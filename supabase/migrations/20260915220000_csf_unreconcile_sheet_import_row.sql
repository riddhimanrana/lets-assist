-- Undo one identity reconciliation on an uncommitted preview row.
--
-- Reconciling a row is reversible in principle and was not in practice: there
-- was a `match` and a `skip` and no way back. That is tolerable while an
-- officer resolves rows one at a time and can see each decision before making
-- it. It is not tolerable once a batch can resolve hundreds in a single
-- confirm, because the cost of a wrong batch becomes the cost of unpicking it
-- by hand.
--
-- The reversal is deliberately narrow:
--
--   * Preview rows only, in the same job states reconciliation itself accepts.
--   * Never a committed row. Once a row has written student records the
--     reversal is a data-correction problem, not a queue problem, and it has
--     to go through the commit-outcome path rather than quietly here.
--   * Audited like any other identity mutation, carrying the batch it belongs
--     to so a bad batch can be found and walked back as a unit.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_unreconcile_sheet_import_row_identity_base(
  p_organization_id uuid,
  p_row_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_before jsonb;
  v_now timestamptz := pg_catalog.now();
BEGIN
  IF nullif(pg_catalog.btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'An unreconciliation reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'An unreconciliation actor is required.';
  END IF;

  SELECT job.* INTO v_job
  FROM plugin_data.csf_sheet_import_jobs AS job
  JOIN plugin_data.csf_sheet_import_rows AS source_row
    ON source_row.organization_id = job.organization_id AND source_row.job_id = job.id
  WHERE source_row.organization_id = p_organization_id AND source_row.id = p_row_id
  FOR UPDATE OF job;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import row not found.';
  END IF;
  IF v_job.mode <> 'preview' OR v_job.status NOT IN ('completed', 'needs_resolution') THEN
    RAISE EXCEPTION 'Choose a completed preview before reviewing identity.';
  END IF;

  SELECT import_row.* INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id AND import_row.id = p_row_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import row not found.';
  END IF;

  -- A committed row is out of scope here, on purpose. Reversing it means
  -- reversing what it wrote, which the commit-outcome path owns.
  IF v_row.commit_outcome_state <> 'not_started' THEN
    RAISE EXCEPTION 'This row has already been committed; reverse it through the commit outcome instead.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_row.commit_frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'This row is frozen for a commit attempt; wait for that attempt to finish.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_row.resolution_status IS DISTINCT FROM 'resolved' THEN
    -- Nothing to undo. Idempotent so replaying a batch reversal is safe.
    RETURN jsonb_build_object(
      'rowId', v_row.id, 'reverted', false, 'reason', 'not_resolved'
    );
  END IF;

  v_before := pg_catalog.to_jsonb(v_row);

  UPDATE plugin_data.csf_sheet_import_rows
     SET matched_profile_id = NULL,
         import_status = 'ambiguous',
         resolution_status = 'pending',
         resolution_reason_code = NULL,
         resolution_notes = NULL,
         resolved_by = NULL,
         resolved_at = NULL,
         resolution_metadata = coalesce(resolution_metadata, '{}'::jsonb)
           || jsonb_build_object(
                'revertedAt', v_now,
                'revertedBy', p_actor_user_id,
                'revertedBatchId', p_batch_id,
                'revertedReason', p_reason
              )
   WHERE organization_id = p_organization_id AND id = p_row_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, reason_code
  )
  VALUES (
    p_organization_id, p_actor_user_id, 'sheet_import.identity_unreconciled',
    'csf_sheet_import_row', p_row_id, v_before,
    (SELECT pg_catalog.to_jsonb(r) FROM plugin_data.csf_sheet_import_rows r
      WHERE r.organization_id = p_organization_id AND r.id = p_row_id),
    'identity_unreconciled'
  );

  RETURN jsonb_build_object(
    'rowId', v_row.id, 'reverted', true, 'batchId', p_batch_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_unreconcile_sheet_import_row(
  p_organization_id uuid,
  p_row_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Same lock order as reconciliation, so a revert cannot deadlock against it.
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor_for_row(
    p_organization_id, p_actor_user_id, p_row_id
  );
  RETURN plugin_data.csf_unreconcile_sheet_import_row_identity_base(
    p_organization_id, p_row_id, p_actor_user_id, p_reason, p_batch_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_unreconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_unreconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,uuid)
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_unreconcile_sheet_import_row(uuid,uuid,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_unreconcile_sheet_import_row(uuid,uuid,uuid,text,uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_unreconcile_sheet_import_row(uuid,uuid,uuid,text,uuid) IS
  'Reverses one identity reconciliation on an uncommitted preview row and records the batch it belonged to. Refuses committed or commit-frozen rows.';

COMMIT;
