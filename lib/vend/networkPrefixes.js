// Server-side mirror of the same lookup used in app.html's UI (duplicated,
// not shared, since the client is plain embedded JS with no module system
// to import from — this is a small, rarely-changing static table, so the
// duplication risk is low). Used as a sanity check so a mismatched
// network+phone pair (accidental client bug, or a tampered request) fails
// fast with a clear error instead of burning an API call and a debit that
// VTpass would likely just reject anyway.
const NETWORK_PREFIXES = {
  mtn: ['0803','0806','0703','0706','0813','0816','0810','0814','0903','0906','0913','0916'],
  airtel: ['0802','0808','0812','0708','0701','0902','0907','0901','0912'],
  glo: ['0805','0807','0705','0815','0811','0905','0915'],
  '9mobile': ['0809','0817','0818','0908','0909'],
};

function detectNetwork(phone) {
  const prefix = String(phone).slice(0, 4);
  for (const net in NETWORK_PREFIXES) {
    if (NETWORK_PREFIXES[net].includes(prefix)) return net;
  }
  return null;
}

module.exports = { NETWORK_PREFIXES, detectNetwork };
