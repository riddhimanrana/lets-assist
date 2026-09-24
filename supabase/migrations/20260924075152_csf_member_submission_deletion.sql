BEGIN;

-- These rows exist only while physical proof cleanup is outstanding. They are
-- authorization and work queues, never a retained history of deleted claims.
CREATE TABLE plugin_data.csf_member_submission_deletions (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  submission_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  authorization_xid bigint,
  UNIQUE (organization_id, request_id)
);
CREATE TABLE plugin_data.csf_member_submission_deletion_paths (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL,
  bucket text NOT NULL,
  object_path text NOT NULL,
  PRIMARY KEY (bucket, object_path)
);
CREATE INDEX csf_member_submission_deletion_paths_org_idx ON plugin_data.csf_member_submission_deletion_paths(organization_id,submission_id);
CREATE INDEX csf_member_submission_deletion_paths_submission_idx ON plugin_data.csf_member_submission_deletion_paths(submission_id);
COMMENT ON TABLE plugin_data.csf_member_submission_deletions IS
  'Temporary owner authorization while proof cleanup is pending. No submission snapshots. Erased when the last path is removed; profile and actor IDs intentionally outlive account/profile removal so the storage worker can finish.';
COMMENT ON TABLE plugin_data.csf_member_submission_deletion_paths IS
  'Temporary exact-path storage work for member deletion, including late upload cleanup. The deletion queue drains these paths during chapter teardown; its completion trigger erases paths and receipts. No completed deletion history is retained.';
ALTER TABLE plugin_data.csf_member_submission_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_member_submission_deletion_paths ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_member_submission_deletions,
  plugin_data.csf_member_submission_deletion_paths FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_reject_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_SCHEMA='plugin_data' AND TG_TABLE_NAME='csf_admin_audit_events'
    AND TG_WHEN='BEFORE' AND TG_LEVEL='ROW' THEN
    IF TG_OP='DELETE' AND OLD.target_type='csf_point_submissions' AND EXISTS (
      SELECT 1 FROM plugin_data.csf_member_submission_deletions d
      WHERE d.organization_id=OLD.organization_id AND d.submission_id=OLD.target_id
        AND d.authorization_xid=txid_current()
    ) THEN RETURN OLD; END IF;
    IF TG_OP='UPDATE' AND OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL
      AND (to_jsonb(NEW)-'actor_user_id') IS NOT DISTINCT FROM (to_jsonb(OLD)-'actor_user_id')
      AND pg_trigger_depth()>1 AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id=OLD.actor_user_id)
    THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'CSF audit events are immutable.';
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_reject_audit_mutation() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reject_audit_mutation() TO postgres;
COMMENT ON FUNCTION plugin_data.csf_reject_audit_mutation() IS
  'Preserves immutable audit except auth-user referential nulling and the exact claim authorized for member deletion by an owner-only row in the current transaction.';

CREATE FUNCTION plugin_data.csf_assert_member_submission_deletion_owner(
  p_organization_id uuid,p_profile_id uuid,p_actor_user_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM plugin_data.csf_assert_point_actor_authority(p_organization_id,p_actor_user_id,ARRAY[]::text[]);
  PERFORM 1 FROM plugin_data.csf_profile_accounts a
  JOIN plugin_data.csf_profiles p ON p.id=a.profile_id AND p.organization_id=a.organization_id
  WHERE a.organization_id=p_organization_id AND a.profile_id=p_profile_id
    AND a.user_id=p_actor_user_id AND a.status='verified' AND p.record_status='active'
  FOR UPDATE OF a,p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the connected member may unsubmit this submission.' USING ERRCODE='42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_member_submission_deletion_owner(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_member_submission_deletion_owner(uuid,uuid,uuid) TO postgres;

-- Queue acknowledgement holds the queue row before this trigger runs. Finish
-- uses that same order, so a late worker cannot recreate a path-bearing receipt.
CREATE FUNCTION plugin_data.csf_finish_deleted_submission_storage_path()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_submission uuid;
BEGIN
  SELECT p.submission_id INTO v_submission FROM plugin_data.csf_member_submission_deletion_paths p
  WHERE p.organization_id=OLD.organization_id AND p.bucket=OLD.bucket AND p.object_path=OLD.object_path FOR UPDATE;
  IF NOT FOUND THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id=OLD.bucket AND name=OLD.object_path) THEN
    RAISE EXCEPTION 'Proof storage deletion is not confirmed.' USING ERRCODE='55000';
  END IF;
  DELETE FROM plugin_data.csf_storage_deletion_receipts
  WHERE organization_id=OLD.organization_id AND bucket=OLD.bucket AND object_path=OLD.object_path;
  DELETE FROM plugin_data.csf_member_submission_deletion_paths
  WHERE organization_id=OLD.organization_id AND bucket=OLD.bucket AND object_path=OLD.object_path;
  DELETE FROM plugin_data.csf_member_submission_deletions d
  WHERE d.organization_id=OLD.organization_id AND d.submission_id=v_submission
    AND d.authorization_xid IS NULL
    AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_member_submission_deletion_paths p WHERE p.submission_id=v_submission);
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_finish_deleted_submission_storage_path() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finish_deleted_submission_storage_path() TO postgres;
CREATE TRIGGER csf_finish_deleted_submission_storage_path
AFTER DELETE ON plugin_data.csf_storage_deletion_queue
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_finish_deleted_submission_storage_path();

