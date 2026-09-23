-- Record first-publication email intent with immutable content and recipient evidence.
BEGIN;

ALTER TABLE plugin_data.csf_publication_events
  ADD COLUMN activity_email_requested boolean,
  ADD COLUMN activity_email_state text NOT NULL DEFAULT 'not_requested'
    CHECK(activity_email_state IN('not_requested','pending','processing','queued','blocked')),
  ADD COLUMN activity_email_actor_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN activity_email_request_id uuid,
  ADD COLUMN activity_email_snapshot jsonb,
  ADD COLUMN activity_email_campaign_id uuid,
  ADD COLUMN activity_email_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN activity_email_next_attempt_at timestamptz,
  ADD COLUMN activity_email_lease_token uuid,
  ADD COLUMN activity_email_lease_expires_at timestamptz,
  ADD COLUMN activity_email_error_code text,
  ADD CONSTRAINT csf_activity_email_campaign_scope FOREIGN KEY(activity_email_campaign_id,organization_id)
    REFERENCES plugin_data.csf_communication_campaigns(id,organization_id) ON DELETE RESTRICT,
  ADD CONSTRAINT csf_activity_email_intent_shape CHECK(
    (activity_email_state='not_requested' AND activity_email_snapshot IS NULL)
    OR (source_kind='activity' AND activity_email_requested=true AND activity_email_actor_id IS NOT NULL
      AND activity_email_request_id IS NOT NULL AND jsonb_typeof(activity_email_snapshot)='object'));
CREATE INDEX csf_activity_email_preparation_ready_idx ON plugin_data.csf_publication_events(activity_email_next_attempt_at,id)
  WHERE activity_email_state IN('pending','processing');

