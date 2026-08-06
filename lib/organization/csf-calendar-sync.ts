import "server-only";

import { synchronizeCalendarEvents } from "@/lib/organization/calendar-event-sync-core";
import { createPluginAdminClient } from "@/lib/plugins/supabase";
import { getAdminClient } from "@/lib/supabase/admin";

const CSF_CALENDAR_SOURCE_KINDS = [
  "csf_opportunity",
  "csf_meeting_session",
  "csf_deadline",
] as const;

type CsfCalendarSourceKind = (typeof CSF_CALENDAR_SOURCE_KINDS)[number];

type CalendarDateTime =
  { dateTime: string; timeZone: string } | { date: string };

export type CsfGoogleCalendarEvent = {
  summary: string;
  description?: string;
  location?: string;
  start: CalendarDateTime;
  end: CalendarDateTime;
  transparency: "opaque" | "transparent";
  visibility: "default";
  extendedProperties: {
    private: {
      letsAssistSourceKind: CsfCalendarSourceKind;
      letsAssistSourceId: string;
    };
  };
};

type CsfCalendarProjection = {
  sourceKind: CsfCalendarSourceKind;
  sourceId: string;
  occurrenceKey: string;
  event: CsfGoogleCalendarEvent;
};

type OpportunityRow = {
  id: string;
  title: string;
  body: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  signup_url: string | null;
  status: string;
};

type MeetingRow = {
  id: string;
  label: string;
  status: string;
};

type MeetingSessionRow = {
  id: string;
  meeting_id: string;
  session_date: string | null;
  starts_at: string | null;
  location: string | null;
  status: string;
};

type DeadlineRow = {
  id: string;
  title: string;
  description: string | null;
  due_at: string;
  status: string;
  audience: string;
  related_route: string | null;
};

type BuildCsfCalendarProjectionInput = {
  opportunities: OpportunityRow[];
  meetings: MeetingRow[];
  meetingSessions: MeetingSessionRow[];
  deadlines: DeadlineRow[];
};

export type CsfCalendarSyncResult =
  | {
      success: true;
      createdCount: number;
      updatedCount: number;
      removedCount: number;
    }
  | { success: false; error: string };

const CALENDAR_TIME_ZONE = "America/Los_Angeles";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

function validDateTime(value: string | null): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function dateTimeRange(
  start: string,
  end: string | null,
  defaultMinutes: number,
) {
  const startTime = Date.parse(start);
  const parsedEnd = validDateTime(end) ? Date.parse(end) : Number.NaN;
  const endTime =
    Number.isFinite(parsedEnd) && parsedEnd > startTime
      ? parsedEnd
      : startTime + defaultMinutes * 60_000;
  return {
    start: {
      dateTime: new Date(startTime).toISOString(),
      timeZone: CALENDAR_TIME_ZONE,
    },
    end: {
      dateTime: new Date(endTime).toISOString(),
      timeZone: CALENDAR_TIME_ZONE,
    },
  } as const;
}

function nextCalendarDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function metadata(sourceKind: CsfCalendarSourceKind, sourceId: string) {
  return {
    visibility: "default" as const,
    extendedProperties: {
      private: {
        letsAssistSourceKind: sourceKind,
        letsAssistSourceId: sourceId,
      },
    },
  };
}

function appendPublicLink(description: string | null, link: string | null) {
  const text = description?.trim() ?? "";
  const safeLink = link && /^https:\/\//u.test(link) ? link : "";
  return (
    [text, safeLink ? `More information: ${safeLink}` : ""]
      .filter(Boolean)
      .join("\n\n") || undefined
  );
}

