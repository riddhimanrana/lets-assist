import { expect, test } from "bun:test";
import {
  classifyWorkerResponse,
  validateWorkerOutcome,
  type ObservedWorker,
  type WorkerOutcome,
} from "./worker-outcome";

const noHeldSessions = {
  historical: 0,
  oversized: 0,
  invalidAttendance: 0,
  missingCreator: 0,
  invalidSchedule: 0,
};
// A real omitted field, not an own property holding undefined.
function without(body: Record<string, unknown>, key: string) {
  const copy = { ...body };
  delete copy[key];
  return copy;
}
// The recovery claim always carries its counted ledger inventory. A recovery
// override states the selected batch, so the inventory defaults to counted
// with nothing pending or held unless the override says otherwise.
const countedLedger = { counted: true, pending: 0, held: 0 };
// An approved, counted, empty hours pass. Overrides replace whole fields.
function hoursPass(overrides: Record<string, unknown> = {}) {
  const body: Record<string, unknown> = { ...emptyHoursPass(), ...overrides };
  if (body.recovery && typeof body.recovery === "object")
    body.recovery = { ...countedLedger, ...body.recovery };
  return body;
}
function emptyHoursPass() {
  return {
    approvalStatus: "approved",
    discoveryCounted: true,
    heldSessions: noHeldSessions,
    processedSessions: 0,
    successfulSessions: 0,
    pendingSessions: 0,
    results: [] as unknown[],
    recovery: {
      deliveries: 0,
      accepted: 0,
      partial: 0,
      settlementUnconfirmed: 0,
    },
  };
}
// What the worker returns when it discovered nothing: no pending key at all.
function undiscoveredHoursPass(
  approvalStatus: string,
  overrides: Record<string, unknown> = {},
) {
  const body = hoursPass({
    approvalStatus,
    discoveryCounted: false,
    heldSessions: null,
    ...overrides,
  });
  return Object.hasOwn(overrides, "pendingSessions")
    ? body
    : without(body, "pendingSessions");
}
function hours(body: Record<string, unknown>) {
  return classifyWorkerResponse("auto-publish-hours", 200, body);
}

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
    hoursPass({
      processedSessions: 1,
      successfulSessions: 1,
      pendingSessions: 1,
      results: [{ success: true, errors: [] }],
    }),
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
  for (const inconsistent of [
    { processedSessions: 1, successfulSessions: 1, results: [] },
    {
      processedSessions: 1,
      successfulSessions: 2,
      results: [{ success: true, errors: [] }],
    },
    {
      processedSessions: 1,
      successfulSessions: 1,
      results: [{ success: false, errors: ["refused"] }],
    },
    { processedSessions: 1, successfulSessions: 1, results: [{ errors: [] }] },
    { processedSessions: 1, successfulSessions: 0, results: [{ success: 0 }] },
  ])
    expect(hours(hoursPass(inconsistent)).code).toBe("invalid_response");
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

test("an approved, counted hours pass with nothing held or pending is the only empty queue", () => {
  const empty = hours(hoursPass());
  expect(empty).toMatchObject({ outcome: "no_run", code: "empty_queue" });
  expect(validateWorkerOutcome(empty) === empty).toBe(true);
});

test("a published session is a committed award, counted apart from email", () => {
  const published = hours(
    hoursPass({
      processedSessions: 2,
      successfulSessions: 2,
      results: [
        { success: true, errors: [] },
        { success: true, errors: [] },
      ],
    }),
  );
  expect(published).toMatchObject({
    outcome: "processed",
    attempted: 2,
    completed: 2,
    pending: 0,
  });
  expect(validateWorkerOutcome(published) === published).toBe(true);

  // The same sessions with their mail still queued are not a finished pass.
  expect(
    hours(
      hoursPass({
        processedSessions: 1,
        successfulSessions: 1,
        results: [{ success: true, errors: [] }],
        recovery: {
          deliveries: 25,
          accepted: 20,
          partial: 5,
          settlementUnconfirmed: 0,
        },
      }),
    ),
  ).toMatchObject({
    outcome: "partial",
    attempted: 26,
    completed: 21,
    pending: 5,
    faults: 0,
  });
});

