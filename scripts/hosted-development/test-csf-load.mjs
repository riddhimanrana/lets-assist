#!/usr/bin/env node

import { chromium } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

import {
  buildSyntheticAccounts,
  FIXTURE_ORGANIZATION_HANDLE,
  FIXTURE_MARKER,
  fixtureOrganizationPath,
  MEMBER_SESSION_COUNT,
  OFFICER_SESSION_COUNT,
  PRODUCTION_PROJECT_REF,
} from "./csf-load-fixture.mjs";
import { requestVercelBypassCookie } from "./vercel-bypass-cookie.mjs";

const EXPECTED_ORIGIN = "https://dev.lets-assist.com";
const MEMBER_SESSIONS = MEMBER_SESSION_COUNT;
const OFFICER_SESSIONS = OFFICER_SESSION_COUNT;
const DEFAULT_DURATION_MS = 15 * 60 * 1000;
const RAMP_DURATION_MS = 60_000;
const REQUEST_INTERVAL_MS = 10_000;
const SESSION_MINT_INTERVAL_MS = 10_500;
const SESSION_MINT_RETRY_MS = 10_000;
const SESSION_MINT_RETRY_LIMIT = 36;
const BROWSER_WARMUP_SAMPLES = 5;
const BROWSER_MEASURED_SAMPLES = 30;
const BROWSER_TOTAL_SAMPLES = BROWSER_WARMUP_SAMPLES + BROWSER_MEASURED_SAMPLES;
const BROWSER_REVIEW_NAVIGATIONS = 25;
const BROWSER_PAGE_SETTLE_MS = 3_000;
const BROWSER_INP_SAMPLE_TIMEOUT_MS = 2_000;

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
  const password = required("CSF_HOSTED_LOAD_PASSWORD");
  if (password.length < 16 || /[\r\n]/u.test(password)) {
    throw new Error("CSF_HOSTED_LOAD_PASSWORD is malformed.");
  }
  const durationMs = Number(
    process.env.CSF_HOSTED_LOAD_DURATION_MS ?? DEFAULT_DURATION_MS,
  );
  if (!Number.isFinite(durationMs) || durationMs < DEFAULT_DURATION_MS) {
    throw new Error("Hosted load duration must be at least fifteen minutes.");
  }
  const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!protectionBypass || /[\r\n]/u.test(protectionBypass)) {
    throw new Error(
      "The Vercel automation bypass secret is missing or malformed.",
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
  const accounts = buildSyntheticAccounts();
  const memberAccounts = accounts.members;
  const officerAccounts = accounts.officers;
  if (
    new Set(
      [...memberAccounts, ...officerAccounts].map(({ authUserId }) =>
        authUserId.toLowerCase(),
      ),
    ).size !==
      MEMBER_SESSIONS + OFFICER_SESSIONS ||
    new Set(
      [...memberAccounts, ...officerAccounts].map(({ email }) =>
        email.toLowerCase(),
      ),
    ).size !==
      MEMBER_SESSIONS + OFFICER_SESSIONS
  ) {
    throw new Error("Hosted load fixture roles must use distinct accounts.");
  }
  return {
    appUrl,
    durationMs,
    memberAccounts,
    officerAccounts,
    password,
    projectRef,
    protectionBypass,
    supabasePublishableKey,
    supabaseUrl,
  };
}

function assertFixtureLocation(value, appUrl) {
  const location = new URL(value);
  if (
    location.origin !== appUrl.origin ||
    location.pathname !== fixtureOrganizationPath()
  ) {
    throw new Error("The hosted load left the synthetic organization route.");
  }
}

function createVercelProtectionHeadersProvider({ protectionBypass }) {
  return async () => ({ "x-vercel-protection-bypass": protectionBypass });
}

function installVitalsObserver() {
  const inpSupported =
    PerformanceObserver.supportedEntryTypes.includes("event");
  window.__csfLoadVitals = { cls: 0, inp: null, inpSupported, lcp: null };
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
  if (inpSupported) {
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
}

async function openAuthenticatedPage(
  context,
  appUrl,
  cookies,
  protectionBypass,
) {
  const bypassCookie = await requestVercelBypassCookie({
    appUrl,
    path: fixtureOrganizationPath(),
    protectionBypass,
  });
  await context.addCookies([
    ...cookies.map(({ name, value }) => ({
      name,
      value,
      url: appUrl.origin,
    })),
    bypassCookie,
  ]);
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (
      request.isNavigationRequest() &&
      request.resourceType() === "document"
    ) {
      try {
        assertFixtureLocation(request.url(), appUrl);
      } catch {
        await route.abort("blockedbyclient");
        return;
      }
    }
    await route.continue();
  });
  await page.goto(new URL(fixtureOrganizationPath(), appUrl).href, {
    waitUntil: "domcontentloaded",
  });
  const settledUrl = new URL(page.url());
  if (settledUrl.origin !== appUrl.origin) {
    throw new Error("Vercel protection rejected the hosted load request.");
  }
  if (settledUrl.pathname === "/login") {
    throw new Error("A minted fictional session was rejected by the app.");
  }
  assertFixtureLocation(settledUrl, appUrl);
  return page;
}

