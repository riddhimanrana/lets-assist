"use client";

import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BadgeCheck, EyeOff, Users } from "lucide-react";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { cn } from "@/lib/utils";
import type { Organization } from "@/types";
import { MemberRoleBadge } from "./[id]/MemberRoleBadge";

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
  /**
   * Tints the card with the primary wash and edge. The directory sets it for
   * the viewer's own organizations; other callers stay neutral.
   */
  highlightMembership?: boolean;
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
  return `${memberCount.toLocaleString("en-US")} member${memberCount !== 1 ? "s" : ""}`;
}

/** The directory's role badge. One presentation, owned by `MemberRoleBadge`. */
export function OrganizationRoleBadge({ role }: { role: OrganizationRole }) {
  return <MemberRoleBadge role={role} />;
}

export default function OrganizationCard({
  org,
  memberCount,
  isUserMember = false,
  userRole,
  highlightMembership = false,
}: OrganizationCardProps) {
  const typeLabel = organizationTypeLabel(org.type);
  const role = isUserMember ? userRole : undefined;
  const FooterIcon = memberCount === null ? EyeOff : Users;

  return (
    <Link
      href={`/organization/${org.username}`}
      className="group focus-visible:ring-ring/50 block h-full rounded-xl outline-none focus-visible:ring-[3px]"
    >
      <Card
        className={cn(
          "h-full transition-colors",
          highlightMembership
            ? "bg-brand/5 ring-primary/25 group-hover:bg-brand/10 group-hover:ring-primary/40"
            : "group-hover:bg-muted/40 group-hover:ring-foreground/20",
        )}
      >
        <CardHeader className="flex flex-row items-start gap-3">
          <Avatar size="lg">
            <AvatarImage src={org.logo_url || undefined} alt="" />
            <AvatarFallback>
              <NoAvatar fullName={org.name} />
            </AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 flex-1 gap-0.5">
            <div className="flex min-w-0 items-start gap-1.5">
              <CardTitle className="line-clamp-2 break-words">
                {org.name}
              </CardTitle>
              {org.verified && (
                <BadgeCheck
                  role="img"
                  aria-label="Verified organization"
                  className="text-primary mt-0.5 size-4 shrink-0"
                />
              )}
            </div>
            <CardDescription className="truncate">
              @{org.username}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-1 flex-col gap-3">
          {typeLabel || role ? (
            <div className="flex flex-wrap items-center gap-2">
              {typeLabel ? <Badge variant="outline">{typeLabel}</Badge> : null}
              {role ? <OrganizationRoleBadge role={role} /> : null}
            </div>
          ) : null}
          {org.description ? (
            <p className="text-muted-foreground line-clamp-2 text-sm break-words">
              {org.description}
            </p>
          ) : null}
        </CardContent>

        {/* The count sits in its own footer row. A private member list keeps
            its own icon and wording and never reads as zero. */}
        <CardFooter
          className={cn(
            "text-muted-foreground gap-2 bg-transparent py-3 text-sm",
            highlightMembership && "border-primary/15",
          )}
        >
          <FooterIcon className="size-4 shrink-0" aria-hidden="true" />
          <span>{memberCountLabel(memberCount)}</span>
        </CardFooter>
      </Card>
    </Link>
  );
}