CREATE FUNCTION plugin_data.csf_activity_email_audience_snapshot(
  p_organization_id uuid,p_actor_user_id uuid,p_term_id uuid,p_cohort_id uuid,p_activity_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_candidates jsonb:='[]';v_page jsonb;v_offset integer:=0;v_topic jsonb;v_result jsonb;
BEGIN
  IF plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_opportunities') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activity emails.' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_terms WHERE organization_id=p_organization_id AND id=p_term_id)
    OR (p_cohort_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_cohorts WHERE organization_id=p_organization_id AND id=p_cohort_id))
  THEN RAISE EXCEPTION 'The activity email audience is outside this chapter.' USING ERRCODE='42501'; END IF;
  SELECT configuration#>'{communications,broadcastTopics,term_members}' INTO v_topic
    FROM public.organization_plugin_installs WHERE organization_id=p_organization_id AND plugin_key='dvhs-csf' AND enabled;
  IF p_cohort_id IS NOT NULL AND p_activity_id IS NOT NULL THEN
    LOOP
      SELECT coalesce(jsonb_agg(jsonb_build_object('email',email,'provenance','account_email','profileId',profile_id,'userId',user_id)
        ORDER BY profile_id,user_id),'[]') INTO v_page
        FROM plugin_data.csf_class_publication_email_candidates(p_organization_id,p_term_id,p_cohort_id,'activity',p_activity_id,p_actor_user_id,v_offset,500);
      v_candidates:=v_candidates||v_page;
      EXIT WHEN jsonb_array_length(v_page)<500;
      v_offset:=v_offset+500;
    END LOOP;
  ELSIF p_cohort_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('email',plugin_data.csf_verified_account_email(a.user_id),
      'provenance','account_email','profileId',a.profile_id,'userId',a.user_id) ORDER BY a.profile_id,a.user_id),'[]') INTO v_candidates
    FROM plugin_data.csf_profile_accounts a
    JOIN plugin_data.csf_profiles p ON p.organization_id=a.organization_id AND p.id=a.profile_id AND p.record_status='active'
    JOIN plugin_data.csf_profile_cohort_memberships m ON m.organization_id=a.organization_id AND m.profile_id=a.profile_id AND m.cohort_id=p_cohort_id AND m.status='active'
    JOIN public.organization_members member ON member.organization_id=a.organization_id AND member.user_id=a.user_id AND member.status='active'
    WHERE a.organization_id=p_organization_id AND plugin_data.csf_publication_account_is_owned(p_organization_id,a.profile_id,a.user_id)
      AND (1=(SELECT count(*) FROM plugin_data.csf_profile_cohort_memberships c WHERE c.organization_id=p_organization_id AND c.profile_id=a.profile_id AND c.status='active')
        OR (member.role IN('admin','staff') AND plugin_data.csf_actor_has_permission(p_organization_id,a.user_id,'manage_opportunities')))
      AND EXISTS(SELECT 1 FROM public.organization_plugin_access WHERE organization_id=p_organization_id AND plugin_key='dvhs-csf' AND enabled AND is_accessible);
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('email',contact.email,'name',concat_ws(' ',coalesce(nullif(p.preferred_name,''),p.first_name),p.last_name),
      'provenance',CASE WHEN contact.preferred IS NULL THEN 'account_email' ELSE 'preferred_contact' END,
      'profileId',p.id,'userId',a.user_id,'preferredContactEmail',contact.preferred)) ORDER BY p.id),'[]') INTO v_candidates
    FROM plugin_data.csf_term_memberships m JOIN plugin_data.csf_profiles p
      ON p.organization_id=m.organization_id AND p.id=m.profile_id AND p.record_status='active'
    LEFT JOIN LATERAL(SELECT account.user_id FROM plugin_data.csf_profile_accounts account
      WHERE account.organization_id=p_organization_id AND account.profile_id=p.id
        AND plugin_data.csf_publication_account_is_owned(p_organization_id,p.id,account.user_id)
      ORDER BY account.is_primary DESC,account.linked_at DESC,account.id LIMIT 1) a ON true
    CROSS JOIN LATERAL(SELECT CASE
      WHEN plugin_data.csf_communication_email_is_storable(lower(btrim(p.personal_email))) THEN lower(btrim(p.personal_email))
      WHEN plugin_data.csf_communication_email_is_storable(lower(btrim(p.school_email))) THEN lower(btrim(p.school_email)) ELSE NULL END AS preferred) pref
    CROSS JOIN LATERAL(SELECT coalesce(pref.preferred,plugin_data.csf_verified_account_email(a.user_id)) AS email,pref.preferred) contact
    WHERE m.organization_id=p_organization_id AND m.term_id=p_term_id AND m.status IN('accepted','active','completed');
  END IF;
  SELECT coalesce(jsonb_agg(candidate ORDER BY candidate->>'profileId',candidate->>'userId'),'[]') INTO v_result
  FROM(SELECT DISTINCT ON(lower(btrim(value->>'email'))) value||jsonb_build_object('email',lower(btrim(value->>'email'))) candidate
    FROM jsonb_array_elements(v_candidates)
    WHERE plugin_data.csf_communication_email_is_storable(lower(btrim(value->>'email')))
      AND NOT EXISTS(SELECT 1 FROM public.notification_settings n WHERE n.user_id=nullif(value->>'userId','')::uuid AND (n.email_notifications=false OR n.organization_updates=false))
      AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_communication_broadcast_preferences pref WHERE pref.organization_id=p_organization_id
        AND pref.topic_key=v_topic->>'topicKey' AND pref.normalized_recipient_email=lower(btrim(value->>'email')) AND pref.subscription_state='unsubscribed')
    ORDER BY lower(btrim(value->>'email')),value->>'profileId',value->>'userId') deduped;
  RETURN jsonb_build_object('recipients',v_result,'topic',v_topic,'topicReady',coalesce(
    v_topic->>'topicKey' ~ '^[a-z0-9](?:[a-z0-9_.-]{0,62}[a-z0-9])?$' AND v_topic->>'topicKey'<>'transactional'
    AND v_topic->>'resendTopicId' ~ '^\S{1,128}$',false));
END; $$;

