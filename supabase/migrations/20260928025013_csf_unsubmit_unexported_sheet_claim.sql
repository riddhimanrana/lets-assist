-- Permit unsubmit while Sheet export is queued but has never started.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_sheet_sync_record_internal(p_organization_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE; r jsonb; v text; l plugin_data.csf_sheet_writeback_ledger%ROWTYPE; profile uuid;
BEGIN
 -- Share the member deletion fence before reading any submission snapshot.
 -- After deletion, the snapshot sees neither the claim nor its removed binding.
 IF p_record_kind='point_submission' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('csf-member-delete:'||p_record_id,0));
 END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE id=p_destination_id AND organization_id=p_organization_id;
 IF NOT FOUND OR NOT d.enabled THEN RAISE EXCEPTION 'Sync destination is disabled.'; END IF;
 r:=plugin_data.csf_sheet_sync_destination_snapshot(p_organization_id,p_destination_id,p_record_kind,p_record_id);
 IF r IS NULL THEN RAISE EXCEPTION 'Record is outside this destination.'; END IF;
 profile:=CASE WHEN p_record_kind='profile' THEN p_record_id ELSE (r->>'profile_id')::uuid END;
 v:=md5(r::text);
 INSERT INTO plugin_data.csf_sheet_sync_bindings(organization_id,destination_id,record_kind,record_id,profile_id,logical_key,sheet_id) VALUES(p_organization_id,d.id,p_record_kind,p_record_id,profile,p_record_kind||':'||p_record_id::text,d.sheet_id) ON CONFLICT(destination_id,record_kind,record_id) DO NOTHING;
 UPDATE plugin_data.csf_sheet_sync_bindings SET profile_id=profile WHERE organization_id=p_organization_id AND destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND profile IS NOT NULL AND profile_id IS DISTINCT FROM profile;
 INSERT INTO plugin_data.csf_sheet_writeback_ledger(organization_id,spreadsheet_file_id,sheet_tab,status,destination_id,record_kind,record_id,source_version,payload)
 VALUES(p_organization_id,d.spreadsheet_file_id,NULL,'pending_export',d.id,p_record_kind,p_record_id,v,r)
 ON CONFLICT(destination_id,record_kind,record_id,source_version) WHERE destination_id IS NOT NULL DO NOTHING RETURNING * INTO l;
 IF l.id IS NULL THEN SELECT * INTO l FROM plugin_data.csf_sheet_writeback_ledger WHERE destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND source_version=v; END IF;
 RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION plugin_data.csf_queue_sheet_sync_record_internal(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_sheet_sync_record_internal(uuid,uuid,text,uuid) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_sheet_sync_snapshot_internal(p_organization_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid,p_snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE; r jsonb:=p_snapshot; v text; l plugin_data.csf_sheet_writeback_ledger%ROWTYPE; profile uuid;
BEGIN
 IF p_record_kind='point_submission' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('csf-member-delete:'||p_record_id,0));
   -- The trigger snapshot may predate a completed Unsubmit.
   r:=plugin_data.csf_sheet_sync_destination_snapshot(p_organization_id,p_destination_id,p_record_kind,p_record_id);
   IF r IS NULL THEN RETURN NULL; END IF;
 END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE id=p_destination_id AND organization_id=p_organization_id;
 IF NOT FOUND OR NOT d.enabled THEN RAISE EXCEPTION 'Sync destination is disabled.'; END IF;
 IF r IS NULL THEN RAISE EXCEPTION 'Record is outside this destination.'; END IF;
 profile:=CASE WHEN p_record_kind='profile' THEN p_record_id ELSE (r->>'profile_id')::uuid END;
 v:=md5(r::text);
 INSERT INTO plugin_data.csf_sheet_sync_bindings(organization_id,destination_id,record_kind,record_id,profile_id,logical_key,sheet_id) VALUES(p_organization_id,d.id,p_record_kind,p_record_id,profile,p_record_kind||':'||p_record_id::text,d.sheet_id) ON CONFLICT(destination_id,record_kind,record_id) DO NOTHING;
 UPDATE plugin_data.csf_sheet_sync_bindings SET profile_id=profile WHERE organization_id=p_organization_id AND destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND profile IS NOT NULL AND profile_id IS DISTINCT FROM profile;
 INSERT INTO plugin_data.csf_sheet_writeback_ledger(organization_id,spreadsheet_file_id,sheet_tab,status,destination_id,record_kind,record_id,source_version,payload)
 VALUES(p_organization_id,d.spreadsheet_file_id,NULL,'pending_export',d.id,p_record_kind,p_record_id,v,r)
 ON CONFLICT(destination_id,record_kind,record_id,source_version) WHERE destination_id IS NOT NULL DO NOTHING RETURNING * INTO l;
 IF l.id IS NULL THEN SELECT * INTO l FROM plugin_data.csf_sheet_writeback_ledger WHERE destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND source_version=v; END IF;
 RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION plugin_data.csf_queue_sheet_sync_snapshot_internal(uuid,uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_sheet_sync_snapshot_internal(uuid,uuid,text,uuid,jsonb) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_delete_member_point_submission_request(
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
  -- Hold each destination before examining its export ledger. The export worker
  -- takes the same destination lock before claiming a row, so an unsubmitted
  -- claim cannot be sent after this transaction decides that no send started.
  PERFORM destination.id FROM plugin_data.csf_sheet_sync_destinations destination
  WHERE destination.organization_id=p_organization_id AND destination.id IN (
    SELECT b.destination_id FROM plugin_data.csf_sheet_sync_bindings b
      WHERE b.organization_id=p_organization_id AND b.record_kind='point_submission' AND b.record_id=s.id
    UNION SELECT l.destination_id FROM plugin_data.csf_sheet_writeback_ledger l
      WHERE l.organization_id=p_organization_id AND l.record_kind='point_submission' AND l.record_id=s.id AND l.destination_id IS NOT NULL
  ) ORDER BY destination.id FOR NO KEY UPDATE;
  PERFORM b.id FROM plugin_data.csf_sheet_sync_bindings b
    WHERE b.organization_id=p_organization_id AND b.record_kind='point_submission' AND b.record_id=s.id
    ORDER BY b.id FOR UPDATE;
  PERFORM l.id FROM plugin_data.csf_sheet_writeback_ledger l
    WHERE l.organization_id=p_organization_id AND l.record_kind='point_submission' AND l.record_id=s.id
    ORDER BY l.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_sync_bindings b
      WHERE b.organization_id=p_organization_id AND b.record_kind='point_submission' AND b.record_id=s.id
        AND (b.last_export_version IS NOT NULL OR b.remote_version IS NOT NULL
          OR b.last_seen_request_source_version IS NOT NULL OR b.last_seen_request <> '{}'::jsonb
          OR b.thread_bindings <> '{}'::jsonb
          OR EXISTS (SELECT 1 FROM plugin_data.csf_sheet_sync_local_messages m WHERE m.binding_id=b.id)))
    OR EXISTS (SELECT 1 FROM plugin_data.csf_sheet_sync_changes c
      WHERE c.organization_id=p_organization_id AND c.record_kind='point_submission' AND c.record_id=s.id)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger l
      WHERE l.organization_id=p_organization_id AND l.record_kind='point_submission' AND l.record_id=s.id
        AND (l.status NOT IN ('pending_export','superseded') OR l.attempts<>0
          OR l.attempt_receipts<>'{}'::jsonb OR l.lease_token IS NOT NULL OR l.sent_at IS NOT NULL))
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
  DELETE FROM plugin_data.csf_sheet_sync_changes WHERE organization_id=p_organization_id AND record_kind='point_submission' AND record_id=s.id;
  DELETE FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND record_kind='point_submission' AND record_id=s.id;
  DELETE FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id=p_organization_id AND record_kind='point_submission' AND record_id=s.id;
  DELETE FROM plugin_data.csf_admin_audit_events WHERE organization_id=p_organization_id AND target_type='csf_point_submissions' AND target_id=s.id;
  DELETE FROM plugin_data.csf_point_submissions WHERE id=s.id;
  DELETE FROM plugin_data.csf_sheet_sync_changes WHERE organization_id=p_organization_id AND record_kind='point_submission' AND record_id=s.id;
  DELETE FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND record_kind='point_submission' AND record_id=s.id;
  DELETE FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id=p_organization_id AND record_kind='point_submission' AND record_id=s.id;
  UPDATE plugin_data.csf_member_submission_deletions SET authorization_xid=NULL WHERE submission_id=s.id;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_member_submission_deletion_paths WHERE submission_id=s.id) THEN
    DELETE FROM plugin_data.csf_member_submission_deletions WHERE submission_id=s.id;
  END IF;
  RETURN plugin_data.csf_deleted_submission_result(p_organization_id,s.id);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_delete_member_point_submission_request(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_delete_member_point_submission_request(uuid,uuid,uuid,uuid,uuid) TO service_role;

COMMIT;
