-- Sheets application review: private staging, atomic release, and what a later
-- sync does to an already-published row.
--
-- Proved here:
--   A. privilege boundaries and the service-role SELECT-only posture;
--   B. staging writes no application, membership, or platform-member state;
--   C. provenance is verified in the database, not claimed by the caller;
--   D. release publishes an accepted applicant whose in-app academic
--      evaluation is incomplete — the officer's Sheet verdict is the authority;
--   E. yellow with no reason is held, unreviewed stays pending;
--   F. a later sync revokes an active member, and an uncolored row retracts a
--      published decision;
--   G. a completed term outcome is never rewritten;
--   H. the in-app decision path cannot publish behind the release gate;
--   I. a sheet row cannot hand a verdict to the wrong applicant in the same
--      workbook, and an application with no recorded lineage stages nothing;
--   J. a mapping edited after the read cannot apply obsolete column semantics;
--   K. a reused request id is bound to its term and payload;
--   L. evidence is immutable and no notification delivery is ever enqueued.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(51);

-- ---------------------------------------------------------------------------
-- A. Privilege boundaries
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_stage_sheet_application_decisions(uuid,uuid,uuid,uuid,jsonb,jsonb)',
    'EXECUTE'
  ),
  'the server role can stage a decision sync run'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_release_sheet_application_decisions(uuid,uuid,uuid,uuid,uuid[])',
    'EXECUTE'
  ),
  'the server role can release a term'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_publish_sheet_application_decision(uuid,uuid,text,text,uuid,jsonb)',
    'EXECUTE'
  ),
  'the publish primitive stays internal to the release and sync transactions'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_term_is_sheet_review(uuid,uuid)',
    'EXECUTE'
  ),
  'the review-source predicate is internal'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_application_decision_stages', 'SELECT'),
  'browser-authenticated users cannot read staged decisions'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'plugin_data.csf_application_decision_sync_rows', 'SELECT'),
  'anonymous visitors cannot read decision sync evidence'
);
SELECT extensions.ok(
  has_table_privilege('service_role', 'plugin_data.csf_application_decision_stages', 'SELECT')
    AND NOT has_table_privilege('service_role', 'plugin_data.csf_application_decision_stages', 'INSERT')
    AND NOT has_table_privilege('service_role', 'plugin_data.csf_application_decision_stages', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'plugin_data.csf_application_decision_stages', 'DELETE'),
  'the server role reads staged decisions but can only write them through a reviewed function'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('de000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'csf-sheet-decision-officer@local.test', now(), '{}', '{}', now(), now()),
  ('de000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'csf-sheet-decision-member@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'de100000-0000-4000-8000-000000000001',
  'CSF Sheet Decision Review',
  'csf-sheet-decision-review',
  'school',
  '740021'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('de100000-0000-4000-8000-000000000001',
   'de000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('de100000-0000-4000-8000-000000000001',
   'de000000-0000-4000-8000-000000000002', 'member', 'active');

INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester, is_current)
VALUES (
  'de200000-0000-4000-8000-000000000001',
  'de100000-0000-4000-8000-000000000001',
  'F30', 'Fall 2030', '2030-2031', 'fall', true
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES (
  'de500000-0000-4000-8000-000000000001',
  'de100000-0000-4000-8000-000000000001',
  2034, 'c/o 2034', 'active'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('de300000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001',
   'Green', 'Applicant', 'green', 'applicant'),
  ('de300000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001',
   'Yellow', 'Applicant', 'yellow', 'applicant'),
  ('de300000-0000-4000-8000-000000000003', 'de100000-0000-4000-8000-000000000001',
   'Explained', 'Applicant', 'explained', 'applicant'),
  ('de300000-0000-4000-8000-000000000004', 'de100000-0000-4000-8000-000000000001',
   'Uncolored', 'Applicant', 'uncolored', 'applicant'),
  ('de300000-0000-4000-8000-000000000005', 'de100000-0000-4000-8000-000000000001',
   'Unbound', 'Applicant', 'unbound', 'applicant');

-- The accepted applicant owns the member account, so the member-side projection
-- can be checked before and after release.
INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'de100000-0000-4000-8000-000000000001',
  'de300000-0000-4000-8000-000000000001',
  'de000000-0000-4000-8000-000000000002',
  'verified', true
);

-- Two registered application-responses workbooks: the regular form and the
-- late-response form. Both are ordinary rows; no id is special.
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, title, provider, source_type, drive_file_id, spreadsheet_id
) VALUES
  ('de400000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001',
   'Fall 2030 applications', 'google_sheets', 'application_responses',
   'de-regular-workbook', 'de-regular-workbook'),
  ('de400000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001',
   'Fall 2030 late applications', 'google_sheets', 'application_responses',
   'de-late-workbook', 'de-late-workbook');

INSERT INTO plugin_data.csf_application_decision_mappings (
  organization_id, source_id, decision_columns, reason_columns, reads_cell_note
) VALUES (
  'de100000-0000-4000-8000-000000000001',
  'de400000-0000-4000-8000-000000000001',
  ARRAY[7], ARRAY[8], true
);

-- A commit job has to name the preview it came from, so the fixture follows
-- the real preview-then-commit lineage rather than inventing a bare commit.
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, mode, status, source_file_id
) VALUES
  ('de700000-0000-4000-8000-000000000011', 'de100000-0000-4000-8000-000000000001',
   'de400000-0000-4000-8000-000000000001', 'preview', 'completed', 'de-regular-workbook'),
  ('de700000-0000-4000-8000-000000000012', 'de100000-0000-4000-8000-000000000001',
   'de400000-0000-4000-8000-000000000002', 'preview', 'completed', 'de-late-workbook');

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, mode, status, source_file_id, preview_job_id
) VALUES
  ('de700000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001',
   'de400000-0000-4000-8000-000000000001', 'commit', 'completed', 'de-regular-workbook',
   'de700000-0000-4000-8000-000000000011'),
  ('de700000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001',
   'de400000-0000-4000-8000-000000000002', 'commit', 'completed', 'de-late-workbook',
   'de700000-0000-4000-8000-000000000012');

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  source_file_id, source_sheet_tab, source_row_number,
  google_form_response_id, source_submitted_at
) VALUES
  ('de600000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001',
   'de300000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'google_form_sheet', 'submitted',
   'de-regular-workbook', 'Form Responses 1', 11,
   'response-green', '2030-08-01T09:00:00Z'),
  ('de600000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001',
   'de300000-0000-4000-8000-000000000002', 'de500000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'google_form_sheet', 'submitted',
   'de-regular-workbook', 'Form Responses 1', 12,
   'response-yellow', '2030-08-01T09:05:00Z'),
  ('de600000-0000-4000-8000-000000000003', 'de100000-0000-4000-8000-000000000001',
   'de300000-0000-4000-8000-000000000003', 'de500000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'google_form_sheet', 'submitted',
   'de-regular-workbook', 'Form Responses 1', 13,
   'response-explained', '2030-08-01T09:10:00Z'),
  ('de600000-0000-4000-8000-000000000004', 'de100000-0000-4000-8000-000000000001',
   'de300000-0000-4000-8000-000000000004', 'de500000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'google_form_sheet', 'submitted',
   'de-regular-workbook', 'Form Responses 1', 14,
   'response-uncolored', '2030-08-01T09:15:00Z'),
  -- Manually created: no workbook, no import row, no response id. A sheet row
  -- claiming it has no provenance chain to stand on.
  ('de600000-0000-4000-8000-000000000005', 'de100000-0000-4000-8000-000000000001',
   'de300000-0000-4000-8000-000000000005', 'de500000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'manual', 'submitted',
   NULL, NULL, NULL, NULL, NULL);

