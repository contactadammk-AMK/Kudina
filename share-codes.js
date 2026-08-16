const crypto = require('crypto');
const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { verifyTrader } = require('../lib/auth');
const { generateCode } = require('../lib/scoring');

// GET  /api/share-codes?trader_id=...&trader_secret=...
//      -> { codes: [{ code, label, revoked, created_at, expires_at, access_count, last_accessed_at }] }
//
// POST /api/share-codes
//      { trader_id, trader_secret, action: 'create', label?, expires_in_days? }
//      { trader_id, trader_secret, action: 'revoke', code }
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const supabase = getSupabaseAdmin();

    if (req.method === 'GET') {
      const trader_id = req.headers['x-trader-id'];
      const trader_secret = req.headers['x-trader-secret'];
      const trader = await verifyTrader(supabase, trader_id, trader_secret);
      if (!trader) return res.status(401).json({ error: 'Unknown trader or wrong device key.' });

      const { data, error } = await supabase
        .from('share_codes')
        .select('code, label, revoked, expires_at, access_count, last_accessed_at, created_at')
        .eq('trader_id', trader.id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      return res.status(200).json({ codes: data || [] });
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch (e) {
        return res.status(400).json({ error: 'Malformed request body.' });
      }
      const { trader_id, trader_secret, action } = body;

      const trader = await verifyTrader(supabase, trader_id, trader_secret);
      if (!trader) return res.status(401).json({ error: 'Unknown trader or wrong device key.' });

      if (action === 'create') {
        const label = (body.label || '').toString().slice(0, 80) || null;
        const expiresInDays = Number.isFinite(body.expires_in_days) ? body.expires_in_days : null;
        const expiresAt = expiresInDays
          ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
          : null;

        // Retry on the (very unlikely) chance of a code collision.
        let lastErr = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = generateCode(crypto);
          const { data, error } = await supabase
            .from('share_codes')
            .insert({ trader_id: trader.id, code, label, expires_at: expiresAt })
            .select('code, label, expires_at, created_at')
            .single();
          if (!error) return res.status(201).json({ code: data.code, label: data.label, expires_at: data.expires_at, created_at: data.created_at });
          lastErr = error;
        }
        throw lastErr;
      }

      if (action === 'revoke') {
        const code = (body.code || '').toString();
        if (!code) return res.status(400).json({ error: 'Missing code.' });

        const { data, error } = await supabase
          .from('share_codes')
          .update({ revoked: true })
          .eq('trader_id', trader.id)
          .eq('code', code)
          .select('code');
        if (error) throw error;
        if (!data || data.length === 0) {
          return res.status(404).json({ error: 'That code was not found among your share codes.' });
        }

        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "action must be 'create' or 'revoke'." });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('share-codes error', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
