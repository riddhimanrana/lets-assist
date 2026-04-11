'use client';

/**
 * Hook: useUserProfile
 * 
 * Provides user profile and settings to components using direct Supabase queries.
 * Uses getClaims() for fast local JWT verification.
 * 
 * Usage:
 * ```typescript
 * const { profile, settings, loading } = useUserProfile();
 * ```
 */

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface UserProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  username: string | null;
  phone: string | null;
  profile_visibility: 'public' | 'private' | 'organization_only' | null;
  created_at: string;
  updated_at: string | null;
  volunteer_goals: Record<string, unknown> | null;
}

export interface NotificationSettings {
  user_id: string;
  email_notifications: boolean;
  project_updates: boolean;
  general: boolean;
}

export interface UseUserProfileReturn {
  profile: UserProfile | null;
  settings: NotificationSettings | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to access user profile and notification settings
 * Fetches directly from Supabase with RLS protection
 */
export function useUserProfile(): UseUserProfileReturn {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const channelNameRef = useRef(`profile-updates-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase.channel(`${channelNameRef.current}-${user.id}`);

    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${user.id}`,
      },
      (payload) => {
        if (payload.new) {
          setProfile(payload.new as UserProfile);
        } else if (payload.old) {
          setProfile(payload.old as UserProfile);
        }
      }
    );

    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notification_settings',
        filter: `user_id=eq.${user.id}`,
      },
      (payload) => {
        if (payload.new) {
          setSettings(payload.new as NotificationSettings);
        } else if (payload.old) {
          setSettings(payload.old as NotificationSettings);
        }
      }
    );

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      if (channelRef.current === channel) {
        supabase.removeChannel(channel);
        channelRef.current = null;
      }
    };
  }, [user?.id, supabase]);

  const fetchData = useCallback(async (userId: string) => {
    setLoading(true);
    try {
      // Fetch profile and settings in parallel
      const [profileResult, settingsResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, avatar_url, username, phone, profile_visibility, created_at, updated_at, volunteer_goals')
          .eq('id', userId)
          .maybeSingle(),
        supabase
          .from('notification_settings')
          .select('user_id, email_notifications, project_updates, general')
          .eq('user_id', userId)
          .maybeSingle(),
      ]);

      if (profileResult.error) {
        console.error('[useUserProfile] Profile error:', profileResult.error.message);
      }
      if (settingsResult.error) {
        console.error('[useUserProfile] Settings error:', settingsResult.error.message);
      }

      setProfile(profileResult.data as UserProfile | null);
      setSettings(settingsResult.data as NotificationSettings | null);
      setError(null);
    } catch (err) {
      console.error('[useUserProfile] Fetch error:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (authLoading) return;

    if (!user?.id) {
      setProfile(null);
      setSettings(null);
      setLoading(false);
      return;
    }

    fetchData(user.id);
  }, [user?.id, authLoading, fetchData]);

  const refetch = useCallback(async () => {
    if (user?.id) {
      setLoading(true);
      await fetchData(user.id);
    }
  }, [user?.id, fetchData]);

  return {
    profile,
    settings,
    loading: authLoading || loading,
    error,
    refetch,
  };
}
