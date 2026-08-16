const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');
const monnify = require('../../lib/monnify');
const { getProvider } = require('../../lib/vend/router');

// GET /api/wallet/reconcile — called by Vercel Cron only (see vercel.json).
// Sweeps up withdrawals AND VTU purchases left 'pending' after an
// ambiguous provider response (timeout, network error, or a
// still-processing status) and settles them by actually asking the
// provider what happened, instead of guessing.
module.exports = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const supabase = getSupabaseAdmin();
    const payouts = await reconcilePayouts(supabase);
    const vends = await reconcileVendOrders(supabase);
    const results = { payouts, vends };
    console.log('wallet reconcile run', results);
    return res.status(200).json(results);
  } catch (err) {
    console.error('wallet reconcile error', err);
    return res.status(500).json({ error: 'Reconciliation run failed.' });
  }
};

async function reconcilePayouts(supabase) {
  try {
    const { data: pending, error } = await supabase
      .from('wallet_transactions')
      .select('id, wallet_id, amount, provider_reference, created_at')
      .eq('type', 'debit')
      .eq('source', 'payout')
      .eq('status', 'pending')
      .not('provider_reference', 'is', null)
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) throw error;

    const results = { checked: 0, completed: 0, refunded: 0, stillPending: 0, errors: 0 };

    for (const txn of pending || []) {
      results.checked++;
      try {
        const status = await monnify.getTransferStatus(txn.provider_reference);

        if (status.transactionStatus === 'SUCCESS' || status.status === 'SUCCESS') {
          await supabase.from('wallet_transactions').update({ status: 'completed' }).eq('id', txn.id);
          results.completed++;
        } else if (status.transactionStatus === 'FAILED' || status.status === 'FAILED') {
          await supabase.rpc('refund_failed_payout', { p_transaction_id: txn.id });
          results.refunded++;
        } else {
          // Still genuinely pending on Monnify's side — leave it. Anything
          // older than 24h with no resolution gets flagged for a human.
          const ageHours = (Date.now() - new Date(txn.created_at).getTime()) / 3600000;
          if (ageHours > 24) {
            console.error('wallet reconcile: payout pending >24h, needs manual review', { transactionId: txn.id, reference: txn.provider_reference });
          }
          results.stillPending++;
        }
      } catch (err) {
        console.error('wallet reconcile: status check failed for', txn.provider_reference, err.message);
        results.errors++;
      }
    }

    console.log('wallet reconcile: payouts', results);
    return results;
  } catch (err) {
    console.error('wallet reconcile: payouts sweep failed', err);
    return { checked: 0, error: err.message };
  }
}

async function reconcileVendOrders(supabase) {
  try {
    const { data: pending, error } = await supabase
      .from('vend_orders')
      .select('id, wallet_transaction_id, provider, provider_request_id, sell_price, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) throw error;

    const results = { checked: 0, delivered: 0, refunded: 0, stillPending: 0, errors: 0 };

    for (const order of pending || []) {
      results.checked++;
      try {
        const adapter = getProvider(order.provider);
        const status = await adapter.requery(order.provider_request_id);

        if (status.status === 'SUCCESS') {
          await supabase.from('vend_orders').update({
            status: 'delivered',
            provider_transaction_id: status.providerTransactionId,
            cost_price: status.actualCost,
            raw_response: status.raw,
          }).eq('id', order.id);
          if (order.wallet_transaction_id) {
            await supabase.from('wallet_transactions').update({ status: 'completed', provider_reference: status.requestId }).eq('id', order.wallet_transaction_id);
          }
          results.delivered++;
        } else if (status.status === 'FAILED') {
          if (order.wallet_transaction_id) {
            await supabase.rpc('refund_failed_payout', { p_transaction_id: order.wallet_transaction_id });
          }
          await supabase.from('vend_orders').update({ status: 'refunded', raw_response: status.raw }).eq('id', order.id);
          results.refunded++;
        } else {
          const ageHours = (Date.now() - new Date(order.created_at).getTime()) / 3600000;
          if (ageHours > 24) {
            console.error('wallet reconcile: vend order pending >24h, needs manual review', { orderId: order.id, reference: order.provider_request_id });
          }
          results.stillPending++;
        }
      } catch (err) {
        console.error('wallet reconcile: vend requery failed for', order.provider_request_id, err.message);
        results.errors++;
      }
    }

    console.log('wallet reconcile: vend orders', results);
    return results;
  } catch (err) {
    console.error('wallet reconcile: vend sweep failed', err);
    return { checked: 0, error: err.message };
  }
}
