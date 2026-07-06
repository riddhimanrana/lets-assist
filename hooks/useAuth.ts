'use client';

/**
 * useAuth Hook: React hook for accessing auth state.
 *
 * Uses getClaims() for the fast path, then falls back to getUser() when claims
 * fail so a refreshable session is not treated as signed out at JWT expiry.
 * Auth events are invalidation signals; the hook resolves fresh auth state
 * instead of trusting the event payload.
 */

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import {
  shouldPromptForMfaChallenge,
  deriveAuthenticatorAssurance,
  type MfaListFactorsLike,
} from '@/lib/auth/mfa';

export type { User } from '@supabase/supabase-js';

export interface AuthState {
  user: User | null;
  loading: boolean;
  needsMfa: boolean;
  isAuthenticated: boolean;
}

type AuthClaimsLike = {
  sub: string;
  role?: string;
  email?: string;
  phone?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

type ResolvedAuthState = {
  user: User | null;
  claims: (AuthClaimsLike & { aal?: string }) | null;
};

function buildUserFromClaims(claims: AuthClaimsLike): User {
  return {
    id: claims.sub,
    aud: 'authenticated',
    role: claims.role || undefined,
    email: claims.email || undefined,
    phone: claims.phone || undefined,
    user_metadata: claims.user_metadata || {},
    app_metadata: claims.app_metadata || {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function resolveAuthState(
  supabase: ReturnType<typeof createClient>,
): Promise<ResolvedAuthState> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsData?.claims && !claimsError) {
    const claims = claimsData.claims as AuthClaimsLike & { aal?: string };
    return {
      user: buildUserFromClaims(claims),
      claims,
    };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (user) {
    if (claimsError && process.env.NODE_ENV === 'development') {
      console.debug(
        '[useAuth] Claims unavailable; preserved session through getUser():',
        claimsError.message,
      );
    }

    return {
      user,
      claims: {
        sub: user.id,
        role: user.role || undefined,
        email: user.email || undefined,
        phone: user.phone || undefined,
        user_metadata: user.user_metadata || {},
        app_metadata: user.app_metadata || {},
      },
    };
  }

  if (claimsError && process.env.NODE_ENV === 'development') {
    console.debug('[useAuth] No active claims:', claimsError.message);
  }

  if (userError && process.env.NODE_ENV === 'development') {
    console.debug('[useAuth] No active user session:', userError.message);
  }

  return { user: null, claims: null };
}

/**
 * Custom React hook for managing auth state
 *
 * Uses getClaims() to validate JWT and extract user data.
 * Much faster than getSession() or getUser() as it doesn't make API calls.
 *
 * @returns User, loading state, and authentication status
 */
export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsMfa, setNeedsMfa] = useState(false);

  // Create stable supabase client reference
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let mounted = true;

    const syncAuthState = async () => {
      try {
        const resolvedAuthState = await resolveAuthState(supabase);

        if (!mounted) return;

        if (!resolvedAuthState.user) {
          setUser(null);
          setNeedsMfa(false);
          return;
        }

        if (!mounted) return;

        const currentAal = resolvedAuthState.claims?.aal || 'aal1';

        // Middleware enforces MFA for protected routes. Client-side factor
        // lookup is only needed on MFA/authentication screens; doing it on
        // every page adds a network call and can create noisy local-dev errors.
        let mfaFactors: MfaListFactorsLike = { totp: [], phone: [] };
        const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
        const shouldCheckClientMfa =
          pathname === '/auth/mfa' || pathname.startsWith('/account/authentication');

        if (shouldCheckClientMfa) {
          try {
            const { data: factors } = await supabase.auth.mfa.listFactors();
            if (factors) {
              mfaFactors = factors as MfaListFactorsLike;
            }
          } catch (mfaError) {
            console.debug('[useAuth] Could not fetch MFA factors:', mfaError);
          }
        }

        // Determine if user needs MFA challenge
        const userNeedsMfa = shouldPromptForMfaChallenge(
          deriveAuthenticatorAssurance(currentAal, mfaFactors),
          mfaFactors
        );

        setNeedsMfa(userNeedsMfa);

        setUser(resolvedAuthState.user);
      } catch (error) {
        console.error('[useAuth] Error during auth initialization:', error);
        if (mounted) {
          setUser(null);
          setNeedsMfa(false);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void syncAuthState();

    // Subscribe to auth state changes for real-time updates
    // This ensures user data stays fresh when login/logout occurs
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (!mounted) return;

        if (event === 'SIGNED_OUT') {
          setUser(null);
          setNeedsMfa(false);
          setLoading(false);
          return;
        }

        if (event === 'INITIAL_SESSION') {
          return;
        }

        setLoading(true);
        setTimeout(() => {
          if (mounted) {
            void syncAuthState();
          }
        }, 0);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  return {
    user,
    loading,
    needsMfa,
    isAuthenticated: user !== null && !needsMfa,
  };
}

/**
 * Hook to refresh auth state with fresh data from server
 * Useful after profile updates or when you need fresh user data
 *
 * Note: This makes an API call to get fresh data, use sparingly.
 * For most cases, onAuthStateChange will keep data fresh automatically.
 */
export function useAuthRefresh() {
  const supabase = useMemo(() => createClient(), []);

  return async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
      console.error('[useAuthRefresh] Error:', error.message);
      return null;
    }
    return user;
  };
}
