"use client";

import Link from "next/link";
import type { ComponentProps, ComponentType, ReactNode, Ref } from "react";
import type { VariantProps } from "class-variance-authority";

import {
  useAnimatedIcon,
  type AnimatedIconHandle,
} from "@/components/icons/animated";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

type AnimatedIconComponent = ComponentType<{
  ref?: Ref<AnimatedIconHandle>;
  size?: number;
  "aria-hidden"?: boolean | "true" | "false";
  "data-icon"?: string;
}>;

/**
 * A link styled as a button whose icon plays once when the link is hovered or
 * focused. For the primary action of a page or an empty state.
 */
export function AnimatedLinkButton({
  href,
  icon: Icon,
  iconPosition = "inline-start",
  variant,
  size,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, "className" | "children"> &
  VariantProps<typeof buttonVariants> & {
    icon: AnimatedIconComponent;
    iconPosition?: "inline-start" | "inline-end";
    className?: string;
    children: ReactNode;
  }) {
  const icon = useAnimatedIcon();
  const glyph = (
    <Icon
      ref={icon.ref}
      size={16}
      data-icon={iconPosition}
      aria-hidden="true"
    />
  );

  return (
    <Link
      href={href}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
      {...icon.triggerProps}
    >
      {iconPosition === "inline-start" ? glyph : null}
      {children}
      {iconPosition === "inline-end" ? glyph : null}
    </Link>
  );
}
