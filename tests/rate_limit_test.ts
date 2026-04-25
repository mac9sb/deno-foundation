import { assertEquals, assertExists } from "@std/assert";
import { enforce } from "../src/rate_limit.ts";
import { withTempKv } from "./_helpers.ts";

const KEY: Deno.KvKey = ["test", "rate", "user1"];

Deno.test("enforce allows requests under the limit", async () => {
  await withTempKv(async (kv) => {
    for (let i = 0; i < 5; i++) {
      const result = await enforce(kv, KEY, { limit: 5, windowMs: 60_000 });
      assertEquals(result.ok, true);
    }
  });
});

Deno.test("enforce blocks the 6th request", async () => {
  await withTempKv(async (kv) => {
    for (let i = 0; i < 5; i++) {
      await enforce(kv, KEY, { limit: 5, windowMs: 60_000 });
    }
    const result = await enforce(kv, KEY, { limit: 5, windowMs: 60_000 });
    assertEquals(result.ok, false);
    assertExists(result.retryAfter);
  });
});

Deno.test("enforce returns retryAfter in seconds", async () => {
  await withTempKv(async (kv) => {
    for (let i = 0; i < 5; i++) {
      await enforce(kv, KEY, { limit: 5, windowMs: 10_000 });
    }
    const result = await enforce(kv, KEY, { limit: 5, windowMs: 10_000 });
    assertEquals(result.ok, false);
    assertEquals(result.retryAfter! <= 10, true);
    assertEquals(result.retryAfter! > 0, true);
  });
});

Deno.test("enforce uses defaults of 5 req / 10 min", async () => {
  await withTempKv(async (kv) => {
    for (let i = 0; i < 5; i++) {
      const r = await enforce(kv, KEY);
      assertEquals(r.ok, true);
    }
    const r = await enforce(kv, KEY);
    assertEquals(r.ok, false);
  });
});

Deno.test("different keys are tracked independently", async () => {
  await withTempKv(async (kv) => {
    const keyA: Deno.KvKey = ["rate", "a"];
    const keyB: Deno.KvKey = ["rate", "b"];

    for (let i = 0; i < 5; i++) {
      await enforce(kv, keyA, { limit: 5, windowMs: 60_000 });
    }
    const blocked = await enforce(kv, keyA, { limit: 5, windowMs: 60_000 });
    assertEquals(blocked.ok, false);

    const ok = await enforce(kv, keyB, { limit: 5, windowMs: 60_000 });
    assertEquals(ok.ok, true);
  });
});
