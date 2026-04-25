import { assertEquals, assertExists } from "@std/assert";
import { mountAuthRoutes } from "../src/auth_routes.ts";
import { Router } from "../src/router.ts";
import { createSession } from "../src/session.ts";
import { mockFetch, withTempKv } from "./_helpers.ts";

Deno.env.set("RESEND_API_KEY", "test-key");

const BASE = "http://localhost:8000";
const OPTS = { baseUrl: BASE, rpId: "localhost", rpName: "Test App" };

function makeRouter(kv: Deno.Kv) {
  const router = new Router();
  mountAuthRoutes(router, kv, OPTS);
  return router;
}

// ── /api/session ───────────────────────────────────────────────────────────────

Deno.test("GET /api/session returns 401 with no session", async () => {
  await withTempKv(async (kv) => {
    const router = makeRouter(kv);
    const res = await router.handle(new Request(`${BASE}/api/session`));
    assertEquals(res.status, 401);
  });
});

Deno.test("GET /api/session returns user data for authenticated request", async () => {
  await withTempKv(async (kv) => {
    const user = { id: "u1", email: "u@test.com", createdAt: 0 };
    await kv.set(["user", "id", "u1"], user);

    const { cookie } = await createSession(kv, "u1");
    const router = makeRouter(kv);

    const res = await router.handle(
      new Request(`${BASE}/api/session`, { headers: { Cookie: cookie } }),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.email, "u@test.com");
    assertEquals(body.userId, "u1");
  });
});

// ── /auth/magic-link ───────────────────────────────────────────────────────────

Deno.test("POST /auth/magic-link returns 400 with missing email", async () => {
  await withTempKv(async (kv) => {
    const router = makeRouter(kv);
    const res = await router.handle(
      new Request(`${BASE}/auth/magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    assertEquals(res.status, 400);
  });
});

Deno.test("POST /auth/magic-link returns 200 and sends email", async () => {
  await withTempKv(async (kv) => {
    const router = new Router();
    mountAuthRoutes(router, kv, { ...OPTS, baseUrl: BASE });

    // Replace global fetch for this test
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(200);
    try {
      const res = await router.handle(
        new Request(`${BASE}/auth/magic-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "u@test.com" }),
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ── /auth/verify ───────────────────────────────────────────────────────────────

Deno.test("GET /auth/verify returns 400 with missing token", async () => {
  await withTempKv(async (kv) => {
    const router = makeRouter(kv);
    const res = await router.handle(new Request(`${BASE}/auth/verify`));
    assertEquals(res.status, 400);
  });
});

Deno.test("GET /auth/verify redirects to expiredPath for invalid token", async () => {
  await withTempKv(async (kv) => {
    const router = makeRouter(kv);
    const res = await router.handle(
      new Request(`${BASE}/auth/verify?token=bad-token`),
    );
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location"), `${BASE}/link-expired`);
  });
});

Deno.test("GET /auth/verify respects custom expiredPath", async () => {
  await withTempKv(async (kv) => {
    const router = new Router();
    mountAuthRoutes(router, kv, { ...OPTS, expiredPath: "/expired" });
    const res = await router.handle(
      new Request(`${BASE}/auth/verify?token=bad-token`),
    );
    assertEquals(res.headers.get("Location"), `${BASE}/expired`);
  });
});

// ── /auth/logout ───────────────────────────────────────────────────────────────

Deno.test("POST /auth/logout redirects to signInPath and clears cookie", async () => {
  await withTempKv(async (kv) => {
    const router = makeRouter(kv);
    const res = await router.handle(
      new Request(`${BASE}/auth/logout`, { method: "POST" }),
    );
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location"), `${BASE}/get-started`);
    assertExists(res.headers.get("Set-Cookie"));
  });
});

Deno.test("POST /auth/logout respects custom signInPath", async () => {
  await withTempKv(async (kv) => {
    const router = new Router();
    mountAuthRoutes(router, kv, { ...OPTS, signInPath: "/sign-in" });
    const res = await router.handle(
      new Request(`${BASE}/auth/logout`, { method: "POST" }),
    );
    assertEquals(res.headers.get("Location"), `${BASE}/sign-in`);
  });
});

// ── passkey stubs return 401 without session ───────────────────────────────────

Deno.test("POST /auth/passkey/register/begin returns 401 without session", async () => {
  await withTempKv(async (kv) => {
    const router = makeRouter(kv);
    const res = await router.handle(
      new Request(`${BASE}/auth/passkey/register/begin`, { method: "POST" }),
    );
    assertEquals(res.status, 401);
  });
});

Deno.test("POST /auth/passkey/register/finish returns 401 without session", async () => {
  await withTempKv(async (kv) => {
    const router = makeRouter(kv);
    const res = await router.handle(
      new Request(`${BASE}/auth/passkey/register/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    assertEquals(res.status, 401);
  });
});
