BEGIN;

-- Storage and Postgres cannot participate in one transaction. Keep the
-- intended private object in Postgres first, then make the claim reviewable
-- only after the object upload has been finalized.
ALTER TABLE plugin_data.csf_submission_files
  ADD COLUMN IF NOT EXISTS upload_status text NOT NULL DEFAULT 'finalized',
  ADD COLUMN IF NOT EXISTS upload_token uuid,
  ADD COLUMN IF NOT EXISTS upload_correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE plugin_data.csf_submission_files
SET finalized_at = coalesce(finalized_at, created_at),
    upload_status = 'finalized',
    updated_at = greatest(updated_at, created_at)
WHERE finalized_at IS NULL
  AND failed_at IS NULL;

ALTER TABLE plugin_data.csf_submission_files
  ADD CONSTRAINT csf_submission_files_upload_status_check
    CHECK (upload_status IN ('pending', 'finalized', 'failed')),
  ADD CONSTRAINT csf_submission_files_upload_state_check
    CHECK (
      (upload_status = 'pending'
        AND upload_token IS NOT NULL
        AND finalized_at IS NULL
        AND failed_at IS NULL)
      OR
      (upload_status = 'finalized'
        AND finalized_at IS NOT NULL
        AND failed_at IS NULL)
      OR
      (upload_status = 'failed'
        AND finalized_at IS NULL
        AND failed_at IS NOT NULL)
    );

ALTER TABLE plugin_data.csf_point_submissions
  ADD CONSTRAINT csf_point_submissions_id_organization_id_key
    UNIQUE (id, organization_id);
ALTER TABLE plugin_data.csf_submission_files
  ADD CONSTRAINT csf_submission_files_id_organization_id_key
    UNIQUE (id, organization_id),
  ADD CONSTRAINT csf_submission_files_submission_organization_fkey
    FOREIGN KEY (submission_id, organization_id)
    REFERENCES plugin_data.csf_point_submissions (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT csf_submission_files_profile_organization_fkey
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT csf_submission_files_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS csf_submission_files_pending_upload_idx
  ON plugin_data.csf_submission_files (created_at, id)
  WHERE upload_status = 'pending';

CREATE TABLE plugin_data.csf_storage_deletion_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  submission_file_id uuid REFERENCES plugin_data.csf_submission_files(id) ON DELETE SET NULL,
  bucket text NOT NULL,
  object_path text NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  CONSTRAINT csf_storage_deletion_queue_bucket_path_key UNIQUE (bucket, object_path),
  CONSTRAINT csf_storage_deletion_queue_bucket_not_blank CHECK (length(btrim(bucket)) > 0),
  CONSTRAINT csf_storage_deletion_queue_path_not_blank CHECK (length(btrim(object_path)) > 0)
);

CREATE INDEX csf_storage_deletion_queue_enqueued_idx
  ON plugin_data.csf_storage_deletion_queue (enqueued_at, id);

ALTER TABLE plugin_data.csf_storage_deletion_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_storage_deletion_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE plugin_data.csf_storage_deletion_queue TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_guard_point_submission_proof_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'submitted', 'withdrawn') THEN
    RAISE EXCEPTION 'A draft point submission cannot be reviewed before its proof upload is finalized.';
  END IF;

  IF OLD.status = 'draft'
    AND NEW.status = 'submitted'
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = NEW.organization_id
        AND proof.submission_id = NEW.id
        AND proof.upload_status <> 'finalized'
    ) THEN
    RAISE EXCEPTION 'Point-submission proof must be finalized before submission.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS csf_guard_point_submission_proof_transition
  ON plugin_data.csf_point_submissions;
CREATE TRIGGER csf_guard_point_submission_proof_transition
  BEFORE UPDATE OF status ON plugin_data.csf_point_submissions
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_guard_point_submission_proof_transition();

