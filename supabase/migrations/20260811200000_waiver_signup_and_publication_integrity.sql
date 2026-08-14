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

-- One definition of "this waiver project is really publishable", shared by the
-- publication RPC, the settings RPC, and the legacy audit below. Returns NULL
-- when the row may be published, otherwise the reason it may not.
CREATE OR REPLACE FUNCTION private.waiver_publication_blocker(
  p_project public.projects
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_definition public.waiver_definitions%ROWTYPE;
  v_esignature_enabled boolean;
BEGIN
  IF NOT COALESCE(p_project.waiver_required, false) THEN
    RETURN NULL;
  END IF;

  IF p_project.waiver_pdf_storage_path IS NULL THEN
    RETURN 'missing_waiver_source';
  END IF;

  IF NOT private.waiver_source_object_exists(
    'waiver-uploads',
    p_project.waiver_pdf_storage_path
  ) THEN
    RETURN 'missing_storage_object';
  END IF;

  v_esignature_enabled := NOT COALESCE(p_project.waiver_disable_esignature, false);

  -- Without e-signatures the only way to sign is the upload path, so the two
  -- switches may not both be off.
  IF NOT v_esignature_enabled
    AND p_project.waiver_allow_upload IS DISTINCT FROM true
  THEN
    RETURN 'no_signing_mode';
  END IF;

  IF v_esignature_enabled AND p_project.waiver_definition_id IS NULL THEN
    RETURN 'missing_waiver_definition';
  END IF;

  IF p_project.waiver_definition_id IS NOT NULL THEN
    SELECT *
    INTO v_definition
    FROM public.waiver_definitions AS definitions
    WHERE definitions.id = p_project.waiver_definition_id
      AND definitions.project_id = p_project.id;

    IF NOT FOUND
      OR NOT v_definition.active
      OR v_definition.scope IS DISTINCT FROM 'project'
      OR v_definition.pdf_storage_path IS DISTINCT FROM
        p_project.waiver_pdf_storage_path
    THEN
      RETURN 'definition_source_mismatch';
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
      RETURN 'definition_missing_signature_field';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.waiver_publication_blocker(public.projects)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.waiver_publication_blocker(public.projects)
  TO service_role;

COMMENT ON FUNCTION private.waiver_publication_blocker(public.projects) IS
  'Service-only single source of truth for whether a waiver-required project may be published.';

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
  v_blocker text;
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

  v_blocker := private.waiver_publication_blocker(v_project);

  IF v_blocker IS NOT NULL THEN
    outcome := v_blocker;
    RETURN NEXT;
    RETURN;
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

-- ---------------------------------------------------------------------------
-- The database boundary: a browser role can never produce a published
-- waiver-required project
-- ---------------------------------------------------------------------------
--
-- RLS on public.projects is column blind, so an organizer holds a direct
-- UPDATE on their own row and could otherwise set workflow_status to
-- 'published' (or flip waiver_required on an already published project)
-- without any proven waiver. Application-side staging alone is therefore not
-- a boundary. This trigger refuses every client-role transition into, or
-- waiver reconfiguration of, a published waiver-required project. Proof is
-- deliberately not evaluated here: the only sanctioned way into that state is
-- publish_waiver_staged_project / apply_project_waiver_settings, which run as
-- service_role and verify the persisted definition and Storage object first.
--
-- A row that is already published and already waiver-required stays editable
-- for everything else, so no pre-existing project is stranded by this change.
-- See the legacy audit at the end of this migration.

CREATE OR REPLACE FUNCTION private.protect_waiver_project_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_gated boolean;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- Evidence provenance. waiver_definition_id is only ever written by
  -- save_project_waiver_definition_version, and a source path may only name an
  -- object under this project's own prefix, so a client cannot pin its project
  -- to another project's waiver document.
  IF TG_OP = 'INSERT' THEN
    IF NEW.waiver_definition_id IS NOT NULL THEN
      RAISE EXCEPTION 'waiver definitions are attached by the server-authorized operation'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.waiver_pdf_storage_path IS NOT NULL THEN
      RAISE EXCEPTION 'waiver source documents are attached by the server-authorized operation'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.waiver_definition_id IS DISTINCT FROM OLD.waiver_definition_id
      AND NEW.waiver_definition_id IS NOT NULL
    THEN
      RAISE EXCEPTION 'waiver definitions are attached by the server-authorized operation'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.waiver_pdf_storage_path IS DISTINCT FROM OLD.waiver_pdf_storage_path
      AND NEW.waiver_pdf_storage_path IS NOT NULL
      AND NEW.waiver_pdf_storage_path
        NOT LIKE 'project_waivers/' || NEW.id::text || '/%'
    THEN
      RAISE EXCEPTION 'a waiver source document must belong to its own project'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF COALESCE(NEW.workflow_status, 'published') <> 'published'
    OR NOT COALESCE(NEW.waiver_required, false)
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_gated := true;
  ELSE
    v_gated :=
      COALESCE(OLD.workflow_status, 'published') <> 'published'
      OR NOT COALESCE(OLD.waiver_required, false)
      OR NEW.waiver_pdf_storage_path IS DISTINCT FROM OLD.waiver_pdf_storage_path
      OR NEW.waiver_definition_id IS DISTINCT FROM OLD.waiver_definition_id
      OR NEW.waiver_disable_esignature IS DISTINCT FROM OLD.waiver_disable_esignature
      OR NEW.waiver_allow_upload IS DISTINCT FROM OLD.waiver_allow_upload;
  END IF;

  IF NOT v_gated THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'publishing or reconfiguring a waiver-required project requires the server-authorized waiver operation'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS protect_waiver_project_publication ON public.projects;
CREATE TRIGGER protect_waiver_project_publication
BEFORE INSERT OR UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION private.protect_waiver_project_publication();

REVOKE ALL ON FUNCTION private.protect_waiver_project_publication()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.protect_waiver_project_publication()
  TO service_role;

COMMENT ON FUNCTION private.protect_waiver_project_publication() IS
  'Refuses browser-role writes that would publish, reconfigure, or forge the evidence of a waiver-required project.';

-- ---------------------------------------------------------------------------
-- The sanctioned way to change waiver settings on an existing project
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_project_waiver_settings(
  p_project_id uuid,
  p_actor_id uuid,
  p_waiver_required boolean DEFAULT NULL,
  p_waiver_allow_upload boolean DEFAULT NULL,
  p_waiver_disable_esignature boolean DEFAULT NULL
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
  v_candidate public.projects%ROWTYPE;
  v_blocker text;
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

  workflow_status := COALESCE(v_project.workflow_status, 'published');

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

  v_candidate := v_project;
  v_candidate.waiver_required :=
    COALESCE(p_waiver_required, v_project.waiver_required);
  v_candidate.waiver_allow_upload :=
    COALESCE(p_waiver_allow_upload, v_project.waiver_allow_upload);
  v_candidate.waiver_disable_esignature :=
    COALESCE(p_waiver_disable_esignature, v_project.waiver_disable_esignature);

  IF v_candidate.waiver_required IS NOT DISTINCT FROM v_project.waiver_required
    AND v_candidate.waiver_allow_upload
      IS NOT DISTINCT FROM v_project.waiver_allow_upload
    AND v_candidate.waiver_disable_esignature
      IS NOT DISTINCT FROM v_project.waiver_disable_esignature
  THEN
    outcome := 'unchanged';
    RETURN NEXT;
    RETURN;
  END IF;

  -- A published project must keep proving its waiver across the change. A
  -- draft is proved later, by publish_waiver_staged_project.
  IF workflow_status = 'published' THEN
    v_blocker := private.waiver_publication_blocker(v_candidate);

    IF v_blocker IS NOT NULL THEN
      outcome := v_blocker;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  UPDATE public.projects AS projects
  SET waiver_required = v_candidate.waiver_required,
      waiver_allow_upload = v_candidate.waiver_allow_upload,
      waiver_disable_esignature = v_candidate.waiver_disable_esignature
  WHERE projects.id = p_project_id;

  outcome := 'updated';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_project_waiver_settings(
  uuid, uuid, boolean, boolean, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_project_waiver_settings(
  uuid, uuid, boolean, boolean, boolean
) TO service_role;

COMMENT ON FUNCTION public.apply_project_waiver_settings(
  uuid, uuid, boolean, boolean, boolean
) IS 'Service-only organizer-scoped waiver setting change that keeps a published project provably signable.';

-- ---------------------------------------------------------------------------
-- Retry-safe project creation
-- ---------------------------------------------------------------------------
--
-- A staged waiver project is created before its PDF exists. Without a durable
-- key, a reload between create and publish stranded an invisible draft row and
-- every retry inserted another one. The creator-scoped key makes the create
-- step idempotent instead, so a retry finishes the same row.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS creation_idempotency_key uuid;

COMMENT ON COLUMN public.projects.creation_idempotency_key IS
  'Client-supplied per-attempt key that makes project creation retry-safe; unique per creator.';

CREATE UNIQUE INDEX IF NOT EXISTS projects_creator_creation_idempotency_key
  ON public.projects (creator_id, creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Superseded waiver source documents
-- ---------------------------------------------------------------------------
--
-- Re-uploading a waiver PDF repoints the project at a new object and leaves
-- the previous one unreferenced. Route it through the existing deletion queue
-- rather than deleting inline, and re-check source references (not just
-- signature-asset references) before the drain removes it.

CREATE OR REPLACE FUNCTION private.waiver_source_path_is_referenced(
  p_object_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects AS projects
    WHERE projects.waiver_pdf_storage_path = p_object_path
  ) OR EXISTS (
    SELECT 1 FROM public.waiver_definitions AS definitions
    WHERE definitions.pdf_storage_path = p_object_path
  ) OR EXISTS (
    SELECT 1 FROM public.waiver_signatures AS signatures
    WHERE signatures.waiver_pdf_storage_path = p_object_path
  );
$$;

REVOKE ALL ON FUNCTION private.waiver_source_path_is_referenced(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.waiver_source_path_is_referenced(text)
  TO service_role;

COMMENT ON FUNCTION private.waiver_source_path_is_referenced(text) IS
  'True when a waiver-uploads object is still named by a project, definition, or signature.';

-- Bucket-aware re-check. waiver-signatures keeps the original evidence rule;
-- waiver-uploads uses the source rule above. An unknown bucket is never
-- treated as unreferenced.
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
  v_referenced boolean;
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
    v_referenced := CASE v_item.bucket_id
      WHEN 'waiver-signatures'
        THEN private.waiver_storage_path_is_referenced(v_item.object_path)
      WHEN 'waiver-uploads'
        THEN private.waiver_source_path_is_referenced(v_item.object_path)
      ELSE true
    END;

    IF v_referenced THEN
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

CREATE OR REPLACE FUNCTION public.enqueue_superseded_waiver_source(
  p_object_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_path text := NULLIF(BTRIM(COALESCE(p_object_path, '')), '');
BEGIN
  IF v_path IS NULL OR v_path ~* '^(data:|https?://)' THEN
    RETURN false;
  END IF;

  IF private.waiver_source_path_is_referenced(v_path) THEN
    RETURN false;
  END IF;

  INSERT INTO public.waiver_storage_deletion_queue (bucket_id, object_path)
  VALUES ('waiver-uploads', v_path)
  ON CONFLICT (bucket_id, object_path) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_superseded_waiver_source(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_superseded_waiver_source(text)
  TO service_role;

COMMENT ON FUNCTION public.enqueue_superseded_waiver_source(text) IS
  'Service-only queueing of a replaced waiver source object for the existing reference-rechecked deletion drain.';

-- ---------------------------------------------------------------------------
-- Paper signup commits obey the same waiver invariant
-- ---------------------------------------------------------------------------
--
-- commit_paper_signup_batch created attended project_signups with no waiver
-- evidence at all. Fabricating digital consent for a paper sheet would be a
-- lie, so this fails closed instead: an unpublished project refuses the whole
-- batch, and on a waiver-required project a row that would mint a *new*
-- signup is failed with 'waiver_required'. Marking an existing signup attended
-- and recording a roster-only headcount stay available, because neither
-- creates a signup that lacks evidence. The full paper-waiver workflow is
-- deliberately deferred; see docs/development/cleanup-register.md.

CREATE OR REPLACE FUNCTION public.commit_paper_signup_batch(
  p_batch_id uuid,
  p_actor_id uuid,
  p_row_ids uuid[],
  p_allow_over_capacity boolean DEFAULT false,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS TABLE (
  row_id uuid,
  outcome text,
  signup_id uuid,
  anonymous_id uuid,
  user_id uuid,
  over_capacity boolean,
  detail text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch record;
  v_project record;
  v_slot record;
  v_row record;
  v_email text;
  v_check_in timestamptz;
  v_check_out timestamptz;
  v_existing_signup record;
  v_profile_id uuid;
  v_anon_id uuid;
  v_new_signup_id uuid;
  v_active_count bigint;
  v_over boolean;
  v_committed integer := 0;
  v_roster integer := 0;
  v_waiver_required boolean := false;
BEGIN
  IF p_batch_id IS NULL OR p_actor_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: invalid input';
  END IF;

  SELECT batches.*
  INTO v_batch
  FROM public.project_paper_scan_batches AS batches
  WHERE batches.id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: batch not found';
  END IF;

  -- Defence in depth: the caller (service role) has already authorized, but a
  -- bug there must not let a non-organizer commit. app_private variant because
  -- p_actor_id is not auth.uid() under the service role.
  IF NOT app_private.can_manage_project(v_batch.project_id, p_actor_id) THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: actor is not a project organizer';
  END IF;

  -- Idempotent replay: the same key on a committed batch returns the stored
  -- per-row outcomes without touching signups again.
  IF v_batch.status = 'committed' THEN
    IF v_batch.commit_idempotency_key = p_idempotency_key THEN
      RETURN QUERY
      SELECT scan_rows.id, scan_rows.outcome, scan_rows.committed_signup_id,
             scan_rows.committed_anonymous_id, signups.user_id,
             scan_rows.over_capacity, scan_rows.outcome_detail
      FROM public.project_paper_scan_rows AS scan_rows
      LEFT JOIN public.project_signups AS signups
        ON signups.id = scan_rows.committed_signup_id
      WHERE scan_rows.batch_id = p_batch_id
        AND scan_rows.id = ANY (p_row_ids)
      ORDER BY scan_rows.sheet_row_number;
      RETURN;
    END IF;

    RETURN QUERY
    SELECT scan_rows.id, 'skipped'::text, scan_rows.committed_signup_id,
           scan_rows.committed_anonymous_id, NULL::uuid,
           scan_rows.over_capacity, 'already_committed'::text
    FROM public.project_paper_scan_rows AS scan_rows
    WHERE scan_rows.batch_id = p_batch_id
      AND scan_rows.id = ANY (p_row_ids)
    ORDER BY scan_rows.sheet_row_number;
    RETURN;
  END IF;

  IF v_batch.status NOT IN ('review', 'committing') THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: batch is not reviewable (status %)', v_batch.status;
  END IF;

  SELECT projects.workflow_status, projects.waiver_required
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = v_batch.project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: project not found';
  END IF;

  -- A staged or drafted project is not signable, so it must not gain
  -- attendance either.
  IF COALESCE(v_project.workflow_status, 'published') <> 'published' THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: project is not published';
  END IF;

  v_waiver_required := COALESCE(v_project.waiver_required, false);

  SELECT slot.capacity, slot.starts_at, slot.ends_at
  INTO v_slot
  FROM private.resolve_project_schedule_slot(v_batch.project_id, v_batch.schedule_id) AS slot;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: invalid_schedule';
  END IF;

  -- Same lock key as insert_project_signup_with_waiver so paper commits
  -- serialize against concurrent digital signups instead of racing them.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'lets-assist-project-signup:' || v_batch.project_id::text || ':' || v_batch.schedule_id,
      0
    )
  );

  UPDATE public.project_paper_scan_batches
  SET status = 'committing', commit_idempotency_key = p_idempotency_key
  WHERE id = p_batch_id;

  FOR v_row IN
    SELECT scan_rows.*
    FROM public.project_paper_scan_rows AS scan_rows
    WHERE scan_rows.batch_id = p_batch_id
      AND scan_rows.id = ANY (p_row_ids)
      AND scan_rows.decision = 'include'
    ORDER BY scan_rows.sheet_row_number
    FOR UPDATE
  LOOP
    row_id := v_row.id;
    signup_id := NULL;
    anonymous_id := NULL;
    user_id := NULL;
    over_capacity := false;
    detail := NULL;

    -- Retried commit after a partial failure: keep the earlier result.
    IF v_row.committed_signup_id IS NOT NULL THEN
      outcome := 'skipped';
      signup_id := v_row.committed_signup_id;
      anonymous_id := v_row.committed_anonymous_id;
      detail := 'already_committed';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Clamp recorded times to the scheduled window. Mirrors
    -- complete_participant_checkout: transcription errors must not mint hours
    -- outside the event.
    v_check_in := GREATEST(COALESCE(v_row.check_in_time, v_slot.starts_at), v_slot.starts_at);
    v_check_out := LEAST(COALESCE(v_row.check_out_time, v_slot.ends_at), v_slot.ends_at);

    IF v_check_out <= v_check_in THEN
      outcome := 'failed';
      detail := 'invalid_time_window';
      UPDATE public.project_paper_scan_rows
      SET outcome = 'failed', outcome_detail = 'invalid_time_window'
      WHERE id = v_row.id;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_email := NULLIF(lower(btrim(v_row.email)), '');

    -- No email: roster-only. Headcount record, no signup, no certificate.
    IF v_email IS NULL THEN
      IF NULLIF(btrim(COALESCE(v_row.name, '')), '') IS NULL THEN
        outcome := 'failed';
        detail := 'missing_name';
        UPDATE public.project_paper_scan_rows
        SET outcome = 'failed', outcome_detail = 'missing_name'
        WHERE id = v_row.id;
        RETURN NEXT;
        CONTINUE;
      END IF;

      INSERT INTO public.project_paper_roster_entries (
        project_id, batch_id, scan_row_id, schedule_id, name, phone,
        check_in_time, check_out_time, signature_present, recorded_by
      )
      VALUES (
        v_batch.project_id, p_batch_id, v_row.id, v_batch.schedule_id,
        btrim(v_row.name), v_row.phone, v_check_in, v_check_out,
        v_row.signature_present, p_actor_id
      )
      ON CONFLICT (scan_row_id) WHERE scan_row_id IS NOT NULL DO NOTHING;

      outcome := 'roster_only';
      v_roster := v_roster + 1;
      UPDATE public.project_paper_scan_rows
      SET outcome = 'roster_only', outcome_detail = NULL
      WHERE id = v_row.id;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- 1) An existing signup for this slot whose identity resolves to this
    --    email (or the reviewer explicitly matched one): mark it attended.
    SELECT signups.id, signups.user_id, signups.anonymous_id, signups.source
    INTO v_existing_signup
    FROM public.project_signups AS signups
    LEFT JOIN public.profiles AS profiles ON profiles.id = signups.user_id
    LEFT JOIN public.anonymous_signups AS anon ON anon.id = signups.anonymous_id
    WHERE signups.project_id = v_batch.project_id
      AND signups.schedule_id = v_batch.schedule_id
      AND signups.status <> 'rejected'
      AND (
        signups.id = v_row.match_signup_id
        OR lower(COALESCE(profiles.email, '')) = v_email
        OR lower(COALESCE(anon.email, '')) = v_email
      )
    ORDER BY (signups.id = v_row.match_signup_id) DESC, signups.created_at
    LIMIT 1;

    IF FOUND THEN
      -- Same person twice on one sheet (or across two sheets in the batch):
      -- an earlier row already claimed this signup. Keep the first result and
      -- surface the duplicate instead of tripping the unique backstop index.
      IF EXISTS (
        SELECT 1
        FROM public.project_paper_scan_rows AS scan_rows
        WHERE scan_rows.committed_signup_id = v_existing_signup.id
      ) THEN
        outcome := 'skipped';
        signup_id := v_existing_signup.id;
        detail := 'duplicate_in_batch';
        UPDATE public.project_paper_scan_rows
        SET outcome = 'skipped', outcome_detail = 'duplicate_in_batch'
        WHERE id = v_row.id;
        RETURN NEXT;
        CONTINUE;
      END IF;

      UPDATE public.project_signups AS signups
      SET status = 'attended',
          check_in_time = COALESCE(signups.check_in_time, v_check_in),
          check_out_time = COALESCE(signups.check_out_time, v_check_out)
      WHERE signups.id = v_existing_signup.id;

      outcome := 'signup_updated';
      signup_id := v_existing_signup.id;
      anonymous_id := v_existing_signup.anonymous_id;
      user_id := v_existing_signup.user_id;
      v_committed := v_committed + 1;
      UPDATE public.project_paper_scan_rows
      SET outcome = 'signup_updated', outcome_detail = NULL,
          committed_signup_id = v_existing_signup.id,
          committed_anonymous_id = v_existing_signup.anonymous_id
      WHERE id = v_row.id;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- A waiver project never gains a signup without waiver evidence, and a
    -- paper sheet is not evidence of digital consent. Fail this row closed.
    IF v_waiver_required THEN
      outcome := 'failed';
      detail := 'waiver_required';
      UPDATE public.project_paper_scan_rows
      SET outcome = 'failed', outcome_detail = 'waiver_required'
      WHERE id = v_row.id;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Capacity check before creating anything new. The event already
    -- happened, so exceeding is allowed only with explicit organizer opt-in.
    SELECT COUNT(*)
    INTO v_active_count
    FROM public.project_signups AS signups
    WHERE signups.project_id = v_batch.project_id
      AND signups.schedule_id = v_batch.schedule_id
      AND signups.status IN ('approved', 'attended');

    v_over := v_active_count >= v_slot.capacity;
    IF v_over AND NOT p_allow_over_capacity THEN
      outcome := 'failed';
      detail := 'slot_full';
      UPDATE public.project_paper_scan_rows
      SET outcome = 'failed', outcome_detail = 'slot_full'
      WHERE id = v_row.id;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- 2) A platform account with this email (primary or verified alias).
    SELECT profiles.id
    INTO v_profile_id
    FROM public.profiles AS profiles
    WHERE lower(COALESCE(profiles.email, '')) = v_email
    UNION
    SELECT emails.user_id
    FROM public.user_emails AS emails
    WHERE lower(emails.email) = v_email
      AND emails.verified_at IS NOT NULL
    LIMIT 1;

    IF v_profile_id IS NOT NULL THEN
      -- The unique partial index on (user_id, project_id, schedule_id) does
      -- not apply here since we already know no signup exists for this slot.
      INSERT INTO public.project_signups (
        project_id, user_id, schedule_id, status,
        check_in_time, check_out_time, source
      )
      VALUES (
        v_batch.project_id, v_profile_id, v_batch.schedule_id, 'attended',
        v_check_in, v_check_out, 'paper_scan'
      )
      RETURNING id INTO v_new_signup_id;

      outcome := 'signup_created';
      signup_id := v_new_signup_id;
      user_id := v_profile_id;
      over_capacity := v_over;
      v_committed := v_committed + 1;
      UPDATE public.project_paper_scan_rows
      SET outcome = 'signup_created', outcome_detail = NULL,
          over_capacity = v_over,
          committed_signup_id = v_new_signup_id
      WHERE id = v_row.id;
      v_profile_id := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- 3) No account: reuse or create the anonymous identity for this email.
    --    confirmed_at is set because the organizer's review is the
    --    confirmation; no double-opt-in email round trip applies here.
    INSERT INTO public.anonymous_signups AS anon (project_id, email, name, phone_number, confirmed_at)
    VALUES (v_batch.project_id, v_email, NULLIF(btrim(COALESCE(v_row.name, '')), ''), v_row.phone, now())
    ON CONFLICT ((lower(email)), project_id) DO UPDATE
      SET name = COALESCE(anon.name, EXCLUDED.name),
          confirmed_at = COALESCE(anon.confirmed_at, EXCLUDED.confirmed_at)
    RETURNING anon.id INTO v_anon_id;

    INSERT INTO public.project_signups (
      project_id, anonymous_id, schedule_id, status,
      check_in_time, check_out_time, source
    )
    VALUES (
      v_batch.project_id, v_anon_id, v_batch.schedule_id, 'attended',
      v_check_in, v_check_out, 'paper_scan'
    )
    RETURNING id INTO v_new_signup_id;

    outcome := 'signup_created';
    signup_id := v_new_signup_id;
    anonymous_id := v_anon_id;
    over_capacity := v_over;
    v_committed := v_committed + 1;
    UPDATE public.project_paper_scan_rows
    SET outcome = 'signup_created', outcome_detail = NULL,
        over_capacity = v_over,
        committed_signup_id = v_new_signup_id,
        committed_anonymous_id = v_anon_id
    WHERE id = v_row.id;
    RETURN NEXT;
  END LOOP;

  UPDATE public.project_paper_scan_batches
  SET status = 'committed',
      committed_at = now(),
      committed_row_count = v_committed,
      roster_row_count = v_roster
  WHERE id = p_batch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_paper_signup_batch(uuid, uuid, uuid[], boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_paper_signup_batch(uuid, uuid, uuid[], boolean, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Legacy audit, not a backfill
-- ---------------------------------------------------------------------------
--
-- Some projects may already be published and waiver-required without a
-- provable source object. Silently unpublishing them would take real, live
-- volunteering events offline, so this migration does not touch them: the
-- signup path already fails closed for them (a waiver project never gets a
-- signup row without evidence), and the trigger above freezes their waiver
-- configuration. Only an aggregate count is reported, with no identifiers, so
-- the release owner can size a reviewed data plan. Tracked in
-- docs/development/cleanup-register.md.

DO $$
DECLARE
  v_total bigint := 0;
  v_unprovable bigint := 0;
BEGIN
  SELECT count(*)
  INTO v_total
  FROM public.projects AS projects
  WHERE COALESCE(projects.workflow_status, 'published') = 'published'
    AND COALESCE(projects.waiver_required, false);

  SELECT count(*)
  INTO v_unprovable
  FROM public.projects AS projects
  WHERE COALESCE(projects.workflow_status, 'published') = 'published'
    AND COALESCE(projects.waiver_required, false)
    AND private.waiver_publication_blocker(projects) IS NOT NULL;

  RAISE NOTICE
    'waiver publication audit: % published waiver-required projects, % without provable waiver evidence (left published for a reviewed data plan)',
    v_total, v_unprovable;
END $$;
