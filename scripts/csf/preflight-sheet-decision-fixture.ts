/**
 * Drive the Sheets decision fixture against an owned isolated stack, without a
 * browser.
 *
 * The browser suite costs a full build, so every API-level thing the fixture
 * does is proved here first: the source registers, the applicants seed with
 * real import provenance, staging reaches the RPC, a release publishes, a
 * later sync stages a correction for another approval, and two scenarios do not contaminate
 * each other.
 *
 * Refuses anything but a marker-validated CSF isolated stack on loopback,
 * before it opens a connection. Every identity it writes is synthetic and
 * scenario-scoped; it deletes nothing, because sync runs, source and row
 * evidence, and release receipts are immutable by design.
 *
 * Usage:
 *   CSF_ISOLATED_WORK_DIR=<work dir> bun scripts/csf/preflight-sheet-decision-fixture.ts
 */

import { inspectCsfIsolatedWorkDir } from "../local-dev/dv-local-env.mjs";
import {
  loadSheetDecisionFixture,
  publishedState,
  releaseDecisions,
  resetSheetDecisionFixture,
  restoreAppReview,
  stageDecisions,
  termState,
  type SheetApplicants,
  type SheetDecisionFixture,
} from "../../tests/e2e/csf/sheet-decision-fixtures";

let failures = 0;

function check(ok: boolean, title: string, detail?: unknown) {
  if (ok) {
    console.log(`PASS: ${title}`);
    return;
  }
  failures += 1;
  console.log(`FAIL: ${title}`);
  if (detail !== undefined) {
    console.log(`  got: ${JSON.stringify(detail)}`);
  }
}

/** Refuse a stack this preflight does not own, before anything is written. */
function assertOwnedStack() {
  const workDir = process.env.CSF_ISOLATED_WORK_DIR;
  if (!workDir) {
    throw new Error(
      "Set CSF_ISOLATED_WORK_DIR to the work directory the isolated launcher printed.",
    );
  }
  const stack = inspectCsfIsolatedWorkDir(workDir) as {
    projectId?: string;
    runId?: string;
  };
  if (
    !stack.runId ||
    stack.projectId !== `lets-assist-csf-browser-${stack.runId}`
  ) {
    throw new Error(
      `Refusing to run: the marker names project ${String(stack.projectId)}, not an owned CSF browser project.`,
    );
  }
  if (!stack.runId) {
    throw new Error("Refusing to run: the marker carries no run identity.");
  }
  return stack;
}

function assertLoopback(fixture: SheetDecisionFixture) {
  // A second reading of the URL the client is actually holding, so a change to
  // the resolver cannot quietly widen what this writes to.
  const url = new URL(
    (fixture.admin as unknown as { supabaseUrl: string }).supabaseUrl,
  );
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (!loopback || url.port !== "55321") {
    throw new Error(
      `Refusing to run: the Supabase URL ${url.origin} is not loopback :55321.`,
    );
  }
  return url.origin;
}

async function stageThree(
  fixture: SheetDecisionFixture,
  applicants: SheetApplicants,
) {
  return stageDecisions(fixture, [
    {
      applicant: applicants.byRole.accepted,
      status: "accepted",
      observedColor: "#d9ead3",
    },
    {
      applicant: applicants.byRole.rejected,
      status: "rejected",
      observedColor: "#f4cccc",
    },
    {
      applicant: applicants.byRole.explained,
      status: "on_hold",
      observedColor: "#fff2cc",
      reason: "Fictional synthetic reason: transcript page two was unreadable.",
    },
  ]);
}

