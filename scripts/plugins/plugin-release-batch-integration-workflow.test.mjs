import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { batchFixture } from "./private-release-batch.fixture.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const workflow = readFileSync(
  join(
    repositoryRoot,
    ".github/workflows/plugin-release-batch-integration.yml",
  ),
  "utf8",
);
const caller = readFileSync(
  join(repositoryRoot, ".github/workflows/plugin-release-integration.yml"),
  "utf8",
);
const names = {
  input: "Validate the manual batch request",
  authority: "Authorize the existing Development pull request",
  download: "Download each known release asset",
  inspect: "Inspect the untrusted common source claim",
  integrate: "Verify every signed release before batch integration",
  validate: "Validate and commit the generated batch",
  publish: "Recheck authority and advance only the reviewed branch",
};
const script = (name, source = workflow) => {
  const section = source.split(`      - name: ${name}\n`)[1];
  assert(section, `missing workflow step: ${name}`);
  const lines = section.split("run: |\n")[1].split("\n");
  const end = lines.findIndex(
    (line) => line.trim() && !line.startsWith("          "),
  );
  return lines
    .slice(0, end < 0 ? undefined : end)
    .join("\n")
    .replace(/^ {10}/gm, "");
};
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const tags = ["first-plugin/v1.0.1", "second-plugin/v1.0.1"];
const branch = "codex/reviewed-batch";
const repository = "riddhimanrana/lets-assist";
const privateRepository = `${repository}-plugins`;
const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();

function executable(path, source) {
  writeFileSync(path, `#!${process.execPath}\n${source}`);
  chmodSync(path, 0o755);
}

function run(name, directory, env) {
  return spawnSync("bash", ["-c", script(name)], {
    cwd: directory,
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, ...env },
  });
}

function request(overrides = {}) {
  return {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: repository,
    ROOT_REPOSITORY: repository,
    PRIVATE_REPOSITORY: privateRepository,
    GITHUB_SHA: "a".repeat(40),
    CANDIDATE_SHA: "a".repeat(40),
    EXISTING_PR_NUMBER: "867",
    GITHUB_REF_NAME: branch,
    GITHUB_REF: `refs/heads/${branch}`,
    RELEASE_TAGS: JSON.stringify(tags),
    GH_TOKEN: "fictional-local-token",
    ...overrides,
  };
}

function authorityFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "batch-workflow-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const remote = join(directory, "remote.git"),
    work = join(directory, "work"),
    bin = join(directory, "bin");
  mkdirSync(work);
  mkdirSync(bin);
  git(directory, "init", "--bare", remote);
  git(work, "init", "-b", "development");
  git(work, "config", "user.name", "Synthetic workflow test");
  git(work, "config", "user.email", "workflow@local.test");
  writeFileSync(join(work, "fixture.txt"), "base\n");
  git(work, "add", ".");
  git(work, "commit", "-m", "base");
  const development = git(work, "rev-parse", "HEAD");
  git(work, "switch", "-c", branch);
  writeFileSync(join(work, "fixture.txt"), "candidate\n");
  git(work, "commit", "-am", "candidate");
  const candidate = git(work, "rev-parse", "HEAD");
  git(work, "push", remote, "development", `${candidate}:refs/heads/${branch}`);
  writeFileSync(join(work, "fixture.txt"), "verified batch\n");
  git(work, "commit", "-am", "result");
  const result = git(work, "rev-parse", "HEAD");
  const forward = git(
    work,
    "commit-tree",
    `${result}^{tree}`,
    "-p",
    candidate,
    "-m",
    "competing writer",
  );
  git(work, "push", remote, `${forward}:refs/testing/competing`);
  const pr = {
    number: 867,
    state: "open",
    merged: false,
    head: { ref: branch, sha: candidate, repo: { full_name: repository } },
    base: {
      ref: "development",
      sha: development,
      repo: { full_name: repository },
    },
  };
  const prPath = join(directory, "pr.json"),
    openPath = join(directory, "open.json"),
    calls = join(directory, "calls.jsonl");
  writeFileSync(prPath, JSON.stringify(pr));
  writeFileSync(openPath, "[[]]");
  executable(
    join(bin, "gh"),
    `
const fs = require('node:fs'), cp = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(['gh', ...args])+'\\n');
if (args[0] === 'auth' && args[1] === 'setup-git') process.exit(0);
if (args[0] !== 'api') process.exit(90);
if (args.includes('--paginate')) { process.stdout.write(fs.readFileSync(process.env.TEST_OPEN)); process.exit(0); }
const pr = JSON.parse(fs.readFileSync(process.env.TEST_PR));
if (fs.existsSync(process.env.TEST_PUSHED)) {
  const count = Number(fs.readFileSync(process.env.TEST_PUSHED, 'utf8'));
  fs.writeFileSync(process.env.TEST_PUSHED, String(count + 1));
  if (count > Number(process.env.TEST_STALE_READS ?? 0)) pr.head.sha = cp.execFileSync(process.env.TEST_GIT, ['--git-dir',process.env.TEST_REMOTE,'rev-parse','refs/heads/'+process.env.GITHUB_REF_NAME],{encoding:'utf8'}).trim();
  if (process.env.TEST_POST_PUSH_HEAD) pr.head.sha = process.env.TEST_POST_PUSH_HEAD;
}
process.stdout.write(JSON.stringify(pr));
`,
  );
  executable(
    join(bin, "git"),
    `
const fs = require('node:fs'), cp = require('node:child_process');
const args = process.argv.slice(2).map(a => a === 'https://github.com/riddhimanrana/lets-assist.git' ? process.env.TEST_REMOTE : a);
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(['git', ...args])+'\\n');
if (args[0] === 'push' && process.env.TEST_RACE_SHA) cp.execFileSync(process.env.TEST_GIT,['--git-dir',process.env.TEST_REMOTE,'update-ref','refs/heads/'+process.env.GITHUB_REF_NAME,process.env.TEST_RACE_SHA]);
const result = cp.spawnSync(process.env.TEST_GIT,args,{stdio:'inherit'});
if(args[0] === 'push' && result.status === 0) fs.writeFileSync(process.env.TEST_PUSHED,'1');
process.exit(result.status ?? 91);
`,
  );
  const env = request({
    GITHUB_SHA: candidate,
    CANDIDATE_SHA: candidate,
    RESULT_SHA: result,
    PATH: `${bin}:${process.env.PATH}`,
    TEST_PR: prPath,
    TEST_OPEN: openPath,
    TEST_CALLS: calls,
    TEST_PUSHED: join(directory, "pushed"),
    TEST_REMOTE: remote,
    TEST_GIT: realGit,
  });
  return {
    directory,
    work,
    bin,
    remote,
    candidate,
    result,
    development,
    pr,
    prPath,
    openPath,
    calls,
    env,
    forward,
    remoteHead: () =>
      git(directory, "--git-dir", remote, "rev-parse", `refs/heads/${branch}`),
    called: () =>
      existsSync(calls)
        ? readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse)
        : [],
  };
}

test("manual request requires the reviewed workflow revision and bounded unique embedded tags", () => {
  assert.equal(run(names.input, repositoryRoot, request()).status, 0);
  for (const bad of [
    { GITHUB_EVENT_NAME: "repository_dispatch" },
    { GITHUB_REPOSITORY: "foreign/root" },
    { CANDIDATE_SHA: "b".repeat(40) },
    { CANDIDATE_SHA: "development" },
    { CANDIDATE_SHA: `${"a".repeat(40)}\nref=main` },
    { EXISTING_PR_NUMBER: "" },
    { EXISTING_PR_NUMBER: "0" },
    { EXISTING_PR_NUMBER: "867; echo bad" },
    { GITHUB_REF_NAME: "main" },
    { GITHUB_REF_NAME: "development" },
    { GITHUB_REF: `refs/tags/${branch}` },
    { RELEASE_TAGS: "not-json" },
    { RELEASE_TAGS: JSON.stringify([tags[0]]) },
    { RELEASE_TAGS: JSON.stringify([tags[0], tags[0]]) },
    { RELEASE_TAGS: JSON.stringify([tags[0], "first-plugin/v1.0.2"]) },
    { RELEASE_TAGS: JSON.stringify([tags[0], "second-plugin/v01.0.1"]) },
    { RELEASE_TAGS: JSON.stringify([tags[0], "second-plugin/v1.0.1-rc1"]) },
    { RELEASE_TAGS: JSON.stringify([tags[0], "$(touch injected)/v1.0.1"]) },
    {
      RELEASE_TAGS: JSON.stringify(
        Array.from({ length: 17 }, (_, i) => `plugin-${i}/v1.0.1`),
      ),
    },
  ])
    assert.notEqual(
      run(names.input, repositoryRoot, request(bad)).status,
      0,
      JSON.stringify(bad),
    );
});

