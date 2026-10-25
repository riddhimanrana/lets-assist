import "server-only";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";
const cleanupEventSchema = z.object({
  source_kind: z.enum(["project", "signup"]),
  source_id: z.string().uuid(),
  event_id: z.string().regex(/^[A-Za-z0-9_-]{5,1024}$/),
});
export type CalendarCleanupEvent = z.infer<typeof cleanupEventSchema>;
/**
 * The event ID of this user's own unresolved receipt for one exact source, or
 * null when no such receipt exists. Throws when the lookup cannot be confirmed,
 * so a failed read is never mistaken for "nothing to clean up".
 */
export async function findPersonalCalendarReceiptEvent(
  userId: string,
  sourceKind: CalendarCleanupEvent["source_kind"],
  sourceId: string,
): Promise<string | null> {
  const { data, error } = await getAdminClient().rpc(
    "find_personal_calendar_receipt_event",
    {
      p_actor_user_id: userId,
      p_source_kind: sourceKind,
      p_source_id: sourceId,
    },
  );
  const parsed = cleanupEventSchema.shape.event_id.nullable().safeParse(data);
  if (error || !parsed.success)
    throw new Error("Calendar cleanup state could not be confirmed.");
  return parsed.data;
}

export async function getPersonalCalendarCleanup(
  userId: string,
): Promise<CalendarCleanupEvent[]> {
  const { data, error } = await getAdminClient().rpc(
    "list_personal_calendar_cleanup",
    { p_actor_user_id: userId },
  );
  const parsed = z.array(cleanupEventSchema).max(100).safeParse(data);
  if (error || !parsed.success)
    throw new Error("Calendar cleanup entries could not be loaded.");
  return parsed.data;
}
