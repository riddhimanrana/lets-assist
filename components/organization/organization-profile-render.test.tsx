import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Organization, Project } from "@/types";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("@/app/organization/actions", () => ({
  joinOrganization: async () => {
    throw new Error("Rendering must not join an organization");
  },
  leaveOrganization: async () => {
    throw new Error("Rendering must not leave an organization");
  },
}));
mock.module("@/app/organization/create/actions", () => ({
  getOrganizationJoinCode: async () => {
    throw new Error("Rendering must not read the join code");
  },
  regenerateJoinCode: async () => {
    throw new Error("Rendering must not regenerate a code");
  },
}));
mock.module("@/app/organization/[id]/server/setup-checklist-mutations", () => ({
  setOrganizationSetupChecklistDismissed: async () => {
    throw new Error("Rendering must not dismiss the checklist");
  },
}));

const { default: OrganizationHeader } = await import("./OrganizationHeader");
const { OrganizationOverviewTab } = await import("./OrganizationOverviewTab");
const { default: OrganizationSetupChecklist } =
  await import("./OrganizationSetupChecklist");
const { default: ProjectsTab } =
  await import("@/app/organization/[id]/ProjectsTab");
const { Tabs } = await import("@/components/ui/tabs");

const organization = {
  id: "org-1",
  name: "Fictional Food Bank",
  username: "fictional-food-bank",
  description: "We run weekend food drives.",
  website: "example.org",
  type: "nonprofit",
  verified: true,
} as Organization & { website?: string | null };

function project(overrides: Partial<Project>): Project {
  return {
    id: "project-1",
    title: "Weekend food drive",
    description: "<p>Sort and pack donations.</p>",
    location: "Community hall",
    event_type: "oneTime",
    schedule: {
      oneTime: {
        date: "2099-03-14",
        startTime: "09:00",
        endTime: "12:00",
        volunteers: 10,
      },
    },
    status: "upcoming",
    created_at: "2020-01-02T00:00:00.000Z",
    ...overrides,
  } as Project;
}

const header = (props: {
  userRole: string | null;
  compact?: boolean;
  showInviteAction?: boolean;
  showProjectAction?: boolean;
  headingLevel?: 1 | 2;
}) =>
  renderToStaticMarkup(
    <OrganizationHeader
      organization={organization}
      memberCount={12}
      {...props}
    />,
  );

const inTabs = (node: ReactElement) =>
  renderToStaticMarkup(<Tabs value="overview">{node}</Tabs>);

describe("organization header", () => {
  test("shows identity and one meta line", () => {
    const html = header({ userRole: null });
    expect(html).toContain("Fictional Food Bank");
    expect(html).toContain("Verified organization");
    expect(html).toContain("Nonprofit");
    expect(html).toContain("@fictional-food-bank");
    expect(html).toContain('href="https://example.org"');
    expect(html).toContain("12 members");
  });

  test("a visitor gets Join and Share, and no member menu", () => {
    const html = header({ userRole: null });
    expect(html).toContain("Join");
    expect(html).toContain("Share");
    expect(html).not.toContain("New project");
    expect(html).not.toContain("Invite");
    expect(html).not.toContain("More organization actions");
  });

  test("a member gets Share and the menu that holds Leave", () => {
    const html = header({ userRole: "member" });
    expect(html).toContain("Share");
    expect(html).toContain('aria-label="More organization actions"');
    expect(html).not.toContain("New project");
    expect(html).not.toContain("Invite");
    expect(html).not.toContain(">Join<");
  });

  test("staff get New project but not Invite", () => {
    const html = header({ userRole: "staff" });
    expect(html).toContain('href="/projects/create?org=org-1"');
    expect(html).toContain("New project");
    expect(html).not.toContain("Invite");
  });

  test("an admin gets New project, Invite, Share and the menu", () => {
    const html = header({ userRole: "admin" });
    expect(html).toContain("New project");
    expect(html).toContain("Invite");
    expect(html).toContain("Share");
    expect(html).toContain('aria-label="More organization actions"');
  });

  test("the compact variant honours hidden Invite and New project", () => {
    const html = header({
      userRole: "admin",
      compact: true,
      showInviteAction: false,
      showProjectAction: false,
    });
    expect(html).toContain("Fictional Food Bank");
    expect(html).toContain("Share");
    expect(html).toContain('aria-label="More organization actions"');
    expect(html).not.toContain("New project");
    expect(html).not.toContain("Invite");
  });

  for (const compact of [false, true]) {
    const layout = compact ? "compact" : "generic";

    test(`the ${layout} header names the organization in one h1 by default`, () => {
      const html = header({ userRole: "admin", compact });
      expect(html.match(/<h1\b/gu)).toHaveLength(1);
      expect(html).not.toMatch(/<h2\b/u);
      expect(html).toMatch(/<h1\b[^>]*>(?:<span[^>]*>)?Fictional Food Bank/u);
    });

    test(`the ${layout} header moves that name to an h2 when embedded`, () => {
      const html = header({ userRole: "admin", compact, headingLevel: 2 });
      expect(html.match(/<h2\b/gu)).toHaveLength(1);
      expect(html).not.toMatch(/<h1\b/u);
      expect(html).toMatch(/<h2\b[^>]*>(?:<span[^>]*>)?Fictional Food Bank/u);

      // Only the tag changes: same classes, name, verified mark and actions.
      const asH1 = header({ userRole: "admin", compact }).replace(
        /(<\/?)h1\b/gu,
        "$1h2",
      );
      expect(html).toBe(asH1);
    });
  }
});

