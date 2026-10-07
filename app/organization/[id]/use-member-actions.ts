"use client";

import { useState } from "react";
import { toast } from "sonner";

import { removeMember, updateMemberRole } from "./actions";
import type { OrganizationMember } from "./members-shared";

export type RemovingMember = { id: string; name: string };

/** Role changes and removal for the members table. */
export function useMemberActions({
  organizationId,
  currentUserId,
}: {
  organizationId: string;
  currentUserId: string | undefined;
}) {
  const [processingMember, setProcessingMember] = useState<string | null>(null);
  const [removingMember, setRemovingMember] = useState<RemovingMember | null>(
    null,
  );

  const handleUpdateRole = async (
    memberId: string,
    userId: string,
    userName: string,
    newRole: OrganizationMember["role"],
  ) => {
    if (userId === currentUserId && newRole !== "admin") {
      toast.error(
        "You cannot demote yourself. Another admin must change your role.",
      );
      return;
    }

    setProcessingMember(memberId);
    try {
      const result = await updateMemberRole(organizationId, memberId, newRole);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`${userName}'s role updated to ${newRole}`);
        // The member list is a server prop, so reload to pick up the change.
        window.location.reload();
      }
    } catch (error) {
      console.error("Error updating member role:", error);
      toast.error("Failed to update member role");
    } finally {
      setProcessingMember(null);
    }
  };

  const handleRemoveConfirm = async () => {
    if (!removingMember) return;

    setProcessingMember(removingMember.id);
    try {
      const result = await removeMember(organizationId, removingMember.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(
          `${removingMember.name} has been removed from the organization`,
        );
        window.location.reload();
      }
    } catch (error) {
      console.error("Error removing member:", error);
      toast.error("Failed to remove member");
    } finally {
      setProcessingMember(null);
      setRemovingMember(null);
    }
  };

  return {
    processingMember,
    removingMember,
    setRemovingMember,
    handleUpdateRole,
    handleRemoveConfirm,
  };
}
