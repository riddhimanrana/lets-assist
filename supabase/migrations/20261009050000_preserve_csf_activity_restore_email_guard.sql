-- Preserve the no-announcement restoration contract with the project-first attendance lock order.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_activity_status_with_email(
 p_organization_id uuid,p_activity_id uuid,p_status text,p_reason text,p_actor_user_id uuid,p_request_id uuid,p_email_requested boolean,p_email_topic jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;v_had_event boolean;v_locked_project_id uuid;
BEGIN
 IF p_actor_user_id IS NULL OR plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_opportunities') IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Not authorized to manage CSF activities.' USING ERRCODE='42501'; END IF;
 IF p_status='restored' AND p_email_requested IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'Restoring an activity cannot request another announcement.' USING ERRCODE='22023';
 END IF;
 IF p_email_requested IS NULL THEN RAISE EXCEPTION 'Choose whether to email this publication.'; END IF;
 SELECT linked_project_id INTO v_locked_project_id FROM plugin_data.csf_opportunities
   WHERE organization_id=p_organization_id AND id=p_activity_id;
 PERFORM 1 FROM public.projects WHERE id=v_locked_project_id FOR UPDATE;
 PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF (SELECT linked_project_id FROM plugin_data.csf_opportunities WHERE organization_id=p_organization_id AND id=p_activity_id)
   IS DISTINCT FROM v_locked_project_id THEN
   RAISE EXCEPTION 'CSF activity changed; refresh and try again.' USING ERRCODE='PT409'; END IF;
 SELECT EXISTS(SELECT 1 FROM plugin_data.csf_publication_events WHERE organization_id=p_organization_id AND source_kind='activity' AND source_id=p_activity_id AND event_key='') INTO v_had_event;
 v_result:=plugin_data.csf_set_activity_status(p_organization_id,p_activity_id,p_status,p_reason,p_actor_user_id,p_request_id);
 IF p_status='restored' THEN RETURN v_result; END IF;
 RETURN v_result||plugin_data.csf_capture_activity_email_intent(p_organization_id,p_activity_id,p_actor_user_id,p_request_id,p_email_requested,p_email_topic,
   NOT v_had_event AND coalesce((v_result->>'idempotent')::boolean,false)=false);
END; $$;

REVOKE ALL ON FUNCTION plugin_data.csf_set_activity_status_with_email(uuid,uuid,text,text,uuid,uuid,boolean,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_activity_status_with_email(uuid,uuid,text,text,uuid,uuid,boolean,jsonb) TO postgres,service_role;

COMMIT;
