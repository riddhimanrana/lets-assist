-- Normalize the DVHS CSF application review lifecycle and protect the
-- consequential decision boundary. Google files remain source evidence while
-- reviewed application, dues, membership, and audit state lives here.

BEGIN;

CREATE TYPE plugin_data.csf_application_submission_status AS ENUM (
  'imported',
  'missing_information',
  'ready',
  'under_review',
  'decided'
);

CREATE TYPE plugin_data.csf_eligibility_status AS ENUM (
  'pending',
  'eligible',
  'ineligible',
  'adviser_override'
);

CREATE TYPE plugin_data.csf_dues_status AS ENUM (
  'not_recorded',
  'receipt_submitted',
  'verified',
  'waived',
  'not_required'
);

CREATE TYPE plugin_data.csf_application_decision_status AS ENUM (
  'pending',
  'approved',
  'rejected',
  'withdrawn'
);

CREATE TYPE plugin_data.csf_application_check_type AS ENUM (
  'identity',
  'required_information',
  'transcript',
  'course_data',
  'academic_eligibility',
  'dues'
);

CREATE TYPE plugin_data.csf_application_check_status AS ENUM (
  'pending',
  'passed',
  'failed',
  'waived',
  'not_required'
);

CREATE TYPE plugin_data.csf_application_reason_code AS ENUM (
  'approved_standard',
  'approved_adviser_override',
  'academic_ineligible',
  'missing_information',
  'missing_transcript',
  'dues_unverified',
  'identity_unresolved',
  'duplicate_submission',
  'withdrawn_by_applicant',
  'other'
);

CREATE TYPE plugin_data.csf_term_deadline_type AS ENUM (
  'application_open',
  'application_close',
  'dues',
  'meeting',
  'points',
  'semester_close',
  'other'
);

CREATE TYPE plugin_data.csf_term_deadline_status AS ENUM (
  'planned',
  'open',
  'completed',
  'cancelled'
);

ALTER TABLE plugin_data.csf_term_policies
  ADD COLUMN dues_required boolean NOT NULL DEFAULT true,
  ADD COLUMN dues_amount numeric(8,2) NOT NULL DEFAULT 5 CHECK (dues_amount >= 0),
  ADD COLUMN dues_currency text NOT NULL DEFAULT 'USD'
    CHECK (dues_currency ~ '^[A-Z]{3}$');

ALTER TABLE plugin_data.csf_term_applications
  ADD COLUMN submission_status plugin_data.csf_application_submission_status
    NOT NULL DEFAULT 'imported',
  ADD COLUMN eligibility_status plugin_data.csf_eligibility_status
    NOT NULL DEFAULT 'pending',
  ADD COLUMN decision_status plugin_data.csf_application_decision_status
    NOT NULL DEFAULT 'pending',
  ADD COLUMN decision_reason_code plugin_data.csf_application_reason_code,
  ADD COLUMN decision_reason text,
  ADD COLUMN assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN assigned_at timestamptz,
  ADD COLUMN decision_correlation_id uuid,
  ADD COLUMN source_file_id text,
  ADD COLUMN source_file_name text,
  ADD COLUMN source_sheet_tab text,
  ADD COLUMN source_row_number integer CHECK (source_row_number IS NULL OR source_row_number > 0),
  ADD COLUMN source_modified_at timestamptz,
  ADD COLUMN source_import_job_id uuid REFERENCES plugin_data.csf_sheet_import_jobs(id) ON DELETE SET NULL,
  ADD COLUMN source_import_row_id uuid REFERENCES plugin_data.csf_sheet_import_rows(id) ON DELETE SET NULL;

UPDATE plugin_data.csf_term_applications
SET
  submission_status = CASE status
    WHEN 'needs_action' THEN 'missing_information'::plugin_data.csf_application_submission_status
    WHEN 'needs_review' THEN 'ready'::plugin_data.csf_application_submission_status
    WHEN 'submitted' THEN 'ready'::plugin_data.csf_application_submission_status
    WHEN 'accepted' THEN 'decided'::plugin_data.csf_application_submission_status
    WHEN 'rejected' THEN 'decided'::plugin_data.csf_application_submission_status
    WHEN 'withdrawn' THEN 'decided'::plugin_data.csf_application_submission_status
    ELSE 'imported'::plugin_data.csf_application_submission_status
  END,
  eligibility_status = CASE status
    WHEN 'accepted' THEN 'eligible'::plugin_data.csf_eligibility_status
    ELSE 'pending'::plugin_data.csf_eligibility_status
  END,
  decision_status = CASE status
    WHEN 'accepted' THEN 'approved'::plugin_data.csf_application_decision_status
    WHEN 'rejected' THEN 'rejected'::plugin_data.csf_application_decision_status
    WHEN 'withdrawn' THEN 'withdrawn'::plugin_data.csf_application_decision_status
    ELSE 'pending'::plugin_data.csf_application_decision_status
  END,
  decision_reason_code = CASE status
    WHEN 'accepted' THEN 'approved_standard'::plugin_data.csf_application_reason_code
    WHEN 'rejected' THEN 'other'::plugin_data.csf_application_reason_code
    WHEN 'withdrawn' THEN 'withdrawn_by_applicant'::plugin_data.csf_application_reason_code
    ELSE NULL
  END,
  decision_reason = CASE
    WHEN status IN ('accepted', 'rejected', 'withdrawn') THEN review_notes
    ELSE NULL
  END,
  decision_correlation_id = CASE
    WHEN status IN ('accepted', 'rejected', 'withdrawn') THEN gen_random_uuid()
    ELSE NULL
  END;

ALTER TABLE plugin_data.csf_application_files
  ADD COLUMN provider text NOT NULL DEFAULT 'supabase_storage',
  ADD COLUMN drive_file_id text,
  ADD COLUMN drive_file_name text,
  ADD COLUMN drive_modified_at timestamptz,
  ADD COLUMN source_url text,
  ADD COLUMN verification_status text NOT NULL DEFAULT 'unreviewed';

ALTER TABLE plugin_data.csf_application_files
  ALTER COLUMN bucket DROP NOT NULL,
  ALTER COLUMN object_path DROP NOT NULL,
  ADD CONSTRAINT csf_application_files_provider_check
    CHECK (provider IN ('supabase_storage', 'google_drive')),
  ADD CONSTRAINT csf_application_files_verification_status_check
    CHECK (verification_status IN ('unreviewed', 'verified', 'rejected')),
  ADD CONSTRAINT csf_application_files_location_check
    CHECK (
      (provider = 'supabase_storage' AND nullif(btrim(bucket), '') IS NOT NULL AND nullif(btrim(object_path), '') IS NOT NULL)
      OR
      (provider = 'google_drive' AND nullif(btrim(drive_file_id), '') IS NOT NULL)
    );

ALTER TABLE plugin_data.csf_application_status_events
  ADD COLUMN correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN reason_code plugin_data.csf_application_reason_code;

ALTER TABLE plugin_data.csf_admin_audit_events
  ADD COLUMN correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN source_type text,
  ADD COLUMN source_id text,
  ADD COLUMN reason_code text;

