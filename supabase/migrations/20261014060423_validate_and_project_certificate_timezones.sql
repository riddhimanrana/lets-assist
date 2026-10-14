-- Validate direct owner writes and expose only display timezone metadata through
-- the existing security-invoker certificate projections. Preserve the 726 ledger.
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

-- Fail rather than silently relabel any rows written under the prior draft.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.certificates AS certificate
    WHERE certificate.event_timezone IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names AS zone
        WHERE zone.name = certificate.event_timezone)
  ) THEN
    RAISE EXCEPTION 'Existing certificate event timezones require review'
      USING ERRCODE = '23514';
  END IF;
END;
$$;
CREATE TRIGGER enforce_certificate_event_timezone
BEFORE INSERT OR UPDATE OF event_timezone ON public.certificates
FOR EACH ROW EXECUTE FUNCTION private.enforce_certificate_event_timezone();

-- Append fields without changing the historical projection's order, grants,
-- owner, RLS boundary or private-data exclusions.
CREATE OR REPLACE VIEW public.certificate_verification_read_model
WITH (security_invoker = true)
AS
SELECT
  c.id, c.project_title, c.creator_name, c.is_certified, c.type,
  c.event_start, c.event_end, c.user_id, c.check_in_method, c.created_at,
  c.organization_name, c.project_id, c.schedule_id, c.issued_at, c.signup_id,
  c.volunteer_name, c.project_location, c.description,
  p.username AS creator_username, c.credited_minutes, c.attendance_revision,
  c.event_timezone, project.project_timezone AS project_timezone
FROM public.certificates c
LEFT JOIN public.profiles p ON p.id = c.creator_id
LEFT JOIN public.projects project ON project.id = c.project_id;

CREATE OR REPLACE VIEW public.user_certificate_read_model
WITH (security_invoker = true)
AS
SELECT
  c.id, c.project_title, c.creator_name, c.is_certified, c.type,
  c.event_start, c.event_end, c.volunteer_email, c.user_id, c.check_in_method,
  c.created_at, c.organization_name, c.project_id, c.schedule_id, c.issued_at,
  c.signup_id, c.volunteer_name, c.project_location, c.description,
  p.project_timezone, c.credited_minutes, c.attendance_revision, c.event_timezone
FROM public.certificates c
LEFT JOIN public.projects p ON p.id = c.project_id;
