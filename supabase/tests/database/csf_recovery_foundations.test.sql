BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(168);

-- ---------------------------------------------------------------------------
-- Server-only boundaries for the new recovery-foundation tables
-- ---------------------------------------------------------------------------

SELECT extensions.has_table(
  'plugin_data', 'csf_partner_club_representatives',
  'term-scoped partner-club representatives have a durable table'
);
SELECT extensions.has_table(
  'plugin_data', 'csf_partner_club_term_events',
  'partner-club semester lifecycle events have a durable table'
);
SELECT extensions.has_table(
  'plugin_data', 'csf_communication_campaigns',
  'CSF communications campaigns have a durable table'
);
SELECT extensions.has_table(
  'plugin_data', 'csf_communication_recipient_snapshots',
  'campaign audiences have a durable snapshot table'
);
SELECT extensions.has_table(
  'plugin_data', 'csf_communication_deliveries',
  'per-recipient deliveries have a durable table'
);
SELECT extensions.has_table(
  'plugin_data', 'csf_communication_provider_events',
  'provider webhook events have a durable table'
);

SELECT extensions.ok(
  (
    SELECT bool_and(class.relrowsecurity)
    FROM pg_class AS class
    WHERE class.oid IN (
      'plugin_data.csf_partner_club_representatives'::regclass,
      'plugin_data.csf_partner_club_term_events'::regclass,
      'plugin_data.csf_communication_campaigns'::regclass,
      'plugin_data.csf_communication_recipient_snapshots'::regclass,
      'plugin_data.csf_communication_deliveries'::regclass,
      'plugin_data.csf_communication_provider_events'::regclass
    )
  ),
  'every new recovery-foundation table has row level security enabled'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_partner_club_representatives',
      'plugin_data.csf_partner_club_term_events',
      'plugin_data.csf_communication_campaigns',
      'plugin_data.csf_communication_recipient_snapshots',
      'plugin_data.csf_communication_deliveries',
      'plugin_data.csf_communication_provider_events'
    ]) AS target(relation)
    CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS client(role_name)
    CROSS JOIN unnest(ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]) AS wanted(privilege)
    WHERE has_table_privilege(client.role_name::name, target.relation, wanted.privilege)
  ),
  'anon and authenticated hold no table privileges at all on the new tables'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      has_table_privilege('service_role', target.relation, wanted.privilege)
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_partner_club_representatives',
      'plugin_data.csf_partner_club_term_events',
      'plugin_data.csf_communication_campaigns',
      'plugin_data.csf_communication_recipient_snapshots',
      'plugin_data.csf_communication_deliveries',
      'plugin_data.csf_communication_provider_events'
    ]) AS target(relation)
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS wanted(privilege)
  ),
  'the server role retains exactly the row access these projections need'
);

-- TRUNCATE would erase an audited ledger without firing a single row trigger.
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_partner_club_representatives',
      'plugin_data.csf_partner_club_term_events',
      'plugin_data.csf_communication_campaigns',
      'plugin_data.csf_communication_recipient_snapshots',
      'plugin_data.csf_communication_deliveries',
      'plugin_data.csf_communication_provider_events'
    ]) AS target(relation)
    CROSS JOIN unnest(ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']) AS forbidden(privilege)
    WHERE has_table_privilege('service_role', target.relation, forbidden.privilege)
  ),
  'not even the server role may TRUNCATE, REFERENCE, or attach triggers to the new tables'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_enforce_import_commit_lineage()',
      'plugin_data.csf_preserve_import_snapshot_provenance()',
      'plugin_data.csf_enforce_campaign_lifecycle()',
      'plugin_data.csf_reject_recipient_snapshot_mutation()',
      'plugin_data.csf_enforce_delivery_recipient_included()',
      'plugin_data.csf_enforce_delivery_lifecycle()',
      'plugin_data.csf_enforce_provider_event_binding()',
      'plugin_data.csf_reject_provider_event_mutation()',
      'plugin_data.csf_reject_partner_club_event_mutation()',
      'plugin_data.csf_enforce_representative_date_state()',
      'plugin_data.csf_assert_representative_account_profile()',
      'plugin_data.csf_assert_snapshot_representative_pairing()',
      'plugin_data.csf_jsonb_carries_raw_content(jsonb)',
      'plugin_data.csf_recovery_teardown_authorized(uuid)',
      'plugin_data.csf_purge_recovery_foundations(uuid)',
      'public.enforce_organization_calendar_event_source()'
    ]) AS guard(signature)
    CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated']) AS client(role_name)
    WHERE has_function_privilege(client.role_name::name, guard.signature, 'EXECUTE')
  ),
  'no client role can execute any new guard, sanitizer, or teardown function directly'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role', 'plugin_data.csf_purge_recovery_foundations(uuid)', 'EXECUTE'
  )
  AND has_function_privilege(
    'service_role', 'plugin_data.csf_jsonb_carries_raw_content(jsonb)', 'EXECUTE'
  ),
  'the server role can run the purge RPC and the sanitizer its CHECK constraints need'
);

SELECT extensions.ok(
  (
    SELECT provolatile = 'i'
    FROM pg_proc
    WHERE oid = 'plugin_data.csf_jsonb_carries_raw_content(jsonb)'::regprocedure
  ),
  'the payload sanitizer is immutable, as a CHECK constraint requires'
);

SELECT extensions.ok(
  (
    SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
    FROM pg_proc
    WHERE oid = 'plugin_data.csf_purge_recovery_foundations(uuid)'::regprocedure
  ),
  'the purge RPC is SECURITY DEFINER with an empty search_path'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ac000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'csf-officer@local.test', now(), '{}', '{}', now(), now()),
  ('ac000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'club.rep@local.test', now(), '{}', '{}', now(), now()),
  ('ac000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'active.staff@local.test', now(), '{}', '{}', now(), now()),
  ('ac000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'inactive.staff@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('ac100000-0000-4000-8000-000000000001', 'CSF Recovery One', 'csf-recovery-one', 'school', '881001'),
  ('ac100000-0000-4000-8000-000000000002', 'CSF Recovery Two', 'csf-recovery-two', 'school', '881002');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000003', 'staff', 'active'),
  ('ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000004', 'staff', 'inactive');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  ('ac200000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001', 'F31', 'Fall 2031', '2031-2032', 'fall', true),
  ('ac200000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000002', 'F31', 'Fall 2031', '2031-2032', 'fall', true);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES (
  'ac300000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001',
  'Recovery', 'Member', 'recovery', 'member'
);

-- The verified link that authorizes naming both an account and a profile on one
-- representative assignment.
INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status
) VALUES (
  'ac100000-0000-4000-8000-000000000001',
  'ac300000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000002',
  'verified'
);

INSERT INTO plugin_data.csf_partner_clubs (id, organization_id, name, status)
VALUES
  ('ac400000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001', 'Robotics', 'active'),
  ('ac400000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000001', 'Interact', 'active'),
  ('ac400000-0000-4000-8000-000000000003', 'ac100000-0000-4000-8000-000000000002', 'Key Club', 'active');

INSERT INTO plugin_data.csf_partner_club_terms (
  id, organization_id, partner_club_id, term_id, relationship_status, workflow_status
) VALUES
  ('ac500000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001', 'ac400000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-000000000001', 'new', 'active'),
  ('ac500000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000001', 'ac400000-0000-4000-8000-000000000002', 'ac200000-0000-4000-8000-000000000001', 'returning', 'active'),
  ('ac500000-0000-4000-8000-000000000003', 'ac100000-0000-4000-8000-000000000002', 'ac400000-0000-4000-8000-000000000003', 'ac200000-0000-4000-8000-000000000002', 'new', 'active');

-- Preview jobs. 0001 is the partner-audit preview most lineage tests use, 0002
-- lives in the other organization, 0003 carries a different source type, and
-- 0004 already recorded its digests so a commit can inherit them.
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, initiated_by, mode, status, source_type, summary,
  source_content_hash, snapshot_hash, snapshot_row_count, snapshot_contract_version
) VALUES
  (
    'aca00000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001',
    'ac000000-0000-4000-8000-000000000001', 'preview', 'completed', 'partner_club_audit',
    '{}'::jsonb, NULL, NULL, NULL, NULL
  ),
  (
    'aca00000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000002',
    'ac000000-0000-4000-8000-000000000001', 'preview', 'completed', 'partner_club_audit',
    '{}'::jsonb, NULL, NULL, NULL, NULL
  ),
  (
    'aca00000-0000-4000-8000-000000000003', 'ac100000-0000-4000-8000-000000000001',
    'ac000000-0000-4000-8000-000000000001', 'preview', 'completed', 'meeting_attendance',
    '{}'::jsonb, NULL, NULL, NULL, NULL
  ),
  (
    'aca00000-0000-4000-8000-000000000004', 'ac100000-0000-4000-8000-000000000001',
    'ac000000-0000-4000-8000-000000000001', 'preview', 'completed', 'partner_club_audit',
    '{}'::jsonb,
    'aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999',
    '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
    17,
    'partner-club-audit.v4'
  );

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, sheet_tab_name, row_number, import_status
) VALUES (
  'acd00000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001',
  'aca00000-0000-4000-8000-000000000001', 'Renewals', 7, 'pending'
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, sheet_tab_name, row_number, import_status
) VALUES (
  'acd00000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000002',
  'aca00000-0000-4000-8000-000000000002', 'Renewals', 7, 'pending'
);

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description,
  event_type, verification_method, schedule, require_login
) VALUES
  (
    'acb00000-0000-4000-8000-000000000001',
    'ac000000-0000-4000-8000-000000000001',
    'ac100000-0000-4000-8000-000000000001',
    'Recovery Calendar Project',
    'Local',
    'Calendar generalization fixture',
    'single',
    'manual',
    '{}'::jsonb,
    true
  ),
  (
    'acb00000-0000-4000-8000-000000000002',
    'ac000000-0000-4000-8000-000000000001',
    'ac100000-0000-4000-8000-000000000002',
    'Other Organization Project',
    'Local',
    'Cross-tenant calendar fixture',
    'single',
    'manual',
    '{}'::jsonb,
    true
  );

