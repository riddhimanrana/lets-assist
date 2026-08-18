-- Keep the canonical database authorization predicate aligned with the
-- server-side app-metadata helper. Both accepted shapes live only in trusted
-- app_metadata; user_metadata and top-level JWT fields never grant authority.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT
    COALESCE(
      (auth.jwt() -> 'app_metadata') @> '{"is_super_admin": true}'::jsonb,
      false
    )
    OR translate(
      regexp_replace(
        COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', ''),
        U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028-\2029\202F\205F\3000\FEFF]+|[\0009-\000D\0020\00A0\1680\2000-\200A\2028-\2029\202F\205F\3000\FEFF]+$',
        '',
        'g'
      ),
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'abcdefghijklmnopqrstuvwxyz'
    ) = 'super_admin';
$function$;

ALTER FUNCTION public.is_super_admin() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_super_admin()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

COMMENT ON FUNCTION public.is_super_admin() IS
  'Returns true only for trusted app_metadata is_super_admin=true or role=super_admin claims.';
