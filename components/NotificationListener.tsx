"use client";

import { useEffect, useRef } from "react";
import { NotificationService } from "@/services/notifications";
import { createClient } from "@/utils/supabase/client";
import { toast } from "sonner";
import { RealtimeChannel } from "@supabase/supabase-js";

interface NotificationListenerProps {
  userId: string;
}

// Keep track of notifications we've displayed globally
const displayedNotifications = new Set<string>();

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
          
          // Process notifications with slight delays between them
          for (let i = 0; i < notifications.length; i++) {
            // Use setTimeout to stagger notifications
            setTimeout(() => {
              displayNotificationToast(notifications[i]);
            }, i * 300); // 300ms between notifications
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
      const channelName = `personal-notifications-${userId}-${Date.now()}`;
      console.log(`Creating realtime channel: ${channelName}`);
      
      // Clean up any existing channel first
      if (channelRef.current) {
        console.log('Removing existing channel before creating new one');
        await supabase.removeChannel(channelRef.current);
      }
      
      // Create new channel with clear status logging
      const channel = supabase
        .channel(channelName)
        .on('system', { event: '*' }, (payload: any) => {
          console.log('Supabase system event:', payload);
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
            console.log('Subscription failed, will retry in 5 seconds');
            setTimeout(initialize, 5000);
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
