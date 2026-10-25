import {
  activeOrganizationRole,
  canManageProjectAccess,
  type OrganizationMembershipRow,
} from "@/lib/projects/management-access";

/**
 * Authorization for reading a signed waiver.
 *
 * Exactly four callers may read one, and every path fails closed:
 * 1. The project creator.
 * 2. An ACTIVE organization admin of the project's organization.
 * 3. ACTIVE organization staff, only when the project allows staff management.
 * 4. The signer: the signed-in user who owns the record, or a guest holding
 *    the validated access token for the guest record that owns it.
 *
 * Paths 1 to 3 are the canonical project-management policy in
 * `lib/projects/management-access.ts`. This module never restates it.
 */

/** Signed URLs are opened by the browser straight after the action returns. */
export const WAIVER_SIGNED_URL_TTL_SECONDS = 120;

export interface AuthCheckParams {
  /** Current authenticated user ID, or null if not authenticated */
  currentUserId: string | null;
  /** Signature record with user_id and anonymous_id */
  signature: {
    user_id: string | null;
    anonymous_id: string | null;
  };
  /** Project with creator and organization info */
  project: {
    creator_id: string | null;
    organization_id: string | null;
    can_be_managed_by_staff: boolean | null;
  };
  /**
   * The caller's membership row in the project's organization, with its
   * status. A row without an explicitly active status confers nothing.
   */
  orgMember?: OrganizationMembershipRow;
  /** For anonymous access, the anonymousSignupId from query params */
  anonymousSignupIdParam?: string | null;
  /** Whether the anonymous token was validated server-side for the provided anonymousSignupId */
  anonymousAccessValidated?: boolean;
}

export interface AuthCheckResult {
  /** Whether the user/request has permission to access the waiver */
  hasPermission: boolean;
  /** The authorization path that granted permission, or reason for denial */
  reason: "organizer" | "signer" | "anonymous" | "unauthorized";
  /** Additional context for debugging */
  details?: string;
}

/**
 * Check if a user/request is authorized to access a waiver signature.
 *
 * See the module comment for the four permitted readers.
 */
export function checkWaiverAccess(params: AuthCheckParams): AuthCheckResult {
  const {
    currentUserId,
    signature,
    project,
    orgMember,
    anonymousSignupIdParam,
    anonymousAccessValidated,
  } = params;

  // Paths 1 to 3: the canonical project-management policy. A membership only
  // counts for the project's own organization and only while it is active.
  if (currentUserId) {
    const organizationRole = project.organization_id
      ? activeOrganizationRole(orgMember)
      : null;

    if (
      canManageProjectAccess({
        creatorId: project.creator_id,
        userId: currentUserId,
        organizationRole,
        canBeManagedByStaff: project.can_be_managed_by_staff,
      })
    ) {
      return {
        hasPermission: true,
        reason: "organizer",
        details:
          project.creator_id === currentUserId
            ? "User is project creator"
            : "User is an active organization manager",
      };
    }
  }

  // Path 4a: Signer self-access (authenticated user)
  if (currentUserId && signature.user_id === currentUserId) {
    return {
      hasPermission: true,
      reason: "signer",
      details: "User owns this signature",
    };
  }

  // Path 4b: Guest signer access. A session does not disable this path, so a
  // signed-in visitor can still open their own guest link. It never widens
  // access: the id must match this record and the token must have validated.
  if (signature.anonymous_id) {
    // Must provide anonymousSignupId parameter for anonymous signatures
    if (anonymousSignupIdParam) {
      if (anonymousSignupIdParam === signature.anonymous_id) {
        if (!anonymousAccessValidated) {
          return {
            hasPermission: false,
            reason: "unauthorized",
            details:
              "Anonymous signature access requires a valid anonymous access token",
          };
        }

        return {
          hasPermission: true,
          reason: "anonymous",
          details:
            "Valid anonymous access (with matching anonymousSignupId and token)",
        };
      } else {
        return {
          hasPermission: false,
          reason: "unauthorized",
          details: "Invalid anonymousSignupId parameter (mismatch)",
        };
      }
    }

    return {
      hasPermission: false,
      reason: "unauthorized",
      details:
        "Anonymous signature access requires anonymousSignupId parameter",
    };
  }

  // No authorization path matched
  return {
    hasPermission: false,
    reason: "unauthorized",
    details: "No authorization path matched",
  };
}

/** The only media types a stored signed waiver is ever served as. */
const WAIVER_FILE_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
};

/**
 * The served media type for a stored signed waiver. The stored object's own
 * content type wins. The path extension is only a fallback for objects whose
 * type was not recorded, and anything unrecognized is served as a PDF.
 */
export function resolveWaiverContentType(
  storedContentType: string | null | undefined,
  storagePath: string | null | undefined,
): "application/pdf" | "image/png" | "image/jpeg" {
  const stored = (storedContentType ?? "").split(";")[0].trim().toLowerCase();
  if (stored === "application/pdf") return "application/pdf";
  if (stored === "image/png") return "image/png";
  if (stored === "image/jpeg" || stored === "image/jpg") return "image/jpeg";

  const path = (storagePath ?? "").toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "application/pdf";
}

/**
 * Get Content-Disposition header value for waiver responses.
 *
 * @param inline - If true, returns 'inline' (for preview), otherwise 'attachment' (for download)
 * @param signatureId - The signature ID for filename
 * @param contentType - Media type of the body, which decides the extension
 */
export function getContentDisposition(
  inline: boolean,
  signatureId: string,
  contentType: string = "application/pdf",
): string {
  const disposition = inline ? "inline" : "attachment";
  const extension =
    WAIVER_FILE_EXTENSIONS[contentType.split(";")[0].trim().toLowerCase()] ??
    "pdf";
  // The id is a database uuid, but it reaches a header, so keep it inert.
  const safeId = signatureId.replace(/[^A-Za-z0-9_-]/g, "");
  const filename = inline
    ? `waiver-${safeId}.${extension}`
    : `signed-waiver-${safeId}.${extension}`;

  return `${disposition}; filename="${filename}"`;
}
