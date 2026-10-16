import type { Project } from "@/types";
import {
  CalendarSyncError,
  guardedWrite,
  type CalendarReceiptStep,
  type PersonalCalendarEvent,
  type PersonalCalendarReceipt,
} from "./reconcile";

export const CALENDAR_OCCURRENCE_COUNT_CHANGED =
  "The number of calendar occurrences for this project changed. Remove it from your Google Calendar and add it again to refresh every occurrence.";
export const CALENDAR_CONNECTION_CHANGED =
  "Your Google Calendar connection changed during the update. Retry the calendar update, and reconnect Google Calendar if it keeps failing.";

/** Must match app_private.personal_calendar_project_source field for field. */
export function personalCalendarProjectSource(project: Project) {
  return {
    id: project.id,
    creator_id: project.creator_id,
    title: project.title,
    description: project.description ?? null,
    location: project.location ?? null,
    event_type: project.event_type,
    schedule: project.schedule,
    project_timezone: project.project_timezone ?? null,
    status: project.status ?? null,
    workflow_status: project.workflow_status ?? null,
  };
}

/** Rewrite every saved event ID in place; nothing is created, removed or moved. */
export async function reconcilePersonalCalendarUpdate(
  initial: PersonalCalendarReceipt,
  dependencies: {
    advance: (
      receipt: PersonalCalendarReceipt,
      step: CalendarReceiptStep,
      payload?: Record<string, unknown>,
    ) => Promise<PersonalCalendarReceipt>;
    events: (receipt: PersonalCalendarReceipt) => PersonalCalendarEvent[];
    /** The stored destination for a legacy marker. Never provisions one. */
    legacyDestination: () => Promise<string | null>;
    /** Confirms the connection is still active and returns its ID. */
    authorize: () => Promise<string>;
    /** `beforeWrite` must run after remote lookups and immediately before the PUT. */
    update: (
      calendarId: string,
      id: string,
      event: PersonalCalendarEvent,
      legacy: boolean,
      beforeWrite: () => Promise<void>,
    ) => Promise<boolean>;
    now?: () => number;
  },
): Promise<{ eventId: string | null; phase: "synced" }> {
  let receipt = initial;
  const now = dependencies.now ?? Date.now;
  const deadline = now() + 25_000;
  if (receipt.phase !== "updating" || !receipt.claim_token)
    throw new CalendarSyncError("Invalid calendar sync receipt");
  // Confirmations belong to the connection the plan was pinned to.
  const pinnedConnection = async () => {
    if ((await dependencies.authorize()) !== receipt.update_connection_id)
      throw new CalendarSyncError(CALENDAR_CONNECTION_CHANGED, 409);
  };
  const renewAuthority = async () => {
    receipt = await dependencies.advance(receipt, "renew");
    await pinnedConnection();
  };
  try {
    if (!receipt.update_planned_at) {
      const ids =
        receipt.events.length > 0
          ? receipt.events.map(({ id }) => id)
          : receipt.legacy_event_id
            ? [receipt.legacy_event_id]
            : [];
      const desired = dependencies.events(receipt);
      if (ids.length === 0 || desired.length !== ids.length)
        throw new CalendarSyncError(CALENDAR_OCCURRENCE_COUNT_CHANGED, 409);
      const calendarId =
        receipt.calendar_id ?? (await dependencies.legacyDestination());
      if (!calendarId || calendarId === "primary")
        throw new CalendarSyncError(
          "Connect or repair your Google Calendar before retrying",
          409,
        );
      receipt = await dependencies.advance(receipt, "plan", {
        calendar_id: calendarId,
        connection_id: await dependencies.authorize(),
        events: ids.map((id, index) => ({
          id,
          event: {
            ...desired[index],
            extendedProperties: {
              private: { letsAssistReceipt: receipt.generation },
            },
          },
        })),
      });
    }
    for (const item of receipt.events) {
      if (receipt.confirmed_event_ids.includes(item.id)) continue;
      if (now() >= deadline)
        throw new CalendarSyncError(
          "Calendar progress saved. Retry to finish the remaining events.",
        );
      await renewAuthority();
      const confirmed = await guardedWrite(
        // The provider lookups take time; lease, source and connection are rechecked right before the PUT.
        renewAuthority,
        (beforeWrite) =>
          dependencies.update(
            receipt.calendar_id!,
            item.id,
            item.event as PersonalCalendarEvent,
            item.id === receipt.legacy_event_id,
            beforeWrite,
          ),
      );
      if (!confirmed)
        throw new CalendarSyncError(
          "Calendar outcome is unconfirmed. Retry to reconcile the same events.",
        );
      // A disconnect or rebind during the write must not be recorded as this connection's success.
      await pinnedConnection();
      receipt = await dependencies.advance(receipt, "confirm", {
        event_id: item.id,
      });
    }
    await pinnedConnection();
    receipt = await dependencies.advance(receipt, "finish");
    return {
      eventId: receipt.events[0]?.id ?? receipt.legacy_event_id,
      phase: "synced",
    };
  } catch (error) {
    // A failed release leaves the lease to expire; the frozen plan remains retryable.
    await dependencies.advance(receipt, "release").catch(() => undefined);
    throw error;
  }
}
