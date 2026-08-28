BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(14);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_profile_merge_preview_term_membership_base(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the service role cannot bypass term-membership merge review'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_merge_profiles_term_membership_base(uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'the service role cannot bypass audited term-membership consolidation'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'browser-authenticated users cannot call the request-aware merge directly'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'da000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'term-merge-officer@local.test', now(),
  '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'da100000-0000-4000-8000-000000000001',
  'Exact key term merge test',
  'exact-key-term-merge-test',
  'school',
  '621408'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'da100000-0000-4000-8000-000000000001',
  'da000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'da200000-0000-4000-8000-000000000001',
  'da100000-0000-4000-8000-000000000001',
  2037,
  'Class of 2037'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'da210000-0000-4000-8000-000000000001',
  'da100000-0000-4000-8000-000000000001',
  'F36', 'Fall 2036', '2036-2037', 'fall'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, mode, status, source_type, source_file_id
) VALUES (
  'da300000-0000-4000-8000-000000000001',
  'da100000-0000-4000-8000-000000000001',
  'preview', 'completed', 'class_history', 'official-class-workbook'
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, sheet_tab_name, row_number,
  normalized_data, import_status
) VALUES
  (
    'da400000-0000-4000-8000-000000000001',
    'da100000-0000-4000-8000-000000000001',
    'da300000-0000-4000-8000-000000000001',
    'F36', 7,
    '{"identity":{"firstName":"Sample","lastName":"Member","sourceStudentKey":"SampleMember"}}',
    'created'
  ),
  (
    'da400000-0000-4000-8000-000000000002',
    'da100000-0000-4000-8000-000000000001',
    'da300000-0000-4000-8000-000000000001',
    'S37', 8,
    '{"identity":{"firstName":"Sample","lastName":"Member","sourceStudentKey":"member sample"}}',
    'created'
  ),
  (
    'da400000-0000-4000-8000-000000000003',
    'da100000-0000-4000-8000-000000000001',
    'da300000-0000-4000-8000-000000000001',
    'F36', 9,
    '{"identity":{"firstName":"Status","lastName":"Mismatch","sourceStudentKey":"StatusMismatch"}}',
    'created'
  ),
  (
    'da400000-0000-4000-8000-000000000004',
    'da100000-0000-4000-8000-000000000001',
    'da300000-0000-4000-8000-000000000001',
    'S37', 10,
    '{"identity":{"firstName":"Status","lastName":"Mismatch","sourceStudentKey":"mismatch status"}}',
    'created'
  );

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email, source_summary
) VALUES
  (
    'da500000-0000-4000-8000-000000000001',
    'da100000-0000-4000-8000-000000000001',
    'Sample', 'Member', 'sample', 'member',
    NULL, NULL,
    '{"importedFrom":"csf_sheet_sync","importRowId":"da400000-0000-4000-8000-000000000001"}'
  ),
  (
    'da500000-0000-4000-8000-000000000002',
    'da100000-0000-4000-8000-000000000001',
    'Sample', 'Member', 'sample', 'member',
    'sample.member@students.example.test',
    'sample.member@students.example.test',
    '{"importedFrom":"csf_sheet_sync","importRowId":"da400000-0000-4000-8000-000000000002"}'
  ),
  (
    'da500000-0000-4000-8000-000000000003',
    'da100000-0000-4000-8000-000000000001',
    'Status', 'Mismatch', 'status', 'mismatch',
    NULL, NULL,
    '{"importedFrom":"csf_sheet_sync","importRowId":"da400000-0000-4000-8000-000000000003"}'
  ),
  (
    'da500000-0000-4000-8000-000000000004',
    'da100000-0000-4000-8000-000000000001',
    'Status', 'Mismatch', 'status', 'mismatch',
    'status.mismatch@students.example.test',
    'status.mismatch@students.example.test',
    '{"importedFrom":"csf_sheet_sync","importRowId":"da400000-0000-4000-8000-000000000004"}'
  );

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
)
SELECT
  'da100000-0000-4000-8000-000000000001',
  profile.id,
  'da200000-0000-4000-8000-000000000001',
  'active'
