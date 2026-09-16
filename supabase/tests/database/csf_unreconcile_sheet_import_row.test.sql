BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(26);

-- Reach. Reversal is an identity mutation, so it lives behind the same wall as
-- reconciliation: the server role only, and the unguarded base not even that.
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_unreconcile_sheet_import_row(uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot reverse an identity reconciliation'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_unreconcile_sheet_import_row(uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot reverse an identity reconciliation directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_unreconcile_sheet_import_row(uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'the server role can reverse an identity reconciliation'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_unreconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'the lock-free base is unreachable even by the server role'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'e1000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'unreconcile-officer@local.test', now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'e1100000-0000-4000-8000-000000000001',
    'CSF Unreconcile Subject',
    'csf-unreconcile-subject',
    'school',
    '995101'
  ),
  (
    'e1100000-0000-4000-8000-000000000002',
    'CSF Unreconcile Bystander',
    'csf-unreconcile-bystander',
    'school',
    '995102'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'e1100000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester)
VALUES (
  'e1200000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'F31', 'Fall 2031', '2031-2032', 'fall'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  (
    'e1300000-0000-4000-8000-000000000001',
    'e1100000-0000-4000-8000-000000000001',
    'Reverted', 'Applicant', 'reverted', 'applicant'
  ),
  (
    'e1300000-0000-4000-8000-000000000002',
    'e1100000-0000-4000-8000-000000000001',
    'Committed', 'Applicant', 'committed', 'applicant'
  ),
  (
    'e1300000-0000-4000-8000-000000000003',
    'e1100000-0000-4000-8000-000000000001',
    'Frozen', 'Applicant', 'frozen', 'applicant'
  );

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, provider, spreadsheet_id, uploaded_file_path,
  drive_file_id, drive_mime_type, drive_modified_at, sync_status, settings
) VALUES (
  'e1500000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'application_responses',
  'Unreconcile application source',
  'google_sheets', 'unreconcile-applications', NULL,
  'unreconcile-applications', 'application/vnd.google-apps.spreadsheet',
  '2031-08-01T00:00:00Z', 'not_synced',
  '{"sourceKind":"application_responses"}'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  mapping_snapshot, mapping_version, correlation_id, summary, completed_at
) VALUES (
  'e1600000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'e1500000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'preview', 'needs_resolution', 'application_responses',
  'unreconcile-applications', 'Applications', 'Responses', 'Responses!A1:D40',
  '{"version":1,"sourceType":"application_responses"}', 1,
  'e1d00000-0000-4000-8000-000000000001', '{}', now()
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, term_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, matched_profile_id, import_status, correlation_id
) VALUES
  (
    'e1700000-0000-4000-8000-000000000001',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'Responses', 2, '{"Name":"Reverted Applicant"}',
    '{"submittedName":"Reverted Applicant"}',
    'unreconcile-revert-hash', NULL, 'ambiguous',
    'e1d00000-0000-4000-8000-000000000001'
  ),
  (
    'e1700000-0000-4000-8000-000000000002',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'Responses', 3, '{"Name":"Untouched Applicant"}',
    '{"submittedName":"Untouched Applicant"}',
    'unreconcile-untouched-hash', NULL, 'ambiguous',
    'e1d00000-0000-4000-8000-000000000001'
  );

-- A committed row and a commit-frozen row, written directly because getting
-- there through the commit pipeline is a different test's subject. Both carry
-- the freeze columns their check constraints demand.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, term_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, matched_profile_id, import_status,
  resolution_status, resolved_by, resolved_at, resolution_reason_code, correlation_id,
  commit_outcome_state, commit_frozen_at, commit_frozen_by_job_id, commit_frozen_row_hash,
  commit_frozen_source_id, commit_frozen_payload_hash, commit_frozen_actor_snapshot,
  commit_resolution_snapshot, commit_frozen_actor_user_id, commit_target_profile_id
) VALUES
  (
    'e1700000-0000-4000-8000-000000000003',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'Responses', 4, '{"Name":"Committed Applicant"}',
    '{"submittedName":"Committed Applicant"}',
    'unreconcile-committed-hash',
    'e1300000-0000-4000-8000-000000000002', 'created',
    'resolved', 'e1000000-0000-4000-8000-000000000001', now(), 'officer_match',
    'e1d00000-0000-4000-8000-000000000001',
    'succeeded', now(), 'e1600000-0000-4000-8000-000000000001', 'c011111111111111111111111111111111111111111111111111111111111111',
    'e1500000-0000-4000-8000-000000000001', 'c022222222222222222222222222222222222222222222222222222222222222',
    '{"role":"admin"}'::jsonb, '{"decision":"match"}'::jsonb,
    'e1000000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000002'
  ),
  (
    'e1700000-0000-4000-8000-000000000004',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'Responses', 5, '{"Name":"Frozen Applicant"}',
    '{"submittedName":"Frozen Applicant"}',
    'unreconcile-frozen-hash',
    'e1300000-0000-4000-8000-000000000003', 'pending',
    'resolved', 'e1000000-0000-4000-8000-000000000001', now(), 'officer_match',
    'e1d00000-0000-4000-8000-000000000001',
    'not_started', now(), 'e1600000-0000-4000-8000-000000000001', 'f011111111111111111111111111111111111111111111111111111111111111',
    'e1500000-0000-4000-8000-000000000001', 'f022222222222222222222222222222222222222222222222222222222222222',
    '{"role":"admin"}'::jsonb, '{"decision":"match"}'::jsonb,
    'e1000000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000003'
  );

