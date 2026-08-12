BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(323);

-- The Server Action boundary is not the only way to write
-- `organizations.username`: RLS lets a trusted member INSERT an
-- organization directly and an org admin UPDATE one directly, both through
-- the ordinary Data API. This suite proves the database itself, not just
-- the application layer, refuses every reserved-slug spelling.

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organizations'::regclass
      AND conname = 'organizations_username_not_reserved_check'
      AND contype = 'c'
      AND convalidated
  ),
  'organization usernames have a validated reserved-slug constraint'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organizations'::regclass
      AND conname = 'organizations_username_valid_format_check'
      AND contype = 'c'
      AND NOT convalidated
  ),
  'organization usernames have a forward-only format constraint pending historical validation'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'fe000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'org-reserved-admin@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(), now()
  ),
  (
    'fe000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'org-reserved-creator@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(), now()
  );

-- `profiles.trusted_member` is server-managed (AUD-001); grant trust through
-- the real application + service-role approval path instead of writing the
-- flag directly. The applicant insert requires an authenticated actor (the
-- identity trigger reads `auth.uid()`); the approval requires service_role.
-- User 001 owns the fixture organization used for the UPDATE tests below.
-- User 002 has no organizations of its own and is used for the direct
-- INSERT tests, so the create-organization cooldown (one per 14 days) never
-- interferes with proving the reserved-slug constraint.
SET LOCAL request.jwt.claims =
  '{"sub":"fe000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

INSERT INTO public.trusted_member (user_id, status, name, email, reason)
VALUES (
  'fe000000-0000-4000-8000-000000000001',
  NULL,
  'Org Reserved Admin',
  'org-reserved-admin@local.test',
  'Fixture for reserved-slug write-path coverage'
);

RESET ROLE;
SET LOCAL request.jwt.claims =
  '{"sub":"fe000000-0000-4000-8000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

INSERT INTO public.trusted_member (user_id, status, name, email, reason)
VALUES (
  'fe000000-0000-4000-8000-000000000002',
  NULL,
  'Org Reserved Creator',
  'org-reserved-creator@local.test',
  'Fixture for reserved-slug write-path coverage'
);

RESET ROLE;
SET LOCAL ROLE service_role;

UPDATE public.trusted_member
  SET status = true
  WHERE user_id IN (
    'fe000000-0000-4000-8000-000000000001',
    'fe000000-0000-4000-8000-000000000002'
  );

RESET ROLE;

INSERT INTO public.organizations (
  id, name, username, type, join_code, created_by
)
VALUES (
  'fe100000-0000-4000-8000-000000000001',
  'Organization Reserved Slug Fixture',
  'organization-reserved-slug-fixture',
  'school',
  '801001',
  'fe000000-0000-4000-8000-000000000001'
);

INSERT INTO public.organization_members (
  id, organization_id, user_id, role
)
VALUES (
  'fe200000-0000-4000-8000-000000000001',
  'fe100000-0000-4000-8000-000000000001',
  'fe000000-0000-4000-8000-000000000001',
  'admin'
);

SET LOCAL request.jwt.claims =
  '{"sub":"fe000000-0000-4000-8000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

-- Direct inserts: every reserved spelling is rejected, exactly like a
-- Server Action call would be, but enforced without one.
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000002',
      'Reserved Create Attempt',
      'create',
      'school',
      '801002',
      'fe000000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username "create"'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000003',
      'Reserved Join Attempt',
      'join',
      'school',
      '801003',
      'fe000000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username "join"'
);

-- Case, surrounding whitespace, and Unicode compatibility variants are the
-- same reserved slug once normalized, and must not be a bypass.
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000004',
      'Reserved Create Case Attempt',
      'CREATE',
      'school',
      '801004',
      'fe000000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username via an uppercase spelling'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000005',
      'Reserved Join Whitespace Attempt',
      '  join  ',
      'school',
      '801005',
      'fe000000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username via padding whitespace'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000006',
      'Reserved Create Fullwidth Attempt',
      E'ｃｒｅａｔｅ',
      'school',
      '801006',
      'fe000000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username via full-width Unicode compatibility characters'
);

