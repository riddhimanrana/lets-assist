import { randomUUID } from "node:crypto";

import { expect, test, type Request } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  localActors,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

type HistoricalImportFixture = {
  admin: SupabaseClient;
  adminUserId: string;
  organizationId: string;
  profileId: string;
  cohortId: string;
  termId: string;
  runToken: string;
  workbookName: string;
  activityTitle: string;
  sourceId?: string;
  previewJobId?: string;
  importRowId?: string;
};

function assertNoSupabaseError(
  operation: string,
  error: { message: string } | null,
) {
  if (error) throw new Error(`${operation}: ${error.message}`);
}

function createHistoricalWorkbook(activityTitle: string) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Last", "First", "Activity 1"],
    ["Mehta", "Aarav", `2 pts: ${activityTitle}`],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "S26");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

function hasSubmittedJobId(request: Request, previewJobId: string) {
  const body = request.postDataBuffer()?.toString("utf8");
  if (!body) return false;

  const escapedJobId = previewJobId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const multipartJobId = new RegExp(
    `name="jobId"[^\\r\\n]*\\r?\\n(?:[^\\r\\n]*\\r?\\n)*\\r?\\n${escapedJobId}(?=\\r?\\n)`,
  );
  const urlEncodedJobId = new RegExp(
    `(?:^|[&\\r\\n])jobId=${encodeURIComponent(previewJobId)}(?:[&\\r\\n]|$)`,
  );
  return multipartJobId.test(body) || urlEncodedJobId.test(body);
}

function isPreviewCommitServerAction(
  request: Request,
  origin: string,
  previewJobId: string,
) {
  const headers = request.headers();
  return (
    request.method() === "POST" &&
    new URL(request.url()).origin === origin &&
    Boolean(headers["next-action"]) &&
    Boolean(headers["content-type"]) &&
    hasSubmittedJobId(request, previewJobId)
  );
}

function replayableServerActionHeaders(headers: Record<string, string>) {
  const browserOwnedHeaders = new Set([
    "cookie",
    "host",
    "content-length",
    "connection",
    "accept-encoding",
  ]);
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !browserOwnedHeaders.has(name.toLowerCase()),
    ),
  );
}

async function countWholePreviewBlockers(
  fixture: HistoricalImportFixture,
  previewJobId: string,
) {
  const { count, error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_sheet_import_rows")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", fixture.organizationId)
    .eq("job_id", previewJobId)
    .in("import_status", ["ambiguous", "conflict", "duplicate", "error"]);
  assertNoSupabaseError("Could not count whole-preview import blockers", error);
  return count ?? 0;
}

async function loadFixture(): Promise<HistoricalImportFixture> {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const plugin = admin.schema("plugin_data");
  const runToken = randomUUID().slice(0, 8);
  const activityTitle = `Historical acceptance ${runToken}`;
  const workbookName = `historical-student-records-${runToken}.xlsx`;

  const [
    { data: organization, error: organizationError },
    { data: profile, error: profileError },
    { data: cohort, error: cohortError },
    { data: term, error: termError },
    usersResult,
  ] = await Promise.all([
    admin
      .from("organizations")
      .select("id")
      .eq("username", "dvhs-csf")
      .single(),
    plugin
      .from("csf_profiles")
      .select("id")
      .eq("normalized_school_email", localActors.member.email)
      .single(),
    plugin
      .from("csf_cohorts")
      .select("id")
      .eq("graduation_year", 2028)
      .single(),
    plugin.from("csf_terms").select("id").eq("code", "S26").single(),
    admin.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
  ]);
  assertNoSupabaseError(
    "Could not load the local DVHS CSF organization",
    organizationError,
  );
  assertNoSupabaseError(
    "Could not load Aarav Mehta's fixture profile",
    profileError,
  );
  assertNoSupabaseError(
    "Could not load the Class of 2028 fixture",
    cohortError,
  );
  assertNoSupabaseError("Could not load the Spring 2026 fixture", termError);
  if (usersResult.error) {
    throw new Error(
      `Could not load local auth fixtures: ${usersResult.error.message}`,
    );
  }
  const adminUser = usersResult.data.users.find(
    (user) => user.email === localActors.admin.email,
  );
  if (!organization || !profile || !cohort || !term || !adminUser) {
    throw new Error(
      "The isolated CSF historical-import fixture is incomplete.",
    );
  }
  return {
    admin,
    adminUserId: adminUser.id,
    organizationId: organization.id,
    profileId: profile.id,
    cohortId: cohort.id,
    termId: term.id,
    runToken,
    workbookName,
    activityTitle,
  };
}