-- Resolve the subject row the ordinary way, so the reversal has a real
-- reconciliation to reverse rather than a hand-written approximation of one.
SELECT plugin_data.csf_reconcile_sheet_import_row(
  'e1100000-0000-4000-8000-000000000001',
  'e1700000-0000-4000-8000-000000000001',
  'e1300000-0000-4000-8000-000000000001',
  'match', 'Bulk proposal confirmed by the reviewing officer.',
  'e1000000-0000-4000-8000-000000000001',
  'e1d00000-0000-4000-8000-000000000001',
  '{"matchMethod":"deterministic_exact_name","matchConfidence":1,"matchDetails":{},"batchId":"e1f00000-0000-4000-8000-000000000001"}'::jsonb
);

SELECT extensions.is(
  (SELECT resolution_status FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'e1700000-0000-4000-8000-000000000001'),
  'resolved',
  'the subject row starts out reconciled'
);

-- Guards.
SELECT extensions.throws_ok($$
  SELECT plugin_data.csf_unreconcile_sheet_import_row(
    'e1100000-0000-4000-8000-000000000001',
    'e1700000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    '   ', 'e1f00000-0000-4000-8000-000000000002'
  )
$$, 'An unreconciliation reason is required.',
  'a reversal without a reason is refused');

SELECT extensions.throws_ok($$
  SELECT plugin_data.csf_unreconcile_sheet_import_row(
    'e1100000-0000-4000-8000-000000000001',
    'e1700000-0000-4000-8000-000000000001',
    NULL,
    'Reversing the batch.', 'e1f00000-0000-4000-8000-000000000002'
  )
$$, 'A CSF import action requires an organization and an acting officer.',
  'a reversal without an actor is refused by the actor check, ahead of the function''s own guard');

SELECT extensions.throws_ok($$
  SELECT plugin_data.csf_unreconcile_sheet_import_row(
    'e1100000-0000-4000-8000-000000000002',
    'e1700000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'Reversing the batch.', 'e1f00000-0000-4000-8000-000000000002'
  )
$$, 'CSF import row was not found for this organization.',
  'a reversal aimed at another organization cannot reach the row');

SELECT extensions.throws_ok($$
  SELECT plugin_data.csf_unreconcile_sheet_import_row(
    'e1100000-0000-4000-8000-000000000001',
    'e1700000-0000-4000-8000-000000000003',
    'e1000000-0000-4000-8000-000000000001',
    'Reversing the batch.', 'e1f00000-0000-4000-8000-000000000002'
  )
$$, 'This row has already been committed; reverse it through the commit outcome instead.',
  'a committed row is not reversible here');

SELECT extensions.is(
  (SELECT matched_profile_id FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'e1700000-0000-4000-8000-000000000003'),
  'e1300000-0000-4000-8000-000000000002'::uuid,
  'the refused committed row keeps the member it wrote'
);

SELECT extensions.throws_ok($$
  SELECT plugin_data.csf_unreconcile_sheet_import_row(
    'e1100000-0000-4000-8000-000000000001',
    'e1700000-0000-4000-8000-000000000004',
    'e1000000-0000-4000-8000-000000000001',
    'Reversing the batch.', 'e1f00000-0000-4000-8000-000000000002'
  )
$$, 'This row is frozen for a commit attempt; wait for that attempt to finish.',
  'a row frozen for an outstanding commit is not reversible');

SELECT extensions.throws_ok($$
  SELECT plugin_data.csf_unreconcile_sheet_import_row(
    'e1100000-0000-4000-8000-000000000001',
    'e1700000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'Reverse a stale batch.',
    'e1f00000-0000-4000-8000-000000000002'
  )
$$, 'This row no longer belongs to the requested confirmation batch.',
  'a different batch cannot reverse this resolution');

-- The reversal itself.
SELECT extensions.lives_ok($$
  SELECT plugin_data.csf_unreconcile_sheet_import_row(
    'e1100000-0000-4000-8000-000000000001',
    'e1700000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'The bulk batch matched the wrong cohort.',
    'e1f00000-0000-4000-8000-000000000001'
  )
$$, 'an uncommitted reconciliation reverses');

