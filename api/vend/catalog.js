const { selectProvider } = require('../../lib/vend/router');

const NETWORKS = ['mtn', 'airtel', 'glo', '9mobile'];
const CABLE_PROVIDERS = ['dstv', 'gotv', 'startimes'];
const EXAM_SERVICES = ['waec', 'jamb'];
const MARKUP_PERCENT = Number(process.env.VEND_DATA_MARKUP_PERCENT || 5); // % added on top of provider cost

// GET /api/vend/catalog?kind=data&network=mtn
// GET /api/vend/catalog?kind=cable&network=dstv
// GET /api/vend/catalog?kind=exam&network=waec
// GET /api/vend/catalog?kind=electricity            (no network needed — returns the DISCO list)
// Returns live prices with markup already applied server-side — the client
// never sees or sets prices.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const kind = (req.query.kind || 'data').toLowerCase();
  const network = (req.query.network || '').toLowerCase();

  try {
    const { adapter } = selectProvider();

    if (kind === 'electricity') {
      return res.status(200).json({ discos: adapter.ELECTRICITY_DISCOS });
    }

    if (kind === 'cable') {
      if (!CABLE_PROVIDERS.includes(network)) return res.status(400).json({ error: `network must be one of: ${CABLE_PROVIDERS.join(', ')}` });
      const variations = await adapter.getCableVariations(network);
      const bundles = variations.filter(v => v.costPrice > 0).map(v => ({ variationCode: v.variationCode, name: v.name, sellPrice: Math.ceil(v.costPrice) }));
      return res.status(200).json({ network, bundles });
    }

    if (kind === 'exam') {
      if (!EXAM_SERVICES.includes(network)) return res.status(400).json({ error: `network must be one of: ${EXAM_SERVICES.join(', ')}` });
      const variations = await adapter.getExamVariations(network);
      const bundles = variations.filter(v => v.costPrice > 0).map(v => ({ variationCode: v.variationCode, name: v.name, sellPrice: Math.ceil(v.costPrice) }));
      return res.status(200).json({ network, bundles });
    }

    // default: data
    if (!NETWORKS.includes(network)) return res.status(400).json({ error: `network must be one of: ${NETWORKS.join(', ')}` });
    const variations = await adapter.getDataVariations(network);
    const bundles = variations
      .filter(v => v.costPrice > 0)
      .map(v => ({ variationCode: v.variationCode, name: v.name, sellPrice: Math.ceil(v.costPrice * (1 + MARKUP_PERCENT / 100)) }));
    return res.status(200).json({ network, bundles });
  } catch (err) {
    console.error('vend catalog error', err);
    return res.status(502).json({ error: "Couldn't load the catalog right now. Try again shortly." });
  }
};

