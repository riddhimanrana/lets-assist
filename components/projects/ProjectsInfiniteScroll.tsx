"use client";
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useInView } from "react-intersection-observer";
import { ProjectViewToggle } from "./ProjectViewToggle";
import { ProjectCardSkeleton } from "./ProjectCardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Search,
  Loader2,
  X,
  CheckCircle2,
  ArrowUp,
  Plus,
  PackageX,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DateRange } from "@daypicker/react";
import { formatDateRangeLabel } from "@/components/ui/date-range-picker";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { ProjectsMapView } from "./ProjectsMapView";
import {
  observeProjectFeedPageLifecycle,
  shouldReportProjectFeedFailure,
} from "./project-feed-lifecycle";
import { ProjectFeedFilters } from "./project-feed/ProjectFeedFilters";
import { filterAndSortProjects } from "./project-feed/project-feed-filtering";
import type { ProjectFeedView, ProjectWithSignups } from "./project-feed/types";

export const ProjectsInfiniteScroll: React.FC = () => {
  const limit = 20;
  const [searchTerm, setSearchTerm] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState<string | undefined>(
    undefined,
  );
  const [dateFilter, setDateFilter] = useState<DateRange | undefined>(
    undefined,
  );
  const [volunteersSort, setVolunteersSort] = useState<
    "asc" | "desc" | undefined
  >(undefined);
  const [dateSort, setDateSort] = useState<"asc" | "desc" | undefined>(
    undefined,
  );
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [isClientReady, setIsClientReady] = useState(false);
  const [view, setView] = useState<ProjectFeedView>("card");
  const [projectsData, setProjectsData] = useState<ProjectWithSignups[]>([]);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isValidating, setIsValidating] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequestIdRef = useRef(0);
  const activeRequestAbortRef = useRef<AbortController | null>(null);
  const pageTeardownRef = useRef(false);

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

  const fetchProjectsPage = useCallback(
    async (offset: number, mode: "replace" | "append" = "append") => {
      const requestId = ++latestRequestIdRef.current;
      activeRequestAbortRef.current?.abort();
      pageTeardownRef.current = false;
      const abortController = new AbortController();
      activeRequestAbortRef.current = abortController;

      if (mode === "replace") {
        setIsLoading(true);
        setHasMore(true);
        setIsSuccess(false);
      }

      setIsValidating(true);
      setError(null);

      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        status: "upcoming",
      });

      if (debouncedSearchTerm) {
        params.set("search", debouncedSearchTerm);
      }

      if (eventTypeFilter && eventTypeFilter !== "all") {
        params.set("eventType", eventTypeFilter);
      }

      try {
        const response = await fetch(`/api/projects?${params.toString()}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to load projects (${response.status})`);
        }

        const nextProjects = (await response.json()) as ProjectWithSignups[];

        if (requestId !== latestRequestIdRef.current) {
          return;
        }

        setProjectsData((currentProjects) =>
          mode === "replace"
            ? nextProjects
            : [...currentProjects, ...nextProjects],
        );
        setHasMore(nextProjects.length === limit);
        setIsSuccess(true);
      } catch (fetchError) {
        if (
          !shouldReportProjectFeedFailure({
            signalAborted: abortController.signal.aborted,
            pageTearingDown: pageTeardownRef.current,
            isLatestRequest: requestId === latestRequestIdRef.current,
          })
        ) {
          return;
        }

        console.error("Error loading project feed:", fetchError);
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load projects",
        );

        if (mode === "replace") {
          setProjectsData([]);
          setHasMore(false);
        }
      } finally {
        if (activeRequestAbortRef.current === abortController) {
          activeRequestAbortRef.current = null;
        }
        if (requestId === latestRequestIdRef.current) {
          setIsLoading(false);
          setIsValidating(false);
        }
      }
    },
    [debouncedSearchTerm, eventTypeFilter, limit],
  );

  useEffect(() => {
    setProjectsData([]);
    void fetchProjectsPage(0, "replace");

    return () => {
      latestRequestIdRef.current += 1;
      activeRequestAbortRef.current?.abort();
      activeRequestAbortRef.current = null;
    };
  }, [fetchProjectsPage]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    return observeProjectFeedPageLifecycle({
      target: window,
      getActiveRequest: () => activeRequestAbortRef.current,
      onTeardown: () => {
        pageTeardownRef.current = true;
        latestRequestIdRef.current += 1;
        activeRequestAbortRef.current = null;
      },
      onPersistedRestore: () => {
        pageTeardownRef.current = false;
        void fetchProjectsPage(0, "replace");
      },
    });
  }, [fetchProjectsPage]);

  const { ref, inView } = useInView({
    threshold: 0.1,
    rootMargin: "100px",
  });

  // Load more trigger
  useEffect(() => {
    if (inView && hasMore && !isValidating && !isLoading) {
      void fetchProjectsPage(projectsData.length);
    }
  }, [
    inView,
    hasMore,
    isValidating,
    isLoading,
    fetchProjectsPage,
    projectsData.length,
  ]);

  const allProjects = projectsData;
  const sortedProjects = useMemo(
    () =>
      filterAndSortProjects({
        projects: allProjects,
        dateFilter,
        volunteersSort,
        dateSort,
      }),
    [allProjects, dateFilter, volunteersSort, dateSort],
  );

  const showInitialSkeleton = isLoading && sortedProjects.length === 0;

  // Count active filters
  const activeFilterCount = useMemo(
    () =>
      [
        debouncedSearchTerm ? 1 : 0,
        eventTypeFilter ? 1 : 0,
        dateFilter?.from ? 1 : 0,
        volunteersSort ? 1 : 0,
        dateSort ? 1 : 0,
      ].reduce((a, b) => a + b, 0),
    [
      debouncedSearchTerm,
      eventTypeFilter,
      dateFilter,
      volunteersSort,
      dateSort,
    ],
  );

  const dateFilterLabel = formatDateRangeLabel(dateFilter, {
    singleDatePrefix: "From",
  });

  // Clear all filters function
  const clearAllFilters = () => {
    setSearchTerm("");
    setEventTypeFilter(undefined);
    setDateFilter(undefined);
    setVolunteersSort(undefined);
    setDateSort(undefined);
  };

  // Loading skeletons
  if (showInitialSkeleton) {
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <ProjectCardSkeleton key={`project-skeleton-${i}`} />
          ))}
        </div>
      </div>
    );
  }

  if (error && !isLoading && allProjects.length === 0) {
    return (
      <Card className="bg-muted/40 border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
            <PackageX className="h-10 w-10 text-muted-foreground opacity-80" />
          </div>
          <h3 className="text-xl font-medium mb-2">
            Couldn&apos;t load projects
          </h3>
          <p className="text-muted-foreground text-center max-w-md mb-8">
            {error}
          </p>
          <Button onClick={() => void fetchProjectsPage(0, "replace")}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Empty state when no projects match filters
  if (isSuccess && sortedProjects.length === 0) {
    return (
      <>
        <ProjectFeedFilters
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          debouncedSearchTerm={debouncedSearchTerm}
          eventTypeFilter={eventTypeFilter}
          setEventTypeFilter={setEventTypeFilter}
          dateFilter={dateFilter}
          setDateFilter={setDateFilter}
          volunteersSort={volunteersSort}
          setVolunteersSort={setVolunteersSort}
          dateSort={dateSort}
          setDateSort={setDateSort}
          view={view}
          setView={setView}
          activeFilterCount={activeFilterCount}
          dateFilterLabel={dateFilterLabel}
          clearAllFilters={clearAllFilters}
        />

        <Card
          className="bg-muted/40 border-dashed"
          data-tour-id="home-project-list"
        >
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
                <Button
                  variant="default"
                  onClick={clearAllFilters}
                  className="gap-2"
                >
                  <X className="h-4 w-4" />
                  Clear all filters
                </Button>
              )}

              <Link
                href="/projects/create"
                className={cn(
                  buttonVariants({
                    variant: activeFilterCount > 0 ? "outline" : "default",
                  }),
                  "gap-2",
                )}
              >
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
      <ProjectFeedFilters
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        debouncedSearchTerm={debouncedSearchTerm}
        eventTypeFilter={eventTypeFilter}
        setEventTypeFilter={setEventTypeFilter}
        dateFilter={dateFilter}
        setDateFilter={setDateFilter}
        volunteersSort={volunteersSort}
        setVolunteersSort={setVolunteersSort}
        dateSort={dateSort}
        setDateSort={setDateSort}
        view={view}
        setView={setView}
        activeFilterCount={activeFilterCount}
        dateFilterLabel={dateFilterLabel}
        clearAllFilters={clearAllFilters}
      />

      {/* Only render when client is ready to avoid hydration mismatch */}
      {isClientReady && view !== "map" && (
        <div data-tour-id="home-project-list">
          <ProjectViewToggle
            projects={sortedProjects}
            onVolunteerSortChange={setVolunteersSort}
            volunteerSort={volunteersSort}
            view={view}
            onViewChangeAction={(newView) =>
              setView(newView as "card" | "list" | "table")
            }
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
              <span className="text-sm text-muted-foreground">
                Loading more projects...
              </span>
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
            <span className="font-medium">
              You&apos;ve seen all available projects
            </span>
          </div>

          <div className="mt-6">
            <Button
              variant="outline"
              className="gap-2"
              onClick={(e) => {
                e.preventDefault();
                window.scrollTo({
                  top: 0,
                  behavior: "smooth",
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
