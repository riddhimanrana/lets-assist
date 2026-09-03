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
    expect(source).toContain("PRODUCTION_PROJECT_REF,");
    expect(source).toContain('from "./csf-load-fixture.mjs"');
    expect(source).toContain("load-hosted-development:${projectRef}");
    expect(source).toContain("projectRef === PRODUCTION_PROJECT_REF");
  });

  test("runs the required session mix for at least fifteen minutes", () => {
    expect(source).toContain("const MEMBER_SESSIONS = MEMBER_SESSION_COUNT");
    expect(source).toContain("const OFFICER_SESSIONS = OFFICER_SESSION_COUNT");
    expect(source).toContain("const DEFAULT_DURATION_MS = 15 * 60 * 1000");
    expect(source).toContain("const RAMP_DURATION_MS = 60_000");
    expect(source).toContain("const BROWSER_WARMUP_SAMPLES = 5");
    expect(source).toContain("const BROWSER_MEASURED_SAMPLES = 30");
    expect(source).toContain("const BROWSER_REVIEW_NAVIGATIONS = 25");
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
    expect(source).toContain("payload.sub");
    expect(source).toContain("distinctSessionIds.size !== accounts.length");
    expect(source).toContain("distinctUserIds.size !== accounts.length");
    expect(source).toContain("const accounts = buildSyntheticAccounts()");
    expect(source).toContain("const memberAccounts = accounts.members");
    expect(source).toContain("const officerAccounts = accounts.officers");
    expect(source).toContain("expectedAccount.authUserId.toLowerCase()");
    expect(source).toContain("payload.app_metadata?.fixture_role !== role");
    expect(source).not.toContain("_ACCOUNTS_JSON");
    expect(source).toContain(
      "result.distinctAuthIdentities === MEMBER_SESSIONS + OFFICER_SESSIONS",
    );
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
      "result.reviewNavigationCount === BROWSER_REVIEW_NAVIGATIONS",
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
    expect(source).toContain("const inpSupported =");
    expect(source).toContain(
      'PerformanceObserver.supportedEntryTypes.includes("event")',
    );
    expect(source).toContain(
      "window.__csfLoadVitals = { cls: 0, inp: null, inpSupported, lcp: null }",
    );
    expect(source).toContain("if (vitals.lcp !== null) lcp.push(vitals.lcp)");
    expect(source).toContain("if (index >= BROWSER_WARMUP_SAMPLES)");
    expect(source).toContain("lcpSampleCount: lcp.length");
    expect(source).toContain("inpSampleCount: inp.length");
    expect(source).toContain(
      'fixtureOrganizationPath("?tab=csf-overview&csf_tour=officer")',
    );
    expect(source).not.toContain("/organization/dvhs-csf");
    expect(source).toContain('name: "Officer workspace tour"');
    expect(source).toContain("exact: true");
    expect(source).toContain('name: movingForward ? "Next" : "Back"');
    expect(source).toContain("window.__csfLoadVitals.inp = null");
    expect(source).toContain(
      "requestAnimationFrame(() => requestAnimationFrame(resolve))",
    );
    expect(source).toContain("BROWSER_INP_SAMPLE_TIMEOUT_MS");
    expect(source).toContain("window.__csfLoadVitals.inp !== null");
    expect(source).toContain("window.__csfLoadVitals.inpSupported === false");
    expect(source).toContain("if (interactionVitals.inp !== null)");
    expect(source).toContain("inp.push(interactionVitals.inp)");
    expect(source).toContain("inpSupported: browserResult.inpSupported");
    expect(source).toContain("result.inpSupported === true");
    expect(source).not.toContain("window.__csfLoadVitals.inp ?? 16");
    const officerTourIndex = source.indexOf("const officerTour =");
    const interactionSampleIndex = source.indexOf(
      "inp.push(interactionVitals.inp)",
    );
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
    expect(source).toContain("selectedReviewDigest");
    expect(source).toContain('page.on("console"');
    expect(source).toContain('page.on("requestfailed"');
    expect(source).toContain('page.on("response"');
    expect(source).toContain('browserFailures.push("console_error")');
    expect(source).toContain('browserFailures.push("request_failed")');
    expect(source).toContain('browserFailures.push("http_5xx")');
    expect(source).toContain('name: "Next subject"');
    expect(source).toContain('name: "Previous subject"');
    expect(source).toContain(
      "for (let index = 0; index < BROWSER_REVIEW_NAVIGATIONS; index += 1)",
    );
    expect(source).toContain("reviewDigest === previousDigest");
    expect(source).toContain("index === 1");
    expect(source).toContain(
      "reviewNavigationCount: BROWSER_REVIEW_NAVIGATIONS",
    );
    expect(source).toContain("VERCEL_AUTOMATION_BYPASS_SECRET?.trim()");
    expect(source).not.toContain("VERCEL_TRUSTED_OIDC_TOKEN");
    expect(source).not.toContain("ACTIONS_ID_TOKEN_REQUEST_URL");
    expect(source).not.toContain("x-vercel-trusted-oidc-idp-token");
    expect(source).toContain('required("SUPABASE_PUBLISHABLE_KEY")');
    expect(source).toContain('"x-vercel-protection-bypass"');
    expect(source).toContain(
      'import { requestVercelBypassCookie } from "./vercel-bypass-cookie.mjs"',
    );
    expect(source).toContain(
      "const bypassCookie = await requestVercelBypassCookie",
    );
    expect(source).toContain('page.route("**/*"');
    expect(source).toContain("await route.continue()");
    expect(source).not.toContain("route.continue({");
    expect(source).toContain("settledUrl.origin !== appUrl.origin");
    expect(source).toContain('redirect: "manual"');
    expect(source).toContain("response.status >= 300");
    expect(source).toContain("assertFixtureLocation(response.url, appUrl)");
    expect(source).toContain("request.isNavigationRequest()");
    expect(source).toContain('request.resourceType() === "document"');
    expect(source).toContain('await route.abort("blockedbyclient")');
    expect(source).toContain("location.pathname !== fixtureOrganizationPath()");
    expect(
      source.match(/assertFixtureLocation\(/gu)?.length ?? 0,
    ).toBeGreaterThanOrEqual(10);
    expect(source).toContain(
      "Vercel protection rejected the hosted load request.",
    );
    expect(source).not.toContain("route.request().headers()");
    expect(source).not.toContain("extraHTTPHeaders");
  });

  test("publishes exact-SHA acceptance only from the trusted Development workflow", () => {
    expect(workflow).not.toContain("id-token: write");
    expect(workflow).toContain("statuses: write");
    const workflowPermissions = workflow.slice(
      workflow.indexOf("permissions:"),
      workflow.indexOf("jobs:"),
    );
    expect(workflowPermissions).toContain("contents: read");
    expect(workflowPermissions).not.toContain("checks: read");
    expect(workflowPermissions).not.toContain("statuses: write");
    const hostedJob = workflow.slice(workflow.indexOf("  hosted-acceptance:"));
    expect(hostedJob).toContain("    permissions:\n      checks: read");
    expect(hostedJob).toContain("      statuses: write");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("isDevelopmentReleaseCommitMessage");
    expect(workflow).toContain("needs: release-selection");
    expect(workflow).toContain("environment: development");
    expect(workflow).not.toContain("core.getIDToken()");
    expect(workflow).not.toContain("VERCEL_TRUSTED_OIDC_TOKEN");
    expect(workflow).toContain("bun run csf:test:hosted:load");
    expect(workflow).toContain("csf-hosted-development-acceptance");
    expect(workflow).toContain("commits/${ACCEPTED_SHA}/status");
    expect(workflow).toContain('.context == "Vercel" and .state == "success"');
    expect(workflow).toContain(
      "commits/${ACCEPTED_SHA}/check-runs?filter=latest&per_page=100",
    );
    expect(workflow).toContain('.name == "Supabase Preview"');
    expect(workflow).toContain('.app.slug == "supabase"');
    expect(workflow).toContain(
      'expected_details_url="https://supabase.com/dashboard/project/${DEVELOPMENT_PROJECT_REF}"',
    );
    expect(workflow).toContain('[[ -z "${DEVELOPMENT_PROJECT_REF:-}" ]]');
    expect(workflow).toContain(".details_url == $expected_details_url");
    expect(workflow).toContain(
      '.status == "completed" and .conclusion == "success"',
    );
    expect(workflow).not.toContain("secrets.VERCEL_TOKEN");
    expect(workflow).not.toContain("vars.VERCEL_TEAM_ID");
    expect(workflow).not.toContain("vars.VERCEL_ROOT_PROJECT_ID");
    expect(aliasVerifier).toContain("https://dev.lets-assist.com/api/status");
    expect(aliasVerifier).not.toContain("https://api.vercel.com");
    expect(aliasVerifier).toContain("--connect-timeout 10");
    expect(aliasVerifier).toContain("--max-time 30");
    expect(aliasVerifier).toContain("--max-redirs 0");
    expect(aliasVerifier).not.toContain("--location");
    expect(aliasVerifier).toContain("x-vercel-protection-bypass");
    expect(aliasVerifier).toContain('.environment == "preview"');
    expect(aliasVerifier).toContain(".version == $sha");
    expect(aliasVerifier).toContain("select(.critical == true)");
    expect(aliasVerifier).toContain('all(.state == "pass")');
    expect(workflow.match(/verify-vercel-alias\.sh/g) ?? []).toHaveLength(2);
    const supabaseCheckIndex = workflow.indexOf(
      "Require successful Supabase Development preview for the SHA",
    );
    const hostedRunIndex = workflow.indexOf("bun run csf:test:hosted:load");
    const firstAliasCheckIndex = workflow.indexOf("verify-vercel-alias.sh");
    const secondAliasCheckIndex = workflow.lastIndexOf(
      "verify-vercel-alias.sh",
    );
    expect(supabaseCheckIndex).toBeGreaterThan(
      workflow.indexOf("Require successful Vercel deployment for the SHA"),
    );
    expect(supabaseCheckIndex).toBeLessThan(firstAliasCheckIndex);
    expect(firstAliasCheckIndex).toBeLessThan(hostedRunIndex);
    expect(secondAliasCheckIndex).toBeGreaterThan(hostedRunIndex);
    expect(secondAliasCheckIndex).toBeLessThan(
      workflow.indexOf("Recheck Development head"),
    );
    expect(workflow).toContain('git rev-parse "origin/development"');
    expect(workflow).toContain("state=success");
    expect(workflow).toContain("state=failure");
    expect(workflow).toContain("timeout-minutes: 75");
    expect(workflow).not.toContain("CSF_HOSTED_LOAD_MEMBER_ACCOUNTS_JSON");
    expect(workflow).not.toContain("CSF_HOSTED_LOAD_OFFICER_ACCOUNTS_JSON");

    const provisionStepStart = workflow.indexOf(
      "- name: Provision the fixed synthetic CSF fixture",
    );
    const preflightStepStart = workflow.indexOf(
      "- name: Preflight hosted acceptance configuration",
    );
    const provisionStepEnd = workflow.indexOf(
      "- name: Install Playwright Chromium",
      provisionStepStart,
    );
    const provisionStep = workflow.slice(provisionStepStart, provisionStepEnd);
    expect(provisionStepStart).toBeGreaterThan(-1);
    expect(provisionStep).toContain(
      "bun run csf:provision:hosted:load-fixtures",
    );
    expect(preflightStepStart).toBeGreaterThan(-1);
    expect(preflightStepStart).toBeLessThan(provisionStepStart);
    expect(workflow.slice(preflightStepStart, provisionStepStart)).toContain(
      "HAS_LOAD_PASSWORD",
    );
    expect(workflow.slice(preflightStepStart, provisionStepStart)).toContain(
      "HAS_PUBLISHABLE_KEY",
    );
    expect(workflow.slice(preflightStepStart, provisionStepStart)).toContain(
      "HAS_SERVICE_ROLE_KEY",
    );
    expect(workflow.slice(preflightStepStart, provisionStepStart)).toContain(
      "HAS_VERCEL_BYPASS",
    );
    expect(provisionStep).toContain(
      "SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}",
    );
    expect(provisionStep).toContain(
      "provision-hosted-development:${{ vars.CSF_DEVELOPMENT_SUPABASE_PROJECT_REF }}:csf-load-fixture",
    );

    const hostedLoadStepStart = workflow.indexOf(
      "- name: Run hosted CSF acceptance",
    );
    const hostedLoadStepEnd = workflow.indexOf(
      "- name: Verify the Development branch domain after acceptance",
      hostedLoadStepStart,
    );
    const hostedLoadStep = workflow.slice(
      hostedLoadStepStart,
      hostedLoadStepEnd,
    );
    expect(hostedLoadStep).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
    );
    expect(hostedLoadStep).toContain(
      '[[ -z "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]',
    );
    expect(
      workflow.match(
        /VERCEL_AUTOMATION_BYPASS_SECRET: \$\{\{ secrets\.VERCEL_AUTOMATION_BYPASS_SECRET \}\}/gu,
      ) ?? [],
    ).toHaveLength(3);
    expect(provisionStep).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(workflow.slice(0, provisionStepStart)).not.toContain(
      "SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}",
    );
    expect(workflow.slice(provisionStepEnd)).not.toContain(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
  });

  test("uses only known fictional accounts and emits count-only output", () => {
    expect(source).toContain('from "./csf-load-fixture.mjs"');
    expect(source).toContain('required("CSF_HOSTED_LOAD_PASSWORD")');
    expect(source).not.toContain("CSF_HOSTED_LOAD_MEMBER_ACCOUNTS_JSON");
    expect(source).not.toContain("CSF_HOSTED_LOAD_OFFICER_ACCOUNTS_JSON");
    expect(source).toContain("fictionalAccounts: true");
    expect(source).not.toContain("console.log(account)");
    expect(source).not.toContain("console.log(password)");
  });
});