CREATE FUNCTION plugin_data.csf_deleted_submission_result(p_organization_id uuid,p_submission_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('submissionId',p_submission_id,
    'status',CASE WHEN count(*)=0 THEN 'deleted' ELSE 'cleanup_required' END,
    'files',coalesce(jsonb_agg(jsonb_build_object('bucket',p.bucket,'objectPath',p.object_path) ORDER BY p.bucket,p.object_path),'[]'::jsonb))
  FROM plugin_data.csf_member_submission_deletion_paths p
  WHERE p.organization_id=p_organization_id AND p.submission_id=p_submission_id;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_deleted_submission_result(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_deleted_submission_result(uuid,uuid) TO postgres;

CREATE FUNCTION plugin_data.csf_delete_member_point_submission_request(
  p_organization_id uuid,p_profile_id uuid,p_submission_id uuid,p_actor_user_id uuid,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s plugin_data.csf_point_submissions%ROWTYPE; d plugin_data.csf_member_submission_deletions%ROWTYPE;
BEGIN
  IF p_request_id IS NULL OR p_submission_id IS NULL THEN RAISE EXCEPTION 'A submission and stable request identifier are required.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a JOIN plugin_data.csf_profiles p ON p.id=a.profile_id AND p.organization_id=a.organization_id
    JOIN public.organization_members m ON m.organization_id=a.organization_id AND m.user_id=a.user_id
    WHERE a.organization_id=p_organization_id AND a.profile_id=p_profile_id AND a.user_id=p_actor_user_id
      AND a.status='verified' AND p.record_status='active' AND m.status='active') THEN
    RAISE EXCEPTION 'Only the connected member may unsubmit this submission.' USING ERRCODE='42501';
  END IF;
  PERFORM plugin_data.csf_assert_point_actor_authority(p_organization_id,p_actor_user_id,ARRAY[]::text[]);
  SELECT * INTO s FROM plugin_data.csf_point_submissions WHERE id=p_submission_id;
  IF FOUND THEN
    IF s.organization_id<>p_organization_id OR s.profile_id<>p_profile_id OR s.source<>'student' THEN
      RAISE EXCEPTION 'Only the connected member may unsubmit this submission.' USING ERRCODE='42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||s.term_id::text,0));
  END IF;
  PERFORM plugin_data.csf_assert_member_submission_deletion_owner(p_organization_id,p_profile_id,p_actor_user_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('csf-member-delete:'||p_submission_id,0));
  SELECT * INTO d FROM plugin_data.csf_member_submission_deletions WHERE submission_id=p_submission_id;
  IF FOUND THEN
    IF d.organization_id<>p_organization_id OR d.profile_id<>p_profile_id OR d.actor_user_id<>p_actor_user_id OR d.request_id<>p_request_id THEN
      RAISE EXCEPTION 'Only the connected member may unsubmit this submission.' USING ERRCODE='42501';
    END IF;
    RETURN plugin_data.csf_deleted_submission_result(p_organization_id,p_submission_id);
  END IF;
  SELECT * INTO s FROM plugin_data.csf_point_submissions WHERE id=p_submission_id;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM plugin_data.csf_member_submission_deletion_paths WHERE submission_id=p_submission_id) THEN
      RAISE EXCEPTION 'Proof cleanup is still pending. Retry shortly.' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('submissionId',p_submission_id,'status','deleted','files','[]'::jsonb);
  END IF;
  IF s.organization_id<>p_organization_id OR s.profile_id<>p_profile_id OR s.source<>'student' THEN
    RAISE EXCEPTION 'Only the connected member may unsubmit this submission.' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||s.term_id::text,0));
  SELECT * INTO s FROM plugin_data.csf_point_submissions WHERE id=p_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM plugin_data.csf_member_submission_deletion_paths WHERE submission_id=p_submission_id) THEN
      RAISE EXCEPTION 'Proof cleanup is still pending. Retry shortly.' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('submissionId',p_submission_id,'status','deleted','files','[]'::jsonb);
  END IF;
  IF s.status NOT IN ('draft','submitted','needs_action','withdrawn')
    OR EXISTS (SELECT 1 FROM plugin_data.csf_submission_reviews WHERE submission_id=s.id AND action IN ('approved','rejected','duplicate'))
    OR EXISTS (SELECT 1 FROM plugin_data.csf_credit_records WHERE submission_id=s.id)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_point_appeals WHERE submission_id=s.id)
  THEN RAISE EXCEPTION 'Reviewed or awarded submissions require the correction workflow.' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_terms t WHERE t.id=s.term_id AND t.organization_id=p_organization_id AND t.lifecycle_status='open' AND t.is_current)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_review_periods r WHERE r.organization_id=p_organization_id AND r.term_id=s.term_id AND r.kind='member_points' AND r.status='open'
      AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_review_decisions x WHERE x.organization_id=p_organization_id AND x.period_id=r.id AND x.subject_kind='profile' AND x.subject_id=p_profile_id AND x.submission_lock_override))
  THEN RAISE EXCEPTION 'Point submissions are locked for this semester.' USING ERRCODE='55000'; END IF;

  PERFORM 1 FROM plugin_data.csf_term_memberships m WHERE m.organization_id=p_organization_id AND m.profile_id=p_profile_id AND m.term_id=s.term_id AND m.status IN ('active','accepted') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'An accepted or active semester membership is required to unsubmit points.' USING ERRCODE='55000'; END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND record_id=s.id)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_sheet_sync_changes WHERE organization_id=p_organization_id AND record_id=s.id)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id=p_organization_id AND record_id=s.id)
  THEN RAISE EXCEPTION 'This submission has synchronized records. Use the correction workflow.' USING ERRCODE='55000'; END IF;

  -- Mail campaigns own external delivery evidence. They require the correction
  -- workflow; unsubmit must not claim to erase an already handed-off email.
  PERFORM 1 FROM plugin_data.csf_publication_notification_deliveries n
  JOIN plugin_data.csf_publication_events e ON e.id=n.event_id
  WHERE e.organization_id=p_organization_id AND e.source_kind='point_submission' AND e.source_id=s.id FOR UPDATE OF n;
  PERFORM 1 FROM plugin_data.csf_publication_events e
  WHERE e.organization_id=p_organization_id AND e.source_kind='point_submission' AND e.source_id=s.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_publication_notification_deliveries n JOIN plugin_data.csf_publication_events e ON e.id=n.event_id
    WHERE e.organization_id=p_organization_id AND e.source_kind='point_submission' AND e.source_id=s.id AND n.status='processing')
    OR EXISTS (SELECT 1 FROM plugin_data.csf_communication_campaigns c JOIN plugin_data.csf_publication_events e ON e.id=c.source_publication_event_id
      WHERE e.organization_id=p_organization_id AND e.source_kind='point_submission' AND e.source_id=s.id)
  THEN RAISE EXCEPTION 'This submission has a review notice in delivery. Use the correction workflow.' USING ERRCODE='55000'; END IF;

  INSERT INTO plugin_data.csf_member_submission_deletions(organization_id,submission_id,profile_id,actor_user_id,request_id,authorization_xid)
  VALUES(p_organization_id,s.id,p_profile_id,p_actor_user_id,p_request_id,txid_current());
  INSERT INTO plugin_data.csf_member_submission_deletion_paths(organization_id,submission_id,bucket,object_path)
  SELECT p_organization_id,s.id,f.bucket,f.object_path FROM plugin_data.csf_submission_files f WHERE f.submission_id=s.id
  UNION SELECT p_organization_id,s.id,'plugins',r.object_path FROM plugin_data.csf_submission_edit_requests r WHERE r.submission_id=s.id AND r.object_path IS NOT NULL
  ON CONFLICT(bucket,object_path) DO NOTHING;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_submission_files f JOIN plugin_data.csf_member_submission_deletion_paths p ON p.bucket=f.bucket AND p.object_path=f.object_path
      WHERE f.submission_id=s.id AND (p.organization_id<>p_organization_id OR p.submission_id<>s.id))
    OR EXISTS (SELECT 1 FROM plugin_data.csf_submission_edit_requests r JOIN plugin_data.csf_member_submission_deletion_paths p ON p.bucket='plugins' AND p.object_path=r.object_path
      WHERE r.submission_id=s.id AND (p.organization_id<>p_organization_id OR p.submission_id<>s.id))
  THEN RAISE EXCEPTION 'Proof cleanup is already owned by another record.' USING ERRCODE='55000'; END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_member_submission_deletion_paths p JOIN plugin_data.csf_submission_files f
    ON f.bucket=p.bucket AND f.object_path=p.object_path WHERE p.submission_id=s.id AND f.submission_id<>s.id)
  THEN RAISE EXCEPTION 'Proof is shared with another record. Use the correction workflow.' USING ERRCODE='55000'; END IF;
  INSERT INTO plugin_data.csf_storage_deletion_queue(organization_id,bucket,object_path)
  SELECT organization_id,bucket,object_path FROM plugin_data.csf_member_submission_deletion_paths WHERE submission_id=s.id
  ON CONFLICT(bucket,object_path) DO NOTHING;

  DELETE FROM public.notifications n USING plugin_data.csf_publication_events e
  WHERE e.organization_id=p_organization_id AND e.source_kind='point_submission' AND e.source_id=s.id AND n.dedupe_key='csf-publication:'||e.id::text;
  DELETE FROM plugin_data.csf_publication_events WHERE organization_id=p_organization_id AND source_kind='point_submission' AND source_id=s.id;
  DELETE FROM plugin_data.csf_sheet_sync_changes WHERE organization_id=p_organization_id AND record_id=s.id;
  DELETE FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND record_id=s.id;
  DELETE FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id=p_organization_id AND record_id=s.id;
  DELETE FROM plugin_data.csf_admin_audit_events WHERE organization_id=p_organization_id AND target_type='csf_point_submissions' AND target_id=s.id;
  DELETE FROM plugin_data.csf_point_submissions WHERE id=s.id;
  DELETE FROM plugin_data.csf_sheet_sync_changes WHERE organization_id=p_organization_id AND record_id=s.id;
  DELETE FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND record_id=s.id;
  DELETE FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id=p_organization_id AND record_id=s.id;
  UPDATE plugin_data.csf_member_submission_deletions SET authorization_xid=NULL WHERE submission_id=s.id;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_member_submission_deletion_paths WHERE submission_id=s.id) THEN
    DELETE FROM plugin_data.csf_member_submission_deletions WHERE submission_id=s.id;
  END IF;
  RETURN plugin_data.csf_deleted_submission_result(p_organization_id,s.id);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_delete_member_point_submission_request(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_delete_member_point_submission_request(uuid,uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION plugin_data.csf_finish_member_point_submission_deletion(
  p_organization_id uuid,p_profile_id uuid,p_submission_id uuid,p_actor_user_id uuid,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_member_submission_deletions%ROWTYPE;
BEGIN
  IF p_request_id IS NULL OR p_submission_id IS NULL THEN RAISE EXCEPTION 'A submission and stable request identifier are required.'; END IF;
  PERFORM plugin_data.csf_assert_member_submission_deletion_owner(p_organization_id,p_profile_id,p_actor_user_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('csf-member-delete:'||p_submission_id,0));
  SELECT * INTO d FROM plugin_data.csf_member_submission_deletions WHERE submission_id=p_submission_id;
  IF FOUND AND (d.organization_id<>p_organization_id OR d.profile_id<>p_profile_id OR d.actor_user_id<>p_actor_user_id OR d.request_id<>p_request_id) THEN
    RAISE EXCEPTION 'Only the connected member may unsubmit this submission.' USING ERRCODE='42501';
  END IF;
  IF d.submission_id IS NULL AND EXISTS (SELECT 1 FROM plugin_data.csf_member_submission_deletion_paths WHERE submission_id=p_submission_id) THEN
    RAISE EXCEPTION 'Proof cleanup is still pending. Retry shortly.' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_point_submissions WHERE id=p_submission_id) THEN
    RAISE EXCEPTION 'Begin submission deletion before confirming cleanup.' USING ERRCODE='55000';
  END IF;
  PERFORM 1 FROM plugin_data.csf_storage_deletion_queue q JOIN plugin_data.csf_member_submission_deletion_paths p
    ON p.bucket=q.bucket AND p.object_path=q.object_path
    WHERE p.organization_id=p_organization_id AND p.submission_id=p_submission_id ORDER BY q.id FOR UPDATE OF q;
  IF EXISTS (SELECT 1 FROM storage.objects o JOIN plugin_data.csf_member_submission_deletion_paths p ON p.bucket=o.bucket_id AND p.object_path=o.name
    WHERE p.organization_id=p_organization_id AND p.submission_id=p_submission_id) THEN
    RETURN plugin_data.csf_deleted_submission_result(p_organization_id,p_submission_id);
  END IF;
  DELETE FROM plugin_data.csf_storage_deletion_queue q USING plugin_data.csf_member_submission_deletion_paths p
  WHERE q.bucket=p.bucket AND q.object_path=p.object_path AND p.organization_id=p_organization_id AND p.submission_id=p_submission_id;
  DELETE FROM plugin_data.csf_storage_deletion_receipts r USING plugin_data.csf_member_submission_deletion_paths p
  WHERE r.bucket=p.bucket AND r.object_path=p.object_path AND p.organization_id=p_organization_id AND p.submission_id=p_submission_id;
  DELETE FROM plugin_data.csf_member_submission_deletion_paths WHERE organization_id=p_organization_id AND submission_id=p_submission_id;
  DELETE FROM plugin_data.csf_member_submission_deletions WHERE organization_id=p_organization_id AND submission_id=p_submission_id;
  RETURN jsonb_build_object('submissionId',p_submission_id,'status','deleted','files','[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_finish_member_point_submission_deletion(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finish_member_point_submission_deletion(uuid,uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION plugin_data.csf_cleanup_deleted_submission_upload(p_organization_id uuid,p_submission_id uuid,p_object_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_organization_id IS NULL OR p_submission_id IS NULL OR p_object_path IS NULL OR NOT (
    p_object_path ~ ('^'||p_organization_id||'/dvhs-csf/profiles/[0-9a-f-]{36}/terms/[0-9a-f-]{36}/submissions/'||p_submission_id||'/[0-9a-f-]{36}-proof$')
    OR p_object_path ~ ('^dvhs-csf/'||p_organization_id||'/submission-edits/[0-9a-f-]{36}/[0-9a-f-]{36}-proof$')
  ) THEN RAISE EXCEPTION 'A valid submission proof path is required.' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('csf-member-delete:'||p_submission_id,0));
  IF EXISTS (SELECT 1 FROM plugin_data.csf_point_submissions WHERE id=p_submission_id)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_submission_files WHERE bucket='plugins' AND object_path=p_object_path)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_submission_edit_requests WHERE object_path=p_object_path)
  THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_member_submission_deletion_paths WHERE bucket='plugins' AND object_path=p_object_path
    AND (organization_id<>p_organization_id OR submission_id<>p_submission_id)) THEN
    RAISE EXCEPTION 'Proof cleanup is already owned by another record.' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='plugins' AND name=p_object_path) THEN
    DELETE FROM plugin_data.csf_storage_deletion_queue WHERE organization_id=p_organization_id AND bucket='plugins' AND object_path=p_object_path;
    DELETE FROM plugin_data.csf_storage_deletion_receipts WHERE organization_id=p_organization_id AND bucket='plugins' AND object_path=p_object_path;
    DELETE FROM plugin_data.csf_member_submission_deletion_paths WHERE organization_id=p_organization_id AND bucket='plugins' AND object_path=p_object_path;
    DELETE FROM plugin_data.csf_member_submission_deletions d WHERE d.organization_id=p_organization_id AND d.submission_id=p_submission_id
      AND d.authorization_xid IS NULL AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_member_submission_deletion_paths p WHERE p.submission_id=p_submission_id);
    RETURN true;
  END IF;
  INSERT INTO plugin_data.csf_member_submission_deletion_paths(organization_id,submission_id,bucket,object_path)
  VALUES(p_organization_id,p_submission_id,'plugins',p_object_path) ON CONFLICT(bucket,object_path) DO NOTHING;
  INSERT INTO plugin_data.csf_storage_deletion_queue(organization_id,bucket,object_path)
  VALUES(p_organization_id,'plugins',p_object_path) ON CONFLICT(bucket,object_path) DO NOTHING;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_cleanup_deleted_submission_upload(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_cleanup_deleted_submission_upload(uuid,uuid,text) TO service_role;

-- Server uploads can outlive the request that staged them. Storage metadata may
-- be committed only while the exact proof or edit remains owned by a live claim.
-- The shared claim lock makes deletion wait for an upload transaction, or makes
-- a late upload fail after deletion. Other buckets and paths are unaffected.
CREATE FUNCTION plugin_data.csf_fence_deleted_submission_storage_upload()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_submission uuid; v_org uuid; v_match text[];
BEGIN
  IF NEW.bucket_id<>'plugins' THEN RETURN NEW; END IF;
  v_match:=regexp_match(NEW.name,'^([0-9a-f-]{36})/dvhs-csf/profiles/[0-9a-f-]{36}/terms/[0-9a-f-]{36}/submissions/([0-9a-f-]{36})/');
  IF v_match IS NOT NULL THEN
    v_org:=v_match[1]::uuid; v_submission:=v_match[2]::uuid;
  ELSE
    v_match:=regexp_match(NEW.name,'^dvhs-csf/([0-9a-f-]{36})/submission-edits/([0-9a-f-]{36})/');
    IF v_match IS NULL THEN RETURN NEW; END IF;
    v_org:=v_match[1]::uuid;
    SELECT submission_id INTO v_submission FROM plugin_data.csf_submission_edit_requests
    WHERE request_id=v_match[2]::uuid AND organization_id=v_org AND object_path=NEW.name;
    IF v_submission IS NULL THEN
      SELECT submission_id INTO v_submission FROM plugin_data.csf_submission_files WHERE bucket=NEW.bucket_id AND object_path=NEW.name;
    END IF;
  END IF;
  IF v_submission IS NULL THEN RAISE EXCEPTION 'This submission no longer accepts proof uploads.' USING ERRCODE='55000'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('csf-member-delete:'||v_submission,0));
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_point_submissions s WHERE s.id=v_submission AND s.organization_id=v_org)
    OR NOT (EXISTS (SELECT 1 FROM plugin_data.csf_submission_files f WHERE f.submission_id=v_submission AND f.organization_id=v_org AND f.bucket=NEW.bucket_id AND f.object_path=NEW.name)
      OR EXISTS (SELECT 1 FROM plugin_data.csf_submission_edit_requests r WHERE r.submission_id=v_submission AND r.organization_id=v_org AND r.object_path=NEW.name AND r.status='pending'))
  THEN RAISE EXCEPTION 'This submission no longer accepts proof uploads.' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_fence_deleted_submission_storage_upload() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_fence_deleted_submission_storage_upload() TO postgres;
CREATE TRIGGER csf_fence_deleted_submission_storage_upload
BEFORE INSERT OR UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_fence_deleted_submission_storage_upload();

COMMIT;
