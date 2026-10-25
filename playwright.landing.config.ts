import path from "node:path";
import { defineConfig } from "@playwright/test";

// Supply an already-running public app in LANDING_TEST_BASE_URL. This config
// starts no server, database or other service.
export default defineConfig({
  testDir: "./tests/e2e/landing",
  testMatch: "landing-first-render.spec.ts",
  outputDir: path.join(process.cwd(), ".artifacts", "landing-first-render"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: "list",
  use: {
    baseURL: process.env.LANDING_TEST_BASE_URL,
    headless: true,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
