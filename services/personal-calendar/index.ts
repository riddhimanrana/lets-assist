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
  createPersonalCalendarEventUpdater,
} from "./provider";
import {
  CalendarSyncError,
  UNFINISHED_CALENDAR_UPDATE,
  guardedWrite,
  personalCalendarReceiptSchema,
  reconcilePersonalCalendar,
  type PersonalCalendarEvent,
} from "./reconcile";
import {
  CALENDAR_CONNECTION_CHANGED,
  CALENDAR_OCCURRENCE_COUNT_CHANGED,
  personalCalendarProjectSource,
  reconcilePersonalCalendarUpdate,
} from "./update";
export { CalendarSyncError } from "./reconcile";

/** Refusals the update functions name with a HINT, so the caller can say what to do next. */
const RECEIPT_REFUSALS: Record<string, string> = {
  calendar_operation_in_progress:
    "Another calendar change for this project is in progress. Retry in about two minutes.",
  calendar_receipt_syncing:
    "This project is still being added to Google Calendar. Add it to your calendar again to finish, then retry the update.",
  calendar_receipt_removing:
    "This project is still being removed from Google Calendar. Finish removing it in your calendar settings before updating it.",
  calendar_receipt_removed:
    "This project's calendar entry was removed. Add it to your calendar again to see the latest details.",
  calendar_event_changed:
    "This project's calendar entry changed. Refresh the page, then retry the calendar update.",
  calendar_source_unavailable:
    "Calendar updates are available only for published projects that are not cancelled.",
  calendar_source_changed:
    "The project changed while its calendar entry was updating. Retry to apply the latest details.",
  calendar_occurrence_count_changed: CALENDAR_OCCURRENCE_COUNT_CHANGED,
  calendar_connection_changed: CALENDAR_CONNECTION_CHANGED,
};

function createReceiptStore(expected: {
  userId: string;
  sourceKind: "project" | "signup";
  sourceId?: string;
  projectId?: string;
}) {
  const admin = getAdminClient();
  async function call(name: string, args: Record<string, unknown>) {
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
        RECEIPT_REFUSALS[error.hint ?? ""] ??
          (status === 404
            ? "Calendar event not found"
            : "Calendar sync state could not be confirmed. Retry shortly."),
        status,
      );
    }
    return data as unknown;
  }
  function parse(data: unknown) {
    const parsed = personalCalendarReceiptSchema.safeParse(data);
    if (
      !parsed.success ||
      parsed.data.user_id !== expected.userId ||
      parsed.data.source_kind !== expected.sourceKind ||
      (expected.sourceId && parsed.data.source_id !== expected.sourceId) ||
      (expected.projectId && parsed.data.project_id !== expected.projectId)
    ) {
      throw new CalendarSyncError("Invalid calendar sync receipt");
    }
    return parsed.data;
  }
  return {
    call,
    parse,
    rpc: async (name: string, args: Record<string, unknown>) =>
      parse(await call(name, args)),
  };
}

type PersonalConnection = NonNullable<
  Awaited<ReturnType<typeof getGoogleOAuthConnectionForBinding>>
>;

/**
 * Which grant the connection row holds. The same row ID can be reauthorized,
 * as another account or the same one. A reconnect resets `connected_at`; an
 * ordinary token refresh keeps it and only advances `updated_at`, which is why
 * `updated_at` is pinned separately as the revision and is not part of this.
 * Scopes and connection type are included so a changed grant or configuration
 * is never mistaken for a harmless row write.
 */
function connectionIdentity(connection: PersonalConnection) {
  return JSON.stringify([
    connection.id,
    connection.calendar_email ?? null,
    connection.connected_at ?? null,
    connection.granted_scopes ?? null,
    connection.connection_type ?? null,
    connection.binding_identity_email ?? null,
    connection.binding_identity_verified_at ?? null,
  ]);
}

