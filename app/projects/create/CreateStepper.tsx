import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Where you are in the flow. Every step is a segment of one bar, so the shape
 * holds at any step count. From `sm` up each segment carries its number and
 * name; on a phone the segments stay and a single line names the current step
 * and the one after it.
 */
export function CreateStepper({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}) {
  const currentLabel = steps[current - 1];
  const nextLabel = steps[current];

  return (
    <nav aria-label="Progress" className="grid gap-2">
      <p
        aria-hidden="true"
        className="flex items-baseline justify-between gap-3 text-sm sm:hidden"
      >
        <span className="min-w-0 truncate font-medium">
          <span className="text-muted-foreground font-normal tabular-nums">
            {current} of {steps.length}
          </span>{" "}
          {currentLabel}
        </span>
        {nextLabel ? (
          <span className="text-muted-foreground shrink-0">
            Next: {nextLabel}
          </span>
        ) : null}
      </p>
      <ol className="flex gap-1.5 sm:gap-3">
        {steps.map((label, index) => {
          const position = index + 1;
          const isDone = position < current;
          const isCurrent = position === current;

          return (
            <li
              key={`${label}-${index}`}
              aria-current={isCurrent ? "step" : undefined}
              className="grid min-w-0 flex-1 gap-2"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-1 rounded-full",
                  isDone || isCurrent ? "bg-primary" : "bg-muted",
                )}
              />
              <span
                className={cn(
                  "sr-only min-w-0 items-center gap-1.5 text-sm sm:not-sr-only sm:flex",
                  isCurrent
                    ? "text-foreground font-medium"
                    : "text-muted-foreground",
                )}
              >
                {isDone ? (
                  <Check
                    aria-hidden="true"
                    className="text-primary size-4 shrink-0"
                  />
                ) : (
                  <span aria-hidden="true" className="tabular-nums">
                    {position}
                  </span>
                )}
                <span className="truncate">{label}</span>
                <span className="sr-only">
                  {isDone
                    ? ", completed"
                    : isCurrent
                      ? ", current step"
                      : ", not started"}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
