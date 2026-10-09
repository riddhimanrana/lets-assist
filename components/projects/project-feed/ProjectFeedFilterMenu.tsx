"use client";

import { SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { ProjectFeedFilterProps } from "./types";

export const EVENT_TYPE_LABELS: Record<string, string> = {
  oneTime: "Single event",
  multiDay: "Multi-day event",
  sameDayMultiArea: "Multi-role event",
};

export const DATE_SORT_LABELS = {
  desc: "Most recent first",
  asc: "Future dates first",
} as const;

export const VOLUNTEER_SORT_LABELS = {
  desc: "Most needed first",
  asc: "Least needed first",
} as const;

/**
 * Event type and the two sort orders, behind one Filters button. `idPrefix`
 * keeps the field ids unique because the phone and desktop toolbars both mount.
 */
export function ProjectFeedFilterMenu({
  idPrefix,
  iconOnly = false,
  eventTypeFilter,
  setEventTypeFilter,
  volunteersSort,
  setVolunteersSort,
  dateSort,
  setDateSort,
  activeFilterCount,
  clearAllFilters,
}: ProjectFeedFilterProps & { idPrefix: string; iconOnly?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger
        nativeButton={true}
        render={
          <Button
            variant="outline"
            size={iconOnly ? "icon" : "default"}
            className="shrink-0"
            aria-label={
              activeFilterCount > 0
                ? `Filters, ${activeFilterCount} applied`
                : "Filters"
            }
          >
            <SlidersHorizontal data-icon="inline-start" aria-hidden="true" />
            {iconOnly ? null : "Filters"}
            {activeFilterCount > 0 && !iconOnly ? (
              <Badge variant="secondary" className="tabular-nums">
                {activeFilterCount}
              </Badge>
            ) : null}
          </Button>
        }
      />
      <PopoverContent className="w-80" align="end">
        <PopoverHeader className="flex flex-row items-center justify-between">
          <PopoverTitle>Filters</PopoverTitle>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters}>
              Clear all
            </Button>
          )}
        </PopoverHeader>

        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-event-type`}>
              Event type
            </FieldLabel>
            <Select
              value={eventTypeFilter ?? "all"}
              onValueChange={(value) =>
                setEventTypeFilter(
                  value === "all" || !value ? undefined : value,
                )
              }
            >
              <SelectTrigger id={`${idPrefix}-event-type`} className="w-full">
                <SelectValue placeholder="All types">
                  {(eventTypeFilter && EVENT_TYPE_LABELS[eventTypeFilter]) ||
                    "All types"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="oneTime">Single event</SelectItem>
                <SelectItem value="multiDay">Multi-day event</SelectItem>
                <SelectItem value="sameDayMultiArea">
                  Multi-role event
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor={`${idPrefix}-sort-date`}>
              Sort by date
            </FieldLabel>
            <Select
              value={dateSort ?? "no-sort"}
              onValueChange={(value) => {
                setDateSort(
                  value === "no-sort" || !value
                    ? undefined
                    : (value as "asc" | "desc"),
                );
                if (value !== "no-sort") {
                  setVolunteersSort(undefined);
                }
              }}
            >
              <SelectTrigger id={`${idPrefix}-sort-date`} className="w-full">
                <SelectValue placeholder="No sorting">
                  {dateSort ? DATE_SORT_LABELS[dateSort] : "No sorting"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="no-sort">No sorting</SelectItem>
                <SelectItem value="desc">Most recent first</SelectItem>
                <SelectItem value="asc">Future dates first</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor={`${idPrefix}-sort-volunteers`}>
              Sort by volunteers
            </FieldLabel>
            <Select
              value={volunteersSort ?? "no-sort"}
              onValueChange={(value) => {
                setVolunteersSort(
                  value === "no-sort" || !value
                    ? undefined
                    : (value as "asc" | "desc"),
                );
                if (value !== "no-sort") {
                  setDateSort(undefined);
                }
              }}
            >
              <SelectTrigger
                id={`${idPrefix}-sort-volunteers`}
                className="w-full"
              >
                <SelectValue placeholder="No sorting">
                  {volunteersSort
                    ? VOLUNTEER_SORT_LABELS[volunteersSort]
                    : "No sorting"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="no-sort">No sorting</SelectItem>
                <SelectItem value="desc">Most needed first</SelectItem>
                <SelectItem value="asc">Least needed first</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
}
