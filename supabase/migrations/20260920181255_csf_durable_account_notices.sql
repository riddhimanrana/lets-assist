-- Durable account and decision notices use the existing publication ledger.
BEGIN;

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
          -- Preserve existing finalized campaigns.
          (sender_email = 'projects@notifications.lets-assist.com'
            AND sender_name = 'DVHS CSF (Let''s Assist)')
          OR (sender_email = 'dvhs-csf@notifications.lets-assist.com'
            AND sender_name = 'DVHS CSF')
          OR (sender_email = 'updates@notifications.lets-assist.com'
            AND nullif(btrim(sender_name), '') IS NOT NULL
            AND length(sender_name) <= 128
            AND sender_name !~ '[[:cntrl:]<>]')
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

CREATE OR REPLACE FUNCTION plugin_data.csf_campaign_platform_sender_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.sender_email = 'csf@notifications.lets-assist.com'
    AND NEW.sender_name = 'DVHS CSF'
  THEN
    NEW.sender_email := 'updates@notifications.lets-assist.com';
    SELECT left(regexp_replace(name, '[[:cntrl:]<>]', '', 'g'), 128)
      INTO NEW.sender_name FROM public.organizations WHERE id = NEW.organization_id;
    NEW.sender_name := coalesce(nullif(btrim(NEW.sender_name), ''), 'CSF');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_campaign_platform_sender_identity()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_campaign_platform_sender_identity() TO postgres;


CREATE OR REPLACE FUNCTION plugin_data.csf_transition_notice_recipient_allowed(
  p_organization_id uuid, p_source_kind text, p_profile_id uuid, p_user_id uuid, p_event_key text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_source_kind = 'profile'
    AND split_part(p_event_key, ':', 1) IN ('account_connected', 'application_decision', 'access_granted')
    AND EXISTS (SELECT 1 FROM public.organization_plugin_access
      WHERE organization_id = p_organization_id AND plugin_key = 'dvhs-csf' AND enabled AND is_accessible)
    AND coalesce(plugin_data.csf_publication_profile_owner(p_organization_id, p_profile_id) = p_user_id, false);
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_transition_notice_recipient_allowed(uuid,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_transition_notice_recipient_allowed(uuid,text,uuid,uuid,text) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_record_personal_notification(
  p_organization_id uuid, p_source_kind text, p_source_id uuid, p_profile_id uuid,
  p_discriminator text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event_id uuid;
  v_user_id uuid;
BEGIN
  IF plugin_data.csf_publication_notices_suppressed() THEN RETURN; END IF;
  v_user_id := plugin_data.csf_publication_profile_owner(p_organization_id, p_profile_id);
  -- No connected account is not an error. The change is already durable, and
  -- the member will read it when they connect.
  IF v_user_id IS NULL THEN RETURN; END IF;
  IF (plugin_data.csf_publication_recipient_allowed(
    p_organization_id, p_source_kind, p_source_id, v_user_id)
    OR plugin_data.csf_transition_notice_recipient_allowed(
      p_organization_id, p_source_kind, p_source_id, v_user_id, p_discriminator)) IS DISTINCT FROM true THEN RETURN; END IF;

  INSERT INTO plugin_data.csf_publication_events(organization_id,source_kind,source_id,event_key)
  VALUES (p_organization_id, p_source_kind, p_source_id,
          plugin_data.csf_publication_personal_event_key(p_discriminator))
  ON CONFLICT (organization_id,source_kind,source_id,event_key) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN RETURN; END IF;

  INSERT INTO plugin_data.csf_publication_notification_deliveries(organization_id,event_id,user_id)
  VALUES (p_organization_id, v_event_id, v_user_id)
  ON CONFLICT (event_id,user_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text) TO postgres;

-- Queue future transitions only. Deferred triggers see the completed access transaction.
CREATE OR REPLACE FUNCTION plugin_data.csf_queue_account_connection_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status <> 'verified' OR (TG_OP = 'UPDATE' AND OLD.status = 'verified'
    AND (OLD.user_id, OLD.profile_id, OLD.connection_basis) IS NOT DISTINCT FROM (NEW.user_id, NEW.profile_id, NEW.connection_basis)) THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE id = NEW.id AND status = 'verified' AND user_id = NEW.user_id AND profile_id = NEW.profile_id) THEN RETURN NEW; END IF;
  PERFORM plugin_data.csf_record_personal_notification(
    NEW.organization_id, 'profile', NEW.profile_id, NEW.profile_id,
    'account_connected:' || NEW.id::text || ':' || pg_catalog.txid_current()::text);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_account_connection_notice() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_account_connection_notice() TO postgres;
DROP TRIGGER IF EXISTS csf_account_connection_notice ON plugin_data.csf_profile_accounts;
CREATE CONSTRAINT TRIGGER csf_account_connection_notice
AFTER INSERT OR UPDATE ON plugin_data.csf_profile_accounts DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_account_connection_notice();

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_application_decision_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.decision_status NOT IN ('approved', 'rejected')
    OR (TG_OP = 'UPDATE' AND NEW.decision_status IS NOT DISTINCT FROM OLD.decision_status)
    OR NEW.reviewed_by IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_term_applications WHERE id = NEW.id AND decision_status = NEW.decision_status AND reviewed_by IS NOT NULL) THEN RETURN NEW; END IF;
  PERFORM plugin_data.csf_record_personal_notification(
    NEW.organization_id, 'profile', NEW.profile_id, NEW.profile_id,
    'application_decision:' || NEW.id::text || ':' || pg_catalog.txid_current()::text);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_application_decision_notice() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_application_decision_notice() TO postgres;
DROP TRIGGER IF EXISTS csf_application_decision_notice ON plugin_data.csf_term_applications;
CREATE CONSTRAINT TRIGGER csf_application_decision_notice
AFTER INSERT OR UPDATE ON plugin_data.csf_term_applications DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_application_decision_notice();

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_class_access_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status <> 'active' OR (TG_OP = 'UPDATE' AND OLD.status = 'active') THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_profile_cohort_memberships WHERE id = NEW.id AND status = 'active') THEN RETURN NEW; END IF;
  PERFORM plugin_data.csf_record_personal_notification(
    NEW.organization_id, 'profile', NEW.profile_id, NEW.profile_id,
    'access_granted:' || NEW.id::text || ':' || pg_catalog.txid_current()::text);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_class_access_notice() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_class_access_notice() TO postgres;
