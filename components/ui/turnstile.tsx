"use client";

import { Turnstile, TurnstileInstance } from "@marsidev/react-turnstile";
import { forwardRef, useImperativeHandle, useRef } from "react";

interface TurnstileComponentProps {
  onVerify?: (token: string) => void;
  onError?: () => void;
  onExpire?: () => void;
  className?: string;
  theme?: "light" | "dark" | "auto";
}

export interface TurnstileRef {
  reset: () => void;
  getResponse: () => string | undefined;
}

export const TurnstileComponent = forwardRef<TurnstileRef, TurnstileComponentProps>(
  ({ onVerify, onError, onExpire, className, theme = "auto" }, ref) => {
    const turnstileRef = useRef<TurnstileInstance>(null);

    useImperativeHandle(ref, () => ({
      reset: () => {
        turnstileRef.current?.reset();
      },
      getResponse: () => {
        return turnstileRef.current?.getResponse();
      },
    }));

    // Use your site key directly
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAABA1bWshniaW4QbF9RDp7tJaBCM";

    return (
      <Turnstile
        ref={turnstileRef}
        siteKey={siteKey}
        onSuccess={onVerify}
        onError={onError}
        onExpire={onExpire}
        options={{
          theme,
          size: "normal",
        }}
        className={className}
      />
    );
  }
);

TurnstileComponent.displayName = "TurnstileComponent";
