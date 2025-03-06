"use client";
import React, { useState, useEffect } from "react";
import axios from "axios";
import useSWRInfinite from "swr/infinite";
import { useInView } from "react-intersection-observer";
import { ProjectViewToggle } from "./ProjectViewToggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Filter,
  AlertCircle,
  Loader2,
  Calendar,
  SlidersHorizontal,
  MapPin,
  Users,
  X,
  LayoutGrid,
  List,
  Table2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { cn } from "@/lib/utils";
import { format, isAfter, isBefore, isWithinInterval, parseISO } from "date-fns";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const fetcher = (url: string) => axios.get(url).then((res) => res.data);

export const ProjectsInfiniteScroll: React.FC = () => {
  const limit = 20;
  const [searchTerm, setSearchTerm] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState<string | undefined>(undefined);
  const [dateFilter, setDateFilter] = useState<DateRange | undefined>(undefined);
  const [volunteersSort, setVolunteersSort] = useState<"asc" | "desc" | undefined>(undefined);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [isClientReady, setIsClientReady] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [view, setView] = useState<"card" | "list" | "table">("card");
  
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

  const { data, error, size, setSize, isLoading } = useSWRInfinite(
    (index) => `/api/projects?limit=${limit}&offset=${index * limit}`,
    fetcher
  );

  const { ref, inView } = useInView();

  // Load more when scrolling to the bottom
  useEffect(() => {
    if (inView && data && data[data.length - 1]?.length === limit) {
      setSize(size + 1);
    }
  }, [inView, data, setSize, size, limit]);

  // Helper function to check if a project is within the date range
  const isProjectInDateRange = (project: any, dateRange: DateRange | undefined) => {
    if (!dateRange?.from) return true;
    
    let projectDate: Date | null = null;
    
    try {
      if (project.event_type === "oneTime" && project.schedule?.oneTime?.date) {
        projectDate = parseISO(project.schedule.oneTime.date);
      } else if (project.event_type === "multiDay" && project.schedule?.multiDay?.length > 0) {
        // For multi-day events, check if any day is within the range
        return project.schedule.multiDay.some((day: any) => {
          const dayDate = parseISO(day.date);
          return isWithinDateRange(dayDate, dateRange);
        });
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
    if (dateRange.to) {
      const endDate = new Date(dateRange.to);
      endDate.setHours(23, 59, 59, 999); // Set to end of day
      return isWithinInterval(date, { start: dateRange.from, end: endDate });
    }
    return date.getTime() === dateRange.from.getTime();
  };

  // Sort projects by volunteer count
  const sortByVolunteers = (projects: any[], direction: "asc" | "desc" | undefined) => {
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
  };

  // Get volunteer count from a project
  const getVolunteerCount = (project: any): number => {
    if (!project.event_type || !project.schedule) return 0;

    switch (project.event_type) {
      case "oneTime":
        return project.schedule.oneTime?.volunteers || 0;
      case "multiDay": {
        // Sum all volunteers across all days and slots
        let total = 0;
        if (project.schedule.multiDay) {
          project.schedule.multiDay.forEach((day: any) => {
            if (day.slots) {
              day.slots.forEach((slot: any) => {
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
          project.schedule.sameDayMultiArea.roles.forEach((role: any) => {
            total += role.volunteers || 0;
          });
        }
        return total;
      }
      default:
        return 0;
    }
  };

  // Get all projects and apply client-side filtering
  const allProjects = data ? ([] as any[]).concat(...data) : [];
  
  const filteredProjects = allProjects.filter((project) => {
    // Search term filter
    const matchesSearch = debouncedSearchTerm 
      ? project.title?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) || 
        project.description?.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
      : true;
      
    // Event type filter
    // Change this to properly handle the "all" value vs undefined
    const matchesEventType = eventTypeFilter 
      ? eventTypeFilter === "all"
        ? true
        : project.event_type === eventTypeFilter 
      : true;
    
    // Date filter
    const matchesDateRange = isProjectInDateRange(project, dateFilter);
      
    return matchesSearch && matchesEventType && matchesDateRange;
  });
  
  // Apply sorting if needed
  const sortedProjects = sortByVolunteers(filteredProjects, volunteersSort);

  // Count active filters
  const activeFilterCount = [
    debouncedSearchTerm ? 1 : 0,
    eventTypeFilter ? 1 : 0,
    dateFilter?.from ? 1 : 0,
    volunteersSort ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  // Clear all filters function
  const clearAllFilters = () => {
    setSearchTerm("");
    setEventTypeFilter(undefined);
    setDateFilter(undefined);
    setVolunteersSort(undefined);
  };

  // Loading skeletons
  if ((!data && !error) || isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="w-full">
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="flex-shrink-0">
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
        
        <Skeleton className="h-10 w-48 mb-8" />
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-4">
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

  // Error state
  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Error Loading Projects
          </CardTitle>
          <CardDescription>
            There was an error loading the projects. Please try again later.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button 
            onClick={() => window.location.reload()}
            variant="outline"
          >
            Retry
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // Empty state when no projects match filters
  if (sortedProjects.length === 0) {
    return (
      <>
        <div className="mb-8">
          {/* Search and filter controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-auto sm:flex-1 max-w-md">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search projects..."
                className="pl-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2 order-last sm:order-none">
              <DateRangePicker
                value={dateFilter}
                onChange={setDateFilter}
                align="end"
                className="w-[180px]"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-9 w-9", view === "card" && "bg-muted")}
                onClick={() => setView("card")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-9 w-9", view === "list" && "bg-muted")}
                onClick={() => setView("list")}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-9 w-9", view === "table" && "bg-muted")}
                onClick={() => setView("table")}
              >
                <Table2 className="h-4 w-4" />
              </Button>
            </div>

            <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
              <PopoverTrigger asChild>
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="relative h-9 w-9"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  {activeFilterCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Filters</h4>
                    {activeFilterCount > 0 && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={clearAllFilters}
                      >
                        Clear all
                      </Button>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Event Type</label>
                    <Select 
                      value={eventTypeFilter ?? "all"} 
                      onValueChange={(value) => setEventTypeFilter(value === "all" ? undefined : value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All Types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="oneTime">Single Event</SelectItem>
                        <SelectItem value="multiDay">Multi-day Event</SelectItem>
                        <SelectItem value="sameDayMultiArea">Multi-role Event</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Date Range</label>
                    <DateRangePicker
                      value={dateFilter}
                      onChange={setDateFilter}
                      placeholder="Select date range"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Sort by Volunteers</label>
                    <Select 
                      value={volunteersSort ?? "no-sort"} 
                      onValueChange={(value) => setVolunteersSort(value === "no-sort" ? undefined : value as "asc" | "desc")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="No sorting" />
                      </SelectTrigger>
                      <SelectContent>
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
                  "{debouncedSearchTerm}"
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

        <Card className="bg-muted/40">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="rounded-full bg-muted p-3 mb-4">
              <Search className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">No projects found</h3>
            <p className="text-muted-foreground text-center max-w-sm mb-6">
              {activeFilterCount > 0
                ? "Try adjusting your filters to find what you're looking for."
                : "There are currently no volunteer projects available. Check back later or create your own!"}
            </p>
            {activeFilterCount > 0 && (
              <Button variant="outline" onClick={clearAllFilters}>
                Clear all filters
              </Button>
            )}
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
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-auto sm:flex-1 max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <DateRangePicker
              value={dateFilter}
              onChange={setDateFilter}
              align="end"
              className="w-[180px]"
            />
          </div>
          
          {/* View Toggle */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-9 w-9", view === "card" && "bg-muted")}
              onClick={() => setView("card")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-9 w-9", view === "list" && "bg-muted")}
              onClick={() => setView("list")}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-9 w-9", view === "table" && "bg-muted")}
              onClick={() => setView("table")}
            >
              <Table2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Filters */}
          <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                size="icon" 
                className="relative h-9 w-9"
              >
                <SlidersHorizontal className="h-4 w-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Filters</h4>
                  {activeFilterCount > 0 && (
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={clearAllFilters}
                    >
                      Clear all
                    </Button>
                  )}
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Event Type</label>
                  <Select 
                    value={eventTypeFilter ?? "all"} 
                    onValueChange={(value) => setEventTypeFilter(value === "all" ? undefined : value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="oneTime">Single Event</SelectItem>
                      <SelectItem value="multiDay">Multi-day Event</SelectItem>
                      <SelectItem value="sameDayMultiArea">Multi-role Event</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Sort by Volunteers</label>
                  <Select 
                    value={volunteersSort ?? "no-sort"} 
                    onValueChange={(value) => setVolunteersSort(value === "no-sort" ? undefined : value as "asc" | "desc")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No sorting" />
                    </SelectTrigger>
                    <SelectContent>
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
                "{debouncedSearchTerm}"
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
      {isClientReady && (
        <ProjectViewToggle 
          projects={sortedProjects} 
          onVolunteerSortChange={setVolunteersSort}
          volunteerSort={volunteersSort}
          view={view}
          onViewChange={(newView) => setView(newView as "card" | "list" | "table")}
        />
      )}
      
      {/* Infinite scrolling marker */}
      <div ref={ref} className="h-4" />
    </div>
  );
};
