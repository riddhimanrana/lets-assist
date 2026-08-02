import { describe, expect, test } from "bun:test";

import {
  findSourceOrganizationIssues,
  SOURCE_ORGANIZATION_RULES,
} from "./check-source-organization.mjs";

describe("source organization guard", () => {
  test("allows intentional source, test, fixture, and artifact paths", () => {
    expect(
      findSourceOrganizationIssues([
        "app/projects/page.tsx",
        "lib/plugins/access-role.test.ts",
        "scripts/local-dev/seed-platform.mjs",
        "artifacts/csf/verification-summary.md",
        "fixtures/imports/sample.csv",
      ]),
    ).toEqual([]);
  });

  test("rejects generated artifacts", () => {
    const issues = findSourceOrganizationIssues([
      ".DS_Store",
      "tsconfig.tsbuildinfo",
      "logs/dev.log",
    ]);

    expect(issues.map((issue) => issue.rule)).toEqual([
      SOURCE_ORGANIZATION_RULES.GENERATED_ARTIFACT,
      SOURCE_ORGANIZATION_RULES.GENERATED_ARTIFACT,
      SOURCE_ORGANIZATION_RULES.GENERATED_ARTIFACT,
    ]);
  });

  test("rejects scratch and backup production source", () => {
    const issues = findSourceOrganizationIssues([
      "scratch/test-remote.ts",
      "tmp/debug.mjs",
      "components/ProjectCard.backup.tsx",
      "lib/auth/session-old.ts",
    ]);

    expect(issues.map((issue) => issue.rule)).toEqual([
      SOURCE_ORGANIZATION_RULES.BACKUP_SOURCE,
      SOURCE_ORGANIZATION_RULES.BACKUP_SOURCE,
      SOURCE_ORGANIZATION_RULES.SCRATCH_SOURCE,
      SOURCE_ORGANIZATION_RULES.SCRATCH_SOURCE,
    ]);
  });
});
