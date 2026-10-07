import { ChevronRight, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <section data-tour-id="home-plugin-feed">
      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle>
            <h2>From your organizations</h2>
          </CardTitle>
          <CardDescription>
            Recent updates from groups you belong to
          </CardDescription>
          <CardAction className="flex items-center gap-1">
            <Link
              href={viewAllHref}
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "text-muted-foreground",
              )}
            >
              View all
              <ChevronRight data-icon="inline-end" aria-hidden="true" />
            </Link>
            {/* Quiet route to the switch that turns this section off. */}
            <Link
              href="/account/plugins"
              title="Organization content settings"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "text-muted-foreground",
              )}
            >
              <SlidersHorizontal aria-hidden="true" />
              <span className="sr-only">Organization content settings</span>
            </Link>
          </CardAction>
        </CardHeader>
        <ul className="divide-y">
          {items.map((item) => (
            <li key={`${item.href}-${item.id}`}>
              <PluginFeedItemCard item={item} />
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
