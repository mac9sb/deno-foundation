import type { MagicToken } from "./schemas.ts";
import { keys } from "./kv.ts";
import { randomToken, sha256Hex } from "./crypto.ts";
import { enforce } from "./rate_limit.ts";
import { sendEmail } from "./email.ts";

const TOKEN_TTL_MS = 15 * 60 * 1000;

export interface MagicLinkOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  rateLimit?: false;
}

export interface SendMagicLinkResult {
  ok: boolean;
  retryAfter?: number;
}

export async function sendMagicLink(
  kv: Deno.Kv,
  email: string,
  opts: MagicLinkOptions,
): Promise<SendMagicLinkResult> {
  if (opts.rateLimit !== false) {
    const result = await enforce(kv, keys.rate.magic(email));
    if (!result.ok) return { ok: false, retryAfter: result.retryAfter };
  }

  const rawToken = randomToken();
  const hashedToken = await sha256Hex(rawToken);
  const now = Date.now();

  const tokenData: MagicToken = {
    email,
    expiresAt: now + TOKEN_TTL_MS,
    used: false,
  };

  await kv.set(keys.magic(hashedToken), tokenData, { expireIn: TOKEN_TTL_MS });

  const link = `${opts.baseUrl}/auth/verify?token=${rawToken}`;
  await sendEmail({
    to: email,
    subject: "Your sign-in link",
    html:
      `<p>Click <a href="${link}">here to sign in</a>. This link expires in 15 minutes.</p>`,
    text: `Sign in: ${link}\n\nThis link expires in 15 minutes.`,
    fetch: opts.fetch,
  });

  return { ok: true };
}

export async function verifyMagicToken(
  kv: Deno.Kv,
  rawToken: string,
): Promise<{ email: string } | null> {
  const hashedToken = await sha256Hex(rawToken);
  const entry = await kv.get<MagicToken>(keys.magic(hashedToken));
  if (!entry.value) return null;

  const token = entry.value;
  if (token.used) return null;
  if (Date.now() > token.expiresAt) {
    await kv.delete(keys.magic(hashedToken));
    return null;
  }

  const remainingTtl = token.expiresAt - Date.now();
  await kv.set(
    keys.magic(hashedToken),
    { ...token, used: true },
    { expireIn: remainingTtl },
  );

  return { email: token.email };
}
