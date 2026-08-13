import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Behavior of the content report service against recorded fakes: what it
 * refuses before any write, what it hands the single reviewed transaction, and
 * how it maps that transaction's outcomes.
 */

mock.module("server-only", () => ({}));

type TargetLookup = {
  data: { id: string } | null;
  error: { message: string } | null;
};

let targetLookups: Array<{ relation: string; id: string }> = [];
let targetResult: TargetLookup = { data: { id: "target" }, error: null };

let rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let rpcResult: { data: unknown; error: { message: string } | null } = {
  data: [
    {
      report_id: "30000000-0000-4000-8000-000000000001",
      replayed: false,
      allowed: true,
      reset_at: null,
    },
  ],
  error: null,
};

let loggedErrors: Array<{
  message: string;
  attributes?: Record<string, unknown>;
}> = [];

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (relation: string) => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: async () => {
            targetLookups.push({ relation, id });
            return targetResult;
          },
        }),
      }),
    }),
  }),
}));

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
  }),
}));

mock.module("@/lib/logger", () => ({
  logError: (
    message: string,
    _error: unknown,
    attributes?: Record<string, unknown>,
  ) => {
    loggedErrors.push({ message, attributes });
  },
  logInfo: () => {},
  flushLogs: async () => {},
}));

const { submitContentReport, CONTENT_REPORT_WINDOW_SECONDS } =
  await import("./content-report-service");
const { buildContentReportRequestKey } =
  await import("./content-report-submission");

const REPORTER_ID = "20000000-0000-4000-8000-000000000001";
const CONTENT_ID = "10000000-0000-4000-8000-000000000001";

const submission = {
  contentType: "project" as const,
  contentId: CONTENT_ID,
  reason: "spam" as const,
  description: "This project contains repeated promotional content.",
};

function headers(extra: Record<string, string> = {}) {
  return new Headers({ host: "lets-assist.com", ...extra });
}

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["NEXT_PUBLIC_SITE_URL", "VERCEL", "VERCEL_ENV", "VERCEL_URL"];

beforeEach(() => {
  targetLookups = [];
  targetResult = { data: { id: CONTENT_ID }, error: null };
  rpcCalls = [];
  rpcResult = {
    data: [
      {
        report_id: "30000000-0000-4000-8000-000000000001",
        replayed: false,
        allowed: true,
        reset_at: null,
      },
    ],
    error: null,
  };
  loggedErrors = [];
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.NEXT_PUBLIC_SITE_URL = "https://lets-assist.com";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("target authorization", () => {
  test("a resolvable target is looked up in the reporter's own session", async () => {
    const result = await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });

    expect(targetLookups).toEqual([{ relation: "projects", id: CONTENT_ID }]);
    expect(result).toEqual({
      status: "created",
      reportId: "30000000-0000-4000-8000-000000000001",
    });
  });

  test("profiles and organizations resolve to their own relations", async () => {
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission: { ...submission, contentType: "profile" },
      requestHeaders: headers(),
    });
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission: { ...submission, contentType: "organization" },
      requestHeaders: headers(),
    });

    expect(targetLookups.map((lookup) => lookup.relation)).toEqual([
      "profiles",
      "organizations",
    ]);
  });

  test("a target outside the reporter's visibility never becomes evidence", async () => {
    targetResult = { data: null, error: null };

    const result = await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });

    expect(result).toEqual({ status: "invalid_input" });
    expect(rpcCalls).toHaveLength(0);
  });

  test("target types the moderation queue cannot act on are refused without a lookup", async () => {
    for (const contentType of ["comment", "image", "other"] as const) {
      const result = await submitContentReport({
        reporterId: REPORTER_ID,
        submission: { ...submission, contentType },
        requestHeaders: headers(),
      });
      expect(result).toEqual({ status: "invalid_input" });
    }

    expect(targetLookups).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  test("a failed lookup fails closed instead of guessing", async () => {
    targetResult = { data: null, error: { message: "connection reset" } };

    const result = await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });

    expect(result).toEqual({ status: "unavailable" });
    expect(rpcCalls).toHaveLength(0);
    expect(JSON.stringify(loggedErrors)).not.toContain("connection reset");
  });
});

