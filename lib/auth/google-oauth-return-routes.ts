/**
 * Purpose-specific return-route allowlist.
 *
 * `normalizeGoogleOAuthReturnTo` only proves a path is same-origin and
 * relative, which let any in-app path become the landing page for a callback
 * carrying `?success=connected&email=...`. Each purpose has a small, audited
 * set of surfaces that actually start a Google connection, so the destination
 * is matched against that set instead.
 *
 * The call sites this mirrors are exact:
 *   personal_calendar     account/calendar, a project page
 *   personal_sheets       account/calendar (no initiating surface today)
 *   organization_calendar organization settings, calendar section
 *   organization_sheets   organization settings sheets section, reports tab
 *   csf_import            the canonical CSF imports/meetings/partners tabs
 */

import {
  normalizeGoogleOAuthReturnTo,
  type GoogleOAuthConnectionPurpose,
} from "./google-oauth-state";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The canonical CSF return tabs. Changing these breaks officer bookmarks. */
export const CSF_IMPORT_RETURN_TABS = [
  "csf-imports",
  "csf-meetings",
  "csf-partners",
] as const;

type ReturnRouteRule = {
  /** Path segments; `:org` matches an allowed organization id or slug. */
  path: readonly string[];
  /** Exactly the query keys allowed, each with its allowed values. */
  query?: Readonly<Record<string, readonly string[]>>;
};

const RETURN_ROUTE_RULES: Readonly<
  Record<GoogleOAuthConnectionPurpose, readonly ReturnRouteRule[]>
> = {
  personal_calendar: [
    { path: ["account", "calendar"] },
    { path: ["projects", ":id"] },
  ],
  personal_sheets: [{ path: ["account", "calendar"] }],
  organization_calendar: [
    {
      path: ["organization", ":org", "settings"],
      query: { section: ["calendar"] },
    },
  ],
  organization_sheets: [
    {
      path: ["organization", ":org", "settings"],
      query: { section: ["sheets"] },
    },
    { path: ["organization", ":org"], query: { tab: ["reports"] } },
  ],
  csf_import: [
    { path: ["organization", ":org"], query: { tab: CSF_IMPORT_RETURN_TABS } },
  ],
};

/** The destination used when a request supplies no usable return route. */
export function getGoogleOAuthDefaultReturnRoute(input: {
  purpose: GoogleOAuthConnectionPurpose;
  organizationSegment: string | null;
}): string {
  switch (input.purpose) {
    case "organization_calendar":
      return input.organizationSegment
        ? `/organization/${input.organizationSegment}/settings?section=calendar`
        : "/account/calendar";
    case "organization_sheets":
      return input.organizationSegment
        ? `/organization/${input.organizationSegment}/settings?section=sheets`
        : "/account/calendar";
    case "csf_import":
      return input.organizationSegment
        ? `/organization/${input.organizationSegment}?tab=csf-imports`
        : "/account/calendar";
    default:
      return "/account/calendar";
  }
}

function matchesSegment(
  pattern: string,
  actual: string,
  allowedOrganizationSegments: ReadonlySet<string>,
): boolean {
  if (pattern === ":org") {
    return allowedOrganizationSegments.has(actual.toLowerCase());
  }
  if (pattern === ":id") {
    return UUID_PATTERN.test(actual);
  }
  return pattern === actual;
}

function matchesRule(
  rule: ReturnRouteRule,
  url: URL,
  allowedOrganizationSegments: ReadonlySet<string>,
): boolean {
  if (url.hash) return false;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== rule.path.length) return false;
  if (
    !rule.path.every((pattern, index) =>
      matchesSegment(pattern, segments[index], allowedOrganizationSegments),
    )
  ) {
    return false;
  }

  const allowedQuery = rule.query ?? {};
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) return false;
    seen.add(key);
    const allowedValues = allowedQuery[key];
    if (!allowedValues?.includes(value)) return false;
  }

  return true;
}

/**
 * Resolve the destination this attempt is allowed to return to.
 *
 * A request that asks for anything outside its purpose's allowlist is not an
 * error the operator can act on -- it is a wiring mistake or an attempt to
 * borrow the callback as a redirector -- so it silently falls back to the
 * purpose's own default surface rather than failing the connection.
 */
export function resolveGoogleOAuthReturnRoute(input: {
  purpose: GoogleOAuthConnectionPurpose;
  returnTo: string | null | undefined;
  organizationSegments?: readonly (string | null | undefined)[];
}): { returnTo: string; allowlisted: boolean } {
  const organizationSegments = new Set(
    (input.organizationSegments ?? [])
      .filter((segment): segment is string => Boolean(segment?.trim()))
      .map((segment) => segment.trim().toLowerCase()),
  );
  const fallback = getGoogleOAuthDefaultReturnRoute({
    purpose: input.purpose,
    organizationSegment: [...organizationSegments][0] ?? null,
  });

  const normalized = normalizeGoogleOAuthReturnTo(input.returnTo);
  if (!normalized) return { returnTo: fallback, allowlisted: false };

  let url: URL;
  try {
    url = new URL(normalized, "https://lets-assist.invalid");
  } catch {
    return { returnTo: fallback, allowlisted: false };
  }

  const matched = RETURN_ROUTE_RULES[input.purpose].some((rule) =>
    matchesRule(rule, url, organizationSegments),
  );

  return matched
    ? { returnTo: normalized, allowlisted: true }
    : { returnTo: fallback, allowlisted: false };
}