ALTER TABLE plugin_data.csf_sheet_sources
  ADD COLUMN drive_file_id text,
  ADD COLUMN drive_file_name text,
  ADD COLUMN drive_modified_at timestamptz;

UPDATE plugin_data.csf_sheet_sources
SET drive_file_id = spreadsheet_id
WHERE drive_file_id IS NULL
  AND spreadsheet_id IS NOT NULL;

ALTER TABLE plugin_data.csf_sheet_import_jobs
  ADD COLUMN source_type text NOT NULL DEFAULT 'student_roster',
  ADD COLUMN source_file_id text,
  ADD COLUMN source_file_name text,
  ADD COLUMN source_sheet_tab text,
  ADD COLUMN source_range text,
  ADD COLUMN source_modified_at timestamptz,
  ADD COLUMN mapping_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN mapping_version integer NOT NULL DEFAULT 1 CHECK (mapping_version > 0),
  ADD COLUMN retry_of_job_id uuid REFERENCES plugin_data.csf_sheet_import_jobs(id) ON DELETE SET NULL,
  ADD COLUMN correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN committed_at timestamptz,
  ADD CONSTRAINT csf_sheet_import_jobs_source_type_check CHECK (
    source_type IN (
      'application_responses',
      'student_roster',
      'class_history',
      'meeting_attendance',
      'partner_club_audit'
    )
  ),
  ADD CONSTRAINT csf_sheet_import_jobs_mapping_snapshot_object_check
    CHECK (jsonb_typeof(mapping_snapshot) = 'object');

ALTER TABLE plugin_data.csf_sheet_import_jobs
  DROP CONSTRAINT csf_sheet_import_jobs_status_check,
  ADD CONSTRAINT csf_sheet_import_jobs_status_check CHECK (
    status IN ('pending', 'running', 'needs_resolution', 'partially_completed', 'completed', 'failed', 'cancelled')
  );

ALTER TABLE plugin_data.csf_sheet_import_rows
  ADD COLUMN mapping_version integer NOT NULL DEFAULT 1 CHECK (mapping_version > 0),
  ADD COLUMN resolution_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN resolution_reason_code text,
  ADD COLUMN resolution_notes text,
  ADD COLUMN resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN retry_of_row_id uuid REFERENCES plugin_data.csf_sheet_import_rows(id) ON DELETE SET NULL,
  ADD COLUMN source_modified_at timestamptz,
  ADD COLUMN correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT csf_sheet_import_rows_resolution_status_check CHECK (
    resolution_status IN ('pending', 'resolved', 'ignored', 'superseded')
  ),
  ADD CONSTRAINT csf_sheet_import_rows_resolution_metadata_check CHECK (
    (resolution_status = 'pending' AND resolved_at IS NULL)
    OR
    (resolution_status <> 'pending' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  );

ALTER TABLE plugin_data.csf_sheet_import_rows
  DROP CONSTRAINT csf_sheet_import_rows_import_status_check,
  ADD CONSTRAINT csf_sheet_import_rows_import_status_check CHECK (
    import_status IN (
      'pending',
      'created',
      'updated',
      'skipped',
      'ambiguous',
      'duplicate',
      'conflict',
      'error',
      'resolved',
      'superseded'
    )
  );

-- Tenant-aware parent keys let critical CSF relationships enforce that the
-- referenced record belongs to the same organization as the child row.
ALTER TABLE plugin_data.csf_terms
  ADD CONSTRAINT csf_terms_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE plugin_data.csf_cohorts
  ADD CONSTRAINT csf_cohorts_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE plugin_data.csf_profiles
  ADD CONSTRAINT csf_profiles_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE plugin_data.csf_term_applications
  ADD CONSTRAINT csf_term_applications_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE plugin_data.csf_application_files
  ADD CONSTRAINT csf_application_files_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE plugin_data.csf_sheet_sources
  ADD CONSTRAINT csf_sheet_sources_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE plugin_data.csf_sheet_import_jobs
  ADD CONSTRAINT csf_sheet_import_jobs_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE plugin_data.csf_sheet_import_rows
  ADD CONSTRAINT csf_sheet_import_rows_id_organization_id_key UNIQUE (id, organization_id);

ALTER TABLE plugin_data.csf_term_applications
  ADD CONSTRAINT csf_term_applications_profile_organization_fkey
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT csf_term_applications_cohort_organization_fkey
    FOREIGN KEY (cohort_id, organization_id)
    REFERENCES plugin_data.csf_cohorts (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT csf_term_applications_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE CASCADE;

ALTER TABLE plugin_data.csf_application_course_entries
  ADD CONSTRAINT csf_application_course_entries_application_organization_fkey
    FOREIGN KEY (application_id, organization_id)
    REFERENCES plugin_data.csf_term_applications (id, organization_id) ON DELETE CASCADE;

ALTER TABLE plugin_data.csf_application_files
  ADD CONSTRAINT csf_application_files_application_organization_fkey
    FOREIGN KEY (application_id, organization_id)
    REFERENCES plugin_data.csf_term_applications (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT csf_application_files_profile_organization_fkey
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT csf_application_files_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE CASCADE;

ALTER TABLE plugin_data.csf_application_status_events
  ADD CONSTRAINT csf_application_status_events_application_organization_fkey
    FOREIGN KEY (application_id, organization_id)
    REFERENCES plugin_data.csf_term_applications (id, organization_id) ON DELETE CASCADE;

ALTER TABLE plugin_data.csf_term_memberships
  ADD CONSTRAINT csf_term_memberships_profile_organization_fkey
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT csf_term_memberships_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT csf_term_memberships_cohort_organization_fkey
    FOREIGN KEY (cohort_id, organization_id)
    REFERENCES plugin_data.csf_cohorts (id, organization_id) ON DELETE SET NULL (cohort_id),
  ADD CONSTRAINT csf_term_memberships_application_organization_fkey
    FOREIGN KEY (application_id, organization_id)
    REFERENCES plugin_data.csf_term_applications (id, organization_id) ON DELETE SET NULL (application_id);

CREATE TABLE plugin_data.csf_application_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  check_type plugin_data.csf_application_check_type NOT NULL,
  status plugin_data.csf_application_check_status NOT NULL DEFAULT 'pending',
  mandatory boolean NOT NULL DEFAULT true,
  reason_code text,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  overridden_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  override_reason text,
  overridden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, application_id, check_type),
  CONSTRAINT csf_application_checks_application_organization_fkey
    FOREIGN KEY (application_id, organization_id)
    REFERENCES plugin_data.csf_term_applications (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX csf_application_checks_queue_idx
  ON plugin_data.csf_application_checks (organization_id, status, check_type, application_id);

CREATE TABLE plugin_data.csf_dues_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  term_id uuid NOT NULL,
  status plugin_data.csf_dues_status NOT NULL DEFAULT 'not_recorded',
  required_amount numeric(8,2) NOT NULL DEFAULT 5 CHECK (required_amount >= 0),
  paid_amount numeric(8,2) CHECK (paid_amount IS NULL OR paid_amount >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  receipt_application_file_id uuid,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('google_form_sheet', 'google_drive', 'manual', 'legacy_import')),
  source_ref jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_ref) = 'object'),
  submitted_at timestamptz,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  waived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  waived_at timestamptz,
  waiver_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, application_id),
  CONSTRAINT csf_dues_records_application_organization_fkey
    FOREIGN KEY (application_id, organization_id)
    REFERENCES plugin_data.csf_term_applications (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_dues_records_profile_organization_fkey
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_dues_records_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_dues_records_receipt_organization_fkey
    FOREIGN KEY (receipt_application_file_id, organization_id)
    REFERENCES plugin_data.csf_application_files (id, organization_id)
    ON DELETE SET NULL (receipt_application_file_id),
  CONSTRAINT csf_dues_records_status_metadata_check CHECK (
    (status = 'verified' AND verified_at IS NOT NULL)
    OR
    (status = 'waived' AND waived_at IS NOT NULL AND waived_by IS NOT NULL AND nullif(btrim(waiver_reason), '') IS NOT NULL)
    OR
    status IN ('not_recorded', 'receipt_submitted', 'not_required')
  )
);

