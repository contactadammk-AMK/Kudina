const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');
const { verifyTrader } = require('../../lib/auth');
const monnify = require('../../lib/monnify');

// POST /api/wallet/create   { trader_id, trader_secret, bvn?, nin? }
// Idempotent: if the trader already has a wallet, just returns it.
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

  try {
    const supabase = getSupabaseAdmin();
    const trader = await verifyTrader(supabase, body.trader_id, body.trader_secret);
    if (!trader) return res.status(401).json({ error: 'Unknown trader or wrong device key.' });

    const { data: existingWallet } = await supabase
      .from('wallets').select('*').eq('trader_id', trader.id).maybeSingle();
    if (existingWallet) return res.status(200).json({ wallet: publicWallet(existingWallet), created: false });

    const accountReference = `KUD-${trader.id}`;
    const accountName = (trader.business_name || 'Kudina Trader').slice(0, 100);
    // Most informal traders don't have (or want to type) an email address —
    // Monnify requires one to create the account, so we synthesize a stable,
    // never-delivered placeholder rather than asking for one in the UI.
    const customerEmail = `${trader.id}@wallet.kudina.app`;

    let monnifyAccount;
    try {
      monnifyAccount = await monnify.createReservedAccount({
        accountReference,
        accountName,
        customerEmail,
        customerName: accountName,
        bvn: body.bvn,
        nin: body.nin,
      });
    } catch (err) {
      // If this trader's reference was already reserved on Monnify's side
      // (e.g. a previous attempt succeeded there but our DB write failed),
      // recover the existing account instead of erroring out.
      console.error('createReservedAccount failed, attempting recovery fetch', err.message);
      monnifyAccount = await monnify.getReservedAccount(accountReference).catch(() => null);
      if (!monnifyAccount) throw err;
    }

    const primaryAccount = (monnifyAccount.accounts && monnifyAccount.accounts[0]) || {};

    const { data: wallet, error: insertErr } = await supabase
      .from('wallets')
      .insert({
        trader_id: trader.id,
        monnify_account_reference: accountReference,
        monnify_reservation_reference: monnifyAccount.reservationReference || null,
        account_number: primaryAccount.accountNumber || null,
        account_name: monnifyAccount.accountName || accountName,
        bank_name: primaryAccount.bankName || null,
        bank_code: primaryAccount.bankCode || null,
        bvn_linked: !!body.bvn,
      })
      .select('*')
      .single();
    if (insertErr) throw insertErr;

    return res.status(201).json({ wallet: publicWallet(wallet), created: true });
  } catch (err) {
    console.error('wallet create error', err);
    return res.status(500).json({ error: 'Could not set up the wallet right now. Please try again shortly.' });
  }
};

function publicWallet(w) {
  return {
    account_number: w.account_number,
    account_name: w.account_name,
    bank_name: w.bank_name,
    balance: w.balance,
    bvn_linked: w.bvn_linked,
    created_at: w.created_at,
  };
}
