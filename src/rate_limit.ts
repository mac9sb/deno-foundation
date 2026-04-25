interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/** Options for {@linkcode enforce}. */
export interface RateLimitOptions {
  /** Maximum number of requests allowed per window. Default: 5. */
  limit?: number;
  /** Length of the sliding window in milliseconds. Default: 10 minutes. */
  windowMs?: number;
}

/** Return value of {@linkcode enforce}. */
export interface RateLimitResult {
  /** `true` if the request is within the limit. */
  ok: boolean;
  /** Seconds until the window resets, present when `ok` is `false`. */
  retryAfter?: number;
}

/**
 * Increments the request counter for `key` in KV and returns whether the
 * request is within the configured rate limit.
 */
export async function enforce(
  kv: Deno.Kv,
  key: Deno.KvKey,
  opts: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const limit = opts.limit ?? 5;
  const windowMs = opts.windowMs ?? 10 * 60 * 1000;
  const now = Date.now();

  const entry = await kv.get<RateLimitEntry>(key);
  const current = entry.value;

  if (!current || now - current.windowStart >= windowMs) {
    await kv.set(key, { count: 1, windowStart: now }, { expireIn: windowMs });
    return { ok: true };
  }

  if (current.count >= limit) {
    const retryAfter = Math.ceil(
      (current.windowStart + windowMs - now) / 1000,
    );
    return { ok: false, retryAfter };
  }

  await kv.set(
    key,
    { count: current.count + 1, windowStart: current.windowStart },
    { expireIn: current.windowStart + windowMs - now },
  );
  return { ok: true };
}