function cookieHeader(cookies) {
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

function sessionIdentityFromAccessToken(accessToken, expectedAccount, role) {
  const [, encodedPayload] = accessToken.split(".");
  if (!encodedPayload)
    throw new Error("A minted session returned a malformed JWT.");
  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8"),
  );
  if (
    typeof payload.sub !== "string" ||
    !/^[0-9a-f-]{36}$/iu.test(payload.sub) ||
    typeof payload.session_id !== "string" ||
    !/^[0-9a-f-]{36}$/iu.test(payload.session_id)
  ) {
    throw new Error(
      "A minted session did not contain valid user and session identities.",
    );
  }
  if (
    payload.sub.toLowerCase() !== expectedAccount.authUserId.toLowerCase() ||
    payload.app_metadata?.csf_hosted_load_fixture !== true ||
    payload.app_metadata?.organization_handle !== FIXTURE_ORGANIZATION_HANDLE ||
    payload.app_metadata?.fixture_role !== role ||
    payload.app_metadata?.fixture_contract !== FIXTURE_MARKER
  ) {
    throw new Error(
      "A minted session does not belong to the synthetic fixture.",
    );
  }
  return { sessionId: payload.session_id, userId: payload.sub };
}

async function mintSession({
  account,
  password,
  role,
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
      email: account.email,
      password,
    });
    if (!error && data.session) {
      session = data.session;
      break;
    }
    if (error?.status !== 429 || attempt + 1 >= SESSION_MINT_RETRY_LIMIT) {
      throw new Error(`Could not mint a fictional ${role} session.`);
    }
    await new Promise((resolve) => setTimeout(resolve, SESSION_MINT_RETRY_MS));
  }
  if (!session) throw new Error("A fictional session was not created.");
  const cookies = [...cookieStore].map(([name, value]) => ({ name, value }));
  if (cookies.length === 0) {
    throw new Error("A minted session did not persist its SSR cookies.");
  }
  const identity = sessionIdentityFromAccessToken(
    session.access_token,
    account,
    role,
  );
  return {
    cookie: cookieHeader(cookies),
    cookies,
    ...identity,
  };
}

