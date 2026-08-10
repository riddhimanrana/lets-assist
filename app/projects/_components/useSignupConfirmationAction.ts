"use client";

import { useCallback, useRef, useState } from "react";

export type SignupAttemptResult =
  { success: true } | { success: false; error: string };

export async function runSignupConfirmationAttempt(
  attempt: () => Promise<SignupAttemptResult>,
): Promise<SignupAttemptResult> {
  try {
    return await attempt();
  } catch (cause) {
    return {
      success: false,
      error:
        cause instanceof Error && cause.message.trim()
          ? cause.message
          : "The signup could not be completed. Please try again.",
    };
  }
}

export function useSignupConfirmationAction() {
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const reset = useCallback(() => setError(null), []);

  const submit = useCallback(
    async <Args extends unknown[]>(
      attempt: (...args: Args) => Promise<SignupAttemptResult>,
      args: Args,
      onSuccess: () => void,
    ) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setError(null);
      try {
        const result = await runSignupConfirmationAttempt(() =>
          attempt(...args),
        );
        if (!result.success) {
          setError(result.error);
          return;
        }
        onSuccess();
      } finally {
        inFlight.current = false;
      }
    },
    [],
  );

  return { error, reset, submit };
}
