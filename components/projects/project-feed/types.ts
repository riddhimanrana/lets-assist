import type { Dispatch, SetStateAction } from "react";
import type { DateRange } from "@daypicker/react";
import type { Project } from "@/types";

export type ProjectWithSignups = Project & {
  signups?: Array<{ status?: string }>;
  slots_filled?: number;
  total_confirmed?: number;
  registrations?: unknown[];
  [key: string]: unknown;
};

export type ProjectFeedView = "card" | "list" | "table" | "map";
export type ProjectFeedSort = "asc" | "desc" | undefined;

export type ProjectFeedFilterProps = {
  searchTerm: string;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  debouncedSearchTerm: string;
  eventTypeFilter?: string;
  setEventTypeFilter: Dispatch<SetStateAction<string | undefined>>;
  dateFilter?: DateRange;
  setDateFilter: Dispatch<SetStateAction<DateRange | undefined>>;
  volunteersSort: ProjectFeedSort;
  setVolunteersSort: Dispatch<SetStateAction<ProjectFeedSort>>;
  dateSort: ProjectFeedSort;
  setDateSort: Dispatch<SetStateAction<ProjectFeedSort>>;
  view: ProjectFeedView;
  setView: Dispatch<SetStateAction<ProjectFeedView>>;
  activeFilterCount: number;
  dateFilterLabel?: string;
  clearAllFilters: () => void;
};
