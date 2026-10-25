"use client";
import { safeConsole } from "@/lib/safe-console";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { TurnstileRef } from "@/components/ui/turnstile";
import { useSecureCheck } from "@/hooks/useSecureCheck";
import { shouldRenderTurnstileWidget } from "@/lib/anonymous-signup-security";
import { resendAnonymousConfirmationEmail } from "./actions";

/** State and action for resending an unconfirmed anonymous signup's email. */
export function useResendConfirmation() {
  const [showResendDialog, setShowResendDialog] = useState(false);
  const [resendAnonymousId, setResendAnonymousId] = useState<string | null>(
    null,
  );
  const [isResending, setIsResending] = useState(false);
  const resendTurnstileRef = useRef<TurnstileRef>(null);
  const [resendTurnstileToken, setResendTurnstileToken] = useState<
    string | null
  >(null);
  const resendSecureCheck = useSecureCheck({
    onRetry: () => setResendTurnstileToken(null),
  });
  const resetResendSecureCheck = resendSecureCheck.retry;

  const showResendTurnstile = shouldRenderTurnstileWidget({
    siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    bypass: process.env.NEXT_PUBLIC_TURNSTILE_BYPASS,
  });

  // Handle resending confirmation email
  const handleResendConfirmation = async () => {
    if (!resendAnonymousId) return;

    setIsResending(true);
    try {
      const result = await resendAnonymousConfirmationEmail(
        resendAnonymousId,
        resendTurnstileToken ?? undefined,
      );

      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        toast.success("Confirmation email sent!", {
          description:
            "Please check your email inbox (and spam folder) for the confirmation link.",
          duration: 6000,
        });
        setShowResendDialog(false);
      }
    } catch (error) {
      safeConsole.error("Error resending confirmation:", error);
      toast.error("Failed to resend confirmation email. Please try again.");
    } finally {
      resendTurnstileRef.current?.reset();
      setResendTurnstileToken(null);
      setIsResending(false);
    }
  };

  useEffect(() => {
    if (showResendDialog) return;

    // Closing the dialog unmounts the widget, so start the next attempt (and
    // its bounded wait) from scratch.
    resetResendSecureCheck();
  }, [resetResendSecureCheck, showResendDialog]);

  return {
    showResendDialog,
    setShowResendDialog,
    setResendAnonymousId,
    isResending,
    resendTurnstileRef,
    resendTurnstileToken,
    setResendTurnstileToken,
    resendSecureCheck,
    showResendTurnstile,
    handleResendConfirmation,
  };
}

export type ResendConfirmationState = ReturnType<typeof useResendConfirmation>;
