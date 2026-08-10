-- Production cutover preflight.
--
-- Read-only. Every statement is a SELECT or a SHOW; nothing here writes.
-- Run against Production before the maintenance window and capture the full
-- output into the change record.
--
--   psql "$PRODUCTION_READONLY_URL" -f scripts/production-cutover-preflight.sql
--
-- Each block states its PASS criterion. A failing block is not a reason to
-- improvise: resolve it, or write down why it is acceptable, before the window.
--
-- Coverage was derived from the data-dependent statements in the pending
-- migrations. Regenerate the list before trusting this file after new
-- migrations land:
--
--   cd supabase/migrations
--   for f in $(ls *.sql | awk '{split($0,a,"_"); if (a[1]+0 > 20260603035734) print}'); do
--     grep -Hn -iE "CREATE UNIQUE INDEX|ADD CONSTRAINT|SET NOT NULL|^DELETE FROM|^UPDATE " "$f"
--   done

\timing off
\pset pager off

\echo '=============================================================='
\echo 'P0  Ledger position — expect 49 rows, head 20260603035734'
\echo '=============================================================='
SELECT count(*) AS applied_migrations,
       max(version) AS head_version
FROM supabase_migrations.schema_migrations;

\echo ''
\echo '=============================================================='
\echo 'P1  Duplicate organization join codes — PASS: 0 rows'
\echo '    Blocks organizations_join_code_unique_idx (20260712014700)'
\echo '=============================================================='
SELECT join_code, count(*) AS n, array_agg(id) AS organization_ids
FROM public.organizations
GROUP BY join_code
HAVING count(*) > 1;

\echo ''
\echo '=============================================================='
\echo 'P2  Malformed or null join codes — PASS: 0 rows'
\echo '=============================================================='
SELECT id, username, join_code
FROM public.organizations
WHERE join_code IS NULL OR join_code !~ '^[0-9]{6}$';

\echo ''
\echo '=============================================================='
\echo 'P3  Organization type outside the allowed set — PASS: 0 rows'
\echo '=============================================================='
SELECT type, count(*) AS n
FROM public.organizations
WHERE type IS NULL
   OR type NOT IN ('nonprofit', 'school', 'company', 'government', 'other')
GROUP BY type;

\echo ''
\echo '=============================================================='
\echo 'P4  Duplicate auto-join domains after normalization — PASS: 0 rows'
\echo '    A failure leaves an INVALID index behind (CONCURRENTLY)'
\echo '=============================================================='
SELECT lower(btrim(auto_join_domain)) AS normalized,
       count(*) AS n, array_agg(id) AS organization_ids
FROM public.organizations
WHERE auto_join_domain IS NOT NULL
GROUP BY 1
HAVING count(*) > 1;

\echo ''
\echo '=============================================================='
\echo 'P5  Auto-join domains failing the format/free-provider check'
\echo '    PASS: 0 rows. Any hit is ALSO a live security finding.'
\echo '=============================================================='
SELECT id, username, auto_join_domain
FROM public.organizations
WHERE auto_join_domain IS NOT NULL
  AND NOT (
    length(lower(btrim(auto_join_domain))) <= 253
    AND lower(btrim(auto_join_domain)) ~ '^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'
    AND lower(btrim(auto_join_domain)) NOT IN (
      'aol.com','gmail.com','googlemail.com','hotmail.com','icloud.com',
      'live.com','mail.com','msn.com','outlook.com','proton.me',
      'protonmail.com','yahoo.com','ymail.com')
  );

\echo ''
\echo '=============================================================='
\echo 'P6  Signup status outside the new CHECK — PASS: 0 rows'
\echo '=============================================================='
SELECT status, count(*) AS n
FROM public.project_signups
WHERE status IS NULL
   OR status NOT IN ('approved','attended','rejected','pending','cancelled')
GROUP BY status;

\echo ''
\echo '=============================================================='
\echo 'P7  Waiver signatures whose project is gone — PASS: 0 rows'
\echo '=============================================================='
SELECT ws.id, ws.project_id
FROM public.waiver_signatures ws
LEFT JOIN public.projects p ON p.id = ws.project_id
WHERE ws.project_id IS NOT NULL AND p.id IS NULL;

