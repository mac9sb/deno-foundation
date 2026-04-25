import type { User } from "./schemas.ts";
import { keys } from "./kv.ts";

/**
 * Returns the existing user for `email`, or atomically creates and stores a
 * new one if none exists. Safe to call concurrently — duplicate emails will
 * always resolve to the same user record.
 */
export async function findOrCreateUser(
  kv: Deno.Kv,
  email: string,
): Promise<User> {
  const existingId = (await kv.get<string>(keys.user.byEmail(email))).value;
  if (existingId) {
    const user = (await kv.get<User>(keys.user.byId(existingId))).value;
    if (user) return user;
  }

  const user: User = { id: crypto.randomUUID(), email, createdAt: Date.now() };

  await kv.atomic()
    .set(keys.user.byId(user.id), user)
    .set(keys.user.byEmail(email), user.id)
    .commit();

  return user;
}
