import {
  getProjectRetentionFinishedAt,
  type RetentionProject,
} from "@/lib/retention/project-finished-at";

/**
 * When a completed project's attendees become eligible for the follow-up
 * feedback email.
 *
 * - +24h floor: the volunteer is still driving home.
 * - Hold while hours are unpublished (up to the 96h backstop): a survey that
 *   lands before the certificate email collects one answer — "where are my
 *   hours?" — and trains volunteers to ignore the email.
 * - The 30-day backfill guard is the single most important safety line: the
 *   first run after enabling the worker must not mail every attendee of
 *   every project ever completed.
 *
 * Instants come from getProjectRetentionFinishedAt (project_timezone-aware);
 * projects.status is only ever a coarse candidate filter because
 * process_projects() computes in a hardcoded 'PST'.
 */

export const FEEDBACK_ELIGIBILITY_FLOOR_MS = 24 * 60 * 60 * 1000;
export const FEEDBACK_PUBLISH_BACKSTOP_MS = 96 * 60 * 60 * 1000;
export const FEEDBACK_BACKFILL_GUARD_MS = 30 * 24 * 60 * 60 * 1000;

export type FeedbackEligibilityProject = RetentionProject;

export function getFeedbackEligibleAt(options: {
  project: FeedbackEligibilityProject;
  allAttendedSlotsPublished: boolean;
  now?: number;
}): Date | null {
  const { project, allAttendedSlotsPublished } = options;
  const now = options.now ?? Date.now();

  if (project.status === "cancelled") return null;

  const finishedAt = getProjectRetentionFinishedAt(project);
  if (!finishedAt) return null;
  const finishedMs = finishedAt.getTime();

  if (finishedMs > now) return null;
  if (now < finishedMs + FEEDBACK_ELIGIBILITY_FLOOR_MS) return null;
  // BACKFILL GUARD: never enqueue for projects that finished long ago.
  if (now > finishedMs + FEEDBACK_BACKFILL_GUARD_MS) return null;
  if (
    !allAttendedSlotsPublished &&
    now < finishedMs + FEEDBACK_PUBLISH_BACKSTOP_MS
  ) {
    return null;
  }

  return new Date(finishedMs + FEEDBACK_ELIGIBILITY_FLOOR_MS);
}
