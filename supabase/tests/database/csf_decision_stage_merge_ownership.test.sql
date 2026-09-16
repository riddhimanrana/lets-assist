-- A staged Sheet decision follows its application through a profile merge, and
-- the mapping that decides how to read the workbook cannot be overwritten by a
-- second officer who never saw the first save.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(11);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'df000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'csf-stage-merge-officer@local.test', now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'df100000-0000-4000-8000-000000000001',
  'CSF Stage Merge Ownership', 'csf-stage-merge-ownership', 'school', '740033'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'df100000-0000-4000-8000-000000000001',
  'df000000-0000-4000-8000-000000000001', 'admin', 'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'df200000-0000-4000-8000-000000000001',
  'df100000-0000-4000-8000-000000000001',
  'F32', 'Fall 2032', '2032-2033', 'fall', true
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label, status
) VALUES (
  'df500000-0000-4000-8000-000000000001',
  'df100000-0000-4000-8000-000000000001', 2036, 'c/o 2036', 'active'
);

-- One student entered twice. The merge refuses anything less than a
-- corroborated duplicate, so these two records agree on the normalized name and
-- share an exact school email; that is what makes them the same student rather
-- than two classmates with similar records.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email
) VALUES
  ('df300000-0000-4000-8000-000000000001',
   'df100000-0000-4000-8000-000000000001',
   'Jordan', 'Rivera', 'jordan', 'rivera',
   'Jordan.Rivera@student.local.test', 'jordan.rivera@student.local.test'),
  ('df300000-0000-4000-8000-000000000002',
   'df100000-0000-4000-8000-000000000001',
   'Jordan', 'Rivera', 'jordan', 'rivera',
   'jordan.rivera@student.local.test', 'jordan.rivera@student.local.test');

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, title, provider, source_type, drive_file_id, spreadsheet_id
) VALUES (
  'df400000-0000-4000-8000-000000000001',
  'df100000-0000-4000-8000-000000000001',
  'Fall 2032 applications', 'google_sheets', 'application_responses',
  'df-regular-workbook', 'df-regular-workbook'
);

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  source_file_id, source_sheet_tab, source_row_number
) VALUES (
  'df600000-0000-4000-8000-000000000001',
  'df100000-0000-4000-8000-000000000001',
  'df300000-0000-4000-8000-000000000001',
  'df500000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000001',
  'google_form_sheet', 'submitted', 'df-regular-workbook', 'Form Responses 1', 7
);

INSERT INTO plugin_data.csf_application_decision_stages (
  organization_id, application_id, term_id, profile_id,
  source_id, staged_decision, observed_color
) VALUES (
  'df100000-0000-4000-8000-000000000001',
  'df600000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000001',
  'df300000-0000-4000-8000-000000000001',
  'df400000-0000-4000-8000-000000000001',
  'accepted', '#d9ead3'
);

-- ---------------------------------------------------------------------------
-- A. The invariant is enforced, not assumed
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_application_decision_stages
    SET profile_id = 'df300000-0000-4000-8000-000000000002'
    WHERE application_id = 'df600000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'A staged CSF decision must name the same student as its application.',
  'a stage cannot be pointed at a student who does not own the application'
);

-- ---------------------------------------------------------------------------
-- B. The merge catalog classifies the reference
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(
      plugin_data.csf_profile_merge_reference_plan(
        'df100000-0000-4000-8000-000000000001',
        'df300000-0000-4000-8000-000000000001'
      ) -> 'sameTransactionRewrites'
    ) AS entry
    WHERE entry ->> 'reference'
      = 'plugin_data.csf_application_decision_stages.profile_id'
  ),
  'the merge plan owns the staged-decision reference as a same-transaction rewrite'
);

SELECT extensions.is(
  (
    SELECT (entry ->> 'sourceCount')::integer
    FROM pg_catalog.jsonb_array_elements(
      plugin_data.csf_profile_merge_reference_plan(
        'df100000-0000-4000-8000-000000000001',
        'df300000-0000-4000-8000-000000000001'
      ) -> 'sameTransactionRewrites'
    ) AS entry
    WHERE entry ->> 'reference'
      = 'plugin_data.csf_application_decision_stages.profile_id'
  ),
  1,
  'the plan counts the staged decisions the merge will move'
);

-- ---------------------------------------------------------------------------
-- C. The merge moves the stage with its application
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_merge_profiles(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000002',
      'Duplicate record entered twice during intake.',
      'df000000-0000-4000-8000-000000000001'
    )
  $$,
  'the audited merge completes with a staged decision attached'
);

SELECT extensions.is(
  (
    SELECT profile_id
    FROM plugin_data.csf_application_decision_stages
    WHERE application_id = 'df600000-0000-4000-8000-000000000001'
  ),
  'df300000-0000-4000-8000-000000000002'::uuid,
  'the staged decision now names the keeper profile'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_application_decision_stages AS stage
    JOIN plugin_data.csf_term_applications AS application
      ON application.id = stage.application_id
     AND application.organization_id = stage.organization_id
    WHERE stage.profile_id IS DISTINCT FROM application.profile_id
  ),
  0,
  'no staged decision disagrees with its application after the merge'
);

SELECT extensions.is(
  (
    SELECT staged_decision
    FROM plugin_data.csf_application_decision_stages
    WHERE application_id = 'df600000-0000-4000-8000-000000000001'
  ),
  'accepted',
  'the merge moves ownership without rewriting what the chapter decided'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'df100000-0000-4000-8000-000000000001'
      AND action = 'profile_merge.decision_stages_reassigned'
  ),
  'the reassignment leaves its own audit evidence'
);

-- ---------------------------------------------------------------------------
-- D. A second officer cannot overwrite a mapping they never saw
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_set_application_decision_mapping(
  'df100000-0000-4000-8000-000000000001',
  'df000000-0000-4000-8000-000000000001',
  'df400000-0000-4000-8000-000000000001',
  '{"decisionColumns":[7],"reasonColumns":[8],"readsCellNote":true,
    "identityColumns":{"email":3,"submittedAt":1},
    "scope":{"sheetTabName":"Form Responses 1","range":"A1:W563","headerRow":1},
    "colors":{"accepted":["#d9ead3"],"ignoredFills":["#f8f9fa","#ffffff"]}}'::jsonb,
  NULL
);

-- The officer who reloaded and saw version 1 saves successfully, taking it to 2.
SELECT extensions.is(
  (
    plugin_data.csf_set_application_decision_mapping(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df400000-0000-4000-8000-000000000001',
      '{"decisionColumns":[9],"identityColumns":{"email":3}}'::jsonb,
      1
    ) ->> 'mappingVersion'
  ),
  '2',
  'a save that names the version it was editing is accepted'
);

-- The officer still holding version 1 is refused, not merged over.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_application_decision_mapping(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df400000-0000-4000-8000-000000000001',
      '{"decisionColumns":[11]}'::jsonb,
      1
    )
  $$,
  '40001',
  'Someone else changed this decision mapping. Reload it and save again.',
  'a stale expected version is refused instead of silently overwriting'
);

SELECT extensions.is(
  (
    SELECT identity_columns ->> 'email'
    FROM plugin_data.csf_application_decision_mappings
    WHERE source_id = 'df400000-0000-4000-8000-000000000001'
  ),
  '3',
  'the identity column configuration survives the move off sheet settings'
);

SELECT * FROM extensions.finish();

ROLLBACK;
