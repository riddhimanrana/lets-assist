import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { loadCsfFeedFixture } from "./feed-fixtures";
import { loginAs } from "./helpers";

test("project discovery counts beyond the API cap and retries an unavailable feed without inventing capacity", async ({
  page,
}) => {
  const fixture = await loadCsfFeedFixture();
  const projectId = randomUUID();
  const title = `E2E occupancy ${randomUUID()}`;
  const externalRequests: string[] = [];
  await page.context().route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      await route.continue();
    } else {
      externalRequests.push(url.origin);
      await route.abort("blockedbyclient");
    }
  });
  const project = {
    id: projectId,
    creator_id: fixture.organizationAdminUserId,
    title,
    location: "Fictional local capacity venue",
    description: "Synthetic signup-count acceptance fixture.",
    event_type: "oneTime",
    verification_method: "manual",
    project_timezone: "America/Los_Angeles",
    schedule: {
      oneTime: {
        date: "2090-06-15",
        startTime: "09:00",
        endTime: "10:00",
        volunteers: 2000,
      },
    },
    require_login: true,
    status: "upcoming",
    visibility: "public",
    workflow_status: "published",
  };
  const seed = await fixture.admin.from("projects").insert(project);
  expect(seed.error).toBeNull();
  try {
    const activeStatuses = ["pending", "approved", "attended"];
    const signups = Array.from({ length: 1235 }, (_, index) => ({
      project_id: projectId,
      user_id: fixture.organizationAdminUserId,
      schedule_id: "oneTime",
      status:
        index < 1205
          ? activeStatuses[index % 3]
          : index % 2
            ? "rejected"
            : "cancelled",
    }));
    for (let offset = 0; offset < signups.length; offset += 250) {
      const result = await fixture.admin
        .from("project_signups")
        .insert(signups.slice(offset, offset + 250));
      expect(result.error).toBeNull();
    }
    const capped = await fixture.admin
      .from("project_signups")
      .select("id", { count: "exact" })
      .eq("project_id", projectId);
    expect(capped.error).toBeNull();
    expect(capped.count).toBe(1235);
    expect(capped.data).toHaveLength(1000);

    let unavailableReplies = 0;
    await page.route("**/api/projects?*", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.origin === new URL(page.url()).origin &&
        route.request().method() === "GET" &&
        url.searchParams.get("search") === title &&
        unavailableReplies === 0
      ) {
        unavailableReplies++;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Projects are temporarily unavailable. Please try again.",
          }),
        });
      } else await route.fallback();
    });
    await loginAs(page, "member", "/home");
    const search = page
      .getByPlaceholder("Search projects...")
      .filter({ visible: true });
    await search.fill(title);
    await expect(
      page.getByRole("heading", {
        name: "Couldn't load projects",
        exact: true,
      }),
    ).toBeVisible();
    expect(unavailableReplies).toBe(1);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("2000 spots left", { exact: true }),
    ).toHaveCount(0);
    const retryResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/projects" &&
        url.searchParams.get("search") === title &&
        response.status() === 200
      );
    });
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    const returned = await (await retryResponse).json();
    const entry = returned.find(
      (value: { id: string }) => value.id === projectId,
    );
    expect(entry).toBeTruthy();
    expect(entry.slots_filled).toBe(1205);
    expect(entry.slots_filled_by_schedule).toEqual({ oneTime: 1205 });
    const card = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await expect(card).toHaveCount(1);
    await expect(
      card.getByText("795 spots left", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Couldn't load projects",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(externalRequests).toEqual([]);
  } finally {
    const signups = await fixture.admin
      .from("project_signups")
      .delete()
      .eq("project_id", projectId);
    expect(signups.error).toBeNull();
    const project = await fixture.admin
      .from("projects")
      .delete()
      .eq("id", projectId)
      .eq("creator_id", fixture.organizationAdminUserId)
      .eq("title", title);
    expect(project.error).toBeNull();
    const remaining = await fixture.admin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("id", projectId);
    expect(remaining.error).toBeNull();
    expect(remaining.count).toBe(0);
  }
});
