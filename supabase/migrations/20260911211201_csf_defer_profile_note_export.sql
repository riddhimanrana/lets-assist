CREATE OR REPLACE FUNCTION plugin_data.csf_sheet_sync_destination_snapshot(p_organization_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE; b plugin_data.csf_sheet_sync_bindings%ROWTYPE; r jsonb; profile uuid; exists_record boolean;
BEGIN
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 IF (d.kind='applications' AND p_record_kind<>'application') OR (d.kind='point_submissions' AND p_record_kind<>'point_submission') OR (d.kind='class' AND p_record_kind<>'profile') THEN RAISE EXCEPTION 'Record kind does not match this destination.'; END IF;
 SELECT * INTO b FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id;
 exists_record:=CASE p_record_kind WHEN 'profile' THEN EXISTS(SELECT 1 FROM plugin_data.csf_profiles WHERE organization_id=p_organization_id AND id=p_record_id) WHEN 'application' THEN EXISTS(SELECT 1 FROM plugin_data.csf_term_applications WHERE organization_id=p_organization_id AND id=p_record_id) ELSE EXISTS(SELECT 1 FROM plugin_data.csf_point_submissions WHERE organization_id=p_organization_id AND id=p_record_id) END;
 IF exists_record AND (d.kind<>'class' OR EXISTS(SELECT 1 FROM plugin_data.csf_cohort_terms WHERE organization_id=p_organization_id AND cohort_id=d.cohort_id AND term_id=d.term_id)) THEN
  r:=plugin_data.csf_sheet_sync_snapshot(p_organization_id,p_record_kind,p_record_id);
  profile:=CASE WHEN p_record_kind='profile' THEN p_record_id ELSE (r->>'profile_id')::uuid END;
  IF NOT ((p_record_kind='application' AND d.cohort_id IS NOT NULL AND (r->>'cohort_id')::uuid IS DISTINCT FROM d.cohort_id) OR (p_record_kind<>'profile' AND (r->>'term_id')::uuid IS DISTINCT FROM d.term_id) OR (d.cohort_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_profile_cohort_memberships WHERE organization_id=p_organization_id AND profile_id=profile AND cohort_id=d.cohort_id AND status='active'))) THEN
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
  END IF;
 END IF;
 IF b.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('id',p_record_id,'organization_id',p_organization_id,'record_kind',p_record_kind,'destination_id',p_destination_id,'out_of_scope',true,'scope_revision',b.scope_revision);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_sync_destination_snapshot(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_sync_destination_snapshot(uuid,uuid,text,uuid) TO service_role;
