import {
  createCheckoutSession,
  createOrGetCustomer,
  createPortalSession,
  getSubscription,
  handleWebhookEvent,
  isActiveSubscription,
  verifyWebhook,
} from "./stripe.ts";
import { validateSession } from "./session.ts";
import { errorResponse, jsonResponse } from "./router.ts";
import type { Router } from "./router.ts";
import type { User } from "./schemas.ts";
import { keys } from "./kv.ts";

/** Options for {@linkcode mountStripeRoutes}. */
export interface StripeRoutesOptions {
  /** Full origin URL used to build redirect URLs. */
  baseUrl: string;
  /** Path to redirect to after successful checkout. Default: `/auth/success`. */
  successPath?: string;
  /** Path to redirect to if checkout is cancelled. Default: `/get-started`. */
  cancelPath?: string;
  /** Override `STRIPE_SECRET_KEY` env var. */
  secretKey?: string;
  /** Override `STRIPE_WEBHOOK_SECRET` env var. */
  webhookSecret?: string;
}

/**
 * Mounts Stripe billing routes onto `router`.
 *
 * Routes registered:
 * - `GET  /api/subscription` — returns current subscription status (auth required)
 * - `POST /billing/checkout` — creates a Checkout session (auth required, body: `{ priceId }`)
 * - `POST /billing/portal` — creates a Billing Portal session (auth required)
 * - `POST /billing/webhook` — handles verified Stripe webhook events
 */
export function mountStripeRoutes(
  router: Router,
  kv: Deno.Kv,
  opts: StripeRoutesOptions,
): void {
  const successPath = opts.successPath ?? "/auth/success";
  const cancelPath = opts.cancelPath ?? "/get-started";
  const secretKey = opts.secretKey ?? Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = opts.webhookSecret ??
    Deno.env.get("STRIPE_WEBHOOK_SECRET");

  router.route("/api/subscription", {
    get: async (req) => {
      const session = await validateSession(kv, req);
      if (!session) return errorResponse("Unauthorized", 401);
      const sub = await getSubscription(kv, session.userId);
      return jsonResponse({
        subscription: sub,
        active: isActiveSubscription(sub),
      });
    },
  });

  router.route("/billing/checkout", {
    post: async (req) => {
      const session = await validateSession(kv, req);
      if (!session) return errorResponse("Unauthorized", 401);

      const body = await req.json().catch(() => ({})) as { priceId?: string };
      if (!body.priceId) return errorResponse("priceId is required", 400);

      const user = (await kv.get<User>(keys.user.byId(session.userId))).value;
      if (!user) return errorResponse("User not found", 404);

      await createOrGetCustomer(kv, user.id, user.email, { secretKey });
      const checkout = await createCheckoutSession(kv, user.id, {
        priceId: body.priceId,
        successUrl: `${opts.baseUrl}${successPath}`,
        cancelUrl: `${opts.baseUrl}${cancelPath}`,
        secretKey,
      });
      return jsonResponse({ url: checkout.url });
    },
  });

  router.route("/billing/portal", {
    post: async (req) => {
      const session = await validateSession(kv, req);
      if (!session) return errorResponse("Unauthorized", 401);

      const portal = await createPortalSession(kv, session.userId, {
        returnUrl: `${opts.baseUrl}${cancelPath}`,
        secretKey,
      });
      return jsonResponse({ url: portal.url });
    },
  });

  router.route("/billing/webhook", {
    post: async (req) => {
      const payload = await req.text();
      const signature = req.headers.get("Stripe-Signature") ?? "";
      const secret = webhookSecret ?? "";

      if (!secret) return errorResponse("Webhook secret not configured", 500);

      const valid = await verifyWebhook(payload, signature, secret);
      if (!valid) return errorResponse("Invalid signature", 400);

      const event = JSON.parse(payload) as {
        type: string;
        data: { object: Record<string, unknown> };
      };
      await handleWebhookEvent(kv, event);
      return jsonResponse({ received: true });
    },
  });
}
