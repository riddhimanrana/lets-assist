-- Officer review campaigns.
--
-- Point verification and club-audit verification are the same operation at two
-- levels: an administrator opens a bounded period, the roster is split into
-- contiguous ranges among reviewing officers, and each officer records one
-- decision per subject with an auditable note trail.
--
-- A subject is either a CSF profile (member point verification) or a partner
-- club (club application verification). Both share these tables so the two
-- campaigns cannot drift apart operationally.
--
-- While a member_points period is open the term's student-entered point
-- submissions are frozen, so an officer never reviews a row that changes
-- underneath them. An officer may lift the freeze for one member at a time
-- with a recorded reason.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Types
-- ---------------------------------------------------------------------------

CREATE TYPE plugin_data.csf_review_period_kind AS ENUM (
  'member_points',
  'club_audit'
);

CREATE TYPE plugin_data.csf_review_period_status AS ENUM (
  'draft',
  'open',
  'closed'
);

CREATE TYPE plugin_data.csf_review_decision_state AS ENUM (
  'pending',
  'approved',
  'rejected'
);

CREATE TYPE plugin_data.csf_review_subject_kind AS ENUM (
  'profile',
  'partner_club'
);

-- ---------------------------------------------------------------------------
-- B. Periods
--
-- One period per organization, term, and kind. The unique constraint is what
-- makes "is verification open right now?" a single-row question rather than a
-- scan, and it stops two administrators opening competing campaigns.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_review_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid NOT NULL,
  kind plugin_data.csf_review_period_kind NOT NULL,
  status plugin_data.csf_review_period_status NOT NULL DEFAULT 'draft',
  title text NOT NULL CHECK (nullif(btrim(title), '') IS NOT NULL),
  instructions text,
  opens_at timestamptz,
  closes_at timestamptz,
  opened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  opened_at timestamptz,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_review_periods_id_organization_id_key UNIQUE (id, organization_id),
  CONSTRAINT csf_review_periods_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_review_periods_term_kind_key UNIQUE (organization_id, term_id, kind),
  CONSTRAINT csf_review_periods_opened_check CHECK (
    status = 'draft' OR (opened_at IS NOT NULL AND opened_by IS NOT NULL)
  ),
  CONSTRAINT csf_review_periods_closed_check CHECK (
    status <> 'closed' OR (closed_at IS NOT NULL AND closed_by IS NOT NULL)
  ),
  CONSTRAINT csf_review_periods_window_check CHECK (
    opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at
  )
);

CREATE INDEX csf_review_periods_open_idx
  ON plugin_data.csf_review_periods (organization_id, kind, status, term_id);

-- ---------------------------------------------------------------------------
-- C. Range assignments
--
-- Contiguous, non-overlapping slices of one alphabetically ordered roster.
-- Ranges are always rewritten as a complete set by csf_assign_review_ranges,
-- which is what keeps them non-overlapping; a partial hand edit is not a
-- supported write path.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_review_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_id uuid NOT NULL,
  cohort_id uuid,
  reviewer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_index integer NOT NULL CHECK (start_index >= 1),
  end_index integer NOT NULL,
  from_label text NOT NULL,
  to_label text NOT NULL,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_review_assignments_period_organization_fkey
    FOREIGN KEY (period_id, organization_id)
    REFERENCES plugin_data.csf_review_periods (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_review_assignments_range_check CHECK (end_index >= start_index)
);

CREATE INDEX csf_review_assignments_period_idx
  ON plugin_data.csf_review_assignments (organization_id, period_id, cohort_id, start_index);

CREATE INDEX csf_review_assignments_reviewer_idx
  ON plugin_data.csf_review_assignments (organization_id, reviewer_user_id, period_id);

-- ---------------------------------------------------------------------------
-- D. Decisions
--
-- One row per subject per period. `submission_lock_override` is the per-member
-- escape hatch from the freeze in section F: an officer opens one member back
-- up, with a reason, without reopening the whole campaign.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_id uuid NOT NULL,
  subject_kind plugin_data.csf_review_subject_kind NOT NULL,
  subject_id uuid NOT NULL,
  decision plugin_data.csf_review_decision_state NOT NULL DEFAULT 'pending',
  reason text,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  submission_lock_override boolean NOT NULL DEFAULT false,
  override_reason text,
  override_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  override_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_review_decisions_id_organization_id_key UNIQUE (id, organization_id),
  CONSTRAINT csf_review_decisions_period_organization_fkey
    FOREIGN KEY (period_id, organization_id)
    REFERENCES plugin_data.csf_review_periods (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_review_decisions_subject_key
    UNIQUE (organization_id, period_id, subject_kind, subject_id),
  CONSTRAINT csf_review_decisions_decided_check CHECK (
    decision = 'pending' OR (decided_at IS NOT NULL AND decided_by IS NOT NULL)
  ),
  CONSTRAINT csf_review_decisions_rejection_reason_check CHECK (
    decision <> 'rejected' OR nullif(btrim(reason), '') IS NOT NULL
  ),
  CONSTRAINT csf_review_decisions_override_check CHECK (
    submission_lock_override = false
    OR (
      override_at IS NOT NULL
      AND override_by IS NOT NULL
      AND nullif(btrim(override_reason), '') IS NOT NULL
    )
  )
);

