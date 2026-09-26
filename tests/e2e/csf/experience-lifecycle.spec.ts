import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { loadCsfFeedFixture } from "./feed-fixtures";
import {
  CSF_ORGANIZATION_PATH,
  loginAs,
  watchBrowserFailures,
  expectNoBrowserFailures,
} from "./helpers";

test("an open non-current term closes, reopens for correction, and closes again without changing the current term", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await loadCsfFeedFixture();
  const plugin = fixture.admin.schema("plugin_data");
  const { data: existing, error: termsError } = await plugin
    .from("csf_terms")
    .select("code")
    .eq("organization_id", fixture.organizationId);
  expect(termsError).toBeNull();
  const year = Array.from({ length: 19 }, (_, i) => 2080 + i).find(
    (value) =>
      !existing?.some((term) => term.code === `S${String(value).slice(-2)}`),
  );
  if (!year)
    throw new Error(
      "No unused fictional lifecycle term remains in this disposable stack.",
    );
  const termId = randomUUID();
  const label = `Synthetic lifecycle ${termId.slice(0, 8)}`;
  const { error: termError } = await plugin.from("csf_terms").insert({
    id: termId,
    organization_id: fixture.organizationId,
    code: `S${String(year).slice(-2)}`,
    label,
    school_year: `${year - 1}-${year}`,
    semester: "spring",
    is_current: false,
    starts_at: `${year}-01-01`,
    ends_at: `${year}-06-30`,
    lifecycle_status: "open",
  });
  expect(termError).toBeNull();
  const { data: policy, error: policyError } = await plugin
    .from("csf_term_policies")
    .select("*")
    .eq("organization_id", fixture.organizationId)
    .eq("term_id", fixture.currentTermId)
    .single();
  expect(policyError).toBeNull();
  const { error: copyError } = await plugin.from("csf_term_policies").insert({
    ...policy,
    id: randomUUID(),
    term_id: termId,
    dues_required: false,
  });
  expect(copyError).toBeNull();
  // Closure and audit receipts belong to this disposable stack. Never delete
  // immutable history to clean up a test; the owned stack teardown removes it.
  const failures = watchBrowserFailures(page);
  const path = `${CSF_ORGANIZATION_PATH}?tab=csf-terms&csf_term=${termId}`;
  await loginAs(page, "admin", path);
  await expect(
    page.getByRole("heading", { name: label, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start next term", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close term", exact: true }).click();
  const emptyClose = page.getByRole("dialog", { name: "Close this semester" });
  await expect(
    emptyClose.getByText("No memberships", { exact: true }),
  ).toBeVisible();
  await expect(
    emptyClose.getByRole("button", { name: "Close and snapshot term" }),
  ).toBeDisabled();
  await emptyClose.getByRole("button", { name: "Close", exact: true }).click();
  const { data: member, error: memberError } = await plugin
    .from("csf_term_memberships")
    .select("profile_id,cohort_id")
    .eq("organization_id", fixture.organizationId)
    .eq("term_id", fixture.currentTermId)
    .eq("status", "active")
    .limit(1)
    .single();
  expect(memberError).toBeNull();
  const { error: membershipError } = await plugin
    .from("csf_term_memberships")
    .insert({
      organization_id: fixture.organizationId,
      term_id: termId,
      profile_id: member!.profile_id,
      cohort_id: member!.cohort_id,
      status: "active",
    });
  expect(membershipError).toBeNull();
  await page.reload();
  const readTerm = () =>
    plugin
      .from("csf_terms")
      .select("lifecycle_status,is_current")
      .eq("organization_id", fixture.organizationId)
      .eq("id", termId)
      .single();
  for (let revision = 1; revision <= 2; revision++) {
    await page.getByRole("button", { name: "Close term", exact: true }).click();
    const close = page.getByRole("dialog", { name: "Close this semester" });
    await expect(close.locator('input[name="termId"]')).toHaveValue(termId);
    await close.getByLabel("Type CLOSE to confirm").fill("CLOSE");
    await close
      .getByRole("button", { name: "Close and snapshot term" })
      .click();
    await expect(close).toBeHidden();
    await expect
      .poll(async () => (await readTerm()).data?.lifecycle_status)
      .toBe("closed");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Add meeting", exact: true }),
    ).toHaveCount(0);
    if (revision === 1) {
      await page
        .getByRole("button", { name: "Reopen semester", exact: true })
        .click();
      const reopen = page.getByRole("dialog", {
        name: "Reopen a closed semester",
      });
      await expect(reopen.locator('input[name="termId"]')).toHaveValue(termId);
      await reopen
        .getByLabel("Correction reason", { exact: true })
        .fill(
          "Synthetic correction verifies the selected historical semester.",
        );
      await reopen.getByLabel("Type REOPEN to confirm").fill("REOPEN");
      await reopen
        .getByRole("button", { name: "Reopen for correction" })
        .click();
      await expect(reopen).toBeHidden();
      await expect
        .poll(async () => (await readTerm()).data?.lifecycle_status)
        .toBe("open");
      await page.reload();
    }
  }
  expect((await readTerm()).data?.is_current).toBe(false);
  const { data: current } = await plugin
    .from("csf_terms")
    .select("id")
    .eq("organization_id", fixture.organizationId)
    .eq("is_current", true)
    .single();
  expect(current?.id).toBe(fixture.currentTermId);
  const { count, error } = await plugin
    .from("csf_term_closures")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", fixture.organizationId)
    .eq("term_id", termId);
  expect(error).toBeNull();
  expect(count).toBe(2);
  expectNoBrowserFailures(failures);
});

