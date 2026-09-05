CREATE INDEX csf_profiles_compact_full_name_prefix_idx
ON plugin_data.csf_profiles (organization_id,
  (regexp_replace(normalized_first_name || normalized_last_name, '[^a-z0-9@._+-]+', '', 'g')) text_pattern_ops)
WHERE record_status = 'active';

CREATE INDEX csf_profiles_compact_reverse_name_prefix_idx
ON plugin_data.csf_profiles (organization_id,
  (regexp_replace(normalized_last_name || normalized_first_name, '[^a-z0-9@._+-]+', '', 'g')) text_pattern_ops)
WHERE record_status = 'active';

CREATE OR REPLACE FUNCTION plugin_data.csf_search_profiles(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_query text,
  p_selected_profile_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, first_name text, preferred_name text, last_name text,
  school_email text, personal_email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_query text := regexp_replace(lower(btrim(coalesce(p_query, ''))), '[^a-z0-9@._+-]+', '', 'g');
BEGIN
  PERFORM plugin_data.csf_assert_dashboard_officer(p_organization_id, p_actor_user_id);
  IF p_selected_profile_id IS NULL AND length(v_query) < 2 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT profile.id, profile.first_name, profile.preferred_name, profile.last_name,
    profile.school_email, profile.personal_email
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.record_status = 'active'
    AND (
      (length(v_query) < 2 AND profile.id = p_selected_profile_id)
      OR (length(v_query) >= 2 AND (
        profile.id = p_selected_profile_id
        OR profile.normalized_first_name LIKE v_query || '%'
        OR profile.normalized_last_name LIKE v_query || '%'
        OR profile.normalized_school_email LIKE v_query || '%'
        OR profile.normalized_personal_email LIKE v_query || '%'
        OR regexp_replace(profile.normalized_first_name || profile.normalized_last_name,
          '[^a-z0-9@._+-]+', '', 'g') LIKE v_query || '%'
        OR regexp_replace(profile.normalized_last_name || profile.normalized_first_name,
          '[^a-z0-9@._+-]+', '', 'g') LIKE v_query || '%'
      ))
    )
  ORDER BY (profile.id = p_selected_profile_id) DESC,
    profile.normalized_last_name, profile.normalized_first_name, profile.id
  LIMIT 20;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_search_profiles(uuid,uuid,text,uuid)
FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_search_profiles(uuid,uuid,text,uuid)
TO service_role, postgres;
