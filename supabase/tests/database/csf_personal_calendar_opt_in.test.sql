BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(42);

SELECT extensions.ok(
  to_regclass('plugin_data.csf_personal_calendar_bindings') IS NOT NULL
    AND to_regclass('plugin_data.csf_personal_calendar_operations') IS NOT NULL,
  'personal calendar binding and operation tables exist'
);
SELECT extensions.ok(
  (
    SELECT bool_and(class.relrowsecurity AND class.relforcerowsecurity)
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'plugin_data'
      AND class.relname IN ('csf_personal_calendar_bindings', 'csf_personal_calendar_operations')
  ),
  'personal calendar tables force row level security'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_policies
    WHERE schemaname = 'plugin_data'
      AND tablename IN ('csf_personal_calendar_bindings', 'csf_personal_calendar_operations')
  ),
  0,
  'server-only calendar tables expose no browser policy'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY['public', 'anon', 'authenticated']) AS client(role_name)
    CROSS JOIN unnest(ARRAY[
      'plugin_data.csf_personal_calendar_bindings',
      'plugin_data.csf_personal_calendar_operations'
    ]) AS relation(name)
    WHERE has_table_privilege(client.role_name::name, relation.name, 'SELECT')
       OR has_table_privilege(client.role_name::name, relation.name, 'INSERT')
       OR has_table_privilege(client.role_name::name, relation.name, 'UPDATE')
       OR has_table_privilege(client.role_name::name, relation.name, 'DELETE')
  ),
  'browser roles have no personal calendar table privilege'
);
SELECT extensions.ok(
  has_table_privilege('service_role', 'plugin_data.csf_personal_calendar_bindings', 'SELECT,INSERT,UPDATE,DELETE')
    AND has_table_privilege('service_role', 'plugin_data.csf_personal_calendar_operations', 'SELECT,INSERT,UPDATE,DELETE'),
  'service role owns the narrow personal calendar data boundary'
);
SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_begin_personal_calendar_operation(uuid,uuid,text,uuid,text,text,uuid,text,text)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_complete_personal_calendar_operation(uuid,uuid,text,text,text,text)') IS NOT NULL,
  'personal calendar begin and completion functions exist'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_begin_personal_calendar_operation(uuid,uuid,text,uuid,text,text,uuid,text,text)',
      'plugin_data.csf_complete_personal_calendar_operation(uuid,uuid,text,text,text,text)'
    ]) AS operation(signature)
    CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated']) AS client(role_name)
    WHERE has_function_privilege(client.role_name::name, operation.signature, 'EXECUTE')
  ),
  'browser roles cannot invoke personal calendar mutations'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_begin_personal_calendar_operation(uuid,uuid,text,uuid,text,text,uuid,text,text)',
    'EXECUTE'
  )
    AND has_function_privilege(
      'service_role',
      'plugin_data.csf_complete_personal_calendar_operation(uuid,uuid,text,text,text,text)',
      'EXECUTE'
    ),
  'service role can invoke the personal calendar mutations'
);
SELECT extensions.ok(
  (
    SELECT bool_and(proc.prosecdef AND proc.proconfig @> ARRAY['search_path=""']::text[])
    FROM pg_proc AS proc
    WHERE proc.oid IN (
      'plugin_data.csf_begin_personal_calendar_operation(uuid,uuid,text,uuid,text,text,uuid,text,text)'::regprocedure,
      'plugin_data.csf_complete_personal_calendar_operation(uuid,uuid,text,text,text,text)'::regprocedure
    )
  ),
  'privileged personal calendar functions pin an empty search path'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ca000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'member@local.test', now(), '{}', '{}', now(), now()),
  ('ca000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'applicant@local.test', now(), '{}', '{}', now(), now()),
  ('ca000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'unverified-link@local.test', now(), '{}', '{}', now(), now()),
  ('ca000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'other@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('ca100000-0000-4000-8000-000000000001', 'Calendar CSF One', 'calendar-csf-one', 'school', '994101'),
  ('ca100000-0000-4000-8000-000000000002', 'Calendar CSF Two', 'calendar-csf-two', 'school', '994102');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, lifecycle_status, is_current
) VALUES
  ('ca200000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'F38', 'Fall 2038', '2038-2039', 'fall', 'open', true),
  ('ca200000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000002', 'F38', 'Fall 2038', '2038-2039', 'fall', 'open', true);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES
  ('ca300000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 2040, 'Class of 2040'),
  ('ca300000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000002', 2040, 'Class of 2040');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('ca400000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'Member', 'Student', 'member', 'student'),
  ('ca400000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000001', 'Applicant', 'Student', 'applicant', 'student'),
  ('ca400000-0000-4000-8000-000000000003', 'ca100000-0000-4000-8000-000000000001', 'Pending', 'Link', 'pending', 'link'),
  ('ca400000-0000-4000-8000-000000000004', 'ca100000-0000-4000-8000-000000000002', 'Other', 'Student', 'other', 'student');

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES
  ('ca100000-0000-4000-8000-000000000001', 'ca400000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'verified', true),
  ('ca100000-0000-4000-8000-000000000001', 'ca400000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000002', 'verified', true),
  ('ca100000-0000-4000-8000-000000000001', 'ca400000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000003', 'pending', false),
  ('ca100000-0000-4000-8000-000000000002', 'ca400000-0000-4000-8000-000000000004', 'ca000000-0000-4000-8000-000000000004', 'verified', true);

INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, status
) VALUES
  ('ca100000-0000-4000-8000-000000000001', 'ca400000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000001', 'active'),
  ('ca100000-0000-4000-8000-000000000002', 'ca400000-0000-4000-8000-000000000004', 'ca200000-0000-4000-8000-000000000002', 'ca300000-0000-4000-8000-000000000002', 'active');

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, status,
  submission_status, eligibility_status, decision_status
) VALUES (
  'ca500000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000002',
  'ca300000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'submitted', 'ready', 'pending', 'pending'
);

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, title, body, starts_at, ends_at, status
) VALUES
  ('ca600000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'Food Bank', 'Sort donations', '2038-09-01T16:00:00Z', '2038-09-01T18:00:00Z', 'published'),
  ('ca600000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000002', 'ca200000-0000-4000-8000-000000000002', 'Other Tenant', 'Private tenant source', '2038-09-01T16:00:00Z', '2038-09-01T18:00:00Z', 'published');

INSERT INTO plugin_data.csf_meetings (
  id, organization_id, term_id, meeting_key, label, status
) VALUES (
  'ca700000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'fall-kickoff', 'Fall kickoff', 'active'
);
INSERT INTO plugin_data.csf_meeting_sessions (
  id, organization_id, meeting_id, session_date, starts_at, status
) VALUES (
  'ca710000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'ca700000-0000-4000-8000-000000000001',
  '2038-09-03', '2038-09-03T16:00:00Z', 'scheduled'
);

INSERT INTO plugin_data.csf_term_deadlines (
  id, organization_id, term_id, deadline_type, title, due_at, status, audience
) VALUES
  ('ca800000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'application_close', 'Application closes', '2038-08-30T23:59:00Z', 'open', 'applicants'),
  ('ca800000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'points', 'Points due', '2038-12-01T23:59:00Z', 'planned', 'members');

SELECT extensions.ok(
  plugin_data.csf_personal_calendar_source_is_authorized(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001',
    'csf_opportunity', 'ca600000-0000-4000-8000-000000000001'
  ),
  'an active term member can add a published same-tenant opportunity'
);
SELECT extensions.ok(
  NOT plugin_data.csf_personal_calendar_source_is_authorized(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002',
    'csf_opportunity', 'ca600000-0000-4000-8000-000000000001'
  ),
  'an applicant cannot add a member opportunity'
);
SELECT extensions.ok(
  plugin_data.csf_personal_calendar_source_is_authorized(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002',
    'csf_deadline', 'ca800000-0000-4000-8000-000000000001'
  ),
  'an applicant can add an applicant deadline for the exact term'
);
SELECT extensions.ok(
  NOT plugin_data.csf_personal_calendar_source_is_authorized(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001',
    'csf_deadline', 'ca800000-0000-4000-8000-000000000001'
  ),
  'a member without an application cannot add an applicant-only deadline'
);
SELECT extensions.ok(
  plugin_data.csf_personal_calendar_source_is_authorized(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001',
    'csf_meeting_session', 'ca710000-0000-4000-8000-000000000001'
  ),
  'an active member can add an active scheduled meeting session'
);
SELECT extensions.ok(
  NOT plugin_data.csf_personal_calendar_source_is_authorized(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001',
    'csf_opportunity', 'ca600000-0000-4000-8000-000000000002'
  ),
  'a cross-tenant source never resolves under the caller organization'
);
SELECT extensions.ok(
  NOT plugin_data.csf_personal_calendar_source_is_authorized(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000003',
    'csf_opportunity', 'ca600000-0000-4000-8000-000000000001'
  ),
  'a pending profile link is not personal calendar authorization'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_begin_personal_calendar_operation(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002',
    'csf_opportunity', 'ca600000-0000-4000-8000-000000000001', 'primary', 'upsert',
    'ca900000-0000-4000-8000-000000000001', repeat('a', 64), 'csf' || repeat('b', 48)
  )$$,
  'P0001', 'That CSF calendar item is not available to this account.',
  'begin rechecks source eligibility even behind the service role'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_begin_personal_calendar_operation(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001',
    'csf_opportunity', 'ca600000-0000-4000-8000-000000000001', 'primary', 'upsert',
    'ca900000-0000-4000-8000-000000000002', repeat('a', 64), 'csf' || repeat('b', 48)
  )$$,
  'an authorized add reserves the durable binding and operation together'
);
SELECT extensions.is(
  (
    SELECT sync_state
    FROM plugin_data.csf_personal_calendar_bindings
    WHERE user_id = 'ca000000-0000-4000-8000-000000000001'
      AND source_id = 'ca600000-0000-4000-8000-000000000001'
  ),
  'pending_create',
  'new binding records the provider operation as pending create'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_personal_calendar_operations
    WHERE user_id = 'ca000000-0000-4000-8000-000000000001'
      AND request_id = 'ca900000-0000-4000-8000-000000000002'
  ),
  1,
  'the request id has one provider-operation receipt'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_begin_personal_calendar_operation(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001',
    'csf_opportunity', 'ca600000-0000-4000-8000-000000000001', 'primary', 'upsert',
    'ca900000-0000-4000-8000-000000000002', repeat('a', 64), 'csf' || repeat('b', 48)
  )$$,
  'an exact request replay returns its existing receipt'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_personal_calendar_operations
    WHERE user_id = 'ca000000-0000-4000-8000-000000000001'
      AND request_id = 'ca900000-0000-4000-8000-000000000002'
  ),
  1,
  'an exact request replay cannot duplicate the provider operation'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_begin_personal_calendar_operation(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001',
    'csf_opportunity', 'ca600000-0000-4000-8000-000000000001', 'primary', 'upsert',
    'ca900000-0000-4000-8000-000000000002', repeat('c', 64), 'csf' || repeat('b', 48)
  )$$,
  'P0001', 'That personal calendar request identifier is already bound to another operation.',
  'a request id cannot be reused with different content'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_complete_personal_calendar_operation(
    (
      SELECT id FROM plugin_data.csf_personal_calendar_operations
      WHERE request_id = 'ca900000-0000-4000-8000-000000000002'
    ),
    'ca000000-0000-4000-8000-000000000001', 'unknown_outcome',
    'internal-calendar-id', 'csf' || repeat('b', 48), 'network_error'
  )$$,
  'an ambiguous provider result is durably completed without retrying'
);
SELECT extensions.is(
  (
    SELECT sync_state
    FROM plugin_data.csf_personal_calendar_bindings
    WHERE user_id = 'ca000000-0000-4000-8000-000000000001'
      AND source_id = 'ca600000-0000-4000-8000-000000000001'
  ),
  'unknown_outcome',
  'unknown outcome remains visible on the binding'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_begin_personal_calendar_operation(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001',
    'csf_opportunity', 'ca600000-0000-4000-8000-000000000001', 'primary', 'upsert',
    'ca900000-0000-4000-8000-000000000003', repeat('c', 64), 'csf' || repeat('b', 48)
  )$$,
  'P0001', 'This calendar item needs a status check before another add or update.',
  'unknown outcome blocks automatic or user-triggered add replay'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_begin_personal_calendar_operation(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001',
    'csf_opportunity', 'ca600000-0000-4000-8000-000000000001', 'primary', 'reconcile',
    'ca900000-0000-4000-8000-000000000004', repeat('c', 64), 'csf' || repeat('b', 48)
  )$$,
  'explicit reconciliation reserves a lookup operation'
);
SELECT extensions.is(
  (
    SELECT provider_action || ':' || state
    FROM plugin_data.csf_personal_calendar_operations
    WHERE request_id = 'ca900000-0000-4000-8000-000000000004'
  ),
  'lookup:started',
  'reconciliation is a provider lookup, not an inferred retry'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_complete_personal_calendar_operation(
    (
      SELECT id FROM plugin_data.csf_personal_calendar_operations
      WHERE request_id = 'ca900000-0000-4000-8000-000000000004'
    ),
    'ca000000-0000-4000-8000-000000000001', 'confirmed',
    'internal-calendar-id', 'csf' || repeat('b', 48), NULL
  )$$,
  'a successful explicit reconciliation confirms the existing event'
);
SELECT extensions.is(
  (
    SELECT sync_state || ':' || confirmed_content_digest
    FROM plugin_data.csf_personal_calendar_bindings
    WHERE user_id = 'ca000000-0000-4000-8000-000000000001'
      AND source_id = 'ca600000-0000-4000-8000-000000000001'
  ),
  'synced:' || repeat('c', 64),
  'reconciliation promotes only its canonical content digest'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_begin_personal_calendar_operation(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001',
    'csf_opportunity', 'ca600000-0000-4000-8000-000000000001', 'primary', 'withdraw',
    'ca900000-0000-4000-8000-000000000005', NULL, 'csf' || repeat('b', 48)
  )$$,
  'withdrawal resolves the owned binding without a client provider id'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_complete_personal_calendar_operation(
    (
      SELECT id FROM plugin_data.csf_personal_calendar_operations
      WHERE request_id = 'ca900000-0000-4000-8000-000000000005'
    ),
    'ca000000-0000-4000-8000-000000000001', 'confirmed_deleted',
    'internal-calendar-id', 'csf' || repeat('d', 48), NULL
  )$$,
  'P0001', 'The provider result does not match the owned personal calendar event.',
  'completion rejects a mismatched remote event identity'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_complete_personal_calendar_operation(
    (
      SELECT id FROM plugin_data.csf_personal_calendar_operations
      WHERE request_id = 'ca900000-0000-4000-8000-000000000005'
    ),
    'ca000000-0000-4000-8000-000000000001', 'confirmed_deleted',
    'internal-calendar-id', 'csf' || repeat('b', 48), NULL
  )$$,
  'the server-owned binding accepts the matching confirmed deletion'
);
SELECT extensions.is(
  (
    SELECT sync_state || ':' || desired_state
    FROM plugin_data.csf_personal_calendar_bindings
    WHERE user_id = 'ca000000-0000-4000-8000-000000000001'
      AND source_id = 'ca600000-0000-4000-8000-000000000001'
  ),
  'removed:removed',
  'confirmed withdrawal records the removed desired and sync states'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_begin_personal_calendar_operation(
    'ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001',
    'csf_opportunity', 'ca600000-0000-4000-8000-000000000001', 'primary', 'withdraw',
    'ca900000-0000-4000-8000-000000000006', NULL, 'csf' || repeat('b', 48)
  )$$,
  'repeated withdrawal becomes an idempotent no-op receipt'
);
SELECT extensions.is(
  (
    SELECT provider_action || ':' || state
    FROM plugin_data.csf_personal_calendar_operations
    WHERE request_id = 'ca900000-0000-4000-8000-000000000006'
  ),
  'none:confirmed_deleted',
  'an already removed event never causes another provider deletion'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_personal_calendar_source_is_authorized(uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'browser roles cannot probe another account source eligibility'
);
SELECT extensions.ok(
  (
    SELECT count(*) = 1
    FROM plugin_data.csf_personal_calendar_bindings
    WHERE organization_id = 'ca100000-0000-4000-8000-000000000001'
      AND user_id = 'ca000000-0000-4000-8000-000000000001'
      AND source_kind = 'csf_opportunity'
      AND source_id = 'ca600000-0000-4000-8000-000000000001'
      AND occurrence_key = 'primary'
  ),
  'all lifecycle operations retain one exact user and source binding'
);
SELECT extensions.ok(
  (
    SELECT bool_and(operation.provider_event_id = binding.provider_event_id)
    FROM plugin_data.csf_personal_calendar_operations AS operation
    JOIN plugin_data.csf_personal_calendar_bindings AS binding
      ON binding.id = operation.binding_id
    WHERE binding.user_id = 'ca000000-0000-4000-8000-000000000001'
  ),
  'every operation remains bound to the server-derived event identity'
);
SELECT extensions.ok(
  (
    SELECT provider_calendar_id IS NULL
    FROM plugin_data.csf_personal_calendar_bindings
    WHERE user_id = 'ca000000-0000-4000-8000-000000000001'
      AND source_id = 'ca600000-0000-4000-8000-000000000001'
  ),
  'confirmed deletion clears the live provider calendar identity'
);
SELECT extensions.ok(
  (
    SELECT inflight_operation_id IS NULL
    FROM plugin_data.csf_personal_calendar_bindings
    WHERE user_id = 'ca000000-0000-4000-8000-000000000001'
      AND source_id = 'ca600000-0000-4000-8000-000000000001'
  ),
  'terminal completion clears the in-flight operation pointer'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_personal_calendar_operations
    WHERE user_id = 'ca000000-0000-4000-8000-000000000001'
  ),
  4,
  'the durable ledger contains create, reconcile, withdraw, and removed no-op receipts only'
);

SELECT * FROM extensions.finish();
ROLLBACK;
