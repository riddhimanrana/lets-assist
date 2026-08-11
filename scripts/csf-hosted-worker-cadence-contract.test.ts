import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const TARGET_PATHS = new Set([
  "/api/cron/csf-communications-dispatch",
  "/api/cron/csf-scheduled-post-publisher",
]);

type VercelCron = { path?: unknown; schedule?: unknown };
type VercelConfig = { crons?: unknown };

function configuredCrons(): VercelCron[] {
  const parsed = JSON.parse(
    readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  ) as VercelConfig;
  return Array.isArray(parsed.crons) ? (parsed.crons as VercelCron[]) : [];
}

describe("CSF hosted-worker cadence acceptance boundary", () => {
  test("does not silently activate either worker before plan and hosted Production acceptance", () => {
    const configuredTargets = configuredCrons().filter(
      (cron) => typeof cron.path === "string" && TARGET_PATHS.has(cron.path),
    );

    expect(
      configuredTargets,
      "A checked-in CSF cron activates only on a Vercel Production deployment. " +
        "Confirm the Vercel plan, choose an accepted cadence, verify both flags " +
        "default disabled, and complete isolated hosted-Production invocation " +
        "evidence before replacing this deliberate no-cron contract.",
    ).toEqual([]);
  });
});
