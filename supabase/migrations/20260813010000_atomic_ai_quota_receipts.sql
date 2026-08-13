-- Charge all dimensions for one AI request as a single transaction. A durable,
-- hashed receipt makes a dropped RPC response safe to retry without charging
-- the same request twice. This is a service-only RPC: it is intentionally not
-- added to the anon/authenticated public-function catalog.

CREATE TABLE public.api_rate_limit_receipts (
  request_key text PRIMARY KEY,
  request_fingerprint text NOT NULL,
  allowed boolean NOT NULL,
  remaining integer NOT NULL,
  reset_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT api_rate_limit_receipts_key_hash
    CHECK (request_key ~ '^[a-f0-9]{64}$'),
  CONSTRAINT api_rate_limit_receipts_fingerprint_hash
    CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT api_rate_limit_receipts_remaining_nonnegative
    CHECK (remaining >= 0),
  CONSTRAINT api_rate_limit_receipts_expiry_order
    CHECK (expires_at >= created_at)
);

CREATE INDEX api_rate_limit_receipts_expiry_idx
  ON public.api_rate_limit_receipts (expires_at);

ALTER TABLE public.api_rate_limit_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.api_rate_limit_receipts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_ai_quota(
  p_request_key text,
  p_request_fingerprint text,
  p_buckets jsonb,
  p_window_seconds integer
)
RETURNS TABLE (
  allowed boolean,
  remaining integer,
  reset_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_canonical_buckets jsonb;
  v_scope_fingerprint text;
  v_receipt public.api_rate_limit_receipts%ROWTYPE;
  v_bucket record;
  v_window_started_at timestamptz;
  v_request_count integer;
  v_bucket_reset_at timestamptz;
  v_denied boolean := false;
  v_remaining integer := 2147483647;
  v_allowed_reset_at timestamptz;
  v_denied_reset_at timestamptz;
  v_result_allowed boolean;
  v_result_remaining integer;
  v_result_reset_at timestamptz;
BEGIN
  IF p_request_key !~ '^[a-f0-9]{64}$'
     OR p_request_fingerprint !~ '^[a-f0-9]{64}$'
     OR p_window_seconds NOT BETWEEN 1 AND 86400
     OR pg_catalog.jsonb_typeof(p_buckets) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_buckets) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'invalid AI quota request'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_buckets) AS bucket(value)
    WHERE pg_catalog.jsonb_typeof(bucket.value) IS DISTINCT FROM 'object'
      OR pg_catalog.jsonb_typeof(bucket.value -> 'key') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(bucket.value -> 'limit') IS DISTINCT FROM 'number'
      OR pg_catalog.char_length(bucket.value ->> 'key') NOT BETWEEN 1 AND 200
      OR (bucket.value ->> 'limit') !~ '^[0-9]{1,5}$'
      OR (bucket.value ->> 'limit')::integer NOT BETWEEN 1 AND 10000
  )
  OR (
    SELECT pg_catalog.count(*) <> pg_catalog.count(
      DISTINCT bucket.value ->> 'key'
    )
    FROM pg_catalog.jsonb_array_elements(p_buckets) AS bucket(value)
  ) THEN
    RAISE EXCEPTION 'invalid AI quota buckets'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'key', normalized.bucket_key,
      'limit', normalized.bucket_limit
    )
    ORDER BY normalized.bucket_key COLLATE "C"
  )
  INTO v_canonical_buckets
  FROM (
    SELECT
      bucket.value ->> 'key' AS bucket_key,
      (bucket.value ->> 'limit')::integer AS bucket_limit
    FROM pg_catalog.jsonb_array_elements(p_buckets) AS bucket(value)
  ) AS normalized;

  v_scope_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'requestFingerprint', p_request_fingerprint,
          'windowSeconds', p_window_seconds,
          'buckets', v_canonical_buckets
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'public.consume_ai_quota:request:' || p_request_key,
      0
    )
  );

  SELECT receipts.*
  INTO v_receipt
  FROM public.api_rate_limit_receipts AS receipts
  WHERE receipts.request_key = p_request_key
  FOR UPDATE;

  IF FOUND AND v_receipt.expires_at > v_now THEN
    IF v_receipt.request_fingerprint IS DISTINCT FROM v_scope_fingerprint THEN
      RAISE EXCEPTION 'AI quota request key scope mismatch'
        USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
      v_receipt.allowed,
      v_receipt.remaining,
      v_receipt.reset_at,
      true;
    RETURN;
  END IF;

  IF FOUND THEN
    DELETE FROM public.api_rate_limit_receipts AS receipts
    WHERE receipts.request_key = p_request_key;
  END IF;

  -- Bound receipt growth without a separate privileged cleanup endpoint.
  DELETE FROM public.api_rate_limit_receipts AS receipts
  WHERE receipts.request_key IN (
    SELECT expired.request_key
    FROM public.api_rate_limit_receipts AS expired
    WHERE expired.expires_at <= v_now
    ORDER BY expired.expires_at, expired.request_key
    LIMIT 32
    FOR UPDATE SKIP LOCKED
  );

  -- Every caller of this function takes bucket locks in bytewise key order.
  -- The preflight below therefore observes a stable set and never partially
  -- charges an earlier bucket when a later bucket denies or raises.
  FOR v_bucket IN
    SELECT
      bucket.value ->> 'key' AS bucket_key,
      (bucket.value ->> 'limit')::integer AS bucket_limit
    FROM pg_catalog.jsonb_array_elements(v_canonical_buckets) AS bucket(value)
    ORDER BY bucket.value ->> 'key' COLLATE "C"
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'public.consume_ai_quota:bucket:' || v_bucket.bucket_key,
        0
      )
    );
  END LOOP;

  FOR v_bucket IN
    SELECT
      bucket.value ->> 'key' AS bucket_key,
      (bucket.value ->> 'limit')::integer AS bucket_limit
    FROM pg_catalog.jsonb_array_elements(v_canonical_buckets) AS bucket(value)
    ORDER BY bucket.value ->> 'key' COLLATE "C"
  LOOP
    SELECT limits.window_started_at, limits.request_count
    INTO v_window_started_at, v_request_count
    FROM public.api_rate_limits AS limits
    WHERE limits.rate_limit_key = v_bucket.bucket_key
    FOR UPDATE;

    IF NOT FOUND
       OR v_window_started_at
            + pg_catalog.make_interval(secs => p_window_seconds) <= v_now THEN
      v_window_started_at := v_now;
      v_request_count := 0;
    END IF;

    v_bucket_reset_at :=
      v_window_started_at
      + pg_catalog.make_interval(secs => p_window_seconds);

    IF v_request_count >= v_bucket.bucket_limit THEN
      v_denied := true;
      IF v_denied_reset_at IS NULL
         OR v_bucket_reset_at > v_denied_reset_at THEN
        v_denied_reset_at := v_bucket_reset_at;
      END IF;
    ELSE
      v_remaining := LEAST(
        v_remaining,
        v_bucket.bucket_limit - (v_request_count + 1)
      );
      IF v_allowed_reset_at IS NULL
         OR v_bucket_reset_at > v_allowed_reset_at THEN
        v_allowed_reset_at := v_bucket_reset_at;
      END IF;
    END IF;
  END LOOP;

  IF v_denied THEN
    v_result_allowed := false;
    v_result_remaining := 0;
    v_result_reset_at := v_denied_reset_at;
  ELSE
    FOR v_bucket IN
      SELECT
        bucket.value ->> 'key' AS bucket_key,
        (bucket.value ->> 'limit')::integer AS bucket_limit
      FROM pg_catalog.jsonb_array_elements(v_canonical_buckets) AS bucket(value)
      ORDER BY bucket.value ->> 'key' COLLATE "C"
    LOOP
      INSERT INTO public.api_rate_limits AS limits (
        rate_limit_key,
        window_started_at,
        request_count,
        updated_at
      )
      VALUES (v_bucket.bucket_key, v_now, 1, v_now)
      ON CONFLICT (rate_limit_key) DO UPDATE
      SET
        window_started_at = CASE
          WHEN limits.window_started_at
                 + pg_catalog.make_interval(secs => p_window_seconds) <= v_now
            THEN v_now
          ELSE limits.window_started_at
        END,
        request_count = CASE
          WHEN limits.window_started_at
                 + pg_catalog.make_interval(secs => p_window_seconds) <= v_now
            THEN 1
          ELSE limits.request_count + 1
        END,
        updated_at = v_now;
    END LOOP;

    v_result_allowed := true;
    v_result_remaining := v_remaining;
    v_result_reset_at := v_allowed_reset_at;
  END IF;

  INSERT INTO public.api_rate_limit_receipts (
    request_key,
    request_fingerprint,
    allowed,
    remaining,
    reset_at,
    created_at,
    expires_at
  )
  VALUES (
    p_request_key,
    v_scope_fingerprint,
    v_result_allowed,
    v_result_remaining,
    v_result_reset_at,
    v_now,
    v_result_reset_at
  );

  RETURN QUERY
  SELECT
    v_result_allowed,
    v_result_remaining,
    v_result_reset_at,
    false;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_quota(text, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(text, text, jsonb, integer)
  TO service_role;

COMMENT ON FUNCTION public.consume_ai_quota(text, text, jsonb, integer) IS
  'Service-role-only atomic multi-bucket AI quota charge with bounded durable idempotency receipts; intentionally excluded from the client-callable public function catalog.';
