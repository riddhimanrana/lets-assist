import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Behavior of the content report service against recorded fakes: what it
 * charges before it does any work, what it refuses before any write, what it
 * hands the single reviewed transaction, and how it maps that transaction's
 * outcomes.
 */

mock.module("server-only", () => ({}));

type TargetLookup = {
  data: { id: string } | null;
  error: { message: string } | null;
};

type RpcResponse = { data: unknown; error: { message: string } | null };

let targetLookups: Array<{ relation: string; id: string }> = [];
let targetResult: TargetLookup = { data: { id: "target" }, error: null };
let publicProfileLookups: string[] = [];
let publicProfileResult: TargetLookup = {
  data: { id: "target" },
  error: null,
};

let rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let attemptResult: RpcResponse;
let submitResult: RpcResponse;

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

mock.module("@/lib/profile/public", () => ({
  getPublicProfileById: async (id: string) => {
    publicProfileLookups.push(id);
    return publicProfileResult;
  },
}));

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return name === "consume_content_report_attempt"
        ? attemptResult
        : submitResult;
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

const {
  submitContentReport,
  CONTENT_REPORT_WINDOW_SECONDS,
  CONTENT_REPORT_ATTEMPT_WINDOW_SECONDS,
  CONTENT_REPORT_USER_ATTEMPT_LIMIT,
  CONTENT_REPORT_IP_ATTEMPT_LIMIT,
  CONTENT_REPORT_REPLAY_WINDOW_SECONDS,
} = await import("./content-report-service");
const { buildContentReportFingerprint } =
  await import("./content-report-submission");

const REPORTER_ID = "20000000-0000-4000-8000-000000000001";
const CONTENT_ID = "10000000-0000-4000-8000-000000000001";
const REPORT_ID = "30000000-0000-4000-8000-000000000001";

const submission = {
  contentType: "project" as const,
  contentId: CONTENT_ID,
  reason: "spam" as const,
  description: "This project contains repeated promotional content.",
};

function headers(extra: Record<string, string> = {}) {
  return new Headers({ host: "lets-assist.com", ...extra });
}

function submitCall() {
  return rpcCalls.find((call) => call.name === "submit_content_report");
}

function attemptCall() {
  return rpcCalls.find(
    (call) => call.name === "consume_content_report_attempt",
  );
}

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["NEXT_PUBLIC_SITE_URL", "VERCEL", "VERCEL_ENV", "VERCEL_URL"];

