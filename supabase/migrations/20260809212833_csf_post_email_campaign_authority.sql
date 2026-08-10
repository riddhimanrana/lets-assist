-- DVHS CSF: least-privilege campaign authority for emails born from posts.
--
-- `manage_posts` is the product capability held by Publicity VP and Web Master.
-- Those roles may publish a non-public member post and request its companion
-- email, but the generic campaign authoring/finalization RPCs correctly require
-- `manage_settings`.  The old application path called those generic RPCs after
-- the post insert, so the post was durable while the action reported that it
-- was not saved.
--
-- These two deliberately narrow doors authorize only a campaign whose source is
-- a same-organization, published, non-public announcement.  Standalone
-- campaigns, campaign editing, cancellation, delivery review, provider-event
-- reconciliation, and the Communications console remain `manage_settings`.

BEGIN;

-- A class post's audience is a durable campaign coordinate, not a value to
-- rediscover from the mutable source post during a retry.  The composite FK
-- prevents a service-role caller from attaching another chapter's cohort.
ALTER TABLE plugin_data.csf_communication_campaigns
  ADD COLUMN audience_cohort_id uuid;

UPDATE plugin_data.csf_communication_campaigns AS campaign
SET audience_cohort_id = announcement.audience_cohort_id
FROM plugin_data.csf_announcements AS announcement
WHERE campaign.source_announcement_id = announcement.id
  AND campaign.organization_id = announcement.organization_id
  AND campaign.audience_kind = 'cohort_members'
  AND announcement.audience = 'class'
  AND announcement.audience_cohort_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_communication_campaigns AS campaign
    LEFT JOIN plugin_data.csf_announcements AS announcement
      ON announcement.id = campaign.source_announcement_id
     AND announcement.organization_id = campaign.organization_id
    WHERE campaign.source_announcement_id IS NOT NULL
      AND (
        announcement.id IS NULL
        OR (
          announcement.audience = 'class'
          AND (
            campaign.audience_kind IS DISTINCT FROM 'cohort_members'
            OR campaign.audience_cohort_id IS DISTINCT FROM
              announcement.audience_cohort_id
          )
        )
        OR (
          campaign.audience_kind = 'cohort_members'
          AND (
            announcement.audience IS DISTINCT FROM 'class'
            OR campaign.audience_cohort_id IS NULL
          )
        )
        OR (
          announcement.audience IS DISTINCT FROM 'class'
          AND campaign.audience_cohort_id IS NOT NULL
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Existing post email campaigns contain an invalid class audience coordinate.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE plugin_data.csf_communication_campaigns
  ADD CONSTRAINT csf_communication_campaigns_audience_cohort_organization_fkey
    FOREIGN KEY (audience_cohort_id, organization_id)
    REFERENCES plugin_data.csf_cohorts (id, organization_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT csf_communication_campaigns_audience_cohort_shape_check
    CHECK (
      (
        audience_kind = 'cohort_members'
        AND (
          source_announcement_id IS NULL
          OR audience_cohort_id IS NOT NULL
        )
      )
      OR (
        audience_kind IS DISTINCT FROM 'cohort_members'
        AND audience_cohort_id IS NULL
      )
    );

COMMENT ON COLUMN plugin_data.csf_communication_campaigns.audience_cohort_id IS
  'Immutable tenant-scoped cohort frozen when a class-post email draft is created. Retries and audience reconstruction use this coordinate and refuse source-post drift.';

CREATE FUNCTION plugin_data.csf_guard_communication_campaign_class_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_audience text;
  v_source_cohort_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.audience_cohort_id IS DISTINCT FROM OLD.audience_cohort_id
  THEN
    RAISE EXCEPTION
      'A CSF campaign class audience coordinate is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_announcement_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT announcement.audience, announcement.audience_cohort_id
  INTO v_source_audience, v_source_cohort_id
  FROM plugin_data.csf_announcements AS announcement
  WHERE announcement.id = NEW.source_announcement_id
    AND announcement.organization_id = NEW.organization_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'That CSF campaign source announcement does not belong to this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_source_audience = 'class' THEN
    IF NEW.audience_kind IS DISTINCT FROM 'cohort_members'
      OR NEW.audience_cohort_id IS NULL
      OR NEW.audience_cohort_id IS DISTINCT FROM v_source_cohort_id
    THEN
      RAISE EXCEPTION
        'A class-post campaign must preserve its source post cohort.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.audience_kind = 'cohort_members'
    OR NEW.audience_cohort_id IS NOT NULL
  THEN
    RAISE EXCEPTION
      'Only a class-post campaign may carry a source-post cohort.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION
  plugin_data.csf_guard_communication_campaign_class_scope()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER csf_communication_campaigns_class_scope_guard
BEFORE INSERT OR UPDATE ON plugin_data.csf_communication_campaigns
FOR EACH ROW EXECUTE FUNCTION
  plugin_data.csf_guard_communication_campaign_class_scope();

CREATE FUNCTION plugin_data.csf_assert_post_email_topic_configuration(
  p_organization_id uuid,
  p_audience_kind text,
  p_broadcast_topic_key text,
  p_resend_topic_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_topic_audience text := CASE
    WHEN p_audience_kind = 'cohort_members' THEN 'term_members'
    ELSE p_audience_kind
  END;
  v_configured_topic text;
  v_configured_resend_topic text;
BEGIN
  SELECT
    nullif(btrim(install.configuration #>> ARRAY[
      'communications', 'broadcastTopics', v_topic_audience, 'topicKey'
    ]), ''),
    nullif(btrim(install.configuration #>> ARRAY[
      'communications', 'broadcastTopics', v_topic_audience, 'resendTopicId'
    ]), '')
  INTO v_configured_topic, v_configured_resend_topic
  FROM public.organization_plugin_installs AS install
  WHERE install.organization_id = p_organization_id
    AND install.plugin_key = 'dvhs-csf'
    AND install.enabled = true;

  IF v_configured_topic IS NULL
    OR v_configured_resend_topic IS NULL
    OR nullif(btrim(coalesce(p_broadcast_topic_key, '')), '')
      IS DISTINCT FROM v_configured_topic
    OR nullif(btrim(coalesce(p_resend_topic_id, '')), '')
      IS DISTINCT FROM v_configured_resend_topic
  THEN
    RAISE EXCEPTION
      'Post email topics must match the active CSF communications configuration.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION plugin_data.csf_create_post_email_campaign_draft(
  p_organization_id uuid,
  p_source_announcement_id uuid,
  p_subject text,
  p_body_text text,
  p_actor_user_id uuid,
  p_term_id uuid,
  p_audience_kind text,
  p_body_html text DEFAULT NULL,
  p_broadcast_topic_key text DEFAULT NULL,
  p_resend_topic_id text DEFAULT NULL,
  p_tags jsonb DEFAULT '{}'::jsonb,
  p_correlation_id text DEFAULT NULL,
  p_audience_cohort_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_capability constant text := 'manage_posts';
  c_sender_name constant text := 'DVHS CSF';
  c_sender_email constant text := 'csf@notifications.lets-assist.com';
  c_reply_to constant text := 'dvhighcsf@gmail.com';
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_body_text text := nullif(btrim(coalesce(p_body_text, '')), '');
  v_body_html text := nullif(btrim(coalesce(p_body_html, '')), '');
  v_topic text := nullif(btrim(coalesce(p_broadcast_topic_key, '')), '');
  v_resend_topic text := nullif(btrim(coalesce(p_resend_topic_id, '')), '');
  v_correlation text := nullif(btrim(coalesce(p_correlation_id, '')), '');
  v_tags jsonb := coalesce(p_tags, '{}'::jsonb);
  v_actor_identity text;
  v_expected_audience_kind text;
  v_campaign_id uuid;
  v_existing plugin_data.csf_communication_campaigns%ROWTYPE;
  v_announcement plugin_data.csf_announcements%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_source_announcement_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF post email draft requires an organization and a source announcement.'
      USING ERRCODE = '22004';
  END IF;

  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF post email draft must record the staff account that requested it.'
      USING ERRCODE = '22004';
  END IF;

  -- Authorization comes before the source row is disclosed or locked.
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, c_capability
  ) THEN
    RAISE EXCEPTION
      'That account does not hold the CSF staff capability required to email a post in this organization.'
      USING ERRCODE = '42501';
  END IF;

  IF v_subject IS NULL OR pg_catalog.char_length(v_subject) > 200 THEN
    RAISE EXCEPTION 'A CSF post email subject is 1 to 200 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_body_text IS NULL OR pg_catalog.char_length(v_body_text) > 20000 THEN
    RAISE EXCEPTION 'A CSF post email plain-text body is 1 to 20000 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_body_html IS NOT NULL AND pg_catalog.char_length(v_body_html) > 60000 THEN
    RAISE EXCEPTION 'A CSF post email HTML body is at most 60000 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF p_term_id IS NULL THEN
    RAISE EXCEPTION 'A CSF post email requires the term whose audience it targets.'
      USING ERRCODE = '22004';
  END IF;

  IF p_audience_kind NOT IN ('term_members', 'cohort_members', 'staff') THEN
    RAISE EXCEPTION
      'A CSF post email targets term members, one cohort, or current staff.'
      USING ERRCODE = '22023';
  END IF;

  IF v_topic IS NULL OR v_resend_topic IS NULL THEN
    RAISE EXCEPTION
      'A CSF post email requires both its consent topic and provider topic.'
      USING ERRCODE = '22004';
  END IF;

  IF v_correlation IS NOT NULL
    AND (v_correlation ~ '\s' OR pg_catalog.char_length(v_correlation) > 128)
  THEN
    RAISE EXCEPTION
      'A CSF correlation identifier is whitespace-free and at most 128 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_tags) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(v_tags)) > 10
    OR plugin_data.csf_jsonb_carries_raw_content(v_tags)
  THEN
    RAISE EXCEPTION
      'CSF post email tags are at most 10 routing fields and may not carry message content.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_terms AS term
    WHERE term.id = p_term_id
      AND term.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'That CSF term does not belong to this organization.'
      USING ERRCODE = '23503';
  END IF;

  -- One serialized coordinate makes retries and simultaneous clicks converge on
  -- the same live campaign.  The table's partial unique index is the final guard
  -- against older/generic writers that do not yet take this advisory lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-post-email:' || p_organization_id::text || ':'
        || p_source_announcement_id::text,
      0
    )
  );

  SELECT announcement.*
  INTO v_announcement
  FROM plugin_data.csf_announcements AS announcement
  WHERE announcement.id = p_source_announcement_id
    AND announcement.organization_id = p_organization_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF announcement does not belong to this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_announcement.status <> 'published'
    OR v_announcement.published_at IS NULL
  THEN
    RAISE EXCEPTION 'Only a published CSF post can be emailed.'
      USING ERRCODE = '23514';
  END IF;

  IF v_announcement.audience = 'public' THEN
    RAISE EXCEPTION 'Public CSF posts are not sent as member email.'
      USING ERRCODE = '23514';
  END IF;

  v_expected_audience_kind := CASE v_announcement.audience
    WHEN 'members' THEN 'term_members'
    WHEN 'officers' THEN 'staff'
    WHEN 'class' THEN 'cohort_members'
    ELSE NULL
  END;

  IF v_expected_audience_kind IS NULL
    OR p_audience_kind IS DISTINCT FROM v_expected_audience_kind
  THEN
    RAISE EXCEPTION
      'The post email audience must match the published post audience.'
      USING ERRCODE = '23514';
  END IF;

  -- The poster never chooses consent/provider coordinates. Even a trusted
  -- service caller must prove the exact active plugin configuration so a
  -- manage_posts role cannot bypass a member opt-out boundary.
  PERFORM plugin_data.csf_assert_post_email_topic_configuration(
    p_organization_id,
    p_audience_kind,
    v_topic,
    v_resend_topic
  );

  IF v_announcement.audience = 'class'
    AND v_announcement.audience_cohort_id IS NULL
  THEN
    RAISE EXCEPTION 'A class post must name its graduating class before email.'
      USING ERRCODE = '23514';
  END IF;

  IF v_announcement.audience = 'class'
    AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_cohorts AS cohort
      WHERE cohort.id = v_announcement.audience_cohort_id
        AND cohort.organization_id = p_organization_id
    )
  THEN
    RAISE EXCEPTION
      'The class post cohort does not belong to this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_announcement.audience = 'class'
    AND p_audience_cohort_id IS DISTINCT FROM
      v_announcement.audience_cohort_id
  THEN
    RAISE EXCEPTION
      'The class email cohort must exactly match the published post cohort.'
      USING ERRCODE = '23514';
  END IF;

  IF v_announcement.audience <> 'class'
    AND p_audience_cohort_id IS NOT NULL
  THEN
    RAISE EXCEPTION
      'A non-class post email cannot carry a class cohort.'
      USING ERRCODE = '23514';
  END IF;

  IF v_announcement.term_id IS NOT NULL
    AND v_announcement.term_id IS DISTINCT FROM p_term_id
  THEN
    RAISE EXCEPTION 'The post email term must match the published post term.'
      USING ERRCODE = '23514';
  END IF;

  SELECT campaign.*
  INTO v_existing
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.organization_id = p_organization_id
    AND campaign.source_announcement_id = p_source_announcement_id
    AND campaign.status <> 'cancelled'
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.term_id IS DISTINCT FROM p_term_id
      OR v_existing.audience_kind IS DISTINCT FROM p_audience_kind
      OR v_existing.broadcast_topic_key IS DISTINCT FROM v_topic
      OR v_existing.resend_topic_id IS DISTINCT FROM v_resend_topic
      OR v_existing.audience_cohort_id IS DISTINCT FROM
        p_audience_cohort_id
    THEN
      RAISE EXCEPTION
        'The existing post email campaign no longer matches the requested frozen audience.'
        USING ERRCODE = '23514';
    END IF;

    IF v_existing.status = 'failed'
      OR v_existing.review_blocked_at IS NOT NULL
    THEN
      RAISE EXCEPTION
        'The existing post email campaign requires Communications review before it can continue.'
        USING ERRCODE = '23514';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'campaignId', v_existing.id,
      'status', v_existing.status,
      'campaignKind', v_existing.campaign_kind,
      'correlationId', v_correlation,
      'idempotentReplay', true
    );
  END IF;

  SELECT lower(btrim(coalesce(account.email, '')))
  INTO v_actor_identity
  FROM auth.users AS account
  WHERE account.id = p_actor_user_id;

  v_actor_identity := coalesce(
    nullif(v_actor_identity, ''), 'user:' || p_actor_user_id::text
  );
  v_campaign_id := pg_catalog.gen_random_uuid();

  BEGIN
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, channel,
      sender_name, sender_email, reply_to_email,
      subject, body_text, body_html, term_id, audience_kind,
      broadcast_topic_key, resend_topic_id, source_announcement_id,
      audience_cohort_id,
      created_by, created_by_identity, metadata,
      audience_snapshot_version, provider_idempotency_key
    ) VALUES (
      v_campaign_id, p_organization_id, 'broadcast', 'draft', 'email',
      c_sender_name, c_sender_email, c_reply_to,
      v_subject, v_body_text, v_body_html, p_term_id, p_audience_kind,
      v_topic, v_resend_topic, p_source_announcement_id,
      p_audience_cohort_id,
      p_actor_user_id, v_actor_identity, v_tags,
      1, 'csf-campaign-' || v_campaign_id::text
    );
  EXCEPTION WHEN unique_violation THEN
    -- A legacy/generic writer does not take the post-scoped advisory lock. The
    -- table's live-source unique index still makes the race converge here.
    SELECT campaign.*
    INTO v_existing
    FROM plugin_data.csf_communication_campaigns AS campaign
    WHERE campaign.organization_id = p_organization_id
      AND campaign.source_announcement_id = p_source_announcement_id
      AND campaign.status <> 'cancelled'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE;
    END IF;

    IF v_existing.term_id IS DISTINCT FROM p_term_id
      OR v_existing.audience_kind IS DISTINCT FROM p_audience_kind
      OR v_existing.broadcast_topic_key IS DISTINCT FROM v_topic
      OR v_existing.resend_topic_id IS DISTINCT FROM v_resend_topic
      OR v_existing.audience_cohort_id IS DISTINCT FROM
        p_audience_cohort_id
    THEN
      RAISE EXCEPTION
        'The existing post email campaign no longer matches the requested frozen audience.'
        USING ERRCODE = '23514';
    END IF;

    IF v_existing.status = 'failed'
      OR v_existing.review_blocked_at IS NOT NULL
    THEN
      RAISE EXCEPTION
        'The existing post email campaign requires Communications review before it can continue.'
        USING ERRCODE = '23514';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'campaignId', v_existing.id,
      'status', v_existing.status,
      'campaignKind', v_existing.campaign_kind,
      'correlationId', v_correlation,
      'idempotentReplay', true
    );
  END;

  RETURN pg_catalog.jsonb_build_object(
    'campaignId', v_campaign_id,
    'status', 'draft',
    'campaignKind', 'broadcast',
    'correlationId', v_correlation,
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_create_post_email_campaign_draft(
  uuid, uuid, text, text, uuid, uuid, text, text, text, text, jsonb, text, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_post_email_topic_configuration(
  uuid, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_post_email_campaign_draft(
  uuid, uuid, text, text, uuid, uuid, text, text, text, text, jsonb, text, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_create_post_email_campaign_draft(
  uuid, uuid, text, text, uuid, uuid, text, text, text, text, jsonb, text, uuid
) IS
  'Creates or returns the one live broadcast campaign attached to a same-organization, published, non-public CSF post. Requires tenant-scoped manage_posts; derives sender and provider idempotency identity; verifies post, term, audience, exact frozen class cohort, consent topics, and bounded content under lock. Standalone campaign authoring remains manage_settings-only.';

CREATE FUNCTION plugin_data.csf_finalize_post_email_campaign_content(
  p_organization_id uuid,
  p_campaign_id uuid,
  p_actor_user_id uuid,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_capability constant text := 'manage_posts';
  v_correlation text := nullif(btrim(coalesce(p_correlation_id, '')), '');
  v_actor_identity text;
  v_expected_audience_kind text;
  v_now timestamptz := now();
  v_campaign plugin_data.csf_communication_campaigns%ROWTYPE;
  v_announcement plugin_data.csf_announcements%ROWTYPE;
  v_content_hash text;
BEGIN
  IF p_organization_id IS NULL OR p_campaign_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF post email finalization requires an organization and a campaign.'
      USING ERRCODE = '22004';
  END IF;

  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF post email finalization must record the staff account that approved its copy.'
      USING ERRCODE = '22004';
  END IF;

  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, c_capability
  ) THEN
    RAISE EXCEPTION
      'That account does not hold the CSF staff capability required to finalize a post email in this organization.'
      USING ERRCODE = '42501';
  END IF;

  IF v_correlation IS NOT NULL
    AND (v_correlation ~ '\s' OR pg_catalog.char_length(v_correlation) > 128)
  THEN
    RAISE EXCEPTION
      'A CSF correlation identifier is whitespace-free and at most 128 characters.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-campaign:' || p_organization_id::text || ':'
        || p_campaign_id::text,
      0
    )
  );

  SELECT campaign.*
  INTO v_campaign
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_campaign.source_announcement_id IS NULL
    OR v_campaign.campaign_kind <> 'broadcast'
  THEN
    RAISE EXCEPTION
      'Only a campaign attached to a published CSF post can use post finalization.'
      USING ERRCODE = '42501';
  END IF;

  SELECT announcement.*
  INTO v_announcement
  FROM plugin_data.csf_announcements AS announcement
  WHERE announcement.id = v_campaign.source_announcement_id
    AND announcement.organization_id = p_organization_id
  FOR SHARE;

  IF NOT FOUND
    OR v_announcement.status <> 'published'
    OR v_announcement.published_at IS NULL
    OR v_announcement.audience = 'public'
  THEN
    RAISE EXCEPTION
      'The source post must still be published, non-public, and in this organization.'
      USING ERRCODE = '23514';
  END IF;

  v_expected_audience_kind := CASE v_announcement.audience
    WHEN 'members' THEN 'term_members'
    WHEN 'officers' THEN 'staff'
    WHEN 'class' THEN 'cohort_members'
    ELSE NULL
  END;

  IF v_campaign.audience_kind IS DISTINCT FROM v_expected_audience_kind
    OR (
      v_announcement.term_id IS NOT NULL
      AND v_campaign.term_id IS DISTINCT FROM v_announcement.term_id
    )
    OR (
      v_announcement.audience = 'class'
      AND v_announcement.audience_cohort_id IS NULL
    )
    OR v_campaign.audience_cohort_id IS DISTINCT FROM (
      CASE
        WHEN v_announcement.audience = 'class'
          THEN v_announcement.audience_cohort_id
        ELSE NULL
      END
    )
    OR (
      v_announcement.audience = 'class'
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_cohorts AS cohort
        WHERE cohort.id = v_announcement.audience_cohort_id
          AND cohort.organization_id = p_organization_id
      )
    )
  THEN
    RAISE EXCEPTION
      'The post campaign no longer matches its published term or audience.'
      USING ERRCODE = '23514';
  END IF;

  IF v_campaign.content_finalized_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'campaignId', p_campaign_id,
      'contentFinalizedAt', v_campaign.content_finalized_at,
      'contentHash', v_campaign.content_hash,
      'idempotentReplay', true
    );
  END IF;

  -- A provider-topic rotation after draft creation requires an operator to
  -- review/recreate the draft under the current unsubscribe configuration.
  -- Exact finalization replays above remain available for already-frozen copy.
  PERFORM plugin_data.csf_assert_post_email_topic_configuration(
    p_organization_id,
    v_campaign.audience_kind,
    v_campaign.broadcast_topic_key,
    v_campaign.resend_topic_id
  );

  IF v_campaign.status <> 'draft' THEN
    RAISE EXCEPTION
      'CSF post email content is finalized while its campaign is a draft; this one is "%".',
      v_campaign.status
      USING ERRCODE = '23514';
  END IF;

  IF nullif(btrim(coalesce(v_campaign.body_text, '')), '') IS NULL THEN
    RAISE EXCEPTION
      'A CSF post email needs a plain-text body before finalization.'
      USING ERRCODE = '23514';
  END IF;

  SELECT lower(btrim(coalesce(account.email, '')))
  INTO v_actor_identity
  FROM auth.users AS account
  WHERE account.id = p_actor_user_id;

  v_actor_identity := coalesce(
    nullif(v_actor_identity, ''), 'user:' || p_actor_user_id::text
  );

  UPDATE plugin_data.csf_communication_campaigns
  SET
    content_finalized_at = v_now,
    content_finalized_by = p_actor_user_id,
    content_finalized_by_identity = v_actor_identity,
    correlation_id = coalesce(correlation_id, v_correlation),
    updated_at = v_now
  WHERE id = p_campaign_id
    AND organization_id = p_organization_id
  RETURNING content_hash INTO v_content_hash;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'campaignId', p_campaign_id,
    'contentFinalizedAt', v_now,
    'contentHash', v_content_hash,
    'actorUserId', p_actor_user_id,
    'actorIdentity', v_actor_identity,
    'correlationId', v_correlation,
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_finalize_post_email_campaign_content(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finalize_post_email_campaign_content(
  uuid, uuid, uuid, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_finalize_post_email_campaign_content(
  uuid, uuid, uuid, text
) IS
  'Freezes content only for a broadcast campaign still attached to a same-organization, published, non-public CSF post. Requires tenant-scoped manage_posts and revalidates source post, term, audience, and exact frozen class cohort under lock. Generic campaign finalization remains manage_settings-only.';

COMMIT;