-- Real CSF calendar sources. A meeting session is a meeting session; a
-- partner-club identifier is never used to stand in for one.
INSERT INTO plugin_data.csf_meetings (
  id, organization_id, term_id, meeting_key, label
) VALUES (
  'acf00000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001',
  'ac200000-0000-4000-8000-000000000001', 'general-1', 'General Meeting 1'
);

INSERT INTO plugin_data.csf_meeting_sessions (
  id, organization_id, meeting_id, session_date, status
) VALUES (
  'acf10000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001',
  'acf00000-0000-4000-8000-000000000001', DATE '2031-09-10', 'scheduled'
);

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, title, body
) VALUES
  (
    'acf20000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001',
    'ac200000-0000-4000-8000-000000000001', 'Park Cleanup', 'Recovery opportunity fixture'
  ),
  (
    'acf20000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000002',
    'ac200000-0000-4000-8000-000000000002', 'Other Org Cleanup', 'Cross-tenant opportunity fixture'
  );

INSERT INTO plugin_data.csf_term_deadlines (
  id, organization_id, term_id, deadline_type, title, due_at
) VALUES (
  'acf30000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001',
  'ac200000-0000-4000-8000-000000000001', 'points', 'Points due', TIMESTAMPTZ '2031-12-01 23:59:00+00'
);

-- ---------------------------------------------------------------------------
-- A. Import lineage that current writers cannot bypass
-- ---------------------------------------------------------------------------

SELECT extensions.has_column(
  'plugin_data', 'csf_sheet_import_jobs', 'preview_job_id',
  'import jobs record the preview they were derived from'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_sheet_import_jobs', 'source_content_hash',
  'import jobs record the source content digest they read'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_sheet_import_jobs', 'snapshot_hash',
  'import jobs record the snapshot digest they produced'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_sheet_import_jobs', 'snapshot_row_count',
  'import jobs record the snapshot row count'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_sheet_import_jobs', 'snapshot_contract_version',
  'import jobs record the importer snapshot contract version'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_sheet_import_jobs'::regclass
      AND conname = 'csf_sheet_import_jobs_preview_job_organization_fkey'
      AND contype = 'f'
      AND convalidated
  ),
  'preview lineage uses an organization-scoped foreign key'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_index AS index_meta
    JOIN pg_class AS index_class ON index_class.oid = index_meta.indexrelid
    WHERE index_class.relname = 'csf_sheet_import_jobs_one_commit_per_preview_idx'
      AND index_meta.indisunique
      AND index_meta.indpred IS NOT NULL
  ),
  'one commit job per preview is enforced by a partial unique index'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_index AS index_meta
    JOIN pg_class AS index_class ON index_class.oid = index_meta.indexrelid
    WHERE index_class.relname = 'csf_sheet_import_rows_job_coordinate_idx'
      AND index_meta.indisunique
  ),
  'one import row per job coordinate is enforced by a unique index'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'csf_sheet_import_jobs_content_hash_history_idx'
      AND relkind = 'i'
  )
  AND EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'csf_sheet_import_jobs_snapshot_hash_idx'
      AND relkind = 'i'
  ),
  'snapshot history and dedup lookups are indexed'
);
SELECT extensions.ok(
  (
    SELECT count(*)::integer
    FROM pg_constraint
    WHERE contype = 'f'
      AND conname IN (
        'csf_sheet_import_rows_job_organization_fkey',
        'csf_sheet_import_rows_retry_of_row_organization_fkey',
        'csf_sheet_import_jobs_retry_of_job_organization_fkey'
      )
      AND convalidated
  ) = 3,
  'row ownership and both retry lineages are organization-scoped composite foreign keys'
);
SELECT extensions.ok(
  (
    SELECT count(*)::integer
    FROM pg_constraint
    WHERE contype = 'c'
      AND conname IN (
        'csf_sheet_import_rows_retry_of_row_not_self_check',
        'csf_sheet_import_jobs_retry_of_job_not_self_check',
        'csf_sheet_import_jobs_preview_job_not_self_check'
      )
  ) = 3,
  'no import job or row may cite itself as its own preview or retry'
);

-- The legacy shape: only summary.previewJobId, exactly what the reconciliation
-- RPCs and the server action already write today.
SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      id, organization_id, initiated_by, mode, status, source_type, summary
    ) VALUES (
      'aca00000-0000-4000-8000-000000000010', 'ac100000-0000-4000-8000-000000000001',
      'ac000000-0000-4000-8000-000000000001', 'commit', 'running', 'partner_club_audit',
      '{"previewJobId": "aca00000-0000-4000-8000-000000000001"}'::jsonb
    )
  $$,
  'a summary-only legacy commit insert is accepted unchanged'
);
SELECT extensions.is(
  (
    SELECT preview_job_id
    FROM plugin_data.csf_sheet_import_jobs
    WHERE id = 'aca00000-0000-4000-8000-000000000010'
  ),
  'aca00000-0000-4000-8000-000000000001'::uuid,
  'a summary-only legacy insert derives structured preview lineage'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, initiated_by, mode, status, source_type
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001',
      'commit', 'running', 'partner_club_audit'
    )
  $$,
  '23514',
  'A CSF commit import job must name the preview it was derived from, either as preview_job_id or as summary.previewJobId.',
  'a commit job with no lineage at all is rejected'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, initiated_by, mode, status, source_type, summary
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001',
      'commit', 'running', 'partner_club_audit',
      '{"previewJobId": "not-a-uuid"}'::jsonb
    )
  $$,
  '23514',
  'The CSF commit import job summary.previewJobId is not a UUID.',
  'a malformed legacy lineage value is diagnosed rather than thrown as a cast error'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, initiated_by, mode, status, source_type,
      preview_job_id, summary
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001',
      'commit', 'running', 'partner_club_audit',
      'aca00000-0000-4000-8000-000000000004',
      '{"previewJobId": "aca00000-0000-4000-8000-000000000003"}'::jsonb
    )
  $$,
  '23514',
  'The CSF commit import job summary.previewJobId disagrees with its structured preview lineage.',
  'a legacy summary cannot contradict explicit structured lineage'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, initiated_by, mode, status, source_type, summary
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001',
      'commit', 'running', 'partner_club_audit',
      '{"previewJobId": "aca00000-0000-4000-8000-000000000002"}'::jsonb
    )
  $$,
  '23503',
  'A CSF commit import job cannot claim a preview from another organization.',
  'a commit job cannot claim another organization preview'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, initiated_by, mode, status, source_type, summary
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001',
      'commit', 'running', 'partner_club_audit',
      '{"previewJobId": "aca00000-0000-4000-8000-000000000010"}'::jsonb
    )
  $$,
  '23514',
  'A CSF commit import job must be derived from a preview job, not from another commit or scheduled job.',
  'commit-to-commit lineage is rejected'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, initiated_by, mode, status, source_type, summary
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001',
      'commit', 'running', 'partner_club_audit',
      '{"previewJobId": "aca00000-0000-4000-8000-000000000003"}'::jsonb
    )
  $$,
  '23514',
  'A CSF commit import job must keep the source type of the preview it commits.',
  'a commit job cannot change the source type of the preview it commits'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      id, organization_id, initiated_by, mode, status, source_type, preview_job_id
    ) VALUES (
      'aca00000-0000-4000-8000-000000000011', 'ac100000-0000-4000-8000-000000000001',
      'ac000000-0000-4000-8000-000000000001', 'commit', 'running', 'partner_club_audit',
      'aca00000-0000-4000-8000-000000000011'
    )
  $$,
  '23514',
  'A CSF commit import job cannot be its own preview.',
  'a commit job cannot be its own preview'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, initiated_by, mode, status, source_type, preview_job_id
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001',
      'preview', 'running', 'partner_club_audit',
      'aca00000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'Only a commit CSF import job may record preview lineage.',
  'a preview job cannot record preview lineage of its own'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, initiated_by, mode, status, source_type, preview_job_id
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001',
      'commit', 'running', 'partner_club_audit', 'aca00000-0000-4000-8000-000000000001'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "csf_sheet_import_jobs_one_commit_per_preview_idx"',
  'one reviewed preview cannot be committed twice'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, initiated_by, mode, status, source_type,
      preview_job_id, source_content_hash
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001',
      'commit', 'running', 'partner_club_audit',
      'aca00000-0000-4000-8000-000000000004',
      '0000000000000000000000000000000000000000000000000000000000000000'
    )
  $$,
  '23514',
  'A CSF commit import job cannot contradict the source content digest recorded by its preview.',
  'a commit job cannot contradict a digest its preview already recorded'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      id, organization_id, initiated_by, mode, status, source_type, preview_job_id
    ) VALUES (
      'aca00000-0000-4000-8000-000000000012', 'ac100000-0000-4000-8000-000000000001',
      'ac000000-0000-4000-8000-000000000001', 'commit', 'running', 'partner_club_audit',
      'aca00000-0000-4000-8000-000000000004'
    )
  $$,
  'a commit job may leave the preview digests for the database to carry forward'
);
SELECT extensions.is(
  (
    SELECT source_content_hash || '|' || snapshot_hash
      || '|' || snapshot_row_count::text || '|' || snapshot_contract_version
    FROM plugin_data.csf_sheet_import_jobs
    WHERE id = 'aca00000-0000-4000-8000-000000000012'
  ),
  'aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999'
    || '|1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff'
    || '|17|partner-club-audit.v4',
  'a commit job inherits every digest its preview already recorded'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, initiated_by, mode, status, source_type, source_content_hash
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001',
      'preview', 'running', 'partner_club_audit', 'not-a-sha256-digest'
    )
  $$,
  '23514',
  'new row for relation "csf_sheet_import_jobs" violates check constraint "csf_sheet_import_jobs_source_content_hash_check"',
  'a source content digest that is not SHA-256 is rejected'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, initiated_by, mode, status, source_type, snapshot_row_count
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001',
      'preview', 'running', 'partner_club_audit', -1
    )
  $$,
  '23514',
  'new row for relation "csf_sheet_import_jobs" violates check constraint "csf_sheet_import_jobs_snapshot_row_count_check"',
  'a negative snapshot row count is rejected'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, initiated_by, mode, status, source_type, snapshot_contract_version
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001',
      'preview', 'running', 'partner_club_audit', '   '
    )
  $$,
  '23514',
  'new row for relation "csf_sheet_import_jobs" violates check constraint "csf_sheet_import_jobs_snapshot_contract_version_check"',
  'a blank snapshot contract version is rejected'
);

SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_jobs
    SET
      status = 'completed',
      snapshot_hash = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
      snapshot_row_count = 42,
      completed_at = now()
    WHERE id = 'aca00000-0000-4000-8000-000000000010'
  $$,
  'a running job may finalize its snapshot digest once'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_jobs
    SET snapshot_hash = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    WHERE id = 'aca00000-0000-4000-8000-000000000010'
  $$,
  'P0001',
  'CSF import snapshot hash is immutable once recorded.',
  'a recorded snapshot digest can never be rewritten'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_jobs
    SET preview_job_id = NULL
    WHERE id = 'aca00000-0000-4000-8000-000000000010'
  $$,
  'P0001',
  'CSF import preview lineage is immutable; create a new commit job instead.',
  'recorded preview lineage can never be cleared'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_rows (
      organization_id, job_id, sheet_tab_name, row_number, import_status
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'aca00000-0000-4000-8000-000000000001',
      'Renewals', 7, 'pending'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "csf_sheet_import_rows_job_coordinate_idx"',
  'one source row coordinate cannot be recorded twice in one job'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_rows (
      organization_id, job_id, sheet_tab_name, row_number, import_status
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'aca00000-0000-4000-8000-000000000002',
      'Renewals', 9, 'pending'
    )
  $$,
  '23503',
  'insert or update on table "csf_sheet_import_rows" violates foreign key constraint "csf_sheet_import_rows_job_organization_fkey"',
  'an import row cannot be filed under a job from another organization'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_rows (
      organization_id, job_id, sheet_tab_name, row_number, import_status,
      retry_of_row_id
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'aca00000-0000-4000-8000-000000000001',
      'Renewals', 11, 'pending', 'acd00000-0000-4000-8000-000000000002'
    )
  $$,
  '23503',
  'insert or update on table "csf_sheet_import_rows" violates foreign key constraint "csf_sheet_import_rows_retry_of_row_organization_fkey"',
  'an import row cannot retry a row from another organization'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_rows (
      id, organization_id, job_id, sheet_tab_name, row_number, import_status,
      retry_of_row_id
    ) VALUES (
      'acd00000-0000-4000-8000-000000000003',
      'ac100000-0000-4000-8000-000000000001', 'aca00000-0000-4000-8000-000000000001',
      'Renewals', 12, 'pending', 'acd00000-0000-4000-8000-000000000003'
    )
  $$,
  '23514',
  'new row for relation "csf_sheet_import_rows" violates check constraint "csf_sheet_import_rows_retry_of_row_not_self_check"',
  'an import row cannot retry itself'
);

-- Deferred coherence triggers are checked at commit, and this transaction ends
-- in ROLLBACK, so they are made immediate for the rest of the file.
SET CONSTRAINTS ALL IMMEDIATE;

