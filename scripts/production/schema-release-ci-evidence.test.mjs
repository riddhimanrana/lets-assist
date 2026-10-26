import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
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
    if (args[0] === "diff") return "app/page.tsx";
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

test("reuses app and database evidence for only the reviewed controller paths", async () => {
  const base = fixture({ changedTree: true });
  const git = (...args) =>
    args[0] === "diff"
      ? ".github/workflows/deploy-schema.yml\nscripts/production/vercel-curl.sh\nscripts/production/hosted-acceptance-status-transport.test.mjs\ntests/e2e/csf/platform-landing-stability.spec.ts\nscripts/ci/pipeline-mode.test.mjs"
      : base.git(...args);
  assert.equal(
    (await verifySchemaReleaseCi(config, { ...base, git })).run,
    "42",
  );
  for (const path of [
    "app/globals.css",
    "supabase/migrations/new.sql",
    "bun.lock",
    "lib/plugins/private",
    "scripts/production/points-first-rollout.mjs",
  ]) {
    await assert.rejects(
      verifySchemaReleaseCi(config, {
        ...base,
        git: (...args) => (args[0] === "diff" ? path : base.git(...args)),
      }),
    );
  }
});

test("only exact rollout budget and duplicate-read transformations may differ from accepted source", async () => {
  const path = "scripts/production/points-first-rollout.mjs";
  const after = readFileSync(
    new URL("./points-first-rollout.mjs", import.meta.url),
    "utf8",
  );
  const before = after
    .replaceAll(
      "now() - startedAt < 12 * 60 * 1000,",
      "now() - startedAt < 8 * 60 * 1000,",
    )
    .replace('(mode === "plan" ? 2 : 16)', '(mode === "plan" ? 2 : 12)')
    .replace(
      "      const next = preparePointsFirstMigration(config.cwd, plan.state.versions);\n",
      "      const next = preparePointsFirstMigration(config.cwd, plan.state.versions);\n      verify(next.before);\n",
    )
    .replace(
      "      const observed = acknowledged\n        ? pointsFirstPlan(config.cwd, next.after.versions)\n        : readState();",
      "      const observed = readState();",
    );
  const base = fixture({ changedTree: true });
  const check = (prior, next) =>
    verifySchemaReleaseCi(config, {
      ...base,
      git: (...args) => {
        if (args[0] === "diff") return path;
        if (args[0] === "show")
          return args[1] === `${accepted}:${path}` ? prior : next;
        return base.git(...args);
      },
    });
  assert.equal((await check(before, after)).run, "42");
  for (const altered of [
    after + "\n",
    "// changed\n" + after,
    after.replace(
      "verifyProductionCheckout(config",
      "verifyProductionCheckout(otherConfig",
    ),
    after.replace("const deadline", "const unexpectedDeadline"),
    after.replace("      verify(observed.state);\n", ""),
    after.replace(
      "        : readState();",
      "        : pointsFirstPlan(config.cwd, next.after.versions);",
    ),
    after.replace("< 12 * 60", "< 13 * 60"),
    after.replace("? 2 : 16", "? 3 : 16"),
  ]) {
    await assert.rejects(check(before, altered));
  }
  await assert.rejects(check(after, after));
  await assert.rejects(check(before.replace("< 8 * 60", "< 7 * 60"), after));
});

test("the exact rollout regression test path remains a controller-only change", async () => {
  const base = fixture({ changedTree: true });
  assert.equal(
    (
      await verifySchemaReleaseCi(config, {
        ...base,
        git: (...args) =>
          args[0] === "diff"
            ? "scripts/production/points-first-rollout.test.mjs"
            : base.git(...args),
      })
    ).run,
    "42",
  );
});
