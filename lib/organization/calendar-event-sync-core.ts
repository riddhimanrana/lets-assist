export type DesiredCalendarEvent<TProject> = {
  key: string;
  projectId: string;
  project: TProject;
  scheduleId: string;
};

export type TrackedCalendarEvent = {
  id: string;
  key: string;
  eventId: string;
};

export type CalendarEventSyncOperations<TProject> = {
  createRemoteEvent: (
    desired: DesiredCalendarEvent<TProject>,
  ) => Promise<string | null>;
  updateRemoteEvent: (
    tracked: TrackedCalendarEvent,
    desired: DesiredCalendarEvent<TProject>,
  ) => Promise<boolean>;
  deleteRemoteEvent: (eventId: string) => Promise<boolean>;
  insertTrackingEvent: (
    desired: DesiredCalendarEvent<TProject>,
    eventId: string,
  ) => Promise<boolean>;
  updateTrackingEvent: (tracked: TrackedCalendarEvent) => Promise<boolean>;
  deleteTrackingEvent: (tracked: TrackedCalendarEvent) => Promise<boolean>;
  markSyncComplete: () => Promise<boolean>;
};

export type CalendarEventSyncResult =
  | {
      success: true;
      createdCount: number;
      updatedCount: number;
      removedCount: number;
    }
  | { success: false; error: string };

async function runBooleanOperation(operation: () => Promise<boolean>) {
  try {
    return await operation();
  } catch {
    return false;
  }
}

async function runCreateOperation(
  operation: () => Promise<string | null>,
): Promise<string | null> {
  try {
    return await operation();
  } catch {
    return null;
  }
}

export async function synchronizeCalendarEvents<TProject>(
  desiredEvents: readonly DesiredCalendarEvent<TProject>[],
  trackedEvents: readonly TrackedCalendarEvent[],
  operations: CalendarEventSyncOperations<TProject>,
): Promise<CalendarEventSyncResult> {
  const trackedByKey = new Map(
    trackedEvents.map((event) => [event.key, event] as const),
  );
  const desiredKeys = new Set<string>();
  let createdCount = 0;
  let updatedCount = 0;
  let removedCount = 0;

  for (const desired of desiredEvents) {
    if (desiredKeys.has(desired.key)) {
      return {
        success: false,
        error: "Calendar sync contains duplicate project schedule entries",
      };
    }
    desiredKeys.add(desired.key);

    const tracked = trackedByKey.get(desired.key);
    if (tracked) {
      const remoteUpdated = await runBooleanOperation(() =>
        operations.updateRemoteEvent(tracked, desired),
      );
      if (!remoteUpdated) {
        return { success: false, error: "Failed to update a Google calendar event" };
      }

      const trackingUpdated = await runBooleanOperation(() =>
        operations.updateTrackingEvent(tracked),
      );
      if (!trackingUpdated) {
        return {
          success: false,
          error: "Google calendar event updated, but its tracking row could not be updated",
        };
      }

      updatedCount += 1;
      continue;
    }

    const eventId = await runCreateOperation(() =>
      operations.createRemoteEvent(desired),
    );
    if (!eventId) {
      return { success: false, error: "Failed to create a Google calendar event" };
    }

    const trackingInserted = await runBooleanOperation(() =>
      operations.insertTrackingEvent(desired, eventId),
    );
    if (!trackingInserted) {
      const compensated = await runBooleanOperation(() =>
        operations.deleteRemoteEvent(eventId),
      );
      return {
        success: false,
        error: compensated
          ? "Calendar tracking insert failed; the new Google event was rolled back"
          : "Calendar tracking insert failed and the new Google event could not be rolled back",
      };
    }

    createdCount += 1;
  }

  for (const tracked of trackedEvents) {
    if (desiredKeys.has(tracked.key)) continue;

    const remoteDeleted = await runBooleanOperation(() =>
      operations.deleteRemoteEvent(tracked.eventId),
    );
    if (!remoteDeleted) {
      return { success: false, error: "Failed to remove a stale Google calendar event" };
    }

    const trackingDeleted = await runBooleanOperation(() =>
      operations.deleteTrackingEvent(tracked),
    );
    if (!trackingDeleted) {
      return {
        success: false,
        error: "Google calendar event removed, but its tracking row could not be deleted",
      };
    }

    removedCount += 1;
  }

  const completionRecorded = await runBooleanOperation(
    operations.markSyncComplete,
  );
  if (!completionRecorded) {
    return {
      success: false,
      error: "Calendar events synced, but completion could not be recorded",
    };
  }

  return { success: true, createdCount, updatedCount, removedCount };
}
