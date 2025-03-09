"use client";

import { useEffect, useState } from "react";
import { NotificationService } from "@/services/notifications";
import { createClient } from "@/utils/supabase/client";
import { toast } from "sonner";

interface NotificationListenerProps {
  userId: string;
}

export function NotificationListener({ userId }: NotificationListenerProps) {
  const [initialized, setInitialized] = useState(false);
  
  useEffect(() => {
    if (!userId || initialized) return;
    
    const supabase = createClient();
    
    // Check for un-displayed notifications first
    const checkExistingNotifications = async () => {
      try {
        const { data: notifications, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', userId)
          .eq('displayed', false);
          
        if (error) {
          console.error('Error checking existing notifications:', error);
          return;
        }
        
        if (notifications?.length) {
          for (const notification of notifications) {
            // Choose toast type based on severity
            const toastMethod = notification.severity === 'warning' 
              ? toast.warning 
              : notification.severity === 'success'
                ? toast.success
                : toast.info;
                
            // Show toast for un-displayed notifications
            toastMethod(notification.title, {
              description: notification.body,
              action: notification.action_url ? {
                label: "View",
                onClick: () => window.location.href = notification.action_url
              } : undefined
            });
            
            // Mark as displayed
            await supabase
              .from('notifications')
              .update({ displayed: true })
              .eq('id', notification.id);
          }
        }
      } catch (error) {
        console.error('Error processing existing notifications:', error);
      }
    };
    
    // Check username notification (this will handle checking for duplicates internally)
    const checkUsername = async () => {
      try {
        await NotificationService.checkUsernameSetting(userId);
      } catch (error) {
        console.error("Username check error:", error);
      }
    };
    
    // Setup realtime subscription for new notifications
    const setupNotificationListener = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || user.id !== userId) return null;
        
        const channel = supabase
          .channel('notification-listener')
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'notifications',
              filter: `user_id=eq.${userId}`
            },
            async (payload) => {
              const notification = payload.new as any;
              
              if (notification && !notification.displayed) {
                // Choose toast type based on severity
                const toastMethod = notification.severity === 'warning' 
                  ? toast.warning 
                  : notification.severity === 'success'
                    ? toast.success
                    : toast.info;
                
                // Show toast for new notification
                toastMethod(notification.title, {
                  description: notification.body,
                  action: notification.action_url ? {
                    label: "View",
                    onClick: () => window.location.href = notification.action_url
                  } : undefined
                });
                
                // Mark as displayed
                await supabase
                  .from('notifications')
                  .update({ displayed: true })
                  .eq('id', notification.id);
              }
            }
          )
          .subscribe();
        
        return channel;
      } catch (error) {
        console.error('Error setting up notification listener:', error);
        return null;
      }
    };
    
    // Initialize notification system
    const init = async () => {
      await checkExistingNotifications();
      await checkUsername();
      const channel = await setupNotificationListener();
      
      return () => {
        if (channel) supabase.removeChannel(channel);
      };
    };
    
    // Run initialization
    const cleanup = init();
    setInitialized(true);
    
    // Cleanup function
    return () => {
      cleanup.then(cleanupFn => cleanupFn && cleanupFn());
    };
  }, [userId, initialized]);

  return null;
}
