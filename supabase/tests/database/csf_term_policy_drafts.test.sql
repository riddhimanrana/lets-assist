BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(55);

SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'plugin_data.csf_term_policy_drafts'::regclass)
  AND NOT has_table_privilege('authenticated', 'plugin_data.csf_term_policy_drafts', 'SELECT'),
  'term policy drafts remain server-only behind RLS'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_save_term_policy_draft(uuid,uuid,integer,numeric,numeric,numeric,integer,integer,boolean,boolean,jsonb,boolean,numeric,text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot save term policy drafts'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_save_term_policy_draft(uuid,uuid,integer,numeric,numeric,numeric,integer,integer,boolean,boolean,jsonb,boolean,numeric,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot save term policy drafts'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_save_term_policy_draft(uuid,uuid,integer,numeric,numeric,numeric,integer,integer,boolean,boolean,jsonb,boolean,numeric,text,uuid)',
    'EXECUTE'
  ),
  'the server role can invoke the authorized draft save boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_publish_term_policy(uuid,uuid,integer,integer,text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot publish term policy drafts'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_publish_term_policy(uuid,uuid,integer,integer,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot publish term policy drafts'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_publish_term_policy(uuid,uuid,integer,integer,text,uuid)',
    'EXECUTE'
  ),
  'the server role can invoke the adviser-authorized publish boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_discard_term_policy_draft(uuid,uuid,integer,text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot discard term policy drafts'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_discard_term_policy_draft(uuid,uuid,integer,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot discard term policy drafts'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_discard_term_policy_draft(uuid,uuid,integer,text,uuid)',
    'EXECUTE'
  ),
  'the server role can invoke the authorized discard boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_update_term_policy(uuid,uuid,numeric,numeric,numeric,integer,integer,boolean,uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass drafts through the first legacy policy function'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_update_term_policy_v2(uuid,uuid,numeric,numeric,numeric,integer,integer,boolean,jsonb,boolean,numeric,text,uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass drafts through the complete legacy policy function'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'policy-admin@local.test', now(), '{}', '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'policy-adviser@local.test', now(), '{}', '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'policy-editor@local.test', now(), '{}', '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'policy-outsider@local.test', now(), '{}', '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'policy-inactive-admin@local.test', now(), '{}', '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'policy-other-admin@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('d1000000-0000-4000-8000-000000000001', 'CSF Policy Draft A', 'csf-policy-draft-a', 'school', '991201'),
  ('d1000000-0000-4000-8000-000000000002', 'CSF Policy Draft B', 'csf-policy-draft-b', 'school', '991202');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'staff', 'active'),
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'staff', 'active'),
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'staff', 'active'),
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'admin', 'inactive'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000006', 'admin', 'active');

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, public_title,
  role_type, is_system, sort_order
) VALUES
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'advisor', 'Adviser', 'Adviser', 'officer_template', true, 10),
  ('d2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'co-president', 'Co-President', 'Co-President', 'officer_template', true, 20),
  ('d2000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'policy-observer', 'Policy observer', 'Policy observer', 'custom', false, 500);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'manage_settings', true),
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002', 'manage_settings', true);

INSERT INTO plugin_data.csf_staff_positions (
  id, organization_id, user_id, role_id, school_year,
  display_title, status
) VALUES
  ('d2100000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', '2026-2027', 'Adviser', 'active'),
  ('d2100000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000002', '2026-2027', 'Co-President', 'active'),
  ('d2100000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000003', '2026-2027', 'Policy observer', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, lifecycle_status
) VALUES
  ('d3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'S26', 'Spring 2026', '2025-2026', 'spring', 'open'),
  ('d3000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'F26', 'Fall 2026', '2026-2027', 'fall', 'planned'),
  ('d3000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000002', 'F26', 'Fall 2026', '2026-2027', 'fall', 'planned');

INSERT INTO plugin_data.csf_term_policies (
  id, organization_id, term_id, policy_version,
  total_points_required, max_drive_points, max_points_per_activity,
  required_meetings, allowed_absences, allow_point_carryover,
  outside_volunteering_allowed, academic_rules,
  dues_required, dues_amount, dues_currency, created_by, updated_by
) VALUES (
  'd4000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  1, 7, 2, 3, 3, 1, false, false,
  '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"bonusPointLimit":2,"disqualifyingGrades":["D","F"]}'::jsonb,
  true, 5, 'USD',
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001'
);

SELECT extensions.ok(
  plugin_data.csf_actor_can_edit_term_policy_draft('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  'an active organization admin can edit policy drafts'
);
SELECT extensions.ok(
  plugin_data.csf_actor_can_edit_term_policy_draft('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003'),
  'active staff with manage_settings can edit policy drafts'
);
SELECT extensions.ok(
  NOT plugin_data.csf_actor_can_edit_term_policy_draft('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004'),
  'staff without manage_settings cannot edit policy drafts'
);
SELECT extensions.ok(
  NOT plugin_data.csf_actor_can_edit_term_policy_draft('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005'),
  'an inactive organization admin cannot edit policy drafts'
);
SELECT extensions.ok(
  plugin_data.csf_actor_can_publish_term_policy('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  'an active organization admin can publish policy drafts'
);
SELECT extensions.ok(
  plugin_data.csf_actor_can_publish_term_policy('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002'),
  'an active adviser with active host membership can publish policy drafts'
);
UPDATE plugin_data.csf_staff_positions
SET ends_at = (now() AT TIME ZONE 'America/Los_Angeles')::date - 1
WHERE id = 'd2100000-0000-4000-8000-000000000001';
SELECT extensions.ok(
  NOT plugin_data.csf_actor_can_edit_term_policy_draft('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002')
  AND NOT plugin_data.csf_actor_can_publish_term_policy('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002'),
  'an adviser position that ended before the current Los Angeles date cannot edit or publish policy'
);
UPDATE plugin_data.csf_staff_positions
SET ends_at = NULL
WHERE id = 'd2100000-0000-4000-8000-000000000001';
UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'd1000000-0000-4000-8000-000000000001'
  AND user_id = 'd0000000-0000-4000-8000-000000000002';
SELECT extensions.ok(
  NOT plugin_data.csf_actor_can_edit_term_policy_draft('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002')
  AND NOT plugin_data.csf_actor_can_publish_term_policy('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002'),
  'an active adviser position cannot edit or publish after host membership becomes inactive'
);
UPDATE public.organization_members
SET status = 'active'
WHERE organization_id = 'd1000000-0000-4000-8000-000000000001'
  AND user_id = 'd0000000-0000-4000-8000-000000000002';
SELECT extensions.ok(
  NOT plugin_data.csf_actor_can_publish_term_policy('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003'),
  'a Co-President cannot publish policy drafts'
);
SELECT extensions.ok(
  NOT plugin_data.csf_actor_can_publish_term_policy('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005'),
  'an inactive organization admin cannot publish policy drafts'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_save_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002',
      0, 7, 2, 3, 3, 1, false, false,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"disqualifyingGrades":["D","F"]}'::jsonb,
      true, 5, 'USD', 'd0000000-0000-4000-8000-000000000004'
    )
  $$,
  'P0001',
  'Not authorized to edit semester policy drafts.',
  'the save RPC enforces draft-edit authorization itself'
);

CREATE TEMP TABLE csf_term_policy_draft_results (
  kind text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT DROP;

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_term_policy_draft_results (kind, payload)
    SELECT 'future-draft', plugin_data.csf_save_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002',
      0, 7, 2, 3, 3, 1, false, false,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"disqualifyingGrades":["D","F"]}'::jsonb,
      true, 5, 'usd', 'd0000000-0000-4000-8000-000000000001'
    )
  $$,
  'an authorized admin can save the Fall 2026 carry-forward as a draft'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_policies
    WHERE organization_id = 'd1000000-0000-4000-8000-000000000001'
      AND term_id = 'd3000000-0000-4000-8000-000000000002'
  ),
  0,
  'saving a future policy draft does not create an operational published policy'
);
SELECT extensions.ok(
  (
    SELECT draft_revision = 1
      AND base_policy_version IS NULL
      AND outside_volunteering_allowed = false
      AND dues_currency = 'USD'
    FROM plugin_data.csf_term_policy_drafts
    WHERE organization_id = 'd1000000-0000-4000-8000-000000000001'
      AND term_id = 'd3000000-0000-4000-8000-000000000002'
  ),
  'the draft stores its revision, unpublished base, explicit outside-volunteering rule, and normalized currency'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1000000-0000-4000-8000-000000000001'
      AND term_id = 'd3000000-0000-4000-8000-000000000002'
      AND action = 'term_policy.draft_saved'
      AND reason_code = 'semester_policy_draft_saved'
  ),
  1,
  'saving a draft writes one correlated audit event'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_save_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002',
      0, 7, 2, 3, 3, 1, false, false,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"disqualifyingGrades":["D","F"]}'::jsonb,
      true, 5, 'USD', 'd0000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'The policy draft changed; refresh and try again.',
  'a stale draft revision cannot overwrite a newer draft'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_save_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002',
      1, 7, 2, 3, 3, 1, false, false,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"disqualifyingGrades":["D","F"]}'::jsonb,
      true, 5, NULL, 'd0000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Dues currency must be a three-letter code.',
  'a null dues currency is rejected explicitly'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_save_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002',
      1, 7, 2, 3, 3, 1, false, false,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"disqualifyingGrades":["D","F"]}'::jsonb,
      true, 5, 'US', 'd0000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Dues currency must be a three-letter code.',
  'an invalid dues currency is rejected before persistence'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_save_term_policy_draft(
      'd1000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000001',
      0, 7, 2, 3, 3, 1, false, false,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"disqualifyingGrades":["D","F"]}'::jsonb,
      true, 5, 'USD', 'd0000000-0000-4000-8000-000000000006'
    )
  $$,
  'P0001',
  'CSF semester not found.',
  'an admin cannot save a draft against another tenant term'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_term_policy_draft_results (kind, payload)
    SELECT 'spring-draft-v1', plugin_data.csf_save_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      0, 8, 2, 4, 4, 1, false, true,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"disqualifyingGrades":["D","F"]}'::jsonb,
      true, 5, 'USD', 'd0000000-0000-4000-8000-000000000003'
    )
  $$,
  'staff with manage_settings can save changes without publishing them'
);
SELECT extensions.ok(
  (
    SELECT draft.base_policy_version = 1
      AND draft.draft_revision = 1
      AND draft.total_points_required = 8
      AND draft.outside_volunteering_allowed = true
      AND published.policy_version = 1
      AND published.total_points_required = 7
      AND published.outside_volunteering_allowed = false
    FROM plugin_data.csf_term_policy_drafts AS draft
    JOIN plugin_data.csf_term_policies AS published
      ON published.organization_id = draft.organization_id
     AND published.term_id = draft.term_id
    WHERE draft.organization_id = 'd1000000-0000-4000-8000-000000000001'
      AND draft.term_id = 'd3000000-0000-4000-8000-000000000001'
  ),
  'operational policy remains unchanged while an updated draft is pending'
);

