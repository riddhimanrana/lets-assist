import { expect, test } from "@playwright/test";

import {
  CSF_PUBLIC_PATH,
  expectNoPrivateBoundaryMarkers,
  responseText,
} from "./helpers";

test.describe("DVHS CSF public privacy boundary", () => {
  test("public HTML contains only public organization and activity structure", async ({
    page,
    request,
  }) => {
    const rawResponse = await request.get(CSF_PUBLIC_PATH);
    expect(rawResponse.status()).toBe(200);
    const rawHtml = await rawResponse.text();
    expectNoPrivateBoundaryMarkers(rawHtml);
    expect(rawHtml).not.toContain("csf_application=");
    expect(rawHtml).not.toContain("csf_profile=");

    const documentResponse = await page.goto(CSF_PUBLIC_PATH);
    expectNoPrivateBoundaryMarkers(await responseText(documentResponse));
    expectNoPrivateBoundaryMarkers(await page.locator("body").innerText());

    await expect(page.getByRole("heading", { name: /DVHS CSF|Dougherty Valley High School CSF/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Upcoming activities/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Member sign in/ })).toBeVisible();
    await expect(page.getByText("Student records stay private")).toHaveCount(0);
    await expect(page.getByText("Privacy by design")).toHaveCount(0);

    const publicHrefs = await page.locator("main a").evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
    expect(publicHrefs.some((href) => href.includes("csf_application"))).toBe(false);
    expect(publicHrefs.some((href) => href.includes("csf_profile"))).toBe(false);
  });
});
