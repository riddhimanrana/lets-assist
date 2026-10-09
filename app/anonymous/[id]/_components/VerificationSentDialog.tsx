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
  loginHref,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  loginHref: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Check your email to finish account access</DialogTitle>
          <DialogDescription>
            Your guest attendance is saved. Verify{" "}
            <span className="text-foreground font-medium wrap-break-word">
              {email}
            </span>
            , then sign in and return here to link it to your account.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 text-sm">
          <h3 className="font-medium">What happens next</h3>
          <p className="text-muted-foreground">
            Your volunteer signups and certificates remain available through
            this guest link.
          </p>
          <p className="text-muted-foreground">
            After verifying, sign in using the button below. You will return
            here to finish linking your attendance.
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
          <Link href={loginHref} className={buttonVariants()}>
            Go to login
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
