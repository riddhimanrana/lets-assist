-- Independent two-connection proof for representative mutations and the
-- positive authorization controls shared by the nine CSF activity and
-- partner-club service transactions. This file intentionally runs in
-- autocommit so dblink sessions observe committed authority changes.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(26);

-- The dblink sessions below commit independently, so a previous interrupted
-- run can leave these fixed synthetic fixtures behind. Clean before setup as
-- well as at EOF to make the next replay self-healing.
CREATE OR REPLACE FUNCTION pg_temp.cleanup_csf_activity_partner_fixtures()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  DELETE FROM plugin_data.csf_partner_club_representatives
  WHERE organization_id IN (
    'fa100000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_partner_club_terms
  WHERE organization_id IN (
    'fa100000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_partner_submission_batches
  WHERE organization_id IN (
    'fa100000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_partner_club_aliases
  WHERE organization_id IN (
    'fa100000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_opportunities
  WHERE organization_id IN (
    'fa100000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_partner_clubs
  WHERE organization_id IN (
    'fa100000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000002'
  );
  DELETE FROM public.projects
  WHERE organization_id IN (
    'fa100000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_terms
  WHERE organization_id IN (
    'fa100000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_staff_positions
  WHERE organization_id = 'fa100000-0000-4000-8000-000000000001';
  DELETE FROM plugin_data.csf_role_permissions
  WHERE organization_id = 'fa100000-0000-4000-8000-000000000001';
  DELETE FROM plugin_data.csf_roles
  WHERE organization_id = 'fa100000-0000-4000-8000-000000000001';
  DELETE FROM public.organization_members
  WHERE organization_id IN (
    'fa100000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000002'
  );
  DELETE FROM public.organizations
  WHERE id IN (
    'fa100000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000002'
  );
  DELETE FROM auth.users
  WHERE id IN (
    'fa000000-0000-4000-8000-000000000001',
    'fa000000-0000-4000-8000-000000000002',
    'fa000000-0000-4000-8000-000000000003',
    'fa000000-0000-4000-8000-000000000004',
    'fa000000-0000-4000-8000-000000000005',
    'fa000000-0000-4000-8000-000000000006',
    'fa000000-0000-4000-8000-000000000007',
    'fa000000-0000-4000-8000-000000000008',
    'fa000000-0000-4000-8000-000000000009',
    'fa000000-0000-4000-8000-000000000010',
    'fa000000-0000-4000-8000-000000000011',
    'fa000000-0000-4000-8000-000000000012'
  );
END;
$function$;

-- The immutable audit and append-only lifecycle triggers require replica mode
-- for test-only deletion. SET LOCAL confines it to this transaction even when
-- deletion raises and the transaction is rolled back, so an interrupted run
-- cannot leak replica mode.
CREATE OR REPLACE FUNCTION pg_temp.cleanup_csf_activity_partner_receipts()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  DELETE FROM plugin_data.csf_admin_audit_events
  WHERE organization_id IN (
    'fa100000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_partner_club_term_events
  WHERE organization_id IN (
    'fa100000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_staff_position_history
  WHERE organization_id = 'fa100000-0000-4000-8000-000000000001';
END;
$function$;

BEGIN;
SET LOCAL session_replication_role = replica;
SELECT pg_temp.cleanup_csf_activity_partner_receipts();
COMMIT;
SELECT pg_temp.cleanup_csf_activity_partner_fixtures();

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fa000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'activity-controls-admin@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'activity-controls-create@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'activity-controls-update@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'activity-controls-status@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'activity-controls-link@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'activity-controls-partner@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'activity-controls-other-admin@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'activity-controls-standing@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'activity-controls-policy@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'activity-controls-retry@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'activity-controls-representative-assign@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'activity-controls-representative-revoke@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('fa100000-0000-4000-8000-000000000001', 'Activity Authorization Controls', 'activity-authorization-controls', 'school', '996501'),
  ('fa100000-0000-4000-8000-000000000002', 'Independent Activity Controls', 'independent-activity-controls', 'school', '996502');

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000003', 'member', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000004', 'member', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000005', 'member', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000006', 'member', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000008', 'member', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000009', 'member', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000010', 'member', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000011', 'member', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000012', 'member', 'active'),
  ('fa100000-0000-4000-8000-000000000002', 'fa000000-0000-4000-8000-000000000007', 'admin', 'active');

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, public_title,
  responsibility_label, description, role_type, is_system, sort_order
) VALUES
  ('fa700000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'activity-controls-create', 'Create officer', 'Create officer', 'Activity creation', 'Synthetic authorization-fence role.', 'custom', false, 501),
  ('fa700000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'activity-controls-update', 'Update officer', 'Update officer', 'Activity updates', 'Synthetic authorization-fence role.', 'custom', false, 502),
  ('fa700000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', 'activity-controls-status', 'Status officer', 'Status officer', 'Activity status', 'Synthetic authorization-fence role.', 'custom', false, 503),
  ('fa700000-0000-4000-8000-000000000004', 'fa100000-0000-4000-8000-000000000001', 'activity-controls-link', 'Link officer', 'Link officer', 'Project links', 'Synthetic authorization-fence role.', 'custom', false, 504),
  ('fa700000-0000-4000-8000-000000000005', 'fa100000-0000-4000-8000-000000000001', 'activity-controls-partner', 'Partner officer', 'Partner officer', 'Partner clubs', 'Synthetic authorization-fence role.', 'custom', false, 505),
  ('fa700000-0000-4000-8000-000000000006', 'fa100000-0000-4000-8000-000000000001', 'activity-controls-standing', 'Standing officer', 'Standing officer', 'Club standing', 'Synthetic authorization-fence role.', 'custom', false, 506),
  ('fa700000-0000-4000-8000-000000000007', 'fa100000-0000-4000-8000-000000000001', 'activity-controls-policy', 'Policy officer', 'Policy officer', 'Club policy', 'Synthetic authorization-fence role.', 'custom', false, 507),
  ('fa700000-0000-4000-8000-000000000008', 'fa100000-0000-4000-8000-000000000001', 'activity-controls-retry', 'Retry officer', 'Retry officer', 'Activity retries', 'Synthetic authorization-fence role.', 'custom', false, 508),
  ('fa700000-0000-4000-8000-000000000009', 'fa100000-0000-4000-8000-000000000001', 'activity-controls-representative-assign', 'Representative assignment officer', 'Representative assignment officer', 'Representative assignments', 'Synthetic authorization-fence role.', 'custom', false, 509),
  ('fa700000-0000-4000-8000-000000000010', 'fa100000-0000-4000-8000-000000000001', 'activity-controls-representative-revoke', 'Representative revocation officer', 'Representative revocation officer', 'Representative revocations', 'Synthetic authorization-fence role.', 'custom', false, 510);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES
  ('fa100000-0000-4000-8000-000000000001', 'fa700000-0000-4000-8000-000000000001', 'manage_opportunities', true),
  ('fa100000-0000-4000-8000-000000000001', 'fa700000-0000-4000-8000-000000000002', 'manage_opportunities', true),
  ('fa100000-0000-4000-8000-000000000001', 'fa700000-0000-4000-8000-000000000003', 'manage_opportunities', true),
  ('fa100000-0000-4000-8000-000000000001', 'fa700000-0000-4000-8000-000000000004', 'manage_opportunities', true),
  ('fa100000-0000-4000-8000-000000000001', 'fa700000-0000-4000-8000-000000000005', 'manage_partner_clubs', true),
  ('fa100000-0000-4000-8000-000000000001', 'fa700000-0000-4000-8000-000000000006', 'manage_partner_clubs', true),
  ('fa100000-0000-4000-8000-000000000001', 'fa700000-0000-4000-8000-000000000007', 'manage_partner_clubs', true),
  ('fa100000-0000-4000-8000-000000000001', 'fa700000-0000-4000-8000-000000000008', 'manage_opportunities', true),
  ('fa100000-0000-4000-8000-000000000001', 'fa700000-0000-4000-8000-000000000009', 'manage_partner_clubs', true),
  ('fa100000-0000-4000-8000-000000000001', 'fa700000-0000-4000-8000-000000000010', 'manage_partner_clubs', true);

INSERT INTO plugin_data.csf_staff_positions (
  id, organization_id, user_id, role_id, school_year,
  display_title, status, starts_at, ends_at
) VALUES
  ('fa800000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000002', 'fa700000-0000-4000-8000-000000000001', '2040-2041', 'Create officer', 'active', current_date - 1, current_date + 30),
  ('fa800000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000003', 'fa700000-0000-4000-8000-000000000002', '2040-2041', 'Update officer', 'active', current_date - 1, current_date + 30),
  ('fa800000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000004', 'fa700000-0000-4000-8000-000000000003', '2040-2041', 'Status officer', 'active', current_date - 1, current_date + 30),
  ('fa800000-0000-4000-8000-000000000004', 'fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000005', 'fa700000-0000-4000-8000-000000000004', '2040-2041', 'Link officer', 'active', current_date - 1, current_date + 30),
  ('fa800000-0000-4000-8000-000000000005', 'fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000006', 'fa700000-0000-4000-8000-000000000005', '2040-2041', 'Partner officer', 'active', current_date - 1, current_date + 30),
  ('fa800000-0000-4000-8000-000000000006', 'fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000008', 'fa700000-0000-4000-8000-000000000006', '2040-2041', 'Standing officer', 'active', current_date - 1, current_date + 30),
  ('fa800000-0000-4000-8000-000000000007', 'fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000009', 'fa700000-0000-4000-8000-000000000007', '2040-2041', 'Policy officer', 'active', current_date - 1, current_date + 30),
  ('fa800000-0000-4000-8000-000000000008', 'fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000010', 'fa700000-0000-4000-8000-000000000008', '2040-2041', 'Retry officer', 'active', current_date - 1, current_date + 30),
  ('fa800000-0000-4000-8000-000000000009', 'fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000011', 'fa700000-0000-4000-8000-000000000009', '2040-2041', 'Representative assignment officer', 'active', current_date - 1, current_date + 30),
  ('fa800000-0000-4000-8000-000000000010', 'fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000012', 'fa700000-0000-4000-8000-000000000010', '2040-2041', 'Representative revocation officer', 'active', current_date - 1, current_date + 30);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES
  ('fa200000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'F40', 'Fall 2040', '2040-2041', 'fall', 'open', true),
  ('fa200000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000002', 'F40', 'Fall 2040', '2040-2041', 'fall', 'open', true);

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description,
  event_type, verification_method, schedule, require_login
) VALUES
  ('fa400000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'Fence Project', 'Local', 'Synthetic project.', 'single', 'manual', '{}'::jsonb, true),
  ('fa400000-0000-4000-8000-000000000002', 'fa000000-0000-4000-8000-000000000007', 'fa100000-0000-4000-8000-000000000002', 'Independent Project', 'Local', 'Synthetic project.', 'single', 'manual', '{}'::jsonb, true);

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, title, body, starts_at, status,
  signup_mode, created_by_user_id
) VALUES
  ('fa500000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'Update unchanged', 'Update unchanged', '2040-09-10 17:00:00+00', 'draft', 'none', 'fa000000-0000-4000-8000-000000000001'),
  ('fa500000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'Status unchanged', 'Status unchanged', '2040-09-11 17:00:00+00', 'draft', 'none', 'fa000000-0000-4000-8000-000000000001'),
  ('fa500000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'Link unchanged', 'Link unchanged', '2040-09-12 17:00:00+00', 'draft', 'none', 'fa000000-0000-4000-8000-000000000001');

INSERT INTO plugin_data.csf_partner_clubs (
  id, organization_id, name, status, created_by
) VALUES
  ('fa600000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'Fence Club', 'active', 'fa000000-0000-4000-8000-000000000001'),
  ('fa600000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000002', 'Independent Club', 'active', 'fa000000-0000-4000-8000-000000000007'),
  ('fa600000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', 'Standing Fence Club', 'active', 'fa000000-0000-4000-8000-000000000001');

INSERT INTO plugin_data.csf_partner_club_terms (
  id, organization_id, partner_club_id, term_id, relationship_status,
  workflow_status, approved_point_types, non_drive_points, drive_points,
  proof_required
) VALUES
  ('fab00000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'fa600000-0000-4000-8000-000000000003', 'fa200000-0000-4000-8000-000000000001', 'new', 'active', ARRAY['non_drive']::text[], 2, 0, true);

INSERT INTO plugin_data.csf_partner_club_representatives (
  id, organization_id, partner_club_term_id, role, display_name, email,
  status, effective_start, is_primary, created_by, metadata
) VALUES (
  'fac00000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'fab00000-0000-4000-8000-000000000001',
  'coordinator',
  'Revocation Target',
  'revocation-target@local.test',
  'invited',
  current_date,
  false,
  'fa000000-0000-4000-8000-000000000001',
  '{}'::jsonb
);

CREATE TEMP TABLE csf_activity_partner_controls_results (
  key text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT PRESERVE ROWS;

CREATE FUNCTION pg_temp.wait_for_csf_activity_partner_lock(p_marker text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_waiting boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '5 seconds';
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity AS activity
      WHERE activity.pid <> pg_catalog.pg_backend_pid()
        AND activity.query LIKE '%' || p_marker || '%'
        AND activity.wait_event_type = 'Lock'
        AND activity.wait_event = 'advisory'
    )
    INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  RETURN v_waiting;
END;
$$;

CREATE FUNCTION pg_temp.wait_for_csf_activity_partner_result(p_connection text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_complete boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '5 seconds';
BEGIN
  LOOP
    v_complete := extensions.dblink_is_busy(p_connection) = 0;
    EXIT WHEN v_complete OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  RETURN v_complete;
END;
$$;

CREATE FUNCTION pg_temp.csf_activity_partner_controls_dsn()
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


-- Establish a committed receipt whose exact replay must later be denied.
INSERT INTO csf_activity_partner_controls_results (key, payload)
SELECT 'authorized_replay_baseline', plugin_data.csf_create_activity(
  'fa100000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000001',
  NULL,
  '{"title":"Authorized replay baseline","startsAt":"2040-09-20T17:00:00Z","status":"draft","signupMode":"none"}'::jsonb,
  'fa000000-0000-4000-8000-000000000002',
  'faa00000-0000-4000-8000-000000000000'
);

-- Remove the baseline actor's permission before the replay control.
SELECT plugin_data.csf_update_role(
  'fa100000-0000-4000-8000-000000000001',
  'fa700000-0000-4000-8000-000000000001',
  'Create officer', 'Activity creation',
  'Permission revoked before the authorization replay control.',
  ARRAY[]::text[], NULL,
  'fa000000-0000-4000-8000-000000000001'
);

-- 1-5: representative assignment queued behind a role-permission edit.
SELECT extensions.ok(
  plugin_data.csf_actor_has_permission(
    'fa100000-0000-4000-8000-000000000001',
    'fa000000-0000-4000-8000-000000000011',
    'manage_partner_clubs'
  ),
  'the assignment actor is authorized before the concurrent role edit'
);
SELECT extensions.dblink_connect(
  'representative_assignment_role_revoked',
  pg_temp.csf_activity_partner_controls_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('fa100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'representative_assignment_role_revoked',
  $query$
    SELECT plugin_data.csf_assign_partner_representative(
      'fa100000-0000-4000-8000-000000000001'::uuid,
      'fab00000-0000-4000-8000-000000000001'::uuid,
      'Queued Assignment',
      'queued-assignment@local.test',
      'coordinator',
      current_date,
      false,
      'faa00000-0000-4000-8000-000000000008'::uuid,
      'fa000000-0000-4000-8000-000000000011'::uuid
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_lock('faa00000-0000-4000-8000-000000000008'),
  'the queued assignment passes its first check and waits on the staff-access lock'
);
SELECT plugin_data.csf_update_role(
  'fa100000-0000-4000-8000-000000000001',
  'fa700000-0000-4000-8000-000000000009',
  'Representative assignment officer', 'Representative assignments',
  'Permission revoked while a representative assignment waits.',
  ARRAY[]::text[], NULL,
  'fa000000-0000-4000-8000-000000000001'
);
COMMIT;
SELECT *
FROM extensions.dblink_get_result('representative_assignment_role_revoked', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF partner clubs.'
    IN extensions.dblink_error_message('representative_assignment_role_revoked')
  ) > 0,
  'the queued assignment fails after the role edit commits'
);
SELECT extensions.dblink_disconnect('representative_assignment_role_revoked');
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_partner_club_representatives
   WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
     AND normalized_email = 'queued-assignment@local.test')
  + (SELECT count(*)::integer
     FROM plugin_data.csf_partner_club_term_events
     WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
       AND idempotency_key = 'representative:assignment-request:faa00000-0000-4000-8000-000000000008')
  + (SELECT count(*)::integer
     FROM plugin_data.csf_admin_audit_events
     WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
       AND actor_user_id = 'fa000000-0000-4000-8000-000000000011'
       AND action = 'partner_representative.assign'),
  0,
  'the revoked queued assignment writes no representative, lifecycle event, or audit receipt'
);
SELECT extensions.is(
  (SELECT enabled::text
   FROM plugin_data.csf_role_permissions
   WHERE role_id = 'fa700000-0000-4000-8000-000000000009'
     AND permission_key = 'manage_partner_clubs'),
  'false',
  'the assignment actor role edit committed before the queued call resumed'
);

-- 6-10: representative revocation queued behind a staff-position revocation.
SELECT extensions.ok(
  plugin_data.csf_actor_has_permission(
    'fa100000-0000-4000-8000-000000000001',
    'fa000000-0000-4000-8000-000000000012',
    'manage_partner_clubs'
  ),
  'the revocation actor is authorized before the concurrent position revocation'
);
SELECT extensions.dblink_connect(
  'representative_revocation_position_revoked',
  pg_temp.csf_activity_partner_controls_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('fa100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'representative_revocation_position_revoked',
  $query$
    SELECT plugin_data.csf_revoke_partner_representative(
      'fa100000-0000-4000-8000-000000000001'::uuid,
      'fac00000-0000-4000-8000-000000000001'::uuid,
      'fab00000-0000-4000-8000-000000000001'::uuid,
      'Revocation queued behind a concurrent position revocation.',
      'faa00000-0000-4000-8000-000000000009'::uuid,
      'fa000000-0000-4000-8000-000000000012'::uuid
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_lock('faa00000-0000-4000-8000-000000000009'),
  'the queued revocation passes its first check and waits on the staff-access lock'
);
SELECT plugin_data.csf_revoke_staff_position(
  'fa100000-0000-4000-8000-000000000001',
  'fa800000-0000-4000-8000-000000000010',
  NULL,
  'Revoke the queued representative-revocation actor position',
  'fa000000-0000-4000-8000-000000000001'
);
COMMIT;
SELECT *
FROM extensions.dblink_get_result('representative_revocation_position_revoked', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF partner clubs.'
    IN extensions.dblink_error_message('representative_revocation_position_revoked')
  ) > 0,
  'the queued revocation fails after the position revocation commits'
);
SELECT extensions.dblink_disconnect('representative_revocation_position_revoked');
SELECT extensions.ok(
  (SELECT status = 'invited' AND effective_end IS NULL
   FROM plugin_data.csf_partner_club_representatives
   WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
     AND id = 'fac00000-0000-4000-8000-000000000001')
  AND (
    (SELECT count(*)
     FROM plugin_data.csf_partner_club_term_events
     WHERE correlation_id = 'faa00000-0000-4000-8000-000000000009')
    + (SELECT count(*)
       FROM plugin_data.csf_admin_audit_events
       WHERE correlation_id = 'faa00000-0000-4000-8000-000000000009')
  ) = 0,
  'the revoked queued revocation leaves the assignment unchanged and writes no lifecycle or audit receipt'
);
SELECT extensions.is(
  (SELECT status
   FROM plugin_data.csf_staff_positions
   WHERE id = 'fa800000-0000-4000-8000-000000000010'),
  'ended',
  'the revocation actor position revocation committed before the queued call resumed'
);

-- 11-13: the actor membership row is genuinely held for the whole transaction,
-- not merely re-read. A concurrent deactivation must block behind the share
-- lock while an open wrapper transaction is still uncommitted.
SELECT extensions.dblink_connect(
  'membership_share_hold',
  pg_temp.csf_activity_partner_controls_dsn()
);
SELECT extensions.dblink_exec('membership_share_hold', 'BEGIN');
SELECT *
FROM extensions.dblink(
  'membership_share_hold',
  $query$
    SELECT plugin_data.csf_create_activity(
      'fa100000-0000-4000-8000-000000000001'::uuid,
      'fa200000-0000-4000-8000-000000000001'::uuid,
      NULL,
      '{"title":"Share lock hold","startsAt":"2040-09-25T17:00:00Z","status":"draft","signupMode":"none"}'::jsonb,
      'fa000000-0000-4000-8000-000000000010'::uuid,
      'faa00000-0000-4000-8000-000000000040'::uuid
    )::text
  $query$
) AS held(payload text);
SET lock_timeout = '750ms';
SELECT extensions.throws_ok(
  $$
    UPDATE public.organization_members
    SET status = 'inactive'
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND user_id = 'fa000000-0000-4000-8000-000000000010'
  $$,
  '55P03',
  'canceling statement due to lock timeout',
  'a concurrent membership deactivation blocks while the wrapper holds the actor membership row'
);
RESET lock_timeout;
SELECT extensions.dblink_exec('membership_share_hold', 'ROLLBACK');
SELECT extensions.dblink_disconnect('membership_share_hold');
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_opportunities
   WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
     AND title = 'Share lock hold'),
  0,
  'the rolled-back share-lock transaction leaves no activity behind'
);
SELECT extensions.is(
  (SELECT status
   FROM public.organization_members
   WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
     AND user_id = 'fa000000-0000-4000-8000-000000000010'),
  'active',
  'the blocked deactivation left the retry actor membership active'
);

-- 14-17: a still-authorized queued call is not denied, and its exact retry is
-- still idempotent through the wrapper.
SELECT extensions.dblink_connect(
  'activity_retry_after_benign_edit',
  pg_temp.csf_activity_partner_controls_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('fa100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'activity_retry_after_benign_edit',
  $query$
    SELECT plugin_data.csf_create_activity(
      'fa100000-0000-4000-8000-000000000001'::uuid,
      'fa200000-0000-4000-8000-000000000001'::uuid,
      NULL,
      '{"title":"Retry queued create","startsAt":"2040-09-26T17:00:00Z","status":"draft","signupMode":"none"}'::jsonb,
      'fa000000-0000-4000-8000-000000000010'::uuid,
      'faa00000-0000-4000-8000-000000000030'::uuid
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_lock('faa00000-0000-4000-8000-000000000030'),
  'the still-authorized queued create waits on the staff-access lock'
);
SELECT plugin_data.csf_update_role(
  'fa100000-0000-4000-8000-000000000001',
  'fa700000-0000-4000-8000-000000000008',
  'Retry officer', 'Activity retries',
  'A benign staff edit that keeps the queued permission.',
  ARRAY['manage_opportunities']::text[], NULL,
  'fa000000-0000-4000-8000-000000000001'
);
COMMIT;
INSERT INTO csf_activity_partner_controls_results (key, payload)
SELECT 'retry_first', payload::jsonb
FROM extensions.dblink_get_result('activity_retry_after_benign_edit', false)
  AS result(payload text);
SELECT extensions.dblink_disconnect('activity_retry_after_benign_edit');
SELECT extensions.is(
  (SELECT payload ->> 'idempotent'
   FROM csf_activity_partner_controls_results
   WHERE key = 'retry_first'),
  'false',
  'a benign concurrent staff edit does not deny the still-authorized queued create'
);
INSERT INTO csf_activity_partner_controls_results (key, payload)
SELECT 'retry_second', plugin_data.csf_create_activity(
  'fa100000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000001',
  NULL,
  '{"title":"Retry queued create","startsAt":"2040-09-26T17:00:00Z","status":"draft","signupMode":"none"}'::jsonb,
  'fa000000-0000-4000-8000-000000000010',
  'faa00000-0000-4000-8000-000000000030'
);
SELECT extensions.ok(
  (
    SELECT (payload ->> 'idempotent')::boolean
    FROM csf_activity_partner_controls_results
    WHERE key = 'retry_second'
  )
  AND (
    SELECT first.payload ->> 'activityId' = second.payload ->> 'activityId'
    FROM csf_activity_partner_controls_results AS first
    CROSS JOIN csf_activity_partner_controls_results AS second
    WHERE first.key = 'retry_first'
      AND second.key = 'retry_second'
  ),
  'the exact retry of a committed request still returns its idempotent receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_opportunities
   WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
     AND title = 'Retry queued create')
  + (SELECT count(*)::integer
     FROM plugin_data.csf_admin_audit_events
     WHERE correlation_id = 'faa00000-0000-4000-8000-000000000030'),
  2,
  'the retried request leaves exactly one target row and one audit receipt'
);

-- 18-20: replay lookup never bypasses current authorization. The committed
-- outcome stays durable; only re-reading it through this boundary is denied.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_activity(
      'fa100000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000001',
      NULL,
      '{"title":"Authorized replay baseline","startsAt":"2040-09-20T17:00:00Z","status":"draft","signupMode":"none"}'::jsonb,
      'fa000000-0000-4000-8000-000000000002',
      'faa00000-0000-4000-8000-000000000000'
    )
  $$,
  'P0001',
  'Not authorized to manage CSF activities.',
  'an exact committed replay is denied after the actor loses permission'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_opportunities
   WHERE id = (
     SELECT (payload ->> 'activityId')::uuid
     FROM csf_activity_partner_controls_results
     WHERE key = 'authorized_replay_baseline'
   )
     AND title = 'Authorized replay baseline'),
  1,
  'the denied replay leaves the committed activity unchanged'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'faa00000-0000-4000-8000-000000000000'),
  1,
  'the denied replay leaves exactly the original audit receipt'
);

-- 21-23: active organization admins retain the unchanged nine-RPC semantics.
INSERT INTO csf_activity_partner_controls_results (key, payload)
VALUES
  (
    'admin_create',
    plugin_data.csf_create_activity(
      'fa100000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000001',
      NULL,
      '{"title":"Admin created","startsAt":"2040-09-23T17:00:00Z","status":"draft","signupMode":"none"}'::jsonb,
      'fa000000-0000-4000-8000-000000000001',
      'faa00000-0000-4000-8000-000000000011'
    )
  ),
  (
    'admin_update',
    plugin_data.csf_update_activity(
      'fa100000-0000-4000-8000-000000000001',
      'fa500000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000001',
      NULL,
      '{"title":"Admin updated","startsAt":"2040-09-24T17:00:00Z","signupMode":"none"}'::jsonb,
      'fa000000-0000-4000-8000-000000000001',
      'faa00000-0000-4000-8000-000000000012'
    )
  ),
  (
    'admin_status',
    plugin_data.csf_set_activity_status(
      'fa100000-0000-4000-8000-000000000001',
      'fa500000-0000-4000-8000-000000000002',
      'published', NULL,
      'fa000000-0000-4000-8000-000000000001',
      'faa00000-0000-4000-8000-000000000013'
    )
  ),
  (
    'admin_link',
    plugin_data.csf_link_activity_project(
      'fa100000-0000-4000-8000-000000000001',
      'fa500000-0000-4000-8000-000000000003',
      'fa400000-0000-4000-8000-000000000001',
      'fa000000-0000-4000-8000-000000000001',
      'faa00000-0000-4000-8000-000000000014'
    )
  ),
  (
    'admin_partner',
    plugin_data.csf_set_partner_club_status(
      'fa100000-0000-4000-8000-000000000001',
      'fa600000-0000-4000-8000-000000000001',
      'inactive',
      'fa000000-0000-4000-8000-000000000001',
      'faa00000-0000-4000-8000-000000000015'
    )
  ),
  (
    'admin_standing',
    plugin_data.csf_set_partner_club_term_status(
      'fa100000-0000-4000-8000-000000000001',
      'fab00000-0000-4000-8000-000000000001',
      'inactive',
      'Admin standing change.',
      'fa000000-0000-4000-8000-000000000001',
      'faa00000-0000-4000-8000-000000000016'
    )
  ),
  (
    'admin_policy',
    plugin_data.csf_upsert_partner_club_policy(
      'fa100000-0000-4000-8000-000000000001',
      'fa000000-0000-4000-8000-000000000001',
      'faa00000-0000-4000-8000-000000000017',
      '{"termId":"fa200000-0000-4000-8000-000000000001","termStatus":"new","name":"Admin policy club","approvedPointTypes":["non_drive"],"nonDrivePoints":"3","drivePoints":"0","proofRequired":"true"}'::jsonb
    )
  ),
  (
    'admin_representative_assign',
    plugin_data.csf_assign_partner_representative(
      'fa100000-0000-4000-8000-000000000001',
      'fab00000-0000-4000-8000-000000000001',
      'Admin Assigned Representative',
      'admin-assigned-representative@local.test',
      'coordinator',
      current_date,
      false,
      'faa00000-0000-4000-8000-000000000018',
      'fa000000-0000-4000-8000-000000000001'
    )
  ),
  (
    'admin_representative_revoke',
    plugin_data.csf_revoke_partner_representative(
      'fa100000-0000-4000-8000-000000000001',
      'fac00000-0000-4000-8000-000000000001',
      'fab00000-0000-4000-8000-000000000001',
      'Admin revocation control proves unchanged representative semantics.',
      'faa00000-0000-4000-8000-000000000019',
      'fa000000-0000-4000-8000-000000000001'
    )
  );
SELECT extensions.ok(
  (
    SELECT count(*) = 9
      AND bool_and((payload ->> 'idempotent')::boolean = false)
    FROM csf_activity_partner_controls_results
    WHERE key LIKE 'admin_%'
  ),
  'the active admin receives the unchanged non-idempotent result contract from all nine RPCs'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_opportunities
    WHERE id = (
      SELECT (payload ->> 'activityId')::uuid
      FROM csf_activity_partner_controls_results
      WHERE key = 'admin_create'
    )
      AND title = 'Admin created'
  )
  AND (
    SELECT title = 'Admin updated'
    FROM plugin_data.csf_opportunities
    WHERE id = 'fa500000-0000-4000-8000-000000000001'
  )
  AND (
    SELECT status = 'published'
    FROM plugin_data.csf_opportunities
    WHERE id = 'fa500000-0000-4000-8000-000000000002'
  )
  AND (
    SELECT linked_project_id = 'fa400000-0000-4000-8000-000000000001'
      AND signup_mode = 'lets_assist_project'
    FROM plugin_data.csf_opportunities
    WHERE id = 'fa500000-0000-4000-8000-000000000003'
  )
  AND (
    SELECT status = 'inactive'
    FROM plugin_data.csf_partner_clubs
    WHERE id = 'fa600000-0000-4000-8000-000000000001'
  )
  AND (
    SELECT workflow_status = 'inactive'
    FROM plugin_data.csf_partner_club_terms
    WHERE id = 'fab00000-0000-4000-8000-000000000001'
  )
  AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_partner_club_terms AS term
    JOIN plugin_data.csf_partner_clubs AS club
      ON club.organization_id = term.organization_id
     AND club.id = term.partner_club_id
    WHERE term.id = (
      SELECT (payload ->> 'partnerClubTermId')::uuid
      FROM csf_activity_partner_controls_results
      WHERE key = 'admin_policy'
    )
      AND club.name = 'Admin policy club'
      AND term.workflow_status = 'active'
  )
  AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_partner_club_representatives AS representative
    WHERE representative.id = (
      SELECT (payload ->> 'assignmentId')::uuid
      FROM csf_activity_partner_controls_results
      WHERE key = 'admin_representative_assign'
    )
      AND representative.organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND representative.partner_club_term_id = 'fab00000-0000-4000-8000-000000000001'
      AND representative.normalized_email = 'admin-assigned-representative@local.test'
      AND representative.status = 'invited'
  )
  AND (
    SELECT status = 'revoked'
      AND effective_end IS NOT NULL
    FROM plugin_data.csf_partner_club_representatives
    WHERE id = 'fac00000-0000-4000-8000-000000000001'
  ),
  'the active admin preserves each target mutation semantics'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id IN (
     'faa00000-0000-4000-8000-000000000011',
     'faa00000-0000-4000-8000-000000000012',
     'faa00000-0000-4000-8000-000000000013',
     'faa00000-0000-4000-8000-000000000014',
     'faa00000-0000-4000-8000-000000000015',
     'faa00000-0000-4000-8000-000000000016',
     'faa00000-0000-4000-8000-000000000017',
     'faa00000-0000-4000-8000-000000000019'
   ))
  + (SELECT count(*)::integer
     FROM plugin_data.csf_admin_audit_events
     WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
       AND actor_user_id = 'fa000000-0000-4000-8000-000000000001'
       AND action = 'partner_representative.assign'
       AND target_id = (
         SELECT (payload ->> 'assignmentId')::uuid
         FROM csf_activity_partner_controls_results
         WHERE key = 'admin_representative_assign'
       )),
  9,
  'the nine admin mutations retain one immutable receipt apiece'
);

-- 24-26: an organization A staff lock cannot block organization B.
SELECT extensions.dblink_connect(
  'activity_partner_cross_org',
  pg_temp.csf_activity_partner_controls_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('fa100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'activity_partner_cross_org',
  $query$
    SELECT plugin_data.csf_set_partner_club_status(
      'fa100000-0000-4000-8000-000000000002'::uuid,
      'fa600000-0000-4000-8000-000000000002'::uuid,
      'inactive',
      'fa000000-0000-4000-8000-000000000007'::uuid,
      'faa00000-0000-4000-8000-000000000020'::uuid
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_result('activity_partner_cross_org'),
  'a cross-organization wrapper completes while the first organization lock is held'
);
COMMIT;
INSERT INTO csf_activity_partner_controls_results (key, payload)
SELECT 'cross_org', payload::jsonb
FROM extensions.dblink_get_result('activity_partner_cross_org', false)
  AS result(payload text);
SELECT extensions.is(
  (SELECT payload ->> 'idempotent'
   FROM csf_activity_partner_controls_results
   WHERE key = 'cross_org'),
  'false',
  'the independent organization receives its committed result before lock release'
);
SELECT extensions.dblink_disconnect('activity_partner_cross_org');
SELECT extensions.ok(
  (
    SELECT status = 'inactive'
    FROM plugin_data.csf_partner_clubs
    WHERE id = 'fa600000-0000-4000-8000-000000000002'
  )
  AND (
    SELECT count(*) = 1
    FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'faa00000-0000-4000-8000-000000000020'
  ),
  'the cross-organization call commits its target and one audit receipt'
);

-- Remove every durable synthetic fixture so later files in the same isolated
-- replay remain independent. The preflight call above recovers interrupted
-- runs; SET LOCAL always restores session_replication_role before ordinary FK
-- cleanup, including if the receipt deletion transaction rolls back.
BEGIN;
SET LOCAL session_replication_role = replica;
SELECT pg_temp.cleanup_csf_activity_partner_receipts();
COMMIT;
SELECT pg_temp.cleanup_csf_activity_partner_fixtures();

DROP TABLE csf_activity_partner_controls_results;

SELECT * FROM extensions.finish();
