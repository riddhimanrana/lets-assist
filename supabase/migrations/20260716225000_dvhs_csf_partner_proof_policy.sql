-- Proof requirements belong to a partner club's semester-specific policy,
-- alongside point type and caps, rather than to the permanent club identity.

BEGIN;

ALTER TABLE plugin_data.csf_partner_club_terms
  ADD COLUMN IF NOT EXISTS proof_required boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN plugin_data.csf_partner_club_terms.proof_required IS
  'Whether member point submissions for this partner club and semester require one private proof file.';

COMMIT;