test("club creation inherits the displayed semester and search works on a phone", async ({
  page,
}) => {
  await loginAs(
    page,
    "admin",
    `${CSF_ORGANIZATION_PATH}?tab=csf-partner-clubs`,
  );
  await page.getByRole("combobox", { name: "Semester", exact: true }).click();
  await page.getByRole("option", { name: "Spring 2026", exact: true }).click();
  await page.getByRole("button", { name: "Add club", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add club", exact: true });
  await expect(
    dialog.getByRole("combobox", { name: "Working term", exact: true }),
  ).toContainText("Spring 2026");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("searchbox", { name: "Search clubs", exact: true })
    .fill("no fictional club matches this name");
  await expect(
    page.getByText("No clubs match these filters in Spring 2026.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("incoming class setup creates eight semesters and archive requires confirmation with reversible history", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await loadCsfFeedFixture();
  const plugin = fixture.admin.schema("plugin_data");
  const { data: cohorts, error } = await plugin
    .from("csf_cohorts")
    .select("graduation_year")
    .eq("organization_id", fixture.organizationId);
  expect(error).toBeNull();
  const year = Array.from({ length: 15 }, (_, i) => 2035 + i).find(
    (value) => !cohorts?.some((item) => item.graduation_year === value),
  );
  if (!year) throw new Error("No unused fictional graduating class remains.");
  const label = `Synthetic incoming class ${year}`;
  await loginAs(page, "admin", `${CSF_ORGANIZATION_PATH}?tab=csf-cohorts`);
  await page.getByRole("button", { name: "Add a class", exact: true }).click();
  const create = page.getByRole("dialog", {
    name: "Set up a graduating class",
    exact: true,
  });
  await create.getByLabel("Graduation year", { exact: true }).fill("invalid");
  await create.getByLabel("Display name", { exact: true }).fill(label);
  await create
    .getByRole("button", { name: "Create class and semesters", exact: true })
    .click();
  await expect(create.getByRole("alert")).toBeVisible();
  await expect(create.getByLabel("Display name", { exact: true })).toHaveValue(
    label,
  );
  await expect(
    create.getByLabel("Graduation year", { exact: true }),
  ).toHaveValue("invalid");
  await create
    .getByLabel("Graduation year", { exact: true })
    .fill(String(year));
  await create
    .getByRole("button", { name: "Create class and semesters", exact: true })
    .click();
  await expect(create).toBeHidden();
  const { data: cohort, error: loadError } = await plugin
    .from("csf_cohorts")
    .select("id,status")
    .eq("organization_id", fixture.organizationId)
    .eq("graduation_year", year)
    .single();
  expect(loadError).toBeNull();
  expect(cohort?.status).toBe("active");
  const links = () =>
    plugin
      .from("csf_cohort_terms")
      .select("id", { count: "exact", head: true })
      .eq("cohort_id", cohort!.id)
      .eq("organization_id", fixture.organizationId);
  expect((await links()).count).toBe(8);
  await page.goto(`${CSF_ORGANIZATION_PATH}?tab=csf-terms`);
  await page.getByRole("button", { name: /Class administration/ }).click();
  const read = () =>
    plugin.from("csf_cohorts").select("status").eq("id", cohort!.id).single();
  await page
    .getByRole("button", { name: `Actions for ${label}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Archive class", exact: true })
    .click();
  const archive = page.getByRole("dialog", {
    name: `Archive ${label}?`,
    exact: true,
  });
  await expect(archive).toBeVisible();
  expect((await read()).data?.status).toBe("active");
  await archive.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await read()).data?.status).toBe("active");
  await page
    .getByRole("button", { name: `Actions for ${label}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Archive class", exact: true })
    .click();
  await archive
    .getByRole("button", { name: "Archive class", exact: true })
    .click();
  await expect(archive).toBeHidden();
  await expect.poll(async () => (await read()).data?.status).toBe("archived");
  expect((await links()).count).toBe(8);
  await page
    .getByRole("button", { name: "Archived graduating classes", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Actions for ${label}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore class", exact: true })
    .click();
  const restore = page.getByRole("dialog", {
    name: `Restore ${label}?`,
    exact: true,
  });
  await restore
    .getByRole("button", { name: "Restore class", exact: true })
    .click();
  await expect(restore).toBeHidden();
  await expect.poll(async () => (await read()).data?.status).toBe("active");
  expect((await links()).count).toBe(8);
});

test("Sheet sync exposes a failed status read and reloads without enabling a destination", async ({
  page,
}) => {
  await loginAs(page, "admin");
  let interrupt = true;
  await page.route("**/organization/dvhs-csf**", async (route) => {
    if (
      interrupt &&
      route.request().method() === "POST" &&
      route.request().headers()["next-action"]
    ) {
      await route.abort("failed");
    } else await route.continue();
  });
  await page.goto(`${CSF_ORGANIZATION_PATH}?tab=csf-settings`);
  const sync = page.getByRole("region", { name: "Sheet sync", exact: true });
  await expect(sync.getByRole("alert")).toContainText(
    "Sheet sync status could not be loaded",
  );
  interrupt = false;
  await sync
    .getByRole("button", { name: "Reload sync status", exact: true })
    .click();
  await expect(
    sync.getByText("No export destinations configured.", { exact: false }),
  ).toBeVisible();
  await expect(
    sync.getByRole("button", { name: "Turn off sync", exact: true }),
  ).toHaveCount(0);
});

test("initial term selection and starting the next term preserve the prior semester", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await loadCsfFeedFixture();
  const plugin = fixture.admin.schema("plugin_data");
  const { data: current, error } = await plugin
    .from("csf_terms")
    .select("id,label,lifecycle_status")
    .eq("id", fixture.currentTermId)
    .single();
  expect(error).toBeNull();
  expect(current?.lifecycle_status).toBe("open");
  try {
    const cleared = await plugin
      .from("csf_terms")
      .update({ is_current: false })
      .eq("id", fixture.currentTermId);
    expect(cleared.error).toBeNull();
    await loginAs(page, "admin", `${CSF_ORGANIZATION_PATH}?tab=csf-terms`);
    await page
      .getByRole("button", { name: "Choose current term", exact: true })
      .click();
    const initial = page.getByRole("dialog", {
      name: "Start a term",
      exact: true,
    });
    await initial
      .getByRole("combobox", { name: "Current term", exact: true })
      .click();
    await page
      .getByRole("option", { name: current!.label, exact: true })
      .click();
    await initial
      .getByRole("button", { name: "Set current term", exact: true })
      .click();
    await expect(initial).toBeHidden();
    await page.goto(`${CSF_ORGANIZATION_PATH}?tab=csf-terms`);
    await page
      .getByRole("button", { name: "Start next term", exact: true })
      .click();
    const next = page.getByRole("dialog", {
      name: "Start Spring 2027",
      exact: true,
    });
    await expect(next).toContainText(
      "stays open until you close it separately",
    );
    await next
      .getByRole("button", {
        name: /^(Make Spring 2027 current|Create and start Spring 2027)$/,
        exact: true,
      })
      .click();
    await expect(next).toBeHidden();
    const { data: prior } = await plugin
      .from("csf_terms")
      .select("is_current,lifecycle_status")
      .eq("id", fixture.currentTermId)
      .single();
    expect(prior).toMatchObject({
      is_current: false,
      lifecycle_status: "open",
    });
    await page.goto(
      `${CSF_ORGANIZATION_PATH}?tab=csf-terms&csf_term=${fixture.currentTermId}`,
    );
    await expect(
      page.getByRole("button", { name: "Close term", exact: true }),
    ).toBeEnabled();
  } finally {
    // Restore only this fixture's current-term pointer for subsequent journeys.
    const clear = await plugin
      .from("csf_terms")
      .update({ is_current: false })
      .eq("organization_id", fixture.organizationId)
      .eq("is_current", true);
    expect(clear.error).toBeNull();
    const restore = await plugin
      .from("csf_terms")
      .update({ is_current: true })
      .eq("id", fixture.currentTermId);
    expect(restore.error).toBeNull();
  }
});
