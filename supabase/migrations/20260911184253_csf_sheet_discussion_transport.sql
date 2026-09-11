-- Add the reviewed Comments-column transport without changing existing destinations.
ALTER TABLE plugin_data.csf_sheet_sync_destinations
 ADD COLUMN discussion_transport text NOT NULL DEFAULT 'native' CHECK(discussion_transport IN ('native','column')),
 ADD CONSTRAINT csf_sheet_discussion_column CHECK(discussion_transport='native' OR managed_headers @> '["Comments"]'::jsonb);

CREATE FUNCTION plugin_data.csf_sheet_discussion_configuration(p_destination_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN discussion_transport='native' THEN '{}'::jsonb ELSE jsonb_build_object('discussion_transport',discussion_transport) END
 FROM plugin_data.csf_sheet_sync_destinations WHERE id=p_destination_id
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_discussion_configuration(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION plugin_data.csf_configure_sheet_discussion_transport(p_organization_id uuid,p_actor_user_id uuid,p_destination_id uuid,p_transport text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('csf-sheet-destination:'||d.spreadsheet_file_id,0));
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id FOR NO KEY UPDATE;
 IF p_transport IS NULL OR p_transport NOT IN ('native','column') OR (p_transport='column' AND (SELECT count(*) FROM jsonb_array_elements_text(d.managed_headers) h WHERE h='Comments')<>1) THEN RAISE EXCEPTION 'The destination needs one Comments column.'; END IF;
 IF d.discussion_transport=p_transport THEN RETURN to_jsonb(d); END IF;
 IF d.enabled OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_bindings WHERE destination_id=d.id) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_acceptances WHERE destination_id=d.id) THEN RAISE EXCEPTION 'Create a new destination to change a discussion transport already in use.'; END IF;
 UPDATE plugin_data.csf_sheet_sync_destinations SET discussion_transport=p_transport,comment_capability='pending',privacy_verified_at=NULL,poll_lease_token=NULL,poll_lease_expires_at=NULL,configured_by=p_actor_user_id,updated_at=now() WHERE id=d.id RETURNING * INTO d;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.discussion_configured','sheet_sync_destination',d.id,to_jsonb(d));
 RETURN to_jsonb(d);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_configure_sheet_discussion_transport(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_configure_sheet_discussion_transport(uuid,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_sheet_sync_destination_state(p_organization_id uuid,p_actor_user_id uuid,p_destination_id uuid,p_enabled boolean,p_privacy_verified boolean,p_comment_capability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 IF p_enabled AND NOT d.is_test AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_acceptances a WHERE a.organization_id=p_organization_id AND a.destination_id=d.id AND a.reviewed_by IS NOT NULL AND a.configuration=(jsonb_build_object('protocol','csf-sheet-sync-v1','file',d.spreadsheet_file_id,'sheet',d.sheet_id,'kind',d.kind,'cohort',d.cohort_id,'term',d.term_id,'start',d.owned_start_column,'headers',d.managed_headers,'scope',jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=d.organization_id AND c.id=d.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id)))||plugin_data.csf_sheet_discussion_configuration(d.id)) AND NOT EXISTS(SELECT 1 FROM jsonb_each(a.evidence->'test_configurations') cfg WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations t WHERE t.id::text=cfg.key AND t.organization_id=a.test_organization_id AND cfg.value=(jsonb_build_object('file',t.spreadsheet_file_id,'sheet',t.sheet_id,'kind',t.kind,'cohort',t.cohort_id,'term',t.term_id,'start',t.owned_start_column,'headers',t.managed_headers,'scope',jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=t.organization_id AND c.id=t.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id)))||plugin_data.csf_sheet_discussion_configuration(t.id))))) THEN RAISE EXCEPTION 'Review a complete copied-workbook test journey before enabling live sync.'; END IF;
 UPDATE plugin_data.csf_sheet_sync_destinations SET seed_cursor=CASE WHEN p_enabled AND NOT enabled THEN NULL ELSE seed_cursor END,seed_completed=CASE WHEN p_enabled AND NOT enabled THEN false ELSE seed_completed END,poll_lease_token=NULL,poll_lease_expires_at=NULL,enabled=p_enabled,privacy_verified_at=CASE WHEN p_privacy_verified THEN now() END,comment_capability=p_comment_capability,configured_by=p_actor_user_id,updated_at=now()
 WHERE organization_id=p_organization_id AND id=p_destination_id RETURNING * INTO d;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.destination_state','sheet_sync_destination',d.id,to_jsonb(d));
 RETURN to_jsonb(d);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text) TO service_role;

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
  IF td.organization_id<>test_org OR td.discussion_transport<>d.discussion_transport OR NOT td.is_test OR td.comment_capability<>'available' OR td.privacy_verified_at IS NULL OR td.last_synced_at IS NULL OR nullif(p_evidence->'provider_versions'->>td.id::text,'') IS NULL OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_copy_requests r WHERE r.organization_id=test_org AND r.source_organization_id=p_organization_id AND r.copied_file_id=td.spreadsheet_file_id AND r.state='completed' AND r.provider_subject IS NOT NULL) THEN RAISE EXCEPTION 'Test destinations need verified copied-file lineage and discussion access.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger l JOIN plugin_data.csf_sheet_sync_bindings b ON b.destination_id=l.destination_id AND b.record_kind=l.record_kind AND b.record_id=l.record_id WHERE l.id=ANY(export_ids) AND l.destination_id=td.id AND l.status='exported' AND l.source_version=b.last_export_version AND l.source_version=md5(plugin_data.csf_sheet_sync_destination_snapshot(test_org,td.id,l.record_kind,l.record_id)::text)) THEN RAISE EXCEPTION 'Each test destination needs a current exported receipt.'; END IF;
  IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger WHERE destination_id=td.id AND status IN ('unknown_outcome','exporting','pending_export','retry_export')) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_changes WHERE destination_id=td.id AND status='pending') THEN RAISE EXCEPTION 'Resolve outstanding copied-workbook changes before acceptance.'; END IF;
 END LOOP;
 IF NOT kinds @> ARRAY['applications','point_submissions','class'] OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_copy_requests r JOIN plugin_data.csf_sheet_sync_destinations t ON t.spreadsheet_file_id=r.copied_file_id AND t.id=ANY(p_test_destination_ids) WHERE r.organization_id=test_org AND r.source_organization_id=p_organization_id AND r.source_file_id=d.spreadsheet_file_id AND r.state='completed' AND t.kind=d.kind) THEN RAISE EXCEPTION 'The test copies do not cover this live destination.'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(export_ids) v WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger l WHERE l.id=v AND l.organization_id=test_org AND l.destination_id=ANY(p_test_destination_ids) AND l.status='exported')) OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger l WHERE l.id=ANY(export_ids) GROUP BY l.destination_id,l.record_kind,l.record_id HAVING count(DISTINCT source_version)>=2) THEN RAISE EXCEPTION 'Repeated sync needs distinct retained export versions.'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(change_ids) v WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_changes c WHERE c.id=v AND c.organization_id=test_org AND c.destination_id=ANY(p_test_destination_ids) AND c.status='accepted' AND c.reviewed_by IS NOT NULL)) OR EXISTS(SELECT 1 FROM unnest(ARRAY['application','point_submission']) k CROSS JOIN unnest(ARRAY['approved','rejected','needs_action']) actions(requested_action) WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_changes c WHERE c.id=ANY(change_ids) AND c.record_kind=k AND c.payload->>'action'=actions.requested_action AND c.status='accepted')) THEN RAISE EXCEPTION 'Approval, rejection and correction need reviewed application and point receipts.'; END IF;
 IF d.discussion_transport='native' THEN
 IF EXISTS(SELECT 1 FROM unnest(comment_ids) v WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_comments c WHERE c.id=v AND c.organization_id=test_org AND c.destination_id=ANY(p_test_destination_ids) AND NOT c.deleted)) OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_comments c WHERE c.id=ANY(comment_ids) GROUP BY c.destination_id,c.provider_thread_id HAVING count(DISTINCT c.provider_message_id)>=2 AND bool_or(c.resolved)) OR jsonb_typeof(p_evidence->'native_receipts') IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence->'native_receipts')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'native_receipts') receipt WHERE nullif(btrim(receipt->>'thread_id'),'') IS NULL OR nullif(btrim(receipt->>'post_id'),'') IS NULL OR nullif(btrim(receipt->>'local_version'),'') IS NULL OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_bindings b WHERE b.id=(receipt->>'binding_id')::uuid AND b.organization_id=test_org AND b.destination_id=ANY(p_test_destination_ids) AND b.thread_bindings->(receipt->>'local_message_id')=jsonb_build_object('threadId',receipt->>'thread_id','postId',receipt->>'post_id','localVersion',receipt->>'local_version') AND EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger l WHERE l.id=ANY(export_ids) AND l.destination_id=b.destination_id AND l.record_kind=b.record_kind AND l.record_id=b.record_id AND l.status='exported' AND l.source_version=b.last_export_version AND l.source_version=md5(plugin_data.csf_sheet_sync_destination_snapshot(test_org,b.destination_id,b.record_kind,b.record_id)::text)))) THEN RAISE EXCEPTION 'Discussions need exported messages, imported replies and resolution receipts.'; END IF;
 ELSE
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

