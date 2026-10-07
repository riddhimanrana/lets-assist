"use client";
import { safeConsole } from "@/lib/safe-console";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { joinOrganization } from "@/app/organization/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Spinner } from "@/components/ui/spinner";

/**
 * Join-code entry opened from an organization profile. It submits the same
 * `joinOrganization` action as the directory's join dialog, so a visitor can
 * join from the page they are already on.
 */
export function JoinOrganizationCodeDialog({
  organizationName,
  open,
  onOpenChange,
}: {
  organizationName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const router = useRouter();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setJoinCode("");
    onOpenChange(nextOpen);
  };

  const handleJoinSubmit = async () => {
    if (joinCode.length !== 6) {
      toast.error("Please enter a valid 6-digit code");
      return;
    }

    setIsLoading(true);

    try {
      const result = await joinOrganization(joinCode);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Successfully joined the organization!");
      handleOpenChange(false);

      if (result.organizationUsername) {
        router.push(`/organization/${result.organizationUsername}`);
      }
      router.refresh();
    } catch (error) {
      safeConsole.error("Error joining organization:", error);
      toast.error("Failed to join organization. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join {organizationName}</DialogTitle>
          <DialogDescription>
            Enter the 6-digit join code from an organization admin.
          </DialogDescription>
        </DialogHeader>

        <form
          id="join-organization-code-form"
          className="flex justify-center"
          onSubmit={(event) => {
            event.preventDefault();
            void handleJoinSubmit();
          }}
        >
          <InputOTP
            maxLength={6}
            value={joinCode}
            onChange={(value) => setJoinCode(value)}
            disabled={isLoading}
            aria-label="Join code"
            autoFocus
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="join-organization-code-form"
            disabled={isLoading || joinCode.length !== 6}
          >
            {isLoading ? (
              <>
                <Spinner data-icon="inline-start" />
                Joining…
              </>
            ) : (
              "Join organization"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
