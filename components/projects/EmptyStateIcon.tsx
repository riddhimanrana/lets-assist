"use client";

import { useEffect, type ComponentType, type Ref } from "react";

import {
  useAnimatedIcon,
  type AnimatedIconHandle,
} from "@/components/icons/animated";

type AnimatedIconComponent = ComponentType<{
  ref?: Ref<AnimatedIconHandle>;
  size?: number;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

/**
 * The icon of an empty or confirmation state. It plays once shortly after it
 * appears and then rests. Reduced-motion users get the still glyph.
 */
export function EmptyStateIcon({
  icon: Icon,
  size = 24,
  className,
}: {
  icon: AnimatedIconComponent;
  size?: number;
  className?: string;
}) {
  const icon = useAnimatedIcon();
  const play = icon.triggerProps.onMouseEnter;

  useEffect(() => {
    const timer = window.setTimeout(play, 200);
    return () => window.clearTimeout(timer);
  }, [play]);

  return (
    <Icon ref={icon.ref} size={size} className={className} aria-hidden="true" />
  );
}
