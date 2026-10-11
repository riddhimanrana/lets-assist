-- Application review roster paging.
--
-- The Applications workspace lists one bounded page and freezes a queue of ids
-- on review entry. These assertions prove the three service functions keep an
-- officer inside one organization, semester and class, return bounded pages
-- whose cursors survive rows changing before the boundary, treat the search as
-- literal text, report scope counts and reviewer totals that no search can
-- move, order names the way the list always has, order and filter a Sheet
-- semester the way the list always has, number rows by a roster index that
-- filters never renumber, and hand over a queue that is complete or refused,
-- never cut short.
--
-- Last names the name order calls equal, and the first-name and id ties that
-- follow, are proven in csf_review_application_name_order.test.sql.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(89);

-- ---------------------------------------------------------------------------
-- A. Execution grants and function hardening
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_function_privilege('anon',
    'plugin_data.csf_review_application_roster_scope(uuid,uuid,uuid)', 'EXECUTE'),
  'anonymous clients cannot read roster scope counts'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'plugin_data.csf_review_application_roster_scope(uuid,uuid,uuid)', 'EXECUTE'),
  'authenticated clients cannot read roster scope counts'
);
SELECT extensions.ok(
  has_function_privilege('service_role',
    'plugin_data.csf_review_application_roster_scope(uuid,uuid,uuid)', 'EXECUTE'),
  'the server role can read roster scope counts'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon',
    'plugin_data.csf_review_application_roster_page(uuid,uuid,uuid,boolean,text,boolean,text,integer,text,text,uuid,text,integer)',
    'EXECUTE'),
  'anonymous clients cannot read a roster page'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'plugin_data.csf_review_application_roster_page(uuid,uuid,uuid,boolean,text,boolean,text,integer,text,text,uuid,text,integer)',
    'EXECUTE'),
  'authenticated clients cannot read a roster page'
);
SELECT extensions.ok(
  has_function_privilege('service_role',
    'plugin_data.csf_review_application_roster_page(uuid,uuid,uuid,boolean,text,boolean,text,integer,text,text,uuid,text,integer)',
    'EXECUTE'),
  'the server role can read a roster page'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon',
    'plugin_data.csf_review_application_roster_queue(uuid,uuid,uuid,boolean,text,boolean,text,uuid,boolean,integer)',
    'EXECUTE'),
  'anonymous clients cannot read the review queue'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'plugin_data.csf_review_application_roster_queue(uuid,uuid,uuid,boolean,text,boolean,text,uuid,boolean,integer)',
    'EXECUTE'),
  'authenticated clients cannot read the review queue'
);
SELECT extensions.ok(
  has_function_privilege('service_role',
    'plugin_data.csf_review_application_roster_queue(uuid,uuid,uuid,boolean,text,boolean,text,uuid,boolean,integer)',
    'EXECUTE'),
  'the server role can read the review queue'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'plugin_data.csf_review_application_roster_rows(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role',
    'plugin_data.csf_review_application_roster_rows(uuid,uuid,uuid)', 'EXECUTE'),
  'the scope helper is internal to the three readers'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'plugin_data.csf_review_application_roster_matches(uuid,uuid,uuid,boolean,text,boolean,text,uuid)',
    'EXECUTE')
  AND NOT has_function_privilege('service_role',
    'plugin_data.csf_review_application_roster_matches(uuid,uuid,uuid,boolean,text,boolean,text,uuid)',
    'EXECUTE'),
  'the filter helper is internal to the three readers'
);
SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'plugin_data'
      AND routine.proname LIKE 'csf\_review\_application\_roster\_%'
      AND routine.prosecdef
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(routine.proconfig) AS setting(value)
        WHERE setting.value = 'search_path=""'
      )
  ),
  5,
  'all five roster functions pin an empty search path'
);
SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'plugin_data'
      AND routine.proname LIKE 'csf\_review\_application\_roster\_%'
  ),
  5,
  'no earlier overload of a roster function is left behind'
);
-- A row set read through the Data API is cut at its row limit without an
-- error. The queue is one scalar document so that limit cannot apply to it.
SELECT extensions.ok(
  (
    SELECT routine.prorettype = 'jsonb'::regtype AND NOT routine.proretset
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'plugin_data'
      AND routine.proname = 'csf_review_application_roster_queue'
  ),
  'the queue is one jsonb document, not a row set a row limit could truncate'
);
-- The name order is one collation, declared by the migration. The locale
-- column was renamed between server versions, so it is read by either name.
SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM pg_catalog.pg_collation AS collation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = collation.collnamespace
    WHERE namespace.nspname = 'plugin_data'
      AND collation.collname = 'csf_review_name_order'
      AND collation.collprovider = 'i'
  ),
  1,
  'the name order is one ICU collation in the plugin_data schema'
);
SELECT extensions.is(
  (
    SELECT coalesce(
      pg_catalog.to_jsonb(collation) ->> 'colllocale',
      pg_catalog.to_jsonb(collation) ->> 'colliculocale'
    )
    FROM pg_catalog.pg_collation AS collation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = collation.collnamespace
    WHERE namespace.nspname = 'plugin_data'
      AND collation.collname = 'csf_review_name_order'
  ),
  'und',
  'the name order uses the ICU root locale'
);
SELECT extensions.is(
  (
    SELECT collation.collisdeterministic
    FROM pg_catalog.pg_collation AS collation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = collation.collnamespace
    WHERE namespace.nspname = 'plugin_data'
      AND collation.collname = 'csf_review_name_order'
  ),
  false,
  'the name order is nondeterministic, so names the locale calls equal are equal'
);
SELECT extensions.ok(
  (
    SELECT collation.collowner = (
      SELECT routine.proowner
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS routine_namespace
        ON routine_namespace.oid = routine.pronamespace
      WHERE routine_namespace.nspname = 'plugin_data'
        AND routine.proname = 'csf_review_application_roster_page'
    )
    FROM pg_catalog.pg_collation AS collation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = collation.collnamespace
    WHERE namespace.nspname = 'plugin_data'
      AND collation.collname = 'csf_review_name_order'
  ),
  'the name order is owned by the same migration role as the functions that use it'
);

