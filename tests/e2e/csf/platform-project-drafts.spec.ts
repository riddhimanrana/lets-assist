import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { loadCsfFeedFixture, type CsfFeedFixture } from "./feed-fixtures";
import {
  localActors,
  loginAs,
  watchBrowserFailures,
  expectNoBrowserFailures,
} from "./helpers";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
let fixture: CsfFeedFixture;
let ownerId: string;
let prefix: string;
let originalId: string;

function draftId(page: Page) {
  return new URL(page.url()).searchParams.get("draft");
}

async function readDraft(id: string) {
  const { data, error } = await fixture.admin
    .from("project_drafts")
    .select("id,title,draft_data")
    .eq("id", id)
    .eq("user_id", ownerId)
    .single();
  if (error || !data)
    throw new Error("Could not read the owned fictional draft.");
  return data;
}

test.beforeAll(async () => {
  fixture = await loadCsfFeedFixture();
  const { data, error } = await fixture.admin
    .from("profiles")
    .select("id")
    .eq("email", localActors.admin.email)
    .single();
  if (error || !data)
    throw new Error("The named local admin profile is missing.");
  ownerId = data.id;
});

test.beforeEach(async () => {
  prefix = `E2E project draft ${randomUUID()}`;
  originalId = randomUUID();
  const title = `${prefix} original`;
  const { error } = await fixture.admin.from("project_drafts").insert({
    id: originalId,
    user_id: ownerId,
    title,
    draft_data: {
      step: 1,
      basicInfo: {
        title,
        organizationId: fixture.organizationId,
        description: "Fictional draft for editor isolation checks.",
        location: "Local fixture venue",
        projectTimezone: "America/Los_Angeles",
      },
    },
  });
  if (error) throw new Error("Could not seed the owned fictional draft.");
});

test.afterEach(async ({ page }) => {
  // Close the editor before cleanup so a pending autosave cannot recreate a row.
  await page.close();
  const { data, error } = await fixture.admin
    .from("project_drafts")
    .select("id")
    .eq("user_id", ownerId)
    .like("title", `${prefix}%`)
    .limit(20);
  if (error || !data)
    throw new Error("Could not list owned draft fixtures for cleanup.");
  if (data.length === 20)
    throw new Error("Draft fixture cleanup bound exceeded.");
  if (data.length === 0) return;
  const { error: deleteError } = await fixture.admin
    .from("project_drafts")
    .delete()
    .eq("user_id", ownerId)
    .in(
      "id",
      data.map((row) => row.id),
    );
  if (deleteError) throw new Error("Could not remove owned draft fixtures.");
});

test("new personal creation leaves the latest organization draft untouched through autosave and reload", async ({
  page,
}) => {
  const failures = watchBrowserFailures(page);
  await loginAs(page, "admin");
  await page.goto("/projects/create", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("e2e-project-mock")).toHaveCount(0);
  const title = page.getByLabel("Project Title", { exact: true });
  await expect(title).toHaveValue("");
  await expect(
    page.getByRole("combobox").filter({ hasText: "Personal Project" }),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("creation"))
    .toMatch(uuid);
  const creation = new URL(page.url()).searchParams.get("creation");
  expect(draftId(page)).toBeNull();

  const newTitle = `${prefix} personal`;
  await title.fill(newTitle);
  await expect.poll(() => draftId(page), { timeout: 15_000 }).toMatch(uuid);
  const savedId = draftId(page)!;
  expect(savedId).not.toBe(originalId);
  expect((await readDraft(originalId)).draft_data.basicInfo).toMatchObject({
    title: `${prefix} original`,
    organizationId: fixture.organizationId,
  });
  expect((await readDraft(savedId)).draft_data.basicInfo).toMatchObject({
    title: newTitle,
    organizationId: null,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(title).toHaveValue(newTitle);
  expect(draftId(page)).toBe(savedId);
  expect(new URL(page.url()).searchParams.get("creation")).toBe(creation);
  expect((await readDraft(originalId)).title).toBe(`${prefix} original`);
  expectNoBrowserFailures(failures);
});

test("edits made while the first autosave settles are persisted to that draft", async ({
  page,
}) => {
  const failures = watchBrowserFailures(page);
  await loginAs(page, "admin");
  await page.goto("/projects/create", { waitUntil: "domcontentloaded" });
  const title = page.getByLabel("Project Title", { exact: true });
  await expect(title).toHaveValue("");
  let held = false;
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let delivered = () => {};
  const delivery = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route("**/projects/create?**", async (route) => {
    if (route.request().method() !== "POST" || held) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    held = true;
    await released;
    try {
      await route.fulfill({ response });
    } finally {
      delivered();
    }
  });
  try {
    await title.fill(`${prefix} first write`);
    await expect.poll(() => held, { timeout: 15_000 }).toBe(true);
    const editedTitle = `${prefix} edited during first write`;
    await title.fill(editedTitle);
    release();
    await delivery;
    await expect.poll(() => draftId(page), { timeout: 15_000 }).toMatch(uuid);
    const savedId = draftId(page)!;
    await expect
      .poll(async () => (await readDraft(savedId)).title, { timeout: 15_000 })
      .toBe(editedTitle);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(title).toHaveValue(editedTitle);
    expect((await readDraft(originalId)).title).toBe(`${prefix} original`);
    expectNoBrowserFailures(failures);
  } finally {
    release();
    if (held) await delivery;
  }
});

test("save as new draft moves subsequent autosave to the copy and preserves explicit resume", async ({
  page,
}) => {
  const failures = watchBrowserFailures(page);
  await loginAs(page, "admin");
  await page.goto(`/projects/create?draft=${originalId}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("e2e-project-mock")).toHaveCount(0);
  const title = page.getByLabel("Project Title", { exact: true });
  await expect(title).toHaveValue(`${prefix} original`);
  await expect(
    page.getByRole("combobox").filter({ hasText: "DVHS CSF" }),
  ).toBeVisible();
  const creationId = new URL(page.url()).searchParams.get("creation");
  expect(creationId).toMatch(uuid);
  const actionUrls: URL[] = [];
  const documentNavigations: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/projects/create")
      actionUrls.push(url);
    if (
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame() &&
      url.pathname === "/projects/create"
    )
      documentNavigations.push(url);
  });
  await page
    .getByRole("button", { name: "Save as new draft", exact: true })
    .click();
  await expect
    .poll(() => draftId(page), { timeout: 15_000 })
    .not.toBe(originalId);
  const copyId = draftId(page);
  expect(copyId).toMatch(uuid);
  expect(new URL(page.url()).searchParams.get("creation")).toBe(creationId);
  const editedTitle = `${prefix} copied and edited`;
  await title.fill(editedTitle);
  await expect
    .poll(async () => (await readDraft(copyId!)).title, { timeout: 15_000 })
    .toBe(editedTitle);
  await expect(title).toHaveValue(editedTitle);
  expect(actionUrls.length).toBeGreaterThanOrEqual(2);
  expect(
    actionUrls.every((url) => url.searchParams.get("creation") === creationId),
  ).toBe(true);
  expect(
    actionUrls.some((url) => url.searchParams.get("draft") === copyId),
  ).toBe(true);
  expect((await readDraft(originalId)).title).toBe(`${prefix} original`);
  expect((await readDraft(copyId!)).draft_data.basicInfo.organizationId).toBe(
    fixture.organizationId,
  );
  expect(documentNavigations).toEqual([]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(title).toHaveValue(editedTitle);
  expect(draftId(page)).toBe(copyId);
  expect((await readDraft(originalId)).title).toBe(`${prefix} original`);
  expectNoBrowserFailures(failures);
});
