import { expect, test } from "bun:test";
import {
  classifyWorkerResponse,
  validateWorkerOutcome,
  type ObservedWorker,
  type WorkerOutcome,
} from "./worker-outcome";

const cases: Array<
  [ObservedWorker, Record<string, unknown>, WorkerOutcome["outcome"]]
> = [
  ["anonymous-cleanup", { deleted: 2, storageDeleted: 1 }, "processed"],
  ["waiver-cleanup", { deleted: 0, storageDeleted: 0 }, "no_run"],
  ["paper-scan-cleanup", { purgedBatches: 1, storageDeleted: 0 }, "processed"],
  [
    "public-image-cleanup",
    { claimed: 3, deleted: 1, retained: 1, retryable: 1, failed: 0 },
    "partial",
  ],
  [
    "csf-proof-cleanup",
    {
      ok: true,
      deleted: 0,
      enqueued: 1,
      failed: 1,
      swept: {
        abandonedUploads: 0,
        expiredClaims: 0,
        readyDeadlinesPassed: 0,
        settledRetirements: 0,
      },
    },
    "partial",
  ],
  [
    "ai-moderation",
    {
      success: true,
      moderated: 1,
      scanned: { projects: 3, reports: 1 },
      warnings: ["private diagnostic"],
    },
    "partial",
  ],
  [
    "auto-publish-hours",
    {
      processedSessions: 1,
      successfulSessions: 1,
      pendingSessions: 1,
      results: [{ errors: [] }],
    },
    "partial",
  ],
  [
    "generate-recurring-projects",
    {
      processedProjects: 1,
      checkedProjects: 1,
      successfulProjects: 0,
      failedParents: 1,
      failedProjects: 1,
      createdOccurrences: 2,
    },
    "failed",
  ],
  [
    "organization-calendar-sync",
    {
      processed: 2,
      message: "done",
      timestamp: "2040-01-01",
      results: [{ success: true }, { success: false }],
    },
    "partial",
  ],
  ["organization-sheet-sync", { processed: 0, results: [] }, "no_run"],
  [
    "paper-signup-notifications",
    {
      claimed: 1,
      reaped: 0,
      outcomes: {
        accepted: 0,
        skipped: 0,
        failed: 0,
        unknown: 1,
        retryable: 0,
      },
    },
    "failed",
  ],
  [
    "project-feedback-followups",
    {
      claimed: 0,
      reaped: 0,
      enqueued: 1,
      projectsScanned: 1,
      deadlineReached: false,
      outcomes: { sent: 0, skipped: 0, failed: 0, unknown: 0, retryable: 0 },
    },
    "processed",
  ],
  [
    "csf-publication-notifications",
    { claimed: 1, delivered: 1, skipped: 0, retryable: 0, emailQueued: 1 },
    "processed",
  ],
  ["csf-import-commit", { claimed: 1, completed: 0, blocked: 1 }, "partial"],
  [
    "csf-class-workbook-refresh",
    { claimed: 1, prepared: 2, blocked: 0, status: "completed" },
    "processed",
  ],
];

for (const [worker, body, outcome] of cases) {
  test(`${worker} records its aggregate outcome without private fields`, () => {
    const result = classifyWorkerResponse(worker, 200, {
      ...body,
      recipient: "private-student@local.test",
      jobId: "private-job",
      error: "private diagnostic",
    });
    expect(result.outcome).toBe(outcome);
    expect(validateWorkerOutcome(result) === result).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(classifyWorkerResponse(worker, 503, body).code).toBe(
      "worker_failed",
    );
    expect(classifyWorkerResponse(worker, 200, {}).code).toBe(
      "invalid_response",
    );
  });
}

test("moderation distinguishes an empty scan, a clean scan, and incomplete scan evidence", () => {
  expect(
    classifyWorkerResponse("ai-moderation", 200, {
      success: true,
      moderated: 0,
    }).outcome,
  ).toBe("no_run");
  expect(
    classifyWorkerResponse("ai-moderation", 200, {
      success: true,
      moderated: 0,
      scanned: { projects: 2, reports: 0 },
    }),
  ).toMatchObject({ attempted: 2, completed: 2, outcome: "processed" });
  expect(
    classifyWorkerResponse("ai-moderation", 200, {
      success: true,
      moderated: 1,
    }).code,
  ).toBe("invalid_response");
});

test("cleanup and notification counts cannot silently accept malformed numbers", () => {
  for (const bad of [-1, 1.5, 1_000_001, "1", null, undefined]) {
    expect(
      classifyWorkerResponse("public-image-cleanup", 200, {
        claimed: 1,
        deleted: bad,
        retained: 0,
        retryable: 0,
        failed: 0,
      }).code,
    ).toBe("invalid_response");
    expect(
      classifyWorkerResponse("csf-publication-notifications", 200, {
        claimed: 1,
        delivered: 1,
        skipped: 0,
        retryable: 0,
        emailUnavailable: bad,
      }).code,
    ).toBe("invalid_response");
  }
  expect(
    classifyWorkerResponse("csf-publication-notifications", 200, {
      claimed: 1,
      delivered: 1,
      skipped: 0,
      retryable: 0,
      emailUnavailable: 1,
    }).outcome,
  ).toBe("partial");
});

test("session and sync receipts refuse inconsistent result arrays", () => {
  expect(
    classifyWorkerResponse("auto-publish-hours", 200, {
      processedSessions: 1,
      successfulSessions: 1,
      results: [],
    }).code,
  ).toBe("invalid_response");
  expect(
    classifyWorkerResponse("auto-publish-hours", 200, {
      processedSessions: 1,
      successfulSessions: 2,
      results: [{ errors: [] }],
    }).code,
  ).toBe("invalid_response");
  expect(
    classifyWorkerResponse("organization-sheet-sync", 200, {
      processed: 2,
      results: [{ success: true }],
    }).code,
  ).toBe("invalid_response");
  expect(
    classifyWorkerResponse("organization-calendar-sync", 200, {
      processed: 1,
      results: [{ success: "yes" }],
    }).code,
  ).toBe("invalid_response");
});

test("workbook component outcomes cannot hide blocked or queued work", () => {
  const idle = { claimed: 0, prepared: 0, blocked: 0 };
  const mixed = classifyWorkerResponse("csf-class-workbook-refresh", 200, {
    ...idle,
    applications: { claimed: 1, status: "prepared" },
    workbookChecks: { claimed: 1, status: "queued", queued: 1 },
    automaticClassImports: {
      checked: 3,
      queued: 1,
      needsAttention: 1,
      blocked: 0,
      unknown: 0,
    },
    sheetSync: { status: "complete" },
  });
  expect(mixed).toMatchObject({
    outcome: "partial",
    attempted: 6,
    completed: 2,
    pending: 2,
    refused: 1,
  });
  expect(
    classifyWorkerResponse("csf-class-workbook-refresh", 200, {
      ...idle,
      claimed: 2,
    }).code,
  ).toBe("invalid_response");
  expect(
    classifyWorkerResponse("csf-class-workbook-refresh", 200, {
      ...idle,
      applications: { claimed: 1, status: "invented" },
    }).code,
  ).toBe("invalid_response");
});
