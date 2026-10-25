-- PostgreSQL 17 recognizes Factory, but the application's ECMA-402 formatter
-- rejects it. Keep direct certificate writes within the formatter's zone set.
-- Review any preexisting Factory rows rather than changing their timestamps or
-- silently displaying them in the legacy Pacific fallback zone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.certificates
    WHERE event_timezone = 'Factory'
  ) THEN
    RAISE EXCEPTION 'Existing Factory certificate timezones require review'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_certificate_event_timezone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.event_timezone IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names AS zone
    WHERE zone.name = NEW.event_timezone
      AND zone.name <> 'Factory'
  ) THEN
    RAISE EXCEPTION 'certificates.event_timezone must be a valid IANA timezone'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_certificate_event_timezone()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.enforce_certificate_event_timezone()
  TO postgres, service_role;
