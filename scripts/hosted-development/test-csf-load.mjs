#!/usr/bin/env node

import { chromium } from "@playwright/test";

const PRODUCTION_PROJECT_REF = "fotdmeakexgrkronxlof";
const EXPECTED_ORIGIN = "https://dev.lets-assist.com";
const MEMBER_ACCOUNT = "student.2028@local.test";
const OFFICER_ACCOUNT = "csf.officer@local.test";
const MEMBER_SESSIONS = 90;
const OFFICER_SESSIONS = 10;
const DEFAULT_DURATION_MS = 15 * 60 * 1000;
const RAMP_DURATION_MS = 60_000;
const REQUEST_INTERVAL_MS = 10_000;

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
  const protectionBypass = required("VERCEL_AUTOMATION_BYPASS_SECRET");
  return { appUrl, durationMs, password, projectRef, protectionBypass };
}

function installVitalsObserver() {
  window.__csfLoadVitals = { cls: 0, inp: 0, lcp: 0 };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__csfLoadVitals.lcp = Math.max(
        window.__csfLoadVitals.lcp,
        entry.startTime,
      );
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
        window.__csfLoadVitals.inp = Math.max(
          window.__csfLoadVitals.inp,
          entry.duration,
        );
      }
    }
  }).observe({ type: "event", buffered: true, durationThreshold: 16 });
}

async function login(context, appUrl, account, password, protectionBypass) {
  const page = await context.newPage();
  await page.route(`${appUrl.origin}/**`, async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "x-vercel-protection-bypass": protectionBypass,
      },
    });
  });
  await page.goto(
    new URL("/login?redirect=%2Forganization%2Fdvhs-csf", appUrl).href,
  );
  await page
    .locator('form[data-hydrated="true"]')
    .waitFor({ state: "visible" });
  await page.getByRole("textbox", { name: "Email" }).fill(account);
  await page.getByLabel("Password").fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/organization/dvhs-csf", {
      timeout: 60_000,
      waitUntil: "domcontentloaded",
    }),
    page
      .locator('form[data-hydrated="true"]')
      .getByRole("button", { name: "Login", exact: true })
      .click(),
  ]);
  return page;
}

function cookieHeader(cookies) {
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

async function runRequestSessions({
  appUrl,
  durationMs,
  memberCookies,
  officerCookies,
  protectionBypass,
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
    ...Array.from({ length: MEMBER_SESSIONS }, (_, index) => ({
      cookie: memberCookies,
      index,
      paths: memberPaths,
      role: "member",
    })),
    ...Array.from({ length: OFFICER_SESSIONS }, (_, index) => ({
      cookie: officerCookies,
      index,
      paths: officerPaths,
      role: "officer",
    })),
  ];
  const timings = [];
  let errors = 0;
  let fiveHundreds = 0;
  let requests = 0;
  const endAt = Date.now() + durationMs;
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
      let cycle = 0;
      while (Date.now() < endAt) {
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
              "x-vercel-protection-bypass": protectionBypass,
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
        if (remaining > 0 && Date.now() + remaining < endAt) {
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

  for (let index = 0; index < 25; index += 1) {
    const page = index % 2 === 0 ? memberPage : officerPage;
    const paths = index % 2 === 0 ? memberPaths : officerPaths;
    await page.goto(new URL(paths[index % paths.length], appUrl).href, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(750);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    const vitals = await page.evaluate(() => window.__csfLoadVitals);
    lcp.push(vitals.lcp);
    inp.push(vitals.inp);
    cls.push(vitals.cls);
  }

  const mutationTimings = [];
  let baselineHeap = null;
  await officerPage.goto(
    new URL("/organization/dvhs-csf?tab=csf-overview", appUrl).href,
  );
  for (let index = 0; index < 25; index += 1) {
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
    mutationTimings.push(performance.now() - startedAt);
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
    clsP75: percentile(cls, 0.75),
    finalHeap,
    heapGrowth,
    inpP75: percentile(inp, 0.75),
    lcpP75Ms: percentile(lcp, 0.75),
    mutationP95Ms: percentile(mutationTimings, 0.95),
  };
}

async function main() {
  const target = validateTarget();
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
    const memberPage = await login(
      memberContext,
      target.appUrl,
      MEMBER_ACCOUNT,
      target.password,
      target.protectionBypass,
    );
    const officerPage = await login(
      officerContext,
      target.appUrl,
      OFFICER_ACCOUNT,
      target.password,
      target.protectionBypass,
    );
    const memberCookies = cookieHeader(await memberContext.cookies());
    const officerCookies = cookieHeader(await officerContext.cookies());

    const loadPromise = runRequestSessions({
      appUrl: target.appUrl,
      durationMs: target.durationMs,
      memberCookies,
      officerCookies,
      protectionBypass: target.protectionBypass,
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
      requests: load.requests,
      readP95Ms: percentile(load.timings, 0.95),
      readP99Ms: percentile(load.timings, 0.99),
      mutationP95Ms: browserResult.mutationP95Ms,
      errorRate: load.requests ? load.errors / load.requests : 1,
      fiveHundredRate: load.requests ? load.fiveHundreds / load.requests : 1,
      lcpP75Ms: browserResult.lcpP75Ms,
      inpP75Ms: browserResult.inpP75,
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
      result.readP95Ms <= 2_500 &&
      result.readP99Ms <= 5_000 &&
      result.mutationP95Ms <= 3_000 &&
      result.errorRate < 0.005 &&
      result.fiveHundredRate < 0.001 &&
      result.lcpP75Ms < 2_500 &&
      result.inpP75Ms < 200 &&
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
