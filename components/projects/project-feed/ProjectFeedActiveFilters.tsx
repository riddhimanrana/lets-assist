"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

import {
  DATE_SORT_LABELS,
  EVENT_TYPE_LABELS,
  VOLUNTEER_SORT_LABELS,
} from "./ProjectFeedFilterMenu";
import type { ProjectFeedFilterProps } from "./types";

/** A removable chip: the whole chip is the 36px press target. */
function FilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9 max-w-full sm:h-8"
      aria-label={`Remove filter: ${label}`}
      onClick={onRemove}
    >
      <span className="truncate">{label}</span>
      <X data-icon="inline-end" aria-hidden="true" />
    </Button>
  );
}

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

  if (activeFilterCount === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {debouncedSearchTerm && (
        <FilterChip
          label={`“${debouncedSearchTerm}”`}
          onRemove={() => setSearchTerm("")}
        />
      )}

      {eventTypeFilter && (
        <FilterChip
          label={EVENT_TYPE_LABELS[eventTypeFilter] ?? eventTypeFilter}
          onRemove={() => setEventTypeFilter(undefined)}
        />
      )}

      {dateFilter?.from && (
        <FilterChip
          label={dateFilterLabel ?? "Date range"}
          onRemove={() => setDateFilter(undefined)}
        />
      )}

      {dateSort && (
        <FilterChip
          label={DATE_SORT_LABELS[dateSort]}
          onRemove={() => setDateSort(undefined)}
        />
      )}

      {volunteersSort && (
        <FilterChip
          label={VOLUNTEER_SORT_LABELS[volunteersSort]}
          onRemove={() => setVolunteersSort(undefined)}
        />
      )}

      {activeFilterCount > 1 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 sm:h-8"
          onClick={clearAllFilters}
        >
          Clear all
        </Button>
      )}
    </div>
  );
}
