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
let applicantRosterName: string;
let originalCourseRows: Record<string, unknown>[] = [];
let originalApplicationData: unknown;
let originalPeriod: Record<string, unknown> | null | undefined;
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

/**
 * Open the seeded applicant's record the way an officer does: from the roster.
 *
 * The Applications tab lands on the list, so a control that lives inside one
 * application's evidence is not on screen until a row is chosen. The officer
 * opens review first, because that is the state a chapter reviews in.
 */
async function openSeededApplication(page: Parameters<typeof loginAs>[0]) {
  for (const label of ["Reopen review", "Open review"]) {
    const open = page.getByRole("button", { name: label, exact: true });
    if (await open.isVisible()) await open.click();
  }
  await expect(
    page.getByRole("button", { name: "Split for review", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: applicantRosterName, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Back to roster", exact: true }),
  ).toBeVisible();
  // The imported lines this correction is about, rendered from the record.
  await expect(
    page.getByText("Fictional Seminar, A, 3", { exact: true }),
  ).toBeVisible();
}

/**
 * A row's text fields, by role and exact accessible name.
 *
 * Matching on label text alone is not safe here: it matches substrings, and an
 * unnamed new row's remove button is labelled "Remove this course line", which
 * contains the word Course. Asking for a textbox with that exact name cannot
 * resolve to a button at all.
 */
function courseField(
  dialog: ReturnType<Parameters<typeof loginAs>[0]["getByRole"]>,
  name: "Course" | "Reported points",
  row: "first" | "last",
) {
  const fields = dialog.getByRole("textbox", { name, exact: true });
  return row === "first" ? fields.first() : fields.last();
}

/**
 * Choose a value from one of the editor's dropdowns.
 *
 * These are Base UI comboboxes, not native selects: the trigger is a button and
 * the options render in a portal outside the dialog. So the trigger is clicked,
 * the option is taken from the page, and the trigger's displayed value is read
 * back before moving on, which also settles the close animation.
 */
async function chooseCourseOption(
  page: Parameters<typeof loginAs>[0],
  dialog: ReturnType<Parameters<typeof loginAs>[0]["getByRole"]>,
  label: "List" | "Grade",
  row: "first" | "last",
  optionLabel: string,
) {
  const triggers = dialog.getByRole("combobox", { name: label, exact: true });
  const trigger = row === "first" ? triggers.first() : triggers.last();
  await trigger.click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
  await expect(trigger.locator('[data-slot="select-value"]')).toHaveText(
    optionLabel,
  );
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

  const { data: period, error: periodError } = await plugin
    .from("csf_review_periods")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("term_id", termId)
    .eq("kind", "membership_applications")
    .maybeSingle();
  checked(periodError);
  originalPeriod = period;

  const { data: application, error: applicationError } = await plugin
    .from("csf_term_applications")
    .select("id, profile_id, application_data")
    .eq("organization_id", organizationId)
    .eq("term_id", termId)
    .eq("most_checked_email", "evan.chen@example.test")
    .single();
  checked(applicationError);
  applicationId = application!.id;
  originalApplicationData = application!.application_data;

  // The roster labels a record "Last, First"; read the names rather than
  // hard-coding them, so a fixture rename fails loudly instead of silently
  // skipping the journey.
  const { data: profile, error: profileError } = await plugin
    .from("csf_profiles")
    .select("first_name, last_name")
    .eq("organization_id", organizationId)
    .eq("id", application!.profile_id as string)
    .single();
  checked(profileError);
  applicantRosterName = `${profile!.last_name}, ${profile!.first_name}`;

  // Everything below replaces fixture state. Keep the originals so afterAll
  // hands the chapter back exactly what it had.
  const { data: existingCourses, error: existingCoursesError } = await plugin
    .from("csf_application_course_entries")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId);
  checked(existingCoursesError);
  originalCourseRows = existingCourses ?? [];

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
            ...(originalApplicationData as Record<string, unknown>),
            normalizedImport: {
              ...((originalApplicationData as Record<string, unknown>)
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

test.afterAll(async () => {
  if (!admin || !organizationId || !applicationId) return;
  const plugin = admin.schema("plugin_data");

  // The correction marker has to go first: while it stands, the overwrite
  // guard refuses exactly this delete, which is the contract under test.
  checked(
    (
      await plugin
        .from("csf_term_applications")
        .update({
          courses_corrected_at: null,
          courses_corrected_by: null,
          application_data: originalApplicationData,
        })
        .eq("organization_id", organizationId)
        .eq("id", applicationId)
    ).error,
  );
  checked(
    (
      await plugin
        .from("csf_application_course_entries")
        .delete()
        .eq("organization_id", organizationId)
        .eq("application_id", applicationId)
    ).error,
  );
  if (originalCourseRows.length > 0) {
    checked(
      (
        await plugin
          .from("csf_application_course_entries")
          .insert(originalCourseRows)
      ).error,
    );
  }
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

test("an officer corrects, removes, and adds a course line, then restores the imported ones", async ({
  page,
}) => {
  const failures = watchBrowserFailures(page);
  await openApplicationsTab(page, "admin");
  await openSeededApplication(page);

  await page
    .getByRole("button", { name: "Correct course lines", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Correct the course lines",
  });
  await expect(dialog).toBeVisible();
  // The editor reads its own lines when it opens, so the revision it submits
  // belongs to the rows on screen.
  await expect(courseField(dialog, "Course", "first")).toHaveValue(
    "Fictional Seminar",
  );

  // Update: the transcript names the honors section, at a different grade.
  await courseField(dialog, "Course", "first").fill("Fictional Seminar Honors");
  await chooseCourseOption(page, dialog, "Grade", "first", "B");

  // Remove: the second line is not on the transcript at all.
  await dialog
    .getByRole("button", { name: "Remove Applied Fiction", exact: true })
    .click();

  // Add: a line the form row missed.
  await dialog
    .getByRole("button", { name: "Add a course line", exact: true })
    .click();
  // Two rows now: the corrected import line and the empty one just added.
  await expect(
    dialog.getByRole("textbox", { name: "Course", exact: true }),
  ).toHaveCount(2);
  await courseField(dialog, "Course", "last").fill("Civic Lab");
  await chooseCourseOption(page, dialog, "List", "last", "List III");
  await chooseCourseOption(page, dialog, "Grade", "last", "P");
  await courseField(dialog, "Reported points", "last").fill("1");

  // A correction without an explanation cannot be submitted.
  await expect(
    dialog.getByRole("button", { name: /^Save \d+ course change/u }),
  ).toBeDisabled();
  await dialog
    .getByRole("textbox", {
      name: "Why these lines are being corrected",
      exact: true,
    })
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

  // Reloading returns to the roster, so the record is opened again rather
  // than assuming the panel survived.
  await page.reload();
  await openSeededApplication(page);
  await page
    .getByRole("button", { name: "Restore imported lines", exact: true })
    .click();
  const restoreDialog = page.getByRole("dialog", {
    name: "Restore the imported course lines",
  });
  await expect(restoreDialog).toBeVisible();
  await restoreDialog
    .getByRole("textbox", {
      name: "Why the corrections are being withdrawn",
      exact: true,
    })
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

test("a member cannot reach the application review workflow at all", async ({
  page,
}) => {
  const failures = watchBrowserFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAs(
    page,
    "member",
    `${CSF_ORGANIZATION_PATH}?tab=csf-applications&csf_review_term=${termId}&csf_review_cohort=${cohortId}`,
  );
  await expect(
    page.locator('[data-organization-tabs-hydrated="true"]'),
  ).toBeVisible();

  // Not "the editor is closed" — the workflow itself is not reachable. The
  // officer tab is absent, so the roster that opens a record never renders,
  // and neither does any applicant's name or imported course line.
  await expect(
    page.getByRole("tab", { name: "Applications", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: applicantRosterName, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Split for review", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Fictional Seminar, A, 3", { exact: true }),
  ).toHaveCount(0);

  // And the controls this branch adds, for the same reason.
  await expect(
    page.getByRole("button", { name: "Correct course lines", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Restore imported lines", exact: true }),
  ).toHaveCount(0);

  expectNoBrowserFailures(failures);
});
