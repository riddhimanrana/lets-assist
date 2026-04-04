import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import {
    getAccountAccessErrorCode,
    isAccountBlockedStatus,
    readAccountAccessFromMetadata,
} from "@/lib/auth/account-access";
import {
    buildMfaRedirectPath,
    deriveAuthenticatorAssurance,
    deriveMfaContinuationPath,
    shouldPromptForMfaChallenge,
    type MfaListFactorsLike,
} from "@/lib/auth/mfa";
import { isStaleSupabaseAuthUserError } from "@/lib/supabase/auth-errors";

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
const RESTRICTED_PATHS_FOR_LOGGED_IN_USERS = ["/", "/login", "/signup", "/reset-password", "/faq"];

// Function to check if a path requires authentication
export function isProtectedPath(path: string) {
    return PROTECTED_PATHS.some(
        (protectedPath) =>
            path === protectedPath || path.startsWith(`${protectedPath}/`),
    );
}

export function applyPrivateNoStore<T extends NextResponse>(response: T): T {
    response.headers.set("Cache-Control", "private, no-store");
    return response;
}

function clearSupabaseAuthCookies(request: NextRequest, response: NextResponse) {
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

// Function to check if path is for project creator only
function isProjectCreatorPath(path: string) {
    const matches = path.match(/^\/projects\/([^/]+)\/(edit|signups|documents|attendance|hours)$/);
    return matches ? { isCreatorPath: true, projectId: matches[1] } : { isCreatorPath: false, projectId: null };
}

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    });
    applyPrivateNoStore(supabaseResponse);

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // IMPORTANT: Always call getClaims() immediately after creating the Supabase client.
    // This refreshes the user's session tokens and writes updated cookies to the response.
    // Do NOT run any code between createServerClient and getClaims().
    // Per Supabase docs: "If you remove getClaims() and you use server-side rendering
    // with the Supabase client, your users may be randomly logged out."
    // @see https://github.com/supabase/supabase/issues/40985
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    
    // If getClaims() fails (e.g., invalid/expired tokens that can't be refreshed),
    // treat the user as not authenticated. The error is expected for anonymous users
    // or users with completely invalid session state.
    if (claimsError && process.env.NODE_ENV === 'development') {
        // Only log in development to avoid noise in production
        console.log('[Proxy] getClaims error (user will be treated as not authenticated):', claimsError.message);
    }
    
    // Extract user from claims if available
    let user = null;
    if (claimsData?.claims) {
        user = { id: claimsData.claims.sub, ...claimsData.claims };
    }

    if (user) {
        const userWithMetadata = user as { app_metadata?: Record<string, unknown> | null };
        const accountAccess = readAccountAccessFromMetadata(userWithMetadata.app_metadata ?? null);

        if (isAccountBlockedStatus(accountAccess.status)) {
            await supabase.auth.signOut();

            const loginUrl = new URL('/login', request.url);
            const errorCode = getAccountAccessErrorCode(accountAccess.status);

            if (errorCode) {
                loginUrl.searchParams.set('error', errorCode);
            }

            if (accountAccess.reason) {
                loginUrl.searchParams.set('reason', accountAccess.reason);
            }

            const response = NextResponse.redirect(loginUrl);
            clearSupabaseAuthCookies(request, response);
            return applyPrivateNoStore(response);
        }
    }

    const currentPath = request.nextUrl.pathname;
    const creatorRouteInfo = isProjectCreatorPath(currentPath);
    const effectivePathForMfa = currentPath === "/account" ? "/account/profile" : currentPath;
    const effectiveSearchForMfa = currentPath === "/account" ? "" : request.nextUrl.search;
    const isRestrictedPathForLoggedIn = RESTRICTED_PATHS_FOR_LOGGED_IN_USERS.includes(currentPath);
    const currentAal = claimsData?.claims && typeof claimsData.claims.aal === "string"
        ? claimsData.claims.aal
        : null;

    // Check for ?noRedirect=1 query parameter
    const searchParams = request.nextUrl.searchParams;
    const hasStaffInviteContext =
        (currentPath === "/login" || currentPath === "/signup") &&
        !!searchParams.get("staff_token") &&
        !!searchParams.get("org");

    if (searchParams.get("noRedirect") === "1") {
        return applyPrivateNoStore(supabaseResponse); // Skip redirects if requested
    }

    // Handle reset password paths specially
    if (currentPath.startsWith("/reset-password")) {
        if (user) {
            await supabase.auth.signOut();
            const response = NextResponse.redirect(request.url);
            clearSupabaseAuthCookies(request, response);
            return applyPrivateNoStore(response);
        }
        return applyPrivateNoStore(supabaseResponse);
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
            return applyPrivateNoStore(NextResponse.redirect(loginUrl));
        }
        // Let authenticated users (aal1 or aal2) through; MfaChallengeClient
        // performs the precise check and redirects aal2 users automatically.
        return applyPrivateNoStore(supabaseResponse);
    }

    let requiresMfaChallenge = false;

    const shouldCheckMfa = !!user && (
        isRestrictedPathForLoggedIn ||
        isProtectedPath(effectivePathForMfa) ||
        currentPath.startsWith("/admin") ||
        creatorRouteInfo.isCreatorPath
    );

    if (shouldCheckMfa) {
        const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();

        if (factorsError) {
            if (isStaleSupabaseAuthUserError(factorsError)) {
                if (process.env.NODE_ENV === "development") {
                    console.warn("[Proxy] Detected stale/deleted auth user. Signing out and treating request as unauthenticated.");
                }

                await supabase.auth.signOut();
                clearSupabaseAuthCookies(request, supabaseResponse);
                user = null;
            } else if (process.env.NODE_ENV === "development") {
                console.log("[Proxy] MFA factor lookup error:", factorsError.message);
            }
        }

        if (user) {
            const factorData = (factorsData as MfaListFactorsLike | null) ?? null;
            const assuranceData = deriveAuthenticatorAssurance(currentAal, factorData);

            requiresMfaChallenge = shouldPromptForMfaChallenge(
                assuranceData,
                factorData,
            );

            if (requiresMfaChallenge) {
                const continuationPath = deriveMfaContinuationPath({
                    pathname: effectivePathForMfa,
                    search: effectiveSearchForMfa,
                    requestedRedirect: searchParams.get("redirect"),
                });

                return applyPrivateNoStore(
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
            const loginUrl = new URL('/login', request.url);
            loginUrl.searchParams.set('redirect', '/account/profile');
            return applyPrivateNoStore(NextResponse.redirect(loginUrl));
        }

        return applyPrivateNoStore(NextResponse.redirect(new URL("/account/profile", request.url)));
    }

    // Redirect authenticated users trying to access restricted paths
    if (user && isRestrictedPathForLoggedIn) {
        if (hasStaffInviteContext) {
            return applyPrivateNoStore(supabaseResponse);
        }

        return applyPrivateNoStore(NextResponse.redirect(new URL("/home", request.url)));
    }

    // Redirect non-authenticated users trying to access protected paths
    if (!user && isProtectedPath(currentPath)) {
        const loginUrl = new URL('/login', request.url);
        loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
        return applyPrivateNoStore(NextResponse.redirect(loginUrl));
    }

    // Handle admin routes - redirect to 404 if not super admin
    if (currentPath.startsWith("/admin")) {
        if (!user) {
            return applyPrivateNoStore(NextResponse.redirect(new URL("/not-found", request.url)));
        }
        // Logged-in users proceed; the admin route performs a service-role check server-side.
    }

    // Check for project creator routes
    const { isCreatorPath, projectId } = creatorRouteInfo;
    if (isCreatorPath && projectId) {
        if (!user) {
            const loginUrl = new URL('/login', request.url);
            loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
            return applyPrivateNoStore(NextResponse.redirect(loginUrl));
        }

        try {
            const { data: project, error } = await supabase
                .from("projects")
                .select("creator_id")
                .eq("id", projectId)
                .single();

            if (error) {
                console.error("Error fetching project for creator check:", error);
                return applyPrivateNoStore(NextResponse.redirect(new URL("/home", request.url)));
            }

            if (!project || project.creator_id !== user.id) {
                return applyPrivateNoStore(
                    NextResponse.redirect(
                        new URL(`/projects/${projectId}`, request.url)
                    ),
                );
            }
        } catch (e) {
            console.error("Exception during project creator check:", e);
            return applyPrivateNoStore(NextResponse.redirect(new URL("/home", request.url)));
        }
    }

    return applyPrivateNoStore(supabaseResponse);
}
