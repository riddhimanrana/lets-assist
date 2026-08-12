-- Preserve cancellation audit truth without retaining live parent rows.
--
-- The hostile-review migration correctly stopped cancellation jobs and
-- deliveries from cascading away, but it made their immutable project and
-- organization identifiers live ON DELETE RESTRICT references. A cancelled
-- project therefore blocked its own deletion and every account/organization
-- deletion that cascaded through it.
--
-- Keep project_id and organization_id as frozen snapshot identifiers. Separate
-- nullable live_* references carry referential actions and detach only after a
-- parent has actually disappeared. Delivery-to-job snapshot coordinates stay
-- RESTRICT so no parent cascade can erase cancellation evidence.

ALTER TABLE public.project_cancellation_jobs
  ADD COLUMN project_id_snapshot uuid,
  ADD COLUMN organization_id_snapshot uuid,
  ADD COLUMN live_project_id uuid,
  ADD COLUMN live_organization_id uuid;

ALTER TABLE public.project_cancellation_deliveries
  ADD COLUMN project_id_snapshot uuid,
  ADD COLUMN organization_id_snapshot uuid,
  ADD COLUMN live_project_id uuid,
  ADD COLUMN live_organization_id uuid;

UPDATE public.project_cancellation_jobs
SET project_id_snapshot = project_id,
    organization_id_snapshot = organization_id,
    live_project_id = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.projects AS projects
        WHERE projects.id = project_cancellation_jobs.project_id
      ) THEN project_id
      ELSE NULL
    END,
    live_organization_id = CASE
      WHEN organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.organizations AS organizations
          WHERE organizations.id = project_cancellation_jobs.organization_id
        )
        THEN organization_id
      ELSE NULL
    END;

UPDATE public.project_cancellation_deliveries
SET project_id_snapshot = project_id,
    organization_id_snapshot = organization_id,
    live_project_id = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.projects AS projects
        WHERE projects.id = project_cancellation_deliveries.project_id
      ) THEN project_id
      ELSE NULL
    END,
    live_organization_id = CASE
      WHEN organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.organizations AS organizations
          WHERE organizations.id = project_cancellation_deliveries.organization_id
        )
        THEN organization_id
      ELSE NULL
    END;

ALTER TABLE public.project_cancellation_jobs
  ALTER COLUMN project_id_snapshot SET NOT NULL,
  ADD CONSTRAINT project_cancellation_jobs_snapshot_identifiers_match CHECK (
    project_id_snapshot = project_id
    AND organization_id_snapshot IS NOT DISTINCT FROM organization_id
    AND cancellation_tenant_id
      = COALESCE(organization_id_snapshot, project_id_snapshot)
  );

ALTER TABLE public.project_cancellation_deliveries
  ALTER COLUMN project_id_snapshot SET NOT NULL,
  ADD CONSTRAINT project_cancellation_deliveries_snapshot_identifiers_match CHECK (
    project_id_snapshot = project_id
    AND organization_id_snapshot IS NOT DISTINCT FROM organization_id
    AND cancellation_tenant_id
      = COALESCE(organization_id_snapshot, project_id_snapshot)
  );

-- project_id and organization_id are snapshots from this point onward. Remove
-- only their live-parent constraints; the delivery-to-job composite constraints
-- below intentionally remain RESTRICT over these immutable coordinates.
ALTER TABLE public.project_cancellation_jobs
  DROP CONSTRAINT project_cancellation_jobs_project_id_fkey,
  DROP CONSTRAINT project_cancellation_jobs_organization_id_fkey,
  DROP CONSTRAINT project_cancellation_jobs_project_organization_fkey,
  DROP CONSTRAINT project_cancellation_jobs_project_tenant_fkey;

ALTER TABLE public.project_cancellation_deliveries
  DROP CONSTRAINT project_cancellation_deliveries_project_id_fkey,
  DROP CONSTRAINT project_cancellation_deliveries_project_organization_fkey,
  DROP CONSTRAINT project_cancellation_deliveries_project_tenant_fkey;

CREATE OR REPLACE FUNCTION app_private.freeze_project_cancellation_parent_identifiers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.project_id_snapshot := NEW.project_id;
  NEW.organization_id_snapshot := NEW.organization_id;
  NEW.live_project_id := NEW.project_id;
  NEW.live_organization_id := NEW.organization_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.freeze_project_cancellation_parent_identifiers()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.freeze_project_cancellation_parent_identifiers()
  TO postgres;

CREATE TRIGGER freeze_project_cancellation_job_parent_identifiers
  BEFORE INSERT ON public.project_cancellation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION app_private.freeze_project_cancellation_parent_identifiers();

CREATE TRIGGER freeze_project_cancellation_delivery_parent_identifiers
  BEFORE INSERT ON public.project_cancellation_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION app_private.freeze_project_cancellation_parent_identifiers();

-- These columns may make exactly one transition: a nested SET NULL referential
-- action may detach an identifier after the referenced parent is gone. Direct
-- mutation, reassignment, and premature nulling remain impossible.
CREATE OR REPLACE FUNCTION app_private.guard_project_cancellation_live_parent_references()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.live_project_id IS DISTINCT FROM NEW.live_project_id
    AND NOT (
      OLD.live_project_id IS NOT NULL
      AND NEW.live_project_id IS NULL
      AND pg_catalog.pg_trigger_depth() > 1
      AND NOT EXISTS (
        SELECT 1
        FROM public.projects AS projects
        WHERE projects.id = OLD.live_project_id
      )
    )
  THEN
    RAISE EXCEPTION 'project cancellation live project reference may only detach after parent deletion'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.live_organization_id IS DISTINCT FROM NEW.live_organization_id
    AND NOT (
      OLD.live_organization_id IS NOT NULL
      AND NEW.live_organization_id IS NULL
      AND pg_catalog.pg_trigger_depth() > 1
      AND NOT EXISTS (
        SELECT 1
        FROM public.organizations AS organizations
        WHERE organizations.id = OLD.live_organization_id
      )
    )
  THEN
    RAISE EXCEPTION 'project cancellation live organization reference may only detach after parent deletion'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.guard_project_cancellation_live_parent_references()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.guard_project_cancellation_live_parent_references()
  TO postgres;

