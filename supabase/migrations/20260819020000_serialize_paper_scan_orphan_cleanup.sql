-- Prevent orphan-upload cleanup from deleting a paper-scan photo that becomes
-- registered after a lost create-batch response.

CREATE TABLE private.paper_scan_storage_cleanup_lock (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  lock_token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);

REVOKE ALL ON TABLE private.paper_scan_storage_cleanup_lock
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE private.paper_scan_storage_cleanup_lock TO postgres;

CREATE OR REPLACE FUNCTION public.acquire_paper_scan_storage_cleanup_lock(
  p_lock_token uuid,
  p_ttl_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_acquired boolean := false;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING errcode = '42501';
  END IF;
  IF p_lock_token IS NULL OR p_ttl_seconds < 30 OR p_ttl_seconds > 1800 THEN
    RAISE EXCEPTION 'invalid cleanup lock request' USING errcode = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('paper-scan-storage-cleanup', 0)
  );

  INSERT INTO private.paper_scan_storage_cleanup_lock (
    singleton, lock_token, expires_at
  )
  VALUES (true, p_lock_token, now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (singleton) DO UPDATE
  SET
    lock_token = excluded.lock_token,
    expires_at = excluded.expires_at
  WHERE private.paper_scan_storage_cleanup_lock.expires_at <= now()
     OR private.paper_scan_storage_cleanup_lock.lock_token = p_lock_token
  RETURNING true INTO v_acquired;

  RETURN coalesce(v_acquired, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_paper_scan_storage_cleanup_lock(
  p_lock_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING errcode = '42501';
  END IF;

  DELETE FROM private.paper_scan_storage_cleanup_lock
  WHERE singleton = true
    AND lock_token = p_lock_token;
  RETURN found;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_orphaned_paper_scan_uploads(
  p_object_paths text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_queued integer := 0;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING errcode = '42501';
  END IF;
  IF p_object_paths IS NULL
     OR cardinality(p_object_paths) < 1
     OR cardinality(p_object_paths) > 20
     OR EXISTS (
       SELECT 1 FROM unnest(p_object_paths) AS path
       WHERE path IS NULL OR length(btrim(path)) = 0
     )
  THEN
    RAISE EXCEPTION 'invalid paper scan cleanup paths' USING errcode = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('paper-scan-storage-cleanup', 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.project_paper_scan_images AS images
    WHERE images.bucket_id = 'paper-signup-scans'
      AND images.object_path = ANY (p_object_paths)
  ) THEN
    RETURN jsonb_build_object('queued', 0, 'registered', true);
  END IF;

  INSERT INTO public.paper_scan_storage_deletion_queue (bucket_id, object_path)
  SELECT 'paper-signup-scans', path
  FROM unnest(p_object_paths) AS path
  ON CONFLICT (bucket_id, object_path) DO NOTHING;
  GET DIAGNOSTICS v_queued = ROW_COUNT;

  RETURN jsonb_build_object('queued', v_queued, 'registered', false);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.guard_paper_scan_registration_during_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('paper-scan-storage-cleanup', 0)
  );

  IF EXISTS (
    SELECT 1
    FROM private.paper_scan_storage_cleanup_lock AS cleanup
    WHERE cleanup.singleton = true
      AND cleanup.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'paper scan storage cleanup is in progress'
      USING errcode = '40001';
  END IF;

  DELETE FROM public.paper_scan_storage_deletion_queue
  WHERE bucket_id = NEW.bucket_id
    AND object_path = NEW.object_path;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_paper_scan_registration_during_cleanup
  ON public.project_paper_scan_images;
CREATE TRIGGER guard_paper_scan_registration_during_cleanup
BEFORE INSERT OR UPDATE OF bucket_id, object_path
ON public.project_paper_scan_images
FOR EACH ROW
EXECUTE FUNCTION app_private.guard_paper_scan_registration_during_cleanup();

REVOKE ALL ON FUNCTION public.acquire_paper_scan_storage_cleanup_lock(uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_paper_scan_storage_cleanup_lock(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_orphaned_paper_scan_uploads(text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_paper_scan_storage_cleanup_lock(uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_paper_scan_storage_cleanup_lock(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_orphaned_paper_scan_uploads(text[])
  TO service_role;

REVOKE ALL ON FUNCTION app_private.guard_paper_scan_registration_during_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.guard_paper_scan_registration_during_cleanup()
  TO postgres;
