-- Add explicit scheduling/editor metadata for the plugin-backed communications surface.

BEGIN;

ALTER TABLE plugin_data.csf_announcements
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE plugin_data.csf_announcements
SET scheduled_for = coalesce(scheduled_for, created_at)
WHERE status = 'scheduled' AND scheduled_for IS NULL;

ALTER TABLE plugin_data.csf_announcements
  DROP CONSTRAINT IF EXISTS csf_announcements_scheduled_time_check;
ALTER TABLE plugin_data.csf_announcements
  ADD CONSTRAINT csf_announcements_scheduled_time_check
  CHECK (status <> 'scheduled' OR scheduled_for IS NOT NULL);

CREATE INDEX IF NOT EXISTS csf_announcements_schedule_idx
  ON plugin_data.csf_announcements (organization_id, status, scheduled_for)
  WHERE status = 'scheduled';

COMMENT ON COLUMN plugin_data.csf_announcements.scheduled_for IS
  'Officer-selected publish time for a scheduled private or public announcement.';

COMMIT;
