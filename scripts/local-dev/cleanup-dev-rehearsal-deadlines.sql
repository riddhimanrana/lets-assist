-- One-off cleanup for the hosted Development Supabase database only.
-- The "Development rehearsal: …" deadlines and meetings visible on the Terms
-- page are hand-entered rehearsal rows from the Fall 2026 operator-guide
-- walkthrough, not seeded fixtures. This is environment data, so it is cleaned
-- with a reviewed one-off statement rather than a migration (the migration
-- ledger is append-only schema history).
--
-- Run against hosted Development only, never Production. Review the SELECTs
-- before running the DELETEs.

SELECT id, title, due_at
FROM plugin_data.csf_term_deadlines
WHERE title LIKE 'Development rehearsal:%';

SELECT id, label, meeting_date
FROM plugin_data.csf_term_meetings
WHERE label LIKE 'Development rehearsal:%';

-- DELETE FROM plugin_data.csf_term_deadlines
--   WHERE title LIKE 'Development rehearsal:%';
-- DELETE FROM plugin_data.csf_term_meetings
--   WHERE label LIKE 'Development rehearsal:%';
