"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";

import { leaveOrganization } from "@/app/organization/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Organization } from "@/types";

export function LeaveOrganizationDialog({
  organization,
  userRole,
}: {
  organization: Organization;
  userRole: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
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
      console.error("Error leaving organization:", error);
      toast.error("Failed to leave organization");
    } finally {
      setIsLeaving(false);
      setIsOpen(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            className="w-full sm:w-auto text-destructive hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Leave Organization
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave Organization</DialogTitle>
          <DialogDescription>
            Are you sure you want to leave this organization? You will lose
            access to all organization resources.
            {userRole === "admin" && (
              <div className="mt-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                As an admin, you cannot leave if you are the last admin. Please
                promote another member to admin first.
              </div>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setIsOpen(false)}
            disabled={isLeaving}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleLeave}
            disabled={isLeaving}
          >
            {isLeaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Leaving…
              </>
            ) : (
              "Leave Organization"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
