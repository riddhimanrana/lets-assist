"use client";

import { Turnstile, TurnstileInstance } from "@marsidev/react-turnstile";
import { ShieldCheck } from "lucide-react";
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
    const bypassEnabled = process.env.NEXT_PUBLIC_TURNSTILE_BYPASS === "true";

    useImperativeHandle(ref, () => ({
      reset: () => {
        if (!bypassEnabled) {
          turnstileRef.current?.reset();
        }
      },
      getResponse: () => {
        if (bypassEnabled) {
          return "turnstile-bypass";
        }
        return turnstileRef.current?.getResponse();
      },
    }));

    useEffect(() => {
      if (bypassEnabled) {
        onLoad?.();
        onVerify?.("turnstile-bypass");
        return;
      }

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

    if (bypassEnabled) {
      return (
        <div className="flex h-full w-full items-center justify-center gap-3 text-sm text-muted-foreground">
          <span className="flex size-8 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
            <ShieldCheck className="size-4" />
          </span>
          <span className="flex flex-col">
            <span className="text-xs font-semibold text-foreground">
              Secure check ready
            </span>
            <span className="text-[0.7rem]">Local development bypass is active</span>
          </span>
        </div>
      );
    }

    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

    if (!siteKey) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Turnstile site key is not configured (NEXT_PUBLIC_TURNSTILE_SITE_KEY)");
      }
      return (
        <div className="flex h-full w-full items-center justify-center gap-3 text-sm text-muted-foreground">
          <span className="flex size-8 items-center justify-center rounded-full border border-border bg-muted/50">
            <ShieldCheck className="size-4" />
          </span>
          <span className="flex flex-col">
            <span className="text-xs font-semibold text-foreground">
              Secure check unavailable
            </span>
            <span className="text-[0.7rem]">Turnstile is not configured</span>
          </span>
        </div>
      );
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
