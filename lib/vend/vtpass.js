// VTpass client. Chosen as the first (and, in this build, only) VTU
// provider because it has genuine public API docs to verify against —
// CheapDataHub / VTU.ng / BlessData, named in the original spec, don't have
// documentation solid enough to write real code against without guessing
// field names. lib/vend/router.js is structured so adding a second provider
// later is one new adapter file, not a rewrite.

function baseUrl() {
  return process.env.VTPASS_BASE_URL || 'https://sandbox.vtpass.com/api';
}

function getHeaders(method) {
  const apiKey = process.env.VTPASS_API_KEY;
  const publicKey = process.env.VTPASS_PUBLIC_KEY;
  const secretKey = process.env.VTPASS_SECRET_KEY;
  if (!apiKey) throw new Error('Missing VTPASS_API_KEY environment variable.');

  // VTpass: GET requests use api-key + public-key; POST requests use
  // api-key + secret-key. Mixing these up is a common integration mistake
  // that produces confusing auth errors, so it's enforced here rather than
  // left to the caller.
  if (method === 'GET') {
    if (!publicKey) throw new Error('Missing VTPASS_PUBLIC_KEY environment variable.');
    return { 'api-key': apiKey, 'public-key': publicKey };
  }
  if (!secretKey) throw new Error('Missing VTPASS_SECRET_KEY environment variable.');
  return { 'api-key': apiKey, 'secret-key': secretKey, 'Content-Type': 'application/json' };
}

async function vtpassRequest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: getHeaders(method),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.response_description || `VTpass request failed (${res.status})`);
    err.vtpassResponse = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

// Required format per VTpass docs: YYYYMMDDHHII (today's date + hour +
// minute) optionally followed by any alphanumeric string. Doubles as our
// idempotency key on their side — resubmitting the same request_id is
// documented to return the original transaction rather than charge again.
function generateRequestId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  const rand = Math.random().toString(36).slice(2, 10);
  return `${stamp}${rand}`;
}

// Network name -> VTpass serviceID prefix. VTpass still uses "etisalat" as
// the internal identifier for what's branded 9mobile.
const NETWORK_PREFIX = { mtn: 'mtn', airtel: 'airtel', glo: 'glo', '9mobile': 'etisalat' };

function dataServiceId(network) {
  const prefix = NETWORK_PREFIX[network];
  if (!prefix) throw new Error(`Unknown network: ${network}`);
  return `${prefix}-data`;
}
function airtimeServiceId(network) {
  const prefix = NETWORK_PREFIX[network];
  if (!prefix) throw new Error(`Unknown network: ${network}`);
  return prefix;
}

async function getDataVariations(network) {
  const serviceID = dataServiceId(network);
  const data = await vtpassRequest(`/service-variations?serviceID=${encodeURIComponent(serviceID)}`);
  const variations = (data.content && data.content.varations) || []; // VTpass's own typo, not ours
  return variations.map(v => ({
    variationCode: v.variation_code,
    name: v.name,
    costPrice: Number(v.variation_amount),
  }));
}

async function purchaseData({ network, variationCode, phone, costPrice }) {
  const requestId = generateRequestId();
  const result = await vtpassRequest('/pay', {
    method: 'POST',
    body: {
      request_id: requestId,
      serviceID: dataServiceId(network),
      billersCode: phone,
      variation_code: variationCode,
      phone,
      amount: costPrice,
    },
  });
  return normalizePurchaseResult(result, requestId);
}

async function purchaseAirtime({ network, phone, amount }) {
  const requestId = generateRequestId();
  const result = await vtpassRequest('/pay', {
    method: 'POST',
    body: {
      request_id: requestId,
      serviceID: airtimeServiceId(network),
      amount,
      phone,
    },
  });
  return normalizePurchaseResult(result, requestId);
}

// Electricity (per-DISCO), cable TV, and exam-PIN services all need a
// "who am I actually paying" check before money moves — unlike airtime/data,
// getting the meter/smartcard/profile-ID wrong sends someone else's bill
// paid, not just a failed transaction. merchant-verify resolves a name from
// the biller code so the UI can show "Paying: JOHN DOE — is this right?"
// before confirming, same pattern as the bank withdrawal name check.
async function verifyCustomer({ serviceID, billersCode, meterType }) {
  const body = { billersCode, serviceID };
  if (meterType) body.type = meterType; // 'prepaid' | 'postpaid', electricity only
  const result = await vtpassRequest('/merchant-verify', { method: 'POST', body });
  const c = result.content || {};
  return { customerName: c.Customer_Name || c.customerName || null, raw: result };
}

