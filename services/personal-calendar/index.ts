import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";
import type { Project } from "@/types";
import {
  formatProjectToCalendarEvent,
  getCalendarConnection,
  getOrCreateVolunteeringCalendar,
  getValidAccessToken,
  markPersonalCalendarConnectionSynced,
} from "@/services/calendar";
import {
  createPersonalCalendarEvent,
  removePersonalCalendarEvent,
} from "./provider";
import {
  CalendarSyncError,
  personalCalendarReceiptSchema,
  reconcilePersonalCalendar,
  type PersonalCalendarEvent,
} from "./reconcile";
export { CalendarSyncError } from "./reconcile";

export async function synchronizePersonalCalendar(input: {
  userId: string;
  sourceKind: "project" | "signup";
  sourceId?: string;
  operation: "sync" | "remove";
  scheduleId?: string;
  expectedEventId?: string;
  project?: Project;
}) {
  const admin = getAdminClient();
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await admin.rpc(name, args);
    if (error) {
      const status =
        error.code === "P0002"
          ? 404
          : error.code === "42501"
            ? 403
            : ["55P03", "55000"].includes(error.code)
              ? 409
              : error.code === "22023"
                ? 400
                : 503;
      throw new CalendarSyncError(
        status === 404
          ? "Calendar event not found"
          : "Calendar sync state could not be confirmed. Retry shortly.",
        status,
      );
    }
    const parsed = personalCalendarReceiptSchema.safeParse(data);
    if (
      !parsed.success ||
      parsed.data.user_id !== input.userId ||
      parsed.data.source_kind !== input.sourceKind ||
      (input.sourceId && parsed.data.source_id !== input.sourceId) ||
      (input.project && parsed.data.project_id !== input.project.id)
    ) {
      throw new CalendarSyncError("Invalid calendar sync receipt");
    }
    return parsed.data;
  }
  const initial = await rpc("claim_personal_calendar_sync", {
    p_actor_user_id: input.userId,
    p_source_kind: input.sourceKind,
    p_source_id: input.sourceId ?? null,
    p_operation: input.operation,
    p_schedule_id: input.scheduleId ?? null,
    p_expected_event_id: input.expectedEventId ?? null,
  });
  let token: string | null = null;
  async function accessToken() {
    token ??= await getValidAccessToken(input.userId);
    if (!token)
      throw new CalendarSyncError(
        "Please connect your Google Calendar first",
        409,
      );
    return token;
  }
  const result = await reconcilePersonalCalendar(initial, {
    advance: (receipt, step, payload = {}) =>
      rpc("advance_personal_calendar_sync", {
        p_actor_user_id: input.userId,
        p_source_kind: receipt.source_kind,
        p_source_id: receipt.source_id,
        p_claim_token: receipt.claim_token,
        p_step: step,
        p_payload: payload,
      }),
    destination: async (create) =>
      create
        ? getOrCreateVolunteeringCalendar(await accessToken(), input.userId)
        : ((await getCalendarConnection(input.userId))?.preferences
            ?.volunteering_calendar_id ?? null),
    events: () => {
      if (
        !input.project ||
        (input.project.event_type === "oneTime" &&
          input.scheduleId &&
          input.scheduleId !== "oneTime")
      ) {
        throw new CalendarSyncError("Project schedule not found", 400);
      }
      const formatted = formatProjectToCalendarEvent(
        input.project,
        input.scheduleId,
      );
      return (
        Array.isArray(formatted) ? formatted : formatted ? [formatted] : []
      ) as PersonalCalendarEvent[];
    },
    create: async (calendarId, id, event) =>
      createPersonalCalendarEvent(await accessToken(), calendarId, id, event),
    remove: async (calendarId, id) =>
      removePersonalCalendarEvent(await accessToken(), calendarId, id),
  });
  if (result.phase === "synced")
    await markPersonalCalendarConnectionSynced(input.userId).catch(
      () => undefined,
    );
  return result;
}
