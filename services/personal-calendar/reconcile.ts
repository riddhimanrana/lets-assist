import { createHash } from "node:crypto";
import { z } from "zod";
import type { GoogleCalendarOwnedEvent } from "../google-calendar-event-mutations";

const plannedEventSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{5,1024}$/),
  event: z.record(z.string(), z.unknown()).nullable(),
});
export const personalCalendarReceiptSchema = z.object({
  source_kind: z.enum(["project", "signup"]),
  source_id: z.string().uuid(),
  user_id: z.string().uuid(),
  project_id: z.string().uuid(),
  generation: z.string().uuid(),
  phase: z.enum(["syncing", "synced", "removing", "removed"]),
  requested_schedule_id: z.string().nullable(),
  legacy_event_id: z.string().nullable(),
  calendar_id: z.string().nullable(),
  events: z.array(plannedEventSchema).max(500),
  confirmed_event_ids: z.array(z.string()),
  claim_token: z.string().uuid().nullable(),
});
export type PersonalCalendarReceipt = z.infer<
  typeof personalCalendarReceiptSchema
>;
export type PersonalCalendarEvent = GoogleCalendarOwnedEvent &
  Record<string, unknown>;
export type CalendarReceiptStep =
  "plan" | "renew" | "confirm" | "finish" | "release";
export class CalendarSyncError extends Error {
  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message);
  }
}

export function personalCalendarEventId(generation: string, index: number) {
  return `la${createHash("sha256").update(`${generation}:${index}`).digest("hex")}`;
}

export async function reconcilePersonalCalendar(
  initial: PersonalCalendarReceipt,
  dependencies: {
    advance: (
      receipt: PersonalCalendarReceipt,
      step: CalendarReceiptStep,
      payload?: Record<string, unknown>,
    ) => Promise<PersonalCalendarReceipt>;
    destination: (create: boolean) => Promise<string | null>;
    events: () => PersonalCalendarEvent[];
    create: (
      calendarId: string,
      id: string,
      event: PersonalCalendarEvent,
    ) => Promise<boolean>;
    remove: (calendarId: string, id: string) => Promise<boolean>;
    now?: () => number;
  },
): Promise<{ eventId: string | null; phase: "synced" | "removed" }> {
  let receipt = initial;
  const now = dependencies.now ?? Date.now;
  const deadline = now() + 25_000;
  if (receipt.phase === "synced" || receipt.phase === "removed") {
    return {
      eventId: receipt.events[0]?.id ?? receipt.legacy_event_id,
      phase: receipt.phase,
    };
  }
  try {
    if (
      !receipt.calendar_id &&
      (receipt.phase === "syncing" || receipt.legacy_event_id)
    ) {
      const events =
        receipt.phase === "syncing"
          ? dependencies.events().map((event, index) => ({
              id: personalCalendarEventId(receipt.generation, index),
              event: {
                ...event,
                extendedProperties: {
                  private: { letsAssistReceipt: receipt.generation },
                },
              },
            }))
          : [{ id: receipt.legacy_event_id!, event: null }];
      if (events.length === 0 || events.length > 500) {
        throw new CalendarSyncError(
          "Select between 1 and 500 calendar occurrences",
          400,
        );
      }
      const calendarId = await dependencies.destination(
        receipt.phase === "syncing",
      );
      if (!calendarId)
        throw new CalendarSyncError(
          "Connect or repair your Google Calendar before retrying",
          409,
        );
      receipt = await dependencies.advance(receipt, "plan", {
        calendar_id: calendarId,
        events,
      });
    }
    for (const item of receipt.events) {
      if (receipt.confirmed_event_ids.includes(item.id)) continue;
      if (now() >= deadline)
        throw new CalendarSyncError(
          "Calendar progress saved. Retry to finish the remaining events.",
        );
      receipt = await dependencies.advance(receipt, "renew");
      const confirmed =
        receipt.phase === "syncing"
          ? await dependencies.create(
              receipt.calendar_id!,
              item.id,
              item.event as PersonalCalendarEvent,
            )
          : await dependencies.remove(receipt.calendar_id!, item.id);
      if (!confirmed)
        throw new CalendarSyncError(
          "Calendar outcome is unconfirmed. Retry to reconcile the same events.",
        );
      receipt = await dependencies.advance(receipt, "confirm", {
        event_id: item.id,
      });
    }
    receipt = await dependencies.advance(receipt, "finish");
    return {
      eventId: receipt.events[0]?.id ?? receipt.legacy_event_id,
      phase: receipt.phase as "synced" | "removed",
    };
  } catch (error) {
    // A failed release leaves the lease to expire; the persisted plan remains retryable.
    await dependencies.advance(receipt, "release").catch(() => undefined);
    throw error;
  }
}