async function cleanFixture(fixture: HistoricalImportFixture) {
  if (!fixture.sourceId) return;
  const plugin = fixture.admin.schema("plugin_data");
  const sourceReference = {
    processor: "class_history_import",
    sourceId: fixture.sourceId,
  };

  // Import previews, sources, attempts, and their audit receipts are immutable
  // recovery evidence. This test removes only mutable, marker-scoped historical
  // credit projections; it never deletes or changes the seeded Aarav profile.
  const [{ error: activityError }, { error: creditError }] = await Promise.all([
    plugin
      .from("csf_profile_activity_events")
      .delete()
      .eq("organization_id", fixture.organizationId)
      .eq("profile_id", fixture.profileId)
      .eq("term_id", fixture.termId)
      .contains("source_ref", sourceReference),
    plugin
      .from("csf_credit_records")
      .delete()
      .eq("organization_id", fixture.organizationId)
      .eq("profile_id", fixture.profileId)
      .eq("term_id", fixture.termId)
      .contains("evidence", sourceReference),
  ]);
  assertNoSupabaseError(
    "Could not remove the synthetic historical activity projection",
    activityError,
  );
  assertNoSupabaseError(
    "Could not remove the synthetic historical credit projection",
    creditError,
  );
}

/**
 * Catches production regressions where uploaded workbook parsing/normalization
 * loses a source row, reconciliation does not bind the canonical profile, or
 * commit drops source lineage / fails to materialize historical credit.
 */
