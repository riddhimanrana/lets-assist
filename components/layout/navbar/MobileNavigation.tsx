"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";

import {
  HeartIcon,
  LogoutIcon,
  MenuIcon,
  MessageCircleIcon,
  SettingsIcon,
  UserIcon,
  XIcon,
  useAnimatedIcon,
} from "@/components/icons/animated";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  AccountAvatar,
  type AnimatedIconComponent,
  type NavbarAccount,
} from "./account";
import {
  featureLinks,
  isActiveDestination,
  memberLinks,
  publicLinks,
} from "./destinations";
import { DevPreviewSourceSwitch } from "./DevPreviewSourceSwitch";
import { NavbarThemeSelector } from "./NavbarThemeSelector";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  isAuthenticated: boolean;
  pathname: string;
  account: NavbarAccount;
};

// One row recipe for the whole sheet, so every label sits on the same left edge.
const rowClass = cn(
  buttonVariants({ variant: "ghost", size: "lg" }),
  "w-full justify-between px-3 text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground",
);

export function MobileNavigation({
  open,
  onOpenChange,
  isLoading,
  isAuthenticated,
  pathname,
  account,
}: Props) {
  const menuIcon = useAnimatedIcon();
  const closeIcon = useAnimatedIcon();
  const close = () => onOpenChange(false);
  const { devPreview } = account;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            {...menuIcon.triggerProps}
          >
            <MenuIcon ref={menuIcon.ref} size={16} aria-hidden="true" />
            <span className="sr-only">Toggle menu</span>
          </Button>
        }
      />
      <SheetContent
        side="right"
        showCloseButton={false}
        className="gap-0 data-[side=right]:w-full data-[side=right]:max-w-sm"
      >
        <div className="flex h-14 shrink-0 items-center gap-3 border-b pr-2 pl-4">
          {isLoading ? (
            <>
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <Skeleton className="h-5 w-32" />
            </>
          ) : isAuthenticated ? (
            <>
              {account.isProfileLoading ? (
                <Skeleton className="size-9 rounded-full" />
              ) : (
                <AccountAvatar account={account} className="size-9" />
              )}
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-sm">
                  {account.displayName}
                </SheetTitle>
                <p className="truncate text-sm text-muted-foreground">
                  {account.email}
                </p>
              </div>
            </>
          ) : (
            <SheetTitle className="text-base font-semibold">Menu</SheetTitle>
          )}
          <SheetClose
            render={
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto"
                aria-label="Close menu"
                {...closeIcon.triggerProps}
              />
            }
          >
            <XIcon ref={closeIcon.ref} size={16} aria-hidden="true" />
          </SheetClose>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex flex-col gap-2 p-1" aria-hidden="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <nav aria-label="Menu" className="flex flex-col gap-0.5">
              {(isAuthenticated ? memberLinks : publicLinks).map(
                ([label, href]) => (
                  <Link
                    key={href}
                    href={href}
                    prefetch={isAuthenticated ? false : undefined}
                    aria-current={
                      isActiveDestination(pathname, href) ? "page" : undefined
                    }
                    className={rowClass}
                    onClick={close}
                  >
                    {label}
                  </Link>
                ),
              )}
              {isAuthenticated
                ? null
                : featureLinks.map(({ title, href }) => (
                    <Link
                      key={href}
                      href={href}
                      className={rowClass}
                      onClick={close}
                    >
                      {title}
                    </Link>
                  ))}
            </nav>
          )}

          {isAuthenticated ? (
            <>
              <Separator />
              <div className="flex flex-col gap-0.5">
                <SheetRow
                  href={account.profileHref}
                  icon={UserIcon}
                  onClick={close}
                >
                  My profile
                </SheetRow>
                <SheetRow
                  href="/account/profile"
                  icon={SettingsIcon}
                  onClick={close}
                >
                  Account settings
                </SheetRow>
              </div>
            </>
          ) : null}

          <Separator />
          <div className="flex flex-col gap-0.5">
            <SheetRow
              icon={MessageCircleIcon}
              onClick={() => {
                account.onFeedback();
                close();
              }}
            >
              Send feedback
            </SheetRow>
            <SheetRow
              icon={HeartIcon}
              onClick={() => {
                account.onDonate();
                close();
              }}
            >
              Donate
            </SheetRow>
          </div>

          <Separator />
          <div className="flex items-center justify-between gap-3 py-1 pr-1 pl-3">
            <span className="text-sm font-medium text-muted-foreground">
              Appearance
            </span>
            <NavbarThemeSelector mobile />
          </div>

          {devPreview.isLocalDevHost ? (
            <>
              <Separator />
              <div className="px-3 py-1">
                <DevPreviewSourceSwitch
                  source={devPreview.source}
                  onSelect={devPreview.selectSource}
                />
              </div>
            </>
          ) : null}
        </div>

        {isLoading ? null : (
          <div className="shrink-0 border-t p-4">
            {isAuthenticated ? (
              <LogoutButton
                isLoggingOut={account.isLoggingOut}
                onLogout={account.onLogout}
              />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  render={<Link href="/login" />}
                  onClick={close}
                >
                  Login
                </Button>
                <Button render={<Link href="/signup" />} onClick={close}>
                  Sign up
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetRow({
  href,
  icon: Icon,
  onClick,
  children,
}: {
  href?: string;
  icon: AnimatedIconComponent;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const icon = useAnimatedIcon();
  const content = (
    <>
      {children}
      <Icon ref={icon.ref} size={16} aria-hidden="true" />
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        prefetch={false}
        className={rowClass}
        onClick={onClick}
        {...icon.triggerProps}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={rowClass}
      onClick={onClick}
      {...icon.triggerProps}
    >
      {content}
    </button>
  );
}

function LogoutButton({
  isLoggingOut,
  onLogout,
}: Pick<NavbarAccount, "isLoggingOut" | "onLogout">) {
  const icon = useAnimatedIcon();

  return (
    <Button
      variant="outline"
      className="w-full"
      onClick={onLogout}
      disabled={isLoggingOut}
      {...icon.triggerProps}
    >
      {isLoggingOut ? (
        <Loader2
          data-icon="inline-start"
          aria-hidden="true"
          className="animate-spin"
        />
      ) : (
        <LogoutIcon
          ref={icon.ref}
          size={16}
          data-icon="inline-start"
          aria-hidden="true"
        />
      )}
      {isLoggingOut ? "Logging out..." : "Log out"}
    </Button>
  );
}
