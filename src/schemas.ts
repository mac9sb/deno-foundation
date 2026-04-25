/** A registered user of the application. */
export type User = {
  id: string;
  email: string;
  createdAt: number;
};

/** An authenticated session tied to a user. */
export type Session = {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
};

/** A one-time magic-link token stored hashed in KV. */
export type MagicToken = {
  email: string;
  expiresAt: number;
  used: boolean;
};

/** A WebAuthn passkey credential stored per user. */
export type PasskeyCredential = {
  id: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports?: string[];
};

/** A Stripe customer linked to an application user. */
export type StripeCustomer = {
  stripeId: string;
  userId: string;
  email: string;
  createdAt: number;
};

/** A Stripe subscription linked to a user. */
export type StripeSubscription = {
  subscriptionId: string;
  customerId: string;
  status: string;
  priceId: string;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  updatedAt: number;
};
