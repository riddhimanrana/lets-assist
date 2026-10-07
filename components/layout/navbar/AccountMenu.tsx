"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";

import {
  HeartIcon,
  LayoutGridIcon,
  LogoutIcon,
  MessageCircleIcon,
  SettingsIcon,
  UserIcon,
  useAnimatedIcon,
} from "@/components/icons/animated";
import { Button } from "@/components/ui/button";
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

import {
  AccountAvatar,
  type AnimatedIconComponent,
  type NavbarAccount,
} from "./account";
import { DevPreviewSourceSwitch } from "./DevPreviewSourceSwitch";
import { NavbarThemeSelector } from "./NavbarThemeSelector";

const rowClass = "cursor-pointer py-2";
const iconClass = "text-muted-foreground";

export function AccountMenu({ account }: { account: NavbarAccount }) {
  const { devPreview } = account;

  if (account.isProfileLoading) {
    return <Skeleton className="size-9 rounded-full" />;
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Account menu"
          >
            <AccountAvatar account={account} />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-64 p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-2 font-normal">
            <span className="truncate text-sm font-medium text-foreground">
              {account.displayName}
            </span>
            <span className="truncate text-sm">{account.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        <MenuLink href="/home" icon={LayoutGridIcon}>
          Volunteer dashboard
        </MenuLink>
        <MenuLink href={account.profileHref} icon={UserIcon}>
          My profile
        </MenuLink>
        <MenuLink href="/account/profile" icon={SettingsIcon}>
          Account settings
        </MenuLink>
        <DropdownMenuSeparator />

        <div className="flex items-center justify-between gap-3 px-2 py-1">
          <span className="text-sm">Appearance</span>
          <NavbarThemeSelector />
        </div>
        <DropdownMenuSeparator />

        <MenuAction icon={MessageCircleIcon} onClick={account.onFeedback}>
          Send feedback
        </MenuAction>
        <MenuAction icon={HeartIcon} onClick={account.onDonate}>
          Donate
        </MenuAction>
        <DropdownMenuSeparator />

        {devPreview.isLocalDevHost ? (
          <>
            <div className="px-2 py-1.5">
              <DevPreviewSourceSwitch
                source={devPreview.source}
                onSelect={devPreview.selectSource}
              />
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <LogoutItem
          isLoggingOut={account.isLoggingOut}
          onLogout={account.onLogout}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: AnimatedIconComponent;
  children: React.ReactNode;
}) {
  const icon = useAnimatedIcon();

  return (
    <DropdownMenuItem
      className={rowClass}
      render={<Link href={href} prefetch={false} />}
      {...icon.triggerProps}
    >
      <Icon ref={icon.ref} size={16} aria-hidden="true" className={iconClass} />
      {children}
    </DropdownMenuItem>
  );
}

function MenuAction({
  icon: Icon,
  onClick,
  children,
}: {
  icon: AnimatedIconComponent;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const icon = useAnimatedIcon();

  return (
    <DropdownMenuItem
      className={rowClass}
      onClick={onClick}
      {...icon.triggerProps}
    >
      <Icon ref={icon.ref} size={16} aria-hidden="true" className={iconClass} />
      {children}
    </DropdownMenuItem>
  );
}

function LogoutItem({
  isLoggingOut,
  onLogout,
}: Pick<NavbarAccount, "isLoggingOut" | "onLogout">) {
  const icon = useAnimatedIcon();

  return (
    <DropdownMenuItem
      className={rowClass}
      // Stay open so the pending state is visible until the page reloads.
      closeOnClick={false}
      onClick={onLogout}
      disabled={isLoggingOut}
      {...icon.triggerProps}
    >
      {isLoggingOut ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : (
        <LogoutIcon
          ref={icon.ref}
          size={16}
          aria-hidden="true"
          className={iconClass}
        />
      )}
      {isLoggingOut ? "Logging out..." : "Log out"}
    </DropdownMenuItem>
  );
}
