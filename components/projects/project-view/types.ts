import type { Organization, Project as BaseProject, Signup } from "@/types";

export type ProjectWithExtras = BaseProject & {
  organizations?: Organization;
  total_confirmed?: number;
  slots_filled?: number;
  signups?: { status?: string }[] | Signup[];
};

export const PROJECT_VIEW_STORAGE_KEY = "preferred-project-view";
export const VALID_PROJECT_VIEWS = ["card", "list", "table", "map"] as const;

export type ValidProjectView = (typeof VALID_PROJECT_VIEWS)[number];

export type ProjectViewToggleProps = {
  projects: ProjectWithExtras[];
  onVolunteerSortChange?: (sort: "asc" | "desc" | undefined) => void;
  volunteerSort?: "asc" | "desc" | undefined;
  view: ValidProjectView;
  onViewChangeAction: (view: ValidProjectView) => void;
};