-- ---------------------------------------------------------------------------
-- B. Representative identity and date coherence
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      id, organization_id, partner_club_term_id, user_id, profile_id,
      source_import_row_id, role, display_name, email, status,
      effective_start, is_primary, created_by
    ) VALUES (
      'ac600000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001',
      'ac500000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000002',
      'ac300000-0000-4000-8000-000000000001', 'acd00000-0000-4000-8000-000000000001',
      'primary_contact', 'Robotics Lead', 'Club.Rep@Local.Test', 'active',
      current_date - 30, true, 'ac000000-0000-4000-8000-000000000001'
    )
  $$,
  'an officer can issue a term-scoped assignment whose account and profile are already linked'
);
SELECT extensions.is(
  (
    SELECT normalized_email
    FROM plugin_data.csf_partner_club_representatives
    WHERE id = 'ac600000-0000-4000-8000-000000000001'
  ),
  'club.rep@local.test',
  'representative email is normalized for matching without losing the submitted form'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      id, organization_id, partner_club_term_id, user_id, role,
      display_name, email, status, effective_start, is_primary
    ) VALUES (
      'ac600000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000001',
      'ac500000-0000-4000-8000-000000000002', 'ac000000-0000-4000-8000-000000000002',
      'president', 'Interact Lead', 'club.rep@local.test', 'active',
      current_date - 30, true
    )
  $$,
  'one account may represent a second partner club in the same semester'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_partner_club_representatives
    WHERE organization_id = 'ac100000-0000-4000-8000-000000000001'
      AND user_id = 'ac000000-0000-4000-8000-000000000002'
      AND status = 'active'
  ),
  2,
  'the same account holds separate active assignments per club term'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      organization_id, partner_club_term_id, role, display_name, email
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000001',
      'treasurer', 'Unsupported Role', 'treasurer@local.test'
    )
  $$,
  '23514',
  'new row for relation "csf_partner_club_representatives" violates check constraint "csf_partner_club_representatives_role_check"',
  'an unsupported representative role is rejected'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      organization_id, partner_club_term_id, display_name, email, status
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000001',
      'Unsupported Status', 'status@local.test', 'suspended'
    )
  $$,
  '23514',
  'new row for relation "csf_partner_club_representatives" violates check constraint "csf_partner_club_representatives_status_check"',
  'an unsupported representative status is rejected'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      organization_id, partner_club_term_id, display_name, email,
      effective_start, effective_end
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000001',
      'Backwards Interval', 'interval@local.test', DATE '2031-09-01', DATE '2031-08-01'
    )
  $$,
  '23514',
  'new row for relation "csf_partner_club_representatives" violates check constraint "csf_partner_club_representatives_effective_range_check"',
  'an assignment cannot end before it starts'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      organization_id, partner_club_term_id, display_name, email
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000003',
      'Cross Tenant', 'cross@local.test'
    )
  $$,
  '23503',
  'insert or update on table "csf_partner_club_representatives" violates foreign key constraint "csf_partner_club_representatives_club_term_fkey"',
  'a representative cannot be attached to another organization club term'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      organization_id, partner_club_term_id, role, display_name, email, status, is_primary
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000001',
      'other', 'Duplicate Address', 'CLUB.REP@LOCAL.TEST', 'invited', false
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "csf_partner_club_representatives_live_email_idx"',
  'one address cannot hold two live assignments for one club term'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      organization_id, partner_club_term_id, user_id, role, display_name,
      email, status, is_primary
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000001',
      'ac000000-0000-4000-8000-000000000002', 'other', 'Same Person New Address',
      'club.rep.alternate@local.test', 'invited', false
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "csf_partner_club_representatives_live_account_idx"',
  'one live account cannot hold two assignments for one club term under different addresses'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      organization_id, partner_club_term_id, role, display_name, email, status, is_primary
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000001',
      'adviser', 'Second Primary', 'second.primary@local.test', 'active', true
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "csf_partner_club_representatives_single_primary_idx"',
  'one club term keeps a single live primary contact'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      organization_id, partner_club_term_id, user_id, profile_id,
      role, display_name, email, status
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000002',
      'ac000000-0000-4000-8000-000000000001', 'ac300000-0000-4000-8000-000000000001',
      'adviser', 'Unlinked Account', 'unlinked.adviser@local.test', 'invited'
    )
  $$,
  '23514',
  'A CSF partner-club representative that names both an account and a profile requires a verified profile link in the same organization.',
  'an assignment cannot pair an account with a profile it is not verified against'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      organization_id, partner_club_term_id, role, display_name, email,
      status, effective_start
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000002',
      'adviser', 'Future Active', 'future.active@local.test', 'active',
      current_date + 7
    )
  $$,
  '23514',
  'An active CSF partner-club representative cannot start in the future.',
  'an active assignment cannot start in the future'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      organization_id, partner_club_term_id, role, display_name, email,
      status, effective_start, effective_end
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000002',
      'adviser', 'Already Ended', 'already.ended@local.test', 'active',
      current_date - 30, current_date - 1
    )
  $$,
  '23514',
  'An active CSF partner-club representative cannot already be ended.',
  'an active assignment cannot already be ended'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      organization_id, partner_club_term_id, role, display_name, email,
      status, effective_start, effective_end
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000002',
      'adviser', 'Future Expiry', 'future.expiry@local.test', 'expired',
      current_date - 30, current_date + 30
    )
  $$,
  '23514',
  'An expired CSF partner-club representative cannot end in the future.',
  'an expired assignment cannot end in the future'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      organization_id, partner_club_term_id, role, display_name, email, status
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000002',
      'adviser', 'Open Revocation', 'open.revocation@local.test', 'revoked'
    )
  $$,
  '23514',
  'new row for relation "csf_partner_club_representatives" violates check constraint "csf_partner_club_representatives_revoked_end_check"',
  'a revoked assignment must record when it ended'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_meta
    JOIN pg_class AS index_class ON index_class.oid = index_meta.indexrelid
    WHERE index_class.relname IN (
        'csf_partner_club_representatives_live_email_idx',
        'csf_partner_club_representatives_live_account_idx',
        'csf_partner_club_representatives_single_primary_idx'
      )
      AND pg_get_expr(index_meta.indpred, index_meta.indrelid) LIKE '%date%'
  ),
  'no representative unique index predicate depends on the current date'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'plugin_data'
      AND tablename = 'csf_partner_club_representatives'
  ),
  'representatives carry no client-facing policy'
);

SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_partner_club_representatives
    SET status = 'revoked', effective_end = current_date, updated_at = now()
    WHERE id = 'ac600000-0000-4000-8000-000000000001'
  $$,
  'an officer can revoke one club-term assignment without deleting its history'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_representatives (
      id, organization_id, partner_club_term_id, role, display_name, email, status, is_primary
    ) VALUES (
      'ac600000-0000-4000-8000-000000000004', 'ac100000-0000-4000-8000-000000000001',
      'ac500000-0000-4000-8000-000000000001', 'primary_contact', 'Replacement Lead',
      'club.rep@local.test', 'active', true
    )
  $$,
  'a revoked assignment frees the address and primary slot for a replacement'
);

INSERT INTO plugin_data.csf_partner_club_representatives (
  id, organization_id, partner_club_term_id, role, display_name, email, status
) VALUES (
  'ac600000-0000-4000-8000-000000000005', 'ac100000-0000-4000-8000-000000000001',
  'ac500000-0000-4000-8000-000000000002', 'coordinator', 'Ephemeral Coordinator',
  'ephemeral.rep@local.test', 'active'
);

-- ---------------------------------------------------------------------------
-- C. Communication relationship coherence
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, sender_name, sender_email,
      reply_to_email, subject, body_text_hash, resend_topic_id,
      audience_snapshot_version, provider_idempotency_key, created_by, queued_at
    ) VALUES (
      'ac700000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001',
      'broadcast', 'queued', 'DVHS CSF', 'csf@local.test', 'csf-reply@local.test',
      'Fall 2031 partner club audit window',
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      'topic_partner_clubs', 3, 'campaign-fall-2031-audit',
      'ac000000-0000-4000-8000-000000000001', now()
    )
  $$,
  'a broadcast campaign records its sender, digests, topic, and provider idempotency key'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, sender_email, subject,
      audience_snapshot_version, provider_idempotency_key
    ) VALUES (
      'ac700000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000001',
      'transactional', 'draft', 'csf@local.test', 'Draft notice', 1,
      'campaign-fall-2031-draft'
    )
  $$,
  'a draft campaign starts editable'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      organization_id, campaign_kind, sender_email, subject, provider_idempotency_key
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'transactional', 'csf@local.test',
      'Replayed campaign', 'campaign-fall-2031-audit'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "csf_communication_campaigns_provider_idempotency_key"',
  'a campaign provider idempotency key cannot be reused'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      organization_id, campaign_kind, sender_email, subject, provider_idempotency_key
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'transactional', 'csf@local.test',
      'Oversized key', repeat('k', 257)
    )
  $$,
  '23514',
  'new row for relation "csf_communication_campaigns" violates check constraint "csf_communication_campaigns_idempotency_shape_check"',
  'a campaign idempotency key longer than Resend accepts is rejected'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      organization_id, campaign_kind, status, sender_email, subject, provider_idempotency_key
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'broadcast', 'delivered', 'csf@local.test',
      'Unsupported campaign status', 'campaign-bad-status'
    )
  $$,
  '23514',
  'new row for relation "csf_communication_campaigns" violates check constraint "csf_communication_campaigns_status_check"',
  'an unsupported campaign status is rejected'
);

SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET
      subject = 'Draft notice, revised',
      body_text_hash = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      audience_snapshot_version = 2
    WHERE id = 'ac700000-0000-4000-8000-000000000002'
  $$,
  'a draft campaign payload and audience version may still be edited'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET subject = 'Rewritten after send'
    WHERE id = 'ac700000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF campaign sender, reply-to, subject, content digests, topic, metadata, audience version, kind, channel, and provider idempotency key are frozen once the campaign leaves draft.',
  'a queued campaign payload can no longer be mutated'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET audience_snapshot_version = 4
    WHERE id = 'ac700000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF campaign sender, reply-to, subject, content digests, topic, metadata, audience version, kind, channel, and provider idempotency key are frozen once the campaign leaves draft.',
  'a campaign cannot be re-pointed at a different audience snapshot'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET status = 'draft'
    WHERE id = 'ac700000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF campaign status may only advance through the send lifecycle; a settled campaign never returns to an earlier state.',
  'a queued campaign cannot be pulled back into draft'
);
SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET status = 'completed', completed_at = now()
    WHERE id = 'ac700000-0000-4000-8000-000000000001'
  $$,
  'a queued campaign may settle as completed'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET status = 'queued'
    WHERE id = 'ac700000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF campaign status may only advance through the send lifecycle; a settled campaign never returns to an earlier state.',
  'a completed campaign never regresses to queued'
);
SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_communication_campaigns
    WHERE id = 'ac700000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF campaign history cannot be deleted; use plugin_data.csf_purge_recovery_foundations().',
  'a campaign cannot be deleted through ordinary operation'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_recipient_snapshots (
      id, organization_id, campaign_id, snapshot_version, recipient_email,
      recipient_name, profile_id, user_id, club_representative_id,
      partner_club_term_id, subscription_decision, exclusion_reason
    ) VALUES
      (
        'ac800000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001',
        'ac700000-0000-4000-8000-000000000001', 3, 'Replacement.Lead@Local.Test',
        'Replacement Lead', 'ac300000-0000-4000-8000-000000000001',
        'ac000000-0000-4000-8000-000000000002', 'ac600000-0000-4000-8000-000000000004',
        'ac500000-0000-4000-8000-000000000001', 'included', NULL
      ),
      (
        'ac800000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000001',
        'ac700000-0000-4000-8000-000000000001', 3, 'ephemeral.rep@local.test',
        'Ephemeral Coordinator', NULL, NULL, 'ac600000-0000-4000-8000-000000000005',
        'ac500000-0000-4000-8000-000000000002', 'included', NULL
      ),
      (
        'ac800000-0000-4000-8000-000000000003', 'ac100000-0000-4000-8000-000000000001',
        'ac700000-0000-4000-8000-000000000001', 3, 'unsubscribed.rep@local.test',
        'Unsubscribed Adviser', NULL, NULL, NULL, NULL, 'excluded', 'unsubscribed'
      )
  $$,
  'an audience snapshot preserves recipients and their subscription decision'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_recipient_snapshots (
      organization_id, campaign_id, snapshot_version, recipient_email, subscription_decision
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac700000-0000-4000-8000-000000000001',
      2, 'wrong.version@local.test', 'included'
    )
  $$,
  '23503',
  'insert or update on table "csf_communication_recipient_snapshots" violates foreign key constraint "csf_communication_recipient_snapshots_campaign_fkey"',
  'a snapshot cannot claim an audience revision its campaign never published'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_recipient_snapshots (
      organization_id, campaign_id, snapshot_version, recipient_email,
      subscription_decision, club_representative_id, partner_club_term_id
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac700000-0000-4000-8000-000000000001',
      3, 'wrong.term@local.test', 'included',
      'ac600000-0000-4000-8000-000000000004', 'ac500000-0000-4000-8000-000000000002'
    )
  $$,
  '23503',
  'insert or update on table "csf_communication_recipient_snapshots" violates foreign key constraint "csf_communication_recipient_snapshots_representative_fkey"',
  'a snapshot cannot cite a representative of a different club term'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_recipient_snapshots (
      organization_id, campaign_id, snapshot_version, recipient_email,
      subscription_decision, club_representative_id
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac700000-0000-4000-8000-000000000001',
      3, 'orphan.pair@local.test', 'included', 'ac600000-0000-4000-8000-000000000004'
    )
  $$,
  '23514',
  'A CSF audience snapshot that cites a partner-club representative must also record that representative''s club term.',
  'a snapshot cannot cite a representative without recording its club term'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_recipient_snapshots (
      organization_id, campaign_id, snapshot_version, recipient_email, subscription_decision
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac700000-0000-4000-8000-000000000001',
      3, 'REPLACEMENT.LEAD@LOCAL.TEST', 'included'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "csf_communication_recipient_snapshots_campaign_email_idx"',
  'one recipient appears once per campaign audience snapshot'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_recipient_snapshots (
      organization_id, campaign_id, snapshot_version, recipient_email,
      subscription_decision, exclusion_reason
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac700000-0000-4000-8000-000000000001',
      3, 'missing.reason@local.test', 'excluded', NULL
    )
  $$,
  '23514',
  'new row for relation "csf_communication_recipient_snapshots" violates check constraint "csf_communication_recipient_snapshots_exclusion_check"',
  'an excluded recipient must record why it was excluded'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_recipient_snapshots
    SET recipient_email = 'rewritten.audience@local.test'
    WHERE id = 'ac800000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF audience snapshots are immutable after insert.',
  'a recorded audience snapshot cannot be edited'
);
SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_communication_recipient_snapshots
    WHERE id = 'ac800000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF audience snapshots cannot be deleted; use plugin_data.csf_purge_recovery_foundations().',
  'a recorded audience snapshot cannot be deleted'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_deliveries (
      id, organization_id, campaign_id, recipient_snapshot_id,
      provider_idempotency_key, status, attempt_count
    ) VALUES
      (
        'ac900000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001',
        'ac700000-0000-4000-8000-000000000001', 'ac800000-0000-4000-8000-000000000001',
        'delivery-audit-1', 'queued', 0
      ),
      (
        'ac900000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000001',
        'ac700000-0000-4000-8000-000000000001', 'ac800000-0000-4000-8000-000000000002',
        'delivery-audit-2', 'queued', 0
      )
  $$,
  'each included snapshot recipient gets its own queued delivery record'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_deliveries (
      organization_id, campaign_id, recipient_snapshot_id, provider_idempotency_key
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac700000-0000-4000-8000-000000000001',
      'ac800000-0000-4000-8000-000000000003', 'delivery-excluded'
    )
  $$,
  '23514',
  'A CSF delivery may only be created for an audience snapshot whose subscription decision is included.',
  'an excluded recipient never receives a delivery record'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_deliveries (
      organization_id, campaign_id, recipient_snapshot_id, provider_idempotency_key
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac700000-0000-4000-8000-000000000002',
      'ac800000-0000-4000-8000-000000000001', 'delivery-wrong-campaign'
    )
  $$,
  '23503',
  'insert or update on table "csf_communication_deliveries" violates foreign key constraint "csf_communication_deliveries_recipient_fkey"',
  'a delivery cannot quote one campaign audience row under another campaign'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_deliveries (
      organization_id, campaign_id, recipient_snapshot_id, provider_idempotency_key
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac700000-0000-4000-8000-000000000001',
      'ac800000-0000-4000-8000-000000000001', repeat('k', 257)
    )
  $$,
  '23514',
  'new row for relation "csf_communication_deliveries" violates check constraint "csf_communication_deliveries_idempotency_shape_check"',
  'a delivery idempotency key longer than Resend accepts is rejected'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_deliveries (
      organization_id, campaign_id, recipient_snapshot_id, provider_idempotency_key
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac700000-0000-4000-8000-000000000001',
      'ac800000-0000-4000-8000-000000000001', 'delivery-audit-1-retry'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "csf_communication_deliveries_campaign_recipient_key"',
  'one campaign recipient cannot be delivered twice'
);

SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_communication_deliveries
    SET
      status = 'sent',
      provider_message_id = 'resend-message-1',
      attempt_count = 1,
      sent_at = now(),
      updated_at = now()
    WHERE id = 'ac900000-0000-4000-8000-000000000001'
  $$,
  'a delivery advances to sent with its provider message identity'
);
SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_communication_deliveries
    SET status = 'delivered', delivered_at = now(), updated_at = now()
    WHERE id = 'ac900000-0000-4000-8000-000000000001'
  $$,
  'a sent delivery advances to delivered'
);
SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_communication_deliveries
    SET
      status = 'bounced',
      provider_message_id = 'resend-message-2',
      attempt_count = 1,
      sent_at = now(),
      failed_at = now(),
      last_error = 'Recipient address rejected by receiving server.',
      updated_at = now()
    WHERE id = 'ac900000-0000-4000-8000-000000000002'
  $$,
  'a delivery records a bounce with a bounded provider error'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_deliveries
    SET status = 'opened'
    WHERE id = 'ac900000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'new row for relation "csf_communication_deliveries" violates check constraint "csf_communication_deliveries_status_check"',
  'an unsupported delivery state is rejected'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_deliveries
    SET status = 'queued'
    WHERE id = 'ac900000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF delivery state may only advance; a delivered, bounced, complained, suppressed, or failed delivery never returns to queued or sent.',
  'a delivered delivery never returns to queued'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_deliveries
    SET attempt_count = 0
    WHERE id = 'ac900000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF delivery attempt count can never decrease.',
  'a delivery attempt count never decreases'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_deliveries
    SET campaign_id = 'ac700000-0000-4000-8000-000000000002'
    WHERE id = 'ac900000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF delivery campaign, recipient, and idempotency identity are frozen once recorded.',
  'a delivery cannot be re-pointed at another campaign'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_deliveries
    SET provider_message_id = 'resend-message-rewritten'
    WHERE id = 'ac900000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF delivery provider message identity is frozen once recorded.',
  'a recorded provider message identity is frozen'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_deliveries
    SET delivered_at = now() + interval '1 hour'
    WHERE id = 'ac900000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF delivery lifecycle timestamps are recorded once and never rewritten.',
  'a recorded delivery timestamp is never rewritten'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_deliveries
    SET last_error = repeat('x', 1001)
    WHERE id = 'ac900000-0000-4000-8000-000000000002'
  $$,
  '23514',
  'new row for relation "csf_communication_deliveries" violates check constraint "csf_communication_deliveries_last_error_bounded_check"',
  'a provider error is stored bounded rather than unbounded'
);
SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_communication_deliveries
    WHERE id = 'ac900000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF delivery history cannot be deleted; use plugin_data.csf_purge_recovery_foundations().',
  'a delivery cannot be deleted through ordinary operation'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_provider_events (
      id, organization_id, delivery_id, provider, provider_event_id, event_type,
      provider_message_id, occurred_at, payload_hash, metadata
    ) VALUES (
      'aca10000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001',
      'ac900000-0000-4000-8000-000000000001', 'resend',
      'msg_2recoveryEnvelope000000001', 'email.delivered', 'resend-message-1', now(),
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      '{"smtpCode":250}'::jsonb
    )
  $$,
  'a verified provider event is recorded against its delivery'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_provider_events (
      organization_id, delivery_id, provider_event_id, event_type,
      provider_message_id, occurred_at, payload_hash
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac900000-0000-4000-8000-000000000001',
      'msg_2recoveryEnvelope000000001', 'email.delivered', 'resend-message-1', now(),
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "csf_communication_provider_events_provider_event_id_key"',
  'a replayed Svix envelope id cannot change state twice'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_provider_events (
      organization_id, provider_event_id, event_type, occurred_at
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'msg_2recoveryEnvelope000000009',
      'email.bounced', now()
    )
  $$,
  '23502',
  'null value in column "payload_hash" of relation "csf_communication_provider_events" violates not-null constraint',
  'a provider event without a payload digest is rejected'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_provider_events (
      organization_id, provider_event_id, event_type, provider_message_id,
      occurred_at, payload_hash
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'resend-message-1', 'email.bounced',
      'resend-message-1', now(),
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    )
  $$,
  '23514',
  'new row for relation "csf_communication_provider_events" violates check constraint "csf_communication_provider_events_event_id_not_message_id_check"',
  'the dedupe identity cannot silently be the provider message id'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_provider_events (
      organization_id, provider_event_id, event_type, occurred_at, payload_hash, metadata
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'msg_2recoveryEnvelope000000002',
      'email.bounced', now(),
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      '{"html":"<p>original message</p>"}'::jsonb
    )
  $$,
  '23514',
  'new row for relation "csf_communication_provider_events" violates check constraint "csf_communication_provider_events_no_raw_content_check"',
  'a provider event cannot smuggle a raw email body into top-level metadata'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_provider_events (
      organization_id, provider_event_id, event_type, occurred_at, payload_hash, metadata
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'msg_2recoveryEnvelope000000003',
      'email.bounced', now(),
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      '{"detail":{"provider":{"Html_Body":"<p>hidden</p>"}}}'::jsonb
    )
  $$,
  '23514',
  'new row for relation "csf_communication_provider_events" violates check constraint "csf_communication_provider_events_no_raw_content_check"',
  'a raw email body nested three levels deep is still rejected'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_provider_events (
      organization_id, provider_event_id, event_type, occurred_at, payload_hash, metadata
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'msg_2recoveryEnvelope000000004',
      'email.bounced', now(),
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      '{"items":[{"ok":true},{"attachments":["invoice.pdf"]}]}'::jsonb
    )
  $$,
  '23514',
  'new row for relation "csf_communication_provider_events" violates check constraint "csf_communication_provider_events_no_raw_content_check"',
  'a content-bearing key inside a nested array is still rejected'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_provider_events (
      organization_id, delivery_id, provider_event_id, event_type,
      provider_message_id, occurred_at, payload_hash
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac900000-0000-4000-8000-000000000001',
      'msg_2recoveryEnvelope000000005', 'email.delivered', 'resend-message-2', now(),
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    )
  $$,
  '23514',
  'A CSF provider event may only be attached to the delivery whose provider message identity it reports.',
  'a provider event cannot be filed against a delivery it does not describe'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_provider_events
    SET payload_hash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    WHERE id = 'aca10000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF provider webhook evidence is append-only.',
  'recorded provider evidence cannot be edited'
);
SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_communication_provider_events
    WHERE id = 'aca10000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF provider webhook evidence cannot be deleted; use plugin_data.csf_purge_recovery_foundations().',
  'recorded provider evidence cannot be deleted'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_provider_events
    SET delivery_id = NULL
    WHERE id = 'aca10000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'A CSF provider event may be attached to its delivery once and never re-pointed.',
  'an attached provider event cannot be detached from a delivery that still exists'
);

-- Out-of-order webhook: the event arrives before its delivery row is linkable.
SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_provider_events (
      id, organization_id, provider_event_id, event_type,
      provider_message_id, occurred_at, payload_hash
    ) VALUES (
      'aca10000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000001',
      'msg_2recoveryEnvelope000000006', 'email.bounced', 'resend-message-2', now(),
      'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
    )
  $$,
  'an out-of-order provider event may be recorded before it is attached'
);
SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_communication_provider_events
    SET delivery_id = 'ac900000-0000-4000-8000-000000000002'
    WHERE id = 'aca10000-0000-4000-8000-000000000002'
  $$,
  'an unattached provider event reconciles once to the delivery whose message it reports'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_provider_events
    SET delivery_id = 'ac900000-0000-4000-8000-000000000001'
    WHERE id = 'aca10000-0000-4000-8000-000000000002'
  $$,
  '23514',
  'A CSF provider event may be attached to its delivery once and never re-pointed.',
  'a reconciled provider event cannot be re-pointed at a second delivery'
);

SELECT extensions.lives_ok(
  $$
    DELETE FROM plugin_data.csf_partner_club_representatives
    WHERE id = 'ac600000-0000-4000-8000-000000000005'
  $$,
  'a representative assignment can be removed from the current roster'
);
SELECT extensions.is(
  (
    SELECT snapshot.recipient_email
      || '|' || snapshot.recipient_name
      || '|' || coalesce(snapshot.club_representative_id::text, 'unlinked')
    FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
    WHERE snapshot.id = 'ac800000-0000-4000-8000-000000000002'
  ),
  'ephemeral.rep@local.test|Ephemeral Coordinator|unlinked',
  'a past audience is reconstructable from the snapshot after the roster changes'
);

-- ---------------------------------------------------------------------------
-- D. Append-only partner-club lifecycle events
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_term_events (
      id, organization_id, partner_club_term_id, event_type,
      previous_workflow_status, next_workflow_status, actor_user_id, reason,
      occurred_at, idempotency_key
    ) VALUES (
      'ace00000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001',
      'ac500000-0000-4000-8000-000000000001', 'audit_submitted',
      'pending', 'active', 'ac000000-0000-4000-8000-000000000001',
      'Robotics submitted its Fall 2031 audit.', now(), 'robotics-f31-audit-submitted'
    )
  $$,
  'a partner-club audit submission is recorded as its own lifecycle event'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_term_events (
      organization_id, partner_club_term_id, event_type, idempotency_key,
      source_import_job_id, communication_campaign_id
    )
    SELECT
      'ac100000-0000-4000-8000-000000000001',
      'ac500000-0000-4000-8000-000000000001',
      event_type,
      'robotics-f31-' || event_type,
      'aca00000-0000-4000-8000-000000000010',
      'ac700000-0000-4000-8000-000000000001'
    FROM (
      VALUES
        ('decision_recorded'),
        ('notification_recorded'),
        ('acknowledgment_recorded'),
        ('point_policy_published'),
        ('tracker_presence_recorded'),
        ('evidence_requested'),
        ('attendance_recorded'),
        ('hours_recorded'),
        ('photos_recorded'),
        ('completion_recorded'),
        ('award_proposed'),
        ('award_recorded'),
        ('standing_changed'),
        ('archived')
    ) AS lifecycle(event_type)
  $$,
  'every remaining lifecycle step is a separate event carrying its import and campaign links'
);
SELECT extensions.is(
  (
    SELECT count(DISTINCT event_type)::integer
    FROM plugin_data.csf_partner_club_term_events
    WHERE organization_id = 'ac100000-0000-4000-8000-000000000001'
      AND partner_club_term_id = 'ac500000-0000-4000-8000-000000000001'
  ),
  15,
  'all fifteen partner-club lifecycle steps are separately representable'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_term_events (
      organization_id, partner_club_term_id, event_type, idempotency_key
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000001',
      'status_overwritten', 'robotics-f31-unsupported'
    )
  $$,
  '23514',
  'new row for relation "csf_partner_club_term_events" violates check constraint "csf_partner_club_term_events_event_type_check"',
  'an untyped omnibus status update cannot be recorded as a lifecycle event'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_term_events (
      organization_id, partner_club_term_id, event_type, idempotency_key
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000002',
      'audit_submitted', 'robotics-f31-audit-submitted'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "csf_partner_club_term_events_idempotency_key"',
  'a retried lifecycle write is deduplicated by its idempotency key'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_partner_club_term_events
    SET reason = 'Rewritten history.'
    WHERE id = 'ace00000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'CSF partner-club lifecycle events are append-only.',
  'a recorded lifecycle event cannot be edited'
);
SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_partner_club_term_events
    WHERE id = 'ace00000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'CSF partner-club lifecycle events are append-only.',
  'a recorded lifecycle event cannot be deleted'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_partner_club_term_events (
      organization_id, partner_club_term_id, event_type, idempotency_key
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000003',
      'decision_recorded', 'cross-tenant-decision'
    )
  $$,
  '23503',
  'insert or update on table "csf_partner_club_term_events" violates foreign key constraint "csf_partner_club_term_events_club_term_fkey"',
  'a lifecycle event cannot be attached to another organization club term'
);

