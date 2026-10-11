-- Waiver geometry boundary: the database half.
--
-- The server now proves every waiver placement against the actual bytes of
-- the source PDF before a definition is saved, before signature assets are
-- stored, and before a guest signup is confirmed. Those proofs only hold if
-- the things they were computed from cannot change afterwards. This migration
-- pins them:
--
-- 1. A definition save is compare-and-set against the project snapshot the
--    server validated, so it can never bind to a replacement source.
-- 2. A saved definition's rendering inputs are frozen, signed or not.
-- 3. A source PDF object cannot be overwritten, moved, or deleted while a
--    project, a definition, or a signature still names it.
-- 4. New waiver evidence is refused when it names a definition or source the
--    project has already moved away from.
-- 5. Guest confirmation promotes exactly the pending signups, waiver
--    requirements, and evidence rows the server checked, or nothing.
--
-- Nothing here rewrites a historical row, and every function added or
-- replaced is service-role only.
--
-- Lock order, the same on every path: guest profile, slot advisory locks,
-- project row, pending signup rows, evidence rows, definition row, source
-- object row. A writer that takes a project row exclusively (definition save,
-- waiver settings, publication) holds no profile or slot lock. A Storage
-- write takes only the object row and then reads references without locking,
-- so it can never wait on a transaction that is waiting on it.

-- ---------------------------------------------------------------------------
-- Source references, including rows that predate source paths
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.waiver_source_path_project_id(
  p_object_path text
)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_object_path ~ '^project_waivers/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.'
      THEN substring(p_object_path FROM 17 FOR 36)::uuid
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION private.waiver_source_path_project_id(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.waiver_source_path_project_id(text)
  TO service_role;

COMMENT ON FUNCTION private.waiver_source_path_project_id(text) IS
  'The project a waiver-uploads object path belongs to, or NULL when the path is not project scoped.';

-- A row with no Storage path may still name the object through the public URL
-- it was created with. The server only ever reads such a URL when it points
-- at the prefix of its own project in waiver-uploads, so the same rule decides
-- whether the object is still in use. Matching on the URL suffix can only
-- keep an object longer, never release one early.
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
  ) OR EXISTS (
    SELECT 1 FROM public.projects AS projects
    WHERE projects.id = private.waiver_source_path_project_id(p_object_path)
      AND projects.waiver_pdf_storage_path IS NULL
      AND right(
        projects.waiver_pdf_url,
        length('/storage/v1/object/public/waiver-uploads/' || p_object_path)
      ) = '/storage/v1/object/public/waiver-uploads/' || p_object_path
  ) OR EXISTS (
    SELECT 1 FROM public.waiver_definitions AS definitions
    WHERE definitions.project_id =
        private.waiver_source_path_project_id(p_object_path)
      AND definitions.pdf_storage_path IS NULL
      AND right(
        definitions.pdf_public_url,
        length('/storage/v1/object/public/waiver-uploads/' || p_object_path)
      ) = '/storage/v1/object/public/waiver-uploads/' || p_object_path
  ) OR EXISTS (
    SELECT 1 FROM public.waiver_signatures AS signatures
    WHERE signatures.project_id =
        private.waiver_source_path_project_id(p_object_path)
      AND signatures.waiver_pdf_storage_path IS NULL
      AND right(
        signatures.waiver_pdf_url,
        length('/storage/v1/object/public/waiver-uploads/' || p_object_path)
      ) = '/storage/v1/object/public/waiver-uploads/' || p_object_path
  );
$$;

