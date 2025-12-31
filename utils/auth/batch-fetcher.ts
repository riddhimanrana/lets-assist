'use client';

/**
 * Batch Data Fetcher with RPC Support
 * 
 * Fetches user profile + settings + preferences in minimal queries
 * - Uses Supabase RPC or batched queries for efficiency
 * - Caches results in memory
 * - Called once at login, then subscribes to realtime updates
 * - Uses promise deduplication to prevent concurrent fetches
 * 
 * Reduces from ~5-10 queries to 1-2 queries per login
 */

import { createClient } from '@/utils/supabase/client';
import {
  updateCachedUserData,
  updateFetchTimestamp,
  isCacheValid,
  getCachedUserData,
  type UserProfile,
  type NotificationSettings,
} from '@/utils/auth/profile-cache';

export interface BatchUserData {
  profile: UserProfile | null;
  settings: NotificationSettings | null;
}

/**
 * In-flight fetch promise for deduplication
 * Prevents multiple concurrent fetches when AuthProvider and useUserProfile
 * both try to fetch at the same time
 */
let fetchInFlightPromise: Promise<BatchUserData> | null = null;
let fetchInFlightForUserId: string | null = null;

/**
 * Fetch user profile and settings in minimal queries
 * 
 * This replaces multiple separate queries:
 * BEFORE: 
 *   - query profiles table
 *   - query notification_settings table
 *   - query preferences (theme, timezone)
 * AFTER:
 *   - single batched query or RPC
 * 
 * Uses promise deduplication - if a fetch is already in-flight for the same user,
 * returns the existing promise instead of starting a new one.
 * 
 * @param userId - Authenticated user ID
 * @returns Profile, settings, and preferences
 */
export async function fetchUserDataBatch(
  userId: string,
): Promise<BatchUserData> {
  // If there's already an in-flight request for this user, return it
  if (fetchInFlightPromise && fetchInFlightForUserId === userId) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[BatchFetch] Returning in-flight promise (deduplication)');
    }
    return fetchInFlightPromise;
  }

  // Create the fetch promise
  fetchInFlightForUserId = userId;
  fetchInFlightPromise = (async () => {
    const supabase = createClient();

    try {
      // Parallel queries (executed together by Supabase)
      const [profileResult, settingsResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, avatar_url, username, phone, profile_visibility, created_at, updated_at, volunteer_goals')
          .eq('id', userId)
          .maybeSingle(),
        supabase
          .from('notification_settings')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle(),
      ]);

      // Check for errors
      if (profileResult.error) {
        console.error('[BatchFetch] Profile query error:', {
          message: profileResult.error.message,
          code: profileResult.error.code,
          details: profileResult.error.details,
          hint: profileResult.error.hint,
        });
      }
      if (settingsResult.error) {
        console.error('[BatchFetch] Settings query error:', settingsResult.error);
      }

      const profile = profileResult.data as UserProfile | null;
      const settings = settingsResult.data as NotificationSettings | null;

      if (process.env.NODE_ENV === 'development') {
        console.log('[BatchFetch] Fetched user data:', {
          profile: profile ? `${profile.full_name} (${profile.username})` : null,
          hasSettings: !!settings,
          profileError: profileResult.error?.message,
          settingsError: settingsResult.error?.message,
        });
      }

      // Update cache and notify subscribers
      updateCachedUserData({ profile, settings }, userId);
      updateFetchTimestamp();

      return { profile, settings };
    } catch (error) {
      console.error('[BatchFetch] Error fetching user data:', error);
      return { profile: null, settings: null };
    }
  })();

  // Clear in-flight promise after completion
  fetchInFlightPromise.finally(() => {
    fetchInFlightPromise = null;
    fetchInFlightForUserId = null;
  });

  return fetchInFlightPromise;
}

/**
 * Get or fetch user data with cache
 * 
 * - Returns cached data if available and fresh (< 30s)
 * - Fetches from API if cache is stale or empty
 * - Called at app initialization or when user changes
 * 
 * @param userId - Authenticated user ID
 * @returns Profile and settings data
 */
export async function getOrFetchUserData(
  userId: string,
): Promise<BatchUserData> {
  // Check if cache is valid and has data
  if (isCacheValid()) {
    const cachedData = getCachedUserData();
    if (cachedData.profile || cachedData.settings) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[BatchFetch] Using cached data');
      }
      return { profile: cachedData.profile, settings: cachedData.settings };
    }
  }

  // Cache miss or stale - fetch from API
  return fetchUserDataBatch(userId);
}

/**
 * Subscribe to realtime profile updates
 * 
 * Listens to changes in profiles and notification_settings tables
 * Updates cache when other tabs or sessions modify data
 * 
 * @param userId - Authenticated user ID
 * @returns Unsubscribe function
 */
export function subscribeToProfileUpdates(userId: string): () => void {
  const supabase = createClient();

  // Subscribe to profile changes
  const profileSubscription = supabase
    .channel(`public.profiles:id=eq.${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*', // All events (INSERT, UPDATE, DELETE)
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${userId}`,
      },
      (payload) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('[Realtime] Profile updated:', payload.eventType);
        }
        updateCachedUserData({ profile: payload.new as UserProfile }, userId);
      },
    )
    .subscribe();

  // Subscribe to settings changes
  const settingsSubscription = supabase
    .channel(`public.notification_settings:user_id=eq.${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notification_settings',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('[Realtime] Settings updated:', payload.eventType);
        }
        updateCachedUserData(
          { settings: payload.new as NotificationSettings },
          userId,
        );
      },
    )
    .subscribe();

  // Return unsubscribe function
  return () => {
    supabase.removeChannel(profileSubscription);
    supabase.removeChannel(settingsSubscription);
  };
}
