import type { Project, Signup } from "@/types";

export const ACTIVE_PROJECT_SIGNUP_STATUSES = ["pending", "approved", "attended"] as const;

const ACTIVE_PROJECT_SIGNUP_STATUS_SET = new Set<string>(ACTIVE_PROJECT_SIGNUP_STATUSES);

export type ActiveProjectSignupStatus = (typeof ACTIVE_PROJECT_SIGNUP_STATUSES)[number];

export type ProjectSignupStatusLike = {
  status?: Signup["status"] | string | null;
};

export type ProjectAvailability = Pick<Project, "event_type" | "schedule"> & {
  signups?: ProjectSignupStatusLike[] | null;
  slots_filled?: number | null;
  total_confirmed?: number | null;
  registrations?: unknown[] | null;
};

export type ProjectSignupOccupancyRow = {
  project_id: string;
  schedule_id: string | null;
  status: Signup["status"] | string;
};

export type ProjectOccupancySummary = {
  slotsFilled: number;
  slotsFilledBySchedule: Record<string, number>;
};

export function isActiveProjectSignupStatus(
  status?: string | null,
): status is ActiveProjectSignupStatus {
  return !!status && ACTIVE_PROJECT_SIGNUP_STATUS_SET.has(status);
}

export function summarizeProjectOccupancy(
  signups: readonly ProjectSignupOccupancyRow[],
): ProjectOccupancySummary {
  return signups.reduce<ProjectOccupancySummary>(
    (summary, signup) => {
      if (!isActiveProjectSignupStatus(signup.status)) {
        return summary;
      }

      summary.slotsFilled += 1;

      if (signup.schedule_id) {
        summary.slotsFilledBySchedule[signup.schedule_id] =
          (summary.slotsFilledBySchedule[signup.schedule_id] || 0) + 1;
      }

      return summary;
    },
    {
      slotsFilled: 0,
      slotsFilledBySchedule: {},
    },
  );
}

export function buildProjectOccupancyByProject(
  signups: readonly ProjectSignupOccupancyRow[],
): Record<string, ProjectOccupancySummary> {
  return signups.reduce<Record<string, ProjectOccupancySummary>>((acc, signup) => {
    if (!isActiveProjectSignupStatus(signup.status)) {
      return acc;
    }

    const summary =
      acc[signup.project_id] ??
      (acc[signup.project_id] = {
        slotsFilled: 0,
        slotsFilledBySchedule: {},
      });

    summary.slotsFilled += 1;

    if (signup.schedule_id) {
      summary.slotsFilledBySchedule[signup.schedule_id] =
        (summary.slotsFilledBySchedule[signup.schedule_id] || 0) + 1;
    }

    return acc;
  }, {});
}

export function getProjectVolunteerCapacity(
  project: Pick<Project, "event_type" | "schedule">,
): number {
  if (!project.event_type || !project.schedule) {
    return 0;
  }

  switch (project.event_type) {
    case "oneTime":
      return project.schedule.oneTime?.volunteers || 0;
    case "multiDay": {
      let total = 0;

      if (project.schedule.multiDay) {
        project.schedule.multiDay.forEach((day) => {
          day.slots?.forEach((slot) => {
            total += slot.volunteers || 0;
          });
        });
      }

      return total;
    }
    case "sameDayMultiArea": {
      let total = 0;

      if (project.schedule.sameDayMultiArea?.roles) {
        project.schedule.sameDayMultiArea.roles.forEach((role) => {
          total += role.volunteers || 0;
        });
      }

      return total;
    }
    default:
      return 0;
  }
}

export function getProjectFilledSpots(project: ProjectAvailability): number {
  if (Array.isArray(project.signups)) {
    return project.signups.reduce((count, signup) => {
      return count + (isActiveProjectSignupStatus(signup.status) ? 1 : 0);
    }, 0);
  }

  if (typeof project.slots_filled === "number") {
    return project.slots_filled;
  }

  if (typeof project.total_confirmed === "number") {
    return project.total_confirmed;
  }

  if (Array.isArray(project.registrations)) {
    return project.registrations.length;
  }

  return 0;
}

export function getProjectRemainingSpots(project: ProjectAvailability): number {
  return Math.max(0, getProjectVolunteerCapacity(project) - getProjectFilledSpots(project));
}