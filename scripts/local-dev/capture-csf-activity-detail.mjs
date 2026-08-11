#!/usr/bin/env node
// Screenshot probe for the redesigned CSF activity detail pages.
// Login helper copied from scripts/local-dev/capture-csf-screens.mjs.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3001";
const PASSWORD = process.env.CSF_LOCAL_TEST_PASSWORD;
const OUT_DIR = path.resolve(
  process.env.OUT_DIR ?? ".artifacts/activity-redesign",
);
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

const ACTIVITIES = [
  { key: "a-minimal", id: "10000000-0000-4000-8000-000000000921" },
  { key: "b-dateonly", id: "10000000-0000-4000-8000-000000000922" },
  { key: "c-linked", id: "10000000-0000-4000-8000-000000000125" },
  { key: "d-full", id: "10000000-0000-4000-8000-000000000126" },
];

const ROLES = [
  { key: "officer", account: "csf.admin@local.test" },
  { key: "member", account: "student.2028@local.test" },
];

const VIEWPORTS = [
  { key: "1440", width: 1440, height: 900 },
  { key: "390", width: 390, height: 844 },
];

const SHOTS = [];
for (const role of ROLES) {
  for (const viewport of VIEWPORTS) {
    for (const activity of ACTIVITIES) {
      SHOTS.push({
        name: `${role.key}-${activity.key}-${viewport.key}`,
        account: role.account,
        viewport,
        path: `/organization/${ORG}?tab=csf-activities&csf_activity=${activity.id}`,
      });
    }
  }
}

async function login(page, account) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
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
  let context = null;
  let page = null;
  let currentKey = null;

  const selected = ONLY.length
    ? SHOTS.filter((shot) => ONLY.some((only) => shot.name.includes(only)))
    : SHOTS;

  for (const shot of selected) {
    const key = `${shot.account}:${shot.viewport.key}`;
    if (key !== currentKey) {
      if (context) await context.close();
      context = await browser.newContext({
        viewport: { width: shot.viewport.width, height: shot.viewport.height },
        deviceScaleFactor: 2,
        colorScheme: "dark",
      });
      page = await context.newPage();
      await login(page, shot.account);
      currentKey = key;
    }
    await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    const file = path.join(OUT_DIR, `${shot.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`captured ${shot.name}`);
  }

  if (context) await context.close();
  await browser.close();
  console.log(`done → ${OUT_DIR}`);
}

await main();
