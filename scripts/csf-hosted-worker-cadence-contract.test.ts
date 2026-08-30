import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const TARGET_PATHS = new Set([
  "/api/cron/csf-communications-dispatch",
  "/api/cron/csf-class-workbook-refresh",
  "/api/cron/csf-import-commit",
  "/api/cron/csf-scheduled-post-publisher",
]);

const githubDispatchWorkflow = readFileSync(
  new URL(
    "../.github/workflows/csf-communications-dispatch.yml",
    import.meta.url,
  ),
  "utf8",
);

const githubScheduledPostWorkflow = readFileSync(
  new URL(
    "../.github/workflows/csf-scheduled-post-publisher.yml",
    import.meta.url,
  ),
  "utf8",
);

type VercelCron = { path?: unknown; schedule?: unknown };
type VercelConfig = { crons?: unknown };

function configuredCrons(): VercelCron[] {
  const parsed = JSON.parse(
    readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  ) as VercelConfig;
  return Array.isArray(parsed.crons) ? (parsed.crons as VercelCron[]) : [];
}

describe("CSF hosted-worker cadence acceptance boundary", () => {
  test("schedules all CSF workers through Vercel cron", () => {
    const configuredTargets = configuredCrons().filter(
      (cron) => typeof cron.path === "string" && TARGET_PATHS.has(cron.path),
    );

    expect(configuredTargets).toEqual([
      {
        path: "/api/cron/csf-communications-dispatch",
        schedule: "*/10 * * * *",
      },
      {
        path: "/api/cron/csf-class-workbook-refresh",
        schedule: "* * * * *",
      },
      {
        path: "/api/cron/csf-import-commit",
        schedule: "* * * * *",
      },
      {
        path: "/api/cron/csf-scheduled-post-publisher",
        schedule: "7,17,27,37,47,57 * * * *",
      },
    ]);
  });

  test("keeps an approval-gated manual communications fallback", () => {
    expect(githubDispatchWorkflow).toContain("workflow_dispatch:");
    expect(githubDispatchWorkflow).not.toContain("schedule:");
    expect(githubDispatchWorkflow).toContain(
      "ENDPOINT_PATH: /api/cron/csf-communications-dispatch",
    );
    expect(githubDispatchWorkflow).toContain("environment: production");
    expect(githubDispatchWorkflow).toContain(
      "CRON_TOKEN: ${{ secrets.CRON_SECRET }}",
    );
    expect(githubDispatchWorkflow).toContain("Vercel Cron owns");
    expect(githubDispatchWorkflow).not.toContain(
      "/api/cron/csf-scheduled-post-publisher",
    );
  });

  test("keeps an approval-gated manual scheduled-post fallback", () => {
    expect(githubScheduledPostWorkflow).toContain("workflow_dispatch:");
    expect(githubScheduledPostWorkflow).not.toContain("schedule:");
    expect(githubScheduledPostWorkflow).toContain(
      "ENDPOINT_PATH: /api/cron/csf-scheduled-post-publisher",
    );
    expect(githubScheduledPostWorkflow).toContain("environment: production");
    expect(githubScheduledPostWorkflow).toContain(
      "CRON_TOKEN: ${{ secrets.CRON_SECRET }}",
    );
    expect(githubScheduledPostWorkflow).toContain("Vercel Cron owns");
    expect(githubScheduledPostWorkflow).toContain("cancel-in-progress: false");
    expect(githubScheduledPostWorkflow).toContain(
      'if [[ "$enabled" != "true" ]]',
    );
    expect(githubScheduledPostWorkflow).not.toContain(
      "/api/cron/csf-communications-dispatch",
    );
  });
});
