import { assertEquals, assertNotEquals } from "@std/assert";
import { verifyAppleToken } from "../src/apple_auth.ts";

const CLIENT_ID = "com.example.app";
const APPLE_ISS = "https://appleid.apple.com";

function base64urlEncode(input: Uint8Array): string {
  return btoa(String.fromCharCode(...input))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function encodeJson(obj: unknown): string {
  return base64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

interface TestKeys {
  privateKey: CryptoKey;
  publicJwk: JsonWebKey & { kid: string };
}

async function generateTestKeys(): Promise<TestKeys> {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return { privateKey, publicJwk: { ...jwk, kid: crypto.randomUUID() } };
}

async function buildToken(
  privateKey: CryptoKey,
  kid: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const header = encodeJson({ alg: "RS256", kid });
  const body = encodeJson(payload);
  const signingInput = new TextEncoder().encode(`${header}.${body}`);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    signingInput,
  );
  return `${header}.${body}.${base64urlEncode(new Uint8Array(sig))}`;
}

function makeMockFetch(keys: (JsonWebKey & { kid: string })[]) {
  return (_url: string | URL | Request): Promise<Response> => {
    return Promise.resolve(Response.json({ keys }));
  };
}

function validPayload(): Record<string, unknown> {
  return {
    iss: APPLE_ISS,
    aud: CLIENT_ID,
    sub: "000123.abc.456",
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: "user@example.com",
    email_verified: true,
  };
}

Deno.test("verifyAppleToken returns payload for valid token", async () => {
  const { privateKey, publicJwk } = await generateTestKeys();
  const token = await buildToken(privateKey, publicJwk.kid, validPayload());
  const result = await verifyAppleToken(token, CLIENT_ID, {
    fetch: makeMockFetch([publicJwk]),
  });
  assertNotEquals(result, null);
  assertEquals(result!.sub, "000123.abc.456");
  assertEquals(result!.email, "user@example.com");
  assertEquals(result!.emailVerified, true);
});

Deno.test("verifyAppleToken returns null for expired token", async () => {
  const { privateKey, publicJwk } = await generateTestKeys();
  const payload = {
    ...validPayload(),
    exp: Math.floor(Date.now() / 1000) - 10,
  };
  const token = await buildToken(privateKey, publicJwk.kid, payload);
  const result = await verifyAppleToken(token, CLIENT_ID, {
    fetch: makeMockFetch([publicJwk]),
  });
  assertEquals(result, null);
});

Deno.test("verifyAppleToken returns null for wrong audience", async () => {
  const { privateKey, publicJwk } = await generateTestKeys();
  const payload = { ...validPayload(), aud: "com.other.app" };
  const token = await buildToken(privateKey, publicJwk.kid, payload);
  const result = await verifyAppleToken(token, CLIENT_ID, {
    fetch: makeMockFetch([publicJwk]),
  });
  assertEquals(result, null);
});

Deno.test("verifyAppleToken returns null for wrong issuer", async () => {
  const { privateKey, publicJwk } = await generateTestKeys();
  const payload = { ...validPayload(), iss: "https://evil.example.com" };
  const token = await buildToken(privateKey, publicJwk.kid, payload);
  const result = await verifyAppleToken(token, CLIENT_ID, {
    fetch: makeMockFetch([publicJwk]),
  });
  assertEquals(result, null);
});

Deno.test("verifyAppleToken returns null when kid not in JWKS", async () => {
  const { privateKey, publicJwk } = await generateTestKeys();
  const token = await buildToken(privateKey, "unknown-kid", validPayload());
  const result = await verifyAppleToken(token, CLIENT_ID, {
    fetch: makeMockFetch([publicJwk]),
  });
  assertEquals(result, null);
});

Deno.test("verifyAppleToken returns null for tampered payload", async () => {
  const { privateKey, publicJwk } = await generateTestKeys();
  const token = await buildToken(privateKey, publicJwk.kid, validPayload());
  // Swap the payload part with a different email
  const [header, , sig] = token.split(".");
  const tamperedPayload = encodeJson({
    ...validPayload(),
    email: "attacker@evil.com",
  });
  const tampered = `${header}.${tamperedPayload}.${sig}`;
  const result = await verifyAppleToken(tampered, CLIENT_ID, {
    fetch: makeMockFetch([publicJwk]),
  });
  assertEquals(result, null);
});

Deno.test("verifyAppleToken returns payload without email when absent", async () => {
  const { privateKey, publicJwk } = await generateTestKeys();
  const { email: _e, email_verified: _ev, ...payloadWithoutEmail } =
    validPayload() as Record<string, unknown>;
  const token = await buildToken(
    privateKey,
    publicJwk.kid,
    payloadWithoutEmail,
  );
  const result = await verifyAppleToken(token, CLIENT_ID, {
    fetch: makeMockFetch([publicJwk]),
  });
  assertNotEquals(result, null);
  assertEquals(result!.email, undefined);
  assertEquals(result!.sub, "000123.abc.456");
});

Deno.test("verifyAppleToken returns null for malformed JWT", async () => {
  const result = await verifyAppleToken("not.a.jwt.at.all.extra", CLIENT_ID, {
    fetch: makeMockFetch([]),
  });
  assertEquals(result, null);
});

Deno.test("verifyAppleToken returns null for non-RS256 algorithm", async () => {
  const { privateKey, publicJwk } = await generateTestKeys();
  const header = encodeJson({ alg: "HS256", kid: publicJwk.kid });
  const body = encodeJson(validPayload());
  const signingInput = new TextEncoder().encode(`${header}.${body}`);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    signingInput,
  );
  const token = `${header}.${body}.${base64urlEncode(new Uint8Array(sig))}`;
  const result = await verifyAppleToken(token, CLIENT_ID, {
    fetch: makeMockFetch([publicJwk]),
  });
  assertEquals(result, null);
});