SELECT extensions.ok(
  (SELECT matched_profile_id IS NULL
      AND import_status = 'ambiguous'
      AND resolution_status = 'pending'
      AND resolved_by IS NULL
      AND resolved_at IS NULL
      AND resolution_reason_code IS NULL
      AND resolution_notes IS NULL
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'e1700000-0000-4000-8000-000000000001'),
  'the reversed row is back in the queue with no member attached'
);

SELECT extensions.is(
  (SELECT resolution_metadata->>'revertedBatchId'
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'e1700000-0000-4000-8000-000000000001'),
  'e1f00000-0000-4000-8000-000000000001',
  'the reversal names the batch it belonged to'
);

SELECT extensions.is(
  (SELECT resolution_metadata->>'revertedBy'
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'e1700000-0000-4000-8000-000000000001'),
  'e1000000-0000-4000-8000-000000000001',
  'the reversal names who reversed it'
);

-- The row's own columns are cleared, so the audit event is the only place the
-- reversed match survives. A batch that went wrong is unfindable without it.
SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_admin_audit_events
    WHERE action = 'sheet_import.identity_unreconciled'
      AND target_id = 'e1700000-0000-4000-8000-000000000001'),
  1,
  'the reversal is audited'
);

SELECT extensions.is(
  (SELECT before_data->>'matched_profile_id' FROM plugin_data.csf_admin_audit_events
    WHERE action = 'sheet_import.identity_unreconciled'
      AND target_id = 'e1700000-0000-4000-8000-000000000001'),
  'e1300000-0000-4000-8000-000000000001',
  'the audit trail preserves the member the reversal detached'
);

-- Idempotence, because a batch reversal that half-applied must be safe to
-- replay over the rows it already reached.
SELECT extensions.is(
  (SELECT plugin_data.csf_unreconcile_sheet_import_row(
    'e1100000-0000-4000-8000-000000000001',
    'e1700000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'Replaying the same reversal.',
    'e1f00000-0000-4000-8000-000000000001'
  )->>'reverted'),
  'true',
  'replaying a reversal returns the successful receipt'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_admin_audit_events
    WHERE action = 'sheet_import.identity_unreconciled'
      AND target_id = 'e1700000-0000-4000-8000-000000000001'),
  1,
  'the replayed no-op does not invent a second audit event'
);

SELECT extensions.is(
  (SELECT plugin_data.csf_unreconcile_sheet_import_row(
    'e1100000-0000-4000-8000-000000000001',
    'e1700000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000001',
    'Reversing a row the batch never resolved.',
    'e1f00000-0000-4000-8000-000000000001'
  )->>'reverted'),
  'false',
  'a row that was never reconciled reverses to nothing'
);

SELECT extensions.is(
  plugin_data.csf_unreconcile_sheet_import_row(
    'e1100000-0000-4000-8000-000000000001',
    'e1700000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'A different batch must not claim this reversal.',
    'e1f00000-0000-4000-8000-000000000002'
  )->>'reverted', 'false', 'another batch cannot replay this receipt'
);

-- The point of the undo: the row is genuinely back in play, not merely blanked.
SELECT extensions.lives_ok($$
  SELECT plugin_data.csf_reconcile_sheet_import_row(
    'e1100000-0000-4000-8000-000000000001',
    'e1700000-0000-4000-8000-000000000001',
    'e1300000-0000-4000-8000-000000000001',
    'match', 'Officer re-resolved the row by hand after the batch was reversed.',
    'e1000000-0000-4000-8000-000000000001',
    'e1d00000-0000-4000-8000-000000000001',
    '{"matchMethod":"officer_review","matchConfidence":1,"matchDetails":{}}'::jsonb
  )
$$, 'a reversed row can be reconciled again');

SELECT extensions.is(
  (SELECT matched_profile_id FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'e1700000-0000-4000-8000-000000000001'),
  'e1300000-0000-4000-8000-000000000001'::uuid,
  'the re-reconciled row carries the member the officer chose'
);

SELECT extensions.throws_ok($$
  SELECT plugin_data.csf_unreconcile_sheet_import_row(
    'e1100000-0000-4000-8000-000000000001',
    'e1700000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'Reverse a stale batch.',
    'e1f00000-0000-4000-8000-000000000001'
  )
$$, 'This row no longer belongs to the requested confirmation batch.',
  'a delayed undo cannot reverse a newer manual resolution');

SELECT extensions.is(
  (SELECT matched_profile_id FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'e1700000-0000-4000-8000-000000000001'),
  'e1300000-0000-4000-8000-000000000001'::uuid,
  'refused stale undo preserves the later match'
);

SELECT * FROM extensions.finish();
ROLLBACK;
