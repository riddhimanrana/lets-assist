'use client';

/**
 * useAuth Hook: React hook for accessing cached auth state
 * 
 * Key Features:
 * - Returns user from memory cache (no API call if cached)
 * - Subscribes to auth state changes automatically
 * - Provides loading and error states
 * - Automatic cleanup on unmount
 * - Type-safe user object
 * 
 * Usage:
 * const { user, isLoading, isError } = useAuth();
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import {
  getOrFetchUser,
  getCachedUser,
  clearAuthCache,
  updateCachedUser,
  waitForAuthReady,
  refreshUser,
  subscribeToCacheChanges,
} from '@/utils/auth/auth-context';
import type { AuthState, User } from '@/utils/auth/types';

/**
 * Custom React hook for managing auth state
 * 
 * Returns:
 * - user: The authenticated user or null
 * - isLoading: Whether auth is being fetched
 * - isError: Whether an error occurred
 * - error: The error object if one occurred
 * 
 * Example:
 * ```typescript
 * function UserProfile() {
 *   const { user, isLoading, isError } = useAuth();
 *
 *   if (isLoading) return <Skeleton />;
 *   if (isError) return <ErrorMessage />;
 *   if (!user) return <SignInPrompt />;
 *
 *   return <div>Welcome, {user.email}</div>;
 * }
 * ```
 */
export function useAuth(): AuthState {
  // Initialize state from cache immediately (not null!)
  // This is critical for preventing flash of logged-out state
  const cachedUserInitial = useMemo(() => getCachedUser(), []);
  
  const [state, setState] = useState<AuthState>({
    user: cachedUserInitial ?? null,  // Use cached user if available
    isLoading: cachedUserInitial ? false : true,  // Only loading if no cached user
    isError: false,
  });

  // Create client once and reuse it
  const supabase = useMemo(() => createClient(), []);

  // Effect 1: Initialize auth state (fetch user if needed)
  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        if (process.env.NODE_ENV === 'development') {
          console.log('[useAuth] Initializing auth state...');
        }

        // IMPORTANT: Check cache FIRST - it may have been updated by AuthProvider or login flow
        const cachedUser = getCachedUser();
        if (cachedUser) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[useAuth] Using cached user:', cachedUser.email);
          }
          if (mounted) {
            setState({
              user: cachedUser,
              isLoading: false,
              isError: false,
            });
          }
          return;
        }

        // If no cached user, check the current session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          console.error('[useAuth] Error getting session:', sessionError);
          if (mounted) {
            setState({
              user: null,
              isLoading: false,
              isError: true,
              error: sessionError,
            });
          }
          return;
        }

        // If we have an active session, use it and update cache
        if (session?.user) {
          updateCachedUser(session.user);
          if (mounted) {
            setState({
              user: session.user,
              isLoading: false,
              isError: false,
            });
          }
          if (process.env.NODE_ENV === 'development') {
            console.log('[useAuth] Session found on mount:', session.user.email);
          }
        } else {
          // No session and no cache - user is logged out
          if (mounted) {
            setState({
              user: null,
              isLoading: false,
              isError: false,
            });
          }
          if (process.env.NODE_ENV === 'development') {
            console.log('[useAuth] No session found');
          }
        }
      } catch (error) {
        if (mounted) {
          setState({
            user: null,
            isLoading: false,
            isError: true,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    };

    initializeAuth();

    return () => {
      mounted = false;
    };
  }, [supabase]); // Only depend on supabase, run once

  // Effect 2a: Subscribe to CACHE changes (fires when updateCachedUser is called)
  // This is critical for detecting manual cache updates from LoginClient
  useEffect(() => {
    let mounted = true;

    if (process.env.NODE_ENV === 'development') {
      console.log('[useAuth] Setting up cache subscription');
    }

    // Subscribe to cache changes - this will fire when updateCachedUser is called
    const unsubscribe = subscribeToCacheChanges((cachedUser) => {
      if (!mounted) return;

      if (process.env.NODE_ENV === 'development') {
        console.log('[useAuth] Cache changed:', cachedUser?.email);
      }

      setState((prev) => ({
        ...prev,
        user: cachedUser,
        isLoading: false,
        isError: false,
      }));
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // Effect 2b: Subscribe to auth state changes (separate from initialization)
  useEffect(() => {
    let mounted = true;

    if (process.env.NODE_ENV === 'development') {
      console.log('[useAuth] Setting up auth state subscription');
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        if (process.env.NODE_ENV === 'development') {
          console.log('[useAuth] Auth state changed:', event, session?.user?.email);
        }

        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') {
          if (session?.user) {
            updateCachedUser(session.user);
            setState((prev) => ({
              ...prev,
              user: session.user,
              isLoading: false,
              isError: false,
            }));
          }
        } else if (event === 'SIGNED_OUT') {
          clearAuthCache();
          setState({
            user: null,
            isLoading: false,
            isError: false,
          });
        } else if (event === 'TOKEN_REFRESHED') {
          // Token was refreshed, update cache if session exists
          if (session?.user) {
            updateCachedUser(session.user);
            setState((prev) => ({
              ...prev,
              user: session.user,
            }));
          }
        }
      }
    );

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [supabase]); // Only depend on supabase, set up once and never change

  // Create refresh function
  const refreshAuthState = useCallback(async () => {
    try {
      await refreshUser(supabase);
      const updatedUser = getCachedUser();
      setState({
        user: updatedUser,
        isLoading: false,
        isError: false,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isError: true,
        error: error instanceof Error ? error : new Error(String(error)),
      }));
    }
  }, [supabase]);

  // Add convenience methods to the returned state object
  return {
    ...state,
    isAuthenticated: state.user !== null,
    getError: () => state.error,
    refresh: refreshAuthState,
  };
}

/**
 * Hook to force refresh the current user
 * Useful after user profile updates
 * 
 * @returns Function to trigger refresh
 * 
 * Example:
 * ```typescript
 * function UserProfile() {
 *   const refreshAuth = useAuthRefresh();
 *
 *   const handleProfileUpdate = async () => {
 *     await updateProfile(...);
 *     await refreshAuth(); // Refresh auth state
 *   };
 * }
 * ```
 */
export function useAuthRefresh() {
  const supabase = useMemo(() => createClient(), []);

  return useCallback(async () => {
    const { refreshUser } = await import('@/utils/auth/auth-context');
    return refreshUser(supabase);
  }, [supabase]);
}

/**
 * Hook to wait for auth to be ready
 * Useful before making decisions based on auth state
 * 
 * @returns Function to wait for auth ready
 * 
 * Example:
 * ```typescript
 * function ProtectedComponent() {
 *   const waitReady = useAuthReady();
 *
 *   useEffect(() => {
 *     waitReady().then(() => {
 *       // Now we know for sure if user is authenticated
 *       const user = getCachedUser();
 *     });
 *   }, [waitReady]);
 * }
 * ```
 */
export function useAuthReady() {
  return useCallback(async () => {
    return waitForAuthReady();
  }, []);
}
