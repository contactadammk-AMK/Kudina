const monnify = require('../../lib/monnify');

// GET /api/wallet/banks — list of banks for the withdraw form's dropdown.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400'); // reference data, cache hard
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  try {
    const banks = await monnify.getBankList();
    return res.status(200).json({ banks });
  } catch (err) {
    console.error('banks list error', err);
    return res.status(500).json({ error: 'Could not load the bank list right now.' });
  }
};
