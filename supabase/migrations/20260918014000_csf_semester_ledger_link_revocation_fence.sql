-- Keep the reviewed workbook link active until each provider write is settled.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_guard_workbook_link_unsettled_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE'
    AND NEW.profile_id IS NOT DISTINCT FROM OLD.profile_id
    AND NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM plugin_data.csf_sheet_semester_ledger_writes w
    WHERE w.organization_id=OLD.organization_id AND w.source_link_id=OLD.id
      AND w.status IN ('claimed','unknown_outcome')) THEN
    RAISE EXCEPTION 'Reconcile the semester Sheet write before moving this workbook link.' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_workbook_link_unsettled_write()
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_workbook_link_unsettled_write()
  TO postgres;

DROP TRIGGER csf_workbook_link_unsettled_write
  ON plugin_data.csf_reviewed_workbook_profile_links;
CREATE TRIGGER csf_workbook_link_unsettled_write
  BEFORE UPDATE OF profile_id,revoked_at OR DELETE
  ON plugin_data.csf_reviewed_workbook_profile_links
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_workbook_link_unsettled_write();

-- An aborted attempt has verified that no provider write occurred. Retain its
-- receipt while allowing a fresh, audited request for the same source snapshot.
ALTER TABLE plugin_data.csf_sheet_semester_ledger_writes
  DROP CONSTRAINT csf_sheet_semester_ledger_wri_destination_id_profile_id_sou_key;
CREATE UNIQUE INDEX csf_sheet_semester_ledger_nonaborted_receipt_unique
  ON plugin_data.csf_sheet_semester_ledger_writes
    (destination_id,profile_id,source_version,preview_digest)
  WHERE status<>'aborted';

CREATE OR REPLACE FUNCTION plugin_data.csf_reconcile_sheet_semester_ledger_write(
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
  IF w.status='claimed' AND w.lease_expires_at<=clock_timestamp() THEN
    before_row:=to_jsonb(w);
    UPDATE plugin_data.csf_sheet_semester_ledger_writes
      SET status='unknown_outcome',finished_at=now()
      WHERE request_id=p_request_id RETURNING * INTO w;
    INSERT INTO plugin_data.csf_admin_audit_events
      (organization_id,actor_user_id,action,target_type,target_id,before_data,after_data)
    VALUES (p_organization_id,p_actor_user_id,'sheet_sync.semester_write_expired_recovered',
      'sheet_semester_ledger_write',p_request_id,before_row,
      to_jsonb(w)||jsonb_build_object('reason',p_reason));
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
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reconcile_sheet_semester_ledger_write(uuid,uuid,uuid,boolean,text,text)
  TO postgres,service_role;

COMMIT;
