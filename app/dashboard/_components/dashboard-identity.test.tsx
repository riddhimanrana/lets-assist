import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardAvatar } from "./DashboardAvatar";
import { dashboardOrganizationLogos } from "./dashboard-identity";

const certificate = (
  id = "org-1",
  name = "Sample School",
  logo_url: string | null = "/logos/dvhs.png",
) => ({
  organization_name: "Sample School",
  projects: { organizations: { id, name, logo_url } },
});
test("existing organization logos are attached to the exact certificate identity", () => {
  expect(dashboardOrganizationLogos([certificate()]).get("Sample School")).toBe(
    "/logos/dvhs.png",
  );
  expect(
    dashboardOrganizationLogos([certificate("org-1", "Renamed School")]).has(
      "Sample School",
    ),
  ).toBe(false);
  expect(
    dashboardOrganizationLogos([certificate(), certificate("org-2")]).get(
      "Sample School",
    ),
  ).toBeNull();
  expect(
    dashboardOrganizationLogos([
      { organization_name: "Sample School", projects: null },
    ]).size,
  ).toBe(0);
});
test("an existing image is passed unchanged to the actual shared avatar image", () => {
  const tree = DashboardAvatar({
    name: "Sample School",
    src: "/logos/dvhs.png",
  });
  const children = tree.props.children;
  expect(children[0].props.src).toBe("/logos/dvhs.png");
  expect(children[0].props.alt).toBe("");
  expect(children[1].props.children.props.fullName).toBe("Sample School");
});
test("missing profile and project imagery retains initials in a stable frame", () => {
  for (const square of [false, true]) {
    const markup = renderToStaticMarkup(
      createElement(DashboardAvatar, {
        name: "Maple Tutors",
        src: null,
        square,
      }),
    );
    expect(markup).toContain("MT");
    expect(markup).toContain("size-12");
    expect(markup).toContain('data-slot="avatar-fallback"');
    expect(markup).not.toContain('src="undefined"');
  }
});
