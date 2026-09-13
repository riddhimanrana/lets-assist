-- Reject Sheet discussion writes when the destination cannot export them.
BEGIN;

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
 IF NOT FOUND OR NOT d.enabled THEN RAISE EXCEPTION 'Sync destination is disabled.'; END IF;
 IF d.discussion_transport NOT IN ('native','column') THEN RAISE EXCEPTION 'Sheet discussions are disabled for this destination.'; END IF;
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

COMMIT;
