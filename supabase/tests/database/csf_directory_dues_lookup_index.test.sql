BEGIN;
SET search_path = public, extensions;
SELECT plan(3);

SELECT has_index(
  'plugin_data', 'csf_dues_records', 'csf_dues_records_profile_term_latest_idx',
  'Directory latest-dues reads have a profile and term scoped index'
);
SELECT is(
  pg_get_indexdef('plugin_data.csf_dues_records_profile_term_latest_idx'::regclass),
  'CREATE INDEX csf_dues_records_profile_term_latest_idx ON plugin_data.csf_dues_records USING btree (organization_id, profile_id, term_id, updated_at DESC, id DESC) INCLUDE (status)',
  'Index covers tenant, profile, term, deterministic recency, and returned status'
);
SELECT ok(
  (SELECT indisvalid AND indisready AND NOT indisunique
   FROM pg_index
   WHERE indexrelid = 'plugin_data.csf_dues_records_profile_term_latest_idx'::regclass),
  'Lookup index is ready and adds no uniqueness constraint'
);
SELECT * FROM finish();
ROLLBACK;
