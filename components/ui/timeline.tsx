import * as React from "react";
import { cn } from "@/lib/utils";

// --- Main Timeline Container ---
const Timeline = React.forwardRef<
  HTMLOListElement,
  React.HTMLAttributes<HTMLOListElement>
>(({ className, ...props }, ref) => (
  <ol ref={ref} className={cn("relative space-y-8", className)} {...props} />
));
Timeline.displayName = "Timeline";

// --- Timeline Item ---
interface TimelineItemProps extends React.HTMLAttributes<HTMLLIElement> {
  status?: "current" | "passed" | "future";
}

const TimelineItem = React.forwardRef<HTMLLIElement, TimelineItemProps>(
  ({ className, status = "future", ...props }, ref) => (
    <li
      ref={ref}
      className={cn("relative flex flex-col", className)}
      data-status={status}
      {...props}
    />
  )
);
TimelineItem.displayName = "TimelineItem";

// --- Timeline Connector ---
const TimelineConnector = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "absolute left-[18px] top-[44px] h-full w-0.5", // Positioned relative to the icon center
      "bg-muted group-data-[status=passed]:bg-primary group-data-[status=current]:bg-primary", // Color based on parent status
      className
    )}
    {...props}
  />
));
TimelineConnector.displayName = "TimelineConnector";

// --- Timeline Header ---
const TimelineHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("relative flex items-start gap-4", className)}
    {...props}
  />
));
TimelineHeader.displayName = "TimelineHeader";

// --- Timeline Icon ---
interface TimelineIconProps extends React.HTMLAttributes<HTMLDivElement> {
  status?: "current" | "passed" | "future";
}

const TimelineIcon = React.forwardRef<HTMLDivElement, TimelineIconProps>(
  ({ className, status = "future", children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-4",
        "border-muted bg-background text-muted-foreground", // Default (future)
        status === "passed" && "border-primary bg-primary text-primary-foreground", // Passed
        status === "current" && "border-primary bg-primary/20 text-primary", // Current
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);
TimelineIcon.displayName = "TimelineIcon";

// --- Timeline Title ---
const TimelineTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, children, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-lg font-semibold",
      "group-data-[status=passed]:text-primary group-data-[status=current]:text-primary", // Color based on parent status
      className
    )}
    {...props}
  >
    {children}
  </h3>
));
TimelineTitle.displayName = "TimelineTitle";

// --- Timeline Description ---
const TimelineDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  >
    {children}
  </p>
));
TimelineDescription.displayName = "TimelineDescription";

// --- Timeline Content ---
const TimelineContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "ml-[52px] mt-2 border rounded-lg p-4 shadow-sm", // Aligned with header content, added padding/border
      "border-muted", // Default border
      "group-data-[status=passed]:border-primary/30", // Passed border
      "group-data-[status=current]:border-primary border-2", // Current border
      className
    )}
    {...props}
  >
    {children}
  </div>
));
TimelineContent.displayName = "TimelineContent";

export {
  Timeline,
  TimelineItem,
  TimelineConnector,
  TimelineHeader,
  TimelineIcon,
  TimelineTitle,
  TimelineDescription,
  TimelineContent,
};
