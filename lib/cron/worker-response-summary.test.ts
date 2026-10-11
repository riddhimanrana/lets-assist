import { expect, test } from "bun:test";
import { workerResponseSummary } from "./worker-response-summary";
const recovery = {
  counted: true,
  pending: 0,
  held: 0,
  deliveries: 0,
  accepted: 0,
  partial: 0,
  settlementUnconfirmed: 0,
};
const hours = {
  processedSessions: 0,
  successfulSessions: 0,
  results: [],
  approvalStatus: "approved",
  discoveryCounted: true,
  pendingSessions: 0,
  heldSessions: {
    historical: 0,
    oversized: 0,
    invalidAttendance: 0,
    missingCreator: 0,
    invalidSchedule: 0,
  },
  recovery,
};
// What a pass reports when it discovered nothing: no session counts at all.
const undiscovered = {
  discoveryCounted: false,
  heldSessions: undefined,
  pendingSessions: undefined,
};
const captureHours = (body: unknown) => {
  const summary = workerResponseSummary("auto-publish-hours");
  expect(summary.heartbeatBlocked()).toBe(true);
  summary.capture(body);
  // The receipt stays an aggregate. It never carries the response's fields.
  expect(JSON.stringify(summary.outcome())).not.toMatch(
    /heldSessions|recovery|settlementUnconfirmed/u,
  );
  return summary;
};
type Expected = [
  name: string,
  body: unknown,
  blocked: boolean,
  outcome: string,
  code: string,
];

const approvalAndDiscovery: Expected[] = [
  ["a counted, approved, empty pass", hours, false, "no_run", "empty_queue"],
  [
    "approval that is still required",
    { ...hours, ...undiscovered, approvalStatus: "approval_required" },
    true,
    "partial",
    "partial_work",
  ],
  [
    "approval that is required but reported with discovered sessions",
    { ...hours, approvalStatus: "approval_required" },
    true,
    "failed",
    "invalid_response",
  ],
  [
    "an approval status this file does not know",
    { ...hours, approvalStatus: "pending" },
    true,
    "failed",
    "invalid_response",
  ],
  [
    "discovery that was not counted",
    { ...hours, ...undiscovered },
    true,
    "partial",
    "partial_work",
  ],
  [
    "uncounted discovery that still reports held sessions",
    { ...hours, discoveryCounted: false },
    true,
    "failed",
    "invalid_response",
  ],
  [
    "no held-session inventory",
    { ...hours, heldSessions: undefined },
    true,
    "failed",
    "invalid_response",
  ],
  [
    "a held historical session",
    { ...hours, heldSessions: { ...hours.heldSessions, historical: 1 } },
    true,
    "partial",
    "partial_work",
  ],
  [
    "a held session with an invalid schedule",
    { ...hours, heldSessions: { ...hours.heldSessions, invalidSchedule: 1 } },
    true,
    "partial",
    "partial_work",
  ],
  [
    // The aggregate counts only the reviewed categories, so it reads as
    // empty. The heartbeat policy is what refuses the unknown one.
    "a held category this file does not know",
    {
      ...hours,
      heldSessions: { ...hours.heldSessions, futureHeldCategory: 1 },
    },
    true,
    "no_run",
    "empty_queue",
  ],
  [
    "a negative held count",
    { ...hours, heldSessions: { ...hours.heldSessions, oversized: -1 } },
    true,
    "failed",
    "invalid_response",
  ],
  [
    "a disabled worker",
    { ...hours, enabled: false },
    true,
    "no_run",
    "disabled",
  ],
  [
    "blocked configuration",
    { ...hours, configurationBlocked: true },
    true,
    "no_run",
    "empty_queue",
  ],
];
test.each(approvalAndDiscovery)(
  "hours pass with %s",
  (_name, body, blocked, outcome, code) => {
    const summary = captureHours(body);
    expect(summary.heartbeatBlocked()).toBe(blocked);
    expect(summary.outcome()).toMatchObject({ outcome, code });
  },
);

