BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
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


CREATE TEMP TABLE activity_guard_receipts(operation text,payload jsonb);
INSERT INTO activity_guard_receipts VALUES ('save',plugin_data.csf_officer_save_profile_activity('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000002',NULL,'Historical cleanup','non_drive',2,'2025-03-01T20:00:00Z','Officer verified historical participation.','fa000000-0000-4000-8000-000000000001','fa900000-0000-4000-8000-000000000090',true));
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_officer_save_profile_activity('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000002',NULL,'Historical cleanup','non_drive',2,'2025-03-01T20:00:00Z','Officer verified historical participation.','fa000000-0000-4000-8000-000000000001','fa900000-0000-4000-8000-000000000090',false)$q$,'That request identifier is already bound to a different change.','save cannot remove closed-semester acknowledgement on retry');
SELECT extensions.is(plugin_data.csf_officer_save_profile_activity('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000002',NULL,'Historical cleanup','non_drive',2,'2025-03-01T20:00:00Z','Officer verified historical participation.','fa000000-0000-4000-8000-000000000001','fa900000-0000-4000-8000-000000000090',true),(SELECT payload FROM activity_guard_receipts WHERE operation='save'),'save exact acknowledged replay returns original receipt');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_admin_audit_events WHERE organization_id='fa100000-0000-4000-8000-000000000001' AND action='profile.activity_saved'),1,'save retries do not duplicate audit');
INSERT INTO activity_guard_receipts VALUES ('delete',plugin_data.csf_officer_delete_profile_activity('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001',(SELECT (payload->>'activityEventId')::uuid FROM activity_guard_receipts WHERE operation='save'),'Officer verified historical participation.','fa000000-0000-4000-8000-000000000001','fa900000-0000-4000-8000-000000000091',true));
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_officer_delete_profile_activity('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001',(SELECT (payload->>'activityEventId')::uuid FROM activity_guard_receipts WHERE operation='save'),'Officer verified historical participation.','fa000000-0000-4000-8000-000000000001','fa900000-0000-4000-8000-000000000091',false)$q$,'That request identifier is already bound to a different change.','delete cannot remove closed-semester acknowledgement on retry');
SELECT extensions.is(plugin_data.csf_officer_delete_profile_activity('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001',(SELECT (payload->>'activityEventId')::uuid FROM activity_guard_receipts WHERE operation='save'),'Officer verified historical participation.','fa000000-0000-4000-8000-000000000001','fa900000-0000-4000-8000-000000000091',true),(SELECT payload FROM activity_guard_receipts WHERE operation='delete'),'delete exact acknowledged replay returns original receipt');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_admin_audit_events WHERE organization_id='fa100000-0000-4000-8000-000000000001' AND action='profile.activity_deleted'),1,'delete retries do not duplicate audit');
UPDATE public.organization_members SET status='inactive' WHERE organization_id='fa100000-0000-4000-8000-000000000001' AND user_id='fa000000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_officer_save_profile_activity('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000002',NULL,'Historical cleanup','non_drive',2,'2025-03-01T20:00:00Z','Officer verified historical participation.','fa000000-0000-4000-8000-000000000001','fa900000-0000-4000-8000-000000000090',true)$q$,'42501','Not authorized to edit CSF member records.','save revalidates authority even for an exact replay');
SELECT extensions.matches(pg_get_functiondef('plugin_data.csf_officer_save_profile_activity(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz,text,uuid,uuid,boolean)'::regprocedure),'(?s)pg_advisory_xact_lock.*csf_staff_access_lock_key.*FROM public.organization_members.*FOR SHARE;.*csf_actor_has_permission.*SELECT audit', 'save locks staff access and membership then rechecks before replay or write');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_officer_delete_profile_activity('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001',(SELECT (payload->>'activityEventId')::uuid FROM activity_guard_receipts WHERE operation='save'),'Officer verified historical participation.','fa000000-0000-4000-8000-000000000001','fa900000-0000-4000-8000-000000000091',true)$q$,'42501','Not authorized to edit CSF member records.','delete revalidates authority even for an exact replay');
SELECT extensions.matches(pg_get_functiondef('plugin_data.csf_officer_delete_profile_activity(uuid,uuid,uuid,text,uuid,uuid,boolean)'::regprocedure),'(?s)pg_advisory_xact_lock.*csf_staff_access_lock_key.*FROM public.organization_members.*FOR SHARE;.*csf_actor_has_permission.*SELECT audit', 'delete locks staff access and membership then rechecks before replay or write');
SELECT * FROM extensions.finish();
ROLLBACK;
