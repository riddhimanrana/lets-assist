BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(44);

SELECT extensions.ok(
  to_regclass('plugin_data.csf_personal_calendar_destinations') IS NOT NULL
    AND to_regclass('plugin_data.csf_personal_calendar_destination_operations') IS NOT NULL,
  'personal calendar destination and provisioning receipt tables exist'
);
SELECT extensions.ok(
  (
    SELECT bool_and(class.relrowsecurity AND class.relforcerowsecurity)
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'plugin_data'
      AND class.relname IN (
        'csf_personal_calendar_destinations',
        'csf_personal_calendar_destination_operations'
      )
  ),
  'destination provisioning tables force row level security'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_policies
    WHERE schemaname = 'plugin_data'
      AND tablename IN (
        'csf_personal_calendar_destinations',
        'csf_personal_calendar_destination_operations'
      )
  ),
  0,
  'destination provisioning exposes no browser policy'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY['public', 'anon', 'authenticated']) AS client(role_name)
    CROSS JOIN unnest(ARRAY[
      'plugin_data.csf_personal_calendar_destinations',
      'plugin_data.csf_personal_calendar_destination_operations'
    ]) AS relation(name)
    WHERE has_table_privilege(client.role_name::name, relation.name, 'SELECT')
       OR has_table_privilege(client.role_name::name, relation.name, 'INSERT')
       OR has_table_privilege(client.role_name::name, relation.name, 'UPDATE')
       OR has_table_privilege(client.role_name::name, relation.name, 'DELETE')
  ),
  'browser roles have no destination provisioning table privilege'
);
SELECT extensions.ok(
  has_table_privilege(
    'service_role',
    'plugin_data.csf_personal_calendar_destinations',
    'SELECT,INSERT,UPDATE,DELETE'
  )
    AND has_table_privilege(
      'service_role',
      'plugin_data.csf_personal_calendar_destination_operations',
      'SELECT,INSERT,UPDATE,DELETE'
    ),
  'service role owns the narrow destination provisioning data boundary'
);
SELECT extensions.ok(
  to_regprocedure(
    'plugin_data.csf_begin_personal_calendar_destination_provision(uuid,uuid,uuid,text,boolean)'
  ) IS NOT NULL
    AND to_regprocedure(
      'plugin_data.csf_complete_personal_calendar_destination_provision(uuid,uuid,text,text,text)'
    ) IS NOT NULL,
  'destination begin and completion functions exist'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_begin_personal_calendar_destination_provision(uuid,uuid,uuid,text,boolean)',
      'plugin_data.csf_complete_personal_calendar_destination_provision(uuid,uuid,text,text,text)'
    ]) AS operation(signature)
    CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated']) AS client(role_name)
    WHERE has_function_privilege(client.role_name::name, operation.signature, 'EXECUTE')
  ),
  'browser roles cannot invoke destination provisioning functions'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_begin_personal_calendar_destination_provision(uuid,uuid,uuid,text,boolean)',
    'EXECUTE'
  )
    AND has_function_privilege(
      'service_role',
      'plugin_data.csf_complete_personal_calendar_destination_provision(uuid,uuid,text,text,text)',
      'EXECUTE'
    ),
  'service role can invoke destination provisioning functions'
);
SELECT extensions.ok(
  (
    SELECT bool_and(proc.prosecdef AND proc.proconfig @> ARRAY['search_path=""']::text[])
    FROM pg_proc AS proc
    WHERE proc.oid IN (
      'plugin_data.csf_begin_personal_calendar_destination_provision(uuid,uuid,uuid,text,boolean)'::regprocedure,
      'plugin_data.csf_complete_personal_calendar_destination_provision(uuid,uuid,text,text,text)'::regprocedure
    )
  ),
  'privileged destination functions pin an empty search path'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM private.plugin_data_user_scope_contracts
    WHERE schema_name = 'plugin_data'
      AND table_name IN (
        'csf_personal_calendar_destinations',
        'csf_personal_calendar_destination_operations'
      )
  ),
  2,
  'both cross-organization personal calendar ledgers satisfy the validated direct-user-scope contract'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 3
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'plugin_data'
      AND constraint_row.conname IN (
        'csf_personal_cal_dest_ops_connection_user_fkey',
        'csf_personal_calendar_destinations_connection_user_fkey',
        'csf_personal_calendar_destinations_inflight_user_fkey'
      )
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%user_id%'
  ),
  'connection and in-flight destination references carry the user coordinate structurally'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('cb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'calendar-one@local.test', now(), '{}', '{}', now(), now()),
  ('cb000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'calendar-two@local.test', now(), '{}', '{}', now(), now()),
  ('cb000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'calendar-unbound@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.user_calendar_connections (
  id, user_id, provider, access_token, refresh_token, token_expires_at,
  calendar_email, is_active, preferences, granted_scopes, connection_type
) VALUES
  (
    'cb100000-0000-4000-8000-000000000001',
    'cb000000-0000-4000-8000-000000000001',
    'google', 'encrypted-access-one', 'encrypted-refresh-one', now() + interval '1 hour',
    'calendar-one@local.test', true,
    '{"theme":"keep","volunteering_calendar_id":"client-spoof"}'::jsonb,
    'https://www.googleapis.com/auth/calendar.app.created', 'calendar'
  ),
  (
    'cb100000-0000-4000-8000-000000000002',
    'cb000000-0000-4000-8000-000000000002',
    'google', 'encrypted-access-two', 'encrypted-refresh-two', now() + interval '1 hour',
    'calendar-two@local.test', true,
    '{"theme":"keep"}'::jsonb,
    'https://www.googleapis.com/auth/calendar.app.created', 'calendar'
  ),
  (
    'cb100000-0000-4000-8000-000000000003',
    'cb000000-0000-4000-8000-000000000003',
    'google', 'encrypted-access-three', 'encrypted-refresh-three', now() + interval '1 hour',
    'calendar-unbound@local.test', true,
    '{"volunteering_calendar_id":"client-only-id"}'::jsonb,
    'https://www.googleapis.com/auth/calendar.app.created', 'calendar'
  );

INSERT INTO public.user_google_oauth_connection_bindings (
  connection_id, user_id, provider, purpose
) VALUES
  ('cb100000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'google', 'personal_calendar'),
  ('cb100000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000002', 'google', 'personal_calendar');

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_begin_personal_calendar_destination_provision(
    'cb000000-0000-4000-8000-000000000003',
    'cb100000-0000-4000-8000-000000000003',
    'cb200000-0000-4000-8000-000000000001',
    NULL
  )$$,
  'P0001',
  'That personal Google Calendar connection is not available to this account.',
  'client-editable preferences cannot replace an exact OAuth purpose binding'
);

CREATE TEMP TABLE destination_claim_results (
  label text PRIMARY KEY,
  payload jsonb NOT NULL
);

INSERT INTO destination_claim_results (label, payload)
SELECT 'user-one-first', plugin_data.csf_begin_personal_calendar_destination_provision(
  'cb000000-0000-4000-8000-000000000001',
  'cb100000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000002',
  NULL
);

SELECT extensions.is(
  (SELECT payload ->> 'shouldCallProvider' FROM destination_claim_results WHERE label = 'user-one-first'),
  'true',
  'the first durable claim authorizes exactly one provider attempt'
);
SELECT extensions.is(
  (
    SELECT state || ':' || coalesce(calendar_id, 'null')
    FROM plugin_data.csf_personal_calendar_destinations
    WHERE user_id = 'cb000000-0000-4000-8000-000000000001'
  ),
  'provisioning:null',
  'the provider attempt is claimed before a calendar identity exists'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_personal_calendar_destination_operations
    WHERE user_id = 'cb000000-0000-4000-8000-000000000001'
  ),
  1,
  'the first claim has one durable provider-operation receipt'
);

INSERT INTO destination_claim_results (label, payload)
SELECT 'user-one-exact-replay', plugin_data.csf_begin_personal_calendar_destination_provision(
  'cb000000-0000-4000-8000-000000000001',
  'cb100000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000002',
  NULL
);
SELECT extensions.is(
  (
    SELECT (payload ->> 'shouldCallProvider') || ':' || (payload ->> 'idempotent')
    FROM destination_claim_results
    WHERE label = 'user-one-exact-replay'
  ),
  'false:true',
  'an exact stable-request replay cannot call the provider twice'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_personal_calendar_destination_operations
    WHERE user_id = 'cb000000-0000-4000-8000-000000000001'
  ),
  1,
  'an exact replay cannot duplicate its provider-operation receipt'
);

INSERT INTO destination_claim_results (label, payload)
SELECT 'user-one-concurrent-request', plugin_data.csf_begin_personal_calendar_destination_provision(
  'cb000000-0000-4000-8000-000000000001',
  'cb100000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000003',
  NULL
);
SELECT extensions.is(
  (
    SELECT (payload ->> 'destinationState') || ':' || (payload ->> 'shouldCallProvider')
    FROM destination_claim_results
    WHERE label = 'user-one-concurrent-request'
  ),
  'provisioning:false',
  'a concurrent first-item request observes the existing claim without another provider attempt'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_personal_calendar_destination_operations
    WHERE user_id = 'cb000000-0000-4000-8000-000000000001'
  ),
  1,
  'a request suppressed by in-flight provisioning does not create a misleading receipt'
);