ALTER TABLE plugin_data.csf_sheet_sync_bindings ADD COLUMN last_export_comments text CHECK(length(last_export_comments)<=50000);
ALTER TABLE plugin_data.csf_sheet_sync_changes DROP CONSTRAINT csf_sheet_sync_changes_record_kind_check,
 ADD CONSTRAINT csf_sheet_sync_changes_record_kind_check CHECK(record_kind IN ('application','point_submission','profile'));
CREATE OR REPLACE FUNCTION plugin_data.csf_record_sheet_sync_change(p_organization_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid,p_source_version text,p_remote_version text,p_payload jsonb,p_destination_lease_token uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c plugin_data.csf_sheet_sync_changes%ROWTYPE; d plugin_data.csf_sheet_sync_destinations%ROWTYPE; b plugin_data.csf_sheet_sync_bindings%ROWTYPE; request jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id FOR NO KEY UPDATE;
 IF NOT FOUND OR NOT d.enabled OR NOT (plugin_data.csf_actor_has_permission(p_organization_id,d.configured_by,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,d.configured_by,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Sync destination is disabled.'; END IF;
 SELECT * INTO b FROM plugin_data.csf_sheet_sync_bindings WHERE destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND last_export_version=p_source_version FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unrecognized record version.'; END IF;
 IF p_destination_lease_token IS NULL OR d.poll_lease_token IS DISTINCT FROM p_destination_lease_token OR d.poll_lease_expires_at IS NULL OR d.poll_lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Sync lease expired or access changed.'; END IF;
 IF coalesce((plugin_data.csf_sheet_sync_destination_snapshot(p_organization_id,p_destination_id,p_record_kind,p_record_id)->>'out_of_scope')::boolean,false) THEN RETURN jsonb_build_object('status','out_of_scope'); END IF;
 request:=p_payload-ARRAY['author_display_name','author_provider_id'];
 IF request='{}'::jsonb THEN UPDATE plugin_data.csf_sheet_sync_bindings SET last_seen_request='{}'::jsonb,last_seen_request_source_version=NULL WHERE id=b.id; RETURN jsonb_build_object('status','unchanged'); END IF;
 IF request=b.last_seen_request AND (b.last_seen_request_source_version IS NOT DISTINCT FROM p_source_version OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_changes old WHERE old.destination_id=d.id AND old.record_kind=p_record_kind AND old.record_id=p_record_id AND old.source_version=b.last_seen_request_source_version AND old.status='stale' AND old.payload-ARRAY['author_display_name','author_provider_id']=request)) THEN
  IF request->>'action'='comment' THEN
   SELECT * INTO c FROM plugin_data.csf_sheet_sync_changes old WHERE old.destination_id=d.id AND old.record_kind=p_record_kind AND old.record_id=p_record_id AND old.status='pending' AND old.payload-ARRAY['author_display_name','author_provider_id']=request ORDER BY old.created_at DESC,old.id DESC LIMIT 1;
   IF FOUND THEN RETURN to_jsonb(c); END IF;
  END IF;
  RETURN jsonb_build_object('status','unchanged');
 END IF;
 IF p_payload->>'action'='comment' THEN
  IF b.last_export_comments IS NULL OR (p_payload->>'previous_comments') IS DISTINCT FROM b.last_export_comments THEN RAISE EXCEPTION 'The exported Comments baseline changed.'; END IF;
  IF d.discussion_transport<>'column' OR p_record_kind NOT IN ('application','point_submission','profile') OR p_payload-ARRAY['action','comments','previous_comments']<>'{}'::jsonb OR jsonb_typeof(p_payload->'comments') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'previous_comments') IS DISTINCT FROM 'string' OR p_payload->>'comments'=p_payload->>'previous_comments' THEN RAISE EXCEPTION 'Unsupported Sheet comment change.'; END IF;
 ELSE
 IF p_record_kind NOT IN ('application','point_submission') OR p_payload->>'action' NOT IN ('approved','rejected','needs_action','duplicate') OR p_payload->>'action' IS NULL OR (p_record_kind='application' AND p_payload->>'action'='duplicate') OR p_payload - ARRAY['action','review_notes','awarded_points','author_display_name','author_provider_id'] <> '{}'::jsonb THEN RAISE EXCEPTION 'Unsupported Sheet change.'; END IF;
 END IF;
 IF length(p_remote_version)>500 OR length(p_payload::text)>10000 THEN RAISE EXCEPTION 'Sheet change exceeds the size limit.'; END IF;
 INSERT INTO plugin_data.csf_sheet_sync_changes(organization_id,destination_id,record_kind,record_id,source_version,remote_version,payload) VALUES(p_organization_id,d.id,p_record_kind,p_record_id,p_source_version,p_remote_version,p_payload)
 ON CONFLICT(destination_id,record_kind,record_id,remote_version,source_version) DO NOTHING RETURNING * INTO c;
 IF c.id IS NULL THEN
 SELECT * INTO c FROM plugin_data.csf_sheet_sync_changes WHERE destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND remote_version=p_remote_version AND source_version=p_source_version;
 IF c.payload<>p_payload OR c.source_version<>p_source_version THEN RAISE EXCEPTION 'Conflicting change uses an existing remote version.'; END IF;
 END IF;
 UPDATE plugin_data.csf_sheet_sync_bindings SET last_seen_request=request,last_seen_request_source_version=p_source_version WHERE id=b.id;
 RETURN to_jsonb(c);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_record_sheet_sync_change(uuid,uuid,text,uuid,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_sheet_sync_change(uuid,uuid,text,uuid,text,text,jsonb,uuid) TO service_role;
CREATE OR REPLACE FUNCTION plugin_data.csf_review_sheet_sync_change(p_organization_id uuid,p_actor_user_id uuid,p_change_id uuid,p_accept boolean,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c plugin_data.csf_sheet_sync_changes%ROWTYPE; r jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO c FROM plugin_data.csf_sheet_sync_changes WHERE organization_id=p_organization_id AND id=p_change_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sheet change not found.'; END IF;
 IF c.payload->>'action'='comment' THEN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'verify_submissions') OR (c.record_kind='application' AND NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'view_applications')) OR (c.record_kind='profile' AND NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_profiles')) THEN RAISE EXCEPTION 'Not authorized to review this discussion.'; END IF;
 ELSE
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,CASE WHEN c.record_kind='application' THEN 'decide_applications' ELSE 'verify_submissions' END) THEN RAISE EXCEPTION 'Not authorized to review this record.'; END IF;
 END IF;
 IF c.status<>'pending' THEN RETURN to_jsonb(c); END IF;
 IF p_accept IS NULL THEN RAISE EXCEPTION 'Choose accept or discard.'; END IF;
 p_reason:=nullif(btrim(p_reason),'');
 IF p_reason IS NULL OR length(p_reason)>4000 THEN RAISE EXCEPTION 'Enter a review note of 1 to 4000 characters.'; END IF;
 IF p_accept THEN
   IF c.record_kind='application' THEN PERFORM 1 FROM plugin_data.csf_term_applications WHERE organization_id=p_organization_id AND id=c.record_id FOR UPDATE;
   ELSIF c.record_kind='profile' THEN PERFORM 1 FROM plugin_data.csf_profiles WHERE organization_id=p_organization_id AND id=c.record_id FOR UPDATE;
   ELSE PERFORM 1 FROM plugin_data.csf_point_submissions WHERE organization_id=p_organization_id AND id=c.record_id FOR UPDATE; END IF;
   r:=plugin_data.csf_sheet_sync_destination_snapshot(p_organization_id,c.destination_id,c.record_kind,c.record_id);
   IF r IS NULL OR coalesce((r->>'out_of_scope')::boolean,false) OR md5(r::text)<>c.source_version THEN c.status:='stale';
   ELSE
     IF c.payload->>'action'='comment' THEN
       PERFORM plugin_data.csf_add_sheet_sync_local_message(p_organization_id,p_actor_user_id,(SELECT id FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND destination_id=c.destination_id AND record_kind=c.record_kind AND record_id=c.record_id),c.id,NULL,'Google Sheets edit (reviewed):'||chr(10)||(c.payload->>'comments'),NULL);
     ELSIF c.record_kind='application' THEN PERFORM plugin_data.csf_decide_term_application(p_organization_id,c.record_id,CASE WHEN c.payload->>'action'='approved' THEN 'accepted' ELSE c.payload->>'action' END,p_reason,p_actor_user_id,c.id);
     ELSE PERFORM plugin_data.csf_review_point_submission_request(p_organization_id,c.record_id,c.payload->>'action',(c.payload->>'awarded_points')::numeric,p_reason,p_actor_user_id,c.id); END IF;
     c.status:='accepted';
   END IF;
 ELSE
  c.status:='discarded';
  IF c.payload->>'action'='comment' THEN
   UPDATE plugin_data.csf_sheet_sync_bindings SET scope_revision=scope_revision+1 WHERE organization_id=p_organization_id AND destination_id=c.destination_id AND record_kind=c.record_kind AND record_id=c.record_id;
   IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations WHERE id=c.destination_id AND organization_id=p_organization_id AND enabled) THEN PERFORM plugin_data.csf_queue_sheet_sync_record_internal(p_organization_id,c.destination_id,c.record_kind,c.record_id); END IF;
  END IF;
 END IF;
 UPDATE plugin_data.csf_sheet_sync_changes SET status=c.status,reviewed_by=p_actor_user_id,review_reason=left(p_reason,4000),reviewed_at=now() WHERE id=c.id RETURNING * INTO c;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.change_reviewed','sheet_sync_change',c.id,to_jsonb(c));
 RETURN to_jsonb(c);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_review_sheet_sync_change(uuid,uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_sheet_sync_change(uuid,uuid,uuid,boolean,text) TO service_role;

CREATE FUNCTION plugin_data.csf_finish_sheet_sync_export(p_organization_id uuid,p_ledger_id uuid,p_lease_token uuid,p_outcome text,p_remote_version text,p_error text,p_comments text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l plugin_data.csf_sheet_writeback_ledger%ROWTYPE; column_mode boolean; receipt jsonb;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('exported','retry_export','unknown_outcome') THEN RAISE EXCEPTION 'Invalid export outcome.'; END IF;
 IF p_outcome='exported' AND nullif(btrim(p_remote_version),'') IS NULL THEN RAISE EXCEPTION 'A successful export requires its provider version.'; END IF;
 SELECT * INTO l FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id=p_organization_id AND id=p_ledger_id AND destination_id IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Export attempt not found.'; END IF;
 PERFORM 1 FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=l.destination_id FOR NO KEY UPDATE;
 PERFORM 1 FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND destination_id=l.destination_id AND record_kind=l.record_kind AND record_id=l.record_id FOR UPDATE;
 SELECT e.* INTO l FROM plugin_data.csf_sheet_writeback_ledger e WHERE e.organization_id=p_organization_id AND e.id=p_ledger_id AND e.destination_id=l.destination_id AND e.record_kind=l.record_kind AND e.record_id=l.record_id FOR UPDATE;
 IF NOT FOUND OR l.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Export lease no longer belongs to this attempt.'; END IF;
 SELECT discussion_transport='column' INTO column_mode FROM plugin_data.csf_sheet_sync_destinations WHERE id=l.destination_id;
 IF column_mode AND p_outcome='exported' AND (p_comments IS NULL OR length(p_comments)>50000) THEN RAISE EXCEPTION 'A column export requires its complete Comments receipt.'; END IF;
 IF NOT column_mode AND p_comments IS NOT NULL THEN RAISE EXCEPTION 'Native exports do not accept a Comments cell receipt.'; END IF;
 receipt:=jsonb_build_object('outcome',p_outcome,'remote_version',p_remote_version)||CASE WHEN column_mode AND p_outcome='exported' THEN jsonb_build_object('comments_hash',md5(p_comments)) ELSE '{}'::jsonb END;
 IF l.attempt_receipts ? p_lease_token::text THEN
  IF l.attempt_receipts->p_lease_token::text IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'Export receipt conflicts with this attempt result.'; END IF;
  RETURN to_jsonb(l);
 END IF;
 IF l.status<>'exporting' OR l.lease_expires_at IS NULL OR l.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Export lease expired. Reconcile before retrying.'; END IF;
 UPDATE plugin_data.csf_sheet_writeback_ledger SET status=p_outcome,attempt_receipts=attempt_receipts||jsonb_build_object(p_lease_token::text,receipt),last_error=left(p_error,1000),updated_at=now(),sent_at=CASE WHEN p_outcome='exported' THEN now() END WHERE id=l.id RETURNING * INTO l;
 IF p_outcome='exported' THEN
   UPDATE plugin_data.csf_sheet_sync_bindings SET last_export_comments=CASE WHEN column_mode THEN p_comments ELSE last_export_comments END,last_export_version=CASE WHEN coalesce((l.payload->>'out_of_scope')::boolean,false) AND last_export_version IS NULL THEN NULL ELSE l.source_version END,remote_version=p_remote_version WHERE destination_id=l.destination_id AND record_kind=l.record_kind AND record_id=l.record_id;
   UPDATE plugin_data.csf_sheet_sync_destinations SET last_synced_at=now() WHERE id=l.destination_id;
 END IF;
 RETURN to_jsonb(l);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_finish_sheet_sync_export(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finish_sheet_sync_export(uuid,uuid,uuid,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_finish_sheet_sync_export(p_organization_id uuid,p_ledger_id uuid,p_lease_token uuid,p_outcome text,p_remote_version text,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT plugin_data.csf_finish_sheet_sync_export(p_organization_id,p_ledger_id,p_lease_token,p_outcome,p_remote_version,p_error,NULL)
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_finish_sheet_sync_export(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finish_sheet_sync_export(uuid,uuid,uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_guard_sheet_sync_export_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (OLD.destination_id IS NOT NULL OR NEW.destination_id IS NOT NULL) AND
  (to_jsonb(NEW)-ARRAY['status','attempts','last_error','sent_at','updated_at','lease_token','lease_expires_at','attempt_receipts']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['status','attempts','last_error','sent_at','updated_at','lease_token','lease_expires_at','attempt_receipts']) THEN
  RAISE EXCEPTION 'Queued export identity and snapshot are immutable.' USING ERRCODE='23514';
 END IF;
 IF NEW.attempt_receipts IS DISTINCT FROM OLD.attempt_receipts AND (OLD.destination_id IS NULL OR OLD.status<>'exporting' OR OLD.lease_token IS NULL OR NEW.lease_token IS DISTINCT FROM OLD.lease_token OR OLD.attempt_receipts ? OLD.lease_token::text OR NEW.attempt_receipts-OLD.lease_token::text IS DISTINCT FROM OLD.attempt_receipts OR NEW.attempt_receipts->OLD.lease_token::text IS DISTINCT FROM (jsonb_build_object('outcome',NEW.status,'remote_version',NEW.attempt_receipts->OLD.lease_token::text->'remote_version')||CASE WHEN NEW.status='exported' AND EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations d WHERE d.id=NEW.destination_id AND d.discussion_transport='column') THEN jsonb_build_object('comments_hash',NEW.attempt_receipts->OLD.lease_token::text->'comments_hash') ELSE '{}'::jsonb END)) THEN RAISE EXCEPTION 'Export attempt receipts are immutable.' USING ERRCODE='23514'; END IF;
 IF NEW.attempt_receipts IS DISTINCT FROM OLD.attempt_receipts AND NEW.status='exported' AND EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations d WHERE d.id=NEW.destination_id AND d.discussion_transport='column') AND coalesce(NEW.attempt_receipts->OLD.lease_token::text->>'comments_hash','') !~ '^[0-9a-f]{32}$' THEN RAISE EXCEPTION 'Column export receipt needs a Comments digest.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_sheet_sync_export_snapshot() FROM PUBLIC,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION plugin_data.csf_reconcile_sheet_sync_export(p_organization_id uuid,p_actor_user_id uuid,p_ledger_id uuid,p_was_written boolean,p_remote_version text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l plugin_data.csf_sheet_writeback_ledger%ROWTYPE; before_row jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 IF p_was_written IS NULL THEN RAISE EXCEPTION 'Confirm whether the provider write occurred. Keep uncertain writes on hold.'; END IF;
 IF p_was_written AND nullif(btrim(p_remote_version),'') IS NULL THEN RAISE EXCEPTION 'A confirmed export requires its provider version.'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Record the destination reconciliation result.'; END IF;
 SELECT * INTO l FROM plugin_data.csf_sheet_writeback_ledger WHERE id=p_ledger_id AND organization_id=p_organization_id AND destination_id IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Export attempt not found.'; END IF;
 PERFORM 1 FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=l.destination_id FOR NO KEY UPDATE;
 IF p_was_written AND EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=l.destination_id AND discussion_transport='column') THEN RAISE EXCEPTION 'A column write requires its complete Comments receipt. Keep this write on hold.'; END IF;
 IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=l.destination_id AND enabled) THEN RAISE EXCEPTION 'Turn off syncing before reconciling this write.'; END IF;
 IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id=p_organization_id AND destination_id=l.destination_id AND status='exporting' AND lease_expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Wait for active export attempts before reconciling this write.'; END IF;
 PERFORM 1 FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND destination_id=l.destination_id AND record_kind=l.record_kind AND record_id=l.record_id FOR UPDATE;
 SELECT e.* INTO l FROM plugin_data.csf_sheet_writeback_ledger e WHERE e.organization_id=p_organization_id AND e.id=p_ledger_id AND e.destination_id=l.destination_id AND e.record_kind=l.record_kind AND e.record_id=l.record_id FOR UPDATE;
 IF NOT FOUND OR l.status<>'unknown_outcome' THEN RAISE EXCEPTION 'Export is not awaiting reconciliation.'; END IF;
 before_row:=to_jsonb(l);
 UPDATE plugin_data.csf_sheet_writeback_ledger SET status=CASE WHEN p_was_written THEN 'exported' ELSE 'retry_export' END,lease_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=now() WHERE id=l.id RETURNING * INTO l;
 IF p_was_written THEN UPDATE plugin_data.csf_sheet_sync_bindings SET last_export_version=l.source_version,remote_version=p_remote_version WHERE destination_id=l.destination_id AND record_kind=l.record_kind AND record_id=l.record_id; END IF;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,before_data,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.export_reconciled','sheet_writeback_ledger',l.id,before_row,to_jsonb(l)||jsonb_build_object('was_written',p_was_written,'remote_version',p_remote_version,'reason',p_reason));
 RETURN to_jsonb(l);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text) TO service_role;
