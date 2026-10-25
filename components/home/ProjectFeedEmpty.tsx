import type { ComponentProps } from "react";
import Link from "next/link";
import {
  CalendarSearch,
  CircleAlert,
  Lock,
  SearchX,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export type ProjectFeedEmptyState =
  "empty" | "filtered" | "restricted" | "error";

/** Who can see which projects, in the order a volunteer meets them. */
export const PROJECT_FEED_VISIBILITY_RULES = [
  "Published public projects with upcoming dates and open spots appear here.",
  "Unlisted projects open from the link their organizer shares.",
  "Organization-only projects are visible to that organization's members.",
] as const;

const COPY: Record<
  ProjectFeedEmptyState,
  { icon: LucideIcon; title: string; description: string }
> = {
  empty: {
    icon: CalendarSearch,
    title: "No projects in your feed right now",
    description:
      "Explore an organization to find opportunities shared with its members, or ask an organizer for a project link.",
  },
  filtered: {
    icon: SearchX,
    title: "No projects match your filters",
    description:
      "Try a different search, or clear your filters to see everything in your feed.",
  },
  restricted: {
    icon: Lock,
    title: "You can't view this feed right now",
    description:
      "Your session may have ended, or you may not have access to these projects. Sign in again, or open the link your organizer shared.",
  },
  error: {
    icon: CircleAlert,
    title: "Couldn't load projects",
    description: "Check your connection and try loading projects again.",
  },
};

/**
 * The project feed when it has nothing to list. Each state says what happened
 * and what to do next, and offers at most one action.
 *
 * Pass `restricted` only for a real 401 or 403 from the feed. An error keeps
 * a solid tinted border and the alert role so it never reads as an empty feed.
 */
export function ProjectFeedEmpty({
  state,
  onClear,
  onRetry,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  state: ProjectFeedEmptyState;
  onClear?: () => void;
  onRetry?: () => void;
}) {
  const { icon: Icon, title, description } = COPY[state];
  const isError = state === "error";
  const showRules = state === "empty" || state === "restricted";
  const action =
    state === "filtered" && onClear ? (
      <Button variant="outline" onClick={onClear}>
        Clear all filters
      </Button>
    ) : isError && onRetry ? (
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    ) : showRules ? (
      <Link
        href="/organization"
        className={buttonVariants({ variant: "outline" })}
      >
        Explore organizations
      </Link>
    ) : null;

  return (
    <Empty
      data-feed-state={state}
      role={isError ? "alert" : undefined}
      className={cn(
        "border",
        isError && "border-destructive/30 border-solid",
        className,
      )}
      {...props}
    >
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className={isError ? "bg-destructive/10 text-destructive" : undefined}
        >
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {showRules || action ? (
        <EmptyContent>
          {showRules ? (
            <ul className="text-muted-foreground grid list-disc gap-1.5 pl-5 text-left text-pretty">
              {PROJECT_FEED_VISIBILITY_RULES.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          ) : null}
          {action}
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
