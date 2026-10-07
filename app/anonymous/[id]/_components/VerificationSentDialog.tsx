"use client";

import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function VerificationSentDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Check your email to finish account access</DialogTitle>
          <DialogDescription>
            We created your account and linked this volunteer profile. Verify{" "}
            <span className="text-foreground font-medium wrap-break-word">
              {email}
            </span>
            , then sign in to access your dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 text-sm">
          <h3 className="font-medium">What happens next</h3>
          <p className="text-muted-foreground">
            Your volunteer signups are already attached to the new account.
          </p>
          <p className="text-muted-foreground">
            Once you verify the email address, you&apos;ll be able to sign in
            and manage hours, attendance, and certificates from your dashboard.
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Link href="/login" className={buttonVariants()}>
            Go to login
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
