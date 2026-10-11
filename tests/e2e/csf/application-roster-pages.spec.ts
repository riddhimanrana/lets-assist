import { expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { main as provision } from "../../../scripts/hosted-development/provision-csf-load-fixtures.mjs";
import {
  buildSyntheticAccounts,
  fixtureOrganizationPath,
} from "../../../scripts/hosted-development/csf-load-fixture.mjs";
import { localTestPassword } from "./helpers";

test("large application lists retain every record, review scope and page position", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
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
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(fixtureOrganizationPath("?tab=csf-applications"));
  const pagination = page.getByRole("navigation", {
    name: "Applications list pages",
  });
  const rows = page.getByRole("button", { name: /^Member\d{4}, Load$/ });
  await expect(rows).toHaveCount(50);
  await expect(
    pagination.getByRole("button", { name: "Previous", exact: true }),
  ).toBeDisabled();

  const seen = new Set<string>();
  for (let index = 0; index < 20; index += 1) {
    await expect(pagination.getByRole("status")).toHaveText(
      `${(index * 50 + 1).toLocaleString("en-US")}–${((index + 1) * 50).toLocaleString("en-US")} of 1,000`,
    );
    for (const name of await rows.allTextContents()) {
      expect(seen.has(name)).toBe(false);
      seen.add(name);
    }
    if (index < 19) {
      await pagination
        .getByRole("button", { name: "Next", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(rows.first()).toBeFocused();
    }
  }
  expect(seen.size).toBe(1000);
  await expect(
    pagination.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  await rows.first().click();
  await expect(
    page.getByRole("button", { name: "Back to roster", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pagination.getByRole("status")).toHaveText("951–1,000 of 1,000");

  const search = page.getByRole("textbox", { name: "Search by name" });
  await search.fill("Member0051");
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveText("Member0051, Load");
  await expect(pagination).toHaveCount(0);
  await search.fill("");
  await expect(rows).toHaveCount(50);
  await expect(pagination.getByRole("status")).toHaveText("1–50 of 1,000");
  await rows.first().click();
  await expect(page.getByText("1 of 1000", { exact: false })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("2 of 1000", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(rows).toHaveCount(50);
  expect(browserErrors).toEqual([]);
});
