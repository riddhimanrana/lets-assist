-- Organization usernames route as the first `/organization/<username>` URL
-- segment. `create` and `join` are static routes under `app/organization`
-- (organization creation and the join flow), so an organization claiming
-- either username would be unreachable at its own profile URL and would
-- shadow -- or be shadowed by -- a platform route.
--
-- `checkOrgUsername`/`createOrganization` and `checkUsernameAvailability`/
-- `updateOrganization` already refuse these usernames at the Server Action
-- boundary (lib/organization/reserved-slugs.ts is the shared source of
-- truth). That is not sufficient on its own: "Create org with serialized
-- cooldown" lets a trusted member INSERT an organization directly, and
-- "Allow admins to update organizations" lets an org admin UPDATE one
-- directly, both through the ordinary Data API with no column-level WITH
-- CHECK on username. Either policy lets an authenticated client bypass the
-- Server Action entirely. This CHECK constraint is therefore the backstop:
-- it runs for every write to this column regardless of role or code path.
--
-- The comparison normalizes case, surrounding whitespace, and Unicode
-- compatibility variants (NFKC) before comparing, matching
-- normalizeOrganizationSlugForReservedCheck in the application layer: the
-- ordinary username format (ASCII letters, digits, `_`, `.`, `-`) is only
-- enforced client-side, so a direct write is not guaranteed to be ASCII.
--
-- The reserved set here must stay in sync with
-- lib/organization/reserved-slugs.ts and with the static/special child
-- directories of app/organization.
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_username_not_reserved_check
  CHECK (
    lower(btrim(normalize(username, nfkc))) <> ALL (ARRAY['create', 'join'])
  );
