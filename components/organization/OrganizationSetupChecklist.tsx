"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
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
    <section aria-labelledby="organization-setup-heading">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="organization-setup-heading">
              Finish setting up your organization
            </h2>
          </CardTitle>
          <CardDescription>
            {completedCount} of {totalCount} done
          </CardDescription>
          <CardAction>
            <Button
              variant="ghost"
              size="icon"
              onClick={dismiss}
              disabled={isPending}
              aria-label="Hide the setup checklist"
            >
              <X aria-hidden="true" />
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="grid gap-3">
          <Progress
            value={percent}
            aria-label={`Setup progress: ${completedCount} of ${totalCount} steps complete`}
          />

          <ul className="-mx-2 flex flex-col">
            {items.map((item) => (
              <li key={item.id}>
                <Item
                  size="sm"
                  className="px-2"
                  render={
                    <Link
                      href={item.href}
                      aria-current={item.complete ? undefined : "step"}
                    />
                  }
                >
                  <ItemMedia aria-hidden="true">
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full border",
                        item.complete
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {item.complete && <Check className="size-3" />}
                    </span>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle
                      className={cn(
                        item.complete && "text-muted-foreground line-through",
                      )}
                    >
                      {item.title}
                    </ItemTitle>
                    <ItemDescription>{item.description}</ItemDescription>
                  </ItemContent>
                  {!item.complete && (
                    <ChevronRight
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <span className="sr-only">
                    {item.complete ? "Complete" : "Not started"}
                  </span>
                </Item>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
