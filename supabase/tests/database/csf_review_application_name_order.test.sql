-- Application review roster name order: last names the locale calls equal.
--
-- The Applications list has always ordered names with a locale comparison.
-- That comparison ignores some characters name normalization keeps, so two
-- stored last names can differ in bytes and still be the same name to the
-- list. When they are, the first name and then the application id decide.
-- These assertions prove the list, both cursor directions, the roster index,
-- the review queue and the split snapshot all make that same decision, and
-- that search still matches literal text.
--
-- The paging, filter, Sheet and queue-bound cases, and the collation's own
-- catalog metadata, are proven in csf_review_application_roster_paging.test.sql.
--
-- The fixture's zero-width space (U+200B) is written into this file as the
-- character itself, inside the quoted strings that sit between `mi` and `ll`.
-- An editor that strips invisible characters would turn every case below into
-- a comparison of identical names.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(15);

-- ---------------------------------------------------------------------------
-- A. Fixtures
--
-- One organization, one semester, one class and five applications. The
-- application ids follow the profile numbers, so 22 sorts before 23 by id.
--
--   #   last name     first name
--   21  miller        zed
--   22  mi<ZWSP>ller  amy
--   23  miller        amy
--   24  mill          zoe
--   25  millerd       abe
-- ---------------------------------------------------------------------------

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('5e910000-0000-4000-8000-000000000001', 'CSF Roster Name Order', 'csf-roster-name-order', 'school', '750413');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  is_current, lifecycle_status, accepts_new_applications
)
VALUES
  ('5e920000-0000-4000-8000-000000000005', '5e910000-0000-4000-8000-000000000001',
   'F30', 'Fall 2030', '2030-2031', 'fall', false, 'open', true);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES
  ('5e950000-0000-4000-8000-000000000001', '5e910000-0000-4000-8000-000000000001',
   2032, 'c/o 2032', 'active');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  -- A last name stored with a zero-width space, which name normalization
  -- keeps and the locale comparison ignores. Rows 22 and 23 then also share a
  -- first name, so only the application id separates them.
  ('5e930000-0000-4000-8000-000000000021', '5e910000-0000-4000-8000-000000000001',
   'Zed', 'Miller', 'zed', 'miller'),
  ('5e930000-0000-4000-8000-000000000022', '5e910000-0000-4000-8000-000000000001',
   'Amy', E'Mi​ller', 'amy', E'mi​ller'),
  ('5e930000-0000-4000-8000-000000000023', '5e910000-0000-4000-8000-000000000001',
   'Amy', 'Miller', 'amy', 'miller'),
  ('5e930000-0000-4000-8000-000000000024', '5e910000-0000-4000-8000-000000000001',
   'Zoe', 'Mill', 'zoe', 'mill'),
  ('5e930000-0000-4000-8000-000000000025', '5e910000-0000-4000-8000-000000000001',
   'Abe', 'Millerd', 'abe', 'millerd');

-- The zero-width-space semester, one application per profile. The application
-- ids follow the profile numbers, so 22 sorts before 23 by id.
INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status
)
SELECT
  ('5e9400' || pg_catalog.right(profile.id::text, 2) || '-0000-4000-8000-0000000000aa')::uuid,
  profile.organization_id,
  profile.id,
  '5e950000-0000-4000-8000-000000000001',
  '5e920000-0000-4000-8000-000000000005',
  'legacy_import',
  'submitted'
FROM plugin_data.csf_profiles AS profile
WHERE profile.id::text LIKE '5e930000-0000-4000-8000-00000000002_';

-- One page of the semester, with every list argument defaulted, so each
-- assertion names only what it varies. The cursor is a boundary row's own
-- sort values.
CREATE FUNCTION pg_temp.listed(
  p_term_id uuid DEFAULT '5e920000-0000-4000-8000-000000000005',
  p_cohort_id uuid DEFAULT NULL,
  p_pending_only boolean DEFAULT false,
  p_query text DEFAULT '',
  p_sheet_review boolean DEFAULT false,
  p_sheet_filter text DEFAULT 'all',
  p_cursor_rank integer DEFAULT NULL,
  p_cursor_last text DEFAULT NULL,
  p_cursor_first text DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_direction text DEFAULT NULL,
  p_limit integer DEFAULT NULL
)
RETURNS TABLE (
  last_name text, roster_index integer, application_id uuid,
  matched_count bigint, match_position bigint
)
LANGUAGE sql
AS $$
  SELECT page.last_name, page.roster_index, page.application_id,
         page.matched_count, page.match_position
  FROM plugin_data.csf_review_application_roster_page(
    '5e910000-0000-4000-8000-000000000001',
    p_term_id, p_cohort_id, p_pending_only, p_query, p_sheet_review,
    p_sheet_filter, p_cursor_rank, p_cursor_last, p_cursor_first, p_cursor_id,
    p_direction, p_limit
  ) AS page;
$$;

