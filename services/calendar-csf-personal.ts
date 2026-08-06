import { getAdminClient } from "@/lib/supabase/admin";
import { getGoogleOAuthConnectionForBinding } from "@/lib/auth/google-oauth-connection-store";
import { hasGoogleCalendarWriteScope } from "@/lib/auth/google-oauth-scopes";
import { classifyGoogleCalendarLookupError } from "@/services/google-calendar-access-state";
import {
  GOOGLE_CALENDAR_API,
  GOOGLE_CALENDAR_LOOKUP_TIMEOUT_MS,
  PERSONAL_CALENDAR_GOOGLE_BINDING,
  getGoogleCalendarAccessState,
} from "./calendar";
import { getGoogleAccessTokenForUser } from "./calendar-operations";

export type CsfPersonalCalendarProviderContext =
  | { status: "ready"; accessToken: string; calendarId: string }
  | { status: "destination_missing" }
  | {
      status: "connection_required";
      reason:
        | "not_connected"
        | "inactive"
        | "missing_scope"
        | "refresh_failed"
        | "provider_forbidden";
    }
  | {
      status: "unknown_outcome";
      reason:
        | "rate_limited"
        | "server_error"
        | "timeout"
        | "network_error"
        | "unknown_error"
        | "malformed_response"
        | "unexpected_status"
        | "calendar_provision_in_progress"
        | "calendar_provision_unknown"
        | "destination_state_unavailable";
      httpStatus?: number;
    }
  | { status: "rejected"; httpStatus: number };

type CsfPersonalCalendarDestinationRow = {
  state: "provisioning" | "ready" | "unknown_outcome" | "rejected";
  calendar_id: string | null;
  last_outcome_code: string | null;
};

type CsfPersonalCalendarDestinationClaim = {
  operationId: string | null;
  operationState: "started" | "confirmed" | "unknown_outcome" | "rejected";
  destinationState: CsfPersonalCalendarDestinationRow["state"] | "missing";
  calendarId: string | null;
  outcomeCode: string | null;
  shouldCallProvider: boolean;
  idempotent: boolean;
};

type CsfPersonalCalendarProviderContextOptions = {
  requestId: string;
  allowCreate: boolean;
};

function parseCsfPersonalCalendarDestinationClaim(
  value: unknown,
): CsfPersonalCalendarDestinationClaim | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    !(row.operationId === null || typeof row.operationId === "string") ||
    !["started", "confirmed", "unknown_outcome", "rejected"].includes(
      String(row.operationState),
    ) ||
    ![
      "provisioning",
      "ready",
      "unknown_outcome",
      "rejected",
      "missing",
    ].includes(String(row.destinationState)) ||
    !(row.calendarId === null || typeof row.calendarId === "string") ||
    !(row.outcomeCode === null || typeof row.outcomeCode === "string") ||
    typeof row.shouldCallProvider !== "boolean" ||
    typeof row.idempotent !== "boolean"
  ) {
    return null;
  }
  return row as unknown as CsfPersonalCalendarDestinationClaim;
}

async function beginCsfPersonalCalendarDestinationClaim(input: {
  userId: string;
  connectionId: string;
  requestId: string;
  replaceCalendarId: string | null;
  allowCreate: boolean;
}): Promise<CsfPersonalCalendarDestinationClaim | null> {
  const admin = getAdminClient().schema("plugin_data");
  const { data, error } = await admin.rpc(
    "csf_begin_personal_calendar_destination_provision",
    {
      p_user_id: input.userId,
      p_connection_id: input.connectionId,
      p_request_id: input.requestId,
      p_replace_calendar_id: input.replaceCalendarId,
      p_allow_create: input.allowCreate,
    },
  );
  if (error) return null;
  return parseCsfPersonalCalendarDestinationClaim(data);
}

async function completeCsfPersonalCalendarDestinationClaim(input: {
  operationId: string;
  userId: string;
  outcome: "confirmed" | "unknown_outcome" | "rejected";
  calendarId: string | null;
  outcomeCode: string | null;
}): Promise<boolean> {
  const admin = getAdminClient().schema("plugin_data");
  const { error } = await admin.rpc(
    "csf_complete_personal_calendar_destination_provision",
    {
      p_operation_id: input.operationId,
      p_user_id: input.userId,
      p_outcome: input.outcome,
      p_calendar_id: input.calendarId,
      p_outcome_code: input.outcomeCode,
    },
  );
  return !error;
}

