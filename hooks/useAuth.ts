'use client';

/**
 * useAuth Hook: React hook for accessing auth state
 * 
 * Uses getSession() + getUser() for reliable auth verification.
 * Subscribes to auth state changes automatically.
 * 
 * Usage:
 * const { user, loading } = useAuth();
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
 * Uses getSession() first to check for existing session,
 * then getUser() to verify the user is still valid.
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

    // Get initial auth state
    const initAuth = async () => {
      try {
        // First check session (reads from storage, fast)
        const { data: { session } } = await supabase.auth.getSession();

        if (!mounted) return;

        if (session?.user) {
          setUser(session.user);
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error('[useAuth] Error getting session:', error);
        if (mounted) setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    initAuth();

    // Subscribe to auth state changes
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
 * Hook to refresh auth state
 * Useful after profile updates or when you need fresh user data
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