-- The queue document for the semester.
CREATE FUNCTION pg_temp.queue(
  p_term_id uuid DEFAULT '5e920000-0000-4000-8000-000000000005',
  p_cohort_id uuid DEFAULT NULL,
  p_pending_only boolean DEFAULT false,
  p_query text DEFAULT '',
  p_sheet_review boolean DEFAULT false,
  p_keep_application_id uuid DEFAULT NULL,
  p_splittable_only boolean DEFAULT false,
  p_max_subjects integer DEFAULT NULL,
  p_organization_id uuid DEFAULT '5e910000-0000-4000-8000-000000000001'
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT plugin_data.csf_review_application_roster_queue(
    p_organization_id, p_term_id, p_cohort_id, p_pending_only, p_query,
    p_sheet_review, 'all', p_keep_application_id, p_splittable_only,
    p_max_subjects
  );
$$;

CREATE FUNCTION pg_temp.queue_indexes(p_queue jsonb)
RETURNS integer[]
LANGUAGE sql
AS $$
  SELECT coalesce(
    pg_catalog.array_agg((subject.value ->> 'index')::integer ORDER BY subject.ordinality),
    ARRAY[]::integer[]
  )
  FROM pg_catalog.jsonb_array_elements(p_queue -> 'subjects')
    WITH ORDINALITY AS subject(value, ordinality);
$$;

-- ---------------------------------------------------------------------------
-- B. Last names the locale comparison calls equal
--
-- `miller` and `mi<U+200B>ller` are equal to the comparison the list has
-- always made, so the first name and then the application id decide. A
-- deterministic collation would break that tie by the invisible byte first
-- and list 24, 23, 21, 22, 25. The list, both cursor directions, the roster
-- index, the queue and the split must all give 24, 22, 23, 21, 25:
--
--   24  mill          zoe   before every miller
--   22  mi<ZWSP>ller  amy   equal last name; first name amy; lower id
--   23  miller        amy   equal last name; first name amy; higher id
--   21  miller        zed   equal last name; first name zed
--   25  millerd       abe   after every miller
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  ('miller' = E'mi​ller' COLLATE plugin_data.csf_review_name_order),
  'the name order treats a last name with a zero-width space as the same last name'
);
SELECT extensions.ok(
  ('miller' <> E'mi​ller' COLLATE pg_catalog."C")
  AND ('miller' < 'millerd' COLLATE plugin_data.csf_review_name_order)
  AND ('mill' < 'miller' COLLATE plugin_data.csf_review_name_order)
  AND ('miller' <> 'millar' COLLATE plugin_data.csf_review_name_order),
  'the two spellings are different bytes, and genuinely different names still differ'
);
SELECT extensions.is(
  ARRAY(SELECT pg_catalog.left(application_id::text, 8) FROM pg_temp.listed(p_term_id => '5e920000-0000-4000-8000-000000000005') ORDER BY match_position),
  ARRAY['5e940024', '5e940022', '5e940023', '5e940021', '5e940025'],
  'equal last names are ordered by first name, then by application id'
);
SELECT extensions.is(
  ARRAY(SELECT roster_index FROM pg_temp.listed(p_term_id => '5e920000-0000-4000-8000-000000000005') ORDER BY pg_catalog.left(application_id::text, 8)),
  ARRAY[4, 2, 3, 1, 5],
  'the roster index numbers them in that same order'
);

