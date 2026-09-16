BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_submit_member_report(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_category text,
  p_message text,
  p_term_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_message text := pg_catalog.btrim(coalesce(p_message, ''));
  v_open_count integer;
  v_report_id uuid;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before reporting a problem with your record.';
  END IF;
  IF p_category IS NULL OR p_category NOT IN (
    'name', 'class', 'attendance', 'points', 'application', 'membership', 'other'
  ) THEN
    RAISE EXCEPTION 'Choose what is wrong.';
  END IF;
  IF pg_catalog.char_length(v_message) < 8 OR pg_catalog.char_length(v_message) > 2000 THEN
    RAISE EXCEPTION 'Describe the problem in 8 to 2000 characters.';
  END IF;

  SELECT account.profile_id INTO v_profile_id
  FROM plugin_data.csf_profile_accounts AS account
  JOIN plugin_data.csf_profiles AS profile
    ON profile.id = account.profile_id AND profile.organization_id = account.organization_id
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_actor_user_id
    AND account.status = 'verified'
    AND profile.record_status = 'active'
  ORDER BY account.is_primary DESC, account.linked_at DESC
  LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Connect your CSF record before reporting a problem with it.';
  END IF;

  IF p_term_id IS NOT NULL THEN
    PERFORM 1 FROM plugin_data.csf_terms AS term
    WHERE term.id = p_term_id AND term.organization_id = p_organization_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CSF semester not found for this organization.' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- A member with five open reports is not being heard; more forms will not
  -- help, and a queue of duplicates hides the real problem.
  SELECT pg_catalog.count(*) INTO v_open_count
  FROM plugin_data.csf_member_reports
  WHERE organization_id = p_organization_id AND profile_id = v_profile_id AND status = 'open';
  IF v_open_count >= 5 THEN
    RAISE EXCEPTION 'You already have five open reports. An officer will get to them.';
  END IF;

  INSERT INTO plugin_data.csf_member_reports (
    organization_id, profile_id, reported_by, term_id, category, message
  ) VALUES (
    p_organization_id, v_profile_id, p_actor_user_id, p_term_id, p_category, v_message
  )
  RETURNING id INTO v_report_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type, target_id,
    after_data, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_profile_id, 'profile.member_report_submitted',
    'csf_member_reports', v_report_id,
    pg_catalog.jsonb_build_object('category', p_category, 'termId', p_term_id),
    'member_report'
  );

  RETURN pg_catalog.jsonb_build_object('reportId', v_report_id, 'profileId', v_profile_id);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_submit_member_report(uuid,uuid,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_submit_member_report(uuid,uuid,text,text,uuid)
  TO service_role, postgres;

COMMIT;
