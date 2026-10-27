// components/Navbar.tsx
"use client";
import { safeConsole } from "@/lib/safe-console";

import * as React from "react";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";

import { logout } from "@/app/logout/actions";
import { DonateDialog } from "@/components/feedback/DonateDialog";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { NotificationPopover } from "@/components/notifications/NotificationPopover";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useUserProfile } from "@/hooks/useUserProfile";

import type { NavbarAccount } from "./navbar/account";
import { AccountMenu } from "./navbar/AccountMenu";
import { DesktopPrimaryNavigation } from "./navbar/DesktopPrimaryNavigation";
import { MobileNavigation } from "./navbar/MobileNavigation";
import { NavbarThemeMenu } from "./navbar/NavbarThemeMenu";
import { useDevPreviewSource } from "./navbar/useDevPreviewSource";

export default function Navbar() {
  // Use centralized auth hook instead of manual state management
  const { user, loading: isAuthLoading } = useAuth();
  // Use cached profile data instead of making a separate query
  const { profile, loading: isProfileLoading } = useUserProfile();

  const authMetadata = (user?.user_metadata ?? null) as Record<
    string,
    unknown
  > | null;

  const displayName =
    profile?.full_name ||
    (typeof authMetadata?.full_name === "string"
      ? authMetadata.full_name
      : null) ||
    (typeof authMetadata?.name === "string" ? authMetadata.name : null) ||
    (typeof authMetadata?.display_name === "string"
      ? authMetadata.display_name
      : null) ||
    user?.email?.split("@")[0] ||
    "Let's Assist user";

  const identityAvatarUrl =
    user?.identities?.find((identity) => {
      const avatar =
        identity.identity_data?.avatar_url || identity.identity_data?.picture;
      return typeof avatar === "string" && avatar.length > 0;
    })?.identity_data?.avatar_url ||
    user?.identities?.find((identity) => {
      const picture = identity.identity_data?.picture;
      return typeof picture === "string" && picture.length > 0;
    })?.identity_data?.picture;

  const avatarUrl =
    profile?.avatar_url ||
    (typeof authMetadata?.avatar_url === "string"
      ? authMetadata.avatar_url
      : null) ||
    (typeof authMetadata?.picture === "string" ? authMetadata.picture : null) ||
    identityAvatarUrl ||
    undefined;

  const profileUsername =
    profile?.username ||
    (typeof authMetadata?.username === "string"
      ? authMetadata.username
      : null) ||
    null;
  const profileHref = profileUsername
    ? `/profile/${profileUsername}`
    : "/account/profile";

  const [showDonateDialog, setShowDonateDialog] = useState(false);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const {
    source: devPreviewSource,
    isLocalDevHost,
    selectSource: handleDevSourceToggle,
  } = useDevPreviewSource();
  const [isSheetOpen, setIsSheetOpen] = React.useState(false);
  // Add loading state for logout
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);
  const pathname = usePathname();

  // Handle logout with loading state
  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);

      // Log out via server action
      const result = await logout();

      if (result.success) {
        setTimeout(() => {
          // Logout must reload the document so no authenticated client state survives.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = "/";
        }, 100);
      } else {
        safeConsole.error("Logout failed:", result.error);
        setIsLoggingOut(false);
        toast.error("We could not sign you out. Please try again.");
      }
    } catch (error) {
      safeConsole.error("Logout failed:", error);
      setIsLoggingOut(false);
      toast.error("We could not sign you out. Please try again.");
    }
  };

  const account: NavbarAccount = {
    displayName,
    email: user?.email,
    avatarUrl,
    profileHref,
    isProfileLoading,
    isLoggingOut,
    onLogout: handleLogout,
    onFeedback: () => setShowFeedbackDialog(true),
    onDonate: () => setShowDonateDialog(true),
    devPreview: {
      isLocalDevHost,
      source: devPreviewSource,
      selectSource: handleDevSourceToggle,
    },
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b bg-background lg:static lg:z-auto">
        {/*
          From `lg` up the bar is three grid tracks: brand, primary links,
          account controls. Equal outer tracks centre the links when all
          content fits; each track retains its content's minimum width.
        */}
        <nav
          aria-label="Primary"
          className="flex h-14 w-full items-center gap-6 px-4 sm:px-6 lg:grid lg:grid-cols-[1fr_auto_1fr]"
        >
          <Link
            href="/"
            className="flex min-h-11 shrink-0 touch-manipulation items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-0 lg:justify-self-start"
          >
            <Image src="/logo.png" alt="" width={28} height={28} />
            <span className="text-base font-semibold tracking-tight whitespace-nowrap">
              Let's Assist
            </span>
          </Link>

          <DesktopPrimaryNavigation
            isLoading={isAuthLoading}
            isAuthenticated={Boolean(user)}
            pathname={pathname}
          />

          <div className="hidden lg:flex items-center gap-2 ml-auto">
            {isAuthLoading ? (
              <Skeleton className="size-9 rounded-full" />
            ) : user ? (
              <>
                <NotificationPopover key={user.id} viewport="desktop" />
                <AccountMenu account={account} />
              </>
            ) : (
              <>
                <NavbarThemeMenu />
                <Button variant="ghost" render={<Link href="/login" />}>
                  Login
                </Button>
                <Button render={<Link href="/signup" />}>Create account</Button>
              </>
            )}
          </div>

          <div className="lg:hidden flex items-center gap-1 ml-auto [&>button]:size-11 [&>button]:touch-manipulation">
            {isAuthLoading ? (
              <Skeleton className="size-9 rounded-full" />
            ) : (
              user && <NotificationPopover key={user.id} viewport="mobile" />
            )}
            <MobileNavigation
              open={isSheetOpen}
              onOpenChange={setIsSheetOpen}
              isLoading={isAuthLoading}
              isAuthenticated={Boolean(user)}
              pathname={pathname}
              account={account}
            />
          </div>
        </nav>
      </header>
      <DonateDialog
        open={showDonateDialog}
        onOpenChange={setShowDonateDialog}
      />
      {showFeedbackDialog && (
        <FeedbackDialog onOpenChangeAction={setShowFeedbackDialog} />
      )}
    </>
  );
}