async function runScenario(fixture: SheetDecisionFixture, name: string) {
  console.log(`\n--- scenario ${name} ---`);
  const applicants = await resetSheetDecisionFixture(fixture, name);

  const imported = applicants.all.filter((a) => a.importRowId !== null);
  check(
    imported.length === 4 && imported.every((a) => a.importRowId !== "pending"),
    `${name}: the preview assigned four import row ids`,
    imported.map((a) => a.importRowId),
  );

  const staged = await stageThree(fixture, applicants);
  check(
    staged.counts.changed === 3 && staged.counts.conflict === 0,
    `${name}: three rows staged with no conflict`,
    staged.counts,
  );

  // Staging is private: nothing is decided and nobody is a member yet.
  for (const role of ["accepted", "rejected", "explained"] as const) {
    const state = await publishedState(fixture, applicants.byRole[role]);
    check(
      state.applicationStatus === "submitted" &&
        state.membershipStatus === null,
      `${name}: ${role} is unpublished before release`,
      state,
    );
  }

  const released = await releaseDecisions(fixture);
  check(
    released.accepted === 1 && released.rejected === 1 && released.pending >= 1,
    `${name}: release published one acceptance and one rejection, leaving the hold pending`,
    {
      accepted: released.accepted,
      rejected: released.rejected,
      held: released.heldCount,
    },
  );

  const held = await publishedState(fixture, applicants.byRole.explained);
  check(
    held.applicationStatus === "submitted" && held.membershipStatus === null,
    `${name}: yellow remains undecided without membership`,
    held,
  );

  const accepted = await publishedState(fixture, applicants.byRole.accepted);
  check(
    accepted.applicationStatus === "accepted" &&
      accepted.membershipStatus === "accepted",
    `${name}: the accepted applicant is a member`,
    accepted,
  );

  // A later Sheet change stays private until an officer approves its release.
  const corrected = await stageDecisions(fixture, [
    {
      applicant: applicants.byRole.accepted,
      status: "rejected",
      observedColor: "#f4cccc",
    },
  ]);
  check(
    corrected.counts.appliedToReleased === 0 &&
      corrected.counts.retractedFromRelease === 0,
    `${name}: sync staged the correction without changing the released decision`,
    corrected.counts,
  );

  const beforeCorrectionRelease = await publishedState(
    fixture,
    applicants.byRole.accepted,
  );
  check(
    beforeCorrectionRelease.applicationStatus === "accepted" &&
      beforeCorrectionRelease.membershipStatus === "accepted",
    `${name}: sync preserves the approved membership`,
    beforeCorrectionRelease,
  );
  const correctionRelease = await releaseDecisions(fixture);
  check(
    correctionRelease.rejected === 1,
    `${name}: the officer releases the correction`,
    correctionRelease,
  );

  const revoked = await publishedState(fixture, applicants.byRole.accepted);
  check(
    revoked.applicationStatus === "rejected" &&
      revoked.membershipStatus === "revoked",
    `${name}: the corrected applicant lost membership`,
    revoked,
  );

  return applicants;
}

async function main() {
  const stack = assertOwnedStack();
  console.log(
    `Owned stack ${stack.projectId} (run ${stack.runId}) validated from the marker.`,
  );

  const fixture = await loadSheetDecisionFixture();
  const origin = assertLoopback(fixture);
  console.log(`Supabase ${origin}, semester ${fixture.termCode}.`);

  try {
    const first = await runScenario(fixture, "preflight one");
    const second = await runScenario(fixture, "preflight two");

    console.log("\n--- isolation ---");
    const sharedIds = first.all
      .map((a) => a.applicationId)
      .filter((id) => second.all.some((b) => b.applicationId === id));
    check(
      sharedIds.length === 0,
      "the two scenarios share no application identity",
      sharedIds,
    );
    check(
      first.token !== second.token,
      "the two scenarios carry different roster labels",
      { first: first.token, second: second.token },
    );

    // The first scenario's published outcomes are untouched by the second.
    const firstRejected = await publishedState(fixture, first.byRole.rejected);
    check(
      firstRejected.applicationStatus === "rejected",
      "the first scenario's published rejection survived the second scenario",
      firstRejected,
    );

    const state = await termState(fixture);
    console.log(
      `Term counters after both scenarios: released ${state.counts.released}, releaseCount ${state.releaseCount}.`,
    );
  } finally {
    await restoreAppReview(fixture);
    console.log("\nReview source restored to the in-app path.");
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
