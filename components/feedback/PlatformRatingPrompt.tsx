"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { savePlatformExperience } from "@/app/feedback/actions";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/useHydrated";
import { cn } from "@/lib/utils";
import {
  ExperienceFeedbackForm,
  type ExperienceFeedbackChange,
} from "./ExperienceFeedbackForm";

const DISMISSED_UNTIL_KEY = "lets-assist:platform-rating-dismissed-until";
const DISMISS_DAYS = 30;

// Storage can throw or be missing (private windows, blocked site data). The
// card then shows as if it had never been dismissed.
function readDismissed(): boolean {
  try {
    const until = Number(window.localStorage.getItem(DISMISSED_UNTIL_KEY));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    window.localStorage.setItem(
      DISMISSED_UNTIL_KEY,
      String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000),
    );
  } catch {
    // Dismissal still holds for this page view.
  }
}

/**
 * Inline card asking a signed-in user to rate Let's Assist. `show` is the
 * server-side prompt state. Never mount this for anonymous volunteers.
 */
export function PlatformRatingPrompt({
  show,
  contextKind,
  contextId,
  className,
}: {
  show: boolean;
  contextKind: "organizer_project" | "volunteer_signup" | "volunteer_hours";
  contextId: string;
  className?: string;
}) {
  const hydrated = useHydrated();
  // Once shown, stay through later refreshes so a comment can follow a rating.
  const [latched, setLatched] = useState(show);
  if (show && !latched) setLatched(true);
  const [dismissed, setDismissed] = useState(() =>
    typeof window === "undefined" ? false : readDismissed(),
  );

  if (!hydrated || !latched || dismissed) return null;

  const save = (change: ExperienceFeedbackChange) =>
    savePlatformExperience({ contextKind, contextId, ...change });

  return (
    <section
      aria-label="Rate Let's Assist"
      className={cn("rounded-xl border bg-card p-4 sm:p-5", className)}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            How is Let&apos;s Assist working for you?
          </h2>
          <p className="text-sm text-muted-foreground">
            Your rating helps us improve the site.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-2 -mt-2 size-8 shrink-0"
          aria-label="Dismiss rating request"
          onClick={() => {
            writeDismissed();
            setDismissed(true);
          }}
        >
          <X className="size-4" />
        </Button>
      </div>
      <ExperienceFeedbackForm save={save} />
    </section>
  );
}
