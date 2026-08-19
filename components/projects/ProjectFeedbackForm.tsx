"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { MaxLengthField } from "@/components/ui/max-length-field";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  StarRatingDisplay,
  StarRatingInput,
} from "@/components/projects/StarRatingInput";
import { submitProjectFeedback } from "@/app/projects/[id]/actions";

const COMMENT_MAX = 2000;

export interface ProjectFeedbackFormValue {
  rating: number;
  comment: string | null;
}

interface ProjectFeedbackFormProps {
  projectId: string;
  signupId: string;
  initial?: ProjectFeedbackFormValue | null;
  /** Pre-selection from a deep link; still requires an explicit submit. */
  initialRating?: number | null;
  /** Keep the editable controls visible when the host owns the compact summary. */
  alwaysEditing?: boolean;
  onSubmitted?: (value: ProjectFeedbackFormValue) => void;
}

/**
 * The private post-project rating widget. Copy is deliberately explicit
 * about who sees what: only the organizer, never the public page — and the
 * volunteer's name is attached, because on a five-person project
 * "anonymous" would be a lie.
 */
export function ProjectFeedbackForm({
  projectId,
  signupId,
  initial,
  initialRating,
  alwaysEditing = false,
  onSubmitted,
}: ProjectFeedbackFormProps) {
  const [rating, setRating] = useState<number>(
    initial?.rating ??
      (initialRating && initialRating >= 1 && initialRating <= 5
        ? initialRating
        : 0),
  );
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [submitted, setSubmitted] = useState(Boolean(initial));
  const [editing, setEditing] = useState(!initial);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (rating < 1) {
      toast.error("Pick a star rating first.");
      return;
    }
    startTransition(async () => {
      const result = await submitProjectFeedback({
        projectId,
        signupId,
        rating,
        comment: comment.trim() || null,
      });
      if (!result.success) {
        toast.error(result.error ?? "Could not save your feedback.");
        return;
      }
      toast.success("Thanks — your feedback went to the organizer.");
      setSubmitted(true);
      setEditing(false);
      onSubmitted?.({ rating, comment: comment.trim() || null });
    });
  };

  if (submitted && !editing && !alwaysEditing) {
    return (
      <FieldGroup>
        <Field>
          <StarRatingDisplay rating={rating} size="md" />
          {comment.trim() ? (
            <FieldDescription className="text-foreground">
              {comment}
            </FieldDescription>
          ) : null}
        </Field>
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setEditing(true)}
        >
          Edit feedback
        </Button>
      </FieldGroup>
    );
  }

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="project-feedback-rating">Your rating</FieldLabel>
        <StarRatingInput
          value={rating}
          onChange={setRating}
          disabled={pending}
        />
      </Field>

      <Field>
        <MaxLengthField
          label="Comment (optional)"
          current={comment.length}
          max={COMMENT_MAX}
        />
        <Textarea
          id="project-feedback-comment"
          value={comment}
          onChange={(event) =>
            setComment(event.target.value.slice(0, COMMENT_MAX))
          }
          placeholder="What went well? What could be better?"
          rows={3}
          maxLength={COMMENT_MAX}
          disabled={pending}
        />
        <FieldDescription>
          Only the organizer sees this — it&apos;s never shown on the project
          page. Your name is shown with your feedback.
        </FieldDescription>
      </Field>

      <ButtonGroup>
        <Button onClick={submit} disabled={pending || rating < 1}>
          {pending ? <Spinner /> : null}
          {pending
            ? "Sending…"
            : submitted
              ? "Update feedback"
              : "Send feedback"}
        </Button>
        {submitted && !alwaysEditing ? (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        ) : null}
      </ButtonGroup>
    </FieldGroup>
  );
}
