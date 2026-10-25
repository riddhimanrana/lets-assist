-- Reserve cleanup before public image uploads and fence every retired object key.
BEGIN;

CREATE TABLE app_private.public_image_cleanup_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL CHECK (bucket_id IN ('avatars', 'organization-logos')),
  object_key text NOT NULL UNIQUE CHECK (object_key ~ '^[a-f0-9]{64}$'),
  object_name text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'retained', 'deleting', 'deleted')),
  available_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  claim_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((state = 'deleted') = (object_name IS NULL)),
  CHECK ((claim_token IS NULL) = (claim_expires_at IS NULL))
);
ALTER TABLE app_private.public_image_cleanup_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.public_image_cleanup_objects FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX public_image_cleanup_due_idx ON app_private.public_image_cleanup_objects(available_at, id)
  WHERE state IN ('pending', 'deleting');

CREATE FUNCTION app_private.public_image_object_key(p_bucket text, p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN length(p_name) <= 160 AND p_name NOT LIKE '%..%'
    AND ((p_bucket = 'avatars' AND p_name ~* '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}-[a-fA-F0-9.-]+\.(jpg|jpeg|png|webp)$')
      OR (p_bucket = 'organization-logos' AND p_name ~* '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}(\.[a-fA-F0-9.-]+)?\.(jpg|jpeg|png|webp)$'))
    THEN encode(sha256(convert_to(p_bucket || '/' || p_name, 'UTF8')), 'hex') END;
$$;
REVOKE ALL ON FUNCTION app_private.public_image_object_key(text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.public_image_object_key(text,text) TO postgres, authenticated, service_role;

CREATE FUNCTION app_private.public_image_reference_key(p_url text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE parts text[]; decoded text := ''; remainder text; character text;
BEGIN
  IF p_url IS NULL THEN RETURN NULL; END IF;
  p_url := left(p_url,4096);
  parts := regexp_match(p_url, '^[hH][tT][tT][pP][sS]?://[^/?#]+/storage/v1/(?:object|render/image)/(?:public|sign|authenticated)/(avatars|organization-logos)/([^?#]+)');
  IF parts IS NULL OR length(parts[2]) > 480 THEN RETURN NULL; END IF;
  remainder := parts[2];
  WHILE length(remainder) > 0 LOOP
    IF left(remainder, 1) = '%' THEN
      IF left(remainder, 3) !~ '^%[a-fA-F0-9]{2}$' THEN RETURN NULL; END IF;
      IF get_byte(decode(substr(remainder, 2, 2), 'hex'), 0) = 0 THEN RETURN NULL; END IF;
      character := chr(get_byte(decode(substr(remainder, 2, 2), 'hex'), 0));
      remainder := substr(remainder, 4);
    ELSE
      character := left(remainder, 1);
      remainder := substr(remainder, 2);
    END IF;
    IF character !~ '^[a-zA-Z0-9.-]$' THEN RETURN NULL; END IF;
    decoded := decoded || character;
  END LOOP;
  RETURN app_private.public_image_object_key(parts[1], decoded);
EXCEPTION WHEN character_not_in_repertoire THEN RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_private.public_image_reference_key(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.public_image_reference_key(text) TO postgres, authenticated, service_role;

CREATE INDEX profiles_public_image_reference_idx ON public.profiles
  (app_private.public_image_reference_key(avatar_url))
  WHERE app_private.public_image_reference_key(avatar_url) IS NOT NULL;
CREATE INDEX organizations_public_image_reference_idx ON public.organizations
  (app_private.public_image_reference_key(logo_url))
  WHERE app_private.public_image_reference_key(logo_url) IS NOT NULL;
CREATE TABLE app_private.auth_public_image_references (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  object_key text NOT NULL CHECK (object_key ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (user_id, object_key)
);
ALTER TABLE app_private.auth_public_image_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.auth_public_image_references FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX auth_public_image_reference_key_idx ON app_private.auth_public_image_references(object_key);

CREATE FUNCTION app_private.public_image_is_referenced(p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE app_private.public_image_reference_key(avatar_url) = p_key)
    OR EXISTS (SELECT 1 FROM public.organizations WHERE app_private.public_image_reference_key(logo_url) = p_key)
    OR EXISTS (SELECT 1 FROM app_private.auth_public_image_references WHERE object_key = p_key);
$$;
REVOKE ALL ON FUNCTION app_private.public_image_is_referenced(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.public_image_is_referenced(text) TO postgres;

CREATE FUNCTION app_private.track_public_image_references()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_keys text[] := ARRAY[]::text[]; new_keys text[] := ARRAY[]::text[];
  asset app_private.public_image_cleanup_objects;
BEGIN
  IF TG_TABLE_SCHEMA = 'auth' THEN
    IF TG_OP <> 'INSERT' THEN old_keys := ARRAY[
      app_private.public_image_reference_key(OLD.raw_user_meta_data->>'avatar_url'),
      app_private.public_image_reference_key(OLD.raw_user_meta_data->>'picture')]; END IF;
    IF TG_OP <> 'DELETE' THEN new_keys := ARRAY[
      app_private.public_image_reference_key(NEW.raw_user_meta_data->>'avatar_url'),
      app_private.public_image_reference_key(NEW.raw_user_meta_data->>'picture')]; END IF;
  ELSIF TG_TABLE_NAME = 'profiles' THEN
    IF TG_OP <> 'INSERT' THEN old_keys := ARRAY[app_private.public_image_reference_key(OLD.avatar_url)]; END IF;
    IF TG_OP <> 'DELETE' THEN new_keys := ARRAY[app_private.public_image_reference_key(NEW.avatar_url)]; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN old_keys := ARRAY[app_private.public_image_reference_key(OLD.logo_url)]; END IF;
    IF TG_OP <> 'DELETE' THEN new_keys := ARRAY[app_private.public_image_reference_key(NEW.logo_url)]; END IF;
  END IF;
  FOR asset IN SELECT * FROM app_private.public_image_cleanup_objects
    WHERE object_key = ANY(old_keys || new_keys) ORDER BY object_key FOR UPDATE LOOP
    IF asset.object_key = ANY(new_keys) AND asset.state IN ('deleting', 'deleted') THEN
      RAISE EXCEPTION 'This image has been retired. Upload a new image.' USING ERRCODE = '23514';
    END IF;
    IF asset.object_key = ANY(old_keys) AND NOT coalesce(asset.object_key = ANY(new_keys), false)
      AND asset.state IN ('pending', 'retained') THEN
      UPDATE app_private.public_image_cleanup_objects SET state = 'pending', available_at = now()
        WHERE id = asset.id;
    END IF;
  END LOOP;
  IF TG_TABLE_SCHEMA = 'auth' THEN
    IF TG_OP <> 'INSERT' THEN
      DELETE FROM app_private.auth_public_image_references WHERE user_id = OLD.id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      INSERT INTO app_private.auth_public_image_references(user_id, object_key)
        SELECT NEW.id, key FROM unnest(new_keys) AS key WHERE key IS NOT NULL
        ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.track_public_image_references() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.track_public_image_references() TO postgres;
CREATE TRIGGER public_image_profile_reference BEFORE INSERT OR UPDATE OF avatar_url OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION app_private.track_public_image_references();
CREATE TRIGGER public_image_organization_reference BEFORE INSERT OR UPDATE OF logo_url OR DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION app_private.track_public_image_references();
CREATE TRIGGER public_image_auth_reference AFTER INSERT OR UPDATE OF raw_user_meta_data OR DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app_private.track_public_image_references();

-- The trigger's table lock serializes this one-time backfill with Auth writes.
INSERT INTO app_private.auth_public_image_references(user_id, object_key)
  SELECT u.id, key FROM auth.users u CROSS JOIN LATERAL unnest(ARRAY[
    app_private.public_image_reference_key(u.raw_user_meta_data->>'avatar_url'),
    app_private.public_image_reference_key(u.raw_user_meta_data->>'picture')]) AS key
  WHERE key IS NOT NULL ON CONFLICT DO NOTHING;

CREATE FUNCTION app_private.fence_retired_public_image_upload()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE asset app_private.public_image_cleanup_objects; new_key text; old_key text;
BEGIN
  new_key := app_private.public_image_object_key(NEW.bucket_id, NEW.name);
  IF TG_OP = 'UPDATE' THEN old_key := app_private.public_image_object_key(OLD.bucket_id, OLD.name); END IF;
  FOR asset IN SELECT * FROM app_private.public_image_cleanup_objects
    WHERE object_key IN (new_key, old_key) ORDER BY object_key FOR UPDATE LOOP
    IF asset.state IN ('deleting', 'deleted') THEN
      RAISE EXCEPTION 'This image object has been retired.' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.fence_retired_public_image_upload() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.fence_retired_public_image_upload() TO postgres;
CREATE TRIGGER public_image_upload_fence BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION app_private.fence_retired_public_image_upload();

CREATE FUNCTION public.reserve_public_image_cleanup(
  p_actor uuid, p_bucket text, p_owner uuid, p_previous_url text, p_previous_path text, p_candidate_path text
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE current_url text; candidate_key text; previous_key text; asset app_private.public_image_cleanup_objects;
BEGIN
  IF p_actor IS NULL OR p_owner IS NULL OR p_bucket IS NULL OR p_bucket NOT IN ('avatars', 'organization-logos') THEN
    RAISE EXCEPTION 'Invalid image cleanup scope.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || p_actor::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(p_actor) THEN
    RAISE EXCEPTION 'Account image updates are unavailable.' USING ERRCODE = '42501';
  END IF;
  IF p_bucket = 'avatars' THEN
    IF p_owner <> p_actor THEN RAISE EXCEPTION 'Image update is not authorized.' USING ERRCODE = '42501'; END IF;
    SELECT avatar_url INTO current_url FROM public.profiles WHERE id = p_owner FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Image owner is unavailable.' USING ERRCODE = '42501'; END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-org-membership:' || p_owner::text, 0));
    IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = p_owner
      AND user_id = p_actor AND role = 'admin' AND status = 'active') THEN
      RAISE EXCEPTION 'Image update is not authorized.' USING ERRCODE = '42501';
    END IF;
    SELECT logo_url INTO current_url FROM public.organizations WHERE id = p_owner FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Image owner is unavailable.' USING ERRCODE = '42501'; END IF;
  END IF;
  IF current_url IS DISTINCT FROM p_previous_url THEN
    RAISE EXCEPTION 'The image changed before cleanup was reserved.' USING ERRCODE = 'PT409';
  END IF;
  IF p_previous_path IS NOT NULL THEN
    previous_key := app_private.public_image_object_key(p_bucket, p_previous_path);
    IF previous_key IS NULL OR left(p_previous_path, 36)::uuid <> p_owner
      OR previous_key IS DISTINCT FROM app_private.public_image_reference_key(current_url) THEN
      RAISE EXCEPTION 'Invalid previous image path.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_candidate_path IS NOT NULL THEN
    candidate_key := app_private.public_image_object_key(p_bucket, p_candidate_path);
    IF candidate_key IS NULL OR left(p_candidate_path, 36)::uuid <> p_owner
      OR p_candidate_path !~ '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$'
      OR candidate_key = previous_key THEN
      RAISE EXCEPTION 'Invalid candidate image path.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = p_bucket AND name = p_candidate_path) THEN
      RAISE EXCEPTION 'Image object keys cannot be reused.' USING ERRCODE = '23514';
    END IF;
  END IF;
  FOR asset IN SELECT * FROM app_private.public_image_cleanup_objects
    WHERE object_key IN (candidate_key, previous_key) ORDER BY object_key FOR UPDATE LOOP
    IF asset.state IN ('deleting', 'deleted') THEN
      RAISE EXCEPTION 'Image object keys cannot be reused.' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF previous_key IS NOT NULL THEN
    INSERT INTO app_private.public_image_cleanup_objects(bucket_id, object_key, object_name)
      VALUES (p_bucket, previous_key, p_previous_path) ON CONFLICT (object_key) DO NOTHING;
  END IF;
  IF candidate_key IS NOT NULL THEN
    INSERT INTO app_private.public_image_cleanup_objects(bucket_id, object_key, object_name, available_at)
      VALUES (p_bucket, candidate_key, p_candidate_path, now() + interval '1 hour') ON CONFLICT (object_key) DO NOTHING;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_public_image_cleanup(uuid,text,uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_public_image_cleanup(uuid,text,uuid,text,text,text) TO service_role;

CREATE FUNCTION public.claim_public_image_cleanup(p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE asset app_private.public_image_cleanup_objects; token uuid; result jsonb := '[]'::jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20 THEN
    RAISE EXCEPTION 'Invalid image cleanup batch size.' USING ERRCODE = '22023';
  END IF;
  FOR asset IN SELECT * FROM app_private.public_image_cleanup_objects
    WHERE state IN ('pending', 'deleting') AND available_at <= now()
      AND (claim_expires_at IS NULL OR claim_expires_at <= now())
    ORDER BY available_at, id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    IF app_private.public_image_is_referenced(asset.object_key) THEN
      UPDATE app_private.public_image_cleanup_objects SET state = CASE WHEN state = 'deleting' THEN state ELSE 'retained' END,
        available_at = now() + interval '1 day', claim_token = NULL, claim_expires_at = NULL WHERE id = asset.id;
      result := result || jsonb_build_array(jsonb_build_object('id', asset.id, 'retained', true));
      CONTINUE;
    END IF;
    token := gen_random_uuid();
    UPDATE app_private.public_image_cleanup_objects SET state = 'deleting', claim_token = token,
      claim_expires_at = now() + interval '2 minutes', attempts = least(attempts + 1, 1000000) WHERE id = asset.id;
    result := result || jsonb_build_array(jsonb_build_object('id', asset.id, 'claim_token', token,
      'bucket_id', asset.bucket_id, 'object_name', asset.object_name, 'retained', false));
  END LOOP;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_public_image_cleanup(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_public_image_cleanup(integer) TO service_role;

CREATE FUNCTION public.finish_public_image_cleanup(p_id uuid, p_claim uuid, p_removed boolean)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE asset app_private.public_image_cleanup_objects;
BEGIN
  SELECT * INTO asset FROM app_private.public_image_cleanup_objects WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR asset.state <> 'deleting' OR p_claim IS NULL OR asset.claim_token IS DISTINCT FROM p_claim
    OR asset.claim_expires_at <= now() THEN RETURN false; END IF;
  IF p_removed IS TRUE AND NOT app_private.public_image_is_referenced(asset.object_key)
    AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = asset.bucket_id AND name = asset.object_name) THEN
    UPDATE app_private.public_image_cleanup_objects SET state = 'deleted', object_name = NULL,
      completed_at = now(), claim_token = NULL, claim_expires_at = NULL, attempts = 0 WHERE id = asset.id;
    RETURN true;
  END IF;
  UPDATE app_private.public_image_cleanup_objects SET claim_token = NULL, claim_expires_at = NULL,
    available_at = now() + make_interval(secs => least(3600, 30 * greatest(1, asset.attempts))) WHERE id = asset.id;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_public_image_cleanup(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finish_public_image_cleanup(uuid,uuid,boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