-- C0 control whitespace (TAB, LF, VT, FF, CR) and U+FEFF (BOM/ZERO WIDTH
-- NO-BREAK SPACE) at either edge must be stripped the same way JavaScript's
-- `String.prototype.trim()` strips them, not just U+0020 SPACE. This is the
-- gap plain `btrim(string)` (the one-argument form) leaves open.
SELECT extensions.throws_ok(
  format(
    $$
      INSERT INTO public.organizations (
        id, name, username, type, join_code, created_by
      )
      VALUES (
        'fe100000-0000-4000-8000-000000000010',
        'Reserved Create Tab Attempt',
        %L,
        'school',
        '801010',
        'fe000000-0000-4000-8000-000000000002'
      )
    $$,
    chr(9) || 'create' || chr(9)
  ),
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username via leading/trailing TAB padding'
);

SELECT extensions.throws_ok(
  format(
    $$
      INSERT INTO public.organizations (
        id, name, username, type, join_code, created_by
      )
      VALUES (
        'fe100000-0000-4000-8000-000000000011',
        'Reserved Join LF CR Attempt',
        %L,
        'school',
        '801011',
        'fe000000-0000-4000-8000-000000000002'
      )
    $$,
    chr(10) || 'join' || chr(13)
  ),
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username via leading LF / trailing CR padding'
);

SELECT extensions.throws_ok(
  format(
    $$
      INSERT INTO public.organizations (
        id, name, username, type, join_code, created_by
      )
      VALUES (
        'fe100000-0000-4000-8000-000000000012',
        'Reserved Create VT FF Attempt',
        %L,
        'school',
        '801012',
        'fe000000-0000-4000-8000-000000000002'
      )
    $$,
    chr(11) || chr(12) || 'create' || chr(12) || chr(11)
  ),
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username via leading/trailing VT and FF padding'
);

SELECT extensions.throws_ok(
  format(
    $$
      INSERT INTO public.organizations (
        id, name, username, type, join_code, created_by
      )
      VALUES (
        'fe100000-0000-4000-8000-000000000013',
        'Reserved Create BOM Attempt',
        %L,
        'school',
        '801013',
        'fe000000-0000-4000-8000-000000000002'
      )
    $$,
    chr(65279) || 'CREATE' || chr(65279)
  ),
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username via leading/trailing U+FEFF padding'
);

-- U+1680 OGHAM SPACE MARK and U+2028 LINE SEPARATOR are the sharp end of
-- the extended trim set. `String.prototype.trim()` strips both, and -- unlike
-- U+00A0, U+2000..U+200A, U+202F, U+205F, and U+3000 -- neither is folded to
-- U+0020 by the NFKC pass that runs first, so a constraint whose trim class
-- covered only the C0 controls, U+0020, and U+FEFF really did accept these
-- rows while the application layer refused the same values: a live bypass,
-- not a theoretical one. These are real RLS-gated writes rather than
-- expression evaluation, so they prove the extended set is enforced on the
-- actual insert path.
SELECT extensions.throws_ok(
  format(
    $$
      INSERT INTO public.organizations (
        id, name, username, type, join_code, created_by
      )
      VALUES (
        'fe100000-0000-4000-8000-000000000014',
        'Reserved Create Ogham Space Attempt',
        %L,
        'school',
        '801014',
        'fe000000-0000-4000-8000-000000000002'
      )
    $$,
    chr(5760) || 'create' || chr(5760)
  ),
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username via leading/trailing U+1680 padding'
);

SELECT extensions.throws_ok(
  format(
    $$
      INSERT INTO public.organizations (
        id, name, username, type, join_code, created_by
      )
      VALUES (
        'fe100000-0000-4000-8000-000000000015',
        'Reserved Join Line Separator Attempt',
        %L,
        'school',
        '801015',
        'fe000000-0000-4000-8000-000000000002'
      )
    $$,
    chr(8232) || 'JOIN' || chr(8232)
  ),
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username via leading/trailing U+2028 padding'
);

