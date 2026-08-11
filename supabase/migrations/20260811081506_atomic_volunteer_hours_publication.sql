-- Publish volunteer hours as one replay-safe database transition. The browser
-- supplies only signup IDs and organizer-edited timestamps; identities,
-- authorization, session scope, certificate fields, and delivery work are
-- derived again inside the transaction.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.certificates
    WHERE type = 'verified'
      AND signup_id IS NOT NULL
    GROUP BY signup_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'cannot enforce verified certificate uniqueness: duplicate signup certificates exist',
      HINT = 'Resolve the conflicting verified certificates explicitly before retrying this migration.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX certificates_verified_signup_unique
  ON public.certificates (signup_id)
  WHERE type = 'verified' AND signup_id IS NOT NULL;

CREATE TABLE public.hours_publication_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  schedule_id text NOT NULL,
  publish_key text NOT NULL,
  request_key text NOT NULL,
  request_hash text NOT NULL,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  certificate_count integer NOT NULL DEFAULT 0,
  email_work_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hours_publication_receipts_project_publish_key_key
    UNIQUE (project_id, publish_key),
  CONSTRAINT hours_publication_receipts_request_key_key UNIQUE (request_key),
  CONSTRAINT hours_publication_receipts_schedule_not_blank
    CHECK (char_length(btrim(schedule_id)) BETWEEN 1 AND 200),
  CONSTRAINT hours_publication_receipts_publish_key_not_blank
    CHECK (char_length(btrim(publish_key)) BETWEEN 1 AND 200),
  CONSTRAINT hours_publication_receipts_request_key_format
    CHECK (request_key ~ '^hours-publication:v1:[0-9a-f]{64}$'),
  CONSTRAINT hours_publication_receipts_request_hash_format
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hours_publication_receipts_counts_nonnegative
    CHECK (certificate_count >= 0 AND email_work_count >= 0)
);

CREATE TABLE public.hours_publication_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL
    REFERENCES public.hours_publication_receipts(id) ON DELETE CASCADE,
  certificate_id uuid NOT NULL REFERENCES public.certificates(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  claim_token uuid,
  attempt_count integer NOT NULL DEFAULT 0,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  settled_at timestamptz,
  provider_message_id text,
  safe_code text,
  last_settlement_token uuid,
  payload_snapshot jsonb,
  payload_hash text,
  payload_prepared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hours_publication_email_outbox_certificate_key UNIQUE (certificate_id),
  CONSTRAINT hours_publication_email_outbox_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT hours_publication_email_outbox_idempotency_key_bounded
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
  CONSTRAINT hours_publication_email_outbox_attempt_timeline_check CHECK (
    (
      attempt_count = 0
      AND first_attempt_at IS NULL
      AND last_attempt_at IS NULL
    )
    OR (
      attempt_count > 0
      AND last_attempt_at IS NOT NULL
      AND (
        (
          first_attempt_at IS NOT NULL
          AND last_attempt_at >= first_attempt_at
        )
        OR (
          state = 'retryable_failure'
          AND claim_token IS NULL
          AND first_attempt_at IS NULL
        )
      )
    )
  ),
  CONSTRAINT hours_publication_email_outbox_state_check CHECK (
    state IN (
      'queued',
      'processing',
      'accepted',
      'retryable_failure',
      'definitive_failure',
      'unknown_outcome',
      'skipped'
    )
  ),
  CONSTRAINT hours_publication_email_outbox_attempts_nonnegative
    CHECK (attempt_count >= 0),
  CONSTRAINT hours_publication_email_outbox_provider_id_bounded
    CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 200),
  CONSTRAINT hours_publication_email_outbox_safe_code_bounded
    CHECK (safe_code IS NULL OR safe_code ~ '^[a-z0-9_]{1,64}$'),
  CONSTRAINT hours_publication_email_outbox_payload_shape CHECK (
    (
      payload_snapshot IS NULL
      AND payload_hash IS NULL
      AND payload_prepared_at IS NULL
    ) OR (
      pg_catalog.jsonb_typeof(payload_snapshot) = 'object'
      AND payload_snapshot ->> 'version' = '1'
      AND pg_catalog.octet_length(payload_snapshot::text) <= 1048576
      AND payload_hash ~ '^[0-9a-f]{64}$'
      AND payload_hash = pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(payload_snapshot::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      )
      AND payload_prepared_at IS NOT NULL
    )
  )
);

