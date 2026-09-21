import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Locator } from "@playwright/test";
import {
  cleanupAttendanceFixture,
  getAttendanceEnvironment,
  prepareHostedContext,
  signInHostedFixture,
} from "./environment";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({ trace: "off", video: "off", screenshot: "off" });
test.setTimeout(180_000);

function checked(error: { message: string } | null) {
  if (error)
    throw new Error(
      process.env.ATTENDANCE_HOSTED_DEVELOPMENT === "1"
        ? "Hosted attendance fixture operation failed."
        : error.message,
    );
}
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if (char === "\n" && !quoted) {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  return rows.map((values) =>
    Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""])),
  );
}
async function fillVisit(
  dialog: Locator,
  index: number,
  date: string,
  start: string,
  end: string,
) {
  await dialog
    .locator('input[type="datetime-local"]')
    .nth(index * 2)
    .fill(`${date}T${start}`);
  await dialog
    .locator('input[type="datetime-local"]')
    .nth(index * 2 + 1)
    .fill(`${date}T${end}`);
}

test("fictional guest attendance prints, publishes, exports, corrects, and links one award", async ({
  page,
  context,
  browser,
}, testInfo) => {
  const env = getAttendanceEnvironment();
  if (env.hosted && testInfo.project.use.baseURL !== env.appUrl)
    throw new Error(
      "Hosted attendance configuration does not match its target.",
    );
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = randomUUID().slice(0, 8);
  const coordinatorEmail = `attendance.coordinator.${suffix}@local.test`;
  const walkinEmail = `attendance.walkin.${suffix}@local.test`;
  const password = randomBytes(24).toString("base64url");
  const projectId = randomUUID();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - 86400000));
  let userId: string | null = null;
  let linkedUserId: string | null = null;
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(env.hosted ? "Browser runtime error" : error.message);
    if (!env.hosted) console.error("Attendance page error:", error.message);
  });
  try {
    const account = await admin.auth.admin.createUser({
      email: coordinatorEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: "Attendance Coordinator Fixture",
        username: `attendance-coordinator-${suffix}`,
      },
    });
    checked(account.error);
    if (!account.data.user)
      throw new Error("Fictional coordinator was not created");
    userId = account.data.user.id;
    const profile = await admin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .single();
    checked(profile.error);
    checked(
      (
        await admin.from("projects").insert({
          id: projectId,
          creator_id: userId,
          organization_id: null,
          title: `Attendance Browser Fixture ${suffix}`,
          description: "Fictional attendance acceptance project",
          location: "Fictional community center",
          event_type: "oneTime",
          verification_method: "manual",
          schedule: {
            oneTime: {
              date,
              startTime: "09:00",
              endTime: "15:00",
              volunteers: 20,
            },
          },
          status: "completed",
          workflow_status: "published",
          project_timezone: "America/Los_Angeles",
          published: {},
          visibility: "unlisted",
          waiver_required: false,
        })
      ).error,
    );

    if (env.hosted) {
      await prepareHostedContext(context, env);
      await signInHostedFixture(context, env, {
        email: coordinatorEmail,
        password,
        userId,
      });
      await page.goto(`/projects/${projectId}/hours`);
    } else {
      await page.goto(
        `/login?redirect=${encodeURIComponent(`/projects/${projectId}/hours`)}`,
      );
      const main = page.getByRole("main");
      await expect(main.locator('form[data-hydrated="true"]')).toBeVisible();
      await expect(
        main.getByText("Secure check ready", { exact: true }),
      ).toBeVisible();
      await main
        .getByRole("textbox", { name: "Email", exact: true })
        .fill(coordinatorEmail);
      await main.getByLabel("Password", { exact: true }).fill(password);
      await main.getByRole("button", { name: "Login", exact: true }).click();
    }
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/hours$`), {
      timeout: 120_000,
    });

    const failedBatchId = randomUUID();
    checked(
      (
        await admin.from("project_paper_scan_batches").insert({
          id: failedBatchId,
          project_id: projectId,
          schedule_id: "oneTime",
          created_by: userId,
          status: "failed",
          image_count: 1,
          input_method: "scan",
        })
      ).error,
    );
    await page.goto(
      `/projects/${projectId}/paper-signups?batch=${failedBatchId}`,
    );
    await expect(
      page.getByRole("button", { name: "Retry scan", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Retry scan", exact: true }),
    ).toBeVisible();
    await page.goto(`/projects/${projectId}/paper-signups`);
    await expect(
      page.getByRole("button", { name: "Retry scan", exact: true }),
    ).toBeVisible();
    checked(
      (
        await admin
          .from("project_paper_scan_batches")
          .delete()
          .eq("id", failedBatchId)
      ).error,
    );
    await page.goto(`/projects/${projectId}/hours`);
    await expect(
      page.getByRole("heading", { name: "Volunteer hours", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/Volunteer hours/);
    console.info("Attendance acceptance: authenticated hours page loaded");

    await page
      .locator(`a[href="/projects/${projectId}/attendance-sheet"]`)
      .filter({ visible: true })
      .first()
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${projectId}/attendance-sheet$`),
    );
    const prepareSheets = page.getByRole("button", {
      name: "Prepare sheets",
      exact: true,
    });
    const printSession = page.getByRole("checkbox").first();
    await printSession.uncheck();
    await expect(prepareSheets).toBeDisabled();
    await printSession.check();
    await expect(prepareSheets).toBeEnabled();
    await prepareSheets.click();
    await expect(page.locator(".attendance-print-page").first()).toBeVisible();
    await expect(page.locator(".attendance-print-sheets")).toContainText(
      "Walk-ins",
    );
    console.info("Attendance acceptance: print sheets prepared");
    if (!env.hosted)
      await page.screenshot({
        path: testInfo.outputPath("print-desktop.png"),
        fullPage: true,
      });

    await page.goto(`/projects/${projectId}/paper-signups?mode=manual`);
    await page.getByRole("radio").first().check();
    await page
      .getByRole("button", { name: "Add attendance manually", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add missed row or walk-in", exact: true })
      .click();
    const review = page.getByRole("dialog");
    await expect(
      review.getByRole("heading", { name: /Review row/ }),
    ).toBeVisible();
    await review.getByLabel("Name", { exact: true }).fill("Walk-in Fixture");
    await review.getByLabel("Email", { exact: true }).fill(walkinEmail);
    await fillVisit(review, 0, date, "09:00", "10:00");
    await review
      .getByRole("button", { name: "Add another visit", exact: true })
      .click();
    await fillVisit(review, 1, date, "11:00", "12:00");
    await expect(review).toContainText("2h 0m, excluding breaks");
    await review.getByLabel(/I checked this volunteer's identity/).check();
    await review.getByLabel(/I reviewed all times and dates/).check();
    const signature = review.getByLabel("Signature visible on the sheet", {
      exact: true,
    });
    await expect(signature).not.toBeChecked();
    await signature.check();
    await expect(signature).toBeChecked();
    await expect(
      review.getByLabel(/I reviewed all times and dates/),
    ).not.toBeChecked();
    await signature.uncheck();
    await review.getByLabel(/I reviewed all times and dates/).check();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(review).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await review.evaluate((element) => {
      element.scrollTop = 0;
    });
    if (!env.hosted)
      await page.screenshot({
        path: testInfo.outputPath("review-mobile.png"),
        fullPage: false,
      });
    await review
      .getByText("Visits and breaks", { exact: true })
      .scrollIntoViewIfNeeded();
    if (!env.hosted)
      await page.screenshot({
        path: testInfo.outputPath("review-mobile-visits.png"),
        fullPage: false,
      });
    await review
      .getByRole("button", { name: "Save review", exact: true })
      .click();
    await expect(review).not.toBeVisible();
    const include = page
      .getByLabel("Include when reviewed", { exact: true })
      .first();
    if (!(await include.isChecked())) {
      await include.click();
      await expect(include).toBeChecked();
    }
    await page
      .getByRole("button", { name: "Add missed row or walk-in", exact: true })
      .click();
    const incompleteReview = page.getByRole("dialog");
    await incompleteReview
      .getByLabel("Name", { exact: true })
      .fill("Unresolved Fixture");
    await incompleteReview
      .getByRole("button", { name: "Save review", exact: true })
      .click();
    await expect(incompleteReview).not.toBeVisible();
    await page
      .getByRole("button", { name: "Save 1 reviewed rows", exact: true })
      .click();
    await expect
      .poll(async () => {
        const result = await admin
          .from("project_signups")
          .select("id")
          .eq("project_id", projectId)
          .eq("status", "attended");
        checked(result.error);
        return result.data?.length ?? 0;
      })
      .toBe(1);

    await page.reload();
    await expect(
      page.getByRole("heading", { name: /Unresolved Fixture$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Add missed row or walk-in",
        exact: true,
      }),
    ).toBeVisible();
    console.info(
      "Attendance acceptance: valid attendance saved; unresolved row survives reload",
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/projects/${projectId}/hours`);
    await expect(
      page.getByRole("heading", { name: "Walk-in Fixture" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Review and publish 1 volunteers?/ })
      .click();
    await page
      .getByRole("button", { name: "Publish hours", exact: true })
      .click();
    await expect
      .poll(
        async () => {
          const result = await admin
            .from("certificates")
            .select("credited_minutes")
            .eq("project_id", projectId);
          checked(result.error);
          return result.data?.[0]?.credited_minutes;
        },
        { timeout: 30_000 },
      )
      .toBe(120);
    const certificate = await admin
      .from("certificates")
      .select("id,credited_minutes,attendance_revision")
      .eq("project_id", projectId)
      .single();
    checked(certificate.error);
    expect(certificate.data).toBeTruthy();
    const certificateId = certificate.data!.id;
    console.info("Attendance acceptance: 120 minutes published");

    const jsonResponse = await context.request.get(
      `/api/projects/${projectId}/hours/export?format=json`,
    );
    expect(jsonResponse.status()).toBe(200);
    expect(jsonResponse.headers()["cache-control"]).toContain("no-store");
    const exported = await jsonResponse.json();
    expect(exported.schemaVersion).toBe(1);
    expect(exported.records).toHaveLength(1);
    expect(exported.records[0]).toMatchObject({
      name: "Walk-in Fixture",
      participantType: "guest",
      creditedMinutes: 120,
      publicationState: "published",
      certificateId,
    });
    expect(exported.records[0].intervals).toHaveLength(2);
    const unpublishedResponse = await context.request.get(
      `/api/projects/${projectId}/hours/export?format=json&includeUnpublished=true`,
    );
    expect(unpublishedResponse.status()).toBe(200);
    const unpublishedExport = await unpublishedResponse.json();
    expect(unpublishedExport.records).toHaveLength(2);
    expect(
      unpublishedExport.records.find(
        (record: { name: string }) => record.name === "Unresolved Fixture",
      ),
    ).toMatchObject({
      creditedMinutes: null,
      publicationState: "unresolved",
      certificateId: null,
    });
    const csvResponse = await context.request.get(
      `/api/projects/${projectId}/hours/export?format=csv`,
    );
    expect(csvResponse.status()).toBe(200);
    const csv = parseCsv(await csvResponse.text());
    expect(csv).toHaveLength(exported.records.length);
    for (const [key, value] of Object.entries(exported.records[0]))
      expect(csv[0][key]).toBe(
        value === null
          ? ""
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value),
      );
    const loggedOut = await browser.newContext();
    if (env.hosted) await prepareHostedContext(loggedOut, env);
    const denied = await loggedOut.request.get(
      `${new URL(page.url()).origin}/api/projects/${projectId}/hours/export?format=json`,
    );
    expect([401, 403]).toContain(denied.status());
    await loggedOut.close();

    console.info(
      "Attendance acceptance: CSV and JSON agree; unauthenticated export denied",
    );
    // A saved name-only entry remains authoritative while its review draft changes.
    await page.goto(`/projects/${projectId}/paper-signups`);
    await page
      .getByRole("button", { name: "Add missed row or walk-in", exact: true })
      .click();
    const rosterReview = page.getByRole("dialog");
    await rosterReview
      .getByLabel("Name", { exact: true })
      .fill("Roster Snapshot Fixture");
    await fillVisit(rosterReview, 0, date, "09:10", "09:40");
    await rosterReview
      .getByRole("button", { name: "Add another visit", exact: true })
      .click();
    await fillVisit(rosterReview, 1, date, "11:10", "11:40");
    await rosterReview
      .getByLabel(/I checked this volunteer's identity/)
      .check();
    await rosterReview.getByLabel(/I reviewed all times and dates/).check();
    await rosterReview
      .getByRole("button", { name: "Save review", exact: true })
      .click();
    await expect(rosterReview).not.toBeVisible();
    const rosterArticle = page.locator("article").filter({
      has: page.getByRole("heading", { name: /Roster Snapshot Fixture$/ }),
    });
    const rosterInclude = rosterArticle.getByLabel("Include when reviewed", {
      exact: true,
    });
    if (!(await rosterInclude.isChecked())) {
      await rosterInclude.click();
      await expect(rosterInclude).toBeChecked();
    }
    await page
      .getByRole("button", { name: "Save 1 reviewed rows", exact: true })
      .click();
    await expect(
      rosterArticle.getByText("Saved without credit", { exact: true }),
    ).toBeVisible();
    const savedIncluded = rosterArticle.getByLabel(
      "Saved attendance stays included",
      { exact: true },
    );
    await expect(savedIncluded).toBeChecked();
    await expect(savedIncluded).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Discard draft", exact: true }),
    ).toBeDisabled();
    const rosterSnapshotResponse = await context.request.get(
      `/api/projects/${projectId}/hours/export?format=json&includeUnpublished=true`,
    );
    expect(rosterSnapshotResponse.status()).toBe(200);
    const rosterSnapshotExport = await rosterSnapshotResponse.json();
    expect(rosterSnapshotExport.records).toHaveLength(3);
    const savedRosterExport = rosterSnapshotExport.records.find(
      (record: { name: string }) => record.name === "Roster Snapshot Fixture",
    );
    expect(savedRosterExport).toMatchObject({
      sourceType: "roster",
      participantType: "guest",
      creditedMinutes: null,
      publicationState: "unresolved",
      certificateId: null,
    });
    expect(savedRosterExport.intervals).toHaveLength(2);
    const rosterEntry = await admin
      .from("project_paper_roster_entries")
      .select("id,scan_row_id,attendance_intervals")
      .eq("project_id", projectId)
      .eq("name", "Roster Snapshot Fixture")
      .single();
    checked(rosterEntry.error);
    expect(rosterEntry.data?.id).toBe(savedRosterExport.sourceId);
    expect(rosterEntry.data?.attendance_intervals).toEqual(
      savedRosterExport.intervals,
    );

    await rosterArticle.getByRole("button", { name: /Review row/ }).click();
    await fillVisit(rosterReview, 0, date, "09:20", "09:35");
    await fillVisit(rosterReview, 1, date, "11:20", "11:35");
    await expect(
      rosterReview.getByLabel(/I reviewed all times and dates/),
    ).not.toBeChecked();
    await rosterReview
      .getByRole("button", { name: "Save review", exact: true })
      .click();
    await expect(rosterReview).not.toBeVisible();
    await page.reload();
    await expect(savedIncluded).toBeDisabled();
    await expect(savedIncluded).toBeChecked();
    await expect(
      rosterArticle.getByRole("button", { name: /Review row/ }),
    ).toBeEnabled();
    const editedSnapshotResponse = await context.request.get(
      `/api/projects/${projectId}/hours/export?format=json&includeUnpublished=true`,
    );
    expect(editedSnapshotResponse.status()).toBe(200);
    const editedSnapshotExport = await editedSnapshotResponse.json();
    expect(editedSnapshotExport.records).toHaveLength(3);
    expect(
      editedSnapshotExport.records.find(
        (record: { sourceId: string }) =>
          record.sourceId === savedRosterExport.sourceId,
      ),
    ).toEqual(savedRosterExport);
    const editedDraft = await admin
      .from("project_paper_scan_rows")
      .select("attendance_intervals,outcome,review_acknowledged")
      .eq("project_id", projectId)
      .eq("id", rosterEntry.data!.scan_row_id)
      .single();
    checked(editedDraft.error);
    expect(editedDraft.data?.outcome).toBe("pending");
    expect(editedDraft.data?.review_acknowledged).toBe(false);
    expect(editedDraft.data?.attendance_intervals).not.toEqual(
      savedRosterExport.intervals,
    );

    const readAwardSnapshot = async () => {
      const [signups, certificates, deliveries, notifications, intervals] =
        await Promise.all([
          admin
            .from("project_signups")
            .select(
              "id,status,anonymous_id,user_id,check_in_time,check_out_time,attendance_revision",
            )
            .eq("project_id", projectId)
            .order("id"),
          admin
            .from("certificates")
            .select(
              "id,signup_id,credited_minutes,attendance_revision,event_start,event_end",
            )
            .eq("project_id", projectId)
            .order("id"),
          admin
            .from("hours_publication_email_outbox")
            // Delivery workers may advance attempts during hosted review.
            .select("id,receipt_id,certificate_id,delivery_revision")
            .eq("certificate_id", certificateId)
            .order("id"),
          admin
            .from("paper_signup_notification_outbox")
            .select("id,source_scan_row_id")
            .eq("project_id", projectId)
            .order("id"),
          admin
            .from("project_attendance_intervals")
            .select("*")
            .eq("project_id", projectId)
            .order("id"),
        ]);
      for (const result of [
        signups,
        certificates,
        deliveries,
        notifications,
        intervals,
      ])
        checked(result.error);
      return {
        signups: signups.data,
        certificates: certificates.data,
        deliveries: deliveries.data,
        notifications: notifications.data,
        intervals: intervals.data,
      };
    };
    const beforeReconciliation = await readAwardSnapshot();
    expect(beforeReconciliation.signups).toHaveLength(1);
    expect(beforeReconciliation.certificates).toHaveLength(1);
    expect(beforeReconciliation.certificates![0]).toMatchObject({
      id: certificateId,
      credited_minutes: 120,
      attendance_revision: certificate.data!.attendance_revision,
    });
    expect(beforeReconciliation.intervals).toHaveLength(2);
    const guestSignupId = beforeReconciliation.signups![0].id;
    await rosterArticle.getByRole("button", { name: /Review row/ }).click();
    const existingSignup = rosterReview.getByLabel(
      "Existing signup, if this person already signed up",
      { exact: true },
    );
    await expect(
      existingSignup.locator(`option[value="${guestSignupId}"]`),
    ).toHaveCount(1);
    await existingSignup.selectOption(guestSignupId);
    await fillVisit(rosterReview, 0, date, "09:10", "09:40");
    await fillVisit(rosterReview, 1, date, "11:10", "11:40");
    await rosterReview
      .getByLabel(/I checked this volunteer's identity/)
      .check();
    await rosterReview.getByLabel(/I reviewed all times and dates/).check();
    await rosterReview
      .getByRole("button", { name: "Save review", exact: true })
      .click();
    await expect(rosterReview).not.toBeVisible();
    await expect(savedIncluded).toBeDisabled();
    await page
      .getByRole("button", { name: "Save 1 reviewed rows", exact: true })
      .click();
    await expect
      .poll(async () => {
        const result = await admin
          .from("project_paper_scan_rows")
          .select("outcome,outcome_detail")
          .eq("project_id", projectId)
          .eq("id", rosterEntry.data!.scan_row_id)
          .single();
        checked(result.error);
        return result.data;
      })
      .toEqual({
        outcome: "skipped",
        outcome_detail: "reconciled_existing_attendance",
      });
    await expect(
      rosterArticle.getByText("Already recorded", { exact: true }),
    ).toBeVisible();
    const remainingRoster = await admin
      .from("project_paper_roster_entries")
      .select("id")
      .eq("project_id", projectId);
    checked(remainingRoster.error);
    expect(remainingRoster.data).toEqual([]);
    expect(await readAwardSnapshot()).toEqual(beforeReconciliation);
    await page.reload();
    await expect(
      rosterArticle.getByText("Already recorded", { exact: true }),
    ).toBeVisible();
    await expect(
      rosterArticle.getByRole("button", { name: /Review row/ }),
    ).toHaveCount(0);
    expect(await readAwardSnapshot()).toEqual(beforeReconciliation);
    const reconciledExportResponse = await context.request.get(
      `/api/projects/${projectId}/hours/export?format=json&includeUnpublished=true`,
    );
    expect(reconciledExportResponse.status()).toBe(200);
    const reconciledExport = await reconciledExportResponse.json();
    expect(reconciledExport.records).toHaveLength(2);
    expect(
      reconciledExport.records.filter(
        (record: { publicationState: string }) =>
          record.publicationState === "published",
      ),
    ).toEqual(exported.records);
    console.info(
      "Attendance acceptance: saved roster reconciles split visits without changing its existing award or delivery",
    );
    await page.goto(`/projects/${projectId}/hours`);
    await page
      .getByRole("button", { name: "Correct hours", exact: true })
      .click();
    const correction = page.getByRole("dialog");
    await fillVisit(correction, 1, date, "11:00", "12:30");
    await correction
      .getByLabel(/Correction reason/)
      .fill("Reviewed fictional sign-out time against the test sheet.");
    await correction.getByLabel(/I reviewed every visit/).check();
    await correction
      .getByRole("button", { name: "Save correction", exact: true })
      .click();
    await expect(correction).not.toBeVisible();
    await expect
      .poll(async () => {
        const result = await admin
          .from("certificates")
          .select("credited_minutes")
          .eq("id", certificateId)
          .single();
        checked(result.error);
        return result.data?.credited_minutes;
      })
      .toBe(150);
    const after = await admin
      .from("certificates")
      .select("id,attendance_revision")
      .eq("project_id", projectId);
    checked(after.error);
    expect(after.data).toHaveLength(1);
    expect(after.data![0].id).toBe(certificateId);
    expect(after.data![0].attendance_revision).toBeGreaterThan(
      certificate.data!.attendance_revision,
    );
    console.info(
      "Attendance acceptance: same certificate corrected to 150 minutes",
    );
    const correctedExportResponse = await context.request.get(
      `/api/projects/${projectId}/hours/export?format=json`,
    );
    expect(correctedExportResponse.status()).toBe(200);
    const correctedExport = await correctedExportResponse.json();
    expect(correctedExport.records).toHaveLength(1);
    expect(correctedExport.records[0]).toMatchObject({
      creditedMinutes: 150,
      certificateId,
      attendanceRevision: after.data![0].attendance_revision,
    });
    const correctedCsvResponse = await context.request.get(
      `/api/projects/${projectId}/hours/export?format=csv`,
    );
    expect(correctedCsvResponse.status()).toBe(200);
    const correctedCsv = parseCsv(await correctedCsvResponse.text());
    expect(correctedCsv).toHaveLength(1);
    expect(correctedCsv[0].creditedMinutes).toBe("150");
    expect(correctedCsv[0].certificateId).toBe(certificateId);

    if (!env.hosted)
      await page.screenshot({
        path: testInfo.outputPath("corrected-hours.png"),
        fullPage: true,
      });
    await page.goto(`/certificates/${certificateId}`);
    await expect(
      page.getByText("2 hours 30 mins", { exact: true }),
    ).toBeVisible();
    if (!env.hosted)
      await page.screenshot({
        path: testInfo.outputPath("corrected-certificate.png"),
        fullPage: true,
      });
    const anonymous = await admin
      .from("anonymous_signups")
      .select("id,token")
      .eq("project_id", projectId)
      .eq("email", walkinEmail)
      .single();
    checked(anonymous.error);
    if (!anonymous.data?.token) throw new Error("Guest access was not created");
    const guestContext = await browser.newContext();
    guestContext.setDefaultNavigationTimeout(120_000);
    guestContext.setDefaultTimeout(20_000);
    try {
      if (env.hosted) await prepareHostedContext(guestContext, env);
      const guestPage = await guestContext.newPage();
      const origin = new URL(page.url()).origin;
      const guestUrl = `${origin}/anonymous/${anonymous.data.id}?token=${encodeURIComponent(anonymous.data.token)}`;
      await guestPage.goto(guestUrl, { timeout: 120_000 });
      const guestCertificate = guestPage.getByRole("link", {
        name: "Certificate",
        exact: true,
      });
      await expect(guestCertificate).toHaveAttribute(
        "href",
        `/certificates/${certificateId}`,
      );
      await guestPage.goto(`${origin}/certificates/${certificateId}`);
      await expect(
        guestPage.getByText("2 hours 30 mins", { exact: true }),
      ).toBeVisible();
      console.info(
        "Attendance acceptance: guest can access the corrected certificate",
      );

      const linkedAccount = await admin.auth.admin.createUser({
        email: walkinEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: "Walk-in Fixture",
          username: `attendance-walkin-${suffix}`,
        },
      });
      checked(linkedAccount.error);
      if (!linkedAccount.data.user)
        throw new Error("Linked account fixture was not created");
      linkedUserId = linkedAccount.data.user.id;
      if (env.hosted)
        await signInHostedFixture(guestContext, env, {
          email: walkinEmail,
          password,
          userId: linkedUserId,
        });
      await guestPage.goto(guestUrl);
      await guestPage
        .getByRole("button", { name: "Link or Create Account", exact: true })
        .click();
      const linker = guestPage.getByRole("dialog");
      if (env.hosted) {
        await linker
          .getByRole("button", { name: "Link to Current Account", exact: true })
          .click();
      } else {
        await linker.getByLabel("Email", { exact: true }).fill(walkinEmail);
        await linker.getByLabel("Password", { exact: true }).fill(password);
        await linker
          .getByRole("button", { name: "Sign In & Link", exact: true })
          .click();
      }
      await expect(guestPage).toHaveURL(/\/dashboard$/, { timeout: 120_000 });
      const linkedSignups = await admin
        .from("project_signups")
        .select("id,user_id,anonymous_id")
        .eq("project_id", projectId);
      checked(linkedSignups.error);
      expect(linkedSignups.data).toHaveLength(1);
      expect(linkedSignups.data![0]).toMatchObject({
        user_id: linkedUserId,
        anonymous_id: null,
      });
      const linkedCertificates = await admin
        .from("certificates")
        .select("id,user_id,credited_minutes")
        .eq("project_id", projectId);
      checked(linkedCertificates.error);
      expect(linkedCertificates.data).toEqual([
        { id: certificateId, user_id: linkedUserId, credited_minutes: 150 },
      ]);
      await guestPage.reload();
      const afterReload = await admin
        .from("certificates")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      checked(afterReload.error);
      expect(afterReload.count).toBe(1);
      console.info(
        "Attendance acceptance: guest account linking preserves exactly one award",
      );
      await guestPage.goto(`${origin}/projects/${projectId}`);
      await expect(
        guestPage.getByText("Volunteer Hours Published!", { exact: true }),
      ).toBeVisible();
      const feedback = guestPage.getByRole("dialog", {
        name: "How did volunteering here go?",
        exact: true,
      });
      await expect(feedback).toBeVisible();
      await feedback
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await expect(feedback).not.toBeVisible();
      const volunteerTotal = guestPage
        .getByText("Total Hours:", { exact: true })
        .locator("..");
      await expect(volunteerTotal).toBeVisible();
      await expect(volunteerTotal).toContainText("2h 30m");
      await expect(volunteerTotal).not.toContainText("3h 30m");
      if (!env.hosted)
        await guestPage.screenshot({
          path: testInfo.outputPath("volunteer-corrected-hours.png"),
          fullPage: true,
        });
      console.info(
        "Attendance acceptance: volunteer total uses corrected150minutes across split visits",
      );
    } finally {
      await guestContext.close();
    }
    expect(
      errors.filter((message) => !message.includes("Failed to load resource")),
    ).toEqual([]);
  } catch (error) {
    if (env.hosted)
      throw new Error(
        "Hosted attendance journey failed (ATTENDANCE_JOURNEY_FAILED).",
      );
    throw error;
  } finally {
    const cleanupErrors = await cleanupAttendanceFixture(admin, projectId, [
      userId,
      linkedUserId,
    ]);
    expect.soft(cleanupErrors, "Fictional fixture cleanup").toEqual([]);
  }
});
