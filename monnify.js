const crypto = require('crypto');

// Sandbox vs live — set MONNIFY_BASE_URL to https://api.monnify.com in
// production. Defaults to sandbox so a misconfigured deploy fails safe
// (test money, not real money).
function baseUrl() {
  return process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
}

let _tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) return _tokenCache.token;

  const apiKey = process.env.MONNIFY_API_KEY;
  const secretKey = process.env.MONNIFY_SECRET_KEY;
  if (!apiKey || !secretKey) {
    throw new Error('Missing MONNIFY_API_KEY / MONNIFY_SECRET_KEY environment variables.');
  }

  const basic = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
  const res = await fetch(`${baseUrl()}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok || !data.requestSuccessful) {
    throw new Error('Monnify auth failed: ' + (data.responseMessage || res.status));
  }

  const { accessToken, expiresIn } = data.responseBody;
  _tokenCache = { token: accessToken, expiresAt: Date.now() + (Number(expiresIn) - 60) * 1000 };
  return accessToken;
}

async function monnifyRequest(path, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.requestSuccessful === false) {
    const msg = (data && data.responseMessage) || `Monnify request failed (${res.status})`;
    const err = new Error(msg);
    err.monnifyResponse = data;
    err.status = res.status;
    throw err;
  }
  return data.responseBody;
}

// Creates (or, if called again with the same accountReference, effectively
// re-reads via a 400 we treat as "already exists") a dedicated Reserved
// Account. preferredBanks pinned to Moniepoint Microfinance Bank (50515) on
// purpose — see the product discussion: the account should visibly be a
// Moniepoint account, since that's the brand traders already trust and
// transfer to daily. getAllAvailableBanks stays false so Monnify doesn't
// also hand back a Wema/GTBank option that dilutes that.
const MONIEPOINT_BANK_CODE = '50515';

async function createReservedAccount({ accountReference, accountName, customerEmail, customerName, bvn, nin }) {
  const contractCode = process.env.MONNIFY_CONTRACT_CODE;
  if (!contractCode) throw new Error('Missing MONNIFY_CONTRACT_CODE environment variable.');

  const body = {
    accountReference,
    accountName,
    currencyCode: 'NGN',
    contractCode,
    customerEmail,
    customerName,
    getAllAvailableBanks: false,
    preferredBanks: [process.env.MONNIFY_PREFERRED_BANK_CODE || MONIEPOINT_BANK_CODE],
  };
  if (bvn) body.bvn = bvn;
  if (nin) body.nin = nin;

  return monnifyRequest('/api/v2/bank-transfer/reserved-accounts', { method: 'POST', body });
}

async function getReservedAccount(accountReference) {
  return monnifyRequest(`/api/v2/bank-transfer/reserved-accounts/${encodeURIComponent(accountReference)}`);
}

async function attachKyc(accountReference, { bvn, nin }) {
  const body = {};
  if (bvn) body.bvn = bvn;
  if (nin) body.nin = nin;
  return monnifyRequest(`/api/v1/bank-transfer/reserved-accounts/${encodeURIComponent(accountReference)}/kyc-info`, {
    method: 'PUT',
    body,
  });
}

// Payout / withdrawal — moves money OUT of your main Monnify settlement
// account (where reserved-account collections land) to the trader's own
// personal bank account. sourceAccountNumber is YOUR account, not theirs.
async function initiateSingleTransfer({ amount, reference, narration, destinationBankCode, destinationAccountNumber, destinationAccountName }) {
  const sourceAccountNumber = process.env.MONNIFY_SETTLEMENT_ACCOUNT_NUMBER;
  if (!sourceAccountNumber) throw new Error('Missing MONNIFY_SETTLEMENT_ACCOUNT_NUMBER environment variable.');

  return monnifyRequest('/api/v2/disbursements/single', {
    method: 'POST',
    body: {
      amount,
      reference,
      narration,
      destinationBankCode,
      destinationAccountNumber,
      destinationAccountName,
      currency: 'NGN',
      sourceAccountNumber,
    },
  });
}

async function getTransferStatus(reference) {
  return monnifyRequest(`/api/v2/disbursements/transfer-status/${encodeURIComponent(reference)}`);
}

// Reference list for the withdraw form's bank dropdown, so a trader picks
// "Moniepoint Microfinance Bank" from a list instead of having to know a
// bank code exists at all.
let _bankListCache = { list: null, expiresAt: 0 };
async function getBankList() {
  if (_bankListCache.list && Date.now() < _bankListCache.expiresAt) return _bankListCache.list;
  const body = await monnifyRequest('/api/v1/banks');
  const list = (body || []).map(b => ({ code: b.code, name: b.name }));
  _bankListCache = { list, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  return list;
}

// Resolves an account number + bank code to the registered account name, so
// the trader can be shown "Sending to: JOHN A. DANJUMA — is this right?"
// before a payout goes out, instead of trusting a hand-typed name.
// NOTE: verify this exact path against current Monnify docs before go-live
// — account-validation endpoints are the one piece of this file pulled from
// general knowledge rather than a page fetched this session. Callers must
// treat failure here as "couldn't verify," never as "transfer is invalid."
async function resolveAccountName({ accountNumber, bankCode }) {
  const body = await monnifyRequest(
    `/api/v1/disbursements/account/validate?accountNumber=${encodeURIComponent(accountNumber)}&bankCode=${encodeURIComponent(bankCode)}`
  );
  return { accountName: body.accountName, accountNumber: body.accountNumber };
}

// Monnify signs every webhook with header `monnify-signature`:
// HMAC-SHA512(rawRequestBody, yourSecretKey). Must be checked against the
// RAW body string, before JSON.parse — this is why api/wallet/webhook.js
// reads the body as text rather than letting the framework auto-parse it.
function verifyWebhookSignature(rawBody, signatureHeader) {
  const secretKey = process.env.MONNIFY_SECRET_KEY;
  if (!secretKey || !signatureHeader) return false;
  const expected = crypto.createHmac('sha512', secretKey).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  MONIEPOINT_BANK_CODE,
  getAccessToken,
  createReservedAccount,
  getReservedAccount,
  attachKyc,
  initiateSingleTransfer,
  getTransferStatus,
  getBankList,
  resolveAccountName,
  verifyWebhookSignature,
};
