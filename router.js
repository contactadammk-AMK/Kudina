const vtpass = require('./vtpass');

// Every provider adapter is expected to expose: getDataVariations(network),
// purchaseData(...), purchaseAirtime(...), requery(requestId),
// verifyCustomer(...), getCableVariations(provider), purchaseCable(...),
// getExamVariations(serviceID), purchaseExam(...), and ELECTRICITY_DISCOS.
// Only 'vtpass' is real here — see vtpass.js's header comment for why the
// other three named in the original spec aren't implemented. Adding one
// later means writing lib/vend/<name>.js to the same shape and registering
// it below; nothing else in api/vend/* needs to change.
const PROVIDERS = { vtpass };

function getProvider(name) {
  const provider = PROVIDERS[name || 'vtpass'];
  if (!provider) throw new Error(`Unknown VTU provider: ${name}`);
  return provider;
}

// Single-provider today, so "selection" is just "the one provider" — this
// function is the seam where price/availability-based selection across
// multiple providers would go once there's a second one to choose between.
function selectProvider() {
  return { name: 'vtpass', adapter: PROVIDERS.vtpass };
}

module.exports = { getProvider, selectProvider };
