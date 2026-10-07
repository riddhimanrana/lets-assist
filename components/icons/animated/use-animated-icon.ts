"use client";

import { useCallback, useMemo, useRef } from "react";

export interface AnimatedIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
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
