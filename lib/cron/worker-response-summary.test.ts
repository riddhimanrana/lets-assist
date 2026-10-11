import { expect, test } from "bun:test";
import { workerResponseSummary } from "./worker-response-summary";
const hours = {
  processedSessions: 0,
  successfulSessions: 0,
  results: [],
  approvalStatus: "approved",
  discoveryCounted: true,
  heldSessions: {
    historical: 0,
    oversized: 0,
    invalidAttendance: 0,
    missingCreator: 0,
    invalidSchedule: 0,
  },
};
test("hours scheduler completion requires explicit approval, discovery and no held records", () => {
  for (const body of [
    hours,
    { ...hours, approvalStatus: "approval_required" },
    { ...hours, discoveryCounted: false },
    { ...hours, heldSessions: undefined },
    { ...hours, heldSessions: { ...hours.heldSessions, historical: 1 } },
    { ...hours, heldSessions: { ...hours.heldSessions, invalidSchedule: 1 } },
    {
      ...hours,
      heldSessions: { ...hours.heldSessions, futureHeldCategory: 1 },
    },
    { ...hours, heldSessions: { ...hours.heldSessions, oversized: -1 } },
    { ...hours, enabled: false },
    { ...hours, configurationBlocked: true },
  ]) {
    const summary = workerResponseSummary("auto-publish-hours");
    expect(summary.heartbeatBlocked()).toBe(true);
    summary.capture(body);
    expect(summary.heartbeatBlocked()).toBe(body !== hours);
    // The execution receipt stays an aggregate; approval is additional policy.
    expect(summary.outcome().outcome).toBe("no_run");
    expect(JSON.stringify(summary.outcome())).not.toContain("heldSessions");
  }
});
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
