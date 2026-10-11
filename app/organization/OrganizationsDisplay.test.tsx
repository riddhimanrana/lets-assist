import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
mock.module("@/app/organization/actions", () => ({
  joinOrganization: async () => {
    throw new Error("Rendering must not join an organization");
  },
}));
// Render only the trigger so page-action assertions see the visible button
// without mounting the certificate dialog.
mock.module("@/app/organization/CsvVerificationModal", () => ({
  CsvVerificationModal: ({ children }: { children?: ReactNode }) =>
    children ?? null,
}));

const { default: OrganizationsDisplay } =
  await import("./OrganizationsDisplay");

function emptyState({
  isLoggedIn,
  isTrusted = false,
  applicationStatus,
  role,
}: {
  isLoggedIn: boolean;
  isTrusted?: boolean;
  applicationStatus?: boolean | null;
  role?: "member" | "staff" | "admin";
}) {
  const html = renderToStaticMarkup(
    <OrganizationsDisplay
      organizations={[]}
      memberCounts={{}}
      isLoggedIn={isLoggedIn}
      isTrusted={isTrusted}
      applicationStatus={applicationStatus}
      userMemberships={role ? [{ role, organizations: null }] : []}
    />,
  );
  const start = html.indexOf('data-slot="empty"');
  expect(start).toBeGreaterThanOrEqual(0);
  // The empty state is the final content group. Excluding the preceding page
  // header ensures its duplicate actions cannot satisfy these assertions.
  return html.slice(start);
}

type DirectoryProps = ComponentProps<typeof OrganizationsDisplay>;
type DirectoryOrganization = DirectoryProps["organizations"][number];

// Fictional organizations. Never replace these with real directory data.
const fixtureOrg = (
  id: string,
  username: string,
  name: string,
  extra: { type?: string; verified?: boolean; description?: string } = {},
): DirectoryOrganization => ({
  id,
  username,
  name,
  description: extra.description,
  type: extra.type ?? "nonprofit",
  verified: extra.verified ?? false,
  logo_url: undefined,
  created_at: "2026-01-01T00:00:00.000Z",
});

const memberOrg = fixtureOrg("org-member", "maple-tutors", "Maple Tutors", {
  type: "school",
  verified: true,
  description: "Fictional tutoring group for directory rendering.",
});
const privateMemberOrg = fixtureOrg(
  "org-private",
  "harbor-cleanup",
  "Harbor Cleanup Crew",
);
const publicOrg = fixtureOrg("org-public", "cedar-pantry", "Cedar Pantry", {
  description: "Fictional food pantry for directory rendering.",
});
const privatePublicOrg = fixtureOrg(
  "org-hidden",
  "quiet-garden",
  "Quiet Garden Club",
);

function populatedDirectory({
  isLoggedIn = true,
  isTrusted = false,
}: { isLoggedIn?: boolean; isTrusted?: boolean } = {}) {
  const html = renderToStaticMarkup(
    <OrganizationsDisplay
      // The public read returns member organizations too; the directory must
      // show each of them once.
      organizations={[memberOrg, privateMemberOrg, publicOrg, privatePublicOrg]}
      memberCounts={{
        [memberOrg.id]: 12,
        [privateMemberOrg.id]: null,
        [publicOrg.id]: 1,
        [privatePublicOrg.id]: null,
      }}
      isLoggedIn={isLoggedIn}
      isTrusted={isTrusted}
      userMemberships={
        isLoggedIn
          ? [
              { role: "admin", organizations: memberOrg },
              { role: "member", organizations: privateMemberOrg },
            ]
          : []
      }
    />,
  );
  const discoverStart = html.indexOf(">Discover<");
  expect(discoverStart).toBeGreaterThanOrEqual(0);
  const ownedStart = html.indexOf(">Your organizations<");
  return {
    html,
    owned: ownedStart >= 0 ? html.slice(ownedStart, discoverStart) : "",
    discover: html.slice(discoverStart),
  };
}

const occurrences = (html: string, needle: string) =>
  html.split(needle).length - 1;