CREATE INDEX csf_review_decisions_period_state_idx
  ON plugin_data.csf_review_decisions (organization_id, period_id, decision, subject_kind);

CREATE INDEX csf_review_decisions_subject_idx
  ON plugin_data.csf_review_decisions (organization_id, subject_kind, subject_id);

-- ---------------------------------------------------------------------------
-- E. Notes
--
-- Officer-visible only. Redaction mirrors csf_application_private_notes so the
-- two note surfaces behave identically for the same staff.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_review_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_id uuid NOT NULL,
  subject_kind plugin_data.csf_review_subject_kind NOT NULL,
  subject_id uuid NOT NULL,
  body text NOT NULL CHECK (nullif(btrim(body), '') IS NOT NULL),
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  redacted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  redacted_at timestamptz,
  redaction_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_review_notes_period_organization_fkey
    FOREIGN KEY (period_id, organization_id)
    REFERENCES plugin_data.csf_review_periods (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_review_notes_redaction_check CHECK (
    (redacted_at IS NULL AND redacted_by IS NULL AND redaction_reason IS NULL)
    OR
    (redacted_at IS NOT NULL AND redacted_by IS NOT NULL AND nullif(btrim(redaction_reason), '') IS NOT NULL)
  )
);

CREATE INDEX csf_review_notes_subject_idx
  ON plugin_data.csf_review_notes (organization_id, period_id, subject_kind, subject_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- F. Submission freeze
--
-- Once member point verification is open, the student-owned rows for that term
-- stop moving. Officer- and staff-sourced corrections still pass, because that
-- is exactly the work the campaign exists to do.
--
-- The freeze is deliberately enforced in the database and not only in the
-- action layer: the whole point of the campaign is that the reviewed set is
-- stable, and a guard that lives only in application code is not that.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_point_submission_freeze()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_point_submissions%ROWTYPE;
  v_period plugin_data.csf_review_periods%ROWTYPE;
  v_override boolean;
BEGIN
  v_row := COALESCE(NEW, OLD);

  -- Only student-owned rows freeze. Staff corrections are the campaign's work.
  IF v_row.source <> 'student' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT *
    INTO v_period
    FROM plugin_data.csf_review_periods
   WHERE organization_id = v_row.organization_id
     AND term_id = v_row.term_id
     AND kind = 'member_points'
     AND status = 'open'
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT submission_lock_override
    INTO v_override
    FROM plugin_data.csf_review_decisions
   WHERE organization_id = v_row.organization_id
     AND period_id = v_period.id
     AND subject_kind = 'profile'
     AND subject_id = v_row.profile_id
   LIMIT 1;

  IF COALESCE(v_override, false) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION
    'Point verification is open for this term; this member''s submissions are locked.'
    USING ERRCODE = 'check_violation';
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_point_submission_freeze()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER csf_point_submissions_verification_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_point_submissions
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_enforce_point_submission_freeze();

-- ---------------------------------------------------------------------------
-- G. Row security and grants
--
-- These tables are never reachable from a browser client. RLS is defense in
-- depth behind the plugin's server-only access path, and only service_role
-- holds row privileges.
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_review_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_review_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_review_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  plugin_data.csf_review_periods,
  plugin_data.csf_review_assignments,
  plugin_data.csf_review_decisions,
  plugin_data.csf_review_notes
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  plugin_data.csf_review_periods,
  plugin_data.csf_review_assignments,
  plugin_data.csf_review_decisions,
  plugin_data.csf_review_notes
TO service_role;

-- ---------------------------------------------------------------------------
-- H. Comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE plugin_data.csf_review_periods IS
  'Administrator-gated verification campaigns: one per organization, term, and kind.';

COMMENT ON COLUMN plugin_data.csf_review_periods.status IS
  'draft hides the workspace; open unlocks reviewing and freezes student point submissions; closed is terminal for the term.';

COMMENT ON TABLE plugin_data.csf_review_assignments IS
  'Contiguous reviewer ranges over one alphabetically ordered roster, rewritten as a complete set.';

COMMENT ON TABLE plugin_data.csf_review_decisions IS
  'One approve/reject verdict per subject per period, plus the per-member submission-freeze override.';

COMMENT ON COLUMN plugin_data.csf_review_decisions.submission_lock_override IS
  'When true, this member may edit point submissions despite an open verification period. Requires a reason.';

COMMENT ON TABLE plugin_data.csf_review_notes IS
  'Officer-only note thread for one review subject, with the same redaction contract as application private notes.';

COMMIT;
