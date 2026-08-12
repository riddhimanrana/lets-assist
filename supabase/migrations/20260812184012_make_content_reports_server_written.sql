-- AUD-034: moderation evidence is server-written. Reporters retain only
-- owner-scoped SELECT through the existing RLS policy.
BEGIN;

DROP POLICY IF EXISTS content_reports_insert_merged ON public.content_reports;
DROP POLICY IF EXISTS content_reports_update_merged ON public.content_reports;
DROP POLICY IF EXISTS content_reports_delete_merged ON public.content_reports;

REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.content_reports
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  column_name text;
BEGIN
  FOR column_name IN
    SELECT attribute.attname
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.content_reports'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE INSERT (%1$I), UPDATE (%1$I) ON public.content_reports FROM PUBLIC, anon, authenticated',
      column_name
    );
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.content_reports
  TO service_role;

-- Start from the immediately preceding canonical definition, removing only
-- the three authenticated write capabilities for content_reports. This avoids
-- duplicating and drifting the rest of the reviewed relation catalog.
DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef(
    'app_private.client_relation_grant_catalog()'::regprocedure
  )
  INTO definition;

  definition := replace(
    definition,
    '(''content_reports''::text, ''authenticated''::text, ''DELETE''::text, NULL),',
    ''
  );
  definition := replace(
    definition,
    '(''content_reports''::text, ''authenticated''::text, ''INSERT''::text, NULL),',
    ''
  );
  definition := replace(
    definition,
    '(''content_reports''::text, ''authenticated''::text, ''UPDATE''::text, NULL),',
    ''
  );

  EXECUTE definition;
END;
$$;

REVOKE ALL ON FUNCTION app_private.client_relation_grant_catalog()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.client_relation_grant_catalog()
  TO service_role;

DO $$
BEGIN
  IF (
    SELECT array_agg(privilege ORDER BY privilege)
    FROM app_private.client_relation_grant_catalog()
    WHERE relation_name = 'content_reports'
      AND role_name = 'authenticated'
  ) IS DISTINCT FROM ARRAY['SELECT'::text] THEN
    RAISE EXCEPTION
      'content_reports client relation catalog must contain authenticated SELECT only';
  END IF;
END;
$$;

COMMIT;
