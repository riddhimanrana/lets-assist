-- Aggregate-only worker execution receipts remain outside browser data access.
BEGIN;
CREATE TABLE app_private.worker_run_receipts (
  run_id uuid PRIMARY KEY,
  worker_key text NOT NULL CHECK (worker_key IN ('project-cancellations','csf-communications-dispatch','data-exports')),
  environment text NOT NULL CHECK (environment IN ('local','development','production')),
  source_sha text CHECK (source_sha IS NULL OR source_sha ~ '^[0-9a-f]{40}$'),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  outcome text NOT NULL DEFAULT 'started' CHECK (outcome IN ('started','no_run','processed','partial','failed')),
  code text NOT NULL DEFAULT 'started' CHECK (code IN ('started','empty_queue','completed','partial_work','worker_failed','invalid_response','unhandled_error')),
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms BETWEEN 0 AND 600000),
  attempted integer NOT NULL DEFAULT 0 CHECK (attempted BETWEEN 0 AND 1000000),
  completed integer NOT NULL DEFAULT 0 CHECK (completed BETWEEN 0 AND 1000000),
  failed integer NOT NULL DEFAULT 0 CHECK (failed BETWEEN 0 AND 1000000),
  pending integer NOT NULL DEFAULT 0 CHECK (pending BETWEEN 0 AND 1000000),
  refused integer NOT NULL DEFAULT 0 CHECK (refused BETWEEN 0 AND 1000000),
  faults integer NOT NULL DEFAULT 0 CHECK (faults BETWEEN 0 AND 1000000),
  deadline_reached boolean NOT NULL DEFAULT false,
  CHECK ((outcome = 'started' AND finished_at IS NULL AND code = 'started')
    OR (outcome <> 'started' AND finished_at IS NOT NULL AND code <> 'started')),
  CHECK ((outcome='started' AND code='started') OR (outcome='no_run' AND code='empty_queue')
    OR (outcome='processed' AND code='completed') OR (outcome='partial' AND code='partial_work')
    OR (outcome='failed' AND code IN ('worker_failed','invalid_response','unhandled_error'))),
  CHECK (outcome <> 'no_run' OR (attempted=0 AND completed=0 AND failed=0 AND pending=0 AND refused=0 AND faults=0 AND NOT deadline_reached)),
  CHECK (outcome <> 'processed' OR (failed=0 AND pending=0 AND refused=0 AND faults=0 AND NOT deadline_reached))
);
CREATE INDEX worker_run_receipts_latest_idx ON app_private.worker_run_receipts(worker_key,environment,started_at DESC,run_id DESC);
CREATE INDEX worker_run_receipts_retention_idx ON app_private.worker_run_receipts(started_at,run_id);
ALTER TABLE app_private.worker_run_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.worker_run_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.start_worker_run_receipt(p_run_id uuid,p_worker_key text,p_environment text,p_source_sha text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_run_id IS NULL OR p_worker_key IS NULL OR p_environment IS NULL THEN
    RAISE EXCEPTION 'Worker identity is required.' USING ERRCODE='22023';
  END IF;
  INSERT INTO app_private.worker_run_receipts(run_id,worker_key,environment,source_sha)
    VALUES (p_run_id,p_worker_key,p_environment,p_source_sha);
  -- Bound retention work per invocation, including concurrent runs.
  DELETE FROM app_private.worker_run_receipts WHERE run_id IN (
    SELECT run_id FROM app_private.worker_run_receipts WHERE started_at < clock_timestamp()-interval '30 days'
      ORDER BY started_at,run_id LIMIT 200 FOR UPDATE SKIP LOCKED
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.finish_worker_run_receipt(p_run_id uuid,p_worker_key text,p_environment text,p_result jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rows integer;
BEGIN
  IF p_run_id IS NULL OR p_worker_key IS NULL OR p_environment IS NULL OR p_result IS NULL
    OR jsonb_typeof(p_result) <> 'object' OR octet_length(p_result::text)>2048
    OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_result) AS key)
      IS DISTINCT FROM ARRAY['attempted','code','completed','deadlineReached','durationMs','failed','faults','outcome','pending','refused']::text[]
    OR jsonb_typeof(p_result->'outcome') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_result->'code') IS DISTINCT FROM 'string'
    OR p_result->>'outcome' NOT IN ('no_run','processed','partial','failed')
    OR p_result->>'code' NOT IN ('empty_queue','completed','partial_work','worker_failed','invalid_response','unhandled_error')
    OR jsonb_typeof(p_result->'deadlineReached') IS DISTINCT FROM 'boolean'
    OR EXISTS (SELECT 1 FROM jsonb_each(p_result) AS entry WHERE entry.key IN ('attempted','completed','failed','pending','refused','faults','durationMs')
      AND (jsonb_typeof(entry.value) <> 'number' OR entry.value::text !~ '^[0-9]+$')) THEN
    RAISE EXCEPTION 'Invalid aggregate worker result.' USING ERRCODE='22023';
  END IF;
  UPDATE app_private.worker_run_receipts SET
    outcome=p_result->>'outcome',code=p_result->>'code',finished_at=clock_timestamp(),
    duration_ms=(p_result->>'durationMs')::integer,attempted=(p_result->>'attempted')::integer,
    completed=(p_result->>'completed')::integer,failed=(p_result->>'failed')::integer,
    pending=(p_result->>'pending')::integer,refused=(p_result->>'refused')::integer,
    faults=(p_result->>'faults')::integer,deadline_reached=(p_result->>'deadlineReached')::boolean
    WHERE run_id=p_run_id AND worker_key=p_worker_key AND environment=p_environment AND outcome='started';
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Worker receipt is missing, mismatched, or already finished.' USING ERRCODE='55000';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.read_worker_run_receipts(p_worker_key text,p_environment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_worker_key IS NULL OR p_worker_key NOT IN ('project-cancellations','csf-communications-dispatch','data-exports')
    OR p_environment IS NULL OR p_environment NOT IN ('local','development','production') THEN
    RAISE EXCEPTION 'Invalid worker receipt scope.' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(recent) ORDER BY recent.started_at DESC,recent.run_id DESC),'[]'::jsonb)
    INTO v_result FROM (
      SELECT * FROM app_private.worker_run_receipts
      WHERE worker_key=p_worker_key AND environment=p_environment
        AND started_at>=clock_timestamp()-interval '30 days'
      ORDER BY started_at DESC,run_id DESC LIMIT 20
    ) recent;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.start_worker_run_receipt(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.finish_worker_run_receipt(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.read_worker_run_receipts(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.start_worker_run_receipt(uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_worker_run_receipt(uuid,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_worker_run_receipts(text,text) TO service_role;
COMMENT ON TABLE app_private.worker_run_receipts IS 'Aggregate server-only worker start/finish evidence. No recipients, job identities, request data, or raw errors. Bounded 30-day retention cleanup; read RPC excludes expired rows.';
-- These functions belong in the reviewed service RPC catalog. No client allowlist entry is needed.
COMMIT;
