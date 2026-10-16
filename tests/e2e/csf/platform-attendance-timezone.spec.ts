import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test.use({ timezoneId: "Asia/Tokyo", viewport: { width: 375, height: 812 } });

test("attendance keeps the Pacific project start in a different browser timezone", async ({
  page,
}) => {
  await loginAs(
    page,
    "admin",
    "/projects/10000000-0000-4000-8000-000000000020/attendance",
  );
  await expect(
    page.getByRole("heading", { name: "Attendance records", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/First session starts at: December 5, 2026 at 9:00 AM PST/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Attendance management not yet available",
      exact: true,
    }),
  ).toBeVisible();
});