CREATE OR REPLACE FUNCTION plugin_data.csf_begin_point_submission(
  p_organization_id uuid,
  p_submission_id uuid,
  p_profile_id uuid,
  p_term_id uuid,
  p_opportunity_id uuid,
  p_partner_club_term_id uuid,
  p_source text,
  p_description text,
  p_claimed_points numeric,
  p_point_type text,
  p_activity_date date,
  p_actor_user_id uuid,
  p_file_id uuid,
  p_file_bucket text,
  p_file_object_path text,
  p_file_original_filename text,
  p_file_mime_type text,
  p_file_size_bytes bigint,
  p_upload_token uuid,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_has_proof boolean := p_file_object_path IS NOT NULL;
  v_status text := CASE WHEN p_file_object_path IS NULL THEN 'submitted' ELSE 'draft' END;
  v_now timestamptz := now();
BEGIN
  IF p_submission_id IS NULL OR p_profile_id IS NULL OR p_term_id IS NULL
    OR p_actor_user_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Point-submission identity is incomplete.';
  END IF;
  IF p_claimed_points IS NULL OR p_claimed_points <= 0 THEN
    RAISE EXCEPTION 'Claimed points must be greater than zero.';
  END IF;
  IF p_point_type NOT IN ('non_drive', 'drive') THEN
    RAISE EXCEPTION 'Point type is invalid.';
  END IF;
  IF p_opportunity_id IS NOT NULL AND p_partner_club_term_id IS NOT NULL THEN
    RAISE EXCEPTION 'Choose one structured point source.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Point-submission actor is not an organization member.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profiles AS profile
    WHERE profile.id = p_profile_id
      AND profile.organization_id = p_organization_id
      AND profile.record_status = 'active'
  ) THEN
    RAISE EXCEPTION 'CSF profile was not found.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_terms AS term
    WHERE term.id = p_term_id
      AND term.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'CSF term was not found.';
  END IF;
  IF p_opportunity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_opportunities AS opportunity
    WHERE opportunity.id = p_opportunity_id
      AND opportunity.organization_id = p_organization_id
      AND opportunity.term_id = p_term_id
  ) THEN
    RAISE EXCEPTION 'CSF activity belongs to a different organization or term.';
  END IF;
  IF p_partner_club_term_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_partner_club_terms AS club_term
    WHERE club_term.id = p_partner_club_term_id
      AND club_term.organization_id = p_organization_id
      AND club_term.term_id = p_term_id
  ) THEN
    RAISE EXCEPTION 'Partner-club policy belongs to a different organization or term.';
  END IF;

  IF v_has_proof THEN
    IF p_file_id IS NULL OR p_upload_token IS NULL
      OR nullif(btrim(coalesce(p_file_bucket, '')), '') IS NULL
      OR nullif(btrim(coalesce(p_file_original_filename, '')), '') IS NULL
      OR p_file_size_bytes IS NULL OR p_file_size_bytes <= 0 THEN
      RAISE EXCEPTION 'Pending proof metadata is incomplete.';
    END IF;
    IF p_file_bucket <> 'csf-private' THEN
      RAISE EXCEPTION 'CSF proof must use the private CSF bucket.';
    END IF;
  ELSIF p_file_id IS NOT NULL OR p_upload_token IS NOT NULL OR p_file_bucket IS NOT NULL
    OR p_file_original_filename IS NOT NULL OR p_file_mime_type IS NOT NULL
    OR p_file_size_bytes IS NOT NULL THEN
    RAISE EXCEPTION 'Proof metadata was provided without an object path.';
  END IF;

  INSERT INTO plugin_data.csf_point_submissions (
    id, organization_id, profile_id, term_id, opportunity_id, partner_club_term_id,
    source, description, claimed_points, point_type, activity_date, status,
    submitted_by, submitted_at, created_at, updated_at
  ) VALUES (
    p_submission_id, p_organization_id, p_profile_id, p_term_id, p_opportunity_id,
    p_partner_club_term_id, p_source, p_description, p_claimed_points, p_point_type,
    p_activity_date, v_status, p_actor_user_id, v_now, v_now, v_now
  );

  IF v_has_proof THEN
    INSERT INTO plugin_data.csf_submission_files (
      id, organization_id, submission_id, profile_id, term_id, bucket, object_path,
      original_filename, mime_type, size_bytes, uploaded_by, upload_status,
      upload_token, upload_correlation_id, created_at, updated_at
    ) VALUES (
      p_file_id, p_organization_id, p_submission_id, p_profile_id, p_term_id,
      p_file_bucket, p_file_object_path, p_file_original_filename, p_file_mime_type,
      p_file_size_bytes, p_actor_user_id, 'pending', p_upload_token, p_correlation_id,
      v_now, v_now
    );
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type, target_id,
    term_id, before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, p_profile_id,
    CASE WHEN v_has_proof THEN 'point_submission.proof_pending' ELSE 'point_submission.create' END,
    'csf_point_submissions', p_submission_id, p_term_id, NULL,
    jsonb_build_object(
      'status', v_status,
      'claimedPoints', p_claimed_points,
      'pointType', p_point_type,
      'hasProof', v_has_proof,
      'proofStatus', CASE WHEN v_has_proof THEN 'pending' ELSE NULL END,
      'opportunityId', p_opportunity_id,
      'partnerClubTermId', p_partner_club_term_id
    ),
    p_correlation_id, 'point_submission', p_submission_id::text,
    CASE WHEN v_has_proof THEN 'point_proof_upload_started' ELSE 'point_submission_created' END
  );

  RETURN jsonb_build_object(
    'submissionId', p_submission_id,
    'fileId', p_file_id,
    'status', v_status,
    'correlationId', p_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_finalize_point_submission_proof(
  p_organization_id uuid,
  p_submission_id uuid,
  p_file_id uuid,
  p_upload_token uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_file plugin_data.csf_submission_files%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  SELECT proof.* INTO v_file
  FROM plugin_data.csf_submission_files AS proof
  WHERE proof.organization_id = p_organization_id
    AND proof.submission_id = p_submission_id
    AND proof.id = p_file_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending proof record was not found.'; END IF;
  IF v_file.upload_status <> 'pending' OR v_file.upload_token IS DISTINCT FROM p_upload_token THEN
    RAISE EXCEPTION 'Pending proof token is invalid or has already been used.';
  END IF;
  IF v_file.uploaded_by IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Only the proof uploader may finalize this upload.';
  END IF;

  SELECT submission.* INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND OR v_submission.status <> 'draft' THEN
    RAISE EXCEPTION 'Point submission is not awaiting proof finalization.';
  END IF;

  UPDATE plugin_data.csf_submission_files
  SET upload_status = 'finalized', finalized_at = v_now, failed_at = NULL,
      last_error = NULL, updated_at = v_now
  WHERE organization_id = p_organization_id AND id = p_file_id;

  UPDATE plugin_data.csf_point_submissions
  SET status = 'submitted', submitted_at = v_now, updated_at = v_now
  WHERE organization_id = p_organization_id AND id = p_submission_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type, target_id,
    term_id, before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_submission.profile_id,
    'point_submission.create', 'csf_point_submissions', p_submission_id,
    v_submission.term_id,
    jsonb_build_object('status', 'draft', 'proofStatus', 'pending'),
    jsonb_build_object(
      'status', 'submitted', 'proofStatus', 'finalized', 'proofFileId', p_file_id,
      'claimedPoints', v_submission.claimed_points, 'pointType', v_submission.point_type
    ),
    v_file.upload_correlation_id, 'point_submission', p_submission_id::text,
    'point_proof_upload_finalized'
  );

  RETURN jsonb_build_object(
    'submissionId', p_submission_id,
    'fileId', p_file_id,
    'status', 'submitted',
    'correlationId', v_file.upload_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_fail_point_submission_proof(
  p_organization_id uuid,
  p_submission_id uuid,
  p_file_id uuid,
  p_upload_token uuid,
  p_actor_user_id uuid,
  p_error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_file plugin_data.csf_submission_files%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_error text := left(coalesce(nullif(btrim(p_error), ''), 'Proof upload did not complete.'), 1000);
  v_now timestamptz := now();
BEGIN
  SELECT proof.* INTO v_file
  FROM plugin_data.csf_submission_files AS proof
  WHERE proof.organization_id = p_organization_id
    AND proof.submission_id = p_submission_id
    AND proof.id = p_file_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending proof record was not found.'; END IF;
  IF v_file.upload_status <> 'pending' OR v_file.upload_token IS DISTINCT FROM p_upload_token THEN
    RAISE EXCEPTION 'Pending proof token is invalid or has already been used.';
  END IF;
  IF v_file.uploaded_by IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Only the proof uploader may fail this upload.';
  END IF;

  SELECT submission.* INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND OR v_submission.status <> 'draft' THEN
    RAISE EXCEPTION 'Point submission is not awaiting proof upload.';
  END IF;

  UPDATE plugin_data.csf_submission_files
  SET upload_status = 'failed', failed_at = v_now, finalized_at = NULL,
      last_error = v_error, updated_at = v_now
  WHERE organization_id = p_organization_id AND id = p_file_id;

  UPDATE plugin_data.csf_point_submissions
  SET status = 'withdrawn', updated_at = v_now
  WHERE organization_id = p_organization_id AND id = p_submission_id;

  INSERT INTO plugin_data.csf_storage_deletion_queue (
    organization_id, submission_file_id, bucket, object_path
  ) VALUES (
    p_organization_id, p_file_id, v_file.bucket, v_file.object_path
  ) ON CONFLICT (bucket, object_path) DO NOTHING;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type, target_id,
    term_id, before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_submission.profile_id,
    'point_submission.proof_failed', 'csf_point_submissions', p_submission_id,
    v_submission.term_id,
    jsonb_build_object('status', 'draft', 'proofStatus', 'pending'),
    jsonb_build_object('status', 'withdrawn', 'proofStatus', 'failed'),
    v_file.upload_correlation_id, 'point_submission', p_submission_id::text,
    'point_proof_upload_failed'
  );

  RETURN jsonb_build_object(
    'submissionId', p_submission_id,
    'fileId', p_file_id,
    'status', 'withdrawn',
    'correlationId', v_file.upload_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_enqueue_stale_submission_proof_cleanup(
  p_cutoff timestamptz,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_file record;
  v_count integer := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 250), 1), 500);
  v_now timestamptz := now();
BEGIN
  IF p_cutoff IS NULL OR p_cutoff > v_now - interval '5 minutes' THEN
    RAISE EXCEPTION 'Stale-proof cutoff must be at least five minutes old.';
  END IF;

  FOR v_file IN
    SELECT proof.*, submission.profile_id AS submission_profile_id,
      submission.term_id AS submission_term_id, submission.status AS submission_status
    FROM plugin_data.csf_submission_files AS proof
    JOIN plugin_data.csf_point_submissions AS submission
      ON submission.id = proof.submission_id
      AND submission.organization_id = proof.organization_id
    WHERE proof.upload_status = 'pending'
      AND proof.created_at <= p_cutoff
    ORDER BY proof.created_at, proof.id
    LIMIT v_limit
    FOR UPDATE OF proof SKIP LOCKED
  LOOP
    UPDATE plugin_data.csf_submission_files
    SET upload_status = 'failed', failed_at = v_now, finalized_at = NULL,
        last_error = 'Proof upload expired before finalization.', updated_at = v_now
    WHERE id = v_file.id AND organization_id = v_file.organization_id;

    IF v_file.submission_status = 'draft' THEN
      UPDATE plugin_data.csf_point_submissions
      SET status = 'withdrawn', updated_at = v_now
      WHERE id = v_file.submission_id
        AND organization_id = v_file.organization_id;
    END IF;

    INSERT INTO plugin_data.csf_storage_deletion_queue (
      organization_id, submission_file_id, bucket, object_path
    ) VALUES (
      v_file.organization_id, v_file.id, v_file.bucket, v_file.object_path
    ) ON CONFLICT (bucket, object_path) DO NOTHING;

    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_profile_id, action, target_type, target_id, term_id,
      before_data, after_data, correlation_id, source_type, source_id, reason_code
    ) VALUES (
      v_file.organization_id, v_file.submission_profile_id,
      'point_submission.proof_abandoned', 'csf_point_submissions', v_file.submission_id,
      v_file.submission_term_id,
      jsonb_build_object('status', v_file.submission_status, 'proofStatus', 'pending'),
      jsonb_build_object('status', 'withdrawn', 'proofStatus', 'failed'),
      v_file.upload_correlation_id, 'point_submission', v_file.submission_id::text,
      'point_proof_upload_abandoned'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('enqueued', v_count, 'cutoff', p_cutoff);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_guard_point_submission_proof_transition()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_begin_point_submission(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  uuid, text, text, text, text, bigint, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_finalize_point_submission_proof(uuid, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_fail_point_submission_proof(uuid, uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_enqueue_stale_submission_proof_cleanup(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_point_submission(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  uuid, text, text, text, text, bigint, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finalize_point_submission_proof(uuid, uuid, uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_fail_point_submission_proof(uuid, uuid, uuid, uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_enqueue_stale_submission_proof_cleanup(timestamptz, integer)
  TO service_role;

COMMENT ON TABLE plugin_data.csf_storage_deletion_queue IS
  'Service-only, idempotent outbox for private CSF proof objects left by failed or abandoned uploads.';
COMMENT ON FUNCTION plugin_data.csf_begin_point_submission(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  uuid, text, text, text, text, bigint, uuid, uuid
) IS
  'Atomically creates a CSF point submission and, when present, its pending private proof record.';
COMMENT ON FUNCTION plugin_data.csf_finalize_point_submission_proof(uuid, uuid, uuid, uuid, uuid) IS
  'Atomically finalizes private proof metadata, submits the claim, and writes its immutable audit event.';
COMMENT ON FUNCTION plugin_data.csf_fail_point_submission_proof(uuid, uuid, uuid, uuid, uuid, text) IS
  'Atomically fails a pending proof upload, withdraws the draft claim, queues object cleanup, and audits the failure.';

NOTIFY pgrst, 'reload schema';

COMMIT;
