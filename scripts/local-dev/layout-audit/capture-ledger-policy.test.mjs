import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { verifyCaptureLedger } from "./capture-ledger-policy.mjs";

const binding = createRequire(import.meta.url)("./linux-binding.cjs");

const rows = Array.from(
  { length: 740 },
  (_, index) =>
    `100644 blob ${String(index).padStart(40, "0")}\tsupabase/migrations/${String(index).padStart(14, "0")}_fictional.sql`,
);
const digest = (values) =>
  createHash("sha256")
    .update(values.join("\n") + "\n")
    .digest("hex");
const policy = {
  ledgerCount: 723,
  targetLedgerCount: 740,
  ledgerGitObjectListSha256: digest(rows.slice(0, 723)),
  targetLedgerGitObjectListSha256: digest(rows),
};

test("the reviewed suffix preserves and separately verifies the immutable prefix", () => {
  assert.doesNotThrow(() => verifyCaptureLedger(policy, rows));
  const changedPrefix = [...rows];
  changedPrefix[12] = changedPrefix[12].replace("100644", "100755");
  assert.throws(() =>
    verifyCaptureLedger(
      { ...policy, targetLedgerGitObjectListSha256: digest(changedPrefix) },
      changedPrefix,
    ),
  );
});

test("the CI wrapper and frozen helper manifest bind the same reviewed private source", () => {
  const policy = JSON.parse(
    readFileSync(new URL("./baseline-policy.json", import.meta.url), "utf8"),
  );
  const wrapper = readFileSync(
    new URL("../layout-audit-ci.sh", import.meta.url),
    "utf8",
  );
  const privatePins = [
    ...wrapper.matchAll(/privateHead:'([a-f0-9]{40})'/gu),
  ].map((match) => match[1]);
  assert.deepEqual(privatePins, [policy.targetPrivateGitlink]);
  const workflow = readFileSync(
    new URL("../../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const manifestPin = workflow.match(
    /LAYOUT_AUDIT_CODE_MANIFEST_SHA256: "([a-f0-9]{64})"/u,
  )?.[1];
  assert.equal(
    manifestPin,
    createHash("sha256")
      .update(readFileSync(new URL("./code-manifest.sha256", import.meta.url)))
      .digest("hex"),
  );
});

test("the old ledger and unknown additions, suffix bytes or ordering cannot acquire capture approval", () => {
  for (const altered of [
    rows.slice(0, 723),
    rows.slice(0, 725),
    rows.slice(0, 728),
    rows.slice(0, 729),
    rows.slice(0, 732),
    [...rows, rows[0]],
    [...rows].reverse(),
    null,
  ])
    assert.throws(() => verifyCaptureLedger(policy, altered));
  for (let index = 723; index < rows.length; index++) {
    const altered = [...rows];
    altered[index] = altered[index].replace("100644", "100755");
    assert.throws(() => verifyCaptureLedger(policy, altered));
  }
  assert.throws(() =>
    verifyCaptureLedger({ ...policy, targetLedgerCount: 741 }, rows),
  );
  assert.throws(() =>
    verifyCaptureLedger({ ...policy, ledgerCount: 722 }, rows),
  );
});

test("the committed migration objects match the reviewed 723 plus 17 source policy", () => {
  const reviewed = JSON.parse(
    readFileSync(new URL("./baseline-policy.json", import.meta.url), "utf8"),
  );
  const committed = execFileSync(
    "git",
    ["ls-tree", "-r", "HEAD", "--", "supabase/migrations"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter((row) => row.endsWith(".sql"));
  assert.equal(
    reviewed.privateGitlink,
    "38dc7c7aff6fd101c87f92eebfae822d1726f2b4",
  );
  assert.equal(
    reviewed.targetPrivateGitlink,
    "8c84d616e4afee34dcd71ede2cb9fdb9af528ac0",
  );
  assert.equal(committed.length, 740);
  assert.doesNotThrow(() => verifyCaptureLedger(reviewed, committed));
});

// The ledger above is immutable history; capture permission is a separate,
// frozen grant. An ordinary candidate with a newer private gitlink must still
// build and test, but the real binding guard must refuse it for capture.
test("only the frozen private gitlink passes the capture binding shape", () => {
  const reviewed = JSON.parse(
    readFileSync(new URL("./baseline-policy.json", import.meta.url), "utf8"),
  );
  const proofs = [
    "static-image-source-proof.json",
    "next-title-source-proof.json",
    "runtime-cache-source-proof.json",
    "read-action-source-review.json",
    "private-next-title-source-proof.json",
  ];
  const approved = {
    schema: "lets-assist-layout-linux-binding-v1",
    template: true,
    materialized: false,
    testOnly: true,
    repoRoot: "/OFFLINE_ONLY/repo",
    rootHead: "1".repeat(40),
    privateHead: reviewed.targetPrivateGitlink,
    ledgerCount: reviewed.targetLedgerCount,
    codeManifestSha256: "2".repeat(64),
    dirtyDiffSha256: "3".repeat(64),
    capturePaths: ["/"],
    reviewedSourceHashes: {},
    uid: 0,
    runId: "ci00000000000000",
    projectId: "lets-assist-csf-browser-ci00000000000000",
    workDir: "/tmp/lets-assist-csf-browser-ci00000000000000",
    appPort: 3000,
    privateAppPort: 3001,
    apiPort: 25321,
    databasePort: 25322,
    databaseVolume: "OFFLINE_ONLY",
    node: { path: "/OFFLINE_ONLY/node", sha256: "4".repeat(64) },
    script: {
      path: "/OFFLINE_ONLY/repo/scripts/local-dev/run-dvhs-csf-isolated-app.mjs",
      sha256: "5".repeat(64),
    },
    captureTemplateFile: "/OFFLINE_ONLY/template.json",
    captureTemplateSha256: "6".repeat(64),
    proofHashes: Object.fromEntries(
      proofs.map((name) => [name, "7".repeat(64)]),
    ),
  };
  // The control passes, so each refusal below is the private identity alone.
  assert.equal(
    binding.shape(structuredClone(approved)).privateHead,
    approved.privateHead,
  );
  const committedPrivate = execFileSync(
    "git",
    ["rev-parse", "HEAD:lib/plugins/private"],
    { encoding: "utf8" },
  ).trim();
  for (const privateHead of new Set([
    "b3369ad397cb907ca6f6462d92708ab849773644",
    reviewed.privateGitlink,
    "f".repeat(40),
    committedPrivate,
  ])) {
    if (privateHead === reviewed.targetPrivateGitlink) continue;
    assert.throws(
      () => binding.shape({ ...structuredClone(approved), privateHead }),
      /capture proof refused/u,
      `private head ${privateHead} must not acquire capture permission`,
    );
  }
});
