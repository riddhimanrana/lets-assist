import { expect, test } from "@playwright/test";

import {
  CSF_ORGANIZATION_PATH,
  CSF_PUBLIC_PATH,
  expectNoPrivateBoundaryMarkers,
  responseText,
  soleAccessibleAction,
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
        name: /DVHS CSF|Dougherty Valley High School CSF/,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Upcoming activities/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Sign in to My CSF/ }),
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

    // Class cards may open the safe join entry, but the organization page does
    // not render a roster/profile search or accept a code itself.
    await expect(
      page.getByRole("button", { name: "Join class" }).first(),
    ).toBeVisible();
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(page.locator("main").getByRole("textbox")).toHaveCount(0);
    await expect(page.locator("main").getByRole("searchbox")).toHaveCount(0);
  });

  test("public entry paths reach the canonical workspace and class-code join page", async ({
    page,
  }) => {
    await page.goto(CSF_PUBLIC_PATH);

    const signIn = await soleAccessibleAction(page, "Sign in to My CSF");
    const signInHref = await signIn.getAttribute("href");
    expect(signInHref).toBe(
      `/login?redirect=${encodeURIComponent(CSF_CANONICAL_PROFILE_PATH)}`,
    );
    expect(decodeURIComponent(signInHref ?? "")).toContain("tab=csf-profile");

    const claim = await soleAccessibleAction(page, "Join or claim profile");
    await expect(claim).toHaveAttribute("href", CSF_CONNECT_PATH);

    await claim.click();
    await page.waitForURL((url) => url.pathname === CSF_CONNECT_PATH, {
      waitUntil: "domcontentloaded",
    });
    // The entry point must not carry or invent a class join code.
    expect(new URL(page.url()).search).toBe("");
    await expect(page.getByLabel("Class join code")).toBeVisible();
  });

  test("a public class page contains join entry and no stream or activities", async ({
    page,
  }) => {
    await page.goto(CSF_PUBLIC_PATH);
    await page.getByRole("button", { name: "Join class" }).first().click();
    await expect(
      page.getByRole("heading", { name: /^Join Class of/ }),
    ).toBeVisible();
    await expect(page.getByLabel(/Class of .* join code/)).toBeVisible();
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
