"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Users, MapPin } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import type { Project } from "@/types";
import { getProjectRemainingSpots } from "@/lib/projects/availability";
import type { ProjectWithAvailability } from "./types";

export function ProjectMapInfoWindow({
  project,
  onClose,
}: {
  project: ProjectWithAvailability;
  onClose: () => void;
}) {
  // Format date display for projects
  const formatDateDisplay = (project: Project) => {
    if (!project.event_type || !project.schedule) return "";

    switch (project.event_type) {
      case "oneTime": {
        if (!project.schedule.oneTime?.date) return "";
        return format(new Date(project.schedule.oneTime.date), "MMM d");
      }
      case "multiDay": {
        if (
          !project.schedule.multiDay ||
          project.schedule.multiDay.length === 0
        ) {
          return "";
        }
        const dates = project.schedule.multiDay
          .map((day) => new Date(day.date))
          .sort((a: Date, b: Date) => a.getTime() - b.getTime());

        // If dates are in same month
        const allSameMonth = dates.every(
          (date: Date) => date.getMonth() === dates[0].getMonth(),
        );

        if (dates.length <= 3) {
          if (allSameMonth) {
            // Format as "Mar 7, 9, 10"
            return `${format(dates[0], "MMM")} ${dates
              .map((date: Date) => format(date, "d"))
              .join(", ")}`;
          } else {
            // Format as "Mar 7, Apr 9, 10"
            return dates
              .map((date: Date, i: number) => {
                const prevDate = i > 0 ? dates[i - 1] : null;
                if (!prevDate || prevDate.getMonth() !== date.getMonth()) {
                  return format(date, "MMM d");
                }
                return format(date, "d");
              })
              .join(", ");
          }
        } else {
          // For more than 3 dates, show range
          return `${format(dates[0], "MMM d")} - ${format(dates[dates.length - 1], "MMM d")}`;
        }
      }
      case "sameDayMultiArea": {
        if (!project.schedule.sameDayMultiArea?.date) return "";
        return format(
          new Date(project.schedule.sameDayMultiArea.date),
          "MMM d",
        );
      }
      default:
        return "";
    }
  };

  // Format volunteer spots
  const formatSpots = (count: number) => {
    return `${count} ${count === 1 ? "spot" : "spots"} left`;
  };

  return (
    <div className="custom-info-window bg-white dark:bg-black p-3 rounded-lg shadow-lg max-w-75 border">
      <button
        className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-800"
        onClick={onClose}
        aria-label="Close info window"
      >
        &times;
      </button>
      <div className="text-black dark:text-white">
        <h4 className="font-semibold mb-1 text-lg">{project.title}</h4>
        <div className="flex items-center gap-1 mb-2">
          <MapPin className="h-3 w-3" />
          <span className="text-xs">{project.location}</span>
        </div>
        <div className="flex flex-wrap gap-1 mb-3">
          <Badge
            variant="outline"
            className="gap-1 text-xs text-black dark:text-white"
          >
            <Calendar className="h-3 w-3" />
            {formatDateDisplay(project)}
          </Badge>
          <Badge
            variant="outline"
            className="gap-1 text-xs text-black dark:text-white"
          >
            <Users className="h-3 w-3" />
            {formatSpots(getProjectRemainingSpots(project))}
          </Badge>
        </div>
        <Link href={`/projects/${project.id}`}>
          <Button
            size="sm"
            className="w-full bg-green-600 hover:bg-green-600/90 text-white"
          >
            View Details
          </Button>
        </Link>
      </div>
    </div>
  );
}
