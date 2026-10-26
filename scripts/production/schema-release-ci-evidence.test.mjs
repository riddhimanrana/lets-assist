import assert from "node:assert/strict";
import { test } from "node:test";
import { verifySchemaReleaseCi } from "./schema-release-ci-evidence.mjs";

const accepted = "a".repeat(40);
const release = "b".repeat(40);
const repository = "example/application";
const config = { accepted, release, repository, token: "test-token" };
function fixture({
  changedTree = false,
  failed = false,
  wrongWorkflow = false,
  wrongSha = false,
  missingReplay = false,
  fork = false,
} = {}) {
  const git = (...args) => {
    if (args[0] === "merge-base") return "";
    if (args[1] === "HEAD") return release;
    return changedTree && args[1] === `${accepted}^{tree}`
      ? "different"
      : "same-tree";
  };
  const request = async (path) =>
    path.startsWith("commits/")
      ? {
          total_count: 2,
          check_runs: [
            "full-quality",
            ...(missingReplay ? [] : ["db-replay-validation"]),
          ].map((name, id) => ({
            id,
            name,
            app: { slug: "github-actions" },
            status: "completed",
            conclusion: failed ? "skipped" : "success",
            details_url: `https://github.com/${repository}/actions/runs/42/job/${id}`,
          })),
        }
      : {
          path: wrongWorkflow
            ? ".github/workflows/other.yml"
            : ".github/workflows/ci.yml",
          event: "workflow_dispatch",
          head_sha: wrongSha ? release : accepted,
          repository: { full_name: repository },
          head_repository: {
            full_name: fork ? "fork/application" : repository,
          },
          status: "completed",
          conclusion: "success",
        };
  return { git, request };
}
test("accepts a trusted full CI run for the identical accepted tree", async () => {
  assert.deepEqual(await verifySchemaReleaseCi(config, fixture()), {
    release,
    accepted,
    run: "42",
    tree: "same-tree",
  });
});
for (const option of [
  "changedTree",
  "failed",
  "wrongWorkflow",
  "wrongSha",
  "missingReplay",
  "fork",
]) {
  test(`refuses ${option} evidence`, async () => {
    await assert.rejects(
      verifySchemaReleaseCi(config, fixture({ [option]: true })),
    );
  });
}
test("refuses missing release context and checkout mismatch", async () => {
  await assert.rejects(
    verifySchemaReleaseCi({ ...config, token: "" }, fixture()),
  );
  await assert.rejects(
    verifySchemaReleaseCi(config, { ...fixture(), git: () => accepted }),
  );
});