-- A second term, so a reused request id can be aimed somewhere else.
INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester)
VALUES (
  'de200000-0000-4000-8000-000000000002',
  'de100000-0000-4000-8000-000000000001',
  'S31', 'Spring 2031', '2030-2031', 'spring'
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, term_id, sheet_tab_name, row_number,
  row_hash, matched_application_id, import_status
) VALUES
  ('de800000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001',
   'de700000-0000-4000-8000-000000000001', 'de400000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'Form Responses 1', 11,
   'hash-green', 'de600000-0000-4000-8000-000000000001', 'created'),
  ('de800000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001',
   'de700000-0000-4000-8000-000000000001', 'de400000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'Form Responses 1', 12,
   'hash-yellow', 'de600000-0000-4000-8000-000000000002', 'created'),
  ('de800000-0000-4000-8000-000000000003', 'de100000-0000-4000-8000-000000000001',
   'de700000-0000-4000-8000-000000000001', 'de400000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'Form Responses 1', 13,
   'hash-explained', 'de600000-0000-4000-8000-000000000003', 'created'),
  ('de800000-0000-4000-8000-000000000004', 'de100000-0000-4000-8000-000000000001',
   'de700000-0000-4000-8000-000000000001', 'de400000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'Form Responses 1', 14,
   'hash-uncolored', 'de600000-0000-4000-8000-000000000004', 'created');

