"use client";

import { Star } from "lucide-react";

import { cn } from "@/lib/utils";
import { useState } from "react";

interface StarRatingInputProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  size?: "default" | "lg";
  className?: string;
}

/**
 * Accessible 1-5 star input shared by the in-app card and the email-link
 * page. Implemented as a real radiogroup (roving tabindex + arrow keys)
 * rather than a shadcn RadioGroup because the control is a single row of
 * icon buttons where hover previews the pending value — the visual model
 * radio dots cannot express.
 */
export function StarRatingInput({
  value,
  onChange,
  disabled,
  size = "default",
  className,
}: StarRatingInputProps) {
  const [hovered, setHovered] = useState(0);
  const shown = hovered || value;

  const move = (event: React.KeyboardEvent, next: number) => {
    event.preventDefault();
    onChange(Math.min(5, Math.max(1, next)));
  };

  return (
    <div
      role="radiogroup"
      aria-label="Rate this project from 1 to 5 stars"
      aria-required="true"
      className={cn("flex items-center gap-1", className)}
      onMouseLeave={() => setHovered(0)}
    >
      {[1, 2, 3, 4, 5].map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          aria-label={`${option} star${option > 1 ? "s" : ""}`}
          // Roving tabindex: the group is one tab stop, arrows move within it.
          tabIndex={value === option || (value === 0 && option === 1) ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(option)}
          onMouseEnter={() => setHovered(option)}
          onFocus={() => setHovered(option)}
          onBlur={() => setHovered(0)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowUp") {
              move(event, (value || 0) + 1);
            } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
              move(event, (value || 1) - 1);
            } else if (event.key === "Home") {
              move(event, 1);
            } else if (event.key === "End") {
              move(event, 5);
            }
          }}
          className={cn(
            "flex items-center justify-center rounded-md transition-colors",
            "hover:bg-muted focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
            size === "lg" ? "size-12" : "size-11 sm:size-9",
          )}
        >
          <Star
            className={cn(
              size === "lg" ? "size-8" : "size-7 sm:size-6",
              option <= shown
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/40",
            )}
          />
        </button>
      ))}
    </div>
  );
}

/** Read-only star display for summaries and submitted feedback. */
export function StarRatingDisplay({
  rating,
  className,
  size = "sm",
}: {
  rating: number;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn("flex items-center gap-0.5", className)}
      aria-label={`${rating} of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((option) => (
        <Star
          key={option}
          aria-hidden="true"
          className={cn(
            size === "md" ? "size-5" : "size-4",
            option <= rating
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/30",
          )}
        />
      ))}
    </span>
  );
}
