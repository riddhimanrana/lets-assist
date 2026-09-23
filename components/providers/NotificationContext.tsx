"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { createNotificationRefreshScheduler } from "./notification-refresh";

// Types
type NotificationSeverity = "info" | "warning" | "success";

export type NotificationRecord = {
  id: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  read: boolean;
  created_at: string;
  action_url?: string | null;
  data?: Record<string, unknown> | null;
  displayed?: boolean; // For tracking toasts
};

interface NotificationContextType {
  unreadCount: number;
  setUnreadCount: React.Dispatch<React.SetStateAction<number>>; // Allow manual updates (e.g. optimistic read)
  refreshTrigger: number; // Increment to signal list refresh
  refresh: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined,
);

export function useNotification() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error(
      "useNotification must be used within a NotificationProvider",
    );
  }
  return context;
}

// Displayed set to prevent duplicate toasts
const displayedNotifications = new Set<string>();

export function NotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Stable singleton client
  const [supabase] = useState(() => createClient());

  const channelRef = useRef<RealtimeChannel | null>(null);
  const mountedRef = useRef(false);

  // Manual refresh trigger
  const refresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  // Display Toast Logic (Moved from NotificationListener)
  const displayNotificationToast = useCallback(
    async (notification: NotificationRecord) => {
      // Remove strict deduplication or make it time-based if needed.
      // For now, we trust the realtime event is unique per insert.
      if (displayedNotifications.has(notification.id)) {
        console.log(
          "[NotificationContext] Notification already displayed:",
          notification.id,
        );
        return;
      }

      console.log(
        "[NotificationContext] Displaying toast:",
        notification.title,
        notification,
      );
      displayedNotifications.add(notification.id);

      const toastMethod =
        notification.severity === "warning"
          ? toast.warning
          : notification.severity === "success"
            ? toast.success
            : toast.info;

      const actionUrl = notification.action_url;
      const action = actionUrl
        ? {
            label: "View",
            onClick: () => {
              // Clean navigation
              window.location.href = actionUrl;
            },
          }
        : undefined;

      toastMethod(notification.title, {
        description: notification.body,
        action,
        duration: 5000,
      });

      // Mark as displayed in DB so we don't show it again on reload (if persisted)
      // This is done in the background
      try {
        await supabase
          .from("notifications")
          .update({ displayed: true })
          .eq("id", notification.id);
      } catch (error) {
        console.error("Error marking notification as displayed:", error);
      }
    },
    [supabase],
  );

  // Initial Fetch of Unread Count
  useEffect(() => {
    if (!user?.id) {
      setUnreadCount(0);
      return;
    }

    const fetchUnreadCount = async () => {
      try {
        const { count, error } = await supabase
          .from("notifications")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("read", false);

        if (error) throw error;
        setUnreadCount(count ?? 0);
      } catch (error) {
        console.error("Error fetching unread count:", error);
      }
    };

    fetchUnreadCount();
  }, [user?.id, supabase]);

  // Realtime Subscription
  useEffect(() => {
    mountedRef.current = true;
    if (!user?.id) {
      // Cleanup if user logs out
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    // Prevents duplicate subscriptions if already connected to this user's channel
    // However, if user changes, we need to resubscribe.
    // The channel name includes user ID, so it's unique per user.
    const channelName = `global-notifications:${user.id}`;

    // If we already have a channel for this user, do nothing (stability check)
    // Note: channelRef.current.topic would be `realtime:${channelName}` usually
    if (channelRef.current) {
      // Check if it's the same topic
      // If logic needed to verify active, we could check state.
      // For now, simpler to cleanup old and start new if userId changed or strict mode re-run.
      supabase.removeChannel(channelRef.current);
    }

    console.log("[NotificationContext] Subscribing to channel:", channelName);

    let cancelled = false;
    const refreshScheduler = createNotificationRefreshScheduler(async () => {
      refresh();
      try {
        const { count, error } = await supabase
          .from("notifications")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("read", false);
        if (cancelled) return;
        if (error) throw error;
        if (count !== null) setUnreadCount(count);
      } catch (error) {
        if (!cancelled) console.error("Error refreshing notifications:", error);
      }
    });

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`, // RLS Filter
        },
        async (payload: { new: NotificationRecord }) => {
          if (cancelled || !mountedRef.current) return;
          console.log("[NotificationContext] INSERT received");

          // 1. Increment Unread Count
          setUnreadCount((prev) => prev + 1);

          // Realtime sends one event per row, including bulk updates.
          refreshScheduler.schedule();

          // 3. Show Toast
          const newNotification = payload.new as NotificationRecord;
          if (newNotification) {
            await displayNotificationToast(newNotification);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          if (cancelled || !mountedRef.current) return;
          console.log("[NotificationContext] UPDATE received");
          refreshScheduler.schedule();
        },
      )
      .subscribe((status: string, err?: Error) => {
        if (status === "CHANNEL_ERROR") {
          if (process.env.NODE_ENV !== "development") {
            if (err) {
              console.error("[NotificationContext] Subscription Error:", err);
            } else {
              console.warn(
                "[NotificationContext] Subscription Error: Unknown error",
              );
            }
          }
          // Optional: Retry logic?
        } else {
          console.log(`[NotificationContext] Status: ${status}`);
        }
      });

    channelRef.current = channel;

    return () => {
      cancelled = true;
      refreshScheduler.dispose();
      mountedRef.current = false;
      if (channelRef.current) {
        console.log("[NotificationContext] Cleaning up channel");
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, supabase, refresh, displayNotificationToast]);

  return (
    <NotificationContext.Provider
      value={{ unreadCount, setUnreadCount, refreshTrigger, refresh }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
