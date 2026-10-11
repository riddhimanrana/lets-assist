import "server-only";
import { isDeepStrictEqual } from "node:util";
import { authorizeGoogleOAuthOrganizationRequest } from "@/lib/auth/google-oauth-authorization";
import { getGoogleOAuthConnectionForBinding } from "@/lib/auth/google-oauth-connection-store";
import {
  getGoogleAccessTokenForSheetsForUser,
  organizationSheetsGoogleBinding,
} from "@/services/calendar";
import {
  ORGANIZATION_SHEET_SYNC_COLUMNS,
  type OrganizationSheetSyncConfig,
  type OrganizationSheetSyncResult,
} from "./organization-report-sync";
import type { getAdminClient } from "@/lib/supabase/admin";

type Refusal = Extract<OrganizationSheetSyncResult, { success: false }>;
type Connection = NonNullable<
  Awaited<ReturnType<typeof getGoogleOAuthConnectionForBinding>>
>;

// The saved columns, and only those, decide whether the configuration moved.
// Read at call time: this module and the sync module import each other.
const savedColumns = () =>
  ORGANIZATION_SHEET_SYNC_COLUMNS.split(", ") as Array<
    keyof OrganizationSheetSyncConfig
  >;
// A refresh may change token material, but may not change the account or grant.
const GRANT_FIELDS = [
  "id",
  "user_id",
  "granted_scopes",
  "granted_scopes_updated_at",
  "connection_type",
  "calendar_email",
  "binding_identity_email",
  "binding_identity_verified_at",
] as const satisfies ReadonlyArray<keyof Connection>;
// A reconnect, a rebind or a refresh by another run changes at least one.
const CREDENTIAL_FIELDS = [
  ...GRANT_FIELDS,
  "access_token",
  "refresh_token",
  "token_expires_at",
] as const satisfies ReadonlyArray<keyof Connection>;

const UNCONFIRMED: Refusal = {
  success: false,
  code: "authorization_changed",
  error: "Export authorization could not be confirmed. Retry shortly.",
};
const TIMED_OUT: Refusal = {
  success: false,
  code: "sheets_timeout",
  error: "Google Sheets did not respond in time. Try again in a few minutes.",
};

/** Thrown in place of any lookup error, so callers never log a provider detail. */
class SheetSyncAuthorityError extends Error {
  constructor() {
    super("Organization sheet export authority changed");
    this.name = "SheetSyncAuthorityError";
  }
}

/**
 * Says whether the saved configuration is no longer the one the caller read.
 * It reads one row and touches no credential, so it can explain a refused
 * claim. False also covers a row that could not be read.
 */
export async function organizationSheetSyncConfigMoved(
  supabase: ReturnType<typeof getAdminClient>,
  config: OrganizationSheetSyncConfig,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("organization_sheet_syncs")
      .select(ORGANIZATION_SHEET_SYNC_COLUMNS)
      .eq("organization_id", config.organization_id)
      .maybeSingle();
    if (error) return false;
    const current = data as Record<string, unknown> | null;
    return (
      !current ||
      !savedColumns().every((column) =>
        isDeepStrictEqual(current[column], config[column]),
      )
    );
  } catch {
    return false;
  }
}

/**
 * Pin the exact credential and configuration before using an export token.
 * This may refresh the stored token, so call it only while holding the
 * organization's run claim.
 */
export async function prepareOrganizationSheetSyncAuthority(
  supabase: ReturnType<typeof getAdminClient>,
  config: OrganizationSheetSyncConfig,
  signal?: AbortSignal,
) {
  const binding = organizationSheetsGoogleBinding(config.organization_id);
  const connection = () =>
    getGoogleOAuthConnectionForBinding(config.created_by, binding, {
      useServiceRole: true,
    });
  // The first refusal is final: later checks cannot replace or clear it.
  const state: { refusal: Refusal | null } = { refusal: null };
  const refuse = (code: Refusal["code"], error: string): never => {
    state.refusal ??= { success: false, code, error };
    throw new SheetSyncAuthorityError();
  };
  const ownerAllowed = async () => {
    const authorization = await authorizeGoogleOAuthOrganizationRequest({
      userId: config.created_by,
      organizationId: config.organization_id,
      pluginKey: null,
      purpose: "organization_sheets",
      requestedCapability: null,
    });
    if (!authorization.allowed)
      refuse(
        "authorization_changed",
        "The sync owner no longer has organization admin access. No further sheet changes were sent.",
      );
  };
  let pinned: Connection | null = null;
  const verify = async () => {
    await ownerAllowed();
    const { data, error } = await supabase
      .from("organization_sheet_syncs")
      .select(ORGANIZATION_SHEET_SYNC_COLUMNS)
      .eq("organization_id", config.organization_id)
      .maybeSingle();
    const current = data as Record<string, unknown> | null;
    if (
      error ||
      !current ||
      !savedColumns().every((column) =>
        isDeepStrictEqual(current[column], config[column]),
      )
    )
      refuse(
        "configuration_changed",
        "The sheet settings changed during this sync. Retry using the current destination.",
      );
    const active = await connection();
    if (
      !pinned ||
      !active ||
      !CREDENTIAL_FIELDS.every((field) => active[field] === pinned?.[field])
    )
      refuse(
        "authorization_changed",
        "The Google connection changed during this sync. Reconnect or retry before exporting.",
      );
  };
  /** Runs before the write, before every clear, and before completion. */
  const beforeWrite = async () => {
    if (state.refusal) throw new SheetSyncAuthorityError();
    // A deadline is the caller's to report, so it is not recorded as a refusal.
    signal?.throwIfAborted();
    try {
      await verify();
    } catch {
      signal?.throwIfAborted();
      // A lookup that could not finish is a refusal too, not a pass.
      state.refusal ??= UNCONFIRMED;
      throw new SheetSyncAuthorityError();
    }
    signal?.throwIfAborted();
  };
  let accessToken: string | null = null;
  try {
    signal?.throwIfAborted();
    await ownerAllowed();
    const initial = await connection();
    if (!initial)
      return refuse(
        "authorization_changed",
        "The organization Google connection is unavailable. Reconnect before exporting.",
      );
    const token = await getGoogleAccessTokenForSheetsForUser(
      config.created_by,
      true,
      binding,
    );
    // A refresh may replace the stored token and expiry, so the credential is
    // pinned after it. The connection itself must still be the initial one.
    pinned = await connection();
    if (
      !token ||
      !pinned ||
      !GRANT_FIELDS.every((field) => pinned?.[field] === initial[field])
    )
      return refuse(
        "authorization_changed",
        "Sheets access could not be confirmed. Reconnect before exporting.",
      );
    await beforeWrite();
    accessToken = token;
  } catch {
    state.refusal ??= signal?.aborted ? TIMED_OUT : UNCONFIRMED;
  }
  return { accessToken, beforeWrite, failure: () => state.refusal };
}
