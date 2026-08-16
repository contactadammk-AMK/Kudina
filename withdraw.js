const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');
const { verifyTrader } = require('../../lib/auth');
const monnify = require('../../lib/monnify');

const MIN_WITHDRAW = 100;

// POST /api/wallet/withdraw
// { trader_id, trader_secret, amount, destination_bank_code, destination_account_number, destination_account_name }
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

  const amount = Number(body.amount);
  const bankCode = (body.destination_bank_code || '').toString().trim();
  const accountNumber = (body.destination_account_number || '').toString().trim();
  const accountName = (body.destination_account_name || '').toString().trim().slice(0, 100);
  const clientReference = (body.client_reference || '').toString().trim();

  if (!clientReference || clientReference.length < 8 || clientReference.length > 100) {
    return res.status(400).json({ error: 'Missing or malformed client_reference — this app is out of date, refresh and try again.' });
  }
  if (!Number.isFinite(amount) || amount < MIN_WITHDRAW) {
    return res.status(400).json({ error: `Enter an amount of at least ₦${MIN_WITHDRAW}.` });
  }
  if (!bankCode || !/^\d{10}$/.test(accountNumber)) {
    return res.status(400).json({ error: 'Enter a valid 10-digit account number and select a bank.' });
  }
  if (!accountName) {
    return res.status(400).json({ error: 'Missing destination account name.' });
  }

  try {
    const supabase = getSupabaseAdmin();
    const trader = await verifyTrader(supabase, body.trader_id, body.trader_secret);
    if (!trader) return res.status(401).json({ error: 'Unknown trader or wrong device key.' });

    const { data: wallet, error: walletErr } = await supabase
      .from('wallets').select('id, balance').eq('trader_id', trader.id).maybeSingle();
    if (walletErr) throw walletErr;
    if (!wallet) return res.status(404).json({ error: 'No wallet yet — set one up first.' });
    if (Number(wallet.balance) < amount) {
      return res.status(400).json({ error: `Insufficient balance. Wallet has ₦${Number(wallet.balance).toLocaleString()}.` });
    }

    // Step 1: atomically reserve the funds (debit now, status 'pending').
    // Idempotent on clientReference — if this exact request was already
    // processed (a retry after a dropped response, or a double-tap that
    // slipped past the UI's busy-lock), we get the original result back
    // instead of debiting a second time.
    let debitData, debitErr;
    ({ data: debitData, error: debitErr } = await supabase.rpc('debit_wallet_for_payout', {
      p_wallet_id: wallet.id,
      p_trader_id: trader.id,
      p_amount: amount,
      p_client_reference: clientReference,
      p_narration: `Withdraw to ${accountName} (${accountNumber})`,
    }));

    if (debitErr) {
      if (String(debitErr.message).includes('insufficient_funds')) {
        return res.status(400).json({ error: 'Insufficient balance.' });
      }
      // Unique-constraint hit = two requests with the same client_reference
      // raced each other past the existence check. Whoever lost the race
      // just needs to look up what the winner already did, not error out.
      if (debitErr.code === '23505' || /duplicate key/i.test(String(debitErr.message))) {
        const { data: existing } = await supabase
          .from('wallet_transactions').select('id, balance_after, status')
          .eq('trader_id', trader.id).eq('client_reference', clientReference).maybeSingle();
        if (existing) {
          return res.status(200).json({ status: existing.status, balance: existing.balance_after, reference: `KUDPAY-${existing.id}`, replay: true });
        }
      }
      throw debitErr;
    }

    const { transaction_id: transactionId, new_balance: balanceAfterDebit, was_duplicate: wasDuplicate } = Array.isArray(debitData) ? debitData[0] : debitData;

    if (wasDuplicate) {
      // Already handled by an earlier call with this same client_reference —
      // don't touch Monnify again, just report the prior outcome.
      const { data: existing } = await supabase.from('wallet_transactions').select('status').eq('id', transactionId).maybeSingle();
      return res.status(200).json({ status: existing?.status || 'pending', balance: balanceAfterDebit, reference: `KUDPAY-${transactionId}`, replay: true });
    }

    const monnifyReference = `KUDPAY-${transactionId}`;
    await supabase.from('wallet_transactions').update({ provider_reference: monnifyReference }).eq('id', transactionId);

    // Step 2: call Monnify. Three outcomes matter, each handled differently:
    //   - definite SUCCESS  -> mark completed
    //   - definite FAILED   -> refund automatically, tell trader clearly
    //   - anything ambiguous (network error, timeout, PENDING/2FA state)
    //     -> do NOT auto-refund. Leave it 'pending' for reconciliation.
    //     Refunding on an ambiguous result risks letting the same funds be
    //     withdrawn twice if the transfer actually went through.
    let transferResult;
    try {
      transferResult = await monnify.initiateSingleTransfer({
        amount,
        reference: monnifyReference,
        narration: `Kudina wallet withdrawal`,
        destinationBankCode: bankCode,
        destinationAccountNumber: accountNumber,
        destinationAccountName: accountName,
      });
    } catch (transferErr) {
      console.error('withdraw: Monnify transfer call failed ambiguously — leaving pending for reconciliation', {
        transactionId, monnifyReference, error: transferErr.message,
      });
      return res.status(202).json({
        status: 'pending',
        message: "Withdrawal is processing. If it doesn't arrive shortly, contact support with this reference.",
        reference: monnifyReference,
      });
    }

    if (transferResult.status === 'SUCCESS') {
      await supabase.from('wallet_transactions').update({ status: 'completed' }).eq('id', transactionId);
      return res.status(200).json({ status: 'completed', balance: balanceAfterDebit, reference: monnifyReference });
    }

    if (transferResult.status === 'FAILED') {
      const newBalance = await supabase.rpc('refund_failed_payout', { p_transaction_id: transactionId });
      return res.status(400).json({
        error: 'The transfer failed and has been refunded to your wallet.',
        balance: newBalance.data,
      });
    }

    // PENDING (e.g. two-factor authorization required on the settlement
    // account) — leave as-is, same "don't guess" handling as the network-error case.
    return res.status(202).json({
      status: 'pending',
      message: "Withdrawal is processing. If it doesn't arrive shortly, contact support with this reference.",
      reference: monnifyReference,
    });
  } catch (err) {
    console.error('withdraw error', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