INSERT INTO destination_claim_results (label, payload)
SELECT 'user-one-read-only-in-flight', plugin_data.csf_begin_personal_calendar_destination_provision(
  'cb000000-0000-4000-8000-000000000001',
  'cb100000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000010',
  NULL,
  false
);
SELECT extensions.is(
  (
    SELECT (payload ->> 'destinationState') || ':' || (payload ->> 'shouldCallProvider')
    FROM destination_claim_results
    WHERE label = 'user-one-read-only-in-flight'
  ),
  'provisioning:false',
  'a read-only removal or status check observes active provisioning without create authority'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_personal_calendar_destination_operations
    WHERE user_id = 'cb000000-0000-4000-8000-000000000001'
  ),
  1,
  'a read-only status check never reserves a provider-operation receipt'
);

UPDATE plugin_data.csf_personal_calendar_destination_operations
SET started_at = now() - interval '6 minutes'
WHERE user_id = 'cb000000-0000-4000-8000-000000000001';

INSERT INTO destination_claim_results (label, payload)
SELECT 'user-one-read-only-stale', plugin_data.csf_begin_personal_calendar_destination_provision(
  'cb000000-0000-4000-8000-000000000001',
  'cb100000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000011',
  NULL,
  false
);
SELECT extensions.is(
  (
    SELECT (payload ->> 'destinationState') || ':' || (payload ->> 'shouldCallProvider')
    FROM destination_claim_results
    WHERE label = 'user-one-read-only-stale'
  ),
  'unknown_outcome:false',
  'a read-only check settles stale provisioning to unknown without creating a calendar'
);
SELECT extensions.is(
  (
    SELECT state || ':' || outcome_code
    FROM plugin_data.csf_personal_calendar_destination_operations
    WHERE user_id = 'cb000000-0000-4000-8000-000000000001'
  ),
  'unknown_outcome:process_interrupted',
  'read-only stale settlement durably closes the abandoned provider receipt'
);

