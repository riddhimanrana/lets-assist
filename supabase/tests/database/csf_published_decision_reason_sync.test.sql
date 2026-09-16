-- A reason-only correction has to reach the applicant, and a red mark has to
-- publish no explanation.
--
-- This goes through the two public RPCs, not the publish primitive, because the
-- primitive was never the whole defect: the sync planner decided that a
-- yellow losing its explanation, a red gaining one, and an edit to a yellow
-- reason were all "no publish", since each normalizes to the same decision.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(18);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'dd000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'csf-published-reason-sync@local.test', now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'dd100000-0000-4000-8000-000000000001',
  'CSF Published Reason Sync', 'csf-published-reason-sync', 'school', '740057'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'dd100000-0000-4000-8000-000000000001',
  'dd000000-0000-4000-8000-000000000001', 'admin', 'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current,
  application_review_source
) VALUES (
  'dd200000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000001',
  'F36', 'Fall 2036', '2036-2037', 'fall', true, 'sheet'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label, status
) VALUES (
  'dd500000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000001', 2040, 'c/o 2040', 'active'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('dd300000-0000-4000-8000-000000000001',
   'dd100000-0000-4000-8000-000000000001',
   'Reason', 'Applicant', 'reason', 'applicant'),
  ('dd300000-0000-4000-8000-000000000002',
   'dd100000-0000-4000-8000-000000000001',
   'Revoked', 'Applicant', 'revoked', 'applicant'),
  ('dd300000-0000-4000-8000-000000000003',
   'dd100000-0000-4000-8000-000000000001',
   'Finished', 'Applicant', 'finished', 'applicant');

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, title, provider, source_type, drive_file_id, spreadsheet_id
) VALUES (
  'dd400000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000001', 'Fall 2036 applications',
  'google_sheets', 'application_responses', 'dd-workbook', 'dd-workbook'
);

INSERT INTO plugin_data.csf_application_decision_mappings (
  organization_id, source_id, decision_columns, reason_columns, reads_cell_note
) VALUES (
  'dd100000-0000-4000-8000-000000000001',
  'dd400000-0000-4000-8000-000000000001',
  ARRAY[7], ARRAY[8], true
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, mode, status, source_file_id
) VALUES (
  'dd700000-0000-4000-8000-000000000011', 'dd100000-0000-4000-8000-000000000001',
  'dd400000-0000-4000-8000-000000000001', 'preview', 'completed', 'dd-workbook'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, mode, status, source_file_id, preview_job_id
) VALUES (
  'dd700000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000001',
  'dd400000-0000-4000-8000-000000000001', 'commit', 'completed', 'dd-workbook',
  'dd700000-0000-4000-8000-000000000011'
);

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  source_file_id, source_sheet_tab, source_row_number,
  google_form_response_id, source_submitted_at
) VALUES
  ('dd600000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000001',
   'dd300000-0000-4000-8000-000000000001', 'dd500000-0000-4000-8000-000000000001',
   'dd200000-0000-4000-8000-000000000001', 'google_form_sheet', 'submitted',
   'dd-workbook', 'Form Responses 1', 11, 'response-reason', '2036-08-01T09:00:00Z'),
  ('dd600000-0000-4000-8000-000000000002', 'dd100000-0000-4000-8000-000000000001',
   'dd300000-0000-4000-8000-000000000002', 'dd500000-0000-4000-8000-000000000001',
   'dd200000-0000-4000-8000-000000000001', 'google_form_sheet', 'submitted',
   'dd-workbook', 'Form Responses 1', 12, 'response-revoked', '2036-08-01T09:05:00Z'),
  ('dd600000-0000-4000-8000-000000000003', 'dd100000-0000-4000-8000-000000000001',
   'dd300000-0000-4000-8000-000000000003', 'dd500000-0000-4000-8000-000000000001',
   'dd200000-0000-4000-8000-000000000001', 'google_form_sheet', 'submitted',
   'dd-workbook', 'Form Responses 1', 13, 'response-finished', '2036-08-01T09:10:00Z');

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, term_id, sheet_tab_name, row_number,
  row_hash, matched_application_id, import_status
) VALUES
  ('dd800000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000001',
   'dd700000-0000-4000-8000-000000000001', 'dd400000-0000-4000-8000-000000000001',
   'dd200000-0000-4000-8000-000000000001', 'Form Responses 1', 11,
   'hash-reason', 'dd600000-0000-4000-8000-000000000001', 'created'),
  ('dd800000-0000-4000-8000-000000000002', 'dd100000-0000-4000-8000-000000000001',
   'dd700000-0000-4000-8000-000000000001', 'dd400000-0000-4000-8000-000000000001',
   'dd200000-0000-4000-8000-000000000001', 'Form Responses 1', 12,
   'hash-revoked', 'dd600000-0000-4000-8000-000000000002', 'created'),
  ('dd800000-0000-4000-8000-000000000003', 'dd100000-0000-4000-8000-000000000001',
   'dd700000-0000-4000-8000-000000000001', 'dd400000-0000-4000-8000-000000000001',
   'dd200000-0000-4000-8000-000000000001', 'Form Responses 1', 13,
   'hash-finished', 'dd600000-0000-4000-8000-000000000003', 'created');

