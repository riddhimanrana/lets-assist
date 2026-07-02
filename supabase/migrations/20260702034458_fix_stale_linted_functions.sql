-- Remove stale RPC-style helper overloads that reference old or unqualified
-- schema objects. Current app paths use table queries/server actions instead.
DROP FUNCTION IF EXISTS public.check_username_unique(text);
DROP FUNCTION IF EXISTS public.get_organization_members(uuid);
DROP FUNCTION IF EXISTS public.update_project_draft_updated_at(uuid);
DROP FUNCTION IF EXISTS public.update_user_profile_picture(bigint, text);
DROP FUNCTION IF EXISTS public.gen_unique_username(text);

CREATE OR REPLACE FUNCTION public.gen_unique_username(p_base text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  base_candidate text := lower(regexp_replace(coalesce(nullif(trim(p_base), ''), 'user'), '[^a-zA-Z0-9_]+', '_', 'g'));
  candidate text;
  suffix text;
  attempts integer := 0;
BEGIN
  IF base_candidate = '' OR base_candidate = '_' THEN
    base_candidate := 'user';
  END IF;

  base_candidate := left(trim(both '_' from base_candidate), 32);
  IF base_candidate = '' THEN
    base_candidate := 'user';
  END IF;

  LOOP
    IF attempts = 0 THEN
      suffix := left(replace(gen_random_uuid()::text, '-', ''), 8);
    ELSE
      suffix := left(to_hex((floor(random() * 4294967295))::bigint), 8);
    END IF;

    candidate := base_candidate || '_' || suffix;

    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE username = candidate
    ) THEN
      RETURN candidate;
    END IF;

    attempts := attempts + 1;

    IF attempts > 20 THEN
      RETURN base_candidate || '_' || left(replace(gen_random_uuid()::text, '-', ''), 12);
    END IF;
  END LOOP;

  RETURN base_candidate || '_' || left(replace(gen_random_uuid()::text, '-', ''), 12);
END;
$$;
