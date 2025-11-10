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
  isCacheInitialized,
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
  // Initialize state from cache if available
  const initialCachedUser = useMemo(() => getCachedUser(), []);
  const isCacheReady = useMemo(() => isCacheInitialized(), []);

  const [state, setState] = useState<AuthState>({
    user: initialCachedUser ?? null,
    isLoading: !isCacheReady, // Only loading if cache hasn't been populated yet
    isError: false,
  });

  // Create client once and reuse it
  const supabase = useMemo(() => createClient(), []);

  // Effect 1: Initialize auth state (fetch user if needed)
  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        // Check if cache has been initialized
        const cacheReady = isCacheInitialized();

        if (cacheReady) {
          // Cache has been populated, use it (even if it's null)
          const cachedUser = getCachedUser();
          if (mounted) {
            setState({
              user: cachedUser,
              isLoading: false,
              isError: false,
            });
          }
        } else {
          // Cache hasn't been populated yet, need to fetch
          try {
            const user = await getOrFetchUser(supabase);
            if (mounted) {
              setState({
                user,
                isLoading: false,
                isError: false,
              });
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

  // Effect 2: Subscribe to auth state changes (separate from initialization)
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
