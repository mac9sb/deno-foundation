import { assertEquals, assertNotEquals } from "@std/assert";
import {
  clearSessionCookie,
  createSession,
  revokeSession,
  validateSession,
} from "../src/session.ts";
import { withTempKv } from "./_helpers.ts";

Deno.test("createSession stores a session and returns a cookie", async () => {
  await withTempKv(async (kv) => {
    const { session, cookie } = await createSession(kv, "user-1");
    assertEquals(session.userId, "user-1");
    assertEquals(typeof session.id, "string");
    assertEquals(cookie.includes("session_id="), true);
    assertEquals(cookie.includes("HttpOnly"), true);
    assertEquals(cookie.includes("Secure"), true);
    assertEquals(cookie.includes("SameSite=Lax"), true);
  });
});

Deno.test("validateSession returns session for valid cookie", async () => {
  await withTempKv(async (kv) => {
    const { session, cookie } = await createSession(kv, "user-2");
    const req = new Request("https://example.com/", {
      headers: { cookie },
    });
    const found = await validateSession(kv, req);
    assertEquals(found?.id, session.id);
    assertEquals(found?.userId, "user-2");
  });
});

Deno.test("validateSession returns null for missing cookie", async () => {
  await withTempKv(async (kv) => {
    const req = new Request("https://example.com/");
    const result = await validateSession(kv, req);
    assertEquals(result, null);
  });
});

Deno.test("validateSession returns null for unknown session id", async () => {
  await withTempKv(async (kv) => {
    const req = new Request("https://example.com/", {
      headers: { cookie: "session_id=not-a-real-id" },
    });
    const result = await validateSession(kv, req);
    assertEquals(result, null);
  });
});

Deno.test("revokeSession makes session invalid", async () => {
  await withTempKv(async (kv) => {
    const { session, cookie } = await createSession(kv, "user-3");
    await revokeSession(kv, session.id);
    const req = new Request("https://example.com/", {
      headers: { cookie },
    });
    const result = await validateSession(kv, req);
    assertEquals(result, null);
  });
});

Deno.test("createSession respects custom ttlMs", async () => {
  await withTempKv(async (kv) => {
    const { session } = await createSession(kv, "user-4", {
      ttlMs: 60_000,
    });
    const maxAge = Math.floor(60_000 / 1000);
    assertEquals(session.expiresAt - session.createdAt, 60_000);
    assertEquals(maxAge, 60);
  });
});

Deno.test("clearSessionCookie returns a cookie that expires immediately", () => {
  const cookie = clearSessionCookie();
  assertEquals(cookie.includes("Max-Age=0"), true);
  assertEquals(cookie.includes("session_id=;"), true);
});

Deno.test("two sessions for same user have different ids", async () => {
  await withTempKv(async (kv) => {
    const { session: s1 } = await createSession(kv, "user-5");
    const { session: s2 } = await createSession(kv, "user-5");
    assertNotEquals(s1.id, s2.id);
  });
});
