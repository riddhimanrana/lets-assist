"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SECURE_CHECK_UNAVAILABLE_COPY } from "@/lib/auth/secure-check";
import { cn } from "@/lib/utils";

export function SecureCheckLoading() {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <span className="relative flex size-8 items-center justify-center rounded-full border border-border bg-muted/40 text-primary">
          <ShieldCheck className="size-4" />
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary motion-safe:animate-pulse" />
        </span>
        <span className="flex flex-col">
          <span className="text-xs font-semibold text-foreground">
            Preparing secure check
          </span>
          <span className="mt-1 flex items-center gap-1 text-[0.7rem]">
            <span>Almost ready</span>
            <span className="flex gap-0.5" aria-hidden>
              <span className="size-1 rounded-full bg-muted-foreground/60 motion-safe:animate-bounce [animation-delay:-200ms]" />
              <span className="size-1 rounded-full bg-muted-foreground/60 motion-safe:animate-bounce [animation-delay:-100ms]" />
              <span className="size-1 rounded-full bg-muted-foreground/60 motion-safe:animate-bounce" />
            </span>
          </span>
        </span>
      </div>
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
        "flex w-full items-start gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 text-left",
        className,
      )}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
        <ShieldAlert className="size-4" />
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-foreground">
          {SECURE_CHECK_UNAVAILABLE_COPY.title}
        </span>
        <span className="text-[0.7rem] leading-4 text-muted-foreground">
          {SECURE_CHECK_UNAVAILABLE_COPY.description}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-1.5 h-7 w-fit rounded-full px-3 text-xs font-semibold"
        >
          {SECURE_CHECK_UNAVAILABLE_COPY.retryLabel}
        </Button>
      </div>
    </div>
  );
}
