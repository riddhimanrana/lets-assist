-- The two dblink writers start from the same committed source version. Holding
-- the source row in this session makes both requests queue before PostgreSQL
-- chooses an update order, which reproduces the stale application-read race.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(41);

DELETE FROM public.organization_members
WHERE organization_id IN (
  'f8100000-0000-4000-8000-000000000001',
  'f8100000-0000-4000-8000-000000000002'
);
DELETE FROM public.organizations
WHERE id IN (
  'f8100000-0000-4000-8000-000000000001',
  'f8100000-0000-4000-8000-000000000002'
);
DELETE FROM auth.users
WHERE id = 'f8000000-0000-4000-8000-000000000001';

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'f8000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'mapping-serialization-officer@local.test', now(),
  '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'f8100000-0000-4000-8000-000000000001',
    'Mapping Serialization Fixtures', 'mapping-serialization-fixtures',
    'school', '997211'
  ),
  (
    'f8100000-0000-4000-8000-000000000002',
    'Mapping Serialization Race', 'mapping-serialization-race',
    'school', '997212'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  (
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    'admin', 'active'
  ),
  (
    'f8100000-0000-4000-8000-000000000002',
    'f8000000-0000-4000-8000-000000000001',
    'admin', 'active'
  );

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, provider, spreadsheet_id,
  drive_file_id, target_strategy, duplicate_policy, column_mappings,
  tab_mappings, sync_status, settings
) VALUES
  (
    'f8200000-0000-4000-8000-000000000001',
    'f8100000-0000-4000-8000-000000000001',
    'student_roster', 'Serialized mapping source', 'google_sheets',
    'mapping-serialization-source', 'mapping-serialization-source',
    'fixed', 'match_email_then_name', '{"email":"Email"}',
    '[{"tabName":"Initial","rangeA1":"A1:B","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}]',
    'not_synced',
    '{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":1,"headerRow":1,"selectedTabs":["Initial"]}'
  ),
  (
    'f8200000-0000-4000-8000-000000000002',
    'f8100000-0000-4000-8000-000000000002',
    'student_roster', 'Concurrent mapping source', 'google_sheets',
    'mapping-serialization-race', 'mapping-serialization-race',
    'fixed', 'match_email_then_name', '{"email":"Email"}',
    '[{"tabName":"Initial","rangeA1":"A1:B","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}]',
    'not_synced',
    '{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":1,"headerRow":1,"selectedTabs":["Initial"]}'
  );

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  mapping_version
) VALUES (
  'f8300000-0000-4000-8000-000000000001',
  'f8100000-0000-4000-8000-000000000001',
  'f8200000-0000-4000-8000-000000000001',
  'f8000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster', 1
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = 'plugin_data.csf_sheet_sources'::regclass
      AND trigger.tgname = 'csf_sheet_sources_mapping_version_before_update'
      AND NOT trigger.tgisinternal
      AND trigger.tgenabled = 'O'
  ),
  1,
  'one enabled trigger owns source mapping-version assignment'
);

SELECT extensions.ok(
  (
    SELECT routine.prosecdef
      AND routine.proconfig @> ARRAY['search_path=""']
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid =
      'plugin_data.csf_enforce_sheet_source_mapping_version()'::regprocedure
  ),
  'the mapping-version trigger function is security definer with an empty search path'
);

SELECT extensions.ok(
  has_function_privilege(
    'postgres',
    'plugin_data.csf_enforce_sheet_source_mapping_version()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_enforce_sheet_source_mapping_version()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_enforce_sheet_source_mapping_version()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_enforce_sheet_source_mapping_version()',
    'EXECUTE'
  ),
  'the trigger function remains owner-only'
);

SELECT extensions.is(
  plugin_data.csf_sheet_source_settings_schema() ->> 'headerSignature',
  'string',
  'the closed source settings schema admits the persisted header digest'
);

SELECT extensions.ok(
  has_function_privilege(
    'postgres',
    'plugin_data.csf_sheet_source_settings_schema()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_sheet_source_settings_schema()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_sheet_source_settings_schema()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_sheet_source_settings_schema()',
    'EXECUTE'
  ),
  'the replaced source settings schema remains owner-only'
);

