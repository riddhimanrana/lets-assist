import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const TONE_CLASS = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
} as const;

/**
 * A short, single-purpose page: one icon, what happened, one line of help and
 * at most two actions with one primary. Used for confirmations, expired links,
 * not-found and error screens. Left-aligned on a narrow measure.
 */
export function NoticePage({
  icon,
  tone = "neutral",
  title,
  description,
  children,
  actions,
  className,
}: {
  icon?: ReactNode;
  tone?: keyof typeof TONE_CLASS;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center gap-6 px-4 py-12 sm:px-6",
        className,
      )}
    >
      {icon ? (
        <div className={cn("[&_svg]:size-6", TONE_CLASS[tone])}>{icon}</div>
      ) : null}
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground text-sm text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      {children}
      {actions ? (
        <div className="flex flex-col gap-2 sm:flex-row">{actions}</div>
      ) : null}
    </div>
  );
}
