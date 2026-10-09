"use client";

import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BadgeCheck } from "lucide-react";
import { NoAvatar } from "@/components/shared/NoAvatar";
import type { Organization } from "@/types";

type OrganizationCardOrg = Omit<
  Organization,
  "description" | "website" | "logo_url" | "type"
> & {
  description?: string | null;
  website?: string | null;
  logo_url?: string | null;
  type?: string | null;
  verified?: boolean;
};

export type OrganizationRole = "admin" | "staff" | "member";

interface OrganizationCardProps {
  org: OrganizationCardOrg;
  /**
   * Visible member count. `null` means the organization keeps its member list
   * private, which is different from genuinely having no members — the card
   * says so instead of rendering a misleading "0 members".
   */
  memberCount: number | null;
  isUserMember?: boolean;
  userRole?: OrganizationRole;
}

const ORGANIZATION_TYPE_LABELS: Record<string, string> = {
  nonprofit: "Nonprofit",
  school: "Educational",
  company: "Company",
  government: "Government",
  other: "Other",
};

/** Short label for an organization type, matching the organization header. */
export function organizationTypeLabel(type?: string | null): string | null {
  if (!type) return null;
  return (
    ORGANIZATION_TYPE_LABELS[type] ??
    type.charAt(0).toUpperCase() + type.slice(1)
  );
}

export function memberCountLabel(memberCount: number | null): string {
  if (memberCount === null) return "Members private";
  return `${memberCount.toLocaleString()} member${memberCount !== 1 ? "s" : ""}`;
}

export function OrganizationRoleBadge({ role }: { role: OrganizationRole }) {
  return (
    <Badge
      variant={
        role === "admin" ? "default" : role === "staff" ? "info" : "outline"
      }
    >
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </Badge>
  );
}

export default function OrganizationCard({
  org,
  memberCount,
  isUserMember = false,
  userRole,
}: OrganizationCardProps) {
  const typeLabel = organizationTypeLabel(org.type);

  return (
    <Link
      href={`/organization/${org.username}`}
      className="group focus-visible:ring-ring/50 block h-full rounded-xl outline-none focus-visible:ring-[3px]"
    >
      <Card className="group-hover:bg-muted/40 group-hover:ring-foreground/20 h-full transition-colors">
        <CardHeader className="flex flex-row items-center gap-3">
          <Avatar size="lg">
            <AvatarImage src={org.logo_url || undefined} alt={org.name} />
            <AvatarFallback>
              <NoAvatar fullName={org.name} />
            </AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 flex-1 gap-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <CardTitle className="line-clamp-2 break-words">
                {org.name}
              </CardTitle>
              {org.verified && (
                <BadgeCheck
                  role="img"
                  aria-label="Verified organization"
                  className="text-primary size-4 shrink-0"
                />
              )}
            </div>
            <CardDescription className="truncate">
              @{org.username}
            </CardDescription>
          </div>
          {isUserMember && userRole ? (
            <OrganizationRoleBadge role={userRole} />
          ) : null}
        </CardHeader>

        <CardContent className="flex flex-1 flex-col gap-3">
          {org.description ? (
            <p className="text-muted-foreground line-clamp-2 text-sm break-words">
              {org.description}
            </p>
          ) : null}
          <p className="text-muted-foreground mt-auto text-sm">
            {typeLabel ? `${typeLabel} · ` : ""}
            {memberCountLabel(memberCount)}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
