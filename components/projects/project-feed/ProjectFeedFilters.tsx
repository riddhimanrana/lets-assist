"use client";

import type { ProjectFeedFilterProps } from "./types";
import { ProjectFeedActiveFilters } from "./ProjectFeedActiveFilters";
import { ProjectFeedDesktopFilters } from "./ProjectFeedDesktopFilters";
import { ProjectFeedMobileFilters } from "./ProjectFeedMobileFilters";

export function ProjectFeedFilters(props: ProjectFeedFilterProps) {
  return (
    <div className="mb-8">
      <div className="w-full" data-tour-id="home-project-filters">
        <ProjectFeedMobileFilters {...props} />
        <ProjectFeedDesktopFilters {...props} />
      </div>
      <ProjectFeedActiveFilters {...props} />
    </div>
  );
}