test(
  "both authority checks refuse changed PR identity, base, head, state or competing integration",
  { timeout: 30_000 },
  (t) => {
    const f = authorityFixture(t);
    for (const step of [names.authority, names.publish]) {
      git(
        f.work,
        "checkout",
        "--detach",
        step === names.authority ? f.candidate : f.result,
      );
      for (const modify of [
        (p) => (p.number = 868),
        (p) => (p.state = "closed"),
        (p) => (p.merged = true),
        (p) => (p.head.repo.full_name = "foreign/root"),
        (p) => (p.base.repo.full_name = "foreign/root"),
        (p) => (p.head.ref = "codex/other"),
        (p) => (p.head.sha = "b".repeat(40)),
        (p) => (p.base.ref = "main"),
        (p) => (p.base.sha = "c".repeat(40)),
      ]) {
        const p = structuredClone(f.pr);
        modify(p);
        writeFileSync(f.prPath, JSON.stringify(p));
        assert.notEqual(run(step, f.work, f.env).status, 0, step);
        assert.equal(f.remoteHead(), f.candidate);
      }
      writeFileSync(f.prPath, JSON.stringify(f.pr));
      writeFileSync(
        f.openPath,
        JSON.stringify([
          [{ number: 999, head: { ref: "codex/plugin-release-other" } }],
        ]),
      );
      assert.notEqual(run(step, f.work, f.env).status, 0);
      assert.equal(f.remoteHead(), f.candidate);
      writeFileSync(f.openPath, "[[]]");
    }
    assert(!f.called().some((args) => args[0] === "git" && args[1] === "push"));
  },
);

test("the valid authority proof permits only the exact descendant result on the existing branch", (t) => {
  const f = authorityFixture(t);
  git(f.work, "checkout", "--detach", f.candidate);
  assert.equal(run(names.authority, f.work, f.env).status, 0);
  git(f.work, "checkout", "--detach", f.result);
  const result = run(names.publish, f.work, f.env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.remoteHead(), f.result);
  const pushes = f
    .called()
    .filter((args) => args[0] === "git" && args[1] === "push");
  assert.equal(pushes.length, 1);
  assert(
    pushes[0].includes(
      `--force-with-lease=refs/heads/${branch}:${f.candidate}`,
    ),
  );
  assert(pushes[0].includes(`${f.result}:refs/heads/${branch}`));
  assert(
    !f
      .called()
      .some((args) => args[0] === "gh" && ["pr", "release"].includes(args[1])),
  );
});

