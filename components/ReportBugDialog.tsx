"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

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
                        Our bug reporting system is coming soon! For now, please email any issues to:
                        <div className="mt-2 font-medium">
                            support@lets-assist.com
                        </div>
                    </div>
                </DialogHeader>
                <DialogFooter>
                    <Button 
                        type="button" 
                        onClick={() => onOpenChangeAction(false)}
                    >
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
