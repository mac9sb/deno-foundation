/** Centralised KV key builders for all application data. */
export const keys = {
  user: {
    /** Key for a user record looked up by ID. */
    byId: (id: string): Deno.KvKey => ["user", "id", id],
    /** Key for a user ID looked up by email address. */
    byEmail: (email: string): Deno.KvKey => ["user", "email", email],
    /** Key for the application user ID looked up by Apple subject identifier. */
    byAppleSub: (sub: string): Deno.KvKey => ["user", "apple", sub],
  },
  /** Key for a session record looked up by session ID. */
  session: (id: string): Deno.KvKey => ["session", id],
  /** Key for a magic-link token record looked up by hashed token. */
  magic: (hashedToken: string): Deno.KvKey => ["magic", "token", hashedToken],
  passkey: {
    /** Key for the list of passkey credentials belonging to a user. */
    byUser: (userId: string): Deno.KvKey => ["passkey", "users", userId],
    /** Key for a temporary WebAuthn challenge looked up by challenge ID. */
    challenge: (id: string): Deno.KvKey => ["passkey", "challenge", id],
    /** Key for the user ID that owns a given credential ID. */
    credentialToUser: (credentialId: string): Deno.KvKey => [
      "passkey",
      "credential",
      credentialId,
    ],
  },
  rate: {
    /** Key for the magic-link rate-limit counter for a given email. */
    magic: (email: string): Deno.KvKey => ["rate", "magic", email],
  },
  stripe: {
    /** Key for a Stripe customer record looked up by application user ID. */
    byUser: (
      userId: string,
    ): Deno.KvKey => ["stripe", "customer", "user", userId],
    /** Key for the application user ID looked up by Stripe customer ID. */
    byStripeId: (
      stripeId: string,
    ): Deno.KvKey => ["stripe", "customer", "id", stripeId],
    /** Key for a Stripe subscription record looked up by application user ID. */
    subscriptionByUser: (
      userId: string,
    ): Deno.KvKey => ["stripe", "subscription", "user", userId],
  },
};
