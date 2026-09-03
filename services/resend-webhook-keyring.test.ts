import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { readResendWebhookVerificationKeys } =
  await import("./resend-webhook-keyring");

describe("Resend webhook keyring", () => {
  test("orders the active key first and retains the legacy migration key", () => {
    const keys = readResendWebhookVerificationKeys({
      RESEND_WEBHOOK_SECRET_KEYRING: JSON.stringify({
        activeKeyId: "v2",
        keys: {
          v1: "whsec_synthetic_old",
          v2: "whsec_synthetic_active",
        },
      }),
      RESEND_WEBHOOK_SECRET: "whsec_synthetic_legacy",
    });

    expect(keys).toEqual([
      { id: "v2", secret: "whsec_synthetic_active" },
      { id: "v1", secret: "whsec_synthetic_old" },
      { id: "legacy", secret: "whsec_synthetic_legacy" },
    ]);
  });

  test("deduplicates a legacy secret already present in the keyring", () => {
    const keys = readResendWebhookVerificationKeys({
      RESEND_WEBHOOK_SECRET_KEYRING: JSON.stringify({
        activeKeyId: "v2",
        keys: { v2: "whsec_synthetic_active" },
      }),
      RESEND_WEBHOOK_SECRET: "whsec_synthetic_active",
    });

    expect(keys).toHaveLength(1);
  });

  test("fails closed for malformed or unbounded keyrings", () => {
    expect(() =>
      readResendWebhookVerificationKeys({
        RESEND_WEBHOOK_SECRET_KEYRING: "not-json",
      }),
    ).toThrow(/keyring configuration is invalid/i);
    expect(() =>
      readResendWebhookVerificationKeys({
        RESEND_WEBHOOK_SECRET_KEYRING: JSON.stringify({
          activeKeyId: "missing",
          keys: { v1: "whsec_synthetic_old" },
        }),
      }),
    ).toThrow(/keyring configuration is invalid/i);
    expect(() =>
      readResendWebhookVerificationKeys({
        RESEND_WEBHOOK_SECRET_KEYRING: JSON.stringify({
          activeKeyId: "legacy",
          keys: { legacy: "whsec_synthetic_replacement" },
        }),
        RESEND_WEBHOOK_SECRET: "whsec_synthetic_legacy",
      }),
    ).toThrow(/keyring configuration is invalid/i);
  });

  test("keeps the single secret as a one-release fallback", () => {
    expect(
      readResendWebhookVerificationKeys({
        RESEND_WEBHOOK_SECRET: "whsec_synthetic_legacy",
      }),
    ).toEqual([{ id: "legacy", secret: "whsec_synthetic_legacy" }]);
  });
});
