import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workflow = readFileSync(
  join(import.meta.dir, "..", ".github", "workflows", "gemini-review.yml"),
  "utf8",
);

function reviewStep() {
  const marker = '      - name: "Run Gemini pull request review"\n';
  const start = workflow.indexOf(marker);
  if (start === -1)
    throw new Error("Gemini pull request review step is missing");
  const body = workflow.slice(start + marker.length);
  const nextStep = /^ {6}- name:/mu.exec(body);
  return nextStep ? body.slice(0, nextStep.index) : body;
}

describe("headless Gemini pull request review workflow", () => {
  test("scopes workspace trust to the unchanged review action and prompt", () => {
    const step = reviewStep();
    const envStart = step.indexOf("        env:\n");
    const withStart = step.indexOf("        with:\n");
    const env = step.slice(envStart, withStart);

    expect(envStart).toBeGreaterThan(-1);
    expect(withStart).toBeGreaterThan(envStart);
    expect(env).toContain('          GEMINI_CLI_TRUST_WORKSPACE: "true"\n');
    expect(workflow.match(/GEMINI_CLI_TRUST_WORKSPACE:/gu)?.length).toBe(1);
    expect(step).toContain(
      '        uses: "google-github-actions/run-gemini-cli@v0"',
    );
    expect(step).toContain('          prompt: "/pr-code-review"\n');
  });
});
