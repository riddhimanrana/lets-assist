-- Which lanes announce a profile change, and which stay quiet.
--
-- The risk here is asymmetric. Suppression reaching too far is silent: a member
-- simply never hears that their record was corrected, and nothing fails. So
-- both halves are stated, and the half that says a staff edit still announces
-- matters more than the half that says an import does not.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(26);

-- ---------------------------------------------------------------------------
-- No parameter privilege was taken, and none is needed.
-- ---------------------------------------------------------------------------
-- The first attempt at this attached the switch with ALTER FUNCTION ... SET,
-- which needs SET privilege on the parameter and failed the replay with 42501.
-- The fix must not have quietly acquired that privilege instead.
SELECT extensions.is(
  (SELECT count(*)::int FROM pg_parameter_acl
   WHERE parname = 'app.csf_suppress_notices'),
  0,
  'no ACL was created for the suppression parameter'
);

-- And nothing persisted the parameter onto a function, a role, or the database.
SELECT extensions.is(
  (SELECT count(*)::int FROM pg_proc AS p
   JOIN pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'plugin_data'
     AND EXISTS (
       SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS setting
       WHERE setting LIKE 'app.csf\_suppress\_notices=%'
     )),
  0,
  'no function carries the parameter as a persisted setting'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM pg_db_role_setting
   WHERE EXISTS (
     SELECT 1 FROM unnest(coalesce(setconfig, ARRAY[]::text[])) AS setting
     WHERE setting LIKE 'app.csf\_suppress\_notices=%'
   )),
  0,
  'no role or database default carries the parameter'
);

-- ---------------------------------------------------------------------------
-- The reader's own shape and reach.
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
  (SELECT p.prosecdef
     AND p.provolatile = 's'
     AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
     AND p.proconfig @> ARRAY['search_path=""']::text[]
   FROM pg_proc AS p
   JOIN pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'plugin_data'
     AND p.proname = 'csf_publication_notices_suppressed'),
  'the reader is a stable plpgsql definer with an empty search path'
);

-- CREATE OR REPLACE keeps an existing ACL, so a replacement that silently
-- widened one would not be obvious. This states the whole reviewed posture.
SELECT extensions.ok(
  NOT has_function_privilege(role_name,
    to_regprocedure('plugin_data.csf_publication_notices_suppressed()'), 'EXECUTE'),
  format('%s cannot execute the suppression reader', role_name)
)
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS expected(role_name);

SELECT extensions.ok(
  has_function_privilege('postgres',
    to_regprocedure('plugin_data.csf_publication_notices_suppressed()'), 'EXECUTE'),
  'the owner can still execute the suppression reader'
);

-- PUBLIC is a pseudo-role and cannot be asked with has_function_privilege, so
-- the grant list is read directly. A PUBLIC entry would make every other
-- revocation above meaningless.
SELECT extensions.is(
  (SELECT count(*)::int
   FROM pg_proc AS p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS a
   WHERE p.oid IN (
     to_regprocedure('plugin_data.csf_publication_notices_suppressed()'),
     to_regprocedure('plugin_data.csf_suppress_publication_notices()'))
     AND a.grantee = 0),
  0,
  'neither suppression function is granted to PUBLIC'
);

-- The switch entry point keeps its own reviewed posture too: the lanes that use
-- it run as the service role.
SELECT extensions.ok(
  NOT has_function_privilege(role_name,
    to_regprocedure('plugin_data.csf_suppress_publication_notices()'), 'EXECUTE'),
  format('%s cannot switch notices off', role_name)
)
FROM (VALUES ('anon'), ('authenticated')) AS expected(role_name);

SELECT extensions.ok(
  has_function_privilege('service_role',
    to_regprocedure('plugin_data.csf_suppress_publication_notices()'), 'EXECUTE'),
  'a lane running as the service role can switch notices off'
);

-- ---------------------------------------------------------------------------
-- The explicit switch still works, and still ends.
-- ---------------------------------------------------------------------------
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

SELECT set_config('app.csf_suppress_notices', '', true);

SELECT extensions.ok(
  NOT plugin_data.csf_publication_notices_suppressed(),
  'clearing the switch restores announcing'
);

