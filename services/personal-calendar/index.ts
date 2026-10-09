import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";
import { getGoogleOAuthConnectionForBinding } from "@/lib/auth/google-oauth-connection-store";
import type { Project } from "@/types";
import {
  PERSONAL_CALENDAR_GOOGLE_BINDING,
  formatProjectToCalendarEvent,
  getCalendarConnection,
  getOrCreateVolunteeringCalendar,
  getValidAccessToken,
  markPersonalCalendarConnectionSynced,
} from "@/services/calendar";
import {
  createPersonalCalendarEvent,
  createPersonalCalendarEventRemover,
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
  let authorizedConnectionId: string | null = null;
  const remove = createPersonalCalendarEventRemover();
  /** The user's active personal-calendar connection, read fresh every call. */
  async function activeConnectionId() {
    const connection = await getGoogleOAuthConnectionForBinding(
      input.userId,
      PERSONAL_CALENDAR_GOOGLE_BINDING,
      { useServiceRole: true },
    );
    return connection?.id ?? null;
  }
  async function accessToken() {
    if (!token) {
      // Pin the connection this credential belongs to before it is cached.
      authorizedConnectionId = await activeConnectionId();
      token = authorizedConnectionId
        ? await getValidAccessToken(input.userId)
        : null;
    }
    if (!token)
      throw new CalendarSyncError(
        "Please connect your Google Calendar first",
        409,
      );
    return token;
  }
  /**
   * A disconnect can deactivate the connection after the credential is cached,
   * and the cached credential keeps working at Google until it is revoked. So
   * every provider write first confirms the same connection is still active.
   */
  async function accessTokenForWrite() {
    const value = await accessToken();
    if (
      !authorizedConnectionId ||
      (await activeConnectionId()) !== authorizedConnectionId
    )
      throw new CalendarSyncError(
        "Your Google Calendar was disconnected. Reconnect it to sync events.",
        409,
      );
    return value;
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
        ? getOrCreateVolunteeringCalendar(
            await accessTokenForWrite(),
            input.userId,
          )
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
      createPersonalCalendarEvent(
        await accessTokenForWrite(),
        calendarId,
        id,
        event,
      ),
    remove: async (calendarId, id) =>
      remove(await accessTokenForWrite(), calendarId, id),
  });
  if (result.phase === "synced")
    await markPersonalCalendarConnectionSynced(input.userId).catch(
      () => undefined,
    );
  return result;
}
