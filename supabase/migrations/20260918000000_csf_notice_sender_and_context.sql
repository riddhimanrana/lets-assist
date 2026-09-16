-- CSF campaign sender identity and authorized notice context.
--
-- New CSF campaigns record the platform default sender identity
-- (projects@notifications.lets-assist.com) with the chapter in the display
-- name, instead of csf@notifications.lets-assist.com. Provider delivery for
-- either address is unverified here. Frozen campaigns keep their stored
-- identity and content hash; nothing is rewritten or resent.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The dispatch identity a campaign must carry to be sendable.
-- ---------------------------------------------------------------------------
-- Both identities are accepted so campaigns finalized before this migration
-- stay valid under the same rule. The constraint is otherwise unchanged.
--
-- It is found by definition rather than by name because the original was named
-- by PostgreSQL and a generated name can differ between databases.
ALTER TABLE plugin_data.csf_communication_campaigns
  DROP CONSTRAINT IF EXISTS csf_communication_campaigns_dispatch_identity_check;

ALTER TABLE plugin_data.csf_communication_campaigns
  ADD CONSTRAINT csf_communication_campaigns_dispatch_identity_check
    CHECK (
      content_hash IS NULL
      OR (
        (
          -- Recorded by campaigns finalized before 20260918000000.
          (sender_email = 'csf@notifications.lets-assist.com'
            AND sender_name = 'DVHS CSF')
          OR
          -- Recorded by campaigns created from 20260918000000 onward.
          (sender_email = 'projects@notifications.lets-assist.com'
            AND sender_name = 'DVHS CSF (Let''s Assist)')
        )
        AND reply_to_email = 'dvhighcsf@gmail.com'
        AND channel = 'email'
        AND nullif(btrim(body_text), '') IS NOT NULL
        AND body_text_hash IS NOT NULL
        AND audience_kind IS NOT NULL
        AND term_id IS NOT NULL
        AND created_by_identity IS NOT NULL
      )
    );

COMMENT ON CONSTRAINT csf_communication_campaigns_dispatch_identity_check
  ON plugin_data.csf_communication_campaigns IS
  'A campaign that records a content hash is dispatch-ready and must carry one of the two reviewed CSF sending identities, the dvhighcsf@gmail.com reply-to, a plain-text body, a body digest, an audience kind, a term, and a frozen creator identity. DVHS CSF <csf@notifications.lets-assist.com> is accepted for campaigns finalized before 20260918000000; DVHS CSF (Let''s Assist) <projects@notifications.lets-assist.com> is what every campaign created after it records.';

-- ---------------------------------------------------------------------------
-- 2. One place that records the sender, for every campaign lane.
-- ---------------------------------------------------------------------------
-- Four authoring functions set the sender: the generic campaign draft, the
-- announcement (post) campaign, the post email campaign authority, and the
-- activity publication campaign. A fifth, the personal notice draft, is the
-- notification lane. All five pass the same historical constants, so the
-- substitution happens once here rather than by restating five function bodies.
--
-- Scope, and why it is narrow:
--   * INSERT only. An UPDATE is never touched, so no finalized campaign moves
--     and no stored content hash is recalculated.
--   * Only a row carrying the historical CSF identity is substituted. A row
--     naming any other sender is left exactly as written, so the constraint
--     above still rejects an arbitrary sender rather than silently correcting
--     it.
--
-- The address is a constant, not a per-deployment value. Local and isolated
-- environments are separated by transport selection, which routes to Mailpit
-- regardless of the recorded sender, not by what this column holds.
CREATE FUNCTION plugin_data.csf_campaign_platform_sender_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.sender_email = 'csf@notifications.lets-assist.com'
    AND NEW.sender_name = 'DVHS CSF'
  THEN
    NEW.sender_email := 'projects@notifications.lets-assist.com';
    NEW.sender_name := 'DVHS CSF (Let''s Assist)';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_campaign_platform_sender_identity()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_campaign_platform_sender_identity() TO postgres;

COMMENT ON FUNCTION plugin_data.csf_campaign_platform_sender_identity() IS
  'Records the platform default sender identity on a new CSF campaign that was authored with the historical csf@notifications.lets-assist.com identity. INSERT only, so no finalized campaign and no stored content hash is altered. A campaign naming any other sender is left unchanged and is still judged by csf_communication_campaigns_dispatch_identity_check.';

