-- Project cover images and documents get recorded ownership, tracked references, and deletion claims.
--
-- A cloned project copies the source's cover image and document URLs. Deleting
-- either project used to remove the shared Storage objects by file name, so the
-- surviving project was left with broken links. This migration replaces file
-- names as deletion authority with three private records:
--
--   * project_asset_objects: one row per Storage object whose upload was proven
--     (canonical project_<uuid>_ name, uploaded by a current organizer of that
--     project). It outlives the owning project, so the last project that still
--     uses a shared object can release it later.
--   * project_asset_references: which projects link which objects, derived from
--     projects.cover_image_url and projects.documents by trigger.
--   * project_deletion_operations: one durable deletion per project identity.
--     Objects it may remove are claimed in the same transaction that creates it.
--
-- Locks are always taken in one order: the acting account's write lock, then
-- the project row, then one transaction-level advisory lock shared by every
-- write that could add a reference, add an object, or remove an object. A
-- claim and a new reference to the same object can therefore never both commit.
-- An object that is unregistered, or still linked from another project, is
-- never removed by project deletion.

BEGIN;

-- Held until this migration commits. Once the triggers below exist, every
-- concurrent asset write waits here, so the backfill at the end is complete.
SELECT pg_advisory_xact_lock(hashtextextended('lets-assist-project-assets', 0));

CREATE TABLE app_private.project_deletion_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No foreign key: the receipt outlives the project it removed, and a
  -- project identity that has an operation is never created again.
  project_id uuid NOT NULL UNIQUE,
  -- The actor most recently authorized to carry the deletion forward.
  actor_id uuid NOT NULL,
  phase text NOT NULL DEFAULT 'pending' CHECK (phase IN ('pending', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((phase = 'completed') = (completed_at IS NOT NULL))
);
ALTER TABLE app_private.project_deletion_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.project_deletion_operations FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE app_private.project_asset_objects (
  bucket_id text NOT NULL CHECK (bucket_id IN ('project-images', 'project-documents')),
  object_name text NOT NULL CHECK (length(object_name) <= 255),
  -- storage.objects.id when ownership was recorded. A later object under the
  -- same name is a different object and is never removed through this row.
  object_id uuid NOT NULL,
  -- Provenance, not a foreign key: it must survive the owning project.
  owner_project_id uuid NOT NULL,
  registered_by uuid,
  -- 'deleted' with a claim is permanent: the name is never used again.
  -- 'deleted' without one records an ordinary removal; the name may be
  -- uploaded again, but nothing can link it while the object is missing.
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'claimed', 'deleted')),
  claim_operation_id uuid REFERENCES app_private.project_deletion_operations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (bucket_id, object_name),
  CHECK (state <> 'active' OR claim_operation_id IS NULL),
  CHECK (state <> 'claimed' OR claim_operation_id IS NOT NULL),
  CHECK ((state = 'deleted') = (deleted_at IS NOT NULL))
);
ALTER TABLE app_private.project_asset_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.project_asset_objects FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX project_asset_objects_owner_idx
  ON app_private.project_asset_objects(owner_project_id);
CREATE INDEX project_asset_objects_claim_idx
  ON app_private.project_asset_objects(claim_operation_id)
  WHERE claim_operation_id IS NOT NULL;

CREATE TABLE app_private.project_asset_references (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  bucket_id text NOT NULL CHECK (bucket_id IN ('project-images', 'project-documents')),
  object_name text NOT NULL,
  PRIMARY KEY (project_id, bucket_id, object_name)
);
ALTER TABLE app_private.project_asset_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.project_asset_references FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX project_asset_references_object_idx
  ON app_private.project_asset_references(bucket_id, object_name);

-- The project a canonical object name was uploaded for, or NULL for any name
-- that is not exactly project_<uuid>_<safe characters>.
CREATE FUNCTION app_private.project_asset_name_project(p_name text)
RETURNS uuid LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN length(p_name) <= 255
      AND p_name ~ '^project_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}_[A-Za-z0-9._-]+$'
    THEN substr(p_name, 9, 36)::uuid
  END;