beforeEach(() => {
  targetLookups = [];
  targetResult = { data: { id: CONTENT_ID }, error: null };
  publicProfileLookups = [];
  publicProfileResult = { data: { id: CONTENT_ID }, error: null };
  rpcCalls = [];
  attemptResult = { data: [{ allowed: true, reset_at: null }], error: null };
  submitResult = {
    data: [{ outcome: "created", report_id: REPORT_ID, reset_at: null }],
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

describe("attempt metering", () => {
  test("the attempt ceiling is charged before any target work happens", async () => {
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers({ "x-forwarded-for": "203.0.113.7" }),
    });

    expect(rpcCalls[0]?.name).toBe("consume_content_report_attempt");
    const args = rpcCalls[0]?.args as Record<string, unknown>;
    const keys = args.p_rate_limit_keys as string[];
    expect(keys[0]).toMatch(
      /^moderation:content-report-attempt:user:[0-9a-f]{64}$/u,
    );
    expect(keys[1]).toMatch(
      /^moderation:content-report-attempt:ip:[0-9a-f]{64}$/u,
    );
    expect(JSON.stringify(keys)).not.toContain(REPORTER_ID);
    expect(JSON.stringify(keys)).not.toContain("203.0.113.7");
    expect(args.p_rate_limit_limits).toEqual([
      CONTENT_REPORT_USER_ATTEMPT_LIMIT,
      CONTENT_REPORT_IP_ATTEMPT_LIMIT,
    ]);
    expect(args.p_rate_limit_window_seconds).toBe(
      CONTENT_REPORT_ATTEMPT_WINDOW_SECONDS,
    );
  });

  test("the attempt ceiling is higher than the stored-report quota", async () => {
    const { CONTENT_REPORT_USER_LIMIT, CONTENT_REPORT_IP_LIMIT } =
      await import("./content-report-service");

    expect(CONTENT_REPORT_USER_ATTEMPT_LIMIT).toBeGreaterThan(
      CONTENT_REPORT_USER_LIMIT,
    );
    expect(CONTENT_REPORT_IP_ATTEMPT_LIMIT).toBeGreaterThan(
      CONTENT_REPORT_IP_LIMIT,
    );
  });

  test("an exhausted attempt ceiling stops the request before the target lookup", async () => {
    attemptResult = {
      data: [{ allowed: false, reset_at: "2026-08-12T12:04:30.000Z" }],
      error: null,
    };

    const result = await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
      now: new Date("2026-08-12T12:00:00.000Z"),
    });

    expect(result).toEqual({ status: "rate_limited", retryAfterSeconds: 270 });
    expect(targetLookups).toHaveLength(0);
    expect(submitCall()).toBeUndefined();
  });

  test("work that stores nothing still costs an attempt", async () => {
    // A forged target, a hostile location, and a replay all reach the meter
    // first. Each of them used to be free, which is what made an unbounded
    // grind against the auth and lookup path possible.
    targetResult = { data: null, error: null };
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });
    expect(attemptCall()).toBeDefined();

    rpcCalls = [];
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission: { ...submission, url: "javascript:alert(1)" },
      requestHeaders: headers(),
    });
    expect(attemptCall()).toBeDefined();

    rpcCalls = [];
    targetResult = { data: { id: CONTENT_ID }, error: null };
    submitResult = {
      data: [{ outcome: "replayed", report_id: REPORT_ID, reset_at: null }],
      error: null,
    };
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });
    expect(attemptCall()).toBeDefined();
  });

  test("a caller with no trusted address is metered on the user dimension alone", async () => {
    // Hashing the `unknown` sentinel would build one bucket that every
    // address-less caller shares, so one script could exhaust it for all of
    // them.
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });

    const attemptArgs = attemptCall()?.args as Record<string, unknown>;
    const submitArgs = submitCall()?.args as Record<string, unknown>;
    expect(attemptArgs.p_rate_limit_keys).toHaveLength(1);
    expect(attemptArgs.p_rate_limit_limits).toEqual([
      CONTENT_REPORT_USER_ATTEMPT_LIMIT,
    ]);
    expect(submitArgs.p_rate_limit_keys).toHaveLength(1);
    expect(JSON.stringify(rpcCalls)).not.toContain("unknown");
  });

  test("a metering outage fails closed rather than admitting the work", async () => {
    attemptResult = { data: null, error: { message: "connection reset" } };

    const result = await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });

    expect(result).toEqual({ status: "unavailable" });
    expect(targetLookups).toHaveLength(0);
    expect(submitCall()).toBeUndefined();
    expect(JSON.stringify(loggedErrors)).not.toContain("connection reset");
  });

  test("an unusable metering row fails closed", async () => {
    attemptResult = { data: [], error: null };

    expect(
      await submitContentReport({
        reporterId: REPORTER_ID,
        submission,
        requestHeaders: headers(),
      }),
    ).toEqual({ status: "unavailable" });
    expect(submitCall()).toBeUndefined();
  });
});

