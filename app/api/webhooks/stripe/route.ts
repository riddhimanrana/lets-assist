/**
 * Stripe Webhook Route Handler
 *
 * Retains the legacy URL without acknowledging unprocessed payment events.
 */

import { NextResponse, type NextRequest } from "next/server";
import { handleStripeWebhook } from "@/lib/payments/service";

export const runtime = "nodejs";

// Signature verification requires the exact raw body.
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
        { status: result.status },
      );
    }

    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
