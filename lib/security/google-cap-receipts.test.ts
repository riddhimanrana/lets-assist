import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let rpcResult: { data: unknown; error: { message: string } | null } = {
  data: [
    {
      receipt_id: "11111111-1111-4111-8111-111111111111",
      decision: "execute",
      claim_token: "22222222-2222-4222-8222-222222222222",
      attempt_count: 1,
      user_id: "33333333-3333-4333-8333-333333333333",
    },
  ],
  error: null,
};

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
  }),
}));

const { claimGoogleCapEvent, finishGoogleCapEvent } =
  await import("./google-cap-receipts");

const descriptor = {
  issuer: "https://accounts.google.com/",
  jti: "raw-provider-jti",
  issuedAt: new Date("2026-08-12T19:00:00.000Z"),
  eventType:
    "https://schemas.openid.net/secevent/risc/event-type/sessions-revoked",
  googleSubject: "raw-google-subject",
};

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResult = {
    data: [
      {
        receipt_id: "11111111-1111-4111-8111-111111111111",
        decision: "execute",
        claim_token: "22222222-2222-4222-8222-222222222222",
        attempt_count: 1,
        user_id: "33333333-3333-4333-8333-333333333333",
      },
    ],
    error: null,
  };
});

describe("Google CAP durable receipts", () => {
  test("hashes the jti, token, and subject before the database receipt", async () => {
    const claim = await claimGoogleCapEvent(descriptor, "signed.jwt.token");
    expect(claim.decision).toBe("execute");

    const call = rpcCalls[0];
    expect(call.name).toBe("claim_google_cap_event");
    expect(call.args.p_jti_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(call.args.p_token_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(call.args.p_subject_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(call.args)).not.toContain("raw-provider-jti");
    expect(JSON.stringify(call.args)).not.toContain("signed.jwt.token");
    // The raw subject is supplied only to the service-only resolver RPC and is
    // deliberately absent from the table contract; SQL coverage proves that.
    expect(call.args.p_google_subject).toBe("raw-google-subject");
  });

  test("fails closed when the claim result shape is not exact", async () => {
    rpcResult = { data: [{ decision: "execute" }], error: null };
    await expect(
      claimGoogleCapEvent(descriptor, "signed.jwt.token"),
    ).rejects.toThrow("invalid result");
  });

  test("settles through aggregate bounded coordinates only", async () => {
    rpcResult = { data: true, error: null };
    expect(
      await finishGoogleCapEvent({
        receiptId: "11111111-1111-4111-8111-111111111111",
        claimToken: "22222222-2222-4222-8222-222222222222",
        succeeded: true,
        safeOutcome: "sessions_terminated",
        actionCount: 1,
        errorCount: 0,
      }),
    ).toBe(true);
    expect(rpcCalls[0]).toEqual({
      name: "finish_google_cap_event",
      args: {
        p_receipt_id: "11111111-1111-4111-8111-111111111111",
        p_claim_token: "22222222-2222-4222-8222-222222222222",
        p_succeeded: true,
        p_safe_outcome: "sessions_terminated",
        p_action_count: 1,
        p_error_count: 0,
      },
    });
  });
});
