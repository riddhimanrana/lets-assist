"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useUserProfile } from "@/hooks/useUserProfile";
import { EmailAddressesSection } from "./EmailAddressesSection";
import { ProfileForm } from "./ProfileForm";
import { VisibilitySection } from "./VisibilitySection";

// How long the placeholders may show before the page offers a way forward.
const SLOW_LOAD_HINT_MS = 10_000;

export default function ProfileClient() {
  const { user, loading: isAuthLoading } = useAuth();
  const {
    profile,
    loading: isProfileLoading,
    pending,
    error,
    refetch,
  } = useUserProfile();
  const isDataLoading = isAuthLoading || isProfileLoading;
  const [isSlow, setIsSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const userId = user?.id;

  // A slow load is not a failed load. The hint only says it is taking a while,
  // and it starts over for each attempt and each account.
  useEffect(() => {
    if (!isDataLoading) return;
    const timer = setTimeout(() => setIsSlow(true), SLOW_LOAD_HINT_MS);
    return () => {
      clearTimeout(timer);
      setIsSlow(false);
    };
  }, [isDataLoading, attempt, userId]);

  function retryProfileLoad() {
    setAttempt((current) => current + 1);
    void refetch();
  }

  const loadFailed = !isDataLoading && error !== null;
  // With no profile to show, an empty form would read as an empty profile.
  const showEditors = !loadFailed || profile !== null;

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
      {isDataLoading && isSlow ? (
        <Alert variant="info" role="status">
          <AlertTitle>Still loading your profile</AlertTitle>
          <AlertDescription>
            This is taking longer than usual. It may still finish on its own.
          </AlertDescription>
          <div className="pt-2">
            {pending === "profile" ? (
              <Button variant="outline" size="sm" onClick={retryProfileLoad}>
                Try again
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
              >
                Reload page
              </Button>
            )}
          </div>
        </Alert>
      ) : null}
      {loadFailed ? (
        <Alert variant="warning">
          <AlertTitle>
            {profile
              ? "Your profile could not be refreshed"
              : "Your profile could not be loaded"}
          </AlertTitle>
          <AlertDescription>
            {profile
              ? "The details below may be out of date. Nothing was changed."
              : "Nothing was changed. Try again in a moment."}
          </AlertDescription>
          <div className="pt-2">
            <Button variant="outline" size="sm" onClick={retryProfileLoad}>
              Try again
            </Button>
          </div>
        </Alert>
      ) : null}
      {showEditors ? (
        <>
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
        </>
      ) : null}
      <EmailAddressesSection user={user} />
    </>
  );
}