test("a refused session is a failure with its diagnostics counted, never copied", () => {
  const refused = hours(
    hoursPass({
      processedSessions: 2,
      successfulSessions: 1,
      results: [
        { success: true, errors: [] },
        { success: false, errors: ["private refusal detail"] },
      ],
    }),
  );
  expect(refused).toMatchObject({
    outcome: "partial",
    attempted: 2,
    completed: 1,
    failed: 1,
    faults: 1,
  });
  expect(JSON.stringify(refused)).not.toContain("private");
});

test("missing approval and uncounted discovery are refused, not an empty queue", () => {
  for (const body of [
    undiscoveredHoursPass("approval_required"),
    // A contended claim under a valid approval counted nothing either.
    undiscoveredHoursPass("approved"),
  ]) {
    const result = hours(body);
    expect(result).toMatchObject({
      outcome: "partial",
      code: "partial_work",
      refused: 1,
      pending: 0,
    });
    expect(validateWorkerOutcome(result) === result).toBe(true);
  }

  // Mail recovered under a missing approval still counts, and still cannot
  // turn the pass green.
  expect(
    hours(
      undiscoveredHoursPass("approval_required", {
        recovery: {
          deliveries: 3,
          accepted: 3,
          partial: 0,
          settlementUnconfirmed: 0,
        },
      }),
    ),
  ).toMatchObject({ outcome: "partial", completed: 3, refused: 1 });
});

test("an undiscovered hours pass cannot report sessions, held work, or a pending count", () => {
  for (const invented of [
    { pendingSessions: 0 },
    { heldSessions: noHeldSessions },
    { discoveryCounted: true },
    {
      processedSessions: 1,
      successfulSessions: 1,
      results: [{ success: true, errors: [] }],
    },
  ])
    expect(
      hours(undiscoveredHoursPass("approval_required", invented)).code,
    ).toBe("invalid_response");
  expect(
    hours(undiscoveredHoursPass("approved", { pendingSessions: 0 })).code,
  ).toBe("invalid_response");
});

test("every held category and any pending session blocks a completed hours pass", () => {
  for (const category of Object.keys(noHeldSessions)) {
    const held = hours(
      hoursPass({ heldSessions: { ...noHeldSessions, [category]: 4 } }),
    );
    expect(held).toMatchObject({ outcome: "partial", refused: 4 });
    // A session published in the same pass does not hide the held backlog.
    expect(
      hours(
        hoursPass({
          heldSessions: { ...noHeldSessions, [category]: 1 },
          processedSessions: 1,
          successfulSessions: 1,
          results: [{ success: true, errors: [] }],
        }),
      ).outcome,
    ).toBe("partial");
  }
  expect(hours(hoursPass({ pendingSessions: 3 }))).toMatchObject({
    outcome: "partial",
    pending: 3,
  });
});

test("a counted hours pass must carry all five held counts and its pending count", () => {
  const withoutPending = without(hoursPass(), "pendingSessions");
  for (const body of [
    hoursPass({ heldSessions: without(noHeldSessions, "invalidSchedule") }),
    hoursPass({ heldSessions: null }),
    hoursPass({ heldSessions: { ...noHeldSessions, historical: -1 } }),
    hoursPass({ heldSessions: { ...noHeldSessions, oversized: 1.5 } }),
    hoursPass({ heldSessions: { ...noHeldSessions, missingCreator: "0" } }),
    hoursPass({ pendingSessions: null }),
    withoutPending,
    hoursPass({ approvalStatus: "pending" }),
    hoursPass({ discoveryCounted: "true" }),
  ])
    expect(hours(body).code).toBe("invalid_response");
});

