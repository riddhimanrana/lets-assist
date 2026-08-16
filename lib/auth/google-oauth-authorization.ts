import "server-only";

import {
  isGoogleOAuthConnectionPurpose,
  isGoogleOAuthCsfImportCapability,
  type GoogleOAuthConnectionPurpose,
  type GoogleOAuthCsfImportCapability,
  type GoogleOAuthConnectionIntent,
} from "@/lib/auth/google-oauth-state";
import { hasOrganizationPluginRuntimeAccess } from "@/lib/plugins/runtime-access";
import { getCsfPermissionsForUser } from "@/lib/plugins/private/plugins/dvhs-csf/services/roles";
import { getAdminClient } from "@/lib/supabase/admin";

type GoogleOAuthOrganizationAuthorizationInput = GoogleOAuthConnectionIntent & {
  userId: string;
  userEmail?: string | null;
};

export type GoogleOAuthOrganizationAuthorization =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "organization_membership_required"
        | "org_admin_required"
        | "plugin_unavailable"
        | "capability_required";
    };

type GoogleOAuthAuthorizationFacts = {
  membershipRole: string | null;
  membershipStatus: string | null;
  pluginAvailable: boolean;
  isCsfOwner: boolean;
  permissions: ReadonlySet<string>;
};

export function evaluateGoogleOAuthOrganizationAuthorization(
  intent: Pick<
    GoogleOAuthOrganizationAuthorizationInput,
    "organizationId" | "pluginKey" | "purpose" | "requestedCapability"
  >,
  facts: GoogleOAuthAuthorizationFacts,
): GoogleOAuthOrganizationAuthorization {
  if (!intent.organizationId) {
    return { allowed: true };
  }

  if (!facts.membershipRole || facts.membershipStatus !== "active") {
    return { allowed: false, reason: "organization_membership_required" };
  }

  if (intent.purpose !== "csf_import") {
    return facts.membershipRole === "admin"
      ? { allowed: true }
      : { allowed: false, reason: "org_admin_required" };
  }

  if (intent.pluginKey !== "dvhs-csf" || !facts.pluginAvailable) {
    return { allowed: false, reason: "plugin_unavailable" };
  }

  if (facts.membershipRole === "admin") {
    return { allowed: true };
  }

  if (
    facts.membershipRole === "staff" &&
    intent.requestedCapability &&
    (facts.isCsfOwner || facts.permissions.has(intent.requestedCapability))
  ) {
    return { allowed: true };
  }

  return { allowed: false, reason: "capability_required" };
}

export async function authorizeGoogleOAuthOrganizationRequest(
  input: GoogleOAuthOrganizationAuthorizationInput,
): Promise<GoogleOAuthOrganizationAuthorization> {
  if (!input.organizationId) {
    return { allowed: true };
  }

  const admin = getAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("role,status")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (membershipError) {
    throw new Error(
      `Failed to verify Google connection membership: ${membershipError.message}`,
    );
  }

  if (input.purpose !== "csf_import" || membership?.status !== "active") {
    return evaluateGoogleOAuthOrganizationAuthorization(input, {
      membershipRole: membership?.role ?? null,
      membershipStatus: membership?.status ?? null,
      pluginAvailable: false,
      isCsfOwner: false,
      permissions: new Set(),
    });
  }

  const pluginAvailable = await hasOrganizationPluginRuntimeAccess({
    organizationId: input.organizationId,
    pluginKey: "dvhs-csf",
  });
  let permissionEmail = input.userEmail;
  if (!permissionEmail) {
    const { data: profile } = await admin
      .from("profiles")
      .select("email")
      .eq("id", input.userId)
      .maybeSingle();
    permissionEmail = profile?.email ?? null;
  }
  const permissionContext = await getCsfPermissionsForUser({
    organizationId: input.organizationId,
    userId: input.userId,
    userEmail: permissionEmail,
  });

  return evaluateGoogleOAuthOrganizationAuthorization(input, {
    membershipRole: membership?.role ?? null,
    membershipStatus: membership?.status ?? null,
    pluginAvailable,
    isCsfOwner: permissionContext?.isOwner ?? false,
    permissions: permissionContext?.permissions ?? new Set(),
  });
}

export function googleOAuthAuthorizationError(
  authorization: Exclude<
    GoogleOAuthOrganizationAuthorization,
    { allowed: true }
  >,
  purpose: GoogleOAuthConnectionPurpose,
): string {
  return purpose !== "csf_import" ||
    authorization.reason === "org_admin_required"
    ? "org_admin_required"
    : "google_capability_required";
}

type GoogleOAuthRequestIntent = {
  organizationId: string | null;
  pluginKey: "dvhs-csf" | null;
  purpose: GoogleOAuthConnectionPurpose;
  requestedCapability: GoogleOAuthCsfImportCapability | null;
  isCalendarSync: boolean;
  isSheetsSync: boolean;
};

export function getGoogleOAuthRequiredScopeFamily(
  purpose: GoogleOAuthConnectionPurpose,
): "calendar" | "sheets" {
  return purpose === "personal_sheets" ||
    purpose === "organization_sheets" ||
    purpose === "csf_import"
    ? "sheets"
    : "calendar";
}

type ResolveGoogleOAuthRequestIntentInput = {
  organizationId: string | null;
  pluginKey: string | null;
  purpose: string | null;
  requestedCapability: string | null;
  scopeType: string;
  isCalendarSync: boolean;
  isSheetsSync: boolean;
};

export function resolveGoogleOAuthRequestIntent(
  input: ResolveGoogleOAuthRequestIntentInput,
): { ok: true; intent: GoogleOAuthRequestIntent } | { ok: false } {
  const organizationId = input.organizationId?.trim() || null;
  const explicitPurpose = input.purpose;
  if (explicitPurpose && !isGoogleOAuthConnectionPurpose(explicitPurpose)) {
    return { ok: false };
  }

  const purpose: GoogleOAuthConnectionPurpose = explicitPurpose
    ? (explicitPurpose as GoogleOAuthConnectionPurpose)
    : organizationId && input.isCalendarSync
      ? "organization_calendar"
      : organizationId && input.isSheetsSync
        ? "organization_sheets"
        : input.scopeType === "sheets"
          ? "personal_sheets"
          : "personal_calendar";

  if (purpose === "csf_import") {
    if (
      !organizationId ||
      input.pluginKey !== "dvhs-csf" ||
      !isGoogleOAuthCsfImportCapability(input.requestedCapability) ||
      !["sheets", "both"].includes(input.scopeType)
    ) {
      return { ok: false };
    }

    return {
      ok: true,
      intent: {
        organizationId,
        pluginKey: "dvhs-csf",
        purpose,
        requestedCapability: input.requestedCapability,
        isCalendarSync: false,
        isSheetsSync: false,
      },
    };
  }

  if (input.pluginKey || input.requestedCapability) {
    return { ok: false };
  }

  const isOrganizationPurpose =
    purpose === "organization_calendar" || purpose === "organization_sheets";
  if (isOrganizationPurpose !== Boolean(organizationId)) {
    return { ok: false };
  }

  return {
    ok: true,
    intent: {
      organizationId,
      pluginKey: null,
      purpose,
      requestedCapability: null,
      isCalendarSync: purpose === "organization_calendar",
      isSheetsSync: purpose === "organization_sheets",
    },
  };
}
