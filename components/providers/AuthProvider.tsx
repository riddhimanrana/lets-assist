'use client';

/**
 * AuthProvider: Global auth state initialization
 * 
 * Simplified provider that only handles auth state change logging.
 * Auth state is managed by individual hooks using getClaims().
 */

import { useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';

type AuthProviderProps = {
  children: React.ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    // Set up global auth state listener for debugging/logging
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('[AuthProvider] Auth state changed:', event, session?.user?.email);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  return <>{children}</>;
}