-- ---------------------------------------------------------------------------
-- B. Fixtures
--
-- One reviewed organization with seven applications in the current semester
-- across two classes, one application in a second semester, 1,005 in a third
-- for the page and queue bounds, and six in a fourth whose surnames differ
-- only by punctuation and accents. A second organization holds one
-- application whose applicant shares a surname with the first, so a leak would
-- be visible.
--
--   #  surname   class  decision   reviewer  staged Sheet decision
--   1  Aguirre   2032   pending    -         none
--   2  Bhola     2031   pending    -         accepted
--   3  Chen      2032   approved   -         rejected, officer_approved
--   4  Desai     2032   pending    reviewer  on_hold, awaiting_review
--   5  Evans     2031   pending    -         conflict
--   6  F%_ox     2032   pending    -         rejected_with_explanation, no reason
--   7  Garcia    2031   rejected   reviewer  rejected
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('5e900000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'csf-roster-officer@local.test', now(), '{}', '{}', now(), now()),
  ('5e900000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'csf-roster-reviewer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('5e910000-0000-4000-8000-000000000001', 'CSF Roster Paging', 'csf-roster-paging', 'school', '750411'),
  ('5e910000-0000-4000-8000-000000000002', 'CSF Roster Other', 'csf-roster-other', 'school', '750412');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('5e910000-0000-4000-8000-000000000001', '5e900000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('5e910000-0000-4000-8000-000000000001', '5e900000-0000-4000-8000-000000000002', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  is_current, lifecycle_status, accepts_new_applications
)
VALUES
  ('5e920000-0000-4000-8000-000000000001', '5e910000-0000-4000-8000-000000000001',
   'F28', 'Fall 2028', '2028-2029', 'fall', true, 'open', true),
  ('5e920000-0000-4000-8000-000000000002', '5e910000-0000-4000-8000-000000000001',
   'S29', 'Spring 2029', '2028-2029', 'spring', false, 'open', true),
  ('5e920000-0000-4000-8000-000000000003', '5e910000-0000-4000-8000-000000000001',
   'F29', 'Fall 2029', '2029-2030', 'fall', false, 'open', true),
  ('5e920000-0000-4000-8000-000000000004', '5e910000-0000-4000-8000-000000000001',
   'S30', 'Spring 2030', '2029-2030', 'spring', false, 'open', true),
  ('5e920000-0000-4000-8000-000000000009', '5e910000-0000-4000-8000-000000000002',
   'S29', 'Spring 2029', '2028-2029', 'spring', false, 'open', true);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES
  ('5e950000-0000-4000-8000-000000000001', '5e910000-0000-4000-8000-000000000001',
   2032, 'c/o 2032', 'active'),
  ('5e950000-0000-4000-8000-000000000002', '5e910000-0000-4000-8000-000000000001',
   2031, 'c/o 2031', 'active'),
  ('5e950000-0000-4000-8000-000000000009', '5e910000-0000-4000-8000-000000000002',
   2032, 'c/o 2032', 'active');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('5e930000-0000-4000-8000-000000000001', '5e910000-0000-4000-8000-000000000001',
   'Ada', 'Aguirre', 'ada', 'aguirre'),
  ('5e930000-0000-4000-8000-000000000002', '5e910000-0000-4000-8000-000000000001',
   'Bo', 'Bhola', 'bo', 'bhola'),
  ('5e930000-0000-4000-8000-000000000003', '5e910000-0000-4000-8000-000000000001',
   'Cy', 'Chen', 'cy', 'chen'),
  ('5e930000-0000-4000-8000-000000000004', '5e910000-0000-4000-8000-000000000001',
   'Di', 'Desai', 'di', 'desai'),
  ('5e930000-0000-4000-8000-000000000005', '5e910000-0000-4000-8000-000000000001',
   'Eli', 'Evans', 'eli', 'evans'),
  ('5e930000-0000-4000-8000-000000000006', '5e910000-0000-4000-8000-000000000001',
   'Flo', 'F%_ox', 'flo', 'f%_ox'),
  ('5e930000-0000-4000-8000-000000000007', '5e910000-0000-4000-8000-000000000001',
   'Gia', 'Garcia', 'gia', 'garcia'),
  ('5e930000-0000-4000-8000-000000000009', '5e910000-0000-4000-8000-000000000002',
   'Ada', 'Aguirre', 'ada', 'aguirre'),
  -- Surnames that differ only by punctuation and accents.
  ('5e930000-0000-4000-8000-000000000011', '5e910000-0000-4000-8000-000000000001',
   'Pat', 'OBrien', 'pat', 'obrien'),
  ('5e930000-0000-4000-8000-000000000012', '5e910000-0000-4000-8000-000000000001',
   'Pat', 'O''Brien', 'pat', 'o''brien'),
  ('5e930000-0000-4000-8000-000000000013', '5e910000-0000-4000-8000-000000000001',
   'Pat', 'O-Brien', 'pat', 'o-brien'),
  ('5e930000-0000-4000-8000-000000000014', '5e910000-0000-4000-8000-000000000001',
   'Pat', 'Nut', 'pat', 'nut'),
  ('5e930000-0000-4000-8000-000000000015', '5e910000-0000-4000-8000-000000000001',
   'Pat', 'Núñez', 'pat', 'núñez'),
  ('5e930000-0000-4000-8000-000000000016', '5e910000-0000-4000-8000-000000000001',
   'Pat', 'Nunez', 'pat', 'nunez');

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status
) VALUES
  ('5e940000-0000-4000-8000-000000000001', '5e910000-0000-4000-8000-000000000001',
   '5e930000-0000-4000-8000-000000000001', '5e950000-0000-4000-8000-000000000001',
   '5e920000-0000-4000-8000-000000000001', 'native', 'submitted'),
  ('5e940000-0000-4000-8000-000000000002', '5e910000-0000-4000-8000-000000000001',
   '5e930000-0000-4000-8000-000000000002', '5e950000-0000-4000-8000-000000000002',
   '5e920000-0000-4000-8000-000000000001', 'native', 'submitted'),
  ('5e940000-0000-4000-8000-000000000003', '5e910000-0000-4000-8000-000000000001',
   '5e930000-0000-4000-8000-000000000003', '5e950000-0000-4000-8000-000000000001',
   '5e920000-0000-4000-8000-000000000001', 'native', 'submitted'),
  ('5e940000-0000-4000-8000-000000000004', '5e910000-0000-4000-8000-000000000001',
   '5e930000-0000-4000-8000-000000000004', '5e950000-0000-4000-8000-000000000001',
   '5e920000-0000-4000-8000-000000000001', 'native', 'submitted'),
  ('5e940000-0000-4000-8000-000000000005', '5e910000-0000-4000-8000-000000000001',
   '5e930000-0000-4000-8000-000000000005', '5e950000-0000-4000-8000-000000000002',
   '5e920000-0000-4000-8000-000000000001', 'native', 'submitted'),
  ('5e940000-0000-4000-8000-000000000006', '5e910000-0000-4000-8000-000000000001',
   '5e930000-0000-4000-8000-000000000006', '5e950000-0000-4000-8000-000000000001',
   '5e920000-0000-4000-8000-000000000001', 'native', 'submitted'),
  ('5e940000-0000-4000-8000-000000000007', '5e910000-0000-4000-8000-000000000001',
   '5e930000-0000-4000-8000-000000000007', '5e950000-0000-4000-8000-000000000002',
   '5e920000-0000-4000-8000-000000000001', 'native', 'submitted'),
  -- Another semester of the same organization.
  ('5e940000-0000-4000-8000-000000000008', '5e910000-0000-4000-8000-000000000001',
   '5e930000-0000-4000-8000-000000000001', '5e950000-0000-4000-8000-000000000001',
   '5e920000-0000-4000-8000-000000000002', 'legacy_import', 'submitted'),
  -- Another organization.
  ('5e940000-0000-4000-8000-000000000009', '5e910000-0000-4000-8000-000000000002',
   '5e930000-0000-4000-8000-000000000009', '5e950000-0000-4000-8000-000000000009',
   '5e920000-0000-4000-8000-000000000009', 'legacy_import', 'submitted');

-- The punctuation and accent semester, one application per profile.
INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status
)
SELECT
  ('5e9400' || pg_catalog.right(profile.id::text, 2) || '-0000-4000-8000-0000000000aa')::uuid,
  profile.organization_id,
  profile.id,
  '5e950000-0000-4000-8000-000000000001',
  '5e920000-0000-4000-8000-000000000004',
  'legacy_import',
  'submitted'
