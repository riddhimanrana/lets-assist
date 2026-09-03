BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(16);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'f7000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'mapping-fence-officer@local.test', now(),
  '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'f7100000-0000-4000-8000-000000000001',
  'Mapping Fence Fixtures', 'mapping-fence-fixtures', 'school', '997201'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'f7100000-0000-4000-8000-000000000001',
  'f7000000-0000-4000-8000-000000000001',
  'admin', 'active'
);

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, provider, spreadsheet_id,
  drive_file_id, sync_status, settings
) VALUES
  (
    'f7200000-0000-4000-8000-000000000001',
    'f7100000-0000-4000-8000-000000000001',
    'student_roster', 'Stale mapping source', 'google_sheets',
    'mapping-fence-stale', 'mapping-fence-stale', 'not_synced',
    '{"sourceKind":"student_roster","mappingVersion":2}'
  ),
  (
    'f7200000-0000-4000-8000-000000000002',
    'f7100000-0000-4000-8000-000000000001',
    'student_roster', 'Legacy mapping source', 'google_sheets',
    'mapping-fence-legacy', 'mapping-fence-legacy', 'not_synced',
    '{"sourceKind":"student_roster"}'
  ),
  (
    'f7200000-0000-4000-8000-000000000003',
    'f7100000-0000-4000-8000-000000000001',
    'student_roster', 'Malformed mapping source', 'google_sheets',
    'mapping-fence-malformed', 'mapping-fence-malformed', 'not_synced',
    '{"sourceKind":"student_roster","mappingVersion":"2"}'
  );

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  mapping_version
) VALUES
  (
    'f7300000-0000-4000-8000-000000000001',
    'f7100000-0000-4000-8000-000000000001',
    'f7200000-0000-4000-8000-000000000001',
    'f7000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'student_roster', 1
  ),
  (
    'f7300000-0000-4000-8000-000000000002',
    'f7100000-0000-4000-8000-000000000001',
    'f7200000-0000-4000-8000-000000000001',
    'f7000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'student_roster', 2
  ),
  (
    'f7300000-0000-4000-8000-000000000003',
    'f7100000-0000-4000-8000-000000000001',
    'f7200000-0000-4000-8000-000000000002',
    'f7000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'student_roster', 1
  ),
  (
    'f7300000-0000-4000-8000-000000000004',
    'f7100000-0000-4000-8000-000000000001',
    'f7200000-0000-4000-8000-000000000003',
    'f7000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'student_roster', 2
  );

SELECT extensions.ok(
  to_regprocedure(
    'plugin_data.csf_assert_import_preview_mapping_current(uuid,uuid)'
  ) IS NOT NULL,
  'the database owns one current-mapping assertion'
);

SELECT extensions.ok(
  (
    SELECT routine.prosecdef
      AND routine.proconfig @> ARRAY['search_path=""']
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid =
      'plugin_data.csf_assert_import_preview_mapping_current(uuid,uuid)'::regprocedure
  ),
  'the mapping assertion is security definer with an empty search path'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_assert_import_preview_mapping_current(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_assert_import_preview_mapping_current(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_assert_import_preview_mapping_current(uuid,uuid)',
    'EXECUTE'
  ),
  'the mapping assertion remains owner-internal'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'plugin_data.csf_queue_import_preview_batch_unserialized(uuid,uuid,uuid[],uuid)'::regprocedure
    )),
    'perform plugin_data.csf_assert_import_preview_mapping_current('
  ) > 0
  AND pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'plugin_data.csf_queue_import_preview_batch_unserialized(uuid,uuid,uuid[],uuid)'::regprocedure
    )),
    'perform plugin_data.csf_assert_import_preview_mapping_current('
  ) < pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'plugin_data.csf_queue_import_preview_batch_unserialized(uuid,uuid,uuid[],uuid)'::regprocedure
    )),
    'v_readiness := plugin_data.csf_import_preview_readiness('
  ),
  'batch approval checks each current mapping before it reads readiness'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'plugin_data.csf_queue_import_preview_batch_unserialized(uuid,uuid,uuid[],uuid)'::regprocedure
    )),
    'when sqlstate ''42501'' then'
  ) > 0
  AND pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'plugin_data.csf_queue_import_preview_batch_unserialized(uuid,uuid,uuid[],uuid)'::regprocedure
    )),
    'when others'
  ) = 0,
  'batch approval classifies only an authorization refusal and propagates unexpected database errors'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)'::regprocedure
    )),
    'select * into v_batch'
  ) > 0
  AND pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)'::regprocedure
    )),
    'select * into v_batch'
  ) < pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)'::regprocedure
    )),
    'return plugin_data.csf_queue_import_preview_batch_unserialized('
  )
  AND pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)'::regprocedure
    )),
    'csf_assert_import_preview_mapping_current'
  ) = 0,
  'a bound durable batch receipt replays before fresh validation delegates to the owner-only base'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'plugin_data.csf_claim_import_commit_attempt(uuid,uuid,uuid,integer,uuid)'::regprocedure
    )),
    'perform plugin_data.csf_assert_import_preview_mapping_current('
  ) > 0
  AND pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'plugin_data.csf_claim_import_commit_attempt(uuid,uuid,uuid,integer,uuid)'::regprocedure
    )),
    'perform plugin_data.csf_assert_import_preview_mapping_current('
  ) < pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'plugin_data.csf_claim_import_commit_attempt(uuid,uuid,uuid,integer,uuid)'::regprocedure
    )),
    'return plugin_data.csf_claim_import_commit_attempt_identity_base('
  ),
  'the final commit claim rechecks the current mapping before evidence is consumed'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_assert_import_preview_mapping_current(
    'f7100000-0000-4000-8000-000000000001',
    'f7300000-0000-4000-8000-000000000002'
  )$$,
  'an exact current mapping version passes'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_assert_import_preview_mapping_current(
    'f7100000-0000-4000-8000-000000000001',
    'f7300000-0000-4000-8000-000000000003'
  )$$,
  'a legacy source without the key keeps the version-one compatibility default'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_preview_mapping_current(
    'f7100000-0000-4000-8000-000000000001',
    'f7300000-0000-4000-8000-000000000004'
  )$$,
  '23514',
  'This import source has no valid mapping version. Save its mapping again.',
  'a non-numeric source mapping version fails with bounded text'
);

