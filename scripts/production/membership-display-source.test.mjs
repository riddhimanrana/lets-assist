import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  membershipConfig,
  membershipPaths,
  membershipPolicy as p,
  hostedSteps,
  verifyMembershipHostedJob,
  verifyMembershipPaths,
  retainMembershipVerification,
  verifyMembershipDependencies,
  membershipDependencyHashes,
} from "./membership-display-source.mjs";

const sha = "a".repeat(40);
const env = () => ({
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_REPOSITORY: p.repository,
  GITHUB_REPOSITORY_ID: p.repositoryId,
  GITHUB_WORKFLOW_REF: p.repository + "/" + p.workflow + "@refs/heads/main",
  RELEASE_SHA: sha,
  GITHUB_SHA: sha,
  GITHUB_RUN_ID: "123",
  GH_TOKEN: "fictional-test-token",
  CONFIRMATION: "deploy-membership-display:" + sha,
  FIXTURE_CONFIRMATION: "test-existing-development-fixture:" + sha,
});
test("accepts only the exact protected Main dispatch and separate fixture scope", () => {
  assert.equal(membershipConfig(env()).sha, sha);
});
for (const [key, value] of Object.entries({
  GITHUB_ACTIONS: "false",
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_REF: "refs/heads/development",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_REPOSITORY: "other/repository",
  GITHUB_REPOSITORY_ID: "1",
  GITHUB_WORKFLOW_REF:
    p.repository + "/.github/workflows/deploy-app-only.yml@refs/heads/main",
  RELEASE_SHA: "b".repeat(40),
  GITHUB_SHA: "b".repeat(40),
  GITHUB_RUN_ID: "0",
  GH_TOKEN: "",
  CONFIRMATION: "deploy-app-only:" + sha,
  FIXTURE_CONFIRMATION: "",
}))
  test("refuses changed dispatch field " + key, () =>
    assert.throws(() => membershipConfig({ ...env(), [key]: value })),
  );

test("scope admits the complete reviewed controller/display set", () => {
  verifyMembershipPaths([...membershipPaths]);
  for (const path of membershipPaths)
    assert.throws(() =>
      verifyMembershipPaths(membershipPaths.filter((p) => p !== path)),
    );
});
for (const path of [
  "supabase/migrations/new.sql",
  "app/home/page.tsx",
  "bunfig.toml",
  "scripts/production/security-only-app-source.mjs",
  ".github/workflows/deploy-app-only.yml",
  "lib/plugins/private/other.ts",
])
  test("refuses additional source " + path, () =>
    assert.throws(() => verifyMembershipPaths([...membershipPaths, path])),
  );
test("refuses duplicate paths", () =>
  assert.throws(() =>
    verifyMembershipPaths([...membershipPaths.slice(1), membershipPaths[1]]),
  ));

test("dependency exception is bound to the exact reviewed package and lockfile bytes", () => {
  const root = new URL("../../", import.meta.url).pathname;
  verifyMembershipDependencies(root);
  assert.deepEqual(Object.keys(membershipDependencyHashes).sort(), [
    "bun.lock",
    "package.json",
  ]);
  for (const file of Object.keys(membershipDependencyHashes))
    assert.throws(() =>
      verifyMembershipDependencies(root, (target) => {
        const bytes = readFileSync(target);
        return target.endsWith("/" + file)
          ? Buffer.concat([bytes, Buffer.from("\n")])
          : bytes;
      }),
    );
});