FROM plugin_data.csf_profiles AS profile
WHERE profile.id::text LIKE '5e930000-0000-4000-8000-00000000001_';

-- 1,005 applications in a third semester: more than ten maximum pages, and
-- more rows than the Data API returns for a row set.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
)
SELECT
  ('5e96' || pg_catalog.lpad(series.n::text, 4, '0') || '-0000-4000-8000-000000000000')::uuid,
  '5e910000-0000-4000-8000-000000000001',
  'Load',
  'Member' || pg_catalog.lpad(series.n::text, 4, '0'),
  'load',
  'member' || pg_catalog.lpad(series.n::text, 4, '0')
FROM pg_catalog.generate_series(1, 1005) AS series(n);

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status
)
SELECT
  ('5e97' || pg_catalog.lpad(series.n::text, 4, '0') || '-0000-4000-8000-000000000000')::uuid,
  '5e910000-0000-4000-8000-000000000001',
  ('5e96' || pg_catalog.lpad(series.n::text, 4, '0') || '-0000-4000-8000-000000000000')::uuid,
  '5e950000-0000-4000-8000-000000000001',
  '5e920000-0000-4000-8000-000000000003',
  'legacy_import',
  'submitted'
FROM pg_catalog.generate_series(1, 1005) AS series(n);

SELECT plugin_data.csf_set_review_period(
  '5e910000-0000-4000-8000-000000000001',
  '5e900000-0000-4000-8000-000000000001',
  '5e920000-0000-4000-8000-000000000001',
  'membership_applications', 'open', 'Fall 2028 application review'
);

-- Desai and Garcia are assigned through the canonical per-application path.
SELECT plugin_data.csf_assign_application(
  '5e910000-0000-4000-8000-000000000001',
  '5e940000-0000-4000-8000-000000000004',
  '5e900000-0000-4000-8000-000000000002',
  '5e900000-0000-4000-8000-000000000001'
);
SELECT plugin_data.csf_assign_application(
  '5e910000-0000-4000-8000-000000000001',
  '5e940000-0000-4000-8000-000000000007',
  '5e900000-0000-4000-8000-000000000002',
  '5e900000-0000-4000-8000-000000000001'
);

