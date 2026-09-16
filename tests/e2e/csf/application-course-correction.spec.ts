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

/**
 * Correcting an application's course lines, through the real Applications
 * review panel rather than through the action.
 *
 * The four things an officer actually does — fix a line, drop one, add one,
 * and put the imported lines back — and the one thing a member must not be
 * able to do. Every value here is fictional and belongs to the synthetic
 * chapter fixture.
 */

let admin: SupabaseClient;
let organizationId: string;
let termId: string;
let cohortId: string;
let applicationId: string;
const seededCourseIds = [randomUUID(), randomUUID()];

function checked(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function readCourses() {
  const { data, error } = await admin
    .schema("plugin_data")
    .from("csf_application_course_entries")
    .select("id, course_list, course_name, grade, points, is_bonus, origin")
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .order("course_list")
    .order("course_name");
  checked(error);
  return data ?? [];
}

async function readCorrectionMarker() {
  const { data, error } = await admin
    .schema("plugin_data")
    .from("csf_term_applications")
    .select("courses_corrected_at")
    .eq("organization_id", organizationId)
    .eq("id", applicationId)
    .single();
  checked(error);
  return data?.courses_corrected_at ?? null;
}

async function openApplicationsTab(
  page: Parameters<typeof loginAs>[0],
  actor: Parameters<typeof loginAs>[1],
) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAs(
    page,
    actor,
    `${CSF_ORGANIZATION_PATH}?tab=csf-applications&csf_review_term=${termId}&csf_review_cohort=${cohortId}`,
  );
  await expect(
    page.locator('[data-organization-tabs-hydrated="true"]'),
  ).toBeVisible();
  const tour = page.getByRole("dialog", { name: "Officer workspace tour" });
  if (await tour.isVisible()) {
    await tour.getByRole("button", { name: "Skip tour", exact: true }).click();
    await expect(tour).toBeHidden();
  }
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

  const { data: term, error: termError } = await plugin
    .from("csf_terms")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("code", "S26")
    .single();
  checked(termError);
  termId = term!.id;

  const { data: cohort, error: cohortError } = await plugin
    .from("csf_cohorts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("graduation_year", 2028)
    .single();
  checked(cohortError);
  cohortId = cohort!.id;

  const { data: application, error: applicationError } = await plugin
    .from("csf_term_applications")
    .select("id, application_data")
    .eq("organization_id", organizationId)
    .eq("term_id", termId)
    .eq("most_checked_email", "evan.chen@example.test")
    .single();
  checked(applicationError);
  applicationId = application!.id;

  // Two imported lines and the matching immutable snapshot on the application,
  // so the restore has an original to read back. Written as the import commit
  // would have written them.
  checked(
    (
      await plugin
        .from("csf_application_course_entries")
        .delete()
        .eq("organization_id", organizationId)
        .eq("application_id", applicationId)
    ).error,
  );
  checked(
    (
      await plugin.from("csf_application_course_entries").insert([
        {
          id: seededCourseIds[0],
          organization_id: organizationId,
          application_id: applicationId,
          course_list: "I",
          course_name: "Fictional Seminar",
          grade: "A",
          points: 3,
          is_bonus: false,
          raw_line: "Fictional Seminar, A, 3",
        },
        {
          id: seededCourseIds[1],
          organization_id: organizationId,
          application_id: applicationId,
          course_list: "II",
          course_name: "Applied Fiction",
          grade: "B",
          points: 1,
          is_bonus: false,
          raw_line: "Applied Fiction, B, 1",
        },
      ])
    ).error,
  );
  checked(
    (
      await plugin
        .from("csf_term_applications")
        .update({
          courses_corrected_at: null,
          courses_corrected_by: null,
          application_data: {
            ...(application!.application_data as Record<string, unknown>),
            normalizedImport: {
              ...((application!.application_data as Record<string, unknown>)
                ?.normalizedImport as Record<string, unknown>),
              courses: [
                {
                  courseList: "I",
                  courseName: "Fictional Seminar",
                  grade: "A",
                  points: "3",
                  isBonus: false,
                  rawLine: "Fictional Seminar, A, 3",
                },
                {
                  courseList: "II",
                  courseName: "Applied Fiction",
                  grade: "B",
                  points: "1",
                  isBonus: false,
                  rawLine: "Applied Fiction, B, 1",
                },
              ],
            },
          },
        })
        .eq("organization_id", organizationId)
        .eq("id", applicationId)
    ).error,
  );
});

