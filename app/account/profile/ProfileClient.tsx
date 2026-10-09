"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useUserProfile } from "@/hooks/useUserProfile";
import { EmailAddressesSection } from "./EmailAddressesSection";
import { ProfileForm } from "./ProfileForm";
import { VisibilitySection } from "./VisibilitySection";

export default function ProfileClient() {
  const { user, loading: isAuthLoading } = useAuth();
  const { profile, loading: isProfileLoading } = useUserProfile();
  const isDataLoading = isAuthLoading || isProfileLoading;

  return (
    <>
      <PageHeader
        title="Profile"
        description="Your name, photo and how others see you."
        actions={
          profile?.username ? (
            <Button
              variant="outline"
              render={<Link href={`/profile/${profile.username}`} />}
            >
              View public profile
              <ExternalLink data-icon="inline-end" />
            </Button>
          ) : null
        }
      />
      <ProfileForm
        profile={profile}
        isProfileLoading={isProfileLoading}
        isDataLoading={isDataLoading}
      />
      <VisibilitySection
        profile={profile}
        isProfileLoading={isProfileLoading}
        isDataLoading={isDataLoading}
      />
      <EmailAddressesSection user={user} />
    </>
  );
}
