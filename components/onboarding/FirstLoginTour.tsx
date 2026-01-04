"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FIRST_LOGIN_TOUR_STEPS } from "@/components/onboarding/first-login-tour-steps";
import type { Step, Tour } from "nextstepjs";

type FirstLoginTourProps = {
  isOpen: boolean;
  onComplete: () => void;
  onSkip?: () => void;
};

type HighlightStyle = {
  top: number;
  left: number;
  width: number;
  height: number;
  borderRadius?: string;
};

const waitForPathname = async (
  getPathname: () => string | null,
  expectedPathname: string,
  timeout = 4000,
) => {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const deadline = now() + timeout;

  await new Promise<void>((resolve) => {
    const check = () => {
      const current = getPathname();
      if (current === expectedPathname) {
        resolve();
        return;
      }

      if (now() > deadline) {
        resolve();
        return;
      }

      window.setTimeout(check, 50);
    };

    check();
  });
};

const waitForSelector = async (selector: string | undefined, timeout = 4000) => {
  if (!selector) {
    return;
  }

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const deadline = now() + timeout;

  await new Promise<void>((resolve) => {
    const check = () => {
      if (typeof document === "undefined") {
        resolve();
        return;
      }

      if (document.querySelector(selector)) {
        resolve();
        return;
      }

      if (now() > deadline) {
        resolve();
        return;
      }

      window.setTimeout(check, 200);
    };

    check();
  });
};

