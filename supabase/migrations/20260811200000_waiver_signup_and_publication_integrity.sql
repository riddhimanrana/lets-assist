-- Close two waiver-integrity gaps at the database boundary.
--
-- 1. Signup: guest-profile creation, the capacity-checked signup row, and the
--    waiver evidence row now commit or roll back together in one function
--    call. A refused or faulted signup therefore leaves no approved/pending
--    row and consumes no capacity even when the application process dies
--    mid-flight, so no application-side compensating delete is load bearing.
--
-- 2. Publication: a waiver-required project stays unpublished (and therefore
--    unreadable to the public and unsignable) until the source PDF object
--    really exists in Storage and, when e-signatures are enabled, an active
--    project-scoped definition with a signature placement is pinned to that
--    same object.
--
-- Everything added here is service-role only. No private helper is granted to
-- a browser role, and a missing storage.objects catalog fails closed instead
-- of counting as proof.

-- ---------------------------------------------------------------------------
-- Signup: single-transaction identity, capacity, and waiver evidence
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.insert_project_signup_locked(
  p_project_id uuid,
  p_schedule_id text,
  p_user_id uuid,
  p_anonymous_id uuid,
  p_status text,
  p_volunteer_comment text,
  p_response_data jsonb,
  p_waiver jsonb,
  p_anonymous_profile jsonb
)
RETURNS TABLE (
  signup_id uuid,
  anonymous_signup_id uuid,
  waiver_signature_id uuid,
  outcome text,
  slot_capacity integer,
  active_count bigint
)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_project record;
  v_window record;
  v_existing record;
  v_anonymous_id uuid := p_anonymous_id;
  v_waiver_required boolean;