function createConnectionFence(userId: string) {
  let pinned: {
    token: string;
    identity: string;
    revision: string | null;
  } | null = null;
  /** The user's active personal-calendar connection, read fresh every call. */
  async function activeConnection() {
    return getGoogleOAuthConnectionForBinding(
      userId,
      PERSONAL_CALENDAR_GOOGLE_BINDING,
      { useServiceRole: true },
    );
  }
  const disconnected = () =>
    new CalendarSyncError(
      "Your Google Calendar was disconnected. Reconnect it to sync events.",
      409,
    );
  async function accessToken() {
    if (!pinned) {
      const before = await activeConnection();
      const token = before ? await getValidAccessToken(userId) : null;
      if (!before || !token)
        throw new CalendarSyncError(
          "Please connect your Google Calendar first",
          409,
        );
      // The credential is trusted only if the row is bound to the same account
      // on both sides of the fetch. A refresh may advance the row revision, so
      // the revision baseline is taken after the fetch.
      const after = await activeConnection();
      if (!after || connectionIdentity(after) !== connectionIdentity(before))
        throw disconnected();
      pinned = {
        token,
        identity: connectionIdentity(after),
        revision: after.updated_at ?? null,
      };
    }
    return pinned;
  }
  /**
   * A disconnect or reauthorization can change the connection after the
   * credential is cached, and the cached credential keeps working at Google
   * until it is revoked. So every provider write and acknowledgement first
   * confirms the same identity and row revision are still active.
   */
  async function authorizeWrite() {
    const baseline = await accessToken();
    const connection = await activeConnection();
    if (
      !connection ||
      connectionIdentity(connection) !== baseline.identity ||
      (connection.updated_at ?? null) !== baseline.revision
    )
      throw disconnected();
    return { token: baseline.token, connection };
  }
  /**
   * Provisioning the destination saves its calendar ID on this same row, which
   * advances the row revision. Accept that one owned write: the grant and
   * configuration must be unchanged, and only then is the revision re-pinned.
   * Everything after this point is checked strictly against the new revision.
   */
  async function repinAfterOwnedDestinationWrite() {
    const baseline = await accessToken();
    const connection = await activeConnection();
    if (!connection || connectionIdentity(connection) !== baseline.identity)
      throw disconnected();
    baseline.revision = connection.updated_at ?? null;
  }
  return {
    authorizeWrite,
    /** Resolve the destination for a new sync, creating it if needed. */
    createDestination: async (
      resolve: (token: string) => Promise<string | null>,
    ) => {
      const { token } = await authorizeWrite();
      const calendarId = await resolve(token);
      if (calendarId) await repinAfterOwnedDestinationWrite();
      return calendarId;
    },
    accessTokenForWrite: async () => (await authorizeWrite()).token,
    planRevision: async () => {
      const { revision } = await accessToken();
      return revision ? { connection_updated_at: revision } : {};
    },
  };
}