SELECT extensions.ok(
  has_function_privilege(
    'postgres',
    'plugin_data.csf_assert_sheet_source_settings(jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_assert_sheet_source_settings(jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_assert_sheet_source_settings(jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_assert_sheet_source_settings(jsonb)',
    'EXECUTE'
  ),
  'the replaced source settings validator remains owner-only'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    NULL,
    'student_roster',
    '{"title":"Malformed initial mapping source","provider":"google_sheets","spreadsheetId":"mapping-serialization-new-fractional","driveFileId":"mapping-serialization-new-fractional","targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email"},"tabMappings":[],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":3.5}}'
  )$$,
  '22023',
  'The requested import source mapping version is invalid.',
  'a create cannot bypass the positive-integer mapping version contract'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    NULL,
    'student_roster',
    '{"title":"Oversized initial mapping source","provider":"google_sheets","spreadsheetId":"mapping-serialization-new-oversized","driveFileId":"mapping-serialization-new-oversized","targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email"},"tabMappings":[],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":2147483648}}'
  )$$,
  '22023',
  'The requested import source mapping version is invalid.',
  'a create cannot store a mapping version outside the int4 preview domain'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    NULL,
    'student_roster',
    '{"title":"Initial version two source","provider":"google_sheets","spreadsheetId":"mapping-serialization-new-v2","driveFileId":"mapping-serialization-new-v2","targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email"},"tabMappings":[],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":2}}'
  )$$,
  'a legitimate create may start at adapter-selected version two'
);

SELECT extensions.is(
  (
    SELECT settings ->> 'mappingVersion'
    FROM plugin_data.csf_sheet_sources
    WHERE organization_id = 'f8100000-0000-4000-8000-000000000001'
      AND spreadsheet_id = 'mapping-serialization-new-v2'
  ),
  '2',
  'the create path stores the validated initial version'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_register_sheet_source(uuid,uuid,uuid,text,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_register_sheet_source(uuid,uuid,uuid,text,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_register_sheet_source(uuid,uuid,uuid,text,jsonb)',
    'EXECUTE'
  ),
  'the existing five-argument registry remains service-only'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    'f8200000-0000-4000-8000-000000000001',
    'student_roster',
    '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email"},"tabMappings":[{"tabName":"Initial","rangeA1":"A1:B","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":1,"headerRow":1,"selectedTabs":["Initial"]}}'
  )$$,
  'an exact source registration replay succeeds'
);

SELECT extensions.is(
  (
    SELECT settings ->> 'mappingVersion'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'f8200000-0000-4000-8000-000000000001'
  ),
  '1',
  'an exact replay keeps the current mapping version'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    'f8200000-0000-4000-8000-000000000001',
    'student_roster',
    '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","firstName":"First"},"tabMappings":[{"tabName":"Corrected","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":2,"headerRow":1,"selectedTabs":["Corrected"]}}'
  )$$,
  'a changed material mapping succeeds with the next application version'
);

SELECT extensions.ok(
  (
    SELECT settings ->> 'mappingVersion' = '2'
      AND tab_mappings #>> '{0,tabName}' = 'Corrected'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'f8200000-0000-4000-8000-000000000001'
  ),
  'the database assigns the next version to the changed mapping'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_preview_mapping_current(
    'f8100000-0000-4000-8000-000000000001',
    'f8300000-0000-4000-8000-000000000001'
  )$$,
  '55000',
  'This source mapping changed after the preview. Run a fresh preview.',
  'the 0202 fence rejects a preview prepared before the mapping change'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    'f8200000-0000-4000-8000-000000000001',
    'student_roster',
    '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","firstName":"First"},"tabMappings":[{"tabName":"Corrected","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":2,"headerRow":1,"selectedTabs":["Corrected"]}}'
  )$$,
  'an exact lost-response replay with its committed version succeeds'
);

