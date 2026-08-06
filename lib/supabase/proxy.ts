import { createServerClient } from "@supabase/ssr";
import { SUPABASE_DB_OPTIONS } from "./retry-policy";
import { type NextRequest, NextResponse } from "next/server";
import {
  getAccountAccessErrorCode,
  isAccountBlockedStatus,
  readAccountAccessFromMetadata,
} from "@/lib/auth/account-access";
import {
  buildMfaRedirectPath,
  deriveMfaContinuationPath,
  type MfaListFactorsLike,
} from "@/lib/auth/mfa";
import { resolveMfaSessionState } from "@/lib/auth/mfa-session-state";
import { isMfaProtectedPath } from "@/lib/auth/mfa-paths";
import { isStaleSupabaseAuthUserError } from "@/lib/supabase/auth-errors";
import {
  canManageProjectAccess,
  type ProjectManagementAccessInput,
} from "@/lib/projects/management-access";

type PendingAuthCookie = {
  name: string;
  value: string;
  options?: Parameters<NextResponse["cookies"]["set"]>[2];
};

type ProxyUser = {
  id: string;
  app_metadata?: Record<string, unknown> | null;
};

type FreshUserErrorLike = {
  message?: string | null;
  code?: string | null;
  status?: number | null;
};

export type FreshUserValidationDisposition =
  "valid" | "banned" | "clear_session" | "retry";

export function classifyFreshUserValidation(input: {
  error?: FreshUserErrorLike | null;
  freshUserId?: string | null;
  expectedUserId: string;
}): FreshUserValidationDisposition {
  if (input.error?.code === "user_banned") return "banned";
  if (isStaleSupabaseAuthUserError(input.error)) return "clear_session";
  if (input.error) return "retry";
  if (!input.freshUserId || input.freshUserId !== input.expectedUserId) {
    return "clear_session";
  }
  return "valid";
}

// Paths that require authentication
const PROTECTED_PATHS = [
  "/home",
  "/dashboard",
  "/certificates",
  "/organization/create",
  "/projects/create",
  "/projects/drafts",
  "/account",
];

// Paths that logged-in users shouldn't access
const RESTRICTED_PATHS_FOR_LOGGED_IN_USERS = [
  "/",
  "/login",
  "/signup",
  "/reset-password",
  "/faq",
];

// Function to check if a path requires authentication
export function isProtectedPath(path: string) {
  return PROTECTED_PATHS.some(
    (protectedPath) =>
      path === protectedPath || path.startsWith(`${protectedPath}/`),
  );
}

export function shouldRedirectAuthenticatedRestrictedRequest(input: {
  method: string;
  hasNextActionHeader: boolean;
}): boolean {
  return !(input.method === "POST" && input.hasNextActionHeader);
}

export function applyPrivateNoStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

type ProxyCachePrivacyInput = {
  hasIncomingAuthContext: boolean;
  authCookiesMutated: boolean;
  authenticated: boolean;
  authSensitiveRequest: boolean;
  isRedirect: boolean;
  responseStatus: number;
};

const SENSITIVE_AUTH_QUERY_PARAMETERS = [
  "access_token",
  "code",
  "email",
  "invite_token",
  "member_token",
  "refresh_token",
  "staff_token",
  "token",
  "token_hash",
] as const;

export function isSupabaseAuthCookieName(name: string): boolean {
  return name.startsWith("sb-");
}

export function hasSensitiveAuthQuery(
  searchParams: Pick<URLSearchParams, "has">,
): boolean {
  return SENSITIVE_AUTH_QUERY_PARAMETERS.some((parameter) =>
    searchParams.has(parameter),
  );
}

export function isAuthSensitiveProxyPath(path: string): boolean {
  if (
    isProtectedPath(path) ||
    path === "/auth" ||
    path.startsWith("/auth/") ||
    path === "/reset-password" ||
    path.startsWith("/reset-password/") ||
    path === "/trusted-member" ||
    path.startsWith("/trusted-member/") ||
    path === "/guardian-action" ||
    path.startsWith("/guardian-action/") ||
    path === "/admin" ||
    path.startsWith("/admin/") ||
    isProjectManagementPath(path).isCreatorPath
  ) {
    return true;
  }

  return /^\/organization\/[^/]+\/(?:admin|moderation|settings)(?:\/|$)/u.test(
    path,
  );
}

