-- Preflight and local cleanup share a transaction. External APIs consume a
-- leased receipt after commit and can resume without repeating the DB phase.
BEGIN;
ALTER TABLE app_private.account_deletion_operations ADD COLUMN reason text CHECK (length(reason)<=1000);

CREATE FUNCTION private.organization_has_other_active_admin(p_organization uuid,p_membership uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.organization_members member
  WHERE member.organization_id=p_organization AND member.id<>p_membership
   AND member.role='admin' AND member.status='active'
   AND app_private.account_deletion_actor_is_active(member.user_id));
$$;
REVOKE ALL ON FUNCTION private.organization_has_other_active_admin(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.organization_has_other_active_admin(uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION private.protect_organization_membership_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF current_user NOT IN ('postgres','service_role') AND
  (NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
  RAISE EXCEPTION 'organization membership identity is immutable' USING ERRCODE='42501';
 END IF;
 IF current_user<>'postgres' AND OLD.role='admin' AND
  (NEW.role IS DISTINCT FROM 'admin' OR (OLD.status='active' AND NEW.status IS DISTINCT FROM 'active')
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-org-membership:' || OLD.organization_id::text,0));
  IF NOT private.organization_has_other_active_admin(OLD.organization_id,OLD.id) THEN
   RAISE EXCEPTION 'cannot remove the final active organization admin' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_organization_membership_identity() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.protect_organization_membership_identity() TO service_role;

CREATE FUNCTION app_private.account_deletion_personal_object(p_user uuid, p_bucket text, p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT coalesce((p_bucket = 'avatars' AND p_name ~ ('^' || p_user::text || '-[a-fA-F0-9.-]+\.(jpg|jpeg|png|webp)$'))
  OR (p_bucket = 'data-exports' AND starts_with(p_name, p_user::text || '/') AND p_name !~ '(^|/)\.\.(/|$)'), false);
$$;
REVOKE ALL ON FUNCTION app_private.account_deletion_personal_object(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.account_deletion_personal_object(uuid,text,text) TO service_role;

CREATE FUNCTION app_private.account_deletion_storage_fence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target uuid;
BEGIN
 FOR target IN SELECT DISTINCT candidate FROM (
   SELECT NEW.owner AS candidate
   UNION ALL SELECT CASE WHEN NEW.owner_id ~ '^[a-fA-F0-9-]{36}$' THEN NEW.owner_id::uuid END
   UNION ALL SELECT CASE WHEN NEW.bucket_id IN ('avatars','data-exports')
    AND NEW.name ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}[-/]'
    THEN left(NEW.name,36)::uuid END
 ) candidates WHERE candidate IS NOT NULL ORDER BY 1 LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || target::text,0));
   IF NOT app_private.account_deletion_actor_is_active(target) THEN
     RAISE EXCEPTION 'Storage writes are blocked for an account being deleted.' USING ERRCODE='42501';
   END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.account_deletion_storage_fence() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.account_deletion_storage_fence() TO service_role;
CREATE TRIGGER account_deletion_storage_reference_fence BEFORE INSERT OR UPDATE ON storage.objects
 FOR EACH ROW EXECUTE FUNCTION app_private.account_deletion_storage_fence();

CREATE FUNCTION app_private.account_deletion_authorize(p_actor uuid,p_target uuid,p_mode text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF p_actor IS NULL OR p_target IS NULL OR p_mode IS NULL OR p_mode NOT IN ('self_delete','admin_blacklist')
  OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_actor)
  OR (p_mode='self_delete' AND p_actor<>p_target)
  OR (p_mode='admin_blacklist' AND (p_actor=p_target OR NOT EXISTS (
   SELECT 1 FROM auth.users WHERE id=p_actor AND
    (raw_app_meta_data->>'is_super_admin'='true' OR lower(btrim(raw_app_meta_data->>'role'))='super_admin')))) THEN
  RAISE EXCEPTION 'Account deletion is not authorized.' USING ERRCODE='42501';
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION app_private.account_deletion_authorize(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.account_deletion_authorize(uuid,uuid,text) TO service_role;

CREATE FUNCTION app_private.account_deletion_blockers(p_target uuid,p_delete_projects boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb := '{}'::jsonb; found_count bigint; relation record; orgs jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('organization_id',o.id,'organization_name',o.name)), '[]') INTO orgs
 FROM public.organization_members m JOIN public.organizations o ON o.id=m.organization_id
 WHERE m.user_id=p_target AND m.role='admin' AND NOT EXISTS (
  SELECT 1 FROM public.organization_members other WHERE other.organization_id=m.organization_id
   AND other.user_id<>p_target AND other.role='admin' AND other.status='active'
   AND app_private.account_deletion_actor_is_active(other.user_id));
 IF jsonb_array_length(orgs)>0 THEN result:=result||jsonb_build_object('sole_admin_organizations',orgs); END IF;
 SELECT count(*) INTO found_count FROM public.organization_sheet_syncs WHERE created_by=p_target;
 IF found_count>0 THEN result:=result||jsonb_build_object('sheet_sync_ownership',found_count); END IF;
 SELECT count(*) INTO found_count FROM public.projects WHERE reviewed_by=p_target AND creator_id<>p_target;
 IF found_count>0 THEN result:=result||jsonb_build_object('project_review_references',found_count); END IF;
 SELECT count(*) INTO found_count FROM public.projects WHERE creator_id=p_target
  AND (NOT p_delete_projects OR organization_id IS NOT NULL);
 IF found_count>0 THEN result:=result||jsonb_build_object('project_ownership',found_count); END IF;
 SELECT count(*) INTO found_count FROM public.project_signups s JOIN public.projects p ON p.id=s.project_id
 WHERE p.creator_id=p_target AND s.user_id IS DISTINCT FROM p_target;
 SELECT found_count+count(*) INTO found_count FROM public.anonymous_signups s JOIN public.projects p ON p.id=s.project_id
 WHERE p.creator_id=p_target;
 SELECT found_count+count(*) INTO found_count FROM public.project_feedback f JOIN public.projects p ON p.id=f.project_id
 WHERE p.creator_id=p_target AND f.user_id IS DISTINCT FROM p_target;
 IF found_count>0 THEN result:=result||jsonb_build_object('other_project_participants',found_count); END IF;
 SELECT count(*) INTO found_count FROM public.waiver_signatures w WHERE w.user_id=p_target
  OR w.project_id IN (SELECT id FROM public.projects WHERE creator_id=p_target);
 IF found_count>0 THEN result:=result||jsonb_build_object('retained_waiver_evidence',found_count); END IF;
 SELECT count(*) INTO found_count FROM public.account_data_export_jobs WHERE user_id=p_target AND status='processing';
 IF found_count>0 THEN result:=result||jsonb_build_object('export_in_progress',found_count); END IF;
 SELECT count(*) INTO found_count FROM public.user_calendar_connections WHERE user_id=p_target;
 IF found_count>0 THEN result:=result||jsonb_build_object('connected_provider_accounts',found_count); END IF;
 SELECT count(*) INTO found_count FROM public.projects WHERE creator_id=p_target AND creator_calendar_event_id IS NOT NULL;
 SELECT found_count+count(*) INTO found_count FROM public.project_signups WHERE user_id=p_target AND volunteer_calendar_event_id IS NOT NULL;
 IF to_regclass('app_private.personal_calendar_sync_receipts') IS NOT NULL THEN
  EXECUTE 'SELECT $2+count(*) FROM app_private.personal_calendar_sync_receipts WHERE user_id=$1 AND phase<>''removed''
    AND (jsonb_array_length(events)>0 OR legacy_event_id IS NOT NULL)' INTO found_count USING p_target,found_count;
 END IF;
 IF found_count>0 THEN result:=result||jsonb_build_object('calendar_cleanup_required',found_count); END IF;
 -- Any plugin user/project reference requires its own reviewed retention or
 -- transfer workflow. Account deletion must not cascade through that evidence.
 FOR relation IN SELECT DISTINCT c.conrelid::regclass AS table_name,a.attname,c.confrelid
  FROM pg_constraint c JOIN pg_namespace n ON n.oid=(SELECT relnamespace FROM pg_class WHERE oid=c.conrelid)
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
  WHERE c.contype='f' AND cardinality(c.conkey)=1 AND n.nspname='plugin_data'
   AND c.confrelid IN ('auth.users'::regclass,'public.profiles'::regclass,'public.projects'::regclass,'public.project_signups'::regclass)
 LOOP
  IF relation.confrelid IN ('auth.users'::regclass,'public.profiles'::regclass) THEN
   EXECUTE format('SELECT count(*) FROM %s WHERE %I=$1',relation.table_name,relation.attname) INTO found_count USING p_target;
  ELSIF relation.confrelid='public.projects'::regclass THEN
   EXECUTE format('SELECT count(*) FROM %s WHERE %I IN (SELECT id FROM public.projects WHERE creator_id=$1)',relation.table_name,relation.attname)
    INTO found_count USING p_target;
  ELSE
   EXECUTE format('SELECT count(*) FROM %s WHERE %I IN (SELECT id FROM public.project_signups WHERE user_id=$1)',relation.table_name,relation.attname)
    INTO found_count USING p_target;
  END IF;
  IF found_count>0 THEN result:=result||jsonb_build_object('plugin_retention_review_required',true); EXIT; END IF;
 END LOOP;
 SELECT count(*) INTO found_count FROM storage.objects o
 WHERE (o.owner=p_target OR o.owner_id=p_target::text)
 AND NOT app_private.account_deletion_personal_object(p_target,o.bucket_id,o.name);
 IF found_count>0 THEN result:=result||jsonb_build_object('retained_storage_ownership',found_count); END IF;
 SELECT count(*) INTO found_count FROM storage.objects o
 WHERE app_private.account_deletion_personal_object(p_target,o.bucket_id,o.name)
 AND ((o.owner IS NOT NULL AND o.owner<>p_target) OR (o.owner_id IS NOT NULL AND o.owner_id<>p_target::text));
 IF found_count>0 THEN result:=result||jsonb_build_object('storage_owner_conflict',found_count); END IF;
 SELECT count(*) INTO found_count FROM storage.objects o
 WHERE app_private.account_deletion_personal_object(p_target,o.bucket_id,o.name);
 IF found_count>500 THEN result:=result||jsonb_build_object('storage_cleanup_limit',found_count); END IF;
 -- Preserve paper attendance and published-hours receipts for reviewed retention.
 SELECT count(*) INTO found_count FROM public.hours_publication_receipts WHERE project_id IN (SELECT id FROM public.projects WHERE creator_id=p_target);
 SELECT found_count+count(*) INTO found_count FROM public.project_paper_scan_batches WHERE project_id IN (SELECT id FROM public.projects WHERE creator_id=p_target);
 SELECT found_count+count(*) INTO found_count FROM public.project_paper_roster_entries WHERE project_id IN (SELECT id FROM public.projects WHERE creator_id=p_target);
 SELECT found_count+count(*) INTO found_count FROM public.paper_signup_notification_outbox WHERE project_id IN (SELECT id FROM public.projects WHERE creator_id=p_target);
 SELECT found_count+count(*) INTO found_count FROM public.organization_calendar_events WHERE project_id IN (SELECT id FROM public.projects WHERE creator_id=p_target);
 SELECT found_count+count(*) INTO found_count FROM private.project_series_end_receipts WHERE project_id IN (SELECT id FROM public.projects WHERE creator_id=p_target);
 IF found_count>0 THEN result:=result||jsonb_build_object('retained_project_evidence',found_count); END IF;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION app_private.account_deletion_blockers(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.account_deletion_blockers(uuid,boolean) TO service_role;

CREATE FUNCTION public.preflight_account_deletion(p_actor uuid,p_target uuid,p_mode text DEFAULT 'self_delete',p_delete_projects boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM app_private.account_deletion_authorize(p_actor,p_target,p_mode);
 IF p_delete_projects IS NULL THEN RAISE EXCEPTION 'Deletion intent is required.' USING ERRCODE='22023'; END IF;
 RETURN app_private.account_deletion_blockers(p_target,p_delete_projects);
END;
$$;
REVOKE ALL ON FUNCTION public.preflight_account_deletion(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.preflight_account_deletion(uuid,uuid,text,boolean) TO service_role;

CREATE FUNCTION public.begin_account_deletion(p_actor uuid,p_target uuid,p_mode text DEFAULT 'self_delete',p_delete_projects boolean DEFAULT true,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE operation app_private.account_deletion_operations; blockers jsonb; org_id uuid; locked_actor uuid; step text; affected bigint; counts jsonb:='{}';
BEGIN
 PERFORM app_private.account_deletion_authorize(p_actor,p_target,p_mode);
 IF p_delete_projects IS NULL OR length(p_reason)>1000 THEN RAISE EXCEPTION 'Deletion intent is invalid.' USING ERRCODE='22023'; END IF;
 p_reason:=nullif(btrim(p_reason),'');
 FOR locked_actor IN SELECT DISTINCT candidate FROM unnest(ARRAY[p_actor,p_target]) candidate ORDER BY candidate LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || locked_actor::text,0));
 END LOOP;
 IF p_mode='admin_blacklist' THEN
  PERFORM 1 FROM auth.users WHERE id=p_actor FOR SHARE;
  PERFORM app_private.account_deletion_authorize(p_actor,p_target,p_mode);
  IF NOT app_private.account_deletion_actor_is_active(p_actor) THEN
   RAISE EXCEPTION 'Administrative account is unavailable.' USING ERRCODE='42501';
  END IF;
 END IF;
 SELECT * INTO operation FROM app_private.account_deletion_operations WHERE target_user_id=p_target FOR UPDATE;
 IF FOUND AND (operation.mode<>p_mode OR operation.delete_projects<>p_delete_projects OR operation.requested_by<>p_actor OR operation.reason IS DISTINCT FROM p_reason) THEN
  RAISE EXCEPTION 'Account deletion intent cannot change on retry.' USING ERRCODE='22023';
 END IF;
 IF operation.phase IN ('external_pending','completed') THEN RETURN to_jsonb(operation)-'db_transaction_id'; END IF;
 -- The membership RPC uses the same sorted organization mutex before removing
 -- an admin. Revalidate after acquiring it; a preview is never authorization.
 FOR org_id IN SELECT organization_id FROM public.organization_members WHERE user_id=p_target ORDER BY organization_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-org-membership:' || org_id::text,0));
 END LOOP;
 PERFORM 1 FROM auth.users WHERE id=p_target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account does not exist.' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_target FOR UPDATE;
 PERFORM 1 FROM public.projects WHERE creator_id=p_target ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.account_data_export_jobs WHERE user_id=p_target ORDER BY id FOR UPDATE;
 blockers:=app_private.account_deletion_blockers(p_target,p_delete_projects);
 INSERT INTO app_private.account_deletion_operations(target_user_id,requested_by,mode,delete_projects,phase,blockers,db_transaction_id,reason)
 VALUES(p_target,p_actor,p_mode,p_delete_projects,CASE WHEN blockers='{}'::jsonb THEN 'database_pending' ELSE 'blocked' END,blockers,txid_current(),p_reason)
 ON CONFLICT(target_user_id) DO UPDATE SET phase=EXCLUDED.phase,blockers=EXCLUDED.blockers,
  db_transaction_id=EXCLUDED.db_transaction_id,safe_error_code=NULL,updated_at=now()
 RETURNING * INTO operation;
 IF blockers<>'{}'::jsonb THEN RETURN to_jsonb(operation)-'db_transaction_id'; END IF;
 BEGIN
  INSERT INTO app_private.account_deletion_storage_objects(operation_id,bucket_id,object_name,object_id)
  SELECT operation.id,bucket_id,name,id FROM storage.objects
   WHERE app_private.account_deletion_personal_object(p_target,bucket_id,name);
  PERFORM public.detach_content_report_reporter(p_target);
  IF p_mode='admin_blacklist' THEN
   INSERT INTO public.banned_emails(email,reason,banned_by)
   SELECT lower(btrim(email)),coalesce(p_reason,'Account removal approved by an administrator.'),p_actor FROM auth.users WHERE id=p_target AND email IS NOT NULL
   ON CONFLICT(email) DO UPDATE SET reason=EXCLUDED.reason,banned_by=EXCLUDED.banned_by;
  END IF;
  IF p_delete_projects THEN
   DELETE FROM public.projects WHERE creator_id=p_target;
   GET DIAGNOSTICS affected=ROW_COUNT; counts:=counts||jsonb_build_object('projects',affected);
  END IF;
  FOREACH step IN ARRAY ARRAY['project_feedback_requests','project_feedback','project_signups','feedback','notifications',
    'notification_settings','user_emails','trusted_member','project_drafts','account_data_export_jobs','organization_members'] LOOP
   EXECUTE format('DELETE FROM public.%I WHERE user_id=$1',step) USING p_target;
   GET DIAGNOSTICS affected=ROW_COUNT; counts:=counts||jsonb_build_object(step,affected);
  END LOOP;
  -- Certificates and audit rows retain provenance through their nullable FKs.
  DELETE FROM public.profiles WHERE id=p_target;
  GET DIAGNOSTICS affected=ROW_COUNT; counts:=counts||jsonb_build_object('profiles',affected);
  UPDATE app_private.account_deletion_operations SET phase='external_pending',deleted_counts=counts,
   database_completed_at=now(),updated_at=now() WHERE id=operation.id RETURNING * INTO operation;
 EXCEPTION WHEN OTHERS THEN
  -- This subtransaction rolls back every domain/storage-outbox change. Keep
  -- only the safe failure receipt so retries cannot mistake partial work for success.
  UPDATE app_private.account_deletion_operations SET phase='blocked',safe_error_code='database_phase_failed',
   updated_at=now() WHERE id=operation.id RETURNING * INTO operation;
 END;
 RETURN to_jsonb(operation)-'db_transaction_id';
END;
$$;
REVOKE ALL ON FUNCTION public.begin_account_deletion(uuid,uuid,text,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.begin_account_deletion(uuid,uuid,text,boolean,text) TO service_role;

CREATE FUNCTION public.claim_account_deletion_cleanup(p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE operation app_private.account_deletion_operations; objects jsonb;
BEGIN
 SELECT * INTO operation FROM app_private.account_deletion_operations WHERE id=p_operation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Deletion operation does not exist.' USING ERRCODE='22023'; END IF;
 IF operation.phase='completed' THEN RETURN to_jsonb(operation)||'{"objects":[]}'::jsonb; END IF;
 IF operation.phase<>'external_pending' THEN RAISE EXCEPTION 'Database cleanup has not committed.' USING ERRCODE='55000'; END IF;
 IF operation.lease_until>now() THEN RAISE EXCEPTION 'Cleanup is already in progress.' USING ERRCODE='55P03'; END IF;
 UPDATE app_private.account_deletion_operations SET claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',
  attempt_count=attempt_count+1,updated_at=now() WHERE id=p_operation RETURNING * INTO operation;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket_id',bucket_id,'object_name',object_name)), '[]') INTO objects
 FROM app_private.account_deletion_storage_objects WHERE operation_id=p_operation AND deleted_at IS NULL;
 RETURN (to_jsonb(operation)-'db_transaction_id')||jsonb_build_object('objects',objects);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_account_deletion_cleanup(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_account_deletion_cleanup(uuid) TO service_role;

CREATE FUNCTION public.advance_account_deletion_cleanup(p_operation uuid,p_claim uuid,p_step text,p_object_ids uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE operation app_private.account_deletion_operations;
BEGIN
 SELECT * INTO operation FROM app_private.account_deletion_operations WHERE id=p_operation FOR UPDATE;
 IF NOT FOUND OR operation.phase<>'external_pending' OR operation.claim_token IS DISTINCT FROM p_claim
  OR p_claim IS NULL OR operation.lease_until<=now() THEN RAISE EXCEPTION 'Cleanup lease is stale.' USING ERRCODE='55000'; END IF;
 IF p_step='storage_removed' THEN
  IF p_object_ids IS NULL OR cardinality(p_object_ids)>100 OR EXISTS(SELECT 1 FROM unnest(p_object_ids) AS input(id)
   WHERE id IS NULL OR NOT EXISTS(SELECT 1 FROM app_private.account_deletion_storage_objects o WHERE o.id=input.id AND o.operation_id=p_operation)) THEN
   RAISE EXCEPTION 'Storage receipt IDs are invalid.' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM app_private.account_deletion_storage_objects receipt JOIN storage.objects o
   ON o.bucket_id=receipt.bucket_id AND o.name=receipt.object_name WHERE receipt.id=ANY(p_object_ids) AND receipt.operation_id=p_operation) THEN
   RAISE EXCEPTION 'Storage removal is not confirmed.' USING ERRCODE='55000';
  END IF;
  UPDATE app_private.account_deletion_storage_objects SET deleted_at=now() WHERE operation_id=p_operation AND id=ANY(p_object_ids);
 ELSIF p_step='complete' THEN
  IF EXISTS(SELECT 1 FROM app_private.account_deletion_storage_objects WHERE operation_id=p_operation AND deleted_at IS NULL)
   OR (operation.mode='self_delete' AND EXISTS(SELECT 1 FROM auth.users WHERE id=operation.target_user_id))
   OR (operation.mode='admin_blacklist' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=operation.target_user_id
    AND banned_until>now() AND raw_app_meta_data->'account_access'->>'status'='banned')) THEN
   RAISE EXCEPTION 'External cleanup is not confirmed.' USING ERRCODE='55000';
  END IF;
  UPDATE app_private.account_deletion_operations SET phase='completed',completed_at=now(),safe_error_code=NULL,
   claim_token=NULL,lease_until=NULL,updated_at=now() WHERE id=p_operation RETURNING * INTO operation;
  RETURN to_jsonb(operation)-'db_transaction_id';
 ELSIF p_step IN ('storage_cleanup_failed','auth_cleanup_failed') THEN
  UPDATE app_private.account_deletion_operations SET safe_error_code=p_step,claim_token=NULL,lease_until=NULL,
   updated_at=now() WHERE id=p_operation RETURNING * INTO operation;
  RETURN to_jsonb(operation)-'db_transaction_id';
 ELSIF p_step IS DISTINCT FROM 'renew' THEN RAISE EXCEPTION 'Unknown cleanup step.' USING ERRCODE='22023';
 END IF;
 UPDATE app_private.account_deletion_operations SET lease_until=now()+interval '5 minutes',updated_at=now()
 WHERE id=p_operation RETURNING * INTO operation;
 RETURN to_jsonb(operation)-'db_transaction_id';
END;
$$;
REVOKE ALL ON FUNCTION public.advance_account_deletion_cleanup(uuid,uuid,text,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.advance_account_deletion_cleanup(uuid,uuid,text,uuid[]) TO service_role;
COMMIT;
