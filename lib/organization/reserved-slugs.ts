/**
 * An organization username is the first `/organization/<username>` URL
 * segment. Every static or special child route under `app/organization`
 * (`create`, `join`) occupies that same segment, so an organization claiming
 * one of those usernames would either be unreachable at its own profile URL
 * or shadow the platform route it collides with.
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
 * `-`: nothing enforces that format on a direct database write.
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
