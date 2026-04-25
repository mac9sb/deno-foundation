import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  createCheckoutSession,
  createOrGetCustomer,
  createPortalSession,
  getSubscription,
  handleWebhookEvent,
  isActiveSubscription,
  verifyWebhook,
} from "../src/stripe.ts";
import { keys } from "../src/kv.ts";
import { withTempKv } from "./_helpers.ts";

const SECRET = "sk_test_dummy";

function mockStripe(
  responses: Array<{ status: number; body: unknown }>,
): typeof globalThis.fetch {
  let i = 0;
  return () => {
    const r = responses[i++] ?? { status: 200, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(r.body), { status: r.status }),
    );
  };
}

// ── createOrGetCustomer ────────────────────────────────────────────────────────

Deno.test("createOrGetCustomer creates and stores a new customer", async () => {
  await withTempKv(async (kv) => {
    const fetch = mockStripe([{ status: 200, body: { id: "cus_123" } }]);
    const customer = await createOrGetCustomer(
      kv,
      "user1",
      "user@example.com",
      {
        secretKey: SECRET,
        fetch,
      },
    );

    assertEquals(customer.stripeId, "cus_123");
    assertEquals(customer.userId, "user1");
    assertEquals(customer.email, "user@example.com");

    // Stored under both lookup keys
    const byUser = await kv.get(keys.stripe.byUser("user1"));
    assertExists(byUser.value);
    const byStripe = await kv.get(keys.stripe.byStripeId("cus_123"));
    assertEquals(byStripe.value, "user1");
  });
});

Deno.test("createOrGetCustomer returns existing customer without calling Stripe", async () => {
  await withTempKv(async (kv) => {
    const fetch = mockStripe([{ status: 200, body: { id: "cus_123" } }]);
    await createOrGetCustomer(kv, "user1", "user@example.com", {
      secretKey: SECRET,
      fetch,
    });

    let callCount = 0;
    const noCallFetch = (() => {
      callCount++;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof globalThis.fetch;

    await createOrGetCustomer(kv, "user1", "user@example.com", {
      secretKey: SECRET,
      fetch: noCallFetch,
    });
    assertEquals(callCount, 0);
  });
});

Deno.test("createOrGetCustomer throws on Stripe error", async () => {
  await withTempKv(async (kv) => {
    const fetch = mockStripe([{
      status: 400,
      body: { error: { message: "bad" } },
    }]);
    await assertRejects(
      () =>
        createOrGetCustomer(kv, "user1", "user@example.com", {
          secretKey: SECRET,
          fetch,
        }),
      Error,
      "Stripe:",
    );
  });
});

// ── createCheckoutSession ──────────────────────────────────────────────────────

Deno.test("createCheckoutSession returns url and sessionId", async () => {
  await withTempKv(async (kv) => {
    const fetch = mockStripe([
      {
        status: 200,
        body: { url: "https://checkout.stripe.com/pay/cs_test", id: "cs_123" },
      },
    ]);
    const result = await createCheckoutSession(kv, "user1", {
      priceId: "price_abc",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      secretKey: SECRET,
      fetch,
    });

    assertEquals(result.url, "https://checkout.stripe.com/pay/cs_test");
    assertEquals(result.sessionId, "cs_123");
  });
});

Deno.test("createCheckoutSession includes existing customer id", async () => {
  await withTempKv(async (kv) => {
    // Seed customer
    await kv.set(keys.stripe.byUser("user1"), {
      stripeId: "cus_existing",
      userId: "user1",
      email: "u@e.com",
      createdAt: 0,
    });

    let capturedBody = "";
    const fetch = ((_url: unknown, init: RequestInit) => {
      capturedBody = (init.body as URLSearchParams).toString();
      return Promise.resolve(
        new Response(JSON.stringify({ url: "https://x", id: "cs_1" }), {
          status: 200,
        }),
      );
    }) as typeof globalThis.fetch;

    await createCheckoutSession(kv, "user1", {
      priceId: "price_abc",
      successUrl: "https://example.com/ok",
      cancelUrl: "https://example.com/cancel",
      secretKey: SECRET,
      fetch,
    });

    assertEquals(capturedBody.includes("cus_existing"), true);
  });
});

// ── createPortalSession ────────────────────────────────────────────────────────

Deno.test("createPortalSession returns billing portal url", async () => {
  await withTempKv(async (kv) => {
    await kv.set(keys.stripe.byUser("user1"), {
      stripeId: "cus_abc",
      userId: "user1",
      email: "u@e.com",
      createdAt: 0,
    });

    const fetch = mockStripe([
      {
        status: 200,
        body: { url: "https://billing.stripe.com/session/bps_123" },
      },
    ]);
    const result = await createPortalSession(kv, "user1", {
      returnUrl: "https://example.com/billing",
      secretKey: SECRET,
      fetch,
    });

    assertEquals(result.url, "https://billing.stripe.com/session/bps_123");
  });
});

Deno.test("createPortalSession throws when no customer exists", async () => {
  await withTempKv(async (kv) => {
    await assertRejects(
      () =>
        createPortalSession(kv, "nobody", {
          returnUrl: "https://example.com",
          secretKey: SECRET,
        }),
      Error,
      "No Stripe customer",
    );
  });
});

// ── verifyWebhook ──────────────────────────────────────────────────────────────

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

Deno.test("verifyWebhook returns true for valid signature", async () => {
  const payload = '{"type":"test"}';
  const sig = await makeSignature(payload, "whsec_test");
  const ok = await verifyWebhook(payload, sig, "whsec_test");
  assertEquals(ok, true);
});

Deno.test("verifyWebhook returns false for wrong secret", async () => {
  const payload = '{"type":"test"}';
  const sig = await makeSignature(payload, "whsec_test");
  const ok = await verifyWebhook(payload, sig, "whsec_wrong");
  assertEquals(ok, false);
});

Deno.test("verifyWebhook returns false for tampered payload", async () => {
  const payload = '{"type":"test"}';
  const sig = await makeSignature(payload, "whsec_test");
  const ok = await verifyWebhook('{"type":"evil"}', sig, "whsec_test");
  assertEquals(ok, false);
});

Deno.test("verifyWebhook returns false for malformed signature header", async () => {
  const ok = await verifyWebhook("payload", "not-a-valid-sig", "secret");
  assertEquals(ok, false);
});

// ── handleWebhookEvent ─────────────────────────────────────────────────────────

Deno.test("handleWebhookEvent stores subscription on created event", async () => {
  await withTempKv(async (kv) => {
    await handleWebhookEvent(kv, {
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          items: { data: [{ price: { id: "price_pro" } }] },
          current_period_end: 9999999999,
          cancel_at_period_end: false,
          metadata: { userId: "user1" },
        },
      },
    });

    const sub = await getSubscription(kv, "user1");
    assertExists(sub);
    assertEquals(sub.subscriptionId, "sub_1");
    assertEquals(sub.status, "active");
    assertEquals(sub.priceId, "price_pro");
  });
});

