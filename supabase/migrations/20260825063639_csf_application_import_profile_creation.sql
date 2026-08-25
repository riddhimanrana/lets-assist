-- Let an authorized officer turn a brand-new application response into an
-- unclaimed CSF profile without trusting the form's email as account identity.
-- Profile creation and import-row reconciliation are one transaction, so the
-- row can never point at a profile whose creation later rolled back (or vice
-- versa). The stable request UUID makes a dropped response safe to replay.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_create_profile_for_application_import_row(
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
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_first_name text;
  v_last_name text;
  v_profile_result jsonb;
  v_profile_id uuid;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable profile-create request identifier is required.';
  END IF;
  IF nullif(pg_catalog.btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Explain why this application should create a new CSF profile.';
  END IF;
  IF pg_catalog.length(p_reason) > 500 THEN
    RAISE EXCEPTION 'Keep the profile-create reason to 500 characters or fewer.';
  END IF;

  -- Match the global identity mutation order before locking the import row.
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor_for_row(
    p_organization_id,
    p_actor_user_id,
    p_row_id
  );

  SELECT import_row.*
  INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  JOIN plugin_data.csf_sheet_import_jobs AS job
    ON job.organization_id = import_row.organization_id
   AND job.id = import_row.job_id
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_row_id
    AND job.source_type = 'application_responses'
  FOR UPDATE OF import_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an application-response row from this organization.';
  END IF;
  IF v_row.cohort_id IS NULL THEN
    RAISE EXCEPTION 'Resolve the application row to a graduating class before creating a profile.';
  END IF;

  -- A replay reaches the same profile-save receipt and the reconciliation RPC
  -- below returns its existing match. A different request cannot create a
  -- second profile after the row has already left the unresolved queue.
  IF v_row.import_status NOT IN ('ambiguous', 'conflict', 'duplicate')
    AND NOT (
      v_row.resolution_status = 'resolved'
      AND v_row.import_status = 'pending'
      AND v_row.matched_profile_id IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'This application row no longer needs a profile decision.';
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
    RAISE EXCEPTION 'The application row does not contain a complete reviewed name.';
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
      -- Application addresses remain unverified evidence on the immutable row.
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

  PERFORM plugin_data.csf_reconcile_sheet_import_row(
    p_organization_id,
    p_row_id,
    v_profile_id,
    'match',
    p_reason,
    p_actor_user_id,
    v_row.correlation_id,
    pg_catalog.jsonb_build_object(
      'matchMethod', 'officer_created_unclaimed_profile',
      'profileCreateRequestId', p_request_id
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'rowId', v_row.id,
    'profileId', v_profile_id,
    'requestId', p_request_id,
    'idempotent', coalesce((v_profile_result ->> 'idempotent')::boolean, false)
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_create_profile_for_application_import_row(
  uuid, uuid, uuid, uuid, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_create_profile_for_application_import_row(
  uuid, uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_profile_for_application_import_row(
  uuid, uuid, uuid, uuid, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_create_profile_for_application_import_row(
  uuid, uuid, uuid, uuid, text
) IS 'Service-only, permission-checked, replay-safe creation of an unclaimed profile from an officer-reviewed application import row, followed by atomic row reconciliation. Form emails remain evidence and are not promoted to profile identity.';

COMMIT;
