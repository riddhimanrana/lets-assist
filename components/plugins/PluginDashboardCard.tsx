import { Blocks, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import type { PlatformDashboardCard as PlatformDashboardCardData } from "@/types";

const STATUS_TONE_CLASSES: Record<
  NonNullable<PlatformDashboardCardData["status"]>["tone"],
  string
> = {
  positive: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  neutral: "",
};

/**
 * One row of the plugin strip that sits above the dashboard's stat grid.
 * Values borrow the stat-card idiom (tinted icon circle, muted label, bold
 * value, tiny sub-label) so plugin numbers read like the platform's own.
 */
export function PluginDashboardCard({
  card,
}: {
  card: PlatformDashboardCardData;
}) {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 lg:flex-row lg:items-center lg:gap-8">
      <div className="flex items-center gap-3 lg:w-56 lg:shrink-0">
        <div className="w-fit rounded-full bg-primary/10 p-2 sm:p-3">
          <Blocks
            className="h-4 w-4 text-primary sm:h-6 sm:w-6"
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0 space-y-1">
          <h2 className="truncate font-semibold">{card.title}</h2>
          {card.status && (
            <Badge
              variant={card.status.tone === "neutral" ? "secondary" : "outline"}
              className={cn(STATUS_TONE_CLASSES[card.status.tone])}
            >
              {card.status.label}
            </Badge>
          )}
        </div>
      </div>

      {card.stats.length > 0 && (
        <div className="flex min-w-0 flex-1 flex-wrap gap-x-8 gap-y-4 sm:gap-x-12">
          {card.stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <p className="truncate text-xs font-medium text-muted-foreground sm:text-sm">
                {stat.label}
              </p>
              <p className="text-xl font-bold sm:text-2xl">{stat.value}</p>
              {stat.hint && (
                <p className="truncate text-xs text-muted-foreground">
                  {stat.hint}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <Link
        href={card.href}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "w-full shrink-0 lg:ml-auto lg:w-auto",
        )}
      >
        Open
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
