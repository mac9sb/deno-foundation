import { constantTimeEqual } from "./crypto.ts";
import { keys } from "./kv.ts";
import type { StripeCustomer, StripeSubscription } from "./schemas.ts";

const API = "https://api.stripe.com/v1";

export interface StripeOptions {
  secretKey?: string;
  fetch?: typeof globalThis.fetch;
}

export interface CheckoutOptions extends StripeOptions {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
}

export interface PortalOptions extends StripeOptions {
  returnUrl: string;
}

type StripeEvent = {
  type: string;
  data: { object: Record<string, unknown> };
};

function resolveKey(opts: StripeOptions): string {
  const key = opts.secretKey ?? Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is required");
  return key;
}

function post(
  path: string,
  body: URLSearchParams,
  key: string,
  fetcher: typeof globalThis.fetch,
): Promise<Response> {
  return fetcher(`${API}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

export async function createOrGetCustomer(
  kv: Deno.Kv,
  userId: string,
  email: string,
  opts: StripeOptions = {},
): Promise<StripeCustomer> {
  const existing =
    (await kv.get<StripeCustomer>(keys.stripe.byUser(userId))).value;
  if (existing) return existing;

  const key = resolveKey(opts);
  const fetcher = opts.fetch ?? globalThis.fetch;

  const res = await post(
    "/customers",
    new URLSearchParams({ email, "metadata[userId]": userId }),
    key,
    fetcher,
  );
  if (!res.ok) throw new Error(`Stripe: ${await res.text()}`);
  const data = await res.json();

  const customer: StripeCustomer = {
    stripeId: data.id,
    userId,
    email,
    createdAt: Date.now(),
  };

  await kv.atomic()
    .set(keys.stripe.byUser(userId), customer)
    .set(keys.stripe.byStripeId(data.id), userId)
    .commit();

  return customer;
}

export async function createCheckoutSession(
  kv: Deno.Kv,
  userId: string,
  opts: CheckoutOptions,
): Promise<{ url: string; sessionId: string }> {
  const customer =
    (await kv.get<StripeCustomer>(keys.stripe.byUser(userId))).value;
  const key = resolveKey(opts);
  const fetcher = opts.fetch ?? globalThis.fetch;

  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": opts.priceId,
    "line_items[0][quantity]": "1",
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    // Set on both session and subscription so webhooks always have userId
    "metadata[userId]": userId,
    "subscription_data[metadata][userId]": userId,
  });
  if (customer) params.set("customer", customer.stripeId);
  if (opts.trialDays) {
    params.set(
      "subscription_data[trial_period_days]",
      String(opts.trialDays),
    );
  }

  const res = await post("/checkout/sessions", params, key, fetcher);
  if (!res.ok) throw new Error(`Stripe: ${await res.text()}`);
  const data = await res.json();

  return { url: data.url, sessionId: data.id };
}

export async function createPortalSession(
  kv: Deno.Kv,
  userId: string,
  opts: PortalOptions,
): Promise<{ url: string }> {
  const customer =
    (await kv.get<StripeCustomer>(keys.stripe.byUser(userId))).value;
  if (!customer) throw new Error("No Stripe customer for this user");

  const key = resolveKey(opts);
  const fetcher = opts.fetch ?? globalThis.fetch;

  const res = await post(
    "/billing/portal/sessions",
    new URLSearchParams({
      customer: customer.stripeId,
      return_url: opts.returnUrl,
    }),
    key,
    fetcher,
  );
  if (!res.ok) throw new Error(`Stripe: ${await res.text()}`);
  const data = await res.json();

  return { url: data.url };
}

export async function verifyWebhook(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const chunk of signature.split(",")) {
    const eq = chunk.indexOf("=");
    parts[chunk.slice(0, eq)] = chunk.slice(eq + 1);
  }
  if (!parts.t || !parts.v1) return false;

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    enc.encode(`${parts.t}.${payload}`),
  );
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return constantTimeEqual(computed, parts.v1);
}

export async function handleWebhookEvent(
  kv: Deno.Kv,
  event: StripeEvent,
): Promise<void> {
  const obj = event.data.object;

  if (event.type === "checkout.session.completed") {
    const customerId = obj["customer"] as string | undefined;
    const meta = obj["metadata"] as Record<string, string> | undefined;
    if (customerId && meta?.userId) {
      await kv.set(keys.stripe.byStripeId(customerId), meta.userId);
    }
    return;
  }

  const subEvents = new Set([
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ]);
  if (!subEvents.has(event.type)) return;

  const sub = obj as {
    id: string;
    customer: string;
    status: string;
    items: { data: Array<{ price: { id: string } }> };
    current_period_end: number;
    cancel_at_period_end: boolean;
    metadata?: Record<string, string>;
  };

  const userId = sub.metadata?.userId ??
    (await kv.get<string>(keys.stripe.byStripeId(sub.customer))).value ??
    undefined;
  if (!userId) return;

  const subscription: StripeSubscription = {
    subscriptionId: sub.id,
    customerId: sub.customer,
    status: sub.status,
    priceId: sub.items.data[0]?.price.id ?? "",
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    updatedAt: Date.now(),
  };
  await kv.set(keys.stripe.subscriptionByUser(userId), subscription);
}

export async function getSubscription(
  kv: Deno.Kv,
  userId: string,
): Promise<StripeSubscription | null> {
  return (await kv.get<StripeSubscription>(
    keys.stripe.subscriptionByUser(userId),
  )).value;
}

export function isActiveSubscription(sub: StripeSubscription | null): boolean {
  if (!sub) return false;
  return sub.status === "active" || sub.status === "trialing";
}
