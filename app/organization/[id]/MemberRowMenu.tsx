"use client";

import { Clock, Loader2, MoreHorizontal, UserRoundX } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  MEMBER_ROLE_LABELS,
  getMemberName,
  getMemberProfile,
  type OrganizationMember,
} from "./members-shared";

type MemberRole = OrganizationMember["role"];

/**
 * Roles the viewer may assign to this member. Admins can assign any role;
 * staff can only promote a regular member to staff. Nobody edits themselves.
 */
export function assignableMemberRoles({
  viewerRole,
  currentUserId,
  member,
}: {
  viewerRole: string | null;
  currentUserId: string | undefined;
  member: OrganizationMember;
}): MemberRole[] {
  if (member.user_id === currentUserId) return [];
  if (viewerRole === "admin") return ["admin", "staff", "member"];
  if (viewerRole === "staff" && member.role === "member") {
    return ["staff", "member"];
  }
  return [];
}

export function MemberRowMenu({
  member,
  viewerRole,
  currentUserId,
  processing,
  onViewHours,
  onUpdateRole,
  onRemove,
}: {
  member: OrganizationMember;
  viewerRole: string | null;
  currentUserId: string | undefined;
  processing: boolean;
  onViewHours: (member: OrganizationMember) => void;
  onUpdateRole: (
    memberId: string,
    userId: string,
    userName: string,
    newRole: MemberRole,
  ) => void;
  onRemove: (member: { id: string; name: string }) => void;
}) {
  const name = getMemberName(member);
  const actionName = getMemberProfile(member)?.full_name || "Member";
  const roles = assignableMemberRoles({ viewerRole, currentUserId, member });
  const canManage = roles.length > 0;

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${name}`}
              disabled={processing}
            >
              {processing ? (
                <Loader2 className="animate-spin" />
              ) : (
                <MoreHorizontal />
              )}
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => onViewHours(member)}>
            <Clock />
            View hours
          </DropdownMenuItem>

          {canManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Role</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={member.role}
                  onValueChange={(value) => {
                    const newRole = value as MemberRole;
                    if (newRole === member.role) return;
                    onUpdateRole(
                      member.id,
                      member.user_id,
                      actionName,
                      newRole,
                    );
                  }}
                >
                  {roles.map((role) => (
                    <DropdownMenuRadioItem key={role} value={role}>
                      {MEMBER_ROLE_LABELS[role]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onRemove({ id: member.id, name: actionName })}
              >
                <UserRoundX />
                Remove from organization
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
