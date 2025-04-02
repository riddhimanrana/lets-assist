import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { XOctagon, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Project } from "@/types";
import { canCancelProject } from "@/utils/project";

interface CancelProjectDialogProps {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

export function CancelProjectDialog({
  project,
  isOpen,
  onClose,
  onConfirm,
}: CancelProjectDialogProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canCancel = canCancelProject(project);

  const handleConfirm = async () => {
    if (!reason.trim()) {
      toast.error("Please provide a reason for cancellation");
      return;
    }

    try {
      setIsSubmitting(true);
      await onConfirm(reason.trim());
      onClose();
    } catch (error) {
      console.error("Error cancelling project:", error);
      toast.error("Failed to cancel project. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setReason("");
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <XOctagon className="h-5 w-5 text-destructive" />
            <DialogTitle>Cancel Project</DialogTitle>
          </div>
          <DialogDescription>
            {canCancel ? (
              "This action cannot be undone. The project will be marked as cancelled and participants will be notified."
            ) : (
              <span className="flex items-start gap-2 text-destructive mt-1">
                <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                <span>
                  Projects can only be cancelled within 24 hours of their start time.
                </span>
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <h4 className="font-medium">Cancellation Reason</h4>
            <Textarea
              placeholder="Please provide a reason for cancelling this project..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="resize-none"
              rows={4}
              disabled={!canCancel || isSubmitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canCancel || isSubmitting || !reason.trim()}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cancelling...
              </>
            ) : (
              "Confirm Cancellation"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
