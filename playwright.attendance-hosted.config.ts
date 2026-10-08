import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { readHostedAttendanceTarget } from "./scripts/hosted-development/attendance-target";

const target = readHostedAttendanceTarget();
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

export default defineConfig({
  testDir: "./tests/e2e/attendance",
  testMatch: "paper-attendance.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["./scripts/hosted-development/attendance-reporter.mjs"]],
  outputDir: path.join(process.cwd(), ".artifacts", "attendance-hosted"),
  preserveOutput: "never",
  use: {
    baseURL: target.appUrl,
    navigationTimeout: 120_000,
    actionTimeout: 20_000,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    { name: "hosted-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
