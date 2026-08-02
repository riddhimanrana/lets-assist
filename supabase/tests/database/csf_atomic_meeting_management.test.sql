BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(40);

SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_upsert_term_meeting(uuid,uuid,uuid,text,date,timestamptz,text,text,boolean,integer,text,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_archive_term_meeting(uuid,uuid,uuid,uuid,uuid)') IS NOT NULL,
  'both atomic meeting-management operations exist'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_upsert_term_meeting(uuid,uuid,uuid,text,date,timestamptz,text,text,boolean,integer,text,uuid,uuid)',
      'plugin_data.csf_archive_term_meeting(uuid,uuid,uuid,uuid,uuid)'
    ]) AS operation(signature)
    CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated']) AS client(role_name)
    WHERE has_function_privilege(client.role_name::name, operation.signature, 'EXECUTE')
  ),
  'no client role can invoke meeting-management mutations'
);
SELECT extensions.ok(
  (
    SELECT bool_and(has_function_privilege('service_role', operation.signature, 'EXECUTE'))
    FROM unnest(ARRAY[
      'plugin_data.csf_upsert_term_meeting(uuid,uuid,uuid,text,date,timestamptz,text,text,boolean,integer,text,uuid,uuid)',
      'plugin_data.csf_archive_term_meeting(uuid,uuid,uuid,uuid,uuid)'
    ]) AS operation(signature)
  ),
  'service_role can invoke both atomic meeting-management operations'
);
SELECT extensions.ok(
  (
    SELECT bool_and(proc.prosecdef AND proc.proconfig @> ARRAY['search_path=""']::text[])
    FROM pg_proc AS proc
    WHERE proc.oid IN (
      'plugin_data.csf_upsert_term_meeting(uuid,uuid,uuid,text,date,timestamptz,text,text,boolean,integer,text,uuid,uuid)'::regprocedure,
      'plugin_data.csf_archive_term_meeting(uuid,uuid,uuid,uuid,uuid)'::regprocedure
    )
  ),
  'both privileged operations are SECURITY DEFINER with an empty search path'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_upsert_term_meeting(uuid,uuid,uuid,text,date,timestamptz,text,text,boolean,integer,text,uuid,uuid)'::regprocedure)
    LIKE '%csf_actor_has_permission%manage_meetings%'
  AND pg_get_functiondef('plugin_data.csf_archive_term_meeting(uuid,uuid,uuid,uuid,uuid)'::regprocedure)
    LIKE '%csf_actor_has_permission%manage_meetings%',
  'both operations recheck the exact database permission'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'meeting-admin@local.test', now(), '{}', '{}', now(), now()),
  ('fb000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'meeting-outsider@local.test', now(), '{}', '{}', now(), now()),
  ('fb000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'other-meeting-admin@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('fb100000-0000-4000-8000-000000000001', 'Atomic Meetings One', 'atomic-meetings-one', 'school', '993301'),
  ('fb100000-0000-4000-8000-000000000002', 'Atomic Meetings Two', 'atomic-meetings-two', 'school', '993302');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('fb100000-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-000000000003', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, lifecycle_status, is_current
) VALUES
  ('fb200000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'S39', 'Spring 2039', '2038-2039', 'spring', 'open', true),
  ('fb200000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000002', 'S39', 'Spring 2039', '2038-2039', 'spring', 'open', true);

INSERT INTO plugin_data.csf_term_meetings (
  id, organization_id, term_id, meeting_key, label, meeting_date, required, sort_order, status
) VALUES
  ('fb600000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'orphan-meeting', 'Orphan meeting', '2039-01-10', true, 90, 'active'),
  ('fb600000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000002', 'fb200000-0000-4000-8000-000000000002', 'other-tenant-meeting', 'Other tenant meeting', '2039-01-11', true, 1, 'active');
INSERT INTO plugin_data.csf_meetings (
  id, organization_id, term_id, meeting_key, label, required, sort_order, status
) VALUES (
  'fb610000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000002', 'fb200000-0000-4000-8000-000000000002', 'other-tenant-meeting', 'Other tenant meeting', true, 1, 'active'
);
INSERT INTO plugin_data.csf_meeting_sessions (
  id, organization_id, meeting_id, legacy_term_meeting_id, session_date, status
) VALUES (
  'fb620000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000002', 'fb610000-0000-4000-8000-000000000002', 'fb600000-0000-4000-8000-000000000002', '2039-01-11', 'scheduled'
);

CREATE TEMP TABLE csf_atomic_meeting_results (
  kind text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT DROP;

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_term_meeting(
    'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', NULL,
    'Unauthorized meeting', '2039-02-01', '2039-02-01 18:00:00+00', 'Library', NULL,
    true, 1, 'active', 'fb900000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000002'
  )$$,
  'P0001', 'Not authorized to manage CSF meetings.',
  'an account without meeting permission cannot create a meeting'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_term_meeting(
    'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000002', NULL,
    'Cross-tenant meeting', '2039-02-01', '2039-02-01 18:00:00+00', 'Library', NULL,
    true, 1, 'active', 'fb900000-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'CSF semester was not found in this organization.',
  'meeting creation rejects a semester from another organization'
);
SELECT extensions.lives_ok(
  $$INSERT INTO csf_atomic_meeting_results (kind, payload)
    SELECT 'create', plugin_data.csf_upsert_term_meeting(
      'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', NULL,
      'February chapter meeting', '2039-02-15', '2039-02-16 02:00:00+00', 'School library', 'https://docs.google.com/spreadsheets/d/example',
      true, 1, 'active', 'fb900000-0000-4000-8000-000000000003', 'fb000000-0000-4000-8000-000000000001'
    )$$,
  'an authorized manager atomically creates a meeting'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_meetings AS meeting
    JOIN csf_atomic_meeting_results AS result ON result.kind = 'create'
    WHERE meeting.id = (result.payload ->> 'meetingId')::uuid
      AND meeting.organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND meeting.term_id = 'fb200000-0000-4000-8000-000000000001'
      AND meeting.label = 'February chapter meeting'
  ),
  'meeting creation writes the exact organization-scoped legacy row'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_meetings AS meeting
    JOIN csf_atomic_meeting_results AS result ON result.kind = 'create'
    WHERE meeting.id = (result.payload ->> 'logicalMeetingId')::uuid
      AND meeting.organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND meeting.term_id = 'fb200000-0000-4000-8000-000000000001'
      AND meeting.label = 'February chapter meeting'
  ),
  'meeting creation writes the matching logical projection'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_meeting_sessions AS session
    JOIN csf_atomic_meeting_results AS result ON result.kind = 'create'
    WHERE session.id = (result.payload ->> 'sessionId')::uuid
      AND session.meeting_id = (result.payload ->> 'logicalMeetingId')::uuid
      AND session.legacy_term_meeting_id = (result.payload ->> 'meetingId')::uuid
      AND session.status = 'scheduled'
  ),
  'meeting creation writes the matching dated session projection'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fb900000-0000-4000-8000-000000000003'),
  1, 'meeting creation writes one immutable audit receipt'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'fb900000-0000-4000-8000-000000000003'
      AND action = 'term_meeting.create'
      AND term_id = 'fb200000-0000-4000-8000-000000000001'
      AND after_data -> 'request' ->> 'label' = 'February chapter meeting'
  ),
  'the create receipt preserves exact term and request evidence'
);
SELECT extensions.is(
  (plugin_data.csf_upsert_term_meeting(
    'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', NULL,
    'February chapter meeting', '2039-02-15', '2039-02-16 02:00:00+00', 'School library', 'https://docs.google.com/spreadsheets/d/example',
    true, 1, 'active', 'fb900000-0000-4000-8000-000000000003', 'fb000000-0000-4000-8000-000000000001'
  ) ->> 'idempotent'),
  'true', 'an exact create request replay returns the committed result'
);
SELECT extensions.ok(
  (SELECT count(*) FROM plugin_data.csf_term_meetings WHERE organization_id = 'fb100000-0000-4000-8000-000000000001' AND meeting_key = 'february_chapter_meeting') = 1
    AND (SELECT count(*) FROM plugin_data.csf_meetings WHERE organization_id = 'fb100000-0000-4000-8000-000000000001' AND meeting_key = 'february_chapter_meeting') = 1
    AND (SELECT count(*) FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fb900000-0000-4000-8000-000000000003') = 1,
  'create replay cannot duplicate any projection or receipt'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_term_meeting(
    'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', NULL,
    'Changed create payload', '2039-02-15', '2039-02-16 02:00:00+00', 'School library', NULL,
    true, 1, 'active', 'fb900000-0000-4000-8000-000000000003', 'fb000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'That meeting request identifier is already bound to a different change.',
  'a create request identifier cannot be reused for a different payload'
);
SELECT extensions.is(
  (SELECT label FROM plugin_data.csf_term_meetings WHERE id = (SELECT (payload ->> 'meetingId')::uuid FROM csf_atomic_meeting_results WHERE kind = 'create')),
  'February chapter meeting', 'a conflicting create replay leaves the committed meeting unchanged'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_term_meeting(
    'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'fb600000-0000-4000-8000-000000000002',
    'Cross-tenant edit', '2039-02-20', NULL, NULL, NULL,
    true, 2, 'active', 'fb900000-0000-4000-8000-000000000004', 'fb000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'Meeting was not found in this organization and semester.',
  'meeting edit rejects a meeting from another organization'
);

UPDATE plugin_data.csf_meeting_sessions
SET status = 'closed'
WHERE id = (SELECT (payload ->> 'sessionId')::uuid FROM csf_atomic_meeting_results WHERE kind = 'create');

SELECT extensions.lives_ok(
  $$INSERT INTO csf_atomic_meeting_results (kind, payload)
    SELECT 'edit', plugin_data.csf_upsert_term_meeting(
      'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001',
      (SELECT (payload ->> 'meetingId')::uuid FROM csf_atomic_meeting_results WHERE kind = 'create'),
      'February member meeting', '2039-02-16', '2039-02-17 02:30:00+00', 'Community room', NULL,
      false, 2, 'active', 'fb900000-0000-4000-8000-000000000005', 'fb000000-0000-4000-8000-000000000001'
    )$$,
  'an authorized manager atomically edits a meeting'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM csf_atomic_meeting_results AS result
    JOIN plugin_data.csf_term_meetings AS legacy ON legacy.id = (result.payload ->> 'meetingId')::uuid
    JOIN plugin_data.csf_meetings AS logical ON logical.id = (result.payload ->> 'logicalMeetingId')::uuid
    JOIN plugin_data.csf_meeting_sessions AS session ON session.id = (result.payload ->> 'sessionId')::uuid
    WHERE result.kind = 'edit'
      AND legacy.label = 'February member meeting'
      AND logical.label = 'February member meeting'
      AND legacy.required = false
      AND logical.required = false
      AND session.location = 'Community room'
      AND session.session_date = '2039-02-16'
  ),
  'meeting edit changes the legacy, logical, and session projections together'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_meeting_sessions WHERE id = (SELECT (payload ->> 'sessionId')::uuid FROM csf_atomic_meeting_results WHERE kind = 'edit')),
  'closed', 'an active metadata edit does not reopen a closed dated session'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fb900000-0000-4000-8000-000000000005' AND action = 'term_meeting.edit'),
  1, 'meeting edit writes one correlated immutable receipt'
);
SELECT extensions.is(
  (plugin_data.csf_upsert_term_meeting(
    'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001',
    (SELECT (payload ->> 'meetingId')::uuid FROM csf_atomic_meeting_results WHERE kind = 'create'),
    'February member meeting', '2039-02-16', '2039-02-17 02:30:00+00', 'Community room', NULL,
    false, 2, 'active', 'fb900000-0000-4000-8000-000000000005', 'fb000000-0000-4000-8000-000000000001'
  ) ->> 'idempotent'),
  'true', 'an exact edit request replay returns the committed result'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fb900000-0000-4000-8000-000000000005'),
  1, 'edit replay cannot duplicate its immutable receipt'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_term_meeting(
    'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001',
    (SELECT (payload ->> 'meetingId')::uuid FROM csf_atomic_meeting_results WHERE kind = 'create'),
    'Conflicting edit', '2039-02-16', '2039-02-17 02:30:00+00', 'Community room', NULL,
    false, 2, 'active', 'fb900000-0000-4000-8000-000000000005', 'fb000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'That meeting request identifier is already bound to a different change.',
  'an edit request identifier cannot be reused for a different payload'
);
SELECT extensions.is(
  (SELECT label FROM plugin_data.csf_term_meetings WHERE id = (SELECT (payload ->> 'meetingId')::uuid FROM csf_atomic_meeting_results WHERE kind = 'create')),
  'February member meeting', 'a conflicting edit replay leaves every committed projection unchanged'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_term_meeting(
    'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'fb600000-0000-4000-8000-000000000001',
    'Should not partially edit', '2039-01-12', NULL, NULL, NULL,
    true, 90, 'active', 'fb900000-0000-4000-8000-000000000006', 'fb000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'Meeting session projection was not found for this meeting.',
  'editing a meeting with a missing session projection fails explicitly'
);
SELECT extensions.ok(
  (SELECT label = 'Orphan meeting' FROM plugin_data.csf_term_meetings WHERE id = 'fb600000-0000-4000-8000-000000000001')
    AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fb900000-0000-4000-8000-000000000006'),
  'a failed edit leaves the legacy row unchanged and writes no audit receipt'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_archive_term_meeting(
      'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', %L,
      'fb900000-0000-4000-8000-000000000007', 'fb000000-0000-4000-8000-000000000002'
    )$$,
    (SELECT payload ->> 'meetingId' FROM csf_atomic_meeting_results WHERE kind = 'create')
  ),
  'P0001', 'Not authorized to manage CSF meetings.',
  'an account without meeting permission cannot archive a meeting'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_archive_term_meeting(
    'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'fb600000-0000-4000-8000-000000000002',
    'fb900000-0000-4000-8000-000000000008', 'fb000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'Meeting was not found in this organization and semester.',
  'meeting archive rejects a meeting from another organization'
);
SELECT extensions.lives_ok(
  $$INSERT INTO csf_atomic_meeting_results (kind, payload)
    SELECT 'archive', plugin_data.csf_archive_term_meeting(
      'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001',
      (SELECT (payload ->> 'meetingId')::uuid FROM csf_atomic_meeting_results WHERE kind = 'create'),
      'fb900000-0000-4000-8000-000000000009', 'fb000000-0000-4000-8000-000000000001'
    )$$,
  'an authorized manager atomically archives a meeting'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM csf_atomic_meeting_results AS result
    JOIN plugin_data.csf_term_meetings AS legacy ON legacy.id = (result.payload ->> 'meetingId')::uuid
    JOIN plugin_data.csf_meetings AS logical ON logical.id = (result.payload ->> 'logicalMeetingId')::uuid
    JOIN plugin_data.csf_meeting_sessions AS session ON session.id = (result.payload ->> 'sessionId')::uuid
    WHERE result.kind = 'archive'
      AND legacy.status = 'archived'
      AND logical.status = 'archived'
      AND session.status = 'archived'
  ),
  'meeting archive changes every projection together'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fb900000-0000-4000-8000-000000000009' AND action = 'term_meeting.archive'),
  1, 'meeting archive writes one correlated immutable receipt'
);
SELECT extensions.is(
  (plugin_data.csf_archive_term_meeting(
    'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001',
    (SELECT (payload ->> 'meetingId')::uuid FROM csf_atomic_meeting_results WHERE kind = 'create'),
    'fb900000-0000-4000-8000-000000000009', 'fb000000-0000-4000-8000-000000000001'
  ) ->> 'idempotent'),
  'true', 'an exact archive request replay returns the committed result'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fb900000-0000-4000-8000-000000000009'),
  1, 'archive replay cannot duplicate its immutable receipt'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_archive_term_meeting(
    'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'fb600000-0000-4000-8000-000000000001',
    'fb900000-0000-4000-8000-000000000009', 'fb000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'That meeting archive request identifier is already bound to a different change.',
  'an archive request identifier cannot be reused for a different target'
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_archive_term_meeting(
      'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', %L,
      'fb900000-0000-4000-8000-000000000010', 'fb000000-0000-4000-8000-000000000001'
    )$$,
    (SELECT payload ->> 'meetingId' FROM csf_atomic_meeting_results WHERE kind = 'create')
  ),
  'P0001', 'Meeting is already archived.',
  'a fresh request cannot create a second archive receipt for an archived meeting'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_archive_term_meeting(
    'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'fb600000-0000-4000-8000-000000000001',
    'fb900000-0000-4000-8000-000000000011', 'fb000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'Meeting session projection was not found for this meeting.',
  'archiving a meeting with a missing session projection fails explicitly'
);
SELECT extensions.ok(
  (SELECT status = 'active' FROM plugin_data.csf_term_meetings WHERE id = 'fb600000-0000-4000-8000-000000000001')
    AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fb900000-0000-4000-8000-000000000011'),
  'a failed archive leaves the legacy row active and writes no audit receipt'
);
SELECT extensions.throws_ok(
  $$UPDATE plugin_data.csf_admin_audit_events
    SET action = 'tampered'
    WHERE correlation_id = 'fb900000-0000-4000-8000-000000000009'$$,
  'P0001', 'CSF audit events are immutable.',
  'the atomic meeting receipt remains immutable after commit'
);

SELECT * FROM extensions.finish();
ROLLBACK;
