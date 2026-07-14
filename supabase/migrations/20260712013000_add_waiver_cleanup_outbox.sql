-- Coordinate waiver-row retention cleanup with Storage through a durable
-- outbox. Database deletion and outbox creation happen in one transaction;
-- private Storage objects are removed only after that transaction commits.

CREATE TABLE public.waiver_storage_deletion_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL DEFAULT 'waiver-signatures',
  object_path text NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_error text,
  CONSTRAINT waiver_storage_deletion_queue_bucket_path_key
    UNIQUE (bucket_id, object_path),
  CONSTRAINT waiver_storage_deletion_queue_path_not_blank
    CHECK (length(btrim(object_path)) > 0)
);

ALTER TABLE public.waiver_storage_deletion_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.waiver_storage_deletion_queue
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.waiver_storage_deletion_queue TO service_role;

COMMENT ON TABLE public.waiver_storage_deletion_queue IS
  'Service-only transactional outbox for idempotent deletion of private signed-waiver evidence.';

CREATE OR REPLACE FUNCTION private.waiver_storage_paths_for_signatures(
  p_signature_ids uuid[]
)
RETURNS TABLE (object_path text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT DISTINCT paths.object_path
  FROM public.waiver_signatures AS signatures
  CROSS JOIN LATERAL (
    SELECT signatures.signature_storage_path AS object_path
    UNION ALL
    SELECT signatures.upload_storage_path AS object_path
    UNION ALL
    SELECT signer.value ->> 'data' AS object_path
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(signatures.signature_payload -> 'signers') = 'array'
          THEN signatures.signature_payload -> 'signers'
        ELSE '[]'::jsonb
      END
    ) AS signer(value)
    WHERE signer.value ->> 'method' IN ('draw', 'upload')
  ) AS paths
  WHERE signatures.id = ANY (COALESCE(p_signature_ids, ARRAY[]::uuid[]))
    AND paths.object_path IS NOT NULL
    AND length(btrim(paths.object_path)) > 0
    AND paths.object_path !~* '^(data:|https?://)';
$$;

CREATE OR REPLACE FUNCTION private.waiver_storage_path_is_referenced(
  p_object_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.waiver_signatures AS signatures
    WHERE signatures.signature_storage_path = p_object_path
      OR signatures.upload_storage_path = p_object_path
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(signatures.signature_payload -> 'signers') = 'array'
              THEN signatures.signature_payload -> 'signers'
            ELSE '[]'::jsonb
          END
        ) AS signer(value)
        WHERE signer.value ->> 'method' IN ('draw', 'upload')
          AND signer.value ->> 'data' = p_object_path
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.enqueue_unreferenced_waiver_storage_paths(
  p_paths text[]
)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO public.waiver_storage_deletion_queue (bucket_id, object_path)
  SELECT 'waiver-signatures', candidate.object_path
  FROM unnest(COALESCE(p_paths, ARRAY[]::text[])) AS candidate(object_path)
  WHERE NOT private.waiver_storage_path_is_referenced(candidate.object_path)
  ON CONFLICT (bucket_id, object_path) DO NOTHING;
$$;

REVOKE ALL ON FUNCTION private.waiver_storage_paths_for_signatures(uuid[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.waiver_storage_path_is_referenced(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.enqueue_unreferenced_waiver_storage_paths(text[])
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.archive_waiver_signatures_for_cleanup(
  p_signature_ids uuid[]
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_paths text[] := ARRAY[]::text[];
  v_deleted bigint := 0;
BEGIN
  IF cardinality(COALESCE(p_signature_ids, ARRAY[]::uuid[])) > 500 THEN
    RAISE EXCEPTION 'too many waiver signatures in one cleanup batch';
  END IF;

  SELECT COALESCE(array_agg(paths.object_path), ARRAY[]::text[])
  INTO v_paths
  FROM private.waiver_storage_paths_for_signatures(p_signature_ids) AS paths;

  DELETE FROM public.waiver_signatures
  WHERE id = ANY (COALESCE(p_signature_ids, ARRAY[]::uuid[]));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  PERFORM private.enqueue_unreferenced_waiver_storage_paths(v_paths);
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_anonymous_signups_for_cleanup(
  p_anonymous_ids uuid[]
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_signup_ids uuid[] := ARRAY[]::uuid[];
  v_signature_ids uuid[] := ARRAY[]::uuid[];
  v_paths text[] := ARRAY[]::text[];
  v_deleted bigint := 0;
BEGIN
  IF cardinality(COALESCE(p_anonymous_ids, ARRAY[]::uuid[])) > 500 THEN
    RAISE EXCEPTION 'too many anonymous profiles in one cleanup batch';
  END IF;

  SELECT COALESCE(array_agg(signups.id), ARRAY[]::uuid[])
  INTO v_signup_ids
  FROM public.project_signups AS signups
  WHERE signups.anonymous_id = ANY (COALESCE(p_anonymous_ids, ARRAY[]::uuid[]));

  SELECT COALESCE(array_agg(signatures.id), ARRAY[]::uuid[])
  INTO v_signature_ids
  FROM public.waiver_signatures AS signatures
  WHERE signatures.anonymous_id = ANY (COALESCE(p_anonymous_ids, ARRAY[]::uuid[]))
    OR signatures.signup_id = ANY (v_signup_ids);

  SELECT COALESCE(array_agg(paths.object_path), ARRAY[]::text[])
  INTO v_paths
  FROM private.waiver_storage_paths_for_signatures(v_signature_ids) AS paths;

  DELETE FROM public.waiver_signatures
  WHERE id = ANY (v_signature_ids);

  DELETE FROM public.certificates
  WHERE signup_id = ANY (v_signup_ids);

  DELETE FROM public.project_signups
  WHERE id = ANY (v_signup_ids);

  DELETE FROM public.anonymous_signups
  WHERE id = ANY (COALESCE(p_anonymous_ids, ARRAY[]::uuid[]));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  PERFORM private.enqueue_unreferenced_waiver_storage_paths(v_paths);
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_waiver_signatures_for_cleanup(uuid[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_anonymous_signups_for_cleanup(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_waiver_signatures_for_cleanup(uuid[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_anonymous_signups_for_cleanup(uuid[])
  TO service_role;

COMMENT ON FUNCTION public.archive_waiver_signatures_for_cleanup(uuid[]) IS
  'Atomically deletes waiver rows and queues now-unreferenced private evidence paths for Storage deletion.';
COMMENT ON FUNCTION public.archive_anonymous_signups_for_cleanup(uuid[]) IS
  'Atomically deletes anonymous signup dependencies and queues now-unreferenced private waiver evidence paths.';
