import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./test-csf-load.mjs", import.meta.url),
  "utf8",
);

describe("hosted CSF load acceptance", () => {
  test("is pinned to the Development app and refuses the Production database", () => {
    expect(source).toContain(
      'const EXPECTED_ORIGIN = "https://dev.lets-assist.com"',
    );
    expect(source).toContain(
      'const PRODUCTION_PROJECT_REF = "fotdmeakexgrkronxlof"',
    );
    expect(source).toContain("load-hosted-development:${projectRef}");
    expect(source).toContain("projectRef === PRODUCTION_PROJECT_REF");
  });

  test("runs the required session mix for at least fifteen minutes", () => {
    expect(source).toContain("const MEMBER_SESSIONS = 90");
    expect(source).toContain("const OFFICER_SESSIONS = 10");
    expect(source).toContain("const DEFAULT_DURATION_MS = 15 * 60 * 1000");
    expect(source).toContain("durationMs < DEFAULT_DURATION_MS");
  });

  test("enforces route, browser, Web Vitals, and retained-heap limits", () => {
    for (const contract of [
      "result.readP95Ms <= 2_500",
      "result.readP99Ms <= 5_000",
      "result.mutationP95Ms <= 3_000",
      "result.errorRate < 0.005",
      "result.fiveHundredRate < 0.001",
      "result.lcpP75Ms < 2_500",
      "result.inpP75Ms < 200",
      "result.clsP75 < 0.1",
      "result.rendererCrashes === 0",
      "result.retainedHeapGrowth <= 0.2",
    ]) {
      expect(source).toContain(contract);
    }
    expect(source).toContain("for (let index = 0; index < 25; index += 1)");
    expect(source).toContain('request.method() === "POST"');
    expect(source).toContain(
      'new URL(response.url()).pathname === "/organization/dvhs-csf"',
    );
    expect(source).toContain("The fictional staff-view mutation returned");
    expect(source).toContain('required("VERCEL_AUTOMATION_BYPASS_SECRET")');
    expect(source).toContain('"x-vercel-protection-bypass"');
    expect(source).toContain("page.route(`${appUrl.origin}/**`");
    expect(source).not.toContain("extraHTTPHeaders");
  });

  test("uses only known fictional accounts and emits count-only output", () => {
    expect(source).toContain(
      'const MEMBER_ACCOUNT = "student.2028@local.test"',
    );
    expect(source).toContain(
      'const OFFICER_ACCOUNT = "csf.officer@local.test"',
    );
    expect(source).toContain("fictionalAccounts: true");
    expect(source).not.toContain("console.log(account)");
    expect(source).not.toContain("console.log(password)");
  });
});
