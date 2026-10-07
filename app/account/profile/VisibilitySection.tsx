"use client";
import { safeConsole } from "@/lib/safe-console";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/layout/SettingsSection";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { UserProfile } from "@/hooks/useUserProfile";
import type { ProfileVisibility } from "@/types";
import { updateProfileVisibility } from "./actions";

interface VisibilitySectionProps {
  profile: UserProfile | null;
  isProfileLoading: boolean;
  isDataLoading: boolean;
}

/** The public/private switch. Saves on toggle. */
export function VisibilitySection({
  profile,
  isProfileLoading,
  isDataLoading,
}: VisibilitySectionProps) {
  const [profileVisibility, setProfileVisibility] =
    useState<ProfileVisibility>("private");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isProfileLoading) return;
    setProfileVisibility(
      (profile?.profile_visibility as ProfileVisibility) || "private",
    );
  }, [profile, isProfileLoading]);

  async function handleVisibilityChange(checked: boolean) {
    const newVisibility: ProfileVisibility = checked ? "public" : "private";
    setIsSaving(true);

    try {
      const result = await updateProfileVisibility(newVisibility);

      if (result.error) {
        const errorMsg =
          result.error.visibility?.[0] ||
          result.error.server?.[0] ||
          "Failed to update visibility";
        toast.error(errorMsg);
        return;
      }

      if (result.success && result.visibility) {
        setProfileVisibility(result.visibility);
        toast.success(`Profile is now ${result.visibility}`);
      }
    } catch (error) {
      safeConsole.error("Error updating visibility:", error);
      toast.error("Failed to update profile visibility");
    } finally {
      setIsSaving(false);
    }
  }

  const isPublic = profileVisibility === "public";

  return (
    <SettingsSection
      title="Profile visibility"
      description="Control who can see your profile."
      footerHint="Saves automatically."
    >
      {isDataLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <Item className="flex-nowrap p-0">
          <ItemContent>
            <ItemTitle id="profile-visibility-label">Public profile</ItemTitle>
            <ItemDescription id="profile-visibility-description">
              {isPublic
                ? "Anyone can view your profile and volunteer history."
                : "Only you and organization admins can see your profile."}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              id="profile-visibility"
              aria-labelledby="profile-visibility-label"
              aria-describedby="profile-visibility-description"
              checked={isPublic}
              onCheckedChange={handleVisibilityChange}
              disabled={isSaving}
            />
          </ItemActions>
        </Item>
      )}
    </SettingsSection>
  );
}
