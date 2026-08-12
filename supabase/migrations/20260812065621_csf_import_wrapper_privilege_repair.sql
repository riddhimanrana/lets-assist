-- Restore the central import fence after the identity-lock wrappers replaced
-- these functions. The owning SECURITY DEFINER commit wrapper can still invoke
-- them, while service_role must enter through the canonical attempt boundary.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_import_application_response_row(
  p_organization_id uuid, p_profile_id uuid,
  p_first_name text, p_last_name text, p_school_email text, p_personal_email text,
  p_normalized_first_name text, p_normalized_last_name text,
  p_normalized_school_email text, p_normalized_personal_email text,
  p_cohort_id uuid, p_term_id uuid, p_source_id uuid, p_import_row_id uuid,
  p_row_hash text, p_application_data jsonb, p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, 'application_responses'
  );
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, ARRAY[p_profile_id]::uuid[]
  );
  RETURN plugin_data.csf_import_application_response_row_identity_base(
    p_organization_id, p_profile_id, p_first_name, p_last_name,
    p_school_email, p_personal_email, p_normalized_first_name,
    p_normalized_last_name, p_normalized_school_email,
    p_normalized_personal_email, p_cohort_id, p_term_id, p_source_id,
    p_import_row_id, p_row_hash, p_application_data, p_actor_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_import_application_response_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_import_student_roster_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plugin_data.csf_import_application_response_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, uuid
) IS 'Owner-internal application row primitive. service_role must use the fenced central commit wrapper, which locks organization identity and revalidates the current officer before delegating.';

COMMENT ON FUNCTION plugin_data.csf_import_student_roster_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, text, uuid
) IS 'Owner-internal roster row primitive. service_role must use the fenced central commit wrapper, which locks organization identity and revalidates the current officer before delegating.';

COMMENT ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) IS 'Owner-internal strict class-history row primitive. service_role must use the fenced central commit wrapper, which locks organization identity and revalidates the current officer before delegating.';

COMMIT;
