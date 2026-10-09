"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function BanConfirmDialog({
  open,
  onOpenChange,
  displayName,
  durationLabel,
  reason,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  durationLabel: string;
  reason: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ban {displayName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {durationLabel === "Indefinitely"
              ? `This will indefinitely ban ${displayName} from signing in. Their data is preserved and the ban can be lifted at any time.`
              : `This will ban ${displayName} for ${durationLabel.toLowerCase()}. Their data is preserved and the ban will expire automatically.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {reason ? (
          <p className="text-sm font-medium">Reason: {reason}</p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Yes, ban user
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  displayName,
  email,
  reason,
  onReasonChange,
  confirmInput,
  onConfirmInputChange,
  canConfirm,
  isDeleting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  email: string | null;
  reason: string;
  onReasonChange: (value: string) => void;
  confirmInput: string;
  onConfirmInputChange: (value: string) => void;
  canConfirm: boolean;
  isDeleting: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Permanently delete &amp; blacklist {displayName}?
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">
              This will <strong>permanently delete all of their data</strong>{" "}
              (projects, sign-ups, certificates, org memberships, etc.) and{" "}
              <strong>blacklist their email address</strong> so they can never
              create a new account with it.
            </span>
            <span className="text-destructive block font-medium">
              This cannot be undone.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="delete-user-reason">
              Reason (optional)
            </FieldLabel>
            <Textarea
              id="delete-user-reason"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Why are you permanently removing this user?"
              className="min-h-20"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="delete-user-confirm" className="flex-wrap">
              Type <span className="font-mono font-semibold">{email}</span> to
              confirm
            </FieldLabel>
            <Input
              id="delete-user-confirm"
              value={confirmInput}
              onChange={(e) => onConfirmInputChange(e.target.value)}
              placeholder="Enter email address to confirm"
            />
          </Field>
        </FieldGroup>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {isDeleting ? "Deleting..." : "Delete & blacklist"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
