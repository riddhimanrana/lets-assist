import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * One header for every app page: optional breadcrumb, optional leading media
 * (an avatar or logo), the title, a one-line description, and right-aligned
 * actions. Pass at most one filled primary action.
 */
function PageHeader({
  title,
  description,
  breadcrumb,
  media,
  meta,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  media?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header data-slot="page-header" className={cn("grid gap-3", className)}>
      {breadcrumb}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {media ? <div className="shrink-0">{media}</div> : null}
          <div className="grid min-w-0 gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">
              {title}
            </h1>
            {description ? (
              <p className="text-muted-foreground text-sm text-pretty">
                {description}
              </p>
            ) : null}
            {meta ? (
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {meta}
              </div>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** Heading for a block inside a page or tab: title, optional count or hint, one action. */
function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="section-header"
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export { PageHeader, SectionHeader };