test.describe("CSF historical workbook import", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: HistoricalImportFixture;

  test.beforeAll(async () => {
    fixture = await loadFixture();
  });

  test.afterAll(async () => {
    if (fixture) await cleanFixture(fixture);
  });

  test("previews, reconciles, and commits one historical workbook row", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    const workbook = createHistoricalWorkbook(fixture.activityTitle);
    expect(workbook.byteLength).toBeGreaterThan(0);

    await loginAs(page, "admin", `${CSF_ORGANIZATION_PATH}?tab=csf-imports`);
    await page.getByRole("button", { name: /Upload Excel or CSV/ }).click();
    await page
      .getByRole("button", { name: "Historical records", exact: true })
      .click();
    await page.getByLabel("Workbook").setInputFiles({
      name: fixture.workbookName,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: workbook,
    });
    await page
      .getByRole("button", { name: "Inspect workbook", exact: true })
      .click();

    await expect(
      page.getByRole("heading", { name: `${fixture.workbookName} · S26` }),
    ).toBeVisible();
    await expect(page.getByText("2 rows", { exact: false })).toBeVisible();

    await page.getByRole("combobox", { name: "Graduating class" }).click();
    await page
      .getByRole("option", { name: "Class of 2028", exact: true })
      .click();
    await page.getByRole("combobox", { name: "Semester" }).click();
    await page
      .getByRole("option", { name: "Spring 2026", exact: true })
      .click();
    await page.getByRole("combobox", { name: "Workbook tab" }).click();
    await page
      .getByRole("option", { name: "S26 · 2 rows", exact: true })
      .click();
    await page.getByLabel("Header row").fill("1");

    await page.getByRole("combobox", { name: "First name" }).click();
    await page.getByRole("option", { name: "First", exact: true }).click();
    await page.getByRole("combobox", { name: "Last name" }).click();
    await page.getByRole("option", { name: "Last", exact: true }).click();
    for (const label of [
      "School email",
      "Personal email",
      "Completion status",
    ]) {
      await page.getByRole("combobox", { name: label }).click();
      await page
        .getByRole("option", { name: "Not mapped", exact: true })
        .click();
    }
    await page
      .getByRole("button", { name: "Preview normalized rows", exact: true })
      .click();

    const progress = page.getByRole("navigation", { name: "Import progress" });
    await expect(progress).toContainText(
      "SourceScopeMapPreviewReconcileCommitResult",
    );
    await expect(progress.getByRole("listitem")).toHaveCount(7);
    await expect(progress.getByRole("button")).toHaveCount(0);
    await expect(progress.getByRole("link")).toHaveCount(0);
    await expect(progress.locator('[aria-current="step"]')).toHaveText(
      "Reconcile",
    );
    await expect(
      page.getByRole("heading", { name: "Preview needs reconciliation" }),
    ).toBeVisible();
    await expect(
      page.getByText(fixture.workbookName, { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText(`${fixture.workbookName} · S26 · A1:C2`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("1 normalized row", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Needs review", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Verify source and commit",
        exact: true,
      }),
    ).toBeDisabled();

    const plugin = fixture.admin.schema("plugin_data");
    const { data: preview, error: previewError } = await plugin
      .from("csf_sheet_import_jobs")
      .select(
        "id, source_id, status, source_type, source_file_name, source_sheet_tab, source_range, source_content_hash, snapshot_hash, snapshot_row_count, mapping_version",
      )
      .eq("organization_id", fixture.organizationId)
      .eq("mode", "preview")
      .eq("source_file_name", fixture.workbookName)
      .single();
    assertNoSupabaseError(
      "Could not load the historical preview",
      previewError,
    );
    if (!preview?.source_id)
      throw new Error("The historical preview has no source.");
    fixture.sourceId = preview.source_id;
    fixture.previewJobId = preview.id;
    expect(preview).toMatchObject({
      status: "needs_resolution",
      source_type: "class_history",
      source_file_name: fixture.workbookName,
      source_sheet_tab: "S26",
      source_range: "A1:C2",
      snapshot_row_count: 1,
      mapping_version: 1,
    });
    expect(preview.source_content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.snapshot_hash).toMatch(/^[a-f0-9]{64}$/);
    await expect
      .poll(() => countWholePreviewBlockers(fixture, preview.id))
      .toBe(1);

    const { data: previewRow, error: previewRowError } = await plugin
      .from("csf_sheet_import_rows")
      .select("id, import_status, matched_profile_id, resolution_status")
      .eq("organization_id", fixture.organizationId)
      .eq("job_id", preview.id)
      .single();
    assertNoSupabaseError(
      "Could not load the unresolved historical preview row",
      previewRowError,
    );
    if (!previewRow) throw new Error("The historical preview row is missing.");
    fixture.importRowId = previewRow.id;
    expect(previewRow).toMatchObject({
      import_status: "ambiguous",
      matched_profile_id: null,
    });

    const sourceReference = {
      processor: "class_history_import",
      sourceId: fixture.sourceId,
    };
    const [{ count: creditCount }, { count: activityCount }] =
      await Promise.all([
        plugin
          .from("csf_credit_records")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", fixture.organizationId)
          .eq("profile_id", fixture.profileId)
          .contains("evidence", sourceReference),
        plugin
          .from("csf_profile_activity_events")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", fixture.organizationId)
          .eq("profile_id", fixture.profileId)
          .contains("source_ref", sourceReference),
      ]);
    expect(creditCount).toBe(0);
    expect(activityCount).toBe(0);

    const resolution = page
      .getByRole("region", { name: /Resolve 1 row/ })
      .getByText("Aarav Mehta", { exact: true })
      .locator("..")
      .locator("..");
    await expect(resolution).toBeVisible();
    await resolution.getByLabel("Match to member").selectOption({
      label: `Aarav Mehta · ${localActors.member.email}`,
    });
    await resolution
      .getByLabel("Match reason")
      .fill(
        "Seeded Class of 2028 record matches this historical workbook row.",
      );
    const useMatch = resolution.getByRole("button", {
      name: "Use match",
      exact: true,
    });
    const matchForm = resolution.locator("form");
    const matchTarget = resolution.getByLabel("Match to member");
    const matchReason = resolution.getByLabel("Match reason");
    await Promise.all([
      expect(matchForm).toHaveAttribute("aria-busy", "true"),
      useMatch.click(),
    ]);
    await expect(useMatch).toBeDisabled();
    await expect(matchTarget).toBeDisabled();
    await expect(matchReason).toBeDisabled();
    await expect(matchTarget).toHaveValue(fixture.profileId);
    await expect(matchReason).toHaveValue(
      "Seeded Class of 2028 record matches this historical workbook row.",
    );
    await expect(
      page.getByText("Import row matched and ready.", { exact: true }),
    ).toBeVisible();
    await expect(matchForm).toHaveAttribute("aria-busy", "false");
    await expect(matchTarget).toHaveValue("");
    await expect(matchReason).toHaveValue("");

    await expect
      .poll(async () => {
        const { data, error } = await plugin
          .from("csf_sheet_import_rows")
          .select(
            "import_status, matched_profile_id, resolution_status, resolution_notes",
          )
          .eq("organization_id", fixture.organizationId)
          .eq("id", fixture.importRowId!)
          .single();
        assertNoSupabaseError("Could not read the resolved import row", error);
        return data;
      })
      .toMatchObject({
        import_status: "pending",
        matched_profile_id: fixture.profileId,
        resolution_status: "resolved",
      });
    await expect
      .poll(() => countWholePreviewBlockers(fixture, preview.id))
      .toBe(0);
    await expect(progress.locator('[aria-current="step"]')).toHaveText(
      "Commit",
    );

    const commit = page.getByRole("button", {
      name: "Verify source and commit",
      exact: true,
    });
    await expect(commit).toBeEnabled();
    const initialCommitRequest = page.waitForRequest((request) =>
      isPreviewCommitServerAction(
        request,
        new URL(page.url()).origin,
        preview.id,
      ),
    );
    const initialCommitResponse = page.waitForResponse((response) =>
      isPreviewCommitServerAction(
        response.request(),
        new URL(page.url()).origin,
        preview.id,
      ),
    );
    await commit.click();
    const [capturedCommitRequest, capturedCommitResponse] = await Promise.all([
      initialCommitRequest,
      initialCommitResponse,
    ]);
    expect(capturedCommitResponse.request()).toBe(capturedCommitRequest);
    expect(capturedCommitResponse.status()).toBe(200);
    expect(capturedCommitResponse.ok()).toBeTruthy();
    const capturedCommitBody = capturedCommitRequest.postDataBuffer();
    if (!capturedCommitBody?.byteLength) {
      throw new Error("The commit Server Action request did not carry a body.");
    }
    const capturedCommitHeaders = capturedCommitRequest.headers();
    const replayHeaders = replayableServerActionHeaders(capturedCommitHeaders);
    if (
      !replayHeaders["next-action"] ||
      !replayHeaders["content-type"] ||
      !replayHeaders.origin
    ) {
      throw new Error(
        "The commit Server Action protocol headers are incomplete.",
      );
    }
    await expect(
      page.getByText("Imported 1 rows; 0 need review; 0 failed.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Last import" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Saved sources/ }).click();
    const savedSource = page
      .getByText(fixture.workbookName, { exact: true })
      .locator("..")
      .locator("..");
    await expect(
      savedSource.getByRole("button", { name: "History" }),
    ).toBeVisible();
    await savedSource.getByRole("button", { name: "History" }).click();

    const sourceHistory = page
      .getByText("Source history", { exact: true })
      .locator("..")
      .locator("..");
    await expect(
      sourceHistory.getByText(fixture.workbookName, { exact: true }),
    ).toBeVisible();

    const { data: committedRow, error: committedRowError } = await plugin
      .from("csf_sheet_import_rows")
      .select(
        "import_status, matched_profile_id, commit_target_profile_id, commit_outcome_state, commit_attempt_id",
      )
      .eq("organization_id", fixture.organizationId)
      .eq("id", fixture.importRowId)
      .single();
    assertNoSupabaseError(
      "Could not load the committed historical row",
      committedRowError,
    );
    expect(committedRow).toMatchObject({
      import_status: "updated",
      matched_profile_id: fixture.profileId,
      commit_target_profile_id: fixture.profileId,
      commit_outcome_state: "succeeded",
    });
    expect(committedRow?.commit_attempt_id).toBeTruthy();

    const { data: commitJob, error: commitJobError } = await plugin
      .from("csf_sheet_import_jobs")
      .select(
        "id, status, source_id, preview_job_id, source_file_name, source_content_hash",
      )
      .eq("organization_id", fixture.organizationId)
      .eq("mode", "commit")
      .eq("preview_job_id", fixture.previewJobId)
      .single();
    assertNoSupabaseError(
      "Could not load the committed historical import",
      commitJobError,
    );
    if (!commitJob) throw new Error("The historical commit job is missing.");
    expect(commitJob).toMatchObject({
      status: "completed",
      source_id: fixture.sourceId,
      preview_job_id: fixture.previewJobId,
      source_file_name: fixture.workbookName,
      source_content_hash: preview.source_content_hash,
    });
    const sourceHistoryRun = sourceHistory
      .locator("article")
      .filter({ hasText: `Commit #${commitJob.id.slice(0, 8)}` });
    await expect(sourceHistoryRun).toHaveCount(1);
    await expect(sourceHistoryRun).toContainText("Rows 1");
    await expect(sourceHistoryRun).toContainText("Committed 1");
    await expect(sourceHistoryRun).toContainText("Skipped 0");
    await expect(sourceHistoryRun).toContainText("Errors 0");
    await sourceHistoryRun.getByText("Run details", { exact: true }).click();
    await expect(sourceHistoryRun).toContainText(
      `Commits preview #${fixture.previewJobId!.slice(0, 8)}`,
    );
    await page
      .getByRole("button", { name: "Import history", exact: true })
      .click();
    const importHistory = page
      .getByRole("button", { name: "Import history", exact: true })
      .locator("..");
    const historyRun = importHistory
      .locator("article")
      .filter({ hasText: `Commit #${commitJob.id.slice(0, 8)}` });
    await expect(historyRun).toHaveCount(1);

    const [{ data: credits }, { data: activities }, { data: audit }] =
      await Promise.all([
        plugin
          .from("csf_credit_records")
          .select("points, status, evidence")
          .eq("organization_id", fixture.organizationId)
          .eq("profile_id", fixture.profileId)
          .eq("term_id", fixture.termId)
          .contains("evidence", sourceReference),
        plugin
          .from("csf_profile_activity_events")
          .select("title, raw_points, counted_points, status, source_ref")
          .eq("organization_id", fixture.organizationId)
          .eq("profile_id", fixture.profileId)
          .eq("term_id", fixture.termId)
          .contains("source_ref", sourceReference),
        plugin
          .from("csf_admin_audit_events")
          .select("action, target_id, correlation_id, source_id, after_data")
          .eq("organization_id", fixture.organizationId)
          .eq("action", "sheet_import.row_committed")
          .eq("target_id", fixture.importRowId)
          .single(),
      ]);
    expect(credits).toHaveLength(1);
    expect(credits?.[0]).toMatchObject({ points: 2, status: "verified" });
    expect(activities).toHaveLength(1);
    expect(activities?.[0]).toMatchObject({
      title: fixture.activityTitle,
      raw_points: 2,
      counted_points: 2,
      status: "verified",
    });
    expect(audit).toMatchObject({
      action: "sheet_import.row_committed",
      target_id: fixture.importRowId,
      source_id: fixture.sourceId,
    });
    expect(audit?.correlation_id).toBeTruthy();

    // A completed preview replaces the UI action, so replay the captured
    // authenticated Server Action at the supported browser request boundary.
    await expect(
      page.getByRole("button", { name: "Committed", exact: true }),
    ).toBeDisabled();
    const replayResponse = await page
      .context()
      .request.post(capturedCommitRequest.url(), {
        headers: replayHeaders,
        data: capturedCommitBody,
      });
    expect(replayResponse.status()).toBe(200);
    expect(replayResponse.ok()).toBeTruthy();
    const [
      { count: committedJobCount, error: committedJobCountError },
      { count: committedCreditCount, error: committedCreditCountError },
      { count: committedActivityCount, error: committedActivityCountError },
      { count: committedAuditCount, error: committedAuditCountError },
    ] = await Promise.all([
      plugin
        .from("csf_sheet_import_jobs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", fixture.organizationId)
        .eq("mode", "commit")
        .eq("preview_job_id", fixture.previewJobId),
      plugin
        .from("csf_credit_records")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", fixture.organizationId)
        .eq("profile_id", fixture.profileId)
        .eq("term_id", fixture.termId)
        .contains("evidence", sourceReference),
      plugin
        .from("csf_profile_activity_events")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", fixture.organizationId)
        .eq("profile_id", fixture.profileId)
        .eq("term_id", fixture.termId)
        .contains("source_ref", sourceReference),
      plugin
        .from("csf_admin_audit_events")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", fixture.organizationId)
        .eq("action", "sheet_import.row_committed")
        .eq("target_id", fixture.importRowId),
    ]);
    assertNoSupabaseError(
      "Could not count idempotent historical commit jobs",
      committedJobCountError,
    );
    assertNoSupabaseError(
      "Could not count idempotent historical credits",
      committedCreditCountError,
    );
    assertNoSupabaseError(
      "Could not count idempotent historical activity rows",
      committedActivityCountError,
    );
    assertNoSupabaseError(
      "Could not count idempotent historical audit rows",
      committedAuditCountError,
    );
    expect(committedJobCount).toBe(1);
    expect(committedCreditCount).toBe(1);
    expect(committedActivityCount).toBe(1);
    expect(committedAuditCount).toBe(1);
    expectNoBrowserFailures(failures);
  });
});
