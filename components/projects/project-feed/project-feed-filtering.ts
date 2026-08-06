import type { DateRange } from "@daypicker/react";
import { parseISO } from "date-fns";

import {
  getProjectRemainingSpots,
  getProjectVolunteerCapacity,
} from "@/lib/projects/availability";
import { getProjectStatus } from "@/utils/project";
import type { ProjectFeedSort, ProjectWithSignups } from "./types";

const isWithinDateRange = (date: Date, range: DateRange) => {
  if (!range.from) return true;
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const start = new Date(range.from);
  start.setHours(0, 0, 0, 0);
  if (!range.to) return target.getTime() === start.getTime();

  const end = new Date(range.to);
  end.setHours(0, 0, 0, 0);
  return target >= start && target <= end;
};

const getProjectDate = (project: ProjectWithSignups): Date | null => {
  try {
    if (project.event_type === "oneTime" && project.schedule?.oneTime?.date) {
      return parseISO(project.schedule.oneTime.date);
    }
    if (project.event_type === "multiDay") {
      const schedule = project.schedule?.multiDay;
      if (schedule?.length) {
        const dates = schedule.map((day) => parseISO(day.date).getTime());
        return new Date(Math.min(...dates));
      }
    }
    if (
      project.event_type === "sameDayMultiArea" &&
      project.schedule?.sameDayMultiArea?.date
    ) {
      return parseISO(project.schedule.sameDayMultiArea.date);
    }
  } catch (error) {
    console.error("Date parsing error:", error);
  }
  return null;
};

const isProjectInDateRange = (
  project: ProjectWithSignups,
  range: DateRange | undefined,
) => {
  if (!range?.from) return true;
  if (project.event_type === "multiDay" && project.schedule?.multiDay?.length) {
    return project.schedule.multiDay.some((day) =>
      isWithinDateRange(parseISO(day.date), range),
    );
  }
  const date = getProjectDate(project);
  return date ? isWithinDateRange(date, range) : true;
};

export function filterAndSortProjects({
  projects,
  dateFilter,
  volunteersSort,
  dateSort,
}: {
  projects: ProjectWithSignups[];
  dateFilter?: DateRange;
  volunteersSort: ProjectFeedSort;
  dateSort: ProjectFeedSort;
}) {
  const filtered = projects.filter((project) => {
    const status = getProjectStatus(project);
    return (
      isProjectInDateRange(project, dateFilter) &&
      getProjectRemainingSpots(project) > 0 &&
      (status === "upcoming" || status === "in-progress")
    );
  });

  if (volunteersSort) {
    const multiplier = volunteersSort === "desc" ? -1 : 1;
    return [...filtered].sort(
      (first, second) =>
        multiplier *
        (getProjectVolunteerCapacity(first) -
          getProjectVolunteerCapacity(second)),
    );
  }

  if (dateSort) {
    return [...filtered].sort((first, second) => {
      const firstDate = getProjectDate(first);
      const secondDate = getProjectDate(second);
      if (!firstDate || !secondDate) return 0;
      return dateSort === "desc"
        ? firstDate.getTime() - secondDate.getTime()
        : secondDate.getTime() - firstDate.getTime();
    });
  }

  return filtered;
}
