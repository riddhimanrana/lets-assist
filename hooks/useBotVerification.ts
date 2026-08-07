"use client";

import { useState, useRef } from "react";
import { TurnstileRef } from "@/components/ui/turnstile";
import { useSecureCheck } from "@/hooks/useSecureCheck";
import type { SecureCheckPhase } from "@/lib/auth/secure-check";

interface UseBotVerificationOptions {
  onSuccess?: (token: string) => void;
  onError?: (error?: string) => void;
}

export function useBotVerification(options?: UseBotVerificationOptions) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<TurnstileRef>(null);

  const secureCheck = useSecureCheck({
    onRetry: () => {
      setToken(null);
      setError(null);
    },
  });

  const handleVerify = (verificationToken: string) => {
    setToken(verificationToken);
    setError(null);
    options?.onSuccess?.(verificationToken);
  };

  const handleError = (errorCode?: string) => {
    const wasReady = secureCheck.isReady;
    secureCheck.handleError();
    setToken(null);

    // Before the widget loads there is nothing for the person to act on in an
    // error message; the unavailable state explains the situation and offers a
    // retry instead.
    if (!wasReady) {
      return;
    }

    const errorMessage = errorCode || "Verification failed. Please try again.";
    setError(errorMessage);
    options?.onError?.(errorMessage);
  };

  const handleLoad = () => {
    secureCheck.handleLoad();
  };

  const reset = () => {
    ref.current?.reset();
    setToken(null);
    setError(null);
  };

  const getToken = () => {
    return token || ref.current?.getResponse();
  };

  return {
    // State
    token: getToken(),
    isReady: secureCheck.isReady,
    phase: secureCheck.phase as SecureCheckPhase,
    error,

    // Ref for TurnstileComponent
    ref,

    // Remount key + retry for the secure check fallback
    widgetKey: secureCheck.widgetKey,
    retry: secureCheck.retry,

    // Handlers for TurnstileComponent
    onVerify: handleVerify,
    onError: handleError,
    onLoad: handleLoad,

    // Helper methods
    reset,
    isVerified: () => !!getToken(),
  };
}
