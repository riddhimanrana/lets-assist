import { expect, test } from "@playwright/test";

import {
  cleanFeedPosts,
  loadCsfFeedFixture,
  seedFeedPosts,
  type CsfFeedFixture,
} from "./feed-fixtures";
import {
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

const TITLE_PREFIX = "E2E member home";

const pinnedTitle = `${TITLE_PREFIX} pinned checkpoint`;
const newerTitle = `${TITLE_PREFIX} newer update`;
const olderTitle = `${TITLE_PREFIX} older update`;
const ownClassTitle = `${TITLE_PREFIX} class of 2028 notice`;
const otherClassTitle = `${TITLE_PREFIX} class of 2029 notice`;

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

test.describe("member Home class feed", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: CsfFeedFixture;
  let outsiderUserId: string;

  test.beforeAll(async () => {
    fixture = await loadCsfFeedFixture();
    await cleanFeedPosts(fixture, TITLE_PREFIX);
    await seedFeedPosts(fixture, [
      {
        title: pinnedTitle,
        body: "Pinned fixture announcement for browser ordering checks.",
        audience: "members",
        pinned: true,
        publishedAt: minutesAgo(3 * 24 * 60),
      },
      {
        title: newerTitle,
        body: "Newer chapter-wide fixture announcement.",
        audience: "members",
        publishedAt: minutesAgo(60),
      },
      {
        title: olderTitle,
        body: "Older chapter-wide fixture announcement.",
        audience: "members",
        publishedAt: minutesAgo(2 * 24 * 60),
      },
      {
        title: ownClassTitle,
        body: "Class-scoped fixture announcement for the viewer's own class.",
        audience: "class",
        audienceCohortId: fixture.cohortIdsByYear[2028],
        publishedAt: minutesAgo(30),
      },
      {
        title: otherClassTitle,
        body: "Class-scoped fixture announcement for a different class.",
        audience: "class",
        audienceCohortId: fixture.cohortIdsByYear[2029],
        publishedAt: minutesAgo(30),
      },
    ]);
  });

  test.afterAll(async () => {
    if (fixture) await cleanFeedPosts(fixture, TITLE_PREFIX);
  });

  test("a linked member lands on Home by default and reads the class feed", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "member");

    // Home is the member default tab and carries the member's class label.
    const homeTab = page.getByRole("tab", { name: "Home", exact: true });
    await expect(homeTab).toBeVisible();
    await expect(homeTab).toHaveAttribute("aria-selected", "true");

    const summary = page.getByRole("region", {
      name: "CSF membership summary",
    });
    await expect(summary).toBeVisible();
    await expect(
      summary.getByRole("heading", { name: "Class of 2028" }),
    ).toBeVisible();
    await expect(summary.getByText("Spring 2026", { exact: true })).toBeVisible();

    // The feed shows the pinned post first, then reverse-chronological posts.
    const feed = page.getByRole("region", { name: "CSF posts" });
    await expect(feed).toBeVisible();
    await expect(feed.getByText(newerTitle, { exact: true })).toBeVisible();
    const fixtureTitles = feed
      .locator('[data-slot="card-title"]')
      .filter({ hasText: TITLE_PREFIX });
    await expect(fixtureTitles).toHaveText([
      pinnedTitle,
      ownClassTitle,
      newerTitle,
      olderTitle,
    ]);

    const pinnedCard = feed
      .locator('[data-post-id]')
      .filter({ hasText: pinnedTitle });
    await expect(pinnedCard.getByText("Pinned", { exact: true })).toBeVisible();

    // The class post carries its class badge; the other class's post is
    // resolved server-side and never reaches this member's document.
    const classCard = feed
      .locator('[data-post-id]')
      .filter({ hasText: ownClassTitle });
    await expect(
      classCard.getByText("Class of 2028", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(otherClassTitle)).toHaveCount(0);
    expect(await page.content()).not.toContain(otherClassTitle);

    expectNoBrowserFailures(failures);
  });

  test("an unlinked member sees the connect call to action instead of a class label", async ({
    page,
  }) => {
    // Promote the outsider fixture to a plain organization member with no
    // verified CSF record link, mirroring a student who joined without a
    // class invitation. The membership is removed again below.
    const usersResult = await fixture.admin.auth.admin.listUsers({
      page: 1,
      perPage: 1_000,
    });
    if (usersResult.error) {
      throw new Error(
        `Could not load local auth fixtures: ${usersResult.error.message}`,
      );
    }
    const outsider = usersResult.data.users.find(
      (candidate) => candidate.email === "platform.outsider@local.test",
    );
    if (!outsider) throw new Error("The local outsider auth fixture is missing.");
    outsiderUserId = outsider.id;

    const { error: membershipError } = await fixture.admin
      .from("organization_members")
      .upsert(
        {
          organization_id: fixture.organizationId,
          user_id: outsiderUserId,
          role: "member",
          status: "active",
        },
        { onConflict: "organization_id,user_id" },
      );
    if (membershipError) {
      throw new Error(
        `Could not seed the unlinked membership: ${membershipError.message}`,
      );
    }

    let cleanupError: string | null = null;
    try {
      await loginAs(page, "outsider");

      const homeTab = page.getByRole("tab", { name: "Home", exact: true });
      await expect(homeTab).toBeVisible();
      await expect(homeTab).toHaveAttribute("aria-selected", "true");

      const summary = page.getByRole("region", {
        name: "CSF membership summary",
      });
      await expect(
        summary.getByRole("heading", { name: "CSF member home" }),
      ).toBeVisible();

      const connectCard = page
        .locator('[data-slot="card"]')
        .filter({ hasText: "Connect student record" })
        .first();
      await expect(connectCard).toBeVisible();
      await expect(
        connectCard.getByText(
          "Enter the identity details used on your CSF forms.",
        ),
      ).toBeVisible();

      // No class label and no staff compose affordance for this viewer.
      await expect(summary.getByText(/^Class of \d{4}$/)).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "New post", exact: true }),
      ).toHaveCount(0);
    } finally {
      const { error } = await fixture.admin
        .from("organization_members")
        .delete()
        .eq("organization_id", fixture.organizationId)
        .eq("user_id", outsiderUserId);
      cleanupError = error?.message ?? null;
    }
    expect(cleanupError, `membership cleanup failed: ${cleanupError}`).toBeNull();
  });
});
