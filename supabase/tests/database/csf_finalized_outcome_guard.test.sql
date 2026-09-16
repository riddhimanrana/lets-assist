-- A finalized semester keeps its published outcome, and the officer read
-- surfaces are exercised rather than merely created.
--
-- The dangerous window is an open term that already carries finalized
-- memberships: requirements have been evaluated but the term has not closed, so
-- the closed-term guards do not apply yet. A green mark on a row from that
-- semester must be held, not published over the outcome.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(14);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'ea000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'csf-finalized-officer@local.test', now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ea100000-0000-4000-8000-000000000001',
  'CSF Finalized Outcome Guard', 'csf-finalized-outcome-guard', 'school', '740055'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'ea100000-0000-4000-8000-000000000001',
  'ea000000-0000-4000-8000-000000000001', 'admin', 'active'
);

-- The term is open. Nothing here depends on a closed-term guard.
INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current,
  application_review_source
) VALUES (
  'ea200000-0000-4000-8000-000000000001',
  'ea100000-0000-4000-8000-000000000001',
  'F34', 'Fall 2034', '2034-2035', 'fall', true, 'sheet'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label, status
) VALUES (
  'ea500000-0000-4000-8000-000000000001',
  'ea100000-0000-4000-8000-000000000001', 2038, 'c/o 2038', 'active'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('ea300000-0000-4000-8000-000000000001',
   'ea100000-0000-4000-8000-000000000001',
   'Completed', 'Member', 'completed', 'member'),
  ('ea300000-0000-4000-8000-000000000002',
   'ea100000-0000-4000-8000-000000000001',
   'Notcompleted', 'Member', 'notcompleted', 'member');

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, title, provider, source_type, drive_file_id, spreadsheet_id
) VALUES (
  'ea400000-0000-4000-8000-000000000001',
  'ea100000-0000-4000-8000-000000000001', 'Fall 2034 applications',
  'google_sheets', 'application_responses', 'ea-workbook', 'ea-workbook'
);

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  decision_status, source_file_id, source_sheet_tab, source_row_number
) VALUES
  ('ea600000-0000-4000-8000-000000000001',
   'ea100000-0000-4000-8000-000000000001',
   'ea300000-0000-4000-8000-000000000001',
   'ea500000-0000-4000-8000-000000000001',
   'ea200000-0000-4000-8000-000000000001',
   'google_form_sheet', 'accepted', 'approved', 'ea-workbook', 'Form Responses 1', 3),
  ('ea600000-0000-4000-8000-000000000002',
   'ea100000-0000-4000-8000-000000000001',
   'ea300000-0000-4000-8000-000000000002',
   'ea500000-0000-4000-8000-000000000001',
   'ea200000-0000-4000-8000-000000000001',
   'google_form_sheet', 'accepted', 'approved', 'ea-workbook', 'Form Responses 1', 4);

-- Both semesters are already finished, in the two finalized shapes.
INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, application_id,
  status, completed_at
) VALUES
  ('ea100000-0000-4000-8000-000000000001',
   'ea300000-0000-4000-8000-000000000001',
   'ea200000-0000-4000-8000-000000000001',
   'ea500000-0000-4000-8000-000000000001',
   'ea600000-0000-4000-8000-000000000001', 'completed', now()),
  ('ea100000-0000-4000-8000-000000000001',
   'ea300000-0000-4000-8000-000000000002',
   'ea200000-0000-4000-8000-000000000001',
   'ea500000-0000-4000-8000-000000000001',
   'ea600000-0000-4000-8000-000000000002', 'not_completed', now());

-- A later sheet read marks both rows green.
INSERT INTO plugin_data.csf_application_decision_stages (
  organization_id, application_id, term_id, profile_id, source_id,
  staged_decision, observed_color
) VALUES
  ('ea100000-0000-4000-8000-000000000001',
   'ea600000-0000-4000-8000-000000000001',
   'ea200000-0000-4000-8000-000000000001',
   'ea300000-0000-4000-8000-000000000001',
   'ea400000-0000-4000-8000-000000000001', 'accepted', '#d9ead3'),
  ('ea100000-0000-4000-8000-000000000001',
   'ea600000-0000-4000-8000-000000000002',
   'ea200000-0000-4000-8000-000000000001',
   'ea300000-0000-4000-8000-000000000002',
   'ea400000-0000-4000-8000-000000000001', 'accepted', '#d9ead3');

-- ---------------------------------------------------------------------------
-- A. An acceptance is held against both finalized shapes
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE release_receipt ON COMMIT DROP AS
SELECT plugin_data.csf_release_sheet_application_decisions(
  'ea100000-0000-4000-8000-000000000001',
  'ea000000-0000-4000-8000-000000000001',
  'ea200000-0000-4000-8000-000000000001',
  'eaa00000-0000-4000-8000-000000000001'
) AS payload;

