import { createClient } from "@/utils/supabase/client";
import { toast } from "sonner";

export type NotificationType = 'email_notifications' | 'project_updates' | 'general'

export type NotificationSeverity = 'info' | 'warning' | 'success';

export interface NotificationData {
  title: string;
  body: string;
  type: NotificationType;
  severity?: NotificationSeverity;
  actionUrl?: string;
  data?: Record<string, any>;
}

export const NotificationService = {
  async createNotification(notification: NotificationData, userId: string, showToast = false) {
    const supabase = createClient();
    
    try {
      // Set default severity if not provided
      const notificationWithSeverity = {
        ...notification,
        severity: notification.severity || 'info'
      };
      
      // Insert notification
      const { data, error } = await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          title: notificationWithSeverity.title,
          body: notificationWithSeverity.body,
          type: notificationWithSeverity.type,
          severity: notificationWithSeverity.severity,
          action_url: notificationWithSeverity.actionUrl,
          data: notificationWithSeverity.data,
          displayed: false
        })
        .select('id')
        .single();
        
      if (error) {
        console.error('Error creating notification:', error);
        return { error };
      }

      return { success: true, data };
    } catch (error) {
      console.error('Error in createNotification:', error);
      return { error };
    }
  },

  async markAsDisplayed(userId: string, type: NotificationType) {
    const supabase = createClient();
    
    try {
      await supabase
        .from('notifications')
        .update({ displayed: true })
        .eq('user_id', userId)
        .eq('type', type);
        
      console.log(`Marked ${type} notification as displayed for user ${userId}`);
    } catch (error) {
      console.error('Error marking notification as displayed:', error);
    }
  },

  async checkUsernameSetting(userId: string) {
    const supabase = createClient();
    
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', userId)
        .single();
        
      if (error) {
        console.error('Error fetching profile:', error);
        return;
      }
      
      if (!profile?.username || profile.username.startsWith('user_')) {
        await this.createNotification({
          title: 'Set Your Custom Username',
          body: 'Personalize your profile by setting a custom username in your account settings.',
          type: 'general',
          severity: 'info',
          actionUrl: '/account/profile'
        }, userId);
      }
    } catch (error) {
      console.error('Error checking username setting:', error);
    }
  }
};
