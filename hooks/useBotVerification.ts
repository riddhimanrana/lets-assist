"use client";

import { useState, useRef } from "react";
import { TurnstileRef } from "@/components/ui/turnstile";

interface UseBotVerificationOptions {
  onSuccess?: (token: string) => void;
  onError?: (error?: string) => void;
}

export function useBotVerification(options?: UseBotVerificationOptions) {
  const [token, setToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<TurnstileRef>(null);

  const handleVerify = (verificationToken: string) => {
    setToken(verificationToken);
    setError(null);
    options?.onSuccess?.(verificationToken);
  };

  const handleError = (errorCode?: string) => {
    const errorMessage = errorCode || "Verification failed. Please try again.";
    setError(errorMessage);
    setToken(null);
    options?.onError?.(errorMessage);
  };

  const handleLoad = () => {
    setIsReady(true);
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
    isReady,
    error,
    
    // Ref for TurnstileComponent
    ref,
    
    // Handlers for TurnstileComponent
    onVerify: handleVerify,
    onError: handleError,
    onLoad: handleLoad,
    
    // Helper methods
    reset,
    isVerified: () => !!getToken(),
  };
}
