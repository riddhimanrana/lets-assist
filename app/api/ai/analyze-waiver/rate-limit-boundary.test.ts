import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

const events: string[] = [];
const quotaCalls: Record<string, unknown>[] = [];
let authResult: {
  user: { id: string } | null;
  error: Error | null;
};
let quotaBehavior: () => unknown;
let providerCalls = 0;
let pdfLoadCalls = 0;

mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => {
    events.push("auth");
    return authResult;
  },
}));

mock.module("@/lib/ai/analyze-waiver-rate-limit", () => ({
  buildAnalyzeWaiverQuotaIdentity: (userId: string, headers: Headers) => ({
    requestKey:
      userId === "waiver-user-1" &&
      headers.get("idempotency-key") === IDEMPOTENCY_KEY
        ? "b".repeat(64)
        : "c".repeat(64),
    requestFingerprint:
      headers.get("x-waiver-content-sha256") ?? "d".repeat(64),
    expectedContentDigest: headers.get("x-waiver-content-sha256"),
  }),
  consumeAnalyzeWaiverQuota: async (input: Record<string, unknown>) => {
    events.push("quota");
    quotaCalls.push(input);
    return quotaBehavior();
  },
}));

mock.module("ai", () => ({
  Output: { object: () => ({}) },
  generateText: async () => {
    providerCalls += 1;
    throw new Error("provider must not run in boundary tests");
  },
}));

mock.module("pdf-lib", () => ({
  PDFDocument: {
    load: async () => {
      pdfLoadCalls += 1;
      throw new Error("PDF parsing must not run in boundary tests");
    },
  },
}));

mock.module("@/lib/waiver/pdf-text-extract", () => ({
  extractPdfTextWithPositions: async () => {
    throw new Error("PDF text extraction must not run in boundary tests");
  },
}));
mock.module("@/lib/waiver/label-detection", () => ({ findLabels: () => [] }));
mock.module("@/lib/waiver/candidate-detection", () => ({
  detectCandidateAreas: () => [],
}));
mock.module("@/lib/waiver/pdf-field-detect", () => ({
  detectPdfWidgets: async () => ({ success: true, fields: [] }),
}));
mock.module("@/lib/ai/gateway", () => ({ gatewayModel: () => ({}) }));
mock.module("@/lib/ai/models", () => ({
  AI_MODEL_FAST: "test/model",
  AI_MODEL_FALLBACK_CHAIN: ["test/model"],
}));
mock.module("@/lib/ai/posthog-telemetry", () => ({
  createPostHogTelemetry: () => undefined,
}));

const { NextRequest } = await import("next/server");
const { POST } = await import("./route");

const CONTENT_DIGEST = "a".repeat(64);
const IDEMPOTENCY_KEY = "018f47f2-b63a-7f2a-9d9e-8f0c5b6a7c8d";

function request(
  headers: Record<string, string> = {},
  formData = new FormData(),
) {
  const value = new NextRequest("http://127.0.0.1:3000/api/ai/analyze-waiver", {
    method: "POST",
    headers: {
      "idempotency-key": IDEMPOTENCY_KEY,
      "x-waiver-content-sha256": CONTENT_DIGEST,
      ...headers,
    },
  });
  Object.defineProperty(value, "formData", {
    value: async () => {
      events.push("formData");
      return formData;
    },
  });
  return value;
}

beforeEach(() => {
  delete process.env.ENABLE_E2E_AUTH_BYPASS;
  events.length = 0;
  quotaCalls.length = 0;
  providerCalls = 0;
  pdfLoadCalls = 0;
  authResult = { user: { id: "waiver-user-1" }, error: null };
  quotaBehavior = () => ({
    allowed: true,
    remaining: 9,
    resetAt: new Date(Date.now() + 60_000).toISOString(),
    replayed: false,
  });
});

describe("waiver analysis route cost and error boundary", () => {
  test("executes authentication and quota metering before parsing multipart data", async () => {
    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(events).toEqual(["auth", "quota", "formData"]);
    expect(providerCalls).toBe(0);
    expect(pdfLoadCalls).toBe(0);
  });

  test("a quota denial executes no multipart, PDF, or provider work", async () => {
    quotaBehavior = () => ({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
      replayed: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toMatch(/^[1-9][0-9]*$/);
    expect(events).toEqual(["auth", "quota"]);
    expect(providerCalls).toBe(0);
    expect(pdfLoadCalls).toBe(0);
  });

  test("an already accepted HTTP request does not repeat expensive work", async () => {
    quotaBehavior = () => ({
      allowed: true,
      remaining: 9,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
      replayed: true,
      recovered: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This waiver-analysis request was already accepted.",
    });
    expect(events).toEqual(["auth", "quota"]);
    expect(providerCalls).toBe(0);
    expect(pdfLoadCalls).toBe(0);
  });

  test("auth and limiter uncertainty fail closed before multipart work", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      authResult = { user: null, error: new Error("sensitive auth failure") };
      let response = await POST(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Waiver analysis is temporarily unavailable. Please try again.",
      });
      expect(events).toEqual(["auth"]);

      events.length = 0;
      authResult = { user: { id: "waiver-user-1" }, error: null };
      quotaBehavior = () => {
        throw new Error("sensitive database failure");
      };
      response = await POST(request());
      expect(response.status).toBe(503);
      expect(events).toEqual(["auth", "quota"]);
      expect(providerCalls).toBe(0);
      expect(pdfLoadCalls).toBe(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("omits the IP bucket when trusted forwarding headers are unresolved", async () => {
    await POST(request());

    expect(quotaCalls).toHaveLength(1);
    expect(quotaCalls[0]).toMatchObject({
      userId: "waiver-user-1",
      requestIp: null,
    });
  });

  test("derives the same quota identity for an exact HTTP replay", async () => {
    quotaBehavior = () => ({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
      replayed: false,
    });

    await POST(request());
    await POST(request());

    expect(quotaCalls).toHaveLength(2);
    expect(quotaCalls[0]).toBeObject();
    expect(quotaCalls[1]).toBeObject();
    expect(quotaCalls[0].requestKey).toMatch(/^[a-f0-9]{64}$/);
    expect(quotaCalls[0].requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(quotaCalls[0].requestKey).toBe(quotaCalls[1].requestKey);
    expect(quotaCalls[0].requestFingerprint).toBe(
      quotaCalls[1].requestFingerprint,
    );
  });

  test("rejects a body that does not match its pre-metered fingerprint before PDF parsing", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new File(["not the declared digest"], "waiver.pdf", {
        type: "application/pdf",
      }),
    );

    const response = await POST(request({}, formData));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Uploaded PDF did not match request metadata",
    });
    expect(events).toEqual(["auth", "quota", "formData"]);
    expect(pdfLoadCalls).toBe(0);
    expect(providerCalls).toBe(0);
  });
});
