-- New activity announcements use term profiles for both class and chapter audiences.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_activity_email_audience_snapshot(
  p_organization_id uuid, p_actor_user_id uuid, p_term_id uuid,
  p_cohort_id uuid, p_activity_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_topic jsonb;
  v_result jsonb;
  v_summary jsonb;
BEGIN
  IF plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_opportunities') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activity emails.' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_terms WHERE organization_id=p_organization_id AND id=p_term_id)
    OR (p_cohort_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_cohorts WHERE organization_id=p_organization_id AND id=p_cohort_id))
    OR NOT EXISTS(SELECT 1 FROM public.organization_plugin_access WHERE organization_id=p_organization_id AND plugin_key='dvhs-csf' AND enabled AND is_accessible)
  THEN RAISE EXCEPTION 'The activity email audience is outside this chapter.' USING ERRCODE='42501'; END IF;
  IF p_activity_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM plugin_data.csf_opportunities WHERE organization_id=p_organization_id
      AND id=p_activity_id AND status='published' AND term_id=p_term_id
      AND cohort_id IS NOT DISTINCT FROM p_cohort_id
  ) THEN RAISE EXCEPTION 'The activity email audience changed. Reload the source.' USING ERRCODE='55000'; END IF;

  SELECT configuration#>'{communications,broadcastTopics,term_members}' INTO v_topic
    FROM public.organization_plugin_installs WHERE organization_id=p_organization_id AND plugin_key='dvhs-csf' AND enabled;

  WITH contacts AS (
    SELECT p.id, a.user_id, pref.email AS preferred,
      coalesce(pref.email,plugin_data.csf_verified_account_email(a.user_id)) AS email,
      concat_ws(' ',coalesce(nullif(p.preferred_name,''),p.first_name),p.last_name) AS name,
      (a.user_id IS NULL OR EXISTS(SELECT 1 FROM public.organization_members member
        WHERE member.organization_id=p_organization_id AND member.user_id=a.user_id AND member.status='active')) AS account_active
    FROM plugin_data.csf_term_memberships m
    JOIN plugin_data.csf_profiles p ON p.organization_id=m.organization_id AND p.id=m.profile_id AND p.record_status='active'
    LEFT JOIN LATERAL (
      SELECT account.user_id FROM plugin_data.csf_profile_accounts account
      WHERE account.organization_id=p_organization_id AND account.profile_id=p.id
        AND plugin_data.csf_publication_account_is_owned(p_organization_id,p.id,account.user_id)
      ORDER BY account.is_primary DESC,account.linked_at DESC,account.id LIMIT 1
    ) a ON true
    CROSS JOIN LATERAL (SELECT CASE
      WHEN plugin_data.csf_communication_email_is_storable(lower(btrim(p.personal_email))) THEN lower(btrim(p.personal_email))
      WHEN plugin_data.csf_communication_email_is_storable(lower(btrim(p.school_email))) THEN lower(btrim(p.school_email))
      ELSE NULL END AS email) pref
    WHERE m.organization_id=p_organization_id AND m.term_id=p_term_id AND m.status IN('accepted','active','completed')
      AND (p_cohort_id IS NULL OR EXISTS(SELECT 1 FROM plugin_data.csf_profile_cohort_memberships cm
        WHERE cm.organization_id=p_organization_id AND cm.profile_id=p.id AND cm.cohort_id=p_cohort_id AND cm.status='active'))
  ), assessed AS (
    SELECT contacts.*,
      CASE
        WHEN NOT account_active OR plugin_data.csf_communication_email_is_storable(email) IS DISTINCT FROM true THEN 'unavailable'
        WHEN EXISTS(SELECT 1 FROM public.notification_settings n WHERE n.user_id=contacts.user_id AND (n.email_notifications=false OR n.organization_updates=false))
          OR EXISTS(SELECT 1 FROM plugin_data.csf_communication_broadcast_preferences pref WHERE pref.organization_id=p_organization_id
            AND pref.topic_key=v_topic->>'topicKey' AND pref.normalized_recipient_email=contacts.email AND pref.subscription_state='unsubscribed')
          THEN 'unsubscribed'
        ELSE 'eligible' END AS eligibility
    FROM contacts
  ), recipients AS (
    SELECT DISTINCT ON(email) jsonb_strip_nulls(jsonb_build_object(
      'email',email,'name',name,'provenance',CASE WHEN preferred IS NULL THEN 'account_email' ELSE 'preferred_contact' END,
      'profileId',id,'userId',user_id,'preferredContactEmail',preferred)) AS recipient
    FROM assessed WHERE eligibility='eligible' ORDER BY email,id,user_id
  )
  SELECT
    (SELECT coalesce(jsonb_agg(recipient ORDER BY recipient->>'profileId',recipient->>'userId'),'[]') FROM recipients),
    jsonb_build_object('members',count(*),'unavailable',count(*) FILTER(WHERE eligibility='unavailable'),
      'unsubscribed',count(*) FILTER(WHERE eligibility='unsubscribed'),
      'duplicates',(count(*) FILTER(WHERE eligibility='eligible'))-(SELECT count(*) FROM recipients))
  INTO v_result,v_summary FROM assessed;

  RETURN jsonb_build_object('audienceVersion',2,'recipients',v_result,'summary',v_summary,'topic',v_topic,'topicReady',coalesce(
    v_topic->>'topicKey' ~ '^[a-z0-9](?:[a-z0-9_.-]{0,62}[a-z0-9])?$' AND v_topic->>'topicKey'<>'transactional'
    AND v_topic->>'resendTopicId' ~ '^\S{1,128}$',false));
END; $$;
REVOKE ALL ON FUNCTION plugin_data.csf_activity_email_audience_snapshot(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_activity_email_audience_snapshot(uuid,uuid,uuid,uuid,uuid) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_preview_activity_email(p_organization_id uuid,p_actor_user_id uuid,p_term_id uuid,p_cohort_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb;
BEGIN
  s:=plugin_data.csf_activity_email_audience_snapshot(p_organization_id,p_actor_user_id,p_term_id,p_cohort_id,NULL);
  RETURN jsonb_build_object('recipients',jsonb_array_length(s->'recipients'),'topicReady',s->'topicReady','summary',s->'summary');
END; $$;
REVOKE ALL ON FUNCTION plugin_data.csf_preview_activity_email(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_preview_activity_email(uuid,uuid,uuid,uuid) TO postgres,service_role;

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
  -- Previously frozen class announcements retain their account-address rules.
  -- Version 2 activity audiences use the term/profile checks below.
  IF c.audience_kind='cohort_members' AND NOT (v_source_kind='activity' AND EXISTS(
    SELECT 1 FROM plugin_data.csf_publication_events publication
    WHERE publication.organization_id=p_organization_id AND publication.source_kind='activity'
      AND publication.source_id=v_source_id AND publication.event_key=''
      AND publication.activity_email_snapshot->>'audienceVersion'='2'
  )) THEN
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

COMMIT;
