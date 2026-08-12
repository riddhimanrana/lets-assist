-- Organization usernames route as the first `/organization/<username>` URL
-- segment. `create` and `join` are static routes under `app/organization`
-- (organization creation and the join flow). In Next.js App Router, a
-- static segment always wins over the `[id]` dynamic segment it sits
-- alongside, so an organization claiming either username would simply be
-- unreachable at its own profile URL -- the static route always resolves
-- first. The reverse can never happen: a static route can never be
-- shadowed by a dynamic one.
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
-- `ADD CONSTRAINT ... CHECK` with no `NOT VALID` validates every existing
-- row as part of this migration, which is the intended, stricter behavior --
-- not a `NOT VALID` + later `VALIDATE CONSTRAINT` split. That is safe to run
-- unconditionally here because a read-only aggregate -- counts only, no
-- rows selected or recorded -- was run against both hosted databases before
-- this migration was written, applying the exact normalization below
-- (NFKC, then the full ECMAScript trim set spelled out further down, then
-- lower) and counting matches against `create` and `join`. Development
-- reported 5 organizations and 0 exact reserved collisions; Production
-- reported 13 organizations and 0 exact reserved collisions. No existing
-- organization is renamed or otherwise mutated by adding this constraint,
-- and the validating form cannot fail on either database.
--
-- That aggregate covers only exact post-normalization equality, which is
-- precisely what this constraint tests. It says nothing about usernames
-- that merely resemble a reserved word, and nothing about the unrelated
-- global username *format* question tracked as AUD-021 in the cleanup
-- register.
--
-- The comparison normalizes case, Unicode compatibility variants (NFKC),
-- and leading/trailing whitespace before comparing, in exactly that order,
-- matching normalizeOrganizationSlugForReservedCheck in the application
-- layer (`value.normalize("NFKC").trim().toLowerCase()`): the ordinary
-- username format (ASCII letters, digits, `_`, `.`, `-`) is only enforced
-- client-side, so a direct write is not guaranteed to be ASCII, or even to
-- avoid whitespace entirely.
--
-- The trim has to be exactly JavaScript's, not an approximation of it. Any
-- code point `String.prototype.trim()` strips but this constraint keeps is
-- a bypass: the application layer would normalize the padded value to a
-- reserved word and refuse it, while a direct Data API write of the same
-- padded value would be stored and would then collide with the static
-- route. `btrim(string)` (the one-argument form) strips only U+0020 SPACE,
-- so it is not usable here.
--
-- ECMAScript defines `trim()` as stripping the union of WhiteSpace and
-- LineTerminator, which is exactly these 25 code points:
--
--   U+0009 CHARACTER TABULATION      U+000A LINE FEED
--   U+000B LINE TABULATION           U+000C FORM FEED
--   U+000D CARRIAGE RETURN           U+0020 SPACE
--   U+00A0 NO-BREAK SPACE            U+1680 OGHAM SPACE MARK
--   U+2000 EN QUAD .. U+200A HAIR SPACE (eleven code points)
--   U+2028 LINE SEPARATOR            U+2029 PARAGRAPH SEPARATOR
--   U+202F NARROW NO-BREAK SPACE     U+205F MEDIUM MATHEMATICAL SPACE
--   U+3000 IDEOGRAPHIC SPACE         U+FEFF ZERO WIDTH NO-BREAK SPACE
--
-- The bracket expression below spells that set out with PostgreSQL regular
-- expression character-entry escapes, and only anchors at the two ends, so
-- interior whitespace is preserved exactly as `trim()` preserves it. An
-- exhaustive scan over the entire Basic Multilingual Plane confirms this
-- class strips these 25 code points and no others -- the same 25 an
-- exhaustive scan of `String.prototype.trim()` strips -- so near misses
-- that look like whitespace but are not (U+00AD SOFT HYPHEN, U+180E
-- MONGOLIAN VOWEL SEPARATOR, U+200B ZERO WIDTH SPACE, U+2060 WORD JOINER)
-- are left in place on both sides. `supabase/tests/database/
-- organization_username_reserved_slugs.test.sql` drives the full matrix
-- through this constraint, and `lib/organization/reserved-slugs.test.ts`
-- drives the same matrix through the JavaScript helper.
--
-- Several of these code points are already folded to U+0020 by the NFKC
-- pass that runs first (U+00A0, U+2000..U+200A, U+202F, U+205F, U+3000), so
-- a narrower class would still have caught them by accident. Three are not:
-- U+1680 OGHAM SPACE MARK, U+2028 LINE SEPARATOR, and U+2029 PARAGRAPH
-- SEPARATOR survive NFKC unchanged, and a class covering only the C0
-- controls, U+0020, and U+FEFF genuinely accepted a reserved word padded
-- with any of them while the application layer refused the same value.
-- Every code point is listed regardless, so the class is the ECMAScript set
-- verbatim rather than a set that happens to work given today's NFKC
-- folding table.
--
-- The reserved set here must stay in sync with
-- lib/organization/reserved-slugs.ts and with the static/special child
-- directories of app/organization.
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_username_not_reserved_check
  CHECK (
    lower(
      regexp_replace(
        normalize(username, nfkc),
        '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+'
          || '|'
          || '[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
        '',
        'g'
      )
    ) <> ALL (ARRAY['create', 'join'])
  );

-- `authenticated` still holds TRUNCATE, REFERENCES, and TRIGGER on
-- `public.organizations`, left over from the initial baseline schema's
-- blanket `GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ...
-- TO authenticated` (20260325181408_20260325_initial_baseline_schema.sql).
-- 20260701180752_organization_public_read_models_and_policy_hardening.sql
-- and 20260712014700_close_organization_and_plugin_data_api_bypasses.sql
-- already narrowed `anon` and revoked `SELECT` from both `anon` and
-- `authenticated`, but never revisited these three privileges for
-- `authenticated`.
--
-- None of RLS, the "Create org with serialized cooldown" INSERT policy, or
-- the "Allow admins to update organizations" UPDATE policy constrain these
-- three: RLS policies gate row-level INSERT/UPDATE/DELETE/SELECT, but
-- PostgreSQL never consults RLS for TRUNCATE, and REFERENCES/TRIGGER are
-- whole-table DDL privileges RLS was never designed to gate at all. Holding
-- TRUNCATE means every authenticated user -- not just an org admin, not
-- just a trusted member, literally anyone with a session -- can run
-- `TRUNCATE public.organizations` and delete every organization in one
-- statement, bypassing every RLS policy on this table entirely.
--
-- The application never truncates this table, creates a trigger on it, or
-- owns another table that would add a foreign key referencing it through
-- the client SDK -- those are schema-migration-time operations performed as
-- `postgres`/`service_role`, never something an authenticated end user's
-- session needs. Revoking is a pure privilege narrowing with no data to
-- validate against and no legitimate application code path depends on it,
-- unlike the reserved-slug CHECK constraint above.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.organizations FROM authenticated;
