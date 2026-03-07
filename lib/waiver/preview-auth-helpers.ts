/**
 * Phase 7: Waiver Preview Authorization Helpers
 * 
 * Extracted authorization logic for waiver preview/download routes.
 * Supports three authorization paths with proper priority:
 * 1. Organizer access (project creator or org admin/staff)
 * 2. Signer self-access (authenticated user tied to signature)
 * 3. Anonymous signer access (with required anonymousSignupId validation)
 */

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
  };
  /** Organization member record if user is in org, or null */
  orgMember?: {
    role: string;
  } | null;
  /** For anonymous access, the anonymousSignupId from query params */
  anonymousSignupIdParam?: string | null;
  /** Whether the anonymous token was validated server-side for the provided anonymousSignupId */
  anonymousAccessValidated?: boolean;
}

export interface AuthCheckResult {
  /** Whether the user/request has permission to access the waiver */
  hasPermission: boolean;
  /** The authorization path that granted permission, or reason for denial */
  reason: 'organizer' | 'signer' | 'anonymous' | 'unauthorized';
  /** Additional context for debugging */
  details?: string;
}

/**
 * Check if a user/request is authorized to access a waiver signature.
 * 
 * Authorization paths (in order of priority):
 * 1. Organizer: project creator or org admin/staff
 * 2. Signer self-access: authenticated user owns the signature
 * 3. Anonymous signer: valid anonymousSignupId matches signature.anonymous_id
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

  // Path 1: Organizer access (project creator)
  if (currentUserId && project.creator_id === currentUserId) {
    return {
      hasPermission: true,
      reason: 'organizer',
      details: 'User is project creator',
    };
  }

  // Path 1: Organizer access (org admin/staff)
  if (currentUserId && project.organization_id && orgMember) {
    if (['admin', 'staff'].includes(orgMember.role)) {
      return {
        hasPermission: true,
        reason: 'organizer',
        details: `User is org ${orgMember.role}`,
      };
    }
  }

  // Path 2: Signer self-access (authenticated user)
  if (currentUserId && signature.user_id === currentUserId) {
    return {
      hasPermission: true,
      reason: 'signer',
      details: 'User owns this signature',
    };
  }

  // Path 3: Anonymous signer access (or logged-in user with anonymous link)
  if (signature.anonymous_id) {
    // Must provide anonymousSignupId parameter for anonymous signatures
    if (anonymousSignupIdParam) {
      if (anonymousSignupIdParam === signature.anonymous_id) {
        if (!anonymousAccessValidated) {
          return {
            hasPermission: false,
            reason: 'unauthorized',
            details: 'Anonymous signature access requires a valid anonymous access token',
          };
        }

        return {
          hasPermission: true,
          reason: 'anonymous',
          details: 'Valid anonymous access (with matching anonymousSignupId and token)',
        };
      } else {
        return {
          hasPermission: false,
          reason: 'unauthorized',
          details: 'Invalid anonymousSignupId parameter (mismatch)',
        };
      }
    }

    return {
      hasPermission: false,
      reason: 'unauthorized',
      details: 'Anonymous signature access requires anonymousSignupId parameter',
    };
    
    // Fallback: if user is logged in, but signed anonymously, we don't have a 
    // direct link unless it was explicitly linked later or they have the token.
  }

  // No authorization path matched
  return {
    hasPermission: false,
    reason: 'unauthorized',
    details: 'No authorization path matched',
  };
}

/**
 * Get Content-Disposition header value for waiver responses.
 * 
 * @param inline - If true, returns 'inline' (for preview), otherwise 'attachment' (for download)
 * @param signatureId - The signature ID for filename
 */
export function getContentDisposition(inline: boolean, signatureId: string): string {
  const disposition = inline ? 'inline' : 'attachment';
  const filename = inline 
    ? `waiver-${signatureId}.pdf`
    : `signed-waiver-${signatureId}.pdf`;
  
  return `${disposition}; filename="${filename}"`;
}
