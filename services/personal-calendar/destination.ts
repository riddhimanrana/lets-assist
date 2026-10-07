import "server-only";
import { randomUUID } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { getGoogleOAuthConnectionForBinding } from "@/lib/auth/google-oauth-connection-store";
import { googleCalendarEventUrl } from "@/lib/google-calendar-identifiers";
import { getCsfPersonalCalendarProviderContext } from "@/services/calendar-csf-personal";
import {
  getGoogleCalendarAccessState,
  PERSONAL_CALENDAR_GOOGLE_BINDING,
} from "@/services/calendar";

export async function verifyOwnedLegacyCalendar(
  accessToken: string,
  calendarId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<"owned" | "missing" | "unconfirmed"> {
  try {
    googleCalendarEventUrl(calendarId);
    if (calendarId === "primary") return "unconfirmed";
    const access = await getGoogleCalendarAccessState(
      accessToken,
      calendarId,
      fetchImpl,
    );
    if (access.status === "missing") return "missing";
    if (access.status !== "accessible") return "unconfirmed";
    const response = await fetchImpl(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(calendarId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      },
    );
    if (!response.ok) return "unconfirmed";
    const value: unknown = await response.json();
    if (!value || typeof value !== "object") return "unconfirmed";
    const calendar = value as {
      id?: unknown;
      accessRole?: unknown;
      primary?: unknown;
      deleted?: unknown;
    };
    return calendar.id === calendarId &&
      calendar.accessRole === "owner" &&
      calendar.primary !== true &&
      calendar.deleted !== true
      ? "owned"
      : "unconfirmed";
  } catch {
    return "unconfirmed";
  }
}

export async function getDurablePersonalCalendarDestination(
  accessToken: string,
  userId: string,
): Promise<string | null> {
  const admin = getAdminClient();
  const { data: destination, error } = await admin
    .schema("plugin_data")
    .from("csf_personal_calendar_destinations")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null;
  if (!destination) {
    const connection = await getGoogleOAuthConnectionForBinding(
      userId,
      PERSONAL_CALENDAR_GOOGLE_BINDING,
      { useServiceRole: true },
    );
    const candidate = connection?.preferences?.volunteering_calendar_id;
    if (candidate && connection) {
      const proof = await verifyOwnedLegacyCalendar(accessToken, candidate);
      if (proof === "unconfirmed") return null;
      if (proof === "owned") {
        const { error: adoptionError } = await admin.rpc(
          "adopt_verified_personal_calendar_destination",
          {
            p_user_id: userId,
            p_connection_id: connection.id,
            p_calendar_id: candidate,
          },
        );
        if (adoptionError) return null;
      }
    }
  }
  // Both platform and CSF events use the same user-scoped destination ledger.
  const context = await getCsfPersonalCalendarProviderContext(userId, {
    requestId: randomUUID(),
    allowCreate: true,
  });
  return context.status === "ready" ? context.calendarId : null;
}
