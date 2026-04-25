export async function withTempKv<T>(
  fn: (kv: Deno.Kv) => Promise<T>,
): Promise<T> {
  const path = await Deno.makeTempFile({ suffix: ".kv" });
  const kv = await Deno.openKv(path);
  try {
    return await fn(kv);
  } finally {
    kv.close();
    await Deno.remove(path);
  }
}

export function mockFetch(
  status: number,
  body = "",
): typeof globalThis.fetch {
  return () => Promise.resolve(new Response(body, { status }));
}