async function mintSessions({
  accounts,
  password,
  role,
  supabasePublishableKey,
  supabaseUrl,
}) {
  const sessions = [];
  for (let index = 0; index < accounts.length; index += 1) {
    sessions.push(
      await mintSession({
        account: accounts[index],
        password,
        role,
        supabasePublishableKey,
        supabaseUrl,
      }),
    );
    if (index + 1 < accounts.length) {
      await new Promise((resolve) =>
        setTimeout(resolve, SESSION_MINT_INTERVAL_MS),
      );
    }
  }
  const distinctSessionIds = new Set(
    sessions.map(({ sessionId }) => sessionId),
  );
  const distinctUserIds = new Set(sessions.map(({ userId }) => userId));
  if (
    distinctSessionIds.size !== accounts.length ||
    distinctUserIds.size !== accounts.length
  ) {
    throw new Error(
      "The hosted load did not mint one distinct auth identity and session per account.",
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
    fixtureOrganizationPath(),
    fixtureOrganizationPath("?tab=csf-profile"),
    fixtureOrganizationPath("?tab=csf-activities"),
  ];
  const officerPaths = [
    fixtureOrganizationPath("?tab=csf-overview"),
    fixtureOrganizationPath("?tab=csf-applications"),
    fixtureOrganizationPath("?tab=csf-cohorts"),
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
            redirect: "manual",
            signal: AbortSignal.timeout(15_000),
          });
          await response.arrayBuffer();
          assertFixtureLocation(response.url, appUrl);
          requests += 1;
          timings.push(performance.now() - startedAt);
          if (response.status >= 500) fiveHundreds += 1;
          if (
            !response.ok ||
            (response.status >= 300 && response.status < 400)
          ) {
            errors += 1;
          }
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

async function selectedReviewDigest(nextButton) {
  return nextButton.evaluate(async (button) => {
    const queue = button.closest("[aria-busy]");
    const panelText = queue?.children.item(1)?.textContent?.trim() ?? "";
    if (!panelText) return "";
    const bytes = new TextEncoder().encode(panelText);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
  });
}

function isExpectedNavigationAbort(request) {
  return request.failure()?.errorText === "net::ERR_ABORTED";
}

function countBrowserFailures(failures) {
  return Object.fromEntries(
    [
      "renderer_crash",
      "page_error",
      "console_error",
      "request_failed",
      "http_5xx",
    ].map((kind) => [
      kind,
      failures.filter((failure) => failure === kind).length,
    ]),
  );
}

async function runBrowserAcceptance({ appUrl, memberPage, officerPage }) {
  const browserFailures = [];
  for (const page of [memberPage, officerPage]) {
    page.on("crash", () => browserFailures.push("renderer_crash"));
    page.on("pageerror", () => browserFailures.push("page_error"));
    page.on("console", (message) => {
      if (message.type() === "error") browserFailures.push("console_error");
    });
    page.on("requestfailed", (request) => {
      if (!isExpectedNavigationAbort(request)) {
        browserFailures.push("request_failed");
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 500) browserFailures.push("http_5xx");
    });
  }
  const memberSession = await memberPage.context().newCDPSession(memberPage);
  const officerSession = await officerPage.context().newCDPSession(officerPage);
  await memberSession.send("Performance.enable");
  await officerSession.send("Performance.enable");

  const memberPaths = [
    fixtureOrganizationPath(),
    fixtureOrganizationPath("?tab=csf-profile"),
  ];
  const officerPaths = [
    fixtureOrganizationPath("?tab=csf-applications"),
    fixtureOrganizationPath("?tab=csf-cohorts"),
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
    assertFixtureLocation(page.url(), appUrl);
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
    new URL(
      fixtureOrganizationPath("?tab=csf-overview&csf_tour=officer"),
      appUrl,
    ).href,
  );
  assertFixtureLocation(officerPage.url(), appUrl);
  const inpSupported = await officerPage.evaluate(
    () => window.__csfLoadVitals.inpSupported,
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
    await officerPage
      .waitForFunction(
        () =>
          window.__csfLoadVitals.inp !== null ||
          window.__csfLoadVitals.inpSupported === false,
        undefined,
        { timeout: BROWSER_INP_SAMPLE_TIMEOUT_MS },
      )
      .catch(() => null);
    if (index >= BROWSER_WARMUP_SAMPLES) {
      const interactionVitals = await officerPage.evaluate(
        () => window.__csfLoadVitals,
      );
      if (interactionVitals.inp !== null) {
        inp.push(interactionVitals.inp);
      }
    }
  }

  await officerPage.goto(
    new URL(fixtureOrganizationPath("?tab=csf-overview"), appUrl).href,
  );
  assertFixtureLocation(officerPage.url(), appUrl);
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
    assertFixtureLocation(officerPage.url(), appUrl);
    if (index >= BROWSER_WARMUP_SAMPLES) {
      mutationTimings.push(performance.now() - startedAt);
    }
  }

  // End in officer mode, then exercise an actual seeded review queue. The
  // digest proves the selected subject changed without returning names or
  // review evidence to the load-test process or its output.
  const restoreOfficerButton = officerPage
    .locator('button[data-csf-view-switch-hydrated="true"]')
    .filter({ hasText: /^Switch to CSF Officer view$/u });
  if (await restoreOfficerButton.isVisible()) {
    await restoreOfficerButton.click({ timeout: 60_000 });
    await officerPage
      .locator('button[data-csf-view-switch-hydrated="true"]')
      .filter({ hasText: /^View as member$/u })
      .waitFor({ state: "visible", timeout: 60_000 });
    assertFixtureLocation(officerPage.url(), appUrl);
  }
  await officerPage.goto(
    new URL(fixtureOrganizationPath("?tab=csf-applications"), appUrl).href,
    { waitUntil: "domcontentloaded" },
  );
  assertFixtureLocation(officerPage.url(), appUrl);
  const rosterSearch = officerPage.getByPlaceholder("Search by name");
  await rosterSearch.waitFor({ state: "visible", timeout: 60_000 });
  const roster = rosterSearch.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' space-y-4 ')][1]",
  );
  const firstSubject = roster.locator("ul > li button").first();
  await firstSubject.waitFor({ state: "visible", timeout: 60_000 });
  await firstSubject.click({ timeout: 60_000 });
  assertFixtureLocation(officerPage.url(), appUrl);

  const reviewQueue = officerPage.locator('[aria-busy="false"]').filter({
    has: officerPage.getByRole("button", { name: "Next subject" }),
  });
  await reviewQueue.waitFor({ state: "visible", timeout: 60_000 });
  const nextSubject = reviewQueue.getByRole("button", {
    name: "Next subject",
  });
  const previousSubject = reviewQueue.getByRole("button", {
    name: "Previous subject",
  });
  if (await nextSubject.isDisabled()) {
    throw new Error(
      "The hosted review fixture must contain at least two application subjects.",
    );
  }

  let reviewDigest = await selectedReviewDigest(nextSubject);
  if (!reviewDigest) {
    throw new Error(
      "The hosted review queue did not expose a selected subject.",
    );
  }
  for (let index = 0; index < BROWSER_REVIEW_NAVIGATIONS; index += 1) {
    const control = index % 2 === 0 ? nextSubject : previousSubject;
    const previousDigest = reviewDigest;
    await control.click({ timeout: 60_000 });
    await officerPage.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    reviewDigest = await selectedReviewDigest(nextSubject);
    if (!reviewDigest || reviewDigest === previousDigest) {
      throw new Error(
        "The hosted review queue did not settle on a different subject.",
      );
    }
    if (index === 1) {
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
    inpSupported,
    lcpSampleCount: lcp.length,
    lcpP75Ms: percentile(lcp, 0.75),
    mutationP95Ms: percentile(mutationTimings, 0.95),
    reviewNavigationCount: BROWSER_REVIEW_NAVIGATIONS,
  };
}

