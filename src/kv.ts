export const keys = {
  user: {
    byId: (id: string): Deno.KvKey => ["user", "id", id],
    byEmail: (email: string): Deno.KvKey => ["user", "email", email],
  },
  session: (id: string): Deno.KvKey => ["session", id],
  magic: (hashedToken: string): Deno.KvKey => ["magic", "token", hashedToken],
  passkey: {
    byUser: (userId: string): Deno.KvKey => ["passkey", "users", userId],
    challenge: (id: string): Deno.KvKey => ["passkey", "challenge", id],
    credentialToUser: (credentialId: string): Deno.KvKey => [
      "passkey",
      "credential",
      credentialId,
    ],
  },
  rate: {
    magic: (email: string): Deno.KvKey => ["rate", "magic", email],
  },
};
