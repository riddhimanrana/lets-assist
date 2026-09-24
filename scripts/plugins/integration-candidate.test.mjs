import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const workflow = readFileSync(
  new URL(
    "../../.github/workflows/plugin-release-integration.yml",
    import.meta.url,
  ),
  "utf8",
);
const resolver = workflow
  .split("- name: Resolve the root integration candidate")[1]
  .split("- name: Checkout root integration source")[0]
  .split("run: |\n")[1]
  .replace(/^ {10}/gm, "");
const sha = "a".repeat(40);

function resolveCandidate(
  candidate,
  event = "workflow_dispatch",
  source = sha,
) {
  const directory = mkdtempSync(
    join(tmpdir(), "plugin-integration-candidate-"),
  );
  const output = join(directory, "output");
  try {
    execFileSync("bash", ["-c", resolver], {
      env: {
        ...process.env,
        CANDIDATE_SHA: candidate,
        GITHUB_EVENT_NAME: event,
        GITHUB_SHA: source,
        GITHUB_OUTPUT: output,
      },
      stdio: "pipe",
    });
    return readFileSync(output, "utf8").trim();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("automatic integration keeps Development; manual pin names this exact workflow commit", () => {
  assert.equal(resolveCandidate("", "repository_dispatch"), "ref=development");
  assert.equal(resolveCandidate(sha), `ref=${sha}`);
});

test("candidate resolver rejects foreign refs, event injection and shell input", () => {
  for (const candidate of [
    "development",
    "a".repeat(7),
    "A".repeat(40),
    "b".repeat(40),
    `${sha}\nref=main`,
    "$(touch /tmp/unexpected-plugin-integration)",
  ]) {
    assert.throws(() => resolveCandidate(candidate));
  }
  assert.throws(() => resolveCandidate(sha, "repository_dispatch"));
});

test("candidate checkout and ancestry stay bound to the root repository", () => {
  assert.match(workflow, /repository: riddhimanrana\/lets-assist\n/u);
  assert.match(workflow, /ref: \$\{\{ steps\.candidate\.outputs\.ref \}\}/u);
  assert.doesNotMatch(workflow, /ref: \$\{\{ inputs\.candidate_sha/u);
  assert.match(
    workflow,
    /test "\$\(git rev-parse HEAD\)" = "\$\{CANDIDATE_SHA\}"/u,
  );
  assert.match(
    workflow,
    /git fetch --no-tags https:\/\/github\.com\/riddhimanrana\/lets-assist\.git/u,
  );
  assert.match(
    workflow,
    /git merge-base --is-ancestor refs\/remotes\/root\/development "\$\{CANDIDATE_SHA\}"/u,
  );
  assert.match(workflow, /--base development/u);
});
