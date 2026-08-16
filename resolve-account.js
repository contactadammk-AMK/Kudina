const monnify = require('../../lib/monnify');

// GET /api/wallet/resolve-account?bank_code=&account_number=
// Best-effort — a failure here means "couldn't verify," not "invalid
// account." The withdraw form should let the trader continue either way,
// just without the reassuring name-match confirmation.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const { bank_code, account_number } = req.query || {};
  if (!bank_code || !account_number) {
    return res.status(400).json({ error: 'Missing bank_code or account_number.' });
  }
  try {
    const result = await monnify.resolveAccountName({ bankCode: bank_code, accountNumber: account_number });
    return res.status(200).json({ account_name: result.accountName, verified: true });
  } catch (err) {
    console.error('resolve-account could not verify (non-fatal)', err.message);
    return res.status(200).json({ account_name: null, verified: false });
  }
};
