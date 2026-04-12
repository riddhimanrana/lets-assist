/**
 * Shared Payment Service Types
 *
 * Defines the contract for the platform-level payment system.
 * Any plugin can create payment requests; the platform handles Stripe.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type PaymentRequestStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

export type ConnectOnboardingStatus =
  | "not_started"
  | "pending"
  | "in_review"
  | "active"
  | "restricted"
  | "disabled";

/**
 * Context type for payment requests.
 * This tells the system what the payment is for.
 * Plugins can define their own context types.
 */
export type PaymentContextType =
  | "membership"         // Membership dues (e.g. DVSD annual dues)
  | "signup"             // Event registration fee (e.g. paid signups plugin)
  | "tournament"         // Tournament entry fee
  | "form_submission"    // Payment attached to a form submission
  | "donation"           // Fundraiser donations
  | "custom";            // Plugin-defined custom context

// ---------------------------------------------------------------------------
// Database row types
// ---------------------------------------------------------------------------

export interface OrgBillingAccount {
  id: string;
  organization_id: string;
  stripe_customer_id: string | null;
  stripe_connect_account_id: string | null;
  connect_onboarding_status: ConnectOnboardingStatus;
  connect_charges_enabled: boolean;
  connect_payouts_enabled: boolean;
  connect_country: string;
  connect_default_currency: string;
  platform_fee_percent: number;
  billing_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentRequest {
  id: string;
  organization_id: string;
  plugin_key: string;
  user_id: string | null;
  payer_email: string | null;
  payer_name: string | null;
  amount_cents: number;
  currency: string;
  description: string;
  context_type: PaymentContextType;
  context_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_charge_id: string | null;
  stripe_refund_id: string | null;
  status: PaymentRequestStatus;
  paid_at: string | null;
  refunded_at: string | null;
  refund_amount_cents: number | null;
  platform_fee_cents: number;
  metadata: Record<string, unknown>;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillingEvent {
  id: string;
  payment_request_id: string | null;
  organization_id: string | null;
  event_type: string;
  stripe_event_id: string | null;
  amount_cents: number | null;
  details: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Service input types
// ---------------------------------------------------------------------------

/**
 * Options for creating a new payment request.
 * This is the API surface that plugins use.
 */
export interface CreatePaymentRequestOptions {
  /** Organization receiving the payment */
  organizationId: string;
  /** Plugin creating the charge */
  pluginKey: string;
  /** User making the payment */
  userId?: string;
  /** Payer email (for non-authenticated users) */
  payerEmail?: string;
  /** Payer name */
  payerName?: string;
  /** Amount in cents */
  amountCents: number;
  /** Currency code (default: 'usd') */
  currency?: string;
  /** Human-readable description shown on the payment page */
  description: string;
  /** What is this payment for? */
  contextType: PaymentContextType;
  /** FK to the relevant record (membership ID, signup ID, etc.) */
  contextId?: string;
  /** Plugin-specific metadata */
  metadata?: Record<string, unknown>;
  /** Auto-cancel payment if not completed by this time */
  expiresAt?: Date;
  /** Success redirect URL after payment */
  successUrl?: string;
  /** Cancel redirect URL */
  cancelUrl?: string;
}

export interface RefundPaymentOptions {
  /** Payment request ID to refund */
  paymentRequestId: string;
  /** Amount to refund in cents (null = full refund) */
  amountCents?: number;
  /** Reason for the refund */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Stripe Connect onboarding
// ---------------------------------------------------------------------------

export interface CreateConnectAccountOptions {
  organizationId: string;
  /** Email for the Stripe account */
  email: string;
  /** Country code (default: 'US') */
  country?: string;
  /** Type of Stripe account (default: 'express') */
  accountType?: "express" | "standard";
  /** Return URL after onboarding completes */
  returnUrl: string;
  /** Refresh URL if onboarding link expires */
  refreshUrl: string;
}

export interface ConnectOnboardingResult {
  accountId: string;
  onboardingUrl: string;
}

// ---------------------------------------------------------------------------
// Webhook types
// ---------------------------------------------------------------------------

export type StripeWebhookEventType =
  | "payment_intent.succeeded"
  | "payment_intent.payment_failed"
  | "checkout.session.completed"
  | "checkout.session.expired"
  | "charge.refunded"
  | "account.updated"
  | "account.application.deauthorized";
