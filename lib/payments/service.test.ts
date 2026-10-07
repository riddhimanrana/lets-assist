import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import Stripe from "stripe";
import { NextRequest } from "next/server";
import {
  createConnectAccount,
  createPaymentRequest,
  getOrCreateBillingAccount,
  getPaymentRequest,
  getPaymentsByContext,
  refundPayment,
  PAYMENTS_UNAVAILABLE,
} from "./service";
import { POST } from "../../app/api/webhooks/stripe/route";

const initialWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const initialApiSecret = process.env.STRIPE_SECRET_KEY;
const oldFetch = globalThis.fetch;
const network = mock(async () => {
  throw new Error("Provider calls must be unreachable");
});
beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_synthetic_test_only";
  process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_test_only";
  network.mockClear();
  globalThis.fetch = network as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = oldFetch;
  if (initialWebhookSecret === undefined)
    delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = initialWebhookSecret;
  if (initialApiSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = initialApiSecret;
});

test("configured keys cannot activate retired financial writes or misleading reads", async () => {
  const calls = [
    createPaymentRequest({
      organizationId: "synthetic-org",
      pluginKey: "synthetic",
      amountCents: 100,
      description: "Synthetic",
      contextType: "membership",
    }),
    createConnectAccount({
      organizationId: "synthetic-org",
      email: "synthetic@example.test",
      refreshUrl: "https://example.test",
      returnUrl: "https://example.test",
    }),
    getOrCreateBillingAccount("synthetic-org"),
    getPaymentRequest("synthetic-payment"),
    getPaymentsByContext("membership", "synthetic"),
  ];
  const results = await Promise.allSettled(calls);
  expect(
    results.every(
      (result) =>
        result.status === "rejected" &&
        result.reason.message === PAYMENTS_UNAVAILABLE,
    ),
  ).toBe(true);
  expect(
    await refundPayment({ paymentRequestId: "synthetic-payment" }),
  ).toEqual({ success: false, error: PAYMENTS_UNAVAILABLE });
  expect(network).not.toHaveBeenCalled();
});

function webhookRequest(payload: string, signature?: string) {
  return new NextRequest("https://lets-assist.com/api/webhooks/stripe", {
    method: "POST",
    body: payload,
    headers: signature ? { "stripe-signature": signature } : {},
  });
}

test("real signature verification never acknowledges valid but unprocessed events", async () => {
  const payload = JSON.stringify({
    id: "evt_synthetic",
    type: "checkout.session.completed",
    data: { object: { id: "cs_synthetic" } },
  });
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await POST(webhookRequest(payload, signature));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Payments are unavailable",
    });
  }
  expect(network).not.toHaveBeenCalled();
});

test("tampered, missing and expired signatures fail without reflecting payload content", async () => {
  const payload = JSON.stringify({
    id: "evt_synthetic",
    private: "synthetic-sensitive-content",
  });
  const expired = await Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
    timestamp: 1,
  });
  for (const signature of [undefined, "invalid-private-signature", expired]) {
    const response = await POST(webhookRequest(payload, signature));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("synthetic-sensitive-content");
  }
});

test("missing webhook configuration is unavailable, never accepted", async () => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const response = await POST(webhookRequest("{}", "synthetic-signature"));
  expect(response.status).toBe(503);
  expect(network).not.toHaveBeenCalled();
});
