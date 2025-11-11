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
  type CachedUserData,
} from '@/utils/auth/profile-cache';
import { subscribeToProfileUpdates } from '@/utils/auth/batch-fetcher';
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

  // Update loading state based on cache freshness
  useEffect(() => {
    if (!cacheData.profile && !cacheData.settings && user?.id) {
      setIsLoading(true);
    } else if (cacheData.profile || cacheData.settings) {
      setIsLoading(false);
    }
  }, [cacheData, user?.id]);

  return {
    profile: cacheData.profile,
    settings: cacheData.settings,
    isLoading,
    isError,
    timestamp: cacheData.timestamp,
  };
}
