import { useEffect, useMemo, useState } from "react";
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
import { XOctagon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Project } from "@/types";
import { cn } from "@/lib/utils";
import { canCancelProject } from "@/utils/project";
import { createClient } from "@/utils/supabase/client";

interface CancelProjectDialogProps {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

type EmailJoin = { email: string | null } | { email: string | null }[] | null | undefined;

interface SignupEmailRow {
  user?: EmailJoin;
  anonymous_signup?: EmailJoin;
}

export function CancelProjectDialog({
  project,
  isOpen,
  onClose,
  onConfirm,
}: CancelProjectDialogProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const CHARACTER_LIMIT = 350; // Define the character limit

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

  // Character count helpers
  const getCounterColor = (current: number, max: number) => {
    const percentage = (current / max) * 100;
    if (percentage >= 90) return "text-destructive";
    if (percentage >= 75) return "text-warning";
    return "text-muted-foreground";
  };

  useEffect(() => {
    if (!isOpen) return;

    let isActive = true;
    const fetchRecipientCount = async () => {
      setRecipientLoading(true);
      setRecipientError(null);

      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("project_signups")
          .select(
            `
              id,
              user:profiles!user_id(email),
              anonymous_signup:anonymous_signups!anonymous_id(email)
            `
          )
          .eq("project_id", project.id)
          .eq("status", "approved");

        if (error) {
          throw error;
        }

        const count = ((data as unknown) as SignupEmailRow[] | null ?? []).filter((signup) => {
          const userEmail = Array.isArray(signup.user)
            ? signup.user[0]?.email
            : signup.user?.email;
          const anonEmail = Array.isArray(signup.anonymous_signup)
            ? signup.anonymous_signup[0]?.email
            : signup.anonymous_signup?.email;
          return !!(userEmail || anonEmail);
        }).length;

        if (isActive) {
          setRecipientCount(count);
        }
      } catch (error) {
        console.error("Error fetching cancellation recipient count:", error);
        if (isActive) {
          setRecipientCount(null);
          setRecipientError("Unable to estimate cancellation email recipients right now.");
        }
      } finally {
        if (isActive) {
          setRecipientLoading(false);
        }
      }
    };

    fetchRecipientCount();

    return () => {
      isActive = false;
    };
  }, [isOpen, project.id]);

  const recipientText = useMemo(() => {
    if (recipientLoading) {
      return "Calculating how many approved volunteers will be emailed...";
    }

    if (recipientError) {
      return recipientError;
    }

    if (recipientCount === null) {
      return "Estimated email recipients will appear here.";
    }

    if (recipientCount === 0) {
      return "There are no approved volunteers with an email address to notify.";
    }

    return `Cancellation emails will be sent to ${recipientCount} approved volunteer${recipientCount === 1 ? "" : "s"}.`;
  }, [recipientCount, recipientError, recipientLoading]);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <XOctagon className="h-5 w-5 text-destructive" />
            <DialogTitle>Cancel Project</DialogTitle>
          </div>
          <DialogDescription>
            This action cannot be undone. The project will be marked as cancelled and approved volunteers will be notified by email. Anonymous volunteers with an email address will only receive the email notice.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {recipientText}
          </div>
          <div className="space-y-2">
            <h4 className="font-medium">Cancellation Reason</h4>
            <Textarea
              placeholder="Please provide a reason for cancelling this project..."
              value={reason}
              onChange={(e) => {
                if (e.target.value.length <= CHARACTER_LIMIT) {
                  setReason(e.target.value);
                }
              }}
              className="resize-none"
              rows={4}
              disabled={!canCancel || isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              This reason will appear in the cancellation email.
            </p>
            <span
              className={cn(
                "text-xs transition-colors float-right",
                getCounterColor(reason.length, CHARACTER_LIMIT)
              )}
            >
              {reason.length}/{CHARACTER_LIMIT}
            </span>
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
            disabled={isSubmitting || !reason.trim() || reason.length > CHARACTER_LIMIT}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
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
