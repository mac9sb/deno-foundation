const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISS = "https://appleid.apple.com";
const JWKS_TTL_MS = 60 * 60 * 1000;

interface JWK {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
}

let jwksCache: { keys: JWK[]; fetchedAt: number } | null = null;

function base64urlDecode(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(input.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function fetchJwks(fetchFn: typeof fetch): Promise<JWK[]> {
  const res = await fetchFn(APPLE_JWKS_URL);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = await res.json() as { keys: JWK[] };
  return data.keys;
}

async function getJwks(fetchFn: typeof fetch): Promise<JWK[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const keys = await fetchJwks(fetchFn);
  jwksCache = { keys, fetchedAt: now };
  return keys;
}

/** Payload returned after successful Apple identity token verification. */
export interface AppleTokenPayload {
  /** Stable Apple user identifier — use this as the primary key. */
  sub: string;
  /** User email — only present on the first sign-in. */
  email?: string;
  /** Whether Apple has verified the email address. */
  emailVerified?: boolean;
}

/** Options for {@linkcode verifyAppleToken}. */
export interface AppleAuthOptions {
  /** Override the global `fetch` — useful for testing with mock JWKS. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Verifies an Apple identity token and returns the decoded payload.
 *
 * Fetches Apple's public JWKS (cached for one hour), locates the key
 * matching the token's `kid`, and verifies the RS256 signature using
 * `crypto.subtle`. Validates `iss`, `aud`, and `exp` claims.
 *
 * Returns `null` if the token is invalid, expired, or cannot be verified.
 *
 * @param identityToken - The JWT from Apple's `ASAuthorizationAppleIDCredential.identityToken`.
 * @param clientId - Your app's bundle ID or Services ID registered with Apple.
 */
export async function verifyAppleToken(
  identityToken: string,
  clientId: string,
  opts: AppleAuthOptions = {},
): Promise<AppleTokenPayload | null> {
  const fetchFn = opts.fetch ?? globalThis.fetch;

  const parts = identityToken.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  let header: { kid: string; alg: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(
      new TextDecoder().decode(base64urlDecode(encodedHeader)),
    );
    payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(encodedPayload)),
    );
  } catch {
    return null;
  }

  if (header.alg !== "RS256") return null;

  // Validate standard claims before touching crypto
  if (payload.iss !== APPLE_ISS) return null;
  if (payload.aud !== clientId) return null;
  if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) {
    return null;
  }

  let jwks = await getJwks(fetchFn);
  let jwk = jwks.find((k) => k.kid === header.kid);

  // Re-fetch once on unknown kid — Apple may have rotated keys
  if (!jwk) {
    jwks = await fetchJwks(fetchFn);
    jwksCache = { keys: jwks, fetchedAt: Date.now() };
    jwk = jwks.find((k) => k.kid === header.kid);
  }

  if (!jwk) return null;

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }

  const signingInput = new TextEncoder().encode(
    `${encodedHeader}.${encodedPayload}`,
  );
  const signature = base64urlDecode(encodedSignature);

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature,
    signingInput,
  );

  if (!valid) return null;

  const sub = payload.sub as string;
  if (!sub) return null;

  const result: AppleTokenPayload = { sub };
  if (typeof payload.email === "string") {
    result.email = payload.email;
    result.emailVerified = payload.email_verified === true ||
      payload.email_verified === "true";
  }
  return result;
}
