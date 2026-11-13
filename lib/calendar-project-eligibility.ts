/** Cancelled and unpublished projects must not create personal Calendar entries. */
export function canSyncCalendarProject(project: {
  status?: string | null;
  workflow_status?: string | null;
}) {
  return (
    project.status !== "cancelled" &&
    (project.workflow_status ?? "published") === "published"
  );
}
