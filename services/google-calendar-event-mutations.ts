import "server-only";

import { createHash } from "node:crypto";

import {
  classifyGoogleCalendarLookupError,
  classifyGoogleCalendarLookupResponse,
  type GoogleCalendarAccessState,
} from "./google-calendar-access-state";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_CALENDAR_TIMEOUT_MS = 10_000;

type GoogleCalendarEventDateTime =
  | { dateTime: string; timeZone: string }
  | { date: string };

export type GoogleCalendarOwnedEvent = {
  summary: string;
  description?: string;
  location?: string;
  start: GoogleCalendarEventDateTime;
  end: GoogleCalendarEventDateTime;
  transparency?: "opaque" | "transparent";
  visibility?: "default" | "private" | "public";
  extendedProperties?: {
    private?: Record<string, string>;
  };
};

export type GoogleCalendarMutationResult =
  | { status: "confirmed"; eventId: string }
  | { status: "confirmed_deleted" }
  | { status: "confirmed_missing" }
  | { status: "connection_required"; httpStatus: 401 | 403 }
  | {
      status: "unknown_outcome";
      reason: "rate_limited" | "server_error" | "timeout" | "network_error" | "unknown_error" | "malformed_response" | "unexpected_status" | "conflict_unresolved";
      httpStatus?: number;
    }
  | { status: "rejected"; httpStatus: number };

type FetchLike = typeof fetch;

function eventUrl(calendarId: string, eventId?: string) {
  const base = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
}

function requestHeaders(accessToken: string, includeJson = false) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(includeJson ? { "Content-Type": "application/json" } : {}),
  };
}

function mutationFailure(
  response: Pick<Response, "status">,
): Exclude<GoogleCalendarMutationResult, { status: "confirmed" } | { status: "confirmed_deleted" } | { status: "confirmed_missing" }> {
  if (response.status === 401 || response.status === 403) {
    return { status: "connection_required", httpStatus: response.status };
  }
  if (response.status === 408 || response.status === 429) {
    return {
      status: "unknown_outcome",
      reason: response.status === 429 ? "rate_limited" : "timeout",
      httpStatus: response.status,
    };
  }
  if (response.status >= 500) {
    return {
      status: "unknown_outcome",
      reason: "server_error",
      httpStatus: response.status,
    };
  }
  return { status: "rejected", httpStatus: response.status };
}

function mutationError(error: unknown): Extract<GoogleCalendarMutationResult, { status: "unknown_outcome" }> {
  const classified = classifyGoogleCalendarLookupError(error);
  return {
    status: "unknown_outcome",
    reason: classified.status === "retryable_error" && classified.reason === "timeout"
      ? "timeout"
      : "network_error",
  };
}

/** Google event IDs accept base32hex; lowercase SHA-256 hex is a valid subset. */
export function deterministicCsfGoogleEventId(input: {
  userId: string;
  organizationId: string;
  sourceKind: string;
  sourceId: string;
  occurrenceKey: string;
}) {
  const digest = createHash("sha256")
    .update([
      "lets-assist-csf-personal-calendar-v1",
      input.userId,
      input.organizationId,
      input.sourceKind,
      input.sourceId,
      input.occurrenceKey,
    ].join("\u0000"))
    .digest("hex");
  return `csf${digest.slice(0, 48)}`;
}

export async function lookupGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleCalendarAccessState> {
  try {
    const response = await fetchImpl(eventUrl(calendarId, eventId), {
      headers: requestHeaders(accessToken),
      signal: AbortSignal.timeout(GOOGLE_CALENDAR_TIMEOUT_MS),
    });
    return classifyGoogleCalendarLookupResponse(response);
  } catch (error) {
    return classifyGoogleCalendarLookupError(error);
  }
}

export async function createGoogleCalendarOwnedEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: GoogleCalendarOwnedEvent,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleCalendarMutationResult> {
  try {
    const response = await fetchImpl(eventUrl(calendarId), {
      method: "POST",
      headers: requestHeaders(accessToken, true),
      body: JSON.stringify({ ...event, id: eventId }),
      signal: AbortSignal.timeout(GOOGLE_CALENDAR_TIMEOUT_MS),
    });
    if (response.ok) return { status: "confirmed", eventId };
    if (response.status !== 409) return mutationFailure(response);

    const lookup = await lookupGoogleCalendarEvent(
      accessToken,
      calendarId,
      eventId,
      fetchImpl,
    );
    if (lookup.status === "accessible") return { status: "confirmed", eventId };
    if (lookup.status === "forbidden") {
      return { status: "connection_required", httpStatus: lookup.httpStatus };
    }
    return {
      status: "unknown_outcome",
      reason: "conflict_unresolved",
      ...(lookup.status === "retryable_error" && lookup.httpStatus
        ? { httpStatus: lookup.httpStatus }
        : {}),
    };
  } catch (error) {
    return mutationError(error);
  }
}

export async function updateGoogleCalendarOwnedEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: GoogleCalendarOwnedEvent,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleCalendarMutationResult> {
  try {
    const response = await fetchImpl(eventUrl(calendarId, eventId), {
      method: "PUT",
      headers: requestHeaders(accessToken, true),
      body: JSON.stringify({ ...event, id: eventId }),
      signal: AbortSignal.timeout(GOOGLE_CALENDAR_TIMEOUT_MS),
    });
    if (response.ok) return { status: "confirmed", eventId };
    if (response.status === 404) return { status: "confirmed_missing" };
    return mutationFailure(response);
  } catch (error) {
    return mutationError(error);
  }
}

export async function deleteGoogleCalendarOwnedEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleCalendarMutationResult> {
  try {
    const response = await fetchImpl(eventUrl(calendarId, eventId), {
      method: "DELETE",
      headers: requestHeaders(accessToken),
      signal: AbortSignal.timeout(GOOGLE_CALENDAR_TIMEOUT_MS),
    });
    if (response.ok || response.status === 404) {
      return { status: "confirmed_deleted" };
    }
    return mutationFailure(response);
  } catch (error) {
    return mutationError(error);
  }
}
