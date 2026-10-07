"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Shown after a signup that still needs its emailed confirmation link. */
export function ProjectEmailConfirmationDialog({
  open,
  onOpenChange,
  onCopyLink,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopyLink: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Check your email</DialogTitle>
          <DialogDescription>
            We&apos;ve sent a confirmation link to your email address. Please
            click the link to finalize your signup for this project.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-sm">
          <p className="font-medium">Don&apos;t see the email?</p>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5">
            <li>Check your spam or junk folder</li>
            <li>Make sure you entered your email correctly</li>
            <li>Wait a few minutes for it to arrive</li>
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={onCopyLink}>Copy project link</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
