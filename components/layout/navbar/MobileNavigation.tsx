"use client";

import Link from "next/link";
import {
  Heart,
  Loader2,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";

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
import { AccountAvatar, type NavbarAccount } from "./account";
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

const rowClass = cn(
  buttonVariants({ variant: "ghost" }),
  "min-h-11 w-full justify-start px-4 text-muted-foreground aria-[current=page]:text-foreground aria-[current=page]:hover:bg-transparent",
);

export function MobileNavigation({
  open,
  onOpenChange,
  isLoading,
  isAuthenticated,
  pathname,
  account,
}: Props) {
  const close = () => onOpenChange(false);
  const { devPreview } = account;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-11 touch-manipulation lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            <Menu className="size-5" aria-hidden="true" />
          </Button>
        }
      />
      <SheetContent
        side="right"
        showCloseButton={false}
        data-lenis-prevent
        className="gap-0 overflow-y-auto overscroll-contain px-4 pt-0 pb-[max(1rem,env(safe-area-inset-bottom))] data-[side=right]:w-[85%] data-[side=right]:max-w-95 motion-reduce:animate-none motion-reduce:transition-none"
      >
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <div className="sticky top-0 z-10 -mx-4 flex h-12 shrink-0 items-center justify-end bg-background px-2">
          <SheetClose
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-11 touch-manipulation"
                aria-label="Close menu"
              />
            }
          >
            <X className="size-5" aria-hidden="true" />
          </SheetClose>
        </div>
        <div className="flex min-h-0 flex-col">
          {isLoading ? (
            <div className="mb-6 space-y-3" aria-label="Loading account">
              <Skeleton className="size-12 rounded-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isAuthenticated ? (
            <>
              <div className="mb-4 flex items-center gap-3">
                {account.isProfileLoading ? (
                  <Skeleton className="size-12 shrink-0 rounded-full" />
                ) : (
                  <AccountAvatar
                    account={account}
                    className="size-12 shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{account.displayName}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {account.email}
                  </p>
                </div>
              </div>
              <Button
                variant="destructive"
                className="mb-6 min-h-11 w-full"
                onClick={account.onLogout}
                disabled={account.isLoggingOut}
              >
                {account.isLoggingOut ? (
                  <Loader2
                    data-icon="inline-start"
                    aria-hidden="true"
                    className="animate-spin"
                  />
                ) : (
                  <LogOut data-icon="inline-start" aria-hidden="true" />
                )}
                {account.isLoggingOut ? "Logging out..." : "Log out"}
              </Button>
            </>
          ) : (
            <div className="mt-3 mb-4 grid gap-2">
              <Button
                variant="outline"
                className="min-h-11 w-full"
                render={<Link href="/login" />}
                onClick={close}
              >
                Login
              </Button>
              <Button
                className="min-h-11 w-full"
                render={<Link href="/signup" />}
                onClick={close}
              >
                Create account
              </Button>
            </div>
          )}
          <Separator className="mb-4" />
          {isLoading ? (
            <div className="space-y-2" aria-hidden="true">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : (
            <nav aria-label="Menu" className="space-y-1">
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
            </nav>
          )}
          {!isLoading && !isAuthenticated && (
            <nav aria-label="Features" className="mt-4 space-y-1">
              <p className="px-4 text-xs font-medium text-muted-foreground">
                Features
              </p>
              {featureLinks.map(({ title, href }) => (
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
          {!isLoading && isAuthenticated && (
            <>
              <Separator className="my-4" />
              <div className="space-y-1">
                <MenuRow
                  href="/account/profile"
                  icon={Settings}
                  onClick={close}
                >
                  Account settings
                </MenuRow>
                <MenuRow
                  href={account.profileHref}
                  icon={UserRound}
                  onClick={close}
                >
                  My profile
                </MenuRow>
              </div>
            </>
          )}
          <Separator className="my-4" />
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-0.5">
            <span className="text-sm text-muted-foreground">Appearance</span>
            <NavbarThemeSelector mobile />
          </div>
          {devPreview.isLocalDevHost && (
            <>
              <Separator className="my-4" />
              <div className="px-4">
                <DevPreviewSourceSwitch
                  source={devPreview.source}
                  onSelect={devPreview.selectSource}
                />
              </div>
            </>
          )}
          <Separator className="my-4" />
          <div className="space-y-1">
            <MenuRow
              icon={MessageSquare}
              className="text-chart-3 hover:bg-chart-3/10 hover:text-chart-3"
              onClick={() => {
                account.onFeedback();
                close();
              }}
            >
              Send feedback
            </MenuRow>
            <MenuRow
              icon={Heart}
              className="text-chart-4 hover:bg-chart-4/10 hover:text-chart-4"
              onClick={() => {
                account.onDonate();
                close();
              }}
            >
              Donate
            </MenuRow>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MenuRow({
  href,
  icon: Icon,
  onClick,
  children,
  className,
}: {
  href?: string;
  icon: LucideIcon;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const content = (
    <>
      {children}
      <Icon className="size-4" aria-hidden="true" />
    </>
  );
  const classes = cn(rowClass, "justify-between", className);
  return href ? (
    <Link href={href} prefetch={false} className={classes} onClick={onClick}>
      {content}
    </Link>
  ) : (
    <button type="button" className={classes} onClick={onClick}>
      {content}
    </button>
  );
}
