-- Recheck queued transitions and keep historical Sheet notes officer-only.
BEGIN;


CREATE FUNCTION plugin_data.csf_transition_notice_fingerprint(
  p_organization_id uuid, p_profile_id uuid, p_user_id uuid,
  p_kind text, p_subject_id uuid
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organization_plugin_access
    WHERE organization_id=p_organization_id AND plugin_key='dvhs-csf' AND enabled AND is_accessible)
    OR plugin_data.csf_publication_profile_owner(p_organization_id,p_profile_id) IS DISTINCT FROM p_user_id
    OR p_user_id IS NULL THEN RETURN NULL; END IF;
  IF p_kind='account_connected' THEN
    SELECT jsonb_build_array('account',id,profile_id,user_id,status,connection_basis,linked_at,revoked_at)
      INTO v_state FROM plugin_data.csf_profile_accounts
      WHERE organization_id=p_organization_id AND id=p_subject_id
        AND profile_id=p_profile_id AND user_id=p_user_id AND status='verified';
  ELSIF p_kind='application_decision' THEN
    SELECT jsonb_build_array('application',id,profile_id,term_id,decision_status,reviewed_by,reviewed_at)
      INTO v_state FROM plugin_data.csf_term_applications
      WHERE organization_id=p_organization_id AND id=p_subject_id AND profile_id=p_profile_id
        AND decision_status IN ('approved','rejected') AND reviewed_by IS NOT NULL;
  ELSIF p_kind='access_granted' THEN
    SELECT jsonb_build_array('class',id,profile_id,cohort_id,status,updated_at)
      INTO v_state FROM plugin_data.csf_profile_cohort_memberships
      WHERE organization_id=p_organization_id AND id=p_subject_id AND profile_id=p_profile_id AND status='active';
    IF v_state IS NULL THEN
      SELECT jsonb_build_array('organization',id,user_id,status,to_jsonb(member)->>'updated_at')
        INTO v_state FROM public.organization_members member
        WHERE organization_id=p_organization_id AND id=p_subject_id AND user_id=p_user_id AND status='active';
    END IF;
  END IF;
  IF v_state IS NULL THEN RETURN NULL; END IF;
  RETURN encode(extensions.digest(convert_to(v_state::text,'UTF8'),'sha256'),'hex');
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_transition_notice_fingerprint(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_transition_notice_fingerprint(uuid,uuid,uuid,text,uuid) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_transition_notice_recipient_allowed(
  p_organization_id uuid, p_source_kind text, p_profile_id uuid, p_user_id uuid, p_event_key text
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_fingerprint text;
BEGIN
  IF p_source_kind IS DISTINCT FROM 'profile'
    OR split_part(p_event_key,':',2) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR split_part(p_event_key,':',4) !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  v_fingerprint := plugin_data.csf_transition_notice_fingerprint(
    p_organization_id,p_profile_id,p_user_id,split_part(p_event_key,':',1),split_part(p_event_key,':',2)::uuid);
  RETURN coalesce(v_fingerprint=split_part(p_event_key,':',4),false);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_transition_notice_recipient_allowed(uuid,text,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_transition_notice_recipient_allowed(uuid,text,uuid,uuid,text) TO postgres;


CREATE OR REPLACE FUNCTION plugin_data.csf_record_personal_notification(
  p_organization_id uuid, p_source_kind text, p_source_id uuid, p_profile_id uuid,
  p_discriminator text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event_id uuid;
  v_user_id uuid;
  v_event_key text;
  v_fingerprint text;
BEGIN
  IF plugin_data.csf_publication_notices_suppressed() THEN RETURN; END IF;
  v_user_id := plugin_data.csf_publication_profile_owner(p_organization_id, p_profile_id);
  -- No connected account is not an error. The change is already durable, and
  -- the member will read it when they connect.
  IF v_user_id IS NULL THEN RETURN; END IF;
  v_event_key := p_discriminator;
  IF split_part(p_discriminator,':',1) IN ('account_connected','application_decision','access_granted') THEN
    IF p_source_kind IS DISTINCT FROM 'profile' OR p_source_id IS DISTINCT FROM p_profile_id
      OR split_part(p_discriminator,':',2) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR split_part(p_discriminator,':',3)='' OR split_part(p_discriminator,':',4)<>'' THEN RETURN; END IF;
    v_fingerprint := plugin_data.csf_transition_notice_fingerprint(
      p_organization_id,p_profile_id,v_user_id,split_part(p_discriminator,':',1),split_part(p_discriminator,':',2)::uuid);
    IF v_fingerprint IS NULL THEN RETURN; END IF;
    v_event_key := p_discriminator || ':' || v_fingerprint;
  ELSIF plugin_data.csf_publication_recipient_allowed(
    p_organization_id,p_source_kind,p_source_id,v_user_id) IS DISTINCT FROM true THEN RETURN; END IF;

  INSERT INTO plugin_data.csf_publication_events(organization_id,source_kind,source_id,event_key)
  VALUES (p_organization_id, p_source_kind, p_source_id,
          plugin_data.csf_publication_personal_event_key(v_event_key))
  ON CONFLICT (organization_id,source_kind,source_id,event_key) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN RETURN; END IF;

  INSERT INTO plugin_data.csf_publication_notification_deliveries(organization_id,event_id,user_id)
  VALUES (p_organization_id, v_event_id, v_user_id)
  ON CONFLICT (event_id,user_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text) TO postgres;

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
  v_allowed := (CASE WHEN split_part(v_event.event_key,':',1) IN ('account_connected','application_decision','access_granted')
    THEN plugin_data.csf_transition_notice_recipient_allowed(p_organization_id,v_event.source_kind,v_event.source_id,v_delivery.user_id,v_event.event_key)
    ELSE plugin_data.csf_publication_recipient_allowed(p_organization_id,v_event.source_kind,v_event.source_id,v_delivery.user_id) END)
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

REVOKE ALL ON FUNCTION plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
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
    IF (CASE WHEN split_part(e.event_key,':',1) IN ('account_connected','application_decision','access_granted')
      THEN plugin_data.csf_transition_notice_recipient_allowed(p_organization_id,e.source_kind,e.source_id,s.user_id,e.event_key)
      ELSE plugin_data.csf_publication_recipient_allowed(p_organization_id,e.source_kind,e.source_id,s.user_id) END) IS DISTINCT FROM true THEN RETURN false; END IF;
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

REVOKE ALL ON FUNCTION plugin_data.csf_publication_email_recipient_allowed(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_publication_email_recipient_allowed(uuid,uuid) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_release_sheet_application_decisions(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_term_id uuid,
  p_request_id uuid,
  p_application_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_existing plugin_data.csf_application_decision_releases%ROWTYPE;
  v_release_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_plan record;
  v_held jsonb;
  v_pending integer;
  v_accepted integer;
  v_rejected integer;
  v_held_count integer;
  v_fingerprint text;
BEGIN
  PERFORM plugin_data.csf_assert_sheet_decision_authority(
    p_organization_id, p_actor_user_id, 'decide_applications',
    'Not authorized to release CSF application decisions.'
  );

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A stable release request identifier is required.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_decision_release_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'termId', p_term_id,
          'applicationIds', pg_catalog.to_jsonb(p_application_ids)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT release.* INTO v_existing
  FROM plugin_data.csf_application_decision_releases AS release
  WHERE release.organization_id = p_organization_id
    AND release.request_id = p_request_id;
  IF FOUND THEN
    -- Same request asked again is a replay. Same id aimed at another term or
    -- another subset is a different intent and must not read this receipt.
    IF v_existing.term_id IS DISTINCT FROM p_term_id
      OR v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION USING
        MESSAGE = 'That release request identifier is already bound to a different release.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=request_conflict',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;

    SELECT term.* INTO v_term
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id AND term.id = v_existing.term_id;
    RETURN pg_catalog.jsonb_build_object(
      'releaseId', v_existing.id,
      'termId', v_existing.term_id,
      'released', v_existing.released_count,
      'accepted', v_existing.accepted_count,
      'rejected', v_existing.rejected_count,
      'pending', v_existing.pending_count,
      'held', v_existing.held,
      'heldCount', v_existing.held_count,
      'firstReleasedAt', v_term.decisions_first_released_at,
      'lastReleasedAt', v_term.decisions_last_released_at,
      'releaseCount', v_term.decisions_release_count,
      'replay', true
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_sheet_decision_term_lock_key(p_organization_id, p_term_id)
  );

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'no_data_found', MESSAGE = 'CSF term not found.';
  END IF;
  IF v_term.application_review_source <> 'sheet' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'This term does not review applications in a Sheet.',
      DETAIL = 'CSF_SHEET_REVIEW_MODE=not_enabled';
  END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'A closed term keeps its published outcomes.',
      DETAIL = 'CSF_RELEASE_BLOCKER=term_closed';
  END IF;

  -- Plan first, with every row locked, so the receipt can be written with its
  -- final counts before any publication happens.
  CREATE TEMP TABLE IF NOT EXISTS csf_decision_release_plan (
    application_id uuid,
    staged_decision text,
    staged_reason text,
    block_reason text,
    disposition text
  ) ON COMMIT DROP;
  TRUNCATE TABLE pg_temp.csf_decision_release_plan;

  INSERT INTO pg_temp.csf_decision_release_plan
  SELECT
    stage.application_id,
    stage.staged_decision,
    NULL::text, -- Source comments remain officer-only.
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_application_decision_mappings mapping
        JOIN plugin_data.csf_application_decision_sync_sources source
          ON source.source_id = mapping.source_id AND source.run_id = stage.last_sync_run_id
        WHERE mapping.organization_id = stage.organization_id AND mapping.source_id = stage.source_id
          AND source.mapping_version = mapping.mapping_version::text
      ) THEN 'mapping_version_stale'
      WHEN stage.block_reason IS NOT NULL THEN stage.block_reason
      WHEN stage.staged_decision = 'conflict' THEN 'unmapped_color'
      WHEN stage.staged_decision = 'rejected_with_explanation'
        AND nullif(pg_catalog.btrim(coalesce(stage.staged_reason, '')), '') IS NULL
        THEN 'missing_yellow_reason'
      WHEN stage.staged_decision = 'rejected_with_explanation' THEN 'awaiting_review'
      WHEN stage.staged_decision
             IN ('accepted', 'rejected', 'rejected_with_explanation')
        AND membership.status IN ('completed', 'not_completed')
        THEN 'historical_outcome'
      ELSE NULL
    END,
    CASE
      WHEN stage.staged_decision IN ('unreviewed', 'on_hold') THEN 'pending'
      WHEN NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_application_decision_mappings mapping
        JOIN plugin_data.csf_application_decision_sync_sources source
          ON source.source_id = mapping.source_id AND source.run_id = stage.last_sync_run_id
        WHERE mapping.organization_id = stage.organization_id AND mapping.source_id = stage.source_id
          AND source.mapping_version = mapping.mapping_version::text
      ) THEN 'held'
      WHEN stage.staged_decision = 'rejected_with_explanation' THEN 'held'
      WHEN stage.blocks_release THEN 'held'
      WHEN stage.staged_decision
             IN ('accepted', 'rejected', 'rejected_with_explanation')
        AND membership.status IN ('completed', 'not_completed')
        THEN 'held'
      ELSE 'release'
    END
  FROM plugin_data.csf_application_decision_stages AS stage
  LEFT JOIN plugin_data.csf_term_memberships AS membership
    ON membership.organization_id = stage.organization_id
   AND membership.profile_id = stage.profile_id
   AND membership.term_id = stage.term_id
  WHERE stage.organization_id = p_organization_id
    AND stage.term_id = p_term_id
    AND stage.release_state = 'staged'
    AND (p_application_ids IS NULL OR stage.application_id = ANY(p_application_ids));

  SELECT
    pg_catalog.count(*) FILTER (WHERE disposition = 'pending'),
    pg_catalog.count(*) FILTER (WHERE disposition = 'held'),
    pg_catalog.count(*) FILTER (WHERE disposition = 'release' AND staged_decision = 'accepted'),
    pg_catalog.count(*) FILTER (
      WHERE disposition = 'release'
        AND staged_decision IN ('rejected', 'rejected_with_explanation')
    ),
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'applicationId', application_id,
          'blockReason', coalesce(block_reason, 'unmapped_color')
        )
        ORDER BY application_id
      ) FILTER (WHERE disposition = 'held'),
      '[]'::jsonb
    )
  INTO v_pending, v_held_count, v_accepted, v_rejected, v_held
  FROM pg_temp.csf_decision_release_plan;

  INSERT INTO plugin_data.csf_application_decision_releases (
    organization_id, term_id, actor_user_id, request_id, request_fingerprint,
    released_count, accepted_count, rejected_count, held_count, pending_count, held, reviewed_snapshot_hash
  )
  VALUES (
    p_organization_id, p_term_id, p_actor_user_id, p_request_id, v_fingerprint,
    v_accepted + v_rejected, v_accepted, v_rejected, v_held_count, v_pending, v_held,
    (SELECT pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(
    pg_catalog.string_agg(application_id::text || '|' || staged_decision || '|' ||
      coalesce(block_reason, '') || '|' || release_state || '|' || coalesce(last_sync_run_id::text, ''),
      E'\n' ORDER BY application_id), ''), 'UTF8'), 'sha256'), 'hex')
    FROM plugin_data.csf_application_decision_stages
    WHERE organization_id = p_organization_id AND term_id = p_term_id)
  )
  RETURNING id INTO v_release_id;

  FOR v_plan IN
    SELECT * FROM pg_temp.csf_decision_release_plan
    WHERE disposition = 'release'
    ORDER BY application_id
  LOOP
    PERFORM plugin_data.csf_publish_sheet_application_decision(
      p_organization_id,
      v_plan.application_id,
      CASE WHEN v_plan.staged_decision = 'accepted' THEN 'accepted' ELSE 'rejected' END,
      v_plan.staged_reason,
      p_actor_user_id,
      pg_catalog.jsonb_build_object(
        'releaseId', v_release_id,
        'termId', p_term_id,
        'stagedDecision', v_plan.staged_decision,
        'trigger', 'term_release'
      )
    );

    UPDATE plugin_data.csf_application_decision_stages
    SET
      release_state = 'released',
      released_decision =
        CASE WHEN v_plan.staged_decision = 'accepted' THEN 'accepted' ELSE 'rejected' END,
      released_reason = v_plan.staged_reason,
      released_at = v_now,
      released_by = p_actor_user_id,
      release_id = v_release_id,
      last_applied_at = v_now,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND application_id = v_plan.application_id;
  END LOOP;

  UPDATE plugin_data.csf_terms
  SET
    decisions_first_released_at = coalesce(decisions_first_released_at, v_now),
    decisions_last_released_at = v_now,
    decisions_release_count = decisions_release_count + 1,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_term_id
  RETURNING * INTO v_term;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    after_data, correlation_id, source_type, source_id
  )
  VALUES (
    p_organization_id, p_actor_user_id, 'application_decisions.released',
    'csf_application_decision_releases', v_release_id, p_term_id,
    pg_catalog.jsonb_build_object(
      'decisionBasis', 'officer_external_sheet_review',
      'released', v_accepted + v_rejected,
      'accepted', v_accepted,
      'rejected', v_rejected,
      'pending', v_pending,
      'held', v_held
    ),
    p_request_id, 'sheet_application_review', v_release_id::text
  );

  RETURN pg_catalog.jsonb_build_object(
    'releaseId', v_release_id,
    'termId', p_term_id,
    'released', v_accepted + v_rejected,
    'accepted', v_accepted,
    'rejected', v_rejected,
    'pending', v_pending,
    'held', v_held,
    'heldCount', v_held_count,
    'firstReleasedAt', v_term.decisions_first_released_at,
    'lastReleasedAt', v_term.decisions_last_released_at,
    'releaseCount', v_term.decisions_release_count,
    'replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_release_sheet_application_decisions(uuid,uuid,uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_release_sheet_application_decisions(uuid,uuid,uuid,uuid,uuid[]) TO service_role;

-- Keep immutable source and audit evidence. Remove only the member-facing copy
-- that still equals the last reason published from a Sheet.
CREATE OR REPLACE FUNCTION plugin_data.csf_redact_legacy_sheet_reasons()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
WITH legacy AS (
  SELECT s.organization_id,s.application_id,s.profile_id,s.term_id,s.released_reason
  FROM plugin_data.csf_application_decision_stages s
  JOIN plugin_data.csf_term_applications a ON a.organization_id=s.organization_id AND a.id=s.application_id
  WHERE s.released_reason IS NOT NULL
    AND a.decision_reason_code IN ('approved_sheet_review','rejected_sheet_review')
    AND a.decision_reason=s.released_reason
), applications AS (
  UPDATE plugin_data.csf_term_applications a SET decision_reason=NULL
  FROM legacy l WHERE a.organization_id=l.organization_id AND a.id=l.application_id RETURNING a.id
)
UPDATE plugin_data.csf_term_memberships m SET status_reason=NULL
FROM legacy l WHERE m.organization_id=l.organization_id AND m.profile_id=l.profile_id AND m.term_id=l.term_id
  AND m.status_reason=l.released_reason;
UPDATE plugin_data.csf_application_decision_stages SET released_reason=NULL WHERE released_reason IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_redact_legacy_sheet_reasons() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_redact_legacy_sheet_reasons() TO postgres;
SELECT plugin_data.csf_redact_legacy_sheet_reasons();
COMMIT;
