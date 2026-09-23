"use client";

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

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { createAuthStateLifecycle } from "./auth-state-lifecycle";

export interface UserProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  username: string | null;
  phone: string | null;
  profile_visibility: "public" | "private" | "organization_only" | null;
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
  const channelNameRef = useRef(
    `profile-updates-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`,
  );
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const loaderRef = useRef<{ refresh: () => Promise<void> | undefined } | null>(
    null,
  );

  useEffect(() => {
    if (!user?.id) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase.channel(`${channelNameRef.current}-${user.id}`);
    let active = true;

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "profiles",
        filter: `id=eq.${user.id}`,
      },
      (payload) => {
        if (!active) return;
        const row = payload.eventType === "DELETE" ? payload.old : payload.new;
        if (!row || !("id" in row) || row.id !== user.id) return;
        setProfile(
          payload.eventType === "DELETE" ? null : (row as UserProfile),
        );
      },
    );

    // Settings are read through RLS and refetch; they are not published to Realtime.

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      active = false;
      if (channelRef.current === channel) {
        supabase.removeChannel(channel);
        channelRef.current = null;
      }
    };
  }, [user?.id, supabase]);

  useEffect(() => {
    if (authLoading) return;
    const lifecycle = createAuthStateLifecycle({
      resolve: async () => {
        if (!user?.id) return { profile: null, settings: null };
        const [profileResult, settingsResult] = await Promise.all([
          supabase
            .from("profiles")
            .select(
              "id, full_name, avatar_url, username, phone, profile_visibility, created_at, updated_at, volunteer_goals",
            )
            .eq("id", user.id)
            .maybeSingle(),
          supabase
            .from("notification_settings")
            .select("user_id, email_notifications, project_updates, general")
            .eq("user_id", user.id)
            .maybeSingle(),
        ]);
        if (profileResult.error) throw profileResult.error;
        if (settingsResult.error) throw settingsResult.error;
        return {
          profile: profileResult.data as UserProfile | null,
          settings: settingsResult.data as NotificationSettings | null,
        };
      },
      onStart: () => setLoading(true),
      onResolved: (data) => {
        setProfile(data.profile);
        setSettings(data.settings);
        setError(null);
      },
      onSignedOut: () => {
        setProfile(null);
        setSettings(null);
        setError(null);
      },
      onError: (err) => {
        console.error("[useUserProfile] Fetch error:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
      },
      onSettled: () => setLoading(false),
    });
    loaderRef.current = lifecycle;
    if (user?.id) void lifecycle.refresh();
    else lifecycle.signedOut();
    return () => {
      lifecycle.dispose();
      if (loaderRef.current === lifecycle) loaderRef.current = null;
    };
  }, [user?.id, authLoading, supabase]);

  const refetch = useCallback(async () => {
    await loaderRef.current?.refresh();
  }, []);

  return {
    profile: profile?.id === user?.id ? profile : null,
    settings: settings?.user_id === user?.id ? settings : null,
    loading: authLoading || loading,
    error,
    refetch,
  };
}