CREATE INDEX csf_dues_records_term_status_idx
  ON plugin_data.csf_dues_records (organization_id, term_id, status, application_id);

CREATE TABLE plugin_data.csf_application_private_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  note_type text NOT NULL DEFAULT 'general'
    CHECK (note_type IN ('general', 'identity', 'eligibility', 'dues', 'decision', 'import')),
  body text NOT NULL CHECK (nullif(btrim(body), '') IS NOT NULL),
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  redacted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  redacted_at timestamptz,
  redaction_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_application_private_notes_application_organization_fkey
    FOREIGN KEY (application_id, organization_id)
    REFERENCES plugin_data.csf_term_applications (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_application_private_notes_redaction_check CHECK (
    (redacted_at IS NULL AND redacted_by IS NULL AND redaction_reason IS NULL)
    OR
    (redacted_at IS NOT NULL AND redacted_by IS NOT NULL AND nullif(btrim(redaction_reason), '') IS NOT NULL)
  )
);

CREATE INDEX csf_application_private_notes_application_idx
  ON plugin_data.csf_application_private_notes (organization_id, application_id, created_at DESC);

CREATE TABLE plugin_data.csf_term_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid NOT NULL,
  deadline_type plugin_data.csf_term_deadline_type NOT NULL,
  title text NOT NULL CHECK (nullif(btrim(title), '') IS NOT NULL),
  description text,
  due_at timestamptz NOT NULL,
  status plugin_data.csf_term_deadline_status NOT NULL DEFAULT 'planned',
  audience text NOT NULL DEFAULT 'officers'
    CHECK (audience IN ('officers', 'members', 'applicants', 'all')),
  related_route text,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'google_drive', 'import')),
  source_ref jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_ref) = 'object'),
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_term_deadlines_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_term_deadlines_completion_check CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR
    status <> 'completed'
  )
);

CREATE INDEX csf_term_deadlines_schedule_idx
  ON plugin_data.csf_term_deadlines (organization_id, term_id, status, due_at);

INSERT INTO plugin_data.csf_dues_records (
  organization_id,
  application_id,
  profile_id,
  term_id,
  status,
  required_amount,
  paid_amount,
  currency,
  receipt_application_file_id,
  source,
  source_ref,
  submitted_at,
  verified_at
)
SELECT
  application.organization_id,
  application.id,
  application.profile_id,
  application.term_id,
  CASE
    WHEN policy.dues_required = false THEN 'not_required'::plugin_data.csf_dues_status
    WHEN application.status = 'accepted' THEN 'verified'::plugin_data.csf_dues_status
    WHEN receipt.id IS NOT NULL THEN 'receipt_submitted'::plugin_data.csf_dues_status
    ELSE 'not_recorded'::plugin_data.csf_dues_status
  END,
  CASE WHEN policy.dues_required = false THEN 0 ELSE coalesce(policy.dues_amount, 5) END,
  CASE WHEN application.status = 'accepted' AND policy.dues_required THEN coalesce(policy.dues_amount, 5) ELSE NULL END,
  coalesce(policy.dues_currency, 'USD'),
  receipt.id,
  'legacy_import',
  jsonb_build_object('migratedFromApplicationStatus', application.status),
  coalesce(application.submitted_at, application.source_submitted_at),
  CASE WHEN application.status = 'accepted' AND policy.dues_required THEN coalesce(application.reviewed_at, application.updated_at, now()) END
FROM plugin_data.csf_term_applications AS application
LEFT JOIN plugin_data.csf_term_policies AS policy
  ON policy.organization_id = application.organization_id
 AND policy.term_id = application.term_id
LEFT JOIN LATERAL (
  SELECT file.id
  FROM plugin_data.csf_application_files AS file
  WHERE file.organization_id = application.organization_id
    AND file.application_id = application.id
    AND file.file_type = 'webstore_receipt'
  ORDER BY file.created_at DESC
  LIMIT 1
) AS receipt ON true;

INSERT INTO plugin_data.csf_application_checks (
  organization_id,
  application_id,
  check_type,
  status,
  mandatory,
  reason_code,
  summary,
  details,
  reviewed_by,
  reviewed_at
)
SELECT
  application.organization_id,
  application.id,
  check_kind.check_type,
  CASE
    WHEN application.status = 'accepted' THEN 'passed'::plugin_data.csf_application_check_status
    WHEN check_kind.check_type = 'identity' THEN 'passed'::plugin_data.csf_application_check_status
    WHEN check_kind.check_type = 'required_information'
      AND application.current_grade_level IS NOT NULL
      AND nullif(btrim(coalesce(application.most_checked_email, '')), '') IS NOT NULL
      THEN 'passed'::plugin_data.csf_application_check_status
    WHEN check_kind.check_type = 'transcript' AND EXISTS (
      SELECT 1 FROM plugin_data.csf_application_files AS file
      WHERE file.organization_id = application.organization_id
        AND file.application_id = application.id
        AND file.file_type = 'transcript'
    ) THEN 'passed'::plugin_data.csf_application_check_status
    WHEN check_kind.check_type = 'course_data' AND (
      EXISTS (
        SELECT 1 FROM plugin_data.csf_application_course_entries AS course
        WHERE course.organization_id = application.organization_id
          AND course.application_id = application.id
      )
      OR (
        application.list_i_points IS NOT NULL
        AND application.list_i_ii_points IS NOT NULL
        AND application.grand_total_points IS NOT NULL
      )
    ) THEN 'passed'::plugin_data.csf_application_check_status
    WHEN check_kind.check_type = 'academic_eligibility'
      AND application.list_i_points IS NOT NULL
      AND application.list_i_ii_points IS NOT NULL
      AND application.grand_total_points IS NOT NULL
      THEN CASE
        WHEN application.list_i_points >= coalesce((policy.academic_rules->>'minimumListI')::numeric, 4)
          AND application.list_i_ii_points >= coalesce((policy.academic_rules->>'minimumListIAndII')::numeric, 7)
          AND application.grand_total_points >= coalesce((policy.academic_rules->>'minimumTotal')::numeric, 10)
          AND NOT EXISTS (
            SELECT 1
            FROM plugin_data.csf_application_course_entries AS course
            WHERE course.organization_id = application.organization_id
              AND course.application_id = application.id
              AND upper(coalesce(course.grade, '')) IN ('D', 'F')
          )
          THEN 'passed'::plugin_data.csf_application_check_status
        ELSE 'failed'::plugin_data.csf_application_check_status
      END
    WHEN check_kind.check_type = 'dues' THEN CASE dues.status
      WHEN 'verified' THEN 'passed'::plugin_data.csf_application_check_status
      WHEN 'waived' THEN 'waived'::plugin_data.csf_application_check_status
      WHEN 'not_required' THEN 'not_required'::plugin_data.csf_application_check_status
      ELSE 'pending'::plugin_data.csf_application_check_status
    END
    ELSE 'pending'::plugin_data.csf_application_check_status
  END,
  true,
  CASE WHEN application.status = 'accepted' THEN 'legacy_accepted' ELSE NULL END,
  CASE WHEN application.status = 'accepted' THEN 'Preserved from a previously accepted application.' ELSE NULL END,
  jsonb_build_object('backfilledAt', now()),
  application.reviewed_by,
  CASE WHEN application.status = 'accepted' THEN application.reviewed_at ELSE NULL END