export function shouldApplyPrivateNoStore(
  input: ProxyCachePrivacyInput,
): boolean {
  return (
    input.hasIncomingAuthContext ||
    input.authCookiesMutated ||
    input.authenticated ||
    input.authSensitiveRequest ||
    input.isRedirect ||
    input.responseStatus >= 400
  );
}

function clearSupabaseAuthCookies(
  request: NextRequest,
  response: NextResponse,
) {
  const cookieNames = new Set([
    ...request.cookies.getAll().map((cookie) => cookie.name),
    "sb-access-token",
    "sb-refresh-token",
  ]);

  for (const name of cookieNames) {
    if (name.startsWith("sb-")) {
      response.cookies.delete(name);
    }
  }
}

// Function to check if path is for project managers only
function isProjectManagementPath(path: string) {
  const matches = path.match(
    /^\/projects\/([^/]+)\/(edit|signups|documents|attendance|hours)$/,
  );
  return matches
    ? { isCreatorPath: true, projectId: matches[1] }
    : { isCreatorPath: false, projectId: null };
}

export function canManageProjectRoute(input: ProjectManagementAccessInput) {
  return canManageProjectAccess(input);
}

export async function updateSession(request: NextRequest) {
  // Capture the original auth context before Supabase's setAll callback mutates
  // the request cookie store during a token refresh.
  const hasIncomingAuthContext =
    request.headers.has("authorization") ||
    request.cookies.getAll().some(({ name }) => isSupabaseAuthCookieName(name));
  const authSensitiveRequest =
    isAuthSensitiveProxyPath(request.nextUrl.pathname) ||
    hasSensitiveAuthQuery(request.nextUrl.searchParams);
  const pendingAuthCookies: PendingAuthCookie[] = [];
  const pendingAuthHeaders = new Map<string, string>();
  let clearAuthCookiesOnFinalize = false;
  let supabaseResponse = NextResponse.next({
    request,
  });

  const applyPendingAuthCookies = <T extends NextResponse>(response: T): T => {
    pendingAuthCookies.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
    return response;
  };

  const finalizeResponse = <T extends NextResponse>(response: T): T => {
    applyPendingAuthCookies(response);
    pendingAuthHeaders.forEach((value, key) =>
      response.headers.set(key, value),
    );
    if (clearAuthCookiesOnFinalize) {
      clearSupabaseAuthCookies(request, response);
    }

    const isRedirect =
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has("location");
    const shouldDisableSharedCaching = shouldApplyPrivateNoStore({
      hasIncomingAuthContext,
      authCookiesMutated:
        pendingAuthCookies.length > 0 || clearAuthCookiesOnFinalize,
      authenticated: user !== null,
      authSensitiveRequest,
      isRedirect,
      responseStatus: response.status,
    });

    return shouldDisableSharedCaching
      ? applyPrivateNoStore(response)
      : response;
  };

  const authRetryResponse = () =>
    finalizeResponse(
      new NextResponse(
        "Authentication is temporarily unavailable. Please retry.",
        {
          status: 503,
          headers: {
            "Retry-After": "5",
          },
        },
      ),
    );

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      db: SUPABASE_DB_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          pendingAuthCookies.push(...cookiesToSet);
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) => {
            pendingAuthHeaders.set(key, value);
            supabaseResponse.headers.set(key, value);
          });
        },
      },
    },
  );

  // Supabase SSR requires this validation to run immediately after client
  // creation. getClaims verifies the JWT and lets setAll persist any refresh.
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError && process.env.NODE_ENV === "development") {
    console.log(
      "[Proxy] getClaims error (request will be treated as unauthenticated):",
      claimsError.message,
    );
  }

  const claims = claimsData?.claims;
  let user: ProxyUser | null = null;

  // Claims establish cryptographic session validity, but authorization state
  // such as bans, restrictions, user deletion, and revocation can change
  // after an access token was issued. Resolve the user authoritatively before
  // using app_metadata or treating the request as authenticated.
  if (claims?.sub) {
    const { data: freshUserData, error: freshUserError } =
      await supabase.auth.getUser();
    const freshUser = freshUserData.user;
    const validationDisposition = classifyFreshUserValidation({
      error: freshUserError,
      freshUserId: freshUser?.id,
      expectedUserId: claims.sub,
    });

    if (validationDisposition === "retry") {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[Proxy] Fresh auth-user validation temporarily failed:",
          freshUserError?.message,
        );
      }
      return authRetryResponse();
    }

    if (
      validationDisposition === "banned" ||
      validationDisposition === "clear_session"
    ) {
      await supabase.auth.signOut();
      clearAuthCookiesOnFinalize = true;

      if (validationDisposition === "banned") {
        const loginUrl = new URL("/login", request.url);
        const errorCode = getAccountAccessErrorCode("banned");

        if (errorCode) {
          loginUrl.searchParams.set("error", errorCode);
        }

        return finalizeResponse(NextResponse.redirect(loginUrl));
      }
    } else if (freshUser) {
      user = {
        id: freshUser.id,
        app_metadata:
          freshUser.app_metadata && typeof freshUser.app_metadata === "object"
            ? (freshUser.app_metadata as Record<string, unknown>)
            : null,
      };
    }
  }

  if (user) {
    const accountAccess = readAccountAccessFromMetadata(
      user.app_metadata ?? null,
    );

    if (isAccountBlockedStatus(accountAccess.status)) {
      await supabase.auth.signOut();
      clearAuthCookiesOnFinalize = true;

      const loginUrl = new URL("/login", request.url);
      const errorCode = getAccountAccessErrorCode(accountAccess.status);

      if (errorCode) {
        loginUrl.searchParams.set("error", errorCode);
      }

      if (accountAccess.reason) {
        loginUrl.searchParams.set("reason", accountAccess.reason);
      }

      return finalizeResponse(NextResponse.redirect(loginUrl));
    }
  }

  const currentPath = request.nextUrl.pathname;
  const creatorRouteInfo = isProjectManagementPath(currentPath);
  const effectivePathForMfa =
    currentPath === "/account" ? "/account/profile" : currentPath;
  const effectiveSearchForMfa =
    currentPath === "/account" ? "" : request.nextUrl.search;
  const isRestrictedPathForLoggedIn =
    RESTRICTED_PATHS_FOR_LOGGED_IN_USERS.includes(currentPath);
  // Check for ?noRedirect=1 query parameter
  const searchParams = request.nextUrl.searchParams;
  const hasStaffInviteContext =
    (currentPath === "/login" || currentPath === "/signup") &&
    !!searchParams.get("staff_token") &&
    !!searchParams.get("org");

  if (
    currentPath === "/" &&
    searchParams.get("deleted") === "true" &&
    searchParams.get("noRedirect") === "1"
  ) {
    return finalizeResponse(supabaseResponse); // Skip redirects if requested
  }

  // Let password reset pages render without using a page visit as a sign-out action.
  if (currentPath.startsWith("/reset-password")) {
    return finalizeResponse(supabaseResponse);
  }

  // Guard the MFA challenge page itself.
  // Unauthenticated users must log in first; pass the redirect param through so
  // they land on the right page after completing both login and MFA.
  if (currentPath === "/auth/mfa") {
    if (!user) {
      const loginUrl = new URL("/login", request.url);
      const existingRedirect = searchParams.get("redirect");
      if (existingRedirect) {
        loginUrl.searchParams.set("redirect", existingRedirect);
      }
      return finalizeResponse(NextResponse.redirect(loginUrl));
    }
    // Let authenticated users (aal1 or aal2) through; MfaChallengeClient
    // performs the precise check and redirects aal2 users automatically.
    return finalizeResponse(supabaseResponse);
  }

  let requiresMfaChallenge = false;

  const shouldCheckMfa =
    !!user &&
    (isRestrictedPathForLoggedIn ||
      isProtectedPath(effectivePathForMfa) ||
      isMfaProtectedPath(effectivePathForMfa) ||
      currentPath.startsWith("/admin") ||
      creatorRouteInfo.isCreatorPath);

  if (shouldCheckMfa) {
    const [assuranceResult, factorsResult] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    const factorData =
      (factorsResult.data as MfaListFactorsLike | null) ?? null;
    const mfaState = resolveMfaSessionState({
      assurance: assuranceResult.data,
      factors: factorData,
      assuranceError: assuranceResult.error,
      factorsError: factorsResult.error,
    });

    if (mfaState.invalidUser) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[Proxy] Detected stale/deleted auth user during MFA validation. Signing out.",
        );
      }

      await supabase.auth.signOut();
      clearAuthCookiesOnFinalize = true;
      user = null;
    } else if (mfaState.lookupError) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[Proxy] MFA validation temporarily failed:",
          mfaState.lookupError.message,
        );
      }
      return authRetryResponse();
    }

    if (user) {
      requiresMfaChallenge = mfaState.requiresMfa;

      if (requiresMfaChallenge) {
        const continuationPath = deriveMfaContinuationPath({
          pathname: effectivePathForMfa,
          search: effectiveSearchForMfa,
          requestedRedirect: searchParams.get("redirect"),
        });

        return finalizeResponse(
          NextResponse.redirect(
            new URL(buildMfaRedirectPath(continuationPath), request.url),
          ),
        );
      }
    }
  }

  // Handle /account redirect after auth/MFA checks so we preserve the intended continuation path.
  if (currentPath === "/account") {
    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", "/account/profile");
      return finalizeResponse(NextResponse.redirect(loginUrl));
    }

    return finalizeResponse(
      NextResponse.redirect(new URL("/account/profile", request.url)),
    );
  }

  // Redirect authenticated users trying to access restricted paths
  if (
    user &&
    isRestrictedPathForLoggedIn &&
    shouldRedirectAuthenticatedRestrictedRequest({
      method: request.method,
      hasNextActionHeader: request.headers.has("next-action"),
    })
  ) {
    if (hasStaffInviteContext) {
      return finalizeResponse(supabaseResponse);
    }

    return finalizeResponse(
      NextResponse.redirect(new URL("/home", request.url)),
    );
  }

  // Redirect non-authenticated users trying to access protected paths
  if (!user && isProtectedPath(currentPath)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "redirect",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return finalizeResponse(NextResponse.redirect(loginUrl));
  }

  // Handle admin routes - redirect to 404 if not super admin
  if (currentPath.startsWith("/admin")) {
    if (!user) {
      return finalizeResponse(
        NextResponse.redirect(new URL("/not-found", request.url)),
      );
    }
    // Logged-in users proceed; the admin route performs a service-role check server-side.
  }

  // Check project-management routes using the same creator/admin/staff model
  // enforced by the underlying Server Actions.
  const { isCreatorPath, projectId } = creatorRouteInfo;
  if (isCreatorPath && projectId) {
    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set(
        "redirect",
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
      );
      return finalizeResponse(NextResponse.redirect(loginUrl));
    }

    try {
      const { data: project, error } = await supabase
        .from("projects")
        .select("creator_id, organization_id, can_be_managed_by_staff")
        .eq("id", projectId)
        .single();

      if (error) {
        console.error(
          "Error fetching project for management-route check:",
          error,
        );
        return finalizeResponse(
          NextResponse.redirect(new URL("/home", request.url)),
        );
      }

      let organizationRole: string | null = null;
      if (project?.organization_id && project.creator_id !== user.id) {
        const { data: membership } = await supabase
          .from("organization_members")
          .select("role")
          .eq("organization_id", project.organization_id)
          .eq("user_id", user.id)
          .maybeSingle();
        organizationRole = membership?.role ?? null;
      }

      if (
        !project ||
        !canManageProjectRoute({
          creatorId: project.creator_id,
          userId: user.id,
          organizationRole,
          canBeManagedByStaff: project.can_be_managed_by_staff,
        })
      ) {
        return finalizeResponse(
          NextResponse.redirect(new URL(`/projects/${projectId}`, request.url)),
        );
      }
    } catch (e) {
      console.error("Exception during project management-route check:", e);
      return finalizeResponse(
        NextResponse.redirect(new URL("/home", request.url)),
      );
    }
  }

  return finalizeResponse(supabaseResponse);
}
