import { describe, expect, test } from "bun:test";

import {
  findSourceOrganizationIssues,
  findMaintainabilityIssues,
  SOURCE_ORGANIZATION_RULES,
} from "./check-source-organization.mjs";

describe("source organization guard", () => {
  test("allows intentional source, test, fixture, and artifact paths", () => {
    expect(
      findSourceOrganizationIssues([
        "app/projects/page.tsx",
        "lib/plugins/access-role.test.ts",
        "scripts/local-dev/seed-platform.mjs",
        "docs/csf/evidence/verification-summary.md",
        "fixtures/imports/sample.csv",
      ]),
    ).toEqual([]);
  });

  test("rejects generated trees, root binaries, hidden docs, and agent worktrees", () => {
    const issues = findSourceOrganizationIssues([
      ".artifacts/run/trace.zip",
      ".claude/worktrees/review/index.ts",
      ".private-notes.md",
      "fixture.xlsx",
      "playwright-report/index.html",
    ]);
    expect(issues.map((issue) => issue.rule)).toEqual([
      SOURCE_ORGANIZATION_RULES.GENERATED_ARTIFACT,
      SOURCE_ORGANIZATION_RULES.AGENT_WORKTREE,
      SOURCE_ORGANIZATION_RULES.HIDDEN_DOCUMENTATION,
      SOURCE_ORGANIZATION_RULES.ROOT_BINARY,
      SOURCE_ORGANIZATION_RULES.GENERATED_ARTIFACT,
    ]);
  });

  test("enforces category limits while ratcheting reviewed legacy files", () => {
    expect(
      findMaintainabilityIssues(
        [
          // Route and component modules are deliberately uncapped.
          { file: "components/NewPanel.tsx", lines: 601 },
          {
            file: "plugins/dvhs-csf/components/NestedPanel.tsx",
            lines: 601,
          },
          { file: "app/organizations/[id]/layout.tsx", lines: 601 },
          { file: "services/new-service.ts", lines: 801 },
          { file: "services/new-service.test.ts", lines: 1201 },
          { file: "components/SmallPanel.tsx", lines: 600 },
        ],
        "lets-assist",
      ).map((issue: { file: string }) => issue.file),
    ).toEqual(["services/new-service.ts", "services/new-service.test.ts"]);
    expect(
      findMaintainabilityIssues(
        [{ file: "app/projects/[id]/actions.ts", lines: 3698 }],
        "lets-assist",
      ).map((issue: { file: string }) => issue.file),
    ).toEqual(["app/projects/[id]/actions.ts"]);
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
