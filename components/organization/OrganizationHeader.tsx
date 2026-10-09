"use client";

import { BadgeCheck, GlobeIcon, UsersIcon } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatOrganizationWebsiteDisplay } from "@/lib/organization/website";
import { cn } from "@/lib/utils";
import type { Organization } from "@/types";
import { OrganizationHeaderActions } from "./OrganizationHeaderActions";
import {
  formatOrganizationTypeLabel,
  organizationWebsiteHref,
} from "./organization-type-label";

type OrganizationHeaderOrg = Organization & {
  website?: string | null;
};

interface OrganizationHeaderProps {
  organization: OrganizationHeaderOrg;
  userRole: string | null;
  memberCount: number;
  showMemberCount?: boolean;
  showInviteAction?: boolean;
  showProjectAction?: boolean;
  /** False when the organization has no Members tab to link to. */
  showMembersLink?: boolean;
  compact?: boolean;
}

function getInitials(name: string) {
  return name
    ? name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .toUpperCase()
        .substring(0, 2)
    : "ORG";
}

export default function OrganizationHeader({
  organization,
  userRole,
  memberCount,
  showMemberCount = true,
  showInviteAction = true,
  showProjectAction = true,
  showMembersLink = true,
  compact = false,
}: OrganizationHeaderProps) {
  const typeLabel = formatOrganizationTypeLabel(organization.type);
  const memberCountLabel = `${memberCount} ${memberCount === 1 ? "member" : "members"}`;

  const avatar = (
    <Avatar className={cn(compact ? "size-10 md:size-12" : "size-14")}>
      <AvatarImage
        src={organization.logo_url || undefined}
        alt={organization.name}
      />
      {/*
        Decorative brand tint behind the monogram. The monogram itself stays on
        --foreground, and the verified badge stays on --primary, because that
        one reports state.
      */}
      <AvatarFallback className="bg-brand/10 rounded-full text-lg font-semibold">
        {getInitials(organization.name)}
      </AvatarFallback>
    </Avatar>
  );

  const actions = (
    <OrganizationHeaderActions
      organization={organization}
      userRole={userRole}
      showInviteAction={showInviteAction}
      showProjectAction={showProjectAction}
      showMembersLink={showMembersLink}
    />
  );

  if (!compact) {
    return (
      <PageHeader
        media={avatar}
        title={
          <span className="wrap-break-word whitespace-normal">
            {organization.name}
            {organization.verified && (
              <>
                {" "}
                <BadgeCheck
                  className="inline-block size-5 shrink-0 align-[-0.125em] text-primary fill-background"
                  aria-hidden="true"
                />
                <span className="sr-only">Verified organization</span>
              </>
            )}
          </span>
        }
        meta={
          <>
            {typeLabel ? <span>{typeLabel}</span> : null}
            {organization.username && <span>@{organization.username}</span>}
            {organization.website && (
              <a
                href={organizationWebsiteHref(organization.website)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground inline-flex min-w-0 items-center gap-1 transition-colors"
              >
                <GlobeIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {formatOrganizationWebsiteDisplay(organization.website)}
                </span>
              </a>
            )}
            {showMemberCount ? <span>{memberCountLabel}</span> : null}
          </>
        }
        actions={actions}
      />
    );
  }

  /*
    Compact mode is a single row that wraps intentionally: the identity region
    owns the free space and truncates, and the actions keep their natural width
    so a long organization name can never push Share (or the identity itself)
    outside a 390px viewport.
  */
  return (
    <div className="flex w-full min-w-0 flex-row flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 grow basis-48 flex-row items-center gap-2.5">
        {avatar}

        <div className="flex min-w-0 flex-col items-start gap-1 overflow-hidden text-left">
          <div className="flex max-w-full min-w-0 items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight md:text-xl">
              {organization.name}
            </h1>
            {organization.verified && (
              <>
                <BadgeCheck
                  className="size-5 shrink-0 text-primary fill-background"
                  aria-hidden="true"
                />
                <span className="sr-only">Verified organization</span>
              </>
            )}
          </div>

          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            {typeLabel ? <Badge variant="secondary">{typeLabel}</Badge> : null}

            {organization.username && (
              <span className="text-muted-foreground truncate text-sm">
                @{organization.username}
              </span>
            )}
          </div>

          <div className="text-muted-foreground flex min-w-0 max-w-full flex-wrap items-center gap-4 text-sm">
            {organization.website && (
              <a
                href={organizationWebsiteHref(organization.website)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground flex min-w-0 items-center gap-1 transition-colors"
              >
                <GlobeIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {formatOrganizationWebsiteDisplay(organization.website)}
                </span>
              </a>
            )}

            {showMemberCount ? (
              <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                <UsersIcon className="size-3.5" aria-hidden="true" />
                <span>{memberCountLabel}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex w-auto shrink-0 flex-row items-center justify-end gap-2">
        {actions}
      </div>
    </div>
  );
}
