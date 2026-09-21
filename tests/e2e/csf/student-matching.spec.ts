import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { inspectCsfIsolatedWorkDir } from "../../../scripts/local-dev/dv-local-env.mjs";
import { CSF_ORGANIZATION_PATH, loginAs } from "./helpers";

for (const width of [1280, 390]) {
  test(`student matching uses one searchable picker at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const isolated = inspectCsfIsolatedWorkDir(
      process.env.CSF_ISOLATED_WORK_DIR,
    );
    const sql = (query: string) =>
      execFileSync(
        "docker",
        [
          "exec",
          "-i",
          `supabase_db_${isolated.projectId}`,
          "psql",
          "-X",
          "-qAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "postgres",
        ],
        { input: query, encoding: "utf8" },
      ).trim();
    const org = sql(
      "SELECT id FROM public.organizations WHERE username='dvhs-csf';",
    );
    const cohort = sql(
      `SELECT id FROM plugin_data.csf_cohorts WHERE organization_id='${org}' AND graduation_year=2028 LIMIT 1;`,
    );
    for (const id of [org, cohort]) expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    const job = randomUUID();
    const row = randomUUID();
    const profile = randomUUID();
    const homonym = randomUUID();
    const lastName = `Fixture${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const name = `Zora ${lastName}`;
    const insertProfile = (id: string, email: string) =>
      sql(`
      INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,personal_email,normalized_personal_email)
      VALUES ('${id}','${org}','Zora','${lastName}','zora','${lastName.toLowerCase()}','${email}','${email}');
      INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id,status)
      VALUES ('${org}','${id}','${cohort}','active');`);
    const href = `${CSF_ORGANIZATION_PATH}?tab=csf-applications&csf_import_type=application_responses&csf_import_preview=${job}`;
    try {
      insertProfile(profile, `${profile}@local.test`);
      sql(`INSERT INTO plugin_data.csf_sheet_import_jobs(id,organization_id,mode,status,source_type,source_file_name)
        VALUES ('${job}','${org}','preview','needs_resolution','application_responses','Fictional student matching');
        INSERT INTO plugin_data.csf_sheet_import_rows(id,organization_id,job_id,cohort_id,sheet_tab_name,row_number,import_status,normalized_data)
        VALUES ('${row}','${org}','${job}','${cohort}','Responses',2,'ambiguous',
          jsonb_build_object('record',jsonb_build_object('identity',jsonb_build_object('firstName','Zora','lastName','${lastName}','normalizedFirstName','zora','normalizedLastName','${lastName.toLowerCase()}'))));`);
      await loginAs(page, "admin", href);
      const tour = page.getByRole("button", { name: "Skip tour", exact: true });
      if (await tour.isVisible()) await tour.click();
      const dialog = page.getByRole("dialog", { name: "Match students" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Decide these yourself")).toHaveCount(0);
      await expect(
        dialog.getByText("Saved sources", { exact: true }),
      ).toHaveCount(0);
      const picker = dialog.getByRole("button", {
        name: "Student",
        exact: true,
      });
      let failSearch = true;
      await page.route("**/organization/dvhs-csf**", async (route) => {
        if (
          failSearch &&
          route.request().method() === "POST" &&
          route.request().postData()?.includes(lastName)
        ) {
          failSearch = false;
          await route.abort("failed");
        } else await route.continue();
      });
      await picker.click();
      const search = page.getByRole("combobox", { name: "Search students" });
      await expect(search).toBeFocused();
      await expect(search).toHaveValue(name);
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "Search failed. Try again." }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      const candidate = page.getByRole("option", { name: new RegExp(profile) });
      await expect(candidate).toContainText("Class of 2028");
      await page.screenshot({
        path: testInfo.outputPath(`student-picker-${width}.png`),
      });
      await search.press("ArrowDown");
      await search.press("Enter");
      await expect(search).toHaveCount(0);
      await expect(
        dialog.getByLabel("How did you identify this student?"),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole("button", { name: "Match", exact: true }),
      ).toBeEnabled();
      // Selecting a result does not submit the matching form.
      expect(
        sql(
          `SELECT import_status FROM plugin_data.csf_sheet_import_rows WHERE id='${row}';`,
        ),
      ).toBe("ambiguous");

      // A new same-name profile invalidates the routine selection at submit time.
      insertProfile(homonym, `${homonym}@local.test`);
      await dialog.getByRole("button", { name: "Match", exact: true }).click();
      const note = dialog.getByLabel("How did you identify this student?");
      await expect(note).toBeVisible();
      await note.fill(
        "The officer checked this fictional student's email and class.",
      );
      await expect(note).toBeVisible();
      expect(
        sql(
          `SELECT import_status FROM plugin_data.csf_sheet_import_rows WHERE id='${row}';`,
        ),
      ).toBe("ambiguous");
      await picker.click();
      await expect(
        page.getByRole("option", { name: new RegExp(profile) }),
      ).toBeVisible();
      await expect(
        page.getByRole("option", { name: new RegExp(homonym) }),
      ).toBeVisible();
      await page.getByRole("option", { name: new RegExp(profile) }).click();
      await expect(note).toBeVisible();
      await note.fill(
        "Verified the fictional email and class with the application.",
      );
      await dialog.getByRole("button", { name: "Match", exact: true }).click();
      await expect
        .poll(() =>
          sql(
            `SELECT import_status || ':' || matched_profile_id FROM plugin_data.csf_sheet_import_rows WHERE id='${row}';`,
          ),
        )
        .toBe(`pending:${profile}`);
      await expect(
        dialog.getByRole("heading", { name: "1 to match" }),
      ).toHaveCount(0);
      expect(
        sql(
          `SELECT count(*) FROM plugin_data.csf_profile_accounts WHERE profile_id IN ('${profile}','${homonym}');`,
        ),
      ).toBe("0");
      expect(
        sql(
          `SELECT count(*) FROM plugin_data.csf_term_applications WHERE profile_id IN ('${profile}','${homonym}');`,
        ),
      ).toBe("0");
      const newRow = randomUUID();
      const otherClass = sql(
        `SELECT id FROM plugin_data.csf_cohorts WHERE organization_id='${org}' AND graduation_year=2027 LIMIT 1;`,
      );
      expect(otherClass).toMatch(/^[0-9a-f-]{36}$/i);
      sql(`INSERT INTO plugin_data.csf_sheet_import_rows(id,organization_id,job_id,cohort_id,sheet_tab_name,row_number,import_status,normalized_data)
        VALUES ('${newRow}','${org}','${job}','${otherClass}','Responses',3,'conflict',
          jsonb_build_object('record',jsonb_build_object('identity',jsonb_build_object('firstName','Zora','lastName','${lastName}'),
          'contact',jsonb_build_object('responseEmail','different-student@local.test'))));`);
      await page.reload();
      await expect(
        dialog.getByRole("heading", { name: "1 to match" }),
      ).toBeVisible();
      await dialog.getByText("Add a new student", { exact: true }).click();
      await dialog
        .getByLabel("Why add a new student?")
        .fill(
          "Confirmed a different student in Class of 2027 with a distinct application email.",
        );
      await dialog
        .getByRole("button", { name: "Create unclaimed profile", exact: true })
        .click();
      await expect
        .poll(() =>
          sql(
            `SELECT import_status FROM plugin_data.csf_sheet_import_rows WHERE id='${newRow}';`,
          ),
        )
        .toBe("pending");
      const newProfile = sql(
        `SELECT matched_profile_id FROM plugin_data.csf_sheet_import_rows WHERE id='${newRow}';`,
      );
      expect(newProfile).not.toBe(profile);
      expect(newProfile).not.toBe(homonym);
      expect(
        sql(
          `SELECT count(*) FROM plugin_data.csf_profile_accounts WHERE profile_id='${newProfile}';`,
        ),
      ).toBe("0");
      expect(
        await page.evaluate(
          () => document.body.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    } finally {
      sql(`DELETE FROM plugin_data.csf_sheet_import_rows WHERE job_id='${job}';
        DELETE FROM plugin_data.csf_sheet_import_jobs WHERE id='${job}';
        DELETE FROM plugin_data.csf_profile_cohort_memberships WHERE profile_id IN (SELECT id FROM plugin_data.csf_profiles WHERE organization_id='${org}' AND last_name='${lastName}');
        DELETE FROM plugin_data.csf_profiles WHERE organization_id='${org}' AND last_name='${lastName}';`);
    }
  });
}
