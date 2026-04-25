import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { PasskeyCredential } from "./schemas.ts";
import { keys } from "./kv.ts";
import { randomToken } from "./crypto.ts";

export type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
};

/** Options for {@linkcode beginRegistration}. */
export interface RegistrationBeginOptions {
  rpName: string;
  rpId: string;
  userId: string;
  userEmail: string;
  userName?: string;
}

/** Options for {@linkcode beginAuthentication}. */
export interface AuthenticationBeginOptions {
  rpId: string;
  /** When provided, only credentials belonging to this user are offered. */
  userId?: string;
}

/** Return value of {@linkcode beginRegistration}. */
export interface RegistrationBeginResult {
  /** WebAuthn creation options to pass to `navigator.credentials.create`. */
  options: PublicKeyCredentialCreationOptionsJSON;
  /** Opaque ID that must be passed back to {@linkcode finishRegistration}. */
  challengeId: string;
}

/** Return value of {@linkcode beginAuthentication}. */
export interface AuthenticationBeginResult {
  /** WebAuthn request options to pass to `navigator.credentials.get`. */
  options: PublicKeyCredentialRequestOptionsJSON;
  /** Opaque ID that must be passed back to {@linkcode finishAuthentication}. */
  challengeId: string;
}

/**
 * Generates WebAuthn registration options and stores the challenge in KV.
 * Pass the returned `options` to `navigator.credentials.create` on the client
 * and the `challengeId` back to {@linkcode finishRegistration}.
 */
export async function beginRegistration(
  kv: Deno.Kv,
  opts: RegistrationBeginOptions,
): Promise<RegistrationBeginResult> {
  const challengeId = randomToken();
  const existing =
    (await kv.get<PasskeyCredential[]>(keys.passkey.byUser(opts.userId)))
      .value ?? [];

  const excludeCredentials = existing.map((c) => ({
    id: c.id,
    type: "public-key" as const,
  }));

  const options = await generateRegistrationOptions({
    rpName: opts.rpName,
    rpID: opts.rpId,
    userName: opts.userName ?? opts.userEmail,
    userID: new TextEncoder().encode(opts.userId),
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await kv.set(keys.passkey.challenge(challengeId), options.challenge, {
    expireIn: 5 * 60 * 1000,
  });

  return { options, challengeId };
}

/**
 * Verifies the WebAuthn registration response from the client, stores the new
 * credential in KV, and returns the stored {@linkcode PasskeyCredential}.
 */
export async function finishRegistration(
  kv: Deno.Kv,
  userId: string,
  challengeId: string,
  response: RegistrationResponseJSON,
  rpId: string,
  origin: string,
): Promise<PasskeyCredential> {
  const challengeEntry = await kv.get<string>(
    keys.passkey.challenge(challengeId),
  );
  if (!challengeEntry.value) throw new Error("Challenge expired or not found");

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challengeEntry.value,
    expectedOrigin: origin,
    expectedRPID: rpId,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Passkey registration verification failed");
  }

  await kv.delete(keys.passkey.challenge(challengeId));

  const { credential } = verification.registrationInfo;
  const passkeyCredential: PasskeyCredential = {
    id: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: credential.transports as string[] | undefined,
  };

  const existing =
    (await kv.get<PasskeyCredential[]>(keys.passkey.byUser(userId))).value ??
      [];
  await kv.set(keys.passkey.byUser(userId), [...existing, passkeyCredential]);
  await kv.set(keys.passkey.credentialToUser(credential.id), userId);

  return passkeyCredential;
}

/**
 * Generates WebAuthn authentication options and stores the challenge in KV.
 * Pass the returned `options` to `navigator.credentials.get` on the client
 * and the `challengeId` back to {@linkcode finishAuthentication}.
 */
export async function beginAuthentication(
  kv: Deno.Kv,
  opts: AuthenticationBeginOptions,
): Promise<AuthenticationBeginResult> {
  const challengeId = randomToken();

  let allowCredentials:
    | { id: string; type: "public-key" }[]
    | undefined;

  if (opts.userId) {
    const credentials =
      (await kv.get<PasskeyCredential[]>(keys.passkey.byUser(opts.userId)))
        .value ?? [];
    allowCredentials = credentials.map((c) => ({
      id: c.id,
      type: "public-key" as const,
    }));
  }

  const options = await generateAuthenticationOptions({
    rpID: opts.rpId,
    userVerification: "preferred",
    allowCredentials,
  });

  await kv.set(keys.passkey.challenge(challengeId), options.challenge, {
    expireIn: 5 * 60 * 1000,
  });

  return { options, challengeId };
}

/**
 * Verifies the WebAuthn authentication response from the client, updates the
 * stored credential counter, and returns the authenticated user ID.
 */
export async function finishAuthentication(
  kv: Deno.Kv,
  challengeId: string,
  response: AuthenticationResponseJSON,
  rpId: string,
  origin: string,
): Promise<{ userId: string; credential: PasskeyCredential }> {
  const challengeEntry = await kv.get<string>(
    keys.passkey.challenge(challengeId),
  );
  if (!challengeEntry.value) throw new Error("Challenge expired or not found");

  const userIdEntry = await kv.get<string>(
    keys.passkey.credentialToUser(response.id),
  );
  if (!userIdEntry.value) throw new Error("Unknown credential");
  const userId = userIdEntry.value;

  const allCredentials =
    (await kv.get<PasskeyCredential[]>(keys.passkey.byUser(userId))).value ??
      [];
  const stored = allCredentials.find((c) => c.id === response.id);
  if (!stored) throw new Error("Credential not found for user");

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challengeEntry.value,
    expectedOrigin: origin,
    expectedRPID: rpId,
    requireUserVerification: false,
    credential: {
      id: stored.id,
      publicKey: stored.publicKey as Uint8Array<ArrayBuffer>,
      counter: stored.counter,
      transports: stored.transports as
        | AuthenticatorTransportFuture[]
        | undefined,
    },
  });

  if (!verification.verified) {
    throw new Error("Passkey authentication verification failed");
  }

  await kv.delete(keys.passkey.challenge(challengeId));

  const updated: PasskeyCredential = {
    ...stored,
    counter: verification.authenticationInfo.newCounter,
  };
  await kv.set(
    keys.passkey.byUser(userId),
    allCredentials.map((c) => (c.id === stored.id ? updated : c)),
  );

  return { userId, credential: updated };
}
