"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type SliderProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> & {
  value?: number[];
  defaultValue?: number[];
  onValueChange?: (value: number[]) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { className, min = 0, max = 100, step = 1, value, defaultValue, onValueChange, ...props },
  ref,
) {
  const currentValue = value?.[0] ?? defaultValue?.[0] ?? Number(min);

  return (
    <input
      ref={ref}
      type="range"
      min={min}
      max={max}
      step={step}
      value={clamp(currentValue, Number(min), Number(max))}
      onChange={(event) => onValueChange?.([Number(event.target.value)])}
      className={cn(
        "flex h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

Slider.displayName = "Slider";

export { Slider };