INSERT INTO destination_claim_results (label, payload)
SELECT 'user-one-stale-exact-replay', plugin_data.csf_begin_personal_calendar_destination_provision(
  'cb000000-0000-4000-8000-000000000001',
  'cb100000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000002',
  NULL
);
SELECT extensions.is(
  (
    SELECT (payload ->> 'operationState') || ':' || (payload ->> 'destinationState')
    FROM destination_claim_results
    WHERE label = 'user-one-stale-exact-replay'
  ),
  'unknown_outcome:unknown_outcome',
  'a stale exact replay settles to unknown instead of provisioning forever'
);
SELECT extensions.is(
  (
    SELECT state || ':' || last_outcome_code || ':' || coalesce(inflight_operation_id::text, 'null')
    FROM plugin_data.csf_personal_calendar_destinations
    WHERE user_id = 'cb000000-0000-4000-8000-000000000001'
  ),
  'unknown_outcome:process_interrupted:null',
  'an interrupted process is durably ambiguous and clears the in-flight pointer'
);

INSERT INTO destination_claim_results (label, payload)
SELECT 'user-one-after-unknown', plugin_data.csf_begin_personal_calendar_destination_provision(
  'cb000000-0000-4000-8000-000000000001',
  'cb100000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000004',
  NULL
);
SELECT extensions.is(
  (
    SELECT (payload ->> 'destinationState') || ':' || (payload ->> 'shouldCallProvider')
    FROM destination_claim_results
    WHERE label = 'user-one-after-unknown'
  ),
  'unknown_outcome:false',
  'an ambiguous calendar creation blocks every future automatic create'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_personal_calendar_destination_operations
    WHERE user_id = 'cb000000-0000-4000-8000-000000000001'
  ),
  1,
  'blocked unknown outcomes do not create retry receipts'
);

