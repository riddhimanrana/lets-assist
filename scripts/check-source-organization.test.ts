import { describe, expect, test } from "bun:test";

import {
  findSourceOrganizationIssues,
  findMaintainabilityIssues,
  maintainabilityRepositoryName,
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
    ).toEqual([
      "components/NewPanel.tsx",
      "plugins/dvhs-csf/components/NestedPanel.tsx",
      "app/organizations/[id]/layout.tsx",
      "services/new-service.ts",
      "services/new-service.test.ts",
    ]);
    expect(
      findMaintainabilityIssues(
        [{ file: "app/projects/[id]/actions.ts", lines: 3698 }],
        "lets-assist",
      ).map((issue: { file: string }) => issue.file),
    ).toEqual(["app/projects/[id]/actions.ts"]);
  });

  test("a legacy allowance cannot authorize growth or an unrelated new file", () => {
    const baseline = require("./source-maintainability-baseline.json")
      .repositories["lets-assist"] as Record<string, number>;
    const [file, lines] = Object.entries(baseline)[0];
    expect(findMaintainabilityIssues([{ file, lines }], "lets-assist")).toEqual(
      [],
    );
    expect(
      findMaintainabilityIssues([{ file, lines: lines + 1 }], "lets-assist"),
    ).toHaveLength(1);
    expect(
      findMaintainabilityIssues(
        [{ file: "components/UnreviewedPanel.tsx", lines }],
        "lets-assist",
      ),
    ).toHaveLength(1);
    expect(
      findMaintainabilityIssues([{ file, lines: 600 }], "lets-assist"),
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

test("worktree directory names do not change the maintainability baseline", () => {
  expect(
    maintainabilityRepositoryName([
      "package.json",
      "scripts/check-source-organization.mjs",
    ]),
  ).toBe("lets-assist");
  expect(maintainabilityRepositoryName(["plugins/dvhs-csf/plugin.tsx"])).toBe(
    "private",
  );
  expect(maintainabilityRepositoryName(["app/page.tsx"])).toBe("unknown");
});
