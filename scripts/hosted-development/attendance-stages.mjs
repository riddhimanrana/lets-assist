// Hosted attendance failures may name one of these fixed journey phases and
// nothing else. A stage is an outcome code: it carries no message, selector,
// URL, identifier, row, token or attachment.
export const ATTENDANCE_STAGES = Object.freeze([
  "S01_FIXTURE_SETUP",
  "S02_SIGN_IN",
  "S03_RETRY_BATCH",
  "S04_HOURS_PAGE",
  "S05_PRINT_SHEETS",
  "S06_MANUAL_REVIEW",
  "S07_MOBILE_REVIEW",
  "S08_SAVE_ROWS",
  "S09_PUBLISH",
  "S10_EXPORT",
  "S11_ROSTER_RECONCILE",
  "S12_CORRECTION",
  "S13_GUEST_CERTIFICATE",
  "S14_ACCOUNT_LINKING",
  "S15_VOLUNTEER_TOTAL",
  "S16_RUNTIME_ERRORS",
  "S17_CLEANUP",
]);

const FAILURE =
  /^(?:Error: )?Hosted attendance journey failed at ([A-Z0-9_]+) \(ATTENDANCE_JOURNEY_FAILED\)\.$/u;

export function hostedJourneyFailure(stage) {
  if (!ATTENDANCE_STAGES.includes(stage))
    throw new Error("Unknown hosted attendance stage.");
  return `Hosted attendance journey failed at ${stage} (ATTENDANCE_JOURNEY_FAILED).`;
}

// The single known stage named by an exact fixed failure, or null. Any other
// error text, an unknown code or two different stages report no stage.
export function reportedStage(errors) {
  const stages = new Set();
  for (const error of Array.isArray(errors) ? errors : []) {
    const match =
      typeof error?.message === "string" ? FAILURE.exec(error.message) : null;
    if (match && ATTENDANCE_STAGES.includes(match[1])) stages.add(match[1]);
  }
  return stages.size === 1 ? [...stages][0] : null;
}
