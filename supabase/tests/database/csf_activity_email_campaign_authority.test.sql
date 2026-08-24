-- Least-privilege activity publication email authority. Synthetic and rollback-only.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(21);

SELECT extensions.has_column(
  'plugin_data', 'csf_communication_campaigns', 'source_activity_id',
  'an activity campaign records its immutable source'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conname =
      'csf_communication_campaigns_source_activity_organization_fkey'
      AND constraint_row.conrelid =
        'plugin_data.csf_communication_campaigns'::regclass
      AND constraint_row.confrelid = 'plugin_data.csf_opportunities'::regclass
      AND constraint_row.convalidated
  ),
  'the source activity is constrained to the campaign organization'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_create_activity_email_campaign_draft(uuid,uuid,text,text,uuid,uuid,text,text,text,text,jsonb,text,uuid)',
    'EXECUTE'
  ),
  'the server role may create an activity-linked campaign'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_create_activity_email_campaign_draft(uuid,uuid,text,text,uuid,uuid,text,text,text,text,jsonb,text,uuid)',
    'EXECUTE'
  ),
  'browser roles cannot create an activity email campaign directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_finalize_activity_email_campaign_content(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'the server role may finalize activity email content'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_finalize_activity_email_campaign_content(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'browser roles cannot finalize activity email content directly'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('a8100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'activities-officer@local.test', now(), '{}', '{}', now(), now()),
  ('a8100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'activities-member@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'a8200000-0000-4000-8000-000000000001',
  'CSF Activity Email Authority',
  'csf-activity-email-authority',
  'school',
  '996101'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('a8200000-0000-4000-8000-000000000001', 'a8100000-0000-4000-8000-000000000001', 'staff', 'active'),
  ('a8200000-0000-4000-8000-000000000001', 'a8100000-0000-4000-8000-000000000002', 'member', 'active');

INSERT INTO public.organization_plugin_installs (
  organization_id, plugin_key, installed_version, configuration, installed_by
) VALUES (
  'a8200000-0000-4000-8000-000000000001',
  'dvhs-csf',
  '0.1.0',
  '{"communications":{"broadcastTopics":{"term_members":{"topicKey":"announcements","resendTopicId":"resend_topic_activity_synthetic"}}}}'::jsonb,
  'a8100000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, public_title,
  role_type, is_system, sort_order
) VALUES (
  'a8300000-0000-4000-8000-000000000001',
  'a8200000-0000-4000-8000-000000000001',
  'activity-publisher', 'Activity publisher', 'Activity publisher',
  'custom', false, 100
);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES (
  'a8200000-0000-4000-8000-000000000001',
  'a8300000-0000-4000-8000-000000000001',
  'manage_opportunities', true
);

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year,
  display_title, status, starts_at, ends_at
) VALUES (
  'a8200000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'a8300000-0000-4000-8000-000000000001',
  '2099-2100', 'Activity publisher', 'active',
  current_date - 1, current_date + 30
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'a8400000-0000-4000-8000-000000000001',
  'a8200000-0000-4000-8000-000000000001',
  'F99', 'Fall 2099', '2099-2100', 'fall', true
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES
  ('a8500000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 2099, 'Class of 2099'),
  ('a8500000-0000-4000-8000-000000000002', 'a8200000-0000-4000-8000-000000000001', 2100, 'Class of 2100');

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, cohort_id, title, body, status, published_at
) VALUES
  ('a8600000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000001', NULL, 'Published activity', 'Published activity body.', 'published', now()),
  ('a8600000-0000-4000-8000-000000000002', 'a8200000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000001', NULL, 'Draft activity', 'Draft activity body.', 'draft', NULL),
  ('a8600000-0000-4000-8000-000000000003', 'a8200000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000001', 'a8500000-0000-4000-8000-000000000001', 'Class activity', 'Class activity body.', 'published', now());

SELECT extensions.ok(
  plugin_data.csf_actor_has_permission(
    'a8200000-0000-4000-8000-000000000001',
    'a8100000-0000-4000-8000-000000000001',
    'manage_opportunities'
  )
  AND NOT plugin_data.csf_actor_has_permission(
    'a8200000-0000-4000-8000-000000000001',
    'a8100000-0000-4000-8000-000000000001',
    'manage_settings'
  ),
  'the fixture officer can publish activities without chapter settings authority'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_activity_email_campaign_draft(
      'a8200000-0000-4000-8000-000000000001',
      'a8600000-0000-4000-8000-000000000001', 'Denied', 'Body.',
      'a8100000-0000-4000-8000-000000000002',
      'a8400000-0000-4000-8000-000000000001', 'term_members', NULL,
      'announcements', 'resend_topic_activity_synthetic', '{}'::jsonb, NULL
    )
  $$,
  '42501', NULL,
  'an ordinary member cannot create an activity email campaign'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_activity_email_campaign_draft(
      'a8200000-0000-4000-8000-000000000001',
      'a8600000-0000-4000-8000-000000000002', 'Draft denied', 'Body.',
      'a8100000-0000-4000-8000-000000000001',
      'a8400000-0000-4000-8000-000000000001', 'term_members', NULL,
      'announcements', 'resend_topic_activity_synthetic', '{}'::jsonb, NULL
    )
  $$,
  '23514', NULL,
  'a draft activity cannot become an email campaign'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_activity_email_campaign_draft(
      'a8200000-0000-4000-8000-000000000001',
      'a8600000-0000-4000-8000-000000000001', 'Wrong audience', 'Body.',
      'a8100000-0000-4000-8000-000000000001',
      'a8400000-0000-4000-8000-000000000001', 'cohort_members', NULL,
      'announcements', 'resend_topic_activity_synthetic', '{}'::jsonb, NULL,
      'a8500000-0000-4000-8000-000000000001'
    )
  $$,
  '23514', NULL,
  'the email audience cannot diverge from its published activity'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_activity_email_campaign_draft(
      'a8200000-0000-4000-8000-000000000001',
      'a8600000-0000-4000-8000-000000000001', 'New activity',
      'A new activity is available.',
      'a8100000-0000-4000-8000-000000000001',
      'a8400000-0000-4000-8000-000000000001', 'term_members',
      '<p>A new activity is available.</p>', 'announcements',
      'resend_topic_activity_synthetic', '{}'::jsonb, 'activity-email-1'
    )
  $$,
  'an activity publisher can create a campaign for a published activity'
);

SELECT extensions.is(
  (
    SELECT status || '|' || campaign_kind || '|' || audience_kind || '|'
      || (content_hash IS NULL)::text
    FROM plugin_data.csf_communication_campaigns
    WHERE source_activity_id = 'a8600000-0000-4000-8000-000000000001'
  ),
  'draft|broadcast|term_members|true',
  'the activity campaign starts as a non-dispatchable draft'
);

SELECT extensions.is(
  (
    plugin_data.csf_create_activity_email_campaign_draft(
      'a8200000-0000-4000-8000-000000000001',
      'a8600000-0000-4000-8000-000000000001', 'Ignored retry', 'Ignored.',
      'a8100000-0000-4000-8000-000000000001',
      'a8400000-0000-4000-8000-000000000001', 'term_members', NULL,
      'announcements', 'resend_topic_activity_synthetic', '{}'::jsonb, NULL
    ) ->> 'idempotentReplay'
  ),
  'true',
  'a retry returns the existing live campaign'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_campaigns
    WHERE source_activity_id = 'a8600000-0000-4000-8000-000000000001'
      AND status <> 'cancelled'
  ),
  1,
  'one activity has exactly one live campaign after retry'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_finalize_activity_email_campaign_content(
      'a8200000-0000-4000-8000-000000000001',
      (
        SELECT id FROM plugin_data.csf_communication_campaigns
        WHERE source_activity_id = 'a8600000-0000-4000-8000-000000000001'
      ),
      'a8100000-0000-4000-8000-000000000001', 'activity-finalize-1'
    )
  $$,
  'the activity publisher can finalize linked campaign content'
);

