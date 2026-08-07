"use client";

import type { ReactNode } from "react";

import {
  SecureCheckLoading,
  SecureCheckUnavailable,
} from "@/components/auth/SecureCheckLoading";
import type { SecureCheckPhase } from "@/lib/auth/secure-check";
import { cn } from "@/lib/utils";

interface SecureCheckPanelProps {
  phase: SecureCheckPhase;
  onRetry: () => void;
  /** The Turnstile widget. Unmounted while the check is unavailable. */
  children: ReactNode;
  /** Classes for the framed widget slot. */
  className?: string;
  /** Classes for the unavailable message. */
  fallbackClassName?: string;
}

/**
 * Frames the Turnstile widget and swaps in an honest, actionable message when
 * the widget never loads. Successful states are unchanged: the widget renders
 * itself and the loading treatment is untouched.
 */
export function SecureCheckPanel({
  phase,
  onRetry,
  children,
  className,
  fallbackClassName,
}: SecureCheckPanelProps) {
  if (phase === "unavailable") {
    return (
      <SecureCheckUnavailable onRetry={onRetry} className={fallbackClassName} />
    );
  }

  return (
    <div
      className={cn(
        "relative flex h-16.25 w-full max-w-75 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-background",
        className,
      )}
    >
      {phase === "loading" && <SecureCheckLoading />}
      {children}
    </div>
  );
}
