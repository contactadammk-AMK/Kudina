// Server-side mirror of the exact scoring logic in app.html (computeScore()).
// Kept in one place so the trader app and the lender portal can never drift
// out of sync with each other.

function computeScore(state) {
  state = state || {};
  const ledger = Array.isArray(state.ledger) ? state.ledger : [];
  const susu = Array.isArray(state.susu) ? state.susu : [];
  const network = Array.isArray(state.network) ? state.network : [];
  const profile = state.profile || {};

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const recent = ledger.filter(e => now - e.ts < 30 * day);
  const sales = ledger.filter(e => (e.kind || '').startsWith('sale'));
  const creditSales = ledger.filter(e => e.kind === 'sale_credit');
  const settledCredit = creditSales.filter(e => e.settled);

  // WATER — liquidity / consistency, max 7
  const activeDays = new Set(recent.map(e => new Date(e.ts).toDateString())).size;
  const water = Math.min(7, Math.round((activeDays / 20) * 5) + (susu.length > 0 ? 2 : 0));

  // EARTH — stability, max 6
  let earth = 0;
  if (profile.name) earth += 1.5;
  if (profile.location) earth += 1.5;
  if (profile.registered === true) earth += 3;
  else if (profile.registered === false) earth += 1;
  earth = Math.min(6, Math.round(earth));

  // FIRE — growth / output, max 7
  const last7 = ledger.filter(e => now - e.ts < 7 * day && (e.kind || '').startsWith('sale')).length;
  const prev7 = ledger.filter(e => now - e.ts >= 7 * day && now - e.ts < 14 * day && (e.kind || '').startsWith('sale')).length;
  const fire = Math.min(7, sales.length > 0 ? Math.round(3 + (last7 >= prev7 ? 2 : 0) + Math.min(2, sales.length / 10)) : 0);

  // AIR — network, max 6
  const air = Math.min(6, network.length + (susu.length > 0 ? 1 : 0));

  // ETHEREAL — trust / repayment, max 7
  const repayRatio = creditSales.length ? settledCredit.length / creditSales.length : 1;
  let ethereal = creditSales.length === 0 ? 3 : Math.round(repayRatio * 7);
  ethereal = Math.min(7, ethereal);

  const total = water + earth + fire + air + ethereal;

  return {
    total,
    max: 33,
    breakdown: [
      { key: 'water', name: 'Cash Flow', value: water, max: 7 },
      { key: 'earth', name: 'Stability', value: earth, max: 6 },
      { key: 'fire', name: 'Growth', value: fire, max: 7 },
      { key: 'air', name: 'Network', value: air, max: 6 },
      { key: 'ethereal', name: 'Trust', value: ethereal, max: 7 },
    ],
  };
}

function summarize(state) {
  state = state || {};
  const ledger = Array.isArray(state.ledger) ? state.ledger : [];
  const susu = Array.isArray(state.susu) ? state.susu : [];
  const network = Array.isArray(state.network) ? state.network : [];

  const sales = ledger.filter(e => (e.kind || '').startsWith('sale'));
  const creditSales = ledger.filter(e => e.kind === 'sale_credit');
  const settledCredit = creditSales.filter(e => e.settled);
  const outstandingCredit = creditSales.filter(e => !e.settled)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const totalSales = sales.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const susuTotal = susu.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const firstTs = ledger.reduce((min, e) => (e.ts && (!min || e.ts < min)) ? e.ts : min, null);

  return {
    totalSalesLogged: sales.length,
    totalSalesValue: totalSales,
    creditSalesIssued: creditSales.length,
    creditSalesSettled: settledCredit.length,
    outstandingCredit,
    savingsContributions: susu.length,
    savingsTotal: susuTotal,
    networkSize: network.length,
    activeSince: firstTs ? new Date(firstTs).toISOString() : null,
  };
}

// Human-friendly code: two groups of 4, uppercase, no ambiguous chars.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
function generateCode(crypto) {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
    if (i === 3) out += '-';
  }
  return out; // e.g. "7F3Q-9B2X"
}

module.exports = { computeScore, summarize, generateCode };