// Source check only: the mock section pulls in charts, dialogs and the tab
// module graph, so nothing renders it in a unit process yet.
describe("landing organization mock", () => {
  test("asks the header for an h2 and stays on the generic layout", () => {
    const section = readFileSync(
      new URL(
        "../../app/(landing)/_components/OrgToolingSection.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const usage = section.slice(
      section.indexOf("<OrganizationHeader"),
      section.indexOf("<OrganizationTabs"),
    );
    expect(usage).toContain("headingLevel={2}");
    expect(usage).not.toContain("compact");
  });

  // The sample organization is not a real record, so it does not borrow a
  // real domain or the verified mark. The header itself is unchanged.
  test("uses a reserved example domain and claims no verified status", () => {
    const section = readFileSync(
      new URL(
        "../../app/(landing)/_components/OrgToolingSection.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const start = section.indexOf("const mockOrganization = {");
    expect(start).toBeGreaterThan(-1);
    const sample = section.slice(start, section.indexOf("\n};", start));

    expect(sample).toContain('website: "https://sanramon.example/"');
    expect(sample).toContain("verified: false");
    expect(sample).not.toContain("verified: true");
    expect(sample).not.toContain(".gov");
    // The name, handle and logo are the ones the demo has always shown.
    expect(sample).toContain('name: "San Ramon City Alliance"');
    expect(sample).toContain('username: "sanramon"');
    expect(sample).toContain('logo_url: "/logos/sanramon.jpg"');
    expect(sample).toContain("this is a mock and is not affiliated");
  });

  test("the demo stays identifiable without the repeated fictional banner", () => {
    const intro = readFileSync(
      new URL(
        "../../app/(landing)/_components/OrgToolingIntro.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(intro).not.toContain("Fictional organization demo");
    expect(intro).toContain("Interactive organization demo");
    expect(intro).toContain("One workspace for your team");
    expect(intro).not.toContain("SignUpGenius");
  });
});

describe("organization overview tab", () => {
  const overview = (props: {
    projects: Project[];
    userRole: string | null;
    projectsHref?: string;
    demoAdminToolsContent?: ReactElement;
  }) =>
    inTabs(
      <OrganizationOverviewTab
        organization={organization}
        organizationCreatedLabel="January 1, 2025"
        memberCount={12}
        totalHours={48.5}
        pluginOverviewExtensions={[]}
        {...props}
      />,
    );

  test("leads with the stats strip and hides Cancelled at zero", () => {
    const html = overview({
      projects: [project({})],
      userRole: null,
      projectsHref: "?tab=projects",
    });
    for (const label of [
      "Members",
      "Total hours",
      "Projects",
      "Upcoming",
      "Completed",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("48.5h");
    expect(html).not.toContain("Cancelled");
    expect(html).not.toContain("Last 6 months");
  });

  test("counts cancelled projects once there are any", () => {
    const html = overview({
      projects: [project({}), project({ id: "p2", status: "cancelled" })],
      userRole: null,
    });
    expect(html).toContain("Cancelled");
  });

  test("keeps completed and cancelled badges compact beside recent project titles", () => {
    const html = overview({
      projects: [
        project({ id: "completed", status: "completed" }),
        project({ id: "cancelled", status: "cancelled" }),
      ],
      userRole: null,
    });
    expect(
      html.match(/data-slot="item-actions"[^>]*class="[^"]*shrink-0/g) ?? [],
    ).toHaveLength(2);
    expect(
      html.match(/text-xs py-0[^"]*whitespace-nowrap/g) ?? [],
    ).toHaveLength(2);
  });

  test("lists recent projects with a link to the full list", () => {
    const html = overview({
      projects: [project({})],
      userRole: null,
      projectsHref: "?tab=projects",
    });
    expect(html).toContain('href="/projects/project-1"');
    expect(html).toContain("Weekend food drive");
    expect(html).toContain("Community hall");
    expect(html).toContain('href="?tab=projects"');
    expect(html).toContain("View all");
  });

  // Whether a long title reads in full beside the badge at 320 and 390 is a
  // browser measurement. This holds the classes that allow it.
  test("a recent project title wraps to two lines on a phone", () => {
    const html = overview({
      projects: [project({ title: "Downtown Summer Market Support" })],
      userRole: null,
    });
    const title =
      /<span class="([^"]*)">Downtown Summer Market Support<\/span>/u.exec(
        html,
      );
    expect(title).not.toBeNull();
    const names = (title?.[1] ?? "").split(/\s+/u);

    expect(names).toEqual(
      expect.arrayContaining(["min-w-0", "line-clamp-2", "sm:line-clamp-1"]),
    );
    expect(names).not.toContain("truncate");
    // The row is still a link to the project, with its location under it.
    expect(html).toContain('href="/projects/project-1"');
    expect(html).toContain("Community hall");
  });

  test("shows an empty state, with New project only for staff and admins", () => {
    const visitor = overview({ projects: [], userRole: null });
    expect(visitor).toContain("No projects yet");
    expect(visitor).not.toContain("New project");

    const staff = overview({ projects: [], userRole: "staff" });
    expect(staff).toContain("No projects yet");
    expect(staff).toContain('href="/projects/create?org=org-1"');
  });

  test("keeps About and drops the role action card", () => {
    const html = overview({ projects: [], userRole: "admin" });
    expect(html).toContain("We run weekend food drives.");
    expect(html).toContain("January 1, 2025");
    for (const removed of [
      "Admin Tools",
      "Staff Actions",
      "Member Actions",
      "Apply for Verification",
      "Quick Stats",
    ]) {
      expect(html).not.toContain(removed);
    }
  });

  test("keeps the demo admin slot for admins only", () => {
    const slot = <button type="button">Demo marketplace</button>;
    expect(
      overview({
        projects: [],
        userRole: "admin",
        demoAdminToolsContent: slot,
      }),
    ).toContain("Demo marketplace");
    expect(
      overview({
        projects: [],
        userRole: "member",
        demoAdminToolsContent: slot,
      }),
    ).not.toContain("Demo marketplace");
  });
});

describe("organization projects tab", () => {
  const tab = (props: {
    projects: Project[];
    userRole: string | null;
    showCreateAction?: boolean;
  }) => renderToStaticMarkup(<ProjectsTab organizationId="org-1" {...props} />);

  test("shows the event date rather than the created date", () => {
    const html = tab({ projects: [project({})], userRole: null });
    expect(html).toContain("Mar 14, 2099");
    expect(html).not.toContain("Created");
    expect(html).not.toContain("2020");
    expect(html).toContain("Sort and pack donations.");
    expect(html).toContain("1 project");
  });

  test("survives a project with a malformed schedule", () => {
    const html = tab({
      projects: [project({ schedule: {} as Project["schedule"] })],
      userRole: null,
    });
    expect(html).toContain("Weekend food drive");
    expect(html).toContain("Community hall");
  });

  test("labels the status filter in full words with counts", () => {
    const html = tab({ projects: [project({})], userRole: null });
    for (const label of [
      "All",
      "Upcoming",
      "In progress",
      "Completed",
      "Cancelled",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('aria-label="Filter projects by status"');
    expect(html).toContain('aria-label="Search projects"');
  });

  test("leaves New project to the page header unless asked to show it", () => {
    const projects = [project({})];
    expect(tab({ projects, userRole: "admin" })).not.toContain("New project");
    expect(
      tab({ projects, userRole: "admin", showCreateAction: true }),
    ).toContain("New project");
    expect(
      tab({ projects, userRole: "member", showCreateAction: true }),
    ).not.toContain("New project");
  });

  test("offers New project in the empty state to staff and admins only", () => {
    const visitor = tab({ projects: [], userRole: null });
    expect(visitor).toContain("No projects yet");
    expect(visitor).not.toContain("New project");
    expect(tab({ projects: [], userRole: "staff" })).toContain(
      'href="/projects/create?org=org-1"',
    );
  });
});

describe("organization setup checklist", () => {
  test("keeps progress, the steps and the dismiss control", () => {
    const html = renderToStaticMarkup(
      <OrganizationSetupChecklist
        organizationId="org-1"
        checklist={{
          shouldShow: true,
          isComplete: false,
          completedCount: 1,
          totalCount: 2,
          items: [
            {
              id: "details",
              title: "Add organization details",
              description: "Logo, description and type.",
              href: "/organization/fictional-food-bank/settings",
              complete: true,
            },
            {
              id: "project",
              title: "Create a project",
              description: "Publish your first project.",
              href: "/projects/create?org=org-1",
              complete: false,
            },
          ],
        }}
      />,
    );
    expect(html).toContain('id="organization-setup-heading"');
    expect(html).toContain('aria-labelledby="organization-setup-heading"');
    expect(html).toContain("1 of 2 done");
    expect(html).toContain('aria-label="Hide the setup checklist"');
    expect(html).toContain(
      'aria-label="Setup progress: 1 of 2 steps complete"',
    );
    expect(html).toContain('href="/organization/fictional-food-bank/settings"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Not started");
    expect(html).toContain("Complete");
  });
});
