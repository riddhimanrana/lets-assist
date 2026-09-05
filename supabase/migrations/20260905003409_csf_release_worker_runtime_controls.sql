-- Platform worker configuration is separate from tenant and import records.
CREATE TABLE app_private.csf_release_worker_controls (
  release_sha text PRIMARY KEY CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  workbook_refresh boolean NOT NULL DEFAULT false,
  import_commit boolean NOT NULL DEFAULT false,
  communications boolean NOT NULL DEFAULT false,
  scheduled_post_publisher boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.csf_release_worker_receipts (
  request_id uuid PRIMARY KEY,
  release_sha text NOT NULL REFERENCES app_private.csf_release_worker_controls(release_sha),
  request jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX csf_release_worker_receipts_release_idx
  ON app_private.csf_release_worker_receipts (release_sha, created_at);
ALTER TABLE app_private.csf_release_worker_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.csf_release_worker_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.csf_release_worker_controls,
  app_private.csf_release_worker_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON app_private.csf_release_worker_controls,
  app_private.csf_release_worker_receipts TO postgres;

-- The runtime may read switches but cannot enable its own processing.
CREATE FUNCTION public.read_csf_release_worker_controls(p_release_sha text)
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
      'communications', communications, 'scheduled_post_publisher', scheduled_post_publisher
    )
  ) INTO v_result FROM app_private.csf_release_worker_controls
  WHERE release_sha = p_release_sha;
  RETURN coalesce(v_result, jsonb_build_object(
    'releaseSha', p_release_sha, 'revision', 0,
    'workers', jsonb_build_object(
      'workbook_refresh', false, 'import_commit', false,
      'communications', false, 'scheduled_post_publisher', false
    )
  ));
END;
$$;
REVOKE ALL ON FUNCTION public.read_csf_release_worker_controls(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_csf_release_worker_controls(text) TO service_role, postgres;

-- Only the database operator can change switches through the release workflow.
CREATE FUNCTION app_private.set_csf_release_worker_control(
  p_release_sha text, p_worker text, p_enabled boolean,
  p_expected_revision bigint, p_request_id uuid, p_actor text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_request jsonb;
  v_prior app_private.csf_release_worker_receipts%ROWTYPE;
  v_state app_private.csf_release_worker_controls%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$'
    OR p_worker IS NULL OR p_worker NOT IN ('workbook_refresh', 'import_commit', 'communications', 'scheduled_post_publisher')
    OR p_enabled IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0
    OR p_request_id IS NULL OR p_actor IS NULL OR length(trim(p_actor)) NOT BETWEEN 1 AND 200
    OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid worker transition' USING ERRCODE = '22023';
  END IF;
  v_request := jsonb_build_object('releaseSha', p_release_sha, 'worker', p_worker,
    'enabled', p_enabled, 'expectedRevision', p_expected_revision, 'actor', p_actor, 'reason', p_reason);
  -- Serializes request IDs across releases as well as transitions within one release.
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
    revision = revision + 1, updated_at = now()
    WHERE release_sha = p_release_sha;
  v_result := public.read_csf_release_worker_controls(p_release_sha)
    || jsonb_build_object('requestId', p_request_id);
  INSERT INTO app_private.csf_release_worker_receipts(request_id, release_sha, request, result)
    VALUES (p_request_id, p_release_sha, v_request, v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text) TO postgres;

CREATE FUNCTION app_private.protect_csf_release_worker_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Worker receipts are immutable' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION app_private.protect_csf_release_worker_receipt()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.protect_csf_release_worker_receipt() TO postgres;
CREATE TRIGGER csf_release_worker_receipt_immutable
  BEFORE UPDATE OR DELETE ON app_private.csf_release_worker_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.protect_csf_release_worker_receipt();
