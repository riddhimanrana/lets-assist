"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { submitProjectFeedback } from "@/app/projects/[id]/actions";

const COMMENT_MAX = 2000;

interface ProjectFeedbackFormProps {
  projectId: string;
  signupId: string;
  initial?: { rating: number; comment: string | null } | null;
  /** Pre-selection from a deep link; still requires an explicit submit. */
  initialRating?: number | null;
  onSubmitted?: (rating: number) => void;
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
  onSubmitted,
}: ProjectFeedbackFormProps) {
  const [rating, setRating] = useState<number>(
    initial?.rating ??
      (initialRating && initialRating >= 1 && initialRating <= 5
        ? initialRating
        : 0),
  );
  const [hovered, setHovered] = useState(0);
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
      onSubmitted?.(rating);
    });
  };

  if (submitted && !editing) {
    return (
      <div className="space-y-2">
        <div
          className="flex items-center gap-1"
          aria-label={`Your rating: ${rating} of 5`}
        >
          {[1, 2, 3, 4, 5].map((value) => (
            <Star
              key={value}
              className={cn(
                "size-5",
                value <= rating
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/40",
              )}
            />
          ))}
        </div>
        {comment.trim() && (
          <p className="text-sm text-muted-foreground">{comment}</p>
        )}
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Edit feedback
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Rate this project from 1 to 5 stars"
        className="flex items-center gap-1"
        onMouseLeave={() => setHovered(0)}
      >
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} star${value > 1 ? "s" : ""}`}
            disabled={pending}
            onClick={() => setRating(value)}
            onMouseEnter={() => setHovered(value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                event.preventDefault();
                setRating(Math.min(5, (rating || 0) + 1));
              } else if (
                event.key === "ArrowLeft" ||
                event.key === "ArrowDown"
              ) {
                event.preventDefault();
                setRating(Math.max(1, (rating || 1) - 1));
              }
            }}
            className="flex size-11 items-center justify-center rounded-md transition-colors hover:bg-muted sm:size-9"
          >
            <Star
              className={cn(
                "size-7 sm:size-6",
                value <= (hovered || rating)
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/40",
              )}
            />
          </button>
        ))}
      </div>

      <Textarea
        value={comment}
        onChange={(event) =>
          setComment(event.target.value.slice(0, COMMENT_MAX))
        }
        placeholder="What went well? What could be better? (optional)"
        rows={3}
        maxLength={COMMENT_MAX}
        disabled={pending}
      />

      <p className="text-xs text-muted-foreground">
        Only the organizer sees this — it&apos;s never shown on the project
        page. Your name is shown with your feedback.
      </p>

      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending || rating < 1}>
          {pending
            ? "Sending…"
            : submitted
              ? "Update feedback"
              : "Send feedback"}
        </Button>
        {submitted && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