test("post-push verification waits for a stale PR head without publishing twice", (t) => {
  const f = authorityFixture(t);
  const result = run(names.publish, f.work, {
    ...f.env,
    TEST_STALE_READS: "1",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.remoteHead(), f.result);
  assert.equal(
    f.called().filter((args) => args[0] === "git" && args[1] === "push").length,
    1,
  );
});

test("post-push verification refuses a competing PR head", (t) => {
  const f = authorityFixture(t);
  const result = run(names.publish, f.work, {
    ...f.env,
    TEST_POST_PUSH_HEAD: f.forward,
  });
  assert.notEqual(result.status, 0);
  assert.equal(f.remoteHead(), f.result);
  assert.equal(
    f.called().filter((args) => args[0] === "git" && args[1] === "push").length,
    1,
  );
});

for (const race of ["forward", "rewind"])
  test(`atomic expected-head lease rejects a ${race} race after readback`, (t) => {
    const f = authorityFixture(t);
    const raced = race === "rewind" ? f.development : f.forward;
    const result = run(names.publish, f.work, {
      ...f.env,
      TEST_RACE_SHA: raced,
    });
    assert.notEqual(result.status, 0);
    assert.equal(f.remoteHead(), raced);
    assert.equal(
      f.called().filter((args) => args[0] === "git" && args[1] === "push")
        .length,
      1,
    );
    assert.match(result.stderr, /stale info|rejected/u);
  });

test("absent branch and a non-descendant generated result fail before push", (t) => {
  const f = authorityFixture(t);
  git(
    f.directory,
    "--git-dir",
    f.remote,
    "update-ref",
    "-d",
    `refs/heads/${branch}`,
  );
  assert.notEqual(run(names.publish, f.work, f.env).status, 0);
  git(f.work, "checkout", "--detach", f.development);
  assert.notEqual(
    run(names.publish, f.work, { ...f.env, RESULT_SHA: f.development }).status,
    0,
  );
  assert(!f.called().some((args) => args[0] === "git" && args[1] === "push"));
});

function releaseFixture(t) {
  const f = batchFixture();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const directory = join(f.root, ".artifacts/plugin-release-batch"),
    bin = join(f.root, "bin");
  mkdirSync(directory, { recursive: true });
  mkdirSync(bin);
  mkdirSync(join(f.root, "scripts/plugins"), { recursive: true });
  for (const file of [
    "integrate-private-release-batch.mjs",
    "integrate-private-release.mjs",
    "private-release-publication.mjs",
    "release-serving-contracts.mjs",
  ]) {
    copyFileSync(
      join(repositoryRoot, "scripts/plugins", file),
      join(f.root, "scripts/plugins", file),
    );
  }
  mkdirSync(join(f.root, "lib/plugins"), { recursive: true });
  symlinkSync(f.privateRoot, join(f.root, "lib/plugins/private"));
  symlinkSync(
    f.registryPath,
    join(f.root, "lib/plugins/published-releases.json"),
  );
  const rows = JSON.parse(readFileSync(f.releasesPath, "utf8"));
  writeFileSync(join(directory, "releases.json"), JSON.stringify(rows));
  return {
    ...f,
    rows,
    directory,
    bin,
    env: request({
      PATH: `${bin}:${process.env.PATH}`,
      SERVING_PRIVATE_COMMIT: f.servingPrivateCommit,
      GITHUB_OUTPUT: join(f.root, "output"),
    }),
  };
}

test("the real inspector refuses mismatched signed source claims before checkout outputs", (t) => {
  const f = releaseFixture(t);
  const manifest = JSON.parse(readFileSync(f.rows[1].manifestPath, "utf8"));
  manifest.sourceCommit = "b".repeat(40);
  writeFileSync(f.rows[1].manifestPath, JSON.stringify(manifest));
  const result = run(names.inspect, f.root, f.env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /same exact private source/u);
  assert(!existsSync(f.env.GITHUB_OUTPUT));
});

test("a missing signature bundle refuses the real integration before registry or ledger writes", (t) => {
  const f = releaseFixture(t);
  const before = readFileSync(f.registryPath, "utf8"),
    ledger = readdirSync(f.migrationsDir);
  rmSync(f.rows[1].bundlePath);
  const result = run(names.integrate, f.root, f.env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing release asset: bundlePath/u);
  assert.equal(readFileSync(f.registryPath, "utf8"), before);
  assert.deepEqual(readdirSync(f.migrationsDir), ledger);
});

test("a rejected Cosign identity refuses the real integration before any host write", (t) => {
  const f = releaseFixture(t);
  executable(join(f.bin, "cosign"), "process.exit(1);\n");
  const before = readFileSync(f.registryPath, "utf8"),
    ledger = readdirSync(f.migrationsDir);
  const result = run(names.integrate, f.root, f.env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /signature verification failed/u);
  assert.equal(readFileSync(f.registryPath, "utf8"), before);
  assert.deepEqual(readdirSync(f.migrationsDir), ledger);
});

test("download refuses missing bundles and unreviewed checksum paths", (t) => {
  const f = authorityFixture(t);
  const assets = join(f.directory, "assets");
  mkdirSync(assets);
  const known = [
    "release-manifest.json",
    "release.cdx.json",
    "release-manifest.sigstore.json",
  ];
  for (const asset of known) writeFileSync(join(assets, asset), "synthetic\n");
  const checks = known.map(
    (asset) =>
      `${createHash("sha256")
        .update(readFileSync(join(assets, asset)))
        .digest("hex")}  ${asset}`,
  );
  writeFileSync(join(assets, "SHA256SUMS"), checks.join("\n") + "\n");
  executable(
    join(f.bin, "gh"),
    `
const fs=require('node:fs'),path=require('node:path');const a=process.argv.slice(2);
if(a[0]!=='release'||a[1]!=='download'||a[a.indexOf('--repo')+1]!=='riddhimanrana/lets-assist-plugins')process.exit(90);
const name=a[a.indexOf('--pattern')+1];if(name===process.env.TEST_MISSING)process.exit(0);
fs.copyFileSync(path.join(process.env.TEST_ASSETS,name),path.join(a[a.indexOf('--dir')+1],name));
`,
  );
  const env = { ...f.env, TEST_ASSETS: assets };
  assert.notEqual(
    run(names.download, f.work, {
      ...env,
      TEST_MISSING: "release-manifest.sigstore.json",
    }).status,
    0,
  );
  rmSync(join(f.work, ".artifacts"), { recursive: true, force: true });
  writeFileSync(
    join(assets, "SHA256SUMS"),
    checks
      .slice(0, 2)
      .concat(`${"0".repeat(64)}  ../../outside`)
      .join("\n") + "\n",
  );
  const result = run(names.download, f.work, env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown checksum asset path/u);
});

test("workflow preserves single-release serialization, pinned actions and credential boundaries", () => {
  assert.match(caller, /group: plugin-release-integration\n/u);
  assert.doesNotMatch(caller + workflow, /default: ["']867["']/u);
  assert.doesNotMatch(workflow, /^concurrency:/mu);
  assert.match(workflow, /^ {2}workflow_call:/mu);
  assert.match(
    caller,
    /uses: \.\/\.github\/workflows\/plugin-release-batch-integration\.yml/u,
  );
  assert.match(workflow, /pull-requests: read/u);
  assert.doesNotMatch(
    workflow,
    /repository_dispatch:|pull_request_target:|gh pr create|gh pr merge|--base main/u,
  );
  const pins = [...workflow.matchAll(/uses: ([^\n ]+)/gu)].map(
    (match) => match[1],
  );
  assert(pins.length >= 5 && pins.every((pin) => /@[a-f0-9]{40}$/.test(pin)));
  assert.equal(
    (workflow.match(/persist-credentials: false/gu) ?? []).length,
    2,
  );
  for (const name of Object.values(names))
    assert.doesNotMatch(script(name), /\$\{\{/u);
  assert(workflow.indexOf(names.integrate) < workflow.indexOf(names.validate));
  assert(workflow.indexOf(names.validate) < workflow.indexOf(names.publish));
  assert.match(script(names.validate), /plugin:surface:generate/u);
  assert.match(script(names.validate), /plugin:check:boundary/u);
  assert.match(script(names.validate), /Unexpected source change/u);
  assert.doesNotMatch(
    script(names.integrate),
    /GH_TOKEN|PRIVATE_PLUGIN_RELEASE_TOKEN/u,
  );
  assert.doesNotMatch(
    script(names.publish),
    /git push --force(?: |$)|\+\$RESULT_SHA/u,
  );
});

test("the registered caller routes one manual mode and preserves automatic single release", () => {
  const directory = mkdtempSync(join(tmpdir(), "batch-workflow-routing-"));
  const output = join(directory, "output");
  try {
    for (const [event, single, batch, expected] of [
      ["workflow_dispatch", tags[0], "", "single"],
      ["workflow_dispatch", "", JSON.stringify(tags), "batch"],
      ["repository_dispatch", "", "", "single"],
      ["repository_dispatch", "", "ignored dispatch metadata", "single"],
      ["workflow_dispatch", "", "", null],
      ["workflow_dispatch", tags[0], JSON.stringify(tags), null],
      ["pull_request", tags[0], "", null],
    ]) {
      rmSync(output, { force: true });
      const result = spawnSync(
        "bash",
        ["-c", script("Choose the integration mode", caller)],
        {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            GITHUB_EVENT_NAME: event,
            SINGLE_TAG: single,
            BATCH_TAGS: batch,
            GITHUB_OUTPUT: output,
          },
        },
      );
      if (expected) {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(readFileSync(output, "utf8").trim(), `mode=${expected}`);
      } else {
        assert.notEqual(result.status, 0);
        assert(!existsSync(output));
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Development advancing beyond the reviewed candidate invalidates both authority checks", (t) => {
  const f = authorityFixture(t);
  git(f.work, "push", f.remote, `${f.result}:refs/heads/development`);
  for (const step of [names.authority, names.publish]) {
    git(
      f.work,
      "checkout",
      "--detach",
      step === names.authority ? f.candidate : f.result,
    );
    const result = run(step, f.work, f.env);
    assert.notEqual(result.status, 0);
    assert.equal(f.remoteHead(), f.candidate);
  }
  assert(!f.called().some((args) => args[0] === "git" && args[1] === "push"));
});