CREATE FUNCTION plugin_data.csf_capture_activity_email_intent(
 p_organization_id uuid,p_activity_id uuid,p_actor_user_id uuid,p_request_id uuid,p_email_requested boolean,p_email_topic jsonb,p_first_publication boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a plugin_data.csf_opportunities%ROWTYPE;e plugin_data.csf_publication_events%ROWTYPE;v_audience jsonb;
BEGIN
 SELECT * INTO a FROM plugin_data.csf_opportunities WHERE organization_id=p_organization_id AND id=p_activity_id;
 IF a.status IS DISTINCT FROM 'published' THEN RETURN '{}'::jsonb; END IF;
 SELECT * INTO e FROM plugin_data.csf_publication_events WHERE organization_id=p_organization_id AND source_kind='activity' AND source_id=p_activity_id AND event_key='' FOR UPDATE;
 IF e.id IS NULL THEN RAISE EXCEPTION 'The activity publication receipt is missing.'; END IF;
 IF e.activity_email_request_id=p_request_id THEN
   IF e.activity_email_requested IS DISTINCT FROM p_email_requested THEN RAISE EXCEPTION 'The publication email choice changed for this request.' USING ERRCODE='22023'; END IF;
   RETURN jsonb_build_object('emailEventId',e.id,'emailStatus',e.activity_email_state,'emailRequested',coalesce(e.activity_email_requested,false),'emailRecipientCount',coalesce(jsonb_array_length(e.activity_email_snapshot->'recipients'),0));
 END IF;
 IF NOT p_first_publication OR e.activity_email_requested IS NOT NULL THEN
   RETURN jsonb_build_object('emailEventId',e.id,'emailStatus',e.activity_email_state,'emailRequested',coalesce(e.activity_email_requested,false),'emailRecipientCount',coalesce(jsonb_array_length(e.activity_email_snapshot->'recipients'),0));
 END IF;
 IF p_email_requested THEN
   v_audience:=plugin_data.csf_activity_email_audience_snapshot(p_organization_id,p_actor_user_id,a.term_id,a.cohort_id,a.id);
   IF (v_audience->>'topicReady')::boolean IS DISTINCT FROM true OR p_email_topic IS DISTINCT FROM v_audience->'topic' THEN
     RAISE EXCEPTION 'Activity email settings changed. Reload before publishing.' USING ERRCODE='55000'; END IF;
 END IF;
 UPDATE plugin_data.csf_publication_events SET activity_email_requested=p_email_requested,
   activity_email_actor_id=p_actor_user_id,activity_email_request_id=p_request_id,
   activity_email_snapshot=CASE WHEN p_email_requested THEN v_audience||jsonb_build_object('sourceSnapshot',to_jsonb(a)) END,
   activity_email_state=CASE WHEN NOT p_email_requested THEN 'not_requested' WHEN jsonb_array_length(v_audience->'recipients')=0 THEN 'blocked' ELSE 'pending' END,
   activity_email_error_code=CASE WHEN p_email_requested AND jsonb_array_length(v_audience->'recipients')=0 THEN 'no_recipients' END,
   activity_email_next_attempt_at=CASE WHEN p_email_requested THEN now() END
 WHERE id=e.id RETURNING * INTO e;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data,correlation_id,reason_code)
 VALUES(p_organization_id,p_actor_user_id,'activity.email_intent','csf_publication_events',e.id,
 jsonb_build_object('activityId',p_activity_id,'publicationRequestId',p_request_id,'requested',p_email_requested,'recipientCount',coalesce(jsonb_array_length(v_audience->'recipients'),0)),gen_random_uuid(),'first_publication_email_choice');
 RETURN jsonb_build_object('emailEventId',e.id,'emailStatus',e.activity_email_state,'emailRequested',coalesce(e.activity_email_requested,false),'emailRecipientCount',coalesce(jsonb_array_length(e.activity_email_snapshot->'recipients'),0));
END; $$;

