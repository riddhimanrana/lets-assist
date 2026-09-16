BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_officer_save_profile_activity(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz,text,uuid,uuid,boolean)',
    'EXECUTE'
  ),
  'the activity editor is never reachable from a browser role'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_officer_delete_profile_activity(uuid,uuid,uuid,text,uuid,uuid,boolean)',
    'EXECUTE'
  ),
  'the reviewed server can remove an activity row'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fa000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'activity-officer@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'activity-member@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('fa100000-0000-4000-8000-000000000001', 'Officer activity editing test', 'officer-activity-editing', 'school', '640912');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000002', 'member', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, lifecycle_status
) VALUES
  ('fa200000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'F25', 'Fall 2025', '2025-2026', 'fall', 'open'),
  ('fa200000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'S25', 'Spring 2025', '2024-2025', 'spring', 'open');

-- A closed semester is only reachable through an authorized close. Building
-- one here is fixture, not the behaviour under test, so the lifecycle guard is
-- suspended for exactly that statement and restored immediately.
SET LOCAL session_replication_role = replica;
INSERT INTO plugin_data.csf_term_closures (
  id, organization_id, term_id, policy_version, decisions, closed_by,
  revision, correlation_id
) VALUES (
  'fa700000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000002',
  1, '[]'::jsonb, 'fa000000-0000-4000-8000-000000000001', 1,
  'fa800000-0000-4000-8000-000000000001'
);
UPDATE plugin_data.csf_terms
SET lifecycle_status = 'closed', is_current = false,
  closed_at = now(), closed_by = 'fa000000-0000-4000-8000-000000000001',
  active_closure_id = 'fa700000-0000-4000-8000-000000000001',
  latest_closure_id = 'fa700000-0000-4000-8000-000000000001'
WHERE id = 'fa200000-0000-4000-8000-000000000002';
SET LOCAL session_replication_role = origin;

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name, source_summary
) VALUES (
  'fa300000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'Ledger', 'Student', 'ledger', 'student', '{}'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_officer_save_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    NULL, 'Beach cleanup', 'non_drive', 2, now(),
    'Confirmed from the sign-in sheet.',
    'fa000000-0000-4000-8000-000000000002',
    'fa900000-0000-4000-8000-000000000001', false
  ) $$,
  '42501',
  'Not authorized to edit CSF member records.',
  'a member cannot edit the activity ledger'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_officer_save_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    NULL, 'Beach cleanup', 'non_drive', 2, now(), 'short',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000002', false
  ) $$,
  'P0001',
  'Explain the correction in 8 to 500 characters.',
  'every edit carries a reason'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_officer_save_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    NULL, 'Beach cleanup', 'meeting', 2, now(),
    'Confirmed from the sign-in sheet.',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000003', false
  ) $$,
  'P0001',
  'Choose whether these are drive or non-drive points.',
  'the point type is one the requirement maths understands'
);

SELECT extensions.ok(
  (plugin_data.csf_officer_save_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    NULL, 'Beach cleanup', 'non_drive', 2, now(),
    'Confirmed from the sign-in sheet.',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000004', false
  ) ->> 'created')::boolean,
  'an officer can add an activity a semester was missing'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_activity_events
   WHERE profile_id = 'fa300000-0000-4000-8000-000000000001'
     AND title = 'Beach cleanup'),
  1,
  'the row appears in the member ledger'
);
SELECT extensions.is(
  (SELECT points::text FROM plugin_data.csf_credit_records AS credit
   JOIN plugin_data.csf_profile_activity_events AS event
     ON event.credit_record_id = credit.id
   WHERE event.title = 'Beach cleanup'),
  '2.00',
  'the points it carries land in the credit ledger too'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'fa900000-0000-4000-8000-000000000004'
     AND action = 'profile.activity_saved'),
  1,
  'the edit is recorded'
);

-- The same request identifier replays rather than adding a second row.
SELECT extensions.is(
  (plugin_data.csf_officer_save_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    NULL, 'Beach cleanup', 'non_drive', 2, now(),
    'Confirmed from the sign-in sheet.',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000004', false
  ) ->> 'activityEventId'),
  (SELECT id::text FROM plugin_data.csf_profile_activity_events
   WHERE title = 'Beach cleanup'),
  'a retried save replays its receipt instead of duplicating the row'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_activity_events
   WHERE profile_id = 'fa300000-0000-4000-8000-000000000001'),
  1,
  'the replay left exactly one row'
);

