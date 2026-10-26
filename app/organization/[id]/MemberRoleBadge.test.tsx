import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { OrganizationRoleBadge } from "../OrganizationCard";
import { MemberRoleBadge } from "./MemberRoleBadge";

const badge = (role: string) =>
  renderToStaticMarkup(<MemberRoleBadge role={role} />);

describe("member role badge", () => {
  test("admin uses the shared primary fill and theme foreground", () => {
    const html = badge("admin");
    expect(html).toContain("Admin");
    expect(html).toContain("bg-primary");
    expect(html).toContain("text-primary-foreground");
    expect(html).not.toContain("text-foreground");
    expect(html).not.toContain("bg-secondary");
    expect(html).not.toContain("bg-info");
  });

  test("staff keeps a readable foreground on the semantic blue tint", () => {
    const html = badge("staff");
    expect(html).toContain("Staff");
    expect(html).toContain("border-info/20");
    expect(html).toContain("text-foreground dark:text-info");
    expect(html).toContain("bg-info/10");
    expect(html).not.toContain("bg-primary");
  });

  test("member is an outline label with a muted icon", () => {
    const html = badge("member");
    expect(html).toContain("Member");
    expect(html).toContain("border-border");
    expect(html).not.toContain("text-primary");
    expect(html).not.toContain("text-info");
  });

  test("an unknown role never reads as admin or staff", () => {
    for (const role of ["", "owner", "ADMIN", "superadmin"]) {
      const html = badge(role);
      expect(html).toContain("Member");
      expect(html).not.toContain("Admin");
      expect(html).not.toContain("Staff");
      expect(html).not.toContain("text-primary");
      expect(html).not.toContain("text-info");
    }
  });

  test("every role icon is hidden from assistive technology", () => {
    for (const role of ["admin", "staff", "member"]) {
      const html = badge(role);
      expect((html.match(/<svg/gu) ?? []).length).toBe(1);
      expect(html).toMatch(/<svg[^>]*aria-hidden="true"/u);
    }
  });

  test("the directory badge is the same presentation", () => {
    for (const role of ["admin", "staff", "member"] as const) {
      expect(renderToStaticMarkup(<OrganizationRoleBadge role={role} />)).toBe(
        badge(role),
      );
    }
  });
});