/** Builds only publishable CSF calendar records; private attendance/source data is never projected. */
export function buildCsfCalendarProjections(
  input: BuildCsfCalendarProjectionInput,
): CsfCalendarProjection[] {
  const projections: CsfCalendarProjection[] = [];

  for (const opportunity of input.opportunities) {
    if (
      opportunity.status !== "published" ||
      !validDateTime(opportunity.starts_at)
    )
      continue;
    const range = dateTimeRange(opportunity.starts_at, opportunity.ends_at, 60);
    projections.push({
      sourceKind: "csf_opportunity",
      sourceId: opportunity.id,
      occurrenceKey: "primary",
      event: {
        summary: `[CSF] ${opportunity.title}`,
        description: appendPublicLink(opportunity.body, opportunity.signup_url),
        location: opportunity.location?.trim() || undefined,
        ...range,
        transparency: "opaque",
        ...metadata("csf_opportunity", opportunity.id),
      },
    });
  }

  const activeMeetings = new Map(
    input.meetings
      .filter((meeting) => meeting.status === "active")
      .map((meeting) => [meeting.id, meeting] as const),
  );
  for (const session of input.meetingSessions) {
    const meeting = activeMeetings.get(session.meeting_id);
    if (!meeting || !["scheduled", "open"].includes(session.status)) continue;

    let range: Pick<CsfGoogleCalendarEvent, "start" | "end"> | null = null;
    if (validDateTime(session.starts_at)) {
      range = dateTimeRange(session.starts_at, null, 60);
    } else if (session.session_date) {
      const endDate = nextCalendarDate(session.session_date);
      if (endDate)
        range = {
          start: { date: session.session_date },
          end: { date: endDate },
        };
    }
    if (!range) continue;

    projections.push({
      sourceKind: "csf_meeting_session",
      sourceId: session.id,
      occurrenceKey: "primary",
      event: {
        summary: `[CSF] ${meeting.label}`,
        location: session.location?.trim() || undefined,
        ...range,
        transparency: "opaque",
        ...metadata("csf_meeting_session", session.id),
      },
    });
  }

  for (const deadline of input.deadlines) {
    if (
      !["planned", "open"].includes(deadline.status) ||
      !validDateTime(deadline.due_at)
    )
      continue;
    const range = dateTimeRange(deadline.due_at, null, 30);
    const safeRoute =
      deadline.related_route && /^\/(?!\/)/u.test(deadline.related_route)
        ? deadline.related_route
        : null;
    projections.push({
      sourceKind: "csf_deadline",
      sourceId: deadline.id,
      occurrenceKey: "primary",
      event: {
        summary: `[CSF deadline] ${deadline.title}`,
        description:
          [
            deadline.description?.trim(),
            safeRoute ? `Open in Let's Assist: ${safeRoute}` : null,
          ]
            .filter(Boolean)
            .join("\n\n") || undefined,
        ...range,
        transparency: "transparent",
        ...metadata("csf_deadline", deadline.id),
      },
    });
  }

  return projections;
}

async function createRemoteEvent(
  accessToken: string,
  calendarId: string,
  event: CsfGoogleCalendarEvent,
): Promise<string | null> {
  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      },
    );
    if (!response.ok) return null;
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("id" in result) ||
      typeof result.id !== "string"
    )
      return null;
    return result.id;
  } catch {
    return null;
  }
}