-- An ordinary ASCII username that merely contains a reserved word remains
-- valid. User 002 has a single organization-creation slot under the real RLS
-- policy, so this one accepted row proves the positive direct-insert path.
SELECT extensions.lives_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000007',
      'Creators Collective',
      'creators-collective',
      'nonprofit',
      '801007',
      'fe000000-0000-4000-8000-000000000002'
    )
  $$,
  'an ordinary ASCII username containing a reserved word remains accepted'
);

RESET ROLE;

-- Direct updates: the same admin-writable path RLS already allows.
SET LOCAL request.jwt.claims =
  '{"sub":"fe000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    UPDATE public.organizations
    SET username = 'create'
    WHERE id = 'fe100000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct update cannot rename an organization to the reserved username "create"'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organizations
    SET username = 'Join'
    WHERE id = 'fe100000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct update cannot rename an organization to the reserved username "join" in mixed case'
);

SELECT extensions.is(
  (
    SELECT username::text
    FROM public.organizations
    WHERE id = 'fe100000-0000-4000-8000-000000000001'
  ),
  'organization-reserved-slug-fixture',
  'the rejected renames leave the organization username unchanged'
);

-- Format enforcement is exercised through the real authenticated UPDATE
-- path, not by re-evaluating a copied regular expression. The astral cases
-- prove PostgreSQL rejects both an emoji and a compatibility character above
-- U+FFFF; the ASCII constraint therefore does not depend on Node/PostgreSQL
-- Unicode normalization parity.
CREATE TEMP TABLE organization_username_invalid_case (
  label text PRIMARY KEY,
  username text NOT NULL
);

INSERT INTO organization_username_invalid_case (label, username) VALUES
  ('a direct update rejects a two-character username', 'ab'),
  ('a direct update rejects a 33-character username', repeat('a', 33)),
  ('a direct update rejects a leading dot', '.abc'),
  ('a direct update rejects a trailing dot', 'abc.'),
  ('a direct update rejects consecutive dots', 'ab..cd'),
  ('a direct update rejects ASCII whitespace', 'with space'),
  ('a direct update rejects a URL path separator', 'slash/name'),
  ('a direct update rejects a control character', 'line' || chr(10) || 'break'),
  ('a direct update rejects an astral emoji', 'abc' || chr(128512)),
  ('a direct update rejects an astral compatibility letter', 'ab' || chr(119808)),
  ('a direct update rejects full-width non-ASCII letters', 'ａｂｃ');

SELECT extensions.throws_ok(
  format(
    'UPDATE public.organizations SET username = %L WHERE id = %L',
    c.username,
    'fe100000-0000-4000-8000-000000000001'
  ),
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_valid_format_check"',
  c.label
)
FROM organization_username_invalid_case c
ORDER BY c.label;

CREATE TEMP TABLE organization_username_valid_case (
  label text PRIMARY KEY,
  username text NOT NULL
);

INSERT INTO organization_username_valid_case (label, username) VALUES
  ('a direct update accepts the three-character lower boundary', 'abc'),
  ('a direct update accepts every documented ASCII punctuation class', 'A_b.c-9'),
  ('a direct update accepts the 32-character upper boundary', repeat('a', 32));

SELECT extensions.lives_ok(
  format(
    'UPDATE public.organizations SET username = %L WHERE id = %L',
    c.username,
    'fe100000-0000-4000-8000-000000000001'
  ),
  c.label
)
FROM organization_username_valid_case c
ORDER BY c.label;

SELECT extensions.lives_ok(
  $$
    UPDATE public.organizations
    SET username = 'organization-reserved-slug-fixture-renamed'
    WHERE id = 'fe100000-0000-4000-8000-000000000001'
  $$,
  'a direct update to a non-reserved username is accepted'
);

