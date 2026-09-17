-- Directory pages resolve the latest dues record for each profile and term.
-- Keep these lookups on the profile key instead of scanning a term repeatedly.
CREATE INDEX csf_dues_records_profile_term_latest_idx
  ON plugin_data.csf_dues_records
    (organization_id, profile_id, term_id, updated_at DESC, id DESC)
  INCLUDE (status);
