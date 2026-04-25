export type User = {
  id: string;
  email: string;
  createdAt: number;
};

export type Session = {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
};

export type MagicToken = {
  email: string;
  expiresAt: number;
  used: boolean;
};

export type PasskeyCredential = {
  id: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports?: string[];
};

export type StripeCustomer = {
  stripeId: string;
  userId: string;
  email: string;
  createdAt: number;
};

export type StripeSubscription = {
  subscriptionId: string;
  customerId: string;
  status: string;
  priceId: string;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  updatedAt: number;
};
