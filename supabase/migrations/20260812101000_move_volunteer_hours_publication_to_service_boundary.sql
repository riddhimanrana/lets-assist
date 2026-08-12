-- The volunteer-hours transaction used to be a public SECURITY DEFINER RPC
-- executable by authenticated. Keep the transaction in an unexposed schema
-- and expose only a service-role SECURITY INVOKER shim. The actor is supplied
-- by the Server Action after auth.getUser() revalidates the request session;
-- browser roles cannot execute either function and therefore cannot spoof it.

CREATE OR REPLACE FUNCTION private.publish_volunteer_hours_transactional(
  p_actor_id uuid,
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
  v_actor_id uuid := p_actor_id;
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

REVOKE ALL ON FUNCTION private.publish_volunteer_hours_transactional(uuid, uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.publish_volunteer_hours_transactional(uuid, uuid, text, jsonb, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.publish_volunteer_hours_transactional(
  p_actor_id uuid,
  p_project_id uuid,
  p_schedule_id text,
  p_entries jsonb,
  p_request_key text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.publish_volunteer_hours_transactional(
    p_actor_id,
    p_project_id,
    p_schedule_id,
    p_entries,
    p_request_key
  );
$$;

REVOKE ALL ON FUNCTION public.publish_volunteer_hours_transactional(uuid, uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_volunteer_hours_transactional(uuid, uuid, text, jsonb, text)
  TO service_role;

-- Remove the browser-callable overload only after its replacement and ACL are
-- complete. Revoking first makes the intended transition explicit even when a
-- migration runner reports a later failure.
REVOKE ALL ON FUNCTION public.publish_volunteer_hours_transactional(uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.publish_volunteer_hours_transactional(uuid, text, jsonb, text);

COMMENT ON FUNCTION private.publish_volunteer_hours_transactional(uuid, uuid, text, jsonb, text) IS
  'Private SECURITY DEFINER transaction for replay-safe volunteer-hours publication. Revalidates the explicit server-authenticated actor against project and active organization authority.';
COMMENT ON FUNCTION public.publish_volunteer_hours_transactional(uuid, uuid, text, jsonb, text) IS
  'Service-role-only SECURITY INVOKER RPC shim. p_actor_id must come from a server-validated user session; browser roles have no EXECUTE privilege.';