function proof() {
  return {
    run: {
      id: 123,
      run_attempt: 1,
      path: p.workflow,
      event: "workflow_dispatch",
      head_sha: sha,
      head_branch: "main",
      status: "in_progress",
      conclusion: null,
      repository: { full_name: p.repository },
      head_repository: { full_name: p.repository },
    },
    jobs: [
      {
        name: p.hostedJob,
        status: "completed",
        conclusion: "success",
        steps: hostedSteps.map((name) => ({
          name,
          status: "completed",
          conclusion: "success",
        })),
      },
    ],
  };
}
test("requires actual completed hosted job within this exact active run", () => {
  const v = proof();
  verifyMembershipHostedJob(v.run, v.jobs, membershipConfig(env()));
});
for (const [key, value] of Object.entries({
  id: 124,
  run_attempt: 2,
  path: ".github/workflows/ci.yml",
  event: "push",
  head_sha: "b".repeat(40),
  head_branch: "development",
  status: "queued",
  repository: { full_name: "other/repo" },
  head_repository: { full_name: "other/repo" },
}))
  test("refuses false hosted-run identity " + key, () => {
    const v = proof();
    assert.throws(() =>
      verifyMembershipHostedJob(
        { ...v.run, [key]: value },
        v.jobs,
        membershipConfig(env()),
      ),
    );
  });
for (const name of hostedSteps)
  for (const conclusion of ["skipped", "failure", "cancelled"])
    test("refuses " + conclusion + " hosted step " + name, () => {
      const v = proof();
      v.jobs[0].steps.find((s) => s.name === name).conclusion = conclusion;
      assert.throws(() =>
        verifyMembershipHostedJob(v.run, v.jobs, membershipConfig(env())),
      );
    });
test("ordinary CI cannot substitute for the hosted job", () => {
  const v = proof();
  v.jobs[0].name = "full-quality";
  assert.throws(() =>
    verifyMembershipHostedJob(v.run, v.jobs, membershipConfig(env())),
  );
});
test("duplicate hosted jobs and duplicate completion steps are refused", () => {
  const v = proof();
  assert.throws(() =>
    verifyMembershipHostedJob(
      v.run,
      [...v.jobs, ...v.jobs],
      membershipConfig(env()),
    ),
  );
  v.jobs[0].steps.push(v.jobs[0].steps[0]);
  assert.throws(() =>
    verifyMembershipHostedJob(v.run, v.jobs, membershipConfig(env())),
  );
});
test("workflow preserves full acceptance and original staged rollback operations", () => {
  const file = (path) =>
    readFileSync(new URL("../../" + path, import.meta.url), "utf8");
  const next = file(".github/workflows/deploy-membership-display.yml");
  const old = file(".github/workflows/deploy-app-only.yml");
  assert.match(next, /environment: development/u);
  assert.match(next, /environment: production/u);
  assert.match(next, /needs: hosted-acceptance/u);
  assert.match(next, /CSF_HOSTED_ACCEPTANCE_MODE: full/u);
  assert.match(next, /bun run csf:test:hosted:load/u);
  assert.doesNotMatch(
    next,
    /provision-csf|csf:provision|security_only_confirmation|performance_waiver|local_validation/u,
  );
  const rollback = (s) =>
    s.slice(
      s.indexOf("      - name: Restore prior app if promotion does not settle"),
      s.indexOf("      - name: Record public release result"),
    );
  assert.ok(rollback(old).length > 1000);
  assert.equal(rollback(next), rollback(old));
  for (const name of hostedSteps) assert.ok(next.includes("- name: " + name));
});

