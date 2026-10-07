/** Server auth validation and the durable account-deletion guard. */

import { createClient } from "./server";
import type { AuthUser } from "./types";
import type { AuthError } from "@supabase/supabase-js";
import { type MfaListFactorsLike } from "@/lib/auth/mfa";
import { resolveMfaSessionState } from "@/lib/auth/mfa-session-state";
import { isStaleSupabaseAuthUserError } from "@/lib/supabase/auth-errors";

export type AuthResult = {
  user: AuthUser | null;
  error: AuthError | null;
  requiresMfa?: boolean;
};

type GetAuthUserOptions = {
  sensitive?: boolean;
  allowMfaPending?: boolean;
  checkMfa?: boolean;
  allowAccountDeletion?: boolean;
};

async function sessionRequiresMfa(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const [assuranceResult, factorsResult] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  const { data: assuranceData, error: assuranceError } = assuranceResult;
  const { data: factorsData, error: factorsError } = factorsResult;
  const factorData = (factorsData as MfaListFactorsLike | null) ?? null;
  const mfaState = resolveMfaSessionState({
    assurance: assuranceData,
    factors: factorData,
    assuranceError,
    factorsError,
  });

  if (mfaState.lookupError && process.env.NODE_ENV === "development") {
    console.warn(
      "[AuthHelpers] MFA assurance lookup failed:",
      mfaState.lookupError.message,
    );
  }

  return {
    ...mfaState,
    lookupError: mfaState.lookupError as AuthError | null,
  };
}

/** Resolve JWT claims or fresh Auth state before checking application access. */
async function resolveAuthUser(
  options?: GetAuthUserOptions,
): Promise<AuthResult> {
  const supabase = await createClient();

  const returnUser = (user: AuthUser, requiresMfa = false): AuthResult => ({
    user,
    error: null,
    ...(requiresMfa ? { requiresMfa: true } : {}),
  });

  if (options?.sensitive) {
    // Use getUser() for sensitive operations - makes API call for fresh data
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      if (isStaleSupabaseAuthUserError(error)) {
        return { user: null, error: null };
      }

      return { user: null, error };
    }

    if (!user) {
      return { user: null, error: null };
    }

    const checkMfaEnabled = options.checkMfa || options.allowMfaPending;
    if (checkMfaEnabled) {
      const mfaState = await sessionRequiresMfa(supabase);

      if (mfaState.invalidUser) {
        await supabase.auth.signOut();
        return { user: null, error: null };
      }

      if (mfaState.lookupError) {
        return { user: null, error: mfaState.lookupError };
      }

      if (options.checkMfa && mfaState.requiresMfa) {
        return { user: null, error: null, requiresMfa: true };
      }

      if (options.allowMfaPending && mfaState.requiresMfa) {
        return returnUser(
          {
            id: user.id,
            email: user.email || null,
            phone: user.phone || null,
            role: user.role || null,
            user_metadata: user.user_metadata || null,
            app_metadata: user.app_metadata || null,
          },
          true,
        );
      }
    }

    // Return user in consistent format
    return returnUser({
      id: user.id,
      email: user.email || null,
      phone: user.phone || null,
      role: user.role || null,
      user_metadata: user.user_metadata || null,
      app_metadata: user.app_metadata || null,
    });
  }

  // Validate the session claims before the account-status database check.
  const { data: claimsData, error } = await supabase.auth.getClaims();

  if (error) {
    return { user: null, error };
  }

  if (!claimsData?.claims) {
    return { user: null, error: null };
  }

  const { claims } = claimsData;

  // ONLY check MFA if explicitly requested, as listing factors requires a network call.
  const checkMfaEnabled = options?.checkMfa || options?.allowMfaPending;
  if (checkMfaEnabled) {
    const mfaState = await sessionRequiresMfa(supabase);

    if (mfaState.invalidUser) {
      await supabase.auth.signOut();
      return { user: null, error: null };
    }

    if (mfaState.lookupError) {
      return { user: null, error: mfaState.lookupError };
    }

    if (options?.checkMfa && mfaState.requiresMfa) {
      return { user: null, error: null, requiresMfa: true };
    }

    if (options?.allowMfaPending && mfaState.requiresMfa) {
      return {
        user: {
          id: claims.sub,
          email: claims.email || null,
          phone: claims.phone || null,
          role: claims.role || null,
          user_metadata: claims.user_metadata || null,
          app_metadata: claims.app_metadata || null,
        },
        error: null,
        requiresMfa: true,
      };
    }
  }

  // Return user-shaped object from claims
  return {
    user: {
      id: claims.sub,
      email: claims.email || null,
      phone: claims.phone || null,
      role: claims.role || null,
      user_metadata: claims.user_metadata || null,
      app_metadata: claims.app_metadata || null,
    },
    error: null,
  };
}

export async function getAuthUser(
  options?: GetAuthUserOptions,
): Promise<AuthResult> {
  const result = await resolveAuthUser(options);
  if (!result.user) return result;
  if (
    options?.allowAccountDeletion &&
    options.sensitive &&
    options.checkMfa &&
    !result.requiresMfa
  )
    return result;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("account_deletion_pending");
  if (error || data !== false) return { user: null, error: null };
  return result;
}

/** Require a validated session whose account is not pending deletion. */
export async function requireAuth(options?: {
  sensitive?: boolean;
}): Promise<AuthUser> {
  const { user, error } = await getAuthUser(options);

  if (error) {
    throw new Error(`Authentication failed: ${error.message}`);
  }

  if (!user) {
    throw new Error("Unauthorized: No active session");
  }

  return user;
}

/**
 * Check if user is authenticated (returns boolean).
 *
 * Useful for conditional logic where you don't need the full user object.
 *
 * @example
 * const isAuthenticated = await isAuth();
 * if (!isAuthenticated) {
 *   return { error: "Please sign in" };
 * }
 */
export async function isAuth(): Promise<boolean> {
  const { user } = await getAuthUser();
  return user !== null;
}
