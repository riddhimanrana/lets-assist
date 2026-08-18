-- Production review follow-up: make paper-scan discard one locked database
-- transaction. A concurrent commit and discard must not both win, and an
-- image may be marked purged only when its durable Storage deletion outbox
-- row was inserted in the same transaction.

CREATE OR REPLACE FUNCTION public.discard_paper_scan_batch(
  p_batch_id uuid,
  p_project_id uuid,
  p_actor_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch public.project_paper_scan_batches%ROWTYPE;
BEGIN
  IF p_batch_id IS NULL OR p_project_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'discard_paper_scan_batch: invalid input';
  END IF;

  SELECT batches.*
  INTO v_batch
  FROM public.project_paper_scan_batches AS batches
  WHERE batches.id = p_batch_id
    AND batches.project_id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF NOT app_private.can_manage_project(v_batch.project_id, p_actor_id) THEN
    RAISE EXCEPTION 'discard_paper_scan_batch: actor is not a project organizer';
  END IF;

  -- commit_paper_signup_batch holds this same row lock for its entire
  -- transaction. After waiting for it, this branch observes committed and
  -- cannot overwrite the terminal state.
  IF v_batch.status = 'committed' THEN
    RETURN 'committed';
  END IF;

  IF v_batch.status NOT IN ('draft', 'extracting', 'review', 'failed', 'discarded') THEN
    RETURN 'unavailable';
  END IF;

  INSERT INTO public.paper_scan_storage_deletion_queue (bucket_id, object_path)
  SELECT images.bucket_id, images.object_path
  FROM public.project_paper_scan_images AS images
  WHERE images.batch_id = p_batch_id
    AND images.purged_at IS NULL
  ON CONFLICT (bucket_id, object_path) DO NOTHING;

  UPDATE public.project_paper_scan_images
  SET purged_at = now()
  WHERE batch_id = p_batch_id
    AND purged_at IS NULL;

  UPDATE public.project_paper_scan_batches
  SET status = 'discarded',
      extraction_claim_id = NULL
  WHERE id = p_batch_id;

  RETURN 'discarded';
END;
$$;

REVOKE ALL ON FUNCTION public.discard_paper_scan_batch(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_paper_scan_batch(uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.discard_paper_scan_batch(uuid, uuid, uuid) IS
  'Service-only atomic paper-scan discard. Locks against commit, rechecks the explicit actor, and couples Storage deletion outbox rows to image purge markers.';