-- ---------------------------------------------------------------------------
-- E. Calendar tenant and type safety
-- ---------------------------------------------------------------------------

SELECT extensions.has_column(
  'public', 'organization_calendar_events', 'source_kind',
  'calendar bindings record which kind of record they project'
);
SELECT extensions.has_column(
  'public', 'organization_calendar_events', 'source_id',
  'calendar bindings record their source record identifier'
);
SELECT extensions.has_column(
  'public', 'organization_calendar_events', 'occurrence_key',
  'calendar bindings record a stable per-occurrence key'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO public.organization_calendar_events (
      id, organization_id, project_id, schedule_id, event_id
    ) VALUES (
      'acc00000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001',
      'acb00000-0000-4000-8000-000000000001', 'day-1', 'google-event-1'
    )
  $$,
  'the existing project calendar writer keeps working without supplying new columns'
);
SELECT extensions.is(
  (
    SELECT event.source_kind
      || '|' || event.source_id::text
      || '|' || event.occurrence_key
      || '|' || event.schedule_id
    FROM public.organization_calendar_events AS event
    WHERE event.id = 'acc00000-0000-4000-8000-000000000001'
  ),
  'project_schedule|acb00000-0000-4000-8000-000000000001|day-1|day-1',
  'a legacy project binding is generalized deterministically without losing schedule_id'
);
SELECT extensions.lives_ok(
  $$
    UPDATE public.organization_calendar_events
    SET schedule_id = 'day-1-rescheduled'
    WHERE id = 'acc00000-0000-4000-8000-000000000001'
  $$,
  'a legacy writer may still repoint the schedule coordinate it owns'
);
SELECT extensions.is(
  (
    SELECT event.occurrence_key || '|' || event.source_id::text
    FROM public.organization_calendar_events AS event
    WHERE event.id = 'acc00000-0000-4000-8000-000000000001'
  ),
  'day-1-rescheduled|acb00000-0000-4000-8000-000000000001',
  'a changed legacy schedule_id mirrors into occurrence_key instead of leaving it stale'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organization_calendar_events'::regclass
      AND conname = 'organization_calendar_events_organization_id_project_id_sch_key'
      AND contype = 'u'
  ),
  'the legacy project schedule unique constraint is preserved'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organization_calendar_events'::regclass
      AND conname = 'organization_calendar_events_source_occurrence_key'
      AND contype = 'u'
  ),
  'one source occurrence maps to one calendar binding per organization'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.projects'::regclass
      AND conname = 'projects_id_organization_id_key'
      AND contype = 'u'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organization_calendar_events'::regclass
      AND conname = 'organization_calendar_events_project_organization_fkey'
      AND contype = 'f'
      AND convalidated
  ),
  'project bindings are organization-scoped by a composite foreign key'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organization_calendar_events'::regclass
      AND conname = 'organization_calendar_events_project_id_fkey'
      AND contype = 'f'
      AND confdeltype = 'c'
  ),
  'the pre-existing project cascade semantics are preserved'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organization_calendar_events (
      organization_id, project_id, source_kind, source_id, occurrence_key, schedule_id, event_id
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'acb00000-0000-4000-8000-000000000001',
      'csf_opportunity', 'acf20000-0000-4000-8000-000000000001', 'occurrence-1',
      'occurrence-1', 'google-event-3'
    )
  $$,
  '23514',
  'new row for relation "organization_calendar_events" violates check constraint "organization_calendar_events_source_binding_check"',
  'a CSF binding cannot masquerade as a project schedule row'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organization_calendar_events (
      organization_id, project_id, schedule_id, event_id
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'acb00000-0000-4000-8000-000000000002',
      'day-2', 'google-event-2'
    )
  $$,
  '23503',
  'Calendar source project_schedule "acb00000-0000-4000-8000-000000000002" does not exist in this organization.',
  'one organization cannot bind another organization project'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO public.organization_calendar_events (
      id, organization_id, source_kind, source_id, occurrence_key, schedule_id, event_id
    ) VALUES (
      'acc00000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000001',
      'csf_meeting_session', 'acf10000-0000-4000-8000-000000000001', 'session-1',
      'session-1', 'google-event-4'
    )
  $$,
  'a real CSF meeting session projection is stored without a project reference'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organization_calendar_events (
      organization_id, source_kind, source_id, occurrence_key, schedule_id, event_id
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'csf_meeting_session',
      'acf10000-0000-4000-8000-000000000001', 'session-1', 'session-1', 'google-event-5'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "organization_calendar_events_source_occurrence_key"',
  'one CSF source occurrence cannot be projected twice'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organization_calendar_events (
      organization_id, source_kind, source_id, occurrence_key, schedule_id, event_id
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'csf_meeting_session',
      'acf20000-0000-4000-8000-000000000001', 'session-x', 'session-x', 'google-event-6'
    )
  $$,
  '23503',
  'Calendar source csf_meeting_session "acf20000-0000-4000-8000-000000000001" does not exist in this organization.',
  'an opportunity identifier cannot be projected as a meeting session'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organization_calendar_events (
      organization_id, source_kind, source_id, occurrence_key, schedule_id, event_id
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'csf_opportunity',
      'acf20000-0000-4000-8000-000000000002', 'occurrence-2', 'occurrence-2', 'google-event-7'
    )
  $$,
  '23503',
  'Calendar source csf_opportunity "acf20000-0000-4000-8000-000000000002" does not exist in this organization.',
  'one organization cannot project another organization CSF source'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organization_calendar_events (
      organization_id, source_kind, source_id, occurrence_key, schedule_id, event_id
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'csf_deadline',
      'acf30000-0000-4000-8000-000000000009', 'occurrence-3', 'occurrence-3', 'google-event-8'
    )
  $$,
  '23503',
  'Calendar source csf_deadline "acf30000-0000-4000-8000-000000000009" does not exist in this organization.',
  'a calendar binding cannot name a source record that does not exist'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organization_calendar_events (
      organization_id, source_kind, source_id, occurrence_key, schedule_id, event_id
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001', 'external_ics',
      'acf20000-0000-4000-8000-000000000001', 'occurrence-9', 'occurrence-9',
      'google-event-9'
    )
  $$,
  '23514',
  'new row for relation "organization_calendar_events" violates check constraint "organization_calendar_events_source_kind_check"',
  'an unsupported calendar source kind is rejected'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO public.organization_calendar_events (
      id, organization_id, source_kind, source_id, occurrence_key, schedule_id, event_id
    ) VALUES (
      'acc00000-0000-4000-8000-000000000004', 'ac100000-0000-4000-8000-000000000001',
      'csf_deadline', 'acf30000-0000-4000-8000-000000000001', 'due-1', 'due-1',
      'google-event-10'
    )
  $$,
  'a real CSF deadline projection is accepted'
);
SELECT extensions.ok(
  (
    SELECT bool_and(
      coalesce(policy.qual, '') LIKE '%project_schedule%'
      OR coalesce(policy.with_check, '') LIKE '%project_schedule%'
    )
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'organization_calendar_events'
      AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE')
      AND policy.roles::text LIKE '%authenticated%'
  ),
  'every authenticated calendar write policy is restricted to project schedule bindings'
);
SELECT extensions.ok(
  (
    SELECT bool_and(
      coalesce(policy.qual, '') LIKE '%status%active%'
      OR coalesce(policy.with_check, '') LIKE '%status%active%'
    )
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'organization_calendar_events'
      AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE')
      AND policy.roles::text LIKE '%authenticated%'
  ),
  'every authenticated calendar write policy requires an active organization membership'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'organization_calendar_events'
      AND policy.roles::text LIKE '%service_role%'
      AND policy.cmd = 'ALL'
  ),
  'the server role keeps explicit authority to write calendar projections'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'organization_calendar_events_source_lookup_idx'
      AND relkind = 'i'
  ),
  'calendar projections are indexed for per-source lookup'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY['anon', 'authenticated']) AS client(role_name)
    CROSS JOIN unnest(ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']) AS forbidden(privilege)
    WHERE has_table_privilege(
      client.role_name::name, 'public.organization_calendar_events', forbidden.privilege
    )
  ),
  'no client role may truncate, reference, or attach triggers to calendar bindings'
);
SELECT extensions.ok(
  (
    SELECT bool_and(
      has_table_privilege('authenticated', 'public.organization_calendar_events', wanted.privilege)
    )
    FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS wanted(privilege)
  ),
  'ordinary authenticated calendar access is left intact for the policies to govern'
);