REVOKE ALL ON FUNCTION private.waiver_source_path_is_referenced(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.waiver_source_path_is_referenced(text)
  TO service_role;

COMMENT ON FUNCTION private.waiver_source_path_is_referenced(text) IS
  'True when a waiver-uploads object is still named by a project, definition, or signature, by Storage path or by a legacy public URL under the same project prefix.';

-- Holds a source object in place until the caller commits. A concurrent
-- overwrite or delete waits on this lock and then sees the new reference.
CREATE OR REPLACE FUNCTION private.lock_waiver_source_object(
  p_object_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NULLIF(BTRIM(COALESCE(p_object_path, '')), '') IS NULL THEN
    RETURN false;
  END IF;

  IF to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'storage object catalog is unavailable'
      USING ERRCODE = '42P01';
  END IF;

  PERFORM 1
  FROM storage.objects AS objects
  WHERE objects.bucket_id = 'waiver-uploads'
    AND objects.name = p_object_path
  FOR SHARE;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION private.lock_waiver_source_object(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.lock_waiver_source_object(text)
  TO service_role;

COMMENT ON FUNCTION private.lock_waiver_source_object(text) IS
  'Service-only share lock on one waiver source object; returns false when the object does not exist and raises when the Storage catalog is unavailable.';

-- ---------------------------------------------------------------------------
-- Source bytes are immutable while referenced
-- ---------------------------------------------------------------------------
--
-- Storage replaces an object by rewriting its row (new version, new metadata),
-- moves it by rewriting name or bucket, and deletes it by deleting the row. All
-- three are refused for a referenced source. A write that changes nothing but
-- the access and update timestamps is not a content change and passes. The
-- comparison is on every ordinary column, so it does not depend on which
-- columns this Storage version has and a column added later is fenced by
-- default.
--
-- Generated columns are left out of the comparison. PostgreSQL computes them
-- after BEFORE triggers, so NEW carries no value for them here while OLD does,
-- and comparing them would report a change on every write. They are derived
-- from the ordinary columns, which are all compared. Their names are read from
-- the catalog for the table the trigger fired on, not listed here.
CREATE OR REPLACE FUNCTION private.protect_referenced_waiver_source_object()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uncompared_columns text[];
BEGIN
  IF OLD.bucket_id IS DISTINCT FROM 'waiver-uploads' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT ARRAY['last_accessed_at', 'updated_at']::text[]
      || COALESCE(array_agg(attributes.attname::text), ARRAY[]::text[])
    INTO v_uncompared_columns
    FROM pg_catalog.pg_attribute AS attributes
    WHERE attributes.attrelid = TG_RELID
      AND attributes.attnum > 0
      AND NOT attributes.attisdropped
      AND attributes.attgenerated <> '';

    IF (to_jsonb(NEW) - v_uncompared_columns)
      IS NOT DISTINCT FROM
        (to_jsonb(OLD) - v_uncompared_columns)
    THEN
      RETURN NEW;
    END IF;
  END IF;

  IF private.waiver_source_path_is_referenced(OLD.name) THEN
    RAISE EXCEPTION 'a referenced waiver source document cannot be changed or deleted'
      USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_referenced_waiver_source_object()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.protect_referenced_waiver_source_object()
  TO postgres;

COMMENT ON FUNCTION private.protect_referenced_waiver_source_object() IS
  'Refuses overwriting, moving, or deleting a waiver source object that a project, definition, or signature still names.';

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage.objects is unavailable; waiver source object protection was not installed';
    RETURN;
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS waiver_source_object_immutable ON storage.objects';
  EXECUTE $trigger$
    CREATE TRIGGER waiver_source_object_immutable
    BEFORE UPDATE OR DELETE ON storage.objects
    FOR EACH ROW
    WHEN (OLD.bucket_id = 'waiver-uploads')
    EXECUTE FUNCTION private.protect_referenced_waiver_source_object()
  $trigger$;
END $$;

-- ---------------------------------------------------------------------------
-- A detached or replaced source is queued in the same transaction
-- ---------------------------------------------------------------------------
--
-- An object can no longer be deleted while its project names it, so the
-- project is detached first and the object cleaned up afterwards. Queueing
-- the old object in the transaction that detaches it means a crash between
-- the two can never leave an unreferenced PDF with no cleanup record. Only an
-- object nothing else names is queued, and the existing drain rechecks every
-- reference again before it deletes anything.
CREATE OR REPLACE FUNCTION private.queue_detached_waiver_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.waiver_pdf_storage_path IS NOT NULL
    AND OLD.waiver_pdf_storage_path
      IS DISTINCT FROM NEW.waiver_pdf_storage_path
  THEN
    PERFORM public.enqueue_superseded_waiver_source(
      OLD.waiver_pdf_storage_path
    );
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.queue_detached_waiver_source()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.queue_detached_waiver_source()
  TO service_role;

COMMENT ON FUNCTION private.queue_detached_waiver_source() IS
  'Queues a waiver source object for reference-rechecked cleanup in the transaction that detaches or replaces it on its project.';

DROP TRIGGER IF EXISTS queue_detached_waiver_source ON public.projects;
CREATE TRIGGER queue_detached_waiver_source
AFTER UPDATE OF waiver_pdf_storage_path ON public.projects
FOR EACH ROW
EXECUTE FUNCTION private.queue_detached_waiver_source();

-- ---------------------------------------------------------------------------
-- Definitions: pinned to their source, frozen once saved
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.pin_waiver_definition_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- The object is locked when it exists. Whether it must exist is decided by
  -- the checked save and by publication, not here.
  IF NEW.pdf_storage_path IS NOT NULL
    AND to_regclass('storage.objects') IS NOT NULL
  THEN
    PERFORM private.lock_waiver_source_object(NEW.pdf_storage_path);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.pin_waiver_definition_source()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.pin_waiver_definition_source()
  TO service_role;

DROP TRIGGER IF EXISTS pin_waiver_definition_source
  ON public.waiver_definitions;
CREATE TRIGGER pin_waiver_definition_source
BEFORE INSERT ON public.waiver_definitions
FOR EACH ROW
EXECUTE FUNCTION private.pin_waiver_definition_source();

-- Every edit already writes a new version row. Only the version bookkeeping
-- (active, updated_at) and the creator link, which an account deletion
-- clears, may change on an existing row. The comparison is on the whole row,
-- so a column added later is frozen by default.
CREATE OR REPLACE FUNCTION private.freeze_waiver_definition_rendering_inputs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'active'::text - 'updated_at'::text - 'created_by'::text)
    IS DISTINCT FROM
      (to_jsonb(OLD) - 'active'::text - 'updated_at'::text - 'created_by'::text)
  THEN
    RAISE EXCEPTION 'saved waiver definitions are immutable'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.freeze_waiver_definition_rendering_inputs()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.freeze_waiver_definition_rendering_inputs()
  TO service_role;

-- Named to fire after prevent_referenced_waiver_definition_mutation, so a
-- referenced definition keeps reporting its existing, stricter message.
DROP TRIGGER IF EXISTS waiver_definition_rendering_inputs_frozen
  ON public.waiver_definitions;
CREATE TRIGGER waiver_definition_rendering_inputs_frozen
BEFORE UPDATE ON public.waiver_definitions
FOR EACH ROW
EXECUTE FUNCTION private.freeze_waiver_definition_rendering_inputs();

-- ---------------------------------------------------------------------------
-- Definition save: compare-and-set against the validated snapshot
-- ---------------------------------------------------------------------------
--
-- The server reads the project, downloads the source PDF, and validates the
-- placements against its bytes. This wrapper then proves, under the project
-- row lock, that the project still names that same source and definition
-- before the existing version RPC runs. The existing RPC keeps its signature
-- and behavior and takes the same lock again inside this transaction.
CREATE OR REPLACE FUNCTION public.save_project_waiver_definition_version_checked(
  p_project_id uuid,
  p_actor_id uuid,
  p_title text,
  p_signers jsonb,
  p_fields jsonb,
  p_expected_storage_path text,
  p_expected_public_url text,
  p_expected_definition_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project record;
  v_definition_path text;
  v_source_path text;
BEGIN
  SELECT
    projects.waiver_pdf_storage_path,
    projects.waiver_pdf_url,
    projects.waiver_definition_id
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_project.waiver_pdf_storage_path IS DISTINCT FROM p_expected_storage_path
    OR v_project.waiver_pdf_url IS DISTINCT FROM p_expected_public_url
    OR v_project.waiver_definition_id IS DISTINCT FROM p_expected_definition_id
  THEN
    RAISE EXCEPTION 'the waiver source or definition changed during the save'
      USING ERRCODE = '40001';
  END IF;

  -- The version RPC falls back to the current definition's source for a
  -- project row with no path. That definition is frozen, its id was just
  -- compared, and it is held in place until commit, so this is the same
  -- object the server validated.
  IF v_project.waiver_definition_id IS NOT NULL THEN
    SELECT definitions.pdf_storage_path
    INTO v_definition_path
    FROM public.waiver_definitions AS definitions
    WHERE definitions.id = v_project.waiver_definition_id
      AND definitions.project_id = p_project_id
    FOR KEY SHARE;
  END IF;
  v_source_path :=
    COALESCE(v_project.waiver_pdf_storage_path, v_definition_path);

  -- The validated object must still exist, and stays put until commit.
  IF v_source_path IS NOT NULL
    AND NOT private.lock_waiver_source_object(v_source_path)
  THEN
    RAISE EXCEPTION 'the waiver source or definition changed during the save'
      USING ERRCODE = '40001';
  END IF;

  RETURN public.save_project_waiver_definition_version(
    p_project_id,
    p_actor_id,
    p_title,
    p_signers,
    p_fields
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_project_waiver_definition_version_checked(
  uuid, uuid, text, jsonb, jsonb, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_project_waiver_definition_version_checked(
  uuid, uuid, text, jsonb, jsonb, text, text, uuid
) TO service_role;

COMMENT ON FUNCTION public.save_project_waiver_definition_version_checked(
  uuid, uuid, text, jsonb, jsonb, text, text, uuid
) IS 'Service-only definition save that refuses with 40001 unless the project still names the source and definition the server validated.';

-- ---------------------------------------------------------------------------
-- New evidence never binds a source or definition the project has left
-- ---------------------------------------------------------------------------
--
-- The server prepares evidence before the signup transaction runs, and every
-- record it prepares carries the project's current definition and source. If
-- the definition was re-saved or the source replaced in between, the insert
-- is refused and the whole signup transaction rolls back.
--
-- The comparison is null-safe in both directions. Evidence with no
-- definition is stale on a project that has one, evidence with no source
-- snapshot is stale on a project that has a source, and the reverse of each
-- is stale too. A snapshot whose object does not exist is refused: a missing
-- object proves nothing. A full signed copy uploaded by the volunteer needs
-- no placement, but it carries the same snapshot and is held to the same
-- rule. Only inserts are fenced. Existing rows are never revisited.
CREATE OR REPLACE FUNCTION private.reject_stale_waiver_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project record;
  v_definition_path text;
  v_current_path text;
  v_object_path text;
  c_public_prefix CONSTANT text :=
    '/storage/v1/object/public/waiver-uploads/';
BEGIN
  SELECT
    projects.waiver_definition_id,
    projects.waiver_pdf_storage_path,
    projects.waiver_pdf_url
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = NEW.project_id
  FOR SHARE;

  -- A missing project is reported by the foreign key.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- So is a definition that belongs to another project.
  IF NEW.waiver_definition_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.waiver_definitions AS definitions
    WHERE definitions.id = NEW.waiver_definition_id
      AND definitions.project_id = NEW.project_id
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.waiver_definition_id
    IS DISTINCT FROM v_project.waiver_definition_id
  THEN
    RAISE EXCEPTION 'waiver evidence names a superseded waiver definition'
      USING ERRCODE = '23514';
  END IF;

  -- The current definition stays in place until commit.
  IF v_project.waiver_definition_id IS NOT NULL THEN
    SELECT definitions.pdf_storage_path
    INTO v_definition_path
    FROM public.waiver_definitions AS definitions
    WHERE definitions.id = v_project.waiver_definition_id
      AND definitions.project_id = NEW.project_id
    FOR KEY SHARE;
  END IF;

  -- The project's current source. A project row that predates paths takes
  -- the path of its current definition, but only when the project's own
  -- public URL names that same object. A URL that names anything else is a
  -- mismatch, not a match.
  v_current_path := v_project.waiver_pdf_storage_path;
  IF v_current_path IS NULL
    AND v_definition_path IS NOT NULL
    AND right(
      v_project.waiver_pdf_url,
      length(c_public_prefix || v_definition_path)
    ) = c_public_prefix || v_definition_path
  THEN
    v_current_path := v_definition_path;
  END IF;

  IF NEW.waiver_pdf_storage_path IS DISTINCT FROM v_current_path THEN
    RAISE EXCEPTION 'waiver evidence names a superseded waiver source document'
      USING ERRCODE = '23514';
  END IF;

  IF v_current_path IS NULL
    AND NEW.waiver_pdf_url IS DISTINCT FROM v_project.waiver_pdf_url
  THEN
    RAISE EXCEPTION 'waiver evidence names a superseded waiver source document'
      USING ERRCODE = '23514';
  END IF;

  -- A snapshot is only provenance if its object exists. It is locked, so it
  -- stays put until commit. A legacy public URL names its object after the
  -- bucket prefix.
  v_object_path := NEW.waiver_pdf_storage_path;
  IF v_object_path IS NULL
    AND position(c_public_prefix IN COALESCE(NEW.waiver_pdf_url, '')) > 0
  THEN
    v_object_path := substring(
      NEW.waiver_pdf_url
      FROM position(c_public_prefix IN NEW.waiver_pdf_url)
        + length(c_public_prefix)
    );
  END IF;

  IF v_object_path IS NOT NULL
    AND NOT private.lock_waiver_source_object(v_object_path)
  THEN
    RAISE EXCEPTION 'waiver evidence names a waiver source document that does not exist'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_stale_waiver_evidence()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.reject_stale_waiver_evidence()
  TO service_role;

COMMENT ON FUNCTION private.reject_stale_waiver_evidence() IS
  'Refuses new waiver evidence that names a definition or source document the project no longer uses.';

DROP TRIGGER IF EXISTS reject_stale_waiver_evidence
  ON public.waiver_signatures;
CREATE TRIGGER reject_stale_waiver_evidence
BEFORE INSERT ON public.waiver_signatures
FOR EACH ROW
EXECUTE FUNCTION private.reject_stale_waiver_evidence();

-- ---------------------------------------------------------------------------
-- Guest confirmation promotes exactly what the server checked
-- ---------------------------------------------------------------------------
--
-- The server proves the signed waiver of every pending signup and passes three
-- sets here: the pending signups it saw, the ones whose project required a
-- waiver, and the evidence rows it judged. All three are compared with the
-- current rows under locks taken in one order: the guest profile, which every
-- guest signup insert also takes first; the slot advisory locks, in the
-- capacity routine's own order; a share lock on each affected project; the
-- pending signup rows; and the evidence rows. Any difference returns
-- 'pending_signups_changed' and changes nothing. So a signup added after the
-- check, a waiver requirement switched on after the check, and evidence that
-- appeared, disappeared, or was replaced after the check are never promoted
-- unchecked, and none of those can happen between the comparison and the
-- commit. The evidence's own source may differ from the project's current
-- one: it was judged against the document it was signed on. A match hands
-- over to the existing capacity routine in the same transaction, which keeps
-- its all-or-nothing promotion and idempotency.
CREATE OR REPLACE FUNCTION private.sorted_distinct_uuids(p_ids uuid[])
RETURNS uuid[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(ids.id ORDER BY ids.id), ARRAY[]::uuid[])
  FROM (
    SELECT DISTINCT candidate.id
    FROM unnest(p_ids) AS candidate(id)
    WHERE candidate.id IS NOT NULL
  ) AS ids;
$$;

REVOKE ALL ON FUNCTION private.sorted_distinct_uuids(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sorted_distinct_uuids(uuid[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_anonymous_signup_with_capacity_checked(
  p_anonymous_id uuid,
  p_checked_signup_ids uuid[],
  p_checked_waiver_signup_ids uuid[],
  p_checked_signature_ids uuid[]
)
RETURNS TABLE (
  outcome text,
  approved_count integer,
  blocked_project_id uuid,
  blocked_schedule_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_slot record;
  v_pending uuid[];
  v_waiver_pending uuid[];
  v_signatures uuid[];
BEGIN
  outcome := NULL;
  approved_count := 0;
  blocked_project_id := NULL;
  blocked_schedule_id := NULL;

  IF p_anonymous_id IS NULL
    OR p_checked_signup_ids IS NULL
    OR p_checked_waiver_signup_ids IS NULL
    OR p_checked_signature_ids IS NULL
  THEN
    outcome := 'invalid_input';
    RETURN NEXT;
    RETURN;
  END IF;

  PERFORM 1
  FROM public.anonymous_signups AS anonymous
  WHERE anonymous.id = p_anonymous_id
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  -- The same slot locks, in the same order, the capacity routine takes. They
  -- are held before any project row, as every signup insert holds them.
  FOR v_slot IN
    SELECT signups.project_id, signups.schedule_id
    FROM public.project_signups AS signups
    WHERE signups.anonymous_id = p_anonymous_id
      AND signups.status = 'pending'
    GROUP BY signups.project_id, signups.schedule_id
    ORDER BY signups.project_id, signups.schedule_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'lets-assist-project-signup:'
          || v_slot.project_id::text
          || ':'
          || v_slot.schedule_id,
        0
      )
    );
  END LOOP;

  -- Holds each project's waiver requirement still until commit.
  PERFORM 1
  FROM public.projects AS projects
  WHERE projects.id IN (
    SELECT signups.project_id
    FROM public.project_signups AS signups
    WHERE signups.anonymous_id = p_anonymous_id
      AND signups.status = 'pending'
  )
  ORDER BY projects.id
  FOR SHARE;

  -- Holds the pending signups themselves. Evidence for one of them cannot be
  -- inserted while this lock is held, because its foreign key needs the row.
  PERFORM 1
  FROM public.project_signups AS signups
  WHERE signups.anonymous_id = p_anonymous_id
    AND signups.status = 'pending'
  ORDER BY signups.id
  FOR UPDATE;

  SELECT COALESCE(array_agg(signups.id ORDER BY signups.id), ARRAY[]::uuid[])
  INTO v_pending
  FROM public.project_signups AS signups
  WHERE signups.anonymous_id = p_anonymous_id
    AND signups.status = 'pending';

  SELECT COALESCE(array_agg(signups.id ORDER BY signups.id), ARRAY[]::uuid[])
  INTO v_waiver_pending
  FROM public.project_signups AS signups
  JOIN public.projects AS projects
    ON projects.id = signups.project_id
  WHERE signups.id = ANY (v_pending)
    AND COALESCE(projects.waiver_required, false);

  -- Holds the evidence rows. Their content is already immutable, and this
  -- keeps them from being deleted or replaced before the promotion commits.
  PERFORM 1
  FROM public.waiver_signatures AS signatures
  WHERE signatures.signup_id = ANY (v_waiver_pending)
  ORDER BY signatures.id
  FOR KEY SHARE;

  SELECT COALESCE(
    array_agg(signatures.id ORDER BY signatures.id),
    ARRAY[]::uuid[]
  )
  INTO v_signatures
  FROM public.waiver_signatures AS signatures
  JOIN public.project_signups AS signups
    ON signups.id = signatures.signup_id
   AND signups.project_id = signatures.project_id
  WHERE signups.id = ANY (v_waiver_pending);

  IF v_pending <> private.sorted_distinct_uuids(p_checked_signup_ids)
    OR v_waiver_pending
      <> private.sorted_distinct_uuids(p_checked_waiver_signup_ids)
    OR v_signatures <> private.sorted_distinct_uuids(p_checked_signature_ids)
  THEN
    outcome := 'pending_signups_changed';
    RETURN NEXT;
    RETURN;
  END IF;

  -- A waiver-required signup is never promoted without an evidence row.
  IF EXISTS (
    SELECT 1
    FROM public.project_signups AS signups
    WHERE signups.id = ANY (v_waiver_pending)
      AND NOT EXISTS (
        SELECT 1
        FROM public.waiver_signatures AS signatures
        WHERE signatures.signup_id = signups.id
          AND signatures.project_id = signups.project_id
      )
  ) THEN
    outcome := 'waiver_evidence_missing';
    RETURN NEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    confirmation.outcome,
    confirmation.approved_count,
    confirmation.blocked_project_id,
    confirmation.blocked_schedule_id
  FROM public.confirm_anonymous_signup_with_capacity(p_anonymous_id)
    AS confirmation;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_anonymous_signup_with_capacity_checked(
  uuid, uuid[], uuid[], uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_anonymous_signup_with_capacity_checked(
  uuid, uuid[], uuid[], uuid[]
) TO service_role;

COMMENT ON FUNCTION public.confirm_anonymous_signup_with_capacity_checked(
  uuid, uuid[], uuid[], uuid[]
) IS 'Service-only guest confirmation that promotes only when the pending signups, their waiver requirements, and their evidence rows are exactly what the server checked.';
