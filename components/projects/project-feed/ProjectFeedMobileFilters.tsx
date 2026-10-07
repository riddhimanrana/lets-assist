"use client";

import { DateRangePicker } from "@/components/ui/date-range-picker";

import { ProjectFeedFilterMenu } from "./ProjectFeedFilterMenu";
import { ProjectFeedSearchField } from "./ProjectFeedSearchField";
import { ProjectFeedViewSwitch } from "./ProjectFeedViewSwitch";
import type { ProjectFeedFilterProps } from "./types";

/**
 * Two rows on phones: search with the filter menu, then dates with the view
 * switch. Both rows share the same left and right edges.
 */
export function ProjectFeedMobileFilters(props: ProjectFeedFilterProps) {
  const {
    searchTerm,
    setSearchTerm,
    dateFilter,
    setDateFilter,
    view,
    setView,
  } = props;

  return (
    <div className="flex flex-col gap-2 md:hidden">
      <div className="flex items-center gap-2">
        <ProjectFeedSearchField
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          className="min-w-0 flex-1"
        />
        <ProjectFeedFilterMenu {...props} idPrefix="feed-mobile" iconOnly />
      </div>
      <div className="flex items-center gap-2">
        <DateRangePicker
          value={dateFilter}
          onChange={setDateFilter}
          align="start"
          placeholder="Any date"
          className="min-w-0 flex-1 [&_button]:w-full [&_button]:min-w-0 [&_button]:overflow-hidden"
        />
        <ProjectFeedViewSwitch view={view} setView={setView} />
      </div>
    </div>
  );
}
