import { expect, test, type Page } from "@playwright/test";

import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  expectNoHorizontalOverflow,
  expectNoPrivateBoundaryMarkers,
  loginAs,
  type LocalActor,
  watchBrowserFailures,
} from "./helpers";

const canonicalTabs = [
  "Home",
  "Applications",
  "Members",
  "Service",
  "Classes",
] as const;

const canonicalMoreItems = [
  "Imports",
  "Reports",
  "Staff access",
  "Change history",
  "Communications",
  "Settings",
  "Help",
] as const;

type CanonicalTab = (typeof canonicalTabs)[number];
type CanonicalMoreItem = (typeof canonicalMoreItems)[number];

type StaffRoleNavigationScenario = {
  actor: LocalActor;
  label: string;
  visibleTabs: readonly CanonicalTab[];
  visibleMoreItems: readonly CanonicalMoreItem[];
  deniedRoute: "applications" | "profiles" | "staff" | null;
  opensClassStream?: boolean;
};

const staffRoleNavigationMatrix: readonly StaffRoleNavigationScenario[] = [
  {
    actor: "adviser",
    label: "Adviser",
    visibleTabs: canonicalTabs,
    visibleMoreItems: canonicalMoreItems,
    deniedRoute: null,
  },
  {
    actor: "coPresident",
    label: "Co-President",
    visibleTabs: canonicalTabs,
    visibleMoreItems: [
      "Imports",
      "Reports",
      "Change history",
      "Communications",
      "Settings",
      "Help",
    ],
    deniedRoute: "staff",
  },
  {
    actor: "vpMembership",
    label: "Vice President — Membership",
    // The Classes hub opens for any class-tab capability; membership holds
    // manage_profiles, process_points, and manage_meetings.
    visibleTabs: ["Home", "Applications", "Members", "Service", "Classes"],
    visibleMoreItems: ["Imports", "Reports", "Help"],
    deniedRoute: "staff",
  },
  {
    actor: "vpPublicity",
    label: "Vice President — Publicity",
    // manage_posts opens Classes so posting officers can reach each class Stream
    // without gaining Members, Points, Meetings, or the Communications console.
    visibleTabs: ["Home", "Service", "Classes"],
    visibleMoreItems: ["Help"],
    deniedRoute: "applications",
    opensClassStream: true,
  },
  {
    actor: "vpClubs",
    label: "Vice President — Clubs",
    // process_points opens the Classes hub (Points tab only inside it).
    visibleTabs: ["Home", "Service", "Classes"],
    visibleMoreItems: ["Imports", "Reports", "Help"],
    deniedRoute: "applications",
  },
  {
    actor: "treasurer",
    label: "Treasurer",
    visibleTabs: ["Home", "Applications"],
    visibleMoreItems: ["Reports", "Help"],
    deniedRoute: "profiles",
  },
  {
    actor: "secretary",
    label: "Secretary",
    // The former Semester tab now lives inside the Classes hub.
    visibleTabs: ["Home", "Members", "Service", "Classes"],
    visibleMoreItems: ["Imports", "Reports", "Help"],
    deniedRoute: "applications",
  },
  {
    actor: "webMaster",
    label: "Web Master",
    visibleTabs: ["Home", "Service", "Classes"],
    visibleMoreItems: ["Help"],
    deniedRoute: "applications",
    opensClassStream: true,
  },
  {
    actor: "activityCoordinator",
    label: "Activity Coordinator",
    visibleTabs: ["Home", "Service"],
    visibleMoreItems: ["Help"],
    deniedRoute: "applications",
  },
  {
    actor: "dataManagement",
    label: "Data Management",
    visibleTabs: ["Home", "Applications", "Members", "Service", "Classes"],
    visibleMoreItems: ["Imports", "Reports", "Change history", "Help"],
    deniedRoute: "staff",
  },
] as const;

async function expectCanonicalNavigation(
  page: Page,
  scenario: Pick<
    StaffRoleNavigationScenario,
    "visibleTabs" | "visibleMoreItems"
  >,
) {
  for (const tab of canonicalTabs) {
    const locator = page.getByRole("tab", { name: tab, exact: true });
    if (scenario.visibleTabs.includes(tab)) {
      await expect(locator, `${tab} should be visible`).toBeVisible();
    } else {
      await expect(locator, `${tab} should be hidden`).toHaveCount(0);
    }
  }

  const moreButton = page.getByRole("button", { name: "More", exact: true });
  if (scenario.visibleMoreItems.length === 0) {
    await expect(
      moreButton,
      "More should be hidden without utilities",
    ).toHaveCount(0);
    return;
  }

  await expect(moreButton).toBeVisible();
  await moreButton.click();
  for (const item of canonicalMoreItems) {
    const locator = page.getByRole("menuitem", { name: item, exact: true });
    if (scenario.visibleMoreItems.includes(item)) {
      await expect(locator, `${item} should be visible`).toBeVisible();
    } else {
      await expect(locator, `${item} should be hidden`).toHaveCount(0);
    }
  }
  await page.keyboard.press("Escape");
}

