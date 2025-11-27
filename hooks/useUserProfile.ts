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

import { useEffect, useState, useCallback } from 'react';
import {
  getCachedUserData,
  subscribeToProfileCache,
  shouldFetchProfileData,
  type CachedUserData,
} from '@/utils/auth/profile-cache';
import { subscribeToProfileUpdates, getOrFetchUserData } from '@/utils/auth/batch-fetcher';
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
  const [isError, setIsError] = useState(false);
  const [cacheData, setCacheData] = useState<CachedUserData>(() =>
    getCachedUserData(),
  );

  // Subscribe to cache changes
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
      console.log('[useUserProfile] Subscribing to cache changes for:', user.id);
    }

    // Subscribe to cache updates from realtime or explicit updates
    const unsubscribe = subscribeToProfileCache((data) => {
      setCacheData(data);
      setIsLoading(false);

      if (process.env.NODE_ENV === 'development') {
        console.log('[useUserProfile] Cache updated');
      }
    });

    // Also subscribe to realtime updates
    const unsubscribeRealtime = subscribeToProfileUpdates(user.id);

    return () => {
      unsubscribe();
      unsubscribeRealtime();
    };
  }, [user?.id]);

  // Fetch profile data if cache is empty or stale
  useEffect(() => {
    if (!user?.id) {
      return;
    }

    if ((cacheData.profile || cacheData.settings) && !shouldFetchProfileData()) {
      return;
    }

    let cancelled = false;

    const loadData = async () => {
      setIsLoading(true);
      await getOrFetchUserData(user.id);
      if (!cancelled) {
        setIsLoading(false);
      }
    };

    loadData();

    return () => {
      cancelled = true;
    };
  }, [user?.id, cacheData.profile, cacheData.settings, cacheData.timestamp]);

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
