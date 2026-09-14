-- Add publication bell delivery as an independent release-bound worker while
-- preserving the four-worker response consumed by already deployed hosts.
BEGIN;

ALTER TABLE app_private.csf_release_worker_controls
  ADD COLUMN publication_notifications boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.read_csf_release_worker_controls_v2(p_release_sha text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'Invalid release identity' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_build_object(
    'releaseSha', release_sha, 'revision', revision,
    'workers', jsonb_build_object(
      'workbook_refresh', workbook_refresh, 'import_commit', import_commit,
      'communications', communications,
      'scheduled_post_publisher', scheduled_post_publisher,
      'publication_notifications', publication_notifications
    )
  ) INTO v_result FROM app_private.csf_release_worker_controls
  WHERE release_sha = p_release_sha;
  RETURN coalesce(v_result, jsonb_build_object(
    'releaseSha', p_release_sha, 'revision', 0,
    'workers', jsonb_build_object(
      'workbook_refresh', false, 'import_commit', false,
      'communications', false, 'scheduled_post_publisher', false,
      'publication_notifications', false
    )
  ));
END;
$$;
REVOKE ALL ON FUNCTION public.read_csf_release_worker_controls_v2(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_csf_release_worker_controls_v2(text)
  TO service_role, postgres;

CREATE OR REPLACE FUNCTION app_private.set_csf_release_worker_control(
  p_release_sha text, p_worker text, p_enabled boolean,
  p_expected_revision bigint, p_request_id uuid, p_actor text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_request jsonb;
  v_prior app_private.csf_release_worker_receipts%ROWTYPE;
  v_state app_private.csf_release_worker_controls%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_worker = 'scheduled_post_publisher' AND p_enabled IS TRUE THEN
    RAISE EXCEPTION 'Scheduled publishing has been removed' USING ERRCODE = '55000';
  END IF;
  IF p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$'
    OR p_worker IS NULL OR p_worker NOT IN (
      'workbook_refresh', 'import_commit', 'communications',
      'scheduled_post_publisher', 'publication_notifications'
    )
    OR p_enabled IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0
    OR p_request_id IS NULL OR p_actor IS NULL OR length(trim(p_actor)) NOT BETWEEN 1 AND 200
    OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid worker transition' USING ERRCODE = '22023';
  END IF;
  v_request := jsonb_build_object('releaseSha', p_release_sha, 'worker', p_worker,
    'enabled', p_enabled, 'expectedRevision', p_expected_revision, 'actor', p_actor, 'reason', p_reason);
  PERFORM pg_catalog.pg_advisory_xact_lock(592041, 1);
  SELECT * INTO v_prior FROM app_private.csf_release_worker_receipts WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.request IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'Worker request identity conflict' USING ERRCODE = '22023';
    END IF;
    RETURN v_prior.result;
  END IF;
  INSERT INTO app_private.csf_release_worker_controls(release_sha)
    VALUES (p_release_sha) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT v_state FROM app_private.csf_release_worker_controls
    WHERE release_sha = p_release_sha FOR UPDATE;
  IF v_state.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Worker configuration changed' USING ERRCODE = '40001';
  END IF;
  IF p_enabled AND (
    (p_worker IN ('import_commit', 'communications', 'scheduled_post_publisher') AND NOT v_state.workbook_refresh)
    OR (p_worker IN ('communications', 'scheduled_post_publisher') AND NOT v_state.import_commit)
    OR (p_worker = 'scheduled_post_publisher' AND NOT v_state.communications)
  ) THEN
    RAISE EXCEPTION 'Enable preceding workers first' USING ERRCODE = '22023';
  END IF;
  UPDATE app_private.csf_release_worker_controls SET
    workbook_refresh = CASE WHEN p_worker = 'workbook_refresh' THEN p_enabled ELSE workbook_refresh END,
    import_commit = CASE WHEN p_worker = 'import_commit' THEN p_enabled ELSE import_commit END,
    communications = CASE WHEN p_worker = 'communications' THEN p_enabled ELSE communications END,
    scheduled_post_publisher = CASE WHEN p_worker = 'scheduled_post_publisher' THEN p_enabled ELSE scheduled_post_publisher END,
    publication_notifications = CASE WHEN p_worker = 'publication_notifications' THEN p_enabled ELSE publication_notifications END,
    revision = revision + 1, updated_at = now()
    WHERE release_sha = p_release_sha;
  -- Legacy callers keep the exact four-worker receipt shape. The new worker is
  -- transitioned and read through the v2 contract.
  v_result := CASE WHEN p_worker = 'publication_notifications'
    THEN public.read_csf_release_worker_controls_v2(p_release_sha)
    ELSE public.read_csf_release_worker_controls(p_release_sha) END
    || jsonb_build_object('requestId', p_request_id);
  INSERT INTO app_private.csf_release_worker_receipts(request_id, release_sha, request, result)
    VALUES (p_request_id, p_release_sha, v_request, v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)
  TO postgres;

NOTIFY pgrst, 'reload schema';
COMMIT;
