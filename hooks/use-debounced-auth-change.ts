'use client';

/**
 * Hook: useDebouncedAuthChange
 * 
 * Debounces rapid auth state changes to prevent duplicate data fetches
 * 
 * Problem:
 * - When tabs regain focus, onAuthStateChange fires multiple times
 * - Each event triggers a profile fetch
 * - Multiple tabs = multiple redundant fetches
 * 
 * Solution:
 * - Debounce the listener callback with 1-second window
 * - Ignore duplicate events within debounce period
 * - Track last user ID to detect actual user changes
 * 
 * Usage:
 * ```typescript
 * const unsubscribe = useDebouncedAuthChange(async (user) => {
 *   if (user?.id) {
 *     await fetchUserDataBatch(user.id);
 *   }
 * });
 * ```
 */

import { useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';
import type { User } from '@supabase/supabase-js';

const DEBOUNCE_DELAY_MS = 1000; // 1 second window

/**
 * Hook that debounces auth state changes
 * 
 * Prevents duplicate data fetches when:
 * - Tab regains focus (fires onAuthStateChange multiple times)
 * - User stays same but token refreshes
 * - Multiple components subscribe to auth changes
 * 
 * @param onAuthChange Callback when user actually changes
 * @param deps Optional dependency array
 */
export function useDebouncedAuthChange(
  onAuthChange: (user: User | null) => Promise<void> | void,
  deps: React.DependencyList = [],
) {
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastUserIdRef = useRef<string | null>(null);
  const isProcessingRef = useRef(false);

  const handleAuthChange = useCallback(
    async (user: User | null) => {
      // Clear existing debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Check if this is actually a user change
      const userId = user?.id || null;
      const isUserChanged = userId !== lastUserIdRef.current;

      if (process.env.NODE_ENV === 'development') {
        console.log('[DebouncedAuth] Event fired:', {
          userId,
          isChanged: isUserChanged,
          isProcessing: isProcessingRef.current,
        });
      }

      // If user didn't change and we're not processing, skip
      if (!isUserChanged && isProcessingRef.current) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[DebouncedAuth] Ignoring duplicate event');
        }
        return;
      }

      // Set debounce timer
      debounceTimerRef.current = setTimeout(async () => {
        if (isUserChanged) {
          lastUserIdRef.current = userId;
          if (process.env.NODE_ENV === 'development') {
            console.log('[DebouncedAuth] User changed, fetching data:', userId);
          }
        }

        try {
          isProcessingRef.current = true;
          await onAuthChange(user);
        } catch (error) {
          console.error('[DebouncedAuth] Error in callback:', error);
        } finally {
          isProcessingRef.current = false;
        }
      }, DEBOUNCE_DELAY_MS);
    },
    [onAuthChange],
  );

  useEffect(() => {
    const supabase = createClient();

    if (process.env.NODE_ENV === 'development') {
      console.log('[DebouncedAuth] Setting up listener');
    }

    // Subscribe to auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      handleAuthChange(session?.user || null);
    });

    // Cleanup
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      subscription?.unsubscribe();
    };
  }, [handleAuthChange]);
}

/**
 * Alternative: Manual debounce utility for existing listeners
 * 
 * Use this to wrap existing auth listeners without changing hook structure
 * 
 * @param callback The function to debounce
 * @param delayMs Debounce delay in milliseconds
 * @returns Debounced function
 */
export function debounceAuthChange<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delayMs: number = DEBOUNCE_DELAY_MS,
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastCallTime = 0;
  let lastInvokeTime = 0;

  return (...args: Parameters<T>) => {
    const time = Date.now();
    const isInvoking = false;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    lastArgs = args;

    timeoutId = setTimeout(() => {
      if (lastArgs) {
        try {
          (callback as (...args: Parameters<T>) => void)(...lastArgs);
        } catch (error) {
          console.error('[DebouncedAuth] Callback error:', error);
        }
      }
      timeoutId = null;
      lastInvokeTime = Date.now();
    }, delayMs);
  };
}
