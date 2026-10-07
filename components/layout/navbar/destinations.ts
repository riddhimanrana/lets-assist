export type NavDestination = readonly [label: string, href: string];

export const featureLinks = [
  {
    title: "Volunteer journey",
    href: "/#journey",
    description:
      "Browse opportunities, confirm attendance, and earn certificates.",
  },
  {
    title: "Platform features",
    href: "/#features",
    description:
      "Calendar sync, dashboards, QR check-ins, and trusted event types.",
  },
  {
    title: "Organization tooling",
    href: "/#org-tooling",
    description:
      "Role-based member management, certified reports, and QR verification.",
  },
] as const;

export const memberLinks = [
  ["Home", "/home"],
  ["Volunteer dashboard", "/dashboard"],
  ["My projects", "/projects"],
  ["Organizations", "/organization"],
] as const satisfies readonly NavDestination[];

export const publicLinks = [
  ["Volunteering near me", "/projects"],
  ["Connected organizations", "/organization"],
  ["FAQ", "/faq"],
] as const satisfies readonly NavDestination[];

/** A destination stays active on its own page and on the pages nested under it. */
export function isActiveDestination(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
