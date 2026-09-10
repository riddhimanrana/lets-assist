-- Keep application contact capture separate from identity matching and account verification.
CREATE OR REPLACE FUNCTION plugin_data.csf_fill_application_profile_contacts(
  p_organization_id uuid, p_import_row_id uuid, p_profile_id uuid, p_actor_user_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_contacts jsonb := '{}'::jsonb;
  v_field text; v_email text; v_school text; v_personal text;
  v_conflicts text[] := ARRAY[]::text[];
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  SELECT * INTO v_row FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id=p_organization_id AND id=p_import_row_id FOR UPDATE;
  IF NOT FOUND OR v_row.normalized_data->>'sourceType' IS DISTINCT FROM 'application_responses'
    OR v_row.matched_profile_id IS DISTINCT FROM p_profile_id
    OR (v_row.commit_frozen_at IS NOT NULL AND v_row.commit_target_profile_id IS DISTINCT FROM p_profile_id) THEN
    RAISE EXCEPTION 'Application contacts require the resolved import profile.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_profile FROM plugin_data.csf_profiles
    WHERE organization_id=p_organization_id AND id=p_profile_id AND merged_into_profile_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The application profile is no longer active.' USING ERRCODE='23514'; END IF;
  FOREACH v_field IN ARRAY ARRAY['schoolEmail','personalEmail','preferredContactEmail','responseEmail'] LOOP
    v_email := plugin_data.csf_normalize_email_text(v_row.normalized_data#>>ARRAY['record','contact',v_field]);
    IF length(v_email)<=254
      AND coalesce(v_row.normalized_data#>>ARRAY['record','contact',v_field||'State'],'valid')='valid'
      AND v_email ~ $email$^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:[.][a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:[.][a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$$email$ THEN
      v_contacts := v_contacts || jsonb_build_object(v_field,v_email);
    END IF;
  END LOOP;
  v_school := CASE WHEN nullif(btrim(v_profile.school_email),'') IS NULL THEN v_contacts->>'schoolEmail' END;
  v_personal := CASE WHEN nullif(btrim(v_profile.personal_email),'') IS NULL
    THEN coalesce(v_contacts->>'preferredContactEmail',v_contacts->>'personalEmail',v_contacts->>'responseEmail') END;
  IF v_school IS NOT NULL AND v_school=plugin_data.csf_normalize_email_text(v_profile.personal_email) THEN v_school:=NULL; END IF;
  IF v_personal IS NOT NULL AND v_personal=coalesce(plugin_data.csf_normalize_email_text(v_profile.school_email),v_school) THEN v_personal:=NULL; END IF;
  IF v_school IS NOT NULL AND EXISTS(SELECT 1 FROM plugin_data.csf_profiles p
    WHERE p.organization_id=p_organization_id AND p.id<>p_profile_id
      AND (p.normalized_school_email=v_school OR p.normalized_personal_email=v_school)) THEN
    v_school:=NULL; v_conflicts:=array_append(v_conflicts,'schoolEmail');
  END IF;
  IF v_personal IS NOT NULL AND EXISTS(SELECT 1 FROM plugin_data.csf_profiles p
    WHERE p.organization_id=p_organization_id AND p.id<>p_profile_id
      AND (p.normalized_school_email=v_personal OR p.normalized_personal_email=v_personal)) THEN
    v_personal:=NULL; v_conflicts:=array_append(v_conflicts,'personalEmail');
  END IF;
  IF v_school IS NULL AND v_personal IS NULL AND cardinality(v_conflicts)=0 THEN RETURN; END IF;
  IF v_school IS NOT NULL OR v_personal IS NOT NULL THEN
    UPDATE plugin_data.csf_profiles SET
      school_email=coalesce(v_school,school_email), normalized_school_email=coalesce(v_school,normalized_school_email),
      personal_email=coalesce(v_personal,personal_email), normalized_personal_email=coalesce(v_personal,normalized_personal_email),
      updated_at=now()
    WHERE organization_id=p_organization_id AND id=p_profile_id;
  END IF;
  INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,before_data,after_data,correlation_id)
  VALUES(p_organization_id,p_actor_user_id,'profile.application_contacts_captured','csf_profiles',p_profile_id,
    jsonb_build_object('schoolEmail',v_profile.school_email,'personalEmail',v_profile.personal_email),
    jsonb_build_object('schoolEmail',coalesce(v_school,v_profile.school_email),'personalEmail',coalesce(v_personal,v_profile.personal_email),
      'importRowId',p_import_row_id,'skippedConflictingFields',to_jsonb(v_conflicts),'accountLinked',false),v_row.correlation_id);
END;
$function$;
REVOKE ALL ON FUNCTION plugin_data.csf_fill_application_profile_contacts(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_fill_application_profile_contacts(uuid,uuid,uuid,uuid) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_prepare_automatic_application_profiles(p_organization_id uuid,p_preview_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_auth plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_result jsonb; v_profile_id uuid; v_request_id uuid;
  v_count integer:=0; v_remaining boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  SELECT * INTO v_preview FROM plugin_data.csf_sheet_import_jobs WHERE organization_id=p_organization_id AND id=p_preview_job_id;
  SELECT * INTO v_auth FROM plugin_data.csf_sheet_automatic_update_authorizations
    WHERE organization_id=p_organization_id AND source_id=v_preview.source_id;
  IF NOT FOUND OR v_preview.source_type IS DISTINCT FROM 'application_responses'
    OR v_preview.mapping_snapshot->>'automaticUpdateAuthorizationId' IS DISTINCT FROM v_auth.id::text THEN
    RAISE EXCEPTION 'Prepare this application Sheet under its automatic-update authorization first.' USING ERRCODE='55000';
  END IF;
  PERFORM plugin_data.csf_assert_import_actor_for_job(p_organization_id,v_auth.authorized_by,p_preview_job_id);
  PERFORM plugin_data.csf_assert_automatic_sheet_preview_current(p_organization_id,p_preview_job_id,v_auth.authorized_by);
  IF cardinality(plugin_data.csf_import_preview_evidence_blockers(p_organization_id,p_preview_job_id,true))>0
    OR v_preview.source_content_hash IS NULL OR v_preview.source_content_hash !~ '^[a-f0-9]{64}$'
    OR v_preview.snapshot_hash IS NULL OR v_preview.snapshot_hash !~ '^[a-f0-9]{64}$'
    OR v_preview.snapshot_contract_version IS DISTINCT FROM 'csf-normalized-import/v1'
    OR v_preview.snapshot_row_count IS DISTINCT FROM (SELECT count(*) FROM plugin_data.csf_sheet_import_rows
      WHERE organization_id=p_organization_id AND job_id=p_preview_job_id)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_sheet_import_rows WHERE organization_id=p_organization_id AND job_id=p_preview_job_id
      AND (source_id IS DISTINCT FROM v_preview.source_id OR commit_outcome_state IN ('in_flight','unknown','historical_unknown'))) THEN
    RAISE EXCEPTION 'Application source evidence or write outcomes need review before creating profiles.' USING ERRCODE='55000';
  END IF;
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id,v_auth.authorized_by,'manage_profiles')
    OR EXISTS (SELECT 1 FROM plugin_data.csf_automatic_import_approvals WHERE organization_id=p_organization_id AND preview_job_id=p_preview_job_id) THEN
    RETURN jsonb_build_object('created',0,'remaining',false);
  END IF;
  -- Validate locked candidates inside the loop. Filtering with the safety function
  -- before sorting evaluated the entire preview before returning the first batch.
  FOR v_row IN SELECT * FROM plugin_data.csf_sheet_import_rows r
    WHERE r.organization_id=p_organization_id AND r.job_id=p_preview_job_id
      AND r.import_status='ambiguous' AND r.matched_profile_id IS NULL
      AND r.resolution_status='pending' AND r.commit_outcome_state='not_started'
      AND r.commit_frozen_at IS NULL
    ORDER BY r.id FOR UPDATE OF r
  LOOP
    IF NOT plugin_data.csf_automatic_application_new_profile_is_safe(p_organization_id,v_row.id) THEN CONTINUE; END IF;
    v_request_id:=md5('csf_auto_application_profile:'||p_organization_id::text||':'||v_row.id::text)::uuid;
    v_result:=plugin_data.csf_upsert_profile(p_organization_id,v_auth.authorized_by,v_request_id,
      jsonb_build_object('profileId',NULL,'firstName',v_row.normalized_data#>>'{record,identity,firstName}',
        'lastName',v_row.normalized_data#>>'{record,identity,lastName}','schoolEmail',NULL,'personalEmail',NULL,
        'cohortId',v_row.cohort_id,'termId',NULL,'termMembershipStatus',NULL));
    v_profile_id:=nullif(v_result->>'profileId','')::uuid;
    IF v_profile_id IS NULL THEN RAISE EXCEPTION 'The new applicant profile could not be confirmed.' USING ERRCODE='55000'; END IF;
    PERFORM plugin_data.csf_reconcile_sheet_import_row(p_organization_id,v_row.id,v_profile_id,'match',
      'Created an unclaimed applicant under the officer-authorized Sheet mapping; no existing identity candidate was found.',
      v_auth.authorized_by,v_row.correlation_id,jsonb_build_object('matchMethod','source_authorized_new_profile',
        'authorizationId',v_auth.id,'generation',v_auth.generation,'profileCreateRequestId',v_request_id));
    PERFORM plugin_data.csf_fill_application_profile_contacts(p_organization_id,v_row.id,v_profile_id,v_auth.authorized_by);
    INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data,correlation_id)
    VALUES(p_organization_id,v_auth.authorized_by,'sheets.automatic_application_profile_created','csf_sheet_import_rows',v_row.id,
      jsonb_build_object('authorizationId',v_auth.id,'generation',v_auth.generation,'profileId',v_profile_id),v_request_id);
    v_count:=v_count+1;
    EXIT WHEN v_count>=50;
  END LOOP;
  SELECT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_import_rows r WHERE r.organization_id=p_organization_id AND r.job_id=p_preview_job_id
    AND plugin_data.csf_automatic_application_new_profile_is_safe(p_organization_id,r.id)) INTO v_remaining;
  UPDATE plugin_data.csf_sheet_automatic_update_authorizations
    SET next_check_at=CASE WHEN v_remaining THEN now() ELSE now()+interval '5 minutes' END
    WHERE organization_id=p_organization_id AND id=v_auth.id;
  RETURN jsonb_build_object('created',v_count,'remaining',v_remaining);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_prepare_automatic_application_profiles(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_prepare_automatic_application_profiles(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_commit_import_row_for_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_import_row_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_preview_job_id uuid;
  v_target_profile_id uuid;
  v_result jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  SELECT
    coalesce(
      nullif(attempt.actor_snapshot->>'claimedBy', '')::uuid,
      attempt.actor_user_id
    ),
    commit_job.preview_job_id,
    import_row.commit_target_profile_id
  INTO v_actor_user_id, v_preview_job_id, v_target_profile_id
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  JOIN plugin_data.csf_sheet_import_jobs AS commit_job
    ON commit_job.organization_id = attempt.organization_id
   AND commit_job.id = attempt.commit_job_id
  JOIN plugin_data.csf_sheet_import_rows AS import_row
    ON import_row.organization_id = attempt.organization_id
   AND import_row.job_id = commit_job.preview_job_id
   AND import_row.id = p_import_row_id
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found for this commit.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, v_actor_user_id, v_preview_job_id
  );
  PERFORM plugin_data.csf_assert_automatic_sheet_preview_current(
    p_organization_id, v_preview_job_id, v_actor_user_id
  );
  PERFORM plugin_data.csf_assert_automatic_import_scope(p_organization_id,v_preview_job_id);
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, ARRAY[v_target_profile_id]::uuid[]
  );
  v_result := plugin_data.csf_commit_import_row_for_attempt_identity_base(
    p_organization_id, p_attempt_id, p_import_row_id
  );
  IF coalesce((v_result->>'replayed')::boolean,false) = false AND v_result->>'applicationId' IS NOT NULL THEN
    PERFORM plugin_data.csf_fill_application_profile_contacts(
      p_organization_id,p_import_row_id,v_target_profile_id,v_actor_user_id
    );
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_import_row_for_attempt(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_import_row_for_attempt(uuid,uuid,uuid) TO service_role;
