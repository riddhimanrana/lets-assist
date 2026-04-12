/**
 * Payments Module — Barrel Export
 *
 * Platform-level payment service accessible by any plugin.
 */

export type {
  PaymentRequestStatus,
  ConnectOnboardingStatus,
  PaymentContextType,
  OrgBillingAccount,
  PaymentRequest,
  BillingEvent,
  CreatePaymentRequestOptions,
  RefundPaymentOptions,
  CreateConnectAccountOptions,
  ConnectOnboardingResult,
  StripeWebhookEventType,
} from "./types";

export {
  getOrCreateBillingAccount,
  createConnectAccount,
  createPaymentRequest,
  getPaymentRequest,
  getPaymentsByContext,
  refundPayment,
  handleStripeWebhook,
} from "./service";
