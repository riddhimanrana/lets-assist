import type { Project } from "@/types";

export type ProjectWithAvailability = Project & {
  signups?: Array<{ status?: string }>;
  slots_filled?: number;
  total_confirmed?: number;
  registrations?: unknown[];
};
