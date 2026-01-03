'use client';

/**
 * Hook: useUserProfile
 * 
 * Provides cached user profile and settings to components
 * 
 * Features:
 * - Returns data from memory cache (instant, no API call)
 * - Subscribes to realtime updates (profile changes in DB)
 * - Handles loading and error states
 * - Used by: Navbar, ProjectDetails, Dashboard, etc.
 * 
 * Usage:
 * ```typescript
 * const { profile, settings, isLoading } = useUserProfile();
 * ```
 */

import { useEffect, useState, useRef } from 'react';
import {
  getCachedUserData,
  subscribeToProfileCache,
  shouldFetchProfileData,
  type CachedUserData,
} from '@/utils/auth/profile-cache';
import { getOrFetchUserData } from '@/utils/auth/batch-fetcher';
import { useAuth } from '@/hooks/useAuth';

export interface UseUserProfileReturn {
  profile: CachedUserData['profile'];
  settings: CachedUserData['settings'];
  isLoading: boolean;
  isError: boolean;
  timestamp: number;
  refetch?: () => Promise<void>;
}

/**
 * Hook to access cached user profile and settings
 * 
 * Automatically fetches on first call if cache is empty
 * Updates when realtime events fire
 * 
 * @returns Profile data, settings, and loading state
 */
export function useUserProfile(): UseUserProfileReturn {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [isLoading, setIsLoading] = useState(isAuthLoading);
  const [isError] = useState(false);
  const [cacheData, setCacheData] = useState<CachedUserData>(() =>
    getCachedUserData(),
  );
  
  // Guard against duplicate concurrent fetches
  const fetchInProgressRef = useRef(false);
  // Track the user ID we're fetching for to avoid stale fetches
  const fetchingForUserIdRef = useRef<string | null>(null);

  // Combined effect: Subscribe to cache changes AND fetch if needed
  // This ensures subscription is set up BEFORE we fetch, avoiding race conditions
  useEffect(() => {
    if (!user?.id) {
      setCacheData({
        profile: null,
        settings: null,
        timestamp: 0,
        userId: null,
      });
      setIsLoading(false);
      return;
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[useUserProfile] Setting up for user:', user.id);
    }

    // Step 1: Set up subscription FIRST (before fetching)
    const unsubscribe = subscribeToProfileCache((data) => {
      setCacheData(data);
      setIsLoading(false);

      if (process.env.NODE_ENV === 'development') {
        console.log('[useUserProfile] Cache updated via subscription');
      }
    });
    
    // Step 2: Check if we need to fetch
    // Re-read cache in case it was updated between render and effect
    const currentCache = getCachedUserData();
    const hasCachedData = currentCache.profile || currentCache.settings;
    const cacheIsFresh = !shouldFetchProfileData();
    
    // Always sync state with current cache first
    // This ensures we pick up any data that was fetched by AuthProvider
    if (hasCachedData) {
      setCacheData(currentCache);
      setIsLoading(false);
      if (process.env.NODE_ENV === 'development') {
        console.log('[useUserProfile] Synced with existing cache');
      }
    }
    
    // Only fetch if cache is empty or stale
    if (!hasCachedData || !cacheIsFresh) {
      // Need to fetch - guard against duplicates
      if (!fetchInProgressRef.current || fetchingForUserIdRef.current !== user.id) {
        fetchInProgressRef.current = true;
        fetchingForUserIdRef.current = user.id;
        if (!hasCachedData) {
          setIsLoading(true);
        }
        
        getOrFetchUserData(user.id)
          .then((data) => {
            // Manually update state with fetched data
            // This handles the case where cache was already populated
            // (by AuthProvider) and getOrFetchUserData returns cached data
            // without triggering a cache update notification
            if (data.profile || data.settings) {
              setCacheData({
                profile: data.profile,
                settings: data.settings,
                timestamp: Date.now(),
                userId: user.id,
              });
              setIsLoading(false);
            }
            if (process.env.NODE_ENV === 'development') {
              console.log('[useUserProfile] Fetch complete:', { 
                hasProfile: !!data.profile,
                hasSettings: !!data.settings 
              });
            }
          })
          .finally(() => {
            if (fetchingForUserIdRef.current === user.id) {
              fetchInProgressRef.current = false;
            }
          });
      }
    }

    return () => {
      unsubscribe();
    };
  }, [user?.id]);

  // Update loading state based on cache freshness
  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    if (cacheData.profile || cacheData.settings) {
      setIsLoading(false);
      return;
    }

    if (cacheData.timestamp === 0) {
      setIsLoading(true);
      return;
    }

    // Cache was populated but still no profile/settings (e.g. user not found)
    setIsLoading(false);
  }, [cacheData, user?.id]);

  return {
    profile: cacheData.profile,
    settings: cacheData.settings,
    isLoading,
    isError,
    timestamp: cacheData.timestamp,
  };
}
