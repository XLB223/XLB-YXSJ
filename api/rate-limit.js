const buckets = new Map();

function prune(now) {
  if (buckets.size < 2000) return;
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Simple in-memory sliding window counter.
 * @returns {{ ok: true } | { ok: false, retryAfterSec: number, error: string }}
 */
export function checkRateLimit(key, { limit, windowMs, message } = {}) {
  const max = Number(limit) || 30;
  const window = Number(windowMs) || 60_000;
  const now = Date.now();
  prune(now);

  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + window });
    return { ok: true };
  }

  if (current.count >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return {
      ok: false,
      retryAfterSec,
      error: message || `请求过于频繁，请 ${retryAfterSec} 秒后再试`,
    };
  }

  current.count += 1;
  return { ok: true };
}

export function clientKey(req, suffix = "") {
  // Prefer nginx X-Real-IP; do not trust client-controlled first XFF hop.
  const realIp = String(req.headers?.["x-real-ip"] || "").trim();
  const forwarded = String(req.headers?.["x-forwarded-for"] || "");
  const forwardedParts = forwarded
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const proxyIp = forwardedParts.length ? forwardedParts[forwardedParts.length - 1] : "";
  const ip = realIp || proxyIp || req.socket?.remoteAddress || "unknown";
  return `${ip}:${suffix}`;
}