-- The applications carry NO completed academic checks: the six-check evaluation
-- is exactly the in-app evidence the chapter is not using this term.
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_application_checks
    WHERE organization_id = 'de100000-0000-4000-8000-000000000001'
      AND application_id = 'de600000-0000-4000-8000-000000000001'
      AND status = 'passed'
  ),
  'the accepted applicant has no passing in-app academic check to lean on'
);

-- ---------------------------------------------------------------------------
-- B. Turning on Sheets review changes nothing else
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_set_term_application_review_source(
      'de100000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000001',
      'de200000-0000-4000-8000-000000000001',
      'sheet',
      'dea00000-0000-4000-8000-000000000001'
    )
  $$,
  'an authorized officer can put the term into Sheets review'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'de100000-0000-4000-8000-000000000001'),
  0,
  'enabling Sheets review creates no term membership'
);

SELECT extensions.ok(
  (
    SELECT (result ->> 'replay')::boolean
    FROM (
      SELECT plugin_data.csf_set_term_application_review_source(
        'de100000-0000-4000-8000-000000000001',
        'de000000-0000-4000-8000-000000000001',
        'de200000-0000-4000-8000-000000000001',
        'sheet',
        'dea00000-0000-4000-8000-000000000001'
      ) AS result
    ) AS replayed
  ),
  'an exact replay of the review-source request returns the recorded outcome'
);

-- ---------------------------------------------------------------------------
-- C. Staging: provenance verified, nothing published
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_stage_sheet_application_decisions(
      'de100000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000001',
      'de200000-0000-4000-8000-000000000001',
      'deb00000-0000-4000-8000-000000000001',
      $evidence$[
        {"sourceId":"de400000-0000-4000-8000-000000000001",
         "sheetTabName":"Form Responses 1","readStatus":"read",
         "spreadsheetFileId":"de-regular-workbook","spreadsheetTitle":"Fall 2030 applications",
         "providerVersion":"7","sheetTabId":0,"requestedRange":"A1:Z100",
         "contentHash":"content-hash-1","mappingVersion":"1",
         "decisionColumns":[7],"reasonColumns":[8]},
        {"sourceId":"de400000-0000-4000-8000-000000000002",
         "sheetTabName":"Form Responses 1","readStatus":"not_configured",
         "spreadsheetFileId":"de-late-workbook",
         "message":"No decision mapping configured for the late workbook.",
         "requestedRange":"A1:Z100"}
      ]$evidence$::jsonb,
      $rows$[
        {"sourceId":"de400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
         "observedRowNumber":11,"applicationId":"de600000-0000-4000-8000-000000000001",
         "importRowId":"de800000-0000-4000-8000-000000000001","status":"accepted",
         "observedColor":"#d9ead3","identityDigest":"id-1","decisionDigest":"dec-1"},
        {"sourceId":"de400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
         "observedRowNumber":12,"applicationId":"de600000-0000-4000-8000-000000000002",
         "importRowId":"de800000-0000-4000-8000-000000000002",
         "status":"rejected_with_explanation","observedColor":"#fff2cc",
         "identityDigest":"id-2","decisionDigest":"dec-2"},
        {"sourceId":"de400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
         "observedRowNumber":13,"applicationId":"de600000-0000-4000-8000-000000000003",
         "importRowId":"de800000-0000-4000-8000-000000000003",
         "status":"rejected_with_explanation","observedColor":"#fff2cc",
         "reason":"Course list does not meet the chapter standard.",
         "identityDigest":"id-3","decisionDigest":"dec-3"},
        {"sourceId":"de400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
         "observedRowNumber":14,"applicationId":"de600000-0000-4000-8000-000000000004",
         "importRowId":"de800000-0000-4000-8000-000000000004","status":"unreviewed",
         "identityDigest":"id-4","decisionDigest":"dec-4"},
        {"sourceId":"de400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
         "observedRowNumber":15,"applicationId":"de600000-0000-4000-8000-000000000005",
         "status":"accepted","observedColor":"#d9ead3",
         "identityDigest":"id-5","decisionDigest":"dec-5"},
        {"sourceId":"de400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
         "observedRowNumber":16,"applicationId":null,"status":"unreviewed",
         "blockReason":"no_import_row","identityDigest":"id-6","decisionDigest":"dec-6"}
      ]$rows$::jsonb
    )
  $$,
  'a decision sync run stages without error'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_applications
    WHERE id = 'de600000-0000-4000-8000-000000000001'
  ),
  'submitted',
  'a staged acceptance does not touch the application status'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'de100000-0000-4000-8000-000000000001'),
  0,
  'a staged acceptance grants no term membership'
);

