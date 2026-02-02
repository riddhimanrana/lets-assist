'use client';

/**
 * useAuth Hook: React hook for accessing auth state
 *
 * Uses getClaims() for fast, local JWT validation (no API call).
 * Subscribes to auth state changes automatically for real-time updates.
 *
 * Based on Supabase best practices from Issue #40985:
 * - getClaims() is recommended over getSession()
 * - Validates JWT locally without database roundtrip
 * - onAuthStateChange still provides real-time updates
 *
 * Usage:
 * const { user, loading } = useAuth();
 *
 * @see https://github.com/supabase/supabase/issues/40985
 */

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

export type { User } from '@supabase/supabase-js';

export interface AuthState {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
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

  // Create stable supabase client reference
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let mounted = true;

    // Get initial auth state using getClaims() for fast validation
    const initAuth = async () => {
      try {
        // Use getClaims() for fast, local JWT validation (no API call)
        const { data: claimsData, error } = await supabase.auth.getClaims();

        if (!mounted) return;

        if (error) {
          console.error('[useAuth] Error getting claims:', error);
          setUser(null);
        } else if (claimsData?.claims) {
          // Construct User object from claims
          const { claims } = claimsData;
          const userFromClaims: User = {
            id: claims.sub,
            aud: 'authenticated',
            role: claims.role || undefined,
            email: claims.email || undefined,
            phone: claims.phone || undefined,
            user_metadata: claims.user_metadata || {},
            app_metadata: claims.app_metadata || {},
            created_at: new Date().toISOString(), // Not available in claims
            updated_at: new Date().toISOString(), // Not available in claims
          };
          setUser(userFromClaims);
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error('[useAuth] Error during auth initialization:', error);
        if (mounted) setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    initAuth();

    // Subscribe to auth state changes for real-time updates
    // This ensures user data stays fresh when login/logout occurs
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        setUser(session?.user ?? null);
        setLoading(false);
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
    isAuthenticated: user !== null,
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
