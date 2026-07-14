import assert from "node:assert/strict";
import test from "node:test";

import {
  synchronizeCalendarEvents,
  type CalendarEventSyncOperations,
  type DesiredCalendarEvent,
  type TrackedCalendarEvent,
} from "./calendar-event-sync-core";

type TestProject = { id: string };

const desired: DesiredCalendarEvent<TestProject> = {
  key: "project-1:slot-1",
  projectId: "project-1",
  project: { id: "project-1" },
  scheduleId: "slot-1",
};

const tracked: TrackedCalendarEvent = {
  id: "tracking-1",
  key: desired.key,
  eventId: "google-1",
};

function operations(
  overrides: Partial<CalendarEventSyncOperations<TestProject>> = {},
) {
  let completionCalls = 0;
  const deletedRemoteIds: string[] = [];
  const value: CalendarEventSyncOperations<TestProject> = {
    createRemoteEvent: async () => "google-new",
    updateRemoteEvent: async () => true,
    deleteRemoteEvent: async (eventId) => {
      deletedRemoteIds.push(eventId);
      return true;
    },
    insertTrackingEvent: async () => true,
    updateTrackingEvent: async () => true,
    deleteTrackingEvent: async () => true,
    markSyncComplete: async () => {
      completionCalls += 1;
      return true;
    },
    ...overrides,
  };

  return {
    value,
    completionCalls: () => completionCalls,
    deletedRemoteIds,
  };
}

test("tracking insert failure compensates the new Google event and never records success", async () => {
  const harness = operations({ insertTrackingEvent: async () => false });

  const result = await synchronizeCalendarEvents(
    [desired],
    [],
    harness.value,
  );

  assert.equal(result.success, false);
  assert.match(result.error, /tracking insert failed/u);
  assert.deepEqual(harness.deletedRemoteIds, ["google-new"]);
  assert.equal(harness.completionCalls(), 0);
});

test("tracking update failure never records a completed sync", async () => {
  const harness = operations({ updateTrackingEvent: async () => false });

  const result = await synchronizeCalendarEvents(
    [desired],
    [tracked],
    harness.value,
  );

  assert.equal(result.success, false);
  assert.match(result.error, /tracking row could not be updated/u);
  assert.equal(harness.completionCalls(), 0);
});

test("tracking delete failure never records a completed sync", async () => {
  const harness = operations({ deleteTrackingEvent: async () => false });

  const result = await synchronizeCalendarEvents([], [tracked], harness.value);

  assert.equal(result.success, false);
  assert.match(result.error, /tracking row could not be deleted/u);
  assert.equal(harness.completionCalls(), 0);
});

test("completion marker failure cannot produce a false success", async () => {
  const harness = operations({ markSyncComplete: async () => false });

  const result = await synchronizeCalendarEvents(
    [desired],
    [],
    harness.value,
  );

  assert.deepEqual(result, {
    success: false,
    error: "Calendar events synced, but completion could not be recorded",
  });
});

test("a fully paired sync records completion and reports committed counts", async () => {
  const stale = {
    id: "tracking-stale",
    key: "project-stale:slot-1",
    eventId: "google-stale",
  };
  const harness = operations();

  const result = await synchronizeCalendarEvents(
    [desired],
    [stale],
    harness.value,
  );

  assert.deepEqual(result, {
    success: true,
    createdCount: 1,
    updatedCount: 0,
    removedCount: 1,
  });
  assert.equal(harness.completionCalls(), 1);
});