CREATE INDEX hours_publication_email_outbox_receipt_state_idx
  ON public.hours_publication_email_outbox (receipt_id, state, created_at);
CREATE INDEX hours_publication_receipts_requested_by_idx
  ON public.hours_publication_receipts (requested_by)
  WHERE requested_by IS NOT NULL;

ALTER TABLE public.hours_publication_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hours_publication_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hours_publication_receipts
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hours_publication_email_outbox
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.hours_publication_receipts
  TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.hours_publication_email_outbox
  TO service_role;

COMMENT ON TABLE public.hours_publication_receipts IS
  'Service-only immutable receipts for one atomic volunteer-hours publication per project session.';
COMMENT ON TABLE public.hours_publication_email_outbox IS
  'Service-only durable email work. Processing and unknown outcomes are never retried automatically.';

CREATE OR REPLACE FUNCTION private.project_hours_publish_key(
  p_event_type text,
  p_schedule jsonb,
  p_schedule_id text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_key text;
BEGIN
  IF NULLIF(pg_catalog.btrim(p_schedule_id), '') IS NULL
    OR char_length(p_schedule_id) > 200
  THEN
    RETURN NULL;
  END IF;

  IF p_event_type = 'oneTime'
    AND p_schedule ? 'oneTime'
    AND p_schedule_id = ANY (ARRAY['oneTime', '0', 'default'])
  THEN
    RETURN 'oneTime';
  END IF;

  IF p_event_type = 'multiDay'
    AND pg_catalog.jsonb_typeof(p_schedule -> 'multiDay') = 'array'
  THEN
    SELECT pg_catalog.format(
      '%s-%s',
      day_item.value ->> 'date',
      slot_item.ordinal - 1
    )
    INTO v_key
    FROM pg_catalog.jsonb_array_elements(p_schedule -> 'multiDay')
      WITH ORDINALITY AS day_item(value, ordinal)
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(day_item.value -> 'slots')
      WITH ORDINALITY AS slot_item(value, ordinal)
    WHERE p_schedule_id = ANY (ARRAY[
      pg_catalog.format(
        '%s-%s-%s',
        day_item.value ->> 'date',
        day_item.ordinal - 1,
        slot_item.ordinal - 1
      ),
      pg_catalog.format('%s-%s', day_item.ordinal - 1, slot_item.ordinal - 1),
      pg_catalog.format('%s-%s', day_item.value ->> 'date', slot_item.ordinal - 1),
      pg_catalog.format('day-%s-slot-%s', day_item.ordinal - 1, slot_item.ordinal - 1)
    ])
    ORDER BY day_item.ordinal, slot_item.ordinal
    LIMIT 1;
    RETURN v_key;
  END IF;

  IF p_event_type = 'sameDayMultiArea'
    AND pg_catalog.jsonb_typeof(p_schedule -> 'sameDayMultiArea' -> 'roles') = 'array'
  THEN
    SELECT role_item.value ->> 'name'
    INTO v_key
    FROM pg_catalog.jsonb_array_elements(
      p_schedule -> 'sameDayMultiArea' -> 'roles'
    ) WITH ORDINALITY AS role_item(value, ordinal)
    WHERE p_schedule_id = role_item.value ->> 'name'
      OR p_schedule_id = pg_catalog.format('role-%s', role_item.ordinal - 1)
    ORDER BY role_item.ordinal
    LIMIT 1;
    RETURN v_key;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.hours_publication_result(
  p_receipt_id uuid,
  p_outcome text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'outcome', p_outcome,
    'receiptId', receipts.id,
    'requestKey', receipts.request_key,
    'certificatesCreated', receipts.certificate_count,
    'projectTitle', projects.title,
    'projectTimezone', projects.project_timezone,
    'deliveries', COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'deliveryId', outbox.id,
          'state', outbox.state,
          'payloadPrepared', outbox.payload_snapshot IS NOT NULL,
          'idempotencyKey', outbox.idempotency_key,
          'certificateId', certificates.id,
          'volunteerName', certificates.volunteer_name,
          'volunteerEmail', certificates.volunteer_email,
          'eventStart', certificates.event_start,
          'eventEnd', certificates.event_end
        ) ORDER BY certificates.signup_id
      ) FILTER (WHERE outbox.id IS NOT NULL),
      '[]'::jsonb
    )
  )
  FROM public.hours_publication_receipts AS receipts
  JOIN public.projects AS projects ON projects.id = receipts.project_id
  LEFT JOIN public.hours_publication_email_outbox AS outbox
    ON outbox.receipt_id = receipts.id
  LEFT JOIN public.certificates AS certificates
    ON certificates.id = outbox.certificate_id
  WHERE receipts.id = p_receipt_id
  GROUP BY receipts.id, projects.id;
