"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { cn } from "@/lib/utils";
import { BadgeCheck, Building2, GraduationCap, Briefcase, Users } from "lucide-react";
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
    href ?? (variant === "organization" ? `/organization/${username}` : `/profile/${username}`);

  const showTrustedBadge = variant === "profile" && isTrusted;
  const showVerifiedBadge = variant === "organization" && verified;
  const joinDate = createdAt ? format(new Date(createdAt), "MMMM yyyy") : null;

  // Map org types to icons
  const getOrgTypeIcon = (type: string | undefined) => {
    if (!type) return <Building2 className="h-3.5 w-3.5 opacity-70" />;

    const lowerType = type.toLowerCase();
    if (lowerType.includes("nonprofit") || lowerType.includes("non-profit")) {
      return <Building2 className="h-3.5 w-3.5 opacity-70" />;
    }
    if (lowerType.includes("school") || lowerType.includes("education") || lowerType.includes("educational")) {
      return <GraduationCap className="h-3.5 w-3.5 opacity-70" />;
    }
    if (lowerType.includes("business") || lowerType.includes("company") || lowerType.includes("corporate")) {
      return <Briefcase className="h-3.5 w-3.5 opacity-70" />;
    }
    if (lowerType.includes("community") || lowerType.includes("group")) {
      return <Users className="h-3.5 w-3.5 opacity-70" />;
    }
    return <Building2 className="h-3.5 w-3.5 opacity-70" />;
  };

  return (
    <HoverCard>
      <HoverCardTrigger render={
        <span className="inline-flex">{children}</span>
      } />

      <HoverCardContent
        side={side}
        sideOffset={sideOffset}
        className={cn(
          "w-auto max-w-[calc(100vw-2rem)] rounded-lg p-4 bg-popover border border-border shadow-lg",
          contentClassName
        )}
      >
        <Link href={resolvedHref} className="block group transition-colors">
          <div className="flex justify-between gap-4">
            <Avatar className="h-10 w-10 border border-border">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt={fullName} /> : null}
              <AvatarFallback className="bg-muted/50">
                <NoAvatar fullName={fullName} className="text-xs font-medium" />
              </AvatarFallback>
            </Avatar>

            <div className="space-y-1 flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <h4 className="text-sm font-semibold leading-none truncate group-hover:underline underline-offset-4">
                  {fullName}
                </h4>
                {showTrustedBadge && (
                  <BadgeCheck
                    className="h-4 w-4 text-success shrink-0"
                    fill="currentColor"
                  />
                )}
                {showVerifiedBadge && (
                  <BadgeCheck
                    className="h-4 w-4 text-primary shrink-0"
                  />
                )}
              </div>

              <div className="text-sm text-muted-foreground truncate group-hover:text-primary group-hover:underline underline-offset-4">
                @{username}
              </div>

              {variant === "profile" && description ? (
                <p className="text-sm leading-snug line-clamp-2 text-foreground/90">
                  {description}
                </p>
              ) : null}

              {variant === "organization" && description ? (
                <div className="flex items-center gap-2 text-muted-foreground text-xs pt-2">
                  {getOrgTypeIcon(description)}
                  <span>{description}</span>
                </div>
              ) : !description && joinDate ? (
                <div className="text-muted-foreground text-xs pt-0.5">Joined {joinDate}</div>
              ) : null}
            </div>
          </div>
        </Link>
      </HoverCardContent>
    </HoverCard>
  );
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
