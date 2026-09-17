-- Class publication email follows the same linked class audience as the bell.
-- Acceptance decisions and member-only communications keep their own audiences.
BEGIN;
CREATE FUNCTION plugin_data.csf_class_publication_email_candidates(
  p_organization_id uuid, p_term_id uuid, p_cohort_id uuid,
  p_source_kind text, p_source_id uuid, p_actor_user_id uuid,
  p_offset integer DEFAULT 0, p_limit integer DEFAULT 500
) RETURNS TABLE(profile_id uuid,user_id uuid,email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_term uuid; v_cohort uuid;
BEGIN
  IF p_limit<1 OR p_limit>500 OR p_offset<0 OR p_limit IS NULL OR p_offset IS NULL THEN
    RAISE EXCEPTION 'Choose a bounded publication audience page.';
  END IF;
  IF p_source_kind NOT IN ('post','activity') OR p_source_kind IS NULL THEN RAISE EXCEPTION 'Choose a publication source.'; END IF;
  IF plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,
    CASE WHEN p_source_kind='post' THEN 'manage_posts' ELSE 'manage_opportunities' END) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to email this publication.' USING ERRCODE='42501';
  END IF;
  IF p_source_kind='post' THEN
    SELECT term_id,audience_cohort_id INTO v_term,v_cohort FROM plugin_data.csf_announcements
      WHERE organization_id=p_organization_id AND id=p_source_id AND audience='class'
        AND status='published' AND (expires_at IS NULL OR expires_at>now());
  ELSE
    SELECT term_id,cohort_id INTO v_term,v_cohort FROM plugin_data.csf_opportunities
      WHERE organization_id=p_organization_id AND id=p_source_id AND status='published';
  END IF;
  IF v_cohort IS NULL OR v_cohort IS DISTINCT FROM p_cohort_id
    OR (v_term IS NOT NULL AND v_term IS DISTINCT FROM p_term_id)
    OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_terms WHERE organization_id=p_organization_id AND id=p_term_id AND (v_term IS NOT NULL OR is_current)) THEN
    RAISE EXCEPTION 'The class publication audience changed. Reload the source.';
  END IF;
  RETURN QUERY
  SELECT a.profile_id,a.user_id,plugin_data.csf_verified_account_email(a.user_id)
  FROM plugin_data.csf_profile_accounts a
  JOIN plugin_data.csf_profiles p ON p.organization_id=a.organization_id AND p.id=a.profile_id AND p.record_status='active'
  JOIN plugin_data.csf_profile_cohort_memberships m ON m.organization_id=a.organization_id AND m.profile_id=a.profile_id AND m.cohort_id=p_cohort_id AND m.status='active'
  WHERE a.organization_id=p_organization_id
    AND plugin_data.csf_publication_account_is_owned(p_organization_id,a.profile_id,a.user_id)
    AND plugin_data.csf_publication_recipient_allowed(p_organization_id,p_source_kind,p_source_id,a.user_id)
    AND plugin_data.csf_verified_account_email(a.user_id) IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.notification_settings n WHERE n.user_id=a.user_id AND (n.email_notifications=false OR n.organization_updates=false))
  ORDER BY a.profile_id,a.user_id LIMIT p_limit OFFSET p_offset;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_class_publication_email_candidates(uuid,uuid,uuid,text,uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_class_publication_email_candidates(uuid,uuid,uuid,text,uuid,uuid,integer,integer) TO postgres,service_role;

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
    IF NOT plugin_data.csf_publication_recipient_allowed(
      p_organization_id, e.source_kind, e.source_id, s.user_id) THEN RETURN false; END IF;
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
