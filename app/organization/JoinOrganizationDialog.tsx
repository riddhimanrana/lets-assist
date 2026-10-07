"use client";
import { safeConsole } from "@/lib/safe-console";

import { useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { joinOrganization } from "./actions";
import { useRouter } from "next/navigation";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";

interface JoinOrganizationDialogProps {
  /**
   * Element that opens the dialog. Defaults to an outline "Join with code"
   * button. Pass `null` when the dialog is opened through `open` only.
   */
  trigger?: React.ReactElement | null;
  /** Controlled open state, for callers that open the dialog themselves. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function JoinOrganizationDialog({
  trigger,
  open,
  onOpenChange,
}: JoinOrganizationDialogProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const router = useRouter();
  const formId = useId();

  const isOpen = open ?? internalOpen;
  const setIsOpen = (next: boolean) => {
    if (!next) setJoinCode("");
    setInternalOpen(next);
    onOpenChange?.(next);
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
      setIsOpen(false);

      // Redirect to the organization page
      if (result.organizationUsername) {
        router.push(`/organization/${result.organizationUsername}`);
      } else {
        router.refresh();
      }
    } catch (error) {
      safeConsole.error("Error joining organization:", error);
      toast.error("Failed to join organization. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {trigger === null ? null : (
        <DialogTrigger
          render={trigger ?? <Button variant="outline">Join with code</Button>}
        />
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join an organization</DialogTitle>
          <DialogDescription>
            Enter the 6-digit join code from the organization admin.
          </DialogDescription>
        </DialogHeader>

        <form
          id={formId}
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
            aria-label="Join code"
            disabled={isLoading}
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
            onClick={() => setIsOpen(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={isLoading || joinCode.length !== 6}
          >
            {isLoading ? (
              <>
                <Spinner data-icon="inline-start" />
                Joining...
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
