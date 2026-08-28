BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(6);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_profile_merge_preview_committed_lineage_base(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the service role cannot bypass committed roster-key lineage checks'
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ca100000-0000-4000-8000-000000000001',
  'Committed roster key lineage test',
  'roster-key-lineage-test',
  'school',
  '731408'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'ca200000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  2036,
  'Class of 2036'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, mode, status, source_type, source_file_id
) VALUES
  (
    'ca300000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'official-class-workbook'
  ),
  (
    'ca300000-0000-4000-8000-000000000002',
    'ca100000-0000-4000-8000-000000000001',
    'preview', 'completed', 'class_history', 'different-class-workbook'
  );

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, sheet_tab_name, row_number,
  normalized_data, matched_profile_id, import_status
) VALUES
  (
    'ca400000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001',
    'F24', 7,
    '{"identity":{"firstName":"Sample","lastName":"Member"}}',
    NULL,
    'created'
  ),
  (
    'ca400000-0000-4000-8000-000000000002',
    'ca100000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001',
    'S25', 8,
    '{"identity":{"firstName":"Sample","lastName":"Member"}}',
    NULL,
    'created'
  );

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email, source_summary
) VALUES
  (
    'ca500000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000001',
    'Sample', 'Member', 'sample', 'member',
    'sample.member@students.example.test',
    'sample.member@students.example.test',
    '{"importedFrom":"csf_sheet_sync","importRowId":"ca400000-0000-4000-8000-000000000001"}'
  ),
  (
    'ca500000-0000-4000-8000-000000000002',
    'ca100000-0000-4000-8000-000000000001',
    'Sample', 'Member', 'sample', 'member',
    NULL, NULL,
    '{"importedFrom":"csf_sheet_sync","importRowId":"ca400000-0000-4000-8000-000000000002"}'
  ),
  (
    'ca500000-0000-4000-8000-000000000003',
    'ca100000-0000-4000-8000-000000000001',
    'Sample', 'Member', 'sample', 'member',
    NULL, NULL,
    '{"importedFrom":"csf_sheet_sync","importRowId":"ca400000-0000-4000-8000-000000000002"}'
  );

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, sheet_tab_name, row_number,
  normalized_data, matched_profile_id, import_status
) VALUES
  (
    'ca400000-0000-4000-8000-000000000003',
    'ca100000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001',
    'F25', 9,
    '{"record":{"identity":{"firstName":"Sample","lastName":"Member","sourceStudentKey":"SampleMember"}}}',
    'ca500000-0000-4000-8000-000000000001',
    'updated'
  ),
  (
    'ca400000-0000-4000-8000-000000000004',
    'ca100000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001',
    'S26', 10,
    '{"identity":{"firstName":"Sample","lastName":"Member","sourceStudentKey":"Member Sample"}}',
    'ca500000-0000-4000-8000-000000000002',
    'updated'
  ),
  (
    'ca400000-0000-4000-8000-000000000005',
    'ca100000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000002',
    'F26', 11,
    '{"identity":{"firstName":"Sample","lastName":"Member","sourceStudentKey":"samplemember"}}',
    'ca500000-0000-4000-8000-000000000003',
    'updated'
  );

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
)
SELECT
  'ca100000-0000-4000-8000-000000000001',
  profile.id,
  'ca200000-0000-4000-8000-000000000001',
  'active'
FROM plugin_data.csf_profiles AS profile
WHERE profile.organization_id = 'ca100000-0000-4000-8000-000000000001';

SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'ca100000-0000-4000-8000-000000000001',
    'ca500000-0000-4000-8000-000000000002',
    'ca500000-0000-4000-8000-000000000001'
  )->>'canMerge')::boolean,
  'later committed rows can prove identity for profiles with pre-key origins'
);
SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'ca100000-0000-4000-8000-000000000001',
    'ca500000-0000-4000-8000-000000000002',
    'ca500000-0000-4000-8000-000000000001'
  )->'identityEvidence'->>'committedSourceStudentKeyMatch')::boolean,
  'the preview records committed roster-key lineage evidence'
);
SELECT extensions.ok(
  NOT jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'ca100000-0000-4000-8000-000000000001',
      'ca500000-0000-4000-8000-000000000002',
      'ca500000-0000-4000-8000-000000000001'
    ),
    '$.conflicts[*] ? (@.type == "identity_email_missing")'
  ),
  'committed exact-key lineage removes only the missing-email blocker'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'ca100000-0000-4000-8000-000000000001',
    'ca500000-0000-4000-8000-000000000003',
    'ca500000-0000-4000-8000-000000000001'
  )->>'canMerge')::boolean,
  'matching keys from different workbook identities remain blocked'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'ca100000-0000-4000-8000-000000000001',
    'ca500000-0000-4000-8000-000000000003',
    'ca500000-0000-4000-8000-000000000001'
  )->'identityEvidence'->>'committedSourceStudentKeyMatch')::boolean,
  'different workbook lineage is not recorded as identity evidence'
);

SELECT * FROM extensions.finish();
ROLLBACK;
