"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Ellipsis,
  LogOut,
  Settings,
  Share2,
  ShieldAlert,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  PlusIcon,
  UserPlusIcon,
  useAnimatedIcon,
} from "@/components/icons/animated";
import JoinCodeDialog from "@/app/organization/[id]/JoinCodeDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyToClipboard, isMobileDevice } from "@/lib/utils";
import type { Organization } from "@/types";
import { JoinOrganizationCodeDialog } from "./JoinOrganizationCodeDialog";
import { LeaveOrganizationDialog } from "./LeaveOrganizationDialog";

type Props = {
  organization: Organization;
  userRole: string | null;
  showInviteAction: boolean;
  showProjectAction: boolean;
  showMembersLink: boolean;
};

/**
 * The organization header's actions, by role. At most one filled button shows:
 * "Join" for visitors, "New project" for staff and admins. The links staff and
 * admins reach less often (settings for admins, members directory, moderation)
 * and "Leave organization" live in the overflow menu.
 */
export function OrganizationHeaderActions({
  organization,
  userRole,
  showInviteAction,
  showProjectAction,
  showMembersLink,
}: Props) {
  const [showJoinCode, setShowJoinCode] = useState(false);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const inviteIcon = useAnimatedIcon();
  const joinIcon = useAnimatedIcon();
  const projectIcon = useAnimatedIcon();

  const isAdmin = userRole === "admin";
  const isStaffOrAdmin = userRole === "admin" || userRole === "staff";
  const organizationPath = `/organization/${organization.username || organization.id}`;

  const handleShare = async () => {
    const url = window.location.href;
    if (
      isMobileDevice() &&
      typeof navigator !== "undefined" &&
      navigator.share
    ) {
      try {
        await navigator.share({
          title: `${organization.name} - Let's Assist`,
          text: `Check out ${organization.name} on Let's Assist!`,
          url,
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

  return (
    <>
      <Button variant="outline" className="shrink-0" onClick={handleShare}>
        <Share2 data-icon="inline-start" aria-hidden="true" />
        Share
      </Button>

      {isAdmin && showInviteAction && (
        <Button
          variant="outline"
          className="shrink-0"
          onClick={() => setShowJoinCode(true)}
          {...inviteIcon.triggerProps}
        >
          <UserPlusIcon
            ref={inviteIcon.ref}
            size={16}
            data-icon="inline-start"
            aria-hidden="true"
          />
          Invite
        </Button>
      )}

      {userRole === null && (
        <Button
          className="shrink-0"
          onClick={() => setShowJoinDialog(true)}
          {...joinIcon.triggerProps}
        >
          <PlusIcon
            ref={joinIcon.ref}
            size={16}
            data-icon="inline-start"
            aria-hidden="true"
          />
          Join
        </Button>
      )}

      {isStaffOrAdmin && showProjectAction && (
        <Button
          className="shrink-0"
          nativeButton={false}
          render={<Link href={`/projects/create?org=${organization.id}`} />}
          {...projectIcon.triggerProps}
        >
          <PlusIcon
            ref={projectIcon.ref}
            size={16}
            data-icon="inline-start"
            aria-hidden="true"
          />
          New project
        </Button>
      )}

      {userRole !== null && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                aria-label="More organization actions"
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            {isStaffOrAdmin && (
              <>
                <DropdownMenuGroup>
                  {isAdmin && (
                    <DropdownMenuItem
                      render={<Link href={`${organizationPath}/settings`} />}
                    >
                      <Settings aria-hidden="true" />
                      Settings
                    </DropdownMenuItem>
                  )}
                  {showMembersLink && (
                    <DropdownMenuItem
                      render={<Link href={`${organizationPath}?tab=members`} />}
                    >
                      <UsersIcon aria-hidden="true" />
                      Members directory
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    render={<Link href={`${organizationPath}/moderation`} />}
                  >
                    <ShieldAlert aria-hidden="true" />
                    Moderation
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setShowLeaveDialog(true)}
            >
              <LogOut aria-hidden="true" />
              Leave organization
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {showJoinCode && isAdmin && (
        <JoinCodeDialog
          organization={organization}
          open={showJoinCode}
          onOpenChange={setShowJoinCode}
        />
      )}

      {userRole === null && (
        <JoinOrganizationCodeDialog
          organizationName={organization.name}
          open={showJoinDialog}
          onOpenChange={setShowJoinDialog}
        />
      )}

      {userRole !== null && (
        <LeaveOrganizationDialog
          organization={organization}
          userRole={userRole}
          open={showLeaveDialog}
          onOpenChange={setShowLeaveDialog}
        />
      )}
    </>
  );
}
