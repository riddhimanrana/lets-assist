import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import type { PlatformDashboardCard as PlatformDashboardCardData } from "@/types";

const STATUS_VARIANTS = {
  positive: "success",
  warning: "warning",
  neutral: "secondary",
} as const satisfies Record<
  NonNullable<PlatformDashboardCardData["status"]>["tone"],
  React.ComponentProps<typeof Badge>["variant"]
>;

/**
 * One row of the plugin strip that sits above the dashboard's stat strip.
 * Numbers use the same label, value, helper cell as `StatStrip` so plugin
 * figures read like the platform's own.
 */
export function PluginDashboardCard({
  card,
}: {
  card: PlatformDashboardCardData;
}) {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:gap-8">
      <div className="grid min-w-0 gap-1.5 lg:w-56 lg:shrink-0">
        <h2 className="truncate text-base leading-snug font-medium">
          {card.title}
        </h2>
        {card.status && (
          <Badge variant={STATUS_VARIANTS[card.status.tone]}>
            {card.status.label}
          </Badge>
        )}
      </div>

      {card.stats.length > 0 && (
        <dl className="flex min-w-0 flex-1 flex-wrap gap-x-8 gap-y-3">
          {card.stats.map((stat) => (
            <div key={stat.label} className="grid min-w-0 gap-1">
              <dt className="text-muted-foreground truncate text-xs">
                {stat.label}
              </dt>
              <dd className="text-xl font-semibold tabular-nums">
                {stat.value}
              </dd>
              {stat.hint && (
                <dd className="text-muted-foreground truncate text-xs">
                  {stat.hint}
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}

      {/* The strip can hold a row per plugin, and "Open" on its own is the
          classic ambiguous link: out of context every row reads the same. The
          visible word stays the prefix of the accessible name. */}
      <Link
        href={card.href}
        aria-label={`Open ${card.title}`}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "w-full shrink-0 lg:ml-auto lg:w-auto",
        )}
      >
        Open
        <ChevronRight data-icon="inline-end" aria-hidden="true" />
      </Link>
    </div>
  );
}
