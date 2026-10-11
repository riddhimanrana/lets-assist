import { expect, test, type Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { main as provision } from "../../../scripts/hosted-development/provision-csf-load-fixtures.mjs";
import {
  buildSyntheticAccounts,
  fixtureOrganizationPath,
} from "../../../scripts/hosted-development/csf-load-fixture.mjs";
import { localTestPassword } from "./helpers";

const member = (position: number) =>
  `Member${String(position).padStart(4, "0")}`;

/** Provision the synthetic campaign and sign the fictional officer in. */
async function signInToLoadFixture(page: Page, baseURL: string | undefined) {
  if (!baseURL) throw new Error("The isolated app origin is required.");
  const isolated = getCsfIsolatedSupabaseEnv();
  const password = localTestPassword();
  // The existing provisioner proves loopback and its synthetic organization
  // boundary. These records live only until the owned test stack is removed.
  await provision(
    {
      SUPABASE_URL: isolated.url,
      SUPABASE_SERVICE_ROLE_KEY: isolated.serviceRoleKey,
      CSF_HOSTED_LOAD_PASSWORD: password,
      CSF_LOCAL_LOAD_PROVISION_CONFIRMATION:
        "provision-isolated-local:csf-load-fixture",
    },
    { isolatedLocal: true },
  );
  const cookieStore = new Map<string, string>();
  const client = createServerClient(isolated.url, isolated.anonKey, {
    cookies: {
      getAll: () => [...cookieStore].map(([name, value]) => ({ name, value })),
      setAll: (values) => {
        for (const { name, value } of values) cookieStore.set(name, value);
      },
    },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: buildSyntheticAccounts().officers[0].email,
    password,
  });
  if (error || !data.session)
    throw new Error("The synthetic local officer session failed.");
  await page
    .context()
    .addCookies(
      [...cookieStore].map(([name, value]) => ({ name, value, url: baseURL })),
    );
}

function applicationsList(page: Page) {
  const pagination = page.getByRole("navigation", {
    name: "Applications list pages",
  });
  return {
    pagination,
    status: pagination.getByRole("status"),
    previous: pagination.getByRole("button", { name: "Previous", exact: true }),
    next: pagination.getByRole("button", { name: "Next", exact: true }),
    rows: page.getByRole("button", { name: /^Member\d{4}, Load$/ }),
    search: page.getByRole("textbox", { name: "Search by name" }),
    backToRoster: page.getByRole("button", {
      name: "Back to roster",
      exact: true,
    }),
    cursorOf: () => new URL(page.url()).searchParams.get("csf_review_cursor"),
  };
}

test("a large application list is paged by the server, and review walks all of it", async ({
  page,
  baseURL,
}) => {
  // The allowance this spec has always had. Nothing here extends it.
  test.setTimeout(120_000);
  await signInToLoadFixture(page, baseURL);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto(fixtureOrganizationPath("?tab=csf-applications"));
  const {
    pagination,
    status,
    previous,
    next,
    rows,
    search,
    backToRoster,
    cursorOf,
  } = applicationsList(page);

  // --- One bounded page reaches the browser --------------------------------
  await expect(rows).toHaveCount(50);
  await expect(status).toHaveText("1–50 of 1,000");
  await expect(previous).toBeDisabled();
  expect(cursorOf()).toBeNull();
  // The response holds the first page and nothing else: no later applicant is
  // anywhere in the document, including the serialized component payload.
  const firstDocument = await page.content();
  expect(firstDocument).toContain(member(50));
  expect(firstDocument).not.toContain(member(51));
  expect(firstDocument).not.toContain(member(1000));

  // --- Every record is reachable through server URLs -----------------------
  const seen = new Set<string>();
  const cursors = new Set<string>();
  for (let index = 0; index < 20; index += 1) {
    await expect(status).toHaveText(
      `${(index * 50 + 1).toLocaleString("en-US")}–${((index + 1) * 50).toLocaleString("en-US")} of 1,000`,
    );
    await expect(rows).toHaveCount(50);
    for (const name of await rows.allTextContents()) {
      expect(seen.has(name)).toBe(false);
      seen.add(name);
    }
    if (index < 19) {
      await next.focus();
      await page.keyboard.press("Enter");
      // The page position is in the URL, and focus lands on the new page.
      await expect(rows.first()).toHaveText(
        `${member((index + 1) * 50 + 1)}, Load`,
      );
      await expect(rows.first()).toBeFocused();
      // A forward cursor names the boundary row by id and sort values, not by
      // a position that could shift under it.
      const cursor = cursorOf();
      expect(cursor).toMatch(/^a\.0\.[0-9a-f-]{36}\.[\w-]*\.[\w-]*$/);
      expect(cursors.has(cursor!)).toBe(false);
      cursors.add(cursor!);
    }
  }
  expect(seen.size).toBe(1000);
  await expect(next).toBeDisabled();

  // --- The page survives reload and browser history ------------------------
  await page.reload();
  await expect(status).toHaveText("951–1,000 of 1,000");
  await expect(rows.first()).toHaveText(`${member(951)}, Load`);
  await page.goBack();
  await expect(status).toHaveText("901–950 of 1,000");
  await page.goForward();
  await expect(status).toHaveText("951–1,000 of 1,000");
  // Paging back uses a backward cursor and returns the same rows.
  await previous.click();
  await expect(status).toHaveText("901–950 of 1,000");
  await expect(rows.first()).toHaveText(`${member(901)}, Load`);
  expect(cursorOf()).toMatch(/^b\.0\.[0-9a-f-]{36}\.[\w-]*\.[\w-]*$/);
  await next.click();
  await expect(status).toHaveText("951–1,000 of 1,000");

  // --- Review walks the whole list, not the page ---------------------------
  await rows.first().click();
  await expect(backToRoster).toBeVisible();
  // Entered from the 951st record of 1,000: the queue is the whole list.
  await expect(page.getByText("951 of 1000", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: `Load ${member(951)}` }),
  ).toBeVisible();
  // Step back across the page boundary to a record this page never held.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("950 of 1000", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: `Load ${member(950)}` }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("952 of 1000", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: `Load ${member(952)}` }),
  ).toBeVisible();
  // Leaving review returns to the same page, with focus on the row entered from.
  await page.keyboard.press("Escape");
  await expect(status).toHaveText("951–1,000 of 1,000");
  await expect(rows.first()).toHaveText(`${member(951)}, Load`);
  await expect(rows.first()).toBeFocused();

  // --- Search reaches later rows and resets the cursor ---------------------
  expect(cursorOf()).not.toBeNull();
  await search.fill(member(51));
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveText(`${member(51)}, Load`);
  await expect(pagination).toHaveCount(0);
  await expect(page).toHaveURL(/csf_review_q=Member0051/);
  expect(cursorOf()).toBeNull();
  // The scope count is the semester's, not the search's.
  await expect(page.getByRole("button", { name: "All (1000)" })).toBeVisible();

  // A search whose matches span two pages pages inside the search.
  await search.fill("Member09");
  await expect(status).toHaveText("1–50 of 100");
  await expect(rows.first()).toHaveText(`${member(900)}, Load`);
  await next.click();
  await expect(status).toHaveText("51–100 of 100");
  await expect(rows.first()).toHaveText(`${member(950)}, Load`);
  expect(cursorOf()).not.toBeNull();
  await expect(page).toHaveURL(/csf_review_q=Member09/);
  // A new search from the second page starts at its own first page.
  await search.fill("Member095");
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toHaveText(`${member(950)}, Load`);
  expect(cursorOf()).toBeNull();

  await search.fill("");
  await expect(rows).toHaveCount(50);
  await expect(status).toHaveText("1–50 of 1,000");
  await rows.first().click();
  await expect(page.getByText("1 of 1000", { exact: false })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("2 of 1000", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(rows).toHaveCount(50);
  expect(browserErrors).toEqual([]);
});

test("a lost review request is said plainly and is safe to retry", async ({
  page,
  baseURL,
}) => {
  // A separate scenario with the same allowance, not a longer one.
  test.setTimeout(120_000);
  await signInToLoadFixture(page, baseURL);
  await page.goto(fixtureOrganizationPath("?tab=csf-applications"));
  const { rows, backToRoster } = applicationsList(page);
  await expect(rows).toHaveCount(50);

  // Drop exactly one Server Action request, the way a flaky connection would.
  let dropNextAction = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (
      dropNextAction &&
      request.method() === "POST" &&
      request.headers()["next-action"]
    ) {
      dropNextAction = false;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  // Named by its text: the framework's own route announcer is also an alert.
  const lostRequest = page.getByText("The request did not reach the server.", {
    exact: false,
  });

  // Entering review: the queue does not open, the list stays, and the reason
  // is announced. Nothing was written, so the same click simply works.
  dropNextAction = true;
  await rows.first().click();
  await expect(lostRequest).toBeVisible();
  await expect(backToRoster).toHaveCount(0);
  await expect(rows).toHaveCount(50);
  await expect(rows.first()).toBeEnabled();
  await rows.first().click();
  await expect(backToRoster).toBeVisible();
  await expect(
    page.getByRole("heading", { name: `Load ${member(1)}` }),
  ).toBeVisible();

  // Opening the next record: the queue keeps its place, shows why the record
  // is missing, offers no decision against it, and loads it on retry.
  dropNextAction = true;
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("2 of 1000", { exact: false })).toBeVisible();
  await expect(lostRequest).toBeVisible();
  await expect(
    page.getByRole("heading", { name: `Load ${member(2)}` }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: `Load ${member(1)}` }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: `Load ${member(2)}` }),
  ).toBeVisible();
  await expect(lostRequest).toHaveCount(0);
  await page.unroute("**/*");
});
