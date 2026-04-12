/**
 * Platform Payment Service
 *
 * Shared payment infrastructure that any plugin can use.
 * Handles Stripe integration (regular + Connect) and records
 * payment events in plugin_data.payment_requests + billing_events.
 *
 * Architecture:
 *   Plugin → pluginPayments.createCharge() → Stripe Checkout Session
 *   Stripe → webhook → updates payment_request status
 *   Org → Stripe Connect payout (if connected)
 *
 * Note: Stripe SDK is not yet installed. This module is designed
 * to work once `stripe` is added as a dependency and keys are configured.
 * Methods are fully typed but will throw "not configured" until then.
 */

import { createClient } from "@/lib/supabase/server";
import type {
  CreatePaymentRequestOptions,
  RefundPaymentOptions,
  PaymentRequest,
  OrgBillingAccount,
  CreateConnectAccountOptions,
  ConnectOnboardingResult,
} from "./types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured. Add it to .env.local or Vercel environment variables.",
    );
  }
  return key;
}

function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not configured. Add it to .env.local or Vercel environment variables.",
    );
  }
  return secret;
}

// Lazy-loaded Stripe instance
let _stripe: import("stripe").default | null = null;

async function getStripe(): Promise<import("stripe").default> {
  if (_stripe) return _stripe;

  try {
    const Stripe = (await import("stripe")).default;
    _stripe = new Stripe(getStripeSecretKey(), {
      apiVersion: "2025-03-31.basil" as any,
      typescript: true,
    });
    return _stripe;
  } catch {
    throw new Error(
      "Stripe SDK not installed. Run: bun add stripe",
    );
  }
}

// ---------------------------------------------------------------------------
// Billing Account Management
// ---------------------------------------------------------------------------

/**
 * Get or create a billing account for an organization.
 */
