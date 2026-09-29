import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  loginAs,
  localActors,
  watchBrowserFailures,
} from "./helpers";

/**
 * The current semester's verified point total for the fixture member, read from
 * the ledger instead of assumed.
 *
 * The seed gives this student no current-semester points, but the browser stack
 * is reused across suite runs and earlier point journeys leave real verified
 * awards on the current term. Those are evidence, not noise: the expectation is
 * derived exactly rather than pinned to the seed's zero or loosened to a bound.
 * Last semester stays hardcoded, because nothing writes to a past term.
 */
let currentTermPoints: number;

test.beforeAll(async () => {
  const local = getCsfIsolatedSupabaseEnv();
  const admin: SupabaseClient = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const checked = <T>(result: {
    data: T;
    error: { message: string } | null;
  }) => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };

  const organization = checked(
    await admin
      .from("organizations")
      .select("id")
      .eq("username", "dvhs-csf")
      .single(),
  ) as { id: string };
  const plugin = admin.schema("plugin_data");
  // The canonical fixture student, found the way the seed identifies them.
  const profile = checked(
    await plugin
      .from("csf_profiles")
      .select("id")
      .eq("organization_id", organization.id)
      .eq("normalized_personal_email", localActors.member.email)
      .single(),
  ) as { id: string };
  const currentTerm = checked(
    await plugin
      .from("csf_terms")
      .select("id")
      .eq("organization_id", organization.id)
      .eq("is_current", true)
      .single(),
  ) as { id: string };
  const credits = (checked(
    await plugin
      .from("csf_credit_records")
      .select("points, point_type")
      .eq("organization_id", organization.id)
      .eq("profile_id", profile.id)
      .eq("term_id", currentTerm.id)
      .eq("status", "verified"),
  ) ?? []) as Array<{ points: number | string | null; point_type: string }>;

  // The counted total applies a drive cap that the profile model owns. A drive
  // credit would make this plain sum wrong, so the derivation refuses that case
  // rather than quietly reimplementing the cap here.
  expect(
    credits.filter((credit) => credit.point_type === "drive"),
    "Deriving approved progress from a plain sum requires no drive credits on the current term",
  ).toHaveLength(0);
  currentTermPoints = credits.reduce(
    (total, credit) => total + Math.max(0, Number(credit.points) || 0),
    0,
  );
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`My CSF keeps the profile and history on one semester at ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const failures = watchBrowserFailures(page);
    await loginAs(page, "member", `${CSF_ORGANIZATION_PATH}?csf_tour=member`);
    const tour = page.getByRole("dialog", { name: "Member workspace tour" });
    await expect(tour).toBeVisible();
    await tour.getByRole("button", { name: "Skip tour", exact: true }).click();
    await expect(tour).toBeHidden();
    let releaseScripts!: () => void;
    const scriptsReady = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    await page.route("**/_next/static/**/*.js", async (route) => {
      await scriptsReady;
      await route.continue();
    });
    try {
      await page.goto(`${CSF_ORGANIZATION_PATH}?tab=csf-profile`, {
        waitUntil: "commit",
      });
      const spring = page
        .getByRole("tablist", { name: "Member semesters" })
        .getByRole("tab", { name: "Spring 2026", exact: true });
      await expect(spring).toBeVisible();
      await expect(spring).toBeDisabled();
    } finally {
      releaseScripts();
    }
    await expect(page).toHaveURL(/tab=csf-profile/);
    const profile = page.getByRole("region", { name: "CSF member profile" });
    const semesters = page.getByRole("tablist", { name: "Member semesters" });
    const semester = page.getByRole("tabpanel");

    await expect(
      profile.getByRole("heading", { name: "Aarav Mehta", exact: true }),
    ).toBeVisible();
    await expect(
      profile.getByText("Class of 2028", { exact: true }),
    ).toBeVisible();
    await expect(
      profile.getByText("Service points", { exact: true }),
    ).toHaveCount(0);
    await expect(profile.getByText("Activities", { exact: true })).toHaveCount(
      0,
    );
    await expect(profile.getByText("Meetings", { exact: true })).toHaveCount(0);
    // Existing current-term submissions can make Fall the opening semester.
    await semesters
      .getByRole("tab", { name: "Spring 2026", exact: true })
      .click();
    await expect(
      semester.getByRole("heading", { name: "Spring 2026", exact: true }),
    ).toBeVisible();
    await expect(
      semesters.getByRole("tab", { name: "Spring 2026", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      semester.getByText("2 verified points", { exact: true }),
    ).toBeVisible();
    await expect(semester.getByRole("progressbar")).toHaveCount(0);
    await expect(
      semester
        .getByText("Quail Run Suessical Musical", { exact: true })
        .first(),
    ).toBeVisible();
    await expect(
      semester.getByText("Spring General Meeting", { exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`profile-history-${viewport.name}.png`),
    });

    await semesters.getByRole("tab", { name: /^Fall 2026/ }).click();
    await expect(
      semester.getByRole("heading", { name: "Fall 2026", exact: true }),
    ).toBeVisible();
    // Exactly the current semester's own ledger, so last semester's 2 points
    // cannot satisfy it and a real award cannot be mistaken for a leak.
    const progress = semester.getByRole("progressbar", {
      name: "Submitted and approved service points",
    });
    await expect(progress).toBeVisible();
    await expect
      .poll(
        async () =>
          (await progress.getAttribute("aria-valuetext"))?.split(", ")[1],
      )
      .toBe(`${currentTermPoints} approved`);
    await expect(
      semester.getByText("Quail Run Suessical Musical", { exact: true }),
    ).toHaveCount(0);
    await expect(
      semester.getByText("Spring General Meeting", { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`profile-current-${viewport.name}.png`),
    });

    await semesters
      .getByRole("tab", { name: "Spring 2026", exact: true })
      .click();
    await expect(
      semester.getByRole("heading", { name: "Spring 2026", exact: true }),
    ).toBeVisible();
    await expect(
      semester.getByText("2 verified points", { exact: true }),
    ).toBeVisible();
    await expect(semester.getByRole("progressbar")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expectNoBrowserFailures(failures);
  });
}