$$;
REVOKE ALL ON FUNCTION app_private.project_asset_name_project(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.project_asset_name_project(text) TO postgres;

-- The (bucket, object name) a stored URL links, or NULL. Only the exact public
-- object path of the two project buckets with a canonical name is recognized;
-- a query string or fragment is ignored. A recognized link only ever protects
-- an object from removal. It is never authority to remove one.
--
-- The bucket and the object name are each read as one path segment with one
-- layer of percent-encoding removed, because a client may encode any character
-- of a URL it stores ("%70roject%5F..." is the same object as "project_...").
-- Every character, written literally or as %XX, must be one a canonical name
-- can contain: A-Z, a-z, 0-9, dot, underscore, hyphen. An incomplete or
-- non-hexadecimal escape, an encoded slash, backslash, question mark, hash,
-- NUL or non-ASCII byte, and an encoded percent sign (so anything encoded
-- twice) all make the URL unrecognized. The decoded name is compared exactly,
-- including letter case.
CREATE FUNCTION app_private.project_asset_reference(p_url text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  parts text[];
  decoded text[] := ARRAY[]::text[];
  segment text;
  remainder text;
  piece text;
  code integer;
  plain text;
BEGIN
  IF p_url IS NULL OR length(p_url) > 2048 THEN
    RETURN NULL;
  END IF;
  parts := regexp_match(
    p_url,
    '^https?://[^/?#]+/storage/v1/object/public/([^/?#]+)/([^/?#]+)(?:[?#].*)?$'
  );
  IF parts IS NULL THEN
    RETURN NULL;
  END IF;

  FOREACH segment IN ARRAY parts LOOP
    plain := '';
    remainder := segment;
    WHILE length(remainder) > 0 LOOP
      IF left(remainder, 1) = '%' THEN
        IF left(remainder, 3) !~ '^%[0-9a-fA-F]{2}$' THEN
          RETURN NULL;
        END IF;
        code := get_byte(decode(substr(remainder, 2, 2), 'hex'), 0);
        -- Every canonical character lies between '-' (45) and 'z' (122).
        IF code < 45 OR code > 122 THEN
          RETURN NULL;
        END IF;
        piece := chr(code);
        remainder := substr(remainder, 4);
      ELSE
        piece := left(remainder, 1);
        remainder := substr(remainder, 2);
      END IF;
      IF piece !~ '^[A-Za-z0-9._-]$' THEN
        RETURN NULL;
      END IF;
      plain := plain || piece;
    END LOOP;
    decoded := decoded || plain;
  END LOOP;

  IF decoded[1] NOT IN ('project-images', 'project-documents')
    OR app_private.project_asset_name_project(decoded[2]) IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN decoded;
END;
$$;
REVOKE ALL ON FUNCTION app_private.project_asset_reference(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.project_asset_reference(text) TO postgres;

CREATE FUNCTION app_private.project_asset_references_of(p_cover_image_url text, p_documents jsonb)
RETURNS TABLE (bucket_id text, object_name text)
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT DISTINCT linked.reference[1], linked.reference[2]
  FROM (
    SELECT app_private.project_asset_reference(p_cover_image_url) AS reference
    UNION ALL
    SELECT app_private.project_asset_reference(document.value->>'url')
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_documents) = 'array' THEN p_documents ELSE '[]'::jsonb END
    ) AS document(value)
    WHERE jsonb_typeof(document.value) = 'object'
  ) AS linked
  WHERE linked.reference IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION app_private.project_asset_references_of(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.project_asset_references_of(text, jsonb) TO postgres;

-- Keeps project_asset_references equal to what a project row links, refuses a
-- link to an object that is claimed or missing, and refuses a new project row
-- under an identity that already has a deletion operation.
CREATE FUNCTION app_private.track_project_asset_references()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A pending operation implies the row still exists, so this insert has
    -- already failed on the primary key. A completing deletion holds the old
    -- row's index entry until it commits, so this statement only runs after
    -- that commit and sees the completed operation. No further lock is needed.
    IF EXISTS (
      SELECT 1 FROM app_private.project_deletion_operations AS operation
      WHERE operation.project_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'project_identity_retired' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM app_private.project_asset_references_of(NEW.cover_image_url, to_jsonb(NEW.documents))
    ) THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.cover_image_url IS NOT DISTINCT FROM OLD.cover_image_url
    AND to_jsonb(NEW.documents) IS NOT DISTINCT FROM to_jsonb(OLD.documents) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-project-assets', 0));

  IF EXISTS (
    SELECT 1 FROM app_private.project_deletion_operations AS operation
    WHERE operation.project_id = NEW.id AND operation.phase = 'pending'
  ) THEN
    RAISE EXCEPTION 'project_deletion_in_progress' USING ERRCODE = '23514';
  END IF;

  -- Only a newly added link is checked, so a project can still clear a link
  -- to a file that has since been removed.
  IF EXISTS (
    SELECT 1
    FROM app_private.project_asset_references_of(NEW.cover_image_url, to_jsonb(NEW.documents)) AS linked
    JOIN app_private.project_asset_objects AS asset
      ON asset.bucket_id = linked.bucket_id AND asset.object_name = linked.object_name
    WHERE asset.state <> 'active'
      AND NOT EXISTS (
        SELECT 1 FROM app_private.project_asset_references AS existing
        WHERE existing.project_id = NEW.id
          AND existing.bucket_id = linked.bucket_id
          AND existing.object_name = linked.object_name
      )
  ) THEN
    RAISE EXCEPTION 'project_asset_unavailable' USING ERRCODE = '23514';
  END IF;

  DELETE FROM app_private.project_asset_references AS existing
  WHERE existing.project_id = NEW.id
    AND NOT EXISTS (
      SELECT 1
      FROM app_private.project_asset_references_of(NEW.cover_image_url, to_jsonb(NEW.documents)) AS linked
      WHERE linked.bucket_id = existing.bucket_id AND linked.object_name = existing.object_name
    );
  INSERT INTO app_private.project_asset_references(project_id, bucket_id, object_name)
  SELECT NEW.id, linked.bucket_id, linked.object_name
  FROM app_private.project_asset_references_of(NEW.cover_image_url, to_jsonb(NEW.documents)) AS linked
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.track_project_asset_references() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.track_project_asset_references() TO postgres;

CREATE TRIGGER project_asset_references_insert
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION app_private.track_project_asset_references();
CREATE TRIGGER project_asset_references_update
  AFTER UPDATE OF cover_image_url, documents ON public.projects
  FOR EACH ROW EXECUTE FUNCTION app_private.track_project_asset_references();

-- Refuses a new object, a move, or an overwrite that would defeat a claim:
-- a name a deletion claimed is never reused, a registered object is never
-- moved, and a project that is being deleted accepts no more uploads.
CREATE FUNCTION app_private.fence_project_asset_object_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_state text;
  v_claim uuid;
  v_registered boolean := false;
  v_same_key boolean := false;
  v_project uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_same_key := NEW.bucket_id IS NOT DISTINCT FROM OLD.bucket_id
      AND NEW.name IS NOT DISTINCT FROM OLD.name;
    -- Access-time bookkeeping is not a change to the object.
    IF v_same_key
      AND (to_jsonb(NEW) - 'last_accessed_at' - 'updated_at')
        IS NOT DISTINCT FROM (to_jsonb(OLD) - 'last_accessed_at' - 'updated_at') THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-project-assets', 0));

  IF TG_OP = 'UPDATE' THEN
    SELECT asset.state INTO v_state
    FROM app_private.project_asset_objects AS asset
    WHERE asset.bucket_id = OLD.bucket_id AND asset.object_name = OLD.name;
    v_registered := FOUND;
    IF v_registered AND (
      v_state <> 'active' OR NOT v_same_key OR NEW.id IS DISTINCT FROM OLD.id
    ) THEN
      RAISE EXCEPTION 'project_asset_object_locked' USING ERRCODE = '23514';
    END IF;
    IF v_same_key THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.bucket_id IN ('project-images', 'project-documents') THEN
    SELECT asset.state, asset.claim_operation_id INTO v_state, v_claim
    FROM app_private.project_asset_objects AS asset
    WHERE asset.bucket_id = NEW.bucket_id AND asset.object_name = NEW.name;
    -- An ordinary removal (no claim) leaves the name free to upload again.
    IF FOUND AND (v_state = 'claimed' OR (v_state = 'deleted' AND v_claim IS NOT NULL)) THEN
      RAISE EXCEPTION 'project_asset_object_retired' USING ERRCODE = '23514';
    END IF;
    v_project := app_private.project_asset_name_project(NEW.name);
    IF v_project IS NOT NULL AND EXISTS (
      SELECT 1 FROM app_private.project_deletion_operations AS operation
      WHERE operation.project_id = v_project AND operation.phase = 'pending'
    ) THEN
      RAISE EXCEPTION 'project_deletion_in_progress' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.fence_project_asset_object_write() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.fence_project_asset_object_write() TO postgres;

CREATE TRIGGER project_asset_object_insert_fence
  BEFORE INSERT ON storage.objects
  FOR EACH ROW
  WHEN (NEW.bucket_id IN ('project-images', 'project-documents'))
  EXECUTE FUNCTION app_private.fence_project_asset_object_write();
CREATE TRIGGER project_asset_object_update_fence
  BEFORE UPDATE ON storage.objects
  FOR EACH ROW
  WHEN (
    OLD.bucket_id IN ('project-images', 'project-documents')
    OR NEW.bucket_id IN ('project-images', 'project-documents')
  )
  EXECUTE FUNCTION app_private.fence_project_asset_object_write();

-- Records ownership of a new object only when the upload itself proves it: the
-- Storage owner is the signed-in actor, and that actor is a current organizer
-- of the project the canonical name belongs to. A service upload, or any name
-- outside the canonical form, is left unregistered and is therefore retained.
CREATE FUNCTION app_private.register_project_asset_object()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_project uuid;
  v_owner_text text;
  v_owner uuid;
BEGIN
  v_project := app_private.project_asset_name_project(NEW.name);
  IF v_project IS NULL THEN
    RETURN NULL;
  END IF;

  v_owner_text := coalesce(to_jsonb(NEW)->>'owner_id', to_jsonb(NEW)->>'owner');
  IF v_owner_text IS NULL
    OR v_owner_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN NULL;
  END IF;
  v_owner := v_owner_text::uuid;

  IF v_owner IS DISTINCT FROM (SELECT auth.uid())
    OR NOT app_private.is_project_organizer(v_project, v_owner) THEN
    RETURN NULL;
  END IF;

  -- A proven upload under a name an ordinary removal freed makes the record
  -- active again for the new object.
  INSERT INTO app_private.project_asset_objects AS asset (
    bucket_id, object_name, object_id, owner_project_id, registered_by
  )
  VALUES (NEW.bucket_id, NEW.name, NEW.id, v_project, v_owner)
  ON CONFLICT (bucket_id, object_name) DO UPDATE
    SET object_id = EXCLUDED.object_id,
        registered_by = EXCLUDED.registered_by,
        state = 'active',
        deleted_at = NULL
    WHERE asset.state = 'active'
      OR (asset.state = 'deleted' AND asset.claim_operation_id IS NULL);

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_private.register_project_asset_object() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.register_project_asset_object() TO postgres;

CREATE TRIGGER project_asset_object_register
  AFTER INSERT ON storage.objects
  FOR EACH ROW
  WHEN (NEW.bucket_id IN ('project-images', 'project-documents'))
  EXECUTE FUNCTION app_private.register_project_asset_object();

-- Why the actor may not delete the project now, or NULL when they may. Only
-- the creator or an active administrator of its organization may delete, and
-- a project with signed waivers is retained. A missing project is 'forbidden'.
CREATE FUNCTION app_private.project_deletion_refusal(p_project_id uuid, p_actor_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id = p_project_id
        AND (
          project.creator_id = p_actor_id
          OR EXISTS (
            SELECT 1 FROM public.organization_members AS member
            WHERE member.organization_id = project.organization_id
              AND member.user_id = p_actor_id
              AND member.role = 'admin'
              AND member.status = 'active'
          )
        )
    ) THEN 'forbidden'
    WHEN EXISTS (
      SELECT 1 FROM public.waiver_signatures AS signature
      WHERE signature.project_id = p_project_id
    ) THEN 'signed_waivers'
  END;
$$;
REVOKE ALL ON FUNCTION app_private.project_deletion_refusal(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.project_deletion_refusal(uuid, uuid) TO postgres;

-- Guards every removal from the two project buckets, whoever asks for it.
--
-- An object linked from a project other than the one its name belongs to is
-- kept, unless that one project is being deleted and holds the claim. A
-- claimed object may only be removed as the exact object that was claimed,
-- and only while the actor carrying the deletion is still allowed to delete
-- the project: a revoked administrator, a deactivated account, a newly signed
-- waiver, or a missing project all stop the removal here.
--
-- A registered object removed outside a claim leaves a record that it is
-- gone, so a copy of the project made from stale data cannot link it.
CREATE FUNCTION app_private.guard_project_asset_object_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_asset app_private.project_asset_objects;
  v_registered boolean;
  v_name_project uuid;
  v_seen_operation uuid;
  v_seen_project uuid;
  v_seen_actor uuid;
  v_claim_project uuid;
  v_claim_actor uuid;
BEGIN
  v_name_project := app_private.project_asset_name_project(OLD.name);

  -- Read the claim once without a lock, only to learn which account and
  -- project locks precede the asset lock. It is checked again under the lock.
  SELECT operation.id, operation.project_id, operation.actor_id
  INTO v_seen_operation, v_seen_project, v_seen_actor
  FROM app_private.project_asset_objects AS asset
  JOIN app_private.project_deletion_operations AS operation
    ON operation.id = asset.claim_operation_id
  WHERE asset.bucket_id = OLD.bucket_id
    AND asset.object_name = OLD.name
    AND asset.state = 'claimed'
    AND operation.phase = 'pending';
  IF FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || v_seen_actor::text, 0));
    PERFORM 1 FROM public.projects AS project WHERE project.id = v_seen_project FOR SHARE;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-project-assets', 0));

  SELECT * INTO v_asset
  FROM app_private.project_asset_objects AS asset
  WHERE asset.bucket_id = OLD.bucket_id AND asset.object_name = OLD.name
  FOR UPDATE;
  v_registered := FOUND;

  IF v_registered AND v_asset.state = 'claimed' THEN
    SELECT operation.project_id, operation.actor_id
    INTO v_claim_project, v_claim_actor
    FROM app_private.project_deletion_operations AS operation
    WHERE operation.id = v_asset.claim_operation_id AND operation.phase = 'pending';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'project_asset_claim_invalid' USING ERRCODE = '23514';
    END IF;
    -- The claim or its actor changed after the unlocked read, so the locks
    -- held are not the ones this claim needs. The caller retries.
    IF v_asset.claim_operation_id IS DISTINCT FROM v_seen_operation
      OR v_claim_actor IS DISTINCT FROM v_seen_actor THEN
      RAISE EXCEPTION 'project_asset_claim_changed' USING ERRCODE = '40001';
    END IF;
    IF v_asset.object_id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'project_asset_object_replaced' USING ERRCODE = '23514';
    END IF;
    IF NOT app_private.account_deletion_actor_is_active(v_claim_actor)
      OR app_private.project_deletion_refusal(v_claim_project, v_claim_actor) IS NOT NULL THEN
      RAISE EXCEPTION 'project_deletion_not_authorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM app_private.project_asset_references AS reference
    WHERE reference.bucket_id = OLD.bucket_id
      AND reference.object_name = OLD.name
      AND reference.project_id IS DISTINCT FROM v_name_project
      AND reference.project_id IS DISTINCT FROM v_claim_project
  ) THEN
    RAISE EXCEPTION 'project_asset_referenced' USING ERRCODE = '23503';
  END IF;

  IF v_registered AND v_asset.state = 'claimed' THEN
    UPDATE app_private.project_asset_objects AS asset
    SET state = 'deleted', deleted_at = now()
    WHERE asset.bucket_id = OLD.bucket_id AND asset.object_name = OLD.name;
  ELSIF v_registered AND v_asset.state = 'active' AND v_asset.object_id = OLD.id THEN
    UPDATE app_private.project_asset_objects AS asset
    SET state = 'deleted', deleted_at = now()
    WHERE asset.bucket_id = OLD.bucket_id AND asset.object_name = OLD.name;
  END IF;

  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION app_private.guard_project_asset_object_delete() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.guard_project_asset_object_delete() TO postgres;