SELECT extensions.is(
  (
    SELECT settings ->> 'mappingVersion'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'f8200000-0000-4000-8000-000000000001'
  ),
  '2',
  'an exact lost-response replay does not advance the version again'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    'f8200000-0000-4000-8000-000000000001',
    'student_roster',
    '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","firstName":"First"},"tabMappings":[{"tabName":"Corrected","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":3,"headerRow":1,"selectedTabs":["Corrected"]}}'
  )$$,
  'an adapter can advance parser semantics by one version without changing source columns'
);

SELECT extensions.is(
  (
    SELECT settings ->> 'mappingVersion'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'f8200000-0000-4000-8000-000000000001'
  ),
  '3',
  'the one-step parser-semantic bump is stored'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    'f8200000-0000-4000-8000-000000000001',
    'student_roster',
    '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","firstName":"First"},"tabMappings":[{"tabName":"Corrected","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":5,"headerRow":1,"selectedTabs":["Corrected"]}}'
  )$$,
  '23514',
  'An import source mapping version may advance by only one step.',
  'an unchanged mapping cannot skip mapping versions'
);

SELECT extensions.is(
  (
    SELECT settings ->> 'mappingVersion'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'f8200000-0000-4000-8000-000000000001'
  ),
  '3',
  'a refused version skip leaves the source unchanged'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    'f8200000-0000-4000-8000-000000000001',
    'student_roster',
    '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","firstName":"First"},"tabMappings":[{"tabName":"Corrected","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":3.5,"headerRow":1,"selectedTabs":["Corrected"]}}'
  )$$,
  '22023',
  'The requested import source mapping version is invalid.',
  'a fractional mapping version fails with bounded text'
);

SELECT extensions.is(
  (
    SELECT settings ->> 'mappingVersion'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'f8200000-0000-4000-8000-000000000001'
  ),
  '3',
  'a malformed version leaves the source unchanged'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    'f8200000-0000-4000-8000-000000000001',
    'student_roster',
    '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","firstName":"First"},"tabMappings":[{"tabName":"Corrected","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":2,"headerRow":1,"selectedTabs":["Corrected"]}}'
  )$$,
  '40001',
  'This import source mapping changed after it was loaded. Reload it and try again.',
  'a lower stale version is refused even when the material mapping matches'
);

SELECT extensions.is(
  (
    SELECT settings ->> 'mappingVersion'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'f8200000-0000-4000-8000-000000000001'
  ),
  '3',
  'a refused lower version leaves the source unchanged'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    'f8200000-0000-4000-8000-000000000001',
    'student_roster',
    '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","firstName":"First"},"tabMappings":[{"tabName":"Corrected","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":4,"headerRow":1,"headerSignature":"too-short","selectedTabs":["Corrected"]}}'
  )$$,
  '22023',
  'CSF source setting "headerSignature" must be a lowercase SHA-256 digest.',
  'the registry rejects an unbounded or malformed header signature'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    'f8200000-0000-4000-8000-000000000001',
    'student_roster',
    '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","firstName":"First"},"tabMappings":[{"tabName":"Corrected","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":4,"headerRow":1,"headerSignature":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","selectedTabs":["Corrected"]}}'
  )$$,
  'the first bounded header snapshot receives the next version'
);

SELECT extensions.ok(
  (
    SELECT settings ->> 'mappingVersion' = '4'
      AND settings ->> 'headerSignature' =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'f8200000-0000-4000-8000-000000000001'
  ),
  'the source stores the header digest as mapping identity'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    'f8200000-0000-4000-8000-000000000001',
    'student_roster',
    '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","firstName":"First"},"tabMappings":[{"tabName":"Corrected","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":4,"headerRow":1,"headerSignature":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","selectedTabs":["Corrected"]}}'
  )$$,
  'an exact header snapshot replay stays idempotent'
);

SELECT extensions.is(
  (
    SELECT settings ->> 'mappingVersion'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'f8200000-0000-4000-8000-000000000001'
  ),
  '4',
  'an exact header snapshot replay does not advance the version'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    'f8200000-0000-4000-8000-000000000001',
    'student_roster',
    '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","firstName":"First"},"tabMappings":[{"tabName":"Corrected","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":4,"headerRow":1,"headerSignature":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","selectedTabs":["Corrected"]}}'
  )$$,
  '40001',
  'This import source mapping changed after it was loaded. Reload it and try again.',
  'a second header snapshot cannot reuse the first snapshot version'
);