SELECT extensions.ok(
  NOT (plugin_data.csf_officer_save_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_profile_activity_events
     WHERE title = 'Beach cleanup'),
    'Beach cleanup (corrected)', 'drive', 3.5, now(),
    'Officer recount of the sign-in sheet.',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000005', false
  ) ->> 'created')::boolean,
  'editing an existing row is not a create'
);
SELECT extensions.is(
  (SELECT point_type || ' ' || counted_points::text
   FROM plugin_data.csf_profile_activity_events
   WHERE title = 'Beach cleanup (corrected)'),
  'drive 3.50',
  'the corrected title, kind and points are what the ledger now holds'
);

-- A submission owns its own award and the editor refuses to rewrite it.
INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, description, claimed_points, status
) VALUES (
  'fa400000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000001',
  'Food bank shift', 3, 'approved'
);
INSERT INTO plugin_data.csf_credit_records (
  id, organization_id, profile_id, term_id, submission_id, source, points,
  point_type, status
) VALUES (
  'fa500000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000001',
  'fa400000-0000-4000-8000-000000000001',
  'submission', 3, 'non_drive', 'verified'
);
INSERT INTO plugin_data.csf_profile_activity_events (
  id, organization_id, profile_id, term_id, credit_record_id, event_type,
  title, point_type, raw_points, counted_points, source
) VALUES (
  'fa600000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000001',
  'fa500000-0000-4000-8000-000000000001',
  'opportunity', 'Food bank shift', 'non_drive', 3, 3, 'submission'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_officer_save_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000001',
    'Food bank shift', 'non_drive', 9, now(),
    'Trying to rewrite a reviewed award.',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000006', false
  ) $$,
  'P0001',
  'These points came from a point submission. Correct them in the submission review.',
  'the editor never rewrites an award a submission owns'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_officer_delete_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000001',
    'Trying to remove a reviewed award.',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000007', false
  ) $$,
  'P0001',
  'These points came from a point submission. Correct them in the submission review.',
  'and never removes one either'
);

-- A closed semester is editable, but only deliberately.
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_officer_save_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000002',
    NULL, 'Late correction', 'non_drive', 1, now(),
    'Trying to edit a closed semester.',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000008', false
  ) $$,
  'P0001',
  'This semester is closed. Confirm that you are correcting closed evidence before saving.',
  'a closed semester is not edited by accident'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_activity_events
   WHERE title = 'Late correction'),
  0,
  'the refused edit wrote nothing'
);
SELECT extensions.ok(
  (plugin_data.csf_officer_save_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000002',
    NULL, 'Late correction', 'non_drive', 1, now(),
    'Confirmed with the adviser after the semester closed.',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000010', true
  ) ->> 'created')::boolean,
  'an officer who says so can correct a closed semester'
);
SELECT extensions.ok(
  (SELECT (after_data ->> 'closedSemesterAcknowledged')::boolean
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'fa900000-0000-4000-8000-000000000010'
     AND action = 'profile.activity_saved'),
  'the receipt records that closed evidence was corrected'
);
SELECT extensions.ok(
  NOT plugin_data.csf_closed_term_edit_attested(),
  'the acknowledgement does not outlive the statement that carried it'
);
SELECT extensions.throws_ok(
  $$ INSERT INTO plugin_data.csf_credit_records (
    organization_id, profile_id, term_id, source, points, point_type, status
  ) VALUES (
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000002',
    'manual', 1, 'non_drive', 'verified'
  ) $$,
  'P0001',
  'Closed CSF semester evidence is immutable; reopen the semester before making changes.',
  'and a direct write to closed evidence is refused exactly as before'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_officer_delete_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_profile_activity_events
     WHERE title = 'Beach cleanup (corrected)'),
    'Recorded against the wrong student.',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000009', false
  ) $$,
  'an officer can remove a row they own'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_activity_events
   WHERE title = 'Beach cleanup (corrected)'),
  0,
  'the row is gone from the ledger'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_credit_records
   WHERE source = 'manual'
     AND profile_id = 'fa300000-0000-4000-8000-000000000001'
     AND term_id = 'fa200000-0000-4000-8000-000000000001'),
  0,
  'and so are the points it carried'
);
SELECT extensions.is(
  (SELECT before_data -> 'event' ->> 'title'
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'fa900000-0000-4000-8000-000000000009'
     AND action = 'profile.activity_deleted'),
  'Beach cleanup (corrected)',
  'the receipt keeps the whole removed row'
);

