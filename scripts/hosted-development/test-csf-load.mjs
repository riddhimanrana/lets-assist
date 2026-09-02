#!/usr/bin/env node

import { chromium } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

const PRODUCTION_PROJECT_REF = "fotdmeakexgrkronxlof";
const EXPECTED_ORIGIN = "https://dev.lets-assist.com";
const MEMBER_ACCOUNT = "student.2028@local.test";
const OFFICER_ACCOUNT = "csf.officer@local.test";
const MEMBER_SESSIONS = 90;
const OFFICER_SESSIONS = 10;
const DEFAULT_DURATION_MS = 15 * 60 * 1000;
const RAMP_DURATION_MS = 60_000;
const REQUEST_INTERVAL_MS = 10_000;
const SESSION_MINT_INTERVAL_MS = 10_500;
const SESSION_MINT_RETRY_MS = 10_000;
const SESSION_MINT_RETRY_LIMIT = 36;
const OIDC_REFRESH_BUFFER_MS = 60_000;
const BROWSER_WARMUP_SAMPLES = 5;
const BROWSER_MEASURED_SAMPLES = 30;
const BROWSER_TOTAL_SAMPLES = BROWSER_WARMUP_SAMPLES + BROWSER_MEASURED_SAMPLES;
const BROWSER_PAGE_SETTLE_MS = 3_000;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ];
}

function validateTarget() {
  const projectRef = required("EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF");
  if (
    !/^[a-z0-9]{20}$/u.test(projectRef) ||
    projectRef === PRODUCTION_PROJECT_REF
  ) {
    throw new Error(
      "The hosted load target must be a non-Production Supabase project.",
    );
  }
  const confirmation = required("CSF_HOSTED_LOAD_CONFIRMATION");
  if (confirmation !== `load-hosted-development:${projectRef}`) {
    throw new Error(
      "The hosted Development load confirmation is missing or does not match the target.",
    );
  }
  const appUrl = new URL(required("CSF_APP_URL"));
  if (appUrl.origin !== EXPECTED_ORIGIN || appUrl.pathname !== "/") {
    throw new Error(`CSF_APP_URL must be exactly ${EXPECTED_ORIGIN}/.`);
  }
  const password = required("CSF_LOCAL_TEST_PASSWORD");
  if (password.length < 16 || /[\r\n]/u.test(password)) {
    throw new Error("CSF_LOCAL_TEST_PASSWORD is malformed.");
  }
  const durationMs = Number(
    process.env.CSF_HOSTED_LOAD_DURATION_MS ?? DEFAULT_DURATION_MS,
  );
  if (!Number.isFinite(durationMs) || durationMs < DEFAULT_DURATION_MS) {
    throw new Error("Hosted load duration must be at least fifteen minutes.");
  }
  const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  const trustedOidcToken = process.env.VERCEL_TRUSTED_OIDC_TOKEN?.trim();
  const oidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL?.trim();
  const oidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN?.trim();
  if (Boolean(oidcRequestUrl) !== Boolean(oidcRequestToken)) {
    throw new Error("The GitHub OIDC request credentials are incomplete.");
  }
  if (!protectionBypass && !trustedOidcToken && !oidcRequestUrl) {
    throw new Error(
      "A Vercel automation bypass secret or trusted OIDC token is required.",
    );
  }
  const supabaseUrl = new URL(required("SUPABASE_URL"));
  if (
    supabaseUrl.origin !== `https://${projectRef}.supabase.co` ||
    supabaseUrl.pathname !== "/"
  ) {
    throw new Error("SUPABASE_URL does not match the Development project ref.");
  }
  const supabasePublishableKey = required("SUPABASE_PUBLISHABLE_KEY");
  return {
    appUrl,
    durationMs,
    password,
    projectRef,
    oidcRequestToken,
    oidcRequestUrl,
    protectionBypass,
    supabasePublishableKey,
    supabaseUrl,
    trustedOidcToken,
  };
}

