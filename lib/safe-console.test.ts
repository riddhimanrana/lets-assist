import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { safeConsole } from "./safe-console";
import { logSignupDebug, summarizePostgrestError } from "./signup-diagnostics";
import { safeErrorAttributes } from "./log-privacy";

const restore: Array<() => void> = [];
function capture(level: "debug" | "error" | "info" | "log" | "warn") {
  const calls: unknown[][] = [];
  const spy = spyOn(console, level).mockImplementation((...args) => {
    calls.push(args);
  });
  restore.push(() => spy.mockRestore());
  return calls;
}
afterEach(() => {
  for (const reset of restore.splice(0)) reset();
});

describe("console privacy boundary", () => {
  test("known lock failures remain diagnosable without accepting arbitrary error text", () => {
    const calls = capture("error");
    for (const error_code of ["55P03", "40P01"]) {
      safeConsole.error("Error fetching profile:", { error_code });
      expect(calls.at(-1)).toEqual(["Error fetching profile:", { error_code }]);
    }
    safeConsole.error("Error fetching profile:", { error_code: "ALICE" });
    expect(calls.at(-1)).toEqual(["Error fetching profile:", {}]);
  });
  test("workbook failures preserve finite recovery facts without provider text", () => {
    const calls = capture("warn");
    safeConsole.warn("CSF workbook refresh unsettled", {
      failureCode: "publication_outcome_unknown",
      disposition: "unknown",
      elapsedMs: 123,
      message: "private@example.test",
      workbookId: "private-workbook",
    });
    expect(calls).toEqual([
      [
        "CSF workbook refresh unsettled",
        {
          failureCode: "publication_outcome_unknown",
          disposition: "unknown",
          elapsedMs: 123,
        },
      ],
    ]);
    for (const elapsedMs of [-1, Infinity, 1.5, 1_000_000_001]) {
      safeConsole.warn("CSF workbook refresh unsettled", {
        failureCode: "private@example.test",
        disposition: "private-provider-body",
        elapsedMs,
      });
      expect(calls.at(-1)).toEqual(["CSF workbook refresh unsettled", {}]);
    }
  });
  test("each level drops nested records, positional strings and provider messages", () => {
    for (const level of ["debug", "error", "info", "log", "warn"] as const) {
      const calls = capture(level);
      safeConsole[level]("Error fetching profile:", "private@example.test", {
        user_id: "11111111-1111-4111-8111-111111111111",
        response: { roster: ["Synthetic Student"] },
        message: "secret provider message",
        token: "private-secret-token",
        status: 503,
        outcome: "failed",
      });
      expect(calls).toEqual([
        ["Error fetching profile:", { status: 503, outcome: "failed" }],
      ]);
    }
  });
  test("unknown message bodies and malformed scalar fields cannot escape", () => {
    const calls = capture("error");
    safeConsole.error("private@example.test", {
      error_code: "private-secret",
      trace_id: "private-secret",
      status: Infinity,
      outcome: "private-secret",
    });
    expect(calls).toEqual([
      ["Unregistered application event", { unregistered_event: true }],
    ]);
  });
  test("Error fields keep only known error categories and codes", () => {
    const calls = capture("error");
    safeConsole.error(
      "Error fetching profile:",
      Object.assign(new TypeError("private@example.test"), {
        code: "23503",
        digest: "123456",
        private: "secret",
      }),
    );
    expect(calls).toEqual([
      [
        "Error fetching profile:",
        {
          error_kind: "TypeError",
          error_code: "23503",
          error_digest: "123456",
        },
      ],
    ]);
  });
  test("no Error or object accessor is evaluated", () => {
    const calls = capture("error");
    let reads = 0;
    const error = new Error("private");
    for (const key of ["name", "code", "digest", "message", "stack"])
      Object.defineProperty(error, key, {
        get: () => {
          reads++;
          return "23503";
        },
        configurable: true,
      });
    const object = Object.defineProperty({}, "status", {
      enumerable: true,
      get: () => {
        reads++;
        return 400;
      },
    });
    safeConsole.error("Error fetching profile:", error, object);
    safeErrorAttributes(error);
    expect(reads).toBe(0);
    expect(calls).toEqual([
      ["Error fetching profile:", { error_kind: "Error" }],
    ]);
  });
  test("logging failures never replace the domain outcome", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {
      throw new Error("sink unavailable");
    });
    restore.push(() => spy.mockRestore());
    expect(() => safeConsole.error("Error fetching profile:")).not.toThrow();
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("untrusted");
        },
      },
    );
    expect(() =>
      safeConsole.error("Error fetching profile:", hostile),
    ).not.toThrow();
  });
  test("webhook logs preserve bounded failure reasons without provider coordinates", () => {
    const calls = capture("error");
    safeConsole.error("CSF provider event was refused by the ledger.", {
      reasonCode: "immutable_replay_conflict",
      sqlstate: "23505",
      eventType: "email.bounced",
      providerEventId: "private-provider-id",
      organizationId: "private-tenant",
      reason: "private@example.test",
    });
    expect(calls).toEqual([
      [
        "CSF provider event was refused by the ledger.",
        {
          reasonCode: "immutable_replay_conflict",
          sqlstate: "23505",
          eventType: "email.bounced",
        },
      ],
    ]);
  });
  test("signup traces retain steps and capacity without people, submissions or provider text", () => {
    const calls = capture("debug");
    logSignupDebug(
      "11111111-1111-4111-8111-111111111111",
      "blocked_slot_full",
      {
        userId: "private-user",
        projectId: "private-project",
        currentSignups: 5,
        maxVolunteers: 5,
        error: summarizePostgrestError({
          code: "23503",
          message: "private@example.test",
          details: "secret-row",
          hint: "secret",
        }),
      },
    );
    expect(calls).toEqual([
      [
        "Project signup diagnostic",
        {
          trace_id: "11111111-1111-4111-8111-111111111111",
          signup_step: "blocked_slot_full",
          slot_capacity: 5,
          active_count: 5,
          error_kind: "Error",
          error_code: "23503",
        },
      ],
    ]);
    logSignupDebug("private-user", "private@example.test", {
      status: "secret",
    });
    expect(calls.at(-1)).toEqual(["Project signup diagnostic", {}]);
  });
});
