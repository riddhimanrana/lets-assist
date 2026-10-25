"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { createDeletionCountdown } from "./account-deletion-countdown";
import { deleteAccount } from "./actions";

const COUNTDOWN_SECONDS = 5;

export default function AccountDeletionSection() {
  const [isDeleting, setIsDeleting] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  // True only while the server request is running, after the countdown ended.
  const requestInFlightRef = useRef(false);

  const runDeletion = useCallback(async () => {
    requestInFlightRef.current = true;
    try {
      const result = await deleteAccount();
      if (result.success) {
        localStorage.clear();
        sessionStorage.clear();
        // Account deletion must reload the document so no authenticated client state survives.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/?deleted=true&noRedirect=1";
        return;
      }
      toast.error(result.error);
    } catch {
      toast.error(
        "Account cleanup could not be confirmed. Retry deletion or contact support.",
      );
    }
    requestInFlightRef.current = false;
    setIsDeleting(false);
    setCountdown(COUNTDOWN_SECONDS);
    setDeleteConfirmation("");
    setShowDeleteDialog(false);
  }, []);

  // One controller for the component's lifetime. It only closes over stable
  // setters, and it is the single path to the delete server action.
  const [deletionCountdown] = useState(() =>
    createDeletionCountdown({
      seconds: COUNTDOWN_SECONDS,
      schedule: (callback, milliseconds) => setTimeout(callback, milliseconds),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      onTick: setCountdown,
      commit: () => void runDeletion(),
    }),
  );

  // Leaving the page is also backing out.
  useEffect(() => () => deletionCountdown.cancel(), [deletionCountdown]);

  const handleDeleteAccount = () => {
    if (deleteConfirmation !== "delete my account") {
      toast.error("Please type the confirmation phrase correctly");
      return;
    }
    if (deletionCountdown.start()) setIsDeleting(true);
  };

  // Escape, an outside press, and Cancel all arrive here as a close request.
  // Each one cancels the countdown and clears the form, so reopening the
  // dialog starts over instead of resuming.
  const handleOpenChange = (nextOpen: boolean) => {
    // The request has already been sent and cannot be recalled, so the dialog
    // stays up until the server answers rather than implying a cancel.
    if (!nextOpen && requestInFlightRef.current) return;
    if (!nextOpen) {
      deletionCountdown.cancel();
      setIsDeleting(false);
      setCountdown(COUNTDOWN_SECONDS);
      setDeleteConfirmation("");
    }
    setShowDeleteDialog(nextOpen);
  };

  return (
    <SettingsSection
      tone="danger"
      title="Delete account"
      description="Remove your account and personal platform data"
      footerHint="This cannot be undone."
      footer={
        <AlertDialog open={showDeleteDialog} onOpenChange={handleOpenChange}>
          <AlertDialogTrigger
            render={<Button variant="destructive">Delete account</Button>}
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
                <Trash2Icon className="size-5" />
              </AlertDialogMedia>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. Account removal preserves records
                needed for organization history and moderation. Transfer
                ownership and disconnect linked providers first.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="confirm">
                  Type &quot;delete my account&quot; to confirm
                </Label>
                <Input
                  id="confirm"
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  placeholder="delete my account"
                />
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={(e) => {
                  e.preventDefault();
                  handleDeleteAccount();
                }}
                disabled={
                  deleteConfirmation !== "delete my account" || isDeleting
                }
              >
                {isDeleting ? `Deleting in ${countdown}s...` : "Delete account"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
    />
  );
}
