import { assertEquals, assertStringIncludes } from "@std/assert";
import { mountStripeRoutes } from "../src/stripe_routes.ts";
import { Router } from "../src/router.ts";
import { createSession } from "../src/session.ts";
import { keys } from "../src/kv.ts";
import { withTempKv } from "./_helpers.ts";

const BASE = "http://localhost:8000";
const OPTS = {
  baseUrl: BASE,
  secretKey: "sk_test_dummy",
  webhookSecret: "whsec_test",
};

function makeRouter(kv: Deno.Kv) {
  const router = new Router();
  mountStripeRoutes(router, kv, OPTS);
  return router;
}

function mockGlobalFetch(
  ...responses: Array<{ status: number; body: unknown }>
) {
  let i = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (() => {
    const r = responses[i++] ?? { status: 200, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(r.body), { status: r.status }),
    );
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

async function makeSignature(
  payload: string,
  secret: string,
  timestamp = "1234567890",
) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${timestamp}.${payload}`),
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v1=${hex}`;
}

// ── /api/subscription ──────────────────────────────────────────────────────────

Deno.test("GET /api/subscription returns 401 without session", async () => {
  await withTempKv(async (kv) => {
    const router = makeRouter(kv);
    const res = await router.handle(new Request(`${BASE}/api/subscription`));
    assertEquals(res.status, 401);
  });
});

Deno.test("GET /api/subscription returns subscription for authenticated user", async () => {
  await withTempKv(async (kv) => {
    const sub = {
      subscriptionId: "sub_1",
      customerId: "cus_1",
      priceId: "price_pro",
      status: "active",
      currentPeriodEnd: 9999999999,
      cancelAtPeriodEnd: false,
      updatedAt: 0,
    };
    await kv.set(keys.stripe.subscriptionByUser("u1"), sub);
    const { cookie } = await createSession(kv, "u1");

    const router = makeRouter(kv);
    const res = await router.handle(
      new Request(`${BASE}/api/subscription`, { headers: { Cookie: cookie } }),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.subscription.subscriptionId, "sub_1");
    assertEquals(body.active, true);
  });
});

// ── /billing/checkout ──────────────────────────────────────────────────────────

Deno.test("POST /billing/checkout returns 401 without session", async () => {
  await withTempKv(async (kv) => {
    const router = makeRouter(kv);
    const res = await router.handle(
      new Request(`${BASE}/billing/checkout`, { method: "POST" }),
    );
    assertEquals(res.status, 401);
  });
});

Deno.test("POST /billing/checkout returns 400 without priceId", async () => {
  await withTempKv(async (kv) => {
    const { cookie } = await createSession(kv, "u1");
    const router = makeRouter(kv);
    const res = await router.handle(
      new Request(`${BASE}/billing/checkout`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    assertEquals(res.status, 400);
  });
});

Deno.test("POST /billing/checkout returns 404 when user not in KV", async () => {
  await withTempKv(async (kv) => {
    const { cookie } = await createSession(kv, "ghost");
    const router = makeRouter(kv);
    const res = await router.handle(
      new Request(`${BASE}/billing/checkout`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ priceId: "price_pro" }),
      }),
    );
    assertEquals(res.status, 404);
  });
});

Deno.test("POST /billing/checkout returns checkout url", async () => {
  await withTempKv(async (kv) => {
    const user = { id: "u1", email: "u@test.com", createdAt: 0 };
    await kv.set(keys.user.byId("u1"), user);
    const { cookie } = await createSession(kv, "u1");

    const restore = mockGlobalFetch(
      { status: 200, body: { id: "cus_1" } },
      {
        status: 200,
        body: { url: "https://checkout.stripe.com/pay/cs_test", id: "cs_1" },
      },
    );
    try {
      const router = makeRouter(kv);
      const res = await router.handle(
        new Request(`${BASE}/billing/checkout`, {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ priceId: "price_pro" }),
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertStringIncludes(body.url, "checkout.stripe.com");
    } finally {
      restore();
    }
  });
});

// ── /billing/portal ────────────────────────────────────────────────────────────

Deno.test("POST /billing/portal returns 401 without session", async () => {
  await withTempKv(async (kv) => {
    const router = makeRouter(kv);
    const res = await router.handle(
      new Request(`${BASE}/billing/portal`, { method: "POST" }),
    );
    assertEquals(res.status, 401);
  });
});

Deno.test("POST /billing/portal returns portal url", async () => {
  await withTempKv(async (kv) => {
    await kv.set(keys.stripe.byUser("u1"), {
      stripeId: "cus_1",
      userId: "u1",
      email: "u@test.com",
      createdAt: 0,
    });
    const { cookie } = await createSession(kv, "u1");

    const restore = mockGlobalFetch(
      {
        status: 200,
        body: { url: "https://billing.stripe.com/session/bps_1" },
      },
    );
    try {
      const router = makeRouter(kv);
      const res = await router.handle(
        new Request(`${BASE}/billing/portal`, {
          method: "POST",
          headers: { Cookie: cookie },
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertStringIncludes(body.url, "billing.stripe.com");
    } finally {
      restore();
    }
  });
});

// ── /billing/webhook ───────────────────────────────────────────────────────────

Deno.test("POST /billing/webhook returns 500 when secret not configured", async () => {
  await withTempKv(async (kv) => {
    const router = new Router();
    mountStripeRoutes(router, kv, { baseUrl: BASE, secretKey: "sk_test" });
    const res = await router.handle(
      new Request(`${BASE}/billing/webhook`, { method: "POST", body: "{}" }),
    );
    assertEquals(res.status, 500);
  });
});

Deno.test("POST /billing/webhook returns 400 for invalid signature", async () => {
  await withTempKv(async (kv) => {
    const router = makeRouter(kv);
    const res = await router.handle(
      new Request(`${BASE}/billing/webhook`, {
        method: "POST",
        headers: { "Stripe-Signature": "t=bad,v1=bad" },
        body: "{}",
      }),
    );
    assertEquals(res.status, 400);
  });
});

Deno.test("POST /billing/webhook returns 200 for valid event", async () => {
  await withTempKv(async (kv) => {
    const payload = JSON.stringify({
      type: "invoice.paid",
      data: { object: {} },
    });
    const sig = await makeSignature(payload, "whsec_test");

    const router = makeRouter(kv);
    const res = await router.handle(
      new Request(`${BASE}/billing/webhook`, {
        method: "POST",
        headers: { "Stripe-Signature": sig },
        body: payload,
      }),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.received, true);
  });
});
