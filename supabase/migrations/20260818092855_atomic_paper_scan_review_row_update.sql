-- Keep reviewer edits in the same lock domain as commit/discard. The parent
-- batch row is locked first by all three operations, so a row can never be
-- edited after a concurrent commit has made the batch terminal.

CREATE OR REPLACE FUNCTION public.update_paper_scan_review_row(
  p_batch_id uuid,
  p_project_id uuid,
  p_row_id uuid,
  p_actor_id uuid,
  p_patch jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch public.project_paper_scan_batches%ROWTYPE;
  v_name text;
  v_email text;
  v_phone text;
  v_check_in_time timestamptz;
  v_check_out_time timestamptz;
  v_signature_present boolean;
  v_decision text;
  v_match_signup_id uuid;
BEGIN
  IF p_batch_id IS NULL OR p_project_id IS NULL OR p_row_id IS NULL
     OR p_actor_id IS NULL OR p_patch IS NULL
     OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'update_paper_scan_review_row: invalid input';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_patch) AS supplied(key)
    WHERE supplied.key NOT IN (
      'name', 'email', 'phone', 'checkInTime', 'checkOutTime',
      'signaturePresent', 'decision', 'matchSignupId'
    )
  ) THEN
    RAISE EXCEPTION 'update_paper_scan_review_row: unsupported patch key';
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
    RAISE EXCEPTION 'update_paper_scan_review_row: actor is not a project organizer';
  END IF;

  IF v_batch.status <> 'review' THEN
    RETURN 'not_review';
  END IF;

  IF p_patch ? 'name' THEN
    IF jsonb_typeof(p_patch->'name') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid name';
    END IF;
    v_name := CASE WHEN jsonb_typeof(p_patch->'name') = 'null' THEN NULL ELSE p_patch->>'name' END;
  END IF;
  IF p_patch ? 'email' THEN
    IF jsonb_typeof(p_patch->'email') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid email';
    END IF;
    v_email := CASE WHEN jsonb_typeof(p_patch->'email') = 'null' THEN NULL ELSE lower(p_patch->>'email') END;
  END IF;
  IF p_patch ? 'phone' THEN
    IF jsonb_typeof(p_patch->'phone') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid phone';
    END IF;
    v_phone := CASE WHEN jsonb_typeof(p_patch->'phone') = 'null' THEN NULL ELSE p_patch->>'phone' END;
  END IF;
  IF p_patch ? 'checkInTime' THEN
    IF jsonb_typeof(p_patch->'checkInTime') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid check-in';
    END IF;
    IF jsonb_typeof(p_patch->'checkInTime') <> 'null' THEN
      v_check_in_time := (p_patch->>'checkInTime')::timestamptz;
    END IF;
  END IF;
  IF p_patch ? 'checkOutTime' THEN
    IF jsonb_typeof(p_patch->'checkOutTime') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid check-out';
    END IF;
    IF jsonb_typeof(p_patch->'checkOutTime') <> 'null' THEN
      v_check_out_time := (p_patch->>'checkOutTime')::timestamptz;
    END IF;
  END IF;
  IF p_patch ? 'signaturePresent' THEN
    IF jsonb_typeof(p_patch->'signaturePresent') <> 'boolean' THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid signature flag';
    END IF;
    v_signature_present := (p_patch->>'signaturePresent')::boolean;
  END IF;
  IF p_patch ? 'decision' THEN
    IF jsonb_typeof(p_patch->'decision') <> 'string'
       OR (p_patch->>'decision') NOT IN ('pending', 'include', 'exclude') THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid decision';
    END IF;
    v_decision := p_patch->>'decision';
  END IF;
  IF p_patch ? 'matchSignupId' THEN
    IF jsonb_typeof(p_patch->'matchSignupId') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid signup match';
    END IF;
    IF jsonb_typeof(p_patch->'matchSignupId') <> 'null' THEN
      v_match_signup_id := (p_patch->>'matchSignupId')::uuid;
    END IF;
  END IF;

  UPDATE public.project_paper_scan_rows AS rows
  SET name = CASE WHEN p_patch ? 'name' THEN v_name ELSE rows.name END,
      email = CASE WHEN p_patch ? 'email' THEN v_email ELSE rows.email END,
      phone = CASE WHEN p_patch ? 'phone' THEN v_phone ELSE rows.phone END,
      check_in_time = CASE WHEN p_patch ? 'checkInTime' THEN v_check_in_time ELSE rows.check_in_time END,
      check_out_time = CASE WHEN p_patch ? 'checkOutTime' THEN v_check_out_time ELSE rows.check_out_time END,
      signature_present = CASE WHEN p_patch ? 'signaturePresent' THEN v_signature_present ELSE rows.signature_present END,
      decision = CASE WHEN p_patch ? 'decision' THEN v_decision ELSE rows.decision END,
      match_signup_id = CASE WHEN p_patch ? 'matchSignupId' THEN v_match_signup_id ELSE rows.match_signup_id END
  WHERE rows.id = p_row_id
    AND rows.batch_id = p_batch_id
    AND rows.project_id = p_project_id;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  RETURN 'updated';
END;
$$;

REVOKE ALL ON FUNCTION public.update_paper_scan_review_row(uuid, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_paper_scan_review_row(uuid, uuid, uuid, uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.update_paper_scan_review_row(uuid, uuid, uuid, uuid, jsonb) IS
  'Service-only atomic review edit. Locks the parent batch shared with commit/discard, rechecks the explicit actor, and updates only while the batch remains in review.';
