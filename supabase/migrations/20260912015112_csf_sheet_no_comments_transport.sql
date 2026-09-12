-- Add a mode that keeps discussions in Let's Assist and leaves Sheet comments untouched.
ALTER TABLE plugin_data.csf_sheet_sync_destinations
 DROP CONSTRAINT csf_sheet_sync_destinations_discussion_transport_check,
 DROP CONSTRAINT csf_sheet_discussion_column,
 ADD CONSTRAINT csf_sheet_sync_destinations_discussion_transport_check CHECK(discussion_transport IN ('none','native','column')),
 ADD CONSTRAINT csf_sheet_discussion_column CHECK(
   (discussion_transport<>'column' OR managed_headers @> '["Comments"]'::jsonb)
   AND (discussion_transport<>'none' OR NOT managed_headers @> '["Comments"]'::jsonb)
 );

CREATE OR REPLACE FUNCTION plugin_data.csf_sheet_discussion_configuration(p_destination_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN discussion_transport='native' THEN '{}'::jsonb ELSE jsonb_build_object('discussion_transport',discussion_transport) END
 FROM plugin_data.csf_sheet_sync_destinations WHERE id=p_destination_id
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_discussion_configuration(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_configure_sheet_discussion_transport(p_organization_id uuid,p_actor_user_id uuid,p_destination_id uuid,p_transport text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE; comment_columns integer;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('csf-sheet-destination:'||d.spreadsheet_file_id,0));
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id FOR NO KEY UPDATE;
 SELECT count(*) INTO comment_columns FROM jsonb_array_elements_text(d.managed_headers) h WHERE h='Comments';
 IF p_transport IS NULL OR p_transport NOT IN ('none','native','column') OR (p_transport='column' AND comment_columns<>1) OR (p_transport='none' AND comment_columns<>0) THEN RAISE EXCEPTION 'The discussion mode does not match the managed Comments columns.'; END IF;
 IF d.discussion_transport=p_transport THEN RETURN to_jsonb(d); END IF;
 IF d.enabled OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_bindings WHERE destination_id=d.id) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_acceptances WHERE destination_id=d.id) THEN RAISE EXCEPTION 'Create a new destination to change a discussion transport already in use.'; END IF;
 UPDATE plugin_data.csf_sheet_sync_destinations SET discussion_transport=p_transport,comment_capability='pending',privacy_verified_at=NULL,poll_lease_token=NULL,poll_lease_expires_at=NULL,configured_by=p_actor_user_id,updated_at=now() WHERE id=d.id RETURNING * INTO d;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.discussion_configured','sheet_sync_destination',d.id,to_jsonb(d));
 RETURN to_jsonb(d);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_configure_sheet_discussion_transport(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_configure_sheet_discussion_transport(uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION plugin_data.csf_configure_sheet_sync_destination_atomic(
 p_organization_id uuid,p_actor_user_id uuid,p_spreadsheet_file_id text,p_sheet_id integer,p_kind text,p_cohort_id uuid,p_term_id uuid,p_is_test boolean,p_owned_start_column integer,p_managed_headers jsonb,p_discussion_transport text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE configured jsonb; existing_transport text; resolved_transport text;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 PERFORM pg_advisory_xact_lock(hashtextextended('csf-sheet-destination:'||p_spreadsheet_file_id,0));
 SELECT discussion_transport INTO existing_transport FROM plugin_data.csf_sheet_sync_destinations
  WHERE organization_id=p_organization_id AND spreadsheet_file_id=p_spreadsheet_file_id AND sheet_id=p_sheet_id;
 resolved_transport:=coalesce(p_discussion_transport,existing_transport,'none');
 configured:=plugin_data.csf_configure_sheet_sync_destination(p_organization_id,p_actor_user_id,p_spreadsheet_file_id,p_sheet_id,p_kind,p_cohort_id,p_term_id,p_is_test,p_owned_start_column,p_managed_headers);
 IF configured->>'discussion_transport' IS DISTINCT FROM resolved_transport THEN
  configured:=plugin_data.csf_configure_sheet_discussion_transport(p_organization_id,p_actor_user_id,(configured->>'id')::uuid,resolved_transport);
 END IF;
 RETURN configured;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_configure_sheet_sync_destination_atomic(uuid,uuid,text,integer,text,uuid,uuid,boolean,integer,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_configure_sheet_sync_destination_atomic(uuid,uuid,text,integer,text,uuid,uuid,boolean,integer,jsonb,text) TO service_role;

ALTER FUNCTION plugin_data.csf_sheet_sync_destination_snapshot(uuid,uuid,text,uuid)
 RENAME TO csf_sheet_sync_destination_snapshot_with_discussions;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_sync_destination_snapshot_with_discussions(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION plugin_data.csf_sheet_sync_destination_snapshot(p_organization_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb; transport text;
BEGIN
 snapshot:=plugin_data.csf_sheet_sync_destination_snapshot_with_discussions(p_organization_id,p_destination_id,p_record_kind,p_record_id);
 IF snapshot IS NULL OR coalesce((snapshot->>'out_of_scope')::boolean,false) THEN RETURN snapshot; END IF;
 SELECT discussion_transport INTO transport FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id;
 IF transport='none' THEN RETURN snapshot-ARRAY['comments','local_messages']; END IF;
 RETURN snapshot;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_sync_destination_snapshot(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_sync_destination_snapshot(uuid,uuid,text,uuid) TO service_role;


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
   IF plugin_data.csf_sheet_sync_destination_snapshot(target.org,d.id,target.kind,target.id) IS NOT NULL THEN
    PERFORM plugin_data.csf_queue_sheet_sync_record_internal(target.org,d.id,target.kind,target.id);
   END IF;
  END LOOP;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_changed_sheet_sync_record() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_changed_sheet_sync_record() TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_record_sheet_sync_acceptance(p_organization_id uuid,p_actor_user_id uuid,p_destination_id uuid,p_test_destination_ids uuid[],p_evidence jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE; td plugin_data.csf_sheet_sync_destinations%ROWTYPE; test_org uuid; a plugin_data.csf_sheet_sync_acceptances%ROWTYPE; config_snapshot jsonb; x uuid; kinds text[]; export_ids uuid[]; change_ids uuid[]; comment_ids uuid[]; test_configurations jsonb; saved_evidence jsonb;
BEGIN
 IF cardinality(p_test_destination_ids) IS DISTINCT FROM 3 OR (SELECT count(DISTINCT v) FROM unnest(p_test_destination_ids) v)<>3 THEN RAISE EXCEPTION 'Choose the three copied-workbook test destinations.'; END IF;
 SELECT organization_id INTO test_org FROM plugin_data.csf_sheet_sync_destinations WHERE id=p_test_destination_ids[1] AND is_test;
 IF test_org IS NULL OR test_org=p_organization_id THEN RAISE EXCEPTION 'Choose an isolated copied-workbook test workspace.'; END IF;
 PERFORM pg_advisory_xact_lock(k) FROM (SELECT DISTINCT plugin_data.csf_staff_access_lock_key(v) k FROM unnest(ARRAY[p_organization_id,test_org]) v ORDER BY k) locks;
 FOREACH x IN ARRAY ARRAY[p_organization_id,test_org] LOOP
  IF NOT (plugin_data.csf_actor_has_permission(x,p_actor_user_id,'manage_settings') AND plugin_data.csf_actor_has_permission(x,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(x,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 END LOOP;
 PERFORM 1 FROM plugin_data.csf_sheet_sync_destinations WHERE id=ANY(p_test_destination_ids||p_destination_id) ORDER BY id FOR NO KEY UPDATE;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id;
 IF NOT FOUND OR d.is_test OR d.enabled THEN RAISE EXCEPTION 'Turn off the live destination before recording test acceptance.'; END IF;
 IF length(btrim(p_reason)) NOT BETWEEN 1 AND 4000 OR p_reason IS NULL OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' OR length(p_evidence->>'observations') NOT BETWEEN 20 AND 10000 OR p_evidence->>'observations' IS NULL OR jsonb_typeof(p_evidence->'provider_versions') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Record the inspected test evidence and review reason.'; END IF;
 IF jsonb_typeof(p_evidence->'export_ids') IS DISTINCT FROM 'array' OR jsonb_typeof(p_evidence->'change_ids') IS DISTINCT FROM 'array' OR jsonb_typeof(p_evidence->'comment_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Supply persisted export, decision and comment receipt IDs.'; END IF;
 SELECT array_agg(v::uuid) INTO export_ids FROM jsonb_array_elements_text(p_evidence->'export_ids') v;
 SELECT array_agg(v::uuid) INTO change_ids FROM jsonb_array_elements_text(p_evidence->'change_ids') v;
 SELECT array_agg(v::uuid) INTO comment_ids FROM jsonb_array_elements_text(p_evidence->'comment_ids') v;
 IF coalesce(cardinality(export_ids),0)<3 OR coalesce(cardinality(change_ids),0)<6 OR (d.discussion_transport='native' AND coalesce(cardinality(comment_ids),0)<2) THEN RAISE EXCEPTION 'The copied-workbook journey is incomplete.'; END IF;
 PERFORM 1 FROM plugin_data.csf_cohorts WHERE organization_id IN (p_organization_id,test_org) AND id IN (SELECT cohort_id FROM plugin_data.csf_sheet_sync_destinations WHERE id=ANY(p_test_destination_ids||p_destination_id)) ORDER BY id FOR SHARE;
 PERFORM 1 FROM plugin_data.csf_terms WHERE organization_id IN (p_organization_id,test_org) AND id IN (SELECT term_id FROM plugin_data.csf_sheet_sync_destinations WHERE id=ANY(p_test_destination_ids||p_destination_id)) ORDER BY id FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations t JOIN plugin_data.csf_sheet_sync_test_copy_requests r ON r.copied_file_id=t.spreadsheet_file_id AND r.organization_id=t.organization_id WHERE t.id=ANY(p_test_destination_ids) AND t.organization_id=test_org AND t.kind=d.kind AND t.discussion_transport=d.discussion_transport AND r.source_organization_id=p_organization_id AND r.source_file_id=d.spreadsheet_file_id AND r.state='completed' AND t.owned_start_column=d.owned_start_column AND t.managed_headers=d.managed_headers AND (t.cohort_id IS NULL)=(d.cohort_id IS NULL) AND (t.term_id IS NULL)=(d.term_id IS NULL) AND jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=t.organization_id AND c.id=t.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id))=jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=d.organization_id AND c.id=d.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id))) THEN RAISE EXCEPTION 'The corresponding test destination must use the live columns, class year and semester.'; END IF;
 FOR td IN SELECT * FROM plugin_data.csf_sheet_sync_destinations WHERE id=ANY(p_test_destination_ids) ORDER BY id LOOP
  kinds:=array_append(kinds,td.kind);
  IF td.organization_id<>test_org OR td.discussion_transport<>d.discussion_transport OR NOT td.is_test OR td.comment_capability<>'available' OR td.privacy_verified_at IS NULL OR td.last_synced_at IS NULL OR nullif(p_evidence->'provider_versions'->>td.id::text,'') IS NULL OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_copy_requests r WHERE r.organization_id=test_org AND r.source_organization_id=p_organization_id AND r.copied_file_id=td.spreadsheet_file_id AND r.state='completed' AND r.provider_subject IS NOT NULL) THEN RAISE EXCEPTION 'Test destinations need verified copied-file lineage and provider access.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger l JOIN plugin_data.csf_sheet_sync_bindings b ON b.destination_id=l.destination_id AND b.record_kind=l.record_kind AND b.record_id=l.record_id WHERE l.id=ANY(export_ids) AND l.destination_id=td.id AND l.status='exported' AND l.source_version=b.last_export_version AND l.source_version=md5(plugin_data.csf_sheet_sync_destination_snapshot(test_org,td.id,l.record_kind,l.record_id)::text)) THEN RAISE EXCEPTION 'Each test destination needs a current exported receipt.'; END IF;
  IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger WHERE destination_id=td.id AND status IN ('unknown_outcome','exporting','pending_export','retry_export')) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_changes WHERE destination_id=td.id AND status='pending') THEN RAISE EXCEPTION 'Resolve outstanding copied-workbook changes before acceptance.'; END IF;
 END LOOP;
 IF NOT kinds @> ARRAY['applications','point_submissions','class'] OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_copy_requests r JOIN plugin_data.csf_sheet_sync_destinations t ON t.spreadsheet_file_id=r.copied_file_id AND t.id=ANY(p_test_destination_ids) WHERE r.organization_id=test_org AND r.source_organization_id=p_organization_id AND r.source_file_id=d.spreadsheet_file_id AND r.state='completed' AND t.kind=d.kind) THEN RAISE EXCEPTION 'The test copies do not cover this live destination.'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(export_ids) v WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger l WHERE l.id=v AND l.organization_id=test_org AND l.destination_id=ANY(p_test_destination_ids) AND l.status='exported')) OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger l WHERE l.id=ANY(export_ids) GROUP BY l.destination_id,l.record_kind,l.record_id HAVING count(DISTINCT source_version)>=2) THEN RAISE EXCEPTION 'Repeated sync needs distinct retained export versions.'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(change_ids) v WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_changes c WHERE c.id=v AND c.organization_id=test_org AND c.destination_id=ANY(p_test_destination_ids) AND c.status='accepted' AND c.reviewed_by IS NOT NULL)) OR EXISTS(SELECT 1 FROM unnest(ARRAY['application','point_submission']) k CROSS JOIN unnest(ARRAY['approved','rejected','needs_action']) actions(requested_action) WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_changes c WHERE c.id=ANY(change_ids) AND c.record_kind=k AND c.payload->>'action'=actions.requested_action AND c.status='accepted')) THEN RAISE EXCEPTION 'Approval, rejection and correction need reviewed application and point receipts.'; END IF;
 IF d.discussion_transport='native' THEN
  IF EXISTS(SELECT 1 FROM unnest(comment_ids) v WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_comments c WHERE c.id=v AND c.organization_id=test_org AND c.destination_id=ANY(p_test_destination_ids) AND NOT c.deleted)) OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_comments c WHERE c.id=ANY(comment_ids) GROUP BY c.destination_id,c.provider_thread_id HAVING count(DISTINCT c.provider_message_id)>=2 AND bool_or(c.resolved)) OR jsonb_typeof(p_evidence->'native_receipts') IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence->'native_receipts')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'native_receipts') receipt WHERE nullif(btrim(receipt->>'thread_id'),'') IS NULL OR nullif(btrim(receipt->>'post_id'),'') IS NULL OR nullif(btrim(receipt->>'local_version'),'') IS NULL OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_bindings b WHERE b.id=(receipt->>'binding_id')::uuid AND b.organization_id=test_org AND b.destination_id=ANY(p_test_destination_ids) AND b.thread_bindings->(receipt->>'local_message_id')=jsonb_build_object('threadId',receipt->>'thread_id','postId',receipt->>'post_id','localVersion',receipt->>'local_version') AND EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger l WHERE l.id=ANY(export_ids) AND l.destination_id=b.destination_id AND l.record_kind=b.record_kind AND l.record_id=b.record_id AND l.status='exported' AND l.source_version=b.last_export_version AND l.source_version=md5(plugin_data.csf_sheet_sync_destination_snapshot(test_org,b.destination_id,b.record_kind,b.record_id)::text)))) THEN RAISE EXCEPTION 'Discussions need exported messages, imported replies and resolution receipts.'; END IF;
 ELSIF d.discussion_transport='column' THEN
  IF jsonb_typeof(p_evidence->'exported_comments') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_bindings b WHERE b.destination_id=ANY(p_test_destination_ids) AND b.last_export_version IS NOT NULL AND (b.last_export_comments IS NULL OR (p_evidence->'exported_comments'->>b.id::text) IS DISTINCT FROM b.last_export_comments)) THEN RAISE EXCEPTION 'Read back every exported Comments cell before acceptance.'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_test_destination_ids) tid WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_changes c JOIN plugin_data.csf_sheet_sync_local_messages m ON m.id=c.id AND m.destination_id=c.destination_id WHERE c.id=ANY(change_ids) AND c.destination_id=tid AND c.status='accepted' AND c.payload->>'action'='comment' AND m.body='Google Sheets edit (reviewed):'||chr(10)||(c.payload->>'comments'))) THEN RAISE EXCEPTION 'Each copied destination needs a reviewed Comments edit.'; END IF;
 END IF;
 SELECT jsonb_object_agg(t.id::text,(jsonb_build_object('file',t.spreadsheet_file_id,'sheet',t.sheet_id,'kind',t.kind,'cohort',t.cohort_id,'term',t.term_id,'start',t.owned_start_column,'headers',t.managed_headers,'scope',jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=t.organization_id AND c.id=t.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id)))||plugin_data.csf_sheet_discussion_configuration(t.id))) INTO test_configurations FROM plugin_data.csf_sheet_sync_destinations t WHERE t.id=ANY(p_test_destination_ids);
 saved_evidence:=p_evidence||jsonb_build_object('test_configurations',test_configurations);
 config_snapshot:=(jsonb_build_object('protocol','csf-sheet-sync-v1','file',d.spreadsheet_file_id,'sheet',d.sheet_id,'kind',d.kind,'cohort',d.cohort_id,'term',d.term_id,'start',d.owned_start_column,'headers',d.managed_headers,'scope',jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=d.organization_id AND c.id=d.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id)))||plugin_data.csf_sheet_discussion_configuration(d.id));
 INSERT INTO plugin_data.csf_sheet_sync_acceptances(organization_id,destination_id,test_organization_id,reviewed_by,configuration,evidence,reason) VALUES(p_organization_id,d.id,test_org,p_actor_user_id,config_snapshot,saved_evidence,p_reason) ON CONFLICT(destination_id,configuration_hash,evidence_hash) DO NOTHING RETURNING * INTO a;
 IF a.id IS NULL THEN SELECT * INTO a FROM plugin_data.csf_sheet_sync_acceptances WHERE destination_id=d.id AND configuration=config_snapshot AND evidence=saved_evidence; ELSE
  INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.test_journey_accepted','sheet_sync_acceptance',a.id,to_jsonb(a)); END IF;
 RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_record_sheet_sync_acceptance(uuid,uuid,uuid,uuid[],jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_sheet_sync_acceptance(uuid,uuid,uuid,uuid[],jsonb,text) TO service_role;

-- These high-volume Sheet sync tables predate the tenant-index architecture
-- gate. Lead with organization_id so tenant-scoped maintenance does not scan
-- across chapters.
CREATE INDEX IF NOT EXISTS csf_sheet_sync_acceptances_organization_idx
 ON plugin_data.csf_sheet_sync_acceptances(organization_id);
CREATE INDEX IF NOT EXISTS csf_sheet_sync_changes_organization_idx
 ON plugin_data.csf_sheet_sync_changes(organization_id);
CREATE INDEX IF NOT EXISTS csf_sheet_sync_comments_organization_idx
 ON plugin_data.csf_sheet_sync_comments(organization_id);
CREATE INDEX IF NOT EXISTS csf_sheet_sync_local_messages_organization_idx
 ON plugin_data.csf_sheet_sync_local_messages(organization_id);