CREATE TRIGGER project_asset_object_delete_guard
  BEFORE DELETE ON storage.objects
  FOR EACH ROW
  WHEN (OLD.bucket_id IN ('project-images', 'project-documents'))
  EXECUTE FUNCTION app_private.guard_project_asset_object_delete();

-- A project that is being deleted accepts no new signed waivers.
--
-- The project row is the lock. Signup already holds it FOR SHARE before it
-- writes a signature, and prepare and finalize hold it FOR UPDATE, so the two
-- are decided one after the other in whichever order they reach the row. The
-- check below runs after any wait and therefore sees a committed operation.
CREATE FUNCTION app_private.fence_deleting_project_waiver_signature()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.projects AS project
  WHERE project.id = NEW.project_id
  FOR KEY SHARE;
  IF EXISTS (
    SELECT 1 FROM app_private.project_deletion_operations AS operation
    WHERE operation.project_id = NEW.project_id AND operation.phase = 'pending'
  ) THEN
    RAISE EXCEPTION 'project_deletion_in_progress' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.fence_deleting_project_waiver_signature() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.fence_deleting_project_waiver_signature() TO postgres;

CREATE TRIGGER waiver_signature_project_deletion_fence
  BEFORE INSERT ON public.waiver_signatures
  FOR EACH ROW EXECUTE FUNCTION app_private.fence_deleting_project_waiver_signature();

