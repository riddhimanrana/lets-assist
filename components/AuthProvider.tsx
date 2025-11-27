'use client';

/**
 * AuthProvider: Global auth state initialization and management
 * 
 * Purpose:
 * - Ensures auth state listeners are set up early in the app lifecycle
 * - Provides a single source of truth for auth state across all components
 * - Handles auth state changes globally before any component renders
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
} from '@/utils/auth/auth-context';
import type { User } from '@supabase/supabase-js';

type AuthProviderProps = {
  children: React.ReactNode;
  initialUser?: User | null;
};

export function AuthProvider({ children, initialUser = null }: AuthProviderProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const primedRef = useRef(false);

  // Prime the cache exactly once during the first render to ensure useAuth
  // starts with the server-provided user (or a confirmed null state).
  useMemo(() => {
    if (primedRef.current) return;
    if (!isCacheInitialized()) {
      primeAuthCache(initialUser ?? null);
    }
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
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') {
          if (session?.user) {
            updateCachedUser(session.user);
          }
        } else if (event === 'SIGNED_OUT') {
          clearAuthCache();
        } else if (event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            updateCachedUser(session.user);
          }
        }
      }
    );

    // Only fetch session if cache wasn't primed from SSR
    // The onAuthStateChange will fire INITIAL_SESSION anyway which updates cache
    if (!isCacheInitialized()) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          updateCachedUser(session.user);
        }
        setIsInitialized(true);
        
        if (process.env.NODE_ENV === 'development') {
          console.log('[AuthProvider] Initialized with session:', session?.user?.email ?? 'no user');
        }
      });
    } else {
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