function jwtExpirationMs(token) {
  const [, payload] = token.split(".");
  if (!payload) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    return Number.isFinite(parsed.exp) ? parsed.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function requestGitHubOidcToken({ requestToken, requestUrl }) {
  const endpoint = new URL(requestUrl);
  if (endpoint.protocol !== "https:") {
    throw new Error("The GitHub OIDC request URL must use HTTPS.");
  }
  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${requestToken}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error("GitHub did not issue a fresh OIDC token.");
  }
  const body = await response.json();
  if (typeof body.value !== "string" || body.value.length === 0) {
    throw new Error("GitHub returned a malformed OIDC token response.");
  }
  const expiresAt = jwtExpirationMs(body.value);
  if (expiresAt <= Date.now()) {
    throw new Error("GitHub returned an expired OIDC token.");
  }
  return { expiresAt, value: body.value };
}

function createVercelProtectionHeadersProvider({
  oidcRequestToken,
  oidcRequestUrl,
  protectionBypass,
  trustedOidcToken,
}) {
  if (protectionBypass) {
    return async () => ({ "x-vercel-protection-bypass": protectionBypass });
  }
  let cached = trustedOidcToken
    ? { expiresAt: jwtExpirationMs(trustedOidcToken), value: trustedOidcToken }
    : null;
  let refreshPromise = null;

  return async () => {
    const now = Date.now();
    if (cached && cached.expiresAt - now > OIDC_REFRESH_BUFFER_MS) {
      return { "x-vercel-trusted-oidc-idp-token": cached.value };
    }
    if (!oidcRequestUrl || !oidcRequestToken) {
      throw new Error("The trusted Vercel OIDC token expired during the run.");
    }
    if (!refreshPromise) {
      refreshPromise = requestGitHubOidcToken({
        requestToken: oidcRequestToken,
        requestUrl: oidcRequestUrl,
      });
    }
    try {
      cached = await refreshPromise;
    } finally {
      refreshPromise = null;
    }
    return { "x-vercel-trusted-oidc-idp-token": cached.value };
  };
}

function installVitalsObserver() {
  window.__csfLoadVitals = { cls: 0, inp: null, lcp: null };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const currentLcp = window.__csfLoadVitals.lcp;
      window.__csfLoadVitals.lcp =
        currentLcp === null
          ? entry.startTime
          : Math.max(currentLcp, entry.startTime);
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) window.__csfLoadVitals.cls += entry.value;
    }
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.interactionId) {
        const currentInp = window.__csfLoadVitals.inp;
        window.__csfLoadVitals.inp =
          currentInp === null
            ? entry.duration
            : Math.max(currentInp, entry.duration);
      }
    }
  }).observe({ type: "event", buffered: true, durationThreshold: 16 });
}

async function openAuthenticatedPage(
  context,
  appUrl,
  cookies,
  getProtectionHeaders,
) {
  await context.addCookies(
    cookies.map(({ name, value }) => ({
      name,
      value,
      url: appUrl.origin,
    })),
  );
  const page = await context.newPage();
  await page.route(`${appUrl.origin}/**`, async (route) => {
    const requestHeaders = await route.request().allHeaders();
    await route.continue({
      headers: {
        ...requestHeaders,
        ...(await getProtectionHeaders()),
      },
    });
  });
  await page.goto(new URL("/organization/dvhs-csf", appUrl).href, {
    waitUntil: "domcontentloaded",
  });
  const settledUrl = new URL(page.url());
  if (settledUrl.origin !== appUrl.origin) {
    throw new Error("Vercel protection rejected the hosted load request.");
  }
  if (settledUrl.pathname === "/login") {
    throw new Error("A minted fictional session was rejected by the app.");
  }
  return page;
}

function cookieHeader(cookies) {
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

function sessionIdFromAccessToken(accessToken) {
  const [, encodedPayload] = accessToken.split(".");
  if (!encodedPayload)
    throw new Error("A minted session returned a malformed JWT.");
  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8"),
  );
  if (
    typeof payload.session_id !== "string" ||
    !/^[0-9a-f-]{36}$/iu.test(payload.session_id)
  ) {
    throw new Error(
      "A minted session did not contain a valid session identity.",
    );
  }
  return payload.session_id;
}

