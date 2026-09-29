-- Refuse concurrent queue mutations without reversing deletion row-lock order.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_sheet_sync_record_internal(p_organization_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE; r jsonb; v text; l plugin_data.csf_sheet_writeback_ledger%ROWTYPE; profile uuid;
BEGIN
 -- Trigger callers may already hold submission or binding rows. Never wait
 -- for the deletion fence while holding those rows; roll back for a safe retry.
 -- After deletion, the snapshot sees neither the claim nor its removed binding.
 IF p_record_kind='point_submission' THEN
   IF NOT pg_try_advisory_xact_lock(hashtextextended('csf-member-delete:'||p_record_id,0)) THEN
     RAISE EXCEPTION 'This submission is being unsubmitted. Reload before trying again.' USING ERRCODE='40001';
   END IF;
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
   IF NOT pg_try_advisory_xact_lock(hashtextextended('csf-member-delete:'||p_record_id,0)) THEN
     RAISE EXCEPTION 'This submission is being unsubmitted. Reload before trying again.' USING ERRCODE='40001';
   END IF;
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

COMMIT;
