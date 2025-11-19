"use client";
import React, { useState, useEffect, useMemo, useCallback } from "react";
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
  CheckCircle2,
  ArrowUp,
  Plus,
  PackageX,
  Map,
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
import { Separator } from "@/components/ui/separator";
import Link from "next/link";
import { ProjectsMapView } from "@/components/ProjectsMapView";
import { getProjectStatus } from "@/utils/project";

const fetcher = (url: string) => axios.get(url).then((res) => res.data);

export const ProjectsInfiniteScroll: React.FC = () => {
  const limit = 20;
  const [searchTerm, setSearchTerm] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState<string | undefined>(undefined);
  const [dateFilter, setDateFilter] = useState<DateRange | undefined>(undefined);
  const [volunteersSort, setVolunteersSort] = useState<"asc" | "desc" | undefined>(undefined);
  const [dateSort, setDateSort] = useState<"asc" | "desc" | undefined>(undefined);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [isClientReady, setIsClientReady] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [view, setView] = useState<"card" | "list" | "table" | "map">("card");
  const [reachedEnd, setReachedEnd] = useState(false);
  
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

  const { data, error, size, setSize, isLoading, isValidating } = useSWRInfinite(
    // Update the key function to include status parameter
    (index) => `/api/projects?limit=${limit}&offset=${index * limit}&status=upcoming`,
    fetcher,
    {
      revalidateFirstPage: false,
      revalidateOnFocus: false, // Prevent reloading when window gets focus
    }
  );

  const { ref, inView } = useInView({
    threshold: 0.5, // Trigger when 50% of the element is visible
    rootMargin: '100px', // Start loading a bit earlier
  });

  // Compute if the last page has fewer projects than the limit.
  const isReachingEnd = useMemo(() => {
    return data && data[data.length - 1]?.length < limit;
  }, [data, limit]);

  const isLoadingMore = isValidating && size > 1;

  // Determine if we've reached the end of content
  useEffect(() => {
    if (data) {
      const lastPage = data[data.length - 1];
      // If we got fewer items than the limit or an empty array, we've reached the end
      if (!lastPage || lastPage.length < limit) {
        setReachedEnd(true);
      }
    }
  }, [data, limit]);

  // Only request a new page if the marker is in view, we're not loading, and we haven't reached the end.
  useEffect(() => {
    if (inView && !isValidating && !reachedEnd && data) {
      setSize(size + 1);
    }
  }, [inView, isValidating, reachedEnd, data, setSize, size]);

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

  // Get the earliest date from a project
  const getProjectDate = useCallback((project: any): Date | null => {
    try {
      if (project.event_type === "oneTime" && project.schedule?.oneTime?.date) {
        return parseISO(project.schedule.oneTime.date);
      } else if (project.event_type === "multiDay" && project.schedule?.multiDay?.length > 0) {
        // Get the earliest date from multiDay events
        const dates = project.schedule.multiDay.map((day: any) => parseISO(day.date));
        return new Date(Math.min(...dates.map((d: Date) => d.getTime())));
      } else if (project.event_type === "sameDayMultiArea" && project.schedule?.sameDayMultiArea?.date) {
        return parseISO(project.schedule.sameDayMultiArea.date);
      }
    } catch (e) {
      console.error("Date parsing error:", e);
    }
    return null;
  }, []);

  // Sort projects by volunteer count
  const sortByVolunteers = useCallback((projects: any[], direction: "asc" | "desc" | undefined) => {
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
  const sortByDate = useCallback((projects: any[], direction: "asc" | "desc" | undefined) => {
    // Define getProjectDate within sortByDate to avoid dependency cycle
    const getProjectDateInternal = (project: any): Date | null => {
      try {
        if (project.event_type === "oneTime" && project.schedule?.oneTime?.date) {
          return parseISO(project.schedule.oneTime.date);
        } else if (project.event_type === "multiDay" && project.schedule?.multiDay?.length > 0) {
          // Get the earliest date from multiDay events
          const dates = project.schedule.multiDay.map((day: any) => parseISO(day.date));
          return new Date(Math.min(...dates.map((d: Date) => d.getTime())));
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

  // Get volunteer count from a project
  const getVolunteerCount = (project: any): number => {
    if (!project.event_type || !project.schedule) return 0;

    switch (project.event_type) {
      case "oneTime":
        return project.schedule.oneTime?.volunteers || 0;
      case "multiDay": {
        let total = 0;  // Initialize total here
        // Sum all volunteers across all days and slots
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

  // New function to get remaining spots
  const getRemainingSpots = (project: any): number => {
    // Get total spots
    const totalSpots = getVolunteerCount(project);
    
    // Calculate filled spots based on project type
    let filledSpots = 0;
    
    if (project.signups && Array.isArray(project.signups)) {
      // Count confirmed signups only
      filledSpots = project.signups.filter((signup: any) => 
        signup.status === "approved"
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

  // Get all projects and apply client-side filtering
  const allProjects = data ? ([] as any[]).concat(...data) : [];
  
  const filteredProjects = allProjects.filter((project) => {
    // Search term filter
    const matchesSearch = debouncedSearchTerm 
      ? project.title?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) || 
        project.description?.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
      : true;
      
    // Event type filter
    const matchesEventType = eventTypeFilter 
      ? eventTypeFilter === "all"
        ? true
        : project.event_type === eventTypeFilter 
      : true;
    
    // Date filter
    const matchesDateRange = isProjectInDateRange(project, dateFilter);
    
    // Only filter for remaining spots - server is already filtering for status
    const hasRemainingSpots = getRemainingSpots(project) > 0;
      
    return matchesSearch && matchesEventType && matchesDateRange && hasRemainingSpots;
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

  // Error state
  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Error Loading Projects
          </CardTitle>
          <CardDescription>
            There was an error loading the projects. Please try again later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            This could be due to a network issue or the server may be temporarily unavailable.
          </p>
        </CardContent>
        <CardFooter>
          <Button 
            onClick={() => window.location.reload()}
            variant="outline"
            className="gap-2"
          >
            <Loader2 className="h-4 w-4 font-bold animate-spin" />
            Try Again
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
          <div className="flex flex-wrap items-center gap-3" data-tour-id="home-project-filters">
            <div className="relative w-full sm:w-auto sm:flex-1 max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
              placeholder="Search projects..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2 flex-grow order-last sm:order-none">
              <DateRangePicker
                value={dateFilter}
                onChange={setDateFilter}
                align="end"
                className="w-full max-w-[180px]"
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
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-9 w-9", view === "map" && "bg-muted")}
                onClick={() => setView("map")}
              >
                <Map className="h-4 w-4" />
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
                    <label className="text-sm font-medium">Sort by Date</label>
                    <Select 
                      value={dateSort ?? "no-sort"} 
                      onValueChange={(value) => {
                        setDateSort(value === "no-sort" ? undefined : value as "asc" | "desc");
                        // Clear volunteer sort when date sort is selected
                        if (value !== "no-sort") {
                          setVolunteersSort(undefined);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="No sorting" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="no-sort">No sorting</SelectItem>
                        <SelectItem value="desc">Most recent first</SelectItem>
                        <SelectItem value="asc">Future dates first</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Sort by Volunteers</label>
                    <Select 
                      value={volunteersSort ?? "no-sort"} 
                      onValueChange={(value) => {
                        setVolunteersSort(value === "no-sort" ? undefined : value as "asc" | "desc");
                        // Clear date sort when volunteer sort is selected
                        if (value !== "no-sort") {
                          setDateSort(undefined);
                        }
                      }}
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
              
              <Button asChild variant={activeFilterCount > 0 ? "outline" : "default"}>
                <Link href="/projects/create" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create a project
                </Link>
              </Button>
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
        <div className="flex flex-wrap items-center gap-3" data-tour-id="home-project-filters">
        <div className="relative w-full sm:w-auto sm:flex-1 max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
              placeholder="Search projects..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2 flex-grow">
            <DateRangePicker
              value={dateFilter}
              onChange={setDateFilter}
              align="end"
              className="w-full max-w-[180px]"
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
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-9 w-9", view === "map" && "bg-muted")}
              onClick={() => setView("map")}
            >
              <Map className="h-4 w-4" />
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
                  <label className="text-sm font-medium">Sort by Date</label>
                  <Select 
                    value={dateSort ?? "no-sort"} 
                    onValueChange={(value) => {
                      setDateSort(value === "no-sort" ? undefined : value as "asc" | "desc");
                      // Clear volunteer sort when date sort is selected
                      if (value !== "no-sort") {
                        setVolunteersSort(undefined);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No sorting" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no-sort">No sorting</SelectItem>
                      <SelectItem value="desc">Most recent first</SelectItem>
                      <SelectItem value="asc">Future dates first</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Sort by Volunteers</label>
                  <Select 
                    value={volunteersSort ?? "no-sort"} 
                    onValueChange={(value) => {
                      setVolunteersSort(value === "no-sort" ? undefined : value as "asc" | "desc");
                      // Clear date sort when volunteer sort is selected
                      if (value !== "no-sort") {
                        setDateSort(undefined);
                      }
                    }}
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
      {!reachedEnd && view !== "map" && (
        <div className="py-6 flex justify-center" ref={ref}>
          {isLoadingMore ? (
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
      {reachedEnd && sortedProjects.length > 0 && view !== "map" && (
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
