import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readHostedAttendanceTarget } from "./attendance-target";
import AttendanceReporter from "./attendance-reporter.mjs";

const ref = "abcdefghijklmnopqrst";
function settings() {
  return {
    ATTENDANCE_HOSTED_DEVELOPMENT: "1",
    ATTENDANCE_APP_URL: "https://dev.lets-assist.com/",
    ATTENDANCE_HOSTED_CONFIRMATION: `attendance-hosted-development:${ref}`,
    EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: ref,
    SUPABASE_URL: `https://${ref}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fictional_development_service_key",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fictional_development_public_key",
    VERCEL_AUTOMATION_BYPASS_SECRET: "fictional-development-bypass",
  };
}
const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("hosted attendance target", () => {
  test("accepts only an explicit Development target", () => {
    const target = readHostedAttendanceTarget(settings());
    expect(target.hosted).toBe(true);
    expect(target.appUrl).toBe("https://dev.lets-assist.com");
    expect(target.url).toBe(`https://${ref}.supabase.co`);
  });
  for (const key of Object.keys(settings())) {
    test(`refuses missing ${key}`, () => {
      const env: Record<string, string> = settings();
      delete env[key];
      expect(() => readHostedAttendanceTarget(env)).toThrow();
    });
  }
  for (const target of [
    "https://lets-assist.com/",
    "http://dev.lets-assist.com/",
    "https://dev.lets-assist.com.attacker.test/",
    "https://dev.lets-assist.com:443/",
    "https://secret@dev.lets-assist.com/",
    "https://dev.lets-assist.com/path",
    "https://dev.lets-assist.com/?token=secret",
    "https://dev.lets-assist.com/#secret",
    "http://localhost:3029/",
  ]) {
    test(`refuses noncanonical app target ${target}`, () => {
      expect(() =>
        readHostedAttendanceTarget({
          ...settings(),
          ATTENDANCE_APP_URL: target,
        }),
      ).toThrow();
    });
  }
  test("refuses Production even with matching confirmation and database", () => {
    const production = "fotdmeakexgrkronxlof";
    expect(() =>
      readHostedAttendanceTarget({
        ...settings(),
        EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: production,
        ATTENDANCE_HOSTED_CONFIRMATION: `attendance-hosted-development:${production}`,
        SUPABASE_URL: `https://${production}.supabase.co`,
      }),
    ).toThrow("Production");
  });
  for (const target of [
    "https://fotdmeakexgrkronxlof.supabase.co",
    "https://db.lets-assist.com",
    `http://${ref}.supabase.co`,
    `https://${ref}.supabase.co/path`,
    `https://${ref}.supabase.co?secret=token`,
    "https://otherprojectrefabcde.supabase.co",
  ]) {
    test(`refuses mismatched database ${target}`, () => {
      expect(() =>
        readHostedAttendanceTarget({ ...settings(), SUPABASE_URL: target }),
      ).toThrow();
    });
  }
  test("confirmation must match the exact project", () => {
    expect(() =>
      readHostedAttendanceTarget({
        ...settings(),
        ATTENDANCE_HOSTED_CONFIRMATION: "attendance-hosted-development:other",
      }),
    ).toThrow("confirmation");
  });
  test("legacy JWT keys must match the reviewed role and project", () => {
    const jwt = (role: string, project = ref) =>
      `e30.${Buffer.from(JSON.stringify({ role, ref: project })).toString("base64url")}.fixture`;
    expect(() =>
      readHostedAttendanceTarget({
        ...settings(),
        SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
      }),
    ).not.toThrow();
    for (const key of [
      jwt("anon"),
      jwt("service_role", "fotdmeakexgrkronxlof"),
      "malformed-secret",
    ])
      expect(() =>
        readHostedAttendanceTarget({
          ...settings(),
          SUPABASE_SERVICE_ROLE_KEY: key,
        }),
      ).toThrow();
    expect(() =>
      readHostedAttendanceTarget({
        ...settings(),
        SUPABASE_PUBLISHABLE_KEY: settings().SUPABASE_SERVICE_ROLE_KEY,
      }),
    ).toThrow();
  });
  test("local configuration still refuses hosted mode and requires its owned stack", () => {
    const config = source("../../playwright.attendance.config.ts");
    expect(config).toContain(
      "process.env.ATTENDANCE_HOSTED_DEVELOPMENT !== undefined",
    );
    expect(config).toContain('process.env.ATTENDANCE_EXISTING_SERVER !== "1"');
    expect(config).toContain("getCsfIsolatedSupabaseEnv()");
    const helper = source("../../tests/e2e/attendance/environment.ts");
    expect(helper).toContain("return readHostedAttendanceTarget()");
    expect(helper).toContain("...getCsfIsolatedSupabaseEnv()");
  });
  test("hosted configuration disables output capture and uses its guarded target", () => {
    const config = source("../../playwright.attendance-hosted.config.ts");
    expect(config).toContain("const target = readHostedAttendanceTarget()");
    expect(config).toContain("baseURL: target.appUrl");
    expect(config).toContain('preserveOutput: "never"');
    for (const option of ["trace", "video", "screenshot"])
      expect(config).toContain(`${option}: "off"`);
    const spec = source("../../tests/e2e/attendance/paper-attendance.spec.ts");
    expect(
      spec.match(/if \(!env.hosted\)\s+await page.screenshot/gu),
    ).toHaveLength(5);
    expect(spec).toContain(
      'throw new Error(\n        "Hosted attendance journey failed (ATTENDANCE_JOURNEY_FAILED)."',
    );
    expect(spec).not.toContain("storageState(");
    expect(spec).not.toContain("extraHTTPHeaders");
  });
});

test("hosted reporter drops token-bearing errors, streams, titles, and attachments", () => {
  const output: string[] = [];
  const reporter = new AttendanceReporter({}, (line: string) =>
    output.push(line),
  );
  const secret = "fixture-secret-not-for-output";
  const error = {
    message: `goto https://dev.lets-assist.com/anonymous/id?token=${secret}`,
    stack: secret,
  };
  const testCase = { title: secret };
  reporter.onBegin();
  reporter.onStdOut(secret);
  reporter.onStdErr(secret);
  reporter.onError(error);
  reporter.onTestEnd(testCase, {
    status: "failed",
    errors: [error],
    attachments: [{ path: secret }],
  });
  reporter.onEnd({ status: "failed" });
  expect(output.join("\n")).not.toContain(secret);
  expect(output.join("\n")).not.toContain("https:");
  expect(output.join("\n")).toContain("ATTENDANCE_JOURNEY_FAILED");
  reporter.onTestEnd(testCase, { status: "passed" });
  reporter.onEnd({ status: "passed" });
  expect(output.at(-1)).toBe("Hosted attendance acceptance passed.");
});
