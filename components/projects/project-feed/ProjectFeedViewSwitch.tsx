"use client";

import { LayoutGrid, List, Map, Table2 } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import type { ProjectFeedFilterProps, ProjectFeedView } from "./types";

const VIEWS: Array<{
  value: ProjectFeedView;
  label: string;
  icon: typeof LayoutGrid;
}> = [
  { value: "card", label: "Card view", icon: LayoutGrid },
  { value: "list", label: "List view", icon: List },
  { value: "table", label: "Table view", icon: Table2 },
  { value: "map", label: "Map view", icon: Map },
];

const isView = (value: unknown): value is ProjectFeedView =>
  VIEWS.some((option) => option.value === value);

/** One segmented control for the four ways to look at the feed. */
export function ProjectFeedViewSwitch({
  view,
  setView,
  className,
}: Pick<ProjectFeedFilterProps, "view" | "setView"> & { className?: string }) {
  return (
    <ToggleGroup
      aria-label="Project view"
      variant="outline"
      className={cn("shrink-0", className)}
      value={[view]}
      onValueChange={(value) => {
        const nextView = value[0];
        if (isView(nextView)) setView(nextView);
      }}
    >
      {VIEWS.map(({ value, label, icon: Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={label}
          title={label}
          className="px-2.5"
        >
          <Icon aria-hidden="true" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