CREATE TEMP TABLE mapping_fence_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

INSERT INTO mapping_fence_state
SELECT 'first', plugin_data.csf_queue_import_preview_batch(
    'f7100000-0000-4000-8000-000000000001',
    'f7000000-0000-4000-8000-000000000001',
    ARRAY[
      'f7300000-0000-4000-8000-000000000001',
      'f7300000-0000-4000-8000-000000000002',
      'f7300000-0000-4000-8000-000000000004'
    ]::uuid[],
    'f7400000-0000-4000-8000-000000000001'
  );

SELECT extensions.ok(
  (SELECT value ->> 'queued' FROM mapping_fence_state WHERE key = 'first') = '1'
  AND (SELECT value ->> 'stale' FROM mapping_fence_state WHERE key = 'first') = '2'
  AND (SELECT value ->> 'blocked' FROM mapping_fence_state WHERE key = 'first') = '0'
  AND (SELECT value ->> 'replayed' FROM mapping_fence_state WHERE key = 'first') = 'false',
  'a mixed batch queues the current preview and marks only stale mappings stale'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM plugin_data.csf_import_approval_batches AS batch
    WHERE batch.organization_id = 'f7100000-0000-4000-8000-000000000001'
  ),
  1,
  'mixed approval creates one durable batch receipt'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM plugin_data.csf_import_approval_batch_items AS item
    WHERE item.organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND item.state = 'stale'
      AND item.reason_code = 'source_mapping_changed'
  ),
  2,
  'each changed or malformed mapping gets a bounded stale receipt'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM plugin_data.csf_import_commit_queue AS queue
    WHERE queue.organization_id = 'f7100000-0000-4000-8000-000000000001'
      AND queue.preview_job_id = 'f7300000-0000-4000-8000-000000000002'
  ),
  1,
  'only the preview under the current mapping enters the commit queue'
);

UPDATE plugin_data.csf_sheet_sources
SET settings = pg_catalog.jsonb_set(settings, '{mappingVersion}', '3'::jsonb)
WHERE id = 'f7200000-0000-4000-8000-000000000001'
  AND organization_id = 'f7100000-0000-4000-8000-000000000001';

INSERT INTO mapping_fence_state
SELECT 'replay', plugin_data.csf_queue_import_preview_batch(
    'f7100000-0000-4000-8000-000000000001',
    'f7000000-0000-4000-8000-000000000001',
    ARRAY[
      'f7300000-0000-4000-8000-000000000001',
      'f7300000-0000-4000-8000-000000000002',
      'f7300000-0000-4000-8000-000000000004'
    ]::uuid[],
    'f7400000-0000-4000-8000-000000000001'
  );

SELECT extensions.ok(
  (SELECT value ->> 'queued' FROM mapping_fence_state WHERE key = 'replay') = '1'
  AND (SELECT value ->> 'stale' FROM mapping_fence_state WHERE key = 'replay') = '2'
  AND (SELECT value ->> 'replayed' FROM mapping_fence_state WHERE key = 'replay') = 'true',
  'an exact request ID replays its frozen receipt after later mapping drift'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_claim_import_commit_attempt(
    'f7100000-0000-4000-8000-000000000001',
    'f7300000-0000-4000-8000-000000000002',
    'f7000000-0000-4000-8000-000000000001',
    300,
    'f7500000-0000-4000-8000-000000000001'
  )$$,
  '55000',
  'This source mapping changed after the preview. Run a fresh preview.',
  'the final claim refuses mapping drift after an accepted batch receipt'
);

SELECT * FROM extensions.finish();
ROLLBACK;
