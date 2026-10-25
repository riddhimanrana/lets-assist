"use client";

import type {
  ForwardRefExoticComponent,
  HTMLAttributes,
  RefAttributes,
} from "react";

import type { AnimatedIconHandle } from "@/components/icons/animated";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export type AnimatedIconComponent = ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & {
    size?: number;
  } & RefAttributes<AnimatedIconHandle>
>;

type PreviewSource = "local" | "remote";

/** Everything the desktop account menu and the mobile sheet share. */
export type NavbarAccount = {
  displayName: string;
  email: string | undefined;
  avatarUrl: string | undefined;
  profileHref: string;
  isProfileLoading: boolean;
  isLoggingOut: boolean;
  onLogout: () => void;
  onFeedback: () => void;
  onDonate: () => void;
  devPreview: {
    isLocalDevHost: boolean;
    source: PreviewSource;
    selectSource: (source: PreviewSource) => void;
  };
};

export function AccountAvatar({
  account,
  className,
}: {
  account: Pick<NavbarAccount, "displayName" | "avatarUrl">;
  className?: string;
}) {
  return (
    <Avatar className={className}>
      <AvatarImage src={account.avatarUrl} alt="" />
      <AvatarFallback>
        <NoAvatar fullName={account.displayName} />
      </AvatarFallback>
    </Avatar>
  );
}
