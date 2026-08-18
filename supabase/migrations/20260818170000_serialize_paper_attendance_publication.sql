-- Serialize paper-attendance commits with hours publication and reject a
-- publication snapshot that omitted newly committed attendance.

CREATE OR REPLACE FUNCTION app_private.lock_paper_scan_project_for_commit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'committing' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM projects.id
    FROM public.projects AS projects
    WHERE projects.id = NEW.project_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'paper scan project not found';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.lock_paper_scan_project_for_commit()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.lock_paper_scan_project_for_commit()
  TO postgres;

DROP TRIGGER IF EXISTS lock_paper_scan_project_for_commit
  ON public.project_paper_scan_batches;
CREATE TRIGGER lock_paper_scan_project_for_commit
  BEFORE UPDATE OF status ON public.project_paper_scan_batches
  FOR EACH ROW
  EXECUTE FUNCTION app_private.lock_paper_scan_project_for_commit();

CREATE OR REPLACE FUNCTION app_private.guard_hours_publication_completeness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_publish_key text;
BEGIN
  FOR v_publish_key IN
    SELECT published.key
    FROM pg_catalog.jsonb_each_text(COALESCE(NEW.published, '{}'::jsonb)) AS published(key, value)
    WHERE published.value = 'true'
      AND COALESCE(OLD.published ->> published.key, 'false') <> 'true'
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.project_signups AS signups
      LEFT JOIN public.certificates AS certificates
        ON certificates.signup_id = signups.id
       AND certificates.type = 'verified'
      WHERE signups.project_id = NEW.id
        AND signups.status = 'attended'
        AND signups.check_in_time IS NOT NULL
        AND signups.check_out_time IS NOT NULL
        AND signups.check_out_time > signups.check_in_time
        AND signups.check_out_time <= signups.check_in_time + interval '24 hours'
        AND private.project_hours_publish_key(
          NEW.event_type,
          NEW.schedule,
          signups.schedule_id
        ) = v_publish_key
        AND certificates.id IS NULL
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'publication snapshot is stale; refresh attendance before publishing';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.guard_hours_publication_completeness()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.guard_hours_publication_completeness()
  TO postgres;

DROP TRIGGER IF EXISTS guard_hours_publication_completeness
  ON public.projects;
CREATE TRIGGER guard_hours_publication_completeness
  BEFORE UPDATE OF published ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION app_private.guard_hours_publication_completeness();

COMMENT ON FUNCTION app_private.lock_paper_scan_project_for_commit() IS
  'Locks the parent project before a paper batch creates attendance so hours publication cannot overlap it.';
COMMENT ON FUNCTION app_private.guard_hours_publication_completeness() IS
  'Rejects a newly published session when eligible attended signups still lack verified certificates.';

CREATE OR REPLACE FUNCTION app_private.issue_verified_certificate_for_late_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_publish_key text;
BEGIN
  IF session_user <> 'postgres'
    AND COALESCE(auth.role()::text, '') <> 'service_role'
  THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'attended'
    OR NEW.check_in_time IS NULL
    OR NEW.check_out_time IS NULL
    OR NEW.check_out_time <= NEW.check_in_time
    OR NEW.check_out_time > NEW.check_in_time + interval '24 hours'
  THEN
    RETURN NEW;
  END IF;

  SELECT projects.*
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = NEW.project_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_publish_key := private.project_hours_publish_key(
    v_project.event_type,
    v_project.schedule,
    NEW.schedule_id
  );

  IF v_publish_key IS NOT NULL
    AND COALESCE((v_project.published ->> v_publish_key)::boolean, false)
  THEN
    -- This executes inside the attendance write transaction. A paper batch
    -- cannot commit a late attendee to an already-published session without
    -- also committing that attendee's verified certificate.
    PERFORM issued.id
    FROM public.issue_supplemental_verified_certificates(
      NEW.project_id,
      NEW.schedule_id,
      ARRAY[NEW.id],
      v_project.creator_id
    ) AS issued;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.issue_verified_certificate_for_late_attendance()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.issue_verified_certificate_for_late_attendance()
  TO postgres;

DROP TRIGGER IF EXISTS issue_verified_certificate_for_late_attendance
  ON public.project_signups;
CREATE TRIGGER issue_verified_certificate_for_late_attendance
  AFTER INSERT OR UPDATE OF status, check_in_time, check_out_time
  ON public.project_signups
  FOR EACH ROW
  EXECUTE FUNCTION app_private.issue_verified_certificate_for_late_attendance();

COMMENT ON FUNCTION app_private.issue_verified_certificate_for_late_attendance() IS
  'Atomically issues a verified certificate when attendance lands after its project session was published.';
