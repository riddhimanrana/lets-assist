import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The segmented look of the default `TabsList` (muted track, raised active
 * pill) for switches that are not client tab panels: views changed by a link,
 * or a small set of filter states. Those keep their link or pressed-button
 * semantics, which a `role="tab"` trigger would replace. Use `Tabs` when the
 * panes live on the page, and this when each segment navigates or filters.
 */
function SegmentedControl({
  as: Element = "div",
  className,
  ...props
}: ComponentProps<"div"> & { as?: "div" | "nav" }) {
  return (
    <Element
      data-slot="segmented-control"
      className={cn(
        "bg-muted text-muted-foreground inline-flex h-9 w-fit max-w-full shrink-0 items-center overflow-x-auto rounded-lg p-[3px]",
        className,
      )}
      {...props}
    />
  );
}

function SegmentedItem({
  active,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant" | "size"> & {
  active: boolean;
}) {
  return (
    <Button
      variant="ghost"
      data-slot="segmented-item"
      data-active={active ? "" : undefined}
      className={cn(
        "h-full shrink-0 gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap",
        active
          ? "bg-background text-foreground hover:bg-background dark:border-input dark:bg-input/30 dark:hover:bg-input/30 shadow-sm"
          : "text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground hover:bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

export { SegmentedControl, SegmentedItem };
