/**
 * Shared TypeScript types for the auth system
 */

import type { User } from '@supabase/supabase-js';

/**
 * Auth state returned by useAuth hook
 */
export interface AuthState {
  /**
   * The authenticated user or null if not authenticated
   */
  user: User | null;

  /**
   * Whether auth data is currently being fetched
   */
  isLoading: boolean;

  /**
   * Whether an error occurred during auth fetch
   */
  isError: boolean;

  /**
   * The error object if isError is true
   */
  error?: Error;

  /**
   * Whether user is authenticated (convenience getter)
   */
  isAuthenticated?: boolean;

  /**
   * Get the error if one exists
   */
  getError?: () => Error | undefined;

  /**
   * Refresh the auth state
   */
  refresh?: () => Promise<void>;
}

/**
 * Auth context metrics for debugging/monitoring
 */
export interface AuthMetrics {
  /**
   * The ID of the currently cached user
   */
  cachedUserId: string | null;

  /**
   * The email of the currently cached user
   */
  cachedUserEmail: string | null;

  /**
   * Timestamp of last successful fetch
   */
  lastFetchTimestamp: number;

  /**
   * Whether a fetch is currently in-flight
   */
  hasPendingPromise: boolean;

  /**
   * Error message from last failed fetch
   */
  lastError: string | null;
}

// Re-export Supabase types for convenience
export type { User } from '@supabase/supabase-js';
