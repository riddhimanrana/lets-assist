-- Least-privilege post email authority. All values are synthetic and rollback.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(34);

SELECT extensions.has_column(
  'plugin_data', 'csf_communication_campaigns', 'audience_cohort_id',
  'a class-post campaign freezes its exact cohort coordinate'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conname =
      'csf_communication_campaigns_audience_cohort_organization_fkey'
      AND constraint_row.conrelid =
        'plugin_data.csf_communication_campaigns'::regclass
      AND constraint_row.confrelid = 'plugin_data.csf_cohorts'::regclass
      AND constraint_row.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE
        'FOREIGN KEY (audience_cohort_id, organization_id) REFERENCES plugin_data.csf_cohorts(id, organization_id)%ON DELETE RESTRICT%'
  ),
  'the frozen cohort is constrained to the campaign organization'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_create_post_email_campaign_draft(uuid,uuid,text,text,uuid,uuid,text,text,text,text,jsonb,text,uuid)',
    'EXECUTE'
  ),
  'the server role may create a post-linked campaign through the narrow RPC'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_create_post_email_campaign_draft(uuid,uuid,text,text,uuid,uuid,text,text,text,text,jsonb,text,uuid)',
    'EXECUTE'
  ),
  'browser roles cannot create a post email campaign directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_finalize_post_email_campaign_content(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'the server role may finalize post email content through the narrow RPC'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_finalize_post_email_campaign_content(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'browser roles cannot finalize post email content directly'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('e9000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'poster-a@local.test', now(), '{}', '{}', now(), now()),
  ('e9000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'member-a@local.test', now(), '{}', '{}', now(), now()),
  ('e9000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'poster-b@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('e9100000-0000-4000-8000-000000000001', 'CSF Post Authority A', 'csf-post-authority-a', 'school', '995101'),
  ('e9100000-0000-4000-8000-000000000002', 'CSF Post Authority B', 'csf-post-authority-b', 'school', '995102');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('e9100000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'staff', 'active'),
  ('e9100000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('e9100000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-000000000003', 'staff', 'active');

INSERT INTO public.organization_plugin_installs (
  organization_id, plugin_key, installed_version, configuration, installed_by
) VALUES (
  'e9100000-0000-4000-8000-000000000001',
  'dvhs-csf',
  '0.1.0',
  '{"communications":{"broadcastTopics":{"term_members":{"topicKey":"announcements","resendTopicId":"resend_topic_synthetic"}}}}'::jsonb,
  'e9000000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, public_title,
  role_type, is_system, sort_order
) VALUES
  ('e9200000-0000-4000-8000-000000000001', 'e9100000-0000-4000-8000-000000000001', 'poster', 'Poster', 'Poster', 'custom', false, 100),
  ('e9200000-0000-4000-8000-000000000002', 'e9100000-0000-4000-8000-000000000002', 'poster', 'Poster', 'Poster', 'custom', false, 100);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES
  ('e9100000-0000-4000-8000-000000000001', 'e9200000-0000-4000-8000-000000000001', 'manage_posts', true),
  ('e9100000-0000-4000-8000-000000000002', 'e9200000-0000-4000-8000-000000000002', 'manage_posts', true);

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year,
  display_title, status, starts_at, ends_at
) VALUES
  ('e9100000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'e9200000-0000-4000-8000-000000000001', '2099-2100', 'Poster', 'active', current_date - 1, current_date + 30),
  ('e9100000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-000000000003', 'e9200000-0000-4000-8000-000000000002', '2099-2100', 'Poster', 'active', current_date - 1, current_date + 30);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  ('e9300000-0000-4000-8000-000000000001', 'e9100000-0000-4000-8000-000000000001', 'F99', 'Fall 2099', '2099-2100', 'fall', true),
  ('e9300000-0000-4000-8000-000000000002', 'e9100000-0000-4000-8000-000000000002', 'F99', 'Fall 2099', '2099-2100', 'fall', true);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES
  ('e9350000-0000-4000-8000-000000000001', 'e9100000-0000-4000-8000-000000000001', 2099, 'Class of 2099'),
  ('e9350000-0000-4000-8000-000000000002', 'e9100000-0000-4000-8000-000000000001', 2100, 'Class of 2100');

INSERT INTO plugin_data.csf_announcements (
  id, organization_id, term_id, title, body, audience,
  audience_cohort_id, status, published_at
) VALUES
  ('e9400000-0000-4000-8000-000000000001', 'e9100000-0000-4000-8000-000000000001', 'e9300000-0000-4000-8000-000000000001', 'Published members post', 'Published body.', 'members', NULL, 'published', now()),
  ('e9400000-0000-4000-8000-000000000002', 'e9100000-0000-4000-8000-000000000001', 'e9300000-0000-4000-8000-000000000001', 'Draft members post', 'Draft body.', 'members', NULL, 'draft', NULL),
  ('e9400000-0000-4000-8000-000000000003', 'e9100000-0000-4000-8000-000000000001', 'e9300000-0000-4000-8000-000000000001', 'Published public post', 'Public body.', 'public', NULL, 'published', now()),
  ('e9400000-0000-4000-8000-000000000004', 'e9100000-0000-4000-8000-000000000002', 'e9300000-0000-4000-8000-000000000002', 'Other chapter post', 'Other body.', 'members', NULL, 'published', now()),
  ('e9400000-0000-4000-8000-000000000005', 'e9100000-0000-4000-8000-000000000001', 'e9300000-0000-4000-8000-000000000001', 'Post archived before finalize', 'Archive body.', 'members', NULL, 'published', now()),
  ('e9400000-0000-4000-8000-000000000006', 'e9100000-0000-4000-8000-000000000001', 'e9300000-0000-4000-8000-000000000001', 'Class retry drift', 'Class body.', 'class', 'e9350000-0000-4000-8000-000000000001', 'published', now()),
  ('e9400000-0000-4000-8000-000000000007', 'e9100000-0000-4000-8000-000000000001', 'e9300000-0000-4000-8000-000000000001', 'Class finalize drift', 'Class body.', 'class', 'e9350000-0000-4000-8000-000000000001', 'published', now()),
  ('e9400000-0000-4000-8000-000000000008', 'e9100000-0000-4000-8000-000000000001', 'e9300000-0000-4000-8000-000000000001', 'Class wrong coordinate', 'Class body.', 'class', 'e9350000-0000-4000-8000-000000000001', 'published', now());

SELECT extensions.ok(
  plugin_data.csf_actor_has_permission(
    'e9100000-0000-4000-8000-000000000001',
    'e9000000-0000-4000-8000-000000000001',
    'manage_posts'
  )
  AND NOT plugin_data.csf_actor_has_permission(
    'e9100000-0000-4000-8000-000000000001',
    'e9000000-0000-4000-8000-000000000001',
    'manage_settings'
  ),
  'the fixture officer has post authority but not chapter settings authority'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_communication_campaign_draft(
      'e9100000-0000-4000-8000-000000000001', 'broadcast', 'Generic denied',
      'Body.', 'e9000000-0000-4000-8000-000000000001',
      'e9300000-0000-4000-8000-000000000001', 'term_members', NULL,
      'announcements', 'resend_topic_synthetic', '{}'::jsonb, NULL,
      'e9400000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  NULL,
  'manage_posts does not grant the generic campaign authoring surface'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_post_email_campaign_draft(
      'e9100000-0000-4000-8000-000000000001',
      'e9400000-0000-4000-8000-000000000001', 'Member denied', 'Body.',
      'e9000000-0000-4000-8000-000000000002',
      'e9300000-0000-4000-8000-000000000001', 'term_members', NULL,
      'announcements', 'resend_topic_synthetic', '{}'::jsonb, NULL
    )
  $$,
  '42501',
  NULL,
  'an ordinary member cannot create a post email campaign'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_post_email_campaign_draft(
      'e9100000-0000-4000-8000-000000000001',
      'e9400000-0000-4000-8000-000000000001', 'Foreign denied', 'Body.',
      'e9000000-0000-4000-8000-000000000003',
      'e9300000-0000-4000-8000-000000000001', 'term_members', NULL,
      'announcements', 'resend_topic_synthetic', '{}'::jsonb, NULL
    )
  $$,
  '42501',
  NULL,
  'an officer from another chapter cannot create this chapter post email'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_post_email_campaign_draft(
      'e9100000-0000-4000-8000-000000000001',
      'e9400000-0000-4000-8000-000000000002', 'Draft denied', 'Body.',
      'e9000000-0000-4000-8000-000000000001',
      'e9300000-0000-4000-8000-000000000001', 'term_members', NULL,
      'announcements', 'resend_topic_synthetic', '{}'::jsonb, NULL
    )
  $$,
  '23514',
  NULL,
  'a draft post cannot become an email campaign'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_post_email_campaign_draft(
      'e9100000-0000-4000-8000-000000000001',
      'e9400000-0000-4000-8000-000000000003', 'Public denied', 'Body.',
      'e9000000-0000-4000-8000-000000000001',
      'e9300000-0000-4000-8000-000000000001', 'term_members', NULL,
      'announcements', 'resend_topic_synthetic', '{}'::jsonb, NULL
    )
  $$,
  '23514',
  NULL,
  'a public post cannot become member email'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_post_email_campaign_draft(
      'e9100000-0000-4000-8000-000000000001',
      'e9400000-0000-4000-8000-000000000004', 'Cross chapter denied', 'Body.',
      'e9000000-0000-4000-8000-000000000001',
      'e9300000-0000-4000-8000-000000000001', 'term_members', NULL,
      'announcements', 'resend_topic_synthetic', '{}'::jsonb, NULL
    )
  $$,
  '23503',
  NULL,
  'a source post from another chapter is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_post_email_campaign_draft(
      'e9100000-0000-4000-8000-000000000001',
      'e9400000-0000-4000-8000-000000000001', 'Wrong audience', 'Body.',
      'e9000000-0000-4000-8000-000000000001',
      'e9300000-0000-4000-8000-000000000001', 'staff', NULL,
      'announcements', 'resend_topic_synthetic', '{}'::jsonb, NULL
    )
  $$,
  '23514',
  NULL,
  'the email audience cannot diverge from its source post'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_post_email_campaign_draft(
      'e9100000-0000-4000-8000-000000000001',
      'e9400000-0000-4000-8000-000000000001', 'Wrong topic', 'Body.',
      'e9000000-0000-4000-8000-000000000001',
      'e9300000-0000-4000-8000-000000000001', 'term_members', NULL,
      'different_topic', 'resend_topic_synthetic', '{}'::jsonb, NULL
    )
  $$,
  '23514',
  'Post email topics must match the active CSF communications configuration.',
  'a post-authoring role cannot substitute a different member consent scope'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_post_email_campaign_draft(
      'e9100000-0000-4000-8000-000000000001',
      'e9400000-0000-4000-8000-000000000001', 'Published members post',
      'Rendered plain text.', 'e9000000-0000-4000-8000-000000000001',
      'e9300000-0000-4000-8000-000000000001', 'term_members',
      '<p>Rendered HTML.</p>', 'announcements', 'resend_topic_synthetic',
      '{}'::jsonb, 'post-email-create-1'
    )
  $$,
  'a manage_posts officer can create a campaign for a published non-public post'
);

SELECT extensions.is(
  (
    SELECT campaign.status || '|' || campaign.campaign_kind || '|'
      || campaign.sender_email || '|' || campaign.audience_kind || '|'
      || (campaign.content_hash IS NULL)::text
    FROM plugin_data.csf_communication_campaigns AS campaign
    WHERE campaign.source_announcement_id = 'e9400000-0000-4000-8000-000000000001'
  ),
  'draft|broadcast|csf@notifications.lets-assist.com|term_members|true',
  'the draft derives sender and campaign identity but is not dispatch-ready'
);

SELECT extensions.is(
  (
    plugin_data.csf_create_post_email_campaign_draft(
      'e9100000-0000-4000-8000-000000000001',
      'e9400000-0000-4000-8000-000000000001', 'Ignored retry title',
      'Ignored retry body.', 'e9000000-0000-4000-8000-000000000001',
      'e9300000-0000-4000-8000-000000000001', 'term_members', NULL,
      'announcements', 'resend_topic_synthetic', '{}'::jsonb, 'post-email-retry-1'
    ) ->> 'idempotentReplay'
  ),
  'true',
  'a retry returns the existing live campaign rather than creating another'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_campaigns
    WHERE source_announcement_id = 'e9400000-0000-4000-8000-000000000001'
      AND status <> 'cancelled'
  ),
  1,
  'a source post has exactly one live campaign after retry'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_finalize_post_email_campaign_content(
      'e9100000-0000-4000-8000-000000000001',
      (
        SELECT id FROM plugin_data.csf_communication_campaigns
        WHERE source_announcement_id = 'e9400000-0000-4000-8000-000000000001'
      ),
      'e9000000-0000-4000-8000-000000000001', 'post-email-finalize-1'
    )
  $$,
  'a manage_posts officer can finalize content for the linked post campaign'
);

SELECT extensions.ok(
  (
    SELECT campaign.content_finalized_at IS NOT NULL
      AND campaign.content_hash ~ '^[0-9a-f]{64}$'
      AND campaign.body_text_hash ~ '^[0-9a-f]{64}$'
    FROM plugin_data.csf_communication_campaigns AS campaign
    WHERE campaign.source_announcement_id = 'e9400000-0000-4000-8000-000000000001'
  ),
  'finalization derives durable content hashes from stored copy'
);

SELECT extensions.is(
  (
    plugin_data.csf_finalize_post_email_campaign_content(
      'e9100000-0000-4000-8000-000000000001',
      (
        SELECT id FROM plugin_data.csf_communication_campaigns
        WHERE source_announcement_id = 'e9400000-0000-4000-8000-000000000001'
      ),
      'e9000000-0000-4000-8000-000000000001', 'post-email-finalize-retry'
    ) ->> 'idempotentReplay'
  ),
  'true',
  'post content finalization is idempotent'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_finalize_communication_campaign_content(
      'e9100000-0000-4000-8000-000000000001',
      (
        SELECT id FROM plugin_data.csf_communication_campaigns
        WHERE source_announcement_id = 'e9400000-0000-4000-8000-000000000001'
      ),
      'e9000000-0000-4000-8000-000000000001', NULL
    )
  $$,
  '42501',
  NULL,
  'manage_posts does not grant the generic campaign finalization surface'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_post_email_campaign_draft(
      'e9100000-0000-4000-8000-000000000001',
      'e9400000-0000-4000-8000-000000000008', 'Wrong class coordinate',
      'Class body.', 'e9000000-0000-4000-8000-000000000001',
      'e9300000-0000-4000-8000-000000000001', 'cohort_members', NULL,
      'announcements', 'resend_topic_synthetic', '{}'::jsonb, NULL,
      'e9350000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'The class email cohort must exactly match the published post cohort.',
  'draft creation refuses a caller-supplied cohort that differs from the post'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_post_email_campaign_draft(
      'e9100000-0000-4000-8000-000000000001',
      'e9400000-0000-4000-8000-000000000006', 'Frozen class draft',
      'Class body.', 'e9000000-0000-4000-8000-000000000001',
      'e9300000-0000-4000-8000-000000000001', 'cohort_members', NULL,
      'announcements', 'resend_topic_synthetic', '{}'::jsonb, NULL,
      'e9350000-0000-4000-8000-000000000001'
    )
  $$,
  'a class-post draft accepts the exact source cohort'
);

SELECT extensions.is(
  (
    SELECT campaign.audience_cohort_id
    FROM plugin_data.csf_communication_campaigns AS campaign
    WHERE campaign.source_announcement_id =
      'e9400000-0000-4000-8000-000000000006'
  ),
  'e9350000-0000-4000-8000-000000000001'::uuid,
  'the campaign stores the exact class cohort as a durable coordinate'
);

UPDATE plugin_data.csf_announcements
SET audience_cohort_id = 'e9350000-0000-4000-8000-000000000002'
WHERE id = 'e9400000-0000-4000-8000-000000000006';

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_post_email_campaign_draft(
      'e9100000-0000-4000-8000-000000000001',
      'e9400000-0000-4000-8000-000000000006', 'Retry after class edit',
      'Class body.', 'e9000000-0000-4000-8000-000000000001',
      'e9300000-0000-4000-8000-000000000001', 'cohort_members', NULL,
      'announcements', 'resend_topic_synthetic', '{}'::jsonb, NULL,
      'e9350000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'The existing post email campaign no longer matches the requested frozen audience.',
  'a retry cannot retarget an existing class campaign after the post changes'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET audience_cohort_id = 'e9350000-0000-4000-8000-000000000002'
    WHERE source_announcement_id =
      'e9400000-0000-4000-8000-000000000006'
  $$,
  '23514',
  'A CSF campaign class audience coordinate is immutable.',
  'even a direct service-role-shaped write cannot retarget the frozen cohort'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_post_email_campaign_draft(
      'e9100000-0000-4000-8000-000000000001',
      'e9400000-0000-4000-8000-000000000007', 'Finalize class draft',
      'Class body.', 'e9000000-0000-4000-8000-000000000001',
      'e9300000-0000-4000-8000-000000000001', 'cohort_members', NULL,
      'announcements', 'resend_topic_synthetic', '{}'::jsonb, NULL,
      'e9350000-0000-4000-8000-000000000001'
    )
  $$,
  'a second class post can freeze its original cohort before finalization'
);

UPDATE plugin_data.csf_announcements
SET audience_cohort_id = 'e9350000-0000-4000-8000-000000000002'
WHERE id = 'e9400000-0000-4000-8000-000000000007';

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_finalize_post_email_campaign_content(
      'e9100000-0000-4000-8000-000000000001',
      (
        SELECT id FROM plugin_data.csf_communication_campaigns
        WHERE source_announcement_id =
          'e9400000-0000-4000-8000-000000000007'
      ),
      'e9000000-0000-4000-8000-000000000001', NULL
    )
  $$,
  '23514',
  'The post campaign no longer matches its published term or audience.',
  'content finalization refuses source-post class drift under lock'
);

INSERT INTO plugin_data.csf_communication_campaigns (
  id, organization_id, campaign_kind, status, sender_email, subject,
  body_text, term_id, audience_kind, broadcast_topic_key, resend_topic_id,
  created_by, created_by_identity, audience_snapshot_version,
  provider_idempotency_key
) VALUES (
  'e9500000-0000-4000-8000-000000000001',
  'e9100000-0000-4000-8000-000000000001',
  'broadcast', 'draft', 'csf@notifications.lets-assist.com',
  'Standalone campaign', 'Standalone body.',
  'e9300000-0000-4000-8000-000000000001', 'term_members',
  'announcements', 'resend_topic_synthetic',
  'e9000000-0000-4000-8000-000000000001', 'poster-a@local.test',
  1, 'post-authority-standalone-campaign'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_finalize_post_email_campaign_content(
      'e9100000-0000-4000-8000-000000000001',
      'e9500000-0000-4000-8000-000000000001',
      'e9000000-0000-4000-8000-000000000001', NULL
    )
  $$,
  '42501',
  NULL,
  'post authority cannot finalize a standalone communications campaign'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_post_email_campaign_draft(
      'e9100000-0000-4000-8000-000000000001',
      'e9400000-0000-4000-8000-000000000005', 'Archive candidate',
      'Archive body.', 'e9000000-0000-4000-8000-000000000001',
      'e9300000-0000-4000-8000-000000000001', 'term_members', NULL,
      'announcements', 'resend_topic_synthetic', '{}'::jsonb, NULL
    )
  $$,
  'a second published post can create its own draft campaign'
);

UPDATE public.organization_plugin_installs
SET configuration = jsonb_set(
  configuration,
  '{communications,broadcastTopics,term_members,resendTopicId}',
  '"resend_topic_rotated"'::jsonb
)
WHERE organization_id = 'e9100000-0000-4000-8000-000000000001'
  AND plugin_key = 'dvhs-csf';

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_finalize_post_email_campaign_content(
      'e9100000-0000-4000-8000-000000000001',
      (
        SELECT id FROM plugin_data.csf_communication_campaigns
        WHERE source_announcement_id = 'e9400000-0000-4000-8000-000000000005'
      ),
      'e9000000-0000-4000-8000-000000000001', NULL
    )
  $$,
  '23514',
  'Post email topics must match the active CSF communications configuration.',
  'a draft cannot be frozen against a provider topic that was rotated after creation'
);

UPDATE public.organization_plugin_installs
SET configuration = jsonb_set(
  configuration,
  '{communications,broadcastTopics,term_members,resendTopicId}',
  '"resend_topic_synthetic"'::jsonb
)
WHERE organization_id = 'e9100000-0000-4000-8000-000000000001'
  AND plugin_key = 'dvhs-csf';

UPDATE plugin_data.csf_announcements
SET status = 'archived'
WHERE id = 'e9400000-0000-4000-8000-000000000005';

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_finalize_post_email_campaign_content(
      'e9100000-0000-4000-8000-000000000001',
      (
        SELECT id FROM plugin_data.csf_communication_campaigns
        WHERE source_announcement_id = 'e9400000-0000-4000-8000-000000000005'
      ),
      'e9000000-0000-4000-8000-000000000001', NULL
    )
  $$,
  '23514',
  NULL,
  'an archived source post cannot have its email content finalized'
);

SELECT extensions.finish();
ROLLBACK;