UPDATE plugin_data.csf_term_policies
SET policy_version = 2,
    total_points_required = 8,
    updated_at = now()
WHERE organization_id = 'd1000000-0000-4000-8000-000000000001'
  AND term_id = 'd3000000-0000-4000-8000-000000000001';

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_term_policy_draft_results (kind, payload)
    SELECT 'spring-draft-v2', plugin_data.csf_save_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      1, 9, 2, 4, 4, 1, false, true,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"disqualifyingGrades":["D","F"]}'::jsonb,
      true, 5, 'USD', 'd0000000-0000-4000-8000-000000000003'
    )
  $$,
  'saving a refreshed draft rebases it onto the latest published version'
);
SELECT extensions.ok(
  (
    SELECT base_policy_version = 2
      AND draft_revision = 2
      AND total_points_required = 9
    FROM plugin_data.csf_term_policy_drafts
    WHERE organization_id = 'd1000000-0000-4000-8000-000000000001'
      AND term_id = 'd3000000-0000-4000-8000-000000000001'
  ),
  'the refreshed save records the current published version as its new base'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_publish_term_policy(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      2, 2, NULL, 'd0000000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'Only an adviser or organization admin can publish semester policy.',
  'the publish RPC rejects a Co-President even when they may edit the draft'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_publish_term_policy(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      NULL, 2, NULL, 'd0000000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'The policy draft changed; refresh and try again.',
  'a null expected draft revision cannot bypass optimistic concurrency'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_publish_term_policy(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      2, 1, NULL, 'd0000000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'The published policy changed; refresh the draft before publishing.',
  'a stale expected published version cannot be published'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_term_policy_draft_results (kind, payload)
    SELECT 'spring-published-v3', plugin_data.csf_publish_term_policy(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      2, 2, NULL, 'd0000000-0000-4000-8000-000000000002'
    )
  $$,
  'an adviser can atomically publish a reviewed draft'
);
SELECT extensions.ok(
  (
    SELECT policy_version = 3
      AND total_points_required = 9
      AND outside_volunteering_allowed = true
      AND published_at IS NOT NULL
      AND published_by = 'd0000000-0000-4000-8000-000000000002'
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_term_policy_drafts AS draft
        WHERE draft.organization_id = policy.organization_id
          AND draft.term_id = policy.term_id
      )
    FROM plugin_data.csf_term_policies AS policy
    WHERE organization_id = 'd1000000-0000-4000-8000-000000000001'
      AND term_id = 'd3000000-0000-4000-8000-000000000001'
  ),
  'publication updates only the published head, stamps the adviser, and consumes the draft'
);
SELECT extensions.ok(
  (
    SELECT (after_data->>'policy_version')::integer = 3
      AND (after_data->>'outside_volunteering_allowed')::boolean = true
      AND (after_data->>'draftRevision')::integer = 2
      AND reason_code = 'semester_policy_republished'
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1000000-0000-4000-8000-000000000001'
      AND term_id = 'd3000000-0000-4000-8000-000000000001'
      AND action = 'term_policy.published'
      AND (after_data->>'policy_version')::integer = 3
  ),
  'publication records the complete policy snapshot and consumed draft revision'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_term_policy_draft_results (kind, payload)
    SELECT 'spring-draft-v4', plugin_data.csf_save_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      0, 10, 2, 4, 4, 1, false, false,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"disqualifyingGrades":["D","F"]}'::jsonb,
      true, 5, 'USD', 'd0000000-0000-4000-8000-000000000003'
    )
  $$,
  'an editor can prepare a new draft over the published policy'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'd5000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  2028,
  'Class of 2028'
);
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'd6000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'Synthetic', 'Student', 'synthetic', 'student'
);
INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status
) VALUES (
  'd7000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd6000000-0000-4000-8000-000000000001',
  'd5000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'manual', 'submitted'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_dues_records
    WHERE organization_id = 'd1000000-0000-4000-8000-000000000001'
      AND term_id = 'd3000000-0000-4000-8000-000000000001'
  ),
  1,
  'application initialization creates the dues record included in publication impact'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_publish_term_policy(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      1, 3, NULL, 'd0000000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'Publishing over an active policy requires a reason of at least 10 characters.',
  'republishing a policy with dependent records requires a meaningful reason'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_term_policy_draft_results (kind, payload)
    SELECT 'spring-published-v4', plugin_data.csf_publish_term_policy(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      1, 3, 'Adviser approved updated chapter rules.', 'd0000000-0000-4000-8000-000000000002'
    )
  $$,
  'an adviser can republish an active policy with an audited reason'
);
SELECT extensions.ok(
  (
    SELECT (result.payload->>'impactCount')::integer = 2
      AND (result.payload->>'policyVersion')::integer = 4
      AND policy.outside_volunteering_allowed = false
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_term_policy_drafts AS draft
        WHERE draft.organization_id = policy.organization_id
          AND draft.term_id = policy.term_id
      )
    FROM csf_term_policy_draft_results AS result
    JOIN plugin_data.csf_term_policies AS policy
      ON policy.organization_id = 'd1000000-0000-4000-8000-000000000001'
     AND policy.term_id = 'd3000000-0000-4000-8000-000000000001'
    WHERE result.kind = 'spring-published-v4'
  ),
  'publication impact counts both the application and its dues record and publishes outside volunteering as disabled'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_term_policy_draft_results (kind, payload)
    SELECT 'discard-draft', plugin_data.csf_save_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      0, 10, 2, 4, 4, 1, false, false,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"disqualifyingGrades":["D","F"]}'::jsonb,
      true, 5, 'USD', 'd0000000-0000-4000-8000-000000000003'
    )
  $$,
  'an editor can save a draft that will later be discarded'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_discard_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      1, 'No longer needed by officers.', 'd0000000-0000-4000-8000-000000000004'
    )
  $$,
  'P0001',
  'Not authorized to edit semester policy drafts.',
  'discard enforces draft-edit authorization itself'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_discard_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      NULL, 'No longer needed by officers.', 'd0000000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'The policy draft changed; refresh and try again.',
  'a null expected draft revision cannot bypass discard concurrency'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_discard_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      1, 'too short', 'd0000000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'Discarding a policy draft requires a reason of at least 10 characters.',
  'discard requires a meaningful audit reason'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_discard_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      1, 'Superseded by adviser guidance.', 'd0000000-0000-4000-8000-000000000003'
    )
  $$,
  'an authorized editor can discard the expected draft revision'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_policy_drafts
    WHERE organization_id = 'd1000000-0000-4000-8000-000000000001'
      AND term_id = 'd3000000-0000-4000-8000-000000000001'
  )
  AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1000000-0000-4000-8000-000000000001'
      AND term_id = 'd3000000-0000-4000-8000-000000000001'
      AND action = 'term_policy.draft_discarded'
      AND after_data->>'reason' = 'Superseded by adviser guidance.'
  ),
  'discard consumes the draft and preserves its reason in immutable audit history'
);

