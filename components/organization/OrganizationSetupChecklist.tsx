"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { OrganizationSetupChecklist as Checklist } from "@/lib/organization/setup-checklist";
import { setOrganizationSetupChecklistDismissed } from "@/app/organization/[id]/server/setup-checklist-mutations";

interface Props {
  organizationId: string;
  checklist: Checklist;
}

/**
 * Shown to organization admins until setup is finished or dismissed. The
 * caller decides whether to render this at all via `checklist.shouldShow`, so
 * this component does not re-derive visibility.
 */
export default function OrganizationSetupChecklist({
  organizationId,
  checklist,
}: Props) {
  const [hidden, setHidden] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (hidden) return null;

  const { items, completedCount, totalCount } = checklist;
  const percent = totalCount === 0 ? 0 : (completedCount / totalCount) * 100;

  function dismiss() {
    startTransition(async () => {
      const result = await setOrganizationSetupChecklistDismissed(
        organizationId,
        true,
      );

      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      setHidden(true);
      toast.success("Setup checklist hidden", {
        description: "You can still finish these steps from settings.",
      });
    });
  }

  return (
    <section
      aria-labelledby="organization-setup-heading"
      className="mt-6 rounded-xl border border-border/60 bg-card p-4 shadow-xs sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            id="organization-setup-heading"
            className="text-base font-semibold sm:text-lg"
          >
            Finish setting up your organization
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {completedCount} of {totalCount} done
          </p>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={dismiss}
          disabled={isPending}
          aria-label="Hide the setup checklist"
        >
          <X className="size-4" />
        </Button>
      </div>

      <Progress
        value={percent}
        className="mt-4 h-2"
        aria-label={`Setup progress: ${completedCount} of ${totalCount} steps complete`}
      />

      <ul className="mt-4 flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              aria-current={item.complete ? undefined : "step"}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-3 transition-colors",
                "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                item.complete && "opacity-60",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  item.complete
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/40",
                )}
              >
                {item.complete && <Check className="size-3" />}
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-sm font-medium",
                    item.complete && "line-through",
                  )}
                >
                  {item.title}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {item.description}
                </span>
              </span>

              {!item.complete && (
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              )}

              <span className="sr-only">
                {item.complete ? "Complete" : "Not started"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
