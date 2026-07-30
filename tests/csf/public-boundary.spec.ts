import { expect, test, type Page } from "@playwright/test";

import {
  CSF_ORGANIZATION_PATH,
  CSF_PUBLIC_PATH,
  expectNoPrivateBoundaryMarkers,
  responseText,
} from "./helpers";

const CSF_CONNECT_PATH = `${CSF_ORGANIZATION_PATH}/plugins/dvhs-csf/connect`;
const CSF_CANONICAL_PROFILE_PATH = `${CSF_ORGANIZATION_PATH}?tab=csf-profile`;

// The local fixture configures exactly one active class link, and it carries
// this fictional Google Form URL, so the public projection must resolve to it.
const FIXTURE_APPLICATION_URL =
  "https://docs.google.com/forms/d/local-csf-form-fixture/viewform";

function publicButtonLink(page: Page, label: string) {
  return page.locator('a[data-slot="button"]', { hasText: label });
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
    expect(rawHtml).not.toContain("csf_onboarding_links");
    // The invitation code, its title, and its landing message stay private
    // even though the Google Form URL that row carries is public.
    expect(rawHtml).not.toContain("S26-2028");
    expect(rawHtml).not.toContain("Spring 2026 Class of 2028");
    expect(rawHtml).not.toContain("Connect your Let’s Assist profile");

    const documentResponse = await page.goto(CSF_PUBLIC_PATH);
    expectNoPrivateBoundaryMarkers(await responseText(documentResponse));
    expectNoPrivateBoundaryMarkers(await page.locator("body").innerText());

    await expect(page.getByRole("heading", { name: /DVHS CSF|Dougherty Valley High School CSF/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Upcoming activities/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign in to My CSF/ })).toBeVisible();
    await expect(page.getByText("Student records stay private")).toHaveCount(0);
    await expect(page.getByText("Privacy by design")).toHaveCount(0);

    const publicHrefs = await page.locator("main a").evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
    expect(publicHrefs.some((href) => href.includes("csf_application"))).toBe(false);
    expect(publicHrefs.some((href) => href.includes("csf_profile"))).toBe(false);
    expect(publicHrefs.some((href) => href.includes("S26-2028"))).toBe(false);
  });

  test("the configured application call to action exposes only the approved Google Form URL", async ({
    page,
  }) => {
    const externalFormRequests: string[] = [];
    page.on("request", (pageRequest) => {
      if (pageRequest.url().includes("docs.google.com") || pageRequest.url().includes("forms.gle")) {
        externalFormRequests.push(pageRequest.url());
      }
    });

    await page.goto(CSF_PUBLIC_PATH);

    const applyCta = publicButtonLink(page, "Apply with Google Forms");
    await expect(applyCta).toBeVisible();
    await expect(applyCta).toHaveAttribute("href", FIXTURE_APPLICATION_URL);
    await expect(applyCta).toHaveAttribute("target", "_blank");
    expect(await applyCta.getAttribute("rel")).toContain("noreferrer");

    // The page may advertise the form, never fetch, prefetch, or open it.
    expect(externalFormRequests).toEqual([]);
    expect(page.url()).toContain(CSF_PUBLIC_PATH);
    expect(page.context().pages()).toHaveLength(1);

    // No generic join path, no first-party application UI, and no roster or
    // profile search may co-exist with the Google Form intake.
    await expect(page.getByRole("button", { name: /^Join/ })).toHaveCount(0);
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(page.locator("main").getByRole("textbox")).toHaveCount(0);
    await expect(page.locator("main").getByRole("searchbox")).toHaveCount(0);
  });

  test("public entry paths reach the canonical workspace and the no-code claim page", async ({
    page,
  }) => {
    await page.goto(CSF_PUBLIC_PATH);

    const signIn = publicButtonLink(page, "Sign in to My CSF");
    await expect(signIn).toBeVisible();
    const signInHref = await signIn.getAttribute("href");
    expect(signInHref).toBe(
      `/login?redirect=${encodeURIComponent(CSF_CANONICAL_PROFILE_PATH)}`,
    );
    expect(decodeURIComponent(signInHref ?? "")).toContain("tab=csf-profile");

    const claim = publicButtonLink(page, "Claim existing profile");
    await expect(claim).toBeVisible();
    await expect(claim).toHaveAttribute("href", CSF_CONNECT_PATH);

    await claim.click();
    await page.waitForURL((url) => url.pathname === CSF_CONNECT_PATH, {
      waitUntil: "domcontentloaded",
    });
    // The claim entry point must not carry or invent an invitation code.
    expect(new URL(page.url()).search).toBe("");
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