SELECT extensions.is(
  (
    SELECT block_reason
    FROM plugin_data.csf_application_decision_stages
    WHERE application_id = 'de600000-0000-4000-8000-000000000005'
  ),
  'provenance_unverified',
  'a claimed application with no workbook provenance is refused, not staged as a decision'
);

SELECT extensions.is(
  (
    SELECT staged_decision
    FROM plugin_data.csf_application_decision_stages
    WHERE application_id = 'de600000-0000-4000-8000-000000000005'
  ),
  'accepted',
  'the unverified claim is recorded verbatim as evidence'
);

SELECT extensions.ok(
  (
    SELECT blocks_release
    FROM plugin_data.csf_application_decision_stages
    WHERE application_id = 'de600000-0000-4000-8000-000000000005'
  ),
  'an unverified row can never be released'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_application_decision_sync_rows
    WHERE run_id = (
      SELECT id FROM plugin_data.csf_application_decision_sync_runs
      WHERE request_id = 'deb00000-0000-4000-8000-000000000001'
    )
      AND outcome = 'unmatched'
  ),
  1,
  'the sheet row that matched nothing is kept as visible evidence'
);

SELECT extensions.is(
  (
    SELECT read_status
    FROM plugin_data.csf_application_decision_sync_sources AS source
    WHERE source.source_id = 'de400000-0000-4000-8000-000000000002'
  ),
  'not_configured',
  'the unconfigured late workbook is recorded, so nobody believes both synced'
);

SELECT extensions.ok(
  (
    SELECT blocks_release
    FROM plugin_data.csf_application_decision_stages
    WHERE application_id = 'de600000-0000-4000-8000-000000000002'
  ),
  'yellow with no explanation blocks its own row from release'
);

-- ---------------------------------------------------------------------------
-- D. The member sees nothing before release
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT (
    plugin_data.csf_member_term_review_state(
      'de100000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000002'
    ) ->> 'memberToolsAvailable'
  )::boolean,
  'a staged acceptance opens no current-term member tools'
);

SELECT extensions.ok(
  (
    plugin_data.csf_member_term_review_state(
      'de100000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000002'
    ) ->> 'applicationPending'
  )::boolean,
  'the member is told a decision is still pending, never which one is staged'
);

SELECT extensions.ok(
  NOT (
    plugin_data.csf_member_term_review_state(
      'de100000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000002'
    ) ? 'stagedDecision'
  ),
  'the member payload has no staged decision key at all'
);

-- ---------------------------------------------------------------------------
-- E. The in-app decision path cannot publish behind the release gate
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_decide_term_application(
      'de100000-0000-4000-8000-000000000001',
      'de600000-0000-4000-8000-000000000004',
      'accepted', 'Approved in the app.',
      'de000000-0000-4000-8000-000000000001'
    )
  $$,
  '55000',
  'This term reviews applications in the source Sheet. Record the decision there and release the term.',
  'the in-app decision is refused while the term reviews in the Sheet'
);

-- ---------------------------------------------------------------------------
-- F. Release publishes the finalized rows together
--
-- The accepted applicant has no passing academic check and no dues record. The
-- officer's Sheet verdict is the authority, so this must publish.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_release_sheet_application_decisions(
      'de100000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000001',
      'de200000-0000-4000-8000-000000000001',
      'dec00000-0000-4000-8000-000000000001'
    )
  $$,
  'releasing a term with incomplete in-app academic evaluation succeeds'
);