async function updateRemoteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: CsfGoogleCalendarEvent,
) {
  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function deleteRemoteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
) {
  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export async function syncCsfCalendarProjections(options: {
  organizationId: string;
  accessToken: string;
  calendarId: string;
}): Promise<CsfCalendarSyncResult> {
  const serviceSupabase = getAdminClient();
  const pluginSupabase = createPluginAdminClient();
  const [
    opportunityResult,
    meetingResult,
    sessionResult,
    deadlineResult,
    existingResult,
  ] = await Promise.all([
    pluginSupabase
      .from("csf_opportunities")
      .select(
        "id, title, body, starts_at, ends_at, location, signup_url, status",
      )
      .eq("organization_id", options.organizationId),
    pluginSupabase
      .from("csf_meetings")
      .select("id, label, status")
      .eq("organization_id", options.organizationId),
    pluginSupabase
      .from("csf_meeting_sessions")
      .select("id, meeting_id, session_date, starts_at, location, status")
      .eq("organization_id", options.organizationId),
    pluginSupabase
      .from("csf_term_deadlines")
      .select("id, title, description, due_at, status, audience, related_route")
      .eq("organization_id", options.organizationId),
    serviceSupabase
      .from("organization_calendar_events")
      .select("id, source_kind, source_id, occurrence_key, event_id")
      .eq("organization_id", options.organizationId)
      .in("source_kind", [...CSF_CALENDAR_SOURCE_KINDS]),
  ]);

  if (
    opportunityResult.error ||
    meetingResult.error ||
    sessionResult.error ||
    deadlineResult.error ||
    existingResult.error
  ) {
    return { success: false, error: "Failed to load CSF calendar sources." };
  }

  const projections = buildCsfCalendarProjections({
    opportunities: (opportunityResult.data ?? []) as OpportunityRow[],
    meetings: (meetingResult.data ?? []) as MeetingRow[],
    meetingSessions: (sessionResult.data ?? []) as MeetingSessionRow[],
    deadlines: (deadlineResult.data ?? []) as DeadlineRow[],
  });
  const desiredEvents = projections.map((projection) => ({
    key: `${projection.sourceKind}:${projection.sourceId}:${projection.occurrenceKey}`,
    projectId: projection.sourceId,
    scheduleId: projection.occurrenceKey,
    project: projection,
  }));
  const trackedEvents = (existingResult.data ?? []).flatMap((row) => {
    if (
      !CSF_CALENDAR_SOURCE_KINDS.includes(
        row.source_kind as CsfCalendarSourceKind,
      )
    )
      return [];
    return [
      {
        id: row.id,
        key: `${row.source_kind}:${row.source_id}:${row.occurrence_key}`,
        eventId: row.event_id,
      },
    ];
  });

  return synchronizeCalendarEvents(desiredEvents, trackedEvents, {
    createRemoteEvent: (desired) =>
      createRemoteEvent(
        options.accessToken,
        options.calendarId,
        desired.project.event,
      ),
    updateRemoteEvent: (tracked, desired) =>
      updateRemoteEvent(
        options.accessToken,
        options.calendarId,
        tracked.eventId,
        desired.project.event,
      ),
    deleteRemoteEvent: (eventId) =>
      deleteRemoteEvent(options.accessToken, options.calendarId, eventId),
    insertTrackingEvent: async (desired, eventId) => {
      const projection = desired.project;
      const { data, error } = await serviceSupabase
        .from("organization_calendar_events")
        .insert({
          organization_id: options.organizationId,
          project_id: null,
          schedule_id: projection.occurrenceKey,
          source_kind: projection.sourceKind,
          source_id: projection.sourceId,
          occurrence_key: projection.occurrenceKey,
          event_id: eventId,
        })
        .select("id")
        .single();
      return !error && Boolean(data);
    },
    updateTrackingEvent: async (tracked) => {
      const { data, error } = await serviceSupabase
        .from("organization_calendar_events")
        .update({ updated_at: new Date().toISOString() })
        .eq("organization_id", options.organizationId)
        .eq("id", tracked.id)
        .in("source_kind", [...CSF_CALENDAR_SOURCE_KINDS])
        .select("id")
        .maybeSingle();
      return !error && Boolean(data);
    },
    deleteTrackingEvent: async (tracked) => {
      const { data, error } = await serviceSupabase
        .from("organization_calendar_events")
        .delete()
        .eq("organization_id", options.organizationId)
        .eq("id", tracked.id)
        .in("source_kind", [...CSF_CALENDAR_SOURCE_KINDS])
        .select("id")
        .maybeSingle();
      return !error && Boolean(data);
    },
    markSyncComplete: async () => true,
  });
}
