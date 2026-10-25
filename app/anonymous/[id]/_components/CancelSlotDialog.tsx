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
import { Spinner } from "@/components/ui/spinner";

export function CancelSlotDialog({
  open,
  onOpenChange,
  isOnlySlot,
  isCancelling,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOnlySlot: boolean;
  isCancelling: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel slot signup</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to cancel this slot signup? This action cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm text-pretty">
          <span className="font-medium">Important.</span>{" "}
          {isOnlySlot
            ? "This is your only active slot signup. Cancelling it keeps the private profile and retained waiver evidence available until scheduled cleanup."
            : "This will cancel your signup for this specific slot. Your other slot signups will remain active."}
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isCancelling}>
            Keep my signup
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={onConfirm}
            disabled={isCancelling}
          >
            {isCancelling && (
              <Spinner data-icon="inline-start" aria-hidden="true" />
            )}
            {isCancelling ? "Cancelling..." : "Yes, cancel slot"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
