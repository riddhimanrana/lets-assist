-- Allow reviewed same-name applicants in distinct graduating classes.
-- Existing same-class and contact matches still require reconciliation.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_create_profile_for_application_import_row_legacy(
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
  v_existing plugin_data.csf_profiles%ROWTYPE;
  v_has_homonym boolean := false;
  v_source_emails text[];
  v_normalized_first text;
  v_normalized_last text;
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

  -- The public wrapper handles request replay before entering this helper.
  IF v_row.import_status NOT IN ('ambiguous', 'conflict', 'duplicate') THEN
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

  v_normalized_first := plugin_data.csf_normalize_identity_part(v_first_name);
  v_normalized_last := plugin_data.csf_normalize_identity_part(v_last_name);
  SELECT coalesce(array_agg(DISTINCT email), ARRAY[]::text[])
  INTO v_source_emails
  FROM (
    SELECT plugin_data.csf_normalize_email_text(value) AS email
    FROM unnest(ARRAY[
      v_row.normalized_data #>> '{record,contact,responseEmail}',
      v_row.normalized_data #>> '{record,contact,preferredContactEmail}',
      v_row.normalized_data #>> '{commitPayload,applicationData,mostCheckedEmail}'
    ]) AS contact(value)
  ) AS contacts
  WHERE email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';

  FOR v_existing IN
    SELECT * FROM plugin_data.csf_profiles
    WHERE organization_id = p_organization_id AND record_status = 'active'
      AND normalized_first_name = v_normalized_first
      AND normalized_last_name = v_normalized_last
    ORDER BY id FOR UPDATE
  LOOP
    v_has_homonym := true;
    IF cardinality(v_source_emails) = 0
      OR NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_profile_cohort_memberships m
        WHERE m.organization_id=p_organization_id AND m.profile_id=v_existing.id AND m.status='active'
      )
      OR EXISTS (
        SELECT 1 FROM plugin_data.csf_profile_cohort_memberships m
        WHERE m.organization_id=p_organization_id AND m.profile_id=v_existing.id
          AND m.status='active' AND m.cohort_id=v_row.cohort_id
      )
      OR v_existing.normalized_school_email = ANY(v_source_emails)
      OR v_existing.normalized_personal_email = ANY(v_source_emails)
      OR plugin_data.csf_normalize_email_text(v_existing.reported_application_school_email) = ANY(v_source_emails)
      OR plugin_data.csf_normalize_email_text(v_existing.reported_application_personal_email) = ANY(v_source_emails)
      OR EXISTS (
        SELECT 1 FROM plugin_data.csf_term_applications a
        WHERE a.organization_id=p_organization_id AND a.profile_id=v_existing.id
          AND plugin_data.csf_normalize_email_text(a.most_checked_email) = ANY(v_source_emails)
      )
      OR EXISTS (
        SELECT 1 FROM plugin_data.csf_profile_accounts a JOIN auth.users u ON u.id=a.user_id
        WHERE a.organization_id=p_organization_id AND a.profile_id=v_existing.id
          AND a.status='verified' AND u.email_confirmed_at IS NOT NULL
          AND plugin_data.csf_normalize_email_text(u.email) = ANY(v_source_emails)
      )
    THEN
      RAISE EXCEPTION 'Review the existing student and class before adding another record with this name.';
    END IF;
  END LOOP;

  IF v_has_homonym THEN
    IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_profiles') THEN
      RAISE EXCEPTION 'Not authorized to manage CSF member profiles.';
    END IF;
    IF length(v_first_name)>200 OR length(v_last_name)>200 THEN
      RAISE EXCEPTION 'CSF member name fields must be 200 characters or fewer.';
    END IF;
    PERFORM 1 FROM plugin_data.csf_cohorts
    WHERE organization_id=p_organization_id AND id=v_row.cohort_id AND status='active'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected graduating class is not active.'; END IF;

    INSERT INTO plugin_data.csf_profiles(organization_id,first_name,last_name,normalized_first_name,normalized_last_name,source_summary)
    VALUES (p_organization_id,v_first_name,v_last_name,v_normalized_first,v_normalized_last,
      jsonb_build_object('createdBy','reviewed_application','actorUserId',p_actor_user_id,
        'profileWriteRequestId',p_request_id,'sourceImportRowId',p_row_id))
    RETURNING id INTO v_profile_id;
    INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id,status)
    VALUES(p_organization_id,v_profile_id,v_row.cohort_id,'active');
    v_profile_result := jsonb_build_object('profileId',v_profile_id,'idempotent',false);
  ELSE
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
  END IF;
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

ALTER FUNCTION plugin_data.csf_create_profile_for_application_import_row_legacy(
  uuid, uuid, uuid, uuid, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_create_profile_for_application_import_row_legacy(
  uuid, uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_profile_for_application_import_row_legacy(
  uuid, uuid, uuid, uuid, text
) TO postgres;

COMMENT ON FUNCTION plugin_data.csf_create_profile_for_application_import_row_legacy(
  uuid, uuid, uuid, uuid, text
) IS 'Owner-internal application profile creation. A reviewed same-name applicant may be created in a different class only when known contact evidence does not match an existing student. The public wrapper owns the durable request receipt; reconciliation and creation remain atomic.';

COMMIT;