-- ---------------------------------------------------------------------------
-- A. Stage and release: yellow with a reason, green, green with a reason
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_stage_sheet_application_decisions(
  'dd100000-0000-4000-8000-000000000001',
  'dd000000-0000-4000-8000-000000000001',
  'dd200000-0000-4000-8000-000000000001',
  'ddb00000-0000-4000-8000-000000000001',
  $evidence$[
    {"sourceId":"dd400000-0000-4000-8000-000000000001",
     "sheetTabName":"Form Responses 1","readStatus":"read",
     "spreadsheetFileId":"dd-workbook","providerVersion":"1",
     "requestedRange":"A1:Z100","contentHash":"content-1","mappingVersion":"1"}
  ]$evidence$::jsonb,
  $rows$[
    {"sourceId":"dd400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
     "observedRowNumber":11,"applicationId":"dd600000-0000-4000-8000-000000000001",
     "importRowId":"dd800000-0000-4000-8000-000000000001",
     "status":"rejected_with_explanation","observedColor":"#fff2cc",
     "reason":"The service hours page was blank.",
     "identityDigest":"id-1","decisionDigest":"dec-1"},
    {"sourceId":"dd400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
     "observedRowNumber":12,"applicationId":"dd600000-0000-4000-8000-000000000002",
     "importRowId":"dd800000-0000-4000-8000-000000000002","status":"accepted",
     "observedColor":"#d9ead3","identityDigest":"id-2","decisionDigest":"dec-2"},
    {"sourceId":"dd400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
     "observedRowNumber":13,"applicationId":"dd600000-0000-4000-8000-000000000003",
     "importRowId":"dd800000-0000-4000-8000-000000000003","status":"accepted",
     "observedColor":"#d9ead3","reason":"Adviser confirmed the transcript.",
     "identityDigest":"id-3","decisionDigest":"dec-3"}
  ]$rows$::jsonb
);

SELECT plugin_data.csf_release_sheet_application_decisions(
  'dd100000-0000-4000-8000-000000000001',
  'dd000000-0000-4000-8000-000000000001',
  'dd200000-0000-4000-8000-000000000001',
  'ddc00000-0000-4000-8000-000000000001'
);

SELECT extensions.is(
  (
    SELECT decision_reason
    FROM plugin_data.csf_term_applications
    WHERE id = 'dd600000-0000-4000-8000-000000000001'
  ),
  'The service hours page was blank.',
  'the initial yellow release publishes the Sheet reason'
);

