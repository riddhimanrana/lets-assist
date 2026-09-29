import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const config = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
) as { crons: Array<{ path: string; schedule: string }> };
const recovery = readFileSync(
  new URL(
    "../.github/workflows/project-feedback-followups.yml",
    import.meta.url,
  ),
  "utf8",
);

test("project follow-ups have one hourly deployed schedule", () => {
  expect(
    config.crons.filter(
      (cron) => cron.path === "/api/cron/project-feedback-followups",
    ),
  ).toEqual([
    { path: "/api/cron/project-feedback-followups", schedule: "17 * * * *" },
  ]);
});

test("project follow-up recovery retains Production approval without a competing schedule", () => {
  expect(recovery).toContain("workflow_dispatch:");
  expect(recovery).not.toMatch(/^\s+schedule:/m);
  expect(recovery).toContain("environment: production");
  expect(recovery).toContain("github.ref == 'refs/heads/main'");
  expect(recovery).toContain("CRON_TOKEN: ${{ secrets.CRON_SECRET }}");
  expect(recovery).toContain(
    "ENDPOINT_PATH: /api/cron/project-feedback-followups",
  );
});
