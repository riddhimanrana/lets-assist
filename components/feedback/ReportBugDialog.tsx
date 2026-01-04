"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";

interface ReportBugDialogProps {
  onOpenChangeAction: (open: boolean) => void;
}

export function ReportBugDialog({ onOpenChangeAction }: ReportBugDialogProps) {
  return (
    <Dialog open={true} onOpenChange={onOpenChangeAction}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Report a Bug</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-4">
          <p className="text-sm text-muted-foreground">
            To report bugs or submit feature requests:
          </p>

            <Link
              href="https://letsassist.featurebase.app"
              className="text-primary text-sm font-medium hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              letsassist.featurebase.app
            </Link>
          
          <p className="text-sm text-muted-foreground">
            Alternatively, email us at{" "}
            <Link 
              href="mailto:support@lets-assist.com" 
              className="text-primary font-medium hover:underline"
            >
              support@lets-assist.com
            </Link>
          </p>
        </div>
        <DialogFooter className="mt-2">
          <Button type="button" onClick={() => onOpenChangeAction(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
