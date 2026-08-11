/**
 * The organization setup checklist.
 *
 * Deliberately a derived checklist rather than a second FirstLoginTour: tour
 * completion is stored per user in auth metadata, and one person can administer
 * several organizations, so a user-scoped boolean cannot answer "is *this*
 * organization set up". Setup is also multi-visit — waiting on a plugin
 * entitlement can take days — and a spotlight tour has no partial-progress
 * model, while completion here is derived from data the organization page has
 * already loaded.
 *
 * Pure: no I/O, so the rules are testable on their own.
 */

export type OrganizationSetupItemId =
  "details" | "invite" | "plugin" | "project";

/**
 * Every field here is already loaded by the organization page — `logo_url`,
 * `description`, and `type` come from `organization_public_read_model`, the
 * counts from the member and project lists, and plugin availability from the
 * plugin resolution the page performs anyway. Only `dismissedAt` needs its own
 * read, and only for admins.
 *
 * There is deliberately no "set a join method" step: `organizations.join_code`
 * is NOT NULL and set at creation, so such a step would always be complete.
 */
export interface OrganizationSetupSnapshot {
  organizationSlug: string;
  hasLogo: boolean;
  hasDescription: boolean;
  hasType: boolean;
  memberCount: number;
  projectCount: number;
  /** False when the organization has no plugin available to it at all. */
  hasPluginAvailable: boolean;
  hasEnabledPlugin: boolean;
  dismissedAt: string | null;
}

export interface OrganizationSetupItem {
  id: OrganizationSetupItemId;
  title: string;
  description: string;
  href: string;
  complete: boolean;
}

export interface OrganizationSetupChecklist {
  items: OrganizationSetupItem[];
  completedCount: number;
  totalCount: number;
  isComplete: boolean;
  /** The page should render the checklist only when this is true. */
  shouldShow: boolean;
}

export function deriveOrganizationSetupChecklist(
  snapshot: OrganizationSetupSnapshot,
): OrganizationSetupChecklist {
  const slug = snapshot.organizationSlug;

  const allItems: OrganizationSetupItem[] = [
    {
      id: "details",
      title: "Add your organization details",
      description: "A logo, a description, and a type help people find you.",
      href: `/organization/${slug}/settings`,
      complete: snapshot.hasLogo && snapshot.hasDescription && snapshot.hasType,
    },
    {
      id: "invite",
      title: "Invite your team",
      description: "Add the other admins and staff who will run things.",
      href: `/organization/${slug}?tab=members`,
      // The creator is a member from the moment the organization exists, so
      // anyone beyond them is the honest threshold.
      complete: snapshot.memberCount > 1,
    },
    {
      id: "plugin",
      title: "Set up your plugin",
      description: "Turn on the tools your organization was given access to.",
      href: `/organization/${slug}/settings`,
      complete: snapshot.hasEnabledPlugin,
    },
    {
      id: "project",
      title: "Create your first project",
      description: "Publish something for volunteers to sign up to.",
      href: "/projects/create",
      complete: snapshot.projectCount > 0,
    },
  ];

  // An organization with no entitlement has no plugin to set up, so showing the
  // step would make the checklist permanently incompletable.
  const items = allItems.filter((item) =>
    item.id === "plugin" ? snapshot.hasPluginAvailable : true,
  );

  const completedCount = items.filter((item) => item.complete).length;
  const totalCount = items.length;
  const isComplete = completedCount === totalCount;

  return {
    items,
    completedCount,
    totalCount,
    isComplete,
    shouldShow: !isComplete && snapshot.dismissedAt === null,
  };
}
