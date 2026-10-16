import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyCaptureLedger } from "./capture-ledger-policy.mjs";

const rows = Array.from(
  { length: 739 },
  (_, index) =>
    `100644 blob ${String(index).padStart(40, "0")}\tsupabase/migrations/${String(index).padStart(14, "0")}_fictional.sql`,
);
const digest = (values) =>
  createHash("sha256")
    .update(values.join("\n") + "\n")
    .digest("hex");
const policy = {
  ledgerCount: 723,
  targetLedgerCount: 739,
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
    verifyCaptureLedger({ ...policy, targetLedgerCount: 740 }, rows),
  );
  assert.throws(() =>
    verifyCaptureLedger({ ...policy, ledgerCount: 722 }, rows),
  );
});

test("the committed migration objects match the reviewed 723 plus 16 source policy", () => {
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
    "f116483844d8bfc04c99899c1e38d501a01be191",
  );
  assert.equal(committed.length, 739);
  assert.doesNotThrow(() => verifyCaptureLedger(reviewed, committed));
});