describe("organization directory cards", () => {
  test("memberships and discovered organizations each link once from their own section", () => {
    const { html, owned, discover } = populatedDirectory();

    expect(occurrences(html, "<h1")).toBe(1);
    expect(html).toMatch(/<h1[^>]*>Organizations<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>Your organizations<\/h2>/);
    expect(html).toMatch(/<h2[^>]*>Discover<\/h2>/);

    for (const org of [memberOrg, privateMemberOrg]) {
      const href = `href="/organization/${org.username}"`;
      expect(occurrences(owned, href)).toBe(1);
      expect(discover).not.toContain(href);
    }
    for (const org of [publicOrg, privatePublicOrg]) {
      const href = `href="/organization/${org.username}"`;
      expect(occurrences(discover, href)).toBe(1);
      expect(owned).not.toContain(href);
    }
  });

  test("owned cards keep role, type, handle, description and verified cue", () => {
    const { owned, discover } = populatedDirectory();

    expect(owned).toContain("bg-primary/5");
    expect(discover).not.toContain("bg-primary/5");
    expect(owned).toContain("Maple Tutors");
    expect(owned).toContain("@maple-tutors");
    expect(owned).toContain("Educational");
    expect(owned).toContain("Admin");
    // "Member<" is the role badge; the footer reads "Members private".
    expect(owned).toContain("Member<");
    expect(owned).toContain(
      "Fictional tutoring group for directory rendering.",
    );
    expect(occurrences(owned, 'aria-label="Verified organization"')).toBe(1);

    // Discovered cards carry no membership role for the viewer.
    expect(discover).not.toContain("Admin");
    expect(discover).not.toContain('aria-label="Verified organization"');
    expect(discover).toContain(
      "Fictional food pantry for directory rendering.",
    );
  });

  test("a private member list never renders as a count", () => {
    const { html, owned, discover } = populatedDirectory();

    expect(owned).toContain("12 members");
    expect(occurrences(owned, "Members private")).toBe(1);
    expect(discover).toContain("1 member<");
    expect(occurrences(discover, "Members private")).toBe(1);
    expect(html).not.toContain("0 members");
  });

  test("signed-in page actions are visible without a More actions menu", () => {
    const untrusted = populatedDirectory().html;
    expect(untrusted).toContain("Verify certificates");
    expect(untrusted).toContain("Join with code");
    expect(untrusted).not.toContain("More actions");
    // An organization admin role is not global creation eligibility.
    expect(untrusted).not.toContain('href="/organization/create"');
    expect(untrusted).toContain('href="/trusted-member"');

    const trusted = populatedDirectory({ isTrusted: true }).html;
    expect(trusted).toContain("Verify certificates");
    expect(occurrences(trusted, 'href="/organization/create"')).toBe(1);
  });

  test("visitors see neutral cards and sign-in guidance only", () => {
    const { html, owned, discover } = populatedDirectory({
      isLoggedIn: false,
      isTrusted: true,
    });

    expect(owned).toBe("");
    expect(discover).not.toContain("bg-primary/5");
    expect(occurrences(discover, 'href="/organization/')).toBe(4);
    expect(html).toContain('href="/login?redirect=/organization"');
    expect(html).not.toContain("Verify certificates");
    expect(html).not.toContain("Join with code");
    expect(html).not.toContain('href="/organization/create"');
    expect(html).not.toContain("Admin");
  });
});

describe("organization directory empty-state eligibility", () => {
  test("visitors receive sign-in guidance without join or create controls", () => {
    for (const isTrusted of [false, true]) {
      const html = emptyState({ isLoggedIn: false, isTrusted });
      expect(html).toContain('href="/login?redirect=/organization"');
      expect(html).not.toContain("Join with code");
      expect(html).not.toContain('href="/organization/create"');
    }
  });

  test("signed-in users can join while creation eligibility is unresolved or refused", () => {
    for (const applicationStatus of [undefined, null, false]) {
      const html = emptyState({ isLoggedIn: true, applicationStatus });
      expect(html).toContain("Join with code");
      expect(html).not.toContain('href="/organization/create"');
      expect(html).not.toContain('href="/login?redirect=/organization"');
    }
  });

  test("trusted users and approved applicants get the existing create route", () => {
    for (const props of [
      { isTrusted: true },
      { isTrusted: false, applicationStatus: true },
    ]) {
      const html = emptyState({ isLoggedIn: true, ...props });
      expect(html).toContain("Join with code");
      expect(html).toContain('href="/organization/create"');
    }
  });

  test("an organization role alone does not grant global creation eligibility", () => {
    for (const role of ["member", "staff", "admin"] as const) {
      const html = emptyState({ isLoggedIn: true, role });
      expect(html).toContain("Join with code");
      expect(html).not.toContain('href="/organization/create"');
    }
  });
});
