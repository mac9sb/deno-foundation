import { assertEquals, assertExists } from "@std/assert";
import { sendMagicLink, verifyMagicToken } from "../src/magic_link.ts";
import { sha256Hex } from "../src/crypto.ts";
import { keys } from "../src/kv.ts";
import { mockFetch, withTempKv } from "./_helpers.ts";

const BASE_URL = "https://example.com";

// Set a dummy key so email.ts env check passes; mock fetch prevents real calls.
Deno.env.set("RESEND_API_KEY", "test-key");

Deno.test("sendMagicLink stores only the hashed token", async () => {
  await withTempKv(async (kv) => {
    let capturedBody: Record<string, unknown> = {};
    const fetch = ((_url: unknown, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(new Response("", { status: 200 }));
    }) as typeof globalThis.fetch;

    await sendMagicLink(kv, "user@example.com", {
      baseUrl: BASE_URL,
      fetch,
      rateLimit: false,
    });

    // Extract raw token from the email link
    const link = (capturedBody.text as string).match(/token=([^\s]+)/)?.[1];
    assertExists(link);
    const rawToken = link;
    const hashedToken = await sha256Hex(rawToken);

    // Raw token must NOT be in KV
    const rawEntry = await kv.get(["magic", "token", rawToken]);
    assertEquals(rawEntry.value, null);

    // Hashed token MUST be in KV
    const hashedEntry = await kv.get(keys.magic(hashedToken));
    assertExists(hashedEntry.value);
  });
});

Deno.test("verifyMagicToken returns email and marks token as used", async () => {
  await withTempKv(async (kv) => {
    let capturedText = "";
    const fetch = ((_url: unknown, init: RequestInit) => {
      capturedText = JSON.parse(init.body as string).text;
      return Promise.resolve(new Response("", { status: 200 }));
    }) as typeof globalThis.fetch;

    await sendMagicLink(kv, "user@example.com", {
      baseUrl: BASE_URL,
      fetch,
      rateLimit: false,
    });

    const rawToken = capturedText.match(/token=([^\s]+)/)?.[1]!;
    const result = await verifyMagicToken(kv, rawToken);

    assertEquals(result?.email, "user@example.com");

    // Second use must fail (replay prevention)
    const replay = await verifyMagicToken(kv, rawToken);
    assertEquals(replay, null);
  });
});

Deno.test("verifyMagicToken returns null for unknown token", async () => {
  await withTempKv(async (kv) => {
    const result = await verifyMagicToken(kv, "totally-fake-token");
    assertEquals(result, null);
  });
});

Deno.test("sendMagicLink respects rate limit", async () => {
  await withTempKv(async (kv) => {
    const fetch = mockFetch(200);

    for (let i = 0; i < 5; i++) {
      const r = await sendMagicLink(kv, "rl@example.com", {
        baseUrl: BASE_URL,
        fetch,
      });
      assertEquals(r.ok, true);
    }

    const blocked = await sendMagicLink(kv, "rl@example.com", {
      baseUrl: BASE_URL,
      fetch,
    });
    assertEquals(blocked.ok, false);
    assertExists(blocked.retryAfter);
  });
});

Deno.test("sendMagicLink skips rate limit when rateLimit is false", async () => {
  await withTempKv(async (kv) => {
    const fetch = mockFetch(200);
    for (let i = 0; i < 10; i++) {
      const r = await sendMagicLink(kv, "nrl@example.com", {
        baseUrl: BASE_URL,
        fetch,
        rateLimit: false,
      });
      assertEquals(r.ok, true);
    }
  });
});
