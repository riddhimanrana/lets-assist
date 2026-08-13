-- Keep the staff-token issuer binding behind the server capability boundary.
-- The original organization capability trigger predates this column, so this
-- forward-only guard closes both INSERT and UPDATE rebinding paths without
-- modifying the historical trigger function.

CREATE OR REPLACE FUNCTION private.protect_staff_join_token_issuer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role')
     AND (
       (TG_OP = 'INSERT' AND NEW.staff_join_token_issued_by IS NOT NULL)
       OR (
         TG_OP = 'UPDATE'
         AND NEW.staff_join_token_issued_by
           IS DISTINCT FROM OLD.staff_join_token_issued_by
       )
     ) THEN
    RAISE EXCEPTION
      'staff invite token issuer requires a server-authorized operation'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION private.protect_staff_join_token_issuer()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION private.protect_staff_join_token_issuer()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.protect_staff_join_token_issuer()
  TO postgres;

DROP TRIGGER IF EXISTS protect_staff_join_token_issuer
  ON public.organizations;
CREATE TRIGGER protect_staff_join_token_issuer
BEFORE INSERT OR UPDATE ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION private.protect_staff_join_token_issuer();

REVOKE SELECT (staff_join_token_issued_by),
       INSERT (staff_join_token_issued_by),
       UPDATE (staff_join_token_issued_by)
  ON public.organizations
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.protect_staff_join_token_issuer() IS
  'Rejects non-postgres, non-service-role organization INSERT/UPDATE attempts that bind or rebind staff-token issuer authority.';