FROM plugin_data.csf_term_applications AS application
LEFT JOIN plugin_data.csf_term_policies AS policy
  ON policy.organization_id = application.organization_id
 AND policy.term_id = application.term_id
JOIN plugin_data.csf_dues_records AS dues
  ON dues.organization_id = application.organization_id
 AND dues.application_id = application.id
CROSS JOIN (
  VALUES
    ('identity'::plugin_data.csf_application_check_type),
    ('required_information'::plugin_data.csf_application_check_type),
    ('transcript'::plugin_data.csf_application_check_type),
    ('course_data'::plugin_data.csf_application_check_type),
    ('academic_eligibility'::plugin_data.csf_application_check_type),
    ('dues'::plugin_data.csf_application_check_type)
) AS check_kind(check_type);

UPDATE plugin_data.csf_term_applications AS application
SET eligibility_status = CASE eligibility.status
  WHEN 'passed' THEN 'eligible'::plugin_data.csf_eligibility_status
  WHEN 'failed' THEN 'ineligible'::plugin_data.csf_eligibility_status
  WHEN 'waived' THEN 'adviser_override'::plugin_data.csf_eligibility_status
  ELSE 'pending'::plugin_data.csf_eligibility_status
END
FROM plugin_data.csf_application_checks AS eligibility
WHERE eligibility.organization_id = application.organization_id
  AND eligibility.application_id = application.id
  AND eligibility.check_type = 'academic_eligibility';

