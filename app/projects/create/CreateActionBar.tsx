"use client";

import { ChevronLeft, Loader2 } from "lucide-react";

import {
  ArrowRightIcon,
  CheckIcon,
  useAnimatedIcon,
} from "@/components/icons/animated";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_LABEL: Record<AutosaveStatus, string> = {
  idle: "Autosave on",
  saving: "Saving...",
  saved: "Saved",
  error: "Save failed",
};

/**
 * The flow's one action row. It floats above the page so Back and the primary
 * action stay reachable on long steps.
 */
export function CreateActionBar({
  isFinalStep,
  isSubmitting,
  backDisabled,
  primaryDisabled,
  autosaveStatus,
  blockedReason,
  onBack,
  onPrimary,
}: {
  isFinalStep: boolean;
  isSubmitting: boolean;
  backDisabled: boolean;
  primaryDisabled: boolean;
  /** Null until this project has a draft that autosave writes to. */
  autosaveStatus: AutosaveStatus | null;
  /** Why the primary action is disabled, when the user can fix it. */
  blockedReason?: string;
  onBack: () => void;
  onPrimary: () => void;
}) {
  const continueIcon = useAnimatedIcon();
  const createIcon = useAnimatedIcon();

  return (
    <div className="bg-card sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-xl border p-2 shadow-md">
      <Button variant="outline" onClick={onBack} disabled={backDisabled}>
        <ChevronLeft data-icon="inline-start" aria-hidden="true" />
        Back
      </Button>
      <div className="flex min-w-0 items-center gap-3">
        {blockedReason ? (
          <p
            id="create-blocked-reason"
            role="alert"
            className="text-destructive min-w-0 text-xs sm:text-sm"
          >
            {blockedReason}
          </p>
        ) : autosaveStatus ? (
          <p
            role="status"
            className={cn(
              "truncate text-xs",
              autosaveStatus === "error"
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {AUTOSAVE_LABEL[autosaveStatus]}
          </p>
        ) : null}
        {isFinalStep ? (
          <Button
            onClick={onPrimary}
            disabled={primaryDisabled}
            aria-describedby={
              blockedReason ? "create-blocked-reason" : undefined
            }
            {...createIcon.triggerProps}
          >
            {isSubmitting ? (
              <Loader2
                data-icon="inline-start"
                aria-hidden="true"
                className="animate-spin"
              />
            ) : (
              <CheckIcon
                ref={createIcon.ref}
                size={16}
                data-icon="inline-start"
                aria-hidden="true"
              />
            )}
            {isSubmitting ? "Creating..." : "Create project"}
          </Button>
        ) : (
          <Button
            onClick={onPrimary}
            disabled={primaryDisabled}
            {...continueIcon.triggerProps}
          >
            Continue
            <ArrowRightIcon
              ref={continueIcon.ref}
              size={16}
              data-icon="inline-end"
              aria-hidden="true"
            />
          </Button>
        )}
      </div>
    </div>
  );
}
