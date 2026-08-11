"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Star } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { submitProjectFeedbackWithToken } from "@/app/projects/[id]/actions";

const COMMENT_MAX = 2000;

interface FeedbackTokenClientProps {
  requestId: string;
  token: string;
  initial: { rating: number; comment: string | null } | null;
  initialRating: number | null;
}

/**
 * The logged-out email-link form. The deep-linked star is a pre-selection;
 * submission always takes an explicit press.
 */
export function FeedbackTokenClient({
  requestId,
  token,
  initial,
  initialRating,
}: FeedbackTokenClientProps) {
  const [rating, setRating] = useState<number>(
    initial?.rating ?? initialRating ?? 0,
  );
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (rating < 1) {
      toast.error("Pick a star rating first.");
      return;
    }
    startTransition(async () => {
      const result = await submitProjectFeedbackWithToken({
        requestId,
        token,
        rating,
        comment: comment.trim() || null,
      });
      if (!result.success) {
        toast.error(result.error ?? "Could not save your feedback.");
        return;
      }
      setDone(true);
    });
  };

  if (done) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2 className="size-10 text-primary" />
        <p className="font-medium">Thanks for the feedback!</p>
        <p className="text-sm text-muted-foreground">
          It goes straight to the organizer — it&apos;s never shown publicly.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        role="radiogroup"
        aria-label="Rate this project from 1 to 5 stars"
        className="flex items-center justify-center gap-1"
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
            className="flex size-12 items-center justify-center rounded-md transition-colors hover:bg-muted"
          >
            <Star
              className={cn(
                "size-8",
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
        rows={4}
        maxLength={COMMENT_MAX}
        disabled={pending}
      />

      <p className="text-center text-xs text-muted-foreground">
        Only the organizer sees this — it&apos;s never shown publicly. Your name
        is shown with your feedback.
      </p>

      <Button
        onClick={submit}
        disabled={pending || rating < 1}
        className="w-full"
      >
        {pending ? "Sending…" : "Send feedback"}
      </Button>
    </div>
  );
}