const session = { success: true, errors: [] };
const recoveryInventory: Expected[] = [
  [
    "accepted deliveries and nothing left behind",
    {
      ...hours,
      recovery: { ...recovery, deliveries: 3, accepted: 3 },
    },
    false,
    "processed",
    "completed",
  ],
  [
    "published sessions and accepted deliveries",
    {
      ...hours,
      processedSessions: 2,
      successfulSessions: 2,
      results: [session, session],
      recovery: { ...recovery, deliveries: 2, accepted: 2 },
    },
    false,
    "processed",
    "completed",
  ],
  [
    "no recovery inventory",
    { ...hours, recovery: undefined },
    true,
    "failed",
    "invalid_response",
  ],
  [
    "a recovery inventory that is not an object",
    { ...hours, recovery: [recovery] },
    true,
    "failed",
    "invalid_response",
  ],
  [
    // Unknown: the ledger was not counted, so nothing is said to be waiting.
    "a recovery ledger that was not counted",
    {
      ...hours,
      recovery: { ...recovery, counted: false, pending: null, held: null },
    },
    true,
    "partial",
    "partial_work",
  ],
  [
    "an uncounted ledger that still gives counts",
    { ...hours, recovery: { ...recovery, counted: false } },
    true,
    "failed",
    "invalid_response",
  ],
  [
    "a counted ledger with no pending count",
    { ...hours, recovery: { ...recovery, pending: null } },
    true,
    "failed",
    "invalid_response",
  ],
  [
    "a counted ledger with no held count",
    { ...hours, recovery: { ...recovery, held: null } },
    true,
    "failed",
    "invalid_response",
  ],
  [
    "a counted flag that is not a boolean",
    { ...hours, recovery: { ...recovery, counted: "true" } },
    true,
    "failed",
    "invalid_response",
  ],
  [
    // Deferred: deliveries wait behind this pass's batch.
    "deliveries still pending in the ledger",
    { ...hours, recovery: { ...recovery, pending: 4 } },
    true,
    "partial",
    "partial_work",
  ],
  [
    "deliveries pending behind a fully accepted batch",
    {
      ...hours,
      recovery: { ...recovery, pending: 1, deliveries: 25, accepted: 25 },
    },
    true,
    "partial",
    "partial_work",
  ],
  [
    "held deliveries",
    { ...hours, recovery: { ...recovery, held: 2 } },
    true,
    "partial",
    "partial_work",
  ],
  [
    "a negative pending count",
    { ...hours, recovery: { ...recovery, pending: -1 } },
    true,
    "failed",
    "invalid_response",
  ],
  [
    "a fractional held count",
    { ...hours, recovery: { ...recovery, held: 0.5 } },
    true,
    "failed",
    "invalid_response",
  ],
  [
    "a partly accepted delivery",
    {
      ...hours,
      recovery: { ...recovery, deliveries: 2, accepted: 1, partial: 1 },
    },
    true,
    "partial",
    "partial_work",
  ],
  [
    "a delivery whose settlement was not confirmed",
    {
      ...hours,
      recovery: {
        ...recovery,
        deliveries: 1,
        partial: 1,
        settlementUnconfirmed: 1,
      },
    },
    true,
    "partial",
    "partial_work",
  ],
  [
    "an unconfirmed settlement with no partial delivery behind it",
    { ...hours, recovery: { ...recovery, settlementUnconfirmed: 1 } },
    true,
    "failed",
    "invalid_response",
  ],
  [
    "deliveries that were neither accepted nor partial",
    { ...hours, recovery: { ...recovery, deliveries: 1 } },
    true,
    "failed",
    "invalid_response",
  ],
  [
    "a negative delivery count",
    { ...hours, recovery: { ...recovery, deliveries: -1, accepted: -1 } },
    true,
    "failed",
    "invalid_response",
  ],
  [
    "no partial count",
    { ...hours, recovery: { ...recovery, partial: undefined } },
    true,
    "failed",
    "invalid_response",
  ],
];
test.each(recoveryInventory)(
  "hours pass with %s",
  (_name, body, blocked, outcome, code) => {
    const summary = captureHours(body);
    expect(summary.heartbeatBlocked()).toBe(blocked);
    expect(summary.outcome()).toMatchObject({ outcome, code });
  },
);
test("valid organization empty discovery is distinct from disabled and blocked settings", () => {
  for (const worker of [
    "organization-calendar-sync",
    "organization-sheet-sync",
  ] as const) {
    const summary = workerResponseSummary(worker);
    summary.capture({ processed: 0, results: [] });
    expect(summary.heartbeatBlocked()).toBe(false);
    expect(summary.outcome()).toMatchObject({
      outcome: "no_run",
      code: "empty_queue",
      attempted: 0,
      completed: 0,
    });
    summary.capture({ enabled: false });
    expect(summary.heartbeatBlocked()).toBe(true);
    summary.capture({ processed: 0, results: [], configurationBlocked: true });
    expect(summary.heartbeatBlocked()).toBe(true);
  }
});
test("deferred due Sheets organizations cannot report a completed empty discovery", () => {
  for (const deferredOrganizations of [1, -1, null, "1"]) {
    const summary = workerResponseSummary("organization-sheet-sync");
    summary.capture({ processed: 0, results: [], deferredOrganizations });
    expect(summary.heartbeatBlocked()).toBe(true);
  }
  const summary = workerResponseSummary("organization-sheet-sync");
  summary.capture({ processed: 0, results: [], deferredOrganizations: 0 });
  expect(summary.heartbeatBlocked()).toBe(false);
});
const counted = {
  processed: 1,
  results: [{ organizationId: "fictional-org", success: true }],
  deferredOrganizations: 0,
  discoveryCounted: true,
  discoveryIncomplete: false,
};
test.each(["organization-calendar-sync", "organization-sheet-sync"] as const)(
  "%s blocks on deferred work or an inventory that was not fully counted",
  (worker) => {
    const blocked = (body: unknown) => {
      const summary = workerResponseSummary(worker);
      summary.capture(body);
      return summary.heartbeatBlocked();
    };
    expect(blocked(counted)).toBe(false);
    expect(blocked({ ...counted, processed: 0, results: [] })).toBe(false);
    for (const change of [
      { deferredOrganizations: 5 },
      { deferredOrganizations: -1 },
      { deferredOrganizations: 0.5 },
      { deferredOrganizations: "0" },
      { deferredOrganizations: null },
      { discoveryCounted: false },
      { discoveryCounted: "true" },
      { discoveryCounted: undefined },
      { discoveryIncomplete: true },
      { discoveryIncomplete: null },
      { discoveryIncomplete: 0 },
      // An unknown inventory reports zero deferred, and is still not healthy.
      { processed: 0, results: [], discoveryCounted: false },
      { processed: 0, results: [], discoveryIncomplete: true },
    ]) {
      expect(blocked({ ...counted, ...change })).toBe(true);
    }
  },
);