SELECT extensions.ok(
  (
    SELECT content_finalized_at IS NOT NULL
      AND content_hash ~ '^[0-9a-f]{64}$'
      AND body_text_hash ~ '^[0-9a-f]{64}$'
    FROM plugin_data.csf_communication_campaigns
    WHERE source_activity_id = 'a8600000-0000-4000-8000-000000000001'
  ),
  'activity content finalization derives durable content hashes'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET source_activity_id = NULL
    WHERE source_activity_id = 'a8600000-0000-4000-8000-000000000001'
  $$,
  '23514', NULL,
  'a campaign source activity is immutable'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_activity_email_campaign_draft(
      'a8200000-0000-4000-8000-000000000001',
      'a8600000-0000-4000-8000-000000000003', 'Wrong class', 'Body.',
      'a8100000-0000-4000-8000-000000000001',
      'a8400000-0000-4000-8000-000000000001', 'cohort_members', NULL,
      'announcements', 'resend_topic_activity_synthetic', '{}'::jsonb, NULL,
      'a8500000-0000-4000-8000-000000000002'
    )
  $$,
  '23514', NULL,
  'a class activity email cannot target another class'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_activity_email_campaign_draft(
      'a8200000-0000-4000-8000-000000000001',
      'a8600000-0000-4000-8000-000000000003', 'Class activity', 'Body.',
      'a8100000-0000-4000-8000-000000000001',
      'a8400000-0000-4000-8000-000000000001', 'cohort_members', NULL,
      'announcements', 'resend_topic_activity_synthetic', '{}'::jsonb, NULL,
      'a8500000-0000-4000-8000-000000000001'
    )
  $$,
  'a class activity campaign accepts its exact published cohort'
);

SELECT extensions.is(
  (
    SELECT audience_cohort_id
    FROM plugin_data.csf_communication_campaigns
    WHERE source_activity_id = 'a8600000-0000-4000-8000-000000000003'
  ),
  'a8500000-0000-4000-8000-000000000001'::uuid,
  'the campaign freezes the exact activity class'
);

UPDATE plugin_data.csf_opportunities
SET cohort_id = 'a8500000-0000-4000-8000-000000000002'
WHERE id = 'a8600000-0000-4000-8000-000000000003';

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_finalize_activity_email_campaign_content(
      'a8200000-0000-4000-8000-000000000001',
      (
        SELECT id FROM plugin_data.csf_communication_campaigns
        WHERE source_activity_id = 'a8600000-0000-4000-8000-000000000003'
      ),
      'a8100000-0000-4000-8000-000000000001', NULL
    )
  $$,
  '23514', NULL,
  'finalization refuses class drift after campaign creation'
);

SELECT * FROM extensions.finish();
ROLLBACK;
