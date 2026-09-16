-- A personal notice campaign has to be able to finalize its own content.
--
-- 20260917080000 created the one-recipient transactional notice campaign with
-- no term and no audience kind, on the reasoning that a notice to one member
-- has no broadcast audience to describe. The ledger disagrees, and it is right
-- to: csf_communication_campaigns_dispatch_identity_check requires audience_kind
-- and term_id on any campaign that has a content hash, and a content hash is
-- exactly what finalization derives.
--
-- So the draft was created, finalization raised, the hand-off reported an
-- unconfirmed enqueue, and the delivery went back to the queue with a growing
-- backoff. The member's in-app notice arrived and their email never would have.
-- The browser test found this; no unit test could, because the constraint only
-- bites against a real ledger.
--
-- The fix is to say the true thing rather than to loosen the constraint. A
-- notice IS addressed to an explicitly named recipient, which is what
-- 'custom_list' means in this ledger's own vocabulary, and it does belong to a
-- term: the one the submission was claimed in, or the member's current term for
-- a profile correction. Both are derived here from the event rather than passed
-- in, so a caller cannot attribute a notice to the wrong term.
--
-- No historical migration is rewritten and no constraint is relaxed. The
-- campaign simply now carries the identity the ledger has always required.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_guard_personal_notice_campaign_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event plugin_data.csf_publication_events%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE'
    AND NEW.source_publication_event_id IS DISTINCT FROM OLD.source_publication_event_id
  THEN
    RAISE EXCEPTION 'A CSF notice campaign source is immutable.' USING ERRCODE='23514';
  END IF;
  IF NEW.source_publication_event_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_event FROM plugin_data.csf_publication_events
  WHERE id=NEW.source_publication_event_id AND organization_id=NEW.organization_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF notice does not belong to this organization.'
      USING ERRCODE='23503';
  END IF;
  IF v_event.source_kind NOT IN ('point_submission','profile') THEN
    RAISE EXCEPTION 'Only a personal CSF notice may originate a notice campaign.'
      USING ERRCODE='23514';
  END IF;

  -- A notice is transactional and carries no broadcast topic: consent for it is
  -- the recipient's own relationship to their record, not a subscription.
  IF NEW.campaign_kind <> 'transactional'
    OR NEW.broadcast_topic_key IS NOT NULL
    OR NEW.resend_topic_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'A CSF notice campaign is transactional and carries no broadcast topic.'
      USING ERRCODE='23514';
  END IF;

  -- Withdrawal is always allowed, identity or not.
  --
  -- The drafts this migration exists to repair were written without a term or
  -- an audience kind. Requiring one here on every write would mean an operator
  -- could neither send such a draft nor cancel it: it would be stuck, which is
  -- worse than either outcome. A cancelled campaign never dispatches, and
  -- anything that could dispatch is still held to the full identity below and
  -- to the ledger's own dispatch check.
  IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;

  -- Otherwise it is addressed to one explicitly named recipient, which is what
  -- this ledger calls a custom list, and it belongs to a term. Both are
  -- required by the dispatch identity the ledger enforces on any finalized
  -- campaign, so a notice that omitted them could be drafted and never sent.
  IF NEW.audience_kind IS DISTINCT FROM 'custom_list'
    OR NEW.audience_cohort_id IS NOT NULL
    OR NEW.term_id IS NULL
  THEN
    RAISE EXCEPTION
      'A CSF notice campaign names one recipient in a term and no class audience.'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_personal_notice_campaign_scope()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_personal_notice_campaign_scope() TO postgres;