describe("target authorization", () => {
  test("a resolvable target is looked up in the reporter's own session", async () => {
    const result = await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });

    expect(targetLookups).toEqual([{ relation: "projects", id: CONTENT_ID }]);
    expect(result).toEqual({ status: "created", reportId: REPORT_ID });
  });

  test("profiles resolve through the reviewed public visibility boundary", async () => {
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission: { ...submission, contentType: "profile" },
      requestHeaders: headers(),
    });

    expect(publicProfileLookups).toEqual([CONTENT_ID]);
    expect(targetLookups).toHaveLength(0);
  });

  test("organizations resolve through the reporter session", async () => {
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission: { ...submission, contentType: "organization" },
      requestHeaders: headers(),
    });

    expect(targetLookups).toEqual([
      { relation: "organizations", id: CONTENT_ID },
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
    expect(submitCall()).toBeUndefined();
  });

  test("a target the transaction cannot find is a generic refusal", async () => {
    // The database repeats the existence check under its own lock. It says
    // only that the submission was invalid, and the service passes that on
    // without adding which relation was consulted.
    submitResult = {
      data: [{ outcome: "invalid_target", report_id: null, reset_at: null }],
      error: null,
    };

    const result = await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });

    expect(result).toEqual({ status: "invalid_input" });
    expect(loggedErrors).toHaveLength(0);
  });

  test("a failed lookup fails closed instead of guessing", async () => {
    targetResult = { data: null, error: { message: "connection reset" } };

    const result = await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });

    expect(result).toEqual({ status: "unavailable" });
    expect(submitCall()).toBeUndefined();
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

    expect(submitCall()?.args.p_description).toContain(
      "\n\nContent URL: /projects/abc?tab=details",
    );
  });

  test("a report filed from a preview alias still becomes a report", async () => {
    // The browser sends whatever origin it is on. A preview, branch, or custom
    // alias is not the configured origin, and refusing those turned every
    // report filed from one into a 400.
    for (const alias of [
      "https://lets-assist-git-feature.vercel.app/projects/abc",
      "https://staging.lets-assist.com/projects/abc",
      "http://lets-assist.com/projects/abc",
    ]) {
      rpcCalls = [];
      const result = await submitContentReport({
        reporterId: REPORTER_ID,
        submission: { ...submission, url: alias },
        requestHeaders: headers({ host: new URL(alias).host }),
      });

      expect(result).toEqual({ status: "created", reportId: REPORT_ID });
      expect(submitCall()?.args.p_description).not.toContain("Content URL:");
    }
  });

  test("Host and X-Forwarded-Host cannot widen the trusted origin", async () => {
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission: { ...submission, url: "https://evil.test/projects/abc" },
      requestHeaders: headers({
        host: "evil.test",
        "x-forwarded-host": "evil.test",
      }),
    });

    expect(submitCall()?.args.p_description).not.toContain("evil.test");
  });

  test("an unsafe location is still refused outright", async () => {
    const result = await submitContentReport({
      reporterId: REPORTER_ID,
      submission: { ...submission, url: "//evil.test/projects/abc" },
      requestHeaders: headers(),
    });

    expect(result).toEqual({ status: "invalid_input" });
    expect(submitCall()).toBeUndefined();
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
    expect(submitCall()).toBeUndefined();
  });

  test("a loopback deployment accepts the loopback spelling the browser used", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";

    await submitContentReport({
      reporterId: REPORTER_ID,
      submission: { ...submission, url: "http://127.0.0.1:3000/projects/abc" },
      requestHeaders: headers({ host: "127.0.0.1:3000" }),
    });

    expect(submitCall()?.args.p_description).toContain(
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

    const args = submitCall()?.args as Record<string, unknown>;
    const keys = args.p_rate_limit_keys as string[];
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

  test("attempt and stored-report quotas are separate buckets", async () => {
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers({ "x-forwarded-for": "203.0.113.7" }),
    });

    const attemptKeys = (attemptCall()?.args as Record<string, unknown>)
      .p_rate_limit_keys as string[];
    const reportKeys = (submitCall()?.args as Record<string, unknown>)
      .p_rate_limit_keys as string[];

    expect(new Set([...attemptKeys, ...reportKeys]).size).toBe(4);
  });

  test("the request fingerprint is what the transaction deduplicates on", async () => {
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });

    expect(submitCall()?.args.p_request_fingerprint).toBe(
      buildContentReportFingerprint({
        reporterId: REPORTER_ID,
        submission,
        normalizedUrl: undefined,
      }),
    );
  });

  test("the replay window is server-owned and bounded", async () => {
    await submitContentReport({
      reporterId: REPORTER_ID,
      submission: {
        ...submission,
        metadata: { reportedAt: "1999-01-01T00:00:00.000Z" },
      },
      requestHeaders: headers(),
    });

    expect(submitCall()?.args.p_replay_window_seconds).toBe(
      CONTENT_REPORT_REPLAY_WINDOW_SECONDS,
    );
    expect(CONTENT_REPORT_REPLAY_WINDOW_SECONDS).toBeGreaterThan(0);
    expect(CONTENT_REPORT_REPLAY_WINDOW_SECONDS).toBeLessThan(
      CONTENT_REPORT_WINDOW_SECONDS,
    );
    // The client clock is kept as context in the description, and is kept out
    // of the fingerprint that decides how long a retry replays.
    expect(submitCall()?.args.p_request_fingerprint).toBe(
      buildContentReportFingerprint({
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

    const args = submitCall()?.args as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual([
      "p_content_id",
      "p_content_type",
      "p_description",
      "p_rate_limit_keys",
      "p_rate_limit_limits",
      "p_rate_limit_window_seconds",
      "p_reason",
      "p_replay_window_seconds",
      "p_reporter_id",
      "p_request_fingerprint",
    ]);
  });

  test("a replayed submission is reported as a replay, not a new report", async () => {
    submitResult = {
      data: [
        {
          outcome: "replayed",
          report_id: "30000000-0000-4000-8000-000000000009",
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
    submitResult = {
      data: [
        {
          outcome: "rate_limited",
          report_id: null,
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
        now: new Date("2026-08-12T12:00:00.000Z"),
      }),
    ).toEqual({ status: "rate_limited", retryAfterSeconds: 270 });
  });

  test("a reset time already in the past still asks for at least a second", async () => {
    submitResult = {
      data: [
        {
          outcome: "rate_limited",
          report_id: null,
          reset_at: "2026-08-12T11:59:00.000Z",
        },
      ],
      error: null,
    };

    expect(
      await submitContentReport({
        reporterId: REPORTER_ID,
        submission,
        requestHeaders: headers(),
        now: new Date("2026-08-12T12:00:00.000Z"),
      }),
    ).toEqual({ status: "rate_limited", retryAfterSeconds: 1 });
  });

  test("a reset time beyond the window is clamped to the window", async () => {
    submitResult = {
      data: [
        {
          outcome: "rate_limited",
          report_id: null,
          reset_at: "2027-01-01T00:00:00.000Z",
        },
      ],
      error: null,
    };

    expect(
      await submitContentReport({
        reporterId: REPORTER_ID,
        submission,
        requestHeaders: headers(),
        now: new Date("2026-08-12T12:00:00.000Z"),
      }),
    ).toEqual({
      status: "rate_limited",
      retryAfterSeconds: CONTENT_REPORT_WINDOW_SECONDS,
    });
  });

  test("an unusable reset time still yields a bounded retry hint", async () => {
    submitResult = {
      data: [{ outcome: "rate_limited", report_id: null, reset_at: null }],
      error: null,
    };

    expect(
      await submitContentReport({
        reporterId: REPORTER_ID,
        submission,
        requestHeaders: headers(),
      }),
    ).toEqual({
      status: "rate_limited",
      retryAfterSeconds: CONTENT_REPORT_WINDOW_SECONDS,
    });
  });

  test("a transaction failure fails closed without leaking the database error", async () => {
    submitResult = {
      data: null,
      error: { message: 'relation "secret" missing' },
    };

    const result = await submitContentReport({
      reporterId: REPORTER_ID,
      submission,
      requestHeaders: headers(),
    });

    expect(result).toEqual({ status: "unavailable" });
    expect(JSON.stringify(loggedErrors)).not.toContain("secret");
  });

  test("a created outcome without an identifier is treated as a failure", async () => {
    submitResult = {
      data: [{ outcome: "created", report_id: null, reset_at: null }],
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

  test("an unrecognized outcome is treated as a failure", async () => {
    submitResult = {
      data: [
        { outcome: "something_new", report_id: REPORT_ID, reset_at: null },
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
    submitResult = { data: [], error: null };

    expect(
      await submitContentReport({
        reporterId: REPORTER_ID,
        submission,
        requestHeaders: headers(),
      }),
    ).toEqual({ status: "unavailable" });
  });
});
