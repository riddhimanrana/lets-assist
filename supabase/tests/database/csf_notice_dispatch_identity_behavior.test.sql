BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(24);

-- ---------------------------------------------------------------------------
-- What this proves, and why it is separate
--
-- csf_notice_campaign_dispatch_identity.test.sql reads the shipped function
-- source and asserts that certain strings appear in it. That cannot fail when
-- the behaviour is wrong and the text is right, and the defect 20260917160000
-- exists to fix only showed itself against a real ledger: the draft was
-- created, finalization raised on
-- csf_communication_campaigns_dispatch_identity_check, and the email went back
-- to the queue. So this file builds fictional chapters, calls the real RPCs,
-- and reads the rows they leave behind.
--
-- Every outcome is captured inside one DO block, including the error codes,
-- which are recorded rather than asserted in place. That keeps the whole file
-- on one shape: a fact is measured once and asserted once.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE notice_behavior (key text PRIMARY KEY, value text);

DO $do$
DECLARE
  v_result jsonb;
  v_c1 uuid;
  v_c2 uuid;
  v_c3 uuid;
  v_c4 uuid;
  v_c5 uuid;
  v_hash text;
BEGIN
  -- -------------------------------------------------------------------------
  -- Fixtures: two fictional chapters, a member, four point claims and a
  -- profile correction. The claims deliberately sit in a semester that is NOT
  -- the current one, so an assertion that the notice took the claim's term
  -- cannot pass by accident.
  -- -------------------------------------------------------------------------
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    ('da000000-0000-4000-8000-000000000001'::uuid, 'authenticated', 'authenticated',
     'notice.member@example.test', now(), '{}', '{}', now(), now()),
    -- Withdrawing a send is a staff decision, and the cancellation RPC checks
    -- the capability rather than taking the caller's word for it. An
    -- organization admin holds it.
    ('da000000-0000-4000-8000-000000000002'::uuid, 'authenticated', 'authenticated',
     'notice.officer@example.test', now(), '{}', '{}', now(), now());

  INSERT INTO public.organizations (id, name, username, type, join_code)
  VALUES
    ('da100000-0000-4000-8000-000000000001'::uuid, 'Notice Chapter One',
     'notice-chapter-one', 'school', '886001'),
    ('da100000-0000-4000-8000-000000000002'::uuid, 'Notice Chapter Two',
     'notice-chapter-two', 'school', '886002');

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES
    ('da100000-0000-4000-8000-000000000001'::uuid,
     'da000000-0000-4000-8000-000000000001'::uuid, 'member', 'active'),
    ('da100000-0000-4000-8000-000000000001'::uuid,
     'da000000-0000-4000-8000-000000000002'::uuid, 'admin', 'active');

  INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester, is_current)
  VALUES
    ('da200000-0000-4000-8000-000000000001'::uuid, 'da100000-0000-4000-8000-000000000001'::uuid,
     'S31', 'Spring 2031', '2030-2031', 'spring', true),
    ('da200000-0000-4000-8000-000000000002'::uuid, 'da100000-0000-4000-8000-000000000001'::uuid,
     'F30', 'Fall 2030', '2030-2031', 'fall', false),
    ('da200000-0000-4000-8000-000000000003'::uuid, 'da100000-0000-4000-8000-000000000002'::uuid,
     'S31', 'Spring 2031', '2030-2031', 'spring', true);

  INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, last_name,
    normalized_first_name, normalized_last_name)
  VALUES
    ('da300000-0000-4000-8000-000000000001'::uuid, 'da100000-0000-4000-8000-000000000001'::uuid,
     'Noor', 'Dispatch', 'noor', 'dispatch'),
    ('da300000-0000-4000-8000-000000000002'::uuid, 'da100000-0000-4000-8000-000000000002'::uuid,
     'Other', 'Chapter', 'other', 'chapter');

  INSERT INTO plugin_data.csf_profile_accounts (organization_id, profile_id, user_id, status, is_primary)
  VALUES ('da100000-0000-4000-8000-000000000001'::uuid,
          'da300000-0000-4000-8000-000000000001'::uuid,
          'da000000-0000-4000-8000-000000000001'::uuid, 'verified', true);

  INSERT INTO plugin_data.csf_term_memberships (organization_id, profile_id, term_id, status, accepted_at)
  VALUES ('da100000-0000-4000-8000-000000000001'::uuid,
          'da300000-0000-4000-8000-000000000001'::uuid,
          'da200000-0000-4000-8000-000000000002'::uuid, 'accepted', now());

  INSERT INTO plugin_data.csf_point_submissions (id, organization_id, profile_id, term_id,
    description, claimed_points, point_type, status, submitted_by)
  VALUES
    ('da400000-0000-4000-8000-000000000001'::uuid, 'da100000-0000-4000-8000-000000000001'::uuid,
     'da300000-0000-4000-8000-000000000001'::uuid, 'da200000-0000-4000-8000-000000000002'::uuid,
     'Claim behind the finalized notice', 2, 'non_drive', 'submitted',
     'da000000-0000-4000-8000-000000000001'::uuid),
    ('da400000-0000-4000-8000-000000000002'::uuid, 'da100000-0000-4000-8000-000000000001'::uuid,
     'da300000-0000-4000-8000-000000000001'::uuid, 'da200000-0000-4000-8000-000000000002'::uuid,
     'Claim whose notice is cancelled and whose record then disappears', 1, 'non_drive', 'submitted',
     'da000000-0000-4000-8000-000000000001'::uuid),
    ('da400000-0000-4000-8000-000000000003'::uuid, 'da100000-0000-4000-8000-000000000001'::uuid,
     'da300000-0000-4000-8000-000000000001'::uuid, 'da200000-0000-4000-8000-000000000002'::uuid,
     'Claim whose notice failed', 1, 'non_drive', 'submitted',
     'da000000-0000-4000-8000-000000000001'::uuid),
    ('da400000-0000-4000-8000-000000000004'::uuid, 'da100000-0000-4000-8000-000000000001'::uuid,
     'da300000-0000-4000-8000-000000000001'::uuid, 'da200000-0000-4000-8000-000000000002'::uuid,
     'Claim whose notice is held for review', 1, 'non_drive', 'submitted',
     'da000000-0000-4000-8000-000000000001'::uuid);

  INSERT INTO plugin_data.csf_publication_events (id, organization_id, source_kind, source_id, event_key)
  VALUES
    ('da500000-0000-4000-8000-000000000001'::uuid, 'da100000-0000-4000-8000-000000000001'::uuid,
     'point_submission', 'da400000-0000-4000-8000-000000000001'::uuid, 'personal:approved'),
    ('da500000-0000-4000-8000-000000000002'::uuid, 'da100000-0000-4000-8000-000000000001'::uuid,
     'profile', 'da300000-0000-4000-8000-000000000001'::uuid, 'personal:details'),
    ('da500000-0000-4000-8000-000000000003'::uuid, 'da100000-0000-4000-8000-000000000001'::uuid,
     'point_submission', 'da400000-0000-4000-8000-000000000002'::uuid, 'personal:approved'),
    ('da500000-0000-4000-8000-000000000004'::uuid, 'da100000-0000-4000-8000-000000000001'::uuid,
     'point_submission', 'da400000-0000-4000-8000-000000000003'::uuid, 'personal:approved'),
    ('da500000-0000-4000-8000-000000000005'::uuid, 'da100000-0000-4000-8000-000000000001'::uuid,
     'point_submission', 'da400000-0000-4000-8000-000000000004'::uuid, 'personal:approved'),
    -- Not a personal notice at all.
    ('da500000-0000-4000-8000-000000000006'::uuid, 'da100000-0000-4000-8000-000000000001'::uuid,
     'post', 'da600000-0000-4000-8000-000000000001'::uuid, ''),
    -- Belongs to the other chapter.
    ('da500000-0000-4000-8000-000000000007'::uuid, 'da100000-0000-4000-8000-000000000002'::uuid,
     'profile', 'da300000-0000-4000-8000-000000000002'::uuid, 'personal:details');

  -- -------------------------------------------------------------------------
  -- A point-submission notice takes the term the claim was made in
  -- -------------------------------------------------------------------------
  v_result := plugin_data.csf_create_personal_notice_campaign_draft(
    'da100000-0000-4000-8000-000000000001'::uuid,
    'da500000-0000-4000-8000-000000000001'::uuid,
    'Your point claim was approved',
    'Your claim for 2 points was approved.');
  v_c1 := (v_result ->> 'campaignId')::uuid;

  INSERT INTO notice_behavior (key, value)
  SELECT 'c1.termIsClaimTerm',
         (campaign.term_id = 'da200000-0000-4000-8000-000000000002'::uuid)::text
  FROM plugin_data.csf_communication_campaigns AS campaign WHERE campaign.id = v_c1;

  INSERT INTO notice_behavior (key, value)
  SELECT 'c1.audience',
         coalesce(campaign.audience_kind, 'null')
           || '/' || coalesce(campaign.audience_cohort_id::text, 'null')
           || '/' || campaign.campaign_kind
  FROM plugin_data.csf_communication_campaigns AS campaign WHERE campaign.id = v_c1;

  INSERT INTO notice_behavior (key, value)
  VALUES ('c1.firstCallWasNew', (v_result ->> 'idempotentReplay'));

  -- -------------------------------------------------------------------------
  -- A profile notice takes the chapter's current term
  -- -------------------------------------------------------------------------
  v_result := plugin_data.csf_create_personal_notice_campaign_draft(
    'da100000-0000-4000-8000-000000000001'::uuid,
    'da500000-0000-4000-8000-000000000002'::uuid,
    'Your CSF record was corrected',
    'An officer corrected your record.');
  v_c3 := (v_result ->> 'campaignId')::uuid;

  INSERT INTO notice_behavior (key, value)
  SELECT 'c3.termIsCurrentTerm',
         (campaign.term_id = 'da200000-0000-4000-8000-000000000001'::uuid
          AND campaign.audience_kind = 'custom_list')::text
  FROM plugin_data.csf_communication_campaigns AS campaign WHERE campaign.id = v_c3;

  -- -------------------------------------------------------------------------
  -- Real finalization against the real ledger constraint
  -- -------------------------------------------------------------------------
  BEGIN
    v_result := plugin_data.csf_finalize_personal_notice_content(
      'da100000-0000-4000-8000-000000000001'::uuid, v_c1);
    INSERT INTO notice_behavior (key, value) VALUES ('c1.finalizeSqlstate', 'ok');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO notice_behavior (key, value) VALUES ('c1.finalizeSqlstate', SQLSTATE);
  END;

  SELECT campaign.content_hash INTO v_hash
  FROM plugin_data.csf_communication_campaigns AS campaign WHERE campaign.id = v_c1;

  INSERT INTO notice_behavior (key, value)
  SELECT 'c1.frozen',
         (campaign.content_finalized_at IS NOT NULL
          AND campaign.content_hash IS NOT NULL
          AND campaign.body_text_hash IS NOT NULL)::text
  FROM plugin_data.csf_communication_campaigns AS campaign WHERE campaign.id = v_c1;

  -- An unchanged retry of the draft entry point after freezing. It must report
  -- a replay, leave the content alone, and create no second campaign.
  v_result := plugin_data.csf_create_personal_notice_campaign_draft(
    'da100000-0000-4000-8000-000000000001'::uuid,
    'da500000-0000-4000-8000-000000000001'::uuid,
    'A different subject that must not land',
    'Different body text that must not land.');

  INSERT INTO notice_behavior (key, value) VALUES
    ('c1.retrySameCampaign', ((v_result ->> 'campaignId')::uuid = v_c1)::text),
    ('c1.retryReportsReplay', (v_result ->> 'idempotentReplay')),
    ('c1.retryDisposition', (v_result ->> 'disposition'));

  INSERT INTO notice_behavior (key, value)
  SELECT 'c1.contentUnchanged',
         (campaign.content_hash IS NOT DISTINCT FROM v_hash
          AND campaign.subject = 'Your point claim was approved'
          AND campaign.body_text = 'Your claim for 2 points was approved.'
          AND campaign.term_id = 'da200000-0000-4000-8000-000000000002'::uuid)::text
  FROM plugin_data.csf_communication_campaigns AS campaign WHERE campaign.id = v_c1;

  INSERT INTO notice_behavior (key, value)
  SELECT 'c1.oneCampaign', count(*)::text
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.organization_id = 'da100000-0000-4000-8000-000000000001'::uuid
    AND campaign.source_publication_event_id = 'da500000-0000-4000-8000-000000000001'::uuid;

  -- Finalization itself is replay-safe.
  v_result := plugin_data.csf_finalize_personal_notice_content(
    'da100000-0000-4000-8000-000000000001'::uuid, v_c1);
  INSERT INTO notice_behavior (key, value) VALUES
    ('c1.finalizeReplay', (v_result ->> 'idempotentReplay')),
    ('c1.finalizeReplayHash', ((v_result ->> 'contentHash') IS NOT DISTINCT FROM v_hash)::text);

  -- -------------------------------------------------------------------------
  -- A cancelled notice never comes back, even when its record is gone
  -- -------------------------------------------------------------------------
  v_result := plugin_data.csf_create_personal_notice_campaign_draft(
    'da100000-0000-4000-8000-000000000001'::uuid,
    'da500000-0000-4000-8000-000000000003'::uuid,
    'Your point claim was approved',
    'Your claim for 1 point was approved.');
  v_c2 := (v_result ->> 'campaignId')::uuid;

  -- The ledger refuses a bare status write, and it is right to: it would stop
  -- the campaign on screen while leaving its queued attempts claimable, with no
  -- actor and no reason. Asserting the refusal keeps that rule from quietly
  -- eroding, and is why the cancellation below goes through the RPC.
  BEGIN
    UPDATE plugin_data.csf_communication_campaigns
    SET status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Operator withdrew it.'
    WHERE id = v_c2;
    INSERT INTO notice_behavior (key, value) VALUES ('bareCancel.sqlstate', 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO notice_behavior (key, value) VALUES ('bareCancel.sqlstate', SQLSTATE);
  END;

  -- The reviewed withdrawal: it settles outstanding work and records the staff
  -- account and the reason.
  v_result := plugin_data.csf_cancel_communication_campaign(
    'da100000-0000-4000-8000-000000000001'::uuid,
    v_c2,
    'Operator withdrew this notice before it was sent.',
    'da000000-0000-4000-8000-000000000002'::uuid,
    'notice-behavior-cancel-1');

  INSERT INTO notice_behavior (key, value)
  SELECT 'c2.cancellationAudited',
         (campaign.status = 'cancelled'
          AND campaign.cancelled_at IS NOT NULL
          AND campaign.cancelled_by_identity = 'notice.officer@example.test'
          AND campaign.cancellation_reason = 'Operator withdrew this notice before it was sent.')::text
  FROM plugin_data.csf_communication_campaigns AS campaign WHERE campaign.id = v_c2;

  -- The claim the notice was about is removed afterwards, so the term this
  -- function would derive no longer exists to derive.
  DELETE FROM plugin_data.csf_point_submissions
  WHERE id = 'da400000-0000-4000-8000-000000000002'::uuid;

  v_result := plugin_data.csf_create_personal_notice_campaign_draft(
    'da100000-0000-4000-8000-000000000001'::uuid,
    'da500000-0000-4000-8000-000000000003'::uuid,
    'Your point claim was approved',
    'Your claim for 1 point was approved.');

  INSERT INTO notice_behavior (key, value) VALUES
    ('c2.disposition', (v_result ->> 'disposition')),
    ('c2.sameCampaign', ((v_result ->> 'campaignId')::uuid = v_c2)::text);

  INSERT INTO notice_behavior (key, value)
  SELECT 'c2.liveCampaigns', count(*)::text
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.organization_id = 'da100000-0000-4000-8000-000000000001'::uuid
    AND campaign.source_publication_event_id = 'da500000-0000-4000-8000-000000000003'::uuid
    AND campaign.status <> 'cancelled';

  -- -------------------------------------------------------------------------
  -- A failed notice and a review-held notice are receipts too
  -- -------------------------------------------------------------------------
  v_result := plugin_data.csf_create_personal_notice_campaign_draft(
    'da100000-0000-4000-8000-000000000001'::uuid,
    'da500000-0000-4000-8000-000000000004'::uuid,
    'Your point claim was approved', 'Your claim was approved.');
  v_c4 := (v_result ->> 'campaignId')::uuid;
  -- There is no reviewed path from draft to failed. The terminalizer only acts
  -- on a queued or sending campaign, which needs a finalized audience and real
  -- delivery rows behind it; a draft that never dispatched has nothing to
  -- terminalize. So this is a direct write, and it is still vetted: the
  -- terminalization trigger is the rule that governs the transition, and it
  -- admits this one only because there are no attempts, no unknown outcomes and
  -- no undispatched deliveries. It stands in for a notice whose send failed
  -- before it began.
  UPDATE plugin_data.csf_communication_campaigns SET status = 'failed' WHERE id = v_c4;
  v_result := plugin_data.csf_create_personal_notice_campaign_draft(
    'da100000-0000-4000-8000-000000000001'::uuid,
    'da500000-0000-4000-8000-000000000004'::uuid,
    'Your point claim was approved', 'Your claim was approved.');
  INSERT INTO notice_behavior (key, value)
  VALUES ('c4.disposition', (v_result ->> 'disposition'));

  v_result := plugin_data.csf_create_personal_notice_campaign_draft(
    'da100000-0000-4000-8000-000000000001'::uuid,
    'da500000-0000-4000-8000-000000000005'::uuid,
    'Your point claim was approved', 'Your claim was approved.');
  v_c5 := (v_result ->> 'campaignId')::uuid;
  -- A review block is not an operator action either: the dispatch-recovery
  -- paths raise it when a provider outcome is unknown, always paired with a
  -- reason, and no RPC exposes it on its own. Writing the pair directly honours
  -- csf_comm_campaign_review_block_check and leaves the campaign nonterminal,
  -- which is exactly the condition the draft entry point has to recognize.
  UPDATE plugin_data.csf_communication_campaigns
  SET review_blocked_at = now(),
      review_blocked_reason = 'A provider outcome for this notice is unresolved.'
  WHERE id = v_c5;
  v_result := plugin_data.csf_create_personal_notice_campaign_draft(
    'da100000-0000-4000-8000-000000000001'::uuid,
    'da500000-0000-4000-8000-000000000005'::uuid,
    'Your point claim was approved', 'Your claim was approved.');
  INSERT INTO notice_behavior (key, value)
  VALUES ('c5.disposition', (v_result ->> 'disposition'));

  -- -------------------------------------------------------------------------
  -- Refusals
  -- -------------------------------------------------------------------------
  BEGIN
    PERFORM plugin_data.csf_create_personal_notice_campaign_draft(
      'da100000-0000-4000-8000-000000000001'::uuid,
      'da500000-0000-4000-8000-000000000007'::uuid,
      'Cross-chapter attempt', 'This notice belongs to another chapter.');
    INSERT INTO notice_behavior (key, value) VALUES ('wrongOrg.sqlstate', 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO notice_behavior (key, value) VALUES ('wrongOrg.sqlstate', SQLSTATE);
  END;

  BEGIN
    PERFORM plugin_data.csf_create_personal_notice_campaign_draft(
      'da100000-0000-4000-8000-000000000001'::uuid,
      'da500000-0000-4000-8000-0000000000ff'::uuid,
      'Unknown notice', 'There is no such notice.');
    INSERT INTO notice_behavior (key, value) VALUES ('unknownSource.sqlstate', 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO notice_behavior (key, value) VALUES ('unknownSource.sqlstate', SQLSTATE);
  END;

  BEGIN
    PERFORM plugin_data.csf_create_personal_notice_campaign_draft(
      'da100000-0000-4000-8000-000000000001'::uuid,
      'da500000-0000-4000-8000-000000000006'::uuid,
      'Post notice', 'A post is not a personal notice.');
    INSERT INTO notice_behavior (key, value) VALUES ('wrongKind.sqlstate', 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO notice_behavior (key, value) VALUES ('wrongKind.sqlstate', SQLSTATE);
  END;

  -- The guard, reached directly rather than through the entry point: a notice
  -- campaign on a post event, and a notice campaign with no term.
  BEGIN
    INSERT INTO plugin_data.csf_communication_campaigns (
      organization_id, campaign_kind, status, channel, sender_name, sender_email,
      reply_to_email, subject, body_text, source_publication_event_id, term_id,
      audience_kind, created_by_identity, provider_idempotency_key)
    VALUES ('da100000-0000-4000-8000-000000000001'::uuid, 'transactional', 'draft', 'email',
      'DVHS CSF', 'csf@notifications.lets-assist.com', 'dvhighcsf@gmail.com',
      'Direct post notice', 'Body.', 'da500000-0000-4000-8000-000000000006'::uuid,
      'da200000-0000-4000-8000-000000000001'::uuid, 'custom_list', 'system:csf-notice',
      'csf-campaign-direct-post');
    INSERT INTO notice_behavior (key, value) VALUES ('guardWrongKind.sqlstate', 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO notice_behavior (key, value) VALUES ('guardWrongKind.sqlstate', SQLSTATE);
  END;

  BEGIN
    INSERT INTO plugin_data.csf_communication_campaigns (
      organization_id, campaign_kind, status, channel, sender_name, sender_email,
      reply_to_email, subject, body_text, source_publication_event_id, term_id,
      audience_kind, created_by_identity, provider_idempotency_key)
    VALUES ('da100000-0000-4000-8000-000000000001'::uuid, 'transactional', 'draft', 'email',
      'DVHS CSF', 'csf@notifications.lets-assist.com', 'dvhighcsf@gmail.com',
      'Termless notice', 'Body.', 'da500000-0000-4000-8000-000000000002'::uuid,
      NULL, NULL, 'system:csf-notice', 'csf-campaign-termless');
    INSERT INTO notice_behavior (key, value) VALUES ('guardNoTerm.sqlstate', 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO notice_behavior (key, value) VALUES ('guardNoTerm.sqlstate', SQLSTATE);
  END;

  -- A notice campaign carrying a broadcast topic is not a notice.
  BEGIN
    INSERT INTO plugin_data.csf_communication_campaigns (
      organization_id, campaign_kind, status, channel, sender_name, sender_email,
      reply_to_email, subject, body_text, source_publication_event_id, term_id,
      audience_kind, broadcast_topic_key, created_by_identity, provider_idempotency_key)
    VALUES ('da100000-0000-4000-8000-000000000001'::uuid, 'transactional', 'draft', 'email',
      'DVHS CSF', 'csf@notifications.lets-assist.com', 'dvhighcsf@gmail.com',
      'Topic notice', 'Body.', 'da500000-0000-4000-8000-000000000002'::uuid,
      'da200000-0000-4000-8000-000000000001'::uuid, 'custom_list', 'csf-announcements',
      'system:csf-notice', 'csf-campaign-topic');
    INSERT INTO notice_behavior (key, value) VALUES ('guardTopic.sqlstate', 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO notice_behavior (key, value) VALUES ('guardTopic.sqlstate', SQLSTATE);
  END;
END
$do$;

-- ---------------------------------------------------------------------------
-- Derived identity
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c1.termIsClaimTerm'), 'true',
  'a point-submission notice is attributed to the semester the claim was made in, not the current one'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c1.audience'), 'custom_list/null/transactional',
  'a notice campaign names a custom list, no class audience, and stays transactional'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c1.firstCallWasNew'), 'false',
  'the first call on a notice creates the campaign rather than reporting a replay'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c3.termIsCurrentTerm'), 'true',
  'a profile-correction notice is attributed to the chapter''s current semester'
);

-- ---------------------------------------------------------------------------
-- Finalization against the real ledger constraint
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c1.finalizeSqlstate'), 'ok',
  'finalizing a notice no longer trips the campaign dispatch identity check'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c1.frozen'), 'true',
  'finalization records a content hash and a body digest, so the notice is dispatch-ready'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c1.finalizeReplay'), 'true',
  'finalizing twice reports a replay'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c1.finalizeReplayHash'), 'true',
  'the replay returns the digest the first finalization froze'
);

-- ---------------------------------------------------------------------------
-- One campaign per notice, and frozen content stays frozen
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c1.retrySameCampaign'), 'true',
  'an unchanged retry returns the campaign that already exists'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c1.retryReportsReplay'), 'true',
  'an unchanged retry says so'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c1.retryDisposition'), 'open',
  'a finalized notice is still open, not held'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c1.contentUnchanged'), 'true',
  'a retry carrying different copy cannot rewrite frozen content, subject or term'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c1.oneCampaign'), '1',
  'a retry creates no second campaign for the same notice'
);

-- ---------------------------------------------------------------------------
-- Withdrawn, failed and held notices are final
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'bareCancel.sqlstate'), '23514',
  'a bare status write cannot cancel a campaign; the ledger requires the cancellation RPC'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c2.cancellationAudited'), 'true',
  'the withdrawal records the staff account that decided it and the reason they gave'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c2.disposition'), 'held',
  'a cancelled notice replays as held even though its point claim no longer exists'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c2.sameCampaign'), 'true',
  'the held reply names the campaign the operator withdrew'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c2.liveCampaigns'), '0',
  'no live campaign is resurrected for a withdrawn notice'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c4.disposition'), 'held',
  'a failed notice replays as held rather than being retried'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'c5.disposition'), 'held',
  'a notice held for review replays as held'
);

-- ---------------------------------------------------------------------------
-- Refusals
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'wrongOrg.sqlstate'), '23503',
  'a notice belonging to another chapter is refused'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'unknownSource.sqlstate'), '23503',
  'a notice id that names nothing is refused'
);

SELECT extensions.is(
  (SELECT value FROM notice_behavior WHERE key = 'wrongKind.sqlstate'), '42501',
  'a post is not a personal notice and cannot be emailed through this path'
);

SELECT extensions.is(
  (SELECT string_agg(value, ',' ORDER BY key) FROM notice_behavior
   WHERE key IN ('guardNoTerm.sqlstate', 'guardTopic.sqlstate', 'guardWrongKind.sqlstate')),
  '23514,23514,23514',
  'the guard refuses a termless notice, a notice with a broadcast topic, and a notice on a post'
);

SELECT * FROM extensions.finish();

ROLLBACK;
