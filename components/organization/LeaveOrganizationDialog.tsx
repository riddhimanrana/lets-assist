"use client";
import { safeConsole } from "@/lib/safe-console";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { leaveOrganization } from "@/app/organization/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Organization } from "@/types";

/**
 * Confirmation for leaving an organization. Opened from the organization
 * header menu, so it carries no trigger of its own.
 */
export function LeaveOrganizationDialog({
  organization,
  userRole,
  open,
  onOpenChange,
}: {
  organization: Organization;
  userRole: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isLeaving, setIsLeaving] = useState(false);
  const router = useRouter();

  const handleLeave = async () => {
    setIsLeaving(true);
    try {
      const result = await leaveOrganization(organization.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Successfully left the organization");
      router.push("/organization");
    } catch (error) {
      safeConsole.error("Error leaving organization:", error);
      toast.error("Failed to leave organization");
    } finally {
      setIsLeaving(false);
      onOpenChange(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave {organization.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            You will lose access to all organization resources.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {userRole === "admin" ? (
          <Alert variant="warning">
            <AlertDescription>
              The last admin cannot leave. Promote another member to admin
              first.
            </AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLeaving}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleLeave}
            disabled={isLeaving}
          >
            {isLeaving ? (
              <>
                <Spinner data-icon="inline-start" />
                Leaving…
              </>
            ) : (
              "Leave organization"
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
