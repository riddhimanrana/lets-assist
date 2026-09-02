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
const aliasVerifier = readFileSync(
  new URL("./verify-vercel-alias.sh", import.meta.url),
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
    expect(source).toContain("const BROWSER_WARMUP_SAMPLES = 5");
    expect(source).toContain("const BROWSER_MEASURED_SAMPLES = 30");
    expect(source).toContain("const BROWSER_PAGE_SETTLE_MS = 3_000");
    expect(source).toContain("const SESSION_MINT_INTERVAL_MS = 10_500");
    expect(source).toContain("const SESSION_MINT_RETRY_LIMIT = 36");
    expect(source).toContain("durationMs < DEFAULT_DURATION_MS");
    expect(source).toContain("RAMP_DURATION_MS * sessionIndex");
    expect(source).toContain("const sessionEndAt = Date.now() + durationMs");
    expect(source).toContain("while (Date.now() < sessionEndAt)");
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
      "result.lcpSampleCount === BROWSER_MEASURED_SAMPLES",
      "result.lcpP75Ms < 2_500",
      "result.inpSampleCount === BROWSER_MEASURED_SAMPLES",
      "result.inpP75Ms < 200",
      "result.clsSampleCount === BROWSER_MEASURED_SAMPLES",
      "result.clsP75 < 0.1",
      "result.rendererCrashes === 0",
      "result.retainedHeapGrowth <= 0.2",
    ]) {
      expect(source).toContain(contract);
    }
    expect(source).toContain(
      "for (let index = 0; index < BROWSER_TOTAL_SAMPLES; index += 1)",
    );
    expect(source).toContain("const roleSampleIndex = Math.floor(index / 2)");
    expect(source).toContain("paths[roleSampleIndex % paths.length]");
    const memberPaths = ["csf-home", "csf-profile"];
    const officerPaths = ["csf-applications", "csf-cohorts"];
    const visited = new Set<string>();
    for (let index = 0; index < 8; index += 1) {
      const paths = index % 2 === 0 ? memberPaths : officerPaths;
      visited.add(paths[Math.floor(index / 2) % paths.length]);
    }
    expect(visited).toEqual(new Set([...memberPaths, ...officerPaths]));
    expect(source).toContain("waitForTimeout(BROWSER_PAGE_SETTLE_MS)");
    expect(source).not.toContain("waitForTimeout(750)");
    expect(source).not.toContain('page.keyboard.press("Tab")');
    expect(source).toContain(
      "window.__csfLoadVitals = { cls: 0, inp: null, lcp: null }",
    );
    expect(source).toContain("if (vitals.lcp !== null) lcp.push(vitals.lcp)");
    expect(source).toContain("if (index >= BROWSER_WARMUP_SAMPLES)");
    expect(source).toContain("lcpSampleCount: lcp.length");
    expect(source).toContain("inpSampleCount: inp.length");
    expect(source).toContain(
      '"/organization/dvhs-csf?tab=csf-overview&csf_tour=officer"',
    );
    expect(source).toContain('name: "Officer workspace tour"');
    expect(source).toContain("exact: true");
    expect(source).toContain('name: movingForward ? "Next" : "Back"');
    expect(source).toContain("window.__csfLoadVitals.inp = null");
    expect(source).toContain(
      "requestAnimationFrame(() => requestAnimationFrame(resolve))",
    );
    expect(source).toContain("window.__csfLoadVitals.inp ?? 16");
    expect(source).toContain("inp.push(interactionInp)");
    const officerTourIndex = source.indexOf("const officerTour =");
    const interactionSampleIndex = source.indexOf("inp.push(interactionInp)");
    const viewSwitchIndex = source.indexOf("const switchButton =");
    expect(officerTourIndex).toBeGreaterThan(-1);
    expect(interactionSampleIndex).toBeGreaterThan(officerTourIndex);
    expect(interactionSampleIndex).toBeLessThan(viewSwitchIndex);
    expect(source.slice(officerTourIndex, viewSwitchIndex)).toContain(
      "for (let index = 0; index < BROWSER_TOTAL_SAMPLES; index += 1)",
    );
    expect(
      source.slice(viewSwitchIndex, source.indexOf("const finalHeap =")),
    ).not.toContain("inp.push(");
    expect(source).toContain("clsSampleCount: cls.length");
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
    expect(workflow).toContain("[deploy-development]");
    expect(workflow).toContain("/codex/csf-integration-");
    expect(workflow).not.toContain("core.getIDToken()");
    expect(workflow).not.toContain("VERCEL_TRUSTED_OIDC_TOKEN");
    expect(workflow).toContain("bun run csf:test:hosted:load");
    expect(workflow).toContain("csf-hosted-development-acceptance");
    expect(workflow).toContain("commits/${ACCEPTED_SHA}/status");
    expect(workflow).toContain('.context == "Vercel" and .state == "success"');
    expect(workflow).not.toContain("commits/${ACCEPTED_SHA}/check-runs");
    expect(workflow).toContain("secrets.VERCEL_TOKEN");
    expect(workflow).toContain("vars.VERCEL_TEAM_ID");
    expect(workflow).toContain("vars.VERCEL_ROOT_PROJECT_ID");
    expect(aliasVerifier).toContain("https://api.vercel.com/v4/aliases");
    expect(aliasVerifier).toContain("https://api.vercel.com/v13/deployments/");
    expect(aliasVerifier).toContain('.readyState == "READY"');
    expect(aliasVerifier).toContain(".aliasAssigned == true");
    expect(aliasVerifier).toContain('.aliasAssigned | type) == "number"');
    expect(aliasVerifier).toContain(".projectId // .project.id");
    expect(aliasVerifier).toContain(".meta.githubCommitSha");
    expect(aliasVerifier).toContain(".gitSource.sha");
    expect(aliasVerifier).toContain(".meta.githubCommitRef");
    expect(aliasVerifier).toContain(".gitSource.ref");
    expect(workflow.match(/verify-vercel-alias\.sh/g) ?? []).toHaveLength(2);
    const hostedRunIndex = workflow.indexOf("bun run csf:test:hosted:load");
    const firstAliasCheckIndex = workflow.indexOf("verify-vercel-alias.sh");
    const secondAliasCheckIndex = workflow.lastIndexOf(
      "verify-vercel-alias.sh",
    );
    expect(firstAliasCheckIndex).toBeLessThan(hostedRunIndex);
    expect(secondAliasCheckIndex).toBeGreaterThan(hostedRunIndex);
    expect(secondAliasCheckIndex).toBeLessThan(
      workflow.indexOf("Recheck Development head"),
    );
    expect(workflow).toContain('git rev-parse "origin/development"');
    expect(workflow).toContain("state=success");
    expect(workflow).toContain("state=failure");
    expect(workflow).toContain("timeout-minutes: 75");
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
