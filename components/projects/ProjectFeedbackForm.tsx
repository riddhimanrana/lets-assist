"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { safeConsole } from "@/lib/safe-console";
import {
  PROJECT_FEEDBACK_SAVED_MESSAGE,
  PROJECT_FEEDBACK_VISIBILITY,
} from "./feedback-visibility";

const COMMENT_MAX = 2000;

export const FEEDBACK_OUTCOME_UNKNOWN_MESSAGE =
  "We could not confirm that your feedback was saved. Your rating and comment are still here. Send it again to make sure. Sending again replaces any copy that already went through.";

type FeedbackSubmitResult =
  { kind: "result"; success: boolean; error?: string } | { kind: "unknown" };

/**
 * A rejected action call (network loss, server crash, a dropped response)
 * says nothing about whether the write happened, so it is reported as
 * unknown rather than as a failure.
 */
export async function submitFeedbackSafely(
  input: Parameters<typeof submitProjectFeedback>[0],
  submit: typeof submitProjectFeedback = submitProjectFeedback,
): Promise<FeedbackSubmitResult> {
  try {
    const result = await submit(input);
    return { kind: "result", ...result };
  } catch (error) {
    safeConsole.error("Project feedback submission did not return:", error);
    return { kind: "unknown" };
  }
}

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
 * about who sees what (PROJECT_FEEDBACK_VISIBILITY): never the public page,
 * only the author, project managers and administrators. The volunteer's
 * name is attached, because on a five-person project
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
  // `pending` only updates on the next render, so a ref blocks a second
  // click that lands before it does.
  const inFlight = useRef(false);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);

  const submit = () => {
    if (inFlight.current) return;
    if (rating < 1) {
      toast.error("Pick a star rating first.");
      return;
    }
    inFlight.current = true;
    setOutcomeUnknown(false);
    const value = { rating, comment: comment.trim() || null };
    startTransition(async () => {
      try {
        const result = await submitFeedbackSafely({
          projectId,
          signupId,
          ...value,
        });
        if (result.kind === "unknown") {
          // The request may have saved before the response was lost. The
          // rating and comment stay so the volunteer can send again, which
          // replaces any copy that went through.
          setOutcomeUnknown(true);
          return;
        }
        if (!result.success) {
          toast.error(result.error ?? "Could not save your feedback.");
          return;
        }
        toast.success(PROJECT_FEEDBACK_SAVED_MESSAGE);
        setSubmitted(true);
        setEditing(false);
        onSubmitted?.(value);
      } finally {
        inFlight.current = false;
      }
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
          // MaxLengthField renders an unassociated label, so the field
          // carries the same name itself.
          aria-label="Comment (optional)"
          value={comment}
          onChange={(event) =>
            setComment(event.target.value.slice(0, COMMENT_MAX))
          }
          placeholder="What went well? What could be better?"
          rows={3}
          maxLength={COMMENT_MAX}
          disabled={pending}
        />
        <FieldDescription>{PROJECT_FEEDBACK_VISIBILITY}</FieldDescription>
      </Field>

      {outcomeUnknown ? (
        <Alert variant="warning">
          <AlertDescription>
            {FEEDBACK_OUTCOME_UNKNOWN_MESSAGE}
          </AlertDescription>
        </Alert>
      ) : null}

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
