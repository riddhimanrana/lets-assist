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
      className="hover:bg-muted/50 focus-visible:ring-ring/50 flex items-center gap-3 px-4 py-3 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-inset motion-reduce:transition-none"
    >
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="secondary" className="shrink-0">
            {item.badgeLabel}
          </Badge>
          {item.pinned && (
            <Badge variant="outline" className="shrink-0">
              <Pin data-icon="inline-start" aria-hidden="true" />
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
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden="true"
      />
    </Link>
  );
}
