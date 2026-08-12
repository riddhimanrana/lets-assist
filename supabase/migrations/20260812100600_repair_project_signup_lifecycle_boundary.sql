-- Projects with multiple schedule slots remain open while an earlier slot is
-- in progress. Approval must serialize with cancellation without treating an
-- active project as closed. Also repair the baseline's accidentally quoted
-- status default for future inserts; existing status rows are left untouched.

ALTER TABLE public.projects
  ALTER COLUMN status SET DEFAULT 'upcoming';

CREATE OR REPLACE FUNCTION app_private.enforce_project_signup_cancellation_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_organization_id uuid;
  v_project_status text;
  v_approving boolean :=
    NEW.status = 'approved'
    AND (
      TG_OP = 'INSERT'
      OR OLD.status IS DISTINCT FROM 'approved'
      OR OLD.project_id IS DISTINCT FROM NEW.project_id
    );
BEGIN
  IF NEW.project_id IS NULL THEN
    NEW.organization_id := NULL;
    RETURN NEW;
  END IF;

  -- Approval and cancellation share this project-row lock. Whichever commits
  -- first defines the cancellation audience; an approval that loses the race
  -- observes cancelled and is denied rather than landing outside the snapshot.
  IF v_approving THEN
    SELECT projects.organization_id, projects.status
    INTO v_organization_id, v_project_status
    FROM public.projects AS projects
    WHERE projects.id = NEW.project_id
    FOR UPDATE;
  ELSE
    SELECT projects.organization_id, projects.status
    INTO v_organization_id, v_project_status
    FROM public.projects AS projects
    WHERE projects.id = NEW.project_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project signup references a missing project'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.organization_id IS NOT NULL
    AND NEW.organization_id IS DISTINCT FROM v_organization_id
  THEN
    RAISE EXCEPTION 'project signup organization does not match project'
      USING ERRCODE = '23514';
  END IF;

  NEW.organization_id := v_organization_id;

  IF v_approving
    AND (
      v_project_status IS NULL
      OR v_project_status NOT IN ('upcoming', 'in-progress')
    )
  THEN
    RAISE EXCEPTION 'signups can only be approved for active projects'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.enforce_project_signup_cancellation_boundary()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.enforce_project_signup_cancellation_boundary()
  TO postgres;

COMMENT ON FUNCTION app_private.enforce_project_signup_cancellation_boundary() IS
  'Synchronizes signup approval with cancellation and permits approval only while a project is upcoming or in progress.';
