"use client";

import { useState } from "react";
import { Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ProjectFeedbackForm,
  type ProjectFeedbackFormValue,
} from "@/components/projects/ProjectFeedbackForm";

interface ProjectFeedbackDialogProps {
  projectId: string;
  signupId: string;
  initial?: ProjectFeedbackFormValue | null;
  onSubmitted?: (value: ProjectFeedbackFormValue) => void;
}

/**
 * Auto-opens once for an eligible volunteer who has not responded. The trigger
 * remains available after dismissal, which also gives Radix a stable element
 * to restore focus to when the dialog closes.
 */
export function ProjectFeedbackDialog({
  projectId,
  signupId,
  initial,
  onSubmitted,
}: ProjectFeedbackDialogProps) {
  const [open, setOpen] = useState(!initial);
  const [submitted, setSubmitted] = useState(Boolean(initial));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="w-fit">
            <Star className="h-4 w-4" aria-hidden="true" />
            {submitted ? "View or edit feedback" : "Rate this project"}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How did volunteering here go?</DialogTitle>
          <DialogDescription>
            Only the organizer sees this — it is never shown on the project
            page.
          </DialogDescription>
        </DialogHeader>
        <ProjectFeedbackForm
          projectId={projectId}
          signupId={signupId}
          initial={initial}
          alwaysEditing
          onSubmitted={(value) => {
            setSubmitted(true);
            setOpen(false);
            onSubmitted?.(value);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
