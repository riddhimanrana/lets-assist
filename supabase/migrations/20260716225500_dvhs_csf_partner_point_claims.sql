-- Link member point submissions to the reviewed semester-specific partner-club
-- policy that authorized the claim.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS csf_partner_club_terms_org_id_unique_idx
  ON plugin_data.csf_partner_club_terms (organization_id, id);

ALTER TABLE plugin_data.csf_point_submissions
  ADD COLUMN IF NOT EXISTS partner_club_term_id uuid;

ALTER TABLE plugin_data.csf_point_submissions
  DROP CONSTRAINT IF EXISTS csf_point_submissions_partner_club_term_org_fkey;
ALTER TABLE plugin_data.csf_point_submissions
  ADD CONSTRAINT csf_point_submissions_partner_club_term_org_fkey
  FOREIGN KEY (organization_id, partner_club_term_id)
  REFERENCES plugin_data.csf_partner_club_terms (organization_id, id)
  ON DELETE RESTRICT;

ALTER TABLE plugin_data.csf_point_submissions
  DROP CONSTRAINT IF EXISTS csf_point_submissions_single_structured_source_check;
ALTER TABLE plugin_data.csf_point_submissions
  ADD CONSTRAINT csf_point_submissions_single_structured_source_check
  CHECK (num_nonnulls(opportunity_id, partner_club_term_id) <= 1);

CREATE INDEX IF NOT EXISTS csf_point_submissions_partner_club_term_idx
  ON plugin_data.csf_point_submissions (organization_id, partner_club_term_id, status)
  WHERE partner_club_term_id IS NOT NULL;

COMMENT ON COLUMN plugin_data.csf_point_submissions.partner_club_term_id IS
  'Reviewed semester-specific partner-club policy selected by the member for this claim.';

COMMIT;