INSERT INTO public.organization_calendar_events (
  id, organization_id, project_id, schedule_id, event_id
) VALUES (
  'acc00000-0000-4000-8000-000000000003', 'ac100000-0000-4000-8000-000000000001',
  'acb00000-0000-4000-8000-000000000001', 'day-9', 'google-event-11'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims =
  '{"sub":"ac000000-0000-4000-8000-000000000004","role":"authenticated"}';

SELECT extensions.throws_ok(
  'TRUNCATE public.organization_calendar_events',
  '42501',
  'permission denied for table organization_calendar_events',
  'an authenticated client cannot truncate calendar bindings'
);

-- An inactive membership is not a membership. The USING clause simply matches
-- nothing, so the delete removes no rows rather than raising.
SELECT extensions.lives_ok(
  $$
    DELETE FROM public.organization_calendar_events
    WHERE id = 'acc00000-0000-4000-8000-000000000003'
  $$,
  'an inactive staff member''s calendar delete is accepted by the parser'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.organization_calendar_events
    WHERE id = 'acc00000-0000-4000-8000-000000000003'
  ),
  1,
  'an inactive staff member deletes no calendar binding at all'
);

-- ---------------------------------------------------------------------------
-- F. Authorized teardown
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_communication_campaigns (
  id, organization_id, campaign_kind, status, sender_email, subject,
  audience_snapshot_version, provider_idempotency_key
) VALUES (
  'ac700000-0000-4000-8000-000000000009', 'ac100000-0000-4000-8000-000000000002',
  'broadcast', 'queued', 'other@local.test', 'Other organization campaign', 1,
  'campaign-other-org'
);

INSERT INTO plugin_data.csf_communication_recipient_snapshots (
  id, organization_id, campaign_id, snapshot_version, recipient_email,
  subscription_decision
) VALUES (
  'ac800000-0000-4000-8000-000000000009', 'ac100000-0000-4000-8000-000000000002',
  'ac700000-0000-4000-8000-000000000009', 1, 'other.rep@local.test', 'included'
);

INSERT INTO plugin_data.csf_communication_deliveries (
  id, organization_id, campaign_id, recipient_snapshot_id,
  provider_idempotency_key, provider_message_id, status, sent_at
) VALUES (
  'ac900000-0000-4000-8000-000000000009', 'ac100000-0000-4000-8000-000000000002',
  'ac700000-0000-4000-8000-000000000009', 'ac800000-0000-4000-8000-000000000009',
  'delivery-other-org', 'resend-message-other', 'sent', now()
);

INSERT INTO plugin_data.csf_communication_provider_events (
  id, organization_id, delivery_id, provider_event_id, event_type,
  provider_message_id, occurred_at, payload_hash
) VALUES (
  'aca10000-0000-4000-8000-000000000009', 'ac100000-0000-4000-8000-000000000002',
  'ac900000-0000-4000-8000-000000000009', 'msg_2recoveryEnvelope000000099',
  'email.sent', 'resend-message-other', now(),
  '9999888877776666555544443333222211110000ffffeeeeddddccccbbbbaaaa'
);

INSERT INTO plugin_data.csf_partner_club_representatives (
  id, organization_id, partner_club_term_id, role, display_name, email, status
) VALUES (
  'ac600000-0000-4000-8000-000000000009', 'ac100000-0000-4000-8000-000000000002',
  'ac500000-0000-4000-8000-000000000003', 'primary_contact', 'Other Org Lead',
  'other.lead@local.test', 'active'
);

INSERT INTO plugin_data.csf_partner_club_term_events (
  id, organization_id, partner_club_term_id, event_type, idempotency_key
) VALUES (
  'ace00000-0000-4000-8000-000000000009', 'ac100000-0000-4000-8000-000000000002',
  'ac500000-0000-4000-8000-000000000003', 'audit_submitted', 'other-org-audit'
);

INSERT INTO public.organization_calendar_events (
  id, organization_id, source_kind, source_id, occurrence_key, schedule_id, event_id
) VALUES (
  'acc00000-0000-4000-8000-000000000009', 'ac100000-0000-4000-8000-000000000002',
  'csf_opportunity', 'acf20000-0000-4000-8000-000000000002', 'other-1', 'other-1',
  'google-event-other'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_purge_recovery_foundations(
      'ac100000-0000-4000-8000-000000000001'
    )
  $$,
  'the authorized purge RPC runs for one organization'
);
SELECT extensions.is(
  (
    SELECT
      (SELECT count(*) FROM plugin_data.csf_communication_provider_events
       WHERE organization_id = 'ac100000-0000-4000-8000-000000000001')
      + (SELECT count(*) FROM plugin_data.csf_communication_deliveries
         WHERE organization_id = 'ac100000-0000-4000-8000-000000000001')
      + (SELECT count(*) FROM plugin_data.csf_communication_recipient_snapshots
         WHERE organization_id = 'ac100000-0000-4000-8000-000000000001')
      + (SELECT count(*) FROM plugin_data.csf_communication_campaigns
         WHERE organization_id = 'ac100000-0000-4000-8000-000000000001')
      + (SELECT count(*) FROM plugin_data.csf_partner_club_term_events
         WHERE organization_id = 'ac100000-0000-4000-8000-000000000001')
      + (SELECT count(*) FROM plugin_data.csf_partner_club_representatives
         WHERE organization_id = 'ac100000-0000-4000-8000-000000000001')
  )::integer,
  0,
  'the purge removes every recovery-foundation record for the target organization'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.organization_calendar_events
    WHERE organization_id = 'ac100000-0000-4000-8000-000000000001'
      AND source_kind <> 'project_schedule'
  ),
  0,
  'the purge retires the target organization CSF calendar projections'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.organization_calendar_events
    WHERE organization_id = 'ac100000-0000-4000-8000-000000000001'
      AND source_kind = 'project_schedule'
  ),
  2,
  'the purge leaves every project schedule calendar binding in place'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.projects
    WHERE organization_id = 'ac100000-0000-4000-8000-000000000001'
  ),
  1,
  'the purge never deletes a core project'
);
SELECT extensions.is(
  (
    SELECT
      (SELECT count(*) FROM plugin_data.csf_communication_provider_events
       WHERE organization_id = 'ac100000-0000-4000-8000-000000000002')
      + (SELECT count(*) FROM plugin_data.csf_communication_deliveries
         WHERE organization_id = 'ac100000-0000-4000-8000-000000000002')
      + (SELECT count(*) FROM plugin_data.csf_communication_recipient_snapshots
         WHERE organization_id = 'ac100000-0000-4000-8000-000000000002')
      + (SELECT count(*) FROM plugin_data.csf_communication_campaigns
         WHERE organization_id = 'ac100000-0000-4000-8000-000000000002')
      + (SELECT count(*) FROM plugin_data.csf_partner_club_term_events
         WHERE organization_id = 'ac100000-0000-4000-8000-000000000002')
      + (SELECT count(*) FROM plugin_data.csf_partner_club_representatives
         WHERE organization_id = 'ac100000-0000-4000-8000-000000000002')
      + (SELECT count(*) FROM public.organization_calendar_events
         WHERE organization_id = 'ac100000-0000-4000-8000-000000000002')
  )::integer,
  7,
  'the purge leaves the other organization entirely untouched'
);
SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_communication_provider_events
    WHERE organization_id = 'ac100000-0000-4000-8000-000000000002'
  $$,
  '23514',
  'CSF provider webhook evidence cannot be deleted; use plugin_data.csf_purge_recovery_foundations().',
  'the purge flag does not survive its own transaction step for another organization'
);

-- ---------------------------------------------------------------------------
-- G. Index discipline and audit target lookup
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relkind = 'i'
      AND relname IN (
        'csf_communication_campaigns_created_by_idx',
        'csf_partner_club_representatives_created_by_idx',
        'csf_partner_club_term_events_actor_idx'
      )
  ),
  'the speculative nullable actor and creator indexes are not created'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'csf_admin_audit_events_target_idx'
      AND relkind = 'i'
  ),
  'audit history for one target record is indexed newest first'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_meta
    JOIN pg_class AS index_class ON index_class.oid = index_meta.indexrelid
    JOIN pg_class AS table_class ON table_class.oid = index_meta.indrelid
    JOIN pg_namespace AS schema_meta ON schema_meta.oid = table_class.relnamespace
    WHERE index_class.relname IN (
        'csf_sheet_import_rows_retry_of_row_idx',
        'csf_communication_recipient_snapshots_representative_idx',
        'csf_partner_club_representatives_import_row_idx'
      )
      AND schema_meta.nspname <> 'plugin_data'
  )
  AND (
    SELECT count(*)::integer FROM pg_class
    WHERE relkind = 'i'
      AND relname IN (
        'csf_sheet_import_rows_retry_of_row_idx',
        'csf_communication_recipient_snapshots_representative_idx',
        'csf_partner_club_representatives_import_row_idx'
      )
  ) = 3,
  'the foreign-key delete paths that a routine delete actually walks stay indexed'
);

SELECT * FROM extensions.finish();
ROLLBACK;
