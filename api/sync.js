const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { hashSecret, isValidTraderId, isValidSecret, verifyTrader } = require('../lib/auth');

// GET  /api/sync?trader_id=...&trader_secret=...        -> { state }
// POST /api/sync   { trader_id, trader_secret, state }   -> creates trader on
//                                                            first call, else
//                                                            overwrites state
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const supabase = getSupabaseAdmin();

    if (req.method === 'GET') {
      const trader_id = req.headers['x-trader-id'];
      const trader_secret = req.headers['x-trader-secret'];
      const trader = await verifyTrader(supabase, trader_id, trader_secret);
      if (!trader) return res.status(401).json({ error: 'Unknown trader or wrong device key.' });
      return res.status(200).json({ state: trader.state_json, updated_at: trader.updated_at });
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch (e) {
        return res.status(400).json({ error: 'Malformed request body.' });
      }
      const { trader_id, trader_secret, state } = body;

      if (!isValidTraderId(trader_id) || !isValidSecret(trader_secret)) {
        return res.status(400).json({ error: 'Missing or malformed trader_id / trader_secret.' });
      }
      if (!state || typeof state !== 'object') {
        return res.status(400).json({ error: 'Missing state.' });
      }

      const { data: existing } = await supabase
        .from('traders')
        .select('id, secret_hash')
        .eq('id', trader_id)
        .maybeSingle();

      const profile = state.profile || {};

      if (!existing) {
        // First sync from this device — create the trader row, pinning the
        // secret so future syncs must present the same one.
        const { error: insertErr } = await supabase.from('traders').insert({
          id: trader_id,
          secret_hash: hashSecret(trader_secret),
          business_name: profile.name || null,
          phone: profile.phone || null,
          business_type: profile.type || null,
          location: profile.location || null,
          registered: typeof profile.registered === 'boolean' ? profile.registered : null,
          state_json: state,
        });
        if (insertErr) throw insertErr;
        return res.status(201).json({ ok: true, created: true });
      }

      const trader = await verifyTrader(supabase, trader_id, trader_secret);
      if (!trader) return res.status(401).json({ error: 'Wrong device key for this trader.' });

      const { error: updateErr } = await supabase
        .from('traders')
        .update({
          business_name: profile.name || null,
          phone: profile.phone || null,
          business_type: profile.type || null,
          location: profile.location || null,
          registered: typeof profile.registered === 'boolean' ? profile.registered : null,
          state_json: state,
          updated_at: new Date().toISOString(),
        })
        .eq('id', trader_id);
      if (updateErr) throw updateErr;

      return res.status(200).json({ ok: true, created: false });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('sync error', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
