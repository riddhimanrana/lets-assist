BEGIN;

-- A worker may disappear after committing a claim but before acknowledging the
-- Storage outcome. Let another worker take over only after a bounded lease,
-- issue a new token, and keep every acknowledgement compare-and-set fenced.
CREATE INDEX csf_storage_deletion_queue_stale_claim_idx
  ON plugin_data.csf_storage_deletion_queue (claimed_at, enqueued_at, id)
  WHERE claim_token IS NOT NULL;

CREATE INDEX csf_storage_deletion_queue_org_stale_claim_idx
  ON plugin_data.csf_storage_deletion_queue (
    organization_id, claimed_at, enqueued_at, id
  )
  WHERE claim_token IS NOT NULL;

CREATE OR REPLACE FUNCTION plugin_data.csf_claim_storage_deletion_queue(
  p_limit integer
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  bucket text,
  object_path text,
  attempt_count integer,
  claim_token uuid,
  claimed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_queue plugin_data.csf_storage_deletion_queue%ROWTYPE;
  v_claim_token uuid;
  v_claimed_at timestamptz;
  v_attempt_count integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'The storage deletion claim limit must be between 1 and 500.'
      USING ERRCODE = '22023';
  END IF;

  FOR v_queue IN
    SELECT queue.*
    FROM plugin_data.csf_storage_deletion_queue AS queue
    WHERE queue.claim_token IS NULL
      OR queue.claimed_at <= now() - interval '15 minutes'
    ORDER BY queue.enqueued_at, queue.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_announcement_attachments AS attachment
      WHERE attachment.bucket = v_queue.bucket
        AND attachment.object_path = v_queue.object_path
    ) THEN
      DELETE FROM plugin_data.csf_storage_deletion_queue AS queue
      WHERE queue.id = v_queue.id
        AND (
          queue.claim_token IS NULL
          OR queue.claimed_at <= now() - interval '15 minutes'
        );
      CONTINUE;
    END IF;

    v_claim_token := gen_random_uuid();
    v_claimed_at := now();
    v_attempt_count := v_queue.attempt_count;
    IF v_queue.claim_token IS NOT NULL THEN
      v_attempt_count := CASE
        WHEN v_attempt_count < 2147483647 THEN v_attempt_count + 1
        ELSE v_attempt_count
      END;
    END IF;

    UPDATE plugin_data.csf_storage_deletion_queue AS queue
    SET claim_token = v_claim_token,
        claimed_at = v_claimed_at,
        attempt_count = v_attempt_count,
        last_attempt_at = CASE
          WHEN v_queue.claim_token IS NOT NULL THEN v_claimed_at
          ELSE queue.last_attempt_at
        END,
        last_error = CASE
          WHEN v_queue.claim_token IS NOT NULL
            THEN 'Storage deletion claim lease expired.'
          ELSE queue.last_error
        END
    WHERE queue.id = v_queue.id
      AND (
        queue.claim_token IS NULL
        OR queue.claimed_at <= now() - interval '15 minutes'
      );
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    id := v_queue.id;
    organization_id := v_queue.organization_id;
    bucket := v_queue.bucket;
    object_path := v_queue.object_path;
    attempt_count := v_attempt_count;
    claim_token := v_claim_token;
    claimed_at := v_claimed_at;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_claim_organization_storage_deletion_queue(
  p_organization_id uuid,
  p_limit integer
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  bucket text,
  object_path text,
  attempt_count integer,
  claim_token uuid,
  claimed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_queue plugin_data.csf_storage_deletion_queue%ROWTYPE;
  v_claim_token uuid;
  v_claimed_at timestamptz;
  v_attempt_count integer;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'The storage deletion claim organization is required.'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'The storage deletion claim limit must be between 1 and 500.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  FOR v_queue IN
    SELECT queue.*
    FROM plugin_data.csf_storage_deletion_queue AS queue
    WHERE queue.organization_id = p_organization_id
      AND (
        queue.claim_token IS NULL
        OR queue.claimed_at <= now() - interval '15 minutes'
      )
    ORDER BY queue.enqueued_at, queue.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_announcement_attachments AS attachment
      WHERE attachment.bucket = v_queue.bucket
        AND attachment.object_path = v_queue.object_path
    ) THEN
      DELETE FROM plugin_data.csf_storage_deletion_queue AS queue
      WHERE queue.id = v_queue.id
        AND queue.organization_id = p_organization_id
        AND (
          queue.claim_token IS NULL
          OR queue.claimed_at <= now() - interval '15 minutes'
        );
      CONTINUE;
    END IF;

    v_claim_token := gen_random_uuid();
    v_claimed_at := now();
    v_attempt_count := v_queue.attempt_count;
    IF v_queue.claim_token IS NOT NULL THEN
      v_attempt_count := CASE
        WHEN v_attempt_count < 2147483647 THEN v_attempt_count + 1
        ELSE v_attempt_count
      END;
    END IF;

    UPDATE plugin_data.csf_storage_deletion_queue AS queue
    SET claim_token = v_claim_token,
        claimed_at = v_claimed_at,
        attempt_count = v_attempt_count,
        last_attempt_at = CASE
          WHEN v_queue.claim_token IS NOT NULL THEN v_claimed_at
          ELSE queue.last_attempt_at
        END,
        last_error = CASE
          WHEN v_queue.claim_token IS NOT NULL
            THEN 'Storage deletion claim lease expired.'
          ELSE queue.last_error
        END
    WHERE queue.id = v_queue.id
      AND queue.organization_id = p_organization_id
      AND (
        queue.claim_token IS NULL
        OR queue.claimed_at <= now() - interval '15 minutes'
      );
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    id := v_queue.id;
    organization_id := v_queue.organization_id;
    bucket := v_queue.bucket;
    object_path := v_queue.object_path;
    attempt_count := v_attempt_count;
    claim_token := v_claim_token;
    claimed_at := v_claimed_at;
    RETURN NEXT;
  END LOOP;
END;
$$;

ALTER FUNCTION plugin_data.csf_claim_storage_deletion_queue(integer)
  OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_claim_organization_storage_deletion_queue(
  uuid, integer
) OWNER TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_claim_storage_deletion_queue(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_storage_deletion_queue(integer)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_organization_storage_deletion_queue(
  uuid, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_organization_storage_deletion_queue(
  uuid, integer
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_claim_storage_deletion_queue(integer) IS
  'Claims unreferenced CSF Storage deletions, replacing abandoned tokens only after a 15-minute lease while preserving acknowledgement fencing.';
COMMENT ON FUNCTION plugin_data.csf_claim_organization_storage_deletion_queue(
  uuid, integer
) IS
  'Claims one organization cleanup batch, replacing abandoned tokens only after a 15-minute lease while preserving acknowledgement fencing.';

COMMIT;
