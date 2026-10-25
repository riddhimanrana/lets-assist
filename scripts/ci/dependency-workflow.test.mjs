import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/dependency-security.yml", import.meta.url),
  "utf8",
);

test("daily dependency checks scan both branch snapshots with read-only credentials", () => {
  expect(workflow).toContain("schedule:");
  expect(workflow).toContain("branch: [development, main]");
  expect(workflow).toContain("contents: read");
  expect(workflow).not.toMatch(
    /\b(?:contents|packages|actions|id-token): write/u,
  );
  expect(workflow.match(/persist-credentials: false/gu)).toHaveLength(3);
  expect(workflow).toContain(
    "ref: ${{ steps.private-plugin-gitlink.outputs.sha }}",
  );
  expect(workflow).toContain(
    "path: target/lib/plugins/private\n          fetch-depth: 0",
  );
});

test("the auditor can inspect older branches without executing their package scripts", () => {
  expect(workflow).toContain("ref: ${{ github.sha }}\n          path: auditor");
  expect(workflow).toContain(
    "node ../auditor/scripts/security/audit-package-graphs.mjs",
  );
  expect(workflow).not.toMatch(/bun (?:install|run)|npm |pnpm |yarn /u);
  expect(workflow).not.toContain("pull_request_target");
});
