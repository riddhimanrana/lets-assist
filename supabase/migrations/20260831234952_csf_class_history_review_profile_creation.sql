-- Let an officer create one unclaimed profile from a reviewed class-history
-- row when the workbook roster key is invalid and no active same-class profile
-- has the same normalized name. The request UUID binds the row and reason to a
-- durable receipt, and profile creation plus row reconciliation share one
-- transaction.

BEGIN;

CREATE UNIQUE INDEX csf_class_history_profile_create_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE action = 'sheet_import.class_history_profile_create_request';

CREATE OR REPLACE FUNCTION plugin_data.csf_create_profile_for_class_history_import_row(
  p_organization_id uuid,
  p_row_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_first_name text;
  v_last_name text;
  v_normalized_first_name text;
  v_normalized_last_name text;
  v_profile_result jsonb;
  v_profile_id uuid;
  v_result jsonb;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable profile-create request identifier is required.';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Explain why this class-history row should create a new CSF profile.';
  END IF;
  IF pg_catalog.length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Keep the profile-create reason to 500 characters or fewer.';
  END IF;

  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor_for_row(
    p_organization_id,
    p_actor_user_id,
    p_row_id
  );

  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'rowId', p_row_id,
          'reason', v_reason
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_create_profile_for_class_history_import_row:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action = 'sheet_import.class_history_profile_create_request';

  IF FOUND THEN
    IF v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint
      OR pg_catalog.jsonb_typeof(v_receipt.after_data -> 'result') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'That profile-create request identifier is already bound to a different class-history row or review.';
    END IF;
    RETURN (v_receipt.after_data -> 'result')
      || pg_catalog.jsonb_build_object('idempotent', true);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = p_organization_id
      AND audit.correlation_id = p_request_id
      AND audit.action IN ('profile.create', 'profile.edit')
  ) THEN
    RAISE EXCEPTION 'That profile-create request identifier is already bound to another member change.';
  END IF;

  SELECT import_row.*
  INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  JOIN plugin_data.csf_sheet_import_jobs AS job
    ON job.organization_id = import_row.organization_id
   AND job.id = import_row.job_id
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_row_id
    AND job.mode = 'preview'
    AND job.source_type = 'class_history'
  FOR UPDATE OF import_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose a class-history preview row from this organization.';
  END IF;
  IF v_row.cohort_id IS NULL THEN
    RAISE EXCEPTION 'Resolve the class-history row to a graduating class before creating a profile.';
  END IF;
  IF v_row.import_status <> 'ambiguous'
    OR v_row.matched_profile_id IS NOT NULL
    OR v_row.resolution_status = 'resolved' THEN
    RAISE EXCEPTION 'This class-history row no longer needs a new-profile decision.';
  END IF;
  IF plugin_data.csf_class_history_has_stable_source_key(v_row.normalized_data) THEN
    RAISE EXCEPTION 'This class-history row has a valid workbook key and must use the normal import path.';
  END IF;

  v_first_name := nullif(pg_catalog.btrim(coalesce(
    v_row.normalized_data #>> '{commitPayload,identity,firstName}',
    v_row.normalized_data #>> '{record,identity,firstName}'
  )), '');
  v_last_name := nullif(pg_catalog.btrim(coalesce(
    v_row.normalized_data #>> '{commitPayload,identity,lastName}',
    v_row.normalized_data #>> '{record,identity,lastName}'
  )), '');
  IF v_first_name IS NULL OR v_last_name IS NULL THEN
    RAISE EXCEPTION 'The class-history row does not contain a complete reviewed name.';
  END IF;

  v_normalized_first_name := plugin_data.csf_normalize_identity_part(v_first_name);
  v_normalized_last_name := plugin_data.csf_normalize_identity_part(v_last_name);
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_profiles AS profile
    JOIN plugin_data.csf_profile_cohort_memberships AS membership
      ON membership.organization_id = profile.organization_id
     AND membership.profile_id = profile.id
     AND membership.cohort_id = v_row.cohort_id
     AND membership.status = 'active'
    WHERE profile.organization_id = p_organization_id
      AND profile.record_status = 'active'
      AND profile.normalized_first_name = v_normalized_first_name
      AND profile.normalized_last_name = v_normalized_last_name
  ) THEN
    RAISE EXCEPTION 'An active member with this exact name already exists in the class. Match that profile instead.';
  END IF;

  v_profile_result := plugin_data.csf_upsert_profile(
    p_organization_id,
    p_actor_user_id,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'profileId', NULL,
      'firstName', v_first_name,
      'middleName', NULL,
      'lastName', v_last_name,
      'preferredName', NULL,
      'nicknames', '[]'::jsonb,
      'schoolEmail', NULL,
      'personalEmail', NULL,
      'cohortId', v_row.cohort_id,
      'termId', NULL,
      'termMembershipStatus', NULL
    )
  );
  v_profile_id := nullif(v_profile_result ->> 'profileId', '')::uuid;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'The unclaimed CSF profile could not be created.';
  END IF;

  v_result := plugin_data.csf_reconcile_sheet_import_row(
    p_organization_id,
    p_row_id,
    v_profile_id,
    'match',
    v_reason,
    p_actor_user_id,
    v_row.correlation_id
  );
  v_result := v_result || pg_catalog.jsonb_build_object(
    'requestId', p_request_id,
    'matchMethod', 'officer_created_class_history_profile',
    'idempotent', coalesce((v_profile_result ->> 'idempotent')::boolean, false)
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'sheet_import.class_history_profile_create_request',
    'csf_sheet_import_rows',
    p_row_id,
    pg_catalog.jsonb_build_object(
      'requestFingerprint', v_request_fingerprint,
      'result', v_result
    ),
    p_request_id,
    'class_history_import',
    p_row_id::text,
    'class_history_profile_created'
  );

  RETURN v_result;
END;
$$;

ALTER FUNCTION plugin_data.csf_create_profile_for_class_history_import_row(
  uuid, uuid, uuid, uuid, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_create_profile_for_class_history_import_row(
  uuid, uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_profile_for_class_history_import_row(
  uuid, uuid, uuid, uuid, text
) TO postgres, service_role;

COMMENT ON FUNCTION plugin_data.csf_create_profile_for_class_history_import_row(
  uuid, uuid, uuid, uuid, text
) IS 'Service-only, permission-checked creation of an unclaimed profile from an officer-reviewed class-history row whose workbook key is invalid and whose class has no exact-name member.';

COMMIT;

NOTIFY pgrst, 'reload schema';
