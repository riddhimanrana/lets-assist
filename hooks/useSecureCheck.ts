"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { clearStaleTurnstileScript } from "@/components/ui/turnstile";
import {
  SECURE_CHECK_TIMEOUT_MS,
  type SecureCheckPhase,
  resolveSecureCheckPhase,
  secureCheckWatchdogDelayMs,
} from "@/lib/auth/secure-check";

interface UseSecureCheckOptions {
  /** Override the bounded wait, mainly for tests and stories. */
  timeoutMs?: number;
  /** Called when the person asks for another attempt. */
  onRetry?: () => void;
}

export interface SecureCheckState {
  phase: SecureCheckPhase;
  isReady: boolean;
  /** Remount key for the Turnstile widget; changes on every retry. */
  widgetKey: number;
  /** Pass to `TurnstileComponent.onLoad`. */
  handleLoad: () => void;
  /** Pass to `TurnstileComponent.onError`. */
  handleError: () => void;
  /** Discard the current widget and start a fresh attempt. */
  retry: () => void;
}

/**
 * Watch a Turnstile widget and give up on it after a bounded wait.
 *
 * Without this, a blocked or failed script leaves the form in a permanent
 * "preparing" state with no way out. Here the wait always resolves to `ready`
 * or `unavailable`, and `retry` remounts the widget for another attempt.
 */
export function useSecureCheck(
  options: UseSecureCheckOptions = {},
): SecureCheckState {
  const { timeoutMs = SECURE_CHECK_TIMEOUT_MS, onRetry } = options;

  const [widgetKey, setWidgetKey] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [hasErrored, setHasErrored] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // Kept in a ref so `retry` stays referentially stable for callers that use it
  // inside effects.
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  const handleLoad = useCallback(() => {
    setIsReady(true);
    setTimedOut(false);
    setHasErrored(false);
  }, []);

  const handleError = useCallback(() => {
    // A widget that already loaded reports its own failures; only a failure
    // before load means the check never became usable.
    setHasErrored(true);
  }, []);

  const retry = useCallback(() => {
    clearStaleTurnstileScript();
    setIsReady(false);
    setHasErrored(false);
    setTimedOut(false);
    setWidgetKey((current) => current + 1);
    onRetryRef.current?.();
  }, []);

  useEffect(() => {
    const delay = secureCheckWatchdogDelayMs({
      isReady,
      hasErrored,
      timeoutMs,
    });

    if (delay === null || timedOut) {
      return;
    }

    const timer = setTimeout(() => setTimedOut(true), delay);
    return () => clearTimeout(timer);
  }, [hasErrored, isReady, timedOut, timeoutMs, widgetKey]);

  const phase = resolveSecureCheckPhase({ isReady, hasErrored, timedOut });

  return useMemo(
    () => ({
      phase,
      isReady,
      widgetKey,
      handleLoad,
      handleError,
      retry,
    }),
    [handleError, handleLoad, isReady, phase, retry, widgetKey],
  );
}
