const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');
const { verifyWebhookSignature } = require('../../lib/monnify');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// POST /api/wallet/webhook — called by Monnify, not by the app.
async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['monnify-signature'];

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.error('wallet webhook: signature mismatch — rejecting');
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: 'Malformed JSON.' });
  }

  // Monnify has used two notification shapes over time: a wrapped
  // { eventType, eventData } form and an older flat form. Handle both so a
  // future/legacy contract doesn't silently stop crediting wallets.
  const eventType = payload.eventType || payload.eventData?.eventType || null;
  const d = payload.eventData || payload;

  const paymentStatus = d.paymentStatus || (eventType === 'SUCCESSFUL_TRANSACTION' ? 'PAID' : null);
  const isSuccessful = paymentStatus === 'PAID' || paymentStatus === 'SUCCESS';

  const accountReference = d.product?.reference;
  const transactionReference = d.transactionReference || d.paymentReference;
  const amountPaid = Number(d.amountPaid || d.settlementAmount || 0);

  // Acknowledge anything we don't need to act on (e.g. a FAILED payment
  // notification, or an event type this endpoint doesn't handle) with 200 —
  // Monnify retries on non-2xx, and there's nothing to retry here.
  if (!isSuccessful || !accountReference || !transactionReference || amountPaid <= 0) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: wallet, error: walletErr } = await supabase
      .from('wallets').select('id, trader_id').eq('monnify_account_reference', accountReference).maybeSingle();
    if (walletErr) throw walletErr;
    if (!wallet) {
      // A payment landed on an account reference we don't recognize — log
      // loudly (this needs a human to look at) but still 200 so Monnify
      // doesn't hammer retries on something a retry can't fix.
      console.error('wallet webhook: no wallet found for account reference', accountReference);
      return res.status(200).json({ ok: true, unmatched: true });
    }

    const { data, error: rpcErr } = await supabase.rpc('credit_wallet_idempotent', {
      p_wallet_id: wallet.id,
      p_trader_id: wallet.trader_id,
      p_amount: amountPaid,
      p_provider_reference: transactionReference,
      p_narration: d.paymentDescription || 'Wallet top-up',
      p_raw_payload: payload,
    });
    if (rpcErr) throw rpcErr;

    const result = Array.isArray(data) ? data[0] : data;
    console.log('wallet webhook processed', { accountReference, transactionReference, amountPaid, duplicate: result?.was_duplicate });

    return res.status(200).json({ ok: true, duplicate: !!result?.was_duplicate });
  } catch (err) {
    console.error('wallet webhook processing error', err);
    // 500 here is intentional: it tells Monnify to retry, which is correct
    // when the failure is on our side (e.g. a transient DB error) rather
    // than a reason to silently drop a real payment.
    return res.status(500).json({ error: 'Processing error.' });
  }
}

// Must be set on the exported function itself, after it's defined — Vercel
// reads config off module.exports, so assigning module.exports = handler
// first and attaching .config after (not before) is what makes both work.
module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
