import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AnonymousSignupWaiverError } from "@/lib/projects/signup-capacity";

const page = readFileSync(
  join(process.cwd(), "app/anonymous/[id]/confirm/page.tsx"),
  "utf8",
);
const confirmation = page.slice(
  page.indexOf("await confirmAnonymousSignupWithCapacity(anonymousSignupId)"),
  page.indexOf("// Revalidate relevant paths"),
);

test("a waiver refusal shows its own sentence instead of a database error", () => {
  const waiverBranch = confirmation.indexOf(
    "confirmation.error instanceof AnonymousSignupWaiverError",
  );
  const databaseBranch = confirmation.indexOf(
    "Database error confirming signup.",
  );

  expect(waiverBranch).toBeGreaterThan(0);
  expect(databaseBranch).toBeGreaterThan(waiverBranch);
  expect(confirmation.slice(waiverBranch, databaseBranch)).toMatch(
    /return \{ status: "error", message: confirmation\.error\.message \};/u,
  );
});

test("a waiver refusal returns before any outcome is read as a success", () => {
  const waiverBranch = confirmation.indexOf(
    "confirmation.error instanceof AnonymousSignupWaiverError",
  );
  const firstOutcomeRead = confirmation.indexOf("confirmation.data.outcome");

  expect(firstOutcomeRead).toBeGreaterThan(waiverBranch);
  expect(confirmation).toMatch(
    /confirmation\.data\.outcome !== "confirmed" &&\s+confirmation\.data\.outcome !== "already_confirmed"/u,
  );
});

test("the sentences are fixed, say nothing was confirmed, and say what to do", () => {
  const invalid = new AnonymousSignupWaiverError("waiver_evidence_invalid");
  expect(invalid.message).toBe(
    "Your signup was not confirmed. The signed waiver on file cannot be placed on this project's waiver document. Ask the organizer to correct the waiver, then sign it again to finish signing up.",
  );

  for (const code of [
    "pending_signups_changed",
    "waiver_check_failed",
  ] as const) {
    const message = new AnonymousSignupWaiverError(code).message;
    expect(message).toMatch(/nothing was confirmed/u);
    expect(message).toMatch(/retry/u);
    expect(message).not.toMatch(/organizer/u);
  }
});