SELECT extensions.is(
  (SELECT (payload ->> 'released')::integer FROM release_receipt),
  0,
  'a green mark on a finished semester publishes nothing'
);

SELECT extensions.is(
  (SELECT (payload ->> 'heldCount')::integer FROM release_receipt),
  2,
  'both finalized rows are held'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM release_receipt,
      LATERAL pg_catalog.jsonb_array_elements(payload -> 'held') AS entry
    WHERE entry ->> 'blockReason' = 'historical_outcome'
  ),
  2,
  'each held row names the finalized outcome as its reason'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'ea600000-0000-4000-8000-000000000001'
  ),
  'completed',
  'the completed membership keeps its outcome'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'ea600000-0000-4000-8000-000000000002'
  ),
  'not_completed',
  'the not-completed membership is not flipped back to accepted'
);

SELECT extensions.is(
  (
    SELECT release_state
    FROM plugin_data.csf_application_decision_stages
    WHERE application_id = 'ea600000-0000-4000-8000-000000000002'
  ),
  'staged',
  'a held row stays staged rather than recording a release it never got'
);

-- The publish primitive refuses directly too, so no other caller can slip past.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_publish_sheet_application_decision(
      'ea100000-0000-4000-8000-000000000001',
      'ea600000-0000-4000-8000-000000000001',
      'accepted', NULL,
      'ea000000-0000-4000-8000-000000000001',
      '{}'::jsonb
    )
  $$,
  '55000',
  'A finalized term membership keeps its published outcome.',
  'publishing an acceptance over a finalized outcome is refused at the primitive'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_publish_sheet_application_decision(
      'ea100000-0000-4000-8000-000000000001',
      'ea600000-0000-4000-8000-000000000002',
      'unreviewed', NULL,
      'ea000000-0000-4000-8000-000000000001',
      '{}'::jsonb
    )
  $$,
  '55000',
  'A finalized term membership keeps its published outcome.',
  'retracting a finalized outcome is refused as well'
);

-- ---------------------------------------------------------------------------
-- B. The officer read surfaces answer when invoked
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT pg_catalog.jsonb_array_length(
      plugin_data.csf_list_sheet_application_decisions(
        'ea100000-0000-4000-8000-000000000001',
        'ea000000-0000-4000-8000-000000000001',
        'ea200000-0000-4000-8000-000000000001'
      ) -> 'rows'
    )
  ),
  2,
  'the staged-decision list returns both rows when called'
);

SELECT extensions.is(
  (
    SELECT entry ->> 'blockReason'
    FROM pg_catalog.jsonb_array_elements(
      plugin_data.csf_list_sheet_application_decisions(
        'ea100000-0000-4000-8000-000000000001',
        'ea000000-0000-4000-8000-000000000001',
        'ea200000-0000-4000-8000-000000000001'
      ) -> 'rows'
    ) AS entry
    WHERE entry ->> 'applicationId' = 'ea600000-0000-4000-8000-000000000001'
  ),
  NULL,
  'a row held only by its membership carries no row-level blocker'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.jsonb_array_length(
      plugin_data.csf_list_sheet_application_decisions(
        'ea100000-0000-4000-8000-000000000001',
        'ea000000-0000-4000-8000-000000000001',
        'ea200000-0000-4000-8000-000000000001',
        'done'
      ) -> 'rows'
    )
  ),
  2,
  'the Done filter is applied by the server, not the caller'
);

SELECT extensions.is(
  (
    plugin_data.csf_sheet_application_decision_term_state(
      'ea100000-0000-4000-8000-000000000001',
      'ea000000-0000-4000-8000-000000000001',
      'ea200000-0000-4000-8000-000000000001'
    ) -> 'counts' ->> 'accepted'
  ),
  '2',
  'the term state counts the staged acceptances when called'
);

SELECT extensions.is(
  (
    plugin_data.csf_sheet_application_decision_term_state(
      'ea100000-0000-4000-8000-000000000001',
      'ea000000-0000-4000-8000-000000000001',
      'ea200000-0000-4000-8000-000000000001'
    ) ->> 'reviewSource'
  ),
  'sheet',
  'the term state reports the review source it was asked about'
);

SELECT extensions.is(
  (
    SELECT entry ->> 'configured'
    FROM pg_catalog.jsonb_array_elements(
      plugin_data.csf_list_application_decision_mappings(
        'ea100000-0000-4000-8000-000000000001',
        'ea000000-0000-4000-8000-000000000001'
      )
    ) AS entry
    WHERE entry ->> 'sourceId' = 'ea400000-0000-4000-8000-000000000001'
  ),
  'false',
  'an unmapped source is reported unconfigured rather than defaulted'
);

SELECT * FROM extensions.finish();

ROLLBACK;