-- Chen and Garcia are decided through the canonical decision path.
SELECT plugin_data.csf_record_review_decision(
  '5e910000-0000-4000-8000-000000000001',
  '5e900000-0000-4000-8000-000000000001',
  (SELECT id FROM plugin_data.csf_review_periods
    WHERE organization_id = '5e910000-0000-4000-8000-000000000001'
      AND kind = 'membership_applications'),
  'application', '5e940000-0000-4000-8000-000000000003', 'approved'
);
SELECT plugin_data.csf_record_review_decision(
  '5e910000-0000-4000-8000-000000000001',
  '5e900000-0000-4000-8000-000000000001',
  (SELECT id FROM plugin_data.csf_review_periods
    WHERE organization_id = '5e910000-0000-4000-8000-000000000001'
      AND kind = 'membership_applications'),
  'application', '5e940000-0000-4000-8000-000000000007', 'rejected',
  p_reason => 'Fictional fixture rejection'
);

SELECT plugin_data.csf_add_review_note(
  p_organization_id => '5e910000-0000-4000-8000-000000000001',
  p_actor_user_id => '5e900000-0000-4000-8000-000000000001',
  p_period_id => (SELECT id FROM plugin_data.csf_review_periods
    WHERE organization_id = '5e910000-0000-4000-8000-000000000001'
      AND kind = 'membership_applications'),
  p_subject_kind => 'application',
  p_subject_id => '5e940000-0000-4000-8000-000000000001',
  p_body => 'Fictional officer note'
);

INSERT INTO plugin_data.csf_application_decision_stages (
  organization_id, application_id, term_id, profile_id,
  staged_decision, block_reason, decision_digest, identity_digest
)
SELECT
  application.organization_id, application.id, application.term_id, application.profile_id,
  staged.decision, staged.block_reason, pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64)
FROM (
  VALUES
    ('5e940000-0000-4000-8000-000000000002'::uuid, 'accepted', NULL),
    ('5e940000-0000-4000-8000-000000000003'::uuid, 'rejected', 'officer_approved'),
    ('5e940000-0000-4000-8000-000000000004'::uuid, 'on_hold', 'awaiting_review'),
    ('5e940000-0000-4000-8000-000000000005'::uuid, 'conflict', NULL),
    ('5e940000-0000-4000-8000-000000000006'::uuid, 'rejected_with_explanation', NULL),
    ('5e940000-0000-4000-8000-000000000007'::uuid, 'rejected', NULL)
) AS staged(application_id, decision, block_reason)
JOIN plugin_data.csf_term_applications AS application
  ON application.id = staged.application_id;

-- One page of a semester, with every list argument defaulted, so each
-- assertion names only what it varies. The cursor is a boundary row's own
-- sort values.
CREATE FUNCTION pg_temp.listed(
  p_term_id uuid DEFAULT '5e920000-0000-4000-8000-000000000001',
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

-- The reviewed queue document for the current semester.
CREATE FUNCTION pg_temp.queue(
  p_term_id uuid DEFAULT '5e920000-0000-4000-8000-000000000001',
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
-- C. Scope counts, reviewer totals, and isolation
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  plugin_data.csf_review_application_roster_scope(
    '5e910000-0000-4000-8000-000000000001',
    '5e920000-0000-4000-8000-000000000001', NULL
  ) - 'reviewers',
  '{"total": 7, "pending": 5}'::jsonb,
  'the all-classes scope counts every application and the pending ones'
);
SELECT extensions.is(
  plugin_data.csf_review_application_roster_scope(
    '5e910000-0000-4000-8000-000000000001',
    '5e920000-0000-4000-8000-000000000001', NULL
  ) -> 'reviewers',
  '[{"reviewerUserId": "5e900000-0000-4000-8000-000000000002", "assigned": 2, "pending": 1}]'::jsonb,
  'reviewer totals count what each officer holds and how much is still pending'
);
SELECT extensions.is(
  plugin_data.csf_review_application_roster_scope(
    '5e910000-0000-4000-8000-000000000001',
    '5e920000-0000-4000-8000-000000000001',
    '5e950000-0000-4000-8000-000000000001'
  ) - 'reviewers',
  '{"total": 4, "pending": 3}'::jsonb,
  'a class scope counts only that class'
);
SELECT extensions.is(
  plugin_data.csf_review_application_roster_scope(
    '5e910000-0000-4000-8000-000000000001',
    '5e920000-0000-4000-8000-000000000002', NULL
  ) ->> 'total',
  '1',
  'another semester counts only its own application'
);
SELECT extensions.is(
  plugin_data.csf_review_application_roster_scope(
    '5e910000-0000-4000-8000-000000000001',
    '5e920000-0000-4000-8000-000000000009', NULL
  ) ->> 'total',
  '0',
  'an organization cannot count another organization''s semester'
);
SELECT extensions.is(
  plugin_data.csf_review_application_roster_scope(
    '5e910000-0000-4000-8000-000000000002',
    '5e920000-0000-4000-8000-000000000001', NULL
  ) ->> 'total',
  '0',
  'another organization cannot count this semester'
);
SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM plugin_data.csf_review_application_roster_page(
      '5e910000-0000-4000-8000-000000000002',
      '5e920000-0000-4000-8000-000000000001',
      NULL, false, 'aguirre', false, 'all', NULL, NULL, NULL, NULL, NULL, NULL
    )
  ),
  0,
  'another organization cannot list this semester, even by a shared surname'
);
SELECT extensions.is(
  pg_temp.queue(
    p_keep_application_id => '5e940000-0000-4000-8000-000000000001',
    p_organization_id => '5e910000-0000-4000-8000-000000000002'
  ) - 'limit',
  '{"listed": 0, "count": 0, "complete": true, "subjects": []}'::jsonb,
  'another organization cannot queue this semester, even by naming a kept application'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_cohort_id => '5e950000-0000-4000-8000-000000000002') ORDER BY match_position),
  ARRAY['Bhola', 'Evans', 'Garcia'],
  'a class page lists only that class'
);

