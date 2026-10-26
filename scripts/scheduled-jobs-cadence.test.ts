import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Production background jobs are scheduled by Vercel Cron. GitHub schedules
 * that declare `environment: production` wait for approval and are cancelled
 * by the next run, so they never execute unattended.
 */
// Preserve the five schedules already enabled in Production. Other routes
// remain available through their approval-gated manual workflows.
const PRODUCTION_SCHEDULES = [
  { path: "/api/cron/csf-communications-dispatch", schedule: "* * * * *" },
  { path: "/api/cron/csf-class-workbook-refresh", schedule: "* * * * *" },
  { path: "/api/cron/csf-import-commit", schedule: "* * * * *" },
  { path: "/api/cron/csf-publication-notifications", schedule: "* * * * *" },
  { path: "/api/cron/project-feedback-followups", schedule: "17 * * * *" },
] as const;
const MANUAL_ONLY = [
  "data-exports",
  "paper-signup-notifications",
  "project-cancellations",
  "organization-calendar-sync",
  "organization-sheet-sync",
  "auto-publish-hours",
  "generate-recurring-projects",
  "waiver-cleanup",
  "ai-moderation",
] as const;

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
  test("retains exactly the five previously enabled Production schedules", () => {
    expect(crons).toEqual(PRODUCTION_SCHEDULES);
  });

  for (const job of MANUAL_ONLY) {
    test(`${job} stays unscheduled and retains its manual fallback`, () => {
      expect(crons.filter((cron) => cron.path === `/api/cron/${job}`)).toEqual(
        [],
      );

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
    for (const job of [...MANUAL_ONLY, ...HELD]) {
      const workflow = read(`.github/workflows/${job}.yml`);
      if (workflow.includes("environment: production")) {
        expect(workflow).not.toMatch(/^\s+- cron:/m);
      }
    }
  });
});
