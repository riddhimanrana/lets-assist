BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(8);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_profile_merge_preview_source_key_contact_base(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the service role cannot bypass the exact roster-key identity check'
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ba100000-0000-4000-8000-000000000001',
  'Roster key contact merge test',
  'roster-key-contact-merge-test',
  'school',
  '841207'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'ba200000-0000-4000-8000-000000000001',
  'ba100000-0000-4000-8000-000000000001',
  2035,
  'Class of 2035'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, mode, status, source_type, source_file_id
) VALUES (
  'ba300000-0000-4000-8000-000000000001',
  'ba100000-0000-4000-8000-000000000001',
  'preview', 'completed', 'class_history', 'official-class-workbook'
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, sheet_tab_name, row_number,
  normalized_data, import_status
) VALUES
  (
    'ba400000-0000-4000-8000-000000000001',
    'ba100000-0000-4000-8000-000000000001',
    'ba300000-0000-4000-8000-000000000001',
    'F24', 7,
    '{"identity":{"firstName":"Sample","lastName":"Member","sourceStudentKey":"SampleMember"}}',
    'created'
  ),
  (
    'ba400000-0000-4000-8000-000000000002',
    'ba100000-0000-4000-8000-000000000001',
    'ba300000-0000-4000-8000-000000000001',
    'S25', 8,
    '{"identity":{"firstName":"Sample","lastName":"Member","sourceStudentKey":"Member Sample"}}',
    'created'
  ),
  (
    'ba400000-0000-4000-8000-000000000003',
    'ba100000-0000-4000-8000-000000000001',
    'ba300000-0000-4000-8000-000000000001',
    'F25', 9,
    '{"identity":{"firstName":"Sample","lastName":"Member","sourceStudentKey":"unrelated-key"}}',
    'created'
  ),
  (
    'ba400000-0000-4000-8000-000000000004',
    'ba100000-0000-4000-8000-000000000001',
    'ba300000-0000-4000-8000-000000000001',
    'S26', 10,
    '{"identity":{"firstName":"Sample","lastName":"Member","sourceStudentKey":"samplemember"}}',
    'created'
  );

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email, source_summary
) VALUES
  (
    'ba500000-0000-4000-8000-000000000001',
    'ba100000-0000-4000-8000-000000000001',
    'Sample', 'Member', 'sample', 'member',
    'sample.member@students.example.test',
    'sample.member@students.example.test',
    '{"importedFrom":"csf_sheet_sync","importRowId":"ba400000-0000-4000-8000-000000000001"}'
  ),
  (
    'ba500000-0000-4000-8000-000000000002',
    'ba100000-0000-4000-8000-000000000001',
    'Sample', 'Member', 'sample', 'member',
    NULL, NULL,
    '{"importedFrom":"csf_sheet_sync","importRowId":"ba400000-0000-4000-8000-000000000002"}'
  ),
  (
    'ba500000-0000-4000-8000-000000000003',
    'ba100000-0000-4000-8000-000000000001',
    'Sample', 'Member', 'sample', 'member',
    NULL, NULL,
    '{"importedFrom":"csf_sheet_sync","importRowId":"ba400000-0000-4000-8000-000000000003"}'
  ),
  (
    'ba500000-0000-4000-8000-000000000004',
    'ba100000-0000-4000-8000-000000000001',
    'Sample', 'Member', 'sample', 'member',
    'different.member@students.example.test',
    'different.member@students.example.test',
    '{"importedFrom":"csf_sheet_sync","importRowId":"ba400000-0000-4000-8000-000000000004"}'
  );

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
)
SELECT
  'ba100000-0000-4000-8000-000000000001',
  profile.id,
  'ba200000-0000-4000-8000-000000000001',
  'active'
FROM plugin_data.csf_profiles AS profile
WHERE profile.organization_id = 'ba100000-0000-4000-8000-000000000001';

SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'ba100000-0000-4000-8000-000000000001',
    'ba500000-0000-4000-8000-000000000002',
    'ba500000-0000-4000-8000-000000000001'
  )->>'canMerge')::boolean,
  'a name-derived roster key corroborates a contact-bearing imported profile'
);
SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'ba100000-0000-4000-8000-000000000001',
    'ba500000-0000-4000-8000-000000000002',
    'ba500000-0000-4000-8000-000000000001'
  )->'identityEvidence'->>'exactSourceStudentKeyMatch')::boolean,
  'the preview records the exact roster-key evidence'
);
SELECT extensions.ok(
  NOT jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'ba100000-0000-4000-8000-000000000001',
      'ba500000-0000-4000-8000-000000000002',
      'ba500000-0000-4000-8000-000000000001'
    ),
    '$.conflicts[*] ? (@.type == "identity_email_missing")'
  ),
  'the exact roster key removes only the missing-email blocker'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'ba100000-0000-4000-8000-000000000001',
    'ba500000-0000-4000-8000-000000000003',
    'ba500000-0000-4000-8000-000000000001'
  )->>'canMerge')::boolean,
  'an opaque roster key cannot corroborate identity'
);
SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'ba100000-0000-4000-8000-000000000001',
      'ba500000-0000-4000-8000-000000000003',
      'ba500000-0000-4000-8000-000000000001'
    ),
    '$.conflicts[*] ? (@.type == "identity_email_missing")'
  ),
  'an opaque roster key leaves the missing-email blocker intact'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'ba100000-0000-4000-8000-000000000001',
    'ba500000-0000-4000-8000-000000000004',
    'ba500000-0000-4000-8000-000000000001'
  )->>'canMerge')::boolean,
  'an exact roster key cannot override different school email identities'
);
SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'ba100000-0000-4000-8000-000000000001',
      'ba500000-0000-4000-8000-000000000004',
      'ba500000-0000-4000-8000-000000000001'
    ),
    '$.conflicts[*] ? (@.type == "school_email_mismatch")'
  ),
  'the exact roster key retains the concrete school-email conflict'
);

SELECT * FROM extensions.finish();
ROLLBACK;