export async function getOrCreateBillingAccount(
  organizationId: string,
): Promise<OrgBillingAccount> {
  const supabase = await createClient();

  // Try to find existing
  const { data: existing, error: fetchError } = await supabase
    .from("org_billing_accounts" as never)
    .select("*")
    .eq("organization_id", organizationId)
    .single() as { data: OrgBillingAccount | null; error: Error | null };

  if (existing && !fetchError) {
    return existing;
  }

  // Create new
  const { data, error } = await supabase
    .from("org_billing_accounts" as never)
    .insert({ organization_id: organizationId } as never)
    .select()
    .single() as { data: OrgBillingAccount | null; error: Error | null };

  if (error || !data) {
    throw new Error(`Failed to create billing account: ${error?.message}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Stripe Connect Onboarding
// ---------------------------------------------------------------------------

/**
 * Create a Stripe Connect account for an organization and return the
 * onboarding URL. This allows users to pay the org directly.
 */
export async function createConnectAccount(
  options: CreateConnectAccountOptions,
): Promise<ConnectOnboardingResult> {
  const stripe = await getStripe();
  const supabase = await createClient();

  // Create the Express account
  const account = await stripe.accounts.create({
    type: options.accountType ?? "express",
    country: options.country ?? "US",
    email: options.email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: {
      organization_id: options.organizationId,
      platform: "lets-assist",
    },
  });

  // Save to billing account
  await supabase
    .from("org_billing_accounts" as never)
    .upsert({
      organization_id: options.organizationId,
      stripe_connect_account_id: account.id,
      connect_onboarding_status: "pending",
      billing_email: options.email,
    } as never);

  // Create account link for onboarding
  const accountLink = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: options.refreshUrl,
    return_url: options.returnUrl,
    type: "account_onboarding",
  });

  return {
    accountId: account.id,
    onboardingUrl: accountLink.url,
  };
}

// ---------------------------------------------------------------------------
// Payment Requests (the main plugin API)
// ---------------------------------------------------------------------------

/**
 * Create a payment request and Stripe Checkout Session.
 * Returns the payment request record + checkout URL.
 *
 * @example
 * ```ts
 * const result = await createPaymentRequest({
 *   organizationId: org.id,
 *   pluginKey: 'dv-speech-debate',
 *   userId: user.id,
 *   amountCents: 10000,  // $100
 *   description: 'DVSD 2026-2027 Membership Fee',
 *   contextType: 'membership',
 *   contextId: membershipId,
 *   successUrl: 'https://lets-assist.com/org/dvhs_sd/membership/success',
 *   cancelUrl: 'https://lets-assist.com/org/dvhs_sd/membership/cancel',
 * });
 *
 * // Redirect user to result.checkoutUrl
 * ```
 */
export async function createPaymentRequest(
  options: CreatePaymentRequestOptions,
): Promise<{ paymentRequest: PaymentRequest; checkoutUrl: string }> {
  const stripe = await getStripe();
  const supabase = await createClient();

  // Get the org's billing account (with optional Connect ID)
  const billingAccount = await getOrCreateBillingAccount(options.organizationId);

  // Calculate platform fee
  const platformFeeCents = billingAccount.stripe_connect_account_id
    ? Math.round(options.amountCents * (billingAccount.platform_fee_percent / 100))
    : 0;

  // Build Stripe Checkout Session params
  const sessionParams: import("stripe").Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: options.currency ?? "usd",
          product_data: {
            name: options.description,
            metadata: {
              plugin_key: options.pluginKey,
              context_type: options.contextType,
              context_id: options.contextId ?? "",
              organization_id: options.organizationId,
            },
          },
          unit_amount: options.amountCents,
        },
        quantity: 1,
      },
    ],
    success_url: options.successUrl ?? `${process.env.NEXT_PUBLIC_SITE_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: options.cancelUrl ?? `${process.env.NEXT_PUBLIC_SITE_URL}/payments/cancelled`,
    metadata: {
      plugin_key: options.pluginKey,
      context_type: options.contextType,
      context_id: options.contextId ?? "",
      organization_id: options.organizationId,
      user_id: options.userId ?? "",
    },
    ...(options.payerEmail ? { customer_email: options.payerEmail } : {}),
    ...(options.expiresAt
      ? { expires_at: Math.floor(options.expiresAt.getTime() / 1000) }
      : {}),
  };

  // If org has a connected account, use Stripe Connect with application fee
  if (billingAccount.stripe_connect_account_id && billingAccount.connect_charges_enabled) {
    sessionParams.payment_intent_data = {
      application_fee_amount: platformFeeCents,
      transfer_data: {
        destination: billingAccount.stripe_connect_account_id,
      },
    };
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  // Record the payment request in our DB
  const { data: paymentRequest, error } = await supabase
    .from("payment_requests" as never)
    .insert({
      organization_id: options.organizationId,
      plugin_key: options.pluginKey,
      user_id: options.userId ?? null,
      payer_email: options.payerEmail ?? null,
      payer_name: options.payerName ?? null,
      amount_cents: options.amountCents,
      currency: options.currency ?? "usd",
      description: options.description,
      context_type: options.contextType,
      context_id: options.contextId ?? null,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null,
      status: "pending",
      platform_fee_cents: platformFeeCents,
      metadata: options.metadata ?? {},
      expires_at: options.expiresAt?.toISOString() ?? null,
    } as never)
    .select()
    .single() as { data: PaymentRequest | null; error: Error | null };

  if (error || !paymentRequest) {
    throw new Error(`Failed to create payment request: ${error?.message}`);
  }

  // Log billing event
  await logBillingEvent(paymentRequest!.id, options.organizationId, "created", {
    amount_cents: options.amountCents,
    plugin_key: options.pluginKey,
    context_type: options.contextType,
  });

  return {
    paymentRequest: paymentRequest!,
    checkoutUrl: session.url!,
  };
}

/**
 * Get a payment request by ID.
 */
export async function getPaymentRequest(id: string): Promise<PaymentRequest | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payment_requests" as never)
    .select("*")
    .eq("id", id)
    .single() as { data: PaymentRequest | null; error: Error | null };

  if (error) return null;
  return data;
}

/**
 * Get payment requests for a specific context (e.g. all payments for a membership).
 */
export async function getPaymentsByContext(
  contextType: string,
  contextId: string,
): Promise<PaymentRequest[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payment_requests" as never)
    .select("*")
    .eq("context_type", contextType)
    .eq("context_id", contextId)
    .order("created_at", { ascending: false }) as { data: PaymentRequest[] | null; error: Error | null };

  if (error) return [];
  return data ?? [];
}

/**
 * Issue a refund for a payment request.
 */
export async function refundPayment(
  options: RefundPaymentOptions,
): Promise<{ success: boolean; error?: string }> {
  const stripe = await getStripe();
  const supabase = await createClient();

  const paymentRequest = await getPaymentRequest(options.paymentRequestId);
  if (!paymentRequest) {
    return { success: false, error: "Payment request not found" };
  }

  if (!paymentRequest.stripe_payment_intent_id) {
    return { success: false, error: "No Stripe payment intent associated" };
  }

  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentRequest.stripe_payment_intent_id,
      ...(options.amountCents ? { amount: options.amountCents } : {}),
      reason: "requested_by_customer",
      metadata: {
        payment_request_id: options.paymentRequestId,
        reason: options.reason ?? "",
      },
    });

    const isFullRefund = !options.amountCents || options.amountCents >= paymentRequest.amount_cents;

    await supabase
      .from("payment_requests" as never)
      .update({
        status: isFullRefund ? "refunded" : "partially_refunded",
        stripe_refund_id: refund.id,
        refunded_at: new Date().toISOString(),
        refund_amount_cents: options.amountCents ?? paymentRequest.amount_cents,
      } as never)
      .eq("id", options.paymentRequestId);

    await logBillingEvent(
      options.paymentRequestId,
      paymentRequest.organization_id,
      "refunded",
      {
        refund_id: refund.id,
        amount_cents: options.amountCents ?? paymentRequest.amount_cents,
        reason: options.reason,
      },
    );

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Billing Events (audit log)
// ---------------------------------------------------------------------------

async function logBillingEvent(
  paymentRequestId: string,
  organizationId: string,
  eventType: string,
  details: Record<string, unknown> = {},
  stripeEventId?: string,
): Promise<void> {
  try {
    const supabase = await createClient();

    await supabase
      .from("billing_events" as never)
      .insert({
        payment_request_id: paymentRequestId,
        organization_id: organizationId,
        event_type: eventType,
        stripe_event_id: stripeEventId ?? null,
        details,
      } as never);
  } catch (err) {
    // Never let billing event logging break the main flow
    console.error("[payment-service] Failed to log billing event:", err);
  }
}

/**
 * Process a Stripe webhook event.
 * Called from the webhook route handler.
 */
export async function handleStripeWebhook(
  payload: string | Buffer,
  signature: string,
): Promise<{ received: boolean; error?: string }> {
  const stripe = await getStripe();
  const webhookSecret = getStripeWebhookSecret();

  let event: import("stripe").Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { received: false, error: `Webhook signature verification failed: ${message}` };
  }

  const supabase = await createClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as import("stripe").Stripe.Checkout.Session;
      const sessionId = session.id;

      // Update payment request status
      await supabase
        .from("payment_requests" as never)
        .update({
          status: "succeeded",
          paid_at: new Date().toISOString(),
          stripe_payment_intent_id: typeof session.payment_intent === "string"
            ? session.payment_intent
            : null,
        } as never)
        .eq("stripe_checkout_session_id", sessionId);

      // Find the payment request to get its ID for the billing event
      const { data: pr } = await supabase
        .from("payment_requests" as never)
        .select("id, organization_id")
        .eq("stripe_checkout_session_id", sessionId)
        .single() as { data: { id: string; organization_id: string } | null };

      if (pr) {
        await logBillingEvent(pr.id, pr.organization_id, "succeeded", {
          session_id: sessionId,
        }, event.id);
      }
      break;
    }

    case "checkout.session.expired": {
      const session = event.data.object as import("stripe").Stripe.Checkout.Session;

      await supabase
        .from("payment_requests" as never)
        .update({ status: "cancelled" } as never)
        .eq("stripe_checkout_session_id", session.id);
      break;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as import("stripe").Stripe.PaymentIntent;

      await supabase
        .from("payment_requests" as never)
        .update({ status: "failed" } as never)
        .eq("stripe_payment_intent_id", pi.id);

      const { data: pr } = await supabase
        .from("payment_requests" as never)
        .select("id, organization_id")
        .eq("stripe_payment_intent_id", pi.id)
        .single() as { data: { id: string; organization_id: string } | null };

      if (pr) {
        await logBillingEvent(pr.id, pr.organization_id, "failed", {
          error: pi.last_payment_error?.message ?? "Unknown error",
        }, event.id);
      }
      break;
    }

    case "account.updated": {
      // Stripe Connect account status update
      const account = event.data.object as import("stripe").Stripe.Account;

      await supabase
        .from("org_billing_accounts" as never)
        .update({
          connect_charges_enabled: account.charges_enabled,
          connect_payouts_enabled: account.payouts_enabled,
          connect_onboarding_status: account.charges_enabled ? "active" : "pending",
        } as never)
        .eq("stripe_connect_account_id", account.id);
      break;
    }

    default:
      // Unhandled event type — log but don't error
      console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
  }

  return { received: true };
}