DROP TRIGGER IF EXISTS csf_class_access_notice ON plugin_data.csf_profile_cohort_memberships;
CREATE CONSTRAINT TRIGGER csf_class_access_notice
AFTER INSERT OR UPDATE ON plugin_data.csf_profile_cohort_memberships DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_class_access_notice();

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_organization_access_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_profile record;
BEGIN
  IF NEW.status <> 'active' OR (TG_OP = 'UPDATE' AND OLD.status = 'active') THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE id = NEW.id AND status = 'active') THEN RETURN NEW; END IF;
  FOR v_profile IN SELECT profile_id FROM plugin_data.csf_profile_accounts
    WHERE organization_id = NEW.organization_id AND user_id = NEW.user_id AND status = 'verified'
  LOOP
    PERFORM plugin_data.csf_record_personal_notification(
      NEW.organization_id, 'profile', v_profile.profile_id, v_profile.profile_id,
      'access_granted:' || NEW.id::text || ':' || pg_catalog.txid_current()::text);
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_organization_access_notice() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_organization_access_notice() TO postgres;
DROP TRIGGER IF EXISTS csf_organization_access_notice ON public.organization_members;
CREATE CONSTRAINT TRIGGER csf_organization_access_notice
AFTER INSERT OR UPDATE ON public.organization_members DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_organization_access_notice();

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
  v_allowed := (plugin_data.csf_publication_recipient_allowed(p_organization_id,v_event.source_kind,v_event.source_id,v_delivery.user_id)
    OR plugin_data.csf_transition_notice_recipient_allowed(p_organization_id,v_event.source_kind,v_event.source_id,v_delivery.user_id,v_event.event_key))
    AND NOT EXISTS (SELECT 1 FROM public.notification_settings
      WHERE user_id=v_delivery.user_id AND organization_updates=false);
  IF v_allowed IS DISTINCT FROM true THEN
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
    'noticeKind', CASE WHEN v_event.source_kind = 'profile' THEN
      CASE split_part(v_event.event_key, ':', 1)
        WHEN 'account_connected' THEN 'account_connected'
        WHEN 'application_decision' THEN 'application_decision'
        WHEN 'access_granted' THEN 'access_granted'
        ELSE NULL END
      ELSE NULL END,
    'recipientEmail',v_email);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid) TO postgres,service_role;


