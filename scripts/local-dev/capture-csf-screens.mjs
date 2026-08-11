#!/usr/bin/env node

/**
 * Capture the CSF member/officer surfaces for design review.
 *
 * Points a Playwright Chromium at an already-running app (default
 * http://localhost:3001, so it never collides with a developer's own :3000)
 * and writes full-page PNGs to .artifacts/csf-screens/. Fixture accounts and
 * fictional data only — this never touches a hosted environment.
 *
 *   BASE_URL=http://localhost:3001 node scripts/local-dev/capture-csf-screens.mjs
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3001";
const PASSWORD = process.env.CSF_LOCAL_TEST_PASSWORD;
const OUT_DIR = path.resolve(process.env.OUT_DIR ?? ".artifacts/csf-screens");
// Comma-separated shot-name substrings, so two people can capture different
// surfaces into different directories without racing each other.
const ONLY = (process.env.ONLY ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const ORG = "dvhs-csf";

if (!PASSWORD) {
  throw new Error(
    "Set CSF_LOCAL_TEST_PASSWORD to the isolated fixture password.",
  );
}

const SHOTS = [
  {
    name: "01-member-home",
    account: "student.2028@local.test",
    path: `/organization/${ORG}`,
    label: "Member Home — class feed",
  },
  {
    name: "02-member-my-csf",
    account: "student.2028@local.test",
    path: `/organization/${ORG}?tab=csf-profile`,
    label: "Member — My CSF",
  },
  {
    name: "03-platform-home-feed",
    account: "student.2028@local.test",
    path: "/home",
    label: "Platform /home — plugin feed section",
  },
  {
    name: "04-platform-dashboard",
    account: "student.2028@local.test",
    path: "/dashboard",
    label: "Platform /dashboard — plugin card",
  },
  {
    name: "05-officer-cohort-hub",
    account: "csf.admin@local.test",
    path: `/organization/${ORG}?tab=csf-cohorts`,
    label: "Officer — class picker",
  },
  {
    name: "06-officer-cohort-stream",
    account: "csf.admin@local.test",
    path: `/organization/${ORG}?tab=csf-cohorts&csf_cohort=10000000-0000-4000-8000-000000000102&csf_cohort_tab=stream`,
    label: "Officer — Class of 2028 Stream",
  },
  {
    name: "07-officer-cohort-members",
    account: "csf.admin@local.test",
    path: `/organization/${ORG}?tab=csf-cohorts&csf_cohort=10000000-0000-4000-8000-000000000102&csf_cohort_tab=members`,
    label: "Officer — Class of 2028 Members",
  },
  {
    name: "08-officer-overview",
    account: "csf.admin@local.test",
    path: `/organization/${ORG}`,
    label: "Officer — overview with Your classes",
  },
  {
    name: "09-account-plugin-content",
    account: "student.2028@local.test",
    path: "/account/plugins",
    label: "Account — plugin content preference",
  },
];

async function login(page, account) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  // Scope to <main>: the header renders a second login form. The form is inert
  // until hydration and the bot check reports ready — same waits the e2e
  // helper uses, for the same reason.
  const main = page.getByRole("main");
  await main.locator('form[data-hydrated="true"]').waitFor({ timeout: 45_000 });
  await main
    .getByText("Secure check ready", { exact: true })
    .waitFor({ timeout: 45_000 });
  await main.getByRole("textbox", { name: "Email" }).fill(account);
  await main.getByLabel("Password").fill(PASSWORD);
  await main.getByRole("button", { name: "Login", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 45_000,
  });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  let currentAccount = null;
  let context = null;
  let page = null;

  const selected = ONLY.length
    ? SHOTS.filter((shot) => ONLY.some((only) => shot.name.includes(only)))
    : SHOTS;

  for (const shot of selected) {
    if (shot.account !== currentAccount) {
      if (context) await context.close();
      context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: "dark",
      });
      page = await context.newPage();
      await login(page, shot.account);
      currentAccount = shot.account;
    }

    await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const file = path.join(OUT_DIR, `${shot.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    results.push({ ...shot, file });
    console.log(`captured ${shot.name} → ${file}`);
  }

  if (context) await context.close();
  await browser.close();
  console.log(
    JSON.stringify(
      { ok: true, count: results.length, outDir: OUT_DIR },
      null,
      2,
    ),
  );
}

await main();
