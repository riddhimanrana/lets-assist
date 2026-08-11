import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CalendarConnection } from "@/types/calendar";

import type { GoogleOAuthConnectionBindingExpectation } from "./google-oauth-connection-binding";
import type { GoogleOAuthCsfImportCapability } from "./google-oauth-state";

type BoundGoogleConnectionOptions = {
  activeOnly?: boolean;
  useServiceRole?: boolean;
};

type SaveBoundGoogleConnectionInput = {
  userId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
  calendarEmail: string;
  grantedScopes: string | null;
  connectionType: "calendar" | "sheets" | "both";
  binding: GoogleOAuthConnectionBindingExpectation;
  requestedCapability: GoogleOAuthCsfImportCapability | null;
  identityEmail: string | null;
  identityVerifiedAt: string | null;
};

export type BoundGoogleOAuthConnection = CalendarConnection & {
  binding_identity_email: string | null;
  binding_identity_verified_at: string | null;
};

type GoogleOAuthBindingEvidence = {
  connectionId: string;
  identityEmail: string | null;
  identityVerifiedAt: string | null;
};

async function findGoogleOAuthBindingEvidence(
  userId: string,
  expected: GoogleOAuthConnectionBindingExpectation,
): Promise<GoogleOAuthBindingEvidence | null> {
  const admin = getAdminClient();
  let query = admin
    .from("user_google_oauth_connection_bindings")
    .select("connection_id, identity_email, identity_verified_at")
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("purpose", expected.purpose);

  query = expected.organizationId
    ? query.eq("organization_id", expected.organizationId)
    : query.is("organization_id", null);
  query = expected.pluginKey
    ? query.eq("plugin_key", expected.pluginKey)
    : query.is("plugin_key", null);

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("Failed to resolve Google OAuth connection binding:", error);
    return null;
  }

  if (!data?.connection_id) return null;
  return {
    connectionId: data.connection_id,
    identityEmail: data.identity_email ?? null,
    identityVerifiedAt: data.identity_verified_at ?? null,
  };
}

/**
 * Resolve a Google credential through the server-managed binding relation.
 * Legacy preference-only rows intentionally fail closed.
 */
export async function getGoogleOAuthConnectionForBinding(
  userId: string,
  expected: GoogleOAuthConnectionBindingExpectation,
  options: BoundGoogleConnectionOptions = {},
): Promise<BoundGoogleOAuthConnection | null> {
  const binding = await findGoogleOAuthBindingEvidence(userId, expected);
  if (!binding) return null;

  const client = options.useServiceRole
    ? getAdminClient()
    : await createClient();
  let query = client
    .from("user_calendar_connections")
    .select("*")
    .eq("id", binding.connectionId)
    .eq("user_id", userId)
    .eq("provider", "google");

  if (options.activeOnly !== false) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return {
    ...(data as CalendarConnection),
    binding_identity_email: binding.identityEmail,
    binding_identity_verified_at: binding.identityVerifiedAt,
  };
}

/**
 * Legacy Google rows have no trustworthy tenant or purpose. Surface an
 * explicit reconnect state without ever selecting one as a usable credential.
 */
export async function hasUnboundActiveGoogleOAuthConnection(
  userId: string,
): Promise<boolean> {
  const admin = getAdminClient();
  const { data: activeConnections, error: connectionError } = await admin
    .from("user_calendar_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("is_active", true);

  if (connectionError || !activeConnections?.length) return false;

  const connectionIds = activeConnections.map((connection) => connection.id);
  const { data: bindings, error: bindingError } = await admin
    .from("user_google_oauth_connection_bindings")
    .select("connection_id")
    .in("connection_id", connectionIds);

  if (bindingError) return true;
  const boundIds = new Set(
    (bindings ?? []).map((binding) => binding.connection_id),
  );
  return connectionIds.some((connectionId) => !boundIds.has(connectionId));
}

/**
 * Remote Google revocation can invalidate an incremental grant shared by many
 * local purposes. Treat any other active Google row as potentially shared.
 */
export async function hasOtherActiveGoogleOAuthConnection(
  userId: string,
  excludedConnectionId: string,
): Promise<boolean> {
  const admin = getAdminClient();
  const { count, error } = await admin
    .from("user_calendar_connections")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("is_active", true)
    .neq("id", excludedConnectionId);

  // A lookup failure must suppress remote revocation. Local deletion is still
  // safe and prevents the app from retaining the target credential.
  return error ? true : (count ?? 0) > 0;
}

/** Atomically create or reconnect the one credential for an exact binding. */
export async function saveGoogleOAuthConnectionForBinding(
  input: SaveBoundGoogleConnectionInput,
): Promise<{ connectionId: string | null; error: string | null }> {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc(
    "save_google_oauth_connection_for_binding",
    {
      p_user_id: input.userId,
      p_provider: "google",
      p_access_token: input.accessToken,
      p_refresh_token: input.refreshToken,
      p_token_expires_at: input.tokenExpiresAt,
      p_calendar_email: input.calendarEmail,
      p_granted_scopes: input.grantedScopes,
      p_connection_type: input.connectionType,
      p_purpose: input.binding.purpose,
      p_organization_id: input.binding.organizationId,
      p_plugin_key: input.binding.pluginKey,
      p_requested_capability: input.requestedCapability,
      p_identity_email: input.identityEmail,
      p_identity_verified_at: input.identityVerifiedAt,
    },
  );

  if (error || typeof data !== "string") {
    console.error("Failed to save bound Google OAuth connection:", error);
    return { connectionId: null, error: error?.message ?? "Save failed" };
  }

  return { connectionId: data, error: null };
}
