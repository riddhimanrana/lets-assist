import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Production background jobs are scheduled by Vercel Cron. GitHub schedules
 * that declare `environment: production` wait for approval and are cancelled
 * by the next run, so they never execute unattended.
 */
const VERCEL_SCHEDULED = {
  "data-exports": "*/20 * * * *",
  "paper-signup-notifications": "3,13,23,33,43,53 * * * *",
  "project-cancellations": "5,35 * * * *",
  "organization-calendar-sync": "12 * * * *",
  "organization-sheet-sync": "27 */2 * * *",
  "auto-publish-hours": "10 3,15 * * *",
  "generate-recurring-projects": "10 1,13 * * *",
  "waiver-cleanup": "25 */12 * * *",
  "ai-moderation": "0 0 * * *",
} as const;

// Hard-deleting jobs held until the retention guard lands (SCHED-CLEANUP-HOLD).
const HELD = ["anonymous-cleanup", "paper-scan-cleanup"] as const;

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const crons = (
  JSON.parse(read("vercel.json")) as {
    crons: Array<{ path: string; schedule: string }>;
  }
).crons;

describe("scheduled Production jobs", () => {
  for (const [job, schedule] of Object.entries(VERCEL_SCHEDULED)) {
    test(`${job} has exactly one Vercel schedule and a manual fallback`, () => {
      expect(crons.filter((cron) => cron.path === `/api/cron/${job}`)).toEqual([
        { path: `/api/cron/${job}`, schedule },
      ]);

      const workflow = read(`.github/workflows/${job}.yml`);
      expect(workflow).toContain("workflow_dispatch:");
      expect(workflow).not.toMatch(/^\s+schedule:/m);
    });
  }

  for (const job of HELD) {
    test(`${job} stays unscheduled while its retention hold is open`, () => {
      expect(crons.some((cron) => cron.path === `/api/cron/${job}`)).toBe(
        false,
      );

      const workflow = read(`.github/workflows/${job}.yml`);
      expect(workflow).toContain("workflow_dispatch:");
      expect(workflow).not.toMatch(/^\s+schedule:/m);
      expect(workflow).toContain("SCHED-CLEANUP-HOLD");
    });
  }

  test("no GitHub workflow schedules a Production-gated cron call", () => {
    for (const job of [...Object.keys(VERCEL_SCHEDULED), ...HELD]) {
      const workflow = read(`.github/workflows/${job}.yml`);
      if (workflow.includes("environment: production")) {
        expect(workflow).not.toMatch(/^\s+- cron:/m);
      }
    }
  });
});