INSERT INTO destination_claim_results (label, payload)
SELECT 'user-two-first', plugin_data.csf_begin_personal_calendar_destination_provision(
  'cb000000-0000-4000-8000-000000000002',
  'cb100000-0000-4000-8000-000000000002',
  'cb200000-0000-4000-8000-000000000005',
  NULL
);
SELECT extensions.is(
  (SELECT payload ->> 'shouldCallProvider' FROM destination_claim_results WHERE label = 'user-two-first'),
  'true',
  'a different user receives an independent provisioning claim'
);

UPDATE public.user_calendar_connections
SET preferences = preferences || '{"locale":"en-US"}'::jsonb
WHERE id = 'cb100000-0000-4000-8000-000000000002';

INSERT INTO destination_claim_results (label, payload)
SELECT 'user-two-confirmed', plugin_data.csf_complete_personal_calendar_destination_provision(
  (SELECT (payload ->> 'operationId')::uuid FROM destination_claim_results WHERE label = 'user-two-first'),
  'cb000000-0000-4000-8000-000000000002',
  'confirmed',
  'provider-calendar-one',
  NULL
);
SELECT extensions.is(
  (
    SELECT state || ':' || calendar_id
    FROM plugin_data.csf_personal_calendar_destinations
    WHERE user_id = 'cb000000-0000-4000-8000-000000000002'
  ),
  'ready:provider-calendar-one',
  'a confirmed provider identity becomes authoritative destination state'
);
SELECT extensions.is(
  (
    SELECT preferences ->> 'volunteering_calendar_id'
    FROM public.user_calendar_connections
    WHERE id = 'cb100000-0000-4000-8000-000000000002'
  ),
  'provider-calendar-one',
  'the compatibility preference mirrors the confirmed server-owned destination'
);
SELECT extensions.is(
  (
    SELECT (preferences ->> 'theme') || ':' || (preferences ->> 'locale')
    FROM public.user_calendar_connections
    WHERE id = 'cb100000-0000-4000-8000-000000000002'
  ),
  'keep:en-US',
  'the database-side preference merge preserves concurrent unrelated settings'
);

INSERT INTO destination_claim_results (label, payload)
SELECT 'user-two-confirmed-replay', plugin_data.csf_complete_personal_calendar_destination_provision(
  (SELECT (payload ->> 'operationId')::uuid FROM destination_claim_results WHERE label = 'user-two-first'),
  'cb000000-0000-4000-8000-000000000002',
  'confirmed',
  'provider-calendar-one',
  NULL
);
SELECT extensions.is(
  (SELECT payload ->> 'idempotent' FROM destination_claim_results WHERE label = 'user-two-confirmed-replay'),
  'true',
  'an exact provider completion replay is idempotent'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_complete_personal_calendar_destination_provision(
    (
      SELECT (payload ->> 'operationId')::uuid
      FROM destination_claim_results
      WHERE label = 'user-two-first'
    ),
    'cb000000-0000-4000-8000-000000000002',
    'confirmed',
    'different-provider-calendar',
    NULL
  )$$,
  'P0001',
  'That personal calendar destination operation already has a different outcome.',
  'an operation receipt cannot be rewritten to a different provider identity'
);

INSERT INTO destination_claim_results (label, payload)
SELECT 'user-two-ready', plugin_data.csf_begin_personal_calendar_destination_provision(
  'cb000000-0000-4000-8000-000000000002',
  'cb100000-0000-4000-8000-000000000002',
  'cb200000-0000-4000-8000-000000000006',
  NULL
);
SELECT extensions.is(
  (
    SELECT (payload ->> 'calendarId') || ':' || (payload ->> 'shouldCallProvider')
    FROM destination_claim_results
    WHERE label = 'user-two-ready'
  ),
  'provider-calendar-one:false',
  'later event requests reuse the confirmed destination without a provider create'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_personal_calendar_destination_operations
    WHERE user_id = 'cb000000-0000-4000-8000-000000000002'
  ),
  1,
  'reusing a ready destination does not create a provisioning receipt'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_begin_personal_calendar_destination_provision(
    'cb000000-0000-4000-8000-000000000002',
    'cb100000-0000-4000-8000-000000000002',
    'cb200000-0000-4000-8000-000000000007',
    'wrong-calendar-id'
  )$$,
  'P0001',
  'The personal calendar replacement no longer matches the confirmed destination.',
  'replacement requires the exact calendar identity whose lookup confirmed 404'
);