-- The trigger name sorts before csf_communication_campaigns_content_freeze_*
-- triggers so the substitution is in place before any digest is derived.
CREATE TRIGGER csf_communication_campaigns_aa_platform_sender
  BEFORE INSERT ON plugin_data.csf_communication_campaigns
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_campaign_platform_sender_identity();

-- ---------------------------------------------------------------------------
-- 3. The class, the term, and what happened.
-- ---------------------------------------------------------------------------
-- Identical to 20260917080000 apart from three added return keys and the locals
-- that derive them. Every existing key keeps its meaning, so a worker that has
-- not been updated is unaffected, and a worker that has been updated against a
-- database that has not taken this migration reads three nulls.
--
--   termLabel          the term the object belongs to, e.g. "Fall 2026".
--   audienceLabel      the class label when the object is scoped to one class,
--                      NULL when it is chapter-wide. Both are chapter-published
--                      strings about an object the recipient check above has
--                      already established this member may open.
--   authorizedOutcome  the submission's own status, for a point submission
--                      only. NULL for every other kind, so a profile notice
--                      still returns nothing about what changed.
CREATE OR REPLACE FUNCTION plugin_data.csf_authorize_publication_notification(
  p_organization_id uuid,p_delivery_id uuid,p_lease_token uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_delivery plugin_data.csf_publication_notification_deliveries%ROWTYPE;
  v_event plugin_data.csf_publication_events%ROWTYPE;
  v_allowed boolean;
  v_tab text := 'csf-home';
  v_param text;
  v_extra text := '';
  v_subject text;
  v_chapter text;
  v_email text;
  v_personal boolean;
  v_term_id uuid;
  v_cohort_id uuid;
  v_term_label text;
  v_audience_label text;
  v_outcome text;
BEGIN
  SELECT * INTO v_delivery FROM plugin_data.csf_publication_notification_deliveries
  WHERE organization_id=p_organization_id AND id=p_delivery_id FOR UPDATE;
  IF NOT FOUND OR v_delivery.status <> 'processing' OR v_delivery.lease_token IS DISTINCT FROM p_lease_token
    OR v_delivery.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'Notification lease is not current.' USING ERRCODE='40001';
  END IF;
  SELECT * INTO STRICT v_event FROM plugin_data.csf_publication_events
    WHERE organization_id=p_organization_id AND id=v_delivery.event_id;
  v_personal := v_event.source_kind IN ('point_submission','profile');
  v_allowed := plugin_data.csf_publication_recipient_allowed(p_organization_id,v_event.source_kind,v_event.source_id,v_delivery.user_id)
    AND NOT EXISTS (SELECT 1 FROM public.notification_settings
      WHERE user_id=v_delivery.user_id AND organization_updates=false);
  IF NOT v_allowed THEN
    UPDATE plugin_data.csf_publication_notification_deliveries
    SET status='skipped',completed_at=now(),lease_token=NULL,lease_expires_at=NULL WHERE id=v_delivery.id;
    RETURN jsonb_build_object('authorized',false);
  END IF;
  IF (v_event.source_kind='post' AND EXISTS (SELECT 1 FROM plugin_data.csf_announcements
      WHERE organization_id=p_organization_id AND id=v_event.source_id AND audience='officers'))
    OR (v_event.source_kind='activity' AND EXISTS (SELECT 1 FROM public.organization_members
      WHERE organization_id=p_organization_id AND user_id=v_delivery.user_id AND status='active' AND role IN ('admin','staff')) AND
      plugin_data.csf_actor_has_permission(p_organization_id,v_delivery.user_id,'manage_opportunities')) THEN
    v_tab := 'csf-overview';
  END IF;

  SELECT nullif(btrim(name),'') INTO v_chapter FROM public.organizations WHERE id=p_organization_id;

  IF v_event.source_kind='post' THEN
    v_tab := CASE WHEN v_tab='csf-overview' THEN 'csf-overview' ELSE 'csf-home' END;
    SELECT nullif(btrim(title),''), term_id, audience_cohort_id
      INTO v_subject, v_term_id, v_cohort_id
      FROM plugin_data.csf_announcements
      WHERE organization_id=p_organization_id AND id=v_event.source_id;
  ELSIF v_event.source_kind='activity' THEN
    v_extra := CASE WHEN v_tab='csf-overview' THEN '&csf_service=opportunities' ELSE '' END;
    v_tab := 'csf-activities';
    v_param := 'csf_activity';
    SELECT nullif(btrim(title),''), term_id, cohort_id
      INTO v_subject, v_term_id, v_cohort_id
      FROM plugin_data.csf_opportunities
      WHERE organization_id=p_organization_id AND id=v_event.source_id;
  ELSIF v_event.source_kind='point_submission' THEN
    v_tab := 'csf-submissions';
    v_param := 'csf_submission';
    -- The ACTIVITY's title, the submission's own status, and the term it was
    -- claimed in. The description is not read: it is the member's free text and
    -- an officer may have amended it.
    SELECT nullif(btrim(activity.title),''), nullif(btrim(submission.status),''),
           submission.term_id
    INTO v_subject, v_outcome, v_term_id
    FROM plugin_data.csf_point_submissions submission
    LEFT JOIN plugin_data.csf_opportunities activity
      ON activity.organization_id = submission.organization_id
     AND activity.id = submission.opportunity_id
    WHERE submission.organization_id=p_organization_id AND submission.id=v_event.source_id;
  ELSIF v_event.source_kind='profile' THEN
    v_tab := 'csf-profile';
    v_param := NULL;
    v_subject := NULL;
    -- A profile notice names the current term only, and still says nothing
    -- about what moved on the record.
    SELECT id INTO v_term_id FROM plugin_data.csf_terms
      WHERE organization_id=p_organization_id AND is_current;
  END IF;

  IF v_term_id IS NOT NULL THEN
    SELECT nullif(btrim(label),'') INTO v_term_label FROM plugin_data.csf_terms
      WHERE organization_id=p_organization_id AND id=v_term_id;
  END IF;
  IF v_cohort_id IS NOT NULL THEN
    SELECT nullif(btrim(label),'') INTO v_audience_label FROM plugin_data.csf_cohorts
      WHERE organization_id=p_organization_id AND id=v_cohort_id;
  END IF;

  IF v_personal AND NOT EXISTS (SELECT 1 FROM public.notification_settings
    WHERE user_id=v_delivery.user_id AND email_notifications=false) THEN
    v_email := plugin_data.csf_verified_account_email(v_delivery.user_id);
  END IF;

  RETURN jsonb_build_object('authorized',true,'userId',v_delivery.user_id,
    'organizationId',p_organization_id,'eventId',v_event.id,'sourceKind',v_event.source_kind,
    'sourceId',v_event.source_id,
    'actionUrl','/organization/'||p_organization_id::text||'?tab='||v_tab||v_extra||
      CASE WHEN v_param IS NULL THEN '' ELSE '&'||v_param||'='||v_event.source_id::text END,
    'profileId',CASE WHEN v_event.source_kind='profile' THEN v_event.source_id
      WHEN v_event.source_kind='point_submission' THEN
        (SELECT profile_id FROM plugin_data.csf_point_submissions
         WHERE organization_id=p_organization_id AND id=v_event.source_id)
      ELSE NULL END,
    'dedupeKey','csf-publication:'||v_event.id::text,
    'chapterName',v_chapter,
    'authorizedSubject',v_subject,
    'termLabel',v_term_label,
    'audienceLabel',v_audience_label,
    'authorizedOutcome',v_outcome,
    'recipientEmail',v_email);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid) TO postgres,service_role;

COMMENT ON FUNCTION plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid) IS
  'Re-checks one leased delivery against current visibility and preferences, then returns the coordinate the worker may open plus the words it may quote: the chapter name, the term label, the class label when the object is scoped to one class, the object''s own title where the title is the thing being announced, and a point submission''s own status. For a personal notice it also returns the address this member may be mailed at. Never returns a review note, a proof, a points figure or an identity field, and never returns a subject or an outcome for a profile.';

COMMIT;
