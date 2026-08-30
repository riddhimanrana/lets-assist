-- Keep class-code joins compatible while removing name-only account linking.

DROP FUNCTION IF EXISTS plugin_data.csf_confirm_profile_name_match(
  uuid, uuid, uuid, text, uuid, uuid, text, text
);

ALTER FUNCTION plugin_data.csf_join_class_by_code(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) RENAME TO csf_join_class_by_code_pre_identity_guard;

REVOKE ALL ON FUNCTION plugin_data.csf_join_class_by_code_pre_identity_guard(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION plugin_data.csf_join_class_by_code(
  p_organization_id uuid,
  p_code text,
  p_user_id uuid,
  p_verified_email text,
  p_first_name text,
  p_last_name text,
  p_preferred_name text DEFAULT NULL,
  p_confirmed_profile_id uuid DEFAULT NULL,
  p_declined_profile_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_confirmed_profile_id IS NOT NULL THEN
    RAISE EXCEPTION 'Name-only profile confirmation is no longer supported.';
  END IF;

  -- A decline is useful only as member-supplied context. It cannot authorize
  -- a second profile when the roster already contains a name match. Passing
  -- neither answer to the guarded implementation creates or replays one
  -- officer request for every name-only or ambiguous result.
  RETURN plugin_data.csf_join_class_by_code_pre_identity_guard(
    p_organization_id,
    p_code,
    p_user_id,
    p_verified_email,
    p_first_name,
    p_last_name,
    p_preferred_name,
    NULL,
    NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_join_class_by_code(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_join_class_by_code(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_join_class_by_code(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) IS
  'Connects one verified-email class record or creates one officer review request. Name-only confirmation never links an account.';
