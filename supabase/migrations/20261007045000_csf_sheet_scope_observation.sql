-- Observe destination scope without loading evidence, history, or export payloads.
BEGIN;
CREATE FUNCTION plugin_data.csf_sheet_sync_scope_statuses_internal(
 p_organization_id uuid, p_destination plugin_data.csf_sheet_sync_destinations, p_records jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations := p_destination; p_destination_id uuid := p_destination.id;
 result jsonb; class_is_configured boolean;
BEGIN
 IF jsonb_typeof(p_records) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Sheet scope records must be an array.' USING ERRCODE = '22023';
 END IF;
 IF jsonb_array_length(p_records) NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Sheet scope batches must contain 1 to 100 records.' USING ERRCODE = '22023';
 END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_records) item WHERE
  jsonb_typeof(item) IS DISTINCT FROM 'object' OR item - ARRAY['record_kind','record_id'] <> '{}'::jsonb
  OR jsonb_typeof(item->'record_kind') IS DISTINCT FROM 'string'
  OR jsonb_typeof(item->'record_id') IS DISTINCT FROM 'string'
  OR item->>'record_kind' NOT IN ('application','point_submission','profile')) THEN
  RAISE EXCEPTION 'Sheet scope record is invalid.' USING ERRCODE = '22023';
 END IF;
 IF d.id IS NULL OR d.organization_id IS DISTINCT FROM p_organization_id THEN
  RAISE EXCEPTION 'Destination not found.';
 END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_records) item WHERE
  (d.kind='applications' AND item->>'record_kind'<>'application')
  OR (d.kind='point_submissions' AND item->>'record_kind'<>'point_submission')
  OR (d.kind='class' AND item->>'record_kind'<>'profile')) THEN
  RAISE EXCEPTION 'Record kind does not match this destination.';
 END IF;
 class_is_configured := d.kind <> 'class' OR EXISTS (SELECT 1 FROM plugin_data.csf_cohort_terms
  WHERE organization_id=p_organization_id AND cohort_id=d.cohort_id AND term_id=d.term_id);

 WITH requested AS (
  SELECT ordinal, item->>'record_kind' AS kind, (item->>'record_id')::uuid AS id
  FROM jsonb_array_elements(p_records) WITH ORDINALITY AS items(item, ordinal)
 ), observed AS (
  SELECT requested.*, b.id AS binding_id, b.scope_revision,
   (p.id IS NOT NULL OR a.id IS NOT NULL OR s.id IS NOT NULL) AND class_is_configured
   AND (requested.kind <> 'application' OR d.cohort_id IS NULL OR a.cohort_id IS NOT DISTINCT FROM d.cohort_id)
   AND (requested.kind = 'profile' OR coalesce(a.term_id,s.term_id) IS NOT DISTINCT FROM d.term_id)
   AND (d.cohort_id IS NULL OR EXISTS (SELECT 1 FROM plugin_data.csf_profile_cohort_memberships m
    WHERE m.organization_id=p_organization_id AND m.profile_id=coalesce(p.id,a.profile_id,s.profile_id)
     AND m.cohort_id=d.cohort_id AND m.status='active')) AS in_scope
  FROM requested
  LEFT JOIN plugin_data.csf_profiles p ON requested.kind='profile' AND p.organization_id=p_organization_id AND p.id=requested.id
  LEFT JOIN plugin_data.csf_term_applications a ON requested.kind='application' AND a.organization_id=p_organization_id AND a.id=requested.id
  LEFT JOIN plugin_data.csf_point_submissions s ON requested.kind='point_submission' AND s.organization_id=p_organization_id AND s.id=requested.id
  LEFT JOIN plugin_data.csf_sheet_sync_bindings b ON b.organization_id=p_organization_id AND b.destination_id=d.id
   AND b.record_kind=requested.kind AND b.record_id=requested.id
 ) SELECT jsonb_agg(jsonb_build_object('organization_id',p_organization_id,'destination_id',p_destination_id,
   'record_kind',kind,'record_id',id,'state',CASE WHEN in_scope THEN 'in_scope'
    WHEN binding_id IS NOT NULL THEN 'out_of_scope' ELSE 'unavailable' END,
   'scope_revision',CASE WHEN in_scope THEN coalesce(scope_revision,0)
    WHEN binding_id IS NOT NULL THEN scope_revision ELSE NULL END) ORDER BY ordinal)
 INTO result FROM observed;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_sync_scope_statuses_internal(uuid,plugin_data.csf_sheet_sync_destinations,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_sync_scope_statuses_internal(uuid,plugin_data.csf_sheet_sync_destinations,jsonb) TO postgres;

CREATE FUNCTION plugin_data.csf_sheet_sync_scope_statuses(p_organization_id uuid,p_destination_id uuid,p_records jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 RETURN plugin_data.csf_sheet_sync_scope_statuses_internal(p_organization_id,d,p_records);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_sync_scope_statuses(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_sync_scope_statuses(uuid,uuid,jsonb) TO service_role;

-- Full exports use the same scope decision as the lightweight worker observation.
CREATE OR REPLACE FUNCTION plugin_data.csf_sheet_sync_destination_snapshot_with_discussions(p_organization_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE; b plugin_data.csf_sheet_sync_bindings%ROWTYPE; r jsonb; profile uuid; scope jsonb;
BEGIN
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 scope := plugin_data.csf_sheet_sync_scope_statuses_internal(p_organization_id,d,
  jsonb_build_array(jsonb_build_object('record_kind',p_record_kind,'record_id',p_record_id)))->0;
 IF scope->>'state'='unavailable' THEN RETURN NULL; END IF;
 IF scope->>'state'='out_of_scope' THEN
  RETURN jsonb_build_object('id',p_record_id,'organization_id',p_organization_id,'record_kind',p_record_kind,
   'destination_id',p_destination_id,'out_of_scope',true,'scope_revision',scope->'scope_revision');
 END IF;
 SELECT * INTO b FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id;
 profile := CASE WHEN p_record_kind='profile' THEN p_record_id
  WHEN p_record_kind='application' THEN (SELECT profile_id FROM plugin_data.csf_term_applications WHERE organization_id=p_organization_id AND id=p_record_id)
  ELSE (SELECT profile_id FROM plugin_data.csf_point_submissions WHERE organization_id=p_organization_id AND id=p_record_id) END;
   r:=plugin_data.csf_sheet_sync_snapshot(p_organization_id,p_record_kind,p_record_id);
   IF p_record_kind='profile' THEN
    r:=r||jsonb_build_object('comments','[]'::jsonb);
    r:=r||jsonb_build_object('applications',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM jsonb_array_elements(r->'applications') x WHERE x->>'term_id'=d.term_id::text),'[]'::jsonb),'credits',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM jsonb_array_elements(r->'credits') x WHERE x->>'term_id'=d.term_id::text),'[]'::jsonb),'memberships',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM jsonb_array_elements(r->'memberships') x WHERE x->>'term_id'=d.term_id::text),'[]'::jsonb));
   END IF;
   RETURN r||jsonb_build_object('scope_revision',coalesce(b.scope_revision,0),
    'local_messages',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM plugin_data.csf_sheet_sync_local_messages m WHERE m.organization_id=p_organization_id AND m.destination_id=d.id AND m.binding_id=b.id),'[]'::jsonb),
    'projection_profile',(SELECT jsonb_build_object('first_name',p.first_name,'last_name',p.last_name) FROM plugin_data.csf_profiles p WHERE p.organization_id=p_organization_id AND p.id=profile),
    'projection_policy',(SELECT to_jsonb(p) FROM plugin_data.csf_term_policies p WHERE p.organization_id=p_organization_id AND p.term_id=d.term_id),
    'projection_attendance',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM plugin_data.csf_meeting_attendance a
     LEFT JOIN plugin_data.csf_meetings m ON m.organization_id=a.organization_id AND m.term_id=a.term_id AND (m.id=a.meeting_id OR (a.meeting_id IS NULL AND m.meeting_key=a.meeting_key))
     LEFT JOIN plugin_data.csf_term_meetings lm ON lm.organization_id=a.organization_id AND lm.term_id=a.term_id AND lm.id=a.term_meeting_id
     LEFT JOIN plugin_data.csf_meeting_sessions ms ON ms.organization_id=a.organization_id AND ms.id=a.meeting_session_id AND ms.meeting_id=m.id
     WHERE a.organization_id=p_organization_id AND a.profile_id=profile AND a.term_id=d.term_id AND coalesce(m.required,lm.required,false) AND coalesce(m.status,lm.status)='active' AND (a.meeting_session_id IS NULL OR (ms.id IS NOT NULL AND ms.status NOT IN ('cancelled','archived')))),'[]'::jsonb),
    'projection_credits',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM plugin_data.csf_credit_records c WHERE c.organization_id=p_organization_id AND c.profile_id=profile AND c.term_id=d.term_id AND c.status='verified' AND (p_record_kind<>'point_submission' OR c.submission_id=p_record_id)),'[]'::jsonb),
    'projection_evidence',coalesce((SELECT jsonb_agg(jsonb_build_object('source_url',f.source_url,'drive_file_id',f.drive_file_id) ORDER BY f.id) FROM plugin_data.csf_application_files f WHERE p_record_kind='application' AND f.organization_id=p_organization_id AND f.application_id=p_record_id),'[]'::jsonb),
    'projection_meetings',coalesce((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('sessions',coalesce((SELECT jsonb_agg(to_jsonb(ms) ORDER BY ms.id) FROM plugin_data.csf_meeting_sessions ms WHERE ms.organization_id=p_organization_id AND ms.meeting_id=m.id),'[]'::jsonb)) ORDER BY m.id) FROM plugin_data.csf_meetings m WHERE m.organization_id=p_organization_id AND m.term_id=d.term_id),'[]'::jsonb));

END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_sync_destination_snapshot_with_discussions(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_sync_destination_snapshot_with_discussions(uuid,uuid,text,uuid) TO postgres;
COMMIT;
