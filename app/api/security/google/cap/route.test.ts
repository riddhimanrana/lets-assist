import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

class RequestFailure extends Error {
  status: 400 | 413;
  constructor(status: 400 | 413) {
    super("request failure");
    this.status = status;
  }
}
class ValidationFailure extends Error {}

const RAW_TOKEN = "raw.signed.token";
const RAW_SUBJECT = "raw-google-subject";
const RAW_JTI = "raw-provider-jti";

let readBehavior: () => Promise<string> = async () => RAW_TOKEN;
let validateBehavior: () => Promise<Record<string, unknown>> = async () => ({
  jti: RAW_JTI,
});
let handleBehavior: () => Promise<{
  actionCount: number;
  errorCount: number;
  safeOutcome: string;
  settlement?: "hold";
}> = async () => ({
  actionCount: 1,
  errorCount: 0,
  safeOutcome: "sessions_terminated",
});
let claimBehavior: () => Promise<Record<string, unknown>> = async () => ({
  receiptId: "11111111-1111-4111-8111-111111111111",
  decision: "execute",
  claimToken: "22222222-2222-4222-8222-222222222222",
  attemptCount: 1,
  userId: "33333333-3333-4333-8333-333333333333",
});
let beginEffectBehavior: () => Promise<Record<string, unknown>> = async () => ({
  decision: "execute",
  userId: "33333333-3333-4333-8333-333333333333",
});
let finishBehavior: () => Promise<boolean> = async () => true;

const calls = {
  validate: 0,
  claim: 0,
  beginEffect: 0,
  handle: 0,
  finish: 0,
};
const callOrder: string[] = [];

mock.module("@/lib/security/google-cap-request", () => ({
  GoogleCapRequestError: RequestFailure,
  readGoogleCapToken: async () => readBehavior(),
}));

mock.module("@/lib/security/google-cap", () => ({
  GoogleCapValidationError: ValidationFailure,
  validateGoogleCapToken: async () => {
    calls.validate += 1;
    callOrder.push("validate");
    return validateBehavior();
  },
  getGoogleCapEventDescriptor: () => ({
    issuer: "https://accounts.google.com/",
    jti: RAW_JTI,
    issuedAt: new Date("2026-08-12T19:00:00.000Z"),
    eventType:
      "https://schemas.openid.net/secevent/risc/event-type/sessions-revoked",
    googleSubject: RAW_SUBJECT,
  }),
  handleGoogleCapPayload: async () => {
    calls.handle += 1;
    callOrder.push("handle");
    return handleBehavior();
  },
  googleCapEventRequiresAuthEffect: () => true,
}));

mock.module("@/lib/security/google-cap-receipts", () => ({
  claimGoogleCapEvent: async () => {
    calls.claim += 1;
    callOrder.push("claim");
    return claimBehavior();
  },
  beginGoogleCapEventEffect: async () => {
    calls.beginEffect += 1;
    callOrder.push("beginEffect");
    return beginEffectBehavior();
  },
  finishGoogleCapEvent: async () => {
    calls.finish += 1;
    callOrder.push("finish");
    return finishBehavior();
  },
}));

const logRecords: unknown[][] = [];
console.info = (...args: unknown[]) => logRecords.push(args);
console.warn = (...args: unknown[]) => logRecords.push(args);
console.error = (...args: unknown[]) => logRecords.push(args);

const { POST } = await import("./route");

function request() {
  return new Request("http://127.0.0.1/api/security/google/cap", {
    method: "POST",
    body: RAW_TOKEN,
  });
}

beforeEach(() => {
  calls.validate = 0;
  calls.claim = 0;
  calls.beginEffect = 0;
  calls.handle = 0;
  calls.finish = 0;
  callOrder.length = 0;
  logRecords.length = 0;
  readBehavior = async () => RAW_TOKEN;
  validateBehavior = async () => ({ jti: RAW_JTI });
  handleBehavior = async () => ({
    actionCount: 1,
    errorCount: 0,
    safeOutcome: "sessions_terminated",
  });
  claimBehavior = async () => ({
    receiptId: "11111111-1111-4111-8111-111111111111",
    decision: "execute",
    claimToken: "22222222-2222-4222-8222-222222222222",
    attemptCount: 1,
    userId: "33333333-3333-4333-8333-333333333333",
  });
  beginEffectBehavior = async () => ({
    decision: "execute",
    userId: "33333333-3333-4333-8333-333333333333",
  });
  finishBehavior = async () => true;
});