INSERT INTO destination_claim_results (label, payload)
SELECT 'user-two-replacement', plugin_data.csf_begin_personal_calendar_destination_provision(
  'cb000000-0000-4000-8000-000000000002',
  'cb100000-0000-4000-8000-000000000002',
  'cb200000-0000-4000-8000-000000000008',
  'provider-calendar-one'
);
SELECT extensions.is(
  (SELECT payload ->> 'shouldCallProvider' FROM destination_claim_results WHERE label = 'user-two-replacement'),
  'true',
  'a confirmed missing destination can reserve one replacement provider attempt'
);
SELECT extensions.is(
  (
    SELECT state || ':' || coalesce(calendar_id, 'null') || ':'
      || coalesce(inflight_operation_id::text, 'null')
    FROM plugin_data.csf_personal_calendar_destinations
    WHERE user_id = 'cb000000-0000-4000-8000-000000000002'
  ),
  (
    SELECT 'provisioning:null:' || (payload ->> 'operationId')
    FROM destination_claim_results
    WHERE label = 'user-two-replacement'
  ),
  'replacement clears the confirmed-missing identity and records its in-flight receipt'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_complete_personal_calendar_destination_provision(
    (
      SELECT (payload ->> 'operationId')::uuid
      FROM destination_claim_results
      WHERE label = 'user-two-replacement'
    ),
    'cb000000-0000-4000-8000-000000000002',
    'unknown_outcome',
    NULL,
    'malformed_response'
  )$$,
  'a malformed success response is durably completed as ambiguous'
);
SELECT extensions.is(
  (
    SELECT state || ':' || last_outcome_code || ':' || coalesce(calendar_id, 'null')
    FROM plugin_data.csf_personal_calendar_destinations
    WHERE user_id = 'cb000000-0000-4000-8000-000000000002'
  ),
  'unknown_outcome:malformed_response:null',
  'ambiguous replacement state retains no guessed provider identity'
);

INSERT INTO destination_claim_results (label, payload)
SELECT 'user-two-after-unknown', plugin_data.csf_begin_personal_calendar_destination_provision(
  'cb000000-0000-4000-8000-000000000002',
  'cb100000-0000-4000-8000-000000000002',
  'cb200000-0000-4000-8000-000000000009',
  NULL
);
SELECT extensions.is(
  (SELECT payload ->> 'shouldCallProvider' FROM destination_claim_results WHERE label = 'user-two-after-unknown'),
  'false',
  'an ambiguous replacement also blocks future automatic creates'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_personal_calendar_destination_operations
    WHERE user_id = 'cb000000-0000-4000-8000-000000000002'
  ),
  2,
  'blocked replacement retries do not add another provider-operation receipt'
);

DELETE FROM public.user_calendar_connections
WHERE id = 'cb100000-0000-4000-8000-000000000002';
SELECT extensions.is(
  (
    SELECT state || ':' || coalesce(connection_id::text, 'null')
    FROM plugin_data.csf_personal_calendar_destinations
    WHERE user_id = 'cb000000-0000-4000-8000-000000000002'
  ),
  'unknown_outcome:null',
  'disconnecting OAuth cannot erase an unresolved provider outcome'
);

ALTER TABLE plugin_data.csf_personal_calendar_destination_operations
  ALTER COLUMN user_id DROP NOT NULL;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM private.plugin_data_user_scope_contracts
    WHERE schema_name = 'plugin_data'
      AND table_name = 'csf_personal_calendar_destination_operations'
  ),
  0,
  'a known table name cannot bypass the user-scope audit when its non-null ownership contract is weakened'
);

SELECT * FROM extensions.finish();
ROLLBACK;
