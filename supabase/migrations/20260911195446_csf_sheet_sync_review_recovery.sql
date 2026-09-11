-- Preserve observed request intent and audited recovery across repeat syncs.

ALTER TABLE plugin_data.csf_sheet_sync_bindings ADD COLUMN observation_generation bigint NOT NULL DEFAULT 0 CHECK(observation_generation>=0);
ALTER TABLE plugin_data.csf_sheet_sync_changes ADD COLUMN observation_generation bigint NOT NULL DEFAULT 0 CHECK(observation_generation>=0);
DO $$ DECLARE constraint_name text; BEGIN
 SELECT conname INTO STRICT constraint_name FROM pg_constraint WHERE conrelid='plugin_data.csf_sheet_sync_changes'::regclass AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (destination_id, record_kind, record_id, remote_version, source_version)';
 EXECUTE format('ALTER TABLE plugin_data.csf_sheet_sync_changes DROP CONSTRAINT %I',constraint_name);
END $$;
ALTER TABLE plugin_data.csf_sheet_sync_changes ADD CONSTRAINT csf_sheet_sync_change_observation_key UNIQUE(destination_id,record_kind,record_id,remote_version,source_version,observation_generation);

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
 IF request IS DISTINCT FROM b.last_seen_request THEN UPDATE plugin_data.csf_sheet_sync_bindings SET observation_generation=observation_generation+1 WHERE id=b.id RETURNING observation_generation INTO b.observation_generation; END IF;
 UPDATE plugin_data.csf_sheet_sync_changes SET status='stale' WHERE organization_id=p_organization_id AND destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND status='pending' AND (payload-ARRAY['author_display_name','author_provider_id']) IS DISTINCT FROM request;
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
 INSERT INTO plugin_data.csf_sheet_sync_changes(organization_id,destination_id,record_kind,record_id,source_version,remote_version,payload,observation_generation) VALUES(p_organization_id,d.id,p_record_kind,p_record_id,p_source_version,p_remote_version,p_payload,b.observation_generation)
 ON CONFLICT(destination_id,record_kind,record_id,remote_version,source_version,observation_generation) DO NOTHING RETURNING * INTO c;
 IF c.id IS NULL THEN
 SELECT * INTO c FROM plugin_data.csf_sheet_sync_changes WHERE destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND remote_version=p_remote_version AND source_version=p_source_version AND observation_generation=b.observation_generation;
 IF c.payload<>p_payload OR c.source_version<>p_source_version THEN RAISE EXCEPTION 'Conflicting change uses an existing remote version.'; END IF;
 END IF;
 UPDATE plugin_data.csf_sheet_sync_bindings SET last_seen_request=request,last_seen_request_source_version=p_source_version WHERE id=b.id;
 RETURN to_jsonb(c);
END $$;

