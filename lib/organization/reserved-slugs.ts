/**
 * An organization username is the first `/organization/<username>` URL
 * segment. Every static or special child route under `app/organization`
 * (`create`, `join`) occupies that same segment. In Next.js App Router a
 * static segment always wins over the `[id]` dynamic segment it sits
 * alongside, so an organization claiming one of those usernames would
 * simply be unreachable at its own profile URL -- it can never shadow the
 * static route, only lose to it.
 *
 * This is the single source of truth for that reserved set: it must be kept
 * in sync with the static/special directories under `app/organization`
 * (everything that is not the `[id]` dynamic segment). Both the client-side
 * availability hint and the create/update Server Actions read from here, but
 * the database also enforces it directly -- RLS lets organization admins and
 * trusted members write `organizations.username` straight through the Data
 * API, so a Server Action check alone cannot be the only gate. See the
 * `organizations_username_not_reserved_check` constraint.
 */
export const RESERVED_ORGANIZATION_SLUGS: ReadonlySet<string> = new Set([
  "create",
  "join",
]);

/**
 * Case, surrounding whitespace, and Unicode compatibility variants (e.g. the
 * full-width or ligature spellings that normalize to plain ASCII) must not
 * be a way to smuggle a reserved slug past this check, even though the
 * ordinary username format only allows ASCII letters, numbers, `_`, `.`, and
 * `-`. The separate format constraint is intentionally not validated against
 * historical rows yet, so this normalization remains necessary for the
 * independently validated reserved-route invariant.
 */
export function normalizeOrganizationSlugForReservedCheck(
  value: string,
): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function isReservedOrganizationSlug(value: string): boolean {
  return RESERVED_ORGANIZATION_SLUGS.has(
    normalizeOrganizationSlugForReservedCheck(value),
  );
}

/**
 * A username can be unavailable for two different reasons -- another
 * organization already holds it, or it is one of
 * `RESERVED_ORGANIZATION_SLUGS` and no organization can ever hold it.
 * Calling the reserved case "already taken" is false: retrying later, or
 * with a different case/whitespace spelling of the same reserved word, will
 * never make it available, unlike a genuinely taken username.
 *
 * This lives here, beside the reserved set itself, rather than inside a
 * form component: the create flow surfaces the same distinction from the
 * Server Action (`createOrganization`/`updateOrganization` return these
 * exact strings), so the copy has one home and can be exercised directly by
 * tests without importing a client component and its Server Action module
 * graph.
 */
export function usernameUnavailableMessage(isReserved: boolean): string {
  return isReserved
    ? "That username is reserved and can't be used"
    : "Username is already taken";
}
