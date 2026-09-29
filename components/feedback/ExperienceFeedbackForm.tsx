"use client";

import { useId, useRef, useState } from "react";
import { Check, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type ExperienceFeedbackChange = { rating: number } | { comment: string };
export type ExperienceFeedbackResult = { success: boolean; error?: string };

export function ExperienceFeedbackForm({
  save,
  initial,
}: {
  save: (change: ExperienceFeedbackChange) => Promise<ExperienceFeedbackResult>;
  initial?: { rating: number; comment: string | null } | null;
}) {
  const commentId = useId();
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [preview, setPreview] = useState(initial?.rating ?? 1);
  const [hover, setHover] = useState(0);
  const [focused, setFocused] = useState(false);
  const [desiredRating, setDesiredRating] = useState(initial?.rating ?? 0);
  const [ratingPending, setRatingPending] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [savedComment, setSavedComment] = useState(initial?.comment ?? "");
  const [commentPending, setCommentPending] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const ratingBusy = useRef(false);
  const commentBusy = useRef(false);

  async function saveRating(value: number) {
    if (ratingBusy.current) return;
    ratingBusy.current = true;
    setDesiredRating(value);
    setPreview(value);
    setRatingPending(true);
    setRatingError(null);
    try {
      const result = await save({ rating: value });
      if (!result.success)
        throw new Error(result.error || "Could not save your rating.");
      setRating(value);
    } catch (error) {
      setRatingError(
        error instanceof Error ? error.message : "Could not save your rating.",
      );
    } finally {
      ratingBusy.current = false;
      setRatingPending(false);
    }
  }
  async function saveComment() {
    if (commentBusy.current) return;
    commentBusy.current = true;
    const draft = comment;
    setCommentPending(true);
    setCommentError(null);
    try {
      const result = await save({ comment: draft });
      if (!result.success)
        throw new Error(result.error || "Could not save your comment.");
      setSavedComment(draft);
    } catch (error) {
      setCommentError(
        error instanceof Error ? error.message : "Could not save your comment.",
      );
    } finally {
      commentBusy.current = false;
      setCommentPending(false);
    }
  }
  const shown = hover || (focused ? preview : rating);
  return (
    <div className="space-y-5">
      <div className="space-y-2 text-center">
        <div
          role="radiogroup"
          aria-label="Rate using Let's Assist from 1 to 5 stars"
          className="flex w-full justify-center sm:gap-1"
          onMouseLeave={() => setHover(0)}
        >
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              ref={(node) => {
                buttons.current[value - 1] = node;
              }}
              type="button"
              role="radio"
              aria-checked={rating === value}
              aria-label={`${value} star${value === 1 ? "" : "s"}`}
              tabIndex={preview === value ? 0 : -1}
              disabled={ratingPending}
              className="grid h-12 min-w-0 max-w-12 flex-1 place-items-center rounded-lg outline-none hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              onMouseEnter={() => setHover(value)}
              onClick={() => void saveRating(value)}
              onFocus={() => {
                setFocused(true);
                setPreview(value);
              }}
              onBlur={() => setFocused(false)}
              onKeyDown={(event) => {
                const next =
                  event.key === "Home"
                    ? 1
                    : event.key === "End"
                      ? 5
                      : ["ArrowRight", "ArrowUp"].includes(event.key)
                        ? Math.min(5, value + 1)
                        : ["ArrowLeft", "ArrowDown"].includes(event.key)
                          ? Math.max(1, value - 1)
                          : null;
                if (next !== null) {
                  event.preventDefault();
                  setPreview(next);
                  buttons.current[next - 1]?.focus();
                }
                // Native button activation commits on Enter or Space only.
              }}
            >
              <Star
                aria-hidden="true"
                className={cn(
                  "size-8 motion-safe:transition-colors",
                  value <= shown
                    ? "fill-amber-400 text-amber-500"
                    : "text-muted-foreground/40",
                )}
              />
            </button>
          ))}
        </div>
        <div role="status" className="min-h-5 text-sm text-muted-foreground">
          {ratingPending ? (
            <span className="inline-flex items-center gap-2">
              <Spinner /> Saving rating
            </span>
          ) : rating > 0 && !ratingError ? (
            <span className="inline-flex items-center gap-1">
              <Check className="size-4" /> Rating saved. Thank you.
            </span>
          ) : (
            "Feedback is optional."
          )}
        </div>
        {ratingError ? (
          <div role="alert" className="text-sm text-destructive">
            {ratingError}
            <Button
              variant="link"
              size="sm"
              disabled={ratingPending}
              onClick={() => void saveRating(desiredRating)}
            >
              Retry rating
            </Button>
          </div>
        ) : null}
      </div>
      {rating > 0 ? (
        <div className="space-y-3">
          <label htmlFor={commentId} className="text-sm font-medium">
            Anything to add?{" "}
            <span className="font-normal text-muted-foreground">Optional</span>
          </label>
          <Textarea
            id={commentId}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="What worked well? What could be easier?"
          />
          <p className="text-xs text-muted-foreground">
            Only you and Let's Assist platform admins can see this feedback.
          </p>
          {commentError ? (
            <p role="alert" className="text-sm text-destructive">
              {commentError}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span role="status" className="text-xs text-muted-foreground">
              {savedComment && comment === savedComment
                ? "Comment saved. Thank you."
                : `${comment.length} / 2,000`}
            </span>
            <Button
              onClick={() => void saveComment()}
              disabled={commentPending || comment === savedComment}
            >
              {commentPending ? <Spinner /> : null}
              {commentPending
                ? "Sending"
                : commentError
                  ? "Retry comment"
                  : "Send comment"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
