import { expect, test } from "@playwright/test";
import {
  decide,
  login,
  memberEmail,
  membershipFixture,
  openRoster,
  reachLastSection,
  rosterFixture,
  workspacePath,
} from "./membership-helpers";

test.beforeEach(async ({ context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      await route.continue();
    } else {
      await route.abort("blockedbyclient");
    }
  });
});

test("staff requests corrections, member retries a lost submission response, then staff approves saved answers", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const fixture = await membershipFixture();
  try {
    await fixture.prepare("submitted");
    await login(page, "dv.staff@local.test");
    await openRoster(page);
    await decide(
      page,
      "needs_action",
      "Please correct the fictional comment before approval.",
    );
    expect((await fixture.current()).status).toBe("needs_action");

    // A separate browser context keeps the staff and member sessions independent.
    const memberContext = await context
      .browser()!
      .newContext({ baseURL: new URL(page.url()).origin });
    try {
      await memberContext.route("**/*", async (route) => {
        const host = new URL(route.request().url()).hostname;
        if (["localhost", "127.0.0.1", "[::1]"].includes(host))
          await route.continue();
        else await route.abort("blockedbyclient");
      });
      const memberPage = await memberContext.newPage();
      await login(memberPage, memberEmail);
      await expect(
        memberPage.getByText("Staff requested changes", { exact: true }),
      ).toBeVisible();
      await expect(
        memberPage.getByText(
          "Please correct the fictional comment before approval.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        memberPage.getByLabel("School Email", { exact: false }),
      ).toHaveValue(memberEmail);
      const submit = await reachLastSection(memberPage);
      const comments = memberPage.getByLabel(
        "Any questions, comments, or concerns?",
        { exact: false },
      );
      await expect(comments).toHaveValue("Saved fictional application answer.");
      const correction =
        "Corrected fictional answer, retained after a lost response.";
      await comments.fill(correction);
      const before = await fixture.records();
      const requestIds: string[] = [];
      await memberPage.route(`**${workspacePath}`, async (route) => {
        const request = route.request();
        if (
          request.method() !== "POST" ||
          !request.headers()["next-action"] ||
          !request.postData()?.includes(correction)
        ) {
          await route.continue();
          return;
        }
        const args: unknown = request.postDataJSON();
        expect(Array.isArray(args)).toBe(true);
        if (!Array.isArray(args) || typeof args[2] !== "string")
          throw new Error("Unexpected membership Server Action arguments.");
        requestIds.push(args[2]);
        const response = await route.fetch({ maxRedirects: 0 });
        expect(response.ok()).toBe(true);
        if (requestIds.length === 1) await route.abort("failed");
        else await route.fulfill({ response });
      });
      await submit.click();
      await expect
        .poll(async () => (await fixture.current()).status)
        .toBe("submitted");
      await expect(submit).toBeEnabled();
      await expect(comments).toHaveValue(correction);
      await expect.poll(() => requestIds.length).toBe(1);
      await submit.click();
      await expect(
        memberPage.getByText(
          "Membership application submitted for staff review.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(submit).not.toBeVisible();
      expect(requestIds).toHaveLength(2);
      expect(requestIds[1]).toBe(requestIds[0]);
      const after = await fixture.records();
      expect(after.membership.id).toBe(fixture.membership.id);
      expect(after.membership.status).toBe("submitted");
      expect(after.membership.review_notes).toBeNull();
      expect(after.membership.application_data.questionsConcerns).toBe(
        correction,
      );
      expect(after.receipts).toHaveLength(before.receipts.length + 1);
      expect(
        after.receipts.filter(
          (receipt) => receipt.request_id === requestIds[0],
        ),
      ).toHaveLength(1);
      expect(
        after.audits.filter((audit) => audit.action === "membership.submitted"),
      ).toHaveLength(
        before.audits.filter((audit) => audit.action === "membership.submitted")
          .length + 1,
      );
      expect(after.guardians).toEqual(before.guardians);
      expect(after.guardianLinks).toEqual(before.guardianLinks);

      await page
        .getByRole("button", { name: "Reload memberships", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Review Blair Student", exact: true })
        .click();
      const review = page.getByRole("region", {
        name: "Review membership",
        exact: true,
      });
      await expect(review.getByText(correction, { exact: true })).toBeVisible();
      await review
        .getByLabel("Decision", { exact: true })
        .selectOption("approved");
      await review
        .getByRole("button", { name: "Save decision", exact: true })
        .click();
      await expect(review).not.toBeVisible();
      expect((await fixture.current()).status).toBe("approved");
      await memberPage.reload();
      await expect(
        memberPage.getByText("Approved", { exact: true }),
      ).toBeVisible();
    } finally {
      await memberContext.close();
    }
  } finally {
    await fixture.restore();
  }
});

for (const refusal of [
  "stale status",
  "revoked organization access",
] as const) {
  test(`${refusal} refuses an open member form without changing identity or retry records`, async ({
    page,
  }) => {
    const fixture = await membershipFixture();
    try {
      await fixture.prepare("needs_action");
      await login(page, memberEmail);
      await expect(
        page.getByText("Staff requested changes", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page
        .getByLabel("Student First Name", { exact: false })
        .fill("Unaccepted identity edit");
      const submit = await reachLastSection(page);
      await page
        .getByLabel("Any questions, comments, or concerns?", { exact: false })
        .fill("This rejected edit must stay only in the form.");
      if (refusal === "stale status")
        await fixture.setMembership({ status: "approved" });
      else await fixture.setAccess("inactive");
      const before = await fixture.records();
      const result = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          Boolean(response.request().headers()["next-action"]) &&
          Boolean(
            response.request().postData()?.includes("Unaccepted identity edit"),
          ),
      );
      await submit.click();
      await result;
      await expect(submit).toBeEnabled();
      await expect(
        page.getByText("Membership application submitted for staff review.", {
          exact: true,
        }),
      ).not.toBeVisible();
      await expect(
        page.locator('[data-sonner-toast][data-type="error"]'),
      ).toBeVisible();
      expect(await fixture.records()).toEqual(before);
      await expect(
        page.getByLabel("Any questions, comments, or concerns?", {
          exact: false,
        }),
      ).toHaveValue("This rejected edit must stay only in the form.");
    } finally {
      await fixture.restore();
    }
  });
}

test("the canonical current-season roster counts and pages all applications without historical memberships", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const fixture = await rosterFixture();
  try {
    await login(page, "dv.staff@local.test");
    const roster = await openRoster(page);
    await expect(
      roster.getByRole("heading", {
        name: `${fixture.current.label} memberships`,
        exact: true,
      }),
    ).toBeVisible();
    const total = fixture.baseline.length + 51;
    const approved = fixture.baseline.filter(
      (row) => row.status === "approved",
    ).length;
    const awaiting =
      fixture.baseline.filter((row) => row.status === "submitted").length + 51;
    const needsAction = fixture.baseline.filter(
      (row) => row.status === "needs_action",
    ).length;
    await expect(
      roster.getByText(
        `${total} applications. ${approved} approved. ${awaiting} awaiting review. ${needsAction} returned for changes.`,
        { exact: true },
      ),
    ).toBeVisible();
    const first = await roster
      .getByRole("button", { name: /^Review DV roster / })
      .evaluateAll((buttons) =>
        buttons.map((button) =>
          button.getAttribute("aria-label")!.replace(/^Review /, ""),
        ),
      );
    expect(first).toHaveLength(50);
    await expect(
      roster.getByText(`${fixture.prefix} historical only`, { exact: true }),
    ).not.toBeVisible();
    await expect(
      roster.getByRole("button", { name: "Previous", exact: true }),
    ).toBeDisabled();
    await roster.getByRole("button", { name: "Next", exact: true }).click();
    await expect(roster.getByText("Page 2", { exact: true })).toBeVisible();
    await expect(
      roster.getByRole("button", { name: /^Review DV roster / }),
    ).toHaveCount(1);
    const second = await roster
      .getByRole("button", { name: /^Review DV roster / })
      .evaluateAll((buttons) =>
        buttons.map((button) =>
          button.getAttribute("aria-label")!.replace(/^Review /, ""),
        ),
      );
    expect(second).toHaveLength(1);
    expect([...first, ...second].sort()).toEqual([...fixture.names].sort());
    await expect(
      roster.getByText(`${fixture.prefix} historical only`, { exact: true }),
    ).not.toBeVisible();
    await expect(
      roster.getByRole("button", { name: "Next", exact: true }),
    ).toBeDisabled();
    await roster.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(roster.getByText("Page 1", { exact: true })).toBeVisible();
    await expect(
      roster.getByRole("button", { name: /^Review DV roster / }),
    ).toHaveCount(50);
    expect(
      await roster
        .getByRole("button", { name: /^Review DV roster / })
        .evaluateAll((buttons) =>
          buttons.map((button) =>
            button.getAttribute("aria-label")!.replace(/^Review /, ""),
          ),
        ),
    ).toEqual(first);
  } finally {
    await fixture.cleanup();
  }
});
