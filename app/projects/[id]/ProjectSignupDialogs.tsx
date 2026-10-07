"use client";

import type { ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { TurnstileComponent } from "@/components/ui/turnstile";
import { SecureCheckPanel } from "@/components/auth/SecureCheckPanel";
import type { AnonymousSlotOption } from "./project-details-types";
import type { ResendConfirmationState } from "./useResendConfirmation";

/** Asks a signed-out volunteer to sign in when the project requires an account. */
export function ProjectSignInDialog({
  open,
  onOpenChange,
  onLogin,
  onCreateAccount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogin: () => void;
  onCreateAccount: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Authentication required</DialogTitle>
          <DialogDescription>
            This project requires an account to sign up.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onCreateAccount}>
            Create new account
          </Button>
          <Button onClick={onLogin}>Log in to your account</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lets a signed-out volunteer pick several slots before one quick sign-up. */
export function ProjectSlotSelectionDialog({
  open,
  onOpenChange,
  options,
  selectedIds,
  onToggle,
  onCancel,
  onContinue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: AnonymousSlotOption[];
  selectedIds: string[];
  onToggle: (scheduleId: string, checked: boolean) => void;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Select your slots</DialogTitle>
          <DialogDescription>
            Want to sign up for more than one slot? Select all that apply, then
            continue to quick signup.
          </DialogDescription>
        </DialogHeader>

        {options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No additional slots are currently available.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {options.map((slot) => (
              <li key={slot.scheduleId}>
                <label className="hover:bg-muted/50 flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2.5">
                  <Checkbox
                    checked={selectedIds.includes(slot.scheduleId)}
                    onCheckedChange={(value) =>
                      onToggle(slot.scheduleId, value === true)
                    }
                    className="mt-0.5"
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-sm font-medium break-words">
                      {slot.title}
                    </span>
                    <span className="text-muted-foreground text-sm">
                      {slot.subtitle}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onContinue} disabled={selectedIds.length === 0}>
            Continue ({selectedIds.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Frames the quick sign-up form, which brings its own Cancel and Sign up. */
export function ProjectAnonymousSignupDialog({
  open,
  onOpenChange,
  selectedSlotCount,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSlotCount: number;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick sign up</DialogTitle>
          <DialogDescription>
            {selectedSlotCount > 1
              ? `You selected ${selectedSlotCount} slots. Fill this once and we'll apply it to all selected slots.`
              : "Please provide your information to sign up. You'll receive an email to confirm your spot."}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Offers a fresh confirmation email for a signup that was never confirmed. */
export function ProjectResendConfirmationDialog({
  resend,
}: {
  resend: ResendConfirmationState;
}) {
  const {
    showResendDialog,
    setShowResendDialog,
    isResending,
    resendTurnstileRef,
    resendTurnstileToken,
    setResendTurnstileToken,
    resendSecureCheck,
    showResendTurnstile,
    handleResendConfirmation,
  } = resend;

  return (
    <Dialog open={showResendDialog} onOpenChange={setShowResendDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Email confirmation pending</DialogTitle>
          <DialogDescription>
            You&apos;ve already signed up for this slot but haven&apos;t
            confirmed your email yet. Would you like us to resend the
            confirmation email?
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <p className="text-muted-foreground text-sm">
            Please check your inbox (and spam folder) for the original
            confirmation email. If you can&apos;t find it, click below to
            receive a new one.
          </p>

          {showResendTurnstile && (
            <Field>
              <FieldLabel>Verify before resending</FieldLabel>
              <FieldDescription>
                Complete the security check so we can safely send a fresh
                confirmation link.
              </FieldDescription>
              <SecureCheckPanel
                phase={resendSecureCheck.phase}
                onRetry={resendSecureCheck.retry}
                className="w-75 rounded-lg"
                fallbackClassName="w-75 rounded-lg"
              >
                <TurnstileComponent
                  action="anonymous-confirmation"
                  key={resendSecureCheck.widgetKey}
                  ref={resendTurnstileRef}
                  onLoad={resendSecureCheck.handleLoad}
                  onVerify={(token) => setResendTurnstileToken(token)}
                  onError={() => {
                    const wasReady = resendSecureCheck.isReady;
                    resendSecureCheck.handleError();
                    setResendTurnstileToken(null);

                    if (wasReady) {
                      toast.error(
                        "Security verification failed. Please try again.",
                      );
                    }
                  }}
                  onExpire={() => setResendTurnstileToken(null)}
                />
              </SecureCheckPanel>
            </Field>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setShowResendDialog(false)}
            disabled={isResending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleResendConfirmation}
            disabled={
              isResending || (showResendTurnstile && !resendTurnstileToken)
            }
          >
            {isResending ? (
              <>
                <Spinner data-icon="inline-start" />
                Sending...
              </>
            ) : (
              "Resend email"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
