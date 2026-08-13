import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { shouldRedirectMemberToPluginRoot } from "./organization-page-routing";

describe("organization plugin member routing", () => {
  test("V34: embedded member tabs remain canonical when a plugin controls the public page", () => {
    expect(
      shouldRedirectMemberToPluginRoot({
        userRole: "member",
        publicPage: "plugin",
        hasEmbeddedOrganizationTabs: true,
      }),
    ).toBe(false);
  });

  test("V34: legacy plugins without embedded tabs keep their direct member workspace", () => {
    expect(
      shouldRedirectMemberToPluginRoot({
        userRole: "member",
        publicPage: "plugin",
        hasEmbeddedOrganizationTabs: false,
      }),
    ).toBe(true);
  });

  test("V34: the host resolves member tabs through its trusted server boundary", () => {
    const pageSource = readFileSync(
      join(import.meta.dir, "../../app/organization/[id]/page.tsx"),
      "utf8",
    );

    expect(pageSource).toMatch(
      /hook:\s*"organization\.tabs"[\s\S]{0,500}useAdminClient:\s*true/,
    );
  });

  test("remote preview keeps its active remote membership role without local revalidation", () => {
    const pageSource = readFileSync(
      join(import.meta.dir, "../../app/organization/[id]/page.tsx"),
      "utf8",
    );

    expect(pageSource).toContain(
      'previewSource === "remote" ? undefined : effectiveUserId',
    );
    expect(pageSource).toContain("viewerUserId: pluginViewerUserId");
  });

  test("V34: anonymous and staff routing are decided by their own boundaries", () => {
    expect(
      shouldRedirectMemberToPluginRoot({
        userRole: null,
        publicPage: "plugin",
        hasEmbeddedOrganizationTabs: false,
      }),
    ).toBe(false);
    expect(
      shouldRedirectMemberToPluginRoot({
        userRole: "staff",
        publicPage: "plugin",
        hasEmbeddedOrganizationTabs: false,
      }),
    ).toBe(false);
  });
});
