const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');
const { verifyTrader } = require('../../lib/auth');
const monnify = require('../../lib/monnify');

// POST /api/wallet/attach-kyc   { trader_id, trader_secret, bvn?, nin? }
// Optional at wallet setup, addable any time after. Raises the account's
// transaction limits under CBN's tiered-KYC framework and is where this
// build's identity-verification story actually lives (see the "is this
// enough for a lender" conversation — Kudina's own score still isn't ID
// verification, but a BVN/NIN-linked wallet at least is).
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

  const bvn = (body.bvn || '').toString().trim();
  const nin = (body.nin || '').toString().trim();
  if (!bvn && !nin) return res.status(400).json({ error: 'Provide a BVN or NIN.' });
  if (bvn && !/^\d{11}$/.test(bvn)) return res.status(400).json({ error: 'BVN must be 11 digits.' });
  if (nin && !/^\d{11}$/.test(nin)) return res.status(400).json({ error: 'NIN must be 11 digits.' });

  try {
    const supabase = getSupabaseAdmin();
    const trader = await verifyTrader(supabase, body.trader_id, body.trader_secret);
    if (!trader) return res.status(401).json({ error: 'Unknown trader or wrong device key.' });

    const { data: wallet } = await supabase.from('wallets').select('id, monnify_account_reference').eq('trader_id', trader.id).maybeSingle();
    if (!wallet) return res.status(404).json({ error: 'Set up a wallet first.' });

    await monnify.attachKyc(wallet.monnify_account_reference, { bvn: bvn || undefined, nin: nin || undefined });

    const { error: updateErr } = await supabase.from('wallets').update({ bvn_linked: true }).eq('id', wallet.id);
    if (updateErr) throw updateErr;

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('attach-kyc error', err);
    // Monnify commonly rejects a BVN/NIN that doesn't match the account
    // name on file — surface that distinction rather than a flat 500.
    const msg = err.monnifyResponse?.responseMessage || 'Could not verify that BVN/NIN. Double-check the number and try again.';
    return res.status(400).json({ error: msg });
  }
};
