-- The published reason is the Sheet's own, or nothing.
--
-- This exercises the publish primitive directly, so it proves the primitive and
-- nothing else. Whether a sheet edit ever reaches the primitive is decided by
-- the sync planner, which is covered in
-- csf_published_decision_reason_sync.test.sql through the public RPCs.
--
-- csf_publish_sheet_application_decision must hand the policy base a non-empty
-- note, because the base refuses a rejection with none. That fallback sentence
-- used to land in decision_reason, which the member surface renders as the
-- chapter's explanation, so a red mark invented one. The fallback still belongs
-- in review_notes, the membership status_reason and the receipts.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(15);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'eb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'csf-published-reason-officer@local.test', now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'eb100000-0000-4000-8000-000000000001',
  'CSF Published Decision Reason', 'csf-published-decision-reason', 'school', '740056'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'eb100000-0000-4000-8000-000000000001',
  'eb000000-0000-4000-8000-000000000001', 'admin', 'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current,
  application_review_source
) VALUES (
  'eb200000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001',
  'F35', 'Fall 2035', '2035-2036', 'fall', true, 'sheet'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label, status
) VALUES (
  'eb500000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001', 2039, 'c/o 2039', 'active'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('eb300000-0000-4000-8000-000000000001',
   'eb100000-0000-4000-8000-000000000001',
   'Red', 'Applicant', 'red', 'applicant'),
  ('eb300000-0000-4000-8000-000000000002',
   'eb100000-0000-4000-8000-000000000001',
   'Active', 'Member', 'active', 'member'),
  ('eb300000-0000-4000-8000-000000000003',
   'eb100000-0000-4000-8000-000000000001',
   'Green', 'Applicant', 'green', 'applicant');

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, title, provider, source_type, drive_file_id, spreadsheet_id
) VALUES (
  'eb400000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001', 'Fall 2035 applications',
  'google_sheets', 'application_responses', 'eb-workbook', 'eb-workbook'
);

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  decision_status, source_file_id, source_sheet_tab, source_row_number
) VALUES
  ('eb600000-0000-4000-8000-000000000001',
   'eb100000-0000-4000-8000-000000000001',
   'eb300000-0000-4000-8000-000000000001',
   'eb500000-0000-4000-8000-000000000001',
   'eb200000-0000-4000-8000-000000000001',
   'google_form_sheet', 'needs_review', 'pending', 'eb-workbook', 'Form Responses 1', 3),
  ('eb600000-0000-4000-8000-000000000002',
   'eb100000-0000-4000-8000-000000000001',
   'eb300000-0000-4000-8000-000000000002',
   'eb500000-0000-4000-8000-000000000001',
   'eb200000-0000-4000-8000-000000000001',
   'google_form_sheet', 'accepted', 'approved', 'eb-workbook', 'Form Responses 1', 4),
  ('eb600000-0000-4000-8000-000000000003',
   'eb100000-0000-4000-8000-000000000001',
   'eb300000-0000-4000-8000-000000000003',
   'eb500000-0000-4000-8000-000000000001',
   'eb200000-0000-4000-8000-000000000001',
   'google_form_sheet', 'needs_review', 'pending', 'eb-workbook', 'Form Responses 1', 5);

-- Only the second applicant is already a member, which is the branch that
-- revokes access directly instead of going through the policy base.
INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, application_id,
  status, accepted_at
) VALUES (
  'eb100000-0000-4000-8000-000000000001',
  'eb300000-0000-4000-8000-000000000002',
  'eb200000-0000-4000-8000-000000000001',
  'eb500000-0000-4000-8000-000000000001',
  'eb600000-0000-4000-8000-000000000002', 'active', now()
);

-- ---------------------------------------------------------------------------
-- A. A red mark publishes no explanation, and the workflow note survives
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_publish_sheet_application_decision(
  'eb100000-0000-4000-8000-000000000001',
  'eb600000-0000-4000-8000-000000000001',
  'rejected', NULL,
  'eb000000-0000-4000-8000-000000000001',
  '{}'::jsonb
);

SELECT extensions.is(
  (
    SELECT decision_reason
    FROM plugin_data.csf_term_applications
    WHERE id = 'eb600000-0000-4000-8000-000000000001'
  ),
  NULL::text,
  'a red rejection publishes no explanation'
);

SELECT extensions.is(
  (
    SELECT review_notes
    FROM plugin_data.csf_term_applications
    WHERE id = 'eb600000-0000-4000-8000-000000000001'
  ),
  'Rejected in the chapter application review Sheet.',
  'the workflow note stays in review_notes'
);

SELECT extensions.is(
  (
    SELECT decision_reason_code::text
    FROM plugin_data.csf_term_applications
    WHERE id = 'eb600000-0000-4000-8000-000000000001'
  ),
  'rejected_sheet_review',
  'the reason code still names the Sheet review'
);

