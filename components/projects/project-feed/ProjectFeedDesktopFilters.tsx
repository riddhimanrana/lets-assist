"use client";

import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
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
import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  List,
  Map,
  Search,
  SlidersHorizontal,
  Table2,
} from "lucide-react";
import type { ProjectFeedFilterProps } from "./types";

export function ProjectFeedDesktopFilters(props: ProjectFeedFilterProps) {
  const {
    searchTerm,
    setSearchTerm,
    eventTypeFilter,
    setEventTypeFilter,
    dateFilter,
    setDateFilter,
    volunteersSort,
    setVolunteersSort,
    dateSort,
    setDateSort,
    view,
    setView,
    activeFilterCount,
    clearAllFilters,
  } = props;
  return (
    <div className="hidden md:flex md:items-center gap-4 w-full">
      <div className="flex items-center gap-3 w-full md:w-auto">
        <div className="relative w-full md:w-70">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <DateRangePicker
          value={dateFilter}
          onChange={setDateFilter}
          align="end"
          placeholder="Select date range"
          className="w-auto shrink-0"
        />
        <div className="flex items-center gap-1 pr-1">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 sm:h-9 sm:w-9",
              view === "card" && "bg-muted",
            )}
            onClick={() => setView("card")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 sm:h-9 sm:w-9",
              view === "list" && "bg-muted",
            )}
            onClick={() => setView("list")}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 sm:h-9 sm:w-9",
              view === "table" && "bg-muted",
            )}
            onClick={() => setView("table")}
          >
            <Table2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 sm:h-9 sm:w-9",
              view === "map" && "bg-muted",
            )}
            onClick={() => setView("map")}
          >
            <Map className="h-4 w-4" />
          </Button>
        </div>

        <Popover>
          <PopoverTrigger
            nativeButton={true}
            render={
              <Button
                variant="outline"
                size="icon"
                className="relative h-8 w-8 sm:h-9 sm:w-9"
              >
                <SlidersHorizontal className="h-4 w-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            }
          />
          <PopoverContent className="w-80">
            <div className="grid gap-4">
              <PopoverHeader className="flex flex-row items-center justify-between pb-2">
                <div className="space-y-1">
                  <PopoverTitle>Filters</PopoverTitle>
                  <PopoverDescription>
                    Refine project results
                  </PopoverDescription>
                </div>
                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFilters}
                    className="h-auto px-2 py-0 text-xs font-normal"
                  >
                    Clear all
                  </Button>
                )}
              </PopoverHeader>

              <div className="grid gap-2">
                <Label htmlFor="event-type-2">Event Type</Label>
                <Select
                  value={eventTypeFilter ?? "all"}
                  onValueChange={(value) =>
                    setEventTypeFilter(
                      value === "all" || !value ? undefined : value,
                    )
                  }
                >
                  <SelectTrigger id="event-type-2" className="w-full">
                    <SelectValue placeholder="All Types">
                      {eventTypeFilter === "oneTime"
                        ? "Single Event"
                        : eventTypeFilter === "multiDay"
                          ? "Multi-day Event"
                          : eventTypeFilter === "sameDayMultiArea"
                            ? "Multi-role Event"
                            : "All Types"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="oneTime">Single Event</SelectItem>
                    <SelectItem value="multiDay">Multi-day Event</SelectItem>
                    <SelectItem value="sameDayMultiArea">
                      Multi-role Event
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="sort-date-2">Sort by Date</Label>
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
                  <SelectTrigger id="sort-date-2" className="w-full">
                    <SelectValue placeholder="No sorting">
                      {dateSort === "desc"
                        ? "Most recent first"
                        : dateSort === "asc"
                          ? "Future dates first"
                          : "No sorting"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectItem value="no-sort">No sorting</SelectItem>
                    <SelectItem value="desc">Most recent first</SelectItem>
                    <SelectItem value="asc">Future dates first</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="sort-volunteers-2">Sort by Volunteers</Label>
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
                  <SelectTrigger id="sort-volunteers-2" className="w-full">
                    <SelectValue placeholder="No sorting">
                      {volunteersSort === "desc"
                        ? "Most needed first"
                        : volunteersSort === "asc"
                          ? "Least needed first"
                          : "No sorting"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectItem value="no-sort">No sorting</SelectItem>
                    <SelectItem value="desc">Most needed first</SelectItem>
                    <SelectItem value="asc">Least needed first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