export default function FirstLoginTour({ isOpen, onComplete, onSkip }: FirstLoginTourProps) {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef<string | null>(pathname);
  const [currentStep, setCurrentStep] = useState(0);
  const [highlightStyle, setHighlightStyle] = useState<HighlightStyle | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const navigationHistory = useRef<string[]>([]);
  const [highlightPortalRoot, setHighlightPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // FIRST_LOGIN_TOUR_STEPS historically has two formats in this repo:
  // - a flat array of Step[] (the version we expect)
  // - an array of Tour objects: { tour: string, steps: Step[] }
  // To be compatible with both formats (and avoid runtime "invalid element type" errors),
  // flatten the steps if needed and use that array consistently.
  const flattenedSteps = useMemo<Step[]>(() => {
    if (FIRST_LOGIN_TOUR_STEPS.length === 0) return [];
    const first = FIRST_LOGIN_TOUR_STEPS[0] as Tour;
    if (first && Array.isArray(first.steps)) {
      return first.steps as Step[];
    }
    return FIRST_LOGIN_TOUR_STEPS as unknown as Step[];
  }, []);

  const step = useMemo<Step>(() => flattenedSteps[currentStep], [currentStep, flattenedSteps]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const attrName = "data-first-login-tour";
    if (isOpen) {
      document.body.setAttribute(attrName, "true");
    } else {
      document.body.removeAttribute(attrName);
    }
  }, [isOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const style = document.createElement("style");
    style.setAttribute("data-first-login-tour-styles", "true");
    style.textContent = `
/* Hide all Dialog overlays during tour */
body[data-first-login-tour='true'] [data-radix-dialog-overlay],
body[data-first-login-tour='true'] [data-state="open"][data-radix-dialog-overlay],
body[data-first-login-tour='true'] .radix-overlay {
  display: none !important;
}

/* Hide ALL close buttons - target every possible selector */
body[data-first-login-tour='true'] button[aria-label="Close"],
body[data-first-login-tour='true'] button[data-radix-dialog-close],
body[data-first-login-tour='true'] [data-dialog-close],
body[data-first-login-tour='true'] [role="dialog"] > button:first-child,
body[data-first-login-tour='true'] [data-radix-dialog-content] > button {
  display: none !important;
}
    `;
    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const portalRoot = document.createElement("div");
    portalRoot.setAttribute("data-first-login-highlight", "true");
    document.body.appendChild(portalRoot);
    setHighlightPortalRoot(portalRoot);

    return () => {
      document.body.removeChild(portalRoot);
      setHighlightPortalRoot(null);
    };
  }, []);

  const handleNext = useCallback(async () => {
    if (!flattenedSteps.length || currentStep === flattenedSteps.length - 1) {
      onComplete();
      return;
    }

    const current = flattenedSteps[currentStep];
    const next = flattenedSteps[currentStep + 1];
    const targetRoute = current.nextRoute;

    if (targetRoute && targetRoute !== pathname) {
      // Push current path to history before navigating
      navigationHistory.current.push(pathname ?? "/home");
      setIsNavigating(true);

      try {
        router.push(targetRoute);
        await waitForPathname(() => pathnameRef.current, targetRoute);
        await waitForSelector(next?.selector);
      } finally {
        setIsNavigating(false);
      }
    }

    setCurrentStep((prev) => prev + 1);
  }, [currentStep, flattenedSteps, onComplete, router, pathname]);

  const handleBack = useCallback(async () => {
    if (!flattenedSteps.length || currentStep === 0) {
      return;
    }

    const current = flattenedSteps[currentStep];
    const previous = flattenedSteps[currentStep - 1];
    
    // Determine target route for back navigation
    let targetRoute: string | undefined;
    
    // If we have history, pop from it
    if (navigationHistory.current.length > 0) {
      targetRoute = navigationHistory.current.pop();
    } else if (current.prevRoute) {
      // Fallback to explicit prevRoute if defined
      targetRoute = current.prevRoute;
    } else {
      // Infer from previous step's nextRoute or assume we stay on same page
      targetRoute = undefined;
    }

    const shouldRoute = Boolean(targetRoute && targetRoute !== pathname);

    if (shouldRoute) {
      setIsNavigating(true);
      try {
        router.push(targetRoute as string);
        await waitForPathname(() => pathnameRef.current, targetRoute as string);
        await waitForSelector(previous?.selector);
      } finally {
        setIsNavigating(false);
      }
    }

    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }, [currentStep, flattenedSteps, router, pathname]);

  const handleSkip = useCallback(() => {
    onSkip?.();
    onComplete();
  }, [onComplete, onSkip]);

  useEffect(() => {
    if (!isOpen) {
      setHighlightStyle(null);
      setCurrentStep(0);
      navigationHistory.current = [];
      setIsNavigating(false);
      return;
    }

    if (!step?.selector || typeof document === "undefined") {
      setHighlightStyle(null);
      return;
    }

    let rafId: number | null = null;
    let retryId: number | null = null;
    let targetElement: Element | null = null;
    const padding = 12;
    const viewportPadding = 8;

    const measure = () => {
      if (!targetElement) {
        setHighlightStyle(null);
        return;
      }

      const rect = targetElement.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(targetElement);
      const borderRadius = computedStyle.borderRadius || "1.125rem";
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const maxWidth = Math.max(viewportWidth - viewportPadding * 2, 0);
      const maxHeight = Math.max(viewportHeight - viewportPadding * 2, 0);
      const width = Math.min(rect.width + padding * 2, maxWidth);
      const height = Math.min(rect.height + padding * 2, maxHeight);

      const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
      const top = clamp(rect.top - padding, viewportPadding, viewportHeight - height - viewportPadding);
      const left = clamp(rect.left - padding, viewportPadding, viewportWidth - width - viewportPadding);

      setHighlightStyle({
        top,
        left,
        width,
        height,
        borderRadius,
      });
    };

    const updateHighlight = () => {
      if (!targetElement) return;

      targetElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });

      measure();
      rafId = window.requestAnimationFrame(measure);
    };

    const locate = () => {
      targetElement = document.querySelector(step?.selector as string);

      if (!targetElement) {
        setHighlightStyle(null);
        retryId = window.setTimeout(locate, 400);
        return;
      }

      updateHighlight();
      window.addEventListener("resize", updateHighlight);
      window.addEventListener("scroll", updateHighlight, true);
    };

    locate();

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      if (retryId) {
        window.clearTimeout(retryId);
      }
      window.removeEventListener("resize", updateHighlight);
      window.removeEventListener("scroll", updateHighlight, true);
    };
  }, [isOpen, step]);

  const highlightLayer =
    highlightPortalRoot && isOpen
      ? createPortal(
          <div className="pointer-events-none fixed inset-0 z-[90]">
            {highlightStyle ? (
              <>
                {/* Use a single div with a massive box-shadow to create the overlay with a clear cutout */}
                <div
                  className="absolute transition-all duration-300 ease-out"
                  style={{
                    top: highlightStyle.top,
                    left: highlightStyle.left,
                    width: highlightStyle.width,
                    height: highlightStyle.height,
                    borderRadius: highlightStyle.borderRadius,
                    boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.75)",
                  }}
                />
                {/* Border highlight around the cutout */}
                <div
                  className="absolute border-2 border-primary/70 transition-[top,left,width,height] duration-300 ease-out ring-2 ring-primary/30"
                  style={{
                    top: highlightStyle.top,
                    left: highlightStyle.left,
                    width: highlightStyle.width,
                    height: highlightStyle.height,
                    borderRadius: highlightStyle.borderRadius,
                  }}
                />
              </>
            ) : (
              <div className="absolute inset-0 bg-slate-950/75" />
            )}
          </div>,
          highlightPortalRoot
        )
      : null;

  return (
    <>
      {highlightLayer}
      <Dialog modal={false} open={isOpen} onOpenChange={() => {}}>
        <DialogPrimitive.Content
          className="m-0 h-screen w-screen max-w-none border-none bg-transparent p-0 shadow-none z-[100] fixed inset-0"
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogTitle className="sr-only">First login tour walkthrough</DialogTitle>
          <div className="relative flex h-full w-full items-end justify-end p-4 sm:p-8">
            <Card className="relative z-20 w-full max-w-lg shadow-2xl">
              <CardHeader className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    {/**
                     * step.icon may be either a Lucide icon component (function) or a JSX element
                     * (depending on which steps file is resolved). Support both.
                     */}
                    {(() => {
                      const Icon = step?.icon;
                      if (!Icon) return null;
                      if (typeof Icon === "function") {
                        return React.createElement(Icon, { className: "h-6 w-6" });
                      }
                      // If Icon is already a JSX element, render it directly (but override size if possible).
                      return Icon;
                    })()}
                  </div>
                  <div>
                    <CardTitle className="text-xl">{step.title}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <p className="text-sm text-muted-foreground">
                  {step.content}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {flattenedSteps.map((_, index) => (
                    <span
                      key={index}
                      className={cn(
                        "h-1 flex-1 rounded-full bg-muted transition-colors duration-200",
                        index <= currentStep && "bg-primary"
                      )}
                    />
                  ))}
                </div>
                {isNavigating && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                    <span>Loading the next page…</span>
                  </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Button variant="ghost" size="sm" onClick={handleSkip}>
                    Skip tour
                  </Button>
                  <div className="flex w-full gap-2 sm:w-auto">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 sm:flex-none"
                      disabled={currentStep === 0 || isNavigating}
                      onClick={handleBack}
                    >
                      Back
                    </Button>
                    <Button
                      className="flex-1 sm:flex-none"
                      onClick={handleNext}
                      disabled={isNavigating}
                    >
                      {currentStep === flattenedSteps.length - 1 ? "Continue" : "Next"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </DialogPrimitive.Content>
      </Dialog>
    </>
  );
}