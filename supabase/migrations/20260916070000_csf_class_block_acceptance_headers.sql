-- The officers' class block carries one column per activity and one per
-- meeting, so its header set changes whenever a semester gains a meeting. The
-- copied-workbook acceptance receipt pinned the whole header array, which made
-- an appended column revoke an officer's acceptance and stop the sync. The
-- product decision is that appending a meeting column is not a change an
-- officer has to re-accept, so the receipt pins the fixed ends of the block
-- instead: where it starts, the five identity columns, and the summary and
-- version columns it ends with.
--
-- Fails safe. Anything that is not a recognisable officers' class block, an
-- older eight-column class block included, keeps comparing on the exact array
-- it always did.
CREATE OR REPLACE FUNCTION plugin_data.csf_sheet_acceptance_headers(
  p_kind text,
  p_headers jsonb
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN p_kind IS DISTINCT FROM 'class'
      OR pg_catalog.jsonb_typeof(p_headers) IS DISTINCT FROM 'array'
      OR p_headers->>0 IS DISTINCT FROM 'Profile ID'
      OR p_headers->>1 IS DISTINCT FROM 'Last'
      OR p_headers->>2 IS DISTINCT FROM 'First'
      OR p_headers->>3 IS DISTINCT FROM 'LastFirst'
      OR NOT (p_headers ? 'All Meeting Attendance')
    THEN p_headers
    ELSE pg_catalog.jsonb_build_object(
      'protocol', 'csf-class-block-v2',
      'prefix', (
        SELECT pg_catalog.jsonb_agg(entry.value ORDER BY entry.ordinality)
        FROM pg_catalog.jsonb_array_elements(p_headers)
          WITH ORDINALITY AS entry(value, ordinality)
        WHERE entry.ordinality <= 5
      ),
      'suffix', (
        SELECT pg_catalog.jsonb_agg(entry.value ORDER BY entry.ordinality)
        FROM pg_catalog.jsonb_array_elements(p_headers)
          WITH ORDINALITY AS entry(value, ordinality)
        WHERE entry.ordinality >= (
          SELECT pg_catalog.min(summary.ordinality)
          FROM pg_catalog.jsonb_array_elements_text(p_headers)
            WITH ORDINALITY AS summary(value, ordinality)
          WHERE summary.value = 'All Meeting Attendance'
        )
      )
    )
  END
$fn$;

REVOKE ALL ON FUNCTION plugin_data.csf_sheet_acceptance_headers(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_acceptance_headers(text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_sheet_sync_destination_state(p_organization_id uuid,p_actor_user_id uuid,p_destination_id uuid,p_enabled boolean,p_privacy_verified boolean,p_comment_capability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 IF p_enabled AND NOT d.is_test AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_acceptances a WHERE a.organization_id=p_organization_id AND a.destination_id=d.id AND a.reviewed_by IS NOT NULL AND a.configuration=(jsonb_build_object('protocol','csf-sheet-sync-v1','file',d.spreadsheet_file_id,'sheet',d.sheet_id,'kind',d.kind,'cohort',d.cohort_id,'term',d.term_id,'start',d.owned_start_column,'headers',plugin_data.csf_sheet_acceptance_headers(d.kind,d.managed_headers),'scope',jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=d.organization_id AND c.id=d.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id)))||plugin_data.csf_sheet_discussion_configuration(d.id)) AND NOT EXISTS(SELECT 1 FROM jsonb_each(a.evidence->'test_configurations') cfg WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations t WHERE t.id::text=cfg.key AND t.organization_id=a.test_organization_id AND cfg.value=(jsonb_build_object('file',t.spreadsheet_file_id,'sheet',t.sheet_id,'kind',t.kind,'cohort',t.cohort_id,'term',t.term_id,'start',t.owned_start_column,'headers',plugin_data.csf_sheet_acceptance_headers(t.kind,t.managed_headers),'scope',jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=t.organization_id AND c.id=t.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id)))||plugin_data.csf_sheet_discussion_configuration(t.id))))) THEN RAISE EXCEPTION 'Review a complete copied-workbook test journey before enabling live sync.'; END IF;
 IF d.enabled IS DISTINCT FROM p_enabled THEN
  PERFORM 1 FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND destination_id=d.id ORDER BY id FOR UPDATE;
  UPDATE plugin_data.csf_sheet_sync_bindings b SET last_seen_request='{}'::jsonb,last_seen_request_source_version=NULL
   WHERE b.organization_id=p_organization_id AND b.destination_id=d.id AND EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_changes c WHERE c.destination_id=b.destination_id AND c.record_kind=b.record_kind AND c.record_id=b.record_id AND c.status='pending');
  UPDATE plugin_data.csf_sheet_sync_changes SET status='stale' WHERE organization_id=p_organization_id AND destination_id=d.id AND status='pending';
 END IF;
 UPDATE plugin_data.csf_sheet_sync_destinations SET observation_state=CASE WHEN enabled IS DISTINCT FROM p_enabled THEN 'checking' ELSE observation_state END,seed_cursor=CASE WHEN p_enabled AND NOT enabled THEN NULL ELSE seed_cursor END,seed_completed=CASE WHEN p_enabled AND NOT enabled THEN false ELSE seed_completed END,poll_lease_token=NULL,poll_lease_expires_at=NULL,enabled=p_enabled,privacy_verified_at=CASE WHEN p_privacy_verified THEN now() END,comment_capability=p_comment_capability,configured_by=p_actor_user_id,updated_at=now()
 WHERE organization_id=p_organization_id AND id=p_destination_id RETURNING * INTO d;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.destination_state','sheet_sync_destination',d.id,to_jsonb(d));
 RETURN to_jsonb(d);
