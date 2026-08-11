import { formatDistanceToNowStrict } from "date-fns";
import { ChevronRight, Pin } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { PlatformFeedItem } from "@/types";

/**
 * One row inside the host feed card. Row-shaped rather than card-shaped so a
 * handful of organization updates stay secondary to the project feed below.
 */
export function PluginFeedItemCard({ item }: { item: PlatformFeedItem }) {
  const publishedAt = new Date(item.publishedAt);
  const publishedLabel = Number.isNaN(publishedAt.getTime())
    ? null
    : formatDistanceToNowStrict(publishedAt, { addSuffix: true });

  return (
    <Link
      href={item.href}
      className="flex items-start gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none sm:px-5"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="secondary" className="shrink-0">
            {item.badgeLabel}
          </Badge>
          {item.pinned && (
            <Badge variant="outline" className="shrink-0 gap-1">
              <Pin className="h-3 w-3" aria-hidden="true" />
              Pinned
            </Badge>
          )}
          {publishedLabel && (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {publishedLabel}
            </span>
          )}
        </div>
        {/* Capped measure: the row is page-wide, but prose should not be. */}
        <p className="max-w-3xl truncate text-sm font-medium">{item.title}</p>
        {item.summary && (
          <p className="max-w-3xl truncate text-sm text-muted-foreground">
            {item.summary}
          </p>
        )}
      </div>
      <ChevronRight
        className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </Link>
  );
}
