// components/Navbar.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import {
  Menu,
  UserRound,
  LogOut,
  Settings,
  Heart,
  MessageSquare,
  Loader2,
  LayoutDashboard,
  Palette,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { logout } from "@/app/logout/actions";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { ModeToggle } from "@/components/theme/theme-toggle";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { DonateDialog } from "@/components/feedback/DonateDialog";
import { useState } from "react";
import Image from "next/image";
import { NotificationPopover } from "@/components/notifications/NotificationPopover";
import { usePathname } from "next/navigation";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { useAuth } from "@/hooks/useAuth";
import { useUserProfile } from "@/hooks/useUserProfile";
import { DesktopPrimaryNavigation } from "./navbar/DesktopPrimaryNavigation";
import { NavbarThemeSelector } from "./navbar/NavbarThemeSelector";
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

  const handleNavigation = () => {
    setIsSheetOpen(false);
  };

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
        console.error("Logout failed:", result.error);
        setIsLoggingOut(false);
      }
    } catch (error) {
      console.error("Logout failed:", error);
      setIsLoggingOut(false);
    }
  };

  return (
    <>
      <div className="w-full">
        <nav className="flex items-center justify-between p-3 bg-background w-full">
          <Link href="/">
            <div className="flex items-center space-x-2">
              <Image
                src="/logo.png"
                alt="letsassist logo"
                width={30}
                height={30}
              />
              <span className="text-md font-semibold tracking-tight">
                Let's Assist
              </span>
            </div>
          </Link>

          <DesktopPrimaryNavigation
            isLoading={isAuthLoading}
            isAuthenticated={Boolean(user)}
            pathname={pathname}
          />
          <div className="hidden lg:flex items-center space-x-4 ml-auto">
            {isAuthLoading ? (
              <Skeleton className="h-9 w-9 rounded-full" />
            ) : user ? (
              <div className="flex items-center gap-5">
                <NotificationPopover key={user.id} viewport="desktop" />
                <DropdownMenu modal={false}>
                  {isProfileLoading ? (
                    <div className="w-9 h-9 rounded-full bg-muted animate-pulse" />
                  ) : (
                    <DropdownMenuTrigger
                      nativeButton={false}
                      render={
                        <Avatar className="w-9 h-9 cursor-pointer hover:opacity-80 transition-opacity">
                          <AvatarImage src={avatarUrl} alt={displayName} />
                          <AvatarFallback>
                            <NoAvatar fullName={displayName} />
                          </AvatarFallback>
                        </Avatar>
                      }
                    />
                  )}
                  <DropdownMenuContent className="w-64 pt-3 px-2 pb-2">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="font-normal mb-2">
                        <div className="flex flex-col space-y-2">
                          <p className="text-sm font-medium leading-tight">
                            {displayName}
                          </p>
                          <p className="text-sm leading-none text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>

                    <DropdownMenuItem
                      className="py-2.5 text-muted-foreground cursor-pointer"
                      render={
                        <Link
                          href="/home"
                          prefetch={false}
                          className="flex items-center w-full"
                        >
                          <LayoutDashboard className="mr-2 h-4 w-4" />
                          <span>Volunteer Dashboard</span>
                        </Link>
                      }
                    />

                    <DropdownMenuItem
                      className="py-2.5 text-muted-foreground cursor-pointer"
                      render={
                        <Link
                          href={profileHref}
                          prefetch={false}
                          className="flex items-center w-full"
                        >
                          <UserRound className="mr-2 h-4 w-4" />
                          <span>My Profile</span>
                        </Link>
                      }
                    />
                    <DropdownMenuItem
                      className="py-2.5 text-muted-foreground cursor-pointer"
                      render={
                        <Link
                          href="/account/profile"
                          prefetch={false}
                          className="flex items-center w-full"
                        >
                          <Settings className="mr-2 h-4 w-4" />
                          <span>Account Settings</span>
                        </Link>
                      }
                    />
                    <DropdownMenuSeparator className="my-2" />

                    {/* Appearance */}
                    <div className="px-2 py-0.5 flex justify-between">
                      <span className="text-sm self-center text-muted-foreground flex items-center">
                        <Palette className="mr-2 h-4 w-4" />
                        Appearance
                      </span>
                      <NavbarThemeSelector />
                    </div>

                    <DropdownMenuSeparator className="my-2" />

                    <DropdownMenuItem
                      className="text-chart-3 focus:text-primary py-2.5 cursor-pointer flex justify-between"
                      onClick={() => setShowFeedbackDialog(true)}
                    >
                      <span className="flex items-center">
                        <MessageSquare className="mr-2 h-4 w-4" />
                        Send Feedback
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-warning focus:text-destructive py-2.5 cursor-pointer flex justify-between"
                      onClick={() => setShowDonateDialog(true)}
                    >
                      <span className="flex items-center">
                        <Heart className="mr-2 h-4 w-4" />
                        Donate
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-2" />

                    {isLocalDevHost ? (
                      <>
                        <div className="px-2 py-2">
                          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Local dev data source
                          </p>
                          <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted/40 p-1">
                            <Button
                              type="button"
                              size="sm"
                              variant={
                                devPreviewSource === "local"
                                  ? "default"
                                  : "ghost"
                              }
                              className="h-7 text-xs"
                              onClick={() => handleDevSourceToggle("local")}
                            >
                              Local
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={
                                devPreviewSource === "remote"
                                  ? "default"
                                  : "ghost"
                              }
                              className="h-7 text-xs"
                              onClick={() => handleDevSourceToggle("remote")}
                            >
                              Remote (RO)
                            </Button>
                          </div>
                        </div>
                        <DropdownMenuSeparator className="my-2" />
                      </>
                    ) : null}

                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive py-2.5 cursor-pointer w-full"
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                    >
                      <div className="flex items-center w-full">
                        {isLoggingOut ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <LogOut className="mr-2 h-4 w-4" />
                        )}
                        <span>
                          {isLoggingOut ? "Logging out..." : "Log Out"}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost">Login</Button>
                </Link>
                <Link href="/signup">
                  <Button>Sign Up</Button>
                </Link>
                <div className="ml-4">
                  <ModeToggle />
                </div>
              </>
            )}
          </div>

          {/* Mobile Navigation */}
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetTitle className="hidden"></SheetTitle>
            <div className="lg:hidden flex items-center ml-auto">
              {isAuthLoading ? (
                <Skeleton className="w-9 h-9 rounded-full" />
              ) : (
                user && <NotificationPopover key={user.id} viewport="mobile" />
              )}
              {/* Show theme toggle for non-logged in users only */}
              {!isAuthLoading && !user && <ModeToggle />}
            </div>
            <SheetTrigger
              nativeButton={true}
              render={
                <Button variant="ghost" size="icon" className="lg:hidden ml-2">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Toggle menu</span>
                </Button>
              }
            />
            <SheetContent
              side="right"
              className="w-[85%] sm:w-95 pt-10 px-4 pb-4 overflow-y-auto"
            >
              <div className="flex flex-col h-full">
                {isAuthLoading ? (
                  <div className="mb-6">
                    <Skeleton className="w-full h-10 rounded" />
                  </div>
                ) : user ? (
                  <>
                    <div className="flex items-center space-x-3 mb-4">
                      {isProfileLoading ? (
                        <Skeleton className="w-12 h-12 rounded-full" />
                      ) : (
                        <Avatar className="w-12 h-12">
                          <AvatarImage src={avatarUrl} alt={displayName} />
                          <AvatarFallback>
                            <NoAvatar fullName={displayName} />
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div className="flex flex-col">
                        <p className="font-medium">{displayName}</p>
                        <p className="text-sm text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="destructive"
                      className="w-full mb-6"
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                    >
                      {isLoggingOut ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <LogOut className="mr-2 h-4 w-4" />
                      )}
                      {isLoggingOut ? "Logging out..." : "Log Out"}
                    </Button>

                    {/* Replace theme selector for logged-in users on mobile */}
                  </>
                ) : (
                  <div className="grid gap-2 mb-4 mt-3">
                    <Link
                      href="/login"
                      className="w-full"
                      onClick={handleNavigation}
                    >
                      <Button variant="outline" className="w-full">
                        Login
                      </Button>
                    </Link>
                    <Link
                      href="/signup"
                      className="w-full"
                      onClick={handleNavigation}
                    >
                      <Button className="w-full">Sign Up</Button>
                    </Link>
                  </div>
                )}

                <Separator className="mb-4" />

                <div className="space-y-1">
                  {user ? (
                    <>
                      <Link
                        href="/home"
                        prefetch={false}
                        className={cn(
                          buttonVariants({ variant: "ghost" }),
                          "w-full justify-start text-muted-foreground",
                        )}
                        onClick={handleNavigation}
                      >
                        Home
                      </Link>
                      <Link
                        href="/dashboard"
                        prefetch={false}
                        className={cn(
                          buttonVariants({ variant: "ghost" }),
                          "w-full justify-start text-muted-foreground",
                        )}
                        onClick={handleNavigation}
                      >
                        Volunteer Dashboard
                      </Link>
                      <Link
                        href="/projects"
                        prefetch={false}
                        className={cn(
                          buttonVariants({ variant: "ghost" }),
                          "w-full justify-start text-muted-foreground",
                        )}
                        onClick={handleNavigation}
                      >
                        My Projects
                      </Link>

                      <Link
                        href="/organization"
                        prefetch={false}
                        className={cn(
                          buttonVariants({ variant: "ghost" }),
                          "w-full justify-start text-muted-foreground",
                        )}
                        onClick={handleNavigation}
                      >
                        Organizations
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link
                        href="/projects"
                        className={cn(
                          buttonVariants({ variant: "ghost" }),
                          "w-full justify-start text-muted-foreground",
                        )}
                        onClick={handleNavigation}
                      >
                        Volunteering Near Me
                      </Link>
                      <Link
                        href="/organization"
                        className={cn(
                          buttonVariants({ variant: "ghost" }),
                          "w-full justify-start text-muted-foreground",
                        )}
                        onClick={handleNavigation}
                      >
                        Connected Organizations
                      </Link>
                    </>
                  )}
                </div>

                {user && (
                  <>
                    <Separator className="my-4" />
                    <Link
                      href="/account/profile"
                      prefetch={false}
                      className={cn(
                        buttonVariants({ variant: "ghost" }),
                        "w-full justify-between text-muted-foreground",
                      )}
                      onClick={handleNavigation}
                    >
                      Account Settings
                      <Settings className="h-4 w-4" />
                    </Link>
                    {/* Re-enable MobileNotificationButton now that we're storing notifications */}
                    {/* <MobileNotificationButton /> */}
                    <Link
                      href={`/profile/${profile?.username}`}
                      prefetch={false}
                      className={cn(
                        buttonVariants({ variant: "ghost" }),
                        "w-full justify-between text-muted-foreground",
                      )}
                      onClick={handleNavigation}
                    >
                      My Profile
                      <UserRound className="h-4 w-4" />
                    </Link>
                  </>
                )}

                <Separator className="my-4" />
                <div className="px-4 py-0.5 flex justify-between">
                  <span className="text-sm self-center text-muted-foreground block">
                    Appearance
                  </span>
                  <NavbarThemeSelector mobile />
                </div>
                <Separator className="my-4" />
                <div className="space-y-1">
                  <Button
                    variant="ghost"
                    className="w-full justify-between text-chart-3 hover:text-chart-3 hover:bg-chart-3/10"
                    onClick={() => {
                      setShowFeedbackDialog(true);
                      handleNavigation();
                    }}
                  >
                    Send Feedback
                    <MessageSquare className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-between text-chart-4 hover:text-chart-4 hover:bg-chart-4/10"
                    onClick={() => {
                      setShowDonateDialog(true);
                      handleNavigation();
                    }}
                  >
                    Donate
                    <Heart className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </nav>
      </div>
      <Separator />
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