SELECT extensions.is(
  (
    SELECT released_reason
    FROM plugin_data.csf_application_decision_stages
    WHERE application_id = 'dd600000-0000-4000-8000-000000000001'
  ),
  'The service hours page was blank.',
  'and the stage records what it released'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'dd600000-0000-4000-8000-000000000002'
  ),
  'accepted',
  'the green mark creates the membership'
);

-- ---------------------------------------------------------------------------
-- B. Editing a yellow reason republishes, though the decision never moves
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_stage_sheet_application_decisions(
  'dd100000-0000-4000-8000-000000000001',
  'dd000000-0000-4000-8000-000000000001',
  'dd200000-0000-4000-8000-000000000001',
  'ddb00000-0000-4000-8000-000000000002',
  $evidence$[
    {"sourceId":"dd400000-0000-4000-8000-000000000001",
     "sheetTabName":"Form Responses 1","readStatus":"read",
     "spreadsheetFileId":"dd-workbook","providerVersion":"2",
     "requestedRange":"A1:Z100","contentHash":"content-2","mappingVersion":"1"}
  ]$evidence$::jsonb,
  $rows$[
    {"sourceId":"dd400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
     "observedRowNumber":11,"applicationId":"dd600000-0000-4000-8000-000000000001",
     "importRowId":"dd800000-0000-4000-8000-000000000001",
     "status":"rejected_with_explanation","observedColor":"#fff2cc",
     "reason":"The service hours page was missing two signatures.",
     "identityDigest":"id-1","decisionDigest":"dec-1b"}
  ]$rows$::jsonb
);

SELECT extensions.is(
  (
    SELECT decision_reason
    FROM plugin_data.csf_term_applications
    WHERE id = 'dd600000-0000-4000-8000-000000000001'
  ),
  'The service hours page was missing two signatures.',
  'an edit to a yellow reason reaches the applicant'
);

SELECT extensions.is(
  (
    SELECT released_reason
    FROM plugin_data.csf_application_decision_stages
    WHERE application_id = 'dd600000-0000-4000-8000-000000000001'
  ),
  'The service hours page was missing two signatures.',
  'the released reason moves with it'
);

-- ---------------------------------------------------------------------------
-- C. Yellow to red clears the explanation, without losing the workflow note
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_stage_sheet_application_decisions(
  'dd100000-0000-4000-8000-000000000001',
  'dd000000-0000-4000-8000-000000000001',
  'dd200000-0000-4000-8000-000000000001',
  'ddb00000-0000-4000-8000-000000000003',
  $evidence$[
    {"sourceId":"dd400000-0000-4000-8000-000000000001",
     "sheetTabName":"Form Responses 1","readStatus":"read",
     "spreadsheetFileId":"dd-workbook","providerVersion":"3",
     "requestedRange":"A1:Z100","contentHash":"content-3","mappingVersion":"1"}
  ]$evidence$::jsonb,
  $rows$[
    {"sourceId":"dd400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
     "observedRowNumber":11,"applicationId":"dd600000-0000-4000-8000-000000000001",
     "importRowId":"dd800000-0000-4000-8000-000000000001","status":"rejected",
     "observedColor":"#f4cccc","identityDigest":"id-1","decisionDigest":"dec-1c"}
  ]$rows$::jsonb
);

SELECT extensions.is(
  (
    SELECT decision_reason
    FROM plugin_data.csf_term_applications
    WHERE id = 'dd600000-0000-4000-8000-000000000001'
  ),
  NULL::text,
  'yellow to red clears the published explanation'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_applications
    WHERE id = 'dd600000-0000-4000-8000-000000000001'
  ),
  'rejected',
  'the applicant is still rejected'
);

SELECT extensions.is(
  (
    SELECT review_notes
    FROM plugin_data.csf_term_applications
    WHERE id = 'dd600000-0000-4000-8000-000000000001'
  ),
  'Rejected in the chapter application review Sheet.',
  'the workflow note stays in review_notes'
);

