import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { loadCsfFeedFixture } from "./feed-fixtures";
import {
  expectNoBrowserFailures,
  localActors,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

test("content rejection keeps the draft and a valid retry creates one project", async ({
  page,
}) => {
  const fixture = await loadCsfFeedFixture();
  const { data: owner, error: ownerError } = await fixture.admin
    .from("profiles")
    .select("id")
    .eq("email", localActors.admin.email)
    .single();
  if (ownerError || !owner) throw new Error("The fictional owner is missing.");

  const ownerId = owner.id;
  const draftId = randomUUID();
  const title = `E2E local content ${randomUUID()}`;
  const content = {
    title,
    location: "Local fixture venue",
    description: "Fictional community garden project for local acceptance.",
  };
  const { error: seedError } = await fixture.admin
    .from("project_drafts")
    .insert({
      id: draftId,
      user_id: ownerId,
      title,
      draft_data: {
        step: 5,
        eventType: "oneTime",
        basicInfo: {
          ...content,
          organizationId: null,
          projectTimezone: "America/Los_Angeles",
        },
        schedule: {
          oneTime: {
            date: "2090-06-15",
            startTime: "09:00",
            endTime: "10:00",
            volunteers: 2,
          },
        },
      },
    });
  if (seedError)
    throw new Error("Could not seed the owned content-check draft.");

  const readProjects = async () => {
    const { data, error } = await fixture.admin
      .from("projects")
      .select("id,title,published,workflow_status")
      .eq("creator_id", ownerId)
      .eq("title", title)
      .limit(3);
    if (error || !data)
      throw new Error("Could not read the owned content-check projects.");
    return data;
  };

  async function cleanupOwnedFixtures() {
    const projects = await readProjects();
    if (projects.length === 3)
      throw new Error("Project cleanup bound exceeded.");
    const cleanup = await Promise.all([
      fixture.admin
        .from("project_drafts")
        .delete()
        .eq("id", draftId)
        .eq("user_id", ownerId),
      projects.length
        ? fixture.admin
            .from("projects")
            .delete()
            .eq("creator_id", ownerId)
            .in(
              "id",
              projects.map((project) => project.id),
            )
        : Promise.resolve({ error: null }),
    ]);
    if (cleanup.some((result) => result.error))
      throw new Error("Could not remove an owned content-check fixture.");
  }

  try {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin", `/projects/create?draft=${draftId}`);
    await expect(
      page.getByText("Step 5 of 5: Finalize", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("e2e-project-mock")).toHaveCount(0);
    const origin = new URL(page.url()).origin;
    let contentRequests = 0;
    let rejectedRequests = 0;

    await page.route("**/projects/create?**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.origin !== origin ||
        url.pathname !== "/projects/create" ||
        request.method() !== "POST" ||
        !request.headers()["next-action"]
      ) {
        await route.continue();
        return;
      }
      let argumentsValue: unknown;
      try {
        argumentsValue = request.postDataJSON();
      } catch {
        await route.continue();
        return;
      }
      const candidate =
        Array.isArray(argumentsValue) && argumentsValue.length === 1
          ? argumentsValue[0]
          : null;
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Object.keys(candidate).sort().join(",") !==
          "description,location,title" ||
        candidate.title !== content.title ||
        candidate.location !== content.location ||
        candidate.description !== content.description
      ) {
        await route.continue();
        return;
      }
      contentRequests++;
      if (rejectedRequests === 0) {
        rejectedRequests++;
        // Forward invalid input to the real action and retain its real response.
        await route.continue({
          postData: JSON.stringify([{ ...candidate, title: "a".repeat(126) }]),
        });
        return;
      }
      await route.continue();
    });

    const create = page.getByRole("button", { name: "Create", exact: true });
    await create.click();
    await expect(
      page.getByText(
        "Check the title, location, and description lengths and try again.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(rejectedRequests).toBe(1);
    expect(contentRequests).toBe(1);
    expect(await readProjects()).toEqual([]);
    expect(new URL(page.url()).pathname).toBe("/projects/create");
    const { data: retained, error: retainedError } = await fixture.admin
      .from("project_drafts")
      .select("id,title")
      .eq("id", draftId)
      .eq("user_id", ownerId)
      .single();
    expect(retainedError).toBeNull();
    expect(retained).toEqual({ id: draftId, title });

    await expect(create).toBeEnabled();
    await create.click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/u, {
      waitUntil: "domcontentloaded",
    });
    const created = await readProjects();
    expect(created).toHaveLength(1);
    expect(new URL(page.url()).pathname).toBe(`/projects/${created[0].id}`);
    expect(created[0].published).toBe(true);
    expect(created[0].workflow_status).toBe("published");
    expect(contentRequests).toBe(2);
    expect(rejectedRequests).toBe(1);
    const { data: consumed, error: consumedError } = await fixture.admin
      .from("project_drafts")
      .select("id")
      .eq("id", draftId)
      .eq("user_id", ownerId);
    expect(consumedError).toBeNull();
    expect(consumed).toEqual([]);
    expectNoBrowserFailures(failures);
  } finally {
    await page.close();
    await cleanupOwnedFixtures();
  }
});