END $$;

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
 SELECT jsonb_object_agg(t.id::text,(jsonb_build_object('file',t.spreadsheet_file_id,'sheet',t.sheet_id,'kind',t.kind,'cohort',t.cohort_id,'term',t.term_id,'start',t.owned_start_column,'headers',plugin_data.csf_sheet_acceptance_headers(t.kind,t.managed_headers),'scope',jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=t.organization_id AND c.id=t.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id)))||plugin_data.csf_sheet_discussion_configuration(t.id))) INTO test_configurations FROM plugin_data.csf_sheet_sync_destinations t WHERE t.id=ANY(p_test_destination_ids);
 saved_evidence:=p_evidence||jsonb_build_object('test_configurations',test_configurations);
 config_snapshot:=(jsonb_build_object('protocol','csf-sheet-sync-v1','file',d.spreadsheet_file_id,'sheet',d.sheet_id,'kind',d.kind,'cohort',d.cohort_id,'term',d.term_id,'start',d.owned_start_column,'headers',plugin_data.csf_sheet_acceptance_headers(d.kind,d.managed_headers),'scope',jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=d.organization_id AND c.id=d.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id)))||plugin_data.csf_sheet_discussion_configuration(d.id));
 INSERT INTO plugin_data.csf_sheet_sync_acceptances(organization_id,destination_id,test_organization_id,reviewed_by,configuration,evidence,reason) VALUES(p_organization_id,d.id,test_org,p_actor_user_id,config_snapshot,saved_evidence,p_reason) ON CONFLICT(destination_id,configuration_hash,evidence_hash) DO NOTHING RETURNING * INTO a;
 IF a.id IS NULL THEN SELECT * INTO a FROM plugin_data.csf_sheet_sync_acceptances WHERE destination_id=d.id AND configuration=config_snapshot AND evidence=saved_evidence; ELSE
  INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.test_journey_accepted','sheet_sync_acceptance',a.id,to_jsonb(a)); END IF;
 RETURN to_jsonb(a);
END $$;

REVOKE ALL ON FUNCTION plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_record_sheet_sync_acceptance(uuid,uuid,uuid,uuid[],jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_sheet_sync_acceptance(uuid,uuid,uuid,uuid[],jsonb,text) TO service_role;
