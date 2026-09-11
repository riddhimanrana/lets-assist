-- Require a new complete observation after changing whether sync is enabled.

CREATE OR REPLACE FUNCTION plugin_data.csf_set_sheet_sync_destination_state(p_organization_id uuid,p_actor_user_id uuid,p_destination_id uuid,p_enabled boolean,p_privacy_verified boolean,p_comment_capability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 IF p_enabled AND NOT d.is_test AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_acceptances a WHERE a.organization_id=p_organization_id AND a.destination_id=d.id AND a.reviewed_by IS NOT NULL AND a.configuration=(jsonb_build_object('protocol','csf-sheet-sync-v1','file',d.spreadsheet_file_id,'sheet',d.sheet_id,'kind',d.kind,'cohort',d.cohort_id,'term',d.term_id,'start',d.owned_start_column,'headers',d.managed_headers,'scope',jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=d.organization_id AND c.id=d.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id)))||plugin_data.csf_sheet_discussion_configuration(d.id)) AND NOT EXISTS(SELECT 1 FROM jsonb_each(a.evidence->'test_configurations') cfg WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations t WHERE t.id::text=cfg.key AND t.organization_id=a.test_organization_id AND cfg.value=(jsonb_build_object('file',t.spreadsheet_file_id,'sheet',t.sheet_id,'kind',t.kind,'cohort',t.cohort_id,'term',t.term_id,'start',t.owned_start_column,'headers',t.managed_headers,'scope',jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=t.organization_id AND c.id=t.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id)))||plugin_data.csf_sheet_discussion_configuration(t.id))))) THEN RAISE EXCEPTION 'Review a complete copied-workbook test journey before enabling live sync.'; END IF;
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
REVOKE ALL ON FUNCTION plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_sheet_sync_change(p_organization_id uuid,p_actor_user_id uuid,p_change_id uuid,p_accept boolean,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c plugin_data.csf_sheet_sync_changes%ROWTYPE; r jsonb; d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=(SELECT destination_id FROM plugin_data.csf_sheet_sync_changes WHERE organization_id=p_organization_id AND id=p_change_id) FOR NO KEY UPDATE;
 SELECT * INTO c FROM plugin_data.csf_sheet_sync_changes WHERE organization_id=p_organization_id AND id=p_change_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sheet change not found.'; END IF;
 IF c.payload->>'action'='comment' THEN
  IF (c.record_kind='point_submission' AND NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'verify_submissions')) OR (c.record_kind='application' AND NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'view_applications') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'write_application_notes'))) OR (c.record_kind='profile' AND NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_profiles')) THEN RAISE EXCEPTION 'Not authorized to review this discussion.'; END IF;
 ELSE
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,CASE WHEN c.record_kind='application' THEN 'decide_applications' ELSE 'verify_submissions' END) THEN RAISE EXCEPTION 'Not authorized to review this record.'; END IF;
 END IF;
 IF c.status<>'pending' THEN RETURN to_jsonb(c); END IF;
 IF p_accept IS NULL THEN RAISE EXCEPTION 'Choose accept or discard.'; END IF;
 p_reason:=nullif(btrim(p_reason),'');
 IF p_reason IS NULL OR length(p_reason)>4000 THEN RAISE EXCEPTION 'Enter a review note of 1 to 4000 characters.'; END IF;
 IF p_accept THEN
   IF NOT d.enabled OR d.observation_state IS DISTINCT FROM 'valid' OR (d.poll_lease_token IS NOT NULL AND d.poll_lease_expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Complete a valid Sheet observation before accepting this change.'; END IF;
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
