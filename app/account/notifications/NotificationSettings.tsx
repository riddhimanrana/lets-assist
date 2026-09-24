"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { motion } from "motion/react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";

import {
  notificationPreferencesChanged,
  readNotificationPreferences,
  type NotificationPreferences,
} from "./preferences";

export function NotificationSettings() {
  const { user } = useAuth(); // Use cached auth instead of getUser() calls
  const [settings, setSettings] = useState<NotificationPreferences | null>(
    null,
  );
  const [originalSettings, setOriginalSettings] =
    useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    // Skip if user is not available yet
    if (!user?.id) return;

    // Capture user id in closure to satisfy TypeScript
    const userId = user.id;

    async function loadSettings() {
      try {
        const { data, error } = (await supabase
          .from("notification_settings")
          .select("*")
          .eq("user_id", userId)) as {
          data: Record<string, unknown>[] | null;
          error: { message?: string } | null;
        };

        if (error) {
          console.error("Error loading notification settings:", error);
          return;
        }

        const firstSetting = readNotificationPreferences(data?.[0] ?? {});
        setSettings(firstSetting);
        setOriginalSettings(firstSetting);
      } catch (error) {
        console.error("Failed to load notification settings", error);
      } finally {
        setLoading(false);
      }
    }

    loadSettings();
  }, [user?.id]); // Re-run when user changes

  const handleChange = (
    field: keyof NotificationPreferences,
    value: boolean,
  ) => {
    if (!settings) return;
    setSettings({ ...settings, [field]: value });
  };

  const saveSettings = async () => {
    if (!settings || !user?.id) return;

    setSaving(true);
    try {
      const { error } = (await supabase
        .from("notification_settings")
        .upsert({ user_id: user.id, ...settings }, { onConflict: "user_id" })
        .select("user_id")
        .single()) as { error: { message?: string } | null };

      if (error) {
        toast.error("Failed to save notification settings");
        console.error("Error saving settings:", error);
        return;
      }

      toast.success("Notification settings saved");
      setOriginalSettings(settings);
    } catch (error) {
      toast.error("Failed to save notification settings");
      console.error("Failed to save settings", error);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = notificationPreferencesChanged(originalSettings, settings);

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
            Choose which updates you receive.
          </p>
        </div>

        <Card className="border shadow-xs">
          <CardHeader>
            <CardTitle className="text-xl">Notification preferences</CardTitle>
            <CardDescription>
              Email settings apply to optional updates. Required account emails
              still arrive.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                  <div className="flex items-center justify-between gap-4 border p-4 rounded-md">
                    <div className="space-y-0.5">
                      <Label htmlFor="feedback-requests" className="text-base">
                        Feedback requests
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        An optional survey about using Let&apos;s Assist after
                        you volunteer.
                      </p>
                    </div>
                    <Switch
                      id="feedback-requests"
                      checked={settings.feedback_requests}
                      disabled={!settings.email_notifications}
                      onCheckedChange={(value) =>
                        handleChange("feedback_requests", value)
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between border p-4 rounded-md">
                    <div className="space-y-0.5">
                      <Label
                        htmlFor="email-notifications"
                        className="text-base"
                      >
                        Email updates
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Receive email for the update types enabled below.
                      </p>
                    </div>
                    <Switch
                      id="email-notifications"
                      checked={settings.email_notifications}
                      onCheckedChange={(checked) =>
                        handleChange("email_notifications", checked)
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between border p-4 rounded-md">
                    <div className="space-y-0.5">
                      <Label htmlFor="project-updates" className="text-base">
                        Project updates
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Changes to your volunteer projects.
                      </p>
                    </div>
                    <Switch
                      id="project-updates"
                      checked={settings.project_updates}
                      onCheckedChange={(checked) =>
                        handleChange("project_updates", checked)
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between border p-4 rounded-md">
                    <div className="space-y-0.5">
                      <Label
                        htmlFor="organization-updates"
                        className="text-base"
                      >
                        Organization updates
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Posts, activities, and record updates from your
                        organizations.
                      </p>
                    </div>
                    <Switch
                      id="organization-updates"
                      checked={settings.organization_updates}
                      onCheckedChange={(checked) =>
                        handleChange("organization_updates", checked)
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between border p-4 rounded-md">
                    <div className="space-y-0.5">
                      <Label htmlFor="general" className="text-base">
                        General
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Other platform updates.
                      </p>
                    </div>
                    <Switch
                      id="general"
                      checked={settings.general}
                      onCheckedChange={(checked) =>
                        handleChange("general", checked)
                      }
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <Button
                    onClick={saveSettings}
                    disabled={saving || !hasChanges}
                    className="w-full sm:w-auto"
                  >
                    {saving ? "Saving..." : "Save changes"}
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
