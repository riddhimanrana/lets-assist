import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  localValidationChecks,
  verifyLocalValidationEvidence,
} from "./local-validation-evidence.mjs";
const now = Date.parse("2040-01-01T12:00:00Z");
const expected = {
  releaseSha: "a".repeat(40),
  acceptedSha: "b".repeat(40),
  gitTree: "c".repeat(40),
  privateGitlink: "d".repeat(40),
  actor: "release-owner",
  repository: "riddhimanrana/lets-assist",
};
const report = Buffer.from("Fictional sanitized validation output");
function receipt() {
  const { repository: _repository, ...identities } = expected;
  return {
    schemaVersion: 1,
    kind: "operator-local-validation",
    ...identities,
    issuedAt: "2040-01-01T11:00:00Z",
    expiresAt: "2040-01-02T11:00:00Z",
    changeRecord: "https://github.com/riddhimanrana/lets-assist/issues/123",
    checks: localValidationChecks.map((name) => ({
      name,
      exitCode: 0,
      completedAt: "2040-01-01T10:00:00Z",
      reportSha256: createHash("sha256").update(report).digest("hex"),
    })),
  };
}
const options = { now, readReport: () => report };
test("evidence binds exact source and report bytes while retaining its attestation limit", () => {
  const result = verifyLocalValidationEvidence(receipt(), expected, options);
  assert.match(result.assurance, /test execution is not independently proven/u);
  assert.equal(result.checks.length, 6);
  assert.equal(result.privateGitlink, expected.privateGitlink);
});
test("changed candidates, operators, change records and expired claims fail", () => {
  for (const patch of [
    { releaseSha: "e".repeat(40) },
    { acceptedSha: "e".repeat(40) },
    { gitTree: "e".repeat(40) },
    { privateGitlink: "e".repeat(40) },
    { actor: "other" },
    {
      changeRecord:
        "https://github.com/riddhimanrana/lets-assist/issues/123#fragment",
    },
    { expiresAt: "2040-01-01T12:00:00Z" },
    { expiresAt: "2040-01-03T12:00:00Z" },
    { issuedAt: "2040-01-01T13:00:00Z" },
    { changeRecord: "https://example.test/incidents/123" },
    { changeRecord: "https://github.com/other/repo/issues/123" },
    {
      changeRecord:
        "https://github.com/riddhimanrana/lets-assist/issues/123?secret=fictional",
    },
  ])
    assert.throws(() =>
      verifyLocalValidationEvidence(
        { ...receipt(), ...patch },
        expected,
        options,
      ),
    );
});
test("missing, failed, repeated or stale checks and altered report bytes fail", () => {
  for (const mutate of [
    (item) => item.checks.pop(),
    (item) => {
      item.checks[0].exitCode = 1;
    },
    (item) => {
      item.checks[0].name = item.checks[1].name;
    },
    (item) => {
      item.checks[0].completedAt = "2039-12-20T10:00:00Z";
    },
    (item) => {
      item.checks[0].completedAt = "2040-01-01T11:30:00Z";
    },
    (item) => {
      item.checks[0].rawLog = "refused";
    },
  ]) {
    const item = receipt();
    mutate(item);
    assert.throws(() => verifyLocalValidationEvidence(item, expected, options));
  }
  assert.throws(
    () =>
      verifyLocalValidationEvidence(receipt(), expected, {
        now,
        readReport: () => Buffer.from("changed"),
      }),
    /digest mismatch/u,
  );
});