export async function synchronizePersonalCalendar(input: {
  userId: string;
  sourceKind: "project" | "signup";
  sourceId?: string;
  operation: "sync" | "remove";
  scheduleId?: string;
  expectedEventId?: string;
  project?: Project;
}) {
  const store = createReceiptStore({
    userId: input.userId,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    projectId: input.project?.id,
  });
  const initial = await store.rpc("claim_personal_calendar_sync", {
    p_actor_user_id: input.userId,
    p_source_kind: input.sourceKind,
    p_source_id: input.sourceId ?? null,
    p_operation: input.operation,
    p_schedule_id: input.scheduleId ?? null,
    p_expected_event_id: input.expectedEventId ?? null,
  });
  if (initial.phase === "updating") {
    // The create claim took no lease. Only the update path may resume this receipt.
    if (input.sourceKind !== "project" || !input.project)
      throw new CalendarSyncError(UNFINISHED_CALENDAR_UPDATE, 409);
    const updated = await updatePersonalCalendarProject({
      userId: input.userId,
      project: input.project,
    });
    if (updated.phase !== "synced")
      throw new CalendarSyncError(UNFINISHED_CALENDAR_UPDATE, 409);
    return { eventId: updated.eventId, phase: updated.phase };
  }
  const fence = createConnectionFence(input.userId);
  const remove = createPersonalCalendarEventRemover();
  const result = await reconcilePersonalCalendar(initial, {
    advance: (receipt, step, payload = {}) =>
      store.rpc("advance_personal_calendar_sync", {
        p_actor_user_id: input.userId,
        p_source_kind: receipt.source_kind,
        p_source_id: receipt.source_id,
        p_claim_token: receipt.claim_token,
        p_step: step,
        p_payload: payload,
      }),
    destination: async (create) =>
      create
        ? fence.createDestination((token) =>
            getOrCreateVolunteeringCalendar(token, input.userId),
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
        await fence.accessTokenForWrite(),
        calendarId,
        id,
        event,
      ),
    remove: (calendarId, id, beforeWrite) =>
      guardedWrite(
        // After the ownership lookup: renew the receipt, then recheck the binding.
        async () => {
          await beforeWrite();
          await fence.authorizeWrite();
        },
        async (check) =>
          remove(await fence.accessTokenForWrite(), calendarId, id, check),
      ),
  });
  if (result.phase === "synced")
    await markPersonalCalendarConnectionSynced(input.userId).catch(
      () => undefined,
    );
  return result;
}

/**
 * Update the creator's already synced calendar entry in place. The caller
 * supplies a project it read for the authenticated creator; the claim compares
 * that read with the locked row before anything is planned or written.
 */
export async function updatePersonalCalendarProject(input: {
  userId: string;
  project: Project;
}): Promise<{ eventId: string | null; phase: "synced" | "not_synced" }> {
  const { userId, project } = input;
  if (project.creator_id !== userId)
    throw new CalendarSyncError(
      "Only the project creator can update this calendar entry",
      403,
    );
  const store = createReceiptStore({
    userId,
    sourceKind: "project",
    sourceId: project.id,
    projectId: project.id,
  });
  const claimed = await store.call("claim_personal_calendar_update", {
    p_actor_user_id: userId,
    p_project_id: project.id,
    p_expected_source: personalCalendarProjectSource(project),
  });
  // Never synced, or already removed: there is nothing to update and nothing to provision.
  if (claimed === null) return { eventId: null, phase: "not_synced" };
  const initial = store.parse(claimed);
  const fence = createConnectionFence(userId);
  const update = createPersonalCalendarEventUpdater();
  const result = await reconcilePersonalCalendarUpdate(initial, {
    advance: async (receipt, step, payload = {}) =>
      store.rpc("advance_personal_calendar_sync", {
        p_actor_user_id: userId,
        p_source_kind: receipt.source_kind,
        p_source_id: receipt.source_id,
        p_claim_token: receipt.claim_token,
        p_step: step,
        // The plan names the row revision this credential was read at, so the
        // database refuses a same-ID rebind that happened in between.
        p_payload:
          step === "plan"
            ? { ...payload, ...(await fence.planRevision()) }
            : payload,
      }),
    events: (receipt) => {
      // The originally selected schedule decides which occurrences are rewritten.
      const scheduleId = receipt.requested_schedule_id ?? undefined;
      if (
        project.event_type === "oneTime" &&
        scheduleId &&
        scheduleId !== "oneTime"
      )
        return [];
      const formatted = formatProjectToCalendarEvent(project, scheduleId);
      return (
        Array.isArray(formatted) ? formatted : formatted ? [formatted] : []
      ) as PersonalCalendarEvent[];
    },
    legacyDestination: async () =>
      (await fence.authorizeWrite()).connection.preferences
        ?.volunteering_calendar_id ?? null,
    authorize: async () => (await fence.authorizeWrite()).connection.id,
    update: async (calendarId, id, event, legacy, beforeWrite) =>
      update(await fence.accessTokenForWrite(), calendarId, id, event, {
        legacy,
        beforeWrite,
      }),
  });
  await markPersonalCalendarConnectionSynced(userId).catch(() => undefined);
  return result;
}
