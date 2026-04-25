import type { Session } from "./schemas.ts";
import { keys } from "./kv.ts";
import { randomToken } from "./crypto.ts";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionOptions {
  ttlMs?: number;
}

export interface CreateSessionResult {
  session: Session;
  cookie: string;
}

export async function createSession(
  kv: Deno.Kv,
  userId: string,
  opts: SessionOptions = {},
): Promise<CreateSessionResult> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const id = randomToken();
  const now = Date.now();
  const session: Session = {
    id,
    userId,
    createdAt: now,
    expiresAt: now + ttlMs,
  };

  await kv.set(keys.session(id), session, { expireIn: ttlMs });

  const maxAge = Math.floor(ttlMs / 1000);
  const cookie =
    `session_id=${id}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}; Path=/`;

  return { session, cookie };
}

export async function validateSession(
  kv: Deno.Kv,
  request: Request,
): Promise<Session | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)session_id=([^;]+)/);
  if (!match) return null;

  const sessionId = match[1].trim();
  const entry = await kv.get<Session>(keys.session(sessionId));
  if (!entry.value) return null;

  if (Date.now() > entry.value.expiresAt) {
    await kv.delete(keys.session(sessionId));
    return null;
  }

  return entry.value;
}

export async function revokeSession(
  kv: Deno.Kv,
  sessionId: string,
): Promise<void> {
  await kv.delete(keys.session(sessionId));
}

export function clearSessionCookie(): string {
  return `session_id=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`;
}
