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

// ── /auth/apple ────────────────────────────────────────────────────────────────

const APPLE_CLIENT_ID = "com.example.testapp";
const APPLE_ISS = "https://appleid.apple.com";

function b64url(input: Uint8Array): string {
  return btoa(String.fromCharCode(...input))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function encodeJsonB64(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function makeAppleToken(
  overrides?: Record<string, unknown>,
): Promise<{ token: string; jwksFetch: typeof globalThis.fetch }> {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  const kid = crypto.randomUUID();
  const publicJwk = { ...jwk, kid };

  const payload = {
    iss: APPLE_ISS,
    aud: APPLE_CLIENT_ID,
    sub: "apple.user.sub.123",
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: "apple@example.com",
    email_verified: true,
    ...overrides,
  };

  const header = encodeJsonB64({ alg: "RS256", kid });
  const body = encodeJsonB64(payload);
  const sigInput = new TextEncoder().encode(`${header}.${body}`);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    sigInput,
  );
  const token = `${header}.${body}.${b64url(new Uint8Array(sig))}`;

  const jwksFetch = (): Promise<Response> =>
    Promise.resolve(Response.json({ keys: [publicJwk] }));

  return { token, jwksFetch };
}

function makeAppleRouter(kv: Deno.Kv) {
  const router = new Router();
  mountAuthRoutes(router, kv, { ...OPTS, appleClientId: APPLE_CLIENT_ID });
  return router;
}

Deno.test("POST /auth/apple returns 404 when appleClientId not configured", async () => {
  await withTempKv(async (kv) => {
    const router = makeRouter(kv); // no appleClientId
    const res = await router.handle(
      new Request(`${BASE}/auth/apple`, { method: "POST" }),
    );
    assertEquals(res.status, 404);
  });
});

Deno.test("POST /auth/apple returns 400 with missing identityToken", async () => {
  await withTempKv(async (kv) => {
    const router = makeAppleRouter(kv);
    const res = await router.handle(
      new Request(`${BASE}/auth/apple`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    assertEquals(res.status, 400);
  });
});

Deno.test("POST /auth/apple returns 401 for invalid identity token", async () => {
  await withTempKv(async (kv) => {
    const router = makeAppleRouter(kv);
    const origFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(Response.json({ keys: [] }));
    try {
      const res = await router.handle(
        new Request(`${BASE}/auth/apple`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identityToken: "not.a.valid.jwt.here" }),
        }),
      );
      assertEquals(res.status, 401);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

Deno.test("POST /auth/apple creates user and returns cookie for new user", async () => {
  await withTempKv(async (kv) => {
    const { token, jwksFetch } = await makeAppleToken();
    const router = makeAppleRouter(kv);
    const origFetch = globalThis.fetch;
    globalThis.fetch = jwksFetch;
    try {
      const res = await router.handle(
        new Request(`${BASE}/auth/apple`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identityToken: token }),
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
      assertExists(res.headers.get("Set-Cookie"));
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

Deno.test("POST /auth/apple signs in returning user by Apple sub", async () => {
  await withTempKv(async (kv) => {
    // First sign-in creates the user
    const { token: firstToken, jwksFetch } = await makeAppleToken();
    const router = makeAppleRouter(kv);
    const origFetch = globalThis.fetch;
    globalThis.fetch = jwksFetch;
    try {
      const firstRes = await router.handle(
        new Request(`${BASE}/auth/apple`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identityToken: firstToken }),
        }),
      );
      assertEquals(firstRes.status, 200);

      // Second sign-in: same sub, no email (Apple omits it after the first sign-in)
      const { token: returnToken, jwksFetch: returnFetch } =
        await makeAppleToken({
          sub: "apple.user.sub.123",
          email: undefined,
          email_verified: undefined,
        });
      globalThis.fetch = returnFetch;

      const secondRes = await router.handle(
        new Request(`${BASE}/auth/apple`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identityToken: returnToken }),
        }),
      );
      // Sub is known from first sign-in, so sign-in succeeds without email
      assertEquals(secondRes.status, 200);
      assertExists(secondRes.headers.get("Set-Cookie"));
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

Deno.test("POST /auth/apple returns 400 when sub unknown and email absent", async () => {
  await withTempKv(async (kv) => {
    const { token, jwksFetch } = await makeAppleToken({
      sub: "unknown.sub.no.email",
      email: undefined,
      email_verified: undefined,
    });
    const router = makeAppleRouter(kv);
    const origFetch = globalThis.fetch;
    globalThis.fetch = jwksFetch;
    try {
      const res = await router.handle(
        new Request(`${BASE}/auth/apple`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identityToken: token }),
        }),
      );
      assertEquals(res.status, 400);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