-- ---------------------------------------------------------------------------
-- D. Red back to yellow publishes the new explanation
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_stage_sheet_application_decisions(
  'dd100000-0000-4000-8000-000000000001',
  'dd000000-0000-4000-8000-000000000001',
  'dd200000-0000-4000-8000-000000000001',
  'ddb00000-0000-4000-8000-000000000004',
  $evidence$[
    {"sourceId":"dd400000-0000-4000-8000-000000000001",
     "sheetTabName":"Form Responses 1","readStatus":"read",
     "spreadsheetFileId":"dd-workbook","providerVersion":"4",
     "requestedRange":"A1:Z100","contentHash":"content-4","mappingVersion":"1"}
  ]$evidence$::jsonb,
  $rows$[
    {"sourceId":"dd400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
     "observedRowNumber":11,"applicationId":"dd600000-0000-4000-8000-000000000001",
     "importRowId":"dd800000-0000-4000-8000-000000000001",
     "status":"rejected_with_explanation","observedColor":"#fff2cc",
     "reason":"Two service entries could not be verified.",
     "identityDigest":"id-1","decisionDigest":"dec-1d"}
  ]$rows$::jsonb
);

SELECT extensions.is(
  (
    SELECT decision_reason
    FROM plugin_data.csf_term_applications
    WHERE id = 'dd600000-0000-4000-8000-000000000001'
  ),
  'Two service entries could not be verified.',
  'red back to yellow publishes the new explanation'
);

-- ---------------------------------------------------------------------------
-- E. Reading the same sheet again changes nothing
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE before_repeat ON COMMIT DROP AS
SELECT
  (
    SELECT count(*)
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'dd600000-0000-4000-8000-000000000001'
  ) AS audit_events,
  (
    SELECT count(*)
    FROM plugin_data.csf_application_status_events
    WHERE application_id = 'dd600000-0000-4000-8000-000000000001'
  ) AS status_events,
  (
    SELECT released_at
    FROM plugin_data.csf_application_decision_stages
    WHERE application_id = 'dd600000-0000-4000-8000-000000000001'
  ) AS released_at;

SELECT plugin_data.csf_stage_sheet_application_decisions(
  'dd100000-0000-4000-8000-000000000001',
  'dd000000-0000-4000-8000-000000000001',
  'dd200000-0000-4000-8000-000000000001',
  'ddb00000-0000-4000-8000-000000000005',
  $evidence$[
    {"sourceId":"dd400000-0000-4000-8000-000000000001",
     "sheetTabName":"Form Responses 1","readStatus":"read",
     "spreadsheetFileId":"dd-workbook","providerVersion":"5",
     "requestedRange":"A1:Z100","contentHash":"content-5","mappingVersion":"1"}
  ]$evidence$::jsonb,
  $rows$[
    {"sourceId":"dd400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
     "observedRowNumber":11,"applicationId":"dd600000-0000-4000-8000-000000000001",
     "importRowId":"dd800000-0000-4000-8000-000000000001",
     "status":"rejected_with_explanation","observedColor":"#fff2cc",
     "reason":"Two service entries could not be verified.",
     "identityDigest":"id-1","decisionDigest":"dec-1d"}
  ]$rows$::jsonb
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'dd600000-0000-4000-8000-000000000001'
  ),
  (SELECT audit_events FROM before_repeat),
  'an identical read publishes nothing and writes no new audit event'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM plugin_data.csf_application_status_events
    WHERE application_id = 'dd600000-0000-4000-8000-000000000001'
  ),
  (SELECT status_events FROM before_repeat),
  'and no new application status event'
);

SELECT extensions.is(
  (
    SELECT released_at
    FROM plugin_data.csf_application_decision_stages
    WHERE application_id = 'dd600000-0000-4000-8000-000000000001'
  ),
  (SELECT released_at FROM before_repeat),
  'the release watermark does not move for an unchanged row'
);

-- ---------------------------------------------------------------------------
-- F. A published acceptance turned red revokes with no invented explanation
-- ---------------------------------------------------------------------------

UPDATE plugin_data.csf_term_memberships
SET status = 'active', activated_at = now()
WHERE application_id = 'dd600000-0000-4000-8000-000000000002';

