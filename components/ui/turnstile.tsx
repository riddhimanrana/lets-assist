"use client";

import { Turnstile, TurnstileInstance } from "@marsidev/react-turnstile";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

type WindowWithTurnstile = Window & {
  turnstile?: Window["turnstile"];
};

interface TurnstileComponentProps {
  onVerify?: (token: string) => void;
  onError?: (errorCode?: string) => void;
  onExpire?: () => void;
  onLoad?: () => void;
  className?: string;
  theme?: "light" | "dark" | "auto";
}

export interface TurnstileRef {
  reset: () => void;
  getResponse: () => string | undefined;
}

export const TurnstileComponent = forwardRef<TurnstileRef, TurnstileComponentProps>(
  ({ onVerify, onError, onExpire, onLoad, className, theme = "auto" }, ref) => {
    const turnstileRef = useRef<TurnstileInstance>(null);

    useImperativeHandle(ref, () => ({
      reset: () => {
        turnstileRef.current?.reset();
      },
      getResponse: () => {
        return turnstileRef.current?.getResponse();
      },
    }));

    useEffect(() => {
      if (typeof window === "undefined") {
        return;
      }

      const checkReady = () => {
        if ((window as WindowWithTurnstile).turnstile) {
          onLoad?.();
          return true;
        }
        return false;
      };

      if (checkReady()) {
        return;
      }

      const interval = window.setInterval(() => {
        if (checkReady()) {
          window.clearInterval(interval);
        }
      }, 300);

      return () => window.clearInterval(interval);
    }, [onLoad]);

    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

    if (!siteKey) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Turnstile site key is not configured (NEXT_PUBLIC_TURNSTILE_SITE_KEY)");
      }
      return null;
    }

    const handleError = (errorCode?: string) => {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[Turnstile] Error", errorCode);
      }
      onError?.(errorCode);
    };

    return (
      <Turnstile
        ref={turnstileRef}
        siteKey={siteKey}
        onSuccess={onVerify}
        onError={handleError}
        onExpire={onExpire}
        options={{
          theme,
          size: "normal",
          execution: "render",
        }}
        className={className}
      />
    );
  }
);

TurnstileComponent.displayName = "TurnstileComponent";
