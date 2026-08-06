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

export function ProjectFeedMobileFilters(props: ProjectFeedFilterProps) {
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
    <div className="flex flex-col gap-3 md:hidden">
      <div className="relative w-full">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search projects..."
          className="pl-8"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-2 w-full flex-nowrap">
        <div className="flex-1 min-w-0">
          <DateRangePicker
            value={dateFilter}
            onChange={setDateFilter}
            align="start"
            placeholder="Pick dates"
            className="w-full"
            buttonClassName="h-10"
          />
        </div>

        {!dateFilter?.from && (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8", view === "card" && "bg-muted")}
              onClick={() => setView("card")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8", view === "list" && "bg-muted")}
              onClick={() => setView("list")}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8", view === "table" && "bg-muted")}
              onClick={() => setView("table")}
            >
              <Table2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8", view === "map" && "bg-muted")}
              onClick={() => setView("map")}
            >
              <Map className="h-4 w-4" />
            </Button>
          </div>
        )}

        <Popover>
          <PopoverTrigger
            nativeButton={true}
            render={
              <Button
                variant="outline"
                size="icon"
                className="relative h-8 w-8 shrink-0"
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
                <Label htmlFor="event-type-mobile-2">Event Type</Label>
                <Select
                  value={eventTypeFilter ?? "all"}
                  onValueChange={(value) =>
                    setEventTypeFilter(
                      value === "all" || !value ? undefined : value,
                    )
                  }
                >
                  <SelectTrigger id="event-type-mobile-2" className="w-full">
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
                <Label htmlFor="sort-date-mobile-2">Sort by Date</Label>
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
                  <SelectTrigger id="sort-date-mobile-2" className="w-full">
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
                <Label htmlFor="sort-volunteers-mobile-2">
                  Sort by Volunteers
                </Label>
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
                    id="sort-volunteers-mobile-2"
                    className="w-full"
                  >
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