-- The registered objects deleting this project may remove.
--
-- Its own uploads always qualify. An object uploaded for another project
-- qualifies only when that project was deleted through this reviewed path (a
-- completed operation records the authorized intent) and this project links
-- it. If the owning project disappeared any other way, the object is kept for
-- reconciliation: a link alone never authorizes a removal. In every case an
-- object that any other project still links is not a candidate.
CREATE FUNCTION app_private.project_deletion_candidates(p_project_id uuid)
RETURNS TABLE (bucket_id text, object_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT asset.bucket_id, asset.object_name
  FROM app_private.project_asset_objects AS asset
  WHERE asset.state = 'active'
    AND (
      asset.owner_project_id = p_project_id
      OR (
        EXISTS (
          SELECT 1 FROM app_private.project_asset_references AS own
          WHERE own.project_id = p_project_id
            AND own.bucket_id = asset.bucket_id
            AND own.object_name = asset.object_name
        )
        AND EXISTS (
          SELECT 1 FROM app_private.project_deletion_operations AS released
          WHERE released.project_id = asset.owner_project_id
            AND released.phase = 'completed'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.projects AS owner
          WHERE owner.id = asset.owner_project_id
        )
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM app_private.project_asset_references AS other
      WHERE other.bucket_id = asset.bucket_id
        AND other.object_name = asset.object_name
        AND other.project_id <> p_project_id
    );
$$;
REVOKE ALL ON FUNCTION app_private.project_deletion_candidates(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.project_deletion_candidates(uuid) TO postgres;

-- Starts or resumes the one deletion of a project and returns the exact
-- objects it claims. Nothing is removed here. When the project is already
-- gone, the actor who completed its deletion gets that receipt back, so a
-- lost response can be confirmed; nobody else learns anything.
--
-- With p_replay_only the call is strictly a read. It returns that same
-- completed receipt when one exists for this actor and the project row is
-- absent, and 'project_not_found' in every other case. It takes no lock,
-- creates or updates no operation, and claims nothing, so it is safe to call
-- when the caller only believes the project is gone.
CREATE FUNCTION public.prepare_project_deletion(
  p_project_id uuid, p_actor_id uuid, p_replay_only boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_operation app_private.project_deletion_operations;
  v_refusal text;
  v_candidates integer;
  v_resumed boolean := false;
BEGIN
  IF p_project_id IS NULL OR p_actor_id IS NULL OR p_replay_only IS NULL THEN
    RAISE EXCEPTION 'Invalid project deletion scope.' USING ERRCODE = '22023';
  END IF;

  IF p_replay_only THEN
    SELECT * INTO v_operation
    FROM app_private.project_deletion_operations AS operation
    WHERE operation.project_id = p_project_id
      AND operation.phase = 'completed'
      AND operation.actor_id = p_actor_id
      AND NOT EXISTS (
        SELECT 1 FROM public.projects AS project WHERE project.id = p_project_id
      );
    IF FOUND THEN
      RETURN jsonb_build_object(
        'outcome', 'completed',
        'operationId', v_operation.id,
        'projectId', v_operation.project_id,
        'phase', 'completed',
        'replayed', true
      );
    END IF;
    RETURN jsonb_build_object('outcome', 'project_not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || p_actor_id::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(p_actor_id) THEN
    RETURN jsonb_build_object('outcome', 'forbidden');
  END IF;

  PERFORM 1 FROM public.projects AS project WHERE project.id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_operation
    FROM app_private.project_deletion_operations AS operation
    WHERE operation.project_id = p_project_id
      AND operation.phase = 'completed'
      AND operation.actor_id = p_actor_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'outcome', 'completed',
        'operationId', v_operation.id,
        'projectId', v_operation.project_id,
        'phase', 'completed',
        'replayed', true
      );
    END IF;
    RETURN jsonb_build_object('outcome', 'project_not_found');
  END IF;

  v_refusal := app_private.project_deletion_refusal(p_project_id, p_actor_id);
  IF v_refusal IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', v_refusal);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-project-assets', 0));

  SELECT * INTO v_operation
  FROM app_private.project_deletion_operations AS operation
  WHERE operation.project_id = p_project_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_operation.phase <> 'pending' THEN
      RETURN jsonb_build_object('outcome', 'invalid_state');
    END IF;
    -- Any actor who is authorized now may carry an open deletion forward.
    UPDATE app_private.project_deletion_operations AS operation
    SET actor_id = p_actor_id, updated_at = now()
    WHERE operation.id = v_operation.id;
    v_resumed := true;
  ELSE
    SELECT count(*) INTO v_candidates
    FROM app_private.project_deletion_candidates(p_project_id);
    -- Refused rather than truncated: a partial claim would report a cleanup
    -- as complete while objects remained.
    IF v_candidates > 500 THEN
      RETURN jsonb_build_object('outcome', 'asset_limit', 'assetCount', v_candidates);
    END IF;

    INSERT INTO app_private.project_deletion_operations(project_id, actor_id)
    VALUES (p_project_id, p_actor_id)
    RETURNING * INTO v_operation;

    UPDATE app_private.project_asset_objects AS asset
    SET state = 'claimed', claim_operation_id = v_operation.id
    FROM app_private.project_deletion_candidates(p_project_id) AS candidate
    WHERE asset.bucket_id = candidate.bucket_id
      AND asset.object_name = candidate.object_name;
  END IF;

  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_resumed THEN 'resumed' ELSE 'prepared' END,
    'operationId', v_operation.id,
    'projectId', p_project_id,
    'phase', 'pending',
    'objects', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'bucket', asset.bucket_id,
          'name', asset.object_name,
          'objectId', asset.object_id,
          'present', EXISTS (
            SELECT 1 FROM storage.objects AS stored
            WHERE stored.bucket_id = asset.bucket_id AND stored.name = asset.object_name
          )
        )
        ORDER BY asset.bucket_id, asset.object_name
      )
      FROM app_private.project_asset_objects AS asset
      WHERE asset.claim_operation_id = v_operation.id
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_project_deletion(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_project_deletion(uuid, uuid, boolean) TO service_role;

-- Completes a deletion once every claimed object is verifiably gone, then
-- removes the project row itself. Safe to repeat after a lost response.
CREATE FUNCTION public.finalize_project_deletion(
  p_operation_id uuid, p_project_id uuid, p_actor_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_operation app_private.project_deletion_operations;
  v_project_exists boolean;
  v_refusal text;
  v_remaining jsonb;
  v_deleted integer;
BEGIN
  IF p_operation_id IS NULL OR p_project_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Invalid project deletion scope.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || p_actor_id::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(p_actor_id) THEN
    RETURN jsonb_build_object('outcome', 'forbidden');
  END IF;

  PERFORM 1 FROM public.projects AS project WHERE project.id = p_project_id FOR UPDATE;
  v_project_exists := FOUND;

  SELECT * INTO v_operation
  FROM app_private.project_deletion_operations AS operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND OR v_operation.project_id <> p_project_id THEN
    RETURN jsonb_build_object('outcome', 'operation_mismatch');
  END IF;

  IF v_operation.phase = 'completed' THEN
    -- The project row is gone, so only the actor who completed it may read
    -- the receipt back.
    IF v_operation.actor_id <> p_actor_id THEN
      RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'completed',
      'operationId', v_operation.id,
      'projectId', v_operation.project_id,
      'phase', 'completed',
      'replayed', true
    );
  END IF;

  IF NOT v_project_exists THEN
    RETURN jsonb_build_object('outcome', 'project_not_found');
  END IF;

  v_refusal := app_private.project_deletion_refusal(p_project_id, p_actor_id);
  IF v_refusal IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', v_refusal);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-project-assets', 0));

  -- A reported removal is not proof. Any object still stored under a claimed
  -- name, the claimed one or a replacement, blocks completion.
  SELECT jsonb_agg(
    jsonb_build_object(
      'bucket', asset.bucket_id,
      'name', asset.object_name,
      'objectId', asset.object_id,
      'replaced', stored.id IS DISTINCT FROM asset.object_id
    )
    ORDER BY asset.bucket_id, asset.object_name
  )
  INTO v_remaining
  FROM app_private.project_asset_objects AS asset
  JOIN storage.objects AS stored
    ON stored.bucket_id = asset.bucket_id AND stored.name = asset.object_name
  WHERE asset.claim_operation_id = v_operation.id;

  IF v_remaining IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'objects_remaining',
      'operationId', v_operation.id,
      'projectId', p_project_id,
      'phase', 'pending',
      'objects', v_remaining
    );
  END IF;

  UPDATE app_private.project_asset_objects AS asset
  SET state = 'deleted', deleted_at = coalesce(asset.deleted_at, now())
  WHERE asset.claim_operation_id = v_operation.id AND asset.state = 'claimed';

  DELETE FROM public.projects AS project WHERE project.id = p_project_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'Project deletion did not remove exactly one project.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE app_private.project_deletion_operations AS operation
  SET phase = 'completed', completed_at = now(), updated_at = now(), actor_id = p_actor_id
  WHERE operation.id = v_operation.id;

  RETURN jsonb_build_object(
    'outcome', 'completed',
    'operationId', v_operation.id,
    'projectId', p_project_id,
    'phase', 'completed',
    'replayed', false,
    'deletedObjectIds', coalesce((
      SELECT jsonb_agg(asset.object_id ORDER BY asset.bucket_id, asset.object_name)
      FROM app_private.project_asset_objects AS asset
      WHERE asset.claim_operation_id = v_operation.id
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_project_deletion(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_project_deletion(uuid, uuid, uuid) TO service_role;

-- Existing links, from the project rows as they stand.
INSERT INTO app_private.project_asset_references(project_id, bucket_id, object_name)
SELECT project.id, linked.bucket_id, linked.object_name
FROM public.projects AS project
CROSS JOIN LATERAL app_private.project_asset_references_of(
  project.cover_image_url, to_jsonb(project.documents)
) AS linked
ON CONFLICT DO NOTHING;

-- Existing objects are registered only on the same proof a new upload needs:
-- a canonical name, a recorded Storage owner, and that owner being a current
-- organizer of the named project. Everything else stays unregistered and is
-- retained. A URL stored on a project is never used as proof.
INSERT INTO app_private.project_asset_objects(
  bucket_id, object_name, object_id, owner_project_id, registered_by
)
SELECT stored.bucket_id, stored.name, stored.id, proof.project_id, proof.owner_id
FROM storage.objects AS stored
CROSS JOIN LATERAL (
  SELECT
    app_private.project_asset_name_project(stored.name) AS project_id,
    CASE
      WHEN coalesce(to_jsonb(stored)->>'owner_id', to_jsonb(stored)->>'owner')
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN coalesce(to_jsonb(stored)->>'owner_id', to_jsonb(stored)->>'owner')::uuid
    END AS owner_id
) AS proof
WHERE stored.bucket_id IN ('project-images', 'project-documents')
  AND proof.project_id IS NOT NULL
  AND proof.owner_id IS NOT NULL
  AND app_private.is_project_organizer(proof.project_id, proof.owner_id)
ON CONFLICT DO NOTHING;

COMMENT ON FUNCTION public.prepare_project_deletion(uuid, uuid, boolean) IS
  'Service-only. Reauthorizes the actor, freezes the project, and claims the registered Storage objects its deletion may remove. Returns the actor''s own completed receipt when the project is already gone. With p_replay_only it only reads that receipt and never begins a deletion.';
COMMENT ON FUNCTION public.finalize_project_deletion(uuid, uuid, uuid) IS
  'Service-only. Verifies every claimed Storage object is absent, reauthorizes the actor, and deletes exactly one project.';

NOTIFY pgrst, 'reload schema';
COMMIT;
