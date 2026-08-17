-- The application review campaign's verdict drives the application decision.
--
-- Proved here: (1) the relaxed decide path keeps its privilege boundary and
-- rejection-notes rule while no longer gating on checks or dues; (2) a
-- campaign verdict on an application subject atomically updates the
-- application, creates the membership, and queues the sheet write-back;
-- (3) the ledger re-queues on re-decision, skips applications with no sheet
-- coordinates, and records dispatch outcomes.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(22);

-- ---------------------------------------------------------------------------
-- A. Privilege boundaries
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_decide_term_application(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'the server role still cannot call the response-loss-unsafe legacy decision signature'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_decide_term_application(uuid,uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can call the request-aware application decision signature'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_queue_application_sheet_writeback(uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'the write-back queue is populated only from inside the decision transaction'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_mark_sheet_writeback_result(uuid,uuid,boolean,text)',
    'EXECUTE'
  ),
  'the dispatcher can record write-back outcomes'
);
SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated',
    'plugin_data.csf_sheet_writeback_ledger',
    'SELECT'
  ),
  'browser-authenticated users cannot read the write-back ledger'
);

-- ---------------------------------------------------------------------------
-- B. Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('dd000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'csf-drive-officer@local.test', now(), '{}', '{}', now(), now()),
  ('dd000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'csf-drive-applicant@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'dd100000-0000-4000-8000-000000000001',
  'CSF Verdict Drives Decision',
  'csf-verdict-drives-decision',
  'school',
  '740002'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'dd100000-0000-4000-8000-000000000001',
  'dd000000-0000-4000-8000-000000000001',
  'admin', 'active'
);

INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester)
VALUES (
  'dd200000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000001',
  'F29', 'Fall 2029', '2029-2030', 'fall'
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES (
  'dd500000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000001',
  2033, 'c/o 2033', 'active'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('dd300000-0000-4000-8000-000000000001',
   'dd100000-0000-4000-8000-000000000001',
   'Imported', 'Applicant', 'imported', 'applicant'),
  ('dd300000-0000-4000-8000-000000000002',
   'dd100000-0000-4000-8000-000000000001',
   'Manual', 'Applicant', 'manual', 'applicant');

-- One imported application with full sheet coordinates, one manual application
-- with none.
INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  source_file_id, source_sheet_tab, source_row_number
) VALUES
  ('dd600000-0000-4000-8000-000000000001',
   'dd100000-0000-4000-8000-000000000001',
   'dd300000-0000-4000-8000-000000000001',
   'dd500000-0000-4000-8000-000000000001',
   'dd200000-0000-4000-8000-000000000001',
   'google_form_sheet', 'submitted',
   'drive-spreadsheet-fixture', 'Form Responses 1', 12),
  ('dd600000-0000-4000-8000-000000000002',
   'dd100000-0000-4000-8000-000000000001',
   'dd300000-0000-4000-8000-000000000002',
   'dd500000-0000-4000-8000-000000000001',
   'dd200000-0000-4000-8000-000000000001',
   'manual', 'submitted',
   NULL, NULL, NULL);

SELECT plugin_data.csf_set_review_period(
  'dd100000-0000-4000-8000-000000000001',
  'dd000000-0000-4000-8000-000000000001',
  'dd200000-0000-4000-8000-000000000001',
  'membership_applications', 'open', 'Fall 2029 application review'
);

-- ---------------------------------------------------------------------------
-- C. Approving the campaign verdict decides the application
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  format(
    $$
      SELECT plugin_data.csf_record_review_decision(
        'dd100000-0000-4000-8000-000000000001',
        'dd000000-0000-4000-8000-000000000001',
        %L, 'application', 'dd600000-0000-4000-8000-000000000001', 'approved'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  'an approval verdict is accepted with no checks, dues, or preflight recorded'
);

SELECT extensions.ok(
  (
    SELECT status = 'accepted'
      AND submission_status = 'decided'
      AND decision_status = 'approved'
    FROM plugin_data.csf_term_applications
    WHERE id = 'dd600000-0000-4000-8000-000000000001'
  ),
  'the campaign verdict updates the application decision state'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
      AND application_id = 'dd600000-0000-4000-8000-000000000001'
  ),
  'accepted',
  'the verdict creates the matching term membership in the same transaction'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_application_status_events
    WHERE application_id = 'dd600000-0000-4000-8000-000000000001'
      AND next_status = 'accepted'
  ),
  'the application decision keeps its status-event history'
);