\echo ''
\echo '=============================================================='
\echo 'P8  Waiver signatures whose (signup_id, project_id) has no'
\echo '    matching signup — PASS: 0 rows.'
\echo '    The most likely failure in this whole set.'
\echo '=============================================================='
SELECT ws.id, ws.signup_id, ws.project_id
FROM public.waiver_signatures ws
WHERE ws.signup_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.project_signups ps
    WHERE ps.id = ws.signup_id AND ps.project_id = ws.project_id
  );

\echo ''
\echo '=============================================================='
\echo 'P9  Null project_id on composite-unique targets — PASS: both 0'
\echo '=============================================================='
SELECT
  (SELECT count(*) FROM public.project_signups    WHERE project_id IS NULL) AS signups_null_project,
  (SELECT count(*) FROM public.waiver_definitions WHERE project_id IS NULL) AS waiver_defs_null_project;

\echo ''
\echo '=============================================================='
\echo 'P10 Waiver storage paths not scoped to their project'
\echo '    PASS: 0 rows each. Any hit is ALSO a cross-tenant finding.'
\echo '=============================================================='
SELECT 'projects' AS source, id::text AS row_id, waiver_pdf_storage_path AS path
FROM public.projects
WHERE waiver_pdf_storage_path IS NOT NULL
  AND left(waiver_pdf_storage_path, length('project_waivers/' || id::text || '/'))
      IS DISTINCT FROM 'project_waivers/' || id::text || '/'
UNION ALL
SELECT 'waiver_definitions', id::text, pdf_storage_path
FROM public.waiver_definitions
WHERE pdf_storage_path IS NOT NULL
  AND left(pdf_storage_path, length('project_waivers/' || project_id::text || '/'))
      IS DISTINCT FROM 'project_waivers/' || project_id::text || '/'
UNION ALL
SELECT 'waiver_signatures', id::text, waiver_pdf_storage_path
FROM public.waiver_signatures
WHERE waiver_pdf_storage_path IS NOT NULL
  AND left(waiver_pdf_storage_path, length('project_waivers/' || project_id::text || '/'))
      IS DISTINCT FROM 'project_waivers/' || project_id::text || '/';

\echo ''
\echo '=============================================================='
\echo 'P11 ROWS THIS CUTOVER WILL DELETE.'
\echo '    20260712021110 runs: DELETE FROM public.user_emails'
\echo '                         WHERE verified_at IS NULL'
\echo '    PASS is NOT zero. PASS is "the number is understood,'
\echo '    reviewed, accepted, and captured in the backup."'
\echo '=============================================================='
SELECT count(*) AS rows_to_be_deleted
FROM public.user_emails WHERE verified_at IS NULL;

\echo ''
\echo '=============================================================='
\echo 'P12 Lowercasing would collide with an existing verified address'
\echo '    PASS: 0 rows. The migration deliberately fails rather than'
\echo '    transferring a verified address between users.'
\echo '=============================================================='
SELECT lower(btrim(email)) AS normalized, count(*) AS n,
       array_agg(DISTINCT user_id) AS user_ids
FROM public.user_emails
WHERE verified_at IS NOT NULL
GROUP BY 1
HAVING count(*) > 1;

\echo ''
\echo '=============================================================='
\echo 'P13 Users with more than one primary email — informational'
\echo '=============================================================='
SELECT user_id, count(*) AS n
FROM public.user_emails WHERE is_primary
GROUP BY user_id HAVING count(*) > 1;

\echo ''
\echo '=============================================================='
\echo 'P14 Auth emails owned by a different user — PASS: 0 rows.'
\echo '    Not a migration error: a SILENT correctness bug. The'
\echo '    ON CONFLICT no-ops and those users end up with no primary.'
\echo '=============================================================='
SELECT u.id AS auth_user_id,
       lower(btrim(u.email::text)) AS auth_email,
       ue.user_id AS conflicting_owner