CREATE OR REPLACE FUNCTION plugin_data.csf_publication_email_recipient_allowed(
  p_organization_id uuid, p_snapshot_id uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s plugin_data.csf_communication_recipient_snapshots%ROWTYPE;
  c plugin_data.csf_communication_campaigns%ROWTYPE;
  p plugin_data.csf_profiles%ROWTYPE;
  e plugin_data.csf_publication_events%ROWTYPE;
  v_user_id uuid;
  v_source_kind text;
  v_source_id uuid;
  v_current_email text;
  v_source_term uuid;
  v_source_cohort uuid;
  v_source_audience text;
BEGIN
  SELECT * INTO STRICT s FROM plugin_data.csf_communication_recipient_snapshots
    WHERE organization_id=p_organization_id AND id=p_snapshot_id;
  SELECT * INTO STRICT c FROM plugin_data.csf_communication_campaigns
    WHERE organization_id=p_organization_id AND id=s.campaign_id;

  -- A personal notice, re-checked here in full because nothing else does.
  IF c.source_publication_event_id IS NOT NULL THEN
    SELECT * INTO e FROM plugin_data.csf_publication_events
      WHERE organization_id=p_organization_id AND id=c.source_publication_event_id;
    IF NOT FOUND OR s.user_id IS NULL THEN RETURN false; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.organization_plugin_access
      WHERE organization_id=p_organization_id AND plugin_key='dvhs-csf'
        AND enabled AND is_accessible) THEN RETURN false; END IF;
    -- Still this member's record, still their account, still an active member.
    IF (plugin_data.csf_publication_recipient_allowed(
      p_organization_id, e.source_kind, e.source_id, s.user_id)
      OR plugin_data.csf_transition_notice_recipient_allowed(
        p_organization_id, e.source_kind, e.source_id, s.user_id, e.event_key)) IS DISTINCT FROM true THEN RETURN false; END IF;
    -- Both opt-outs, re-read now rather than trusted from queue time.
    IF EXISTS (SELECT 1 FROM public.notification_settings WHERE user_id=s.user_id
      AND (email_notifications=false OR organization_updates=false)) THEN RETURN false; END IF;
    -- And the frozen address must still be the account's confirmed address, so
    -- an address changed, unconfirmed or reassigned since the snapshot was
    -- taken cannot be mailed from it.
    v_current_email := plugin_data.csf_verified_account_email(s.user_id);
    RETURN v_current_email IS NOT NULL
      AND v_current_email = s.normalized_recipient_email;
  END IF;

  IF s.delivery_requirement IS DISTINCT FROM 'broadcast' OR
    (c.source_announcement_id IS NULL AND c.source_activity_id IS NULL) THEN RETURN true; END IF;
  v_source_kind := CASE WHEN c.source_announcement_id IS NOT NULL THEN 'post' ELSE 'activity' END;
  v_source_id := coalesce(c.source_announcement_id,c.source_activity_id);
  IF v_source_kind='post' THEN
    SELECT term_id,audience_cohort_id,audience INTO v_source_term,v_source_cohort,v_source_audience
      FROM plugin_data.csf_announcements WHERE organization_id=p_organization_id AND id=v_source_id
      AND status='published' AND (expires_at IS NULL OR expires_at>now());
    IF NOT FOUND OR v_source_audience='public' OR c.audience_kind IS DISTINCT FROM
      (CASE v_source_audience WHEN 'members' THEN 'term_members' WHEN 'class' THEN 'cohort_members' WHEN 'officers' THEN 'staff' END)
      THEN RETURN false; END IF;
  ELSE
    SELECT term_id,cohort_id INTO v_source_term,v_source_cohort FROM plugin_data.csf_opportunities
      WHERE organization_id=p_organization_id AND id=v_source_id AND status='published';
    IF NOT FOUND OR c.audience_kind IS DISTINCT FROM
      (CASE WHEN v_source_cohort IS NULL THEN 'term_members' ELSE 'cohort_members' END) THEN RETURN false; END IF;
  END IF;
  IF ((v_source_kind='activity' OR v_source_term IS NOT NULL) AND c.term_id IS DISTINCT FROM v_source_term)
    OR c.audience_cohort_id IS DISTINCT FROM v_source_cohort THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_plugin_access WHERE organization_id=p_organization_id
    AND plugin_key='dvhs-csf' AND enabled AND is_accessible) THEN RETURN false; END IF;
  IF c.audience_kind='cohort_members' THEN
    RETURN s.user_id IS NOT NULL AND s.profile_id IS NOT NULL
      AND plugin_data.csf_publication_account_is_owned(p_organization_id,s.profile_id,s.user_id)
      AND plugin_data.csf_publication_recipient_allowed(p_organization_id,v_source_kind,v_source_id,s.user_id)
      AND EXISTS(SELECT 1 FROM plugin_data.csf_profile_cohort_memberships
        WHERE organization_id=p_organization_id AND profile_id=s.profile_id AND cohort_id=c.audience_cohort_id AND status='active')
      AND NOT EXISTS(SELECT 1 FROM public.notification_settings WHERE user_id=s.user_id AND (email_notifications=false OR organization_updates=false))
      AND plugin_data.csf_verified_account_email(s.user_id) IS NOT NULL
      AND plugin_data.csf_verified_account_email(s.user_id)=s.normalized_recipient_email;
  END IF;
  v_user_id := s.user_id;
  IF s.profile_id IS NOT NULL THEN
    SELECT * INTO p FROM plugin_data.csf_profiles WHERE organization_id=p_organization_id
      AND id=s.profile_id AND record_status='active';
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_user_id IS NOT NULL AND NOT
      plugin_data.csf_publication_account_is_owned(p_organization_id,s.profile_id,v_user_id) THEN
      RETURN false;
    END IF;
    IF v_user_id IS NULL THEN
      SELECT user_id INTO v_user_id FROM plugin_data.csf_profile_accounts
        WHERE organization_id=p_organization_id AND profile_id=s.profile_id
          AND plugin_data.csf_publication_account_is_owned(p_organization_id,s.profile_id,user_id)
        ORDER BY is_primary DESC,linked_at DESC,id LIMIT 1;
    END IF;
    v_current_email := CASE
      WHEN plugin_data.csf_communication_email_is_storable(lower(btrim(p.personal_email)))
        THEN lower(btrim(p.personal_email))
      WHEN plugin_data.csf_communication_email_is_storable(lower(btrim(p.school_email)))
        THEN lower(btrim(p.school_email))
      ELSE NULL END;
  END IF;
  IF c.audience_kind IN ('term_members','cohort_members') THEN
    IF s.profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM plugin_data.csf_term_memberships
      WHERE organization_id=p_organization_id AND profile_id=s.profile_id AND term_id=c.term_id
        AND status IN ('accepted','active','completed')) THEN RETURN false; END IF;
    IF c.audience_kind='cohort_members' AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_profile_cohort_memberships
      WHERE organization_id=p_organization_id AND profile_id=s.profile_id AND cohort_id=c.audience_cohort_id AND status='active') THEN RETURN false; END IF;
  ELSIF c.audience_kind='staff' THEN
    IF v_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.organization_members
      WHERE organization_id=p_organization_id AND user_id=v_user_id AND status='active' AND role IN ('admin','staff'))
      OR plugin_data.csf_actor_has_permission(p_organization_id,v_user_id,'manage_posts') IS DISTINCT FROM true THEN RETURN false; END IF;
  ELSE RETURN false;
  END IF;
  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id=p_organization_id
      AND user_id=v_user_id AND status='active') THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM public.notification_settings WHERE user_id=v_user_id
      AND (email_notifications=false OR organization_updates=false)) THEN RETURN false; END IF;
    IF v_current_email IS NULL THEN
      -- Same rule for the broadcast fallback. The audience restriction above is
      -- unchanged; this only stops an unconfirmed or diverged address from
      -- being used when the chapter record carries no storable one.
      v_current_email := plugin_data.csf_verified_account_email(v_user_id);
    END IF;
  END IF;
  RETURN v_current_email IS NOT NULL AND v_current_email=s.normalized_recipient_email;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_publication_email_recipient_allowed(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_publication_email_recipient_allowed(uuid,uuid) TO postgres;


COMMIT;
