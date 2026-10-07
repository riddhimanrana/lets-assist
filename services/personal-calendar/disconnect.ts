import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getGoogleOAuthConnectionForBinding } from "@/lib/auth/google-oauth-connection-store";
import { PERSONAL_CALENDAR_GOOGLE_BINDING } from "@/services/calendar";
import { CalendarSyncError } from "./reconcile";

function timestampMicros(value: string): bigint | null {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return null;
  const milliseconds = Date.parse(`${match[1]}${match[3]}`);
  return Number.isFinite(milliseconds)
    ? BigInt(milliseconds) * BigInt(1000) +
        BigInt((match[2] ?? "").padEnd(6, "0"))
    : null;
}
const timestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => timestampMicros(value) !== null);
const preparedSchema = z
  .object({
    user_id: z.string().uuid(),
    connection_id: z.string().uuid(),
    connection_updated_at: timestampSchema,
    prepared_count: z.number().int().min(0).max(2000),
  })
  .strict();
const unavailable = () =>
  new CalendarSyncError(
    "Calendar cleanup state could not be saved. Retry before disconnecting.",
  );

/** Save cleanup metadata atomically without removing events or credentials. */
export async function preparePersonalCalendarDisconnect(
  userId: string,
): Promise<{ connectionId: string; updatedAt: string }> {
  try {
    const session = await createClient();
    const { data: auth, error: authError } = await session.auth.getUser();
    if (authError) throw unavailable();
    if (!auth.user)
      throw new CalendarSyncError("Sign in before disconnecting.", 401);
    if (auth.user.id !== userId || !z.string().uuid().safeParse(userId).success)
      throw new CalendarSyncError("Calendar access denied.", 403);

    const connection = await getGoogleOAuthConnectionForBinding(
      userId,
      PERSONAL_CALENDAR_GOOGLE_BINDING,
      { activeOnly: false },
    );
    if (!connection)
      throw new CalendarSyncError(
        "Calendar connection could not be found or confirmed.",
        404,
      );
    if (
      !z.string().uuid().safeParse(connection.id).success ||
      connection.user_id !== userId ||
      connection.provider !== "google" ||
      !timestampSchema.safeParse(connection.updated_at).success
    )
      throw unavailable();
    const { data, error } = await getAdminClient()
      .rpc("prepare_personal_calendar_disconnect", {
        p_actor_user_id: userId,
        p_connection_id: connection.id,
        p_expected_updated_at: connection.updated_at,
      })
      .abortSignal(AbortSignal.timeout(15_000));
    if (error) {
      if (error.code === "42501")
        throw new CalendarSyncError(
          "Calendar access changed. Refresh before disconnecting.",
          403,
        );
      if (["55P03", "55000", "54000"].includes(error.code))
        throw new CalendarSyncError(
          "Calendar cleanup is not ready. Retry before disconnecting.",
          409,
        );
      throw unavailable();
    }
    const prepared = preparedSchema.safeParse(data);
    if (
      !prepared.success ||
      prepared.data.user_id !== userId ||
      prepared.data.connection_id !== connection.id ||
      timestampMicros(prepared.data.connection_updated_at) !==
        timestampMicros(connection.updated_at)
    )
      throw unavailable();
    return { connectionId: connection.id, updatedAt: connection.updated_at };
  } catch (error) {
    if (error instanceof CalendarSyncError) throw error;
    throw unavailable();
  }
}