FROM auth.users u
JOIN public.user_emails ue ON ue.email = lower(btrim(u.email::text))
WHERE u.email IS NOT NULL AND btrim(u.email::text) <> ''
  AND ue.user_id <> u.id;

\echo ''
\echo '=============================================================='
\echo 'P15 Post-cutover invariant baseline — record both numbers'
\echo '=============================================================='
SELECT
  (SELECT count(*) FROM auth.users
    WHERE email IS NOT NULL AND btrim(email::text) <> '') AS auth_users_with_email,
  (SELECT count(*) FROM public.user_emails WHERE is_primary) AS primary_rows;

\echo ''
\echo '=============================================================='
\echo 'P16 Duplicate DV service-ledger sources — PASS: 0 rows.'
\echo '    20260712024700 RAISEs on this before building its index.'
\echo '=============================================================='
SELECT account_id, source_type, source_id, entry_type, count(*) AS n
FROM plugin_data.dv_sd_family_service_ledger
WHERE source_id IS NOT NULL
GROUP BY account_id, source_type, source_id, entry_type
HAVING count(*) > 1;

\echo ''
\echo '=============================================================='
\echo 'P17 Duplicate DV tournament project bindings — PASS: 0 rows'
\echo '=============================================================='
SELECT project_id, count(*) AS n, array_agg(id) AS tournament_ids
FROM plugin_data.dv_sd_tournaments
WHERE project_id IS NOT NULL
GROUP BY project_id HAVING count(*) > 1;

\echo ''
\echo '=============================================================='
\echo 'P18 Duplicate DV tabroom links — PASS: 0 rows'
\echo '=============================================================='
SELECT tournament_id, count(*) AS n, array_agg(id) AS link_ids
FROM plugin_data.dv_sd_tabroom_links
GROUP BY tournament_id HAVING count(*) > 1;

\echo ''
\echo '=============================================================='
\echo 'P19/P20 organization_id backfill gaps that break SET NOT NULL'
\echo '        PASS: 0 rows each'
\echo '=============================================================='
SELECT 'tabroom_links' AS relation, l.id::text AS row_id
FROM plugin_data.dv_sd_tabroom_links l
LEFT JOIN plugin_data.dv_sd_tournaments t ON t.id = l.tournament_id
WHERE t.id IS NULL OR t.organization_id IS NULL
UNION ALL
SELECT 'tournament_entries', e.id::text
FROM plugin_data.dv_sd_tournament_entries e
LEFT JOIN plugin_data.dv_sd_tournaments t ON t.id = e.tournament_id
WHERE e.organization_id IS NULL AND (t.id IS NULL OR t.organization_id IS NULL);

\echo ''
\echo '=============================================================='
\echo 'P21 Plugin catalog state — record for the DV 2.0 step'
\echo '=============================================================='
SELECT key, name, is_active FROM public.plugins ORDER BY key;

\echo ''
\echo '=============================================================='
\echo 'P22 The CSF surface must NOT exist yet — PASS: all NULL.'
\echo '    Any non-NULL means out-of-band creation: STOP, because'
\echo '    CREATE TABLE without IF NOT EXISTS fails with 42P07.'
\echo '=============================================================='
SELECT to_regclass('plugin_data.csf_roles')           AS csf_roles,
       to_regclass('plugin_data.csf_profiles')        AS csf_profiles,
       to_regclass('plugin_data.csf_terms')           AS csf_terms,
       to_regclass('plugin_data.csf_staff_positions') AS csf_staff_positions;

\echo ''
\echo '=============================================================='
\echo 'TM-1 Trusted-member adjudication (AUD-001).'
\echo '     A self-grant produces a CONSISTENT pair, so inconsistency'
\echo '     does not detect it. The approval notification is the'
\echo '     signal. INVESTIGATE any row with no approval notification'
\echo '     AND missing application content.'
\echo '=============================================================='
SELECT p.id AS user_id,
       p.username,
       p.trusted_member AS profile_flag,
       tm.status AS tm_status,
       tm.created_at AS tm_created_at,
       (tm.name IS NULL OR tm.email IS NULL OR tm.reason IS NULL)
         AS missing_application_content,
       EXISTS (
         SELECT 1 FROM public.notifications n
         WHERE n.user_id = p.id
           AND n.title = 'Trusted Member Application Approved!'
       ) AS has_approval_notification,
       (SELECT count(*) FROM public.organizations o WHERE o.created_by = p.id) AS orgs_created,
       (SELECT count(*) FROM public.projects pr WHERE pr.creator_id = p.id) AS projects_created,
       u.created_at AS account_created_at,
       coalesce(u.raw_app_meta_data -> 'is_super_admin' = 'true'::jsonb, false) AS is_super_admin
