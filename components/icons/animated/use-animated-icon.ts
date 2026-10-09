"use client";

import { useCallback, useMemo, useRef } from "react";

export interface AnimatedIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

/**
 * The one reduced-motion check for this directory. The hook below uses it for
 * icons driven by a parent control, and every icon uses it in its own hover
 * handler so an icon rendered without a controlling ref stays static too.
 */
export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Lets the control that contains an animated icon drive it, so the icon plays
 * when the whole button, link, or row is hovered or focused instead of only
 * when the pointer is over the glyph itself.
 *
 *   const icon = useAnimatedIcon();
 *   <Button {...icon.triggerProps}>
 *     <BellIcon ref={icon.ref} size={16} /> Notifications
 *   </Button>
 *
 * The icon plays once per hover and never loops. Reduced-motion users get the
 * static glyph.
 */
export function useAnimatedIcon() {
  const ref = useRef<AnimatedIconHandle>(null);

  const start = useCallback(() => {
    if (!prefersReducedMotion()) ref.current?.startAnimation();
  }, []);
  const stop = useCallback(() => {
    ref.current?.stopAnimation();
  }, []);

  const triggerProps = useMemo(
    () => ({
      onMouseEnter: start,
      onMouseLeave: stop,
      onFocus: start,
      onBlur: stop,
    }),
    [start, stop],
  );

  return { ref, triggerProps };
}
