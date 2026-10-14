import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyCaptureLedger } from "./capture-ledger-policy.mjs";

const rows = Array.from(
  { length: 725 },
  (_, index) =>
    `100644 blob ${String(index).padStart(40, "0")}\tsupabase/migrations/${String(index).padStart(14, "0")}_fictional.sql`,
);
const digest = (values) =>
  createHash("sha256")
    .update(values.join("\n") + "\n")
    .digest("hex");
const policy = {
  ledgerCount: 723,
  targetLedgerCount: 725,
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
    rows.slice(0, 724),
    [...rows, rows[0]],
    [...rows].reverse(),
    [...rows.slice(0, 723), rows[723].replace("100644", "100755")],
    [...rows.slice(0, 724), rows[724].replace("100644", "100755")],
    null,
  ])
    assert.throws(() => verifyCaptureLedger(policy, altered));
  assert.throws(() =>
    verifyCaptureLedger({ ...policy, targetLedgerCount: 726 }, rows),
  );
  assert.throws(() =>
    verifyCaptureLedger({ ...policy, ledgerCount: 722 }, rows),
  );
});
