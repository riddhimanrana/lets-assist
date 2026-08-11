"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const FOCUSABLE_TABLE_CONTENT_SELECTOR =
  'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';

/**
 * A horizontally scrollable region has to be reachable by keyboard (WCAG 2.1.1,
 * axe `scrollable-region-focusable`). Tables that already contain links, menus,
 * or form controls are reachable through those controls, and giving them a tab
 * stop as well would add a stop that goes nowhere. So the container only becomes
 * focusable when its own content offers no other way in — which is exactly the
 * read-only case, such as the change-history log.
 */
function useScrollRegionTabStop(
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [needsTabStop, setNeedsTabStop] = React.useState(false);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setNeedsTabStop(
      container.querySelector(FOCUSABLE_TABLE_CONTENT_SELECTOR) === null,
    );
  });

  return needsTabStop;
}

function Table({ className, ...props }: React.ComponentProps<"table">) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const needsTabStop = useScrollRegionTabStop(containerRef);
  // Reuse the table's own accessible name so the new stop announces the thing
  // it scrolls. Without a name there is nothing for a group to convey, so the
  // container stays a plain focusable scroll region rather than an anonymous
  // one that a screen reader would enter and leave unlabelled.
  const label = props["aria-label"];
  const labelledBy = props["aria-labelledby"];
  const named = needsTabStop && Boolean(label || labelledBy);

  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      role={named ? "group" : undefined}
      aria-label={named ? label : undefined}
      aria-labelledby={named ? labelledBy : undefined}
      tabIndex={needsTabStop ? 0 : undefined}
      className={cn(
        "relative w-full overflow-x-auto",
        needsTabStop &&
          "focus-visible:ring-ring/50 focus-visible:border-ring rounded-md outline-none focus-visible:ring-[3px]",
      )}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