CREATE OR REPLACE FUNCTION plugin_data.csf_validate_application_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_is_adviser boolean := false;
BEGIN
  IF NEW.status = 'waived' THEN
    IF NEW.overridden_by IS NULL OR nullif(btrim(coalesce(NEW.override_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Waived application checks require an actor and reason.';
    END IF;
    NEW.overridden_at := coalesce(NEW.overridden_at, now());

    IF NEW.check_type = 'academic_eligibility' THEN
      SELECT EXISTS (
        SELECT 1
        FROM plugin_data.csf_staff_positions AS position
        JOIN plugin_data.csf_roles AS role
          ON role.id = position.role_id
         AND role.organization_id = position.organization_id
        WHERE position.organization_id = NEW.organization_id
          AND position.user_id = NEW.overridden_by
          AND position.status = 'active'
          AND role.key IN ('advisor', 'owner')
      ) OR EXISTS (
        SELECT 1
        FROM auth.users AS actor
        WHERE actor.id = NEW.overridden_by
          AND lower(actor.email) = 'dvhighcsf@gmail.com'
      )
      INTO v_is_adviser;

      IF NOT v_is_adviser THEN
        RAISE EXCEPTION 'Academic eligibility may only be overridden by a CSF adviser.';
      END IF;
    END IF;
  ELSIF NEW.overridden_by IS NOT NULL OR NEW.override_reason IS NOT NULL OR NEW.overridden_at IS NOT NULL THEN
    RAISE EXCEPTION 'Override metadata is only valid for a waived application check.';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_validate_application_check_before_write
BEFORE INSERT OR UPDATE ON plugin_data.csf_application_checks
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_validate_application_check();

CREATE OR REPLACE FUNCTION plugin_data.csf_sync_application_check_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.check_type = 'academic_eligibility' THEN
    UPDATE plugin_data.csf_term_applications
    SET
      eligibility_status = CASE NEW.status
        WHEN 'passed' THEN 'eligible'::plugin_data.csf_eligibility_status
        WHEN 'failed' THEN 'ineligible'::plugin_data.csf_eligibility_status
        WHEN 'waived' THEN 'adviser_override'::plugin_data.csf_eligibility_status
        ELSE 'pending'::plugin_data.csf_eligibility_status
      END,
      updated_at = now()
    WHERE organization_id = NEW.organization_id
      AND id = NEW.application_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_sync_application_check_state_after_write
AFTER INSERT OR UPDATE ON plugin_data.csf_application_checks
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_sync_application_check_state();

CREATE OR REPLACE FUNCTION plugin_data.csf_sync_dues_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO plugin_data.csf_application_checks (
    organization_id,
    application_id,
    check_type,
    status,
    mandatory,
    reason_code,
    summary,
    details,
    reviewed_by,
    reviewed_at,
    overridden_by,
    override_reason,
    overridden_at
  )
  VALUES (
    NEW.organization_id,
    NEW.application_id,
    'dues',
    CASE NEW.status
      WHEN 'verified' THEN 'passed'::plugin_data.csf_application_check_status
      WHEN 'waived' THEN 'waived'::plugin_data.csf_application_check_status
      WHEN 'not_required' THEN 'not_required'::plugin_data.csf_application_check_status
      ELSE 'pending'::plugin_data.csf_application_check_status
    END,
    true,
    CASE NEW.status
      WHEN 'verified' THEN 'dues_verified'
      WHEN 'waived' THEN 'dues_waived'
      WHEN 'not_required' THEN 'dues_not_required'
      ELSE 'dues_unverified'
    END,
    CASE NEW.status
      WHEN 'verified' THEN 'Dues verified.'
      WHEN 'waived' THEN 'Dues waived.'
      WHEN 'not_required' THEN 'Dues are not required for this term.'
      WHEN 'receipt_submitted' THEN 'Receipt is awaiting verification.'
      ELSE 'No dues payment has been recorded.'
    END,
    jsonb_build_object('duesRecordId', NEW.id, 'duesStatus', NEW.status),
    NEW.verified_by,
    NEW.verified_at,
    NEW.waived_by,
    NEW.waiver_reason,
    NEW.waived_at
  )
  ON CONFLICT (organization_id, application_id, check_type) DO UPDATE
  SET
    status = EXCLUDED.status,
    reason_code = EXCLUDED.reason_code,
    summary = EXCLUDED.summary,
    details = EXCLUDED.details,
    reviewed_by = EXCLUDED.reviewed_by,
    reviewed_at = EXCLUDED.reviewed_at,
    overridden_by = EXCLUDED.overridden_by,
    override_reason = EXCLUDED.override_reason,
    overridden_at = EXCLUDED.overridden_at,
    updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_sync_dues_check_after_write
AFTER INSERT OR UPDATE ON plugin_data.csf_dues_records
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_sync_dues_check();

CREATE OR REPLACE FUNCTION plugin_data.csf_initialize_application_operations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_dues_required boolean := true;
  v_dues_amount numeric(8,2) := 5;
  v_dues_currency text := 'USD';
BEGIN
  SELECT policy.dues_required, policy.dues_amount, policy.dues_currency
  INTO v_dues_required, v_dues_amount, v_dues_currency
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = NEW.organization_id
    AND policy.term_id = NEW.term_id;

  INSERT INTO plugin_data.csf_dues_records (
    organization_id,
    application_id,
    profile_id,
    term_id,
    status,
    required_amount,
    paid_amount,
    currency,
    source,
    source_ref,
    verified_at
  )
  VALUES (
    NEW.organization_id,
    NEW.id,
    NEW.profile_id,
    NEW.term_id,
    CASE
      WHEN coalesce(v_dues_required, true) = false THEN 'not_required'::plugin_data.csf_dues_status
      WHEN NEW.status = 'accepted' THEN 'verified'::plugin_data.csf_dues_status
      ELSE 'not_recorded'::plugin_data.csf_dues_status
    END,
    CASE WHEN coalesce(v_dues_required, true) THEN coalesce(v_dues_amount, 5) ELSE 0 END,
    CASE WHEN NEW.status = 'accepted' AND coalesce(v_dues_required, true) THEN coalesce(v_dues_amount, 5) ELSE NULL END,
    coalesce(v_dues_currency, 'USD'),
    CASE WHEN NEW.source = 'manual' THEN 'manual' ELSE 'legacy_import' END,
    jsonb_build_object('initializedFromApplication', NEW.id),
    CASE WHEN NEW.status = 'accepted' AND coalesce(v_dues_required, true) THEN coalesce(NEW.reviewed_at, now()) END
  );

  INSERT INTO plugin_data.csf_application_checks (
    organization_id,
    application_id,
    check_type,
    status,
    mandatory,
    reason_code,
    summary,
    details,
    reviewed_by,
    reviewed_at
  )
  SELECT
    NEW.organization_id,
    NEW.id,
    check_kind.check_type,
    CASE
      WHEN NEW.status = 'accepted' THEN 'passed'::plugin_data.csf_application_check_status
      WHEN check_kind.check_type = 'identity' THEN 'passed'::plugin_data.csf_application_check_status
      WHEN check_kind.check_type = 'dues' AND coalesce(v_dues_required, true) = false
        THEN 'not_required'::plugin_data.csf_application_check_status
      ELSE 'pending'::plugin_data.csf_application_check_status
    END,
    true,
    CASE WHEN NEW.status = 'accepted' THEN 'legacy_accepted' ELSE NULL END,
    CASE WHEN NEW.status = 'accepted' THEN 'Preserved from an accepted imported application.' ELSE NULL END,
    jsonb_build_object('initializedAt', now()),
    NEW.reviewed_by,
    CASE WHEN NEW.status = 'accepted' THEN NEW.reviewed_at ELSE NULL END
  FROM (
    VALUES
      ('identity'::plugin_data.csf_application_check_type),
      ('required_information'::plugin_data.csf_application_check_type),
      ('transcript'::plugin_data.csf_application_check_type),
      ('course_data'::plugin_data.csf_application_check_type),
      ('academic_eligibility'::plugin_data.csf_application_check_type),
      ('dues'::plugin_data.csf_application_check_type)
  ) AS check_kind(check_type)
  ON CONFLICT (organization_id, application_id, check_type) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_initialize_application_operations_after_insert
AFTER INSERT ON plugin_data.csf_term_applications
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_initialize_application_operations();

CREATE OR REPLACE FUNCTION plugin_data.csf_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'CSF audit events are immutable.';
END;
$$;

CREATE TRIGGER csf_admin_audit_events_immutable
BEFORE UPDATE OR DELETE ON plugin_data.csf_admin_audit_events
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_reject_audit_mutation();

CREATE OR REPLACE FUNCTION plugin_data.csf_set_application_check(
  p_organization_id uuid,
  p_application_id uuid,
  p_check_type text,
  p_status text,
  p_reason_code text,
  p_summary text,
  p_details jsonb,
  p_actor_user_id uuid,
  p_override_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_before plugin_data.csf_application_checks%ROWTYPE;
  v_check plugin_data.csf_application_checks%ROWTYPE;
  v_check_type plugin_data.csf_application_check_type;
  v_status plugin_data.csf_application_check_status;
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
BEGIN
  BEGIN
    v_check_type := p_check_type::plugin_data.csf_application_check_type;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Unsupported application check type: %', p_check_type;
  END;

  BEGIN
    v_status := p_status::plugin_data.csf_application_check_status;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Unsupported application check status: %', p_status;
  END;

  IF coalesce(jsonb_typeof(p_details), 'null') <> 'object' THEN
    RAISE EXCEPTION 'Application check details must be a JSON object.';
  END IF;
  IF v_status = 'waived' AND nullif(btrim(coalesce(p_override_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A waiver requires an override reason.';
  END IF;
  IF v_status <> 'waived' AND nullif(btrim(coalesce(p_override_reason, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'An override reason is only valid for a waived check.';
  END IF;

  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF application not found.';
  END IF;

  SELECT check_row.*
  INTO v_before
  FROM plugin_data.csf_application_checks AS check_row
  WHERE check_row.organization_id = p_organization_id
    AND check_row.application_id = p_application_id
    AND check_row.check_type = v_check_type
  FOR UPDATE;

  INSERT INTO plugin_data.csf_application_checks (
    organization_id,
    application_id,
    check_type,
    status,
    mandatory,
    reason_code,
    summary,
    details,
    reviewed_by,
    reviewed_at,
    overridden_by,
    override_reason,
    overridden_at,
    updated_at
  )
  VALUES (
    p_organization_id,
    p_application_id,
    v_check_type,
    v_status,
    true,
    nullif(btrim(coalesce(p_reason_code, '')), ''),
    nullif(btrim(coalesce(p_summary, '')), ''),
    coalesce(p_details, '{}'::jsonb),
    p_actor_user_id,
    v_now,
    CASE WHEN v_status = 'waived' THEN p_actor_user_id END,
    CASE WHEN v_status = 'waived' THEN btrim(p_override_reason) END,
    CASE WHEN v_status = 'waived' THEN v_now END,
    v_now
  )
  ON CONFLICT (organization_id, application_id, check_type) DO UPDATE
  SET
    status = EXCLUDED.status,
    mandatory = true,
    reason_code = EXCLUDED.reason_code,
    summary = EXCLUDED.summary,
    details = EXCLUDED.details,
    reviewed_by = EXCLUDED.reviewed_by,
    reviewed_at = EXCLUDED.reviewed_at,
    overridden_by = EXCLUDED.overridden_by,
    override_reason = EXCLUDED.override_reason,
    overridden_at = EXCLUDED.overridden_at,
    updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_check;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  )
  VALUES (
    p_organization_id,
    p_actor_user_id,
    'application.check.set',
    'csf_term_applications',
    p_application_id,
    v_application.term_id,
    CASE WHEN v_before.id IS NULL THEN NULL ELSE jsonb_build_object(
      'checkType', v_before.check_type,
      'status', v_before.status,
      'reasonCode', v_before.reason_code
    ) END,
    jsonb_build_object(
      'checkId', v_check.id,
      'checkType', v_check.check_type,
      'status', v_check.status,
      'reasonCode', v_check.reason_code,
      'adviserOverride', v_check.overridden_by IS NOT NULL
    ),
    v_correlation_id,
    'application_review',
    p_application_id::text,
    nullif(btrim(coalesce(p_reason_code, '')), '')
  );

  RETURN jsonb_build_object(
    'applicationId', p_application_id,
    'checkId', v_check.id,
    'checkType', v_check.check_type,
    'status', v_check.status,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_application_dues(
  p_organization_id uuid,
  p_application_id uuid,
  p_status text,
  p_paid_amount numeric,
  p_waiver_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_before plugin_data.csf_dues_records%ROWTYPE;
  v_dues plugin_data.csf_dues_records%ROWTYPE;
  v_status plugin_data.csf_dues_status;
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
BEGIN
  BEGIN
    v_status := p_status::plugin_data.csf_dues_status;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Unsupported dues status: %', p_status;
  END;

  IF p_paid_amount IS NOT NULL AND p_paid_amount < 0 THEN
    RAISE EXCEPTION 'Paid dues amount cannot be negative.';
  END IF;
  IF v_status = 'waived' AND nullif(btrim(coalesce(p_waiver_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Waived dues require a reason.';
  END IF;
  IF v_status <> 'waived' AND nullif(btrim(coalesce(p_waiver_reason, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'A waiver reason is only valid when dues are waived.';
  END IF;

  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF application not found.';
  END IF;

  SELECT policy.*
  INTO v_policy
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = v_application.term_id;

  IF v_status = 'not_required' AND coalesce(v_policy.dues_required, true) THEN
    RAISE EXCEPTION 'Dues are required by this term policy.';
  END IF;

  SELECT dues.*
  INTO v_before
  FROM plugin_data.csf_dues_records AS dues
  WHERE dues.organization_id = p_organization_id
    AND dues.application_id = p_application_id
  FOR UPDATE;

  INSERT INTO plugin_data.csf_dues_records (
    organization_id,
    application_id,
    profile_id,
    term_id,
    status,
    required_amount,
    paid_amount,
    currency,
    source,
    source_ref,
    submitted_at,
    verified_by,
    verified_at,
    waived_by,
    waived_at,
    waiver_reason,
    updated_at
  )
  VALUES (
    p_organization_id,
    p_application_id,
    v_application.profile_id,
    v_application.term_id,
    v_status,
    CASE WHEN v_status = 'not_required' THEN 0 ELSE coalesce(v_policy.dues_amount, 5) END,
    CASE WHEN v_status = 'verified' THEN coalesce(p_paid_amount, v_policy.dues_amount, 5) ELSE p_paid_amount END,
    coalesce(v_policy.dues_currency, 'USD'),
    'manual',
    jsonb_build_object('updatedBy', p_actor_user_id, 'correlationId', v_correlation_id),
    CASE WHEN v_status = 'receipt_submitted' THEN v_now ELSE v_before.submitted_at END,
    CASE WHEN v_status = 'verified' THEN p_actor_user_id END,
    CASE WHEN v_status = 'verified' THEN v_now END,
    CASE WHEN v_status = 'waived' THEN p_actor_user_id END,
    CASE WHEN v_status = 'waived' THEN v_now END,
    CASE WHEN v_status = 'waived' THEN btrim(p_waiver_reason) END,
    v_now
  )
  ON CONFLICT (organization_id, application_id) DO UPDATE
  SET
    status = EXCLUDED.status,
    required_amount = EXCLUDED.required_amount,
    paid_amount = EXCLUDED.paid_amount,
    currency = EXCLUDED.currency,
    source = EXCLUDED.source,
    source_ref = plugin_data.csf_dues_records.source_ref || EXCLUDED.source_ref,
    submitted_at = EXCLUDED.submitted_at,
    verified_by = EXCLUDED.verified_by,
    verified_at = EXCLUDED.verified_at,
    waived_by = EXCLUDED.waived_by,
    waived_at = EXCLUDED.waived_at,
    waiver_reason = EXCLUDED.waiver_reason,
    updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_dues;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  )
  VALUES (
    p_organization_id,
    p_actor_user_id,
    'application.dues.set',
    'csf_term_applications',
    p_application_id,
    v_application.term_id,
    CASE WHEN v_before.id IS NULL THEN NULL ELSE jsonb_build_object(
      'duesId', v_before.id,
      'status', v_before.status,
      'paidAmount', v_before.paid_amount
    ) END,
    jsonb_build_object(
      'duesId', v_dues.id,
      'status', v_dues.status,
      'paidAmount', v_dues.paid_amount,
      'requiredAmount', v_dues.required_amount
    ),
    v_correlation_id,
    'application_review',
    p_application_id::text,
    CASE v_status WHEN 'waived' THEN 'dues_waived' WHEN 'verified' THEN 'dues_verified' ELSE 'dues_status_changed' END
  );

  RETURN jsonb_build_object(
    'applicationId', p_application_id,
    'duesId', v_dues.id,
    'status', v_dues.status,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_assign_application(
  p_organization_id uuid,
  p_application_id uuid,
  p_assignee_user_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
BEGIN
  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF application not found.';
  END IF;

  IF p_assignee_user_id IS NOT NULL AND NOT (
    EXISTS (
      SELECT 1
      FROM plugin_data.csf_staff_positions AS position
      WHERE position.organization_id = p_organization_id
        AND position.user_id = p_assignee_user_id
        AND position.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = p_assignee_user_id
        AND member.status = 'active'
        AND member.role IN ('admin', 'staff')
    )
    OR EXISTS (
      SELECT 1 FROM auth.users AS actor
      WHERE actor.id = p_assignee_user_id
        AND lower(actor.email) = 'dvhighcsf@gmail.com'
    )
  ) THEN
    RAISE EXCEPTION 'The assignee is not active CSF staff for this organization.';
  END IF;

  UPDATE plugin_data.csf_term_applications
  SET
    assigned_to = p_assignee_user_id,
    assigned_by = p_actor_user_id,
    assigned_at = CASE WHEN p_assignee_user_id IS NULL THEN NULL ELSE v_now END,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_application_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  )
  VALUES (
    p_organization_id,
    p_actor_user_id,
    'application.assign',
    'csf_term_applications',
    p_application_id,
    v_application.term_id,
    jsonb_build_object('assignedTo', v_application.assigned_to),
    jsonb_build_object('assignedTo', p_assignee_user_id),
    v_correlation_id,
    'application_review',
    p_application_id::text,
    CASE WHEN p_assignee_user_id IS NULL THEN 'unassigned' ELSE 'assigned' END
  );

  RETURN jsonb_build_object(
    'applicationId', p_application_id,
    'assignedTo', p_assignee_user_id,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_add_application_private_note(
  p_organization_id uuid,
  p_application_id uuid,
  p_body text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_note_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF nullif(btrim(coalesce(p_body, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A private note cannot be empty.';
  END IF;

  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF application not found.';
  END IF;

  INSERT INTO plugin_data.csf_application_private_notes (
    organization_id,
    application_id,
    note_type,
    body,
    author_user_id
  )
  VALUES (
    p_organization_id,
    p_application_id,
    'general',
    btrim(p_body),
    p_actor_user_id
  )
  RETURNING id INTO v_note_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  )
  VALUES (
    p_organization_id,
    p_actor_user_id,
    'application.private_note.add',
    'csf_term_applications',
    p_application_id,
    v_application.term_id,
    jsonb_build_object('noteId', v_note_id, 'noteType', 'general'),
    v_correlation_id,
    'application_review',
    p_application_id::text,
    'private_note_added'
  );

  RETURN jsonb_build_object(
    'applicationId', p_application_id,
    'noteId', v_note_id,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_decide_term_application(
  p_organization_id uuid,
  p_application_id uuid,
  p_decision text,
  p_review_notes text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_previous_status text;
  v_membership_status text;
  v_linked_user_id uuid;
  v_dues plugin_data.csf_dues_records%ROWTYPE;
  v_required_check_count integer := 0;
  v_unresolved_check_count integer := 0;
  v_checks jsonb := '{}'::jsonb;
  v_reason_code plugin_data.csf_application_reason_code;
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
BEGIN
  IF p_decision NOT IN ('accepted', 'rejected', 'needs_action') THEN
    RAISE EXCEPTION 'Unsupported CSF application decision: %', p_decision;
  END IF;

  IF p_decision IN ('rejected', 'needs_action')
    AND nullif(btrim(coalesce(p_review_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Review notes are required for this decision.';
  END IF;

  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF application not found.';
  END IF;

  v_previous_status := v_application.status;

  SELECT
    count(*) FILTER (WHERE mandatory),
    count(*) FILTER (
      WHERE mandatory
        AND status NOT IN ('passed', 'waived', 'not_required')
    ),
    coalesce(jsonb_object_agg(check_type::text, status::text), '{}'::jsonb)
  INTO v_required_check_count, v_unresolved_check_count, v_checks
  FROM plugin_data.csf_application_checks
  WHERE organization_id = p_organization_id
    AND application_id = p_application_id;

  SELECT dues.*
  INTO v_dues
  FROM plugin_data.csf_dues_records AS dues
  WHERE dues.organization_id = p_organization_id
    AND dues.application_id = p_application_id
  FOR UPDATE;

  IF p_decision = 'accepted' THEN
    IF v_required_check_count <> 6 THEN
      RAISE EXCEPTION 'Application review is incomplete: all mandatory checks must exist.';
    END IF;
    IF v_unresolved_check_count > 0 THEN
      RAISE EXCEPTION 'Application review is incomplete: % mandatory check(s) remain unresolved.', v_unresolved_check_count;
    END IF;
    IF v_application.eligibility_status NOT IN ('eligible', 'adviser_override') THEN
      RAISE EXCEPTION 'Application cannot be accepted without eligible or adviser-overridden academic status.';
    END IF;
    IF v_dues.id IS NULL OR v_dues.status NOT IN ('verified', 'waived', 'not_required') THEN
      RAISE EXCEPTION 'Application cannot be accepted until dues are verified, waived, or not required.';
    END IF;
  END IF;

  IF p_decision = 'rejected' AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.profile_id = v_application.profile_id
      AND membership.term_id = v_application.term_id
      AND membership.status IN ('active', 'completed', 'not_completed')
  ) THEN
    RAISE EXCEPTION 'An active or closed term membership cannot be rejected.';
  END IF;

  v_reason_code := CASE
    WHEN p_decision = 'accepted' AND v_application.eligibility_status = 'adviser_override'
      THEN 'approved_adviser_override'::plugin_data.csf_application_reason_code
    WHEN p_decision = 'accepted'
      THEN 'approved_standard'::plugin_data.csf_application_reason_code
    WHEN p_decision = 'needs_action'
      THEN 'missing_information'::plugin_data.csf_application_reason_code
    ELSE coalesce(v_application.decision_reason_code, 'other'::plugin_data.csf_application_reason_code)
  END;

  UPDATE plugin_data.csf_term_applications
  SET
    status = p_decision,
    submission_status = CASE p_decision
      WHEN 'accepted' THEN 'decided'::plugin_data.csf_application_submission_status
      WHEN 'rejected' THEN 'decided'::plugin_data.csf_application_submission_status
      ELSE 'missing_information'::plugin_data.csf_application_submission_status
    END,
    decision_status = CASE p_decision
      WHEN 'accepted' THEN 'approved'::plugin_data.csf_application_decision_status
      WHEN 'rejected' THEN 'rejected'::plugin_data.csf_application_decision_status
      ELSE 'pending'::plugin_data.csf_application_decision_status
    END,
    decision_reason_code = v_reason_code,
    decision_reason = nullif(btrim(coalesce(p_review_notes, '')), ''),
    decision_correlation_id = v_correlation_id,
    reviewed_by = p_actor_user_id,
    reviewed_at = v_now,
    review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''),
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_application_id;

  IF p_decision = 'accepted' THEN
    INSERT INTO plugin_data.csf_term_memberships (
      organization_id,
      profile_id,
      term_id,
      cohort_id,
      application_id,
      status,
      status_reason,
      eligibility_snapshot,
      accepted_at,
      updated_at
    )
    VALUES (
      p_organization_id,
      v_application.profile_id,
      v_application.term_id,
      v_application.cohort_id,
      v_application.id,
      'accepted',
      nullif(btrim(coalesce(p_review_notes, '')), ''),
      jsonb_build_object(
        'applicationDecision', 'approved',
        'eligibilityStatus', v_application.eligibility_status,
        'checks', v_checks,
        'duesStatus', v_dues.status,
        'currentGradeLevel', v_application.current_grade_level,
        'returningStatus', v_application.returning_status,
        'listIPoints', v_application.list_i_points,
        'listIAndIIPoints', v_application.list_i_ii_points,
        'grandTotalPoints', v_application.grand_total_points,
        'correlationId', v_correlation_id,
        'capturedAt', v_now
      ),
      v_now,
      v_now
    )
    ON CONFLICT (organization_id, profile_id, term_id) DO UPDATE
    SET
      cohort_id = EXCLUDED.cohort_id,
      application_id = EXCLUDED.application_id,
      status = CASE
        WHEN plugin_data.csf_term_memberships.status IN ('active', 'completed', 'not_completed')
          THEN plugin_data.csf_term_memberships.status
        ELSE 'accepted'
      END,
      status_reason = EXCLUDED.status_reason,
      eligibility_snapshot = EXCLUDED.eligibility_snapshot,
      accepted_at = coalesce(plugin_data.csf_term_memberships.accepted_at, EXCLUDED.accepted_at),
      updated_at = EXCLUDED.updated_at;

    SELECT account.user_id
    INTO v_linked_user_id
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = v_application.profile_id
      AND account.status = 'verified'
    ORDER BY account.is_primary DESC, account.linked_at DESC
    LIMIT 1;

    IF v_linked_user_id IS NOT NULL THEN
      INSERT INTO public.organization_members (
        organization_id,
        user_id,
        role,
        status,
        is_visible,
        joined_at
      )
      VALUES (
        p_organization_id,
        v_linked_user_id,
        'member',
        'active',
        false,
        v_now
      )
      ON CONFLICT (organization_id, user_id) DO UPDATE
      SET status = 'active';
    END IF;
  ELSIF p_decision = 'rejected' THEN
    UPDATE plugin_data.csf_term_memberships
    SET
      status = 'revoked',
      status_reason = btrim(p_review_notes),
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND profile_id = v_application.profile_id
      AND term_id = v_application.term_id
      AND status IN ('pending', 'accepted');
  ELSE
    UPDATE plugin_data.csf_term_memberships
    SET
      status = 'pending',
      status_reason = btrim(p_review_notes),
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND profile_id = v_application.profile_id
      AND term_id = v_application.term_id
      AND status IN ('pending', 'accepted');
  END IF;

  SELECT membership.status
  INTO v_membership_status
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = v_application.profile_id
    AND membership.term_id = v_application.term_id;

  INSERT INTO plugin_data.csf_application_status_events (
    organization_id,
    application_id,
    actor_user_id,
    previous_status,
    next_status,
    reason,
    reason_code,
    correlation_id,
    details
  )
  VALUES (
    p_organization_id,
    p_application_id,
    p_actor_user_id,
    v_previous_status,
    p_decision,
    nullif(btrim(coalesce(p_review_notes, '')), ''),
    v_reason_code,
    v_correlation_id,
    jsonb_build_object(
      'eligibilityStatus', v_application.eligibility_status,
      'checks', v_checks,
      'duesStatus', v_dues.status,
      'termMembershipStatus', v_membership_status
    )
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  )
  VALUES (
    p_organization_id,
    p_actor_user_id,
    'application.' || p_decision,
    'csf_term_applications',
    p_application_id,
    v_application.term_id,
    jsonb_build_object(
      'legacyStatus', v_previous_status,
      'submissionStatus', v_application.submission_status,
      'decisionStatus', v_application.decision_status
    ),
    jsonb_build_object(
      'legacyStatus', p_decision,
      'submissionStatus', CASE WHEN p_decision = 'needs_action' THEN 'missing_information' ELSE 'decided' END,
      'decisionStatus', CASE p_decision WHEN 'accepted' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END,
      'eligibilityStatus', v_application.eligibility_status,
      'checks', v_checks,
      'duesStatus', v_dues.status,
      'reviewNotes', nullif(btrim(coalesce(p_review_notes, '')), ''),
      'termMembershipStatus', v_membership_status,
      'platformMemberUserId', v_linked_user_id
    ),
    v_correlation_id,
    'application_review',
    p_application_id::text,
    v_reason_code::text
  );

  RETURN jsonb_build_object(
    'applicationId', p_application_id,
    'applicationStatus', p_decision,
    'decisionStatus', CASE p_decision WHEN 'accepted' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END,
    'eligibilityStatus', v_application.eligibility_status,
    'duesStatus', v_dues.status,
    'termMembershipStatus', v_membership_status,
    'platformMemberUserId', v_linked_user_id,
    'correlationId', v_correlation_id
  );
END;
$$;

ALTER TABLE plugin_data.csf_application_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_dues_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_application_private_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_term_deadlines ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  plugin_data.csf_application_checks,
  plugin_data.csf_dues_records,
  plugin_data.csf_application_private_notes,
  plugin_data.csf_term_deadlines
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE
  plugin_data.csf_application_checks,
  plugin_data.csf_dues_records,
  plugin_data.csf_application_private_notes,
  plugin_data.csf_term_deadlines
TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_set_application_check(uuid, uuid, text, text, text, text, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_application_check(uuid, uuid, text, text, text, text, jsonb, uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_set_application_dues(uuid, uuid, text, numeric, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_application_dues(uuid, uuid, text, numeric, text, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assign_application(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assign_application(uuid, uuid, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_add_application_private_note(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_add_application_private_note(uuid, uuid, text, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_validate_application_check() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_sync_application_check_state() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_sync_dues_check() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_initialize_application_operations() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_reject_audit_mutation() FROM PUBLIC, anon, authenticated;

CREATE INDEX csf_term_applications_review_queue_idx
  ON plugin_data.csf_term_applications (
    organization_id,
    term_id,
    submission_status,
    decision_status,
    assigned_to,
    updated_at DESC
  );
CREATE INDEX csf_term_applications_source_import_job_idx
  ON plugin_data.csf_term_applications (organization_id, source_import_job_id)
  WHERE source_import_job_id IS NOT NULL;
CREATE INDEX csf_term_applications_source_import_row_idx
  ON plugin_data.csf_term_applications (organization_id, source_import_row_id)
  WHERE source_import_row_id IS NOT NULL;
CREATE INDEX csf_application_status_events_correlation_idx
  ON plugin_data.csf_application_status_events (organization_id, correlation_id, created_at);
CREATE INDEX csf_admin_audit_events_correlation_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id, created_at);
CREATE INDEX csf_sheet_import_jobs_retry_idx
  ON plugin_data.csf_sheet_import_jobs (organization_id, retry_of_job_id, created_at DESC)
  WHERE retry_of_job_id IS NOT NULL;
CREATE INDEX csf_sheet_import_rows_resolution_idx
  ON plugin_data.csf_sheet_import_rows (organization_id, job_id, resolution_status, import_status);

COMMENT ON TABLE plugin_data.csf_application_checks IS
  'Normalized, reviewable application gates. An approval requires every mandatory check to be passed, waived, or not required.';
COMMENT ON TABLE plugin_data.csf_dues_records IS
  'Term-scoped CSF dues evidence and officer verification, separate from academic eligibility and application decision.';
COMMENT ON TABLE plugin_data.csf_application_private_notes IS
  'Officer-only application notes. Notes are never included in member/public read models.';
COMMENT ON TABLE plugin_data.csf_term_deadlines IS
  'Operational application, dues, meeting, points, and semester-close deadlines for one CSF term.';
COMMENT ON FUNCTION plugin_data.csf_set_application_check(uuid, uuid, text, text, text, text, jsonb, uuid, text) IS
  'Atomically writes one normalized application check and its correlated immutable audit event.';
COMMENT ON FUNCTION plugin_data.csf_set_application_dues(uuid, uuid, text, numeric, text, uuid) IS
  'Atomically updates one application dues record, synchronizes the dues check, and writes immutable audit history.';
COMMENT ON FUNCTION plugin_data.csf_assign_application(uuid, uuid, uuid, uuid) IS
  'Atomically assigns or unassigns an application to active CSF staff and audits the change.';
COMMENT ON FUNCTION plugin_data.csf_add_application_private_note(uuid, uuid, text, uuid) IS
  'Atomically adds an officer-only application note and a content-free immutable audit reference.';
COMMENT ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid) IS
  'Atomically enforces mandatory application checks, records the decision, synchronizes membership, and writes correlated immutable history.';

COMMIT;
