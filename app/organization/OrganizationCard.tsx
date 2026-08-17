"use client";

import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users2,
  BadgeCheck,
  Shield,
  UserRoundCog,
  UserRound,
  EyeOff,
} from "lucide-react";
import { NoAvatar } from "@/components/shared/NoAvatar";
import type { Organization } from "@/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

interface OrganizationCardProps {
  org: OrganizationCardOrg;
  /**
   * Visible member count. `null` means the organization keeps its member list
   * private, which is different from genuinely having no members — the card
   * says so instead of rendering a misleading "0 members".
   */
  memberCount: number | null;
  isUserMember?: boolean;
  userRole?: "admin" | "staff" | "member";
}

export default function OrganizationCard({
  org,
  memberCount,
  isUserMember = false,
  userRole,
}: OrganizationCardProps) {
  return (
    <Link
      href={`/organization/${org.username}`}
      className="block h-full group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card
        className={`h-full flex flex-col transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 ${isUserMember ? "ring-primary/30 bg-primary/5" : "hover:ring-primary/25"}`}
      >
        <CardHeader className="flex flex-row items-start gap-3">
          <Avatar className="h-12 w-12 border border-border shrink-0">
            <AvatarImage src={org.logo_url || undefined} alt={org.name} />
            <AvatarFallback>
              <NoAvatar fullName={org.name} />
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <CardTitle className="text-base font-bold truncate leading-tight group-hover:text-primary transition-colors">
                {org.name}
              </CardTitle>
              {org.verified && (
                <Tooltip>
                  <TooltipTrigger aria-label="Verified organization">
                    <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Verified Organization</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <CardDescription className="text-xs truncate">
              @{org.username}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <div className="flex flex-wrap gap-2 mb-2">
            <Badge
              variant="outline"
              className="text-[10px] h-5 px-1.5 capitalize"
            >
              {org.type}
            </Badge>
            {isUserMember && userRole && (
              <Badge
                variant={
                  userRole === "admin"
                    ? "default"
                    : userRole === "staff"
                      ? "info"
                      : "outline"
                }
                className="text-[10px] h-5 px-1.5 flex items-center gap-1"
              >
                {userRole === "admin" && <Shield className="h-3 w-3" />}
                {userRole === "staff" && <UserRoundCog className="h-3 w-3" />}
                {userRole === "member" && <UserRound className="h-3 w-3" />}
                {userRole.charAt(0).toUpperCase() + userRole.slice(1)}
              </Badge>
            )}
          </div>

          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed break-words min-h-[2.4rem]">
            {org.description || "No description provided."}
          </p>
        </CardContent>

        <CardFooter className="px-4 py-0 h-10 text-[11px] font-medium text-muted-foreground flex items-center justify-start bg-muted/10">
          {memberCount === null ? (
            <div className="flex items-center gap-1.5">
              <EyeOff className="h-3.5 w-3.5" />
              <span>Members private</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Users2 className="h-3.5 w-3.5" />
              <span>
                {memberCount.toLocaleString()} member
                {memberCount !== 1 ? "s" : ""}
              </span>
            </div>
          )}
        </CardFooter>
      </Card>
    </Link>
  );
}