SELECT extensions.is(
  (
    SELECT username::text
    FROM public.organizations
    WHERE id = 'fe100000-0000-4000-8000-000000000001'
  ),
  'organization-reserved-slug-fixture-renamed',
  'the accepted rename is persisted'
);

RESET ROLE;

-- The constraint applies uniformly: even a service-role write cannot claim
-- a reserved username, so it is not only an authenticated-client boundary.
SET LOCAL ROLE service_role;

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000008',
      'Service Role Reserved Attempt',
      'join',
      'school',
      '801008',
      'fe000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'even a service-role insert cannot claim a reserved username'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000009',
      'Service Role Ordinary Organization',
      'service-role-ordinary-organization',
      'school',
      '801009',
      'fe000000-0000-4000-8000-000000000001'
    )
  $$,
  'a service-role insert with an ordinary username is unaffected'
);

RESET ROLE;

-- `authenticated` and `anon` no longer hold TRUNCATE, REFERENCES, or TRIGGER
-- on this table. None of RLS, the INSERT cooldown policy, or the admin UPDATE
-- policy constrain any of these -- RLS never fires for TRUNCATE -- so holding
-- them let any authenticated user bypass every RLS policy on this table (e.g.
-- `TRUNCATE public.organizations`, wiping every organization in one statement).
-- The TRUNCATE revoke is defense-in-depth: PostgREST exposes no TRUNCATE verb,
-- so no unmodified client can issue one. The durable root-cause fix is the
-- default ACL cleanup in 20260810220400; this revoke covers the residual grant
-- on this specific existing table.
WITH revoked_role(role_name) AS (
  VALUES ('authenticated'), ('anon')
),
revoked_privilege(privilege_name) AS (
  VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
)
SELECT extensions.ok(
  NOT has_table_privilege(role_name, 'public.organizations', privilege_name),
  format('%s cannot %s public.organizations', role_name, privilege_name)
)
FROM revoked_role CROSS JOIN revoked_privilege;

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    WHERE c.oid = 'public.organizations'::regclass
      AND acl.grantee = 0
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ),
  'PUBLIC has no whole-table maintenance or DDL privilege on public.organizations'
);

-- MAINTAIN (PG 17+): revoked for both authenticated and anon. On PG < 17 the
-- privilege does not exist, so effective absence is trivially true.
SELECT extensions.ok(
  CASE current_setting('server_version_num')::int >= 170000
    WHEN TRUE THEN NOT has_table_privilege('authenticated', 'public.organizations', 'MAINTAIN')
    ELSE TRUE
  END,
  'authenticated cannot MAINTAIN public.organizations'
);

SELECT extensions.ok(
  CASE current_setting('server_version_num')::int >= 170000
    WHEN TRUE THEN NOT has_table_privilege('anon', 'public.organizations', 'MAINTAIN')
    ELSE TRUE
  END,
  'anon cannot MAINTAIN public.organizations'
);

-- The row-level-security-gated privileges this migration does not touch are
-- still held for authenticated, so the "Create org with serialized cooldown"
-- and "Allow admins to update organizations" policies keep working.
WITH retained_privileges(privilege_name) AS (
  VALUES ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT extensions.ok(
  has_table_privilege('authenticated', 'public.organizations', privilege_name),
  format('authenticated retains %s public.organizations', privilege_name)
)
FROM retained_privileges;

-- Prove it end-to-end, not just via the catalog: an authenticated user
-- really cannot truncate this table.
SET LOCAL request.jwt.claims =
  '{"sub":"fe000000-0000-4000-8000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$TRUNCATE public.organizations$$,
  '42501',
  'permission denied for table organizations',
  'an authenticated user cannot truncate public.organizations'
);

RESET ROLE;

