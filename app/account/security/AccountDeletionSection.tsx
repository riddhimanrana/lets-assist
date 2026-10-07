"use client";

import { useState } from "react";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { deleteAccount } from "./actions";

export default function AccountDeletionSection() {
  const [isDeleting, setIsDeleting] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [countdownInterval, setCountdownInterval] =
    useState<NodeJS.Timeout | null>(null);

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "delete my account") {
      toast.error("Please type the confirmation phrase correctly");
      return;
    }

    try {
      setIsDeleting(true);
      let count = 5;
      setCountdown(count);
      const interval = setInterval(() => {
        count--;
        setCountdown(count);
        if (count === 0) {
          clearInterval(interval);
          setCountdownInterval(null);
        }
      }, 1000);
      setCountdownInterval(interval);

      await new Promise((resolve) => setTimeout(resolve, 5000));

      if (count === 0) {
        const result = await deleteAccount();
        if (result.success) {
          localStorage.clear();
          sessionStorage.clear();
          // Account deletion must reload the document so no authenticated client state survives.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = "/?deleted=true&noRedirect=1";
        }
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete account",
      );
      setIsDeleting(false);
    }
    setShowDeleteDialog(false);
  };

  const handleCancelDelete = () => {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      setCountdownInterval(null);
    }
    setIsDeleting(false);
    setCountdown(5);
    setShowDeleteDialog(false);
  };

  return (
    <Card className="border-destructive mt-6">
      <CardHeader className="">
        <CardTitle className="text-destructive">Delete Account</CardTitle>
        <CardDescription>
          Permanently delete your account and all associated data
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogTrigger
            render={
              <Button variant="destructive" className="w-full sm:w-auto">
                Delete Account
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
                <Trash2Icon className="size-5" />
              </AlertDialogMedia>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete your
                account and remove all associated data.
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
              <AlertDialogCancel onClick={handleCancelDelete}>
                Cancel
              </AlertDialogCancel>
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
                {isDeleting ? `Deleting in ${countdown}s...` : "Delete Account"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
