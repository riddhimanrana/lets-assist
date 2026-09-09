-- Extend reviewed class layouts to matching canonical tabs only after consent.
BEGIN;
ALTER TABLE plugin_data.csf_sheet_automatic_update_authorizations
  ADD COLUMN include_matching_semester_tabs boolean NOT NULL DEFAULT false,
  ADD COLUMN parent_authorization_id uuid,
  ADD COLUMN parent_authorization_generation bigint,
  ADD CONSTRAINT csf_sheet_authorization_organization_id UNIQUE (organization_id,id),
  ADD CONSTRAINT csf_sheet_authorization_parent_tenant FOREIGN KEY (organization_id,parent_authorization_id)
    REFERENCES plugin_data.csf_sheet_automatic_update_authorizations(organization_id,id),
  ADD CONSTRAINT csf_sheet_authorization_class_scope CHECK (NOT include_matching_semester_tabs OR source_type='class_history'),
  ADD CONSTRAINT csf_sheet_authorization_parent_pair CHECK (
    (parent_authorization_id IS NULL AND parent_authorization_generation IS NULL)
    OR (parent_authorization_id IS NOT NULL AND parent_authorization_generation IS NOT NULL AND parent_authorization_generation>0
      AND parent_authorization_id<>id AND NOT include_matching_semester_tabs));
CREATE UNIQUE INDEX csf_workbook_matching_tab_scope_request
  ON plugin_data.csf_admin_audit_events(organization_id,(after_data->>'requestId'))
  WHERE action='sheets.matching_tab_scope_changed';

