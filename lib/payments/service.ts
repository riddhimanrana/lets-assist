import "server-only";
import type {
  CreatePaymentRequestOptions,
  RefundPaymentOptions,
  PaymentRequest,
  OrgBillingAccount,
  CreateConnectAccountOptions,
  ConnectOnboardingResult,
} from "./types";

export const PAYMENTS_UNAVAILABLE =
  "Online payments are unavailable. Contact the organization for its supported payment instructions.";

/** Compatibility boundary for the retired, unshipped billing adapter. */
function unavailable(): never {
  throw new Error(PAYMENTS_UNAVAILABLE);
}

export async function getOrCreateBillingAccount(
  _organizationId: string,
): Promise<OrgBillingAccount> {
  return unavailable();
}

export async function createConnectAccount(
  _options: CreateConnectAccountOptions,
): Promise<ConnectOnboardingResult> {
  return unavailable();
}

export async function createPaymentRequest(
  _options: CreatePaymentRequestOptions,
): Promise<{ paymentRequest: PaymentRequest; checkoutUrl: string }> {
  return unavailable();
}

export async function getPaymentRequest(
  _id: string,
): Promise<PaymentRequest | null> {
  return unavailable();
}

export async function getPaymentsByContext(
  _contextType: string,
  _contextId: string,
): Promise<PaymentRequest[]> {
  return unavailable();
}

export async function refundPayment(
  _options: RefundPaymentOptions,
): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: PAYMENTS_UNAVAILABLE };
}

export type WebhookResult =
  { received: true } | { received: false; error: string; status: 400 | 503 };

/** Never acknowledge an event that this application cannot durably process. */
export async function handleStripeWebhook(
  payload: string | Buffer,
  signature: string,
): Promise<WebhookResult> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret)
    return { received: false, error: "Payments are unavailable", status: 503 };
  const { default: Stripe } = await import("stripe");
  try {
    await Stripe.webhooks.constructEventAsync(payload, signature, secret);
  } catch {
    return { received: false, error: "Invalid webhook signature", status: 400 };
  }
  return { received: false, error: "Payments are unavailable", status: 503 };
}
