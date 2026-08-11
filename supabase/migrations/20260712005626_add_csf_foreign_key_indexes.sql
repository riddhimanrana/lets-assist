-- One concurrent index per migration keeps Supabase CLI execution out of a
-- pipeline and avoids write locks on the CSF table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS csf_announcements_created_by_idx ON plugin_data.csf_announcements (created_by);
