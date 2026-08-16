const crypto = require('crypto');

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isValidTraderId(id) {
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);
}

function isValidSecret(secret) {
  return typeof secret === 'string' && secret.length >= 20 && secret.length <= 128;
}

// Looks up a trader and checks the supplied secret against the stored hash.
// Returns the trader row on success, or null on any failure. Deliberately
// vague on failure (no "trader not found" vs "wrong secret" distinction)
// so this can't be used to enumerate trader IDs.
async function verifyTrader(supabase, traderId, traderSecret) {
  if (!isValidTraderId(traderId) || !isValidSecret(traderSecret)) return null;

  const { data, error } = await supabase
    .from('traders')
    .select('*')
    .eq('id', traderId)
    .maybeSingle();

  if (error || !data) return null;
  if (!timingSafeEqual(hashSecret(traderSecret), data.secret_hash)) return null;
  return data;
}

module.exports = { hashSecret, timingSafeEqual, isValidTraderId, isValidSecret, verifyTrader };
