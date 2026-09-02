import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./test-csf-load.mjs", import.meta.url),
  "utf8",
);
const workflow = readFileSync(
  new URL(
    "../../.github/workflows/csf-hosted-development-acceptance.yml",
    import.meta.url,
  ),
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
    expect(source).toContain("const RAMP_DURATION_MS = 60_000");
    expect(source).toContain("const SESSION_MINT_INTERVAL_MS = 10_500");
    expect(source).toContain("const SESSION_MINT_RETRY_LIMIT = 36");
    expect(source).toContain("durationMs < DEFAULT_DURATION_MS");
    expect(source).toContain("RAMP_DURATION_MS * sessionIndex");
    expect(source).toContain(
      "await new Promise((resolve) => setTimeout(resolve, RAMP_DURATION_MS))",
    );
    expect(source).toContain(
      'import { createServerClient } from "@supabase/ssr"',
    );
    expect(source).toContain("client.auth.signInWithPassword");
    expect(source).toContain("error?.status !== 429");
    expect(source).toContain("SESSION_MINT_RETRY_MS");
    expect(source).toContain("payload.session_id");
    expect(source).toContain("distinctSessionIds.size !== count");
    expect(source).toContain(
      "result.distinctAuthSessions === MEMBER_SESSIONS + OFFICER_SESSIONS",
    );
    expect(source).not.toContain("cookie: memberCookies");
    expect(source).not.toContain("cookie: officerCookies");
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
    expect(source).toContain('button[data-csf-view-switch-hydrated="true"]');
    expect(source).toContain("const destinationTab = movingToMember");
    expect(source).toContain("const settledTab = new URL(officerPage.url())");
    expect(source).toContain("settledTab !== destinationTab");
    expect(source).toContain(
      "The fictional staff view did not reach its landing tab.",
    );
    expect(source).not.toContain("waitForResponse(");
    expect(source).not.toContain("actionResponse");
    expect(source).toContain("baselineHeapBytes: browserResult.baselineHeap");
    expect(source).toContain("finalHeapBytes: browserResult.finalHeap");
    expect(source).toContain("VERCEL_AUTOMATION_BYPASS_SECRET?.trim()");
    expect(source).toContain("VERCEL_TRUSTED_OIDC_TOKEN?.trim()");
    expect(source).toContain("ACTIONS_ID_TOKEN_REQUEST_URL?.trim()");
    expect(source).toContain("ACTIONS_ID_TOKEN_REQUEST_TOKEN?.trim()");
    expect(source).toContain("requestGitHubOidcToken");
    expect(source).toContain("OIDC_REFRESH_BUFFER_MS");
    expect(source).toContain("if (!refreshPromise)");
    expect(source).toContain('required("SUPABASE_PUBLISHABLE_KEY")');
    expect(source).toContain('"x-vercel-protection-bypass"');
    expect(source).toContain('"x-vercel-trusted-oidc-idp-token"');
    expect(source).toContain("page.route(`${appUrl.origin}/**`");
    expect(source).toContain("await route.request().allHeaders()");
    expect(source).toContain("settledUrl.origin !== appUrl.origin");
    expect(source).toContain(
      "Vercel protection rejected the hosted load request.",
    );
    expect(source).not.toContain("route.request().headers()");
    expect(source).not.toContain("extraHTTPHeaders");
  });

  test("publishes exact-SHA acceptance only from the trusted Development workflow", () => {
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("statuses: write");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("[hosted-acceptance]");
    expect(workflow).not.toContain("core.getIDToken()");
    expect(workflow).not.toContain("VERCEL_TRUSTED_OIDC_TOKEN");
    expect(workflow).toContain("bun run csf:test:hosted:load");
    expect(workflow).toContain("csf-hosted-development-acceptance");
    expect(workflow).toContain("commits/${ACCEPTED_SHA}/status");
    expect(workflow).toContain('.context == "Vercel" and .state == "success"');
    expect(workflow).not.toContain("commits/${ACCEPTED_SHA}/check-runs");
    expect(workflow).toContain('git rev-parse "origin/development"');
    expect(workflow).toContain("state=success");
    expect(workflow).toContain("state=failure");
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
