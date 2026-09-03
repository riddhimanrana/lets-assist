-- Restate the two import-approval trigger helpers as owner-only functions.

REVOKE ALL ON FUNCTION plugin_data.csf_audit_import_approval_batch()
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_audit_import_approval_batch()
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_normalize_import_approval_batch_status()
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_normalize_import_approval_batch_status()
  TO postgres;

-- The generation fence intentionally blocks previously prepared workbooks until
-- their current Drive revision is checked. Allow that one recovery state to
-- take the metadata lease. Every other blocked state still needs officer repair.
CREATE OR REPLACE FUNCTION plugin_data.csf_claim_class_workbook_check(
  p_organization_id uuid,
  p_cohort_id uuid,
  p_actor_user_id uuid,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
  v_token uuid := gen_random_uuid();
BEGIN
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id,
    p_actor_user_id,
    'class_history'
  );
  IF p_lease_seconds IS NULL
    OR p_lease_seconds < 30
    OR p_lease_seconds > 600
  THEN
    RAISE EXCEPTION 'Workbook check lease must be between 30 and 600 seconds.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.organization_id = p_organization_id
    AND workbook.cohort_id = p_cohort_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_workbook.state = 'unlinked'
    OR (
      v_workbook.state = 'blocked'
      AND v_workbook.last_error_code IS DISTINCT FROM
        'workbook_generation_reprepare_required'
    )
    OR v_workbook.drive_file_id IS NULL
  THEN
    RETURN pg_catalog.jsonb_build_object('status', 'blocked');
  END IF;
  IF v_workbook.check_lease_expires_at > pg_catalog.now() THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unchanged');
  END IF;

  UPDATE plugin_data.csf_class_workbooks
  SET check_lease_token = v_token,
      check_lease_expires_at = pg_catalog.now()
        + pg_catalog.make_interval(secs => p_lease_seconds),
      updated_at = pg_catalog.now()
  WHERE id = v_workbook.id;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'leased',
    'workbookId', v_workbook.id,
    'driveFileId', v_workbook.drive_file_id,
    'ownerUserId', v_workbook.drive_owner_user_id,
    'leaseToken', v_token,
    'providerVersion', v_workbook.provider_version,
    'lastPreparedVersion', v_workbook.last_prepared_version
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_claim_class_workbook_check(
  uuid, uuid, uuid, integer
) IS
  'Claims a bounded metadata-check lease, including the explicit generation reprepare recovery state. Other blocked and unlinked workbooks remain closed.';

REVOKE ALL ON FUNCTION plugin_data.csf_claim_class_workbook_check(
  uuid, uuid, uuid, integer
) FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_class_workbook_check(
  uuid, uuid, uuid, integer
) TO service_role;