Deno.test("handleWebhookEvent falls back to stripe→user reverse lookup", async () => {
  await withTempKv(async (kv) => {
    await kv.set(keys.stripe.byStripeId("cus_1"), "user42");

    await handleWebhookEvent(kv, {
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_2",
          customer: "cus_1",
          status: "past_due",
          items: { data: [{ price: { id: "price_pro" } }] },
          current_period_end: 9999999999,
          cancel_at_period_end: false,
          metadata: {},
        },
      },
    });

    const sub = await getSubscription(kv, "user42");
    assertExists(sub);
    assertEquals(sub.status, "past_due");
  });
});

Deno.test("handleWebhookEvent stores customer mapping on checkout.session.completed", async () => {
  await withTempKv(async (kv) => {
    await handleWebhookEvent(kv, {
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_new",
          metadata: { userId: "user99" },
        },
      },
    });

    const userId = await kv.get(keys.stripe.byStripeId("cus_new"));
    assertEquals(userId.value, "user99");
  });
});

Deno.test("handleWebhookEvent ignores unknown event types", async () => {
  await withTempKv(async (kv) => {
    // Should not throw
    await handleWebhookEvent(kv, {
      type: "invoice.paid",
      data: { object: {} },
    });
  });
});

// ── isActiveSubscription ───────────────────────────────────────────────────────

Deno.test("isActiveSubscription returns true for active and trialing", () => {
  const base = {
    subscriptionId: "s",
    customerId: "c",
    priceId: "p",
    currentPeriodEnd: 0,
    cancelAtPeriodEnd: false,
    updatedAt: 0,
  };
  assertEquals(isActiveSubscription({ ...base, status: "active" }), true);
  assertEquals(isActiveSubscription({ ...base, status: "trialing" }), true);
  assertEquals(isActiveSubscription({ ...base, status: "canceled" }), false);
  assertEquals(isActiveSubscription({ ...base, status: "past_due" }), false);
  assertEquals(isActiveSubscription(null), false);
});