$$;

REVOKE ALL ON FUNCTION private.project_hours_publish_key(text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.hours_publication_result(uuid, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.publish_volunteer_hours_transactional(
  p_project_id uuid,
  p_schedule_id text,
  p_entries jsonb,
  p_request_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_project public.projects%ROWTYPE;
  v_publish_key text;
  v_entries jsonb;
  v_entry_count integer;
  v_valid_count integer;
  v_request_hash text;
  v_receipt public.hours_publication_receipts%ROWTYPE;
  v_creator_name text;
  v_organization_name text;
  v_organization_verified boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  IF p_request_key IS NULL
    OR p_request_key !~ '^hours-publication:v1:[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid publication request key';
  END IF;

  IF pg_catalog.jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'publication entries must be an array';
  END IF;

  v_entry_count := pg_catalog.jsonb_array_length(p_entries);
  IF v_entry_count < 1 OR v_entry_count > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'publication entries must contain between 1 and 500 signups';
  END IF;

  SELECT projects.*
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'project not found';
  END IF;

  IF v_project.creator_id <> v_actor_id THEN
    PERFORM members.user_id
    FROM public.organization_members AS members
    WHERE members.organization_id = v_project.organization_id
      AND members.user_id = v_actor_id
      AND COALESCE(members.status, 'active') = 'active'
      AND (
        members.role = 'admin'
        OR (
          members.role = 'staff'
          AND v_project.can_be_managed_by_staff IS TRUE
        )
      )
    FOR UPDATE OF members;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized to publish project hours';
    END IF;
  END IF;

  v_publish_key := private.project_hours_publish_key(
    v_project.event_type,
    v_project.schedule,
    p_schedule_id
  );
  IF v_publish_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'project session is not valid';
  END IF;

  BEGIN
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'signupId', (entry.value ->> 'signupId')::uuid,
        'checkIn', (entry.value ->> 'checkIn')::timestamptz,
        'checkOut', (entry.value ->> 'checkOut')::timestamptz
      ) ORDER BY entry.value ->> 'signupId'
    )
    INTO v_entries
    FROM pg_catalog.jsonb_array_elements(p_entries) AS entry(value)
    WHERE pg_catalog.jsonb_typeof(entry.value) = 'object'
      AND entry.value ? 'signupId'
      AND entry.value ? 'checkIn'
      AND entry.value ? 'checkOut';
  EXCEPTION
    WHEN invalid_text_representation OR datetime_field_overflow THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'publication entries contain invalid identifiers or timestamps';
  END;

  IF v_entries IS NULL OR pg_catalog.jsonb_array_length(v_entries) <> v_entry_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'every publication entry requires a signup and two timestamps';
  END IF;

  IF (
    SELECT count(DISTINCT entry.value ->> 'signupId')
    FROM pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
  ) <> v_entry_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'a signup can appear only once in a publication';
  END IF;

  -- Lock every referenced signup in deterministic order before checking its
  -- project, status, session, or time range. Direct status changes therefore
  -- serialize with publication instead of racing certificate creation.
  PERFORM signups.id
  FROM pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
  JOIN public.project_signups AS signups
    ON signups.id = (entry.value ->> 'signupId')::uuid
  ORDER BY signups.id
  FOR UPDATE OF signups;

  v_request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'projectId', p_project_id,
          'publishKey', v_publish_key,
          'entries', v_entries
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT receipts.*
  INTO v_receipt
  FROM public.hours_publication_receipts AS receipts
  WHERE receipts.request_key = p_request_key;

  IF FOUND THEN
    IF v_receipt.project_id <> p_project_id
      OR v_receipt.publish_key <> v_publish_key
      OR v_receipt.request_hash <> v_request_hash
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'publication request key was already used for different input';
    END IF;
    RETURN private.hours_publication_result(v_receipt.id, 'replayed');
  END IF;

  SELECT receipts.*
  INTO v_receipt
  FROM public.hours_publication_receipts AS receipts
  WHERE receipts.project_id = p_project_id
    AND receipts.publish_key = v_publish_key;

  IF FOUND THEN
    IF v_receipt.request_hash <> v_request_hash THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'project session was already published with different hours';
    END IF;
    RETURN private.hours_publication_result(v_receipt.id, 'replayed');
  END IF;

  SELECT count(*)
  INTO v_valid_count
  FROM pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
  JOIN public.project_signups AS signups
    ON signups.id = (entry.value ->> 'signupId')::uuid
  WHERE signups.project_id = p_project_id
    AND signups.status IN ('approved', 'attended')
    AND private.project_hours_publish_key(
      v_project.event_type,
      v_project.schedule,
      signups.schedule_id
    ) = v_publish_key
    AND (entry.value ->> 'checkOut')::timestamptz
      > (entry.value ->> 'checkIn')::timestamptz
    AND pg_catalog.round(
      extract(epoch FROM (
        (entry.value ->> 'checkOut')::timestamptz
          - (entry.value ->> 'checkIn')::timestamptz
      )) / 60
    ) > 0
    AND (entry.value ->> 'checkOut')::timestamptz
      <= (entry.value ->> 'checkIn')::timestamptz + interval '24 hours';

  IF v_valid_count <> v_entry_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'one or more signups, sessions, statuses, or time ranges are invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
    JOIN public.certificates AS certificates
      ON certificates.signup_id = (entry.value ->> 'signupId')::uuid
     AND certificates.type = 'verified'
    WHERE certificates.project_id IS DISTINCT FROM p_project_id
      OR certificates.event_start IS DISTINCT FROM (entry.value ->> 'checkIn')::timestamptz
      OR certificates.event_end IS DISTINCT FROM (entry.value ->> 'checkOut')::timestamptz
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'an existing verified certificate conflicts with the requested hours';
  END IF;

  SELECT profiles.full_name
  INTO v_creator_name
  FROM public.profiles AS profiles
  WHERE profiles.id = v_project.creator_id;
  v_creator_name := COALESCE(NULLIF(v_creator_name, ''), 'Project Organizer');

  IF v_project.organization_id IS NOT NULL THEN
    SELECT organizations.name, COALESCE(organizations.verified, false)
    INTO v_organization_name, v_organization_verified
    FROM public.organizations AS organizations
    WHERE organizations.id = v_project.organization_id;
  END IF;

  INSERT INTO public.hours_publication_receipts (
    project_id,
    schedule_id,
    publish_key,
    request_key,
    request_hash,
    requested_by
  ) VALUES (
    p_project_id,
    v_publish_key,
    v_publish_key,
    p_request_key,
    v_request_hash,
    v_actor_id
  )
  RETURNING * INTO v_receipt;

  UPDATE public.project_signups AS signups
  SET
    check_in_time = (entry.value ->> 'checkIn')::timestamptz,
    check_out_time = (entry.value ->> 'checkOut')::timestamptz
  FROM pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
  WHERE signups.id = (entry.value ->> 'signupId')::uuid;

  INSERT INTO public.certificates (
    project_id,
    user_id,
    signup_id,
    volunteer_name,
    volunteer_email,
    project_title,
    project_location,
    event_start,
    event_end,
    organization_name,
    creator_name,
    is_certified,
    creator_id,
    type,
    check_in_method,
    schedule_id
  )
  SELECT
    p_project_id,
    signups.user_id,
    signups.id,
    COALESCE(
      NULLIF(profiles.full_name, ''),
      NULLIF(anonymous_signups.name, ''),
      'No Name Volunteer'
    ),
    COALESCE(profiles.email::text, anonymous_signups.email),
    v_project.title,
    v_project.location,
    (entry.value ->> 'checkIn')::timestamptz,
    (entry.value ->> 'checkOut')::timestamptz,
    v_organization_name,
    v_creator_name,
    v_organization_verified,
    v_project.creator_id,
    'verified',
    v_project.verification_method,
    v_publish_key
  FROM pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
  JOIN public.project_signups AS signups
    ON signups.id = (entry.value ->> 'signupId')::uuid
  LEFT JOIN public.profiles AS profiles ON profiles.id = signups.user_id
  LEFT JOIN public.anonymous_signups
    ON anonymous_signups.id = signups.anonymous_id
  ON CONFLICT (signup_id)
    WHERE type = 'verified' AND signup_id IS NOT NULL
    DO NOTHING;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
    JOIN public.project_signups AS signups
      ON signups.id = (entry.value ->> 'signupId')::uuid
    JOIN public.certificates AS certificates
      ON certificates.signup_id = signups.id
     AND certificates.type = 'verified'
    LEFT JOIN public.profiles AS profiles ON profiles.id = signups.user_id
    LEFT JOIN public.anonymous_signups
      ON anonymous_signups.id = signups.anonymous_id
    WHERE certificates.project_id IS DISTINCT FROM p_project_id
      OR certificates.user_id IS DISTINCT FROM signups.user_id
      OR certificates.volunteer_name IS DISTINCT FROM COALESCE(
        NULLIF(profiles.full_name, ''),
        NULLIF(anonymous_signups.name, ''),
        'No Name Volunteer'
      )
      OR certificates.volunteer_email IS DISTINCT FROM
        COALESCE(profiles.email::text, anonymous_signups.email)
      OR certificates.project_title IS DISTINCT FROM v_project.title
      OR certificates.project_location IS DISTINCT FROM v_project.location
      OR certificates.event_start IS DISTINCT FROM
        (entry.value ->> 'checkIn')::timestamptz
      OR certificates.event_end IS DISTINCT FROM
        (entry.value ->> 'checkOut')::timestamptz
      OR certificates.organization_name IS DISTINCT FROM v_organization_name
      OR certificates.creator_name IS DISTINCT FROM v_creator_name
      OR certificates.is_certified IS DISTINCT FROM v_organization_verified
      OR certificates.creator_id IS DISTINCT FROM v_project.creator_id
      OR certificates.check_in_method IS DISTINCT FROM v_project.verification_method
      OR certificates.schedule_id IS DISTINCT FROM v_publish_key
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'an existing verified certificate conflicts with canonical publication data';
  END IF;

  IF (
    SELECT count(*)
    FROM public.certificates AS certificates
    JOIN pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
      ON certificates.signup_id = (entry.value ->> 'signupId')::uuid
    WHERE certificates.type = 'verified'
  ) <> v_entry_count THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'verified certificate creation was incomplete';
  END IF;

  INSERT INTO public.notifications (
    user_id,
    title,
    body,
    type,
    severity,
    action_url,
    displayed,
    read,
    dedupe_key
  )
  SELECT
    signups.user_id,
    'Your Volunteer Hours Have Been Published! 🎉',
    pg_catalog.format(
      'Your volunteer certificate for "%s" is now available. You volunteered for %s hours and %s minutes.',
      v_project.title,
      floor(
        pg_catalog.round(
          extract(epoch FROM (certificates.event_end - certificates.event_start)) / 60
        ) / 60
      ),
      pg_catalog.round(
        extract(epoch FROM (certificates.event_end - certificates.event_start)) / 60
      )::integer % 60
    ),
    'project_updates',
    'success',
    '/certificates/' || certificates.id,
    false,
    false,
    'hours-publication:certificate:' || certificates.id
  FROM public.certificates AS certificates
  JOIN public.project_signups AS signups ON signups.id = certificates.signup_id
  JOIN pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
    ON certificates.signup_id = (entry.value ->> 'signupId')::uuid
  WHERE signups.user_id IS NOT NULL
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  INSERT INTO public.hours_publication_email_outbox (
    receipt_id,
    certificate_id,
    idempotency_key,
    state,
    settled_at,
    safe_code
  )
  SELECT
    v_receipt.id,
    certificates.id,
    'hours-publication:v1:certificate:' || certificates.id,
    CASE
      WHEN NULLIF(certificates.volunteer_email, '') IS NULL
        OR NULLIF(certificates.volunteer_name, '') IS NULL
      THEN 'skipped'
      ELSE 'queued'
    END,
    CASE
      WHEN NULLIF(certificates.volunteer_email, '') IS NULL
        OR NULLIF(certificates.volunteer_name, '') IS NULL
      THEN now()
      ELSE NULL
    END,
    CASE
      WHEN NULLIF(certificates.volunteer_email, '') IS NULL
        OR NULLIF(certificates.volunteer_name, '') IS NULL
      THEN 'recipient_missing'
      ELSE NULL
    END
  FROM public.certificates AS certificates
  JOIN pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
    ON certificates.signup_id = (entry.value ->> 'signupId')::uuid
  WHERE certificates.type = 'verified'
  ON CONFLICT (certificate_id) DO NOTHING;

  UPDATE public.projects
  SET published = COALESCE(published, '{}'::jsonb)
    || pg_catalog.jsonb_build_object(v_publish_key, true)
  WHERE id = p_project_id;

  UPDATE public.hours_publication_receipts
  SET
    certificate_count = v_entry_count,
    email_work_count = (
      SELECT count(*)
      FROM public.hours_publication_email_outbox AS outbox
      WHERE outbox.receipt_id = v_receipt.id
    )
  WHERE id = v_receipt.id
  RETURNING * INTO v_receipt;

  RETURN private.hours_publication_result(v_receipt.id, 'accepted');
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_hours_publication_email_delivery(
  p_delivery_id uuid,
  p_sender text DEFAULT NULL,
  p_subject text DEFAULT NULL,
  p_html text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_outbox public.hours_publication_email_outbox%ROWTYPE;
  v_recipient text;
  v_snapshot jsonb;
  v_hash text;
BEGIN
  IF p_delivery_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT outbox.*
  INTO v_outbox
  FROM public.hours_publication_email_outbox AS outbox
  WHERE outbox.id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_outbox.payload_snapshot IS NOT NULL THEN
    v_hash := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(v_outbox.payload_snapshot::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    IF v_outbox.payload_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION USING ERRCODE = '22000', MESSAGE = 'durable email payload integrity check failed';
    END IF;
    RETURN v_outbox.payload_snapshot;
  END IF;

  SELECT certificates.volunteer_email
  INTO v_recipient
  FROM public.certificates AS certificates
  WHERE certificates.id = v_outbox.certificate_id;

  IF NULLIF(pg_catalog.btrim(v_recipient), '') IS NULL
    OR char_length(v_recipient) > 320
    OR NULLIF(pg_catalog.btrim(p_sender), '') IS NULL
    OR char_length(p_sender) > 500
    OR NULLIF(pg_catalog.btrim(p_subject), '') IS NULL
    OR char_length(p_subject) > 998
    OR NULLIF(p_html, '') IS NULL
    OR pg_catalog.octet_length(p_html) > 1000000
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid durable email payload';
  END IF;

  v_snapshot := pg_catalog.jsonb_build_object(
    'version', 1,
    'to', v_recipient,
    'from', p_sender,
    'subject', p_subject,
    'html', p_html,
    'tags', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'name', 'workflow',
        'value', 'volunteer-hours-publication'
      ),
      pg_catalog.jsonb_build_object(
        'name', 'receipt',
        'value', v_outbox.receipt_id::text
      )
    )
  );
  v_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_snapshot::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  UPDATE public.hours_publication_email_outbox
  SET
    payload_snapshot = v_snapshot,
    payload_hash = v_hash,
    payload_prepared_at = now(),
    updated_at = now()
  WHERE id = p_delivery_id;

  RETURN v_snapshot;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_supplemental_verified_certificates(
  p_project_id uuid,
  p_schedule_id text,
  p_signup_ids uuid[],
  p_actor_id uuid
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  volunteer_name text,
  volunteer_email text,
  project_title text,
  event_start timestamptz,
  event_end timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_project_id IS NULL
    OR p_actor_id IS NULL
    OR NULLIF(pg_catalog.btrim(p_schedule_id), '') IS NULL
    OR char_length(p_schedule_id) > 200
    OR p_signup_ids IS NULL
    OR cardinality(p_signup_ids) < 1
    OR cardinality(p_signup_ids) > 500
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid supplemental certificate request';
  END IF;

  RETURN QUERY
  INSERT INTO public.certificates AS inserted_certificates (
    project_id,
    user_id,
    signup_id,
    volunteer_name,
    volunteer_email,
    project_title,
    project_location,
    event_start,
    event_end,
    organization_name,
    creator_name,
    is_certified,
    creator_id,
    type,
    check_in_method,
    schedule_id
  )
  SELECT
    projects.id,
    signups.user_id,
    signups.id,
    COALESCE(
      NULLIF(volunteer_profiles.full_name, ''),
      NULLIF(anonymous_signups.name, ''),
      'No Name Volunteer'
    ),
    COALESCE(volunteer_profiles.email::text, anonymous_signups.email),
    projects.title,
    projects.location,
    signups.check_in_time,
    signups.check_out_time,
    organizations.name,
    COALESCE(NULLIF(creator_profiles.full_name, ''), 'Project Organizer'),
    COALESCE(organizations.verified, false),
    p_actor_id,
    'verified',
    projects.verification_method,
    p_schedule_id
  FROM public.project_signups AS signups
  JOIN public.projects AS projects
    ON projects.id = signups.project_id
  LEFT JOIN public.profiles AS volunteer_profiles
    ON volunteer_profiles.id = signups.user_id
  LEFT JOIN public.anonymous_signups
    ON anonymous_signups.id = signups.anonymous_id
  LEFT JOIN public.profiles AS creator_profiles
    ON creator_profiles.id = projects.creator_id
  LEFT JOIN public.organizations
    ON organizations.id = projects.organization_id
  WHERE signups.id = ANY (p_signup_ids)
    AND signups.project_id = p_project_id
    AND signups.status = 'attended'
    AND signups.check_in_time IS NOT NULL
    AND signups.check_out_time IS NOT NULL
  ON CONFLICT (signup_id)
    WHERE type = 'verified' AND signup_id IS NOT NULL
    DO NOTHING
  RETURNING
    inserted_certificates.id,
    inserted_certificates.user_id,
    inserted_certificates.volunteer_name,
    inserted_certificates.volunteer_email,
    inserted_certificates.project_title,
    inserted_certificates.event_start,
    inserted_certificates.event_end;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_hours_publication_email_delivery(
  p_delivery_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_delivery_id IS NULL OR p_claim_token IS NULL THEN
    RETURN false;
  END IF;

  -- Resend retains an idempotency key for 24 hours. Once an interrupted
  -- provider attempt is outside that window, another send could duplicate an
  -- accepted message, so terminalize it honestly instead of reclaiming it.
  UPDATE public.hours_publication_email_outbox
  SET
    state = 'unknown_outcome',
    claim_token = NULL,
    safe_code = 'settlement_unconfirmed',
    settled_at = now(),
    updated_at = now()
  WHERE id = p_delivery_id
    AND state = 'processing'
    AND first_attempt_at < now() - interval '24 hours';

  IF FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.hours_publication_email_outbox
  SET
    state = 'processing',
    claim_token = p_claim_token,
    last_settlement_token = NULL,
    attempt_count = attempt_count + 1,
    first_attempt_at = coalesce(first_attempt_at, now()),
    last_attempt_at = now(),
    updated_at = now()
  WHERE id = p_delivery_id
    AND payload_snapshot IS NOT NULL
    AND (
      (
        state IN ('queued', 'retryable_failure')
        AND claim_token IS NULL
      )
      OR (
        state = 'processing'
        AND last_attempt_at < now() - interval '15 minutes'
        AND first_attempt_at >= now() - interval '24 hours'
      )
    );

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_hours_publication_email_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_state text,
  p_provider_message_id text DEFAULT NULL,
  p_safe_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_state NOT IN (
    'accepted',
    'retryable_failure',
    'definitive_failure',
    'unknown_outcome',
    'skipped'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid email settlement state';
  END IF;

  IF p_provider_message_id IS NOT NULL
    AND char_length(p_provider_message_id) > 200
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'provider message identity is too long';
  END IF;

  IF p_safe_code IS NOT NULL AND p_safe_code !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid safe settlement code';
  END IF;

  UPDATE public.hours_publication_email_outbox
  SET
    state = p_state,
    claim_token = NULL,
    last_settlement_token = p_claim_token,
    provider_message_id = p_provider_message_id,
    safe_code = p_safe_code,
    first_attempt_at = CASE
      WHEN p_state = 'retryable_failure' THEN NULL
      ELSE first_attempt_at
    END,
    settled_at = CASE
      WHEN p_state = 'retryable_failure' THEN NULL
      ELSE now()
    END,
    updated_at = now()
  WHERE id = p_delivery_id
    AND state = 'processing'
    AND claim_token = p_claim_token;

  IF FOUND THEN
    RETURN true;
  END IF;

  -- A successful settlement whose response was lost is safe to repeat with
  -- the same claim token and exact bounded outcome metadata.
  RETURN EXISTS (
    SELECT 1
    FROM public.hours_publication_email_outbox AS outbox
    WHERE outbox.id = p_delivery_id
      AND outbox.last_settlement_token = p_claim_token
      AND outbox.state = p_state
      AND outbox.provider_message_id IS NOT DISTINCT FROM p_provider_message_id
      AND outbox.safe_code IS NOT DISTINCT FROM p_safe_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_volunteer_hours_transactional(uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_hours_publication_email_delivery(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_supplemental_verified_certificates(uuid, text, uuid[], uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_hours_publication_email_delivery(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_hours_publication_email_delivery(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_volunteer_hours_transactional(uuid, text, jsonb, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_volunteer_hours_transactional(uuid, text, jsonb, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_hours_publication_email_delivery(uuid, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_supplemental_verified_certificates(uuid, text, uuid[], uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_hours_publication_email_delivery(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_hours_publication_email_delivery(uuid, uuid, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.publish_volunteer_hours_transactional(uuid, text, jsonb, text) IS
  'Authenticated, permission-rechecked, replay-safe publication of validated signup hours, certificates, in-app notifications, and durable email work.';
COMMENT ON FUNCTION public.prepare_hours_publication_email_delivery(uuid, text, text, text) IS
  'Service-only first-writer-wins snapshot of the exact bounded provider payload. Recovery returns the immutable stored payload and verifies its hash.';
COMMENT ON FUNCTION public.claim_hours_publication_email_delivery(uuid, uuid) IS
  'Service-only claim. Explicit drains reclaim interrupted processing only inside Resend''s 24-hour idempotency window; older ambiguous work terminalizes as unknown.';
COMMENT ON FUNCTION public.settle_hours_publication_email_delivery(uuid, uuid, text, text, text) IS
  'Service-only, claim-token-idempotent settlement with bounded, non-recipient provider outcome metadata.';
