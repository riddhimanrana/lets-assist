#!/usr/bin/env node

const expectedSha = process.env.EXPECTED_RELEASE_SHA?.trim() ?? "";
const expectedStage = process.env.EXPECTED_CSF_WORKER_STAGE?.trim() ?? "";

if (!/^[0-9a-f]{40}$/u.test(expectedSha)) {
  throw new Error("EXPECTED_RELEASE_SHA must be a full lowercase commit SHA.");
}

const stages = {
  disabled: [false, false, false, false],
  workbook_refresh: [true, false, false, false],
  import_commit: [true, true, false, false],
  communications: [true, true, true, false],
  scheduled_post_publisher: [true, true, true, true],
};
const expected = stages[expectedStage];
if (!expected) {
  throw new Error("EXPECTED_CSF_WORKER_STAGE is invalid.");
}

let payloadText = "";
for await (const chunk of process.stdin) payloadText += chunk;

let payload;
try {
  payload = JSON.parse(payloadText);
} catch {
  throw new Error("The status endpoint returned malformed JSON.");
}

const workerChecks = Array.isArray(payload?.checks)
  ? payload.checks.filter((check) => check?.name === "workers")
  : [];
const details = workerChecks.length === 1 ? workerChecks[0]?.details : null;
const actual = [
  details?.csfWorkbookRefresh,
  details?.csfImportCommit,
  details?.csfCommunications,
  details?.csfScheduledPostPublisher,
];

if (
  payload?.version !== expectedSha ||
  payload?.environment !== "production" ||
  payload?.deep !== false ||
  actual.some((value, index) => value !== expected[index])
) {
  throw new Error(
    "The Production CSF worker posture does not match the requested stage.",
  );
}

console.log(`Production CSF worker posture verified at ${expectedStage}.`);
