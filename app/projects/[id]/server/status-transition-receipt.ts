import "server-only";

import type { ProjectStatus } from "@/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProjectStatusTransitionReceipt = {
  outcome: "transitioned" | "replayed";
  projectId: string;
  previousStatus: ProjectStatus;
  status: ProjectStatus;
};

export function getExactProjectStatusTransitionReceipt(
  value: unknown,
): ProjectStatusTransitionReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const receipt = value as Record<string, unknown>;
  if (
    (receipt.outcome !== "transitioned" && receipt.outcome !== "replayed") ||
    typeof receipt.projectId !== "string" ||
    !UUID_PATTERN.test(receipt.projectId) ||
    (receipt.previousStatus !== "upcoming" &&
      receipt.previousStatus !== "in-progress" &&
      receipt.previousStatus !== "completed" &&
      receipt.previousStatus !== "cancelled") ||
    (receipt.status !== "upcoming" &&
      receipt.status !== "in-progress" &&
      receipt.status !== "completed" &&
      receipt.status !== "cancelled")
  ) {
    return null;
  }

  if (
    (receipt.outcome === "transitioned" &&
      receipt.previousStatus === receipt.status) ||
    (receipt.outcome === "replayed" &&
      receipt.previousStatus !== receipt.status)
  ) {
    return null;
  }

  return receipt as ProjectStatusTransitionReceipt;
}
