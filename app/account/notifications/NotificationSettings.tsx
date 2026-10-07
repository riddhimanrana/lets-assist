"use client";

import { Fragment, useEffect, useState } from "react";
import { BellOff } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";

import {
  notificationPreferencesChanged,
  readNotificationPreferences,
  type NotificationPreferences,
} from "./preferences";

type PreferenceKey = keyof NotificationPreferences;

// Feedback requests is the only type the saved data ties to the email switch,
// so it is the only row that locks when email updates are off.
const UPDATE_TYPES: Array<{
  key: Exclude<PreferenceKey, "email_notifications">;
  id: string;
  title: string;
  description: string;
  needsEmail?: boolean;
}> = [
  {
    key: "project_updates",
    id: "project-updates",
    title: "Project updates",
    description: "Changes to your volunteer projects.",
  },
  {
    key: "organization_updates",
    id: "organization-updates",
    title: "Organization updates",
    description:
      "Posts, activities, and record updates from your organizations.",
  },
  {
    key: "feedback_requests",
    id: "feedback-requests",
    title: "Feedback requests",
    description:
      "An optional survey about using Let's Assist after you volunteer.",
    needsEmail: true,
  },
  {
    key: "general",
    id: "general",
    title: "General",
    description: "Other platform updates.",
  },
];

function PreferenceRow({
  id,
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Item className="flex-nowrap">
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none">
          <Label htmlFor={id}>{title}</Label>
        </ItemTitle>
        <ItemDescription id={`${id}-description`} className="line-clamp-none">
          {description}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-describedby={`${id}-description`}
        />
      </ItemActions>
    </Item>
  );
}

export function NotificationSettings() {
  const { user } = useAuth(); // Use cached auth instead of getUser() calls
  const [settings, setSettings] = useState<NotificationPreferences | null>(
    null,
  );
  const [originalSettings, setOriginalSettings] =
    useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Bumped by "Try again" to re-run the load below.
  const [loadAttempt, setLoadAttempt] = useState(0);
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
  }, [user?.id, loadAttempt]); // Re-run when user changes or on retry

  const retryLoad = () => {
    setLoading(true);
    setLoadAttempt((attempt) => attempt + 1);
  };

  const handleChange = (field: PreferenceKey, value: boolean) => {
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
    <>
      <PageHeader
        title="Notifications"
        description="Choose which updates you receive."
      />

      {loading ? (
        <SettingsSection
          title="Email"
          description="Required account emails always arrive."
        >
          <div className="grid gap-4" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </SettingsSection>
      ) : !settings ? (
        <SettingsSection
          title="Email"
          description="Required account emails always arrive."
        >
          <Empty className="p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellOff aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Could not load your settings</EmptyTitle>
              <EmptyDescription>
                Your preferences are unchanged. Check your connection and try
                again.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={retryLoad}>
                Try again
              </Button>
            </EmptyContent>
          </Empty>
        </SettingsSection>
      ) : (
        <SettingsSection
          title="Email"
          description="Required account emails always arrive."
          contentClassName="gap-0 px-0"
          footerHint={hasChanges ? "Unsaved changes" : "No changes to save"}
          footer={
            <Button
              onClick={saveSettings}
              disabled={saving || !hasChanges}
              className="w-full sm:w-auto"
            >
              {saving ? "Saving..." : "Save changes"}
            </Button>
          }
        >
          <PreferenceRow
            id="email-notifications"
            title="Email updates"
            description="Receive email for the update types enabled below."
            checked={settings.email_notifications}
            onCheckedChange={(checked) =>
              handleChange("email_notifications", checked)
            }
          />
          <ItemSeparator className="my-0" />
          <h2 className="px-4 pt-4 text-sm font-medium">Update types</h2>
          <ItemGroup className="gap-0">
            {UPDATE_TYPES.map((type, index) => {
              const locked =
                Boolean(type.needsEmail) && !settings.email_notifications;
              return (
                <Fragment key={type.key}>
                  {index > 0 ? <ItemSeparator className="my-0" /> : null}
                  <PreferenceRow
                    id={type.id}
                    title={type.title}
                    description={
                      locked
                        ? `${type.description} Turn on email updates to change this.`
                        : type.description
                    }
                    checked={settings[type.key]}
                    disabled={locked}
                    onCheckedChange={(checked) =>
                      handleChange(type.key, checked)
                    }
                  />
                </Fragment>
              );
            })}
          </ItemGroup>
        </SettingsSection>
      )}
    </>
  );
}
