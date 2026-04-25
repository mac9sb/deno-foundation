import {
  beginAuthentication,
  beginRegistration,
  finishAuthentication,
  finishRegistration,
} from "./passkey.ts";
import {
  clearSessionCookie,
  createSession,
  revokeSession,
  validateSession,
} from "./session.ts";
import { sendMagicLink, verifyMagicToken } from "./magic_link.ts";
import { createLogger } from "./logging.ts";
import { errorResponse, jsonResponse } from "./router.ts";
import type { Router } from "./router.ts";
import { findOrCreateUser } from "./user.ts";
import type { User } from "./schemas.ts";
import { keys } from "./kv.ts";

const log = createLogger("auth");

/** Options for {@linkcode mountAuthRoutes}. */
export interface AuthRoutesOptions {
  /** Full origin URL, e.g. `https://example.com`. */
  baseUrl: string;
  /** WebAuthn relying-party ID, typically the hostname. */
  rpId: string;
  /** Human-readable name shown to users during passkey registration. */
  rpName: string;
  /** Path to redirect to after sign-in. Default: `/auth/success`. */
  successPath?: string;
  /** Path to redirect to after sign-out. Default: `/get-started`. */
  signInPath?: string;
  /** Path to redirect to when a magic link has expired. Default: `/link-expired`. */
  expiredPath?: string;
}

/**
 * Mounts all authentication routes onto `router`.
 *
 * Routes registered:
 * - `GET  /api/session` — returns current session user or 401
 * - `POST /auth/magic-link` — sends a one-time sign-in email
 * - `GET  /auth/verify` — verifies a magic-link token and creates a session
 * - `POST /auth/passkey/register/begin` — starts WebAuthn registration
 * - `POST /auth/passkey/register/finish` — completes WebAuthn registration
 * - `POST /auth/passkey/login/begin` — starts WebAuthn authentication
 * - `POST /auth/passkey/login/finish` — completes WebAuthn authentication
 * - `POST /auth/logout` — revokes the session and clears the cookie
 */
export function mountAuthRoutes(
  router: Router,
  kv: Deno.Kv,
  opts: AuthRoutesOptions,
): void {
  const successPath = opts.successPath ?? "/auth/success";
  const signInPath = opts.signInPath ?? "/get-started";
  const expiredPath = opts.expiredPath ?? "/link-expired";

  router.route("/api/session", {
    get: async (req) => {
      const session = await validateSession(kv, req);
      if (!session) return errorResponse("Unauthorized", 401);
      const user = (await kv.get<User>(keys.user.byId(session.userId))).value;
      if (!user) return errorResponse("User not found", 404);
      return jsonResponse({ userId: user.id, email: user.email });
    },
  });

  router.route("/auth/magic-link", {
    post: async (req) => {
      const body = await req.json().catch(() => ({})) as { email?: string };
      if (!body.email) return errorResponse("email is required", 400);

      const result = await sendMagicLink(kv, body.email, {
        baseUrl: opts.baseUrl,
      });
      if (!result.ok) {
        return new Response(
          JSON.stringify({
            error: "Too many requests. Please wait before trying again.",
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(result.retryAfter ?? 60),
            },
          },
        );
      }
      return jsonResponse({ ok: true });
    },
  });

  router.route("/auth/verify", {
    get: async (req) => {
      const token = new URL(req.url).searchParams.get("token");
      if (!token) return errorResponse("token is required", 400);

      const result = await verifyMagicToken(kv, token);
      if (!result) {
        return Response.redirect(`${opts.baseUrl}${expiredPath}`, 302);
      }

      const user = await findOrCreateUser(kv, result.email);
      const { cookie } = await createSession(kv, user.id);
      log.info("magic link login", { userId: user.id });

      return new Response(null, {
        status: 302,
        headers: {
          Location: `${opts.baseUrl}${successPath}`,
          "Set-Cookie": cookie,
        },
      });
    },
  });

  router.route("/auth/passkey/register/begin", {
    post: async (req) => {
      const session = await validateSession(kv, req);
      if (!session) return errorResponse("Unauthorized", 401);
      const user = (await kv.get<User>(keys.user.byId(session.userId))).value;
      if (!user) return errorResponse("User not found", 404);

      return jsonResponse(
        await beginRegistration(kv, {
          rpName: opts.rpName,
          rpId: opts.rpId,
          userId: user.id,
          userEmail: user.email,
        }),
      );
    },
  });

  router.route("/auth/passkey/register/finish", {
    post: async (req) => {
      const session = await validateSession(kv, req);
      if (!session) return errorResponse("Unauthorized", 401);

      const body = await req.json().catch(() => ({})) as {
        challengeId?: string;
        response?: unknown;
      };
      if (!body.challengeId || !body.response) {
        return errorResponse("challengeId and response are required", 400);
      }

      // deno-lint-ignore no-explicit-any
      const regResponse = body.response as any;
      await finishRegistration(
        kv,
        session.userId,
        body.challengeId,
        regResponse,
        opts.rpId,
        opts.baseUrl,
      );
      return jsonResponse({ ok: true });
    },
  });

  router.route("/auth/passkey/login/begin", {
    post: async () =>
      jsonResponse(await beginAuthentication(kv, { rpId: opts.rpId })),
  });

  router.route("/auth/passkey/login/finish", {
    post: async (req) => {
      const body = await req.json().catch(() => ({})) as {
        challengeId?: string;
        response?: unknown;
      };
      if (!body.challengeId || !body.response) {
        return errorResponse("challengeId and response are required", 400);
      }

      // deno-lint-ignore no-explicit-any
      const authResponse = body.response as any;
      const { userId } = await finishAuthentication(
        kv,
        body.challengeId,
        authResponse,
        opts.rpId,
        opts.baseUrl,
      );
      const { cookie } = await createSession(kv, userId);
      log.info("passkey login", { userId });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
      });
    },
  });

  router.route("/auth/logout", {
    post: async (req) => {
      const session = await validateSession(kv, req);
      if (session) await revokeSession(kv, session.id);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${opts.baseUrl}${signInPath}`,
          "Set-Cookie": clearSessionCookie(),
        },
      });
    },
  });
}
