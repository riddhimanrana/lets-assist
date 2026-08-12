-- Preserve the meeting commit's established input-validation precedence while
-- retaining the organization identity lock as the first acquired lock.
--
-- The identity wrapper introduced in 20260812030000 delegated preview lookup
-- to the actor resolver before the historical commit body could validate the
-- requested preview. A cross-organization preview therefore changed from the
-- canonical, non-enumerating "Choose a meeting-attendance preview." refusal to
-- an authorization-helper error. Validate only the public argument shape and
-- organization-scoped preview kind before resolving actor capability; all
-- readiness, evidence, and write checks remain in the owner-internal base.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_correlation_id uuid,
  p_evidence_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_ids uuid[];
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  IF nullif(pg_catalog.btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A meeting-attendance commit reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A meeting-attendance commit actor is required.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_sheet_import_jobs AS job
    WHERE job.organization_id = p_organization_id
      AND job.id = p_preview_job_id
      AND job.mode = 'preview'
      AND job.source_type = 'meeting_attendance'
  ) THEN
    RAISE EXCEPTION 'Choose a meeting-attendance preview.';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, p_actor_user_id, p_preview_job_id
  );
  SELECT coalesce(
    pg_catalog.array_agg(
      DISTINCT import_row.matched_profile_id
      ORDER BY import_row.matched_profile_id
    ) FILTER (WHERE import_row.matched_profile_id IS NOT NULL),
    ARRAY[]::uuid[]
  )
  INTO v_profile_ids
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.job_id = p_preview_job_id
    AND import_row.import_status = 'pending';
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, v_profile_ids
  );
  RETURN plugin_data.csf_commit_meeting_attendance_import_identity_base(
    p_organization_id, p_preview_job_id, p_actor_user_id, p_reason,
    p_correlation_id, p_evidence_token
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  uuid, uuid, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  uuid, uuid, uuid, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  uuid, uuid, uuid, text, uuid, uuid
) IS 'Meeting attendance import with organization identity lock first, canonical argument and tenant-scoped preview validation second, current actor authorization third, then ordered active-profile and historical commit locks.';

COMMIT;
