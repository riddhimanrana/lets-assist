"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/shared/NoAvatar";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import {
  BadgeCheck,
  Building2,
  GraduationCap,
  Briefcase,
  Users,
} from "lucide-react";
import { format } from "date-fns";

interface ProfileHoverCardProps {
  username: string;
  fullName: string;
  avatarUrl?: string;
  isTrusted?: boolean;
  /** Organization verification checkmark (for org hover cards) */
  verified?: boolean;
  createdAt?: string;
  /** Optional short description (useful for organizations) */
  description?: string;
  children: ReactNode;
  /** If true, prevents link navigation (useful for anonymous users) */
  disabled?: boolean;
  /** Side positioning for the hover card */
  side?: "top" | "bottom" | "left" | "right";
  /** Offset from the trigger element */
  sideOffset?: number;
  /** Overrides the click-through destination (defaults based on variant) */
  href?: string;
  /** Controls the meta row and default href */
  variant?: "profile" | "organization";
  /** Optional additional classes for the hover card content */
  contentClassName?: string;
}

/**
 * Unified hover card used across the app.
 * Sizing is intentionally similar to the shadcn/ui HoverCard demo (w-80).
 */
export function ProfileHoverCard({
  username,
  fullName,
  avatarUrl,
  isTrusted = false,
  verified = false,
  createdAt,
  description,
  children,
  disabled = false,
  side = "bottom",
  sideOffset = 2,
  href,
  variant = "profile",
  contentClassName,
}: ProfileHoverCardProps) {
  const isDisabled = disabled || !username;
  if (isDisabled) return <>{children}</>;

  const resolvedHref =
    href ??
    (variant === "organization"
      ? `/organization/${username}`
      : `/profile/${username}`);

  const showTrustedBadge = variant === "profile" && isTrusted;
  const showVerifiedBadge = variant === "organization" && verified;
  const joinDate = createdAt ? format(new Date(createdAt), "MMMM yyyy") : null;

  const OrgTypeIcon = orgTypeIcon(description);

  return (
    <HoverCard>
      {/* The trigger is a plain span on purpose. Callers put this around a
          link, or inside a card that is itself a link, so an anchor or button
          here would nest one interactive element in another. */}
      <HoverCardTrigger
        render={<span className="inline-flex min-w-0">{children}</span>}
      />

      <HoverCardContent
        side={side}
        sideOffset={sideOffset}
        className={cn("w-72 max-w-[calc(100vw-2rem)]", contentClassName)}
      >
        <Link
          href={resolvedHref}
          className="group/profile focus-visible:ring-ring/50 -m-1 flex items-start gap-3 rounded-md p-1 outline-none focus-visible:ring-[3px]"
        >
          <Avatar className="size-10">
            <AvatarImage src={avatarUrl} alt="" />
            <AvatarFallback>
              <NoAvatar fullName={fullName} />
            </AvatarFallback>
          </Avatar>

          <div className="grid min-w-0 flex-1 gap-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="truncate text-sm leading-snug font-medium underline-offset-4 group-hover/profile:underline">
                {fullName}
              </p>
              {showTrustedBadge && (
                <BadgeCheck
                  aria-label="Trusted member"
                  className="text-success size-4 shrink-0"
                />
              )}
              {showVerifiedBadge && (
                <BadgeCheck
                  aria-label="Verified organization"
                  className="text-success size-4 shrink-0"
                />
              )}
            </div>

            <p className="text-muted-foreground truncate text-sm">
              @{username}
            </p>

            {variant === "profile" && description ? (
              <p className="line-clamp-2 pt-1 text-sm leading-snug">
                {description}
              </p>
            ) : null}

            {variant === "organization" && description ? (
              <p className="text-muted-foreground flex items-center gap-1.5 pt-1 text-xs">
                <OrgTypeIcon aria-hidden="true" className="size-3.5 shrink-0" />
                {description}
              </p>
            ) : !description && joinDate ? (
              <p className="text-muted-foreground pt-1 text-xs">
                Joined {joinDate}
              </p>
            ) : null}
          </div>
        </Link>
      </HoverCardContent>
    </HoverCard>
  );
}

/** Organization types are free text, so match on the words people use. */
function orgTypeIcon(type: string | undefined) {
  const lowerType = type?.toLowerCase() ?? "";
  if (/school|education/.test(lowerType)) return GraduationCap;
  if (/business|company|corporate/.test(lowerType)) return Briefcase;
  if (/community|group/.test(lowerType)) return Users;
  return Building2;
}

interface OrganizationHoverCardProps {
  organization: {
    username: string;
    name: string;
    logo_url?: string | null;
    verified?: boolean;
    description?: string | null;
    type?: string;
  };
  children: ReactNode;
  disabled?: boolean;
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
  contentClassName?: string;
}

export function OrganizationHoverCard({
  organization,
  children,
  disabled,
  side,
  sideOffset,
  contentClassName,
}: OrganizationHoverCardProps) {
  // Capitalize the first letter of the organization type
  const capitalizeType = (type: string | undefined) => {
    if (!type) return "Organization";
    return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  };

  return (
    <ProfileHoverCard
      variant="organization"
      username={organization.username}
      fullName={organization.name}
      avatarUrl={organization.logo_url ?? undefined}
      verified={Boolean(organization.verified)}
      description={capitalizeType(organization.type)}
      href={`/organization/${organization.username}`}
      disabled={disabled}
      side={side}
      sideOffset={sideOffset}
      contentClassName={contentClassName}
    >
      {children}
    </ProfileHoverCard>
  );
}
