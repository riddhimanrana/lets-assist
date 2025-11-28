'use client';

/**
 * Profile & Settings Cache Layer
 * 
 * Caches lightweight user data in memory:
 * - Profile: full_name, avatar_url, username, phone
 * - Settings: notification_settings, theme preference, timezone
 * - Prevents re-fetching on every token change
 * - Provides single source of truth for user metadata
 * 
 * Used by: Navbar, ProfileClient, ProjectDetails, Dashboard
 */

import type { User } from '@supabase/supabase-js';

// Profile from profiles table
// Note: email is NOT in profiles table - get it from auth user (useAuth().user?.email)
// This interface reflects all columns that actually exist in the profiles table
export interface UserProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  username: string | null;
  phone: string | null;
  profile_visibility: 'public' | 'private' | 'organization_only' | null;
  created_at: string;
  updated_at: string | null;
  volunteer_goals: Record<string, any> | null;  // JSONB field
  // Note: columns like date_of_birth, parental_consent_required might not exist in this table
  [key: string]: any;  // Allow other columns that might be in the DB
}

// Notification settings from notification_settings table
export interface NotificationSettings {
  id: string;
  user_id: string;
  email_notifications: boolean;
  push_notifications: boolean;
  in_app_notifications: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface CachedUserData {
  profile: UserProfile | null;
  settings: NotificationSettings | null;
  timestamp: number; // When cache was populated
  userId: string | null;
}

/**
 * In-memory cache for user profile and settings
 * Persisted per session (not localStorage) for security
 */
let cachedUserData: CachedUserData = {
  profile: null,
  settings: null,
  timestamp: 0,
  userId: null,
};

/**
 * Subscribers to profile/settings changes
 * Called when cache is updated via realtime or explicit updates
 */
let profileSubscribers: Set<(data: CachedUserData) => void> = new Set();

/**
 * Track when we last fetched profile + settings
 * Used to avoid fetching again if within 30 seconds
 */
let lastFetchTimestamp = 0;
const CACHE_DURATION_MS = 30 * 1000; // 30 second cache

/**
 * Get cached user data immediately (no API call)
 */
export function getCachedUserData(): CachedUserData {
  return cachedUserData;
}

/**
 * Update cache and notify all subscribers
 */
export function updateCachedUserData(
  data: Partial<CachedUserData>,
  userId: string | null,
): void {
  cachedUserData = {
    ...cachedUserData,
    ...data,
    timestamp: Date.now(),
    userId,
  };

  if (process.env.NODE_ENV === 'development') {
    console.log('[ProfileCache] Updated:', {
      hasProfile: !!cachedUserData.profile,
      hasSettings: !!cachedUserData.settings,
      userId,
    });
  }

  // Notify all subscribers
  profileSubscribers.forEach((callback) => {
    try {
      callback(cachedUserData);
    } catch (error) {
      console.error('[ProfileCache] Subscriber error:', error);
    }
  });
}

/**
 * Subscribe to profile/settings cache changes
 * Called when cache is updated or realtime events fire
 */
export function subscribeToProfileCache(
  callback: (data: CachedUserData) => void,
): () => void {
  profileSubscribers.add(callback);

  // Return unsubscribe function
  return () => {
    profileSubscribers.delete(callback);
  };
}

/**
 * Check if cache is still valid (less than 30s old)
 */
export function isCacheValid(): boolean {
  const age = Date.now() - lastFetchTimestamp;
  return age < CACHE_DURATION_MS;
}

/**
 * Clear cache (on logout)
 */
export function clearProfileCache(): void {
  cachedUserData = {
    profile: null,
    settings: null,
    timestamp: 0,
    userId: null,
  };
  lastFetchTimestamp = 0;
  
  if (process.env.NODE_ENV === 'development') {
    console.log('[ProfileCache] Cleared');
  }
}

/**
 * Mark fetch time (after successful fetch)
 */
export function updateFetchTimestamp(): void {
  lastFetchTimestamp = Date.now();
}

/**
 * Check if we should fetch (cache expired or never fetched)
 */
export function shouldFetchProfileData(): boolean {
  const age = Date.now() - lastFetchTimestamp;
  return age >= CACHE_DURATION_MS;
}
