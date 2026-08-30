import { expect, test } from "@playwright/test";

import {
  CSF_ORGANIZATION_PATH,
  CSF_PUBLIC_PATH,
  expectNoPrivateBoundaryMarkers,
  responseText,
} from "./helpers";

const CSF_CONNECT_PATH = `${CSF_ORGANIZATION_PATH}/plugins/dvhs-csf/connect`;
const CSF_CANONICAL_PROFILE_PATH = `${CSF_ORGANIZATION_PATH}?tab=csf-profile`;

function isApprovedExternalFormUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "docs.google.com" || url.hostname === "forms.gle")
    );
  } catch {
    return false;
  }
}

test.describe("DVHS CSF public privacy boundary", () => {
  test("public HTML contains only public organization and activity structure", async ({
    page,
    request,
  }) => {
    const rawResponse = await request.get(CSF_PUBLIC_PATH);
    expect(rawResponse.status()).toBe(200);
    const rawHtml = await rawResponse.text();
    expectNoPrivateBoundaryMarkers(rawHtml);
    expect(rawHtml).not.toContain("csf_application");
    expect(rawHtml).not.toContain("csf_profile");
    expect(rawHtml).not.toContain("csf_class_join_codes");
    // The seeded permanent class join codes stay private: students receive
    // them from officers, never from the public page.
    expect(rawHtml).not.toContain("HAWK28");
    expect(rawHtml).not.toContain("HAWK27");
    expect(rawHtml).not.toContain("HAWK29");

    const documentResponse = await page.goto(CSF_PUBLIC_PATH);
    expectNoPrivateBoundaryMarkers(await responseText(documentResponse));
    expectNoPrivateBoundaryMarkers(await page.locator("body").innerText());

    await expect(
      page.getByRole("heading", {
        name: /DVHS CSF|Dougherty Valley High School(?: CSF)?/,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Meetings, announcements, and deadlines",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("button", { name: "Sign in" }),
    ).toBeVisible();
    await expect(page.getByText("Student records stay private")).toHaveCount(0);
    await expect(page.getByText("Privacy by design")).toHaveCount(0);

    const publicHrefs = await page
      .locator("main a")
      .evaluateAll((links) =>
        links.map(
          (link) => (link as HTMLAnchorElement).getAttribute("href") ?? "",
        ),
      );
    expect(publicHrefs.some((href) => href.includes("csf_application"))).toBe(
      false,
    );
    expect(publicHrefs.some((href) => href.includes("csf_profile"))).toBe(
      false,
    );
    expect(publicHrefs.some((href) => href.includes("HAWK28"))).toBe(false);
  });

  test("an out-of-term application link stays hidden while safe class join remains available", async ({
    page,
  }) => {
    const externalFormRequests: string[] = [];
    page.on("request", (pageRequest) => {
      if (isApprovedExternalFormUrl(pageRequest.url())) {
        externalFormRequests.push(pageRequest.url());
      }
    });

    await page.goto(CSF_PUBLIC_PATH);

    await expect(
      page.getByRole("button", {
        name: "Apply with Google Forms",
        exact: true,
      }),
    ).toHaveCount(0);

    // The page may advertise the form, never fetch, prefetch, or open it.
    expect(externalFormRequests).toEqual([]);
    expect(page.url()).toContain(CSF_PUBLIC_PATH);
    expect(page.context().pages()).toHaveLength(1);

    // The public page accepts one general class code. It never exposes a
    // roster or asks the visitor to choose a class or semester.
    await expect(page.locator("main form")).toHaveCount(1);
    await expect(page.getByLabel("Join code")).toBeVisible();
    await expect(page.getByRole("button", { name: "Join class" })).toHaveCount(
      0,
    );
    await expect(page.locator("main").getByRole("searchbox")).toHaveCount(0);
  });

  test("public entry paths reach the canonical workspace and class-code join page", async ({
    page,
  }) => {
    await page.goto(CSF_PUBLIC_PATH);

    const signIn = page
      .getByRole("main")
      .getByRole("button", { name: "Sign in", exact: true });
    const signInHref = await signIn.getAttribute("href");
    expect(signInHref).toBe(
      `/login?redirect=${encodeURIComponent(CSF_CANONICAL_PROFILE_PATH)}`,
    );
    expect(decodeURIComponent(signInHref ?? "")).toContain("tab=csf-profile");

    await expect(page.locator('main form[data-hydrated="true"]')).toBeVisible();
    await page.getByLabel("Join code").fill("HAWK28");
    await expect(page.getByLabel("Join code")).toHaveValue("HAWK28");
    const continueButton = page.getByRole("button", { name: "Continue" });
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    await page.waitForURL(
      (url) => url.pathname === `${CSF_CONNECT_PATH}/HAWK28`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("heading", { name: "Connect your CSF record" }),
    ).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("HAWK28");
  });

  test("the public page uses one class join entry and no class workspace", async ({
    page,
  }) => {
    await page.goto(CSF_PUBLIC_PATH);
    await expect(
      page.getByText("Join a class", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByLabel("Join code")).toBeVisible();
    await expect(page.getByRole("button", { name: "Join class" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("heading", { name: "Stream" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Activities" })).toHaveCount(
      0,
    );
    expectNoPrivateBoundaryMarkers(await page.locator("body").innerText());
  });

  test("the public page renders no internal CSF workspace navigation", async ({
    page,
  }) => {
    await page.goto(CSF_PUBLIC_PATH);

    await expect(
      page.getByRole("navigation", { name: "DVHS CSF workspace" }),
    ).toHaveCount(0);
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
    for (const officerDestination of [
      "Applications",
      "Members",
      "Imports",
      "Staff access",
      "Change history",
    ]) {
      await expect(
        page.getByRole("link", { name: officerDestination, exact: true }),
      ).toHaveCount(0);
    }
  });
});
