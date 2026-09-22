-- Avoid constructing full history snapshots for unrelated class exports.
CREATE OR REPLACE FUNCTION plugin_data.csf_sheet_sync_destination_snapshot_with_discussions(p_organization_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE; b plugin_data.csf_sheet_sync_bindings%ROWTYPE; r jsonb; profile uuid; exists_record boolean;
BEGIN
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 IF (d.kind='applications' AND p_record_kind<>'application') OR (d.kind='point_submissions' AND p_record_kind<>'point_submission') OR (d.kind='class' AND p_record_kind<>'profile') THEN RAISE EXCEPTION 'Record kind does not match this destination.'; END IF;
 SELECT * INTO b FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id;
 exists_record:=CASE p_record_kind WHEN 'profile' THEN EXISTS(SELECT 1 FROM plugin_data.csf_profiles WHERE organization_id=p_organization_id AND id=p_record_id) WHEN 'application' THEN EXISTS(SELECT 1 FROM plugin_data.csf_term_applications WHERE organization_id=p_organization_id AND id=p_record_id) ELSE EXISTS(SELECT 1 FROM plugin_data.csf_point_submissions WHERE organization_id=p_organization_id AND id=p_record_id) END;
 IF exists_record AND (d.kind<>'class' OR EXISTS(SELECT 1 FROM plugin_data.csf_cohort_terms WHERE organization_id=p_organization_id AND cohort_id=d.cohort_id AND term_id=d.term_id)) THEN
  -- Resolve scope before loading evidence and historical records.
  IF p_record_kind='profile' THEN
   r:=jsonb_build_object('id',p_record_id);
  ELSIF p_record_kind='application' THEN
   SELECT jsonb_build_object('profile_id',a.profile_id,'cohort_id',a.cohort_id,'term_id',a.term_id) INTO r
   FROM plugin_data.csf_term_applications a WHERE a.organization_id=p_organization_id AND a.id=p_record_id;
  ELSE
   SELECT jsonb_build_object('profile_id',s.profile_id,'term_id',s.term_id) INTO r
   FROM plugin_data.csf_point_submissions s WHERE s.organization_id=p_organization_id AND s.id=p_record_id;
  END IF;
  profile:=CASE WHEN p_record_kind='profile' THEN p_record_id ELSE (r->>'profile_id')::uuid END;
  IF NOT ((p_record_kind='application' AND d.cohort_id IS NOT NULL AND (r->>'cohort_id')::uuid IS DISTINCT FROM d.cohort_id) OR (p_record_kind<>'profile' AND (r->>'term_id')::uuid IS DISTINCT FROM d.term_id) OR (d.cohort_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_profile_cohort_memberships WHERE organization_id=p_organization_id AND profile_id=profile AND cohort_id=d.cohort_id AND status='active'))) THEN
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
  END IF;
 END IF;
 IF b.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('id',p_record_id,'organization_id',p_organization_id,'record_kind',p_record_kind,'destination_id',p_destination_id,'out_of_scope',true,'scope_revision',b.scope_revision);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_sync_destination_snapshot_with_discussions(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_sync_destination_snapshot_with_discussions(uuid,uuid,text,uuid) TO postgres;

-- Queue the exact snapshot already constructed by the change trigger.
CREATE FUNCTION plugin_data.csf_queue_sheet_sync_snapshot_internal(p_organization_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid,p_snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE; r jsonb:=p_snapshot; v text; l plugin_data.csf_sheet_writeback_ledger%ROWTYPE; profile uuid;
BEGIN
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE id=p_destination_id AND organization_id=p_organization_id;
 IF NOT FOUND OR NOT d.enabled THEN RAISE EXCEPTION 'Sync destination is disabled.'; END IF;
 IF r IS NULL THEN RAISE EXCEPTION 'Record is outside this destination.'; END IF;
 profile:=CASE WHEN p_record_kind='profile' THEN p_record_id ELSE (r->>'profile_id')::uuid END;
 v:=md5(r::text);
 INSERT INTO plugin_data.csf_sheet_sync_bindings(organization_id,destination_id,record_kind,record_id,profile_id,logical_key,sheet_id) VALUES(p_organization_id,d.id,p_record_kind,p_record_id,profile,p_record_kind||':'||p_record_id::text,d.sheet_id) ON CONFLICT(destination_id,record_kind,record_id) DO NOTHING;
 UPDATE plugin_data.csf_sheet_sync_bindings SET profile_id=profile WHERE organization_id=p_organization_id AND destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND profile IS NOT NULL AND profile_id IS DISTINCT FROM profile;
 INSERT INTO plugin_data.csf_sheet_writeback_ledger(organization_id,spreadsheet_file_id,sheet_tab,status,destination_id,record_kind,record_id,source_version,payload)
 VALUES(p_organization_id,d.spreadsheet_file_id,NULL,'pending_export',d.id,p_record_kind,p_record_id,v,r)
 ON CONFLICT(destination_id,record_kind,record_id,source_version) WHERE destination_id IS NOT NULL DO NOTHING RETURNING * INTO l;
 IF l.id IS NULL THEN SELECT * INTO l FROM plugin_data.csf_sheet_writeback_ledger WHERE destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND source_version=v; END IF;
 RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION plugin_data.csf_queue_sheet_sync_snapshot_internal(uuid,uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_sheet_sync_snapshot_internal(uuid,uuid,text,uuid,jsonb) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row jsonb:=CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END; new_row jsonb:=CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END; r jsonb; targets jsonb:='[]'; k text; rid uuid; org uuid; profile uuid; changed_term uuid; target record; d record;
BEGIN
 IF TG_TABLE_NAME='csf_sheet_sync_local_messages' THEN
  FOR target IN SELECT b.* FROM plugin_data.csf_sheet_sync_bindings b WHERE EXISTS(SELECT 1 FROM unnest(ARRAY[old_row,new_row]) x WHERE x IS NOT NULL AND b.organization_id=(x->>'organization_id')::uuid AND b.id=(x->>'binding_id')::uuid) AND EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations sd WHERE sd.organization_id=b.organization_id AND sd.id=b.destination_id AND sd.discussion_transport<>'none') ORDER BY b.id FOR NO KEY UPDATE LOOP
   UPDATE plugin_data.csf_sheet_sync_bindings SET scope_revision=scope_revision+1 WHERE id=target.id;
   IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations WHERE id=target.destination_id AND organization_id=target.organization_id AND enabled AND discussion_transport<>'none') THEN
    PERFORM plugin_data.csf_queue_sheet_sync_record_internal(target.organization_id,target.destination_id,target.record_kind,target.record_id);
   END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END IF;
 FOR r IN SELECT DISTINCT x FROM unnest(ARRAY[old_row,new_row]) x WHERE x IS NOT NULL LOOP
  org:=(r->>'organization_id')::uuid; profile:=NULL; k:=NULL; rid:=NULL; changed_term:=(r->>'term_id')::uuid;
  IF TG_TABLE_NAME IN ('csf_term_applications','csf_point_submissions') THEN k:=CASE WHEN TG_TABLE_NAME='csf_term_applications' THEN 'application' ELSE 'point_submission' END; rid:=(r->>'id')::uuid;
  ELSIF TG_TABLE_NAME IN ('csf_application_files','csf_application_status_events') THEN k:='application';rid:=(r->>'application_id')::uuid;
  ELSIF TG_TABLE_NAME IN ('csf_submission_files','csf_submission_reviews') OR (TG_TABLE_NAME='csf_credit_records' AND r->>'submission_id' IS NOT NULL) THEN k:='point_submission';rid:=(r->>'submission_id')::uuid;
  ELSIF TG_TABLE_NAME='csf_review_notes' THEN
   IF r->>'subject_kind' NOT IN ('application','profile') THEN CONTINUE; END IF;
   k:=r->>'subject_kind';rid:=(r->>'subject_id')::uuid; IF k='profile' THEN changed_term:=NULL; END IF;
  ELSIF TG_TABLE_NAME='csf_sheet_sync_local_messages' THEN
   SELECT record_kind,record_id INTO k,rid FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=org AND id=(r->>'binding_id')::uuid;
  ELSE k:='profile';rid:=CASE WHEN TG_TABLE_NAME='csf_profiles' THEN (r->>'id')::uuid ELSE (r->>'profile_id')::uuid END; END IF;
  IF changed_term IS NULL AND k='application' THEN SELECT term_id INTO changed_term FROM plugin_data.csf_term_applications WHERE organization_id=org AND id=rid; ELSIF changed_term IS NULL AND k='point_submission' THEN SELECT term_id INTO changed_term FROM plugin_data.csf_point_submissions WHERE organization_id=org AND id=rid; END IF;
  IF changed_term IS NULL AND k IN ('application','point_submission') AND TG_TABLE_NAME NOT IN ('csf_term_applications','csf_point_submissions') THEN CONTINUE; END IF;
  profile:=CASE WHEN k='profile' THEN rid ELSE (r->>'profile_id')::uuid END;
  IF k IS NOT NULL AND rid IS NOT NULL THEN targets:=targets||jsonb_build_array(jsonb_build_object('org',org,'term',changed_term,'kind',k,'id',rid)); END IF;
  IF profile IS NOT NULL AND k<>'profile' THEN targets:=targets||jsonb_build_array(jsonb_build_object('org',org,'term',changed_term,'kind','profile','id',profile)); END IF;
  IF profile IS NOT NULL AND TG_TABLE_NAME IN ('csf_profiles','csf_meeting_attendance','csf_credit_records') THEN
   targets:=targets||coalesce((SELECT jsonb_agg(jsonb_build_object('org',org,'term',changed_term,'kind','application','id',a.id)) FROM plugin_data.csf_term_applications a WHERE a.organization_id=org AND a.profile_id=profile AND (changed_term IS NULL OR a.term_id=changed_term)),'[]'::jsonb)
    ||coalesce((SELECT jsonb_agg(jsonb_build_object('org',org,'term',changed_term,'kind','point_submission','id',p.id)) FROM plugin_data.csf_point_submissions p WHERE p.organization_id=org AND p.profile_id=profile AND (changed_term IS NULL OR p.term_id=changed_term)),'[]'::jsonb)
    ||coalesce((SELECT jsonb_agg(jsonb_build_object('org',org,'term',changed_term,'kind',b.record_kind,'id',b.record_id)) FROM plugin_data.csf_sheet_sync_bindings b WHERE b.organization_id=org AND b.profile_id=profile AND (changed_term IS NULL OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations sd WHERE sd.id=b.destination_id AND (sd.term_id IS NULL OR sd.term_id=changed_term)))),'[]'::jsonb);
  END IF;
 END LOOP;
 PERFORM b.id FROM plugin_data.csf_sheet_sync_bindings b WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(targets) x WHERE b.organization_id=(x->>'org')::uuid AND b.record_kind=x->>'kind' AND b.record_id=(x->>'id')::uuid AND (x->>'term' IS NULL OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations sd WHERE sd.id=b.destination_id AND (sd.term_id IS NULL OR sd.term_id=(x->>'term')::uuid)))) ORDER BY b.id FOR NO KEY UPDATE;
 FOR target IN SELECT DISTINCT (x->>'org')::uuid org,x->>'kind' kind,(x->>'id')::uuid id,(x->>'term')::uuid term FROM jsonb_array_elements(targets) x ORDER BY org,kind,id,term LOOP
  UPDATE plugin_data.csf_sheet_sync_bindings SET scope_revision=scope_revision+1 WHERE organization_id=target.org AND record_kind=target.kind AND record_id=target.id AND (target.term IS NULL OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations sd WHERE sd.id=destination_id AND (sd.term_id IS NULL OR sd.term_id=target.term))) AND (TG_TABLE_NAME<>'csf_review_notes' OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations sd WHERE sd.id=destination_id AND sd.discussion_transport<>'none'));
  FOR d IN SELECT * FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=target.org AND enabled AND (TG_TABLE_NAME<>'csf_review_notes' OR discussion_transport<>'none') AND (target.term IS NULL OR term_id IS NULL OR term_id=target.term) AND ((target.kind='application' AND kind='applications') OR (target.kind='point_submission' AND kind='point_submissions') OR (target.kind='profile' AND kind='class')) LOOP
   r:=plugin_data.csf_sheet_sync_destination_snapshot(target.org,d.id,target.kind,target.id);
   IF r IS NOT NULL THEN
    PERFORM plugin_data.csf_queue_sheet_sync_snapshot_internal(target.org,d.id,target.kind,target.id,r);
   END IF;
  END LOOP;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_changed_sheet_sync_record() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_changed_sheet_sync_record() TO postgres;

