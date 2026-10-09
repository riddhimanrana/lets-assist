export const observedWorkers = /** @type {const} */ ([
  "project-cancellations",
  "csf-communications-dispatch",
  "data-exports",
  "ai-moderation",
  "anonymous-cleanup",
  "auto-publish-hours",
  "csf-class-workbook-refresh",
  "csf-import-commit",
  "csf-proof-cleanup",
  "csf-publication-notifications",
  "generate-recurring-projects",
  "organization-calendar-sync",
  "organization-sheet-sync",
  "paper-scan-cleanup",
  "paper-signup-notifications",
  "project-feedback-followups",
  "waiver-cleanup",
  "public-image-cleanup",
]);

export const workerReceiptMaxDurationMs = 900_000;
export function workerMaximumRunSeconds(worker) {
  return ["csf-class-workbook-refresh", "csf-import-commit"].includes(worker)
    ? 800
    : 600;
}