REVOKE ALL ON FUNCTION plugin_data.csf_record_sheet_sync_change(uuid,uuid,text,uuid,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_sheet_sync_change(uuid,uuid,text,uuid,text,text,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_sheet_sync_record(p_organization_id uuid,p_actor_user_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 result:=plugin_data.csf_queue_sheet_sync_record_internal(p_organization_id,p_destination_id,p_record_kind,p_record_id);
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 UPDATE plugin_data.csf_sheet_writeback_ledger SET status='retry_export',lease_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=now() WHERE id=(result->>'id')::uuid AND organization_id=p_organization_id AND destination_id=p_destination_id AND status IN ('exported','superseded') RETURNING to_jsonb(csf_sheet_writeback_ledger.*) INTO result;
 IF result IS NULL THEN SELECT to_jsonb(l) INTO result FROM plugin_data.csf_sheet_writeback_ledger l WHERE organization_id=p_organization_id AND destination_id=p_destination_id AND record_kind=p_record_kind AND record_id=p_record_id AND source_version=md5(plugin_data.csf_sheet_sync_destination_snapshot(p_organization_id,p_destination_id,p_record_kind,p_record_id)::text); END IF;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION plugin_data.csf_queue_sheet_sync_record(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_sheet_sync_record(uuid,uuid,uuid,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_claim_sheet_sync_destination(p_organization_id uuid,p_destination_id uuid,p_force boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 UPDATE plugin_data.csf_sheet_sync_destinations SET seed_cursor=CASE WHEN p_force THEN NULL ELSE seed_cursor END,seed_completed=CASE WHEN p_force THEN false ELSE seed_completed END,poll_lease_token=gen_random_uuid(),poll_lease_expires_at=clock_timestamp()+interval '2 minutes',next_poll_at=clock_timestamp()+interval '2 minutes'
 WHERE organization_id=p_organization_id AND id=p_destination_id AND enabled AND (p_force OR next_poll_at<=clock_timestamp()) AND (poll_lease_expires_at IS NULL OR poll_lease_expires_at<clock_timestamp()) AND plugin_data.csf_actor_has_permission(organization_id,configured_by,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(organization_id,configured_by,'export_sensitive_reports') RETURNING * INTO d;
 RETURN CASE WHEN d.id IS NULL THEN NULL ELSE to_jsonb(d) END;
END $$;

REVOKE ALL ON FUNCTION plugin_data.csf_claim_sheet_sync_destination(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_sheet_sync_destination(uuid,uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_add_sheet_sync_local_message(p_organization_id uuid,p_actor_user_id uuid,p_binding_id uuid,p_request_id uuid,p_thread_id text,p_body text,p_resolved boolean DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b plugin_data.csf_sheet_sync_bindings%ROWTYPE; m plugin_data.csf_sheet_sync_local_messages%ROWTYPE; d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable message request identifier is required.'; END IF;
 SELECT * INTO b FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND id=p_binding_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Comment binding not found.'; END IF;
 IF (b.record_kind='application' AND NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'view_applications') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'write_application_notes'))) OR (b.record_kind='profile' AND NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_profiles')) OR (b.record_kind='point_submission' AND NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'verify_submissions')) THEN RAISE EXCEPTION 'Not authorized to view this discussion.'; END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE id=b.destination_id AND organization_id=p_organization_id;
 IF NOT d.enabled THEN RAISE EXCEPTION 'Sync destination is disabled.'; END IF;
 IF p_thread_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_comments WHERE binding_id=b.id AND provider_thread_id=p_thread_id) AND NOT EXISTS(SELECT 1 FROM jsonb_each(b.thread_bindings) WHERE value->>'threadId'=p_thread_id) THEN RAISE EXCEPTION 'Thread does not belong to this record.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('csf-sheet-message:'||p_request_id::text,0));
 SELECT * INTO m FROM plugin_data.csf_sheet_sync_local_messages WHERE id=p_request_id;
 IF FOUND THEN
  IF m.organization_id<>p_organization_id OR m.binding_id<>b.id OR m.author_user_id IS DISTINCT FROM p_actor_user_id OR m.body<>p_body OR m.provider_thread_id IS DISTINCT FROM p_thread_id OR m.resolved IS DISTINCT FROM p_resolved THEN RAISE EXCEPTION 'Message request conflicts with its previous use.'; END IF;
  RETURN to_jsonb(m);
 END IF;
 INSERT INTO plugin_data.csf_sheet_sync_local_messages(id,organization_id,destination_id,binding_id,author_user_id,provider_thread_id,body,resolved) VALUES(p_request_id,p_organization_id,b.destination_id,b.id,p_actor_user_id,p_thread_id,p_body,p_resolved) RETURNING * INTO m;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.message_added','sheet_sync_local_message',m.id,to_jsonb(m));
 RETURN to_jsonb(m);
END $$;

REVOKE ALL ON FUNCTION plugin_data.csf_add_sheet_sync_local_message(uuid,uuid,uuid,uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_add_sheet_sync_local_message(uuid,uuid,uuid,uuid,text,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_sheet_sync_change(p_organization_id uuid,p_actor_user_id uuid,p_change_id uuid,p_accept boolean,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c plugin_data.csf_sheet_sync_changes%ROWTYPE; r jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') THEN RAISE EXCEPTION 'Not authorized.'; END IF;
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

CREATE OR REPLACE FUNCTION plugin_data.csf_reconcile_sheet_sync_export(p_organization_id uuid,p_actor_user_id uuid,p_ledger_id uuid,p_was_written boolean,p_remote_version text,p_reason text,p_comments text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l plugin_data.csf_sheet_writeback_ledger%ROWTYPE; before_row jsonb; column_mode boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 IF p_was_written IS NULL THEN RAISE EXCEPTION 'Confirm whether the provider write occurred. Keep uncertain writes on hold.'; END IF;
 IF p_was_written AND nullif(btrim(p_remote_version),'') IS NULL THEN RAISE EXCEPTION 'A confirmed export requires its provider version.'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Record the destination reconciliation result.'; END IF;
 SELECT * INTO l FROM plugin_data.csf_sheet_writeback_ledger WHERE id=p_ledger_id AND organization_id=p_organization_id AND destination_id IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Export attempt not found.'; END IF;
 PERFORM 1 FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=l.destination_id FOR NO KEY UPDATE;
 SELECT discussion_transport='column' INTO column_mode FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=l.destination_id;
 IF p_was_written AND column_mode AND (p_comments IS NULL OR length(p_comments)>50000) THEN RAISE EXCEPTION 'A column write requires its complete Comments receipt. Keep this write on hold.'; END IF;
 IF p_comments IS NOT NULL AND (NOT column_mode OR NOT p_was_written) THEN RAISE EXCEPTION 'Comments evidence only belongs to a confirmed column write.'; END IF;
 IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=l.destination_id AND enabled) THEN RAISE EXCEPTION 'Turn off syncing before reconciling this write.'; END IF;
 IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id=p_organization_id AND destination_id=l.destination_id AND status='exporting' AND lease_expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Wait for active export attempts before reconciling this write.'; END IF;
 PERFORM 1 FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND destination_id=l.destination_id AND record_kind=l.record_kind AND record_id=l.record_id FOR UPDATE;
 SELECT e.* INTO l FROM plugin_data.csf_sheet_writeback_ledger e WHERE e.organization_id=p_organization_id AND e.id=p_ledger_id AND e.destination_id=l.destination_id AND e.record_kind=l.record_kind AND e.record_id=l.record_id FOR UPDATE;
 IF NOT FOUND OR l.status<>'unknown_outcome' THEN RAISE EXCEPTION 'Export is not awaiting reconciliation.'; END IF;
 before_row:=to_jsonb(l);
 UPDATE plugin_data.csf_sheet_writeback_ledger SET status=CASE WHEN p_was_written THEN 'exported' ELSE 'retry_export' END,lease_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=now() WHERE id=l.id RETURNING * INTO l;
 IF p_was_written THEN
  UPDATE plugin_data.csf_sheet_sync_bindings SET last_export_version=l.source_version,remote_version=p_remote_version,last_export_comments=CASE WHEN column_mode THEN p_comments ELSE last_export_comments END WHERE destination_id=l.destination_id AND record_kind=l.record_kind AND record_id=l.record_id;
  UPDATE plugin_data.csf_sheet_sync_destinations SET last_synced_at=now(),updated_at=now() WHERE organization_id=p_organization_id AND id=l.destination_id;
 END IF;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,before_data,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.export_reconciled','sheet_writeback_ledger',l.id,before_row,to_jsonb(l)||jsonb_build_object('was_written',p_was_written,'remote_version',p_remote_version,'reason',p_reason)||CASE WHEN p_was_written AND column_mode THEN jsonb_build_object('comments_hash',md5(p_comments),'comments',p_comments) ELSE '{}'::jsonb END);
 RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_reconcile_sheet_sync_export(p_organization_id uuid,p_actor_user_id uuid,p_ledger_id uuid,p_was_written boolean,p_remote_version text,p_reason text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT plugin_data.csf_reconcile_sheet_sync_export(p_organization_id,p_actor_user_id,p_ledger_id,p_was_written,p_remote_version,p_reason,NULL) $$;

REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text) TO service_role;

