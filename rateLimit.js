// Sliding-window rate limit backed by a Supabase table. Good enough for a
// low/medium traffic public endpoint; stateless Vercel functions can't hold
// counters in memory across invocations, so this trades a small amount of
// DB traffic for correctness across cold starts and multiple regions.
async function checkRateLimit(supabase, bucketKey, { max = 20, windowSeconds = 60 } = {}) {
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();

  const { count, error } = await supabase
    .from('rate_limit_hits')
    .select('id', { count: 'exact', head: true })
    .eq('bucket_key', bucketKey)
    .gte('created_at', windowStart);

  // If the rate-limit check itself fails, fail open (allow the request) —
  // we'd rather risk some abuse than take down the endpoint over a
  // secondary table having an issue.
  if (error) {
    console.error('rate limit check failed, allowing request', error);
    return { allowed: true };
  }

  if (count >= max) {
    return { allowed: false, retryAfterSeconds: windowSeconds };
  }

  supabase.from('rate_limit_hits').insert({ bucket_key: bucketKey }).then(() => {}, () => {});
  return { allowed: true };
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress || 'unknown';
}

module.exports = { checkRateLimit, clientIp };