async function mintSession({
  account,
  password,
  supabasePublishableKey,
  supabaseUrl,
}) {
  const cookieStore = new Map();
  const client = createServerClient(
    supabaseUrl.origin,
    supabasePublishableKey,
    {
      cookies: {
        getAll: () =>
          [...cookieStore].map(([name, value]) => ({ name, value })),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            if (value) cookieStore.set(name, value);
            else cookieStore.delete(name);
          }
        },
      },
    },
  );
  let session = null;
  for (let attempt = 0; attempt < SESSION_MINT_RETRY_LIMIT; attempt += 1) {
    const { data, error } = await client.auth.signInWithPassword({
      email: account,
      password,
    });
    if (!error && data.session) {
      session = data.session;
      break;
    }
    if (error?.status !== 429 || attempt + 1 >= SESSION_MINT_RETRY_LIMIT) {
      throw new Error(
        `Could not mint a fictional ${account === OFFICER_ACCOUNT ? "officer" : "member"} session.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, SESSION_MINT_RETRY_MS));
  }
  if (!session) throw new Error("A fictional session was not created.");
  const cookies = [...cookieStore].map(([name, value]) => ({ name, value }));
  if (cookies.length === 0) {
    throw new Error("A minted session did not persist its SSR cookies.");
  }
  return {
    cookie: cookieHeader(cookies),
    cookies,
    sessionId: sessionIdFromAccessToken(session.access_token),
  };
}

async function mintSessions({
  account,
  count,
  password,
  supabasePublishableKey,
  supabaseUrl,
}) {
  const sessions = [];
  for (let index = 0; index < count; index += 1) {
    sessions.push(
      await mintSession({
        account,
        password,
        supabasePublishableKey,
        supabaseUrl,
      }),
    );
    if (index + 1 < count) {
      await new Promise((resolve) =>
        setTimeout(resolve, SESSION_MINT_INTERVAL_MS),
      );
    }
  }
  const distinctSessionIds = new Set(
    sessions.map(({ sessionId }) => sessionId),
  );
  if (distinctSessionIds.size !== count) {
    throw new Error(
      "The hosted load did not mint one distinct auth session per user.",
    );
  }
  return sessions;
}

async function runRequestSessions({
  appUrl,
  durationMs,
  memberSessions,
  officerSessions,
  getProtectionHeaders,
}) {
  const memberPaths = [
    "/organization/dvhs-csf",
    "/organization/dvhs-csf?tab=csf-profile",
    "/organization/dvhs-csf?tab=csf-activities",
  ];
  const officerPaths = [
    "/organization/dvhs-csf?tab=csf-overview",
    "/organization/dvhs-csf?tab=csf-applications",
    "/organization/dvhs-csf?tab=csf-cohorts",
  ];
  const sessions = [
    ...memberSessions.map((session, index) => ({
      cookie: session.cookie,
      index,
      paths: memberPaths,
      role: "member",
    })),
    ...officerSessions.map((session, index) => ({
      cookie: session.cookie,
      index,
      paths: officerPaths,
      role: "officer",
    })),
  ];
  if (sessions.length !== MEMBER_SESSIONS + OFFICER_SESSIONS) {
    throw new Error(
      "The hosted load received the wrong authenticated session count.",
    );
  }
  const timings = [];
  let errors = 0;
  let fiveHundreds = 0;
  let requests = 0;
  await Promise.all(
    sessions.map(async (session, sessionIndex) => {
      const rampDelayMs =
        sessions.length === 1
          ? 0
          : Math.floor(
              (RAMP_DURATION_MS * sessionIndex) / (sessions.length - 1),
            );
      if (rampDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, rampDelayMs));
      }
      const sessionEndAt = Date.now() + durationMs;
      let cycle = 0;
      while (Date.now() < sessionEndAt) {
        const cycleStart = Date.now();
        const path =
          session.paths[(cycle + session.index) % session.paths.length];
        const startedAt = performance.now();
        try {
          const response = await fetch(new URL(path, appUrl), {
            headers: {
              accept: "text/html,application/xhtml+xml",
              cookie: session.cookie,
              "user-agent": `lets-assist-csf-hosted-load/${session.role}`,
              ...(await getProtectionHeaders()),
            },
            redirect: "follow",
            signal: AbortSignal.timeout(15_000),
          });
          await response.arrayBuffer();
          requests += 1;
          timings.push(performance.now() - startedAt);
          if (response.status >= 500) fiveHundreds += 1;
          if (!response.ok || new URL(response.url).pathname === "/login")
            errors += 1;
        } catch {
          requests += 1;
          errors += 1;
          timings.push(performance.now() - startedAt);
        }
        cycle += 1;
        const remaining = REQUEST_INTERVAL_MS - (Date.now() - cycleStart);
        if (remaining > 0 && Date.now() + remaining < sessionEndAt) {
          await new Promise((resolve) => setTimeout(resolve, remaining));
        }
      }
    }),
  );

  return { errors, fiveHundreds, requests, timings };
}

async function collectHeap(page, session) {
  await session.send("HeapProfiler.collectGarbage");
  const metrics = await session.send("Performance.getMetrics");
  return (
    metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ??
    0
  );
}

async function runBrowserAcceptance({ appUrl, memberPage, officerPage }) {
  const browserFailures = [];
  for (const page of [memberPage, officerPage]) {
    page.on("crash", () => browserFailures.push("renderer_crash"));
    page.on("pageerror", () => browserFailures.push("page_error"));
  }
  const memberSession = await memberPage.context().newCDPSession(memberPage);
  const officerSession = await officerPage.context().newCDPSession(officerPage);
  await memberSession.send("Performance.enable");
  await officerSession.send("Performance.enable");

  const memberPaths = [
    "/organization/dvhs-csf",
    "/organization/dvhs-csf?tab=csf-profile",
  ];
  const officerPaths = [
    "/organization/dvhs-csf?tab=csf-applications",
    "/organization/dvhs-csf?tab=csf-cohorts",
  ];
  const lcp = [];
  const inp = [];
  const cls = [];

  for (let index = 0; index < BROWSER_TOTAL_SAMPLES; index += 1) {
    const page = index % 2 === 0 ? memberPage : officerPage;
    const paths = index % 2 === 0 ? memberPaths : officerPaths;
    const roleSampleIndex = Math.floor(index / 2);
    await page.goto(
      new URL(paths[roleSampleIndex % paths.length], appUrl).href,
      {
        waitUntil: "domcontentloaded",
      },
    );
    // User input freezes the browser's LCP candidate set. Wait beyond the
    // acceptance threshold so a late largest render cannot disappear.
    await page.waitForTimeout(BROWSER_PAGE_SETTLE_MS);
    const vitals = await page.evaluate(() => window.__csfLoadVitals);
    if (index >= BROWSER_WARMUP_SAMPLES) {
      if (vitals.lcp !== null) lcp.push(vitals.lcp);
      cls.push(vitals.cls);
    }
  }

  const mutationTimings = [];
  let baselineHeap = null;
  // The staff-view switch below replaces the document, so its Event Timing
  // entry cannot survive the navigation. The officer tour changes local UI
  // state in one document and gives every INP sample a real rendered update.
  await officerPage.goto(
    new URL("/organization/dvhs-csf?tab=csf-overview&csf_tour=officer", appUrl)
      .href,
  );
  const officerTour = officerPage.getByRole("dialog", {
    name: "Officer workspace tour",
  });
  await officerTour.waitFor({ state: "visible", timeout: 60_000 });
  const tourStep = officerTour.locator('[aria-label^="Step "]');
  for (let index = 0; index < BROWSER_TOTAL_SAMPLES; index += 1) {
    const movingForward = index % 2 === 0;
    const tourControl = officerTour.getByRole("button", {
      exact: true,
      name: movingForward ? "Next" : "Back",
    });
    const previousStep = await tourStep.getAttribute("aria-label");
    if (!previousStep) {
      throw new Error("The fictional officer tour did not expose its step.");
    }
    await officerPage.evaluate(() => {
      window.__csfLoadVitals.inp = null;
    });
    await tourControl.click({ timeout: 60_000 });
    await officerPage.waitForFunction(
      (priorStep) =>
        document
          .querySelector('[role="dialog"][aria-label="Officer workspace tour"]')
          ?.querySelector('[aria-label^="Step "]')
          ?.getAttribute("aria-label") !== priorStep,
      previousStep,
      { timeout: 60_000 },
    );
    await officerPage.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    if (index >= BROWSER_WARMUP_SAMPLES) {
      const interactionInp = await officerPage.evaluate(
        // Event Timing clamps durationThreshold to 16 ms. No reported entry
        // after two paints therefore gets the conservative threshold value.
        () => window.__csfLoadVitals.inp ?? 16,
      );
      inp.push(interactionInp);
    }
  }

  await officerPage.goto(
    new URL("/organization/dvhs-csf?tab=csf-overview", appUrl).href,
  );
  for (let index = 0; index < BROWSER_TOTAL_SAMPLES; index += 1) {
    const switchButton = officerPage
      .locator('button[data-csf-view-switch-hydrated="true"]')
      .filter({ hasText: /^(Switch to CSF Officer view|View as member)$/u });
    await switchButton.waitFor({ state: "visible", timeout: 60_000 });
    const switchLabel = (await switchButton.textContent())?.trim();
    const movingToMember = switchLabel === "View as member";
    if (!movingToMember && switchLabel !== "Switch to CSF Officer view") {
      throw new Error("The fictional staff-view control has an unknown state.");
    }
    const destinationTab = movingToMember ? "csf-home" : "csf-overview";
    const startedAt = performance.now();
    await switchButton.click({ timeout: 60_000 });
    await officerPage
      .locator('button[data-csf-view-switch-hydrated="true"]')
      .filter({
        hasText: movingToMember
          ? "Switch to CSF Officer view"
          : "View as member",
      })
      .waitFor({ state: "visible", timeout: 60_000 });
    const settledTab = new URL(officerPage.url()).searchParams.get("tab");
    if (settledTab !== destinationTab) {
      throw new Error(
        "The fictional staff view did not reach its landing tab.",
      );
    }
    if (index >= BROWSER_WARMUP_SAMPLES) {
      mutationTimings.push(performance.now() - startedAt);
    }
    if (index === BROWSER_WARMUP_SAMPLES - 1) {
      baselineHeap =
        (await collectHeap(memberPage, memberSession)) +
        (await collectHeap(officerPage, officerSession));
    }
  }

  const finalHeap =
    (await collectHeap(memberPage, memberSession)) +
    (await collectHeap(officerPage, officerSession));
  const heapGrowth =
    baselineHeap && baselineHeap > 0
      ? (finalHeap - baselineHeap) / baselineHeap
      : null;

  return {
    baselineHeap,
    browserFailures,
    clsSampleCount: cls.length,
    clsP75: percentile(cls, 0.75),
    finalHeap,
    heapGrowth,
    inpSampleCount: inp.length,
    inpP75: percentile(inp, 0.75),
    lcpSampleCount: lcp.length,
    lcpP75Ms: percentile(lcp, 0.75),
    mutationP95Ms: percentile(mutationTimings, 0.95),
  };
}

async function main() {
  const target = validateTarget();
  const getProtectionHeaders = createVercelProtectionHeadersProvider(target);
  const memberSessions = await mintSessions({
    account: MEMBER_ACCOUNT,
    count: MEMBER_SESSIONS,
    password: target.password,
    supabasePublishableKey: target.supabasePublishableKey,
    supabaseUrl: target.supabaseUrl,
  });
  await new Promise((resolve) => setTimeout(resolve, SESSION_MINT_INTERVAL_MS));
  const officerSessions = await mintSessions({
    account: OFFICER_ACCOUNT,
    count: OFFICER_SESSIONS,
    password: target.password,
    supabasePublishableKey: target.supabasePublishableKey,
    supabaseUrl: target.supabaseUrl,
  });
  const allSessionIds = new Set(
    [...memberSessions, ...officerSessions].map(({ sessionId }) => sessionId),
  );
  if (allSessionIds.size !== MEMBER_SESSIONS + OFFICER_SESSIONS) {
    throw new Error("The hosted load reused an auth session between roles.");
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const memberContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const officerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await memberContext.addInitScript(installVitalsObserver);
    await officerContext.addInitScript(installVitalsObserver);
    const memberPage = await openAuthenticatedPage(
      memberContext,
      target.appUrl,
      memberSessions[0].cookies,
      getProtectionHeaders,
    );
    const officerPage = await openAuthenticatedPage(
      officerContext,
      target.appUrl,
      officerSessions[0].cookies,
      getProtectionHeaders,
    );

    const loadPromise = runRequestSessions({
      appUrl: target.appUrl,
      durationMs: target.durationMs,
      memberSessions,
      officerSessions,
      getProtectionHeaders,
    });
    await new Promise((resolve) => setTimeout(resolve, RAMP_DURATION_MS));
    const browserResult = await runBrowserAcceptance({
      appUrl: target.appUrl,
      memberPage,
      officerPage,
    });
    const load = await loadPromise;
    const result = {
      ok: true,
      environment: "hosted-development",
      fictionalAccounts: true,
      durationMs: target.durationMs,
      sessions: { members: MEMBER_SESSIONS, officers: OFFICER_SESSIONS },
      distinctAuthSessions: allSessionIds.size,
      requests: load.requests,
      readP95Ms: percentile(load.timings, 0.95),
      readP99Ms: percentile(load.timings, 0.99),
      mutationP95Ms: browserResult.mutationP95Ms,
      errorRate: load.requests ? load.errors / load.requests : 1,
      fiveHundredRate: load.requests ? load.fiveHundreds / load.requests : 1,
      lcpSampleCount: browserResult.lcpSampleCount,
      lcpP75Ms: browserResult.lcpP75Ms,
      inpSampleCount: browserResult.inpSampleCount,
      inpP75Ms: browserResult.inpP75,
      clsSampleCount: browserResult.clsSampleCount,
      clsP75: browserResult.clsP75,
      rendererCrashes: browserResult.browserFailures.filter(
        (failure) => failure === "renderer_crash",
      ).length,
      browserErrors: browserResult.browserFailures.length,
      baselineHeapBytes: browserResult.baselineHeap,
      finalHeapBytes: browserResult.finalHeap,
      retainedHeapGrowth: browserResult.heapGrowth,
    };
    result.ok =
      result.requests > 0 &&
      result.distinctAuthSessions === MEMBER_SESSIONS + OFFICER_SESSIONS &&
      result.readP95Ms <= 2_500 &&
      result.readP99Ms <= 5_000 &&
      result.mutationP95Ms <= 3_000 &&
      result.errorRate < 0.005 &&
      result.fiveHundredRate < 0.001 &&
      result.lcpSampleCount === BROWSER_MEASURED_SAMPLES &&
      result.lcpP75Ms < 2_500 &&
      result.inpSampleCount === BROWSER_MEASURED_SAMPLES &&
      result.inpP75Ms < 200 &&
      result.clsSampleCount === BROWSER_MEASURED_SAMPLES &&
      result.clsP75 < 0.1 &&
      result.rendererCrashes === 0 &&
      result.browserErrors === 0 &&
      result.retainedHeapGrowth !== null &&
      result.retainedHeapGrowth <= 0.2;
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