SELECT extensions.is(
  (
    SELECT status || '/' || decision_status::text || '/' || decision_reason_code::text
    FROM plugin_data.csf_term_applications
    WHERE id = 'de600000-0000-4000-8000-000000000001'
  ),
  'accepted/approved/approved_sheet_review',
  'the released acceptance is recorded as an external Sheet review, not a standard approval'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'de600000-0000-4000-8000-000000000001'
  ),
  'accepted',
  'release creates the term membership through the existing atomic decision'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_applications
    WHERE id = 'de600000-0000-4000-8000-000000000003'
  ),
  'rejected',
  'the explained yellow rejection publishes with its reason'
);

SELECT extensions.is(
  (
    SELECT release_state
    FROM plugin_data.csf_application_decision_stages
    WHERE application_id = 'de600000-0000-4000-8000-000000000002'
  ),
  'staged',
  'yellow with no reason is held back from the release'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_applications
    WHERE id = 'de600000-0000-4000-8000-000000000004'
  ),
  'submitted',
  'an unreviewed row stays pending instead of being decided'
);

SELECT extensions.ok(
  (
    SELECT decisions_first_released_at IS NOT NULL AND decisions_release_count = 1
    FROM plugin_data.csf_terms
    WHERE id = 'de200000-0000-4000-8000-000000000001'
  ),
  'the term records its first release watermark'
);

SELECT extensions.ok(
  (
    plugin_data.csf_member_term_review_state(
      'de100000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000002'
    ) ->> 'memberToolsAvailable'
  )::boolean,
  'the released member gains current-term member tools'
);

-- ---------------------------------------------------------------------------
-- G. A later sync follows the sheet, including revocation
-- ---------------------------------------------------------------------------

UPDATE plugin_data.csf_term_memberships
SET status = 'active', activated_at = now()
WHERE application_id = 'de600000-0000-4000-8000-000000000001';

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_stage_sheet_application_decisions(
      'de100000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000001',
      'de200000-0000-4000-8000-000000000001',
      'deb00000-0000-4000-8000-000000000002',
      $evidence$[
        {"sourceId":"de400000-0000-4000-8000-000000000001",
         "sheetTabName":"Form Responses 1","readStatus":"read",
         "spreadsheetFileId":"de-regular-workbook","providerVersion":"8",
         "requestedRange":"A1:Z100","contentHash":"content-hash-2",
         "mappingVersion":"1"}
      ]$evidence$::jsonb,
      $rows$[
        {"sourceId":"de400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
         "observedRowNumber":11,"applicationId":"de600000-0000-4000-8000-000000000001",
         "importRowId":"de800000-0000-4000-8000-000000000001","status":"rejected",
         "observedColor":"#f4cccc","identityDigest":"id-1","decisionDigest":"dec-1b"},
        {"sourceId":"de400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
         "observedRowNumber":13,"applicationId":"de600000-0000-4000-8000-000000000003",
         "importRowId":"de800000-0000-4000-8000-000000000003","status":"unreviewed",
         "identityDigest":"id-3","decisionDigest":"dec-3b"}
      ]$rows$::jsonb
    )
  $$,
  'a later sync over already-released rows runs'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'de600000-0000-4000-8000-000000000001'
  ),
  'revoked',
  'a published acceptance turned red revokes the active member immediately'
);

SELECT extensions.is(
  (
    SELECT status || '/' || decision_status::text
    FROM plugin_data.csf_term_applications
    WHERE id = 'de600000-0000-4000-8000-000000000003'
  ),
  'needs_review/pending',
  'an uncolored row retracts the published decision and presents as unreviewed'
);

SELECT extensions.is(
  (
    SELECT released_decision
    FROM plugin_data.csf_application_decision_stages
    WHERE application_id = 'de600000-0000-4000-8000-000000000003'
  ),
  'unreviewed',
  'the retraction is recorded against the released row, not hidden'
);

SELECT extensions.ok(
  NOT (
    plugin_data.csf_member_term_review_state(
      'de100000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000002'
    ) ->> 'memberToolsAvailable'
  )::boolean,
  'the revoked member loses current-term member tools'
);

-- ---------------------------------------------------------------------------
-- H. A completed term outcome is never rewritten
-- ---------------------------------------------------------------------------