BEGIN
  signup_id := NULL;
  anonymous_signup_id := p_anonymous_id;
  waiver_signature_id := NULL;
  slot_capacity := NULL;
  active_count := 0;

  IF p_project_id IS NULL
    OR NULLIF(BTRIM(p_schedule_id), '') IS NULL
    OR p_status NOT IN ('approved', 'pending')
  THEN
    outcome := 'invalid_input';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Exactly one identity. A session actor may never carry guest identity, and
  -- a guest either references one existing profile or supplies the profile
  -- this transaction creates.
  IF p_user_id IS NOT NULL THEN
    IF p_anonymous_id IS NOT NULL OR p_anonymous_profile IS NOT NULL THEN
      outcome := 'conflicting_identity';
      RETURN NEXT;
      RETURN;
    END IF;
  ELSIF (p_anonymous_id IS NULL) = (p_anonymous_profile IS NULL) THEN
    outcome := 'invalid_input';
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_anonymous_profile IS NOT NULL
    AND (
      jsonb_typeof(p_anonymous_profile) IS DISTINCT FROM 'object'
      OR NULLIF(BTRIM(COALESCE(p_anonymous_profile->>'email', '')), '') IS NULL
      OR length(p_anonymous_profile->>'email') > 320
      OR length(COALESCE(p_anonymous_profile->>'name', '')) > 200
      OR length(COALESCE(p_anonymous_profile->>'phone_number', '')) > 64
    )
  THEN
    outcome := 'invalid_identity';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Reject a malformed waiver payload before anything is written, so the only
  -- post-insert waiver failure mode left is an exception that rolls the whole
  -- transaction back.
  IF p_waiver IS NOT NULL
    AND (
      jsonb_typeof(p_waiver) IS DISTINCT FROM 'object'
      OR octet_length(p_waiver::text) > 1048576
      OR COALESCE(p_waiver->>'signature_type', '') NOT IN (
        'draw', 'typed', 'upload', 'multi-signer'
      )
      OR NULLIF(BTRIM(COALESCE(p_waiver->>'signer_name', '')), '') IS NULL
      OR NULLIF(BTRIM(COALESCE(p_waiver->>'signer_email', '')), '') IS NULL
      OR length(p_waiver->>'signer_name') > 200
      OR length(p_waiver->>'signer_email') > 320
    )
  THEN
    outcome := 'invalid_waiver';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Confirmation takes the guest profile lock before any slot lock. Keep that
  -- ordering so a concurrent insert cannot appear between a confirmation's
  -- capacity checks and its pending-to-approved update.
  IF p_anonymous_id IS NOT NULL THEN
    PERFORM 1
    FROM public.anonymous_signups AS anonymous
    WHERE anonymous.id = p_anonymous_id
    FOR UPDATE;

    IF NOT FOUND THEN
      outcome := 'identity_not_found';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- Every capacity-aware insert for a slot uses the same transaction lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'lets-assist-project-signup:' || p_project_id::text || ':' || p_schedule_id,
      0
    )
  );

  SELECT
    projects.status,
    projects.pause_signups,
    projects.workflow_status,
    projects.waiver_required
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = p_project_id
  FOR SHARE;

  IF NOT FOUND THEN
    outcome := 'project_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  -- A staged or drafted project is not publicly readable, so it must not be
  -- signable or able to consume capacity either.
  IF COALESCE(v_project.workflow_status, 'published') <> 'published' THEN
    outcome := 'project_unpublished';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_project.pause_signups
    OR v_project.status IN ('cancelled', 'completed')
  THEN
    outcome := 'project_closed';
    RETURN NEXT;
    RETURN;
  END IF;

  v_waiver_required := COALESCE(v_project.waiver_required, false);

  -- Fail closed: a waiver project never gets a signup row without evidence.
  IF v_waiver_required AND p_waiver IS NULL THEN
    outcome := 'waiver_required';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT slot.capacity, slot.starts_at, slot.ends_at
  INTO v_window
  FROM private.resolve_project_schedule_slot(p_project_id, p_schedule_id) AS slot;

  IF NOT FOUND THEN
    outcome := 'invalid_slot';
    RETURN NEXT;
    RETURN;
  END IF;
  slot_capacity := v_window.capacity;

  IF p_user_id IS NOT NULL OR p_anonymous_id IS NOT NULL THEN
    SELECT signups.id, signups.status
    INTO v_existing
    FROM public.project_signups AS signups
    WHERE signups.project_id = p_project_id
      AND signups.schedule_id = p_schedule_id
      AND signups.status <> 'cancelled'
      AND (
        (p_user_id IS NOT NULL AND signups.user_id = p_user_id)
        OR (
          p_anonymous_id IS NOT NULL
          AND signups.anonymous_id = p_anonymous_id
        )
      )
    ORDER BY signups.created_at DESC NULLS LAST, signups.id
    LIMIT 1;

    IF FOUND THEN
      -- A replayed request returns the first row instead of taking a second
      -- seat, so a lost response cannot double-book or double-sign.
      signup_id := v_existing.id;
      outcome := CASE
        WHEN v_existing.status = 'rejected' THEN 'rejected'
        ELSE 'already_exists'
      END;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT COUNT(*)
  INTO active_count
  FROM public.project_signups AS signups
  WHERE signups.project_id = p_project_id
    AND signups.schedule_id = p_schedule_id
    AND signups.status IN ('approved', 'attended');

  -- Pending email confirmations do not consume a slot yet, matching the
  -- existing product rule.
  IF active_count >= slot_capacity THEN
    outcome := 'slot_full';
    RETURN NEXT;
    RETURN;
  END IF;

  -- The guest profile is created only once every refusal has been ruled out,
  -- so a refused signup never leaves an identity behind.
  IF p_anonymous_profile IS NOT NULL THEN
    INSERT INTO public.anonymous_signups (
      project_id,
      email,
      name,
      phone_number,
      token,
      confirmed_at
    )
    VALUES (
      p_project_id,
      p_anonymous_profile->>'email',
      NULLIF(p_anonymous_profile->>'name', ''),
      NULLIF(p_anonymous_profile->>'phone_number', ''),
      COALESCE(
        NULLIF(p_anonymous_profile->>'token', '')::uuid,
        gen_random_uuid()
      ),
      CASE
        WHEN COALESCE((p_anonymous_profile->>'confirmed')::boolean, false)
          THEN clock_timestamp()
        ELSE NULL
      END
    )
    ON CONFLICT DO NOTHING
    RETURNING anonymous_signups.id INTO v_anonymous_id;

    IF v_anonymous_id IS NULL THEN
      outcome := 'identity_conflict';
      RETURN NEXT;
      RETURN;
    END IF;

    anonymous_signup_id := v_anonymous_id;
  END IF;

  INSERT INTO public.project_signups (
    project_id,
    schedule_id,
    user_id,
    anonymous_id,
    status,
    volunteer_comment,
    response_data
  )
  VALUES (
    p_project_id,
    p_schedule_id,
    p_user_id,
    v_anonymous_id,
    p_status,
    p_volunteer_comment,
    p_response_data
  )
  RETURNING project_signups.id INTO signup_id;

  IF p_waiver IS NOT NULL THEN
    -- Project, signup, and signer identity come from the verified arguments,
    -- never from the caller-supplied payload, so evidence cannot be bound to
    -- another project, signup, or actor.
    INSERT INTO public.waiver_signatures (
      waiver_definition_id,
      waiver_pdf_url,
      waiver_pdf_storage_path,
      project_id,
      signup_id,
      user_id,
      anonymous_id,
      signer_name,
      signer_email,
      signature_type,
      signature_text,
      signature_storage_path,
      upload_storage_path,
      signature_payload,
      form_data,
      ip_address,
      user_agent
    )
    VALUES (
      NULLIF(p_waiver->>'waiver_definition_id', '')::uuid,
      NULLIF(p_waiver->>'waiver_pdf_url', ''),
      NULLIF(p_waiver->>'waiver_pdf_storage_path', ''),
      p_project_id,
      signup_id,
      p_user_id,
      v_anonymous_id,
      BTRIM(p_waiver->>'signer_name'),
      BTRIM(p_waiver->>'signer_email'),
      p_waiver->>'signature_type',
      NULLIF(p_waiver->>'signature_text', ''),
      NULLIF(p_waiver->>'signature_storage_path', ''),
      NULLIF(p_waiver->>'upload_storage_path', ''),
      CASE
        WHEN jsonb_typeof(p_waiver->'signature_payload') = 'object'
          THEN p_waiver->'signature_payload'
        ELSE NULL
      END,
      CASE
        WHEN jsonb_typeof(p_waiver->'form_data') = 'object'
          THEN p_waiver->'form_data'
        ELSE NULL
      END,
      NULLIF(p_waiver->>'ip_address', ''),
      NULLIF(p_waiver->>'user_agent', '')
    )
    RETURNING waiver_signatures.id INTO waiver_signature_id;
  END IF;

  outcome := 'inserted';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION private.insert_project_signup_locked(
  uuid, text, uuid, uuid, text, text, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.insert_project_signup_locked(
  uuid, text, uuid, uuid, text, text, jsonb, jsonb, jsonb
) TO service_role;

COMMENT ON FUNCTION private.insert_project_signup_locked(
  uuid, text, uuid, uuid, text, text, jsonb, jsonb, jsonb
) IS 'Single-transaction guest identity, capacity, and waiver evidence writer for project signups.';

-- Retained for compatibility. Callers that never carry waiver evidence now
-- fail closed on waiver-required projects instead of creating an orphan.
CREATE OR REPLACE FUNCTION public.insert_project_signup_with_capacity(
  p_project_id uuid,
  p_schedule_id text,
  p_user_id uuid,
  p_anonymous_id uuid,
  p_status text,
  p_volunteer_comment text DEFAULT NULL,
  p_response_data jsonb DEFAULT NULL
)
RETURNS TABLE (
  signup_id uuid,
  outcome text,
  slot_capacity integer,
  active_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    locked.signup_id,
    locked.outcome,
    locked.slot_capacity,
    locked.active_count
  FROM private.insert_project_signup_locked(
    p_project_id,
    p_schedule_id,
    p_user_id,
    p_anonymous_id,
    p_status,
    p_volunteer_comment,
    p_response_data,
    NULL,
    NULL
  ) AS locked;
$$;

REVOKE ALL ON FUNCTION public.insert_project_signup_with_capacity(
  uuid, text, uuid, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_project_signup_with_capacity(
  uuid, text, uuid, uuid, text, text, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.insert_project_signup_with_waiver(
  p_project_id uuid,
  p_schedule_id text,
  p_user_id uuid,
  p_anonymous_id uuid,
  p_status text,
  p_volunteer_comment text DEFAULT NULL,
  p_response_data jsonb DEFAULT NULL,
  p_waiver jsonb DEFAULT NULL,
  p_anonymous_profile jsonb DEFAULT NULL
)
RETURNS TABLE (
  signup_id uuid,
  anonymous_signup_id uuid,
  waiver_signature_id uuid,
  outcome text,
  slot_capacity integer,
  active_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT *
  FROM private.insert_project_signup_locked(
    p_project_id,
    p_schedule_id,
    p_user_id,
    p_anonymous_id,
    p_status,
    p_volunteer_comment,
    p_response_data,
    p_waiver,
    p_anonymous_profile
  ) AS locked;
$$;

REVOKE ALL ON FUNCTION public.insert_project_signup_with_waiver(
  uuid, text, uuid, uuid, text, text, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_project_signup_with_waiver(
  uuid, text, uuid, uuid, text, text, jsonb, jsonb, jsonb
) TO service_role;

COMMENT ON FUNCTION public.insert_project_signup_with_waiver(
  uuid, text, uuid, uuid, text, text, jsonb, jsonb, jsonb
) IS 'Service-only atomic project signup: guest identity, capacity seat, and waiver evidence commit together or not at all.';

-- ---------------------------------------------------------------------------
-- Publication: staged waiver projects
-- ---------------------------------------------------------------------------

-- Fail closed. An environment without the Storage object catalog cannot prove
-- a source PDF exists, so it must raise rather than report success.
CREATE OR REPLACE FUNCTION private.waiver_source_object_exists(
  p_bucket text,
  p_path text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF NULLIF(BTRIM(COALESCE(p_bucket, '')), '') IS NULL
    OR NULLIF(BTRIM(COALESCE(p_path, '')), '') IS NULL
  THEN
    RETURN false;
  END IF;

  IF to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'storage object catalog is unavailable'
      USING ERRCODE = '42P01';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM storage.objects AS objects
    WHERE objects.bucket_id = p_bucket
      AND objects.name = p_path
  )
  INTO v_exists;

  RETURN v_exists;
END;
$$;

REVOKE ALL ON FUNCTION private.waiver_source_object_exists(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.waiver_source_object_exists(text, text)
  TO service_role;

COMMENT ON FUNCTION private.waiver_source_object_exists(text, text) IS
  'Service-only proof that a waiver source object exists; raises when the Storage catalog is unavailable.';

CREATE OR REPLACE FUNCTION public.publish_waiver_staged_project(
  p_project_id uuid,
  p_actor_id uuid
)
RETURNS TABLE (
  outcome text,
  workflow_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_definition public.waiver_definitions%ROWTYPE;
  v_esignature_enabled boolean;
  v_current_status text;
BEGIN
  outcome := NULL;
  workflow_status := NULL;

  IF p_project_id IS NULL OR p_actor_id IS NULL THEN
    outcome := 'invalid_input';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'project_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  v_current_status := COALESCE(v_project.workflow_status, 'published');
  workflow_status := v_current_status;

  IF v_project.creator_id IS DISTINCT FROM p_actor_id
    AND NOT COALESCE(
      app_private.is_project_organizer(p_project_id, p_actor_id),
      false
    )
  THEN
    outcome := 'forbidden';
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT COALESCE(v_project.waiver_required, false) THEN
    outcome := 'not_waiver_project';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_current_status NOT IN ('draft', 'published') THEN
    outcome := 'invalid_state';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_project.waiver_pdf_storage_path IS NULL THEN
    outcome := 'missing_waiver_source';
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT private.waiver_source_object_exists(
    'waiver-uploads',
    v_project.waiver_pdf_storage_path
  ) THEN
    outcome := 'missing_storage_object';
    RETURN NEXT;
    RETURN;
  END IF;

  v_esignature_enabled := NOT COALESCE(v_project.waiver_disable_esignature, false);

  -- Without e-signatures the only way to sign is the upload path, so the two
  -- switches may not both be off.
  IF NOT v_esignature_enabled
    AND v_project.waiver_allow_upload IS DISTINCT FROM true
  THEN
    outcome := 'no_signing_mode';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_esignature_enabled AND v_project.waiver_definition_id IS NULL THEN
    outcome := 'missing_waiver_definition';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_project.waiver_definition_id IS NOT NULL THEN
    SELECT *
    INTO v_definition
    FROM public.waiver_definitions AS definitions
    WHERE definitions.id = v_project.waiver_definition_id
      AND definitions.project_id = p_project_id;

    IF NOT FOUND
      OR NOT v_definition.active
      OR v_definition.scope IS DISTINCT FROM 'project'
      OR v_definition.pdf_storage_path IS DISTINCT FROM
        v_project.waiver_pdf_storage_path
    THEN
      outcome := 'definition_source_mismatch';
      RETURN NEXT;
      RETURN;
    END IF;

    -- An e-signature project needs a definition that can actually be signed.
    IF v_esignature_enabled
      AND (
        jsonb_typeof(v_definition.signers) IS DISTINCT FROM 'array'
        OR jsonb_array_length(v_definition.signers) < 1
        OR jsonb_typeof(v_definition.fields) IS DISTINCT FROM 'array'
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_definition.fields) AS field
          WHERE field->>'field_type' IN ('signature', 'initial')
        )
      )
    THEN
      outcome := 'definition_missing_signature_field';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  IF v_current_status = 'published' THEN
    outcome := 'already_published';
    workflow_status := 'published';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.projects AS projects
  SET workflow_status = 'published'
  WHERE projects.id = p_project_id;

  outcome := 'published';
  workflow_status := 'published';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_waiver_staged_project(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_waiver_staged_project(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.publish_waiver_staged_project(uuid, uuid) IS
  'Service-only idempotent publication of a staged waiver project after proving its source object and signing configuration.';
