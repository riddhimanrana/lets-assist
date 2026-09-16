-- Which lanes announce a profile change, and which stay quiet.
--
-- The risk this pins is asymmetric. Suppression reaching too far is silent: a
-- member simply never hears that their record was corrected, and nothing fails.
-- So the tests below state both halves, and the second half matters more than
-- the first.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(16);

-- ---------------------------------------------------------------------------
-- The bulk lanes carry the switch.
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
  (SELECT bool_and(p.proconfig @> ARRAY['app.csf_suppress_notices=on']::text[])
   FROM pg_proc AS p
   JOIN pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'plugin_data' AND p.proname = expected.name),
  format('%s suppresses personal notices', expected.name)
)
FROM (VALUES
  ('csf_commit_import_row_for_attempt'),
  ('csf_commit_import_row_for_attempt_identity_base'),
  ('csf_fill_application_profile_contacts'),
  ('csf_prepare_automatic_application_profiles'),
  ('csf_import_class_history_row_identity_base')
) AS expected(name);

-- Every versioned class-history entry point, not just the one that exists
-- today. A new version added without the switch is the defect returning.
SELECT extensions.ok(
  (SELECT count(*) > 0 AND bool_and(
     p.proconfig @> ARRAY['app.csf_suppress_notices=on']::text[])
   FROM pg_proc AS p
   JOIN pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'plugin_data'
     AND p.proname LIKE 'csf\_import\_class\_history\_row\_v%'),
  'every versioned class-history row entry point suppresses personal notices'
);

-- Attaching the switch must not have disturbed the search path these functions
-- already carried. Both settings have to survive together.
SELECT extensions.ok(
  (SELECT bool_and(p.proconfig @> ARRAY['search_path=""']::text[])
   FROM pg_proc AS p
   JOIN pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'plugin_data'
     AND (p.proname IN (
       'csf_commit_import_row_for_attempt',
       'csf_commit_import_row_for_attempt_identity_base',
       'csf_fill_application_profile_contacts',
       'csf_prepare_automatic_application_profiles',
       'csf_import_class_history_row_identity_base')
       OR p.proname LIKE 'csf\_import\_class\_history\_row\_v%')),
  'the suppressed lanes keep their empty search path'
);

-- ---------------------------------------------------------------------------
-- A staff edit still announces.
-- ---------------------------------------------------------------------------
-- This is the half that fails quietly if it is wrong, so it is stated by name.
-- An officer correcting a current member's record is precisely what a personal
-- notice exists for.
SELECT extensions.ok(
  (SELECT bool_and(
     p.proconfig IS NULL
     OR NOT (p.proconfig @> ARRAY['app.csf_suppress_notices=on']::text[]))
   FROM pg_proc AS p
   JOIN pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'plugin_data' AND p.proname = expected.name),
  format('%s still announces to the member', expected.name)
)
FROM (VALUES
  ('csf_review_point_submission_request'),
  ('csf_review_point_appeal_request')
) AS expected(name);

-- Nothing in the decision lane carries it either, because nothing in the
-- decision lane queues a personal notice to begin with. A function there that
-- suddenly needed suppression would mean one had started to.
SELECT extensions.is(
  (SELECT count(*)::int
   FROM pg_proc AS p
   JOIN pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'plugin_data'
     AND p.proconfig @> ARRAY['app.csf_suppress_notices=on']::text[]
     AND (p.proname LIKE '%decision%' OR p.proname LIKE '%release%')),
  0,
  'no decision or release function suppresses notices, because none queues one'
);

-- ---------------------------------------------------------------------------
-- The switch stays narrow.
-- ---------------------------------------------------------------------------
-- Suppression is attached to import and reconciliation lanes only. A count that
-- has grown past those is the thing to look at, not to re-baseline.
SELECT extensions.ok(
  (SELECT bool_and(
     p.proname LIKE 'csf\_import\_%'
     OR p.proname LIKE 'csf\_commit\_import\_%'
     OR p.proname LIKE 'csf\_prepare\_automatic\_%'
     OR p.proname LIKE 'csf\_fill\_application\_%'
     OR p.proname LIKE 'csf\_source\_%'
     OR p.proname LIKE 'csf\_retention\_%')
   FROM pg_proc AS p
   JOIN pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'plugin_data'
     AND p.proconfig @> ARRAY['app.csf_suppress_notices=on']::text[]),
  'only import, reconciliation and retention lanes carry the switch'
);

-- ---------------------------------------------------------------------------
-- The reader the triggers consult is unchanged and still transaction-scoped.
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
  (SELECT bool_and(strpos(pg_get_functiondef(
     to_regprocedure('plugin_data.csf_publication_notices_suppressed()')
   ), needle) > 0)
   FROM unnest(ARRAY['current_setting', 'app.csf_suppress_notices']) AS needle),
  'the notice trigger still reads the same switch'
);

-- Read with the missing_ok form. A database where nothing has ever set the
-- switch must answer "not suppressed" rather than raising, or an ordinary
-- officer edit would fail instead of announcing.
SELECT extensions.ok(
  NOT plugin_data.csf_publication_notices_suppressed(),
  'an ordinary transaction is not suppressed'
);

-- Set in its own statement. Putting the write and the read in one statement
-- would depend on an evaluation order nothing guarantees.
SELECT set_config('app.csf_suppress_notices', 'on', true);

SELECT extensions.ok(
  plugin_data.csf_publication_notices_suppressed(),
  'a transaction that set the switch is suppressed'
);

-- And it goes back off, so one suppressed import cannot silence the rest of a
-- session.
SELECT set_config('app.csf_suppress_notices', '', true);

SELECT extensions.ok(
  NOT plugin_data.csf_publication_notices_suppressed(),
  'clearing the switch restores announcing'
);

-- And the personal notice recorder still consults it before writing anything.
SELECT extensions.ok(
  strpos(pg_get_functiondef(to_regprocedure(
    'plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text)')
  ), 'csf_publication_notices_suppressed()') > 0,
  'the personal notice recorder still checks the switch'
);

SELECT extensions.finish();
ROLLBACK;