SELECT plugin_data.csf_stage_sheet_application_decisions(
  'dd100000-0000-4000-8000-000000000001',
  'dd000000-0000-4000-8000-000000000001',
  'dd200000-0000-4000-8000-000000000001',
  'ddb00000-0000-4000-8000-000000000006',
  $evidence$[
    {"sourceId":"dd400000-0000-4000-8000-000000000001",
     "sheetTabName":"Form Responses 1","readStatus":"read",
     "spreadsheetFileId":"dd-workbook","providerVersion":"6",
     "requestedRange":"A1:Z100","contentHash":"content-6","mappingVersion":"1"}
  ]$evidence$::jsonb,
  $rows$[
    {"sourceId":"dd400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
     "observedRowNumber":12,"applicationId":"dd600000-0000-4000-8000-000000000002",
     "importRowId":"dd800000-0000-4000-8000-000000000002","status":"rejected",
     "observedColor":"#f4cccc","identityDigest":"id-2","decisionDigest":"dec-2b"}
  ]$rows$::jsonb
);

SELECT extensions.is(
  (
    SELECT decision_reason
    FROM plugin_data.csf_term_applications
    WHERE id = 'dd600000-0000-4000-8000-000000000002'
  ),
  NULL::text,
  'revoking an active member publishes no invented explanation'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'dd600000-0000-4000-8000-000000000002'
  ),
  'revoked',
  'access still follows the Sheet'
);

SELECT extensions.is(
  (
    SELECT status_reason
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'dd600000-0000-4000-8000-000000000002'
  ),
  'Rejected in the chapter application review Sheet.',
  'the membership keeps the workflow note for the revocation'
);

-- ---------------------------------------------------------------------------
-- G. A reason-only correction against a finished semester is held
-- ---------------------------------------------------------------------------

UPDATE plugin_data.csf_term_memberships
SET status = 'completed', completed_at = now()
WHERE application_id = 'dd600000-0000-4000-8000-000000000003';

SELECT plugin_data.csf_stage_sheet_application_decisions(
  'dd100000-0000-4000-8000-000000000001',
  'dd000000-0000-4000-8000-000000000001',
  'dd200000-0000-4000-8000-000000000001',
  'ddb00000-0000-4000-8000-000000000007',
  $evidence$[
    {"sourceId":"dd400000-0000-4000-8000-000000000001",
     "sheetTabName":"Form Responses 1","readStatus":"read",
     "spreadsheetFileId":"dd-workbook","providerVersion":"7",
     "requestedRange":"A1:Z100","contentHash":"content-7","mappingVersion":"1"}
  ]$evidence$::jsonb,
  $rows$[
    {"sourceId":"dd400000-0000-4000-8000-000000000001","sheetTabName":"Form Responses 1",
     "observedRowNumber":13,"applicationId":"dd600000-0000-4000-8000-000000000003",
     "importRowId":"dd800000-0000-4000-8000-000000000003","status":"accepted",
     "observedColor":"#d9ead3","reason":"Rewritten after the semester closed.",
     "identityDigest":"id-3","decisionDigest":"dec-3b"}
  ]$rows$::jsonb
);

SELECT extensions.is(
  (
    SELECT block_reason
    FROM plugin_data.csf_application_decision_stages
    WHERE application_id = 'dd600000-0000-4000-8000-000000000003'
  ),
  'historical_outcome',
  'a reason-only rewrite against a finished semester is held'
);

SELECT extensions.is(
  (
    SELECT decision_reason
    FROM plugin_data.csf_term_applications
    WHERE id = 'dd600000-0000-4000-8000-000000000003'
  ),
  'Adviser confirmed the transcript.',
  'the finished semester keeps the reason it published'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'dd600000-0000-4000-8000-000000000003'
  ),
  'completed',
  'and keeps its outcome'
);

SELECT * FROM extensions.finish();

ROLLBACK;
