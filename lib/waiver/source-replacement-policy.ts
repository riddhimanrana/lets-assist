/**
 * When a project's waiver source PDF can be changed from the edit page.
 *
 * The database trigger `private.protect_waiver_project_publication` refuses a
 * client-role change to `waiver_pdf_storage_path` or `waiver_definition_id` on
 * a project that is published and requires a waiver (SQLSTATE 42501). Until a
 * service-only replacement function exists, the edit actions detect that case
 * up front and say so, before any file is stored or removed.
 */

export const WAIVER_SOURCE_REPLACE_LOCKED_MESSAGE =
  "This project is published and requires a waiver, so its waiver PDF cannot be replaced here yet.";

export const WAIVER_SOURCE_REMOVE_LOCKED_MESSAGE =
  "This project is published and requires a waiver, so its waiver PDF cannot be removed here yet.";

export const ENCRYPTED_WAIVER_PDF_MESSAGE =
  "This PDF is password protected. Remove the password and upload it again.";

/**
 * Mirrors the trigger's gate exactly: a missing workflow status counts as
 * published, and a missing waiver flag counts as not required.
 */
export function isWaiverSourceLocked(project: {
  workflow_status?: string | null;
  waiver_required?: boolean | null;
}): boolean {
  return (
    (project.workflow_status ?? "published") === "published" &&
    project.waiver_required === true
  );
}
