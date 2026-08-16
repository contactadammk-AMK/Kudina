const crypto = require('crypto');
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');
const { verifyTrader } = require('../../lib/auth');
const { selectProvider } = require('../../lib/vend/router');
const { detectNetwork } = require('../../lib/vend/networkPrefixes');

const NETWORKS = ['mtn', 'airtel', 'glo', '9mobile'];
const CABLE_PROVIDERS = ['dstv', 'gotv', 'startimes'];
const EXAM_SERVICES = ['waec', 'jamb'];
const MIN_AIRTIME = 50, MAX_AIRTIME = 50000;
const MIN_ELECTRICITY = 500, MAX_ELECTRICITY = 500000; // some DISCOs enforce higher band minimums; VTpass's own response rejects below-minimum amounts, which flows through the normal FAILED->refund path
const MARKUP_PERCENT = Number(process.env.VEND_DATA_MARKUP_PERCENT || 5);

// POST /api/vend/purchase
// data:        { kind:'data', network, phone, variation_code, client_reference }
// airtime:     { kind:'airtime', network, phone, amount, client_reference }
// electricity: { kind:'electricity', network:<disco serviceID>, phone, biller_code:<meter>, meter_type:'prepaid'|'postpaid', amount, customer_name?, client_reference }
// cable:       { kind:'cable', network:'dstv'|'gotv'|'startimes', phone, biller_code:<smartcard>, variation_code, customer_name?, client_reference }
// exam:        { kind:'exam', network:'waec'|'jamb', phone, variation_code, biller_code:<jamb profile id, jamb only>, customer_name?, client_reference }
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    return res.status(400).json({ error: 'Malformed request body.' });
  }

  const kind = body.kind;
  const network = (body.network || '').toLowerCase();
  const phone = (body.phone || '').toString().trim();
  const billerCode = (body.biller_code || '').toString().trim();
  const customerNameInput = (body.customer_name || '').toString().trim().slice(0, 100) || null;
  const clientReference = (body.client_reference || '').toString().trim();

  if (!['data', 'airtime', 'electricity', 'cable', 'exam'].includes(kind)) {
    return res.status(400).json({ error: "kind must be 'data', 'airtime', 'electricity', 'cable', or 'exam'." });
  }
  if (!/^0\d{10}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid 11-digit phone number starting with 0.' });
  if (!clientReference || clientReference.length < 8 || clientReference.length > 100) {
    return res.status(400).json({ error: 'Missing or malformed client_reference — refresh the app and try again.' });
  }

  if (kind === 'data' || kind === 'airtime') {
    if (!NETWORKS.includes(network)) return res.status(400).json({ error: `network must be one of: ${NETWORKS.join(', ')}` });
    const actualNetwork = detectNetwork(phone);
    if (actualNetwork && actualNetwork !== network) {
      return res.status(400).json({ error: `That number looks like ${actualNetwork.toUpperCase()}, not ${network.toUpperCase()} — double-check before continuing.` });
    }
  }
  if (kind === 'cable' && !CABLE_PROVIDERS.includes(network)) {
    return res.status(400).json({ error: `network must be one of: ${CABLE_PROVIDERS.join(', ')}` });
  }
  if (kind === 'exam' && !EXAM_SERVICES.includes(network)) {
    return res.status(400).json({ error: `network must be one of: ${EXAM_SERVICES.join(', ')}` });
  }
  if ((kind === 'electricity' || kind === 'cable') && !/^\d{5,20}$/.test(billerCode)) {
    return res.status(400).json({ error: kind === 'electricity' ? 'Enter a valid meter number.' : 'Enter a valid smartcard number.' });
  }
  if (kind === 'exam' && network === 'jamb' && !/^\d{5,20}$/.test(billerCode)) {
    return res.status(400).json({ error: 'Enter a valid JAMB Profile ID.' });
  }
  if (kind === 'electricity' && !['prepaid', 'postpaid'].includes(body.meter_type)) {
    return res.status(400).json({ error: "meter_type must be 'prepaid' or 'postpaid'." });
  }

  try {
    const supabase = getSupabaseAdmin();
    const trader = await verifyTrader(supabase, body.trader_id, body.trader_secret);
    if (!trader) return res.status(401).json({ error: 'Unknown trader or wrong device key.' });

    const { adapter, name: providerName } = selectProvider();

    const { data: wallet, error: walletErr } = await supabase.from('wallets').select('id, balance').eq('trader_id', trader.id).maybeSingle();
    if (walletErr) throw walletErr;
    if (!wallet) return res.status(404).json({ error: 'No wallet yet — set one up first.' });

    // Determine what to charge. Cost is always re-fetched fresh from the
    // provider right here, never taken from the client — a manipulated
    // variation_code/amount in the request body must not be able to set
    // its own price.
    let sellPrice, variationCode = null, productLabel;

    if (kind === 'data') {
      variationCode = (body.variation_code || '').toString();
      if (!variationCode) return res.status(400).json({ error: 'Select a data bundle.' });
      const variations = await adapter.getDataVariations(network);
      const match = variations.find(v => v.variationCode === variationCode);
      if (!match) return res.status(400).json({ error: 'That bundle is no longer available — refresh and pick again.' });
      sellPrice = Math.ceil(match.costPrice * (1 + MARKUP_PERCENT / 100));
      productLabel = match.name;

    } else if (kind === 'airtime') {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < MIN_AIRTIME || amount > MAX_AIRTIME) {
        return res.status(400).json({ error: `Enter an airtime amount between ₦${MIN_AIRTIME} and ₦${MAX_AIRTIME}.` });
      }
      sellPrice = amount; // sold at face value; margin comes from VTpass's own discount, recorded after purchase
      productLabel = `${network.toUpperCase()} Airtime`;

    } else if (kind === 'electricity') {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < MIN_ELECTRICITY || amount > MAX_ELECTRICITY) {
        return res.status(400).json({ error: `Enter an amount between ₦${MIN_ELECTRICITY} and ₦${MAX_ELECTRICITY}.` });
      }
      const disco = adapter.ELECTRICITY_DISCOS.find(d => d.serviceID === network);
      if (!disco) return res.status(400).json({ error: 'Unknown electricity provider.' });
      sellPrice = amount; // face value; DISCO deducts its own commission, reflected in actualCost after purchase
      productLabel = `${disco.name} (${body.meter_type})`;

    } else if (kind === 'cable') {
      variationCode = (body.variation_code || '').toString();
      if (!variationCode) return res.status(400).json({ error: 'Select a bouquet.' });
      const variations = await adapter.getCableVariations(network);
      const match = variations.find(v => v.variationCode === variationCode);
      if (!match) return res.status(400).json({ error: 'That bouquet is no longer available — refresh and pick again.' });
      sellPrice = Math.ceil(match.costPrice); // no markup -- cable margins are already thin/regulated
      productLabel = match.name;

    } else { // exam
      variationCode = (body.variation_code || '').toString();
      if (!variationCode) return res.status(400).json({ error: 'Select an option.' });
      const variations = await adapter.getExamVariations(network);
      const match = variations.find(v => v.variationCode === variationCode);
      if (!match) return res.status(400).json({ error: 'That option is no longer available — refresh and pick again.' });
      sellPrice = Math.ceil(match.costPrice);
      productLabel = match.name;
    }

    if (Number(wallet.balance) < sellPrice) {
      return res.status(400).json({ error: `Insufficient balance. Wallet has ₦${Number(wallet.balance).toLocaleString()}.` });
    }

    // Step 1: atomically reserve the funds. Idempotent on clientReference --
    // a retried/duplicate submission returns the original result instead
    // of debiting twice.
    const { data: debitData, error: debitErr } = await supabase.rpc('debit_wallet_for_vend', {
      p_wallet_id: wallet.id,
      p_trader_id: trader.id,
      p_amount: sellPrice,
      p_client_reference: clientReference,
      p_narration: `${productLabel} for ${phone}`,
    });
    if (debitErr) {
      if (String(debitErr.message).includes('insufficient_funds')) {
        return res.status(400).json({ error: 'Insufficient balance.' });
      }
      if (debitErr.code === '23505' || /duplicate key/i.test(String(debitErr.message))) {
        return await respondFromExistingOrder(supabase, trader.id, clientReference, res);
      }
      throw debitErr;
    }
    const { transaction_id: transactionId, new_balance: balanceAfter, was_duplicate: wasDuplicate } = Array.isArray(debitData) ? debitData[0] : debitData;
    if (wasDuplicate) return await respondFromExistingOrder(supabase, trader.id, clientReference, res, balanceAfter);

    // Step 2: create the vend_orders row up front (status 'pending') so
    // there's a durable record even if the process dies before Step 3 replies.
    const { data: order, error: orderErr } = await supabase
      .from('vend_orders')
      .insert({
        trader_id: trader.id,
        wallet_transaction_id: transactionId,
        kind, network, phone,
        biller_code: billerCode || null,
        customer_name: customerNameInput,
        variation_code: variationCode,
        product_name: productLabel,
        sell_price: sellPrice,
        provider: providerName,
        provider_request_id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        client_reference: clientReference,
        status: 'pending',
      })
      .select('*').single();
    if (orderErr) throw orderErr;

    // Step 3: call VTpass. Same three-outcome handling as wallet withdrawals:
    // definite success, definite failure (refund), or ambiguous (leave
    // pending for reconciliation -- never guess).
    let result;
    try {
      if (kind === 'data') result = await adapter.purchaseData({ network, variationCode, phone, costPrice: sellPrice });
      else if (kind === 'airtime') result = await adapter.purchaseAirtime({ network, phone, amount: sellPrice });
      else if (kind === 'electricity') result = await adapter.purchaseElectricity({ serviceID: network, meterType: body.meter_type, meterNumber: billerCode, phone, amount: sellPrice });
      else if (kind === 'cable') result = await adapter.purchaseCable({ provider: network, smartcardNumber: billerCode, variationCode, phone, costPrice: sellPrice });
      else result = await adapter.purchaseExam({ serviceID: network, variationCode, phone, profileId: billerCode, costPrice: sellPrice });
    } catch (providerErr) {
      console.error('vend purchase: provider call failed ambiguously — leaving pending', { orderId: order.id, error: providerErr.message });
      return res.status(202).json({
        status: 'pending',
        message: "Purchase is processing. If it doesn't arrive shortly, contact support with this reference.",
        reference: order.provider_request_id,
        balance: balanceAfter,
      });
    }

    // The provider generated its own request_id internally (ignore ours if
    // different) -- reconcile on whichever one it actually used.
    await supabase.from('vend_orders').update({ provider_request_id: result.requestId }).eq('id', order.id);

    if (result.status === 'SUCCESS') {
      await supabase.from('vend_orders').update({
        status: 'delivered',
        provider_transaction_id: result.providerTransactionId,
        cost_price: result.actualCost,
        raw_response: result.raw,
      }).eq('id', order.id);
      await supabase.from('wallet_transactions').update({ status: 'completed', provider_reference: result.requestId }).eq('id', transactionId);

      return res.status(200).json({
        status: 'delivered',
        product_name: productLabel, network, phone,
        sell_price: sellPrice,
        profit: result.actualCost != null ? Number((sellPrice - result.actualCost).toFixed(2)) : null,
        purchased_code: (result.raw && result.raw.purchased_code) || null, // electricity token / exam PIN, when present
        reference: result.requestId,
        balance: balanceAfter,
      });
    }

    if (result.status === 'FAILED') {
      const { data: newBalance } = await supabase.rpc('refund_failed_payout', { p_transaction_id: transactionId });
      await supabase.from('vend_orders').update({ status: 'failed', raw_response: result.raw }).eq('id', order.id);
      return res.status(400).json({
        error: 'The purchase failed and has been refunded to your wallet.',
        balance: newBalance,
      });
    }

    // PENDING -- VTpass itself says still processing.
    await supabase.from('vend_orders').update({ raw_response: result.raw }).eq('id', order.id);
    return res.status(202).json({
      status: 'pending',
      message: "Purchase is processing. If it doesn't arrive shortly, contact support with this reference.",
      reference: result.requestId,
      balance: balanceAfter,
    });
  } catch (err) {
    console.error('vend purchase error', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};

async function respondFromExistingOrder(supabase, traderId, clientReference, res, fallbackBalance) {
  const { data: order } = await supabase
    .from('vend_orders').select('status, product_name, network, phone, sell_price, cost_price, provider_request_id')
    .eq('trader_id', traderId).eq('client_reference', clientReference).maybeSingle();
  if (!order) return res.status(200).json({ status: 'pending', replay: true, balance: fallbackBalance });
  return res.status(200).json({
    status: order.status === 'delivered' ? 'delivered' : order.status,
    product_name: order.product_name, network: order.network, phone: order.phone,
    sell_price: order.sell_price,
    profit: order.cost_price != null ? Number((order.sell_price - order.cost_price).toFixed(2)) : null,
    reference: order.provider_request_id,
    balance: fallbackBalance,
    replay: true,
  });
}
