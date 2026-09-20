import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const workflow = readFileSync(
  join(import.meta.dir, "../..", ".github/workflows/ci.yml"),
  "utf8",
);

function job(name, nextName) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`Missing ${name} job.`);
  const end = nextName ? workflow.indexOf(`\n  ${nextName}:\n`, start + 1) : -1;
  return workflow.slice(start, end < 0 ? undefined : end);
}

describe("CI delivery modes", () => {
  test("pull requests run the short quality gate", () => {
    const quality = job("quality", "db-replay-validation");
    expect(quality).toContain("run: bun run plugin:apps:contract");
    expect(quality).toContain("run: bun run typecheck");
    expect(quality).toContain("if: github.event_name != 'pull_request'");
    expect(quality).toContain("run: bun run test");
    expect(quality).toContain("run: bun run build");
  });

  test("database and browser validation runs only outside pull requests", () => {
    const replay = job("db-replay-validation", "ci-gate");
    expect(replay).toContain("if: github.event_name != 'pull_request'");
    expect(replay).toContain("run: bun run csf:test:e2e");
  });

  test("the aggregate gate requires full validation outside pull requests", () => {
    const gate = job("ci-gate");
    expect(gate).toContain(
      "FULL_VALIDATION: ${{ github.event_name != 'pull_request' }}",
    );
    expect(gate).toContain('[[ "${DATABASE_RESULT}" == "success" ]]');
    expect(gate).toContain('[[ "${DATABASE_RESULT}" == "skipped" ]]');
    expect(gate).toContain("\n          fi\n");
  });
});
