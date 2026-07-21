BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

SELECT extensions.has_column('plugin_data', 'csf_partner_club_terms', 'proof_required', 'partner-club terms store their proof policy');
SELECT extensions.has_column('plugin_data', 'csf_point_submissions', 'partner_club_term_id', 'point submissions reference the reviewed partner-club term');
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_point_submissions'::regclass
      AND conname = 'csf_point_submissions_partner_club_term_org_fkey'
      AND contype = 'f'
      AND convalidated
  ),
  'partner-club claims use an organization-scoped foreign key'
);
SELECT extensions.ok(
  NOT has_function_privilege('public', 'plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)', 'EXECUTE'),
  'PUBLIC cannot change partner-club semester standing'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)', 'EXECUTE'),
  'authenticated users cannot bypass the permission-checked Server Action'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)', 'EXECUTE'),
  'the permission-checked server role can change partner-club semester standing'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES ('d4000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'club-officer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('d4100000-0000-4000-8000-000000000001', 'CSF Club One', 'csf-club-one', 'school', '994101'),
  ('d4100000-0000-4000-8000-000000000002', 'CSF Club Two', 'csf-club-two', 'school', '994102');

INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester, is_current)
VALUES
  ('d4200000-0000-4000-8000-000000000001', 'd4100000-0000-4000-8000-000000000001', 'F30', 'Fall 2030', '2030-2031', 'fall', true),
  ('d4200000-0000-4000-8000-000000000002', 'd4100000-0000-4000-8000-000000000002', 'F30', 'Fall 2030', '2030-2031', 'fall', true);

INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name)
VALUES ('d4300000-0000-4000-8000-000000000001', 'd4100000-0000-4000-8000-000000000001', 'Club', 'Member', 'club', 'member');

INSERT INTO plugin_data.csf_partner_clubs (id, organization_id, name, status)
VALUES
  ('d4400000-0000-4000-8000-000000000001', 'd4100000-0000-4000-8000-000000000001', 'Robotics', 'active'),
  ('d4400000-0000-4000-8000-000000000002', 'd4100000-0000-4000-8000-000000000002', 'Key Club', 'active');

INSERT INTO plugin_data.csf_partner_club_terms (
  id, organization_id, partner_club_id, term_id, relationship_status,
  workflow_status, approved_point_types, non_drive_points, drive_points, proof_required
) VALUES
  ('d4500000-0000-4000-8000-000000000001', 'd4100000-0000-4000-8000-000000000001', 'd4400000-0000-4000-8000-000000000001', 'd4200000-0000-4000-8000-000000000001', 'new', 'active', ARRAY['non_drive'], 3, 0, true),
  ('d4500000-0000-4000-8000-000000000002', 'd4100000-0000-4000-8000-000000000002', 'd4400000-0000-4000-8000-000000000002', 'd4200000-0000-4000-8000-000000000002', 'new', 'active', ARRAY['non_drive'], 2, 0, false);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_set_partner_club_term_status(
    'd4100000-0000-4000-8000-000000000001', 'd4500000-0000-4000-8000-000000000001',
    'inactive', 'Officer suspended this club pending policy review.',
    'd4000000-0000-4000-8000-000000000001', 'd4600000-0000-4000-8000-000000000001'
  ) $$,
  'an officer can suspend one semester standing'
);
SELECT extensions.is(
  (SELECT workflow_status FROM plugin_data.csf_partner_club_terms WHERE id = 'd4500000-0000-4000-8000-000000000001'),
  'inactive',
  'the semester standing changes without altering the canonical club'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'd4600000-0000-4000-8000-000000000001'),
  1,
  'the standing update and its audit event commit together'
);
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_set_partner_club_term_status(
    'd4100000-0000-4000-8000-000000000001', 'd4500000-0000-4000-8000-000000000001',
    'active', 'Officer approved the corrected semester policy.',
    'd4000000-0000-4000-8000-000000000001', 'd4600000-0000-4000-8000-000000000002'
  ) $$,
  'an officer can reactivate the reviewed semester standing'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE target_id = 'd4500000-0000-4000-8000-000000000001'),
  2,
  'standing history retains both transitions'
);
SELECT extensions.lives_ok(
  $$ INSERT INTO plugin_data.csf_point_submissions (
    organization_id, profile_id, term_id, partner_club_term_id, description, claimed_points, point_type, submitted_by
  ) VALUES (
    'd4100000-0000-4000-8000-000000000001', 'd4300000-0000-4000-8000-000000000001',
    'd4200000-0000-4000-8000-000000000001', 'd4500000-0000-4000-8000-000000000001',
    'Partner-club service', 2, 'non_drive', 'd4000000-0000-4000-8000-000000000001'
  ) $$,
  'a point claim can reference its reviewed partner-club semester policy'
);
SELECT extensions.throws_ok(
  $$ INSERT INTO plugin_data.csf_point_submissions (
    organization_id, profile_id, term_id, partner_club_term_id, description, claimed_points, point_type, submitted_by
  ) VALUES (
    'd4100000-0000-4000-8000-000000000001', 'd4300000-0000-4000-8000-000000000001',
    'd4200000-0000-4000-8000-000000000001', 'd4500000-0000-4000-8000-000000000002',
    'Cross-tenant claim', 1, 'non_drive', 'd4000000-0000-4000-8000-000000000001'
  ) $$,
  '23503', 'insert or update on table "csf_point_submissions" violates foreign key constraint "csf_point_submissions_partner_club_term_org_fkey"',
  'a point claim cannot reference another organization partner-club policy'
);

SELECT extensions.finish();
ROLLBACK;