-- ---------------------------------------------------------------------------
-- D. Bounded pages and cursors made of sort values
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  ARRAY(SELECT roster_index FROM pg_temp.listed(p_limit => 3) ORDER BY match_position),
  ARRAY[1, 2, 3],
  'the first page starts at the top of the roster'
);
SELECT extensions.is(
  (SELECT ARRAY[pg_catalog.min(matched_count), pg_catalog.max(match_position)] FROM pg_temp.listed(p_limit => 3)),
  ARRAY[7::bigint, 3::bigint],
  'a page reports the whole listed count and where it sits in the list'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(
    p_cursor_rank => 0, p_cursor_last => 'chen', p_cursor_first => 'cy',
    p_cursor_id => '5e940000-0000-4000-8000-000000000003',
    p_direction => 'after', p_limit => 3
  ) ORDER BY match_position),
  ARRAY['Desai', 'Evans', 'F%_ox'],
  'a forward cursor reads the rows strictly after the boundary row'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(
    p_cursor_rank => 0, p_cursor_last => 'f%_ox', p_cursor_first => 'flo',
    p_cursor_id => '5e940000-0000-4000-8000-000000000006',
    p_direction => 'after', p_limit => 3
  ) ORDER BY match_position),
  ARRAY['Garcia'],
  'the last page holds the remainder'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(
    p_cursor_rank => 0, p_cursor_last => 'garcia', p_cursor_first => 'gia',
    p_cursor_id => '5e940000-0000-4000-8000-000000000007',
    p_direction => 'before', p_limit => 3
  ) ORDER BY match_position),
  ARRAY['Desai', 'Evans', 'F%_ox'],
  'a backward cursor reads the previous page in list order'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(
    p_cursor_rank => 0, p_cursor_last => 'desai', p_cursor_first => 'di',
    p_cursor_id => '5e940000-0000-4000-8000-000000000004',
    p_direction => 'before', p_limit => 3
  ) ORDER BY match_position),
  ARRAY['Aguirre', 'Bhola', 'Chen'],
  'paging back reaches the first page again'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(
    p_cursor_rank => 0, p_cursor_last => 'chen', p_cursor_first => 'cy',
    p_cursor_id => '5e940000-0000-4000-8000-000000000003',
    p_direction => 'sideways', p_limit => 3
  )),
  ARRAY[]::text[],
  'a cursor with an unknown direction lists nothing rather than guessing a page'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM pg_temp.listed(p_limit => 0)),
  1,
  'a page never holds fewer than one row'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM pg_temp.listed(p_term_id => '5e920000-0000-4000-8000-000000000003')),
  50,
  'the default page is fifty rows'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000003', p_limit => 100000
  )),
  100,
  'no page exceeds one hundred rows whatever limit is asked for'
);
SELECT extensions.is(
  (SELECT ARRAY[pg_catalog.min(last_name), pg_catalog.max(last_name)] FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000003',
    p_cursor_rank => 0, p_cursor_last => 'member0100', p_cursor_first => 'load',
    p_cursor_id => '5e970100-0000-4000-8000-000000000000',
    p_direction => 'after', p_limit => 100
  )),
  ARRAY['Member0101', 'Member0200'],
  'a cursor past the first maximum page reaches the rows a single page could not hold'
);
-- The boundary is found by its sort values, so a cursor whose row has since
-- gone still marks the same place in the list.
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(
    p_cursor_rank => 0, p_cursor_last => 'cz', p_cursor_first => 'nobody',
    p_cursor_id => '00000000-0000-4000-8000-000000000000',
    p_direction => 'after', p_limit => 2
  ) ORDER BY match_position),
  ARRAY['Desai', 'Evans'],
  'a cursor for a row that no longer exists still resumes at the same place'
);

