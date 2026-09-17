-- Bind semester Sheet retries to the reviewed source identity and restore explicit trigger grants.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_claim_sheet_semester_ledger_write(
  p_organization_id uuid,p_actor_user_id uuid,p_mapping_id uuid,p_source_link_id uuid,
  p_profile_id uuid,p_source_version text,p_preview_digest text,p_plan jsonb,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m plugin_data.csf_sheet_semester_ledger_mappings%ROWTYPE;
  d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
  w plugin_data.csf_sheet_semester_ledger_writes%ROWTYPE;
  snapshot jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync')
    AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO m FROM plugin_data.csf_sheet_semester_ledger_mappings
    WHERE organization_id=p_organization_id AND id=p_mapping_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accepted ledger mapping not found.' USING ERRCODE='22023'; END IF;
  SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations
    WHERE organization_id=p_organization_id AND id=m.destination_id FOR NO KEY UPDATE;
  IF NOT FOUND OR d.enabled OR d.kind<>'class' OR d.cohort_id IS DISTINCT FROM m.cohort_id
    OR d.term_id IS DISTINCT FROM m.term_id OR d.spreadsheet_file_id=m.source_file_id
    OR d.privacy_verified_at IS NULL THEN
    RAISE EXCEPTION 'The accepted destination mapping changed.' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_reviewed_workbook_profile_links l
    WHERE l.id=p_source_link_id AND l.organization_id=p_organization_id
      AND l.cohort_id=m.cohort_id AND l.source_file_id=m.source_file_id
      AND l.profile_id=p_profile_id AND l.revoked_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM plugin_data.csf_profile_cohort_memberships c
      WHERE c.organization_id=p_organization_id AND c.cohort_id=m.cohort_id
        AND c.profile_id=p_profile_id AND c.status='active') THEN
    RAISE EXCEPTION 'The reviewed roster link or cohort membership changed.' USING ERRCODE='55000';
  END IF;
  snapshot:=plugin_data.csf_sheet_sync_destination_snapshot(p_organization_id,d.id,'profile',p_profile_id);
  IF snapshot IS NULL OR md5(snapshot::text) IS DISTINCT FROM p_source_version THEN
    RAISE EXCEPTION 'The profile source version changed. Preview again.' USING ERRCODE='55000';
  END IF;
  IF p_request_id IS NULL OR coalesce(p_preview_digest !~ '^[a-f0-9]{64}$',true)
    OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_plan->'changes') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_plan->'changes')<1
    OR (p_plan->>'rowIndex')::integer <= (m.layout->>'headerRowIndex')::integer THEN
    RAISE EXCEPTION 'A reviewed, nonempty cell plan is required.' USING ERRCODE='22023';
  END IF;
  IF (p_plan->>'rowIndex')::integer < (m.layout->>'firstDataRowIndex')::integer
    OR (p_plan->>'rowIndex')::integer > (m.layout->>'lastDataRowIndex')::integer
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_plan->'changes') AS cell(value)
      WHERE (cell.value->>'rowIndex')::integer IS DISTINCT FROM (p_plan->>'rowIndex')::integer
        OR (cell.value->>'columnIndex')::integer NOT BETWEEN
          (m.layout->>'firstWritableColumn')::integer AND (m.layout->>'lastWritableColumn')::integer
        OR NOT (
          m.layout->'activityColumns' @> jsonb_build_array((cell.value->>'columnIndex')::integer)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(m.layout->'meetingColumns') AS meeting(value)
            WHERE (meeting.value->>'columnIndex')::integer=(cell.value->>'columnIndex')::integer))
        OR coalesce(cell.value->>'expectedValue','')<>''
        OR nullif(btrim(cell.value->>'value'),'') IS NULL
        OR nullif(btrim(cell.value->>'evidenceId'),'') IS NULL) THEN
    RAISE EXCEPTION 'The cell plan exceeds its reviewed row or column mapping.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO w FROM plugin_data.csf_sheet_semester_ledger_writes
    WHERE request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF w.organization_id IS DISTINCT FROM p_organization_id OR w.mapping_id IS DISTINCT FROM m.id
      OR w.destination_id IS DISTINCT FROM d.id OR w.source_link_id IS DISTINCT FROM p_source_link_id
      OR w.profile_id IS DISTINCT FROM p_profile_id OR w.source_version IS DISTINCT FROM p_source_version
      OR w.preview_digest IS DISTINCT FROM p_preview_digest OR w.plan IS DISTINCT FROM p_plan
      OR w.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'This write request conflicts with its original plan.' USING ERRCODE='23505';
    END IF;
    RETURN to_jsonb(w)||jsonb_build_object('claimed_now',false);
  END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_semester_ledger_writes old
    WHERE old.destination_id=d.id AND old.profile_id=p_profile_id
      AND old.status IN ('claimed','unknown_outcome')) THEN
    RAISE EXCEPTION 'Reconcile the previous semester Sheet attempt first.' USING ERRCODE='55000';
  END IF;
  INSERT INTO plugin_data.csf_sheet_semester_ledger_writes
    (request_id,organization_id,mapping_id,destination_id,source_link_id,profile_id,
      actor_user_id,source_version,preview_digest,plan)
    VALUES(p_request_id,p_organization_id,m.id,d.id,p_source_link_id,p_profile_id,
      p_actor_user_id,p_source_version,p_preview_digest,p_plan)
    RETURNING * INTO w;
  INSERT INTO plugin_data.csf_admin_audit_events
    (organization_id,actor_user_id,action,target_type,target_id,after_data)
    VALUES(p_organization_id,p_actor_user_id,'sheet_sync.semester_write_claimed',
      'sheet_semester_ledger_write',w.request_id,
      jsonb_build_object('destination_id',d.id,'profile_id',p_profile_id,
        'source_version',p_source_version,'preview_digest',p_preview_digest));
  RETURN to_jsonb(w)||jsonb_build_object('claimed_now',true);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_sheet_semester_ledger_write(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_sheet_semester_ledger_write(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid) TO postgres,service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_sheet_semester_ledger_immutable() TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_semester_write_link_owner() TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_workbook_link_unsettled_write() TO postgres;

COMMIT;