-- The draft, now carrying the term it belongs to.
--
-- The signature is unchanged, so no caller moves: the term is resolved from the
-- event inside the function. A point-submission notice takes the term the claim
-- was made in; a profile notice takes the chapter's current term, which is also
-- the only term in which a profile notice has a recipient at all.
CREATE OR REPLACE FUNCTION plugin_data.csf_create_personal_notice_campaign_draft(
  p_organization_id uuid,
  p_source_publication_event_id uuid,
  p_subject text,
  p_body_text text,
  p_body_html text DEFAULT NULL,
  p_tags jsonb DEFAULT '{}'::jsonb,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_sender_name constant text := 'DVHS CSF';
  c_sender_email constant text := 'csf@notifications.lets-assist.com';
  c_reply_to constant text := 'dvhighcsf@gmail.com';
  v_subject text := nullif(pg_catalog.btrim(coalesce(p_subject,'')),'');
  v_body_text text := nullif(pg_catalog.btrim(coalesce(p_body_text,'')),'');
  v_body_html text := nullif(pg_catalog.btrim(coalesce(p_body_html,'')),'');
  v_correlation text := nullif(pg_catalog.btrim(coalesce(p_correlation_id,'')),'');
  v_tags jsonb := coalesce(p_tags,'{}'::jsonb);
  v_event plugin_data.csf_publication_events%ROWTYPE;
  v_existing plugin_data.csf_communication_campaigns%ROWTYPE;
  v_campaign_id uuid;
  v_term_id uuid;
  -- FOUND is reset by every later query, including the term lookup, so whether
  -- a campaign already exists is captured the moment it is known.
  v_has_existing boolean;
BEGIN
  IF p_organization_id IS NULL OR p_source_publication_event_id IS NULL THEN
    RAISE EXCEPTION 'A CSF notice email draft requires an organization and a notice.'
      USING ERRCODE='22004';
  END IF;
  IF v_subject IS NULL OR pg_catalog.char_length(v_subject) > 200 THEN
    RAISE EXCEPTION 'A CSF notice email subject is 1 to 200 characters.' USING ERRCODE='22023';
  END IF;
  IF v_body_text IS NULL OR pg_catalog.char_length(v_body_text) > 20000 THEN
    RAISE EXCEPTION 'A CSF notice email plain-text body is 1 to 20000 characters.'
      USING ERRCODE='22023';
  END IF;
  IF v_body_html IS NOT NULL AND pg_catalog.char_length(v_body_html) > 60000 THEN
    RAISE EXCEPTION 'A CSF notice email HTML body is at most 60000 characters.'
      USING ERRCODE='22023';
  END IF;
  IF v_correlation IS NOT NULL
    AND (v_correlation ~ '\s' OR pg_catalog.char_length(v_correlation) > 128)
  THEN
    RAISE EXCEPTION 'A CSF correlation identifier is whitespace-free and at most 128 characters.'
      USING ERRCODE='22023';
  END IF;
  IF pg_catalog.jsonb_typeof(v_tags) <> 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_tags)) > 10
    OR plugin_data.csf_jsonb_carries_raw_content(v_tags)
  THEN
    RAISE EXCEPTION 'CSF notice email tags are at most 10 routing fields and may not carry message content.'
      USING ERRCODE='22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-notice-email:'||p_organization_id::text||':'||p_source_publication_event_id::text, 0));

  SELECT * INTO v_event FROM plugin_data.csf_publication_events
  WHERE id=p_source_publication_event_id AND organization_id=p_organization_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF notice does not belong to this organization.' USING ERRCODE='23503';
  END IF;
  IF v_event.source_kind NOT IN ('point_submission','profile') THEN
    RAISE EXCEPTION 'Only a personal CSF notice may be emailed through this path.'
      USING ERRCODE='42501';
  END IF;

  -- The existing campaign for this notice, if there is one, BEFORE anything is
  -- derived from the live record.
  --
  -- A withdrawn or failed campaign is a receipt. Deriving a term first would
  -- mean a notice whose submission has since been removed raised an error
  -- instead of reporting the disposition an operator already chose, and an
  -- automatic replay would keep retrying a decision that was final.
  SELECT * INTO v_existing FROM plugin_data.csf_communication_campaigns
  WHERE organization_id=p_organization_id
    AND source_publication_event_id=p_source_publication_event_id
  ORDER BY (status = 'cancelled'), created_at DESC, id
  LIMIT 1
  FOR UPDATE;
  v_has_existing := FOUND;
  IF v_has_existing AND (
    v_existing.status IN ('cancelled','failed') OR v_existing.review_blocked_at IS NOT NULL
  ) THEN
    RETURN pg_catalog.jsonb_build_object('campaignId',v_existing.id,
      'status',v_existing.status,'campaignKind',v_existing.campaign_kind,
      'contentFinalizedAt',v_existing.content_finalized_at,
      'correlationId',v_correlation,'idempotentReplay',true,
      'disposition','held');
  END IF;

  -- A campaign whose content is already frozen is returned untouched. Its
  -- digest is what an allocated idempotency key was issued against, so its
  -- identity is not ours to revise even if it predates this migration.
  IF v_has_existing AND v_existing.content_finalized_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('campaignId',v_existing.id,'status',v_existing.status,
      'campaignKind',v_existing.campaign_kind,'contentFinalizedAt',v_existing.content_finalized_at,
      'correlationId',v_correlation,'idempotentReplay',true,'disposition','open');
  END IF;

  -- The term this notice belongs to, read from the record it is about.
  IF v_event.source_kind='point_submission' THEN
    SELECT submission.term_id INTO v_term_id
    FROM plugin_data.csf_point_submissions submission
    WHERE submission.organization_id=p_organization_id AND submission.id=v_event.source_id;
  ELSE
    SELECT term.id INTO v_term_id FROM plugin_data.csf_terms term
    WHERE term.organization_id=p_organization_id AND term.is_current;
  END IF;
  IF v_term_id IS NULL THEN
    RAISE EXCEPTION 'That CSF notice has no term to attribute its email to.'
      USING ERRCODE='23514';
  END IF;

  -- REPAIR. A draft written before this migration carries no term and no
  -- audience kind, so finalization would raise and the notice could never be
  -- sent. Repairing it here is repeat-safe: it happens under the same advisory
  -- lock and the same row lock as everything else, it only ever writes the
  -- identity this function would have written when creating the row, and it
  -- touches nothing about the message itself. A draft that already carries the
  -- right identity is left exactly as it is.
  IF v_has_existing THEN
    IF v_existing.term_id IS DISTINCT FROM v_term_id
      OR v_existing.audience_kind IS DISTINCT FROM 'custom_list'
      OR v_existing.audience_cohort_id IS NOT NULL
    THEN
      UPDATE plugin_data.csf_communication_campaigns
      SET term_id = v_term_id,
          audience_kind = 'custom_list',
          audience_cohort_id = NULL,
          updated_at = pg_catalog.now()
      WHERE id = v_existing.id
        AND organization_id = p_organization_id
        AND status = 'draft'
        AND content_finalized_at IS NULL
      RETURNING * INTO v_existing;
      IF NOT FOUND THEN
        RAISE EXCEPTION
          'That CSF notice campaign could not be repaired; it is no longer an unfinalized draft.'
          USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN pg_catalog.jsonb_build_object('campaignId',v_existing.id,'status',v_existing.status,
      'campaignKind',v_existing.campaign_kind,'contentFinalizedAt',v_existing.content_finalized_at,
      'correlationId',v_correlation,'idempotentReplay',true,'disposition','open');
  END IF;

  v_campaign_id := pg_catalog.gen_random_uuid();
  BEGIN
    INSERT INTO plugin_data.csf_communication_campaigns (
      id,organization_id,campaign_kind,status,channel,sender_name,sender_email,reply_to_email,
      subject,body_text,body_html,source_publication_event_id,term_id,audience_kind,
      created_by,created_by_identity,metadata,audience_snapshot_version,provider_idempotency_key
    ) VALUES (
      v_campaign_id,p_organization_id,'transactional','draft','email',
      c_sender_name,c_sender_email,c_reply_to,v_subject,v_body_text,v_body_html,
      p_source_publication_event_id,v_term_id,'custom_list',
      -- A notice has no human author. It is recorded as system-originated
      -- rather than being attributed to whichever officer's edit produced it.
      NULL,'system:csf-notice',
      v_tags,1,'csf-campaign-'||v_campaign_id::text
    );
  EXCEPTION WHEN unique_violation THEN
    -- The racing writer committed first. Its row is the one that counts, and it
    -- is read without the cancelled predicate for the same reason as above.
    SELECT * INTO v_existing FROM plugin_data.csf_communication_campaigns
    WHERE organization_id=p_organization_id
      AND source_publication_event_id=p_source_publication_event_id
    ORDER BY (status = 'cancelled'), created_at DESC, id
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN RAISE; END IF;
    RETURN pg_catalog.jsonb_build_object('campaignId',v_existing.id,'status',v_existing.status,
      'campaignKind',v_existing.campaign_kind,'contentFinalizedAt',v_existing.content_finalized_at,
      'correlationId',v_correlation,'idempotentReplay',true,
      'disposition',CASE WHEN v_existing.status IN ('cancelled','failed')
        OR v_existing.review_blocked_at IS NOT NULL THEN 'held' ELSE 'open' END);
  END;

  RETURN pg_catalog.jsonb_build_object('campaignId',v_campaign_id,'status','draft',
    'campaignKind','transactional','contentFinalizedAt',NULL,
    'correlationId',v_correlation,'idempotentReplay',false,'disposition','open');
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_create_personal_notice_campaign_draft(uuid,uuid,text,text,text,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_personal_notice_campaign_draft(uuid,uuid,text,text,text,jsonb,text)
  TO postgres,service_role;

COMMENT ON FUNCTION plugin_data.csf_create_personal_notice_campaign_draft(uuid,uuid,text,text,text,jsonb,text) IS
  'Opens the one live transactional campaign for a personal CSF notice, or returns the existing one and whether it is open or held. The term is derived from the record the notice is about and the audience kind is custom_list, because the ledger requires both on any campaign it will let reach a content hash.';

COMMIT;
