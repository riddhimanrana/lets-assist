"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  const [open, setOpen] = useState(false);
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

  const nextItem = items.find((item) => !item.complete);

  return (
    <section aria-labelledby="organization-setup-heading">
      {/* One compact row so the page content stays above the fold. The steps
          stay mounted while collapsed, so each link is one press away. */}
      <Card className="gap-0 py-0">
        <Collapsible open={open} onOpenChange={setOpen}>
          <div className="flex items-center gap-2 py-2 pr-2 pl-4">
            <div className="grid min-w-0 flex-1 gap-1">
              <h2
                id="organization-setup-heading"
                className="truncate text-sm font-medium"
              >
                Finish setting up your organization
              </h2>
              <div className="flex items-center gap-3">
                <Progress
                  value={percent}
                  className="max-w-56 flex-1"
                  aria-label={`Setup progress: ${completedCount} of ${totalCount} steps complete`}
                />
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {completedCount} of {totalCount} done
                </span>
              </div>
            </div>

            {nextItem ? (
              <Button
                variant="ghost"
                size="sm"
                className="hidden max-w-64 sm:inline-flex"
                nativeButton={false}
                render={<Link href={nextItem.href} />}
              >
                <span className="truncate">Next: {nextItem.title}</span>
                <ChevronRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            ) : null}
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label={open ? "Hide setup steps" : "Show setup steps"}
                >
                  <ChevronDown
                    className={cn("transition-transform", open && "rotate-180")}
                    aria-hidden="true"
                  />
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={dismiss}
              disabled={isPending}
              aria-label="Hide the setup checklist"
            >
              <X aria-hidden="true" />
            </Button>
          </div>

          <CollapsibleContent keepMounted>
            <ul className="grid border-t p-2">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    aria-current={item.complete ? undefined : "step"}
                    className="hover:bg-muted focus-visible:ring-ring/50 flex min-h-9 items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors outline-none focus-visible:ring-[3px]"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full border",
                        item.complete
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {item.complete && <Check className="size-3" />}
                    </span>
                    <span className="grid min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
                      <span
                        className={cn(
                          "shrink-0 font-medium",
                          item.complete && "text-muted-foreground line-through",
                        )}
                      >
                        {item.title}
                      </span>
                      <span className="text-muted-foreground truncate">
                        {item.description}
                      </span>
                    </span>
                    {!item.complete && (
                      <ChevronRight
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="sr-only">
                      {item.complete ? "Complete" : "Not started"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </section>
  );
}
