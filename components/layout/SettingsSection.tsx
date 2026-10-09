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
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {status ? <CardAction>{status}</CardAction> : null}
      </CardHeader>
      {children ? (
        <CardContent className={cn("grid gap-4", contentClassName)}>
          {children}
        </CardContent>
      ) : null}
      {footer || footerHint ? (
        // The hint takes the width the actions leave. Once that would fall
        // under about 16rem the actions wrap to their own row, right-aligned.
        <CardFooter className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {footerHint ? (
            <p className="text-muted-foreground min-w-0 grow basis-64 text-sm">
              {footerHint}
            </p>
          ) : null}
          {footer ? (
            <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
              {footer}
            </div>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}

/**
 * A flat strip of headline numbers: one card, divided cells. Two columns on a
 * phone (an odd last cell spans both), one row from `sm` up. Borders are set
 * per cell so a row's last cell never carries one and wrapped rows get a top
 * rule. Cells align to the top, so a helper line never shifts the number.
 */
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
      <dl className="grid grid-cols-2 sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none">
        {items.map((item, index) => (
          <div
            key={index}
            className="border-border grid content-start gap-1 px-4 py-3 max-sm:last:odd:col-span-2 max-sm:even:border-l max-sm:[&:nth-child(n+3)]:border-t sm:[&:not(:first-child)]:border-l"
          >
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