-- ---------------------------------------------------------------------------
-- C. Cursors across the tie, in both directions
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  ARRAY(SELECT pg_catalog.left(application_id::text, 8) FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000005',
    p_cursor_rank => 0, p_cursor_last => E'mi​ller', p_cursor_first => 'amy',
    p_cursor_id => '5e940022-0000-4000-8000-0000000000aa',
    p_direction => 'after', p_limit => 2
  ) ORDER BY match_position),
  ARRAY['5e940023', '5e940021'],
  'a forward cursor on the zero-width row continues with the id tie, then the first name'
);
SELECT extensions.is(
  ARRAY(SELECT pg_catalog.left(application_id::text, 8) FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000005',
    p_cursor_rank => 0, p_cursor_last => 'miller', p_cursor_first => 'amy',
    p_cursor_id => '5e940022-0000-4000-8000-0000000000aa',
    p_direction => 'after', p_limit => 2
  ) ORDER BY match_position),
  ARRAY['5e940023', '5e940021'],
  'the same boundary spelled without the zero-width space is the same boundary'
);
SELECT extensions.is(
  ARRAY(SELECT pg_catalog.left(application_id::text, 8) FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000005',
    p_cursor_rank => 0, p_cursor_last => 'miller', p_cursor_first => 'zed',
    p_cursor_id => '5e940021-0000-4000-8000-0000000000aa',
    p_direction => 'before', p_limit => 2
  ) ORDER BY match_position),
  ARRAY['5e940022', '5e940023'],
  'a backward cursor reads the two tied rows in id order'
);
SELECT extensions.is(
  ARRAY(SELECT pg_catalog.left(application_id::text, 8) FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000005',
    p_cursor_rank => 0, p_cursor_last => 'miller', p_cursor_first => 'amy',
    p_cursor_id => '5e940023-0000-4000-8000-0000000000aa',
    p_direction => 'before', p_limit => 5
  ) ORDER BY match_position),
  ARRAY['5e940024', '5e940022'],
  'a backward cursor on the higher id stops at the lower id, not at the byte order'
);
SELECT extensions.is(
  (
    SELECT pg_catalog.array_agg(DISTINCT walked.id ORDER BY walked.id)
    FROM (
      SELECT pg_catalog.left(application_id::text, 8) AS id FROM pg_temp.listed(
        p_term_id => '5e920000-0000-4000-8000-000000000005', p_limit => 2
      )
      UNION ALL
      SELECT pg_catalog.left(application_id::text, 8) FROM pg_temp.listed(
        p_term_id => '5e920000-0000-4000-8000-000000000005',
        p_cursor_rank => 0, p_cursor_last => E'mi​ller', p_cursor_first => 'amy',
        p_cursor_id => '5e940022-0000-4000-8000-0000000000aa',
        p_direction => 'after', p_limit => 2
      )
      UNION ALL
      SELECT pg_catalog.left(application_id::text, 8) FROM pg_temp.listed(
        p_term_id => '5e920000-0000-4000-8000-000000000005',
        p_cursor_rank => 0, p_cursor_last => 'miller', p_cursor_first => 'zed',
        p_cursor_id => '5e940021-0000-4000-8000-0000000000aa',
        p_direction => 'after', p_limit => 2
      )
    ) AS walked
  ),
  ARRAY['5e940021', '5e940022', '5e940023', '5e940024', '5e940025'],
  'paging through the tied names two at a time reaches every row'
);
SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM (
      SELECT application_id FROM pg_temp.listed(
        p_term_id => '5e920000-0000-4000-8000-000000000005', p_limit => 2
      )
      UNION ALL
      SELECT application_id FROM pg_temp.listed(
        p_term_id => '5e920000-0000-4000-8000-000000000005',
        p_cursor_rank => 0, p_cursor_last => E'mi​ller', p_cursor_first => 'amy',
        p_cursor_id => '5e940022-0000-4000-8000-0000000000aa',
        p_direction => 'after', p_limit => 2
      )
      UNION ALL
      SELECT application_id FROM pg_temp.listed(
        p_term_id => '5e920000-0000-4000-8000-000000000005',
        p_cursor_rank => 0, p_cursor_last => 'miller', p_cursor_first => 'zed',
        p_cursor_id => '5e940021-0000-4000-8000-0000000000aa',
        p_direction => 'after', p_limit => 2
      )
    ) AS walked
  ),
  5,
  'and reaches none of them twice'
);

-- ---------------------------------------------------------------------------
-- D. The review queue and the split snapshot
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  ARRAY(
    SELECT pg_catalog.left(subject.value ->> 'id', 8)
    FROM pg_catalog.jsonb_array_elements(
      pg_temp.queue(p_term_id => '5e920000-0000-4000-8000-000000000005') -> 'subjects'
    ) WITH ORDINALITY AS subject(value, ordinality)
    ORDER BY subject.ordinality
  ),
  ARRAY['5e940024', '5e940022', '5e940023', '5e940021', '5e940025'],
  'the review queue walks the tied names in the list''s order'
);
SELECT extensions.is(
  ARRAY(
    SELECT pg_catalog.left(subject.value ->> 'id', 8)
    FROM pg_catalog.jsonb_array_elements(
      pg_temp.queue(
        p_term_id => '5e920000-0000-4000-8000-000000000005',
        p_splittable_only => true
      ) -> 'subjects'
    ) WITH ORDINALITY AS subject(value, ordinality)
    ORDER BY subject.ordinality
  ),
  ARRAY['5e940024', '5e940022', '5e940023', '5e940021', '5e940025'],
  'the split snapshot shares them out in the list''s order'
);
SELECT extensions.is(
  pg_temp.queue_indexes(pg_temp.queue(p_term_id => '5e920000-0000-4000-8000-000000000005')),
  ARRAY[1, 2, 3, 4, 5],
  'the queue''s roster numbers agree with the list''s'
);

-- ---------------------------------------------------------------------------
-- E. Search stays literal
--
-- Search is matching, not ordering. It stays a literal substring test under
-- the names' ordinary collation: the stored zero-width space is a character,
-- so `miller` does not find the row that contains one.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  ARRAY(SELECT pg_catalog.left(application_id::text, 8) FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000005', p_query => 'miller'
  ) ORDER BY match_position),
  ARRAY['5e940023', '5e940021', '5e940025'],
  'search matches literally and does not use the name order to decide what matches'
);
SELECT extensions.is(
  ARRAY(SELECT pg_catalog.left(application_id::text, 8) FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000005', p_query => E'mi​ll'
  )),
  ARRAY['5e940022'],
  'a search that contains the zero-width space finds exactly the row that has it'
);

SELECT * FROM extensions.finish();

ROLLBACK;
