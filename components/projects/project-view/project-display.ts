import { format, parse } from "date-fns";

import { getProjectRemainingSpots } from "@/lib/projects/availability";
import { getProjectStatus } from "@/utils/project";

import type { ProjectWithExtras } from "./types";

const formatTime = (timeString: string) => {
  try {
    return format(parse(timeString, "HH:mm", new Date()), "h:mm a");
  } catch {
    return timeString;
  }
};

const parseLocalDate = (dateString: string) => {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
};

export const formatSpots = (count: number) =>
  `${count} ${count === 1 ? "spot" : "spots"} left`;

export const formatDateDisplay = (project: ProjectWithExtras) => {
  if (!project.event_type || !project.schedule) return "";

  switch (project.event_type) {
    case "oneTime": {
      const date = project.schedule.oneTime?.date;
      return date ? format(parseLocalDate(date), "MMM d") : "";
    }
    case "multiDay": {
      const schedule = project.schedule.multiDay;
      if (!schedule?.length) return "";

      const dates = schedule
        .map((day) => parseLocalDate(day.date))
        .sort((a, b) => a.getTime() - b.getTime());
      const allSameMonth = dates.every(
        (date) => date.getMonth() === dates[0].getMonth(),
      );

      if (dates.length <= 3) {
        if (allSameMonth) {
          return `${format(dates[0], "MMM")} ${dates
            .map((date) => format(date, "d"))
            .join(", ")}`;
        }

        return dates
          .map((date, index) => {
            const previousDate = index > 0 ? dates[index - 1] : null;
            return !previousDate || previousDate.getMonth() !== date.getMonth()
              ? format(date, "MMM d")
              : format(date, "d");
          })
          .join(", ");
      }

      return `${format(dates[0], "MMM d")} - ${format(dates.at(-1)!, "MMM d")}`;
    }
    case "sameDayMultiArea": {
      const date = project.schedule.sameDayMultiArea?.date;
      return date ? format(parseLocalDate(date), "MMM d") : "";
    }
    default:
      return "";
  }
};

export const getEventScheduleSummary = (project: ProjectWithExtras) => {
  if (!project.event_type || !project.schedule) return "Not specified";

  switch (project.event_type) {
    case "oneTime": {
      const schedule = project.schedule.oneTime;
      if (!schedule?.date) return "Not specified";

      const date = format(parseLocalDate(schedule.date), "MMM d, yyyy");
      if (schedule.startTime && schedule.endTime) {
        return `${date}, ${formatTime(schedule.startTime)} - ${formatTime(schedule.endTime)}`;
      }
      if (schedule.startTime)
        return `${date}, starts ${formatTime(schedule.startTime)}`;
      if (schedule.endTime)
        return `${date}, ends ${formatTime(schedule.endTime)}`;
      return date;
    }
    case "multiDay": {
      const schedule = project.schedule.multiDay;
      if (!schedule?.length) return "Not specified";

      const startDate = format(parseLocalDate(schedule[0].date), "MMM d");
      const endDate = format(parseLocalDate(schedule.at(-1)!.date), "MMM d");
      return `${schedule.length} days (${startDate} - ${endDate})`;
    }
    case "sameDayMultiArea": {
      const schedule = project.schedule.sameDayMultiArea;
      if (!schedule?.date) return "Not specified";

      const date = format(parseLocalDate(schedule.date), "MMM d, yyyy");
      return `${date}, ${schedule.roles.length} roles`;
    }
    default:
      return "Not specified";
  }
};

export const getRemainingSpots = (project: ProjectWithExtras) =>
  getProjectRemainingSpots(project);

export const isUpcomingProject = (project: ProjectWithExtras) => {
  const status = getProjectStatus(project);
  return status === "upcoming" || status === "in-progress";
};

export const getProjectCreator = (project: ProjectWithExtras) => {
  if (project.organization) return project.organization.name || "Organization";
  if (project.organization_id && project.organizations) {
    return project.organizations.name || "Organization";
  }
  return project.profiles?.full_name || "Anonymous";
};

export const getCreatorAvatarUrl = (project: ProjectWithExtras) => {
  if (project.organization) return project.organization.logo_url;
  if (project.organization_id && project.organizations) {
    return project.organizations.logo_url;
  }
  return project.profiles?.avatar_url;
};

export const isOrganizationVerified = (project: ProjectWithExtras) => {
  if (project.organization) return project.organization.verified || false;
  if (project.organization_id && project.organizations) {
    return project.organizations.verified || false;
  }
  return false;
};
