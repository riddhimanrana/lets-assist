import * as React from "react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One settings block: a title and description, the controls, and a footer row
 * with a hint on the left and the action on the right. Use `tone="danger"` for
 * destructive blocks. A section with only switches or rows needs no footer.
 */
function SettingsSection({
  title,
  description,
  status,
  footer,
  footerHint,
  tone = "default",
  className,
  contentClassName,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Card>, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  status?: React.ReactNode;
  footer?: React.ReactNode;
  footerHint?: React.ReactNode;
  tone?: "default" | "danger";
  contentClassName?: string;
}) {
  return (
    <Card
      data-slot="settings-section"
      data-tone={tone}
      className={cn(tone === "danger" && "ring-destructive/30", className)}
      {...props}
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {status ? <CardAction>{status}</CardAction> : null}
      </CardHeader>
      {children ? (
        <CardContent className={cn("grid gap-4", contentClassName)}>
          {children}
        </CardContent>
      ) : null}
      {footer || footerHint ? (
        <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-sm">{footerHint}</p>
          {footer ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {footer}
            </div>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}

/** A flat strip of headline numbers: one card, divided cells. */
function StatStrip({
  items,
  className,
}: {
  items: Array<{
    label: React.ReactNode;
    value: React.ReactNode;
    helper?: React.ReactNode;
  }>;
  className?: string;
}) {
  return (
    <Card data-slot="stat-strip" className={cn("py-0", className)}>
      <dl className="divide-border grid grid-cols-2 divide-x divide-y sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none sm:divide-y-0">
        {items.map((item, index) => (
          <div key={index} className="grid gap-1 px-4 py-3">
            <dt className="text-muted-foreground text-xs">{item.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{item.value}</dd>
            {item.helper ? (
              <dd className="text-muted-foreground text-xs">{item.helper}</dd>
            ) : null}
          </div>
        ))}
      </dl>
    </Card>
  );
}

export { SettingsSection, StatStrip };