-- ───────────────────────────────────────────────────────────────────────
-- Normalization parity matrix
-- ───────────────────────────────────────────────────────────────────────
--
-- The application layer normalizes with
-- `value.normalize("NFKC").trim().toLowerCase()`
-- (`normalizeOrganizationSlugForReservedCheck`). The constraint has to
-- agree on every input, in both directions: a code point the constraint
-- fails to strip but `trim()` does strip is a bypass (the Server Action
-- refuses the padded value while a direct Data API write stores it), and a
-- code point the constraint strips but `trim()` does not is a false
-- rejection of a legitimate username.
--
-- The matrix below is evaluated against the *deployed* constraint
-- expression, read straight out of `pg_constraint` with `pg_get_expr` and
-- executed over a candidate table whose column is also named `username`, so
-- there is no second copy of the predicate to drift. The real RLS-gated
-- INSERT/UPDATE assertions above are what prove that same expression is
-- actually attached to `public.organizations` and fires on the write path;
-- this section is what proves it is *correct* across the whole character
-- set, without needing one insert per case. A CHECK constraint rejects a
-- row only when its expression evaluates to FALSE (NULL passes), and this
-- expression is never NULL for a non-null username, so evaluating it
-- directly is the same verdict the write path produces.

CREATE TEMP TABLE ecma_trim_codepoint (code int PRIMARY KEY, code_label text NOT NULL);

-- ECMAScript `String.prototype.trim()` strips the union of WhiteSpace and
-- LineTerminator, which is exactly these 25 code points and no others.
INSERT INTO ecma_trim_codepoint (code, code_label) VALUES
  (9, 'U+0009 CHARACTER TABULATION'),
  (10, 'U+000A LINE FEED'),
  (11, 'U+000B LINE TABULATION'),
  (12, 'U+000C FORM FEED'),
  (13, 'U+000D CARRIAGE RETURN'),
  (32, 'U+0020 SPACE'),
  (160, 'U+00A0 NO-BREAK SPACE'),
  (5760, 'U+1680 OGHAM SPACE MARK'),
  (8192, 'U+2000 EN QUAD'),
  (8193, 'U+2001 EM QUAD'),
  (8194, 'U+2002 EN SPACE'),
  (8195, 'U+2003 EM SPACE'),
  (8196, 'U+2004 THREE-PER-EM SPACE'),
  (8197, 'U+2005 FOUR-PER-EM SPACE'),
  (8198, 'U+2006 SIX-PER-EM SPACE'),
  (8199, 'U+2007 FIGURE SPACE'),
  (8200, 'U+2008 PUNCTUATION SPACE'),
  (8201, 'U+2009 THIN SPACE'),
  (8202, 'U+200A HAIR SPACE'),
  (8232, 'U+2028 LINE SEPARATOR'),
  (8233, 'U+2029 PARAGRAPH SEPARATOR'),
  (8239, 'U+202F NARROW NO-BREAK SPACE'),
  (8287, 'U+205F MEDIUM MATHEMATICAL SPACE'),
  (12288, 'U+3000 IDEOGRAPHIC SPACE'),
  (65279, 'U+FEFF ZERO WIDTH NO-BREAK SPACE');

CREATE TEMP TABLE non_trim_codepoint (code int PRIMARY KEY, code_label text NOT NULL);

-- Near misses: format-control and zero-width code points that look like
-- padding but are not WhiteSpace or LineTerminator, so `trim()` keeps them
-- and the constraint must keep them too. Padding a reserved word with one
-- of these produces a username that is genuinely not the reserved slug.
INSERT INTO non_trim_codepoint (code, code_label) VALUES
  (173, 'U+00AD SOFT HYPHEN'),
  (6158, 'U+180E MONGOLIAN VOWEL SEPARATOR'),
  (8203, 'U+200B ZERO WIDTH SPACE'),
  (8206, 'U+200E LEFT-TO-RIGHT MARK'),
  (8288, 'U+2060 WORD JOINER');

CREATE TEMP TABLE reserved_slug_case (
  label text PRIMARY KEY,
  username text NOT NULL,
  expected_allowed boolean NOT NULL
);

CREATE TEMP TABLE reserved_slug_word (word text PRIMARY KEY);
INSERT INTO reserved_slug_word (word) VALUES ('create'), ('join');