test("unsettled or unknown mail is partial and only durable acceptance completes", () => {
  const unconfirmed = hours(
    hoursPass({
      recovery: {
        deliveries: 2,
        accepted: 0,
        partial: 2,
        settlementUnconfirmed: 2,
      },
    }),
  );
  expect(unconfirmed).toMatchObject({
    outcome: "partial",
    completed: 0,
    pending: 2,
    faults: 2,
  });
  expect(validateWorkerOutcome(unconfirmed) === unconfirmed).toBe(true);

  expect(
    hours(
      hoursPass({
        recovery: {
          deliveries: 2,
          accepted: 1,
          partial: 1,
          settlementUnconfirmed: 0,
        },
      }),
    ),
  ).toMatchObject({ outcome: "partial", completed: 1, pending: 1, faults: 0 });

  expect(
    hours(
      hoursPass({
        recovery: {
          deliveries: 25,
          accepted: 25,
          partial: 0,
          settlementUnconfirmed: 0,
        },
      }),
    ),
  ).toMatchObject({ outcome: "processed", attempted: 25, completed: 25 });
});

test("inconsistent recovery arithmetic is rejected", () => {
  for (const recovery of [
    { deliveries: 1, accepted: 2, partial: 0, settlementUnconfirmed: 0 },
    { deliveries: 2, accepted: 1, partial: 0, settlementUnconfirmed: 0 },
    { deliveries: 1, accepted: 1, partial: 1, settlementUnconfirmed: 0 },
    { deliveries: 1, accepted: 1, partial: 0, settlementUnconfirmed: 1 },
    { deliveries: 2, accepted: 1, partial: 1, settlementUnconfirmed: 2 },
    { deliveries: 26, accepted: 26, partial: 0, settlementUnconfirmed: 0 },
    { deliveries: 1, accepted: 1.5, partial: 0, settlementUnconfirmed: 0 },
    { deliveries: 1, accepted: 1, partial: -0.5, settlementUnconfirmed: 0 },
    { deliveries: 1, accepted: 1, partial: 0 },
    { deliveries: "1", accepted: 1, partial: 0, settlementUnconfirmed: 0 },
  ])
    expect(hours(hoursPass({ recovery })).code).toBe("invalid_response");
  expect(hours(hoursPass({ recovery: null })).code).toBe("invalid_response");
  expect(hours(without(hoursPass(), "recovery")).code).toBe("invalid_response");
});

test("deferred organizations are pending work for sheet and calendar sync", () => {
  const allDeferred = classifyWorkerResponse("organization-sheet-sync", 200, {
    processed: 0,
    results: [],
    deferredOrganizations: 3,
  });
  expect(allDeferred).toMatchObject({
    outcome: "partial",
    code: "partial_work",
    attempted: 0,
    pending: 3,
  });
  expect(validateWorkerOutcome(allDeferred) === allDeferred).toBe(true);

  expect(
    classifyWorkerResponse("organization-sheet-sync", 200, {
      processed: 2,
      results: [{ success: true }, { success: true }],
      deferredOrganizations: 1,
    }),
  ).toMatchObject({ outcome: "partial", completed: 2, pending: 1 });

  // Absent and zero both keep the earlier behavior.
  expect(
    classifyWorkerResponse("organization-sheet-sync", 200, {
      processed: 0,
      results: [],
      deferredOrganizations: 0,
    }).outcome,
  ).toBe("no_run");
  expect(
    classifyWorkerResponse("organization-sheet-sync", 200, {
      processed: 1,
      results: [{ success: true }],
    }),
  ).toMatchObject({ outcome: "processed", pending: 0 });

  for (const bad of [-1, 1.5, "1", null, undefined, 1_000_001])
    expect(
      classifyWorkerResponse("organization-sheet-sync", 200, {
        processed: 0,
        results: [],
        deferredOrganizations: bad,
      }).code,
    ).toBe("invalid_response");

  // Calendar sync defers the same way.
  expect(
    classifyWorkerResponse("organization-calendar-sync", 200, {
      processed: 0,
      results: [],
      deferredOrganizations: 3,
    }),
  ).toMatchObject({ outcome: "partial", attempted: 0, pending: 3 });
});

