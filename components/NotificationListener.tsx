"use client";

import { useEffect, useRef } from "react";
import { NotificationService } from "@/services/notifications";
import { createClient } from "@/utils/supabase/client";
import { toast } from "sonner";
import { RealtimeChannel } from "@supabase/supabase-js";

interface NotificationListenerProps {
  userId: string;
}

// Keep track of notifications we've displayed during the current session
const displayedNotifications = new Set<string>();

// Maximum number of notifications to process at once
const MAX_BATCH_SIZE = 10;
const NOTIFICATION_DELAY = 300; // ms between notifications

export function NotificationListener({ userId }: NotificationListenerProps) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const initializedRef = useRef(false);
  
  // Function to display a notification toast
  const displayNotificationToast = async (notification: any) => {
    // Don't show the same notification twice
    if (displayedNotifications.has(notification.id)) {
      console.log(`Already displayed notification ${notification.id}, skipping`);
      return;
    }
    
    console.log('Displaying notification toast:', notification.title);
    displayedNotifications.add(notification.id);
    
    // Choose toast type based on severity
    const toastMethod = notification.severity === 'warning' 
      ? toast.warning 
      : notification.severity === 'success'
        ? toast.success
        : toast.info;
        
    // Show toast
    toastMethod(notification.title, {
      description: notification.body,
      action: notification.action_url ? {
        label: "View",
        onClick: () => window.location.href = notification.action_url
      } : undefined
    });
    
    // Mark as displayed in database
    const supabase = createClient();
    try {
      await supabase
        .from('notifications')
        .update({ displayed: true })
        .eq('id', notification.id);
    } catch (error) {
      console.error('Error marking notification as displayed:', error);
    }
  };
  
  useEffect(() => {
    if (!userId || initializedRef.current) return;
    initializedRef.current = true;
    
    console.log(`Initializing NotificationListener for user ${userId}`);
    
    const initialize = async () => {
      const supabase = createClient();
      
      // First, check for any un-displayed notifications
      try {
        const { data: notifications, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', userId)
          .eq('displayed', false)
          .order('created_at', { ascending: true });
          
        if (error) {
          console.error('Error fetching notifications:', error);
        } else if (notifications?.length) {
          console.log(`Found ${notifications.length} pending notifications to display`);
          
          // Process notifications in batches with slight delays between them
          const notificationsToProcess = notifications.slice(0, MAX_BATCH_SIZE);
          console.log(`Processing ${notificationsToProcess.length} notifications (max batch size: ${MAX_BATCH_SIZE})`);
          
          for (let i = 0; i < notificationsToProcess.length; i++) {
            setTimeout(() => {
              displayNotificationToast(notificationsToProcess[i]);
            }, i * NOTIFICATION_DELAY);
          }
        } else {
          console.log('No pending notifications found');
        }
      } catch (error) {
        console.error('Error checking existing notifications:', error);
      }
      
      // Custom username check
      try {
        await NotificationService.checkUsernameSetting(userId);
      } catch (error) {
        console.error('Error in username check:', error);
      }
      
      // Set up realtime subscription with a unique channel name
      const channelName = `personal-notifications:${userId}`;
      console.log(`Creating realtime channel: ${channelName}`);
      
      // Clean up any existing channel first
      if (channelRef.current) {
        console.log(`Removing existing channel: ${channelRef.current.topic}`);
        await supabase.removeChannel(channelRef.current);
      }
      
      // Create new channel with clear status logging and error handling
      const channel = supabase
        .channel(channelName)
        .on('system', { event: '*' }, (payload: any) => {
          console.log('Supabase system event:', payload);
          if (payload.type === 'ERROR') {
            console.error('Supabase system error:', payload);
          }
        })
        .on(
          'postgres_changes',
          {
            event: 'INSERT', 
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`
          },
          async (payload) => {
            console.log('REALTIME: New notification inserted!', payload);
            if (payload.new) {
              await displayNotificationToast(payload.new);
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public', 
            table: 'notifications',
            filter: `user_id=eq.${userId}`
          }, 
          (payload) => {
            console.log('Notification updated:', payload);
          }
        )
        .subscribe(status => {
          console.log(`Channel ${channelName} status:`, status);
          
          // If the subscription failed, try again after a delay
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Using a ref to track retry attempts
          const retryCount = (channel as any)._retryCount || 0;
          (channel as any)._retryCount = retryCount + 1;
          
          console.log('Subscription failed, will retry with exponential backoff');
          const backoffDelay = Math.min(5000 * Math.pow(2, retryCount), 30000);
          console.log(`Retrying in ${backoffDelay}ms (attempt ${retryCount + 1})`);
          setTimeout(initialize, backoffDelay);
          }
        });
        
      // Store the channel reference for cleanup
      channelRef.current = channel;
    };
    
    // Start the initialization
    initialize();
    
    // Cleanup function
    return () => {
      const supabase = createClient();
      if (channelRef.current) {
        console.log('Cleaning up notification channel');
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [userId]);
  
  // Must return a React element, even if just null, to make it a valid React component
  return null;
}
