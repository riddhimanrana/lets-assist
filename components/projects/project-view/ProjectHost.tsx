"use client";

import { BadgeCheck } from "lucide-react";

import { NoAvatar } from "@/components/shared/NoAvatar";
import {
  OrganizationHoverCard,
  ProfileHoverCard,
} from "@/components/shared/ProfileHoverCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import {
  getCreatorAvatarUrl,
  getProjectCreator,
  isOrganizationVerified,
} from "./project-display";
import type { ProjectWithExtras } from "./types";

/**
 * Who runs a project: a small avatar, the organization or creator name with
 * its hover card, and the verified mark. Shared by every feed view.
 */
export function ProjectHost({
  project,
  className,
}: {
  project: ProjectWithExtras;
  className?: string;
}) {
  const name = getProjectCreator(project);
  const avatarUrl = getCreatorAvatarUrl(project);
  const verified = isOrganizationVerified(project);

  const identity = (
    <span className="flex min-w-0 cursor-pointer items-center gap-2">
      <Avatar className="size-5">
        <AvatarImage src={avatarUrl || undefined} alt="" />
        <AvatarFallback>
          <NoAvatar fullName={name} className="text-xs" />
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{name}</span>
    </span>
  );

  return (
    <div
      className={cn(
        "text-muted-foreground flex min-w-0 items-center gap-1.5 text-sm",
        className,
      )}
    >
      {project.organization_id ? (
        <OrganizationHoverCard
          organization={{
            username:
              project.organization?.username ||
              project.organizations?.username ||
              "",
            name,
            logo_url: avatarUrl,
            verified,
            type: project.organization?.type || project.organizations?.type,
          }}
        >
          {identity}
        </OrganizationHoverCard>
      ) : (
        <ProfileHoverCard
          username={project.profiles?.username || ""}
          fullName={name}
          avatarUrl={avatarUrl || undefined}
          createdAt={project.profiles?.created_at || undefined}
        >
          {identity}
        </ProfileHoverCard>
      )}
      {project.organization_id && verified ? (
        <BadgeCheck
          className="text-success size-4 shrink-0"
          aria-label="Verified organization"
        />
      ) : null}
    </div>
  );
}
