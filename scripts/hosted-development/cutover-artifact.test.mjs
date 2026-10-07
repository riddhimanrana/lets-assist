import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cutoverConfig,
  digest,
  loadPreparation,
  target,
} from "./cutover-authority.mjs";
import {
  candidate,
  clock,
  environment,
  merged,
  preparedReceipt,
} from "./cutover.fixture.mjs";

function artifactFixture(options = {}) {
  const config = cutoverConfig(
    environment(options.recovery ? "recover" : "complete"),
  );
  const receipt = { ...preparedReceipt(), ...options.receipt };
  const directory = mkdtempSync(join(tmpdir(), "cutover-artifact-test-"));
  let archive;
  try {
    writeFileSync(
      join(directory, "development-cutover.json"),
      JSON.stringify(receipt),
    );
    const names = ["development-cutover.json"];
    if (options.extraFile) {
      names.push("extra.json");
      writeFileSync(join(directory, "extra.json"), "{}");
    }
    execFileSync("zip", ["-q", "receipt.zip", ...names], { cwd: directory });
    archive = readFileSync(join(directory, "receipt.zip"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const artifact = {
    id: 77,
    name: "development-cutover-100",
    digest: `sha256:${digest(archive)}`,
    expired: false,
    size_in_bytes: archive.length,
    ...options.artifact,
  };
  const run = {
    head_sha: receipt.controller,
    path: target.workflow,
    event: "workflow_dispatch",
    run_attempt: 1,
    status: "completed",
    conclusion: "success",
    repository: { id: target.repositoryId },
    ...options.run,
  };
  const read = async (path) => {
    if (path.endsWith("/artifacts?per_page=100"))
      return { total_count: 1, artifacts: options.artifacts || [artifact] };
    if (path === "/pulls/867")
      return {
        merged: true,
        merge_commit_sha: merged,
        head: { sha: candidate, repo: { id: target.repositoryId } },
        base: { ref: target.branch, repo: { id: target.repositoryId } },
      };
    if (path.startsWith("/commits/"))
      return {
        sha: path.slice(9),
        commit: { tree: { sha: receipt.tree } },
        parents: [{ sha: receipt.base }, { sha: candidate }],
      };
    return run;
  };
  const requests = [];
  const fetcher = async (url, settings) => {
    requests.push({ url: String(url), settings });
    return String(url).startsWith("https://api.github.com/")
      ? new Response(null, {
          status: 302,
          headers: {
            location:
              options.redirect ||
              "https://fixture.blob.core.windows.net/artifact?synthetic=1",
          },
        })
      : new Response(options.bytes || archive);
  };
  return { config, read, fetcher, receipt, requests };
}

test("preparation uses immutable ZIP digest, exact file and GitHub run identity", async () => {
  const f = artifactFixture();
  const receipt = await loadPreparation(f.config, f.read, f.fetcher, clock);
  assert.equal(receipt.candidate, candidate);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].settings.redirect, "manual");
  assert.equal(f.requests[1].settings.redirect, "error");
  assert.equal(f.requests[1].settings.headers, undefined);
});

for (const [name, options] of [
  ["missing artifact", { artifacts: [] }],
  ["expired artifact", { artifact: { expired: true } }],
  ["missing digest", { artifact: { digest: undefined } }],
  ["tampered digest", { artifact: { digest: `sha256:${"a".repeat(64)}` } }],
  ["wrong source run", { run: { head_sha: merged } }],
  ["wrong workflow", { run: { path: ".github/workflows/foreign.yml" } }],
  ["rerun artifact", { run: { run_attempt: 2 } }],
  ["failed preparation", { run: { conclusion: "failure" } }],
  ["running preparation", { run: { status: "in_progress" } }],
  ["foreign repository", { run: { repository: { id: 1 } } }],
  [
    "foreign download origin",
    { redirect: "https://attacker.test/archive.zip" },
  ],
  [
    "credential-bearing redirect",
    { redirect: "https://user:secret@fixture.blob.core.windows.net/archive" },
  ],
  ["extra archive member", { extraFile: true }],
  ["wrong receipt database", { receipt: { database: "fotdmeakexgrkronxlof" } }],
  ["wrong receipt candidate", { receipt: { candidate: merged } }],
  [
    "self-claimed foreign merged controller",
    {
      recovery: true,
      receipt: { controller: "f".repeat(40), merged: "f".repeat(40) },
    },
  ],
  ["expired preparation", { receipt: { expiresAt: clock - 1 } }],
])
  test(`artifact boundary refuses ${name}`, async () => {
    const f = artifactFixture(options);
    await assert.rejects(loadPreparation(f.config, f.read, f.fetcher, clock));
  });

test("recovery may consume a failed complete artifact only with its exact merged controller", async () => {
  const f = artifactFixture({
    recovery: true,
    run: { conclusion: "failure" },
    receipt: {
      controller: merged,
      merged,
      phase: "recovered",
      recovery: "maintenance-with-postgrest-read-only",
    },
  });
  assert.equal(
    (await loadPreparation(f.config, f.read, f.fetcher, clock)).controller,
    merged,
  );
  const wrong = artifactFixture({
    recovery: true,
    run: { conclusion: "failure" },
    receipt: { controller: merged },
  });
  await assert.rejects(
    loadPreparation(wrong.config, wrong.read, wrong.fetcher, clock),
  );
});
