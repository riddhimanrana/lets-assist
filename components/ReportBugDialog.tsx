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
          <DialogTitle>Report a Bug</DialogTitle>
          <div className="text-sm text-muted-foreground">
            Our bug reporting system is coming soon! For now, please email any
            issues to:
            <div className="mt-2">
              <Link
                href="mailto:support@lets-assist.com"
                className="text-primary font-medium"
              >
                support@lets-assist.com
              </Link>
            </div>
          </div>
          <div className="mt-4 text-sm text-muted-foreground">
            Have a feature request or idea?&nbsp;
            <Link
              className="text-primary font-medium"
              href="https://letsassist.featurebase.app"
            >
              Submit it here!
            </Link>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChangeAction(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
