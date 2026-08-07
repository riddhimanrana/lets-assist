import { ChevronRight, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { resolvePlatformFeedItems } from "@/lib/plugins/resolve-platform-surfaces";
import { cn } from "@/lib/utils";

import { PluginFeedItemCard } from "./PluginFeedItemCard";

/**
 * Deliberately small. This section is context for the page, not the page —
 * the project feed below it is what people come to /home for.
 */
const HOME_FEED_LIMIT = 3;

export async function PluginFeedSection({ userId }: { userId: string }) {
  const items = (
    await resolvePlatformFeedItems(userId, { limit: HOME_FEED_LIMIT })
  ).slice(0, HOME_FEED_LIMIT);
  if (items.length === 0) return null;

  const sources = Array.from(
    new Set(
      items
        .map((item) => item.sourceHref)
        .filter((href): href is string => Boolean(href)),
    ),
  );
  const viewAllHref = sources.length === 1 ? sources[0] : "/organizations";

  return (
    <section className="mb-6 sm:mb-8" data-tour-id="home-plugin-feed">
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">From your organizations</h2>
            <p className="truncate text-sm text-muted-foreground">
              Recent updates from groups you belong to
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link
              href={viewAllHref}
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "text-muted-foreground",
              )}
            >
              View all
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            {/* Quiet route to the switch that turns this section off. */}
            <Link
              href="/account/plugins"
              title="Plugin content settings"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "text-muted-foreground",
              )}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Plugin content settings</span>
            </Link>
          </div>
        </div>
        <ul className="divide-y">
          {items.map((item) => (
            <li key={`${item.href}-${item.id}`}>
              <PluginFeedItemCard item={item} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
