-- Prevent legacy class-history imports from inventing one-point awards when
-- an activity's numeric point value is missing, blank, or malformed.
--
-- The original implementation is retained under a revoked internal name so
-- this remains a forward-only migration. The public v2 database contract is
-- recreated as a strict validator that delegates only validated input to the
-- legacy transactional implementation.

BEGIN;

ALTER FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
)
RENAME TO csf_import_class_history_row_v2_legacy_unsafe_points_default;

REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_v2_legacy_unsafe_points_default(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION plugin_data.csf_import_class_history_row_v2(
  p_organization_id uuid,
  p_profile_id uuid,
  p_first_name text,
  p_last_name text,
  p_school_email text,
  p_personal_email text,
  p_normalized_first_name text,
  p_normalized_last_name text,
  p_normalized_school_email text,
  p_normalized_personal_email text,
  p_cohort_id uuid,
  p_term_id uuid,
  p_source_id uuid,
  p_import_row_id uuid,
  p_row_hash text,
  p_activities jsonb,
  p_meetings jsonb,
  p_all_requirements_met boolean,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_activity jsonb;
  v_points_text text;
  v_points numeric;
BEGIN
  IF jsonb_typeof(coalesce(p_activities, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Class-history activities must be a JSON array.';
  END IF;

  FOR v_activity IN
    SELECT value
    FROM jsonb_array_elements(coalesce(p_activities, '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_activity) <> 'object' THEN
      RAISE EXCEPTION 'Each class-history activity must be a JSON object.';
    END IF;

    IF NOT (v_activity ? 'points')
       OR jsonb_typeof(v_activity->'points') = 'null'
       OR nullif(btrim(v_activity->>'points'), '') IS NULL THEN
      RAISE EXCEPTION 'Imported activity points are required and must be numeric.';
    END IF;

    IF jsonb_typeof(v_activity->'points') NOT IN ('number', 'string') THEN
      RAISE EXCEPTION 'Imported activity points are required and must be numeric.';
    END IF;

    v_points_text := btrim(v_activity->>'points');

    BEGIN
      v_points := v_points_text::numeric;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Imported activity points are required and must be numeric.';
    END;

    IF v_points::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_points <= 0
       OR v_points > 100 THEN
      RAISE EXCEPTION 'Imported activity points must be greater than zero and no more than 100.';
    END IF;
  END LOOP;

  RETURN plugin_data.csf_import_class_history_row_v2_legacy_unsafe_points_default(
    p_organization_id,
    p_profile_id,
    p_first_name,
    p_last_name,
    p_school_email,
    p_personal_email,
    p_normalized_first_name,
    p_normalized_last_name,
    p_normalized_school_email,
    p_normalized_personal_email,
    p_cohort_id,
    p_term_id,
    p_source_id,
    p_import_row_id,
    p_row_hash,
    p_activities,
    p_meetings,
    p_all_requirements_met,
    p_actor_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) IS
  'Imports reviewed class history only when every activity includes an explicit numeric point value; missing, blank, and malformed points are rejected instead of defaulting to one.';

COMMENT ON FUNCTION plugin_data.csf_import_class_history_row_v2_legacy_unsafe_points_default(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) IS
  'Revoked legacy implementation retained only for delegation from the strict csf_import_class_history_row_v2 wrapper.';

COMMIT;