test("an officer corrects, removes, and adds a course line, then restores the imported ones", async ({
  page,
}) => {
  const failures = watchBrowserFailures(page);
  await openApplicationsTab(page, "admin");

  await page
    .getByRole("button", { name: "Correct course lines", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Correct the course lines",
  });
  await expect(dialog).toBeVisible();
  // The editor reads its own lines when it opens, so the revision it submits
  // belongs to the rows on screen.
  await expect(dialog.getByLabel("Course").first()).toHaveValue(
    "Fictional Seminar",
  );

  // Update: the transcript names the honors section, at a different grade.
  await dialog.getByLabel("Course").first().fill("Fictional Seminar Honors");
  await dialog.getByLabel("Grade").first().selectOption("B");

  // Remove: the second line is not on the transcript at all.
  await dialog.getByRole("button", { name: "Remove Applied Fiction" }).click();

  // Add: a line the form row missed.
  await dialog
    .getByRole("button", { name: "Add a course line", exact: true })
    .click();
  await dialog.getByLabel("Course").last().fill("Civic Lab");
  await dialog.getByLabel("Grade").last().selectOption("P");
  await dialog.getByLabel("Reported points").last().fill("1");

  // A correction without an explanation cannot be submitted.
  await expect(
    dialog.getByRole("button", { name: /^Save \d+ course change/u }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Why these lines are being corrected")
    .fill("Transcript lists the honors section and no Applied Fiction.");

  await dialog
    .getByRole("button", { name: /^Save \d+ course change/u })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(/Eligibility now needs recalculation/u),
  ).toBeVisible();

  const corrected = await readCourses();
  expect(
    corrected.map((course) => [
      course.course_list,
      course.course_name,
      course.grade,
      course.origin,
    ]),
  ).toEqual([
    ["I", "Fictional Seminar Honors", "B", "import"],
    ["III", "Civic Lab", "P", "officer"],
  ]);
  expect(await readCorrectionMarker()).not.toBeNull();

  // The imported source is untouched by the correction, which is what makes
  // the restore below possible.
  const { data: untouched, error: untouchedError } = await admin
    .schema("plugin_data")
    .from("csf_term_applications")
    .select("application_data")
    .eq("organization_id", organizationId)
    .eq("id", applicationId)
    .single();
  checked(untouchedError);
  const snapshotCourses = (
    (untouched!.application_data as Record<string, unknown>)
      .normalizedImport as { courses?: Array<Record<string, unknown>> }
  ).courses;
  expect((snapshotCourses ?? []).map((course) => course.courseName)).toEqual([
    "Fictional Seminar",
    "Applied Fiction",
  ]);

  // A source re-import of this row is held while the correction stands.
  const { error: overwriteError } = await admin
    .schema("plugin_data")
    .from("csf_application_course_entries")
    .delete()
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId);
  expect(overwriteError?.message ?? "").toContain(
    "the source cannot overwrite them",
  );

  await page.reload();
  await page
    .getByRole("button", { name: "Restore imported lines", exact: true })
    .click();
  const restoreDialog = page.getByRole("dialog", {
    name: "Restore the imported course lines",
  });
  await expect(restoreDialog).toBeVisible();
  await restoreDialog
    .getByLabel("Why the corrections are being withdrawn")
    .fill("Registrar confirmed the imported lines were right.");
  await restoreDialog
    .getByRole("button", { name: "Restore imported lines", exact: true })
    .click();
  await expect(restoreDialog).toBeHidden();

  const restored = await readCourses();
  expect(
    restored.map((course) => [course.course_list, course.course_name]),
  ).toEqual([
    ["I", "Fictional Seminar"],
    ["II", "Applied Fiction"],
  ]);
  expect(await readCorrectionMarker()).toBeNull();

  expectNoBrowserFailures(failures);
});

test("a member never reaches the course editor", async ({ page }) => {
  const failures = watchBrowserFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAs(
    page,
    "member",
    `${CSF_ORGANIZATION_PATH}?tab=csf-applications&csf_review_term=${termId}`,
  );
  await expect(
    page.locator('[data-organization-tabs-hydrated="true"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Correct course lines", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Restore imported lines", exact: true }),
  ).toHaveCount(0);
  expectNoBrowserFailures(failures);
});
