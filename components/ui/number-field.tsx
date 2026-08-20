"use client";

import * as React from "react";
import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";

import { cn } from "@/lib/utils";

/**
 * Groups the stepper parts and owns the value. When `name` is set the root
 * also renders a hidden `<input type="number">`, so a number field posts
 * through plain FormData without any mirrored state.
 */
function NumberField({
  className,
  ...props
}: React.ComponentProps<typeof NumberFieldPrimitive.Root>) {
  return (
    <NumberFieldPrimitive.Root
      data-slot="number-field"
      className={cn("w-full", className)}
      {...props}
    />
  );
}

/** The bordered shell that holds decrement, input and increment as one control. */
function NumberFieldGroup({
  className,
  ...props
}: React.ComponentProps<typeof NumberFieldPrimitive.Group>) {
  return (
    <NumberFieldPrimitive.Group
      data-slot="number-field-group"
      className={cn(
        "dark:bg-input/30 border-input h-9 flex w-full min-w-0 items-stretch overflow-hidden rounded-md border bg-transparent shadow-xs transition-[color,box-shadow]",
        "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
        "has-aria-invalid:border-destructive has-aria-invalid:ring-destructive/20 dark:has-aria-invalid:ring-destructive/40 has-aria-invalid:ring-[3px]",
        "has-disabled:pointer-events-none has-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

const stepperButton = cn(
  "text-muted-foreground hover:text-foreground hover:bg-muted/60 flex w-9 shrink-0 items-center justify-center transition-colors outline-none select-none",
  "active:bg-muted disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none",
  "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
);

function NumberFieldDecrement({
  className,
  ...props
}: React.ComponentProps<typeof NumberFieldPrimitive.Decrement>) {
  return (
    <NumberFieldPrimitive.Decrement
      data-slot="number-field-decrement"
      className={cn(stepperButton, "border-input border-r", className)}
      {...props}
    />
  );
}

function NumberFieldIncrement({
  className,
  ...props
}: React.ComponentProps<typeof NumberFieldPrimitive.Increment>) {
  return (
    <NumberFieldPrimitive.Increment
      data-slot="number-field-increment"
      className={cn(stepperButton, "border-input border-l", className)}
      {...props}
    />
  );
}

function NumberFieldInput({
  className,
  ...props
}: React.ComponentProps<typeof NumberFieldPrimitive.Input>) {
  return (
    <NumberFieldPrimitive.Input
      data-slot="number-field-input"
      className={cn(
        "text-foreground placeholder:text-muted-foreground w-full min-w-0 flex-1 bg-transparent px-2 py-1 text-center text-base tabular-nums outline-none md:text-sm",
        "disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}

export {
  NumberField,
  NumberFieldGroup,
  NumberFieldDecrement,
  NumberFieldInput,
  NumberFieldIncrement,
};