SELECT extensions.ok(
  (
    SELECT settings ->> 'mappingVersion' = '4'
      AND settings ->> 'headerSignature' =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'f8200000-0000-4000-8000-000000000001'
  ),
  'the stale header save leaves the winning header snapshot intact'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000001',
    'f8000000-0000-4000-8000-000000000001',
    'f8200000-0000-4000-8000-000000000001',
    'student_roster',
    '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","firstName":"First"},"tabMappings":[{"tabName":"Corrected","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":5,"headerRow":1,"headerSignature":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","selectedTabs":["Corrected"]}}'
  )$$,
  'a fresh request can store the second header snapshot at the next version'
);

SELECT extensions.ok(
  (
    SELECT settings ->> 'mappingVersion' = '5'
      AND settings ->> 'headerSignature' =
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'f8200000-0000-4000-8000-000000000001'
  ),
  'the fresh header snapshot receives its own mapping version'
);

CREATE OR REPLACE FUNCTION plugin_data.csf_test_mapping_serialization_write(
  p_registration jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'accepted',
    'receipt', plugin_data.csf_register_sheet_source(
      'f8100000-0000-4000-8000-000000000002',
      'f8000000-0000-4000-8000-000000000001',
      'f8200000-0000-4000-8000-000000000002',
      'student_roster',
      p_registration
    )
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'refused',
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    );
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_test_mapping_serialization_write(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pg_temp.csf_mapping_serialization_dsn()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'hostaddr=' || host(inet_server_addr()) ||
    ' port=' || current_setting('port') ||
    ' dbname=' || current_database() ||
    ' user=' || current_user ||
    ' password=' || current_user ||
    ' sslmode=disable'
$$;

CREATE FUNCTION pg_temp.wait_for_csf_mapping_writer(p_connection text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_complete boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '10 seconds';
BEGIN
  LOOP
    v_complete := extensions.dblink_is_busy(p_connection) = 0;
    EXIT WHEN v_complete OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  RETURN v_complete;
END;
$$;

SELECT extensions.dblink_connect(
  'csf_mapping_writer_a',
  pg_temp.csf_mapping_serialization_dsn()
);
SELECT extensions.dblink_connect(
  'csf_mapping_writer_b',
  pg_temp.csf_mapping_serialization_dsn()
);

BEGIN;
SELECT 1
FROM plugin_data.csf_sheet_sources
WHERE id = 'f8200000-0000-4000-8000-000000000002'
FOR UPDATE;

SELECT extensions.dblink_send_query(
  'csf_mapping_writer_a',
  $query$
    SELECT plugin_data.csf_test_mapping_serialization_write(
      '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","firstName":"First"},"tabMappings":[{"tabName":"Concurrent A","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":2,"headerRow":1,"selectedTabs":["Concurrent A"]}}'
    )::text
  $query$
);
SELECT extensions.dblink_send_query(
  'csf_mapping_writer_b',
  $query$
    SELECT plugin_data.csf_test_mapping_serialization_write(
      '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","lastName":"Last"},"tabMappings":[{"tabName":"Concurrent B","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":2,"headerRow":1,"selectedTabs":["Concurrent B"]}}'
    )::text
  $query$
);

SELECT extensions.ok(
  extensions.dblink_is_busy('csf_mapping_writer_a') = 1
    AND extensions.dblink_is_busy('csf_mapping_writer_b') = 1,
  'both stale writers wait on the same source row'
);
COMMIT;

SELECT extensions.ok(
  pg_temp.wait_for_csf_mapping_writer('csf_mapping_writer_a')
    AND pg_temp.wait_for_csf_mapping_writer('csf_mapping_writer_b'),
  'both concurrent mapping saves settle after the source lock is released'
);

CREATE TEMP TABLE csf_mapping_writer_results (
  writer text PRIMARY KEY,
  payload text NOT NULL
) ON COMMIT PRESERVE ROWS;

INSERT INTO csf_mapping_writer_results (writer, payload)
SELECT 'a', payload
FROM extensions.dblink_get_result('csf_mapping_writer_a', false)
  AS result(payload text);
INSERT INTO csf_mapping_writer_results (writer, payload)
SELECT 'b', payload
FROM extensions.dblink_get_result('csf_mapping_writer_b', false)
  AS result(payload text);

SELECT extensions.ok(
  (
    SELECT pg_catalog.count(*) = 1
    FROM csf_mapping_writer_results
    WHERE payload::jsonb ->> 'outcome' = 'accepted'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM csf_mapping_writer_results
    WHERE payload::jsonb ->> 'outcome' = 'refused'
      AND payload::jsonb ->> 'sqlstate' = '40001'
      AND payload::jsonb ->> 'message' =
        'This import source mapping changed after it was loaded. Reload it and try again.'
  ),
  'one stale writer commits and the other receives the closed stale-mapping refusal'
);

SELECT extensions.ok(
  (
    SELECT settings ->> 'mappingVersion' = '2'
      AND tab_mappings #>> '{0,tabName}' IN ('Concurrent A', 'Concurrent B')
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'f8200000-0000-4000-8000-000000000002'
  ),
  'the winning stale-read request owns version two without a mixed payload'
);

CREATE TEMP TABLE csf_mapping_first_winner (
  tab_name text NOT NULL
) ON COMMIT PRESERVE ROWS;
INSERT INTO csf_mapping_first_winner (tab_name)
SELECT tab_mappings #>> '{0,tabName}'
FROM plugin_data.csf_sheet_sources
WHERE id = 'f8200000-0000-4000-8000-000000000002';

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
    'f8100000-0000-4000-8000-000000000002',
    'f8000000-0000-4000-8000-000000000001',
    'f8200000-0000-4000-8000-000000000002',
    'student_roster',
    CASE
      WHEN (
        SELECT tab_name FROM csf_mapping_first_winner
      ) = 'Concurrent A'
        THEN '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","lastName":"Last"},"tabMappings":[{"tabName":"Concurrent B","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":3,"headerRow":1,"selectedTabs":["Concurrent B"]}}'::jsonb
      ELSE '{"targetStrategy":"fixed","duplicatePolicy":"match_email_then_name","columnMappings":{"email":"Email","firstName":"First"},"tabMappings":[{"tabName":"Concurrent A","rangeA1":"A1:C","headerRow":1,"termCode":"F26","cohortYear":2027,"targetStrategy":"fixed","activityPointMode":"explicit_numeric"}],"settings":{"sourceKind":"student_roster","targetStrategy":"fixed","mappingVersion":3,"headerRow":1,"selectedTabs":["Concurrent A"]}}'::jsonb
    END
  )$$,
  'a fresh request for the losing mapping can advance from version two to three'
);

SELECT extensions.ok(
  (
    SELECT settings ->> 'mappingVersion' = '3'
      AND tab_mappings #>> '{0,tabName}' IS DISTINCT FROM (
        SELECT tab_name FROM csf_mapping_first_winner
      )
    FROM plugin_data.csf_sheet_sources
    WHERE id = 'f8200000-0000-4000-8000-000000000002'
  ),
  'the fresh losing mapping receives version three'
);

SELECT extensions.dblink_disconnect('csf_mapping_writer_a');
SELECT extensions.dblink_disconnect('csf_mapping_writer_b');

DROP FUNCTION plugin_data.csf_test_mapping_serialization_write(jsonb);

DELETE FROM public.organization_members
WHERE organization_id IN (
  'f8100000-0000-4000-8000-000000000001',
  'f8100000-0000-4000-8000-000000000002'
);
DELETE FROM public.organizations
WHERE id IN (
  'f8100000-0000-4000-8000-000000000001',
  'f8100000-0000-4000-8000-000000000002'
);
DELETE FROM auth.users
WHERE id = 'f8000000-0000-4000-8000-000000000001';

SELECT * FROM extensions.finish();