-- ---------------------------------------------------------------------------
-- E. Filters, literal search, and the stable roster index
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  ARRAY(SELECT roster_index FROM pg_temp.listed(p_pending_only => true) ORDER BY match_position),
  ARRAY[1, 2, 4, 5, 6],
  'the pending filter drops decided rows and keeps every roster index'
);
SELECT extensions.is(
  ARRAY(SELECT roster_index FROM pg_temp.listed(p_query => 'bho')),
  ARRAY[2],
  'a searched row keeps the roster index it has in the unfiltered scope'
);
SELECT extensions.is(
  ARRAY(SELECT roster_index FROM pg_temp.listed(p_query => '  ADA agu  ')),
  ARRAY[1],
  'search ignores case and surrounding space and reads first then last name'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_query => '%')),
  ARRAY['F%_ox'],
  'a percent sign matches only itself'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_query => '_')),
  ARRAY['F%_ox'],
  'an underscore matches only itself'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_query => 'f%_o')),
  ARRAY['F%_ox'],
  'pattern characters inside a search are read literally'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_query => 'a%e')),
  ARRAY[]::text[],
  'a percent sign is never a wildcard'
);
SELECT extensions.is(
  ARRAY[
    (plugin_data.csf_review_application_roster_scope(
      '5e910000-0000-4000-8000-000000000001',
      '5e920000-0000-4000-8000-000000000001', NULL
    ) ->> 'total')::bigint,
    (SELECT pg_catalog.max(matched_count) FROM pg_temp.listed(p_pending_only => true, p_query => 'bho'))
  ],
  ARRAY[7::bigint, 1::bigint],
  'a search narrows the listed count and leaves the scope count alone'
);
SELECT extensions.is(
  ARRAY(SELECT roster_index FROM pg_temp.listed(
    p_cohort_id => '5e950000-0000-4000-8000-000000000002', p_query => 'garcia'
  )),
  ARRAY[3],
  'the roster index is the position inside the selected class scope'
);
SELECT extensions.is(
  ARRAY[
    (
      SELECT page.note_count
      FROM plugin_data.csf_review_application_roster_page(
        '5e910000-0000-4000-8000-000000000001',
        '5e920000-0000-4000-8000-000000000001',
        NULL, false, 'aguirre', false, 'all', NULL, NULL, NULL, NULL, NULL, NULL
      ) AS page
    ),
    (
      SELECT page.note_count
      FROM plugin_data.csf_review_application_roster_page(
        '5e910000-0000-4000-8000-000000000001',
        '5e920000-0000-4000-8000-000000000001',
        NULL, false, 'bhola', false, 'all', NULL, NULL, NULL, NULL, NULL, NULL
      ) AS page
    )
  ],
  ARRAY[1::bigint, 0::bigint],
  'a row carries its own note count and nothing from another application'
);

-- ---------------------------------------------------------------------------
-- F. Name ordering: the comparison the list has always made
--
-- The previous loader ordered names with a locale comparison, where
-- punctuation sorts before letters and an accented letter sorts beside its
-- base letter. Byte order would give
--   nunez, nut, núñez, o'brien, o-brien, obrien.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_term_id => '5e920000-0000-4000-8000-000000000004') ORDER BY match_position),
  ARRAY['Nunez', 'Núñez', 'Nut', 'O-Brien', 'O''Brien', 'OBrien'],
  'surnames with punctuation and accents keep the locale order the list has always used'
);
SELECT extensions.is(
  ARRAY(SELECT roster_index FROM pg_temp.listed(p_term_id => '5e920000-0000-4000-8000-000000000004') ORDER BY match_position),
  ARRAY[1, 2, 3, 4, 5, 6],
  'the roster index follows the same order'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000004',
    p_cursor_rank => 0, p_cursor_last => 'núñez', p_cursor_first => 'pat',
    p_cursor_id => '5e940015-0000-4000-8000-0000000000aa',
    p_direction => 'after', p_limit => 2
  ) ORDER BY match_position),
  ARRAY['Nut', 'O-Brien'],
  'a cursor on an accented surname pages in that same order'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000004',
    p_cursor_rank => 0, p_cursor_last => 'o''brien', p_cursor_first => 'pat',
    p_cursor_id => '5e940012-0000-4000-8000-0000000000aa',
    p_direction => 'before', p_limit => 2
  ) ORDER BY match_position),
  ARRAY['Nut', 'O-Brien'],
  'a backward cursor on a punctuated surname pages in that same order'
);
SELECT extensions.is(
  ARRAY(
    SELECT subject.value ->> 'label'
    FROM pg_catalog.jsonb_array_elements(
      pg_temp.queue(p_term_id => '5e920000-0000-4000-8000-000000000004') -> 'subjects'
    ) WITH ORDINALITY AS subject(value, ordinality)
    ORDER BY subject.ordinality
  ),
  ARRAY['Nunez', 'Núñez', 'Nut', 'O-Brien', 'O''Brien', 'OBrien'],
  'the queue walks the same order the list shows'
);

