'use client';

/**
 * AuthProvider: Global auth state initialization and management
 * 
 * Purpose:
 * - Ensures auth state listeners are set up early in the app lifecycle
 * - Provides a single source of truth for auth state across all components
 * - Handles auth state changes globally before any component renders
 * - Initializes profile cache when user is authenticated
 * 
 * This provider should wrap the entire app to ensure all components
 * have access to synchronized auth state.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import {
  updateCachedUser,
  clearAuthCache,
  isCacheInitialized,
  primeAuthCache,
  initializeUserProfileCache,
} from '@/utils/auth/auth-context';
import { clearProfileCache } from '@/utils/auth/profile-cache';
import type { User } from '@supabase/supabase-js';

type AuthProviderProps = {
  children: React.ReactNode;
  initialUser?: User | null;
};

export function AuthProvider({ children, initialUser = null }: AuthProviderProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const primedRef = useRef(false);
  // Track if we've initialized profile cache for current user
  const profileInitializedForRef = useRef<string | null>(null);

  // Prime the cache exactly once during the first render to ensure useAuth
  // starts with the server-provided user (or a confirmed null state).
  useMemo(() => {
    if (primedRef.current) return;
    // Always prime the cache with server state to ensure hydration matches.
    // We use force: true to override any potential client-side initialization
    // that might have happened (though unlikely in fresh load).
    primeAuthCache(initialUser ?? null, { force: true });
    primedRef.current = true;
  }, [initialUser]);

  useEffect(() => {
    const supabase = createClient();

    // Set up global auth state listener
    // This fires BEFORE individual component listeners
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('[AuthProvider] Global auth state changed:', event, session?.user?.email);
        }

        // Update the global auth cache immediately
        // TOKEN_REFRESHED: Only update cached user reference, don't trigger profile refetches
        // This prevents ~30 duplicate queries on tab focus/token refresh
        if (event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            // Silent update - don't notify subscribers (prevents cascade of fetches)
            updateCachedUser(session.user, { silent: true });
          }
          return; // Exit early - no need to trigger data fetches
        }
        
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') {
          if (session?.user) {
            updateCachedUser(session.user);
            
            // Initialize profile cache if not already done for this user
            // This ensures profile data is fetched after page refresh
            if (profileInitializedForRef.current !== session.user.id) {
              profileInitializedForRef.current = session.user.id;
              initializeUserProfileCache(session.user.id).catch((error) => {
                console.error('[AuthProvider] Failed to initialize profile cache:', error);
              });
            }
          }
        } else if (event === 'SIGNED_OUT') {
          clearAuthCache();
          clearProfileCache();
          profileInitializedForRef.current = null;
        }
      }
    );

    // Only fetch session if cache wasn't primed from SSR
    // The onAuthStateChange will fire INITIAL_SESSION anyway which updates cache
    if (!isCacheInitialized()) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          updateCachedUser(session.user);
          // Initialize profile cache for the session user
          if (profileInitializedForRef.current !== session.user.id) {
            profileInitializedForRef.current = session.user.id;
            initializeUserProfileCache(session.user.id).catch((error) => {
              console.error('[AuthProvider] Failed to initialize profile cache:', error);
            });
          }
        }
        setIsInitialized(true);
        
        if (process.env.NODE_ENV === 'development') {
          console.log('[AuthProvider] Initialized with session:', session?.user?.email ?? 'no user');
        }
      });
    } else {
      // Cache was primed from SSR, but we should still initialize profile cache
      // This runs on client side after SSR hydration
      if (initialUser && profileInitializedForRef.current !== initialUser.id) {
        profileInitializedForRef.current = initialUser.id;
        initializeUserProfileCache(initialUser.id).catch((error) => {
          console.error('[AuthProvider] Failed to initialize profile cache:', error);
        });
      }
      setIsInitialized(true);
      if (process.env.NODE_ENV === 'development') {
        console.log('[AuthProvider] Cache already primed from SSR, skipping getSession');
      }
    }

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Optionally, you can show a loading state while auth initializes
  // For now, we'll render children immediately to avoid flash
  return <>{children}</>;
}