async function main() {
  const target = validateTarget();
  const getProtectionHeaders = createVercelProtectionHeadersProvider(target);
  const memberSessions = await mintSessions({
    accounts: target.memberAccounts,
    password: target.password,
    role: "member",
    supabasePublishableKey: target.supabasePublishableKey,
    supabaseUrl: target.supabaseUrl,
  });
  await new Promise((resolve) => setTimeout(resolve, SESSION_MINT_INTERVAL_MS));
  const officerSessions = await mintSessions({
    accounts: target.officerAccounts,
    password: target.password,
    role: "officer",
    supabasePublishableKey: target.supabasePublishableKey,
    supabaseUrl: target.supabaseUrl,
  });
  const allSessionIds = new Set(
    [...memberSessions, ...officerSessions].map(({ sessionId }) => sessionId),
  );
  if (allSessionIds.size !== MEMBER_SESSIONS + OFFICER_SESSIONS) {
    throw new Error("The hosted load reused an auth session between roles.");
  }
  const allUserIds = new Set(
    [...memberSessions, ...officerSessions].map(({ userId }) => userId),
  );
  if (allUserIds.size !== MEMBER_SESSIONS + OFFICER_SESSIONS) {
    throw new Error("The hosted load reused an auth identity between roles.");
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
      target.protectionBypass,
    );
    const officerPage = await openAuthenticatedPage(
      officerContext,
      target.appUrl,
      officerSessions[0].cookies,
      target.protectionBypass,
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
      distinctAuthIdentities: allUserIds.size,
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
      inpSupported: browserResult.inpSupported,
      clsSampleCount: browserResult.clsSampleCount,
      clsP75: browserResult.clsP75,
      rendererCrashes: browserResult.browserFailures.filter(
        (failure) => failure === "renderer_crash",
      ).length,
      reviewNavigationCount: browserResult.reviewNavigationCount,
      browserErrors: browserResult.browserFailures.length,
      browserErrorCounts: countBrowserFailures(browserResult.browserFailures),
      baselineHeapBytes: browserResult.baselineHeap,
      finalHeapBytes: browserResult.finalHeap,
      retainedHeapGrowth: browserResult.heapGrowth,
    };
    result.ok =
      result.requests > 0 &&
      result.distinctAuthIdentities === MEMBER_SESSIONS + OFFICER_SESSIONS &&
      result.distinctAuthSessions === MEMBER_SESSIONS + OFFICER_SESSIONS &&
      result.readP95Ms <= 2_500 &&
      result.readP99Ms <= 5_000 &&
      result.mutationP95Ms <= 3_000 &&
      result.errorRate < 0.005 &&
      result.fiveHundredRate < 0.001 &&
      result.lcpSampleCount === BROWSER_MEASURED_SAMPLES &&
      result.lcpP75Ms < 2_500 &&
      result.inpSupported === true &&
      result.inpSampleCount === BROWSER_MEASURED_SAMPLES &&
      result.inpP75Ms < 200 &&
      result.clsSampleCount === BROWSER_MEASURED_SAMPLES &&
      result.clsP75 < 0.1 &&
      result.rendererCrashes === 0 &&
      result.reviewNavigationCount === BROWSER_REVIEW_NAVIGATIONS &&
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