-- ---------------------------------------------------------------------------
-- The empty search path the match depends on.
-- ---------------------------------------------------------------------------
-- The recogniser matches a schema-qualified frame. That the frame is qualified
-- follows from every lane running with SET search_path = '', because PL/pgSQL
-- renders the signature with format_procedure at compile time and compilation
-- happens inside the call. If a lane ever loses that setting, its frame could
-- render bare and stop matching, so the assumption is pinned here rather than
-- left in a comment.
SELECT extensions.ok(
  (SELECT count(*) > 0 AND bool_and(
     p.prosecdef AND p.proconfig @> ARRAY['search_path=""']::text[])
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
  'every real lane is a definer with an empty search path, so its frame is qualified'
);

-- ---------------------------------------------------------------------------
-- The call stack recognises a bulk lane, and only a bulk lane.
-- ---------------------------------------------------------------------------
-- Driving a real import would need a whole fixture, so the recogniser is
-- exercised with probes that sit exactly where a lane sits: in plugin_data,
-- definer, empty search path. They are created inside this transaction and go
-- away with the ROLLBACK, and each carries a v99 suffix no real lane uses.
CREATE FUNCTION plugin_data.csf_import_class_history_row_v99_probe()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $probe$
BEGIN
  RETURN plugin_data.csf_publication_notices_suppressed();
END;
$probe$;

CREATE FUNCTION plugin_data.csf_commit_import_row_for_attempt_v99_probe()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $probe$
BEGIN
  RETURN plugin_data.csf_publication_notices_suppressed();
END;
$probe$;

CREATE FUNCTION plugin_data.csf_review_point_submission_request_v99_probe()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $probe$
BEGIN
  RETURN plugin_data.csf_publication_notices_suppressed();
END;
$probe$;

CREATE FUNCTION plugin_data.csf_release_application_decisions_v99_probe()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $probe$
BEGIN
  RETURN plugin_data.csf_publication_notices_suppressed();
END;
$probe$;

SELECT extensions.ok(
  plugin_data.csf_import_class_history_row_v99_probe(),
  'a class-history import lane on the stack suppresses, including a later version'
);

SELECT extensions.ok(
  plugin_data.csf_commit_import_row_for_attempt_v99_probe(),
  'the application import commit lane and its identity base suppress'
);

-- The half that fails quietly if it is wrong.
SELECT extensions.ok(
  NOT plugin_data.csf_review_point_submission_request_v99_probe(),
  'an officer reviewing a submission still announces to the member'
);

SELECT extensions.ok(
  NOT plugin_data.csf_release_application_decisions_v99_probe(),
  'a decision release still announces nothing and suppresses nothing'
);

-- ---------------------------------------------------------------------------
-- A look-alike in another schema is not a lane.
-- ---------------------------------------------------------------------------
-- This is the spoof the schema-qualified match exists to refuse. A function
-- named exactly like a bulk lane, but living somewhere a caller can reach,
-- must not be able to silence a member's notice. Two schemas are tried: the
-- temporary one, which any session can write to, and public.
CREATE FUNCTION pg_temp.csf_import_class_history_row_v99_probe()
RETURNS boolean LANGUAGE plpgsql AS $probe$
BEGIN
  RETURN plugin_data.csf_publication_notices_suppressed();
END;
$probe$;

CREATE FUNCTION public.csf_import_class_history_row_v99_probe()
RETURNS boolean LANGUAGE plpgsql AS $probe$
BEGIN
  RETURN plugin_data.csf_publication_notices_suppressed();
END;
$probe$;

SELECT extensions.ok(
  NOT pg_temp.csf_import_class_history_row_v99_probe(),
  'a lane-named function in the temporary schema cannot suppress'
);

SELECT extensions.ok(
  NOT public.csf_import_class_history_row_v99_probe(),
  'a lane-named function in public cannot suppress'
);

-- A bare SQL caller is not a lane either, so nothing is suppressed by default.
SELECT extensions.ok(
  NOT plugin_data.csf_publication_notices_suppressed(),
  'a plain caller is never treated as an import'
);

-- ---------------------------------------------------------------------------
-- The recogniser names the lanes it claims to, and no officer surface.
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
  (SELECT bool_and(strpos(pg_get_functiondef(
     to_regprocedure('plugin_data.csf_publication_notices_suppressed()')
   ), needle) > 0)
   FROM unnest(ARRAY[
     'csf_commit_import_row_for_attempt',
     'csf_fill_application_profile_contacts',
     'csf_prepare_automatic_application_profiles',
     'csf_import_class_history_row',
     'PG_CONTEXT',
     -- The qualification is the whole defence against a look-alike elsewhere.
     'function plugin_data.'
   ]) AS needle),
  'the recogniser covers every bulk lane this migration claims, schema-qualified'
);

SELECT extensions.ok(
  (SELECT bool_and(strpos(pg_get_functiondef(
     to_regprocedure('plugin_data.csf_publication_notices_suppressed()')
   ), needle) = 0)
   FROM unnest(ARRAY[
     'csf_review_point', 'decision', 'release', 'sync'
   ]) AS needle),
  'no officer review, decision or release surface is in the lane list'
);

-- And the recorder still asks before it writes anything.
SELECT extensions.ok(
  strpos(pg_get_functiondef(to_regprocedure(
    'plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text)')
  ), 'csf_publication_notices_suppressed()') > 0,
  'the personal notice recorder still checks before recording'
);

SELECT extensions.finish();
ROLLBACK;