describe("trusted origin", () => {
  test("a same-origin report URL is stored as a relative path", async () => {
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission: {
        ...submission,
        url: "https://lets-assist.com/projects/abc?tab=details",
      },
      requestHeaders: headers(),
    });

    expect(rpcCalls[0]?.args.p_description).toContain(
      "\n\nContent URL: /projects/abc?tab=details",
    );
  });

  test("Host and X-Forwarded-Host cannot widen the trusted origin", async () => {
    const result = await submitContentReport({
      reporterId: REPORTER_ID,
      submission: { ...submission, url: "https://evil.test/projects/abc" },
      requestHeaders: headers({
        host: "evil.test",
        "x-forwarded-host": "evil.test",
      }),
    });

    expect(result).toEqual({ status: "invalid_input" });
    expect(rpcCalls).toHaveLength(0);
  });

  test("a deployment with no resolvable origin refuses the write", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.VERCEL = "1";

    const result = await submitContentReport({
      reporterId: REPORTER_ID,
      submission: { ...submission, url: "/projects/abc" },
      requestHeaders: headers(),
    });

    expect(result).toEqual({ status: "unavailable" });
    expect(rpcCalls).toHaveLength(0);
  });

  test("a loopback deployment accepts the loopback spelling the browser used", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";

    await submitContentReport({
      reporterId: REPORTER_ID,
      submission: { ...submission, url: "http://127.0.0.1:3000/projects/abc" },
      requestHeaders: headers({ host: "127.0.0.1:3000" }),
    });

    expect(rpcCalls[0]?.args.p_description).toContain(
      "\n\nContent URL: /projects/abc",
    );
  });
});

describe("transaction contract", () => {
  test("quota buckets are hashed and passed as one combined decision", async () => {
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
    });

    const args = rpcCalls[0]?.args as Record<string, unknown>;
    const keys = args.p_rate_limit_keys as string[];
    expect(rpcCalls[0]?.name).toBe("submit_content_report");
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^moderation:content-report:user:[0-9a-f]{64}$/u);
    expect(keys[1]).toMatch(/^moderation:content-report:ip:[0-9a-f]{64}$/u);
    expect(JSON.stringify(keys)).not.toContain(REPORTER_ID);
    expect(JSON.stringify(keys)).not.toContain("203.0.113.7");
    expect(args.p_rate_limit_limits).toEqual([10, 30]);
    expect(args.p_rate_limit_window_seconds).toBe(
      CONTENT_REPORT_WINDOW_SECONDS,
    );
  });

  test("the deterministic request key is what the transaction deduplicates on", async () => {
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });

    expect(rpcCalls[0]?.args.p_request_key).toBe(
      buildContentReportRequestKey({
        reporterId: REPORTER_ID,
        submission,
        normalizedUrl: undefined,
      }),
    );
  });

  test("moderation state is never sent from the application", async () => {
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });

    const args = rpcCalls[0]?.args as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual([
      "p_content_id",
      "p_content_type",
      "p_description",
      "p_rate_limit_keys",
      "p_rate_limit_limits",
      "p_rate_limit_window_seconds",
      "p_reason",
      "p_reporter_id",
      "p_request_key",
    ]);
  });

  test("a replayed submission is reported as a replay, not a new report", async () => {
    rpcResult = {
      data: [
        {
          report_id: "30000000-0000-4000-8000-000000000009",
          replayed: true,
          allowed: true,
          reset_at: null,
        },
      ],
      error: null,
    };

    expect(
      await submitContentReport({
        reporterId: REPORTER_ID,
        submission,
        requestHeaders: headers(),
      }),
    ).toEqual({
      status: "replayed",
      reportId: "30000000-0000-4000-8000-000000000009",
    });
  });

  test("a denied quota returns a bounded retry hint and no report", async () => {
    const now = new Date("2026-08-12T12:00:00.000Z");
    rpcResult = {
      data: [
        {
          report_id: null,
          replayed: false,
          allowed: false,
          reset_at: "2026-08-12T12:04:30.000Z",
        },
      ],
      error: null,
    };

    expect(
      await submitContentReport({
        reporterId: REPORTER_ID,
        submission,
        requestHeaders: headers(),
        now,
      }),
    ).toEqual({ status: "rate_limited", retryAfterSeconds: 270 });
  });

  test("an unusable reset time still yields a bounded retry hint", async () => {
    rpcResult = {
      data: [
        {
          report_id: null,
          replayed: false,
          allowed: false,
          reset_at: null,
        },
      ],
      error: null,
    };

    const result = await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });

    expect(result).toEqual({
      status: "rate_limited",
      retryAfterSeconds: CONTENT_REPORT_WINDOW_SECONDS,
    });
  });

  test("a transaction failure fails closed without leaking the database error", async () => {
    rpcResult = { data: null, error: { message: 'relation "secret" missing' } };

    const result = await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });

    expect(result).toEqual({ status: "unavailable" });
    expect(JSON.stringify(loggedErrors)).not.toContain("secret");
  });

  test("an allowed row without an identifier is treated as a failure", async () => {
    rpcResult = {
      data: [
        { report_id: null, replayed: false, allowed: true, reset_at: null },
      ],
      error: null,
    };

    expect(
      await submitContentReport({
        reporterId: REPORTER_ID,
        submission,
        requestHeaders: headers(),
      }),
    ).toEqual({ status: "unavailable" });
  });

  test("an empty transaction result is treated as a failure", async () => {
    rpcResult = { data: [], error: null };

    expect(
      await submitContentReport({
        reporterId: REPORTER_ID,
        submission,
        requestHeaders: headers(),
      }),
    ).toEqual({ status: "unavailable" });
  });
});
