"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Users, Loader2 } from "lucide-react";
import { joinOrganization } from "./actions";
import { useRouter } from "next/navigation";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";

export function JoinOrganizationDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const router = useRouter();

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
      console.error("Error joining organization:", error);
      toast.error("Failed to join organization. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setJoinCode("");
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Users className="w-4 h-4" />
          Join Organization
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-xl">Join an Organization</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter the 6-digit join code provided by the organization admin.
          </p>
          
          <div className="flex justify-center py-4">
            <InputOTP
              maxLength={6}
              value={joinCode}
              onChange={(value) => setJoinCode(value)}
              containerClassName="group flex items-center gap-2 disabled:opacity-50"
              className="[&_input]:w-10 [&_input]:h-12 [&_input]:text-center [&_input]:border [&_input]:rounded-md [&_input]:text-lg"
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
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button onClick={handleJoinSubmit} disabled={isLoading || joinCode.length !== 6}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Joining...
                </>
              ) : (
                "Join Organization"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