async function expectMembersDirectory(page: Page) {
  await page.getByRole("tab", { name: "Members", exact: true }).click();
  await expect(page).toHaveURL(/[?&]tab=csf-members(?:&|$)/);

  const memberViews = page.getByRole("navigation", { name: "Member views" });
  await expect(memberViews).toBeVisible();
  await expect(
    memberViews.getByRole("button", { name: /^Directory\b/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Student", exact: true }),
  ).toBeVisible();
}

async function expectClassStream(page: Page) {
  await page.getByRole("tab", { name: "Classes", exact: true }).click();
  await expect(page).toHaveURL(/[?&]tab=csf-cohorts(?:&|$)/);
  await page.getByRole("link", { name: "Class of 2028", exact: true }).click();
  await expect(page).toHaveURL(/[?&]csf_cohort=/);

  const workspaceTabs = page.getByRole("navigation", {
    name: "Class workspace tabs",
  });
  await expect(
    workspaceTabs.getByRole("button", { name: "Stream", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Class stream" }),
  ).toBeVisible();
}

async function expectExplicitStaffRouteDenial(
  page: Page,
  route: Exclude<StaffRoleNavigationScenario["deniedRoute"], null>,
) {
  const deniedPath = `${CSF_ORGANIZATION_PATH}/plugins/dvhs-csf/${route}`;
  const deniedResponse = await page.goto(deniedPath, {
    waitUntil: "domcontentloaded",
  });

  expect(deniedResponse?.status()).toBe(200);
  await expect(page).toHaveURL(deniedPath);
  const denialAlert = page
    .getByRole("alert")
    .filter({ hasText: "This area is not part of your CSF role" });
  await expect(denialAlert).toHaveCount(1);
  await expect(denialAlert).toContainText(
    "This area is not part of your CSF role",
  );
  await expect(
    denialAlert.getByText(
      "Ask a CSF administrator to update your officer permissions",
    ),
  ).toBeVisible();
  expectNoPrivateBoundaryMarkers(await page.locator("body").innerText());
}

test.describe("DVHS CSF role-aware navigation", () => {
  test("phone navigation keeps every primary officer destination reachable", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, "admin");

    const switcher = page.getByTestId("organization-section-switcher");
    await expect(switcher).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // The phone layout replaces the horizontal category strip and its desktop
    // utility menu with one full-section switcher, so neither may survive here.
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "More", exact: true }),
    ).toBeHidden();

    // Disclosure semantics only: the trigger names the active section without
    // claiming to be the current page — aria-current lives on the menu item.
    await expect(switcher).toHaveAccessibleName(/^Home\b/);
    await expect(switcher).toHaveAttribute("aria-haspopup", "menu");
    await expect(switcher).not.toHaveAttribute("aria-current", /.*/);

    await switcher.click();
    const switcherMenu = page.getByRole("menu");
    await expect(switcherMenu).toBeVisible();
    await expect(
      switcherMenu.getByRole("group", { name: "Workspace", exact: true }),
    ).toBeVisible();
    // CSF names its utility group "More" so the phone switcher and the desktop
    // overflow trigger read identically; the host default stays "Administration".
    await expect(
      switcherMenu.getByRole("group", { name: "More", exact: true }),
    ).toBeVisible();
    await expect(
      switcherMenu.getByRole("group", { name: "Administration", exact: true }),
    ).toHaveCount(0);

    // Every destination the desktop chrome splits between the strip and the
    // utility menu must appear exactly once inside the single phone switcher.
    for (const destination of [...canonicalTabs, ...canonicalMoreItems]) {
      const item = switcherMenu.getByRole("menuitem", {
        name: destination,
        exact: true,
      });
      await expect(item, `${destination} should be listed once`).toHaveCount(1);
      await expect(item, `${destination} should be visible`).toBeVisible();
    }

    await switcherMenu
      .getByRole("menuitem", { name: "Members", exact: true })
      .click();
    await expect(page).toHaveURL(/[?&]tab=csf-members(?:&|$)/);
    await expect(
      page.getByRole("navigation", { name: "Member views" }),
    ).toBeVisible();

    await expect(switcherMenu).toBeHidden();
    await expect(switcher).toHaveAccessibleName(/^Members\b/);
    await expectNoHorizontalOverflow(page);

    expectNoBrowserFailures(failures);
  });

  test("organization admin sees the complete canonical CSF navigation", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin");
    await expectCanonicalNavigation(page, {
      visibleTabs: canonicalTabs,
      visibleMoreItems: canonicalMoreItems,
    });
    await test.step("opens the authorized Members directory", async () => {
      await expectMembersDirectory(page);
    });
    expectNoBrowserFailures(failures);
  });

  for (const scenario of staffRoleNavigationMatrix) {
    test(`${scenario.label} sees only its canonical CSF areas`, async ({
      page,
    }) => {
      const failures = watchBrowserFailures(page);
      await loginAs(page, scenario.actor);
      await expectCanonicalNavigation(page, scenario);

      if (scenario.visibleTabs.includes("Members")) {
        await test.step("opens the authorized Members directory", async () => {
          await expectMembersDirectory(page);
        });
      }

      if (scenario.opensClassStream) {
        await test.step("opens Classes and a class Stream", async () => {
          await expectClassStream(page);
        });
      }

      if (scenario.deniedRoute) {
        await expectExplicitStaffRouteDenial(page, scenario.deniedRoute);
      }

      expectNoBrowserFailures(failures);
    });
  }

  test("an authorized internal CSF route redirects to the canonical organization tab", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin");

    await page.goto(`${CSF_ORGANIZATION_PATH}/plugins/dvhs-csf/overview`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page).toHaveURL(`${CSF_ORGANIZATION_PATH}?tab=csf-overview`);
    await expect(
      page.getByRole("tab", { name: "Home", exact: true }),
    ).toBeVisible();
    // The canonical tab owns the CSF chrome; the plugin must not nest a second
    // workspace shell inside it.
    await expect(
      page.getByRole("navigation", { name: "DVHS CSF workspace" }),
    ).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });

  test("member sees only Feed, My CSF, Activities, Point submissions, and Help", async ({
    page,
  }) => {
    await loginAs(page, "member");

    // Feed is the member default landing tab.
    const memberHome = page.getByRole("tab", { name: "Feed", exact: true });
    await expect(memberHome).toBeVisible();
    await expect(memberHome).toHaveAttribute("aria-selected", "true");

    for (const tab of ["My CSF", "Activities", "Point submissions"]) {
      await expect(
        page.getByRole("tab", { name: tab, exact: true }),
      ).toBeVisible();
    }
    const memberMore = page.getByRole("button", {
      name: "More",
      exact: true,
    });
    await expect(memberMore).toBeVisible();
    await memberMore.click();
    await expect(
      page.getByRole("menuitem", { name: "Help", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    for (const tab of ["Applications", "Members", "Service", "Classes"]) {
      await expect(
        page.getByRole("tab", { name: tab, exact: true }),
      ).toHaveCount(0);
    }

    const response = await page.goto(
      `${CSF_ORGANIZATION_PATH}/plugins/dvhs-csf/applications`,
    );
    expect(response?.status()).toBe(404);
    expectNoPrivateBoundaryMarkers(await page.locator("body").innerText());
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
  });

  test("applicant sees only their own CSF workflow", async ({ page }) => {
    await loginAs(page, "applicant");

    for (const tab of ["Feed", "My CSF", "Activities", "Point submissions"]) {
      await expect(
        page.getByRole("tab", { name: tab, exact: true }),
      ).toBeVisible();
    }
    const applicantMore = page.getByRole("button", {
      name: "More",
      exact: true,
    });
    await expect(applicantMore).toBeVisible();
    await applicantMore.click();
    await expect(
      page.getByRole("menuitem", { name: "Help", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    // The applicant's review state lives in My CSF; Feed is the landing tab.
    await page.getByRole("tab", { name: "My CSF", exact: true }).click();
    await expect(
      page.getByText("Under review", { exact: true }).first(),
    ).toBeVisible();
    for (const tab of ["Applications", "Members", "Service", "Classes"]) {
      await expect(
        page.getByRole("tab", { name: tab, exact: true }),
      ).toHaveCount(0);
    }

    const response = await page.goto(
      `${CSF_ORGANIZATION_PATH}/plugins/dvhs-csf/applications`,
    );
    expect(response?.status()).toBe(404);
    expectNoPrivateBoundaryMarkers(await page.locator("body").innerText());
  });
});