-- ---------------------------------------------------------------------------
-- G. Sheet filter and ordering parity
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_sheet_filter => 'accepted') ORDER BY match_position),
  ARRAY['Aguirre', 'Bhola', 'Chen', 'Desai', 'Evans', 'F%_ox', 'Garcia'],
  'the Sheet filter and ordering are ignored for a semester reviewed in the app'
);
SELECT extensions.is(
  (
    SELECT page.stage_status
    FROM plugin_data.csf_review_application_roster_page(
      '5e910000-0000-4000-8000-000000000001',
      '5e920000-0000-4000-8000-000000000001',
      NULL, false, 'bhola', false, 'all', NULL, NULL, NULL, NULL, NULL, NULL
    ) AS page
  ),
  'accepted',
  'a staged decision is still attached to its row outside Sheet review'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_sheet_review => true) ORDER BY match_position),
  ARRAY['Desai', 'Evans', 'F%_ox', 'Aguirre', 'Bhola', 'Chen', 'Garcia'],
  'Sheet review lists blocked rows first, then not done, then done, each in roster order'
);
SELECT extensions.is(
  ARRAY(SELECT roster_index FROM pg_temp.listed(p_sheet_review => true) ORDER BY match_position),
  ARRAY[4, 5, 6, 1, 2, 3, 7],
  'Sheet ordering moves rows without renumbering them'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(
    p_sheet_review => true,
    p_cursor_rank => -1, p_cursor_last => 'f%_ox', p_cursor_first => 'flo',
    p_cursor_id => '5e940000-0000-4000-8000-000000000006',
    p_direction => 'after', p_limit => 2
  ) ORDER BY match_position),
  ARRAY['Aguirre', 'Bhola'],
  'a forward cursor crosses a Sheet rank boundary'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(
    p_sheet_review => true,
    p_cursor_rank => 1, p_cursor_last => 'bhola', p_cursor_first => 'bo',
    p_cursor_id => '5e940000-0000-4000-8000-000000000002',
    p_direction => 'before', p_limit => 2
  ) ORDER BY match_position),
  ARRAY['F%_ox', 'Aguirre'],
  'a backward cursor crosses a Sheet rank boundary'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_sheet_review => true, p_sheet_filter => 'accepted') ORDER BY match_position),
  ARRAY['Bhola', 'Chen'],
  'Accepted lists accepted rows and individual officer approvals'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_sheet_review => true, p_sheet_filter => 'rejected') ORDER BY match_position),
  ARRAY['Garcia'],
  'Rejected excludes an officer approval staged as rejected and a rejection with a reason'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_sheet_review => true, p_sheet_filter => 'rejected_with_explanation') ORDER BY match_position),
  ARRAY['F%_ox'],
  'a rejection with a reason is its own status'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_sheet_review => true, p_sheet_filter => 'on_hold') ORDER BY match_position),
  ARRAY['Desai'],
  'Awaiting review lists held rows'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_sheet_review => true, p_sheet_filter => 'unreviewed') ORDER BY match_position),
  ARRAY['Aguirre'],
  'a row with no staged decision is Unreviewed'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_sheet_review => true, p_sheet_filter => 'conflict') ORDER BY match_position),
  ARRAY['Evans', 'F%_ox'],
  'Needs attention lists conflicts and blocked rows, not rows merely awaiting review'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_sheet_review => true, p_sheet_filter => 'done') ORDER BY match_position),
  ARRAY['F%_ox', 'Bhola', 'Chen', 'Garcia'],
  'Done lists terminal staged verdicts and officer approvals'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_sheet_review => true, p_sheet_filter => 'not_done') ORDER BY match_position),
  ARRAY['Desai', 'Evans', 'Aguirre'],
  'Not done lists everything else, including rows never staged'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_sheet_review => true, p_sheet_filter => 'everything')),
  ARRAY[]::text[],
  'an unknown Sheet filter lists nothing rather than everything'
);
SELECT extensions.is(
  ARRAY(SELECT last_name FROM pg_temp.listed(p_pending_only => true, p_sheet_review => true, p_sheet_filter => 'done') ORDER BY match_position),
  ARRAY['F%_ox', 'Bhola'],
  'the pending filter and the Sheet filter narrow together'
);

-- ---------------------------------------------------------------------------
-- H. The frozen queue: complete or refused
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  pg_temp.queue_indexes(pg_temp.queue(p_pending_only => true)),
  ARRAY[1, 2, 4, 5, 6],
  'the queue is the whole filtered list in list order'
);
SELECT extensions.is(
  pg_temp.queue_indexes(pg_temp.queue(
    p_pending_only => true,
    p_keep_application_id => '5e940000-0000-4000-8000-000000000003'
  )),
  ARRAY[1, 2, 3, 4, 5, 6],
  'the row an officer entered from stays in the queue after it is decided'
);
SELECT extensions.is(
  pg_temp.queue(
    p_pending_only => true, p_query => 'no such applicant',
    p_keep_application_id => '5e940000-0000-4000-8000-000000000003'
  ) -> 'subjects',
  '[{"id": "5e940000-0000-4000-8000-000000000003", "index": 3, "label": "Chen"}]'::jsonb,
  'a search still narrows the queue around the kept row'
);
SELECT extensions.is(
  pg_temp.queue_indexes(pg_temp.queue(p_sheet_review => true)),
  ARRAY[4, 5, 6, 1, 2, 3, 7],
  'a Sheet semester queue walks the Sheet ordering'
);
SELECT extensions.is(
  pg_temp.queue(p_splittable_only => true) - 'limit',
  '{
    "listed": 7, "count": 4, "complete": true,
    "subjects": [
      {"id": "5e940000-0000-4000-8000-000000000001", "index": 1, "label": "Aguirre"},
      {"id": "5e940000-0000-4000-8000-000000000002", "index": 2, "label": "Bhola"},
      {"id": "5e940000-0000-4000-8000-000000000005", "index": 5, "label": "Evans"},
      {"id": "5e940000-0000-4000-8000-000000000006", "index": 6, "label": "F%_ox"}
    ]
  }'::jsonb,
  'a split snapshot holds only pending, unassigned rows and reports how many were listed'
);
SELECT extensions.is(
  pg_temp.queue(p_splittable_only => true, p_query => 'garcia') - 'limit',
  '{"listed": 1, "count": 0, "complete": true, "subjects": []}'::jsonb,
  'a list with nothing left to split still reports how many rows it lists'
);
SELECT extensions.is(
  (pg_temp.queue(
    p_cohort_id => '5e950000-0000-4000-8000-000000000001',
    p_keep_application_id => '5e940000-0000-4000-8000-000000000002'
  ) ->> 'count')::integer,
  4,
  'a kept application from another class cannot widen a class queue'
);
-- More subjects than the Data API returns for a row set, in one document.
SELECT extensions.is(
  (
    SELECT ARRAY[
      (queue ->> 'count')::integer,
      pg_catalog.jsonb_array_length(queue -> 'subjects'),
      (queue ->> 'listed')::integer
    ]
    FROM pg_temp.queue(p_term_id => '5e920000-0000-4000-8000-000000000003', p_pending_only => true) AS queue
  ),
  ARRAY[1005, 1005, 1005],
  'a queue of 1,005 applications carries all 1,005, past any thousand-row limit'
);
SELECT extensions.is(
  (
    SELECT ARRAY[queue -> 'subjects' -> 0 ->> 'label', queue -> 'subjects' -> 1000 ->> 'label', queue -> 'subjects' -> 1004 ->> 'label']
    FROM pg_temp.queue(p_term_id => '5e920000-0000-4000-8000-000000000003') AS queue
  ),
  ARRAY['Member0001', 'Member1001', 'Member1005'],
  'the 1,001st application and the last are present and in order'
);
SELECT extensions.is(
  (
    SELECT pg_catalog.count(DISTINCT subject.value ->> 'id')::integer
    FROM pg_catalog.jsonb_array_elements(
      pg_temp.queue(p_term_id => '5e920000-0000-4000-8000-000000000003') -> 'subjects'
    ) AS subject(value)
  ),
  1005,
  'no application appears twice in the queue'
);
SELECT extensions.is(
  pg_temp.queue(p_term_id => '5e920000-0000-4000-8000-000000000003', p_max_subjects => 1000),
  '{"listed": 1005, "count": 1005, "limit": 1000, "complete": false, "subjects": []}'::jsonb,
  'a list over the bound is refused whole: its count is reported and no subject is returned'
);
SELECT extensions.is(
  pg_temp.queue(p_term_id => '5e920000-0000-4000-8000-000000000003', p_max_subjects => 1005) ->> 'complete',
  'true',
  'a list exactly at the bound is complete'
);
SELECT extensions.is(
  ARRAY[
    pg_temp.queue(p_max_subjects => 1000000) ->> 'limit',
    pg_temp.queue(p_max_subjects => 0) ->> 'limit',
    pg_temp.queue() ->> 'limit'
  ],
  ARRAY['5000', '1', '5000'],
  'the bound is clamped to 1..5000 whatever is asked for'
);

