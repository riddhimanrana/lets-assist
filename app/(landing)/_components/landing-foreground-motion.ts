"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Says when a looping landing demo may run its timers.
 *
 * `reduceMotion` starts from the motion library's own preference, so the
 * first render matches what the rest of the page does, and then follows the
 * media query, which the library's hook reads only once.
 *
 * `running` is false on the server and on the first render. It turns true
 * only after an effect has seen a visible document and ordinary motion, so a
 * page that opens in a background tab never starts a timer. It turns false
 * again as soon as the tab is hidden, the preference changes or `enabled`
 * is withdrawn.
 */
export function useLandingForegroundMotion(enabled = true) {
  const reducedAtRender = useReducedMotion() === true;
  const [liveReduced, setLiveReduced] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia(REDUCED_MOTION_QUERY)
        : null;

    const sync = () => {
      const reduced = media ? media.matches : reducedAtRender;
      if (media) setLiveReduced(reduced);
      setRunning(enabled && !reduced && !document.hidden);
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    media?.addEventListener?.("change", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      media?.removeEventListener?.("change", sync);
    };
  }, [enabled, reducedAtRender]);

  return { reduceMotion: liveReduced ?? reducedAtRender, running };
}
