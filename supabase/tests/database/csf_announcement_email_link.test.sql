-- Announcement email linkage: cohort-targeted posts, the one-live-campaign
-- double-send guard, the cohort_members audience kind, and the campaign draft
-- entry point's source-announcement parameter.
--
-- Every value here is synthetic. The whole file runs inside one transaction and
-- ends in ROLLBACK, so it leaves no rows behind and does not depend on the
-- order it is run relative to any other suite.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(22);

-- ---------------------------------------------------------------------------
-- A. Schema presence
-- ---------------------------------------------------------------------------

SELECT extensions.has_column(
  'plugin_data', 'csf_announcements', 'audience_cohort_id',
  'a class-audience post can name the graduating class it targets'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_announcements', 'email_requested',
  'a post records whether the officer asked for email delivery'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_announcements', 'email_campaign_id',
  'a post can point at the campaign queued for it'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_communication_campaigns', 'source_announcement_id',
  'a campaign records the post it was queued from'
);

-- Pre-v1.1 announcement rows are migration history and are not rewritten; the
-- class-audience cohort requirement is therefore enforced NOT VALID: every new
-- or updated row is checked, existing history is exempt.
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'csf_announcements_class_audience_cohort_check'
      AND NOT convalidated
  ),
  'the class-audience cohort requirement spares pre-v1.1 history via NOT VALID'
);

SELECT extensions.has_index(
  'plugin_data', 'csf_announcements', 'csf_announcements_cohort_feed_idx',
  'the cohort feed reads through a partial index'
);
SELECT extensions.has_index(
  'plugin_data', 'csf_communication_campaigns',
  'csf_communication_campaigns_live_source_announcement_key',
  'live campaigns are unique per source announcement per organization'
);

-- ---------------------------------------------------------------------------
-- B. Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('be000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'post-officer-one@local.test', now(), '{}', '{}', now(), now()),
  ('be000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'post-officer-two@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('be100000-0000-4000-8000-000000000001', 'CSF Posts One', 'csf-posts-one', 'school', '991101'),
  ('be100000-0000-4000-8000-000000000002', 'CSF Posts Two', 'csf-posts-two', 'school', '991102');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('be100000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('be100000-0000-4000-8000-000000000002', 'be000000-0000-4000-8000-000000000002', 'admin', 'active');

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES (
  'be200000-0000-4000-8000-000000000001',
  'be100000-0000-4000-8000-000000000001', 2098, 'Class of 2098'
);

INSERT INTO plugin_data.csf_announcements (id, organization_id, title, body, status, published_at)
VALUES
  ('be300000-0000-4000-8000-000000000001', 'be100000-0000-4000-8000-000000000001', 'Post with two send attempts', 'Body.', 'published', now()),
  ('be300000-0000-4000-8000-000000000002', 'be100000-0000-4000-8000-000000000002', 'Post in the other chapter', 'Body.', 'published', now()),
  ('be300000-0000-4000-8000-000000000003', 'be100000-0000-4000-8000-000000000001', 'Post queued through the entry point', 'Body.', 'published', now()),
  ('be300000-0000-4000-8000-000000000004', 'be100000-0000-4000-8000-000000000001', 'Post whose first campaign was cancelled', 'Body.', 'published', now());

SET CONSTRAINTS ALL IMMEDIATE;

-- ---------------------------------------------------------------------------
-- C. Class audience requires a cohort on newly written rows
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_announcements (organization_id, title, body, audience)
    VALUES ('be100000-0000-4000-8000-000000000001', 'Classless class post', 'Body.', 'class')
  $$,
  '23514',
  'new row for relation "csf_announcements" violates check constraint "csf_announcements_class_audience_cohort_check"',
  'a new class-audience post without a cohort is refused'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_announcements (organization_id, title, body, audience, audience_cohort_id)
    VALUES (
      'be100000-0000-4000-8000-000000000001', 'Cohort post', 'Body.', 'class',
      'be200000-0000-4000-8000-000000000001'
    )
  $$,
  'a class-audience post naming its cohort is accepted'
);

-- ---------------------------------------------------------------------------
-- D. The cohort_members audience kind
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, sender_email, subject,
      audience_kind, audience_snapshot_version, provider_idempotency_key
    ) VALUES (
      'be400000-0000-4000-8000-000000000001', 'be100000-0000-4000-8000-000000000001',
      'broadcast', 'draft', 'draft@local.test', 'Cohort audience draft',
      'cohort_members', 1, 'cohort-audience-draft-key'
    )
  $$,
  'a campaign may target cohort members'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, sender_email, subject,
      audience_kind, audience_snapshot_version, provider_idempotency_key
    ) VALUES (
      'be400000-0000-4000-8000-000000000002', 'be100000-0000-4000-8000-000000000001',
      'broadcast', 'draft', 'draft@local.test', 'Bogus audience draft',
      'everyone', 1, 'bogus-audience-draft-key'
    )
  $$,
  '23514',
  'new row for relation "csf_communication_campaigns" violates check constraint "csf_communication_campaigns_audience_kind_check"',
  'an invented audience kind is still refused'
);

