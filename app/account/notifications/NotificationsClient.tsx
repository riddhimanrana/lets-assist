"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";

import { useAuth } from "@/hooks/useAuth";

type NotificationSettings = {
  email_notifications: boolean;
  project_updates: boolean;
  general: boolean;
};

type Notification = {
  id: string;
  title: string;
  body: string;
  type: string;
  severity: 'info' | 'warning' | 'success';
  read: boolean;
  created_at: string;
  action_url?: string;
};

export function NotificationsClient() {
  const { user } = useAuth(); // Use cached auth instead of getUser() calls
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [originalSettings, setOriginalSettings] = useState<NotificationSettings | null>(null);
  const [, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setNotificationsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    // Skip if user is not available yet
    if (!user?.id) return;

    // Capture user id in closure to satisfy TypeScript
    const userId = user.id;

    async function loadSettings() {
      try {
        const { data, error } = await supabase
          .from("notification_settings")
          .select("*")
          .eq("user_id", userId);

        if (error) {
          console.error("Error loading notification settings:", error);
          return;
        }

        setSettings(data[0]);
        setOriginalSettings(data[0]);
      } catch (error) {
        console.error("Failed to load notification settings", error);
      } finally {
        setLoading(false);
      }
    }

    async function loadNotifications() {
      try {
        setNotificationsLoading(true);
        const { data, error } = await supabase
          .from("notifications")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(10);
        
        if (error) {
          console.error("Error loading notifications:", error);
          return;
        }
        
        setNotifications(data || []);
      } catch (error) {
        console.error("Error loading notifications:", error);
      } finally {
        setNotificationsLoading(false);
      }
    }

    loadSettings();
    loadNotifications();
  }, [user?.id]); // Re-run when user changes

  const handleChange = (field: keyof NotificationSettings, value: boolean) => {
    if (!settings) return;
    setSettings({ ...settings, [field]: value });
  };

  const saveSettings = async () => {
    if (!settings || !user?.id) return;
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from("notification_settings")
        .update(settings)
        .eq("user_id", user.id);

      if (error) {
        toast.error("Failed to save notification settings");
        console.error("Error saving settings:", error);
        return;
      }
      
      toast.success("Notification settings saved successfully");
      setOriginalSettings(settings);
    } catch (error) {
      toast.error("Failed to save notification settings");
      console.error("Failed to save settings", error);
    } finally {
      setSaving(false);
    }
  };

  // Check if settings have changed compared to the original
  const hasChanges =
    originalSettings &&
    settings &&
    (settings.email_notifications !== originalSettings.email_notifications ||
      settings.project_updates !== originalSettings.project_updates);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 sm:p-6"
    >
      <div className="max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Notifications
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your notification preferences and control how you receive alerts
          </p>
        </div>

        <Card className="border shadow-sm">
          <CardHeader className="px-5 py-5 sm:px-6">
            <CardTitle className="text-xl">Notification Preferences</CardTitle>
            <CardDescription>
              Choose which notifications you&apos;d like to receive
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 sm:px-6 py-4">
            {loading ? (
              <div className="space-y-6">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-32 mt-4" />
              </div>
            ) : !settings ? (
              <div className="text-center py-6 text-muted-foreground">
                Error loading notification settings. Please try again later.
              </div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-5">
                  <div className="flex items-center justify-between border p-4 rounded-md">
                    <div className="space-y-0.5">
                      <Label htmlFor="email-notifications" className="text-base">
                        Email Notifications
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Receive notifications via email when important updates occur
                      </p>
                    </div>
                    <Switch
                      id="email-notifications"
                      checked={settings.email_notifications}
                      onCheckedChange={(checked) => handleChange("email_notifications", checked)}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between border p-4 rounded-md">
                    <div className="space-y-0.5">
                      <Label htmlFor="project-updates" className="text-base">
                        Project Updates
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Receive helpful notifications about project updates and changes (may also send over email)
                      </p>
                    </div>
                    <Switch
                      id="project-updates"
                      checked={settings.project_updates}
                      onCheckedChange={(checked) => handleChange("project_updates", checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between border p-4 rounded-md">
                    <div className="space-y-0.5">
                      <Label htmlFor="general" className="text-base">
                        General
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        General system notifications about login items and other such stuff.
                      </p>
                    </div>
                    <Switch
                      id="general"
                      checked={settings.general}
                      onCheckedChange={(checked) => handleChange("general", checked)}
                    />
                  </div>
                </div>
                
                <div className="pt-2">
                  <Button 
                    onClick={saveSettings} 
                    disabled={saving || !hasChanges}
                    className="w-full sm:w-auto"
                  >
                    {saving ? "Saving Changes..." : "Save Changes"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