SELECT extensions.is(
  (
    SELECT reason
    FROM plugin_data.csf_application_status_events
    WHERE application_id = 'eb600000-0000-4000-8000-000000000001'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  ),
  'Rejected in the chapter application review Sheet.',
  'the status receipt keeps the workflow note it actually recorded'
);

-- ---------------------------------------------------------------------------
-- B. A correction that only moves the reason lands
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_publish_sheet_application_decision(
  'eb100000-0000-4000-8000-000000000001',
  'eb600000-0000-4000-8000-000000000001',
  'rejected', 'The service hours page was blank.',
  'eb000000-0000-4000-8000-000000000001',
  '{}'::jsonb
);

SELECT extensions.is(
  (
    SELECT decision_reason
    FROM plugin_data.csf_term_applications
    WHERE id = 'eb600000-0000-4000-8000-000000000001'
  ),
  'The service hours page was blank.',
  'red to yellow publishes the Sheet reason exactly'
);

-- Whitespace is not an explanation.
SELECT plugin_data.csf_publish_sheet_application_decision(
  'eb100000-0000-4000-8000-000000000001',
  'eb600000-0000-4000-8000-000000000001',
  'rejected', '   ',
  'eb000000-0000-4000-8000-000000000001',
  '{}'::jsonb
);

SELECT extensions.is(
  (
    SELECT decision_reason
    FROM plugin_data.csf_term_applications
    WHERE id = 'eb600000-0000-4000-8000-000000000001'
  ),
  NULL::text,
  'yellow back to red removes the published explanation'
);

-- ---------------------------------------------------------------------------
-- C. Revoking an active member takes the direct branch, with the same rule
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_publish_sheet_application_decision(
  'eb100000-0000-4000-8000-000000000001',
  'eb600000-0000-4000-8000-000000000002',
  'rejected', NULL,
  'eb000000-0000-4000-8000-000000000001',
  '{}'::jsonb
);

SELECT extensions.is(
  (
    SELECT decision_reason
    FROM plugin_data.csf_term_applications
    WHERE id = 'eb600000-0000-4000-8000-000000000002'
  ),
  NULL::text,
  'revoking an active member publishes no invented explanation'
);

SELECT extensions.is(
  (
    SELECT review_notes
    FROM plugin_data.csf_term_applications
    WHERE id = 'eb600000-0000-4000-8000-000000000002'
  ),
  'Rejected in the chapter application review Sheet.',
  'the revocation still records why the officer acted'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'eb600000-0000-4000-8000-000000000002'
  ),
  'revoked',
  'access still follows the Sheet'
);

SELECT extensions.is(
  (
    SELECT status_reason
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'eb600000-0000-4000-8000-000000000002'
  ),
  'Rejected in the chapter application review Sheet.',
  'the membership keeps the workflow note for the revocation'
);

-- ---------------------------------------------------------------------------
-- D. Acceptance and retraction follow the same rule
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_publish_sheet_application_decision(
  'eb100000-0000-4000-8000-000000000001',
  'eb600000-0000-4000-8000-000000000003',
  'accepted', NULL,
  'eb000000-0000-4000-8000-000000000001',
  '{}'::jsonb
);

SELECT extensions.is(
  (
    SELECT decision_reason
    FROM plugin_data.csf_term_applications
    WHERE id = 'eb600000-0000-4000-8000-000000000003'
  ),
  NULL::text,
  'a green mark with no note publishes no explanation either'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'eb600000-0000-4000-8000-000000000003'
  ),
  'accepted',
  'the acceptance still creates the membership'
);

SELECT plugin_data.csf_publish_sheet_application_decision(
  'eb100000-0000-4000-8000-000000000001',
  'eb600000-0000-4000-8000-000000000003',
  'accepted', 'The adviser confirmed the transcript.',
  'eb000000-0000-4000-8000-000000000001',
  '{}'::jsonb
);

SELECT extensions.is(
  (
    SELECT decision_reason
    FROM plugin_data.csf_term_applications
    WHERE id = 'eb600000-0000-4000-8000-000000000003'
  ),
  'The adviser confirmed the transcript.',
  'a same-outcome acceptance still takes the new note'
);

SELECT plugin_data.csf_publish_sheet_application_decision(
  'eb100000-0000-4000-8000-000000000001',
  'eb600000-0000-4000-8000-000000000003',
  'unreviewed', NULL,
  'eb000000-0000-4000-8000-000000000001',
  '{}'::jsonb
);

SELECT extensions.is(
  (
    SELECT decision_reason
    FROM plugin_data.csf_term_applications
    WHERE id = 'eb600000-0000-4000-8000-000000000003'
  ),
  NULL::text,
  'a withdrawn decision carries no explanation'
);

SELECT extensions.is(
  (
    SELECT review_notes
    FROM plugin_data.csf_term_applications
    WHERE id = 'eb600000-0000-4000-8000-000000000003'
  ),
  'The review Sheet row is no longer marked, so the published decision was withdrawn.',
  'the retraction still says why the decision went away'
);

SELECT * FROM extensions.finish();

ROLLBACK;