-- Construct a historical archive fixture as the database owner. Runtime
-- callers cannot switch the replication role. A transaction-local role avoids
-- ALTER TABLE failing when this pgTAP transaction has pending trigger events.
SET LOCAL session_replication_role = replica;
UPDATE plugin_data.csf_terms
SET lifecycle_status = 'archived'
WHERE organization_id = 'd1000000-0000-4000-8000-000000000001'
  AND id = 'd3000000-0000-4000-8000-000000000002';
SET LOCAL session_replication_role = origin;

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_save_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002',
      1, 7, 2, 3, 3, 1, false, false,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"disqualifyingGrades":["D","F"]}'::jsonb,
      true, 5, 'USD', 'd0000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Closed or archived semester policy cannot be changed.',
  'closed semester drafts cannot be changed'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_publish_term_policy(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002',
      1, 0, NULL, 'd0000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Closed or archived semester policy cannot be published.',
  'a pending draft cannot be published after its semester closes'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_save_term_policy_draft(
      'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001',
      0, 7, 8, 3, 3, 1, false, false,
      '{"minimumListI":4,"minimumListIAndII":7,"minimumTotal":10,"maximumCourses":5,"disqualifyingGrades":["D","F"]}'::jsonb,
      true, 5, 'USD', 'd0000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'The drive-point cap cannot exceed the total point requirement.',
  'cross-field policy validation runs before any draft write'
);

SELECT * FROM extensions.finish();
ROLLBACK;
