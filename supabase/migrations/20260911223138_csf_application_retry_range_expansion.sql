-- Preserve committed application bindings when a refreshed mapping only extends its row range.
CREATE OR REPLACE FUNCTION plugin_data.csf_recover_application_retry_matches(
  p_organization_id uuid, p_actor_user_id uuid, p_preview_job_id uuid,
  p_after_row_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_origin_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_parent plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_profile uuid;
  v_parent_id uuid;
  v_parent_job_id uuid;
  v_seen uuid[];
  v_count integer := 0;
  v_scanned integer := 0;
  v_last uuid;
  v_candidates uuid[];
  v_depth integer;
  v_record jsonb;
  v_prior_record jsonb;
  v_prior_range text[];
  v_current_range text[];
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor_for_job(p_organization_id,p_actor_user_id,p_preview_job_id);
  SELECT * INTO v_job FROM plugin_data.csf_sheet_import_jobs
    WHERE organization_id=p_organization_id AND id=p_preview_job_id FOR UPDATE;
  IF v_job.mode <> 'preview' OR v_job.source_type <> 'application_responses'
    OR v_job.status NOT IN ('completed','needs_resolution')
    OR v_job.initiated_by IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Choose a sealed application preview started by this officer.' USING ERRCODE='42501';
  END IF;
  IF v_job.retry_of_job_id IS NULL THEN
    RETURN jsonb_build_object('restored',0,'scanned',0,'nextCursor',NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_sheet_sources s
    WHERE s.organization_id=p_organization_id AND s.id=v_job.source_id
      AND s.source_type='application_responses'
      AND coalesce(s.drive_file_id,s.spreadsheet_id)=v_job.source_file_id
      AND coalesce(s.settings->>'mappingVersion','1')=v_job.mapping_version::text
      AND s.drive_access_state='accessible' AND NOT coalesce(s.drive_trashed,false)) THEN
    RAISE EXCEPTION 'The application source or mapping changed. Prepare a current preview.' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_import_commit_queue
      WHERE organization_id=p_organization_id AND preview_job_id=p_preview_job_id
        AND status IN ('queued','running'))
    OR EXISTS (SELECT 1 FROM plugin_data.csf_automatic_import_approvals
      WHERE organization_id=p_organization_id AND preview_job_id=p_preview_job_id) THEN
    RAISE EXCEPTION 'A frozen import preview cannot acquire new identity matches.' USING ERRCODE='55000';
  END IF;
  IF v_job.mapping_snapshot ? 'automaticUpdateAuthorizationId' AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_sheet_automatic_update_authorizations a
    WHERE a.organization_id=p_organization_id AND a.source_id=v_job.source_id
      AND a.id::text=v_job.mapping_snapshot->>'automaticUpdateAuthorizationId'
      AND a.generation::text=v_job.mapping_snapshot->>'automaticUpdateGeneration'
      AND a.authorized_by=p_actor_user_id AND a.mapping_version=v_job.mapping_version
      AND plugin_data.csf_sheet_automatic_update_authorization_current(p_organization_id,a.id)
  ) THEN
    RAISE EXCEPTION 'Automatic updates changed. Review this Sheet before importing.' USING ERRCODE='55000';
  END IF;

  FOR v_row IN SELECT * FROM plugin_data.csf_sheet_import_rows r
    WHERE r.organization_id=p_organization_id AND r.job_id=p_preview_job_id
      AND r.retry_of_row_id IS NOT NULL AND r.import_status='ambiguous'
      AND r.resolution_status='pending' AND r.matched_profile_id IS NULL
      AND r.commit_outcome_state='not_started' AND r.commit_frozen_at IS NULL
      AND coalesce(cardinality(r.errors),0)=0
      AND (p_after_row_id IS NULL OR r.id>p_after_row_id)
    ORDER BY r.id LIMIT 50 FOR UPDATE OF r
  LOOP
    v_scanned := v_scanned+1;
    v_last := v_row.id;
    v_record := v_row.normalized_data->'record';
    v_parent_id := v_row.retry_of_row_id;
    v_parent_job_id := v_job.retry_of_job_id;
    v_seen := ARRAY[v_row.id];
    v_profile := NULL;
    FOR v_depth IN 1..32 LOOP
      EXIT WHEN v_parent_id IS NULL OR v_parent_id=ANY(v_seen);
      v_seen := array_append(v_seen,v_parent_id);
      SELECT * INTO v_parent FROM plugin_data.csf_sheet_import_rows
        WHERE organization_id=p_organization_id AND id=v_parent_id
          AND job_id=v_parent_job_id AND source_id=v_job.source_id
          AND sheet_tab_name=v_row.sheet_tab_name AND row_number=v_row.row_number
          AND cohort_id=v_row.cohort_id AND term_id=v_row.term_id;
      EXIT WHEN NOT FOUND;
      SELECT * INTO v_origin_job FROM plugin_data.csf_sheet_import_jobs
        WHERE organization_id=p_organization_id AND id=v_parent.job_id
          AND source_id=v_job.source_id AND source_file_id=v_job.source_file_id
          AND source_type='application_responses' AND mode='preview';
      EXIT WHEN NOT FOUND;
      IF v_origin_job.mapping_version IS DISTINCT FROM v_job.mapping_version THEN
        -- Pending matches remain tied to their original mapping approval.
        EXIT WHEN v_parent.import_status NOT IN ('created','updated')
          OR v_parent.commit_outcome_state<>'succeeded'
          OR v_parent.commit_target_profile_id IS NULL
          OR v_origin_job.mapping_version IS NULL OR v_origin_job.mapping_version<1
          OR v_job.mapping_version IS NULL OR v_job.mapping_version<1
          OR v_origin_job.mapping_version>=v_job.mapping_version
          OR jsonb_typeof(v_origin_job.mapping_snapshot->'columns') IS DISTINCT FROM 'object'
          OR v_origin_job.mapping_snapshot->'columns'='{}'::jsonb
          OR coalesce(v_origin_job.mapping_snapshot->>'headerSignature','') !~ '^[a-f0-9]{64}$'
          OR jsonb_typeof(v_origin_job.mapping_snapshot->'tabs') IS DISTINCT FROM 'array'
          OR jsonb_typeof(v_job.mapping_snapshot->'tabs') IS DISTINCT FROM 'array';
        EXIT WHEN jsonb_array_length(v_origin_job.mapping_snapshot->'tabs')<>1
          OR jsonb_array_length(v_job.mapping_snapshot->'tabs')<>1;
        EXIT WHEN (v_origin_job.mapping_snapshot - ARRAY['version','driveFile','normalizedSnapshot','tabs',
            'automaticUpdateReadScope','automaticUpdateGeneration','automaticUpdateAuthorizationId','automaticUpdateProviderVersion'])
          IS DISTINCT FROM (v_job.mapping_snapshot - ARRAY['version','driveFile','normalizedSnapshot','tabs',
            'automaticUpdateReadScope','automaticUpdateGeneration','automaticUpdateAuthorizationId','automaticUpdateProviderVersion'])
          OR ((v_origin_job.mapping_snapshot#>'{tabs,0}') - 'range')
            IS DISTINCT FROM ((v_job.mapping_snapshot#>'{tabs,0}') - 'range')
          OR v_origin_job.mapping_snapshot#>>'{tabs,0,tabName}' IS DISTINCT FROM v_row.sheet_tab_name;
        v_prior_range := regexp_match(v_origin_job.mapping_snapshot#>>'{tabs,0,range}',
          '^(.+![A-Z]+[1-9][0-9]{0,6}:[A-Z]+)([1-9][0-9]{0,6})$');
        v_current_range := regexp_match(v_job.mapping_snapshot#>>'{tabs,0,range}',
          '^(.+![A-Z]+[1-9][0-9]{0,6}:[A-Z]+)([1-9][0-9]{0,6})$');
        EXIT WHEN v_prior_range IS NULL OR v_current_range IS NULL
          OR v_prior_range[1] IS DISTINCT FROM v_current_range[1]
          OR v_current_range[2]::integer<v_prior_range[2]::integer
          OR v_row.row_number>v_prior_range[2]::integer;
      END IF;
      v_prior_record := v_parent.normalized_data->'record';
      EXIT WHEN EXISTS (SELECT 1 FROM plugin_data.csf_import_commit_queue q
        WHERE q.organization_id=p_organization_id AND q.preview_job_id=v_parent.job_id
          AND q.status IN ('queued','running'));
      EXIT WHEN coalesce(v_record#>>'{identity,normalizedFirstName}','')=''
        OR coalesce(v_record#>>'{identity,normalizedLastName}','')=''
        OR v_record#>'{identity}' IS DISTINCT FROM v_prior_record#>'{identity}'
        OR v_record#>'{contact}' IS DISTINCT FROM v_prior_record#>'{contact}'
        OR v_record#>'{cohort}' IS DISTINCT FROM v_prior_record#>'{cohort}'
        OR nullif(v_record#>>'{submission,submittedAt}','') IS NULL
        OR v_record#>>'{submission,submittedAt}' IS DISTINCT FROM v_prior_record#>>'{submission,submittedAt}';
      IF v_parent.import_status IN ('created','updated') AND v_parent.commit_outcome_state='succeeded'
        AND v_parent.commit_target_profile_id IS NOT NULL THEN
        v_profile := v_parent.commit_target_profile_id;
        EXIT;
      END IF;
      EXIT WHEN v_parent.row_hash IS DISTINCT FROM v_row.row_hash;
      IF v_parent.import_status='pending' AND v_parent.commit_outcome_state='not_started'
        AND v_parent.resolution_status='resolved' AND v_parent.commit_target_profile_id IS NULL
        AND v_parent.commit_frozen_at IS NULL AND v_parent.commit_attempt_id IS NULL
        AND v_parent.matched_profile_id IS NOT NULL
        AND (SELECT count(*) FROM plugin_data.csf_admin_audit_events a
          WHERE a.organization_id=p_organization_id AND a.target_type='csf_sheet_import_rows'
            AND a.target_id=v_parent.id AND a.action='sheets.row_match_resolved')=1
        AND EXISTS (SELECT 1 FROM plugin_data.csf_admin_audit_events a
          WHERE a.organization_id=p_organization_id AND a.target_type='csf_sheet_import_rows'
            AND a.target_id=v_parent.id AND a.action='sheets.row_match_resolved'
            AND a.actor_user_id=v_parent.resolved_by AND a.correlation_id=v_parent.correlation_id
            AND a.after_data->>'decision'='match'
            AND a.after_data->>'profileId'=v_parent.matched_profile_id::text
            AND a.after_data->>'jobId'=v_parent.job_id::text
            AND a.after_data->>'sourceId'=v_parent.source_id::text) THEN
        v_profile := v_parent.matched_profile_id;
        EXIT;
      END IF;
      EXIT WHEN v_parent.import_status NOT IN ('superseded','ambiguous')
        OR v_parent.commit_outcome_state<>'not_started' OR v_parent.commit_target_profile_id IS NOT NULL
        OR v_parent.matched_profile_id IS NOT NULL;
      v_parent_id := v_parent.retry_of_row_id;
      v_parent_job_id := v_origin_job.retry_of_job_id;
    END LOOP;
    CONTINUE WHEN v_profile IS NULL;
    SELECT array_agg(DISTINCT p.id) INTO v_candidates
      FROM plugin_data.csf_profiles p
      WHERE p.organization_id=p_organization_id AND p.record_status='active'
        AND ((p.normalized_first_name=v_record#>>'{identity,normalizedFirstName}'
          AND p.normalized_last_name=v_record#>>'{identity,normalizedLastName}'
          AND EXISTS (SELECT 1 FROM plugin_data.csf_profile_cohort_memberships m
            WHERE m.organization_id=p.organization_id AND m.profile_id=p.id
              AND m.cohort_id=v_row.cohort_id AND m.status='active'))
          OR p.normalized_school_email IN (
            nullif(lower(btrim(v_record#>>'{contact,responseEmail}')),''),
            nullif(lower(btrim(v_record#>>'{contact,preferredContactEmail}')),''))
          OR p.normalized_personal_email IN (
            nullif(lower(btrim(v_record#>>'{contact,responseEmail}')),''),
            nullif(lower(btrim(v_record#>>'{contact,preferredContactEmail}')),'')));
    CONTINUE WHEN cardinality(v_candidates) IS DISTINCT FROM 1 OR v_candidates[1]<>v_profile;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM plugin_data.csf_profile_cohort_memberships m
      WHERE m.organization_id=p_organization_id AND m.profile_id=v_profile
        AND m.cohort_id=v_row.cohort_id AND m.status='active');
    PERFORM plugin_data.csf_reconcile_sheet_import_row(p_organization_id,v_row.id,v_profile,'match',
      'Recovered the prior source-bound application identity after revalidating its audit receipt and current class candidates.',
      p_actor_user_id,v_row.correlation_id,jsonb_build_object('matchMethod','reviewed_source_retry',
        'originRowId',v_parent.id,'originJobId',v_parent.job_id,'originActorId',v_parent.resolved_by));
    v_count := v_count+1;
  END LOOP;
  RETURN jsonb_build_object('restored',v_count,'scanned',v_scanned,
    'nextCursor',CASE WHEN v_scanned=50 THEN v_last ELSE NULL END);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_recover_application_retry_matches(uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_recover_application_retry_matches(uuid,uuid,uuid,uuid) TO service_role;
