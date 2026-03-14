"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Share2, GlobeIcon, UsersIcon, Plus, Building2, BadgeCheck, GraduationCap, Building } from "lucide-react";
import { useState } from "react";
import JoinCodeDialog from "@/app/organization/[id]/JoinCodeDialog";
import { useRouter } from "next/navigation";
import type { Organization } from "@/types";
import { toast } from "sonner";
import { copyToClipboard, isMobileDevice } from "@/lib/utils";

type OrganizationHeaderOrg = Organization & {
  website?: string | null;
};

interface OrganizationHeaderProps {
  organization: OrganizationHeaderOrg;
  userRole: string | null;
  memberCount: number;
}

export default function OrganizationHeader({
  organization,
  userRole,
  memberCount,
}: OrganizationHeaderProps) {
  const [showJoinCode, setShowJoinCode] = useState(false);
  const isAdmin = userRole === "admin";
  const router = useRouter();
  
  const getInitials = (name: string) => {
    return name
      ? name.split(' ').map(part => part[0]).join('').toUpperCase().substring(0, 2)
      : "ORG";
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (isMobileDevice() && typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `${organization.name} - Let's Assist`,
          text: `Check out ${organization.name} on Let's Assist!`,
          url
        });
        return;
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          console.error("Share failed: ", err);
          toast.error("Could not share link");
        } else {
          return;
        }
      }
    }

    const success = await copyToClipboard(url);
    if (success) {
      toast.success("Organization link copied to clipboard");
    } else {
      toast.error("Could not copy link to clipboard");
    }
  };

  // Update this function to use URL parameter instead of cookie
  const handleCreateProject = () => {
    router.push(`/projects/create?org=${organization.id}`);
  };

  const canCreateProjects = userRole === "admin" || userRole === "staff";

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col items-center gap-4 md:flex-row md:items-start">
          <div className="relative shrink-0">
            <Avatar className="h-20 w-20 rounded-full border-4 border-background shadow-sm md:h-24 md:w-24">
              <AvatarImage src={organization.logo_url || undefined} alt={organization.name} />
              <AvatarFallback className="bg-primary/10 text-xl rounded-full">
                {(() => {
                  switch (organization.type) {
                    case 'company':
                      return <Building2 className="h-10 w-10 text-primary/60" />;
                    case 'school':
                      return <GraduationCap className="h-10 w-10 text-primary/60" />;
                    case 'government':
                      return <Building className="h-10 w-10 text-primary/60" />;
                    case 'nonprofit':
                    case 'other':
                    default:
                      return getInitials(organization.name);
                  }
                })()}
              </AvatarFallback>
            </Avatar>
            {organization.verified && (
              <div className="absolute -bottom-0.5 -right-0.5 bg-background rounded-full shadow-sm border flex items-center justify-center p-0.5 md:hidden">
                <BadgeCheck className="h-4 w-4 text-primary fill-background" />
              </div>
            )}
          </div>

          <div className="flex flex-col items-center text-center md:items-start md:text-left space-y-2">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
                {organization.name}
              </h1>
              {organization.verified && (
                <BadgeCheck
                  className="hidden md:block h-6 w-6 text-primary"
                />
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 md:justify-start">
              <Badge variant="secondary" className="capitalize">
                {(() => {
                  switch (organization.type) {
                    case 'nonprofit':
                      return 'Nonprofit';
                    case 'school':
                      return 'Educational';
                    case 'company':
                      return 'Company';
                    case 'government':
                      return 'Government';
                    case 'other':
                      return 'Other';
                    default:
                      return organization.type;
                  }
                })()}
              </Badge>

              {organization.username && (
                <span className="text-sm text-muted-foreground font-mono">
                  @{organization.username}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground md:justify-start">
              {organization.website && (
                <a
                  href={organization.website.startsWith('http') ? organization.website : `https://${organization.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <GlobeIcon className="h-3.5 w-3.5" />
                  <span>
                    {organization.website.replace(/^https?:\/\/(www\.)?/, '')}
                  </span>
                </a>
              )}

              <div className="flex items-center gap-1">
                <UsersIcon className="h-3.5 w-3.5" />
                <span>{memberCount} {memberCount === 1 ? 'Member' : 'Members'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto md:items-center">
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={handleShare}
          >
            <Share2 className="mr-2 h-4 w-4" />
            Share
          </Button>

          {isAdmin && (
            <Button
              variant="default"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => setShowJoinCode(true)}
            >
              <UsersIcon className="mr-2 h-4 w-4" />
              Invite
            </Button>
          )}

          {userRole === null && (
            <Button
              variant="default"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => toast.info("Get the join code from an admin and join from the organizations page", {
                action: {
                  label: "Go to Organizations",
                  onClick: () => window.location.href = "/organization"
                }
              })}
            >
              <Plus className="mr-2 h-4 w-4" />
              Join
            </Button>
          )}

          {canCreateProjects && (
            <Button
              onClick={handleCreateProject}
              size="sm"
              className="w-full sm:w-auto"
            >
              <Plus className="mr-2 h-4 w-4" />
              Project
            </Button>
          )}
        </div>
      </div>

      {showJoinCode && isAdmin && (
        <JoinCodeDialog
          organization={organization}
          open={showJoinCode}
          onOpenChange={setShowJoinCode}
        />
      )}
    </div>
  );
}
