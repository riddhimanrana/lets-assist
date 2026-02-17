import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("cron scheduling configuration", () => {
  it("uses GitHub Actions cron route for auto-publish", () => {
    const autoPublishWorkflowPath = path.join(process.cwd(), ".github/workflows/auto-publish-hours.yml");
    const autoPublishWorkflow = fs.readFileSync(autoPublishWorkflowPath, "utf8");

    expect(autoPublishWorkflow).toContain("/api/cron/auto-publish-hours");
  });

  it("has a dedicated workflow for recurring project generation", () => {
    const recurringWorkflowPath = path.join(process.cwd(), ".github/workflows/generate-recurring-projects.yml");
    const recurringWorkflow = fs.readFileSync(recurringWorkflowPath, "utf8");

    expect(recurringWorkflow).toContain("name: Generate Recurring Projects");
    expect(recurringWorkflow).toContain("/api/cron/generate-recurring-projects");
  });

  it("does not define Vercel cron schedules", () => {
    const vercelPath = path.join(process.cwd(), "vercel.json");
    const vercelConfig = fs.readFileSync(vercelPath, "utf8");

    expect(vercelConfig).not.toContain('"crons"');
  });
});
