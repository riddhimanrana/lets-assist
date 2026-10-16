import { randomUUID } from "node:crypto";
import { expect, test, type Route } from "@playwright/test";

import { loadCsfFeedFixture } from "./feed-fixtures";
import { loginAs } from "./helpers";

test.use({ viewport: { width: 375, height: 812 } });

test("a failed mobile download still offers working document navigation", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error("The isolated app origin is required.");
  const fixture = await loadCsfFeedFixture();
  const projectId = randomUUID();
  const documentUrl = new URL(`/e2e-preview-${projectId}.pdf`, baseURL).href;
  const fileName = "Fictional mobile preview.pdf";
  const context = page.context();
  const serveDocument = async (route: Route) => {
    if (route.request().resourceType() === "fetch") {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<p>Fictional document navigation succeeded.</p>",
    });
  };
  await context.route(documentUrl, serveDocument);
  try {
    const seeded = await fixture.admin.from("projects").insert({
      id: projectId,
      creator_id: fixture.organizationAdminUserId,
      title: `E2E mobile file preview ${projectId}`,
      description: "Fictional document recovery fixture.",
      location: "Local fixture venue",
      event_type: "oneTime",
      verification_method: "manual",
      visibility: "public",
      workflow_status: "published",
      status: "upcoming",
      project_timezone: "America/Los_Angeles",
      schedule: {
        oneTime: {
          date: "2038-06-15",
          startTime: "10:00",
          endTime: "11:00",
          volunteers: 5,
        },
      },
      documents: [
        {
          name: fileName,
          originalName: fileName,
          type: "application/pdf",
          size: 100,
          url: documentUrl,
        },
      ],
    });
    expect(seeded.error).toBeNull();
    await loginAs(page, "admin", `/projects/${projectId}`);
    await page.getByRole("button", { name: `Preview ${fileName}` }).click();
    const dialog = page.getByRole("dialog", {
      name: `File Preview: ${fileName}`,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Download", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Download failed");

    const open = dialog.getByRole("button", {
      name: "Open in new tab",
      exact: true,
    });
    await expect(open).toBeVisible();
    const bounds = await open.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    const popupPromise = page.waitForEvent("popup");
    await open.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(documentUrl);
    await expect(
      popup.getByText("Fictional document navigation succeeded."),
    ).toBeVisible();
    await popup.close();
  } finally {
    await context.unroute(documentUrl, serveDocument);
    const cleaned = await fixture.admin
      .from("projects")
      .delete()
      .eq("id", projectId)
      .eq("creator_id", fixture.organizationAdminUserId);
    expect(cleaned.error).toBeNull();
  }
});