// Electricity DISCOs. Pulled from VTpass's documented per-DISCO API pages
// rather than the live /services list — worth a one-time check against
// https://vtpass.com/api/services?identifier=electricity-bill before go-live
// to confirm these serviceIDs haven't changed.
const ELECTRICITY_DISCOS = [
  { serviceID: 'ikeja-electric', name: 'Ikeja Electric (IKEDC)' },
  { serviceID: 'eko-electric', name: 'Eko Electric (EKEDC)' },
  { serviceID: 'abuja-electric', name: 'Abuja Electric (AEDC)' },
  { serviceID: 'kano-electric', name: 'Kano Electric (KEDCO)' },
  { serviceID: 'portharcourt-electric', name: 'Port Harcourt Electric (PHED)' },
  { serviceID: 'jos-electric', name: 'Jos Electric (JED)' },
  { serviceID: 'ibadan-electric', name: 'Ibadan Electric (IBEDC)' },
  { serviceID: 'kaduna-electric', name: 'Kaduna Electric (KAEDCO)' },
  { serviceID: 'enugu-electric', name: 'Enugu Electric (EEDC)' },
  { serviceID: 'benin-electric', name: 'Benin Electric (BEDC)' },
  { serviceID: 'aba-electric', name: 'Aba Electric (ABEDC)' },
  { serviceID: 'yola-electric', name: 'Yola Electric (YEDC)' },
];

async function purchaseElectricity({ serviceID, meterType, meterNumber, phone, amount }) {
  const requestId = generateRequestId();
  const result = await vtpassRequest('/pay', {
    method: 'POST',
    body: { request_id: requestId, serviceID, billersCode: meterNumber, variation_code: meterType, amount, phone },
  });
  return normalizePurchaseResult(result, requestId);
}

async function getCableVariations(provider) {
  const data = await vtpassRequest(`/service-variations?serviceID=${encodeURIComponent(provider)}`);
  const variations = (data.content && data.content.varations) || (data.content && data.content.variations) || [];
  return variations.map(v => ({ variationCode: v.variation_code, name: v.name, costPrice: Number(v.variation_amount) }));
}

async function purchaseCable({ provider, smartcardNumber, variationCode, phone, costPrice }) {
  const requestId = generateRequestId();
  const result = await vtpassRequest('/pay', {
    method: 'POST',
    body: {
      request_id: requestId, serviceID: provider, billersCode: smartcardNumber,
      variation_code: variationCode, amount: costPrice, phone, subscription_type: 'renew',
    },
  });
  return normalizePurchaseResult(result, requestId);
}

async function getExamVariations(serviceID) {
  const data = await vtpassRequest(`/service-variations?serviceID=${encodeURIComponent(serviceID)}`);
  const variations = (data.content && data.content.varations) || (data.content && data.content.variations) || [];
  return variations.map(v => ({ variationCode: v.variation_code, name: v.name, costPrice: Number(v.variation_amount) }));
}

// WAEC needs no customer verification (buying a PIN card, not paying an
// existing account); JAMB does (billersCode = the candidate's Profile ID).
async function purchaseExam({ serviceID, variationCode, phone, profileId, costPrice }) {
  const requestId = generateRequestId();
  const body = { request_id: requestId, serviceID, variation_code: variationCode, phone, amount: costPrice };
  body.billersCode = serviceID === 'jamb' ? profileId : phone;
  const result = await vtpassRequest('/pay', { method: 'POST', body });
  return normalizePurchaseResult(result, requestId);
}


async function requery(requestId) {
  const result = await vtpassRequest('/requery', { method: 'POST', body: { request_id: requestId } });
  return normalizePurchaseResult(result, requestId);
}

// VTpass's own transaction status lives at content.transactions.status:
// 'delivered' (success), 'pending' (still processing — genuinely ambiguous,
// not a failure), 'failed', 'reversed' (they refunded it their side), or
// sometimes absent entirely on an error response. Collapsed here into one
// consistent shape the rest of the app can rely on.
function normalizePurchaseResult(result, requestId) {
  const txn = result.content && result.content.transactions;
  const rawStatus = txn && txn.status;
  let status;
  if (result.code === '000' && rawStatus === 'delivered') status = 'SUCCESS';
  else if (rawStatus === 'pending' || result.code === '099') status = 'PENDING';
  else if (rawStatus === 'failed' || rawStatus === 'reversed') status = 'FAILED';
  else status = 'PENDING'; // unrecognized shape — treat as ambiguous, never as success or failure

  return {
    status,
    requestId,
    providerTransactionId: txn ? txn.transactionId : null,
    productName: txn ? txn.product_name : null,
    actualCost: txn ? Number(txn.total_amount ?? txn.unit_price) : null, // what we actually paid VTpass, incl. their discount
    raw: result,
  };
}

module.exports = {
  getDataVariations,
  purchaseData,
  purchaseAirtime,
  requery,
  generateRequestId,
  NETWORK_PREFIX,
  verifyCustomer,
  ELECTRICITY_DISCOS,
  purchaseElectricity,
  getCableVariations,
  purchaseCable,
  getExamVariations,
  purchaseExam,
};
