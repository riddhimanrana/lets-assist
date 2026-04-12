-- Migration: Organization contact import jobs for large CSV/XLSX invitation workflows

-- Track each import request initiated by organization admins
CREATE TABLE IF NOT EXISTS public.organization_contact_import_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    source_file_name text NOT NULL,
    source_file_type text NOT NULL CHECK (source_file_type IN ('csv', 'xlsx', 'xls')),
    role text NOT NULL CHECK (role IN ('staff', 'member')),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    total_rows integer NOT NULL DEFAULT 0,
    valid_rows integer NOT NULL DEFAULT 0,
    invalid_rows integer NOT NULL DEFAULT 0,
    duplicate_rows integer NOT NULL DEFAULT 0,
    processed_rows integer NOT NULL DEFAULT 0,
    successful_invites integer NOT NULL DEFAULT 0,
    failed_invites integer NOT NULL DEFAULT 0,
    started_at timestamptz,
    completed_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT organization_contact_import_jobs_total_rows_check CHECK (total_rows >= 0),
    CONSTRAINT organization_contact_import_jobs_valid_rows_check CHECK (valid_rows >= 0),
    CONSTRAINT organization_contact_import_jobs_invalid_rows_check CHECK (invalid_rows >= 0),
    CONSTRAINT organization_contact_import_jobs_duplicate_rows_check CHECK (duplicate_rows >= 0),
    CONSTRAINT organization_contact_import_jobs_processed_rows_check CHECK (processed_rows >= 0),
    CONSTRAINT organization_contact_import_jobs_successful_invites_check CHECK (successful_invites >= 0),
    CONSTRAINT organization_contact_import_jobs_failed_invites_check CHECK (failed_invites >= 0)
);

-- Track normalized rows from the uploaded file and processing outcomes
CREATE TABLE IF NOT EXISTS public.organization_contact_import_rows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES public.organization_contact_import_jobs(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    row_number integer NOT NULL,
    email text NOT NULL,
    full_name text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'invited', 'skipped', 'failed')),
    error text,
    invitation_id uuid REFERENCES public.organization_invitations(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT organization_contact_import_rows_row_number_check CHECK (row_number > 0)
);

-- Link generated invitations back to their import job
ALTER TABLE public.organization_invitations
    ADD COLUMN IF NOT EXISTS import_job_id uuid REFERENCES public.organization_contact_import_jobs(id) ON DELETE SET NULL;

-- Indexes for scale and polling
CREATE INDEX IF NOT EXISTS organization_contact_import_jobs_org_status_idx
    ON public.organization_contact_import_jobs (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS organization_contact_import_jobs_created_by_idx
    ON public.organization_contact_import_jobs (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS organization_contact_import_rows_job_status_row_idx
    ON public.organization_contact_import_rows (job_id, status, row_number);

CREATE INDEX IF NOT EXISTS organization_contact_import_rows_org_email_idx
    ON public.organization_contact_import_rows (organization_id, lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS organization_contact_import_rows_job_row_number_unique
    ON public.organization_contact_import_rows (job_id, row_number);

CREATE UNIQUE INDEX IF NOT EXISTS organization_contact_import_rows_job_email_unique
    ON public.organization_contact_import_rows (job_id, lower(email));

CREATE INDEX IF NOT EXISTS organization_invitations_import_job_idx
    ON public.organization_invitations (import_job_id);

-- Keep updated_at current
DROP TRIGGER IF EXISTS trg_organization_contact_import_jobs_updated_at ON public.organization_contact_import_jobs;
CREATE TRIGGER trg_organization_contact_import_jobs_updated_at
BEFORE UPDATE ON public.organization_contact_import_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_organization_contact_import_rows_updated_at ON public.organization_contact_import_rows;
CREATE TRIGGER trg_organization_contact_import_rows_updated_at
BEFORE UPDATE ON public.organization_contact_import_rows
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.organization_contact_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_contact_import_rows ENABLE ROW LEVEL SECURITY;

-- Restrict import management to organization admins
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'organization_contact_import_jobs'
          AND policyname = 'Org admins can manage contact import jobs'
    ) THEN
        CREATE POLICY "Org admins can manage contact import jobs"
        ON public.organization_contact_import_jobs
        FOR ALL
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.organization_id = organization_contact_import_jobs.organization_id
                  AND om.user_id = auth.uid()
                  AND om.role = 'admin'
            )
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.organization_id = organization_contact_import_jobs.organization_id
                  AND om.user_id = auth.uid()
                  AND om.role = 'admin'
            )
        );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'organization_contact_import_rows'
          AND policyname = 'Org admins can manage contact import rows'
    ) THEN
        CREATE POLICY "Org admins can manage contact import rows"
        ON public.organization_contact_import_rows
        FOR ALL
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.organization_id = organization_contact_import_rows.organization_id
                  AND om.user_id = auth.uid()
                  AND om.role = 'admin'
            )
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.organization_id = organization_contact_import_rows.organization_id
                  AND om.user_id = auth.uid()
                  AND om.role = 'admin'
            )
        );
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organization_contact_import_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organization_contact_import_rows TO authenticated;