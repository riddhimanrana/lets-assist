import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  getCsfIsolatedSupabaseEnv,
  inspectCsfIsolatedWorkDir,
} from "../../../scripts/local-dev/dv-local-env.mjs";
import { CSF_ORGANIZATION_PATH, loginAs } from "./helpers";

test("saved application previews keep their own rows through navigation and reload", async ({
  page,
}) => {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .eq("username", "dvhs-csf")
    .single();
  if (orgError || !org)
    throw new Error("The isolated CSF organization is missing.");
  const isolated = inspectCsfIsolatedWorkDir(process.env.CSF_ISOLATED_WORK_DIR);
  const sql = (query: string) =>
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        `supabase_db_${isolated.projectId}`,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
      { input: query, encoding: "utf8" },
    );
  if (!/^[0-9a-f-]{36}$/i.test(org.id))
    throw new Error("Invalid fixture organization ID.");
  const olderId = randomUUID();
  const newerId = randomUUID();
  const ids = [olderId, newerId];
  const sourceId = randomUUID();
  const historyIds = Array.from({ length: 10 }, () => randomUUID());
  const marker = randomUUID().slice(0, 8);
  const names = [
    `Fictional Spring preview ${marker}`,
    `Fictional Fall preview ${marker}`,
  ];
  const base = `${CSF_ORGANIZATION_PATH}?tab=csf-applications&csf_import_type=application_responses`;
  const sourceTitle = `Fictional application source ${marker}`;
  try {
    sql(`INSERT INTO plugin_data.csf_sheet_sources (id, organization_id, title, provider, source_type, sync_mode)
      VALUES ('${sourceId}', '${org.id}', '${sourceTitle}', 'uploaded_xlsx', 'application_responses', 'disabled');`);
    for (const [index, id] of ids.entries()) {
      sql(`BEGIN;
        INSERT INTO plugin_data.csf_sheet_import_jobs
          (id, organization_id, source_id, mode, status, source_type, source_file_name, source_sheet_tab, source_range, created_at)
        VALUES ('${id}', '${org.id}', '${sourceId}', 'preview', 'needs_resolution', 'application_responses', '${names[index]}', 'Responses', 'A1:B52', now() + interval '${index} second');
        INSERT INTO plugin_data.csf_sheet_import_rows
          (organization_id, job_id, sheet_tab_name, row_number, import_status, normalized_data)
        SELECT '${org.id}', '${id}', 'Responses', n + 1, 'ambiguous',
          jsonb_build_object('record', jsonb_build_object('identity', jsonb_build_object('firstName', '${index === 0 ? "SpringFixture" : "FallFixture"}', 'lastName', 'Row' || n)))
        FROM generate_series(1, ${index === 0 ? 51 : 1}) n;
        COMMIT;`);
    }
    await loginAs(page, "admin", base);
    await expect(
      page.locator('[data-organization-tabs-hydrated="true"]'),
    ).toHaveCount(1);
    const skip = page.getByRole("button", { name: "Skip tour", exact: true });
    if (await skip.isVisible()) await skip.click();
    const previews = page.getByRole("navigation", {
      name: "Saved import previews",
    });
    await expect(
      previews.getByRole("link", { name: new RegExp(names[1]) }),
    ).toHaveAttribute("aria-current", "page");
    await previews.getByRole("link", { name: new RegExp(names[0]) }).click();
    await expect(page).toHaveURL(new RegExp(`csf_import_preview=${olderId}`));
    await expect(
      page.getByRole("heading", { name: "Resolve 51 rows", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next rows", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`csf_import_preview=${olderId}`));
    await expect(
      page.getByText("SpringFixture Row51", { exact: true }).first(),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("SpringFixture Row51", { exact: true }).first(),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Saved import previews" })
      .getByRole("link", { name: new RegExp(names[1]) })
      .click();
    await expect(page).toHaveURL(new RegExp(`csf_import_preview=${newerId}`));
    expect(new URL(page.url()).searchParams.has("csf_import_cursor")).toBe(
      false,
    );
    await expect(
      page.getByRole("heading", { name: "Resolve 1 row", exact: true }),
    ).toBeVisible();
    for (const id of historyIds) {
      sql(`INSERT INTO plugin_data.csf_sheet_import_jobs
        (id, organization_id, source_id, mode, status, source_type, source_file_name, created_at)
        VALUES ('${id}', '${org.id}', '${sourceId}', 'preview', 'needs_resolution', 'application_responses', 'Fictional history ${marker}', now() + interval '10 seconds');`);
    }
    await page.goto(base);
    await expect(
      page
        .getByRole("navigation", { name: "Saved import previews" })
        .locator(`a[href*="${olderId}"]`),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /^Saved sources/ }).click();
    const source = page
      .getByText(sourceTitle, { exact: true })
      .locator("..")
      .locator("..")
      .locator("..");
    await source.getByRole("button", { name: "History", exact: true }).click();
    await page.locator(`a[href*="${olderId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`csf_import_preview=${olderId}`));
    await expect(
      page.getByRole("heading", { name: "Resolve 51 rows", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Resolve 51 rows", exact: true }),
    ).toBeVisible();
    await page.goto(`${base}&csf_import_preview=${randomUUID()}`);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "That saved preview is unavailable." }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /^Resolve \d+ rows?$/ }),
    ).toHaveCount(0);
  } finally {
    sql(`BEGIN;
      DELETE FROM plugin_data.csf_sheet_import_rows WHERE organization_id='${org.id}' AND job_id IN ('${olderId}', '${newerId}');
      DELETE FROM plugin_data.csf_sheet_import_jobs WHERE organization_id='${org.id}' AND id IN (${[...ids, ...historyIds].map((id) => `'${id}'`).join(",")});
      DELETE FROM plugin_data.csf_sheet_sources WHERE organization_id='${org.id}' AND id='${sourceId}';
      COMMIT;`);
  }
});
