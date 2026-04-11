"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Shield, Loader2 } from "lucide-react";
import { TurnstileComponent } from "@/components/ui/turnstile";
import { useBotVerification } from "@/hooks/useBotVerification";

interface BotVerificationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onVerified: (token: string) => void;
  title?: string;
  description?: string;
  submitLabel?: string;
  isLoading?: boolean;
  isSingleStep?: boolean; // If true, auto-verifies and closes on success
}

export function BotVerificationDialog({
  isOpen,
  onClose,
  onVerified,
  title = "Verify You're Human",
  description = "Complete the security challenge to continue.",
  submitLabel = "Verify",
  isLoading = false,
  isSingleStep = false,
}: BotVerificationDialogProps) {
  const verification = useBotVerification({
    onSuccess: (token) => {
      if (isSingleStep) {
        // Auto-close and verify if single step
        onVerified(token);
        onClose();
      }
    },
  });

  const handleSubmit = () => {
    if (verification.isVerified()) {
      const token = verification.token;
      if (token) {
        onVerified(token);
        // Only close if not auto-closing (non-single-step)
        if (!isSingleStep) {
          onClose();
        }
      }
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      verification.reset();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex justify-center py-6">
          <TurnstileComponent
            ref={verification.ref}
            onVerify={verification.onVerify}
            onError={verification.onError}
            onLoad={verification.onLoad}
            theme="auto"
          />
        </div>

        {verification.error && (
          <p className="text-sm text-destructive text-center">{verification.error}</p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!verification.isVerified() || isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {submitLabel}...
              </>
            ) : (
              submitLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
