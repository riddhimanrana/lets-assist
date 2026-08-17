BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(30);

SELECT extensions.is(
  plugin_data.csf_import_compatibility_permissions('meeting_attendance'),
  ARRAY[]::text[],
  'meeting attendance accepts no legacy broad import grant'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_upsert_term_meeting(uuid,uuid,uuid,text,date,timestamptz,text,text,boolean,integer,text,uuid,uuid)',
      'plugin_data.csf_archive_term_meeting(uuid,uuid,uuid,uuid,uuid)',
      'plugin_data.csf_correct_meeting_attendance(uuid,uuid,uuid,text,text,text,uuid,uuid)',
      'plugin_data.csf_commit_meeting_attendance_import(uuid,uuid,uuid,text,uuid,uuid)'
    ]) AS operation(signature)
    CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated']) AS client(role_name)
    WHERE has_function_privilege(client.role_name::name, operation.signature, 'EXECUTE')
  ),
  'no browser role can execute a meeting mutation RPC'
);
SELECT extensions.ok(
  (
    SELECT bool_and(
      has_function_privilege('service_role', operation.signature, 'EXECUTE')
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_upsert_term_meeting(uuid,uuid,uuid,text,date,timestamptz,text,text,boolean,integer,text,uuid,uuid)',
      'plugin_data.csf_archive_term_meeting(uuid,uuid,uuid,uuid,uuid)',
      'plugin_data.csf_correct_meeting_attendance(uuid,uuid,uuid,text,text,text,uuid,uuid)',
      'plugin_data.csf_commit_meeting_attendance_import(uuid,uuid,uuid,text,uuid,uuid)'
    ]) AS operation(signature)
  ),
  'service_role can execute the reviewed meeting mutation RPCs'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_assert_meeting_permission_under_lock(uuid,uuid,text)',
      'plugin_data.csf_upsert_term_meeting_permission_base(uuid,uuid,uuid,text,date,timestamptz,text,text,boolean,integer,text,uuid,uuid)',
      'plugin_data.csf_archive_term_meeting_permission_base(uuid,uuid,uuid,uuid,uuid)',
      'plugin_data.csf_correct_meeting_attendance_permission_base(uuid,uuid,uuid,text,text,text,uuid,uuid)'
    ]) AS operation(signature)
    WHERE has_function_privilege('service_role', operation.signature, 'EXECUTE')
  ),
  'owner-internal meeting helpers and historical bodies are not service-callable'
);
SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_assert_import_actor(uuid,uuid,text)'::regprocedure
  ) LIKE '%csf_assert_meeting_permission_under_lock%import_meetings%'
  AND pg_get_functiondef(
    'plugin_data.csf_assert_import_actor(uuid,uuid,text)'::regprocedure
  ) LIKE '%csf_assert_meeting_permission_under_lock%reconcile_meeting_attendance%',
  'meeting import and row recovery require both exact capabilities in SQL'
);
SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_upsert_term_meeting(uuid,uuid,uuid,text,date,timestamptz,text,text,boolean,integer,text,uuid,uuid)'::regprocedure
  ) LIKE '%manage_meetings%'
  AND pg_get_functiondef(
    'plugin_data.csf_upsert_term_meeting(uuid,uuid,uuid,text,date,timestamptz,text,text,boolean,integer,text,uuid,uuid)'::regprocedure
  ) LIKE '%import_meetings%'
  AND pg_get_functiondef(
    'plugin_data.csf_upsert_term_meeting(uuid,uuid,uuid,text,date,timestamptz,text,text,boolean,integer,text,uuid,uuid)'::regprocedure
  ) LIKE '%reconcile_meeting_attendance%',
  'meeting upsert carries the exact schedule/add-source/replacement matrix'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ea000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'meeting-manage-import@local.test', now(), '{}', '{}', now(), now()),
  ('ea000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'meeting-full@local.test', now(), '{}', '{}', now(), now()),
  ('ea000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'meeting-legacy@local.test', now(), '{}', '{}', now(), now()),
  ('ea000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'meeting-no-membership@local.test', now(), '{}', '{}', now(), now()),
  ('ea000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'meeting-manage-only@local.test', now(), '{}', '{}', now(), now()),
  ('ea000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'meeting-reconcile-only@local.test', now(), '{}', '{}', now(), now()),
  ('ea000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'meeting-import-only@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('ea100000-0000-4000-8000-000000000001', 'Meeting Permission One', 'meeting-permission-one', 'school', '995101'),
  ('ea100000-0000-4000-8000-000000000002', 'Meeting Permission Two', 'meeting-permission-two', 'school', '995102')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000010', 'member', 'active'),
  ('ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000003', 'member', 'active'),
  ('ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000005', 'member', 'active'),
  ('ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000006', 'member', 'active'),
  ('ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000007', 'member', 'active');

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, role_type, is_system
) VALUES
  ('ea200000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001', 'meeting-manage-import', 'Meeting manage and import', 'custom', false),
  ('ea200000-0000-4000-8000-000000000002', 'ea100000-0000-4000-8000-000000000001', 'meeting-full', 'Meeting full authority', 'custom', false),
  ('ea200000-0000-4000-8000-000000000003', 'ea100000-0000-4000-8000-000000000001', 'meeting-legacy', 'Meeting legacy authority', 'custom', false),
  ('ea200000-0000-4000-8000-000000000005', 'ea100000-0000-4000-8000-000000000001', 'meeting-manage-only', 'Meeting manage only', 'custom', false),
  ('ea200000-0000-4000-8000-000000000006', 'ea100000-0000-4000-8000-000000000001', 'meeting-reconcile-only', 'Meeting reconcile only', 'custom', false),
  ('ea200000-0000-4000-8000-000000000007', 'ea100000-0000-4000-8000-000000000001', 'meeting-import-only', 'Meeting import only', 'custom', false);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES
  ('ea100000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000001', 'manage_meetings', true),
  ('ea100000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000001', 'import_meetings', true),
  ('ea100000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000002', 'manage_meetings', true),
  ('ea100000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000002', 'import_meetings', true),
  ('ea100000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000002', 'reconcile_meeting_attendance', true),
  ('ea100000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000003', 'manage_sheet_sync', true),
  ('ea100000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000003', 'resolve_imports', true),
  ('ea100000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000005', 'manage_meetings', true),
  ('ea100000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000006', 'reconcile_meeting_attendance', true),
  ('ea100000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000007', 'import_meetings', true);

INSERT INTO plugin_data.csf_staff_positions (
  id, organization_id, user_id, role_id, school_year, display_title, status
) VALUES
  ('ea300000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000010', 'ea200000-0000-4000-8000-000000000001', '2050-2051', 'Meeting manager', 'active'),
  ('ea300000-0000-4000-8000-000000000002', 'ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000002', 'ea200000-0000-4000-8000-000000000002', '2050-2051', 'Meeting reconciler', 'active'),
  ('ea300000-0000-4000-8000-000000000003', 'ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000003', 'ea200000-0000-4000-8000-000000000003', '2050-2051', 'Legacy sheet officer', 'active'),
  ('ea300000-0000-4000-8000-000000000005', 'ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000005', 'ea200000-0000-4000-8000-000000000005', '2050-2051', 'Meeting scheduler', 'active'),
  ('ea300000-0000-4000-8000-000000000006', 'ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000006', 'ea200000-0000-4000-8000-000000000006', '2050-2051', 'Attendance reconciler', 'active'),
  ('ea300000-0000-4000-8000-000000000007', 'ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000007', 'ea200000-0000-4000-8000-000000000007', '2050-2051', 'Meeting importer', 'active');

-- An earlier autocommit concurrency fixture intentionally retains the same
-- synthetic organization through the disposable full-suite replay. Advance
-- its term honestly before configuring this fixture's current school year.
UPDATE plugin_data.csf_terms
SET is_current = false
WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
  AND is_current = true;

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, lifecycle_status, is_current
) VALUES
  ('ea400000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001', 'F50', 'Fall 2050', '2050-2051', 'fall', 'open', true),
  ('ea400000-0000-4000-8000-000000000002', 'ea100000-0000-4000-8000-000000000002', 'F50', 'Fall 2050', '2050-2051', 'fall', 'open', true);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('ea500000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001', 'Meeting', 'Member', 'meeting', 'member'),
  ('ea500000-0000-4000-8000-000000000002', 'ea100000-0000-4000-8000-000000000002', 'Other', 'Member', 'other', 'member');

INSERT INTO plugin_data.csf_term_meetings (
  id, organization_id, term_id, meeting_key, label, meeting_date,
  attendance_source_url, required, sort_order, status
) VALUES
  ('ea600000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001', 'ea400000-0000-4000-8000-000000000001', 'permission-meeting', 'Permission meeting', '2050-09-10', 'https://docs.google.com/spreadsheets/d/original', true, 1, 'active'),
  ('ea600000-0000-4000-8000-000000000002', 'ea100000-0000-4000-8000-000000000002', 'ea400000-0000-4000-8000-000000000002', 'other-meeting', 'Other meeting', '2050-09-11', NULL, true, 1, 'active');
INSERT INTO plugin_data.csf_meetings (
  id, organization_id, term_id, meeting_key, label, required, sort_order, status
) VALUES
  ('ea610000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001', 'ea400000-0000-4000-8000-000000000001', 'permission-meeting', 'Permission meeting', true, 1, 'active'),
  ('ea610000-0000-4000-8000-000000000002', 'ea100000-0000-4000-8000-000000000002', 'ea400000-0000-4000-8000-000000000002', 'other-meeting', 'Other meeting', true, 1, 'active');
INSERT INTO plugin_data.csf_meeting_sessions (
  id, organization_id, meeting_id, legacy_term_meeting_id, session_date,
  attendance_source_url, status
) VALUES
  ('ea620000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001', 'ea610000-0000-4000-8000-000000000001', 'ea600000-0000-4000-8000-000000000001', '2050-09-10', 'https://docs.google.com/spreadsheets/d/original', 'scheduled'),
  ('ea620000-0000-4000-8000-000000000002', 'ea100000-0000-4000-8000-000000000002', 'ea610000-0000-4000-8000-000000000002', 'ea600000-0000-4000-8000-000000000002', '2050-09-11', NULL, 'scheduled');

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_correct_meeting_attendance(
    'ea100000-0000-4000-8000-000000000001', 'ea600000-0000-4000-8000-000000000001',
    'ea500000-0000-4000-8000-000000000001', 'set', 'attended', 'No membership must be denied.',
    'ea000000-0000-4000-8000-000000000004', 'eaf00000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'Not authorized for the requested CSF meeting operation.',
  'attendance correction requires active organization membership'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_correct_meeting_attendance(
    'ea100000-0000-4000-8000-000000000001', 'ea600000-0000-4000-8000-000000000001',
    'ea500000-0000-4000-8000-000000000001', 'set', 'attended', 'Legacy grants must be denied.',
    'ea000000-0000-4000-8000-000000000003', 'eaf00000-0000-4000-8000-000000000002'
  )$$,
  '42501', 'Not authorized for the requested CSF meeting operation.',
  'legacy sheet grants cannot correct meeting attendance'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_correct_meeting_attendance(
    'ea100000-0000-4000-8000-000000000001', 'ea600000-0000-4000-8000-000000000001',
    'ea500000-0000-4000-8000-000000000001', 'set', 'attended', 'Import-only authority must be denied.',
    'ea000000-0000-4000-8000-000000000010', 'eaf00000-0000-4000-8000-000000000003'
  )$$,
  '42501', 'Not authorized for the requested CSF meeting operation.',
  'import_meetings does not imply reconciliation authority'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_correct_meeting_attendance(
    'ea100000-0000-4000-8000-000000000001', 'ea600000-0000-4000-8000-000000000001',
    'ea500000-0000-4000-8000-000000000001', 'set', 'attended', 'Full authority permits correction.',
    'ea000000-0000-4000-8000-000000000002', 'eaf00000-0000-4000-8000-000000000004'
  )$$,
  'exact reconciliation authority can correct meeting attendance'
);
SELECT extensions.is(
  (SELECT source FROM plugin_data.csf_meeting_attendance
   WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
     AND profile_id = 'ea500000-0000-4000-8000-000000000001'),
  'manual',
  'the authorized correction writes the canonical manual attendance row'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_correct_meeting_attendance(
    'ea100000-0000-4000-8000-000000000001', 'ea600000-0000-4000-8000-000000000001',
    'ea500000-0000-4000-8000-000000000002', 'set', 'attended', 'Cross-tenant profile must fail.',
    'ea000000-0000-4000-8000-000000000002', 'eaf00000-0000-4000-8000-000000000005'
  )$$,
  'P0001', 'CSF member not found.',
  'attendance correction cannot target another tenant profile'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_upsert_term_meeting(
    'ea100000-0000-4000-8000-000000000001', 'ea400000-0000-4000-8000-000000000001',
    'ea600000-0000-4000-8000-000000000001', 'Permission meeting renamed', '2050-09-10', NULL, 'Library',
    'https://docs.google.com/spreadsheets/d/original', true, 1, 'active',
    'eaf00000-0000-4000-8000-000000000006', 'ea000000-0000-4000-8000-000000000005'
  )$$,
  'manage_meetings alone may edit scheduling while preserving the source'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_term_meeting(
    'ea100000-0000-4000-8000-000000000001', 'ea400000-0000-4000-8000-000000000001',
    'ea600000-0000-4000-8000-000000000001', 'Unauthorized replacement', '2050-09-10', NULL, 'Library',
    'https://docs.google.com/spreadsheets/d/replacement-denied', true, 1, 'active',
    'eaf00000-0000-4000-8000-000000000007', 'ea000000-0000-4000-8000-000000000010'
  )$$,
  '42501', 'Not authorized for the requested CSF meeting operation.',
  'replacing an existing source also requires reconciliation authority'
);
SELECT extensions.is(
  (SELECT attendance_source_url FROM plugin_data.csf_term_meetings
   WHERE id = 'ea600000-0000-4000-8000-000000000001'),
  'https://docs.google.com/spreadsheets/d/original',
  'a denied replacement leaves the existing source unchanged'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_upsert_term_meeting(
    'ea100000-0000-4000-8000-000000000001', 'ea400000-0000-4000-8000-000000000001',
    'ea600000-0000-4000-8000-000000000001', 'Authorized replacement', '2050-09-10', NULL, 'Library',
    'https://docs.google.com/spreadsheets/d/replacement-allowed', true, 1, 'active',
    'eaf00000-0000-4000-8000-000000000008', 'ea000000-0000-4000-8000-000000000002'
  )$$,
  'manage, import, and reconcile together may replace a meeting source'
);
SELECT extensions.is(
  (SELECT attendance_source_url FROM plugin_data.csf_term_meetings
   WHERE id = 'ea600000-0000-4000-8000-000000000001'),
  'https://docs.google.com/spreadsheets/d/replacement-allowed',
  'the authorized source replacement updates the meeting projection'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_upsert_term_meeting(
    'ea100000-0000-4000-8000-000000000001', 'ea400000-0000-4000-8000-000000000001',
    NULL, 'New sourced meeting', '2050-10-01', NULL, 'Library',
    'https://docs.google.com/spreadsheets/d/new-source', true, 2, 'active',
    'eaf00000-0000-4000-8000-000000000009', 'ea000000-0000-4000-8000-000000000010'
  )$$,
  'creating a new sourced meeting requires manage plus import but not reconcile'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_term_meeting(
    'ea100000-0000-4000-8000-000000000001', 'ea400000-0000-4000-8000-000000000001',
    NULL, 'Import without scheduling', '2050-10-02', NULL, 'Library',
    'https://docs.google.com/spreadsheets/d/import-only', true, 3, 'active',
    'eaf00000-0000-4000-8000-000000000011', 'ea000000-0000-4000-8000-000000000007'
  )$$,
  '42501', 'Not authorized for the requested CSF meeting operation.',
  'import_meetings alone cannot create or schedule a meeting'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000003',
    'meeting_attendance'
  )$$,
  '42501', 'Not authorized for the requested CSF meeting operation.',
  'legacy row-recovery grants do not authorize meeting imports'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000010',
    'meeting_attendance'
  )$$,
  '42501', 'Not authorized for the requested CSF meeting operation.',
  'meeting import authority alone cannot reconcile meeting rows'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000002',
    'meeting_attendance'
  )$$,
  'meeting imports accept the exact import plus reconcile pair'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000006',
    'meeting_attendance'
  )$$,
  '42501', 'Not authorized for the requested CSF meeting operation.',
  'reconciliation authority alone cannot import meeting rows'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000003',
    'student_roster'
  )$$,
  'non-meeting import compatibility remains available'
);

