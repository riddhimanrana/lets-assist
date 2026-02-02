/**
 * Server-side authentication helpers
 *
 * Based on Supabase best practices from Issue #40985:
 * - Use getClaims() by default (fast, no API call)
 * - Use getUser() only for sensitive operations (password/email changes)
 *
 * @see https://github.com/supabase/supabase/issues/40985
 */

import { createClient } from './server';
import type { AuthUser } from './types';
import type { AuthError } from '@supabase/supabase-js';

export type AuthResult = {
  user: AuthUser | null;
  error: AuthError | null;
};

/**
 * Get authenticated user from server-side context with optimal performance.
 *
 * **Default Behavior (sensitive: false):**
 * - Uses getClaims() which validates JWT locally (no API call, ~50ms faster)
 * - Returns user data from the JWT token
 * - Suitable for 95% of auth checks: authorization, profile updates, CRUD operations
 *
 * **Sensitive Operations (sensitive: true):**
 * - Uses getUser() which fetches fresh data from the database
 * - Required for: password changes, email changes, account deletion
 * - Provides revocation awareness (logout-all scenarios)
 *
 * @param options.sensitive - Set to true ONLY for sensitive operations (password/email changes, account deletion)
 * @returns User object and error (if any)
 *
 * @example
 * // Standard operations (fast, uses getClaims) - USE THIS BY DEFAULT
 * const { user, error } = await getAuthUser();
 * if (!user) {
 *   return { error: "Not authenticated" };
 * }
 * // Proceed with project creation, profile updates, etc.
 *
 * @example
 * // Sensitive operations (secure, uses getUser) - ONLY FOR CRITICAL AUTH CHANGES
 * const { user, error } = await getAuthUser({ sensitive: true });
 * if (!user) {
 *   return { error: "Not authenticated" };
 * }
 * // Proceed with password change, email change, or account deletion
 */
export async function getAuthUser(options?: { sensitive?: boolean }): Promise<AuthResult> {
  const supabase = await createClient();

  if (options?.sensitive) {
    // Use getUser() for sensitive operations - makes API call for fresh data
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error) {
      return { user: null, error };
    }

    if (!user) {
      return { user: null, error: null };
    }

    // Return user in consistent format
    return {
      user: {
        id: user.id,
        email: user.email || null,
        phone: user.phone || null,
        role: user.role || null,
        user_metadata: user.user_metadata || null,
        app_metadata: user.app_metadata || null,
      },
      error: null,
    };
  }

  // Default: use getClaims() for fast session validation
  // This validates the JWT locally without making an API call
  const { data: claimsData, error } = await supabase.auth.getClaims();

  if (error) {
    return { user: null, error };
  }

  if (!claimsData?.claims) {
    return { user: null, error: null };
  }

  const { claims } = claimsData;

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

/**
 * Auth guard for server actions and API routes - throws if not authenticated.
 *
 * **Cleaner Alternative to Manual Checks:**
 * Instead of checking `if (!user) return { error: ... }`, this function throws an error
 * if authentication fails, making your code cleaner and less error-prone.
 *
 * **Performance:**
 * - By default, uses getClaims() for fast JWT validation (~50ms faster than getUser)
 * - Use sensitive: true ONLY for password/email changes and account deletion
 *
 * @param options.sensitive - Set to true ONLY for sensitive operations
 * @throws Error if authentication fails or user is not authenticated
 * @returns Authenticated user object (never null)
 *
 * @example
 * // Standard operations (fast) - USE THIS BY DEFAULT
 * export async function createProject(data: ProjectData) {
 *   const user = await requireAuth(); // Throws if not authenticated
 *   // Now you can safely use user.id, user.email, etc.
 *
 *   const { data: project } = await supabase
 *     .from("projects")
 *     .insert({ ...data, creator_id: user.id });
 *
 *   return { success: true, project };
 * }
 *
 * @example
 * // Sensitive operations (secure) - ONLY FOR CRITICAL AUTH CHANGES
 * export async function updatePassword(newPassword: string) {
 *   const user = await requireAuth({ sensitive: true }); // Uses getUser()
 *
 *   const { error } = await supabase.auth.updateUser({
 *     password: newPassword
 *   });
 *
 *   return { success: !error };
 * }
 */
export async function requireAuth(options?: { sensitive?: boolean }): Promise<AuthUser> {
  const { user, error } = await getAuthUser(options);

  if (error) {
    throw new Error(`Authentication failed: ${error.message}`);
  }

  if (!user) {
    throw new Error('Unauthorized: No active session');
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
