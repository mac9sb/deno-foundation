interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfter?: number;
}

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
