"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function TrustedMemberReasonCell({
  reason,
  name,
  email,
}: {
  reason: string;
  name: string;
  email: string;
}) {
  if (!reason.trim()) {
    return (
      <span className="text-muted-foreground text-sm">No reason provided</span>
    );
  }

  return (
    <div className="max-w-75">
      <p className="text-muted-foreground truncate text-sm">{reason}</p>
      <Dialog>
        <DialogTrigger
          render={
            <Button
              variant="link"
              className="h-auto px-0 text-xs"
              aria-label={`View full reason for ${name || email}`}
            />
          }
        >
          View full reason
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="min-w-0 pr-8">
            <DialogTitle>Application reason</DialogTitle>
            <DialogDescription className="wrap-anywhere">
              {name ? `${name} (${email})` : email}
            </DialogDescription>
          </DialogHeader>
          <p className="min-w-0 wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed">
            {reason}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
