const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');
const { verifyTrader } = require('../../lib/auth');

// GET /api/wallet/balance?trader_id=...&trader_secret=...
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const supabase = getSupabaseAdmin();
    const trader_id = req.headers['x-trader-id'];
    const trader_secret = req.headers['x-trader-secret'];
    const trader = await verifyTrader(supabase, trader_id, trader_secret);
    if (!trader) return res.status(401).json({ error: 'Unknown trader or wrong device key.' });

    const { data: wallet, error: walletErr } = await supabase
      .from('wallets').select('*').eq('trader_id', trader.id).maybeSingle();
    if (walletErr) throw walletErr;
    if (!wallet) return res.status(404).json({ error: 'No wallet yet — set one up first.' });

    const { data: txns, error: txnErr } = await supabase
      .from('wallet_transactions')
      .select('type, source, amount, balance_after, narration, status, created_at')
      .eq('wallet_id', wallet.id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (txnErr) throw txnErr;

    return res.status(200).json({
      wallet: {
        account_number: wallet.account_number,
        account_name: wallet.account_name,
        bank_name: wallet.bank_name,
        balance: wallet.balance,
        bvn_linked: wallet.bvn_linked,
      },
      transactions: txns || [],
    });
  } catch (err) {
    console.error('wallet balance error', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