-- The rejected applicant never had a membership, so give them the one a real
-- completed term would leave behind.
INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, application_id, status, completed_at
) VALUES (
  'de100000-0000-4000-8000-000000000001',
  'de300000-0000-4000-8000-000000000003',
  'de200000-0000-4000-8000-000000000001',
  'de500000-0000-4000-8000-000000000001',
  'de600000-0000-4000-8000-000000000003',
  'completed', now()
);

UPDATE plugin_data.csf_application_decision_stages
SET release_state = 'released', released_decision = 'accepted',
    released_at = now(), release_id = (
      SELECT id FROM plugin_data.csf_application_decision_releases LIMIT 1
    )
WHERE application_id = 'de600000-0000-4000-8000-000000000003';

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_stage_sheet_application_decisions(
      'de100000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000001',
      'de200000-0000-4000-8000-000000000001',
      'deb00000-0000-4000-8000-000000000003',
      $evidence$[
        {"sourceId":"de400000-0000-4000-8000-000000000001",
         "sheetTabName":"Form Responses 1","readStatus":"read",
         "spreadsheetFileId":"de-regular-workbook","providerVersion":"9",
         "requestedRange":"A1:Z100","contentHash":"content-hash-3",
         "mappingVersion":"1"}
      ]$evidence$::jsonb,
      $rows$[
        {"sourceId":"de400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
         "observedRowNumber":13,"applicationId":"de600000-0000-4000-8000-000000000003",
         "importRowId":"de800000-0000-4000-8000-000000000003","status":"rejected",
         "observedColor":"#f4cccc","identityDigest":"id-3","decisionDigest":"dec-3c"}
      ]$rows$::jsonb
    )
  $$,
  'a sync that would rewrite a completed outcome still completes and reports'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'de600000-0000-4000-8000-000000000003'
  ),
  'completed',
  'the completed term membership keeps its published outcome'
);

SELECT extensions.is(
  (
    SELECT block_reason
    FROM plugin_data.csf_application_decision_sync_rows
    WHERE run_id = (
      SELECT id FROM plugin_data.csf_application_decision_sync_runs
      WHERE request_id = 'deb00000-0000-4000-8000-000000000003'
    )
  ),
  'historical_outcome',
  'the refused rewrite is reported as a conflict with its reason'
);

-- ---------------------------------------------------------------------------
-- I. Row identity: the workbook holds every applicant, so file membership
-- identifies nobody
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_stage_sheet_application_decisions(
      'de100000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000001',
      'de200000-0000-4000-8000-000000000001',
      'deb00000-0000-4000-8000-000000000004',
      $evidence$[
        {"sourceId":"de400000-0000-4000-8000-000000000001",
         "sheetTabName":"Form Responses 1","readStatus":"read",
         "spreadsheetFileId":"de-regular-workbook","providerVersion":"10",
         "requestedRange":"A1:Z100","contentHash":"content-hash-4",
         "mappingVersion":"1"}
      ]$evidence$::jsonb,
      $rows$[
        {"sourceId":"de400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
         "observedRowNumber":21,"applicationId":"de600000-0000-4000-8000-000000000002",
         "importRowId":"de800000-0000-4000-8000-000000000001","status":"accepted",
         "observedColor":"#d9ead3","identityDigest":"id-x1","decisionDigest":"dec-x1"},
        {"sourceId":"de400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
         "observedRowNumber":22,"applicationId":"de600000-0000-4000-8000-000000000002",
         "responseId":"response-uncolored","status":"accepted",
         "observedColor":"#d9ead3","identityDigest":"id-x2","decisionDigest":"dec-x2"},
        {"sourceId":"de400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
         "observedRowNumber":23,"applicationId":"de600000-0000-4000-8000-000000000004",
         "responseId":"response-uncolored","responseSubmittedAt":"2030-08-01T09:15:00Z",
         "status":"accepted","observedColor":"#d9ead3",
         "identityDigest":"id-x3","decisionDigest":"dec-x3"}
      ]$rows$::jsonb
    )
  $$,
  'a run mixing mismatched and correct identity evidence completes'
);

SELECT extensions.is(
  (
    SELECT block_reason
    FROM plugin_data.csf_application_decision_sync_rows
    WHERE run_id = (
      SELECT id FROM plugin_data.csf_application_decision_sync_runs
      WHERE request_id = 'deb00000-0000-4000-8000-000000000004'
    )
      AND observed_row_number = 21
  ),
  'provenance_unverified',
  'an import row belonging to another applicant cannot carry this one''s verdict'
);

