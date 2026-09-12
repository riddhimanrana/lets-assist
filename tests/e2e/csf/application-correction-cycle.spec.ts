import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

const applicationId = randomUUID();
const correctionMessage = `The missing course is Fictional Algebra II. ${applicationId}`;
const reviewReason =
  "Verified the corrected fictional course title against the application evidence.";
let admin: SupabaseClient;
let organizationId: string;
let termId: string;
let cohortId: string;
let profileId: string;
let originalPeriod: Record<string, unknown> | null | undefined;
let unrelatedApplications: unknown;
let priorHistory: unknown;
let privileges: unknown;
let createdApplication = false;

function checked(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function application() {
  const { data, error } = await admin
    .schema("plugin_data")
    .from("csf_term_applications")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", applicationId)
    .single();
  checked(error);
  return data!;
}

async function applicationChecks() {
  const { data, error } = await admin
    .schema("plugin_data")
    .from("csf_application_checks")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .order("id");
  checked(error);
  return data!;
}

async function corrections() {
  const { data, error } = await admin
    .schema("plugin_data")
    .from("csf_application_correction_requests")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .order("id");
  checked(error);
  return data!;
}

async function preservedState() {
  const plugin = admin.schema("plugin_data");
  const results = await Promise.all([
    plugin
      .from("csf_term_applications")
      .select("*")
      .eq("organization_id", organizationId)
      .neq("id", applicationId)
      .order("id"),
    plugin
      .from("csf_application_status_events")
      .select("*")
      .eq("organization_id", organizationId)
      .neq("application_id", applicationId)
      .order("id"),
    admin
      .from("organization_members")
      .select("user_id, role, status")
      .eq("organization_id", organizationId)
      .order("user_id"),
  ]);
  results.forEach(({ error }) => checked(error));
  return results.map(({ data }) => data);
}

test.beforeAll(async () => {
  const local = getCsfIsolatedSupabaseEnv();
  admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const plugin = admin.schema("plugin_data");
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .eq("username", "dvhs-csf")
    .single();
  checked(orgError);
  organizationId = org!.id;
  const { data: existing, error: existingError } = await plugin
    .from("csf_term_applications")
    .select("profile_id, cohort_id")
    .eq("organization_id", organizationId)
    .eq("most_checked_email", "evan.chen@example.test")
    .single();
  checked(existingError);
  profileId = existing!.profile_id;
  cohortId = existing!.cohort_id;
  const { data: term, error: termError } = await plugin
    .from("csf_terms")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_current", true)
    .single();
  checked(termError);
  termId = term!.id;
  const { data: current, error: currentError } = await plugin
    .from("csf_term_applications")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("profile_id", profileId)
    .eq("term_id", termId);
  checked(currentError);
  expect(
    current,
    "The journey owns a new current-term application only",
  ).toEqual([]);
  const { data: membership, error: membershipError } = await plugin
    .from("csf_term_memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("profile_id", profileId)
    .eq("term_id", termId);
  checked(membershipError);
  expect(membership).toEqual([]);
  const { data: period, error: periodError } = await plugin
    .from("csf_review_periods")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("term_id", termId)
    .eq("kind", "membership_applications")
    .maybeSingle();
  checked(periodError);
  originalPeriod = period;
  [unrelatedApplications, priorHistory, privileges] = await preservedState();
  checked(
    (
      await plugin.from("csf_term_applications").insert({
        id: applicationId,
        organization_id: organizationId,
        profile_id: profileId,
        cohort_id: cohortId,
        term_id: termId,
        source: "manual",
        status: "needs_review",
        submission_status: "under_review",
        eligibility_status: "pending",
        decision_status: "pending",
        most_checked_email: "application-cycle@example.test",
        current_grade_level: 11,
        submitted_at: new Date().toISOString(),
        application_data: { fixture: "application-correction-cycle" },
      })
    ).error,
  );
  createdApplication = true;
  checked(
    (
      await plugin.from("csf_application_checks").upsert(
        {
          organization_id: organizationId,
          application_id: applicationId,
          check_type: "required_information",
          status: "failed",
          mandatory: true,
          summary: "The fictional course title needs correction.",
        },
        { onConflict: "organization_id,application_id,check_type" },
      )
    ).error,
  );
});

test.afterAll(async () => {
  if (!admin || !createdApplication) return;
  const plugin = admin.schema("plugin_data");
  checked(
    (
      await plugin
        .from("csf_term_memberships")
        .delete()
        .eq("organization_id", organizationId)
        .eq("application_id", applicationId)
    ).error,
  );
  checked(
    (
      await plugin
        .from("csf_review_decisions")
        .delete()
        .eq("organization_id", organizationId)
        .eq("subject_kind", "application")
        .eq("subject_id", applicationId)
    ).error,
  );
  checked(
    (
      await plugin
        .from("csf_term_applications")
        .delete()
        .eq("organization_id", organizationId)
        .eq("id", applicationId)
    ).error,
  );
  if (originalPeriod) {
    checked(
      (
        await plugin
          .from("csf_review_periods")
          .update(originalPeriod)
          .eq("organization_id", organizationId)
          .eq("id", String(originalPeriod.id))
      ).error,
    );
  } else if (originalPeriod === null) {
    checked(
      (
        await plugin
          .from("csf_review_periods")
          .delete()
          .eq("organization_id", organizationId)
          .eq("term_id", termId)
          .eq("kind", "membership_applications")
      ).error,
    );
  }
});

test("member correction stays attached until officer review and a separate application decision", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const memberFailures = watchBrowserFailures(page);
  const initialApplication = await application();
  const initialChecks = await applicationChecks();
  await loginAs(page, "applicant", `${CSF_ORGANIZATION_PATH}?tab=csf-overview`);
  await page.getByRole("tab", { name: "My CSF", exact: true }).click();
  await page
    .getByRole("button", { name: "Submit correction", exact: true })
    .click();
  const correctionDialog = page.getByRole("dialog", {
    name: "Correct application information",
  });
  await correctionDialog
    .getByRole("textbox", { name: "Corrected information" })
    .fill(correctionMessage);
  await correctionDialog
    .getByRole("button", { name: "Submit correction", exact: true })
    .click();
  await expect(correctionDialog).toBeHidden();
  await expect(
    page.getByText("Profile correction under review", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await corrections())[0]?.status)
    .toBe("submitted");
  expect(await application()).toEqual(initialApplication);
  const submittedCorrection = (await corrections())[0];

  const officerContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const officer = await officerContext.newPage();
  const officerFailures = watchBrowserFailures(officer);
  try {
    await loginAs(
      officer,
      "admin",
      `${CSF_ORGANIZATION_PATH}?tab=csf-applications&csf_review_term=${termId}&csf_review_cohort=${cohortId}`,
    );
    await expect(
      officer.locator('[data-organization-tabs-hydrated="true"]'),
    ).toBeVisible();
    const tour = officer.getByRole("dialog", {
      name: "Officer workspace tour",
    });
    if (await tour.isVisible())
      await tour
        .getByRole("button", { name: "Skip tour", exact: true })
        .click();
    for (const name of ["Reopen review", "Open review"]) {
      const open = officer.getByRole("button", { name, exact: true });
      if (await open.isVisible()) await open.click();
    }
    await expect(
      officer.getByRole("button", { name: "Close review", exact: true }),
    ).toBeVisible();
    await officer
      .getByRole("button", { name: "Chen, Evan", exact: true })
      .click();
    const correctionSection = officer.getByRole("region", {
      name: "Student corrections",
    });
    await expect(
      correctionSection.getByText(correctionMessage, { exact: true }),
    ).toBeVisible();
    await correctionSection
      .getByRole("button", { name: "Review correction", exact: true })
      .click();
    const reviewDialog = officer.getByRole("dialog", {
      name: "Review student correction",
    });
    await reviewDialog
      .getByRole("textbox", { name: "Review note" })
      .fill(reviewReason);
    await reviewDialog
      .getByRole("button", { name: "Mark reviewed", exact: true })
      .click();
    await expect(reviewDialog).toBeHidden();
    await expect(
      correctionSection.getByText(reviewReason, { exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await corrections())[0]?.status)
      .toBe("reviewed");
    const reviewedCorrection = (await corrections())[0];
    expect(reviewedCorrection).toMatchObject({
      id: submittedCorrection.id,
      message: correctionMessage,
      review_reason: reviewReason,
      correlation_id: submittedCorrection.correlation_id,
    });
    expect(reviewedCorrection.reviewed_by).toBeTruthy();
    expect(reviewedCorrection.reviewed_at).toBeTruthy();
    expect(await application()).toEqual(initialApplication);
    expect(await applicationChecks()).toEqual(initialChecks);
    await officer.getByRole("button", { name: "Approve", exact: true }).click();
    await expect
      .poll(async () => (await application()).decision_status)
      .toBe("approved");
    const decided = await application();
    expect(await applicationChecks()).toEqual(initialChecks);
    const { data: decisions, error: decisionError } = await admin
      .schema("plugin_data")
      .from("csf_review_decisions")
      .select("decision, decided_by")
      .eq("organization_id", organizationId)
      .eq("subject_id", applicationId)
      .eq("subject_kind", "application");
    checked(decisionError);
    expect(decisions).toEqual([
      { decision: "approved", decided_by: reviewedCorrection.reviewed_by },
    ]);
    const { data: events, error: eventsError } = await admin
      .schema("plugin_data")
      .from("csf_application_status_events")
      .select("next_status, correlation_id")
      .eq("organization_id", organizationId)
      .eq("application_id", applicationId);
    checked(eventsError);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          correlation_id: submittedCorrection.correlation_id,
        }),
        expect.objectContaining({
          next_status: "accepted",
          correlation_id: decided.decision_correlation_id,
        }),
      ]),
    );
    expect(decided).toMatchObject({
      status: "accepted",
      submission_status: "decided",
      profile_id: profileId,
      term_id: termId,
    });
    const { data: membership, error: membershipError } = await admin
      .schema("plugin_data")
      .from("csf_term_memberships")
      .select("application_id, status")
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId)
      .eq("term_id", termId)
      .single();
    checked(membershipError);
    expect(membership).toEqual({
      application_id: applicationId,
      status: "accepted",
    });
    const { data: audits, error: auditError } = await admin
      .schema("plugin_data")
      .from("csf_admin_audit_events")
      .select("action")
      .eq("organization_id", organizationId)
      .eq("correlation_id", submittedCorrection.correlation_id);
    checked(auditError);
    expect(audits!.map((row) => row.action).sort()).toEqual([
      "application.correction_reviewed",
      "application.correction_submitted",
    ]);
    expect(await preservedState()).toEqual([
      unrelatedApplications,
      priorHistory,
      privileges,
    ]);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Submit correction", exact: true }),
    ).toBeVisible();
    expectNoBrowserFailures(memberFailures);
    expectNoBrowserFailures(officerFailures);
  } finally {
    await officerContext.close();
  }
});