-- ---------------------------------------------------------------------------
-- I. A cursor survives rows changing before the boundary
--
-- An officer reads the first fifty of a search and holds a cursor on the
-- fiftieth row. Before they ask for the next page, an earlier row leaves the
-- search and another row moves in ahead of the boundary. The next page must
-- start at the fifty-first applicant either way: nothing skipped, nothing
-- repeated.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT ARRAY[pg_catalog.min(last_name), pg_catalog.max(last_name)] FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000003', p_query => 'member'
  )),
  ARRAY['Member0001', 'Member0050'],
  'the first page of the search ends on the fiftieth applicant'
);

-- An earlier applicant is renamed out of the search.
UPDATE plugin_data.csf_profiles
SET last_name = 'Zed', normalized_last_name = 'zed'
WHERE id = '5e960010-0000-4000-8000-000000000000';

SELECT extensions.is(
  (SELECT ARRAY[pg_catalog.min(last_name), pg_catalog.max(last_name)] FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000003', p_query => 'member',
    p_cursor_rank => 0, p_cursor_last => 'member0050', p_cursor_first => 'load',
    p_cursor_id => '5e970050-0000-4000-8000-000000000000',
    p_direction => 'after'
  )),
  ARRAY['Member0051', 'Member0100'],
  'after an earlier row leaves the list, the next page still starts at the fifty-first applicant'
);
SELECT extensions.is(
  (SELECT pg_catalog.min(match_position) FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000003', p_query => 'member',
    p_cursor_rank => 0, p_cursor_last => 'member0050', p_cursor_first => 'load',
    p_cursor_id => '5e970050-0000-4000-8000-000000000000',
    p_direction => 'after'
  )),
  50::bigint,
  'the position label follows the list as it now stands, and nothing pages by it'
);

-- A later applicant is renamed to sort ahead of the boundary.
UPDATE plugin_data.csf_profiles
SET last_name = 'Member0020a', normalized_last_name = 'member0020a'
WHERE id = '5e960500-0000-4000-8000-000000000000';

SELECT extensions.is(
  (SELECT ARRAY[pg_catalog.min(last_name), pg_catalog.max(last_name)] FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000003', p_query => 'member',
    p_cursor_rank => 0, p_cursor_last => 'member0050', p_cursor_first => 'load',
    p_cursor_id => '5e970050-0000-4000-8000-000000000000',
    p_direction => 'after'
  )),
  ARRAY['Member0051', 'Member0100'],
  'after a row moves in ahead of the boundary, the boundary row is not repeated'
);
SELECT extensions.is(
  (SELECT ARRAY[pg_catalog.min(last_name), pg_catalog.max(last_name), pg_catalog.count(*)::text] FROM pg_temp.listed(
    p_term_id => '5e920000-0000-4000-8000-000000000003', p_query => 'member',
    p_cursor_rank => 0, p_cursor_last => 'member0051', p_cursor_first => 'load',
    p_cursor_id => '5e970051-0000-4000-8000-000000000000',
    p_direction => 'before'
  )),
  ARRAY['Member0001', 'Member0050', '50'],
  'paging back from the fifty-first applicant returns the rows now before it, the moved row among them'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_temp.listed(
      p_term_id => '5e920000-0000-4000-8000-000000000003', p_query => 'member',
      p_cursor_rank => 0, p_cursor_last => 'member0051', p_cursor_first => 'load',
      p_cursor_id => '5e970051-0000-4000-8000-000000000000',
      p_direction => 'before'
    ) WHERE last_name = 'Member0020a'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_temp.listed(
      p_term_id => '5e920000-0000-4000-8000-000000000003', p_query => 'member',
      p_cursor_rank => 0, p_cursor_last => 'member0051', p_cursor_first => 'load',
      p_cursor_id => '5e970051-0000-4000-8000-000000000000',
      p_direction => 'before'
    ) WHERE last_name = 'Zed'
  ),
  'the previous page shows the row that moved in and not the row that left'
);

SELECT * FROM extensions.finish();

ROLLBACK;
