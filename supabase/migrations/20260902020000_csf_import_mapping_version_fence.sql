-- Refuse a preview after its source mapping changes. Provider revision checks
-- prove which workbook bytes were read, but a mapping-only edit does not alter
-- those bytes. Batch approval and the final commit claim therefore compare the
-- preview's immutable mapping version with the current source under a row lock.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_import_preview_mapping_current(
  p_organization_id uuid,
  p_preview_job_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_mapping_version_max constant bigint := 2147483647;
  v_preview_source_id uuid;
  v_preview_mapping_version integer;
  v_source_settings jsonb;
  v_source_mapping_version integer := 1;
  v_source_mapping_version_text text;
BEGIN
  IF p_organization_id IS NULL OR p_preview_job_id IS NULL THEN
    RAISE EXCEPTION 'A CSF mapping check requires an organization and preview.'
      USING ERRCODE = '22023';
  END IF;

  -- Preview provenance is immutable after sealing, so this read needs no row
  -- lock. The source mapping is mutable, and FOR SHARE keeps a successful
  -- comparison stable through the caller's approval or claim transaction.
  SELECT preview.source_id, preview.mapping_version
  INTO v_preview_source_id, v_preview_mapping_version
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id
    AND preview.mode = 'preview';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This import preview is no longer available.'
      USING ERRCODE = '23503';
  END IF;
  -- Historical source-less previews predate this fence. Preserve their queue
  -- behavior; the existing provider-evidence boundary still refuses any later
  -- source-backed commit without a source. New previews always record one.
  IF v_preview_source_id IS NULL THEN
    RETURN;
  END IF;
  IF v_preview_mapping_version IS NULL OR v_preview_mapping_version < 1 THEN
    RAISE EXCEPTION 'This import preview has no valid mapping version. Preview it again.'
      USING ERRCODE = '23514';
  END IF;

  SELECT source.settings
  INTO v_source_settings
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = v_preview_source_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The source for this import preview no longer exists.'
      USING ERRCODE = '23503';
  END IF;

  -- Version 1 predates the settings key and remains the compatibility default.
  -- Once present, the value must be one exact positive JSON integer. Validate
  -- its grammar and bound before casting so corrupt settings fail with fixed
  -- operational text instead of echoing a database conversion error.
  IF v_source_settings ? 'mappingVersion' THEN
    IF pg_catalog.jsonb_typeof(v_source_settings -> 'mappingVersion') <> 'number' THEN
      RAISE EXCEPTION 'This import source has no valid mapping version. Save its mapping again.'
        USING ERRCODE = '23514';
    END IF;
    v_source_mapping_version_text := v_source_settings ->> 'mappingVersion';
    IF v_source_mapping_version_text IS NULL
      OR v_source_mapping_version_text !~ '^[1-9][0-9]{0,9}$'
    THEN
      RAISE EXCEPTION 'This import source has no valid mapping version. Save its mapping again.'
        USING ERRCODE = '23514';
    END IF;
    IF v_source_mapping_version_text::bigint > c_mapping_version_max THEN
      RAISE EXCEPTION 'This import source has no valid mapping version. Save its mapping again.'
        USING ERRCODE = '23514';
    END IF;
    v_source_mapping_version := v_source_mapping_version_text::integer;
  END IF;

  IF v_preview_mapping_version IS DISTINCT FROM v_source_mapping_version THEN
    RAISE EXCEPTION 'This source mapping changed after the preview. Run a fresh preview.'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_import_preview_mapping_current(
  uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_import_preview_mapping_current(
  uuid, uuid
) TO postgres;

COMMENT ON FUNCTION plugin_data.csf_assert_import_preview_mapping_current(
  uuid, uuid
) IS
  'Owner-internal mapping fence. Locks the current source mapping and refuses a preview whose immutable mapping version is stale or malformed.';

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_import_preview_batch_unserialized(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_preview_job_ids uuid[],
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch plugin_data.csf_import_approval_batches%ROWTYPE;
  v_preview_id uuid;
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_readiness jsonb;
  v_queue_id uuid;
  v_state text;
  v_reason text;
  v_actor_authorized boolean;
  v_mapping_current boolean;
  v_queued integer := 0;
  v_blocked integer := 0;
  v_stale integer := 0;
  v_completed integer := 0;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A batch request ID is required.';
  END IF;
  IF coalesce(pg_catalog.cardinality(p_preview_job_ids), 0) < 1
    OR pg_catalog.cardinality(p_preview_job_ids) > 100
  THEN
    RAISE EXCEPTION 'Choose between one and 100 import previews.';
  END IF;
  IF pg_catalog.cardinality(p_preview_job_ids) <> (
    SELECT pg_catalog.count(DISTINCT preview_id)
    FROM pg_catalog.unnest(p_preview_job_ids) AS preview_id
  ) THEN
    RAISE EXCEPTION 'Each import preview may appear only once.';
  END IF;

  SELECT * INTO v_batch
  FROM plugin_data.csf_import_approval_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.request_id = p_request_id;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'batchId', v_batch.id,
      'requested', v_batch.requested_count,
      'queued', v_batch.queued_count,
      'blocked', v_batch.blocked_count,
      'stale', v_batch.stale_count,
      'completed', v_batch.completed_count,
      'replayed', true
    );
  END IF;

  INSERT INTO plugin_data.csf_import_approval_batches (
    organization_id, actor_user_id, request_id, requested_count
  ) VALUES (
    p_organization_id, p_actor_user_id, p_request_id,
    pg_catalog.cardinality(p_preview_job_ids)
  )
  RETURNING * INTO v_batch;

  FOREACH v_preview_id IN ARRAY p_preview_job_ids LOOP
    v_state := 'stale';
    v_reason := 'preview_unavailable';
    v_queue_id := NULL;
    v_actor_authorized := true;
    v_mapping_current := true;

    -- Serialize approvals that may create the first queue row for this preview,
    -- then follow the worker's queue-before-preview lock order. A queue cannot
    -- become visible to a worker until the creating approval commits.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'csf_import_preview_queue:'
          || p_organization_id::text
          || ':'
          || v_preview_id::text,
        0
      )
    );
    PERFORM queue.id
    FROM plugin_data.csf_import_commit_queue AS queue
    WHERE queue.organization_id = p_organization_id
      AND queue.preview_job_id = v_preview_id
    FOR UPDATE;

    SELECT * INTO v_preview
    FROM plugin_data.csf_sheet_import_jobs AS preview
    WHERE preview.organization_id = p_organization_id
      AND preview.id = v_preview_id
      AND preview.mode = 'preview'
    FOR UPDATE;

    IF FOUND AND v_preview.status IN ('completed', 'needs_resolution') THEN
      BEGIN
        PERFORM plugin_data.csf_assert_import_actor(
          p_organization_id,
          p_actor_user_id,
          v_preview.source_type
        );
      EXCEPTION
        WHEN SQLSTATE '42501' THEN
          v_actor_authorized := false;
          v_state := 'blocked';
          v_reason := 'actor_not_authorized';
          v_blocked := v_blocked + 1;
      END;

      IF v_actor_authorized THEN
        BEGIN
          PERFORM plugin_data.csf_assert_import_preview_workbook_generation_current(
            p_organization_id,
            v_preview_id
          );
          PERFORM plugin_data.csf_assert_import_preview_mapping_current(
            p_organization_id,
            v_preview_id
          );
        EXCEPTION
          WHEN SQLSTATE '55000' OR SQLSTATE '23503' OR SQLSTATE '23514' THEN
            v_mapping_current := false;
            v_state := 'stale';
            v_reason := 'source_mapping_changed';
            v_stale := v_stale + 1;
        END;

        IF v_mapping_current THEN
          v_readiness := plugin_data.csf_import_preview_readiness(
            p_organization_id,
            v_preview_id
          );
          IF v_readiness ->> 'commitState' = 'completed' THEN
            v_state := 'completed';
            v_reason := NULL;
            v_completed := v_completed + 1;
          ELSIF v_readiness ->> 'commitState' IN ('running', 'cancelled')
            OR coalesce((v_readiness ->> 'ambiguous')::integer, 0) > 0
            OR coalesce((v_readiness ->> 'conflict')::integer, 0) > 0
            OR coalesce((v_readiness ->> 'duplicate')::integer, 0) > 0
            OR coalesce((v_readiness ->> 'error')::integer, 0) > 0
            OR coalesce((v_readiness ->> 'pendingMissingCohort')::integer, 0) > 0
            OR coalesce((v_readiness ->> 'pendingMissingTerm')::integer, 0) > 0
            OR coalesce((v_readiness ->> 'pendingMissingMatch')::integer, 0) > 0
            OR coalesce((v_readiness ->> 'inFlight')::integer, 0) > 0
            OR coalesce((v_readiness ->> 'unknownOutcome')::integer, 0) > 0
            OR coalesce((v_readiness ->> 'historicalUnknown')::integer, 0) > 0
          THEN
            v_state := 'blocked';
            v_reason := 'preview_requires_review';
            v_blocked := v_blocked + 1;
          ELSE
            -- Exact completed previews returned above. A completed queue that
            -- reaches this branch belongs to a partial commit whose remaining
            -- rows were resolved, so a new officer approval may requeue it.
            INSERT INTO plugin_data.csf_import_commit_queue (
              organization_id, preview_job_id, actor_user_id, status, updated_at
            ) VALUES (
              p_organization_id, v_preview_id, p_actor_user_id, 'queued',
              pg_catalog.now()
            )
            ON CONFLICT (organization_id, preview_job_id) DO UPDATE
            SET actor_user_id = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN EXCLUDED.actor_user_id
                  ELSE plugin_data.csf_import_commit_queue.actor_user_id
                END,
                status = CASE
                  WHEN plugin_data.csf_import_commit_queue.status = 'queued'
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND plugin_data.csf_import_commit_queue.lease_expires_at
                        > pg_catalog.now()
                    )
                    THEN plugin_data.csf_import_commit_queue.status
                  ELSE 'queued'
                END,
                error_code = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN NULL
                  ELSE plugin_data.csf_import_commit_queue.error_code
                END,
                lease_token = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN NULL
                  ELSE plugin_data.csf_import_commit_queue.lease_token
                END,
                lease_expires_at = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN NULL
                  ELSE plugin_data.csf_import_commit_queue.lease_expires_at
                END,
                attempt_count = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN 0
                  ELSE plugin_data.csf_import_commit_queue.attempt_count
                END,
                result_counts = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN '{}'::jsonb
                  ELSE plugin_data.csf_import_commit_queue.result_counts
                END,
                started_at = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN NULL
                  ELSE plugin_data.csf_import_commit_queue.started_at
                END,
                finished_at = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN NULL
                  ELSE plugin_data.csf_import_commit_queue.finished_at
                END,
                updated_at = pg_catalog.now()
            RETURNING id INTO v_queue_id;
            v_state := 'queued';
            v_reason := NULL;
            v_queued := v_queued + 1;
          END IF;
        END IF;
      END IF;
    ELSE
      v_stale := v_stale + 1;
    END IF;

    INSERT INTO plugin_data.csf_import_approval_batch_items (
      organization_id, batch_id, preview_job_id, queue_id, state, reason_code
    ) VALUES (
      p_organization_id, v_batch.id, v_preview_id, v_queue_id, v_state, v_reason
    );
  END LOOP;

  UPDATE plugin_data.csf_import_approval_batches
  SET queued_count = v_queued,
      blocked_count = v_blocked,
      stale_count = v_stale,
      completed_count = v_completed,
      status = CASE
        WHEN v_queued > 0 THEN 'queued'
        ELSE 'completed'
      END,
      updated_at = pg_catalog.now()
  WHERE id = v_batch.id;

  RETURN pg_catalog.jsonb_build_object(
    'batchId', v_batch.id,
    'requested', pg_catalog.cardinality(p_preview_job_ids),
    'queued', v_queued,
    'blocked', v_blocked,
    'stale', v_stale,
    'completed', v_completed,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_queue_import_preview_batch_unserialized(
  uuid, uuid, uuid[], uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_import_preview_batch_unserialized(
  uuid, uuid, uuid[], uuid
) TO postgres;

COMMENT ON FUNCTION plugin_data.csf_queue_import_preview_batch_unserialized(
  uuid, uuid, uuid[], uuid
) IS
  'Owner-only batch implementation. Freezes one receipt while classifying a changed or malformed source mapping as stale for that preview only.';

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_import_preview_batch(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_preview_job_ids uuid[],
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch plugin_data.csf_import_approval_batches%ROWTYPE;
  v_preview_id uuid;
  v_preview_source_type text;
  v_requested_preview_ids uuid[];
  v_existing_preview_ids uuid[];
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A batch request ID is required.';
  END IF;
  IF coalesce(pg_catalog.cardinality(p_preview_job_ids), 0) < 1
    OR pg_catalog.cardinality(p_preview_job_ids) > 100
  THEN
    RAISE EXCEPTION 'Choose between one and 100 import previews.';
  END IF;
  IF pg_catalog.cardinality(p_preview_job_ids) <> (
    SELECT pg_catalog.count(DISTINCT preview_id)
    FROM pg_catalog.unnest(p_preview_job_ids) AS preview_id
  ) THEN
    RAISE EXCEPTION 'Each import preview may appear only once.';
  END IF;

  SELECT pg_catalog.array_agg(preview_id ORDER BY preview_id)
  INTO v_requested_preview_ids
  FROM pg_catalog.unnest(p_preview_job_ids) AS preview_id;

  -- Refuse the whole approval request before creating a durable receipt when
  -- the actor cannot approve one of its preview source types. Run this check
  -- on every call so a lost-response replay cannot bypass a later permission
  -- change.
  FOREACH v_preview_id IN ARRAY v_requested_preview_ids LOOP
    SELECT preview.source_type
    INTO v_preview_source_type
    FROM plugin_data.csf_sheet_import_jobs AS preview
    WHERE preview.organization_id = p_organization_id
      AND preview.id = v_preview_id
      AND preview.mode = 'preview';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'An import preview is no longer available.'
        USING ERRCODE = '22023';
    END IF;
    PERFORM plugin_data.csf_assert_import_actor(
      p_organization_id,
      p_actor_user_id,
      v_preview_source_type
    );
  END LOOP;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf_import_approval_batch:'
        || p_organization_id::text
        || ':'
        || p_request_id::text,
      0
    )
  );

  SELECT * INTO v_batch
  FROM plugin_data.csf_import_approval_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.request_id = p_request_id
  FOR UPDATE;

  IF FOUND THEN
    SELECT pg_catalog.array_agg(item.preview_job_id ORDER BY item.preview_job_id)
    INTO v_existing_preview_ids
    FROM plugin_data.csf_import_approval_batch_items AS item
    WHERE item.organization_id = p_organization_id
      AND item.batch_id = v_batch.id;

    IF v_batch.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing_preview_ids IS DISTINCT FROM v_requested_preview_ids
    THEN
      RAISE EXCEPTION 'This batch request ID belongs to a different approval request.'
        USING ERRCODE = '22023';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'batchId', v_batch.id,
      'requested', v_batch.requested_count,
      'queued', v_batch.queued_count,
      'blocked', v_batch.blocked_count,
      'stale', v_batch.stale_count,
      'completed', v_batch.completed_count,
      'replayed', true
    );
  END IF;

  -- The owner implementation walks this canonical array and records missing,
  -- stale, or unauthorized previews independently in the durable receipt.
  RETURN plugin_data.csf_queue_import_preview_batch_unserialized(
    p_organization_id,
    p_actor_user_id,
    v_requested_preview_ids,
    p_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_queue_import_preview_batch(
  uuid, uuid, uuid[], uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_import_preview_batch(
  uuid, uuid, uuid[], uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_queue_import_preview_batch(
  uuid, uuid, uuid[], uuid
) IS
  'Service-only batch approval boundary. Serializes and replays a bound durable receipt, then delegates canonical per-preview authorization and mapping validation to the owner-only queue implementation.';

CREATE OR REPLACE FUNCTION plugin_data.csf_claim_import_commit_attempt(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_actor_user_id uuid,
  p_lease_seconds integer,
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
  PERFORM plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, p_actor_user_id, p_preview_job_id
  );

  -- Enter the established import coordinate before the mapping helper locks the
  -- source. Finalize takes this same coordinate and locks the source last, so an
  -- expired-lease takeover cannot hold source-share while waiting on finalize.
  -- The preserved claim body enters the same transaction-scoped coordinate
  -- again after the identity locks; that repeat is reentrant.
  PERFORM plugin_data.csf_lock_import_commit_coordinate(
    p_organization_id, p_preview_job_id, true
  );
  PERFORM plugin_data.csf_assert_import_preview_workbook_generation_current(
    p_organization_id, p_preview_job_id
  );
  PERFORM plugin_data.csf_assert_import_preview_mapping_current(
    p_organization_id, p_preview_job_id
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
  RETURN plugin_data.csf_claim_import_commit_attempt_identity_base(
    p_organization_id, p_preview_job_id, p_actor_user_id, p_lease_seconds,
    p_evidence_token
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_claim_import_commit_attempt(
  uuid, uuid, uuid, integer, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_import_commit_attempt(
  uuid, uuid, uuid, integer, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_claim_import_commit_attempt(
  uuid, uuid, uuid, integer, uuid
) IS
  'Service-only import claim with organization identity lock, current actor authorization, canonical commit-coordinate ordering before the source-mapping fence, ordered active-profile locks, and the preserved evidence-consuming claim body.';

COMMIT;
