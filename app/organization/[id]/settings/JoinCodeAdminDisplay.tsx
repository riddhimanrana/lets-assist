"use client";

import { useState } from "react";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Copy,
  Check,
  Link as LinkIcon,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { regenerateJoinCode } from "../../create/actions";
import { copyToClipboard } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface JoinCodeAdminDisplayProps {
  organizationId: string;
  joinCode: string;
}

export default function JoinCodeAdminDisplay({
  organizationId,
  joinCode,
}: JoinCodeAdminDisplayProps) {
  const [displayedJoinCode, setDisplayedJoinCode] = useState(joinCode);
  const [isCopied, setIsCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showRegenerateAlert, setShowRegenerateAlert] = useState(false);

  // Copy join code to clipboard
  const handleCopyCode = async () => {
    const success = await copyToClipboard(displayedJoinCode);
    if (success) {
      setIsCopied(true);
      toast.success("Join code copied to clipboard");

      // Reset copy confirmation after 2 seconds
      setTimeout(() => {
        setIsCopied(false);
      }, 2000);
    } else {
      toast.error("Failed to copy join code");
    }
  };

  const handleCopyLink = async () => {
    const link = new URL("/organization/join", window.location.origin);
    link.searchParams.set("code", displayedJoinCode);
    const success = await copyToClipboard(link.toString());
    if (success) toast.success("Invitation link copied");
    else toast.error("Failed to copy invitation link");
  };

  // Regenerate join code
  const handleRegenerateJoinCode = async () => {
    setIsRegenerating(true);

    try {
      const result = await regenerateJoinCode(organizationId);

      if (result.error) {
        toast.error(result.error);
      } else {
        setDisplayedJoinCode(result.joinCode);
        toast.success("Join code regenerated successfully");
      }
    } catch (error) {
      console.error("Error regenerating join code:", error);
      toast.error("Failed to regenerate join code");
    } finally {
      setIsRegenerating(false);
      setShowRegenerateAlert(false);
    }
  };

  return (
    <SettingsSection
      title="Join code"
      description="Share this code or its link so people can join as members."
      footerHint="Joining with the code adds a member. Assign staff access separately after they join."
      footer={
        <AlertDialog
          open={showRegenerateAlert}
          onOpenChange={setShowRegenerateAlert}
        >
          <AlertDialogTrigger
            render={
              <Button variant="outline" type="button" disabled={isRegenerating}>
                <RefreshCw />
                Regenerate code
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Regenerate join code?</AlertDialogTitle>
              <AlertDialogDescription>
                This will invalidate the current join code. Anyone using the old
                code will no longer be able to join.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRegenerating}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRegenerateJoinCode}
                disabled={isRegenerating}
              >
                {isRegenerating ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  "Regenerate code"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
    >
      <Field>
        <FieldLabel htmlFor="join-code">Current join code</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id="join-code"
            value={displayedJoinCode}
            readOnly
            className="font-mono text-base tracking-wider"
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Copy join code"
            onClick={handleCopyCode}
          >
            {isCopied ? <Check className="text-success" /> : <Copy />}
          </Button>
        </div>
      </Field>
      <div>
        <Button type="button" variant="outline" onClick={handleCopyLink}>
          <LinkIcon aria-hidden="true" />
          Copy invitation link
        </Button>
      </div>
    </SettingsSection>
  );
}
