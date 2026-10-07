"use client";

import { Flag, MoreVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * The overflow menu on a project card or row. It is always visible so it is
 * reachable by touch and keyboard, and it never follows the surrounding link.
 */
export function ProjectReportMenu({
  onReport,
  className,
}: {
  onReport: () => void;
  className?: string;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn("text-muted-foreground", className)}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <MoreVertical aria-hidden="true" />
            <span className="sr-only">Open menu</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onReport();
          }}
        >
          <Flag aria-hidden="true" />
          Report project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
