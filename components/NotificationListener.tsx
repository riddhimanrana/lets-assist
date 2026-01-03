"use client";

import { useEffect, useRef } from "react";

import { createClient } from "@/utils/supabase/client";
import { toast } from "sonner";
import { RealtimeChannel } from "@supabase/supabase-js";

interface NotificationListenerProps {
  userId: string;
}

const displayedNotifications = new Set<string>();
const MAX_BATCH_SIZE = 10;
const NOTIFICATION_DELAY = 300;
const MAX_RETRIES = 3; // Maximum number of retry attempts
const MAX_BACKOFF_DELAY = 30000; // Maximum delay between retries (30 seconds)

export function NotificationListener({ userId }: NotificationListenerProps) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const initializedRef = useRef(false);
  const retryCountRef = useRef(0);
  const unmountedRef = useRef(false);

  // Modified displayNotificationToast to check if component is still mounted
  type NotificationRow = {
    id: string;
    title: string;
    body: string;
    severity?: 'info' | 'warning' | 'success';
    action_url?: string | null;
    created_at?: string;
    displayed?: boolean;
  };

  const displayNotificationToast = async (notification: NotificationRow) => {
    if (unmountedRef.current) return;
    if (displayedNotifications.has(notification.id)) return;

    console.log('Displaying notification toast:', notification.title);
    displayedNotifications.add(notification.id);

    const toastMethod = notification.severity === 'warning' 
      ? toast.warning 
      : notification.severity === 'success'
        ? toast.success
        : toast.info;

    toastMethod(notification.title, {
      description: notification.body,
      action: notification.action_url ? {
        label: "View",
        onClick: () => window.location.href = notification.action_url!
      } : undefined
    });

    const supabase = createClient();
    try {
      await supabase
        .from('notifications')
        .update({ displayed: true })
        .eq('id', notification.id);
    } catch (error: unknown) {
      console.error('Error marking notification as displayed:', error);
    }
  };

  useEffect(() => {
    if (!userId || initializedRef.current) return;
    initializedRef.current = true;
    unmountedRef.current = false;
    retryCountRef.current = 0;

    const initialize = async () => {
      if (retryCountRef.current >= MAX_RETRIES) {
        console.log('Max retry attempts reached, stopping notification service');
        return;
      }

      const supabase = createClient();

      try {
        // Removed connection test query - it's redundant since we're about to make a real query anyway
        // The actual notifications query will fail if there's a connection issue

        const { data: notifications, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', userId)
          .eq('displayed', false)
          .order('created_at', { ascending: true })
          .limit(MAX_BATCH_SIZE);

        if (error) throw error;

        if (!unmountedRef.current && notifications?.length) {
          for (let i = 0; i < notifications.length; i++) {
            if (unmountedRef.current) break;
            setTimeout(() => {
              if (!unmountedRef.current) {
                displayNotificationToast(notifications[i]);
              }
            }, i * NOTIFICATION_DELAY);
          }
        }

        const channelName = `personal-notifications:${userId}`;
        
        if (channelRef.current) {
          await supabase.removeChannel(channelRef.current);
        }

        const channel = supabase
          .channel(channelName)
          .on('postgres_changes', 
            {
              event: 'INSERT',
              schema: 'public',
              table: 'notifications',
              filter: `user_id=eq.${userId}`
            },
            (payload: { new?: unknown }) => {
              const newNotification = payload.new as NotificationRow | undefined;
              if (!unmountedRef.current && newNotification) {
                displayNotificationToast(newNotification);
              }
            }
          )
          .subscribe(status => {
            if (unmountedRef.current) return;

            if (status === 'SUBSCRIBED') {
              console.log('Successfully subscribed to notifications');
              retryCountRef.current = 0;
            }
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.log(`Subscription failed (attempt ${retryCountRef.current + 1}/${MAX_RETRIES})`);
              
              if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
              }

              if (retryCountRef.current < MAX_RETRIES && !unmountedRef.current) {
                retryCountRef.current++;
                const backoffDelay = Math.min(1000 * Math.pow(2, retryCountRef.current), MAX_BACKOFF_DELAY);
                console.log(`Retrying in ${backoffDelay}ms`);
                setTimeout(initialize, backoffDelay);
              }
            }
          });

        channelRef.current = channel;

      } catch (error: unknown) {
        console.error('Error in notification initialization:', error);
        if (!unmountedRef.current && retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current++;
          const backoffDelay = Math.min(1000 * Math.pow(2, retryCountRef.current), MAX_BACKOFF_DELAY);
          setTimeout(initialize, backoffDelay);
        }
      }
    };

    initialize();

    return () => {
      unmountedRef.current = true;
      const supabase = createClient();
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId]);

  return null;
}
