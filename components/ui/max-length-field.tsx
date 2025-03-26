"use client"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface MaxLengthFieldProps {
  label: string;
  current: number;
  max: number;
  required?: boolean;
  className?: string;
}

export function MaxLengthField({
  label,
  current,
  max,
  required = false,
  className
}: MaxLengthFieldProps) {
  const getCounterColor = (current: number, max: number) => {
    const percentage = (current / max) * 100;
    if (percentage >= 90) return "text-destructive";
    if (percentage >= 75) return "text-chart-6";
    return "text-muted-foreground";
  };

  return (
    <div className={cn("flex justify-between items-baseline", className)}>
      <Label>{label}{required && "*"}</Label>
      <span
        className={cn(
          "text-xs transition-colors",
          getCounterColor(current, max)
        )}
      >
        {current}/{max}
      </span>
    </div>
  );
}