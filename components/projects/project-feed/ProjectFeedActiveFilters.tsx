"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Filter, Search, Users, X } from "lucide-react";
import type { ProjectFeedFilterProps } from "./types";

export function ProjectFeedActiveFilters(props: ProjectFeedFilterProps) {
  const {
    debouncedSearchTerm,
    setSearchTerm,
    eventTypeFilter,
    setEventTypeFilter,
    dateFilter,
    setDateFilter,
    volunteersSort,
    setVolunteersSort,
    dateSort,
    setDateSort,
    activeFilterCount,
    dateFilterLabel,
    clearAllFilters,
  } = props;
  return (
    <>
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="gap-1">
              <Filter className="size-3" />
              {activeFilterCount}{" "}
              {activeFilterCount === 1 ? "filter" : "filters"} applied
            </Badge>
          )}

          {debouncedSearchTerm && (
            <Badge variant="outline" className="gap-1">
              <Search className="size-3" />
              &quot;{debouncedSearchTerm}&quot;
              <Button
                variant="ghost"
                size="icon"
                className="size-3 ml-1 p-0"
                onClick={() => setSearchTerm("")}
              >
                <X className="size-3" />
              </Button>
            </Badge>
          )}

          {eventTypeFilter && (
            <Badge variant="outline" className="gap-1">
              <Calendar className="size-3" />
              {eventTypeFilter === "oneTime" && "Single Event"}
              {eventTypeFilter === "multiDay" && "Multi-day Event"}
              {eventTypeFilter === "sameDayMultiArea" && "Multi-role Event"}
              <Button
                variant="ghost"
                size="icon"
                className="size-3 ml-1 p-0"
                onClick={() => setEventTypeFilter(undefined)}
              >
                <X className="size-3" />
              </Button>
            </Badge>
          )}

          {dateFilter?.from && (
            <Badge variant="outline" className="gap-1">
              <Calendar className="size-3" />
              {dateFilterLabel}
              <Button
                variant="ghost"
                size="icon"
                className="size-3 ml-1 p-0"
                onClick={() => setDateFilter(undefined)}
              >
                <X className="size-3" />
              </Button>
            </Badge>
          )}

          {dateSort && (
            <Badge variant="outline" className="gap-1">
              <Calendar className="size-3" />
              {dateSort === "desc" ? "Most recent first" : "Future dates first"}
              <Button
                variant="ghost"
                size="icon"
                className="size-3 ml-1 p-0"
                onClick={() => setDateSort(undefined)}
              >
                <X className="size-3" />
              </Button>
            </Badge>
          )}

          {volunteersSort && (
            <Badge variant="outline" className="gap-1">
              <Users className="size-3" />
              {volunteersSort === "desc"
                ? "Most volunteers needed"
                : "Least volunteers needed"}
              <Button
                variant="ghost"
                size="icon"
                className="size-3 ml-1 p-0"
                onClick={() => setVolunteersSort(undefined)}
              >
                <X className="size-3" />
              </Button>
            </Badge>
          )}

          {activeFilterCount > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-sm"
              onClick={clearAllFilters}
            >
              Clear all
            </Button>
          )}
        </div>
      )}
    </>
  );
}
