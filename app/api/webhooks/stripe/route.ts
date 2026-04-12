/**
 * Stripe Webhook Route Handler
 *
 * Receives Stripe webhook events and delegates to the payment service.
 * Handles: checkout completed, payment failed, refunds, Connect account updates.
 */

import { NextResponse, type NextRequest } from "next/server";
import { handleStripeWebhook } from "@/lib/payments/service";

export const runtime = "nodejs";

// Stripe sends raw body — we need to disable Next.js body parsing
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  try {
    const body = await request.text();

    const result = await handleStripeWebhook(body, signature);

    if (!result.received) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 },
      );
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe-webhook] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