-- ---------------------------------------------------------------------------
-- E. One live campaign per post
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, sender_email, subject,
      source_announcement_id, audience_snapshot_version, provider_idempotency_key
    ) VALUES (
      'be400000-0000-4000-8000-000000000003', 'be100000-0000-4000-8000-000000000001',
      'broadcast', 'draft', 'draft@local.test', 'First live campaign for the post',
      'be300000-0000-4000-8000-000000000001', 1, 'first-live-campaign-key'
    )
  $$,
  'the first live campaign for a post is accepted'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, sender_email, subject,
      source_announcement_id, audience_snapshot_version, provider_idempotency_key
    ) VALUES (
      'be400000-0000-4000-8000-000000000004', 'be100000-0000-4000-8000-000000000001',
      'broadcast', 'draft', 'draft@local.test', 'Second live campaign for the post',
      'be300000-0000-4000-8000-000000000001', 1, 'second-live-campaign-key'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "csf_communication_campaigns_live_source_announcement_key"',
  'a second live campaign for the same post is refused by the database'
);

-- A cancelled row carries the full canceller evidence tuple
-- (csf_comm_campaign_canceller_check): when, by which account, and under what
-- durable identity the send was withdrawn.
INSERT INTO plugin_data.csf_communication_campaigns (
  id, organization_id, campaign_kind, status, sender_email, subject,
  source_announcement_id, cancelled_at, cancellation_reason,
  cancelled_by, cancelled_by_identity,
  audience_snapshot_version, provider_idempotency_key
) VALUES (
  'be400000-0000-4000-8000-000000000005', 'be100000-0000-4000-8000-000000000001',
  'broadcast', 'cancelled', 'draft@local.test', 'Cancelled campaign for the post',
  'be300000-0000-4000-8000-000000000004', now(), 'officer cancelled before send',
  'be000000-0000-4000-8000-000000000001', 'post-officer-one@local.test',
  1, 'cancelled-campaign-key'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, sender_email, subject,
      source_announcement_id, audience_snapshot_version, provider_idempotency_key
    ) VALUES (
      'be400000-0000-4000-8000-000000000006', 'be100000-0000-4000-8000-000000000001',
      'broadcast', 'draft', 'draft@local.test', 'Replacement after cancellation',
      'be300000-0000-4000-8000-000000000004', 1, 'replacement-campaign-key'
    )
  $$,
  'a cancelled campaign frees the slot for a replacement'
);

-- ---------------------------------------------------------------------------
-- F. The draft entry point and its source-announcement parameter
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_create_communication_campaign_draft(uuid,text,text,text,uuid,uuid,text,text,text,text,jsonb,text,uuid)',
    'EXECUTE'
  ),
  'the service role may call the thirteen-argument draft entry point'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_create_communication_campaign_draft(uuid,text,text,text,uuid,uuid,text,text,text,text,jsonb,text,uuid)',
    'EXECUTE'
  ),
  'browser roles may not call the draft entry point directly'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc
    JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
    WHERE pg_namespace.nspname = 'plugin_data'
      AND pg_proc.proname = 'csf_create_communication_campaign_draft'
      AND pg_proc.pronargs = 12
  ),
  'the old twelve-argument overload is gone, so calls are never ambiguous'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_communication_campaign_draft(
      'be100000-0000-4000-8000-000000000001', 'broadcast', 'Cross-chapter post',
      'Body.', 'be000000-0000-4000-8000-000000000001',
      NULL, 'cohort_members', NULL, 'announcements', NULL, '{}'::jsonb, NULL,
      'be300000-0000-4000-8000-000000000002'
    )
  $$,
  '23503',
  'That CSF announcement does not belong to this organization.',
  'a campaign cannot be queued from another chapter''s post'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_communication_campaign_draft(
      'be100000-0000-4000-8000-000000000001', 'transactional', 'Transactional post',
      'Body.', 'be000000-0000-4000-8000-000000000001',
      NULL, NULL, NULL, NULL, NULL, '{}'::jsonb, NULL,
      'be300000-0000-4000-8000-000000000003'
    )
  $$,
  '22023',
  'A CSF campaign queued from an announcement is a broadcast.',
  'announcement-born campaigns are member-facing broadcasts by definition'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_communication_campaign_draft(
      'be100000-0000-4000-8000-000000000001', 'broadcast', 'Foreign officer post',
      'Body.', 'be000000-0000-4000-8000-000000000002',
      NULL, 'cohort_members', NULL, 'announcements', NULL, '{}'::jsonb, NULL,
      'be300000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  'That account does not hold the CSF staff capability required to author a communications campaign in this organization.',
  'an officer of another chapter cannot queue a campaign here'
);

SELECT extensions.ok(
  (
    plugin_data.csf_create_communication_campaign_draft(
      'be100000-0000-4000-8000-000000000001', 'broadcast', 'Queued from a post',
      'Body.', 'be000000-0000-4000-8000-000000000001',
      NULL, 'term_members', NULL, 'announcements', NULL, '{}'::jsonb, NULL,
      'be300000-0000-4000-8000-000000000003'
    ) ->> 'status'
  ) = 'draft',
  'an authorized officer queues a draft campaign from a post'
);

SELECT extensions.is(
  (
    SELECT campaign.audience_kind
    FROM plugin_data.csf_communication_campaigns AS campaign
    WHERE campaign.source_announcement_id = 'be300000-0000-4000-8000-000000000003'
      AND campaign.status <> 'cancelled'
  ),
  'term_members',
  'the queued campaign remembers both its source post and its member audience'
);

SELECT extensions.finish();
ROLLBACK;
