"use client";

import { DateRangePicker } from "@/components/ui/date-range-picker";

import { ProjectFeedFilterMenu } from "./ProjectFeedFilterMenu";
import { ProjectFeedSearchField } from "./ProjectFeedSearchField";
import { ProjectFeedViewSwitch } from "./ProjectFeedViewSwitch";
import type { ProjectFeedFilterProps } from "./types";

/** One row from md up: search and dates on the left, view and filters right. */
export function ProjectFeedDesktopFilters(props: ProjectFeedFilterProps) {
  const {
    searchTerm,
    setSearchTerm,
    dateFilter,
    setDateFilter,
    view,
    setView,
  } = props;

  return (
    <div className="hidden w-full items-center gap-2 md:flex">
      <ProjectFeedSearchField
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        className="w-72 lg:w-80"
      />
      <DateRangePicker
        value={dateFilter}
        onChange={setDateFilter}
        align="start"
        placeholder="Any date"
        className="w-auto shrink-0"
      />
      <div className="ml-auto flex items-center gap-2">
        <ProjectFeedViewSwitch view={view} setView={setView} />
        <ProjectFeedFilterMenu {...props} idPrefix="feed-desktop" />
      </div>
    </div>
  );
}
