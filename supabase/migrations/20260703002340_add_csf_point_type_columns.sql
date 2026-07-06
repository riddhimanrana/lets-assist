-- Keep already-applied DVHS CSF databases compatible with the point-submission
-- UI added after the original foundation migration. This migration is
-- intentionally idempotent because some local databases may already include
-- these columns from a full reset while others only have the earlier table
-- shape.

ALTER TABLE IF EXISTS plugin_data.csf_point_submissions
  ADD COLUMN IF NOT EXISTS point_type text;

UPDATE plugin_data.csf_point_submissions
SET point_type = 'non_drive'
WHERE point_type IS NULL
  OR point_type NOT IN ('non_drive', 'drive');

ALTER TABLE IF EXISTS plugin_data.csf_point_submissions
  ALTER COLUMN point_type SET DEFAULT 'non_drive',
  ALTER COLUMN point_type SET NOT NULL;

ALTER TABLE IF EXISTS plugin_data.csf_point_submissions
  DROP CONSTRAINT IF EXISTS csf_point_submissions_point_type_check;

ALTER TABLE IF EXISTS plugin_data.csf_point_submissions
  ADD CONSTRAINT csf_point_submissions_point_type_check
  CHECK (point_type IN ('non_drive', 'drive'));

UPDATE plugin_data.csf_credit_records
SET point_type = CASE WHEN point_type = 'drive' THEN 'drive' ELSE 'non_drive' END
WHERE point_type IS NULL
  OR point_type NOT IN ('non_drive', 'drive');

ALTER TABLE IF EXISTS plugin_data.csf_credit_records
  ALTER COLUMN point_type SET DEFAULT 'non_drive',
  ALTER COLUMN point_type SET NOT NULL;

ALTER TABLE IF EXISTS plugin_data.csf_credit_records
  DROP CONSTRAINT IF EXISTS csf_credit_records_point_type_check;

ALTER TABLE IF EXISTS plugin_data.csf_credit_records
  ADD CONSTRAINT csf_credit_records_point_type_check
  CHECK (point_type IN ('non_drive', 'drive'));

CREATE INDEX IF NOT EXISTS csf_point_submissions_org_term_type_status_idx
  ON plugin_data.csf_point_submissions (organization_id, term_id, point_type, status);

CREATE INDEX IF NOT EXISTS csf_credit_records_org_term_type_status_idx
  ON plugin_data.csf_credit_records (organization_id, term_id, point_type, status);