SELECT extensions.is(
  (
    SELECT block_reason
    FROM plugin_data.csf_application_decision_sync_rows
    WHERE run_id = (
      SELECT id FROM plugin_data.csf_application_decision_sync_runs
      WHERE request_id = 'deb00000-0000-4000-8000-000000000004'
    )
      AND observed_row_number = 22
  ),
  'provenance_unverified',
  'a response id from the same workbook but a different applicant is refused'
);

SELECT extensions.is(
  (
    SELECT outcome || '/' || match_basis
    FROM plugin_data.csf_application_decision_sync_rows
    WHERE run_id = (
      SELECT id FROM plugin_data.csf_application_decision_sync_runs
      WHERE request_id = 'deb00000-0000-4000-8000-000000000004'
    )
      AND observed_row_number = 23
  ),
  'changed/recorded_response_id',
  'the application''s own recorded response id and timestamp do resolve it'
);

-- ---------------------------------------------------------------------------
-- J. A mapping edited after the read cannot apply obsolete column semantics
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_set_application_decision_mapping(
  'de100000-0000-4000-8000-000000000001',
  'de000000-0000-4000-8000-000000000001',
  'de400000-0000-4000-8000-000000000001',
  ARRAY[9], ARRAY[10], false
);

SELECT extensions.is(
  (
    SELECT mapping_version
    FROM plugin_data.csf_application_decision_mappings
    WHERE source_id = 'de400000-0000-4000-8000-000000000001'
  ),
  2,
  'changing the decision columns moves the mapping version'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_stage_sheet_application_decisions(
      'de100000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000001',
      'de200000-0000-4000-8000-000000000001',
      'deb00000-0000-4000-8000-000000000005',
      $evidence$[
        {"sourceId":"de400000-0000-4000-8000-000000000001",
         "sheetTabName":"Form Responses 1","readStatus":"read",
         "spreadsheetFileId":"de-regular-workbook","providerVersion":"11",
         "requestedRange":"A1:Z100","contentHash":"content-hash-5",
         "mappingVersion":"1"}
      ]$evidence$::jsonb,
      $rows$[
        {"sourceId":"de400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
         "observedRowNumber":14,"applicationId":"de600000-0000-4000-8000-000000000004",
         "importRowId":"de800000-0000-4000-8000-000000000004","status":"accepted",
         "observedColor":"#d9ead3","identityDigest":"id-4","decisionDigest":"dec-4s"}
      ]$rows$::jsonb
    )
  $$,
  'a run read against an older mapping still records its evidence'
);

SELECT extensions.is(
  (
    SELECT block_reason
    FROM plugin_data.csf_application_decision_sync_rows
    WHERE run_id = (
      SELECT id FROM plugin_data.csf_application_decision_sync_runs
      WHERE request_id = 'deb00000-0000-4000-8000-000000000005'
    )
  ),
  'mapping_version_stale',
  'a row read under a superseded column mapping is refused, not staged'
);

-- ---------------------------------------------------------------------------
-- K. A reused request id is bound to its term and payload
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_stage_sheet_application_decisions(
      'de100000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000001',
      'de200000-0000-4000-8000-000000000002',
      'deb00000-0000-4000-8000-000000000005',
      '[]'::jsonb,
      '[]'::jsonb
    )
  $$,
  'That decision-sync run identifier is already bound to a different read.',
  'the same run id aimed at another term is a conflict, never another term''s receipt'
);

-- ---------------------------------------------------------------------------
-- L. Evidence immutability, write-back suppression, and no notifications
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_application_decision_sync_runs
    SET changed_count = 999
    WHERE request_id = 'deb00000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'CSF application decision evidence is immutable.',
  'a sync receipt cannot be rewritten to agree with a later story'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_sheet_writeback_ledger
    WHERE organization_id = 'de100000-0000-4000-8000-000000000001'
      AND destination_id IS NULL
  ),
  0,
  'no decision is written back into the workbook the chapter is reviewing in'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_publication_notification_deliveries
    WHERE organization_id = 'de100000-0000-4000-8000-000000000001'
  ),
  0,
  'releasing and re-syncing decisions enqueues no notification delivery'
);

SELECT * FROM extensions.finish();

ROLLBACK;