CREATE TEMP TABLE reserved_slug_placement (placement text PRIMARY KEY);
INSERT INTO reserved_slug_placement (placement) VALUES
  ('leading'), ('trailing'), ('both');

-- Group A: every trimmed code point, in every edge placement, around every
-- reserved slug. 25 x 3 x 2 = 150 cases, all rejected.
INSERT INTO reserved_slug_case (label, username, expected_allowed)
SELECT
  format('A %s %s padding around "%s" is rejected', p.placement, c.code_label, w.word),
  CASE p.placement
    WHEN 'leading' THEN chr(c.code) || w.word
    WHEN 'trailing' THEN w.word || chr(c.code)
    ELSE chr(c.code) || w.word || chr(c.code)
  END,
  false
FROM ecma_trim_codepoint c
CROSS JOIN reserved_slug_word w
CROSS JOIN reserved_slug_placement p;

-- Group B: case folding and NFKC compatibility spellings, padded with plain
-- spaces so trim, NFKC, and lower all have to agree at once.
INSERT INTO reserved_slug_case (label, username, expected_allowed) VALUES
  ('B an all-uppercase spelling is rejected', ' CREATE ', false),
  ('B a title-case spelling is rejected', ' Join ', false),
  ('B a mixed-case spelling is rejected', ' cReAtE ', false),
  (
    'B a full-width compatibility spelling of "create" is rejected',
    ' ' || chr(65347) || chr(65362) || chr(65349) || chr(65345) || chr(65364)
        || chr(65349) || ' ',
    false
  ),
  (
    'B a full-width compatibility spelling of "join" is rejected',
    ' ' || chr(65354) || chr(65359) || chr(65353) || chr(65358) || ' ',
    false
  ),
  (
    'B a mixed full-width and ASCII spelling is rejected',
    ' ' || chr(65315) || 'reate ',
    false
  ),
  (
    'B an ideographic-space-padded full-width spelling is rejected',
    chr(12288) || chr(65354) || chr(65359) || chr(65353) || chr(65358)
      || chr(12288),
    false
  ),
  (
    'B a no-break-space-padded uppercase spelling is rejected',
    chr(160) || 'JOIN' || chr(160),
    false
  );

-- Group C: the same code points in the interior of a username are not
-- stripped, exactly as `trim()` leaves them, so the value never collapses
-- to a bare reserved word. 25 cases, all accepted.
INSERT INTO reserved_slug_case (label, username, expected_allowed)
SELECT
  format('C %s inside a username is not stripped', c.code_label),
  'cre' || chr(c.code) || 'ate',
  true
FROM ecma_trim_codepoint c;

-- Group D: near-miss padding is kept, so the padded value is not the
-- reserved slug. 5 x 3 x 2 = 30 cases, all accepted.
INSERT INTO reserved_slug_case (label, username, expected_allowed)
SELECT
  format('D %s %s padding around "%s" is accepted', p.placement, c.code_label, w.word),
  CASE p.placement
    WHEN 'leading' THEN chr(c.code) || w.word
    WHEN 'trailing' THEN w.word || chr(c.code)
    ELSE chr(c.code) || w.word || chr(c.code)
  END,
  true
FROM non_trim_codepoint c
CROSS JOIN reserved_slug_word w
CROSS JOIN reserved_slug_placement p;

-- Group E: one trimmed edge and one near-miss edge. The trimmed side goes
-- away, the near-miss side survives, so the result is still not the
-- reserved slug -- this is the case an over-eager trim would get wrong.
-- 25 x 2 = 50 cases, all accepted.
INSERT INTO reserved_slug_case (label, username, expected_allowed)
SELECT
  format('E %s leading with a surviving U+200B trailing "%s" is accepted', c.code_label, w.word),
  chr(c.code) || w.word || chr(8203),
  true
FROM ecma_trim_codepoint c
CROSS JOIN reserved_slug_word w;