-- C11: the award an event points at has to belong to the same member.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name, source_summary
) VALUES (
  'fa300000-0000-4000-8000-000000000002',
  'fa100000-0000-4000-8000-000000000001',
  'Other', 'Member', 'other', 'member', '{}'
);
INSERT INTO plugin_data.csf_credit_records (
  id, organization_id, profile_id, term_id, source, points, point_type, status
) VALUES (
  'fa500000-0000-4000-8000-000000000002',
  'fa100000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000002',
  'fa200000-0000-4000-8000-000000000001',
  'manual', 4, 'non_drive', 'verified'
);
INSERT INTO plugin_data.csf_profile_activity_events (
  id, organization_id, profile_id, term_id, credit_record_id, event_type,
  title, point_type, raw_points, counted_points, source
) VALUES (
  'fa600000-0000-4000-8000-000000000002',
  'fa100000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000001',
  'fa500000-0000-4000-8000-000000000002',
  'manual_adjustment', 'Cross member award', 'non_drive', 4, 4, 'manual'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_officer_save_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000002',
    'Cross member award', 'non_drive', 9, now(),
    'Trying to edit another member''s award.',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000011', false
  ) $$,
  'P0001',
  'That award belongs to a different member record. Reload the member.',
  'C11 one member''s page cannot rewrite another member''s award'
);

-- C8: a meeting row is not an activity the editor owns.
INSERT INTO plugin_data.csf_profile_activity_events (
  id, organization_id, profile_id, term_id, event_type,
  title, point_type, raw_points, counted_points, source
) VALUES (
  'fa600000-0000-4000-8000-000000000003',
  'fa100000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000001',
  'meeting', 'November Meeting', 'meeting', 0, 0, 'manual'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_officer_save_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000003',
    'November Meeting', 'non_drive', 5, now(),
    'Trying to turn a meeting into points.',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000012', false
  ) $$,
  'P0001',
  'That record is not an activity the ledger editor owns. Correct it where it is recorded.',
  'C8 a meeting row cannot be rewritten into a points award'
);

-- C9: an award shared with another row or an appeal is not removable here.
INSERT INTO plugin_data.csf_credit_records (
  id, organization_id, profile_id, term_id, source, points, point_type, status
) VALUES (
  'fa500000-0000-4000-8000-000000000003',
  'fa100000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000001',
  'manual', 2, 'non_drive', 'verified'
);
INSERT INTO plugin_data.csf_profile_activity_events (
  id, organization_id, profile_id, term_id, credit_record_id, event_type,
  title, point_type, raw_points, counted_points, source
) VALUES
  (
    'fa600000-0000-4000-8000-000000000004',
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    'fa500000-0000-4000-8000-000000000003',
    'manual_adjustment', 'Shared award A', 'non_drive', 2, 2, 'manual'
  ),
  (
    'fa600000-0000-4000-8000-000000000005',
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    'fa500000-0000-4000-8000-000000000003',
    'manual_adjustment', 'Shared award B', 'non_drive', 2, 2, 'manual'
  );
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_officer_delete_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000004',
    'Removing one of two rows sharing an award.',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000013', false
  ) $$,
  'P0001',
  'Another activity row shares these points. Remove that row first.',
  'C9 a shared award is not silently detached from its other row'
);

-- C7: the receipt describes this edit, not merely this actor.
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_officer_save_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    NULL, 'Receipt binding', 'non_drive', 1, now(),
    'First correction under this identifier.',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000014', false
  ) $$,
  'C7 the first edit under a request identifier is written'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_officer_save_profile_activity(
    'fa100000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    NULL, 'A different correction', 'drive', 8, now(),
    'Second, different correction under the same identifier.',
    'fa000000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000014', false
  ) $$,
  'P0001',
  'That request identifier is already bound to a different change.',
  'C7 a different edit under the same identifier is refused, not replayed'
);

-- C6: the claims-queue resolution supersedes competing pending claims the
-- same way the direct officer connection does.
SELECT extensions.ok(
  has_function_privilege(
    'postgres',
    'plugin_data.csf_supersede_competing_profile_claims(uuid,uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'C6 both decision paths share one supersede'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_supersede_competing_profile_claims(uuid,uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'C6 the shared supersede is owner-internal, reachable only through a decision'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef(
     pg_catalog.to_regprocedure(
       'plugin_data.csf_resolve_profile_link_request(uuid,uuid,uuid,text,text,uuid)'
     )
   ) LIKE '%csf_supersede_competing_profile_claims%'),
  'C6 the claims-queue resolution calls it'
);
SELECT extensions.ok(
  (SELECT pg_catalog.pg_get_functiondef(
     pg_catalog.to_regprocedure(
       'plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)'
     )
   ) LIKE '%csf_supersede_competing_profile_claims%'),
  'C6 and so does the direct officer connection, from the same function'
);

SELECT * FROM extensions.finish();
ROLLBACK;