test("organization discovery that did not count or stopped early is refused without a due count", () => {
  for (const worker of [
    "organization-calendar-sync",
    "organization-sheet-sync",
  ] as const) {
    const counted = {
      processed: 0,
      results: [],
      discoveryCounted: true,
      discoveryIncomplete: false,
      deferredOrganizations: 0,
    };
    expect(classifyWorkerResponse(worker, 200, counted)).toMatchObject({
      outcome: "no_run",
      code: "empty_queue",
    });
    for (const flags of [
      { discoveryCounted: false },
      { discoveryIncomplete: true },
    ]) {
      const blocked = classifyWorkerResponse(worker, 200, {
        ...counted,
        ...flags,
      });
      expect(blocked).toMatchObject({
        outcome: "partial",
        code: "partial_work",
        refused: 1,
        pending: 0,
      });
      expect(validateWorkerOutcome(blocked) === blocked).toBe(true);
    }
    // Completed organizations do not make an incomplete discovery healthy.
    expect(
      classifyWorkerResponse(worker, 200, {
        ...counted,
        processed: 1,
        results: [{ success: true }],
        discoveryIncomplete: true,
      }),
    ).toMatchObject({ outcome: "partial", completed: 1, refused: 1 });
    for (const malformed of [
      { discoveryCounted: 1 },
      { discoveryCounted: null },
      { discoveryIncomplete: "false" },
      { discoveryIncomplete: undefined },
    ])
      expect(
        classifyWorkerResponse(worker, 200, { ...counted, ...malformed }).code,
      ).toBe("invalid_response");
  }
});

test("the counted email ledger blocks an hours pass that left work pending or held", () => {
  const batch = {
    deliveries: 25,
    accepted: 25,
    partial: 0,
    settlementUnconfirmed: 0,
  };
  const drained = hours(hoursPass({ recovery: batch }));
  expect(drained).toMatchObject({ outcome: "processed", completed: 25 });

  // 26 were due. The 25 selected were all accepted and one is still owed.
  const oneLeft = hours(hoursPass({ recovery: { ...batch, pending: 1 } }));
  expect(oneLeft).toMatchObject({
    outcome: "partial",
    attempted: 25,
    completed: 25,
    pending: 1,
    refused: 0,
  });
  expect(validateWorkerOutcome(oneLeft) === oneLeft).toBe(true);

  // Leased or cooling deliveries with nothing selected are not an empty queue.
  const empty = { deliveries: 0, accepted: 0, partial: 0 };
  expect(
    hours(
      hoursPass({
        recovery: { ...empty, settlementUnconfirmed: 0, pending: 4 },
      }),
    ),
  ).toMatchObject({ outcome: "partial", attempted: 0, pending: 4 });

  // An unknown outcome or a corrected unfrozen original is held, not sent.
  expect(
    hours(
      hoursPass({ recovery: { ...empty, settlementUnconfirmed: 0, held: 2 } }),
    ),
  ).toMatchObject({ outcome: "partial", completed: 0, pending: 0, refused: 2 });

  // Selected-but-unresolved work adds to the pending the ledger reported.
  expect(
    hours(
      hoursPass({
        recovery: {
          deliveries: 3,
          accepted: 1,
          partial: 2,
          settlementUnconfirmed: 1,
          pending: 5,
          held: 1,
        },
      }),
    ),
  ).toMatchObject({
    outcome: "partial",
    completed: 1,
    pending: 7,
    refused: 1,
    faults: 1,
  });
});

test("an uncounted or malformed email ledger never reads as zero", () => {
  const empty = {
    deliveries: 0,
    accepted: 0,
    partial: 0,
    settlementUnconfirmed: 0,
  };
  const uncounted = hours(
    hoursPass({
      recovery: { ...empty, counted: false, pending: null, held: null },
    }),
  );
  expect(uncounted).toMatchObject({
    outcome: "partial",
    code: "partial_work",
    refused: 1,
    pending: 0,
  });
  expect(validateWorkerOutcome(uncounted) === uncounted).toBe(true);

  for (const recovery of [
    { ...empty, counted: false, pending: 0, held: null },
    { ...empty, counted: false, pending: null, held: 0 },
    { ...empty, deliveries: 1, accepted: 1, counted: false, pending: null },
    { ...empty, counted: "true" },
    { ...empty, counted: null },
    { ...empty, pending: null },
    { ...empty, pending: -1 },
    { ...empty, held: 1.5 },
    { ...empty, held: "0" },
  ])
    expect(hours(hoursPass({ recovery })).code).toBe("invalid_response");
  // The inventory itself is required.
  expect(hours(emptyHoursPass()).code).toBe("invalid_response");
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
