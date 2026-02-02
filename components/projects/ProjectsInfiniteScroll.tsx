"use client";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useInView } from "react-intersection-observer";
import { ProjectViewToggle } from "./ProjectViewToggle";
import { useInfiniteQuery, type SupabaseQueryHandler } from "@/hooks/use-infinite-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Search,
  Filter,
  Loader2,
  Calendar,
  SlidersHorizontal,
  Users,
  X,
  LayoutGrid,
  List,
  Table2,
  CheckCircle2,
  ArrowUp,
  Plus,
  PackageX,
  Map,
} from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import { ProjectsMapView } from "./ProjectsMapView";
import type { Project } from "@/types";



type ProjectWithSignups = Project & {
  signups?: Array<{ status?: string }>;
  slots_filled?: number;
  registrations?: unknown[];
  [key: string]: unknown;
};

export const ProjectsInfiniteScroll: React.FC = () => {
  const limit = 20;
  const [searchTerm, setSearchTerm] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState<string | undefined>(undefined);
  const [dateFilter, setDateFilter] = useState<DateRange | undefined>(undefined);
  const [volunteersSort, setVolunteersSort] = useState<"asc" | "desc" | undefined>(undefined);
  const [dateSort, setDateSort] = useState<"asc" | "desc" | undefined>(undefined);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [isClientReady, setIsClientReady] = useState(false);
  const [view, setView] = useState<"card" | "list" | "table" | "map">("card");

  // Debug local storage issue with hydration
  useEffect(() => {
    setIsClientReady(true);
  }, []);

  // Debounce search term to reduce API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const projectsQueryHandler = useCallback<SupabaseQueryHandler<"projects">>(
    (query) => {
      // Basic filters: status=upcoming and visibility=public
      let q = query
        .eq("status", "upcoming")
        .eq("visibility", "public")
        .order("created_at", { ascending: false });

      // Search term filter if provided
      if (debouncedSearchTerm) {
        q = q.or(`title.ilike.%${debouncedSearchTerm}%,description.ilike.%${debouncedSearchTerm}%`);
      }

      // Event type filter if provided
      if (eventTypeFilter && eventTypeFilter !== "all") {
        q = q.eq("event_type", eventTypeFilter);
      }

      return q;
    },
    [debouncedSearchTerm, eventTypeFilter]
  );

  const {
    data: projectsData,
    isLoading,
    isFetching: isValidating,
    hasMore,
    fetchNextPage,
  } = useInfiniteQuery<ProjectWithSignups, "projects">({
    tableName: "projects",
    columns: "*, profiles!projects_creator_id_fkey1(id, avatar_url, full_name, username, created_at), organization:organizations(id, name, username, logo_url, verified, type), signups:project_signups(project_id, schedule_id, status)",
    pageSize: limit,
    trailingQuery: projectsQueryHandler,
  });

  const { ref, inView } = useInView({
    threshold: 0.1,
    rootMargin: '100px',
  });

  // Load more trigger
  useEffect(() => {
    if (inView && hasMore && !isValidating && !isLoading) {
      fetchNextPage();
    }
  }, [inView, hasMore, isValidating, isLoading, fetchNextPage]);

  // Helper function to check if a project is within the date range
  const isProjectInDateRange = (project: ProjectWithSignups, dateRange: DateRange | undefined) => {
    if (!dateRange?.from) return true;

    let projectDate: Date | null = null;

    try {
      if (project.event_type === "oneTime" && project.schedule?.oneTime?.date) {
        projectDate = parseISO(project.schedule.oneTime.date);
      } else if (project.event_type === "multiDay") {
        const multiDaySchedule = project.schedule?.multiDay;
        if (Array.isArray(multiDaySchedule) && multiDaySchedule.length > 0) {
          // For multi-day events, check if any day is within the range
          return multiDaySchedule.some((day) => {
            const dayDate = parseISO(day.date);
            return isWithinDateRange(dayDate, dateRange);
          });
        }
      } else if (project.event_type === "sameDayMultiArea" && project.schedule?.sameDayMultiArea?.date) {
        projectDate = parseISO(project.schedule.sameDayMultiArea.date);
      }

      if (projectDate) {
        return isWithinDateRange(projectDate, dateRange);
      }
    } catch (e) {
      console.error("Date parsing error:", e);
    }

    return true;
  };

  // Check if a date is within a date range
  const isWithinDateRange = (date: Date, dateRange: DateRange) => {
    if (!dateRange.from) return true;

    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const startDate = new Date(dateRange.from);
    startDate.setHours(0, 0, 0, 0);

    if (dateRange.to) {
      const endDate = new Date(dateRange.to);
      endDate.setHours(0, 0, 0, 0);

      return targetDate >= startDate && targetDate <= endDate;
    }

    return targetDate.getTime() === startDate.getTime();
  };

  // Get volunteer count from a project
  const getVolunteerCount = (project: ProjectWithSignups): number => {
    if (!project.event_type || !project.schedule) return 0;

    switch (project.event_type) {
      case "oneTime":
        return project.schedule.oneTime?.volunteers || 0;
      case "multiDay": {
        let total = 0;  // Initialize total here
        // Sum all volunteers across all days and slots
        if (project.schedule.multiDay) {
          project.schedule.multiDay.forEach((day) => {
            if (day.slots) {
              day.slots.forEach((slot) => {
                total += slot.volunteers || 0;
              });
            }
          });
        }
        return total;
      }
      case "sameDayMultiArea": {
        // Sum all volunteers across all roles
        let total = 0;
        if (project.schedule.sameDayMultiArea?.roles) {
          project.schedule.sameDayMultiArea.roles.forEach((role) => {
            total += role.volunteers || 0;
          });
        }
        return total;
      }
      default:
        return 0;
    }
  };

  // Sort projects by volunteer count
  const sortByVolunteers = useCallback((projects: ProjectWithSignups[], direction: "asc" | "desc" | undefined) => {
    if (!direction) return projects;

    return [...projects].sort((a, b) => {
      const countA = getVolunteerCount(a);
      const countB = getVolunteerCount(b);

      if (direction === "desc") {
        return countB - countA;
      } else {
        return countA - countB;
      }
    });
  }, []);

  // Sort projects by date
  const sortByDate = useCallback((projects: ProjectWithSignups[], direction: "asc" | "desc" | undefined) => {
    // Define getProjectDate within sortByDate to avoid dependency cycle
    const getProjectDateInternal = (project: ProjectWithSignups): Date | null => {
      try {
        if (project.event_type === "oneTime" && project.schedule?.oneTime?.date) {
          return parseISO(project.schedule.oneTime.date);
        } else if (project.event_type === "multiDay") {
          const multiDaySchedule = project.schedule?.multiDay;
          if (Array.isArray(multiDaySchedule) && multiDaySchedule.length > 0) {
            // Get the earliest date from multiDay events
            const dates = multiDaySchedule.map((day) => parseISO(day.date));
            return new Date(Math.min(...dates.map((d: Date) => d.getTime())));
          }
        } else if (project.event_type === "sameDayMultiArea" && project.schedule?.sameDayMultiArea?.date) {
          return parseISO(project.schedule.sameDayMultiArea.date);
        }
      } catch (e) {
        console.error("Date parsing error:", e);
      }
      return null;
    };

    if (!direction) return projects;

    return [...projects].sort((a, b) => {
      const dateA = getProjectDateInternal(a);
      const dateB = getProjectDateInternal(b);

      if (!dateA || !dateB) return 0;

      if (direction === "desc") {
        return dateA.getTime() - dateB.getTime(); // Recent first
      } else {
        return dateB.getTime() - dateA.getTime(); // Future first
      }
    });
  }, []);

  // New function to get remaining spots
  const getRemainingSpots = (project: ProjectWithSignups): number => {
    // Get total spots
    const totalSpots = getVolunteerCount(project);

    // Calculate filled spots based on project type
    let filledSpots = 0;

    if (project.signups && Array.isArray(project.signups)) {
      // Count confirmed and pending signups to avoid overestimating availability
      filledSpots = project.signups.filter((signup) =>
        signup.status === "approved" || signup.status === "pending"
      ).length;
    } else if (project.slots_filled) {
      // If project has a direct slots_filled count
      filledSpots = project.slots_filled;
    } else if (project.registrations && Array.isArray(project.registrations)) {
      // Alternative signup structure
      filledSpots = project.registrations.length;
    }

    return Math.max(0, totalSpots - filledSpots);
  };

  // Get all projects - useInfiniteQuery already provides the flattened data
  const allProjects = projectsData || [];

  const filteredProjects = allProjects.filter((project) => {
    // Search and Event Type filtering are now handled by the hook/server where possible,
    // but we can still apply client-side filters for things like date which are hard to query

    // Date filter
    const matchesDateRange = isProjectInDateRange(project, dateFilter);

    // Only filter for remaining spots - server is already filtering for status
    const hasRemainingSpots = getRemainingSpots(project) > 0;

    return matchesDateRange && hasRemainingSpots;
  });

  // Apply sorting if needed
  const sortedProjects = useMemo(() => {
    let sorted = [...filteredProjects];

    if (volunteersSort) {
      sorted = sortByVolunteers(sorted, volunteersSort);
    }

    if (dateSort) {
      sorted = sortByDate(sorted, dateSort);
    }

    return sorted;
  }, [filteredProjects, volunteersSort, dateSort, sortByVolunteers, sortByDate]);

  // Count active filters
  const activeFilterCount = useMemo(() => [
    debouncedSearchTerm ? 1 : 0,
    eventTypeFilter ? 1 : 0,
    dateFilter?.from ? 1 : 0,
    volunteersSort ? 1 : 0,
    dateSort ? 1 : 0,
  ].reduce((a, b) => a + b, 0), [debouncedSearchTerm, eventTypeFilter, dateFilter, volunteersSort, dateSort]);

  // Clear all filters function
  const clearAllFilters = () => {
    setSearchTerm("");
    setEventTypeFilter(undefined);
    setDateFilter(undefined);
    setVolunteersSort(undefined);
    setDateSort(undefined);
  };

  // Loading skeletons
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="w-full">
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="shrink-0">
            <Skeleton className="h-10 w-32" />
          </div>
        </div>

        <Skeleton className="h-10 w-48 mb-8" />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-4 border rounded-lg p-5 animate-pulse">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20 w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state (handled by hook)
  /* if (error) { ... } */

  // Empty state when no projects match filters
  if (sortedProjects.length === 0) {
    return (
      <>
        <div className="mb-8">
          {/* Search and filter controls */}
          <div className="w-full" data-tour-id="home-project-filters">
            {/* Mobile layout */}
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
                        <Label htmlFor="event-type-mobile">Event Type</Label>
                        <Select
                          value={eventTypeFilter ?? "all"}
                          onValueChange={(value) => setEventTypeFilter((value === "all" || !value) ? undefined : value)}
                        >
                          <SelectTrigger id="event-type-mobile" className="w-full">
                            <SelectValue placeholder="All Types">
                              {eventTypeFilter === "oneTime" ? "Single Event" :
                                eventTypeFilter === "multiDay" ? "Multi-day Event" :
                                  eventTypeFilter === "sameDayMultiArea" ? "Multi-role Event" :
                                    "All Types"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent alignItemWithTrigger={false}>
                            <SelectItem value="all">All Types</SelectItem>
                            <SelectItem value="oneTime">Single Event</SelectItem>
                            <SelectItem value="multiDay">Multi-day Event</SelectItem>
                            <SelectItem value="sameDayMultiArea">Multi-role Event</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="sort-date-mobile">Sort by Date</Label>
                        <Select
                          value={dateSort ?? "no-sort"}
                          onValueChange={(value) => {
                            setDateSort((value === "no-sort" || !value) ? undefined : value as "asc" | "desc");
                            if (value !== "no-sort") {
                              setVolunteersSort(undefined);
                            }
                          }}
                        >
                          <SelectTrigger id="sort-date-mobile" className="w-full">
                            <SelectValue placeholder="No sorting">
                              {dateSort === "desc" ? "Most recent first" :
                                dateSort === "asc" ? "Future dates first" :
                                  "No sorting"}
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
                        <Label htmlFor="sort-volunteers-mobile">Sort by Volunteers</Label>
                        <Select
                          value={volunteersSort ?? "no-sort"}
                          onValueChange={(value) => {
                            setVolunteersSort((value === "no-sort" || !value) ? undefined : value as "asc" | "desc");
                            if (value !== "no-sort") {
                              setDateSort(undefined);
                            }
                          }}
                        >
                          <SelectTrigger id="sort-volunteers-mobile" className="w-full">
                            <SelectValue placeholder="No sorting">
                              {volunteersSort === "desc" ? "Most needed first" :
                                volunteersSort === "asc" ? "Least needed first" :
                                  "No sorting"}
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

            {/* Desktop layout */}
            <div className="hidden md:flex md:flex-row justify-between items-start md:items-center gap-4 w-full">
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

              <div className="flex items-center gap-1 w-full md:w-auto justify-end">
                <div className="w-60">
                  <DateRangePicker
                    value={dateFilter}
                    onChange={setDateFilter}
                    align="end"
                    placeholder="Select date range"
                    className="w-full"
                  />
                </div>
                <div className="flex items-center gap-1 mr-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-8 w-8 sm:h-9 sm:w-9", view === "card" && "bg-muted")}
                    onClick={() => setView("card")}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-8 w-8 sm:h-9 sm:w-9", view === "list" && "bg-muted")}
                    onClick={() => setView("list")}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-8 w-8 sm:h-9 sm:w-9", view === "table" && "bg-muted")}
                    onClick={() => setView("table")}
                  >
                    <Table2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-8 w-8 sm:h-9 sm:w-9", view === "map" && "bg-muted")}
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
                        <Label htmlFor="event-type">Event Type</Label>
                        <Select
                          value={eventTypeFilter ?? "all"}
                          onValueChange={(value) => setEventTypeFilter((value === "all" || !value) ? undefined : value)}
                        >
                          <SelectTrigger id="event-type" className="w-full">
                            <SelectValue placeholder="All Types">
                              {eventTypeFilter === "oneTime" ? "Single Event" :
                                eventTypeFilter === "multiDay" ? "Multi-day Event" :
                                  eventTypeFilter === "sameDayMultiArea" ? "Multi-role Event" :
                                    "All Types"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent alignItemWithTrigger={false}>
                            <SelectItem value="all">All Types</SelectItem>
                            <SelectItem value="oneTime">Single Event</SelectItem>
                            <SelectItem value="multiDay">Multi-day Event</SelectItem>
                            <SelectItem value="sameDayMultiArea">Multi-role Event</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="sort-date">Sort by Date</Label>
                        <Select
                          value={dateSort ?? "no-sort"}
                          onValueChange={(value) => {
                            setDateSort((value === "no-sort" || !value) ? undefined : value as "asc" | "desc");
                            if (value !== "no-sort") {
                              setVolunteersSort(undefined);
                            }
                          }}
                        >
                          <SelectTrigger id="sort-date" className="w-full">
                            <SelectValue placeholder="No sorting">
                              {dateSort === "desc" ? "Most recent first" :
                                dateSort === "asc" ? "Future dates first" :
                                  "No sorting"}
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
                        <Label htmlFor="sort-volunteers">Sort by Volunteers</Label>
                        <Select
                          value={volunteersSort ?? "no-sort"}
                          onValueChange={(value) => {
                            setVolunteersSort((value === "no-sort" || !value) ? undefined : value as "asc" | "desc");
                            if (value !== "no-sort") {
                              setDateSort(undefined);
                            }
                          }}
                        >
                          <SelectTrigger id="sort-volunteers" className="w-full">
                            <SelectValue placeholder="No sorting">
                              {volunteersSort === "desc" ? "Most needed first" :
                                volunteersSort === "asc" ? "Least needed first" :
                                  "No sorting"}
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
          </div>

          {/* Active filters display */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <Filter className="h-3 w-3" />
                  {activeFilterCount} {activeFilterCount === 1 ? 'filter' : 'filters'} applied
                </Badge>
              )}

              {debouncedSearchTerm && (
                <Badge variant="outline" className="gap-1">
                  <Search className="h-3 w-3" />
                  &quot;{debouncedSearchTerm}&quot;
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-3 w-3 ml-1 p-0"
                    onClick={() => setSearchTerm("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              )}

              {eventTypeFilter && (
                <Badge variant="outline" className="gap-1">
                  <Calendar className="h-3 w-3" />
                  {eventTypeFilter === "oneTime" && "Single Event"}
                  {eventTypeFilter === "multiDay" && "Multi-day Event"}
                  {eventTypeFilter === "sameDayMultiArea" && "Multi-role Event"}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-3 w-3 ml-1 p-0"
                    onClick={() => setEventTypeFilter(undefined)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              )}

              {dateFilter?.from && (
                <Badge variant="outline" className="gap-1">
                  <Calendar className="h-3 w-3" />
                  {dateFilter.to
                    ? `${format(dateFilter.from, "MMM d")} - ${format(dateFilter.to, "MMM d")}`
                    : `From ${format(dateFilter.from, "MMM d")}`
                  }
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-3 w-3 ml-1 p-0"
                    onClick={() => setDateFilter(undefined)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              )}

              {dateSort && (
                <Badge variant="outline" className="gap-1">
                  <Calendar className="h-3 w-3" />
                  {dateSort === "desc" ? "Most recent first" : "Future dates first"}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-3 w-3 ml-1 p-0"
                    onClick={() => setDateSort(undefined)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              )}

              {volunteersSort && (
                <Badge variant="outline" className="gap-1">
                  <Users className="h-3 w-3" />
                  {volunteersSort === "desc" ? "Most volunteers needed" : "Least volunteers needed"}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-3 w-3 ml-1 p-0"
                    onClick={() => setVolunteersSort(undefined)}
                  >
                    <X className="h-3 w-3" />
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
        </div>

        <Card className="bg-muted/40 border-dashed" data-tour-id="home-project-list">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
              {activeFilterCount > 0 ? (
                <Search className="h-10 w-10 text-muted-foreground opacity-80" />
              ) : (
                <PackageX className="h-10 w-10 text-muted-foreground opacity-80" />
              )}
            </div>
            <h3 className="text-xl font-medium mb-2">No projects found</h3>
            <p className="text-muted-foreground text-center max-w-md mb-8">
              {activeFilterCount > 0
                ? "We couldn't find any projects matching your current filters. Try adjusting your search criteria or browse all projects."
                : "There are currently no volunteer projects available in our database. Be the first to create a project and start making a difference!"}
            </p>

            <div className="flex gap-4 flex-wrap justify-center">
              {activeFilterCount > 0 && (
                <Button variant="default" onClick={clearAllFilters} className="gap-2">
                  <X className="h-4 w-4" />
                  Clear all filters
                </Button>
              )}

              <Link href="/projects/create" className={cn(buttonVariants({ variant: activeFilterCount > 0 ? "outline" : "default" }), "gap-2")}>
                <Plus className="h-4 w-4" />
                Create a project
              </Link>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  // Normal view with projects
  return (
    <div>
      <div className="mb-8">
        {/* Search and filter controls */}
        <div className="w-full" data-tour-id="home-project-filters">
          {/* Mobile layout */}
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
                        onValueChange={(value) => setEventTypeFilter((value === "all" || !value) ? undefined : value)}
                      >
                        <SelectTrigger id="event-type-mobile-2" className="w-full">
                          <SelectValue placeholder="All Types">
                            {eventTypeFilter === "oneTime" ? "Single Event" :
                              eventTypeFilter === "multiDay" ? "Multi-day Event" :
                                eventTypeFilter === "sameDayMultiArea" ? "Multi-role Event" :
                                  "All Types"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectItem value="all">All Types</SelectItem>
                          <SelectItem value="oneTime">Single Event</SelectItem>
                          <SelectItem value="multiDay">Multi-day Event</SelectItem>
                          <SelectItem value="sameDayMultiArea">Multi-role Event</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="sort-date-mobile-2">Sort by Date</Label>
                      <Select
                        value={dateSort ?? "no-sort"}
                        onValueChange={(value) => {
                          setDateSort((value === "no-sort" || !value) ? undefined : value as "asc" | "desc");
                          if (value !== "no-sort") {
                            setVolunteersSort(undefined);
                          }
                        }}
                      >
                        <SelectTrigger id="sort-date-mobile-2" className="w-full">
                          <SelectValue placeholder="No sorting">
                            {dateSort === "desc" ? "Most recent first" :
                              dateSort === "asc" ? "Future dates first" :
                                "No sorting"}
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
                      <Label htmlFor="sort-volunteers-mobile-2">Sort by Volunteers</Label>
                      <Select
                        value={volunteersSort ?? "no-sort"}
                        onValueChange={(value) => {
                          setVolunteersSort((value === "no-sort" || !value) ? undefined : value as "asc" | "desc");
                          if (value !== "no-sort") {
                            setDateSort(undefined);
                          }
                        }}
                      >
                        <SelectTrigger id="sort-volunteers-mobile-2" className="w-full">
                          <SelectValue placeholder="No sorting">
                            {volunteersSort === "desc" ? "Most needed first" :
                              volunteersSort === "asc" ? "Least needed first" :
                                "No sorting"}
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

          {/* Desktop layout */}
          <div className="hidden md:flex md:flex-row justify-between items-start md:items-center gap-4 w-full">
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

            <div className="flex items-center gap-1 w-full md:w-auto justify-end">
              <div className="flex items-center gap-1 mr-2">
                <DateRangePicker
                  value={dateFilter}
                  onChange={setDateFilter}
                  align="end"
                  placeholder="Select date range"
                  className="w-full mr-2"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8 sm:h-9 sm:w-9", view === "card" && "bg-muted")}
                  onClick={() => setView("card")}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8 sm:h-9 sm:w-9", view === "list" && "bg-muted")}
                  onClick={() => setView("list")}
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8 sm:h-9 sm:w-9", view === "table" && "bg-muted")}
                  onClick={() => setView("table")}
                >
                  <Table2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8 sm:h-9 sm:w-9", view === "map" && "bg-muted")}
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
                        onValueChange={(value) => setEventTypeFilter((value === "all" || !value) ? undefined : value)}
                      >
                        <SelectTrigger id="event-type-2" className="w-full">
                          <SelectValue placeholder="All Types">
                            {eventTypeFilter === "oneTime" ? "Single Event" :
                              eventTypeFilter === "multiDay" ? "Multi-day Event" :
                                eventTypeFilter === "sameDayMultiArea" ? "Multi-role Event" :
                                  "All Types"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectItem value="all">All Types</SelectItem>
                          <SelectItem value="oneTime">Single Event</SelectItem>
                          <SelectItem value="multiDay">Multi-day Event</SelectItem>
                          <SelectItem value="sameDayMultiArea">Multi-role Event</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="sort-date-2">Sort by Date</Label>
                      <Select
                        value={dateSort ?? "no-sort"}
                        onValueChange={(value) => {
                          setDateSort((value === "no-sort" || !value) ? undefined : value as "asc" | "desc");
                          if (value !== "no-sort") {
                            setVolunteersSort(undefined);
                          }
                        }}
                      >
                        <SelectTrigger id="sort-date-2" className="w-full">
                          <SelectValue placeholder="No sorting">
                            {dateSort === "desc" ? "Most recent first" :
                              dateSort === "asc" ? "Future dates first" :
                                "No sorting"}
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
                          setVolunteersSort((value === "no-sort" || !value) ? undefined : value as "asc" | "desc");
                          if (value !== "no-sort") {
                            setDateSort(undefined);
                          }
                        }}
                      >
                        <SelectTrigger id="sort-volunteers-2" className="w-full">
                          <SelectValue placeholder="No sorting">
                            {volunteersSort === "desc" ? "Most needed first" :
                              volunteersSort === "asc" ? "Least needed first" :
                                "No sorting"}
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
        </div>

        {/* Active filters display */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="gap-1">
                <Filter className="h-3 w-3" />
                {activeFilterCount} {activeFilterCount === 1 ? 'filter' : 'filters'} applied
              </Badge>
            )}

            {debouncedSearchTerm && (
              <Badge variant="outline" className="gap-1">
                <Search className="h-3 w-3" />
                &quot;{debouncedSearchTerm}&quot;
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-3 w-3 ml-1 p-0"
                  onClick={() => setSearchTerm("")}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            )}

            {eventTypeFilter && (
              <Badge variant="outline" className="gap-1">
                <Calendar className="h-3 w-3" />
                {eventTypeFilter === "oneTime" && "Single Event"}
                {eventTypeFilter === "multiDay" && "Multi-day Event"}
                {eventTypeFilter === "sameDayMultiArea" && "Multi-role Event"}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-3 w-3 ml-1 p-0"
                  onClick={() => setEventTypeFilter(undefined)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            )}

            {dateFilter?.from && (
              <Badge variant="outline" className="gap-1">
                <Calendar className="h-3 w-3" />
                {dateFilter.to
                  ? `${format(dateFilter.from, "MMM d")} - ${format(new Date(dateFilter.to.getTime() - 24 * 60 * 60 * 1000), "MMM d")}`
                  : `From ${format(dateFilter.from, "MMM d")}`
                }
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-3 w-3 ml-1 p-0"
                  onClick={() => setDateFilter(undefined)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            )}

            {dateSort && (
              <Badge variant="outline" className="gap-1">
                <Calendar className="h-3 w-3" />
                {dateSort === "desc" ? "Most recent first" : "Future dates first"}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-3 w-3 ml-1 p-0"
                  onClick={() => setDateSort(undefined)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            )}

            {volunteersSort && (
              <Badge variant="outline" className="gap-1">
                <Users className="h-3 w-3" />
                {volunteersSort === "desc" ? "Most volunteers needed" : "Least volunteers needed"}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-3 w-3 ml-1 p-0"
                  onClick={() => setVolunteersSort(undefined)}
                >
                  <X className="h-3 w-3" />
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
      </div>

      {/* Only render when client is ready to avoid hydration mismatch */}
      {isClientReady && view !== "map" && (
        <div data-tour-id="home-project-list">
          <ProjectViewToggle
            projects={sortedProjects}
            onVolunteerSortChange={setVolunteersSort}
            volunteerSort={volunteersSort}
            view={view}
            onViewChangeAction={(newView) => setView(newView as "card" | "list" | "table")}
          />
        </div>
      )}

      {/* Map View */}
      {isClientReady && view === "map" && (
        <ProjectsMapView projects={sortedProjects} />
      )}

      {/* Loading indicator at the bottom */}
      {hasMore && view !== "map" && (
        <div className="py-6 flex justify-center" ref={ref}>
          {isValidating ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Loading more projects...</span>
            </div>
          ) : (
            <div className="h-16" />
          )}
        </div>
      )}

      {/* Show end of results message when we've reached the end */}
      {!hasMore && sortedProjects.length > 0 && view !== "map" && (
        <div className="py-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-muted/40">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <span className="font-medium">You&apos;ve seen all available projects</span>
          </div>

          <div className="mt-6">
            <Button
              variant="outline"
              className="gap-2"
              onClick={(e) => {
                e.preventDefault();
                window.scrollTo({
                  top: 0,
                  behavior: 'smooth'
                });
              }}
            >
              <ArrowUp className="h-4 w-4" />
              Back to top
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
