const { selectProvider } = require('../../lib/vend/router');

const VERIFIABLE_KINDS = ['electricity', 'cable', 'jamb'];

// GET /api/vend/verify-customer?kind=electricity&service_id=ikeja-electric&biller_code=1234567890&meter_type=prepaid
// Best-effort, like resolve-account.js — a failure here means "couldn't
// verify," never "invalid." The purchase form should let the trader
// continue either way, just without the reassuring name-match confirmation.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const kind = req.query.kind;
  const serviceId = (req.query.service_id || '').toString();
  const billerCode = (req.query.biller_code || '').toString().trim();
  const meterType = req.query.meter_type;

  if (!VERIFIABLE_KINDS.includes(kind)) return res.status(400).json({ error: 'Invalid kind for verification.' });
  if (!serviceId || !billerCode) return res.status(400).json({ error: 'Missing service_id or biller_code.' });

  try {
    const { adapter } = selectProvider();
    const result = await adapter.verifyCustomer({ serviceID: serviceId, billersCode: billerCode, meterType });
    return res.status(200).json({ customer_name: result.customerName, verified: !!result.customerName });
  } catch (err) {
    console.error('verify-customer could not verify (non-fatal)', err.message);
    return res.status(200).json({ customer_name: null, verified: false });
  }
};
