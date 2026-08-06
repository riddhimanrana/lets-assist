#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { getLocalSupabaseEnv } from "./dv-local-env.mjs";

const PORT = Number(process.env.PLUGIN_ISOLATION_TEST_PORT ?? 3110);
const EXTERNAL_BASE_URL =
  process.env.PLUGIN_ISOLATION_TEST_BASE_URL?.trim().replace(/\/$/, "");
const BASE_URL = EXTERNAL_BASE_URL || `http://127.0.0.1:${PORT}`;
const LOGIN_EMAIL =
  process.env.PLUGIN_ISOLATION_TEST_EMAIL ?? "dv.admin@local.test";

function requireRunPassword(value: string | undefined) {
  const password = value?.trim();
  if (!password) {
    throw new Error(
      "Set DV_LOCAL_TEST_PASSWORD to the run-scoped fixture password.",
    );
  }
  return password;
}

const LOGIN_PASSWORD = requireRunPassword(process.env.DV_LOCAL_TEST_PASSWORD);

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canReach(url: string) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function stopServer(server: ReturnType<typeof spawn> | null) {
  if (!server || server.exitCode !== null || server.killed) return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (server.exitCode === null && !server.killed) {
        server.kill("SIGKILL");
      }
      resolve();
    }, 5_000);

    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    server.kill("SIGTERM");
  });
}

async function startServer() {
  const localSupabase = getLocalSupabaseEnv();
  const server = spawn(
    "bunx",
    ["next", "dev", "--hostname", "127.0.0.1", "--port", String(PORT)],
    {
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: localSupabase.url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: localSupabase.anonKey,
        SUPABASE_SECRET_KEY: localSupabase.serviceRoleKey,
        NEXT_PUBLIC_TURNSTILE_BYPASS: "true",
      },
      stdio: "pipe",
    },
  );

  server.stdout?.on("data", (data) => {
    const output = data.toString().trim();
    if (output) console.log(`[Server] ${output}`);
  });

  server.stderr?.on("data", (data) => {
    const output = data.toString().trim();
    if (output) console.error(`[Server Error] ${output}`);
  });

  for (let i = 0; i < 40; i++) {
    if (await canReach(BASE_URL)) return server;
    await wait(500);
  }

  await stopServer(server);
  throw new Error(
    `Next.js dev server did not become reachable at ${BASE_URL}.`,
  );
}

async function assertAnonymousPluginDataBlocked() {
  const localSupabase = getLocalSupabaseEnv();
  const response = await fetch(
    `${localSupabase.url}/rest/v1/dv_sd_tournaments?select=id&limit=1`,
    {
      headers: {
        apikey: localSupabase.anonKey,
        Authorization: `Bearer ${localSupabase.anonKey}`,
        "Accept-Profile": "plugin_data",
      },
    },
  );

  if (response.ok) {
    const body = await response.text();
    throw new Error(
      `Expected anonymous plugin_data REST access to fail, got ${response.status}: ${body}`,
    );
  }

  console.log(
    `Anonymous plugin_data REST access blocked with status ${response.status}.`,
  );
}

async function assertDvPluginIsolatedInBrowser() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: BASE_URL });

  try {
    await page.goto(
      `/login?redirect=${encodeURIComponent(
        "/organization/dv-speech-debate/plugins/dv-speech-debate",
      )}`,
    );
    await page.getByRole("textbox", { name: "Email" }).fill(LOGIN_EMAIL);
    await page.getByLabel("Password").fill(LOGIN_PASSWORD);
    await page
      .getByRole("main")
      .getByRole("button", { name: "Login", exact: true })
      .click();

    await page.waitForURL(
      /\/organization\/dv-speech-debate\/plugins\/dv-speech-debate/,
      {
        timeout: 30_000,
      },
    );
    await page
      .getByRole("heading", { name: /DV Speech & Debate/i })
      .first()
      .waitFor({
        state: "visible",
        timeout: 30_000,
      });

    console.log(
      "DV plugin renders through its authenticated server-only workspace.",
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  let server: ReturnType<typeof spawn> | null = null;

  try {
    if (EXTERNAL_BASE_URL) {
      if (!(await canReach(BASE_URL))) {
        throw new Error(
          `Configured app server is not reachable at ${BASE_URL}.`,
        );
      }
    } else {
      server = await startServer();
    }
    await assertAnonymousPluginDataBlocked();
    await assertDvPluginIsolatedInBrowser();
    console.log("Plugin isolation browser/API smoke passed.");
  } finally {
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
