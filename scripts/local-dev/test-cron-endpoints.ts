#!/usr/bin/env bun
import { spawn } from "child_process";

const PORT = 3009;
const CRON_SECRET =
  process.env.CRON_SECRET ||
  process.env.AUTO_PUBLISH_SECRET_TOKEN ||
  "local-cron-test-secret-123456";
const EXISTING_DEV_SERVER_URL = process.env.CRON_TEST_BASE_URL ?? "http://localhost:3000";

// Define cron endpoints to test
const CRONS = [
  { name: "Auto-Publish Hours", path: "/api/cron/auto-publish-hours" },
  { name: "Project Cancellations", path: "/api/cron/project-cancellations" },
  { name: "Organization Calendar Sync", path: "/api/cron/organization-calendar-sync" },
  { name: "Organization Sheet Sync", path: "/api/cron/organization-sheet-sync" },
  { name: "Background Data Exports", path: "/api/cron/data-exports" },
];

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopDevServer(devServer: ReturnType<typeof spawn> | null) {
  if (!devServer || devServer.exitCode !== null || devServer.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (devServer.exitCode === null && !devServer.killed) {
        devServer.kill("SIGKILL");
      }
      resolve();
    }, 5_000);

    devServer.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    devServer.kill("SIGTERM");
  });
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

async function runTests() {
  let baseUrl = EXISTING_DEV_SERVER_URL;
  let devServer: ReturnType<typeof spawn> | null = null;
  let hasFailed = false;

  try {
    console.log(`=== Checking for existing Next.js dev server at ${baseUrl} ===`);

    const existingServerUp = await canReach(baseUrl);
    if (!existingServerUp) {
      console.log("No existing dev server detected. Starting a temporary one for cron testing...");

      // Set required env vars for the child process dev server
      const env = {
        ...process.env,
        PORT: String(PORT),
        CRON_TOKEN: CRON_SECRET,
        CRON_SECRET: CRON_SECRET,
        AUTO_PUBLISH_SECRET_TOKEN: CRON_SECRET,
        PROJECT_CANCELLATION_WORKER_SECRET_TOKEN: CRON_SECRET,
        ORG_CALENDAR_SYNC_WORKER_SECRET_TOKEN: CRON_SECRET,
        ORG_SHEET_SYNC_WORKER_SECRET_TOKEN: CRON_SECRET,
        AUTO_PUBLISH_ENABLED: "true",
        PROJECT_CANCELLATION_WORKER_ENABLED: "true",
        ORG_CALENDAR_SYNC_WORKER_ENABLED: "true",
        ORG_SHEET_SYNC_WORKER_ENABLED: "true",
      };

      devServer = spawn("bun", ["run", "dev"], {
        env,
        stdio: "pipe",
      });

      baseUrl = `http://localhost:${PORT}`;

      // Listen to output to surface startup failures.
      const stdout = devServer.stdout;
      if (stdout) {
        stdout.on("data", (data) => {
          const output = data.toString().trim();
          if (output) {
            console.log(`[Server] ${output}`);
          }
        });
      }

      const stderr = devServer.stderr;
      if (stderr) {
        stderr.on("data", (data) => {
          const output = data.toString().trim();
          if (output) {
            console.error(`[Server Error] ${output}`);
          }
        });
      }

      console.log("Waiting for temporary server to spin up on port", PORT);
      for (let i = 0; i < 30; i++) {
        if (await canReach(baseUrl)) break;
        await wait(500);
      }

      if (!(await canReach(baseUrl))) {
        throw new Error(`Next.js dev server did not become reachable at ${baseUrl}.`);
      }
    } else {
      console.log(`Using existing dev server at ${baseUrl}.`);
    }

    console.log("Server is ready. Running cron tests...");

    for (const cron of CRONS) {
      const url = `${baseUrl}${cron.path}`;
      console.log(`\nTesting cron: ${cron.name} (${url})`);

      const startTime = Date.now();
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${CRON_SECRET}`,
            Accept: "application/json",
          },
        });

        const duration = Date.now() - startTime;
        console.log(`Status Code: ${response.status} (took ${duration}ms)`);

        const body = await response.text();
        try {
          const json = JSON.parse(body);
          console.log("Response JSON:", JSON.stringify(json, null, 2));
        } catch {
          console.log("Response Text:", body.slice(0, 500));
        }

        if (response.status !== 200) {
          console.error(`❌ Cron ${cron.name} returned non-200 status!`);
          hasFailed = true;
        } else {
          console.log(`✅ Cron ${cron.name} passed.`);
        }
      } catch (err: any) {
        console.error(`❌ Cron ${cron.name} fetch failed:`, err.message);
        hasFailed = true;
      }
    }

    if (hasFailed) {
      console.error("\n❌ Some cron tests failed.");
      process.exitCode = 1;
    } else {
      console.log("\n🎉 All local cron tests completed successfully!");
    }
  } finally {
    if (devServer) {
      console.log("\n=== Shutting down temporary Next.js dev server ===");
      await stopDevServer(devServer);
    }
  }
}

runTests();
