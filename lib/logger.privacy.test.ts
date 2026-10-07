import { afterAll, describe, expect, mock, test } from "bun:test";
const emitted: unknown[] = [];
const flush = mock(async () => undefined);
mock.module("@/lib/otel-logger-provider", () => ({
  loggerProvider: {
    getLogger: () => ({ emit: (event: unknown) => emitted.push(event) }),
    forceFlush: flush,
  },
}));
const { logError, logInfo, flushLogs } = await import("./logger");
const { sanitizeLogRecord } = await import("./log-privacy");
const { telemetryRuntime } = await import("./telemetry-runtime");
afterAll(() => mock.restore());
describe("telemetry data boundary", () => {
  test("business conflict codes survive without exporting their private messages", () => {
    logError(
      "Failed to update Google spreadsheet values",
      { code: "PT409", message: "private-student-conflict-details" },
      { sqlstate: "PT409", error_message: "private-provider-body" },
    );
    expect(emitted.at(-1)).toMatchObject({
      attributes: { error_code: "PT409", sqlstate: "PT409" },
    });
    expect(JSON.stringify(emitted.at(-1))).not.toContain("private");
    for (const code of ["PT409 private-value", "PT400", "PT409\n"]) {
      expect(
        sanitizeLogRecord("Data export job completed", { error_code: code })
          .attributes,
      ).toEqual({});
    }
  });
  test("actual error emission excludes provider bodies, stack traces, people, URLs and arbitrary text", () => {
    const error = Object.assign(
      new Error(
        "Synthetic Student private@example.test token=capability-secret",
      ),
      { code: "23503" },
    );
    error.stack = "Error: private-stack-token\n at /private/path";
    logError("Failed to update Google spreadsheet values", error, {
      user_id: "private-user",
      title: "Private title",
      tab_name: "Private roster",
      range: "private-range",
      url: "https://example.test/?token=capability-secret",
      error_message: "private-provider-response",
      job_id: "11111111-1111-4111-8111-111111111111",
      rows_count: 4,
      status: 403,
    });
    const event = emitted.at(-1);
    expect(event).toMatchObject({
      body: "Failed to update Google spreadsheet values",
      attributes: {
        error_code: "23503",
        error_kind: "Error",
        job_id: "11111111-1111-4111-8111-111111111111",
        rows_count: 4,
        status: 403,
      },
    });
    expect(JSON.stringify(event)).not.toMatch(
      /private|Synthetic Student|Private|capability-secret/,
    );
  });
  test("unknown message bodies cannot smuggle arbitrary content into export", () => {
    logInfo("Student Synthetic private@example.test", {
      outcome: "private-token",
      transport: "resend",
    });
    expect(emitted.at(-1)).toMatchObject({
      body: "Unregistered application event",
      attributes: { unregistered_event: true, transport: "resend" },
    });
    expect(JSON.stringify(emitted.at(-1))).not.toMatch(/Student|private/);
  });
  test("unsafe values cannot impersonate approved attribute types", () => {
    const record = sanitizeLogRecord("Data export job completed", {
      rows_count: Infinity,
      status: "private",
      job_id: "private",
      error_digest: "private",
      constructor: "private",
      outcome: "accepted",
      replayed: true,
    });
    expect(record.attributes).toEqual({ outcome: "accepted", replayed: true });
  });
  test("explicit flush awaits the configured provider", async () => {
    await flushLogs();
    expect(flush).toHaveBeenCalledTimes(1);
  });
  test("only hosted Production enables telemetry and release labels are bounded", () => {
    for (const VERCEL_ENV of [undefined, "preview", "development"])
      expect(
        telemetryRuntime({ NODE_ENV: "production", VERCEL_ENV }).enabled,
      ).toBe(false);
    expect(
      telemetryRuntime({ NODE_ENV: "development", VERCEL_ENV: "production" })
        .enabled,
    ).toBe(false);
    const result = telemetryRuntime({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      LETS_ASSIST_BUILD_SHA: "a".repeat(40),
    });
    expect(result.enabled).toBe(true);
    expect(result.attributes["service.version"]).toBe("a".repeat(40));
    expect(
      telemetryRuntime({ LETS_ASSIST_BUILD_SHA: "private-untrusted-version" })
        .attributes["service.version"],
    ).toBe("unknown");
  });
});