Deno.test("verifyAppleToken handles email_verified as string 'true'", async () => {
  const { privateKey, publicJwk } = await generateTestKeys();
  const payload = { ...validPayload(), email_verified: "true" };
  const token = await buildToken(privateKey, publicJwk.kid, payload);
  const result = await verifyAppleToken(token, CLIENT_ID, {
    fetch: makeMockFetch([publicJwk]),
  });
  assertNotEquals(result, null);
  assertEquals(result!.emailVerified, true);
});

Deno.test("verifyAppleToken re-fetches JWKS on key rotation and succeeds", async () => {
  const { privateKey, publicJwk } = await generateTestKeys();
  const token = await buildToken(privateKey, publicJwk.kid, validPayload());

  // The unique kid won't be in the module-level cache from previous tests.
  // Whether the cache is cold (initial fetch) or warm (re-fetch), the mock is
  // called exactly once and returns the key — verifying the rotation path succeeds.
  let callCount = 0;
  const countingFetch = (
    ..._args: Parameters<typeof fetch>
  ): Promise<Response> => {
    callCount++;
    return Promise.resolve(Response.json({ keys: [publicJwk] }));
  };

  const result = await verifyAppleToken(token, CLIENT_ID, {
    fetch: countingFetch,
  });
  assertNotEquals(result, null);
  assertEquals(result!.sub, "000123.abc.456");
  assertEquals(callCount, 1);
});

Deno.test("verifyAppleToken concurrent cold-cache requests share one fetch", async () => {
  const { privateKey, publicJwk } = await generateTestKeys();
  const token = await buildToken(privateKey, publicJwk.kid, validPayload());

  let callCount = 0;
  const slowMockFetch = (_url: string | URL | Request): Promise<Response> => {
    callCount++;
    return new Promise((resolve) =>
      setTimeout(() => resolve(Response.json({ keys: [publicJwk] })), 10)
    );
  };

  const [r1, r2, r3] = await Promise.all([
    verifyAppleToken(token, CLIENT_ID, { fetch: slowMockFetch }),
    verifyAppleToken(token, CLIENT_ID, { fetch: slowMockFetch }),
    verifyAppleToken(token, CLIENT_ID, { fetch: slowMockFetch }),
  ]);

  assertNotEquals(r1, null);
  assertNotEquals(r2, null);
  assertNotEquals(r3, null);
  assertEquals(callCount, 1);
});