SELECT extensions.ok(
  (
    SELECT status = 'queued'
      AND spreadsheet_file_id = 'drive-spreadsheet-fixture'
      AND sheet_tab = 'Form Responses 1'
      AND row_number = 12
      AND decision = 'approved'
      AND attempts = 0
    FROM plugin_data.csf_sheet_writeback_ledger
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
      AND application_id = 'dd600000-0000-4000-8000-000000000001'
  ),
  'an approval queues a write-back with the imported sheet coordinates'
);

-- ---------------------------------------------------------------------------
-- D. Rejection rules and re-queueing
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_record_review_decision(
        'dd100000-0000-4000-8000-000000000001',
        'dd000000-0000-4000-8000-000000000001',
        %L, 'application', 'dd600000-0000-4000-8000-000000000001', 'rejected'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '23514',
  'A rejection needs a reason.',
  'a rejection verdict still requires a reason'
);

SELECT extensions.lives_ok(
  format(
    $$
      SELECT plugin_data.csf_record_review_decision(
        'dd100000-0000-4000-8000-000000000001',
        'dd000000-0000-4000-8000-000000000001',
        %L, 'application', 'dd600000-0000-4000-8000-000000000001', 'rejected',
        'Transcript does not match the reported courses.'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  'an officer can reverse an approval into a rejection with a reason'
);

SELECT extensions.ok(
  (
    SELECT decision_status = 'rejected'
    FROM plugin_data.csf_term_applications
    WHERE id = 'dd600000-0000-4000-8000-000000000001'
  ),
  'the reversed verdict updates the application decision state again'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
      AND application_id = 'dd600000-0000-4000-8000-000000000001'
  ),
  'revoked',
  'a rejection revokes the not-yet-active membership'
);

SELECT extensions.ok(
  (
    SELECT status = 'queued'
      AND decision = 'rejected'
      AND comment = 'Transcript does not match the reported courses.'
      AND attempts = 0
      AND sent_at IS NULL
    FROM plugin_data.csf_sheet_writeback_ledger
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
      AND application_id = 'dd600000-0000-4000-8000-000000000001'
  ),
  're-deciding overwrites and re-queues the single ledger row'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_sheet_writeback_ledger
    WHERE application_id = 'dd600000-0000-4000-8000-000000000001'
  ),
  1,
  'one application holds exactly one ledger row across re-decisions'
);

-- ---------------------------------------------------------------------------
-- E. Manual applications skip the queue; the dispatcher records outcomes
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  format(
    $$
      SELECT plugin_data.csf_record_review_decision(
        'dd100000-0000-4000-8000-000000000001',
        'dd000000-0000-4000-8000-000000000001',
        %L, 'application', 'dd600000-0000-4000-8000-000000000002', 'approved'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  'a manually created application can still be approved'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_sheet_writeback_ledger
    WHERE application_id = 'dd600000-0000-4000-8000-000000000002'
  ),
  0,
  'an application without sheet coordinates queues no write-back'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_mark_sheet_writeback_result(
      'dd100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_writeback_ledger
        WHERE application_id = 'dd600000-0000-4000-8000-000000000001'),
      false,
      'google: 429 rate limited'
    )
  $$,
  'the dispatcher can record a failed attempt'
);

SELECT extensions.ok(
  (
    SELECT status = 'failed'
      AND attempts = 1
      AND last_error = 'google: 429 rate limited'
      AND sent_at IS NULL
    FROM plugin_data.csf_sheet_writeback_ledger
    WHERE application_id = 'dd600000-0000-4000-8000-000000000001'
  ),
  'a failed attempt keeps the row retryable with its error'
);

SELECT extensions.ok(
  (
    SELECT plugin_data.csf_mark_sheet_writeback_result(
      'dd100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_writeback_ledger
        WHERE application_id = 'dd600000-0000-4000-8000-000000000001'),
      true,
      NULL
    ) ->> 'status'
  ) = 'sent',
  'a successful attempt marks the row sent'
);

SELECT extensions.ok(
  (
    SELECT status = 'sent'
      AND attempts = 2
      AND last_error IS NULL
      AND sent_at IS NOT NULL
    FROM plugin_data.csf_sheet_writeback_ledger
    WHERE application_id = 'dd600000-0000-4000-8000-000000000001'
  ),
  'the sent row records when the sheet was updated'
);

SELECT * FROM extensions.finish();

ROLLBACK;