-- Group F: ordinary usernames, including ones that merely contain a
-- reserved word, are untouched.
INSERT INTO reserved_slug_case (label, username, expected_allowed) VALUES
  ('F "lets-assist" is accepted', 'lets-assist', true),
  ('F "creators" is accepted', 'creators', true),
  ('F "createorg" is accepted', 'createorg', true),
  ('F "the-creators-collective" is accepted', 'the-creators-collective', true),
  ('F "rejoin" is accepted', 'rejoin', true),
  ('F "joint-venture" is accepted', 'joint-venture', true),
  ('F "enjoin" is accepted', 'enjoin', true),
  ('F "my_org.2026" is accepted', 'my_org.2026', true);

-- The full-width spellings above are only meaningful as bypass attempts if
-- they really are the reserved words once NFKC-normalized. A mistyped code
-- point would otherwise turn a rejection test into a test of nothing, so the
-- fixtures check themselves first.
SELECT extensions.is(
  lower(normalize(
    chr(65347) || chr(65362) || chr(65349) || chr(65345) || chr(65364)
      || chr(65349),
    nfkc
  )),
  'create',
  'the full-width "create" fixture NFKC-normalizes to the reserved word'
);

SELECT extensions.is(
  lower(normalize(
    chr(65354) || chr(65359) || chr(65353) || chr(65358),
    nfkc
  )),
  'join',
  'the full-width "join" fixture NFKC-normalizes to the reserved word'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM reserved_slug_case),
  271,
  'the normalization parity matrix has every case it is planned for'
);

CREATE TEMP TABLE reserved_slug_verdict (
  label text PRIMARY KEY,
  expected_allowed boolean NOT NULL,
  actual_allowed boolean
);

-- The predicate is the deployed one, not a transcription of it.
DO $matrix$
DECLARE
  deployed_predicate text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid)
    INTO STRICT deployed_predicate
    FROM pg_constraint
   WHERE conrelid = 'public.organizations'::regclass
     AND conname = 'organizations_username_not_reserved_check';

  EXECUTE format(
    'INSERT INTO reserved_slug_verdict (label, expected_allowed, actual_allowed)
       SELECT label, expected_allowed, (%s) FROM reserved_slug_case',
    deployed_predicate
  );
END
$matrix$;

SELECT extensions.is(
  v.actual_allowed,
  v.expected_allowed,
  v.label
)
FROM reserved_slug_verdict v
ORDER BY v.label;

-- Both directions at once, over the whole Basic Multilingual Plane: the set
-- of padding code points that make the deployed constraint reject
-- `<cp>create<cp>` must be exactly the 25 ECMAScript trim code points --
-- no more (no legitimate username is falsely rejected) and no fewer (no
-- padded reserved slug slips past). `lib/organization/reserved-slugs.test.ts`
-- runs the identical scan against `String.prototype.trim()` and anchors it
-- to the same 25 code points, which is what makes this a parity proof
-- rather than two independently drifting lists.
CREATE TEMP TABLE bmp_scan_verdict (code int PRIMARY KEY, rejected boolean);

DO $scan$
DECLARE
  deployed_predicate text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid)
    INTO STRICT deployed_predicate
    FROM pg_constraint
   WHERE conrelid = 'public.organizations'::regclass
     AND conname = 'organizations_username_not_reserved_check';

  EXECUTE format(
    'INSERT INTO bmp_scan_verdict (code, rejected)
       SELECT code, NOT (%s)
         FROM (
           SELECT code, chr(code) || ''create'' || chr(code) AS username
             FROM generate_series(1, 65535) AS g(code)
            WHERE code NOT BETWEEN 55296 AND 57343
         ) AS candidates',
    deployed_predicate
  );
END
$scan$;

SELECT extensions.is(
  (
    SELECT coalesce(string_agg(to_hex(code), ' ' ORDER BY code), '')
    FROM bmp_scan_verdict
    WHERE rejected
  ),
  (
    SELECT string_agg(to_hex(code), ' ' ORDER BY code)
    FROM ecma_trim_codepoint
  ),
  'across the whole BMP the constraint strips exactly the 25 ECMAScript trim code points'
);

SELECT * FROM extensions.finish();

ROLLBACK;
