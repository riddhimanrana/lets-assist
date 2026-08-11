"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { MaxLengthField } from "@/components/ui/max-length-field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { StarRatingInput } from "@/components/projects/StarRatingInput";
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
      <Empty className="border-0 p-6">
        <EmptyMedia variant="icon" className="text-primary">
          <CheckCircle2 />
        </EmptyMedia>
        <EmptyTitle>Thanks for the feedback!</EmptyTitle>
        <EmptyDescription>
          It goes straight to the organizer — it&apos;s never shown publicly.
        </EmptyDescription>
      </Empty>
    );
  }

  return (
    <FieldGroup>
      <Field className="items-center">
        <FieldLabel className="sr-only">Your rating</FieldLabel>
        <StarRatingInput
          value={rating}
          onChange={setRating}
          disabled={pending}
          size="lg"
        />
      </Field>

      <Field>
        <MaxLengthField
          label="Comment (optional)"
          current={comment.length}
          max={COMMENT_MAX}
        />
        <Textarea
          value={comment}
          onChange={(event) =>
            setComment(event.target.value.slice(0, COMMENT_MAX))
          }
          placeholder="What went well? What could be better?"
          rows={4}
          maxLength={COMMENT_MAX}
          disabled={pending}
        />
        <FieldDescription className="text-center">
          Only the organizer sees this — it&apos;s never shown publicly. Your
          name is shown with your feedback.
        </FieldDescription>
      </Field>

      <Button
        onClick={submit}
        disabled={pending || rating < 1}
        className="w-full"
      >
        {pending ? <Spinner /> : null}
        {pending ? "Sending…" : "Send feedback"}
      </Button>
    </FieldGroup>
  );
}
