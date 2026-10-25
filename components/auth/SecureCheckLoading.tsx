"use client";

import { Loader2, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SECURE_CHECK_UNAVAILABLE_COPY } from "@/lib/auth/secure-check";
import { cn } from "@/lib/utils";

export function SecureCheckLoading() {
  return (
    <div className="bg-background absolute inset-0 z-10 flex items-center justify-center gap-3 rounded-lg">
      <Loader2
        aria-hidden="true"
        className="text-muted-foreground size-4 shrink-0 animate-spin motion-reduce:animate-none"
      />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">Preparing secure check</span>
        <span className="text-muted-foreground text-xs">Almost ready</span>
      </span>
    </div>
  );
}

interface SecureCheckUnavailableProps {
  onRetry: () => void;
  className?: string;
}

/**
 * Shown when the Turnstile widget never initialized, so people know what
 * happened and can start another attempt instead of waiting indefinitely.
 */
export function SecureCheckUnavailable({
  onRetry,
  className,
}: SecureCheckUnavailableProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="secure-check-unavailable"
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border p-3 text-left",
        className,
      )}
    >
      <ShieldAlert
        aria-hidden="true"
        className="text-muted-foreground mt-0.5 size-4 shrink-0"
      />
      <div className="grid gap-1">
        <span className="text-sm font-medium">
          {SECURE_CHECK_UNAVAILABLE_COPY.title}
        </span>
        <span className="text-muted-foreground text-sm">
          {SECURE_CHECK_UNAVAILABLE_COPY.description}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-1 w-fit"
        >
          {SECURE_CHECK_UNAVAILABLE_COPY.retryLabel}
        </Button>
      </div>
    </div>
  );
}
