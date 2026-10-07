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
import { ArrowUp, CircleAlert } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import {
  CalendarDaysIcon,
  PlusIcon,
  SearchIcon,
  useAnimatedIcon,
} from "@/components/icons/animated";
import { EmptyStateIcon } from "./EmptyStateIcon";
import { DateRange } from "@daypicker/react";
import { formatDateRangeLabel } from "@/components/ui/date-range-picker";
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
  const createIcon = useAnimatedIcon();

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
      <div aria-busy="true">
        <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-center">
          <Skeleton className="h-9 w-full md:w-72 lg:w-80" />
          <Skeleton className="h-9 w-full md:w-36" />
          <Skeleton className="hidden h-9 w-56 md:ml-auto md:block" />
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <ProjectCardSkeleton key={`project-skeleton-${i}`} />
          ))}
        </div>
      </div>
    );
  }

  if (error && !isLoading && allProjects.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleAlert aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Couldn&apos;t load projects</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => void fetchProjectsPage(0, "replace")}>
            Try again
          </Button>
        </EmptyContent>
      </Empty>
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

        <Empty className="border" data-tour-id="home-project-list">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <EmptyStateIcon
                icon={activeFilterCount > 0 ? SearchIcon : CalendarDaysIcon}
              />
            </EmptyMedia>
            <EmptyTitle>No projects found</EmptyTitle>
            <EmptyDescription>
              {activeFilterCount > 0
                ? "Try changing or clearing your filters."
                : "No projects are available yet."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {activeFilterCount > 0 ? (
              <Button onClick={clearAllFilters}>Clear all filters</Button>
            ) : (
              <Link
                href="/projects/create"
                className={buttonVariants()}
                {...createIcon.triggerProps}
              >
                <PlusIcon
                  ref={createIcon.ref}
                  size={16}
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                Create a project
              </Link>
            )}
          </EmptyContent>
        </Empty>
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
        <div className="flex h-16 items-center justify-center" ref={ref}>
          {isValidating ? (
            <p
              className="text-muted-foreground flex items-center gap-2 text-sm"
              role="status"
            >
              <Spinner />
              Loading more projects...
            </p>
          ) : null}
        </div>
      )}

      {/* Show end of results message when we've reached the end */}
      {!hasMore && sortedProjects.length > 0 && view !== "map" && (
        <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-8 text-sm">
          <p>You&apos;ve seen all available projects</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({
                top: 0,
                behavior: "smooth",
              });
            }}
          >
            <ArrowUp data-icon="inline-start" aria-hidden="true" />
            Back to top
          </Button>
        </div>
      )}
    </div>
  );
};
