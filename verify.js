const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');
const { computeScore, summarize } = require('../../lib/scoring');
const { checkRateLimit, clientIp } = require('../../lib/rateLimit');

// GET /api/lender/verify?code=7F3Q-9B2X
// Public endpoint (no trader auth) — the code itself IS the credential.
// Deliberately returns the vitality score + aggregate stats only, never the
// raw ledger, so a lender sees creditworthiness signals without seeing a
// trader's individual customers, prices, or transaction history.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const code = ((req.query && req.query.code) || '').toString().trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Missing code.' });

  try {
    const supabase = getSupabaseAdmin();

    const limit = await checkRateLimit(supabase, `lender-verify:${clientIp(req)}`, { max: 20, windowSeconds: 60 });
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many checks from this connection. Wait a minute and try again.' });
    }

    const { data: shareCode, error: codeErr } = await supabase
      .from('share_codes')
      .select('id, trader_id, revoked, expires_at')
      .eq('code', code)
      .maybeSingle();

    if (codeErr) throw codeErr;
    if (!shareCode) return res.status(404).json({ error: 'That code was not found. Check it with the trader and try again.' });
    if (shareCode.revoked) return res.status(410).json({ error: 'This code has been revoked by the trader and is no longer valid.' });
    if (shareCode.expires_at && new Date(shareCode.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This code has expired. Ask the trader for a new one.' });
    }

    const { data: trader, error: traderErr } = await supabase
      .from('traders')
      .select('business_name, phone, business_type, location, registered, state_json, created_at')
      .eq('id', shareCode.trader_id)
      .maybeSingle();

    if (traderErr) throw traderErr;
    if (!trader) return res.status(404).json({ error: 'Trader record not found.' });

    const score = computeScore(trader.state_json);
    const summary = summarize(trader.state_json);

    // Log the view and bump the counter — fire-and-forget, doesn't block the response.
    supabase.from('share_code_views').insert({ code, trader_id: shareCode.trader_id }).then(() => {}, () => {});
    supabase
      .from('share_codes')
      .update({
        access_count: (shareCode.access_count || 0) + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq('id', shareCode.id)
      .then(() => {}, () => {});

    return res.status(200).json({
      business: {
        name: trader.business_name || 'Unnamed business',
        type: trader.business_type || null,
        location: trader.location || null,
        registered: trader.registered,
        phone: trader.phone || null,
      },
      score,
      summary,
      onKudinaSince: trader.created_at,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('lender verify error', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
