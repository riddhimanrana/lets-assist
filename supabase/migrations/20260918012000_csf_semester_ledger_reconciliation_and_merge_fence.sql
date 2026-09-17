-- Recover ambiguous copied-Sheet writes and keep profile identity stable until settlement.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_guard_sheet_semester_ledger_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_NAME='csf_sheet_semester_ledger_mappings' THEN
    RAISE EXCEPTION 'Accepted semester mappings are immutable.' USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','readback_digest','finished_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','readback_digest','finished_at']) THEN
    RAISE EXCEPTION 'Semester write identity and evidence are immutable.' USING ERRCODE='23514';
  END IF;
  IF NOT ((OLD.status='claimed' AND NEW.status IN ('applied','unknown_outcome','aborted'))
    OR (OLD.status='unknown_outcome' AND NEW.status IN ('applied','aborted')))
    OR (OLD.status='unknown_outcome' AND NEW.finished_at IS DISTINCT FROM OLD.finished_at) THEN
    RAISE EXCEPTION 'A completed semester write cannot change.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_sheet_semester_ledger_immutable()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION plugin_data.csf_reconcile_sheet_semester_ledger_write(
  p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,
  p_was_written boolean,p_readback_digest text,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w plugin_data.csf_sheet_semester_ledger_writes%ROWTYPE;
  before_row jsonb;
  target_status text;
BEGIN
  IF p_was_written IS NULL OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 12 AND 500
    OR (p_was_written AND coalesce(p_readback_digest !~ '^[a-f0-9]{64}$',true))
    OR (NOT p_was_written AND p_readback_digest IS NOT NULL) THEN
    RAISE EXCEPTION 'Record the checked provider readback and a review reason.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync')
    AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO w FROM plugin_data.csf_sheet_semester_ledger_writes
    WHERE organization_id=p_organization_id AND request_id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Semester write attempt not found.' USING ERRCODE='22023'; END IF;
  target_status:=CASE WHEN p_was_written THEN 'applied' ELSE 'aborted' END;
  IF w.status=target_status THEN
    IF w.readback_digest IS DISTINCT FROM p_readback_digest
      OR NOT EXISTS (SELECT 1 FROM plugin_data.csf_admin_audit_events a
        WHERE a.organization_id=p_organization_id AND a.target_id=p_request_id
          AND a.action='sheet_sync.semester_write_reconciled'
          AND a.after_data->>'reason'=p_reason) THEN
      RAISE EXCEPTION 'This reconciliation conflicts with its saved outcome.' USING ERRCODE='23505';
    END IF;
    RETURN to_jsonb(w)||jsonb_build_object('replayed',true);
  END IF;
  IF w.status<>'unknown_outcome' THEN
    RAISE EXCEPTION 'Only an ambiguous semester write can be reconciled.' USING ERRCODE='55000';
  END IF;
  before_row:=to_jsonb(w);
  UPDATE plugin_data.csf_sheet_semester_ledger_writes
    SET status=target_status,readback_digest=p_readback_digest
    WHERE request_id=p_request_id RETURNING * INTO w;
  INSERT INTO plugin_data.csf_admin_audit_events
    (organization_id,actor_user_id,action,target_type,target_id,before_data,after_data)
  VALUES (p_organization_id,p_actor_user_id,'sheet_sync.semester_write_reconciled',
    'sheet_semester_ledger_write',p_request_id,before_row,
    to_jsonb(w)||jsonb_build_object('was_written',p_was_written,'reason',p_reason));
  RETURN to_jsonb(w)||jsonb_build_object('replayed',false);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_sheet_semester_ledger_write(uuid,uuid,uuid,boolean,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reconcile_sheet_semester_ledger_write(uuid,uuid,uuid,boolean,text,text)
  TO service_role;

-- The provider attempt must still target the reviewed workbook link's current owner.
-- Locking that link serializes claim against a merge's link reassignment.
CREATE FUNCTION plugin_data.csf_guard_semester_write_link_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE link_profile_id uuid;
BEGIN
  SELECT profile_id INTO link_profile_id
  FROM plugin_data.csf_reviewed_workbook_profile_links
  WHERE id=NEW.source_link_id AND organization_id=NEW.organization_id AND revoked_at IS NULL
  FOR UPDATE;
  IF link_profile_id IS DISTINCT FROM NEW.profile_id THEN
    RAISE EXCEPTION 'The reviewed workbook link changed. Preview again.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_semester_write_link_owner()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER csf_semester_write_link_owner
  BEFORE INSERT ON plugin_data.csf_sheet_semester_ledger_writes
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_semester_write_link_owner();

CREATE FUNCTION plugin_data.csf_guard_workbook_link_unsettled_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id AND EXISTS (
    SELECT 1 FROM plugin_data.csf_sheet_semester_ledger_writes w
    WHERE w.organization_id=OLD.organization_id AND w.source_link_id=OLD.id
      AND w.status IN ('claimed','unknown_outcome')) THEN
    RAISE EXCEPTION 'Reconcile the semester Sheet write before moving this workbook link.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_workbook_link_unsettled_write()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER csf_workbook_link_unsettled_write
  BEFORE UPDATE OF profile_id ON plugin_data.csf_reviewed_workbook_profile_links
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_workbook_link_unsettled_write();

ALTER FUNCTION plugin_data.csf_profile_merge_preview(uuid,uuid,uuid)
  RENAME TO csf_profile_merge_preview_semester_ledger_base;
CREATE FUNCTION plugin_data.csf_profile_merge_preview(
  p_organization_id uuid,p_source_profile_id uuid,p_target_profile_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE preview jsonb; conflict jsonb; conflicts jsonb;
BEGIN
  preview:=plugin_data.csf_profile_merge_preview_semester_ledger_base(
    p_organization_id,p_source_profile_id,p_target_profile_id);
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_semester_ledger_writes w
    WHERE w.organization_id=p_organization_id
      AND w.profile_id IN (p_source_profile_id,p_target_profile_id)
      AND w.status IN ('claimed','unknown_outcome')) THEN
    conflict:=jsonb_build_object('type','semester_sheet_write_needs_reconciliation',
      'message','Reconcile the pending semester Sheet write before merging these profiles.');
    conflicts:=coalesce(preview->'conflicts','[]'::jsonb)||jsonb_build_array(conflict);
    RETURN preview||jsonb_build_object('conflicts',conflicts,'canMerge',false,
      'canMergeWithOfficerAttestation',false);
  END IF;
  RETURN preview;
END $$;
ALTER FUNCTION plugin_data.csf_profile_merge_preview(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview_semester_ledger_base(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_preview_semester_ledger_base(uuid,uuid,uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_preview(uuid,uuid,uuid) TO postgres,service_role;

COMMIT;
