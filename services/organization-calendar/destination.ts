import "server-only";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";
import { googleCalendarEventUrl } from "@/lib/google-calendar-identifiers";
import { verifyOwnedLegacyCalendar } from "@/services/personal-calendar/destination";

const destinationSchema = z.object({
  state: z
    .enum(["provisioning", "ready", "unknown_outcome", "rejected"])
    .nullable(),
  calendar_id: z.string().nullable(),
  operation_id: z.string().uuid().nullable(),
  legacy_id: z.string().nullable(),
  should_create: z.boolean(),
});

export async function ensureDurableOrganizationCalendar(
  options: {
    userId: string;
    organizationId: string;
    accessToken: string;
    calendarName: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ calendarId: string; created: boolean } | null> {
  const admin = getAdminClient();
  const actor = {
    p_actor: options.userId,
    p_organization: options.organizationId,
  };
  const claim = async (extra: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc(
      "claim_organization_calendar_destination",
      {
        ...actor,
        ...extra,
      },
    );
    const parsed = destinationSchema.safeParse(data);
    return error || !parsed.success ? null : parsed.data;
  };
  try {
    const current = await claim();
    if (
      !current ||
      (current.state !== null &&
        current.state !== "ready" &&
        current.state !== "rejected")
    )
      return null;
    const existingId = current.calendar_id ?? current.legacy_id;
    if (existingId) {
      const proof = await verifyOwnedLegacyCalendar(
        options.accessToken,
        existingId,
        fetchImpl,
      );
      if (proof === "unconfirmed") return null;
      if (proof === "owned") {
        // This compare-and-swap also binds a verified replacement admin to the
        // existing destination. A browser preference cannot select a calendar.
        const adopted = await claim({ p_verified_calendar_id: existingId });
        return adopted?.state === "ready" && adopted.calendar_id === existingId
          ? { calendarId: existingId, created: false }
          : null;
      }
    }
    const reserved = await claim({
      p_allow_create: true,
      p_replace_calendar_id: existingId,
    });
    if (
      !reserved?.should_create ||
      reserved.state !== "provisioning" ||
      !reserved.operation_id
    )
      return null;
    let outcome = "unknown_outcome";
    let createdId: string | null = null;
    try {
      const response = await fetchImpl(
        "https://www.googleapis.com/calendar/v3/calendars",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            summary: options.calendarName,
            description: `Volunteer events from ${options.calendarName} on Let's Assist`,
            timeZone: "America/Los_Angeles",
          }),
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (response.ok) {
        const data: unknown = await response.json();
        const parsed = z.object({ id: z.string() }).safeParse(data);
        if (parsed.success && parsed.data.id !== "primary") {
          googleCalendarEventUrl(parsed.data.id);
          createdId = parsed.data.id;
          outcome = "ready";
        }
      } else if ([400, 401, 403, 404, 422].includes(response.status)) {
        outcome = "rejected";
      }
    } catch {
      // A lost creation response is not permission to create another calendar.
    }
    const { data, error } = await admin.rpc(
      "complete_organization_calendar_destination",
      {
        ...actor,
        p_operation: reserved.operation_id,
        p_outcome: outcome,
        p_calendar_id: createdId,
      },
    );
    if (
      error ||
      !createdId ||
      !data ||
      data.state !== "ready" ||
      data.calendar_id !== createdId
    )
      return null;
    return { calendarId: createdId, created: true };
  } catch {
    return null;
  }
}
