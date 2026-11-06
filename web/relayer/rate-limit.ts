// Small fixed-window limiter per key (client IP). In memory: resets when the service restarts.
export function createRateLimiter({ limit, windowMs, now = () => Date.now(), maxKeys = 10_000 }: { limit: number; windowMs: number; now?: () => number; maxKeys?: number }) {
  const hits = new Map<string, { start: number; count: number }>();
  return {
    // Returns 0 when allowed, otherwise the seconds to wait.
    take(key: string): number {
      const t = now();
      if (hits.size > maxKeys) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
      if (hits.size > maxKeys) hits.clear(); // under flood: reset rather than grow without bound
      const entry = hits.get(key);
      if (!entry || t - entry.start >= windowMs) {
        hits.set(key, { start: t, count: 1 });
        return 0;
      }
      if (entry.count >= limit) return Math.max(1, Math.ceil((entry.start + windowMs - t) / 1000));
      entry.count += 1;
      return 0;
    },
  };
}