FROM public.profiles p
LEFT JOIN public.trusted_member tm ON tm.user_id = p.id
LEFT JOIN auth.users u ON u.id = p.id
WHERE p.trusted_member IS TRUE OR tm.status IS TRUE
ORDER BY has_approval_notification ASC,
         missing_application_content DESC,
         tm.created_at DESC;

\echo ''
\echo '=============================================================='
\echo 'NT-1 Notification injection check (AUD-002).'
\echo '     Unauthenticated injection has been possible in Production.'
\echo '     Rows with an action_url pointing off-platform, or a sender'
\echo '     pattern that no server path produces, deserve a look.'
\echo '=============================================================='
SELECT count(*) AS total_notifications,
       count(*) FILTER (
         WHERE action_url IS NOT NULL
           AND action_url !~ '^/'
           AND action_url !~ '^https://(www\.)?lets-assist\.com'
       ) AS offsite_action_urls
FROM public.notifications;

\echo ''
\echo '=============================================================='
\echo 'E1  Collation version mismatch — a mismatch is EXPECTED here'
\echo '=============================================================='
SELECT datname, datcollate, datcollversion,
       pg_database_collation_actual_version(oid) AS actual_version,
       datcollversion IS DISTINCT FROM pg_database_collation_actual_version(oid) AS mismatch
FROM pg_database WHERE datname = current_database();

\echo ''
\echo '=============================================================='
\echo 'E2  Pre-existing invalid indexes — PASS: 0 rows.'
\echo '    Drop any hit before the push or a later CREATE collides.'
\echo '=============================================================='
SELECT c.relname AS table_name, ic.relname AS index_name
FROM pg_index i
JOIN pg_class c  ON c.oid  = i.indrelid
JOIN pg_class ic ON ic.oid = i.indexrelid
WHERE NOT i.indisvalid;

\echo ''
\echo '=============================================================='
\echo 'E3  Table sizes for the CONCURRENTLY targets — sizes the window'
\echo '=============================================================='
SELECT relname, n_live_tup,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE relname IN ('project_signups','waiver_definitions','waiver_signatures',
                  'organizations','user_emails','projects','profiles',
                  'notifications')
ORDER BY n_live_tup DESC;

\echo ''
\echo '=============================================================='
\echo 'E4  Session limits that would abort long DDL'
\echo '=============================================================='
SHOW statement_timeout;
SHOW idle_in_transaction_session_timeout;
SHOW lock_timeout;

\echo ''
\echo '=============================================================='
\echo 'E5  Scheduled jobs to pause — snapshot before the window.'
\echo '    Note 20260621210000 re-schedules two jobs DURING the push,'
\echo '    so restore by reconciling, not by replaying this blindly.'
\echo '=============================================================='
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;

\echo ''
\echo '=============================================================='
\echo 'E6  Connection and lock pressure — take again at T-0'
\echo '=============================================================='
SELECT state, count(*) AS n FROM pg_stat_activity GROUP BY state ORDER BY n DESC;
SELECT count(*) AS ungranted_locks FROM pg_locks WHERE NOT granted;

\echo ''
\echo '=============================================================='
\echo 'S1  Storage object counts per bucket — before/after invariant'
\echo '=============================================================='
SELECT bucket_id, count(*) AS objects,
       pg_size_pretty(sum((metadata->>'size')::bigint)) AS bytes
FROM storage.objects
GROUP BY bucket_id ORDER BY bucket_id;

\echo ''
\echo 'Preflight complete. Capture this entire output into the change record.'