FROM plugin_data.csf_profiles AS profile
WHERE profile.organization_id = 'da100000-0000-4000-8000-000000000001';

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id, status,
  status_reason, eligibility_snapshot, completed_at
) VALUES
  (
    'da600000-0000-4000-8000-000000000001',
    'da100000-0000-4000-8000-000000000001',
    'da500000-0000-4000-8000-000000000001',
    'da210000-0000-4000-8000-000000000001',
    'da200000-0000-4000-8000-000000000001',
    'completed', 'Imported history', '{"sourcePoints":8}', now() - interval '2 days'
  ),
  (
    'da600000-0000-4000-8000-000000000002',
    'da100000-0000-4000-8000-000000000001',
    'da500000-0000-4000-8000-000000000002',
    'da210000-0000-4000-8000-000000000001',
    'da200000-0000-4000-8000-000000000001',
    'completed', NULL, '{"targetMeetings":3}', now() - interval '1 day'
  ),
  (
    'da600000-0000-4000-8000-000000000003',
    'da100000-0000-4000-8000-000000000001',
    'da500000-0000-4000-8000-000000000003',
    'da210000-0000-4000-8000-000000000001',
    'da200000-0000-4000-8000-000000000001',
    'active', NULL, '{}', NULL
  ),
  (
    'da600000-0000-4000-8000-000000000004',
    'da100000-0000-4000-8000-000000000001',
    'da500000-0000-4000-8000-000000000004',
    'da210000-0000-4000-8000-000000000001',
    'da200000-0000-4000-8000-000000000001',
    'completed', NULL, '{}', now()
  );

SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'da100000-0000-4000-8000-000000000001',
    'da500000-0000-4000-8000-000000000001',
    'da500000-0000-4000-8000-000000000002'
  )->>'canMerge')::boolean,
  'an exact workbook key permits equivalent same-term outcomes'
);
SELECT extensions.is(
  plugin_data.csf_profile_merge_preview(
    'da100000-0000-4000-8000-000000000001',
    'da500000-0000-4000-8000-000000000001',
    'da500000-0000-4000-8000-000000000002'
  ) #>> '{identityEvidence,termMembershipConsolidationCount}',
  '1',
  'the preview records one audited same-term consolidation'
);
SELECT extensions.ok(
  NOT jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'da100000-0000-4000-8000-000000000001',
      'da500000-0000-4000-8000-000000000001',
      'da500000-0000-4000-8000-000000000002'
    ),
    '$.conflicts[*] ? (@.type == "term_membership")'
  ),
  'the equivalent term-membership blocker is removed from the reviewed preview'
);
SELECT extensions.is(
  plugin_data.csf_merge_profiles(
    'da100000-0000-4000-8000-000000000001',
    'da500000-0000-4000-8000-000000000001',
    'da500000-0000-4000-8000-000000000002',
    'Exact workbook identity and matching semester outcome.',
    'da000000-0000-4000-8000-000000000001',
    'da700000-0000-4000-8000-000000000001'
  )->>'consolidatedTermMemberships',
  '1',
  'the request-aware merge reports one consolidated term membership'
);
SELECT extensions.is(
  (
    SELECT merged_into_profile_id::text
    FROM plugin_data.csf_profiles
    WHERE id = 'da500000-0000-4000-8000-000000000001'
  ),
  'da500000-0000-4000-8000-000000000002',
  'the imported duplicate points to the canonical profile'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'da100000-0000-4000-8000-000000000001'
      AND term_id = 'da210000-0000-4000-8000-000000000001'
      AND profile_id IN (
        'da500000-0000-4000-8000-000000000001',
        'da500000-0000-4000-8000-000000000002'
      )
  ),
  1,
  'one canonical term-membership row remains after the merge'
);
SELECT extensions.is(
  (
    SELECT eligibility_snapshot
    FROM plugin_data.csf_term_memberships
    WHERE profile_id = 'da500000-0000-4000-8000-000000000002'
      AND term_id = 'da210000-0000-4000-8000-000000000001'
  ),
  '{"sourcePoints":8,"targetMeetings":3}'::jsonb,
  'the canonical term membership retains evidence from both imported records'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profile_merge_term_membership_consolidations
    WHERE source_profile_id = 'da500000-0000-4000-8000-000000000001'
      AND target_profile_id = 'da500000-0000-4000-8000-000000000002'
      AND source_snapshot ->> 'status' = 'completed'
      AND target_snapshot ->> 'status' = 'completed'
  ),
  1,
  'the private audit table preserves both original membership snapshots'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_merge_term_membership_consolidations AS consolidation
    JOIN plugin_data.csf_profile_merge_reviews AS review
      ON review.id = consolidation.merge_review_id
    WHERE consolidation.source_profile_id = 'da500000-0000-4000-8000-000000000001'
      AND review.status = 'approved'
  ),
  'the consolidation evidence is attached to the approved merge review'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'da100000-0000-4000-8000-000000000001',
    'da500000-0000-4000-8000-000000000003',
    'da500000-0000-4000-8000-000000000004'
  )->>'canMerge')::boolean,
  'different same-term outcomes remain blocked'
);
SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'da100000-0000-4000-8000-000000000001',
      'da500000-0000-4000-8000-000000000003',
      'da500000-0000-4000-8000-000000000004'
    ),
    '$.conflicts[*] ? (@.type == "term_membership")'
  ),
  'the preview retains the term-membership conflict when outcomes differ'
);

SELECT * FROM extensions.finish();
ROLLBACK;
