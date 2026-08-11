-- Re-check evidence references at the last database boundary before a queued
-- Storage deletion. A queue item that became referenced again is cancelled.
CREATE OR REPLACE FUNCTION public.filter_unreferenced_waiver_storage_deletions(
  p_queue_ids uuid[]
)
RETURNS TABLE (
  id uuid,
  bucket_id text,
  object_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item public.waiver_storage_deletion_queue%ROWTYPE;
BEGIN
  IF cardinality(COALESCE(p_queue_ids, ARRAY[]::uuid[])) > 500 THEN
    RAISE EXCEPTION 'too many waiver Storage deletion items in one batch';
  END IF;

  FOR v_item IN
    SELECT queue.*
    FROM public.waiver_storage_deletion_queue AS queue
    WHERE queue.id = ANY (COALESCE(p_queue_ids, ARRAY[]::uuid[]))
    ORDER BY queue.enqueued_at, queue.id
    FOR UPDATE
  LOOP
    IF private.waiver_storage_path_is_referenced(v_item.object_path) THEN
      DELETE FROM public.waiver_storage_deletion_queue AS queue
      WHERE queue.id = v_item.id;
    ELSE
      id := v_item.id;
      bucket_id := v_item.bucket_id;
      object_path := v_item.object_path;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.filter_unreferenced_waiver_storage_deletions(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.filter_unreferenced_waiver_storage_deletions(uuid[])
  TO service_role;

COMMENT ON FUNCTION public.filter_unreferenced_waiver_storage_deletions(uuid[]) IS
  'Locks queued objects, cancels paths referenced by live waiver evidence, and returns only currently unreferenced deletion work.';