CREATE FUNCTION plugin_data.csf_class_sheet_layout_matches(
  p_organization_id uuid,p_reviewed_source_id uuid,p_new_source_id uuid
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_reviewed plugin_data.csf_sheet_sources%ROWTYPE;
  v_new plugin_data.csf_sheet_sources%ROWTYPE;
  v_before jsonb; v_after jsonb; v_year integer;
BEGIN
  SELECT * INTO v_reviewed FROM plugin_data.csf_sheet_sources
    WHERE organization_id=p_organization_id AND id=p_reviewed_source_id;
  SELECT * INTO v_new FROM plugin_data.csf_sheet_sources
    WHERE organization_id=p_organization_id AND id=p_new_source_id;
  IF v_reviewed.id IS NULL OR v_new.id IS NULL
    OR v_reviewed.source_type IS DISTINCT FROM 'class_history' OR v_new.source_type IS DISTINCT FROM 'class_history'
    OR v_reviewed.provider IS DISTINCT FROM 'google_sheets' OR v_new.provider IS DISTINCT FROM 'google_sheets'
    OR v_reviewed.cohort_id IS NULL OR v_new.cohort_id IS DISTINCT FROM v_reviewed.cohort_id
    OR v_reviewed.spreadsheet_id IS NULL OR v_new.spreadsheet_id IS DISTINCT FROM v_reviewed.spreadsheet_id
    OR v_reviewed.sync_owner_user_id IS NULL OR v_new.sync_owner_user_id IS DISTINCT FROM v_reviewed.sync_owner_user_id
    OR v_reviewed.target_strategy IS DISTINCT FROM 'fixed' OR v_new.target_strategy IS DISTINCT FROM 'fixed'
    OR v_reviewed.column_mappings IS DISTINCT FROM v_new.column_mappings
    OR v_reviewed.duplicate_policy IS DISTINCT FROM v_new.duplicate_policy
    OR jsonb_typeof(v_reviewed.tab_mappings) IS DISTINCT FROM 'array'
    OR jsonb_typeof(v_new.tab_mappings) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(v_reviewed.tab_mappings)<>1 OR jsonb_array_length(v_new.tab_mappings)<>1 THEN RETURN false; END IF;
  v_before:=v_reviewed.tab_mappings->0; v_after:=v_new.tab_mappings->0;
  SELECT graduation_year INTO v_year FROM plugin_data.csf_cohorts
    WHERE organization_id=p_organization_id AND id=v_new.cohort_id;
  IF v_year IS NULL OR jsonb_typeof(v_before) IS DISTINCT FROM 'object' OR jsonb_typeof(v_after) IS DISTINCT FROM 'object'
    OR coalesce(v_before->>'tabName','') !~ '^[FS][0-9]{2}$'
    OR coalesce(v_after->>'tabName','') !~ '^[FS][0-9]{2}$'
    OR v_before->>'termCode' IS DISTINCT FROM v_before->>'tabName'
    OR v_after->>'termCode' IS DISTINCT FROM v_after->>'tabName'
    OR v_before->>'cohortYear' IS DISTINCT FROM v_year::text
    OR v_after->>'cohortYear' IS DISTINCT FROM v_year::text
    OR v_before->>'targetStrategy' IS DISTINCT FROM 'fixed'
    OR v_after->>'targetStrategy' IS DISTINCT FROM 'fixed' THEN RETURN false; END IF;
  IF (2000+substring(v_after->>'termCode' from 2)::integer) NOT BETWEEN v_year-4 AND v_year
    OR (2000+substring(v_before->>'termCode' from 2)::integer) NOT BETWEEN v_year-4 AND v_year THEN RETURN false; END IF;
  IF (v_after->>'termCode'='F'||right(v_year::text,2)) OR (v_after->>'termCode'='S'||right((v_year-4)::text,2))
    OR (v_before->>'termCode'='F'||right(v_year::text,2)) OR (v_before->>'termCode'='S'||right((v_year-4)::text,2)) THEN RETURN false; END IF;
  IF NOT (starts_with(v_before->>'rangeA1',(v_before->>'tabName')||'!')
      OR starts_with(v_before->>'rangeA1',quote_literal(v_before->>'tabName')||'!'))
    OR NOT (starts_with(v_after->>'rangeA1',(v_after->>'tabName')||'!')
      OR starts_with(v_after->>'rangeA1',quote_literal(v_after->>'tabName')||'!')) THEN RETURN false; END IF;
  IF regexp_match(v_before->>'rangeA1','!([A-Z]+[1-9][0-9]*):([A-Z]+)[1-9][0-9]*$') IS NULL
    OR regexp_match(v_before->>'rangeA1','!([A-Z]+[1-9][0-9]*):([A-Z]+)[1-9][0-9]*$') IS DISTINCT FROM
      regexp_match(v_after->>'rangeA1','!([A-Z]+[1-9][0-9]*):([A-Z]+)[1-9][0-9]*$') THEN RETURN false; END IF;
  RETURN (v_before-ARRAY['tabName','termCode','rangeA1','populationState']) =
    (v_after-ARRAY['tabName','termCode','rangeA1','populationState'])
    AND EXISTS (SELECT 1 FROM plugin_data.csf_class_workbooks w
      WHERE w.organization_id=p_organization_id AND w.cohort_id=v_new.cohort_id
        AND w.drive_file_id=v_new.spreadsheet_id AND w.drive_owner_user_id=v_new.sync_owner_user_id
        AND w.state='linked');
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_class_sheet_layout_matches(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_class_sheet_layout_matches(uuid,uuid,uuid) TO postgres;

ALTER FUNCTION plugin_data.csf_sheet_automatic_update_authorization_current(uuid,uuid)
  RENAME TO csf_sheet_automatic_update_authorization_current_tab_base;
CREATE FUNCTION plugin_data.csf_sheet_automatic_update_authorization_current(p_organization_id uuid,p_authorization_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_auth plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
  v_parent plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
BEGIN
  IF plugin_data.csf_sheet_automatic_update_authorization_current_tab_base(p_organization_id,p_authorization_id) IS DISTINCT FROM true THEN RETURN false; END IF;
  SELECT * INTO STRICT v_auth FROM plugin_data.csf_sheet_automatic_update_authorizations
    WHERE organization_id=p_organization_id AND id=p_authorization_id;
  IF v_auth.parent_authorization_id IS NULL THEN RETURN true; END IF;
  SELECT * INTO v_parent FROM plugin_data.csf_sheet_automatic_update_authorizations
    WHERE organization_id=p_organization_id AND id=v_auth.parent_authorization_id;
  RETURN v_parent.id IS NOT NULL AND v_parent.parent_authorization_id IS NULL
    AND v_parent.include_matching_semester_tabs AND v_parent.generation=v_auth.parent_authorization_generation
    AND v_parent.authorized_by=v_auth.authorized_by AND v_parent.google_owner_user_id=v_auth.google_owner_user_id
    AND plugin_data.csf_sheet_automatic_update_authorization_current_tab_base(p_organization_id,v_parent.id)
    AND plugin_data.csf_class_sheet_layout_matches(p_organization_id,v_parent.source_id,v_auth.source_id);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_automatic_update_authorization_current_tab_base(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_automatic_update_authorization_current_tab_base(uuid,uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_automatic_update_authorization_current(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_automatic_update_authorization_current(uuid,uuid) TO postgres;

ALTER FUNCTION plugin_data.csf_set_sheet_automatic_update_authorization(uuid,uuid,uuid,integer,text,uuid,uuid)
  RENAME TO csf_set_sheet_automatic_update_authorization_tab_base;
CREATE FUNCTION plugin_data.csf_set_sheet_automatic_update_authorization(
  p_organization_id uuid,p_source_id uuid,p_actor_user_id uuid,p_expected_mapping_version integer,
  p_mode text,p_request_id uuid,p_reviewed_preview_job_id uuid,p_include_matching_semester_tabs boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb; v_existing plugin_data.csf_admin_audit_events%ROWTYPE; v_scope jsonb;
BEGIN
  IF p_include_matching_semester_tabs IS NULL THEN RAISE EXCEPTION 'Choose the Sheet update scope.' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_assert_import_actor_for_source(p_organization_id,p_actor_user_id,p_source_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('csf_source_auto:'||p_organization_id::text||':'||p_source_id::text,0));
  SELECT * INTO v_existing FROM plugin_data.csf_admin_audit_events
    WHERE organization_id=p_organization_id AND action='sheets.automatic_update_authorization_changed'
      AND after_data->>'requestId'=p_request_id::text;
  IF FOUND THEN
    SELECT after_data INTO v_scope FROM plugin_data.csf_admin_audit_events
      WHERE organization_id=p_organization_id AND action='sheets.matching_tab_scope_changed'
        AND after_data->>'requestId'=p_request_id::text;
    IF coalesce((v_scope->>'includeMatchingSemesterTabs')::boolean,false) IS DISTINCT FROM p_include_matching_semester_tabs THEN
      RAISE EXCEPTION 'This request belongs to another Sheet update scope.' USING ERRCODE='22023';
    END IF;
  END IF;
  IF p_include_matching_semester_tabs AND (p_mode<>'enable'
    OR NOT plugin_data.csf_class_sheet_layout_matches(p_organization_id,p_source_id,p_source_id)) THEN
    RAISE EXCEPTION 'Review a canonical class tab before authorizing matching semester tabs.' USING ERRCODE='22023';
  END IF;
  v_result:=plugin_data.csf_set_sheet_automatic_update_authorization_tab_base(
    p_organization_id,p_source_id,p_actor_user_id,p_expected_mapping_version,p_mode,p_request_id,p_reviewed_preview_job_id);
  IF v_result->>'replayed' IS DISTINCT FROM 'true' THEN
    UPDATE plugin_data.csf_sheet_automatic_update_authorizations
      SET include_matching_semester_tabs=p_include_matching_semester_tabs,
        parent_authorization_id=NULL,parent_authorization_generation=NULL
      WHERE organization_id=p_organization_id AND source_id=p_source_id;
    INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data)
    VALUES (p_organization_id,p_actor_user_id,'sheets.matching_tab_scope_changed',
      'csf_sheet_automatic_update_authorizations',(v_result->>'authorizationId')::uuid,
      jsonb_build_object('requestId',p_request_id,'includeMatchingSemesterTabs',p_include_matching_semester_tabs));
  END IF;
  RETURN v_result||jsonb_build_object('includeMatchingSemesterTabs',
    (SELECT include_matching_semester_tabs FROM plugin_data.csf_sheet_automatic_update_authorizations
      WHERE organization_id=p_organization_id AND source_id=p_source_id));
END;
$$;
CREATE FUNCTION plugin_data.csf_set_sheet_automatic_update_authorization(
  p_organization_id uuid,p_source_id uuid,p_actor_user_id uuid,p_expected_mapping_version integer,
  p_mode text,p_request_id uuid,p_reviewed_preview_job_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT plugin_data.csf_set_sheet_automatic_update_authorization(p_organization_id,p_source_id,p_actor_user_id,
    p_expected_mapping_version,p_mode,p_request_id,p_reviewed_preview_job_id,false);
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_set_sheet_automatic_update_authorization_tab_base(uuid,uuid,uuid,integer,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_sheet_automatic_update_authorization_tab_base(uuid,uuid,uuid,integer,text,uuid,uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_set_sheet_automatic_update_authorization(uuid,uuid,uuid,integer,text,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_sheet_automatic_update_authorization(uuid,uuid,uuid,integer,text,uuid,uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_set_sheet_automatic_update_authorization(uuid,uuid,uuid,integer,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_sheet_automatic_update_authorization(uuid,uuid,uuid,integer,text,uuid,uuid) TO service_role;

CREATE FUNCTION plugin_data.csf_inherit_matching_class_tab_authorization(p_organization_id uuid,p_source_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_parent plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
  v_child plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM pg_advisory_xact_lock(hashtextextended('csf_source_auto:'||p_organization_id::text||':'||p_source_id::text,0));
  SELECT * INTO v_child FROM plugin_data.csf_sheet_automatic_update_authorizations
    WHERE organization_id=p_organization_id AND source_id=p_source_id;
  IF FOUND THEN
    RETURN jsonb_build_object('inherited',false,'reason','existing_authorization');
  END IF;
  SELECT * INTO v_source FROM plugin_data.csf_sheet_sources
    WHERE organization_id=p_organization_id AND id=p_source_id FOR UPDATE;
  IF NOT FOUND OR v_source.source_type IS DISTINCT FROM 'class_history'
    OR v_source.sync_mode='disabled' OR coalesce(v_source.settings->>'mappingVersion','') !~ '^[1-9][0-9]{0,8}$' THEN
    RETURN jsonb_build_object('inherited',false,'reason','source_not_eligible');
  END IF;
  SELECT * INTO v_parent FROM plugin_data.csf_sheet_automatic_update_authorizations a
    WHERE a.organization_id=p_organization_id AND a.source_type='class_history'
      AND a.source_file_id=v_source.spreadsheet_id AND a.google_owner_user_id=v_source.sync_owner_user_id
      AND a.include_matching_semester_tabs AND a.parent_authorization_id IS NULL
      AND plugin_data.csf_sheet_automatic_update_authorization_current(p_organization_id,a.id)
      AND plugin_data.csf_class_sheet_layout_matches(p_organization_id,a.source_id,p_source_id)
    ORDER BY a.updated_at DESC,a.id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('inherited',false,'reason','mapping_review_required'); END IF;
  INSERT INTO plugin_data.csf_sheet_automatic_update_authorizations
    (organization_id,source_id,source_file_id,source_type,authorized_by,google_owner_user_id,
      mapping_version,mapping_hash,reviewed_preview_job_id,approved_header_signature,status,
      parent_authorization_id,parent_authorization_generation)
  VALUES(p_organization_id,p_source_id,v_parent.source_file_id,'class_history',v_parent.authorized_by,
    v_parent.google_owner_user_id,(v_source.settings->>'mappingVersion')::integer,
    plugin_data.csf_sheet_automatic_update_mapping_hash(p_source_id,p_organization_id),
    v_parent.reviewed_preview_job_id,v_parent.approved_header_signature,'active',v_parent.id,v_parent.generation)
  RETURNING * INTO v_child;
  INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data)
  VALUES(p_organization_id,v_parent.authorized_by,'sheets.matching_tab_authorization_inherited',
    'csf_sheet_automatic_update_authorizations',v_child.id,
    jsonb_build_object('parentAuthorizationId',v_parent.id,'parentGeneration',v_parent.generation,
      'sourceId',p_source_id,'mappingVersion',v_child.mapping_version,'mappingHash',v_child.mapping_hash));
  RETURN jsonb_build_object('inherited',true,'authorizationId',v_child.id);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_inherit_matching_class_tab_authorization(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_inherit_matching_class_tab_authorization(uuid,uuid) TO service_role;
COMMIT;
