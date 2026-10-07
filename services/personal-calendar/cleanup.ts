import "server-only";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";
const cleanupEventSchema = z.object({
  source_kind: z.enum(["project", "signup"]),
  source_id: z.string().uuid(),
  event_id: z.string().regex(/^[A-Za-z0-9_-]{5,1024}$/),
});
export type CalendarCleanupEvent = z.infer<typeof cleanupEventSchema>;
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
