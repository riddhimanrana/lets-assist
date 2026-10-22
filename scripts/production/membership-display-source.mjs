import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { verifyExactFullCi } from "./security-only-app-source.mjs";

// A separate functional acceptance path. The security-only exception is unchanged.
export const membershipPolicy = Object.freeze({
  repository: "riddhimanrana/lets-assist",
  repositoryId: "713042374",
  baseline: "415b8060d2466924bbb7e9567920f57455dc0aa1",
  productionApp: "1e43cb58975f7a30c23404fd786a9fc55c208cee",
  development: "99adfc035773de6849676821fdc9032055f1f25f",
  privateBefore: "a1d5836fb800ad4afef7cfbfc6ed4a5f63e23f3d",
  privateAfter: "7ded413a51b1ef6cd66f6a754c7233394d094ebd",
  project: "prj_XUDpEktrouxF4dc2VGMegoL00dlE",
  team: "team_CjhwP5Wl7iAhbDrSFJRFxJjE",
  database: "ocbuygudvarsuxijxhau",
  workflow: ".github/workflows/deploy-membership-display.yml",
  hostedJob: "Hosted membership-display acceptance",
});

export const membershipPaths = Object.freeze([
  ".github/workflows/deploy-membership-display.yml",
  "docs/README.md",
  "docs/development/membership-display-hotfix.md",
  "lib/plugins/private",
  "scripts/hosted-development/membership-display-preview.mjs",
  "scripts/hosted-development/membership-display-preview.test.mjs",
  "scripts/hosted-development/test-csf-load.mjs",
  "scripts/production/membership-display-source.mjs",
  "scripts/production/membership-display-source.test.mjs",
  "scripts/vercel-build-policy.mjs",
]);
const privatePaths = [
  "plugins/dvhs-csf/components/CsfMemberProfileStatus.ts",
  "plugins/dvhs-csf/components/CsfProfileTermWorkspace.tsx",
  "plugins/dvhs-csf/components/csf-member-profile-decision.test.tsx",
  "plugins/dvhs-csf/components/csf-profile-default-term.test.ts",
];
export const hostedSteps = Object.freeze([
  "Verify exact hosted Preview before acceptance",
  "Run full hosted CSF acceptance",
  "Verify exact hosted Preview after acceptance",
  "Recheck source and Development baseline",
]);
const fail = () => {
  throw new Error("Exact membership-display release proof refused.");
};
export function verifyMembershipPaths(paths) {
  if (
    !Array.isArray(paths) ||
    new Set(paths).size !== paths.length ||
    paths.length !== membershipPaths.length ||
    membershipPaths.some((path) => !paths.includes(path))
  )
    fail();
}

export function membershipConfig(env) {
  const sha = env.RELEASE_SHA;
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_RUN_ATTEMPT !== "1" ||
    env.GITHUB_REPOSITORY !== membershipPolicy.repository ||
    env.GITHUB_REPOSITORY_ID !== membershipPolicy.repositoryId ||
    env.GITHUB_WORKFLOW_REF !==
      membershipPolicy.repository +
        "/" +
        membershipPolicy.workflow +
        "@refs/heads/main" ||
    !/^[a-f0-9]{40}$/u.test(sha ?? "") ||
    sha !== env.GITHUB_SHA ||
    !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID ?? "") ||
    env.CONFIRMATION !== "deploy-membership-display:" + sha ||
    env.FIXTURE_CONFIRMATION !== "test-existing-development-fixture:" + sha ||
    !env.GH_TOKEN
  )
    fail();
  return {
    sha,
    run: env.GITHUB_RUN_ID,
    githubToken: env.GH_TOKEN,
    repository: membershipPolicy.repository,
    releaseSha: sha,
  };
}