/**
 * Resolve the app-created personal calendar without exposing the credential or
 * a provider identifier to the browser. Only a confirmed 404 replaces a
 * previously tracked calendar; every ambiguous lookup stops for review.
 */
export async function getCsfPersonalCalendarProviderContext(
  userId: string,
  options: CsfPersonalCalendarProviderContextOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<CsfPersonalCalendarProviderContext> {
  const connection = await getGoogleOAuthConnectionForBinding(
    userId,
    PERSONAL_CALENDAR_GOOGLE_BINDING,
    { activeOnly: false, useServiceRole: true },
  );
  if (!connection) {
    return { status: "connection_required", reason: "not_connected" };
  }
  if (!connection.is_active) {
    return { status: "connection_required", reason: "inactive" };
  }
  if (
    !["calendar", "both"].includes(connection.connection_type ?? "") ||
    !hasGoogleCalendarWriteScope(connection.granted_scopes)
  ) {
    return { status: "connection_required", reason: "missing_scope" };
  }

  const accessToken = await getGoogleAccessTokenForUser(userId, true, {
    connectionType: "calendar",
    expectedBinding: PERSONAL_CALENDAR_GOOGLE_BINDING,
  });
  if (!accessToken) {
    return { status: "connection_required", reason: "refresh_failed" };
  }

  const admin = getAdminClient().schema("plugin_data");
  const { data: destinationData, error: destinationError } = await admin
    .from("csf_personal_calendar_destinations")
    .select("state, calendar_id, last_outcome_code")
    .eq("user_id", userId)
    .maybeSingle();
  if (destinationError) {
    return {
      status: "unknown_outcome",
      reason: "destination_state_unavailable",
    };
  }

  const destination =
    destinationData as CsfPersonalCalendarDestinationRow | null;
  if (destination?.state === "unknown_outcome") {
    return { status: "unknown_outcome", reason: "calendar_provision_unknown" };
  }

  const storedCalendarId =
    destination?.state === "ready" &&
    typeof destination.calendar_id === "string" &&
    destination.calendar_id.trim().length > 0
      ? destination.calendar_id
      : null;
  let replaceCalendarId: string | null = null;

  if (storedCalendarId) {
    const accessState = await getGoogleCalendarAccessState(
      accessToken,
      storedCalendarId,
      fetchImpl,
    );
    if (accessState.status === "accessible") {
      return { status: "ready", accessToken, calendarId: storedCalendarId };
    }
    if (accessState.status === "forbidden") {
      return { status: "connection_required", reason: "provider_forbidden" };
    }
    if (accessState.status !== "missing") {
      return {
        status: "unknown_outcome",
        reason: accessState.reason,
        ...(accessState.httpStatus
          ? { httpStatus: accessState.httpStatus }
          : {}),
      };
    }
    replaceCalendarId = storedCalendarId;
  }

  const claim = await beginCsfPersonalCalendarDestinationClaim({
    userId,
    connectionId: connection.id,
    requestId: options.requestId,
    replaceCalendarId,
    allowCreate: options.allowCreate,
  });
  if (!claim) {
    return {
      status: "unknown_outcome",
      reason: "destination_state_unavailable",
    };
  }
  if (claim.destinationState === "ready" && claim.calendarId) {
    return { status: "ready", accessToken, calendarId: claim.calendarId };
  }
  if (!options.allowCreate && claim.destinationState === "missing") {
    return { status: "destination_missing" };
  }
  if (!claim.shouldCallProvider || !claim.operationId) {
    if (claim.destinationState === "rejected") {
      return { status: "rejected", httpStatus: 400 };
    }
    return {
      status: "unknown_outcome",
      reason:
        claim.destinationState === "provisioning"
          ? "calendar_provision_in_progress"
          : "calendar_provision_unknown",
    };
  }

  try {
    const response = await fetchImpl(`${GOOGLE_CALENDAR_API}/calendars`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: "Let's Assist Volunteering",
        description: "Volunteer events and CSF dates you add from Let's Assist",
        timeZone: "America/Los_Angeles",
      }),
      signal: AbortSignal.timeout(GOOGLE_CALENDAR_LOOKUP_TIMEOUT_MS),
    });

    if (response.status === 401 || response.status === 403) {
      const recorded = await completeCsfPersonalCalendarDestinationClaim({
        operationId: claim.operationId,
        userId,
        outcome: "rejected",
        calendarId: null,
        outcomeCode: `provider_forbidden_${response.status}`,
      });
      if (!recorded) {
        return {
          status: "unknown_outcome",
          reason: "destination_state_unavailable",
        };
      }
      return { status: "connection_required", reason: "provider_forbidden" };
    }
    if (response.status === 408 || response.status === 429) {
      const reason = response.status === 429 ? "rate_limited" : "timeout";
      const recorded = await completeCsfPersonalCalendarDestinationClaim({
        operationId: claim.operationId,
        userId,
        outcome: "unknown_outcome",
        calendarId: null,
        outcomeCode: reason,
      });
      if (!recorded) {
        return {
          status: "unknown_outcome",
          reason: "destination_state_unavailable",
        };
      }
      return {
        status: "unknown_outcome",
        reason,
        httpStatus: response.status,
      };
    }
    if (response.status >= 500) {
      const recorded = await completeCsfPersonalCalendarDestinationClaim({
        operationId: claim.operationId,
        userId,
        outcome: "unknown_outcome",
        calendarId: null,
        outcomeCode: "server_error",
      });
      if (!recorded) {
        return {
          status: "unknown_outcome",
          reason: "destination_state_unavailable",
        };
      }
      return {
        status: "unknown_outcome",
        reason: "server_error",
        httpStatus: response.status,
      };
    }
    if (!response.ok) {
      const recorded = await completeCsfPersonalCalendarDestinationClaim({
        operationId: claim.operationId,
        userId,
        outcome: "rejected",
        calendarId: null,
        outcomeCode: `provider_rejected_${response.status}`,
      });
      if (!recorded) {
        return {
          status: "unknown_outcome",
          reason: "destination_state_unavailable",
        };
      }
      return { status: "rejected", httpStatus: response.status };
    }

    const payload: unknown = await response.json().catch(() => null);
    const calendarId =
      payload &&
      typeof payload === "object" &&
      "id" in payload &&
      typeof payload.id === "string" &&
      payload.id.trim().length > 0
        ? payload.id
        : null;
    if (!calendarId) {
      const recorded = await completeCsfPersonalCalendarDestinationClaim({
        operationId: claim.operationId,
        userId,
        outcome: "unknown_outcome",
        calendarId: null,
        outcomeCode: "malformed_response",
      });
      if (!recorded) {
        return {
          status: "unknown_outcome",
          reason: "destination_state_unavailable",
        };
      }
      return { status: "unknown_outcome", reason: "malformed_response" };
    }

    const recorded = await completeCsfPersonalCalendarDestinationClaim({
      operationId: claim.operationId,
      userId,
      outcome: "confirmed",
      calendarId,
      outcomeCode: null,
    });
    if (!recorded) {
      return {
        status: "unknown_outcome",
        reason: "destination_state_unavailable",
      };
    }

    return { status: "ready", accessToken, calendarId };
  } catch (error) {
    const state = classifyGoogleCalendarLookupError(error);
    const reason =
      state.status === "retryable_error" ? state.reason : "network_error";
    const recorded = await completeCsfPersonalCalendarDestinationClaim({
      operationId: claim.operationId,
      userId,
      outcome: "unknown_outcome",
      calendarId: null,
      outcomeCode: reason,
    });
    if (!recorded) {
      return {
        status: "unknown_outcome",
        reason: "destination_state_unavailable",
      };
    }
    return {
      status: "unknown_outcome",
      reason,
      ...(state.status === "retryable_error" && state.httpStatus
        ? { httpStatus: state.httpStatus }
        : {}),
    };
  }
}