const workflow = readFileSync(
  new URL(
    "../../.github/workflows/deploy-membership-display.yml",
    import.meta.url,
  ),
  "utf8",
);
test("both jobs validate trusted Main identity before checkout or any secret reference", () => {
  const blocks = workflow.matchAll(
    /- name: Validate trusted Main dispatch before checkout\n {8}working-directory: \.\n {8}shell: bash\n {8}run: \|\n((?: {10}.+\n)+)/gu,
  );
  const scripts = [...blocks].map((m) => m[1].replace(/^ {10}/gmu, ""));
  assert.equal(scripts.length, 2);
  assert.equal(scripts[0], scripts[1]);
  for (const job of workflow
    .split(/^ {2}(?:hosted-acceptance|deploy):$/gmu)
    .slice(1)) {
    const gate = job.indexOf(
      "- name: Validate trusted Main dispatch before checkout",
    );
    assert.ok(gate >= 0);
    assert.ok(gate < job.indexOf("actions/checkout@"));
    assert.ok(gate < job.indexOf("secrets."));
    assert.doesNotMatch(job.split("    steps:")[0], /secrets\.|github\.token/u);
  }
  assert.doesNotMatch(workflow, /ref: \$\{\{ inputs\.release_sha \}\}/u);
  assert.equal(
    (workflow.match(/ref: \$\{\{ github\.sha \}\}/gu) ?? []).length,
    3,
  );
  const run = (change = {}) =>
    spawnSync("bash", ["--noprofile", "--norc", "-c", scripts[0]], {
      env: { PATH: process.env.PATH, ...env(), ...change },
      encoding: "utf8",
    });
  assert.equal(run().status, 0);
  for (const change of [
    { RELEASE_SHA: "b".repeat(40) },
    { RELEASE_SHA: "$(exit 0)" },
    { GITHUB_SHA: "" },
    { GITHUB_REPOSITORY: "other/repo" },
    { GITHUB_REPOSITORY_ID: "1" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/development" },
    { GITHUB_RUN_ATTEMPT: "2" },
    { GITHUB_WORKFLOW_REF: "untrusted" },
    { CONFIRMATION: "" },
    { FIXTURE_CONFIRMATION: "" },
  ])
    assert.notEqual(run(change).status, 0, JSON.stringify(change));
});
test("Production must download this run's receipt and verify the same pinned baseline across its review wait", () => {
  const deploy = workflow.slice(workflow.indexOf("  deploy:"));
  const receipt = deploy.indexOf(
    "- name: Download immutable Preview receipt from this run",
  );
  const initial = deploy.indexOf(
    "- name: Verify pinned Production baseline after review",
  );
  const stage = deploy.indexOf(
    "- name: Recheck pinned Production baseline before staging",
  );
  const promote = deploy.indexOf(
    "- name: Recheck pinned Production baseline before promotion",
  );
  assert.ok(receipt > 0 && initial > receipt);
  assert.match(
    deploy.slice(receipt, initial),
    /name: membership-display-preview-\$\{\{ github.run_id \}\}/u,
  );
  assert.doesNotMatch(
    deploy.slice(receipt, initial),
    /run-id:|repository:|github-token:/u,
  );
  assert.ok(
    initial <
      deploy.indexOf("- name: Verify Production schema without writing"),
  );
  assert.ok(
    stage > initial &&
      stage < deploy.indexOf("- name: Create one Vercel-side Production build"),
  );
  assert.ok(
    promote > stage &&
      promote < deploy.indexOf("- name: Promote staged application"),
  );
  assert.equal(
    (deploy.match(/membership-display-preview\.mjs baseline/gu) ?? []).length,
    3,
  );
  assert.doesNotMatch(deploy, /Capture current Production alias/u);
});
test("successful source proof is retained as a required private JSON artifact", () => {
  const directory = mkdtempSync(join(tmpdir(), "membership-source-proof-"));
  try {
    const result = {
      sha,
      tree: "b".repeat(40),
      ciRun: "123",
      hosted: "verified",
    };
    retainMembershipVerification(directory, result);
    const file = join(directory, ".artifacts/source-verification.json");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), result);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.match(
      workflow,
      /if: steps.source.outcome == 'success'[\s\S]*?path: release\/\.artifacts\/source-verification\.json\n {10}include-hidden-files: true\n {10}if-no-files-found: error/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("receipt uploads explicitly include only their named hidden JSON file", () => {
  const paths = [
    ...workflow.matchAll(
      /path: ((?:release\/)?\.artifacts\/[^\n]+)\n {10}include-hidden-files: true/gu,
    ),
  ].map((m) => m[1]);
  assert.deepEqual(paths, [
    ".artifacts/membership-display-preview.json",
    "release/.artifacts/source-verification.json",
    "release/.artifacts/app-only-stage.json",
    "release/.artifacts/app-only-release.json",
  ]);
  assert.equal(
    (workflow.match(/uses: actions\/upload-artifact@/gu) ?? []).length,
    paths.length,
  );
});