export function verifyMembershipCheckout(config, cwd, execute = execFileSync) {
  const git = (...args) =>
    execute("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (
    git("rev-parse", "HEAD") !== config.sha ||
    git("rev-parse", "origin/main") !== config.sha ||
    git("rev-parse", "origin/development") !== membershipPolicy.development ||
    git("status", "--porcelain", "--untracked-files=normal")
  )
    fail();
  git("merge-base", "--is-ancestor", membershipPolicy.baseline, config.sha);
  verifyMembershipPaths(
    git(
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      membershipPolicy.baseline,
      config.sha,
      "--",
    )
      .split("\0")
      .filter(Boolean),
  );
  if (
    git("rev-parse", membershipPolicy.baseline + ":lib/plugins/private") !==
      membershipPolicy.privateBefore ||
    git("rev-parse", "HEAD:lib/plugins/private") !==
      membershipPolicy.privateAfter ||
    git("-C", "lib/plugins/private", "rev-parse", "HEAD") !==
      membershipPolicy.privateAfter
  )
    fail();
  const changed = git(
    "-C",
    "lib/plugins/private",
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    membershipPolicy.privateBefore,
    membershipPolicy.privateAfter,
    "--",
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  if (JSON.stringify(changed) !== JSON.stringify([...privatePaths].sort()))
    fail();
  return {
    sha: config.sha,
    tree: git("rev-parse", "HEAD^{tree}"),
    private: membershipPolicy.privateAfter,
  };
}

export function verifyMembershipHostedJob(run, jobs, config) {
  if (
    String(run?.id) !== config.run ||
    run.run_attempt !== 1 ||
    run.path !== membershipPolicy.workflow ||
    run.event !== "workflow_dispatch" ||
    run.head_sha !== config.sha ||
    run.head_branch !== "main" ||
    run.repository?.full_name !== membershipPolicy.repository ||
    run.head_repository?.full_name !== membershipPolicy.repository ||
    !["in_progress", "completed"].includes(run.status) ||
    (run.status === "completed" && run.conclusion !== "success") ||
    !Array.isArray(jobs)
  )
    fail();
  const found = jobs.filter((job) => job.name === membershipPolicy.hostedJob);
  if (
    found.length !== 1 ||
    found[0].status !== "completed" ||
    found[0].conclusion !== "success" ||
    hostedSteps.some((name) => {
      const steps = found[0].steps?.filter((step) => step.name === name) ?? [];
      return (
        steps.length !== 1 ||
        steps[0].status !== "completed" ||
        steps[0].conclusion !== "success"
      );
    })
  )
    fail();
}

async function github(config, path, fetcher) {
  const response = await fetcher(
    "https://api.github.com/repos/" + membershipPolicy.repository + "/" + path,
    {
      headers: {
        Authorization: "Bearer " + config.githubToken,
        Accept: "application/vnd.github+json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) fail();
  return response.json();
}

export async function verifyMembershipRelease(
  config,
  cwd,
  mode,
  dependencies = {},
) {
  if (!["acceptance", "deploy"].includes(mode)) fail();
  const source = verifyMembershipCheckout(config, cwd, dependencies.execute);
  const fetcher = dependencies.fetcher ?? fetch;
  const main = await github(config, "branches/main", fetcher);
  const development = await github(config, "branches/development", fetcher);
  if (
    main.commit?.sha !== config.sha ||
    development.commit?.sha !== membershipPolicy.development
  )
    fail();
  const ciRun = await (dependencies.fullCi ?? verifyExactFullCi)(
    config,
    dependencies.fetcher,
  );
  if (mode === "deploy") {
    const run = await github(config, "actions/runs/" + config.run, fetcher);
    const result = await github(
      config,
      "actions/runs/" + config.run + "/jobs?per_page=100",
      fetcher,
    );
    if (result.total_count !== result.jobs?.length) fail();
    verifyMembershipHostedJob(run, result.jobs, config);
  }
  return {
    ...source,
    ciRun,
    hosted: mode === "deploy" ? "full-immutable-preview-verified" : "pending",
    productionSchema: 688,
    productionWrites: "none",
  };
}

export function retainMembershipVerification(cwd, result) {
  const directory = resolve(cwd, ".artifacts");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(
    resolve(directory, "source-verification.json"),
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const config = membershipConfig(process.env);
    const result = await verifyMembershipRelease(
      config,
      process.cwd(),
      process.argv[2],
    );
    retainMembershipVerification(process.cwd(), result);
    console.log(JSON.stringify(result));
  } catch {
    console.error(
      "Membership-display source/acceptance proof failed; raw details suppressed.",
    );
    process.exitCode = 1;
  }
}