UPDATE plugin_data.csf_role_permissions
SET enabled = false
WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
  AND role_id = 'ea200000-0000-4000-8000-000000000002'
  AND permission_key = 'reconcile_meeting_attendance';
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_correct_meeting_attendance(
    'ea100000-0000-4000-8000-000000000001', 'ea600000-0000-4000-8000-000000000001',
    'ea500000-0000-4000-8000-000000000001', 'set', 'excused', 'Revoked authority must fail.',
    'ea000000-0000-4000-8000-000000000002', 'eaf00000-0000-4000-8000-000000000010'
  )$$,
  '42501', 'Not authorized for the requested CSF meeting operation.',
  'a revoked reconciliation grant cannot correct attendance'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_meeting_attendance
   WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
     AND profile_id = 'ea500000-0000-4000-8000-000000000001'),
  'attended',
  'the revoked correction writes nothing'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_correct_meeting_attendance(
    'ea100000-0000-4000-8000-000000000001', 'ea600000-0000-4000-8000-000000000001',
    'ea500000-0000-4000-8000-000000000001', 'set', 'excused', 'Reconcile-only correction.',
    'ea000000-0000-4000-8000-000000000006', 'eaf00000-0000-4000-8000-000000000012'
  )$$,
  'reconcile_meeting_attendance alone is sufficient for manual correction'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_archive_term_meeting(
    'ea100000-0000-4000-8000-000000000001', 'ea400000-0000-4000-8000-000000000001',
    'ea600000-0000-4000-8000-000000000001', 'eaf00000-0000-4000-8000-000000000013',
    'ea000000-0000-4000-8000-000000000006'
  )$$,
  '42501', 'Not authorized for the requested CSF meeting operation.',
  'reconciliation authority does not imply meeting scheduling authority'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_archive_term_meeting(
    'ea100000-0000-4000-8000-000000000001', 'ea400000-0000-4000-8000-000000000001',
    'ea600000-0000-4000-8000-000000000001', 'eaf00000-0000-4000-8000-000000000014',
    'ea000000-0000-4000-8000-000000000005'
  )$$,
  'manage_meetings alone may archive a meeting'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_term_meetings
   WHERE id = 'ea600000-0000-4000-8000-000000000001'),
  'archived',
  'the authorized archive updates the canonical meeting projection'
);

SELECT * FROM extensions.finish();
ROLLBACK;
