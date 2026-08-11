-- Canonical partner-club identity/term policy and one-proof-per-activity rules.

BEGIN;

CREATE TABLE IF NOT EXISTS plugin_data.csf_partner_club_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  partner_club_id uuid NOT NULL REFERENCES plugin_data.csf_partner_clubs(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  source text NOT NULL DEFAULT 'staff'
    CHECK (source IN ('staff', 'form', 'sheet', 'legacy_import')),
  first_seen_term_id uuid REFERENCES plugin_data.csf_terms(id) ON DELETE SET NULL,
  last_seen_term_id uuid REFERENCES plugin_data.csf_terms(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS csf_partner_club_aliases_club_idx
  ON plugin_data.csf_partner_club_aliases (organization_id, partner_club_id, created_at);

CREATE TABLE IF NOT EXISTS plugin_data.csf_partner_club_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  partner_club_id uuid NOT NULL REFERENCES plugin_data.csf_partner_clubs(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  relationship_status text NOT NULL
    CHECK (relationship_status IN ('new', 'returning')),
  workflow_status text NOT NULL DEFAULT 'active'
    CHECK (workflow_status IN ('pending', 'active', 'inactive', 'rejected', 'archived')),
  approved_point_types text[] NOT NULL DEFAULT ARRAY['non_drive']::text[],
  non_drive_points numeric(6,2) NOT NULL DEFAULT 0 CHECK (non_drive_points >= 0),
  drive_points numeric(6,2) NOT NULL DEFAULT 0 CHECK (drive_points >= 0),
  allocation_satisfied boolean,
  policy_notes text,
  source_batch_id uuid REFERENCES plugin_data.csf_partner_submission_batches(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, partner_club_id, term_id)
);

CREATE INDEX IF NOT EXISTS csf_partner_club_terms_org_term_idx
  ON plugin_data.csf_partner_club_terms (organization_id, term_id, workflow_status, partner_club_id);

INSERT INTO plugin_data.csf_partner_club_aliases (
  organization_id,
  partner_club_id,
  alias,
  normalized_alias,
  source,
  created_by
)
SELECT
  club.organization_id,
  club.id,
  club.name,
  lower(regexp_replace(btrim(club.name), '\s+', ' ', 'g')),
  'legacy_import',
  club.created_by
FROM plugin_data.csf_partner_clubs AS club
ON CONFLICT (organization_id, normalized_alias) DO NOTHING;

ALTER TABLE plugin_data.csf_point_submissions
  ADD COLUMN IF NOT EXISTS activity_date date;

CREATE UNIQUE INDEX IF NOT EXISTS csf_point_submissions_one_active_activity_claim_idx
  ON plugin_data.csf_point_submissions (organization_id, profile_id, term_id, opportunity_id)
  WHERE opportunity_id IS NOT NULL
    AND status NOT IN ('rejected', 'duplicate', 'withdrawn');

CREATE UNIQUE INDEX IF NOT EXISTS csf_submission_files_one_proof_idx
  ON plugin_data.csf_submission_files (submission_id);

CREATE UNIQUE INDEX IF NOT EXISTS csf_credit_records_one_submission_award_idx
  ON plugin_data.csf_credit_records (submission_id)
  WHERE submission_id IS NOT NULL;

ALTER TABLE plugin_data.csf_partner_club_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_partner_club_terms ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE plugin_data.csf_partner_club_aliases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE plugin_data.csf_partner_club_terms FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_partner_club_aliases TO service_role;
GRANT ALL ON TABLE plugin_data.csf_partner_club_terms TO service_role;

COMMENT ON TABLE plugin_data.csf_partner_club_aliases IS
  'Audited aliases that map historical/form names to one canonical partner-club record.';
COMMENT ON TABLE plugin_data.csf_partner_club_terms IS
  'Per-term partner-club relationship, point policy, allocation decision, and source audit link.';
COMMENT ON INDEX plugin_data.csf_submission_files_one_proof_idx IS
  'A CSF activity claim has at most one private proof object; awarded points are stored on its one credit record.';

COMMIT;