CREATE TRIGGER guard_project_cancellation_job_live_parent_references
  BEFORE UPDATE ON public.project_cancellation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION app_private.guard_project_cancellation_live_parent_references();

CREATE TRIGGER guard_project_cancellation_delivery_live_parent_references
  BEFORE UPDATE ON public.project_cancellation_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION app_private.guard_project_cancellation_live_parent_references();

ALTER TABLE public.project_cancellation_jobs
  ADD CONSTRAINT project_cancellation_jobs_live_project_id_fkey
    FOREIGN KEY (live_project_id)
    REFERENCES public.projects(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT project_cancellation_jobs_live_organization_id_fkey
    FOREIGN KEY (live_organization_id)
    REFERENCES public.organizations(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT project_cancellation_jobs_live_project_organization_fkey
    FOREIGN KEY (live_project_id, live_organization_id)
    REFERENCES public.projects(id, organization_id)
    MATCH SIMPLE ON DELETE SET NULL (live_project_id) NOT VALID;

ALTER TABLE public.project_cancellation_deliveries
  ADD CONSTRAINT project_cancellation_deliveries_live_project_id_fkey
    FOREIGN KEY (live_project_id)
    REFERENCES public.projects(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT project_cancellation_deliveries_live_organization_id_fkey
    FOREIGN KEY (live_organization_id)
    REFERENCES public.organizations(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT project_cancellation_deliveries_live_project_organization_fkey
    FOREIGN KEY (live_project_id, live_organization_id)
    REFERENCES public.projects(id, organization_id)
    MATCH SIMPLE ON DELETE SET NULL (live_project_id) NOT VALID;

ALTER TABLE public.project_cancellation_jobs
  VALIDATE CONSTRAINT project_cancellation_jobs_live_project_id_fkey,
  VALIDATE CONSTRAINT project_cancellation_jobs_live_organization_id_fkey,
  VALIDATE CONSTRAINT project_cancellation_jobs_live_project_organization_fkey;

ALTER TABLE public.project_cancellation_deliveries
  VALIDATE CONSTRAINT project_cancellation_deliveries_live_project_id_fkey,
  VALIDATE CONSTRAINT project_cancellation_deliveries_live_organization_id_fkey,
  VALIDATE CONSTRAINT project_cancellation_deliveries_live_project_organization_fkey;

CREATE INDEX project_cancellation_jobs_live_project_id_idx
  ON public.project_cancellation_jobs (live_project_id)
  WHERE live_project_id IS NOT NULL;
CREATE INDEX project_cancellation_jobs_live_organization_id_idx
  ON public.project_cancellation_jobs (live_organization_id)
  WHERE live_organization_id IS NOT NULL;
CREATE INDEX project_cancellation_deliveries_live_project_id_idx
  ON public.project_cancellation_deliveries (live_project_id)
  WHERE live_project_id IS NOT NULL;
CREATE INDEX project_cancellation_deliveries_live_organization_id_idx
  ON public.project_cancellation_deliveries (live_organization_id)
  WHERE live_organization_id IS NOT NULL;

COMMENT ON COLUMN public.project_cancellation_jobs.project_id IS
  'Immutable project identifier frozen at cancellation; not a live foreign key.';
COMMENT ON COLUMN public.project_cancellation_jobs.organization_id IS
  'Immutable organization identifier frozen at cancellation; not a live foreign key.';
COMMENT ON COLUMN public.project_cancellation_jobs.project_id_snapshot IS
  'Explicit immutable alias of the frozen project identifier.';
COMMENT ON COLUMN public.project_cancellation_jobs.organization_id_snapshot IS
  'Explicit immutable alias of the frozen organization identifier.';
COMMENT ON COLUMN public.project_cancellation_jobs.live_project_id IS
  'Nullable live project reference. Parent deletion clears only this column.';
COMMENT ON COLUMN public.project_cancellation_jobs.live_organization_id IS
  'Nullable live organization reference. Parent deletion clears only this column.';

COMMENT ON COLUMN public.project_cancellation_deliveries.project_id IS
  'Immutable project identifier frozen at cancellation; not a live foreign key.';
COMMENT ON COLUMN public.project_cancellation_deliveries.organization_id IS
  'Immutable organization identifier frozen at cancellation; not a live foreign key.';
COMMENT ON COLUMN public.project_cancellation_deliveries.project_id_snapshot IS
  'Explicit immutable alias of the frozen project identifier.';
COMMENT ON COLUMN public.project_cancellation_deliveries.organization_id_snapshot IS
  'Explicit immutable alias of the frozen organization identifier.';
COMMENT ON COLUMN public.project_cancellation_deliveries.live_project_id IS
  'Nullable live project reference. Parent deletion clears only this column.';
COMMENT ON COLUMN public.project_cancellation_deliveries.live_organization_id IS
  'Nullable live organization reference. Parent deletion clears only this column.';
