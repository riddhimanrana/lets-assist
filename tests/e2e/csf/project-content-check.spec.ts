import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { loadCsfFeedFixture } from "./feed-fixtures";
import {
  expectNoBrowserFailures,
  localActors,
  localTestPassword,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

async function verifyProjectReviewPrivacy(page: Page, projectId: string) {
  const local = getCsfIsolatedSupabaseEnv();
  const browser = page.context().browser();
  if (!browser) throw new Error("The local browser is unavailable.");
  const publicContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const publicPage = await publicContext.newPage();
  const errors: string[] = [];
  const allowedOrigins = [
    new URL(page.url()).origin,
    new URL(local.url).origin,
  ];
  await publicContext.route("**/*", async (route) => {
    if (allowedOrigins.includes(new URL(route.request().url()).origin)) {
      await route.continue();
    } else {
      errors.push("An external browser request was blocked.");
      await route.abort("blockedbyclient");
    }
  });
  const privateColumns = ["review_notes", "reviewed_by", "reviewed_at"];
  const isExpectedRefusal = (raw: string) => {
    try {
      const url = new URL(raw);
      return (
        url.origin === new URL(local.url).origin &&
        url.pathname === "/rest/v1/projects" &&
        url.searchParams.get("id") === `eq.${projectId}` &&
        privateColumns.includes(url.searchParams.get("select") ?? "")
      );
    } catch {
      return false;
    }
  };
  publicPage.on("pageerror", (error) => errors.push(error.message));
  publicPage.on("console", (message) => {
    if (message.type() !== "error") return;
    if (
      isExpectedRefusal(message.location().url) &&
      message.text().includes("status of 403")
    )
      return;
    errors.push(message.text());
  });
  publicPage.on("response", (response) => {
    if (
      response.status() >= 400 &&
      !(response.status() === 403 && isExpectedRefusal(response.url()))
    )
      errors.push(`Unexpected browser status ${response.status()}`);
  });
  publicPage.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED")
      errors.push("A browser request failed.");
  });
  const publicProjectId = "10000000-0000-4000-8000-000000000020";
  try {
    await publicPage.goto(`/projects/${publicProjectId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      publicPage.getByRole("heading", {
        name: "Santa Cruz Beach Cleanup",
        exact: true,
      }),
    ).toBeVisible();
    const discovery = await publicPage.evaluate(async () => {
      const response = await fetch(
        "/api/projects?search=Santa%20Cruz%20Beach%20Cleanup&limit=10",
      );
      return { status: response.status, data: await response.json() };
    });
    expect(discovery.status).toBe(200);
    expect(
      discovery.data.some(
        (project: { id: string }) => project.id === publicProjectId,
      ),
    ).toBe(true);
    for (const project of discovery.data) {
      for (const column of privateColumns)
        expect(project).not.toHaveProperty(column);
    }
    for (const actor of ["admin", "outsider"] as const) {
      const client = createClient(local.url, local.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const signedIn = await client.auth.signInWithPassword({
        email: localActors[actor].email,
        password: localTestPassword(),
      });
      const bearer = signedIn.data.session?.access_token;
      if (signedIn.error || !bearer)
        throw new Error("The fictional REST session is unavailable.");
      const result = await publicPage.evaluate(
        async ({
          url,
          anonKey,
          bearer,
          projectId,
          publicProjectId,
          privateColumns,
        }) => {
          const headers = {
            apikey: anonKey,
            Authorization: `Bearer ${bearer}`,
          };
          const readable = await fetch(
            `${url}/rest/v1/projects?id=eq.${publicProjectId}&select=id,title`,
            { headers },
          );
          const readableBody = await readable.json();
          const refusals = [];
          for (const column of privateColumns) {
            const response = await fetch(
              `${url}/rest/v1/projects?id=eq.${projectId}&select=${column}`,
              { headers },
            );
            const body = await response.json();
            refusals.push({ column, status: response.status, code: body.code });
          }
          return { readableStatus: readable.status, readableBody, refusals };
        },
        {
          url: local.url,
          anonKey: local.anonKey,
          bearer,
          projectId,
          publicProjectId,
          privateColumns,
        },
      );
      expect(result.readableStatus).toBe(200);
      expect(result.readableBody).toEqual([
        { id: publicProjectId, title: "Santa Cruz Beach Cleanup" },
      ]);
      expect(result.refusals).toEqual(
        privateColumns.map((column) => ({
          column,
          status: 403,
          code: "42501",
        })),
      );
    }
    expect(errors).toEqual([]);
  } finally {
    await publicContext.close();
  }
}

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
  const editedTitle = `${title} revised`;
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
      .select("id,title,workflow_status")
      .eq("creator_id", ownerId)
      .in("title", [title, editedTitle])
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
    const projectId = created[0].id;
    const reviewNote = `private-review-${randomUUID()}`;
    const { error: reviewError } = await fixture.admin
      .from("projects")
      .update({
        review_notes: reviewNote,
        reviewed_by: ownerId,
        reviewed_at: "2038-02-03T04:05:06Z",
      })
      .eq("id", projectId)
      .eq("creator_id", ownerId);
    if (reviewError)
      throw new Error("Could not seed the private review sentinel.");
    const detail = await page.request.get(`/projects/${projectId}`);
    expect(detail.status()).toBe(200);
    const html = await detail.text();
    expect(html).toContain(title);
    expect(html).not.toContain(reviewNote);
    await verifyProjectReviewPrivacy(page, projectId);

    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Created", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.goto(`/projects/${projectId}/edit`, {
      waitUntil: "domcontentloaded",
    });
    const titleInput = page.getByLabel("Project Title", { exact: true });
    await expect(titleInput).toHaveValue(title);
    await titleInput.fill(editedTitle);
    const save = page.getByRole("button", {
      name: "Save Changes",
      exact: true,
    });
    await expect(save).toBeEnabled();
    await save.click();
    await page.waitForURL(`**/projects/${projectId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: editedTitle, exact: true }),
    ).toBeVisible();
    expect(await readProjects()).toEqual([
      { id: projectId, title: editedTitle, workflow_status: "published" },
    ]);

    await page.goto(`/projects/${projectId}/edit`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("button", { name: "Delete Project", exact: true })
      .click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toBeVisible();
    await confirmation
      .getByRole("button", { name: "Delete Project", exact: true })
      .click();
    await page.waitForURL("**/home", { waitUntil: "domcontentloaded" });
    expect(await readProjects()).toEqual([]);
    expect(externalRequests).toEqual([]);
    expectNoBrowserFailures(failures);
  } finally {
    await page.close();
    await cleanupOwnedFixtures();
  }
});
