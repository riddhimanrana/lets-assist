import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const TARGET_PATHS = new Set([
  "/api/cron/csf-communications-dispatch",
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
  test("keeps both CSF workers out of Vercel cron", () => {
    const configuredTargets = configuredCrons().filter(
      (cron) => typeof cron.path === "string" && TARGET_PATHS.has(cron.path),
    );

    expect(
      configuredTargets,
      "CSF workers are scheduled outside Vercel because the accepted hosted " +
        "cadence and plan do not use Vercel cron.",
    ).toEqual([]);
  });

  test("checks in the accepted GitHub communications scheduler", () => {
    expect(githubDispatchWorkflow).toContain('cron: "*/10 * * * *"');
    expect(githubDispatchWorkflow).toContain(
      "ENDPOINT_PATH: /api/cron/csf-communications-dispatch",
    );
    expect(githubDispatchWorkflow).toContain("environment: production");
    expect(githubDispatchWorkflow).toContain(
      "CRON_TOKEN: ${{ secrets.CRON_SECRET }}",
    );
    expect(githubDispatchWorkflow).toContain(
      "GitHub Actions schedules can be delayed",
    );
    expect(githubDispatchWorkflow).not.toContain(
      "/api/cron/csf-scheduled-post-publisher",
    );
  });

  test("checks in the bounded GitHub scheduled-post publisher away from the top of the hour", () => {
    expect(githubScheduledPostWorkflow).toContain(
      'cron: "7,17,27,37,47,57 * * * *"',
    );
    expect(githubScheduledPostWorkflow).toContain(
      "ENDPOINT_PATH: /api/cron/csf-scheduled-post-publisher",
    );
    expect(githubScheduledPostWorkflow).toContain("environment: production");
    expect(githubScheduledPostWorkflow).toContain(
      "CRON_TOKEN: ${{ secrets.CRON_SECRET }}",
    );
    expect(githubScheduledPostWorkflow).toContain(
      "GitHub Actions schedules can be delayed or dropped under load",
    );
    expect(githubScheduledPostWorkflow).toContain("cancel-in-progress: false");
    expect(githubScheduledPostWorkflow).toContain(
      'if [[ "$enabled" != "true" ]]',
    );
    expect(githubScheduledPostWorkflow).not.toContain(
      "/api/cron/csf-communications-dispatch",
    );
  });
});
