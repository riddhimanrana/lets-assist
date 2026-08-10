"use client";

import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export function SignupConfirmationActionFrame({
  children,
  isLoading,
  isOpen,
  onClose,
}: {
  children: ReactNode;
  isLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isLoading) onClose();
      }}
    >
      {children}
    </Dialog>
  );
}

export function SignupConfirmationActionContent({
  children,
  isLoading,
}: {
  children: ReactNode;
  isLoading: boolean;
}) {
  return (
    <DialogContent
      className="w-[95vw] max-h-[90vh] overflow-y-auto"
      showCloseButton={!isLoading}
      aria-busy={isLoading}
    >
      {children}
    </DialogContent>
  );
}

export function SignupConfirmationActionFeedback({
  error,
  isLoading,
}: {
  error: string | null;
  isLoading: boolean;
}) {
  return (
    <>
      {error ? (
        <Alert variant="destructive" role="alert" aria-live="assertive">
          <AlertTitle>Signup not completed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        className="min-h-5 text-sm text-muted-foreground"
      >
        {isLoading ? "Saving your signup…" : null}
      </p>
    </>
  );
}