CREATE FUNCTION plugin_data.csf_create_activity_with_email(
 p_organization_id uuid,p_term_id uuid,p_cohort_id uuid,p_activity jsonb,p_actor_user_id uuid,p_request_id uuid,p_email_requested boolean,p_email_topic jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
 IF p_email_requested IS NULL THEN RAISE EXCEPTION 'Choose whether to email this publication.'; END IF;
 v_result:=plugin_data.csf_create_activity(p_organization_id,p_term_id,p_cohort_id,p_activity,p_actor_user_id,p_request_id);
 RETURN v_result||plugin_data.csf_capture_activity_email_intent(p_organization_id,(v_result->>'activityId')::uuid,p_actor_user_id,p_request_id,p_email_requested,p_email_topic,
   coalesce((v_result->>'idempotent')::boolean,false)=false);
END; $$;

CREATE FUNCTION plugin_data.csf_set_activity_status_with_email(
 p_organization_id uuid,p_activity_id uuid,p_status text,p_reason text,p_actor_user_id uuid,p_request_id uuid,p_email_requested boolean,p_email_topic jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;v_had_event boolean;
BEGIN
 IF p_email_requested IS NULL THEN RAISE EXCEPTION 'Choose whether to email this publication.'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 SELECT EXISTS(SELECT 1 FROM plugin_data.csf_publication_events WHERE organization_id=p_organization_id AND source_kind='activity' AND source_id=p_activity_id AND event_key='') INTO v_had_event;
 v_result:=plugin_data.csf_set_activity_status(p_organization_id,p_activity_id,p_status,p_reason,p_actor_user_id,p_request_id);
 RETURN v_result||plugin_data.csf_capture_activity_email_intent(p_organization_id,p_activity_id,p_actor_user_id,p_request_id,p_email_requested,p_email_topic,
   NOT v_had_event AND coalesce((v_result->>'idempotent')::boolean,false)=false);
END; $$;

CREATE FUNCTION plugin_data.csf_preview_activity_email(p_organization_id uuid,p_actor_user_id uuid,p_term_id uuid,p_cohort_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb;
BEGIN
 s:=plugin_data.csf_activity_email_audience_snapshot(p_organization_id,p_actor_user_id,p_term_id,p_cohort_id,NULL);
 RETURN jsonb_build_object('recipients',jsonb_array_length(s->'recipients'),'topicReady',s->'topicReady');
END; $$;

CREATE FUNCTION plugin_data.csf_read_activity_email_preparation(p_organization_id uuid,p_activity_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e plugin_data.csf_publication_events%ROWTYPE;
BEGIN
 IF plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_opportunities') IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Not authorized to read activity email status.' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM plugin_data.csf_publication_events WHERE organization_id=p_organization_id AND source_kind='activity' AND source_id=p_activity_id AND event_key='';
 RETURN jsonb_build_object('eventId',e.id,'status',coalesce(e.activity_email_state,'not_requested'),'attempts',coalesce(e.activity_email_attempts,0),
 'recipientCount',coalesce(jsonb_array_length(e.activity_email_snapshot->'recipients'),0),'campaignId',e.activity_email_campaign_id,
 'errorCode',e.activity_email_error_code,'requested',coalesce(e.activity_email_requested,false));
END; $$;

CREATE FUNCTION plugin_data.csf_bind_activity_email_campaign()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e plugin_data.csf_publication_events%ROWTYPE;
BEGIN
 IF NEW.source_activity_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO e FROM plugin_data.csf_publication_events WHERE organization_id=NEW.organization_id AND source_kind='activity'
   AND source_id=NEW.source_activity_id AND event_key='' AND activity_email_requested FOR UPDATE;
 IF e.id IS NULL THEN RETURN NEW; END IF;
 IF e.activity_email_campaign_id IS NOT NULL AND e.activity_email_campaign_id<>NEW.id THEN
   RAISE EXCEPTION 'This publication already has its one email campaign.' USING ERRCODE='55000'; END IF;
 UPDATE plugin_data.csf_publication_events SET activity_email_campaign_id=NEW.id WHERE id=e.id;
 RETURN NEW;
END; $$;
CREATE TRIGGER csf_bind_activity_email_campaign AFTER INSERT ON plugin_data.csf_communication_campaigns
 FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_bind_activity_email_campaign();

CREATE FUNCTION plugin_data.csf_claim_activity_email_preparations(p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e plugin_data.csf_publication_events%ROWTYPE;a plugin_data.csf_opportunities%ROWTYPE;c plugin_data.csf_communication_campaigns%ROWTYPE;candidate record;
 v_result jsonb:='[]';v_token uuid;v_error text;v_topic jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>25 THEN RAISE EXCEPTION 'Choose 1 to 25 activity emails.'; END IF;
 FOR candidate IN SELECT id,organization_id FROM plugin_data.csf_publication_events WHERE activity_email_requested
   AND ((activity_email_state='pending' AND activity_email_next_attempt_at<=now()) OR (activity_email_state='processing' AND activity_email_lease_expires_at<=clock_timestamp()))
   ORDER BY organization_id,activity_email_next_attempt_at,id LIMIT p_limit LOOP
   PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(candidate.organization_id));
   SELECT * INTO e FROM plugin_data.csf_publication_events WHERE id=candidate.id AND
     ((activity_email_state='pending' AND activity_email_next_attempt_at<=now()) OR (activity_email_state='processing' AND activity_email_lease_expires_at<=clock_timestamp()))
     FOR UPDATE SKIP LOCKED;
   IF NOT FOUND THEN CONTINUE; END IF;
   v_error:=NULL;
   IF plugin_data.csf_actor_has_permission(e.organization_id,e.activity_email_actor_id,'manage_opportunities') IS DISTINCT FROM true THEN v_error:='unauthorized'; END IF;
   SELECT * INTO a FROM plugin_data.csf_opportunities WHERE organization_id=e.organization_id AND id=e.source_id;
   IF a.status IS DISTINCT FROM 'published' OR a.term_id::text IS DISTINCT FROM e.activity_email_snapshot#>>'{sourceSnapshot,term_id}'
     OR a.cohort_id::text IS DISTINCT FROM e.activity_email_snapshot#>>'{sourceSnapshot,cohort_id}' THEN v_error:='source_changed'; END IF;
   SELECT configuration#>'{communications,broadcastTopics,term_members}' INTO v_topic FROM public.organization_plugin_installs
     WHERE organization_id=e.organization_id AND plugin_key='dvhs-csf' AND enabled;
   IF v_topic IS DISTINCT FROM e.activity_email_snapshot->'topic' THEN v_error:='topic_changed'; END IF;
   IF e.activity_email_campaign_id IS NOT NULL THEN
     SELECT * INTO c FROM plugin_data.csf_communication_campaigns WHERE organization_id=e.organization_id AND id=e.activity_email_campaign_id;
     IF c.status IN('cancelled','failed') OR c.review_blocked_at IS NOT NULL THEN v_error:='campaign_requires_review'; END IF;
   END IF;
   IF e.activity_email_attempts>=5 THEN v_error:='retry_limit'; END IF;
   IF v_error IS NOT NULL THEN
     UPDATE plugin_data.csf_publication_events SET activity_email_state='blocked',activity_email_error_code=v_error,
       activity_email_lease_token=NULL,activity_email_lease_expires_at=NULL WHERE id=e.id;
     CONTINUE;
   END IF;
   v_token:=gen_random_uuid();
   UPDATE plugin_data.csf_publication_events SET activity_email_state='processing',activity_email_attempts=activity_email_attempts+1,
     activity_email_lease_token=v_token,activity_email_lease_expires_at=clock_timestamp()+interval '5 minutes',activity_email_error_code=NULL WHERE id=e.id;
   v_result:=v_result||jsonb_build_array(jsonb_build_object('eventId',e.id,'organizationId',e.organization_id,'activityId',e.source_id,
     'actorUserId',e.activity_email_actor_id,'leaseToken',v_token,'sourceSnapshot',e.activity_email_snapshot->'sourceSnapshot',
     'recipients',e.activity_email_snapshot->'recipients','topic',e.activity_email_snapshot->'topic','attempts',e.activity_email_attempts+1,'campaignId',e.activity_email_campaign_id));
 END LOOP;
 RETURN v_result;
END; $$;

CREATE FUNCTION plugin_data.csf_finish_activity_email_preparation(p_organization_id uuid,p_event_id uuid,p_lease_token uuid,p_campaign_id uuid,p_error_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e plugin_data.csf_publication_events%ROWTYPE;c plugin_data.csf_communication_campaigns%ROWTYPE;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 SELECT * INTO e FROM plugin_data.csf_publication_events WHERE organization_id=p_organization_id AND id=p_event_id FOR UPDATE;
 IF e.id IS NULL OR e.activity_email_state<>'processing' OR e.activity_email_lease_token IS DISTINCT FROM p_lease_token OR e.activity_email_lease_expires_at<=clock_timestamp() THEN
   RAISE EXCEPTION 'This activity email preparation lease is stale.' USING ERRCODE='55000'; END IF;
 IF plugin_data.csf_actor_has_permission(p_organization_id,e.activity_email_actor_id,'manage_opportunities') IS DISTINCT FROM true THEN p_error_code:='unauthorized'; END IF;
 IF p_error_code IS NULL THEN
   SELECT * INTO c FROM plugin_data.csf_communication_campaigns WHERE organization_id=p_organization_id AND id=p_campaign_id;
   IF c.id IS NULL OR c.id IS DISTINCT FROM e.activity_email_campaign_id OR c.source_activity_id IS DISTINCT FROM e.source_id
     OR c.status NOT IN('queued','sending','completed') OR c.review_blocked_at IS NOT NULL THEN
     RAISE EXCEPTION 'The activity email campaign outcome needs review.' USING ERRCODE='55000'; END IF;
 ELSIF p_error_code NOT IN('transient','unauthorized','source_changed','topic_changed','no_recipients','campaign_requires_review','review_required','retry_limit') THEN
   p_error_code:='campaign_requires_review';
 END IF;
 UPDATE plugin_data.csf_publication_events SET activity_email_state=CASE WHEN p_error_code IS NULL THEN 'queued' WHEN p_error_code='transient' AND activity_email_attempts<5 THEN 'pending' ELSE 'blocked' END,
 activity_email_error_code=p_error_code,activity_email_next_attempt_at=now()+interval '1 minute'*greatest(activity_email_attempts,1),activity_email_lease_token=NULL,activity_email_lease_expires_at=NULL
 WHERE id=e.id RETURNING * INTO e;
 RETURN jsonb_build_object('eventId',e.id,'status',e.activity_email_state,'campaignId',e.activity_email_campaign_id);
END; $$;

CREATE FUNCTION plugin_data.csf_retry_activity_email_preparation(p_organization_id uuid,p_event_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e plugin_data.csf_publication_events%ROWTYPE;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_opportunities') IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Not authorized to retry this activity email.' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM plugin_data.csf_publication_events WHERE organization_id=p_organization_id AND id=p_event_id AND activity_email_requested FOR UPDATE;
 IF e.id IS NULL OR e.activity_email_state NOT IN('pending','blocked') OR e.activity_email_error_code IN('no_recipients','campaign_requires_review','review_required') THEN
   RAISE EXCEPTION 'This activity email needs review and cannot be retried.' USING ERRCODE='55000'; END IF;
 UPDATE plugin_data.csf_publication_events SET activity_email_state='pending',activity_email_attempts=0,activity_email_next_attempt_at=now(),activity_email_error_code=NULL WHERE id=e.id;
 RETURN jsonb_build_object('eventId',e.id,'status','pending');
END; $$;

CREATE FUNCTION plugin_data.csf_guard_activity_email_intent_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.activity_email_requested IS NOT NULL AND ROW(NEW.activity_email_requested,NEW.activity_email_actor_id,NEW.activity_email_request_id,NEW.activity_email_snapshot)
   IS DISTINCT FROM ROW(OLD.activity_email_requested,OLD.activity_email_actor_id,OLD.activity_email_request_id,OLD.activity_email_snapshot) THEN
   RAISE EXCEPTION 'An activity publication email snapshot is immutable.' USING ERRCODE='55000'; END IF;
 IF OLD.activity_email_campaign_id IS NOT NULL AND NEW.activity_email_campaign_id IS DISTINCT FROM OLD.activity_email_campaign_id THEN
   RAISE EXCEPTION 'The publication email campaign cannot be replaced.' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER csf_guard_activity_email_intent_snapshot BEFORE UPDATE ON plugin_data.csf_publication_events
 FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_activity_email_intent_snapshot();

CREATE FUNCTION plugin_data.csf_open_activity_email_preparation_campaign(
 p_organization_id uuid,p_event_id uuid,p_lease_token uuid,p_subject text,p_body_text text,p_body_html text,p_tags jsonb,p_correlation_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e plugin_data.csf_publication_events%ROWTYPE;a plugin_data.csf_opportunities%ROWTYPE;v_topic jsonb;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 SELECT * INTO e FROM plugin_data.csf_publication_events WHERE organization_id=p_organization_id AND id=p_event_id;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Activity email preparation was not found.' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('csf-activity-email:'||p_organization_id::text||':'||e.source_id::text,0));
 SELECT * INTO a FROM plugin_data.csf_opportunities WHERE organization_id=p_organization_id AND id=e.source_id FOR SHARE;
 SELECT * INTO e FROM plugin_data.csf_publication_events WHERE organization_id=p_organization_id AND id=p_event_id FOR UPDATE;
 IF e.activity_email_state<>'processing' OR e.activity_email_lease_token IS DISTINCT FROM p_lease_token OR e.activity_email_lease_expires_at<=clock_timestamp() THEN
   RAISE EXCEPTION 'This activity email preparation lease is stale.' USING ERRCODE='55000'; END IF;
 IF plugin_data.csf_actor_has_permission(p_organization_id,e.activity_email_actor_id,'manage_opportunities') IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Not authorized to prepare this activity email.' USING ERRCODE='42501'; END IF;
 IF a.status IS DISTINCT FROM 'published' OR a.term_id::text IS DISTINCT FROM e.activity_email_snapshot#>>'{sourceSnapshot,term_id}'
   OR a.cohort_id::text IS DISTINCT FROM e.activity_email_snapshot#>>'{sourceSnapshot,cohort_id}' THEN
   RAISE EXCEPTION 'The activity email source scope changed.' USING ERRCODE='55000'; END IF;
 SELECT configuration#>'{communications,broadcastTopics,term_members}' INTO v_topic FROM public.organization_plugin_installs
   WHERE organization_id=p_organization_id AND plugin_key='dvhs-csf' AND enabled FOR SHARE;
 IF v_topic IS DISTINCT FROM e.activity_email_snapshot->'topic' THEN RAISE EXCEPTION 'The activity email topic changed.' USING ERRCODE='55000'; END IF;
 IF e.activity_email_campaign_id IS NOT NULL AND EXISTS(SELECT 1 FROM plugin_data.csf_communication_campaigns WHERE id=e.activity_email_campaign_id
   AND (status IN('cancelled','failed') OR review_blocked_at IS NOT NULL)) THEN
   RAISE EXCEPTION 'The existing activity email campaign needs review.' USING ERRCODE='55000'; END IF;
 RETURN plugin_data.csf_create_activity_email_campaign_draft(p_organization_id,e.source_id,p_subject,p_body_text,e.activity_email_actor_id,
   a.term_id,CASE WHEN a.cohort_id IS NULL THEN 'term_members' ELSE 'cohort_members' END,p_body_html,
   v_topic->>'topicKey',v_topic->>'resendTopicId',p_tags,p_correlation_id,a.cohort_id);
END; $$;

CREATE FUNCTION plugin_data.csf_guard_activity_email_frozen_recipient()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e plugin_data.csf_publication_events%ROWTYPE;
BEGIN
 SELECT event.* INTO e FROM plugin_data.csf_communication_campaigns campaign JOIN plugin_data.csf_publication_events event
   ON event.organization_id=campaign.organization_id AND event.source_kind='activity' AND event.source_id=campaign.source_activity_id AND event.event_key=''
   WHERE campaign.organization_id=NEW.organization_id AND campaign.id=NEW.campaign_id AND event.activity_email_requested;
 IF e.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.activity_email_snapshot->'recipients') candidate
   WHERE candidate->>'email'=lower(btrim(NEW.recipient_email)) AND nullif(candidate->>'profileId','')::uuid IS NOT DISTINCT FROM NEW.profile_id
     AND nullif(candidate->>'userId','')::uuid IS NOT DISTINCT FROM NEW.user_id) THEN
   RAISE EXCEPTION 'This recipient was not in the published activity email audience.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER csf_guard_activity_email_frozen_recipient BEFORE INSERT ON plugin_data.csf_communication_recipient_snapshots
 FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_activity_email_frozen_recipient();

CREATE FUNCTION plugin_data.csf_finalize_activity_email_preparation_campaign(
 p_organization_id uuid,p_event_id uuid,p_lease_token uuid,p_campaign_id uuid,p_expected_included_count integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e plugin_data.csf_publication_events%ROWTYPE;a plugin_data.csf_opportunities%ROWTYPE;c plugin_data.csf_communication_campaigns%ROWTYPE;v_topic jsonb;v_result jsonb;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('csf-communication-audience:'||p_organization_id::text||':'||p_campaign_id::text,0));
 SELECT * INTO c FROM plugin_data.csf_communication_campaigns WHERE organization_id=p_organization_id AND id=p_campaign_id FOR UPDATE;
 IF c.id IS NULL OR c.source_activity_id IS NULL THEN RAISE EXCEPTION 'Activity email campaign was not found.' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM plugin_data.csf_opportunities WHERE organization_id=p_organization_id AND id=c.source_activity_id FOR SHARE;
 SELECT * INTO e FROM plugin_data.csf_publication_events WHERE organization_id=p_organization_id AND id=p_event_id FOR UPDATE;
 IF e.id IS NULL OR e.activity_email_state<>'processing' OR e.activity_email_lease_token IS DISTINCT FROM p_lease_token
   OR e.activity_email_lease_expires_at<=clock_timestamp() OR e.activity_email_campaign_id IS DISTINCT FROM p_campaign_id OR e.source_id<>a.id THEN
   RAISE EXCEPTION 'This activity email preparation lease is stale.' USING ERRCODE='55000'; END IF;
 IF plugin_data.csf_actor_has_permission(p_organization_id,e.activity_email_actor_id,'manage_opportunities') IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Not authorized to queue this activity email.' USING ERRCODE='42501'; END IF;
 IF a.status IS DISTINCT FROM 'published' OR a.term_id::text IS DISTINCT FROM e.activity_email_snapshot#>>'{sourceSnapshot,term_id}'
   OR a.cohort_id::text IS DISTINCT FROM e.activity_email_snapshot#>>'{sourceSnapshot,cohort_id}' OR c.status IN('cancelled','failed') OR c.review_blocked_at IS NOT NULL THEN
   RAISE EXCEPTION 'This activity email source or campaign needs review.' USING ERRCODE='55000'; END IF;
 SELECT configuration#>'{communications,broadcastTopics,term_members}' INTO v_topic FROM public.organization_plugin_installs
   WHERE organization_id=p_organization_id AND plugin_key='dvhs-csf' AND enabled FOR SHARE;
 IF v_topic IS DISTINCT FROM e.activity_email_snapshot->'topic' THEN RAISE EXCEPTION 'The activity email topic changed.' USING ERRCODE='55000'; END IF;
 PERFORM pg_catalog.set_config('plugin_data.csf_activity_email_preparation_fence',jsonb_build_object('eventId',e.id,'leaseToken',p_lease_token)::text,true);
 v_result:=plugin_data.csf_finalize_communication_recipient_snapshot(p_organization_id,p_campaign_id,p_expected_included_count);
 PERFORM pg_catalog.set_config('plugin_data.csf_activity_email_preparation_fence','',true);
 RETURN v_result;
END; $$;

CREATE FUNCTION plugin_data.csf_guard_activity_email_queue_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e plugin_data.csf_publication_events%ROWTYPE;v_fence jsonb;
BEGIN
 IF OLD.status<>'draft' OR NEW.status<>'queued' OR NEW.source_activity_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO e FROM plugin_data.csf_publication_events WHERE organization_id=NEW.organization_id AND source_kind='activity'
   AND source_id=NEW.source_activity_id AND event_key='' AND activity_email_requested;
 IF e.id IS NULL THEN RETURN NEW; END IF;
 v_fence:=nullif(pg_catalog.current_setting('plugin_data.csf_activity_email_preparation_fence',true),'')::jsonb;
 IF e.activity_email_state<>'processing' OR e.activity_email_lease_expires_at<=clock_timestamp()
   OR v_fence->>'eventId' IS DISTINCT FROM e.id::text OR v_fence->>'leaseToken' IS DISTINCT FROM e.activity_email_lease_token::text THEN
   RAISE EXCEPTION 'Queue this activity email through its current preparation lease.' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER csf_guard_activity_email_queue_transition BEFORE UPDATE ON plugin_data.csf_communication_campaigns
 FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_activity_email_queue_transition();
REVOKE ALL ON FUNCTION plugin_data.csf_guard_activity_email_queue_transition() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_activity_email_queue_transition() TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_finalize_activity_email_preparation_campaign(uuid,uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finalize_activity_email_preparation_campaign(uuid,uuid,uuid,uuid,integer) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_guard_activity_email_intent_snapshot(),plugin_data.csf_guard_activity_email_frozen_recipient() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_activity_email_intent_snapshot(),plugin_data.csf_guard_activity_email_frozen_recipient() TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_open_activity_email_preparation_campaign(uuid,uuid,uuid,text,text,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_open_activity_email_preparation_campaign(uuid,uuid,uuid,text,text,text,jsonb,text) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_activity_email_audience_snapshot(uuid,uuid,uuid,uuid,uuid),plugin_data.csf_capture_activity_email_intent(uuid,uuid,uuid,uuid,boolean,jsonb,boolean),plugin_data.csf_bind_activity_email_campaign() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_activity_email_audience_snapshot(uuid,uuid,uuid,uuid,uuid),plugin_data.csf_capture_activity_email_intent(uuid,uuid,uuid,uuid,boolean,jsonb,boolean),plugin_data.csf_bind_activity_email_campaign() TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_create_activity_with_email(uuid,uuid,uuid,jsonb,uuid,uuid,boolean,jsonb),plugin_data.csf_set_activity_status_with_email(uuid,uuid,text,text,uuid,uuid,boolean,jsonb),plugin_data.csf_preview_activity_email(uuid,uuid,uuid,uuid),plugin_data.csf_read_activity_email_preparation(uuid,uuid,uuid),plugin_data.csf_claim_activity_email_preparations(integer),plugin_data.csf_finish_activity_email_preparation(uuid,uuid,uuid,uuid,text),plugin_data.csf_retry_activity_email_preparation(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_activity_with_email(uuid,uuid,uuid,jsonb,uuid,uuid,boolean,jsonb),plugin_data.csf_set_activity_status_with_email(uuid,uuid,text,text,uuid,uuid,boolean,jsonb),plugin_data.csf_preview_activity_email(uuid,uuid,uuid,uuid),plugin_data.csf_read_activity_email_preparation(uuid,uuid,uuid),plugin_data.csf_claim_activity_email_preparations(integer),plugin_data.csf_finish_activity_email_preparation(uuid,uuid,uuid,uuid,text),plugin_data.csf_retry_activity_email_preparation(uuid,uuid,uuid) TO service_role;
COMMIT;