describe("POST /api/security/google/cap", () => {
  test("rejects malformed input before validation, database, or auth work", async () => {
    readBehavior = async () => {
      throw new RequestFailure(413);
    };
    const response = await POST(request());
    expect(response.status).toBe(413);
    expect(calls).toEqual({
      validate: 0,
      claim: 0,
      beginEffect: 0,
      handle: 0,
      finish: 0,
    });
  });

  test("returns 400 for a signature or claim validation failure", async () => {
    validateBehavior = async () => {
      throw new ValidationFailure("invalid signature");
    };
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(calls.claim).toBe(0);
  });

  test("returns 503 for a transient JWKS validation dependency failure", async () => {
    validateBehavior = async () => {
      throw new Error("synthetic JWKS timeout");
    };
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(calls.claim).toBe(0);
  });

  test("acknowledges a completed durable replay without repeating effects", async () => {
    claimBehavior = async () => ({
      receiptId: "11111111-1111-4111-8111-111111111111",
      decision: "replayed",
      claimToken: null,
      attemptCount: 1,
      userId: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ received: true, replayed: true });
    expect(calls.beginEffect).toBe(0);
    expect(calls.handle).toBe(0);
    expect(calls.finish).toBe(0);
  });

  test("keeps a concurrent in-progress delivery retryable", async () => {
    claimBehavior = async () => ({
      receiptId: "11111111-1111-4111-8111-111111111111",
      decision: "in_progress",
      claimToken: null,
      attemptCount: 1,
      userId: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(calls.beginEffect).toBe(0);
    expect(calls.handle).toBe(0);
  });

  test("revalidates identity under the lease immediately before an Auth effect", async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(calls).toEqual({
      validate: 1,
      claim: 1,
      beginEffect: 1,
      handle: 1,
      finish: 1,
    });
    expect(callOrder).toEqual([
      "validate",
      "claim",
      "beginEffect",
      "handle",
      "finish",
    ]);
  });

  test("keeps an actionable event retryable when no local identity exists", async () => {
    claimBehavior = async () => ({
      receiptId: "11111111-1111-4111-8111-111111111111",
      decision: "execute",
      claimToken: "22222222-2222-4222-8222-222222222222",
      attemptCount: 1,
      userId: null,
    });
    beginEffectBehavior = async () => ({
      decision: "no_local_user",
      userId: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(calls.handle).toBe(0);
    expect(calls.finish).toBe(0);
  });

  test("a stale worker cannot mutate Auth after lease takeover", async () => {
    beginEffectBehavior = async () => ({
      decision: "lease_lost",
      userId: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(calls.handle).toBe(0);
    expect(calls.finish).toBe(0);
  });

  test("an identity owner changed after claim is retried before Auth mutation", async () => {
    beginEffectBehavior = async () => ({
      decision: "identity_changed",
      userId: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(calls.handle).toBe(0);
    expect(calls.finish).toBe(0);
  });

  test("returns 503 after a retryable action failure so Google redelivers", async () => {
    handleBehavior = async () => ({
      actionCount: 0,
      errorCount: 1,
      safeOutcome: "retryable_failure",
    });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(calls.finish).toBe(1);
  });

  test("does not release the effect fence after an ambiguous Auth outcome", async () => {
    handleBehavior = async () => ({
      actionCount: 0,
      errorCount: 1,
      safeOutcome: "auth_outcome_unknown",
      settlement: "hold",
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(calls.finish).toBe(0);
  });

  test("returns 503 when durable settlement is lost after the action", async () => {
    finishBehavior = async () => false;
    const response = await POST(request());
    expect(response.status).toBe(503);
  });

  test("structured logs exclude tokens, provider subjects, jtis, and user ids", async () => {
    await POST(request());
    const serialized = JSON.stringify(logRecords);
    expect(serialized).not.toContain(RAW_TOKEN);
    expect(serialized).not.toContain(RAW_SUBJECT);
    expect(serialized).not.toContain(RAW_JTI);
    expect(serialized).not.toContain("33333333-3333-4333-8333-333333333333");
  });
});
