import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { loadCsfFeedFixture } from "./feed-fixtures";
import {
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

test.use({ timezoneId: "Asia/Tokyo", viewport: { width: 375, height: 812 } });

test("attendance keeps the Pacific project start in a different browser timezone", async ({
  page,
}) => {
  const failures = watchBrowserFailures(page);
  const fixture = await loadCsfFeedFixture();
  const projectId = randomUUID();
  const year = new Date().getUTCFullYear() + 2;
  try {
    const seeded = await fixture.admin.from("projects").insert({
      id: projectId,
      creator_id: fixture.organizationAdminUserId,
      title: `E2E attendance timezone ${projectId}`,
      description: "Fictional future Pacific attendance fixture.",
      location: "Local fixture venue",
      event_type: "oneTime",
      verification_method: "manual",
      visibility: "public",
      workflow_status: "published",
      status: "upcoming",
      project_timezone: "America/Los_Angeles",
      schedule: {
        oneTime: {
          date: `${year}-12-05`,
          startTime: "09:00",
          endTime: "13:00",
          volunteers: 5,
        },
      },
    });
    expect(seeded.error).toBeNull();
    await loginAs(page, "admin", `/projects/${projectId}/attendance`);
    await expect(
      page.getByRole("heading", { name: "Attendance records", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        new RegExp(
          `First session starts at: December 5, ${year} at 9:00 AM PST`,
        ),
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Attendance management not yet available",
        exact: true,
      }),
    ).toBeVisible();
    expectNoBrowserFailures(failures);
  } finally {
    const cleaned = await fixture.admin
      .from("projects")
      .delete()
      .eq("id", projectId)
      .eq("creator_id", fixture.organizationAdminUserId);
    expect(cleaned.error).toBeNull();
  }
});
