BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users (id, email) VALUES
  ('f3810000-0000-4000-8000-000000000001', 'scoped-officer@local.test'),
  ('f3810000-0000-4000-8000-000000000002', 'scoped-outsider@local.test');
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('f3820000-0000-4000-8000-000000000001', 'Scoped import fixture', 'scoped-import-fixture', 'school', '998381');
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('f3820000-0000-4000-8000-000000000001', 'f3810000-0000-4000-8000-000000000001', 'admin', 'active');
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES ('f3830000-0000-4000-8000-000000000001', 'f3820000-0000-4000-8000-000000000001', 2040, 'Class of 2040');
INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester)
VALUES ('f3840000-0000-4000-8000-000000000001', 'f3820000-0000-4000-8000-000000000001', 'F39', 'Fall 2039', '2039-2040', 'fall');
INSERT INTO plugin_data.csf_cohort_terms (organization_id, cohort_id, term_id)
VALUES ('f3820000-0000-4000-8000-000000000001', 'f3830000-0000-4000-8000-000000000001', 'f3840000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name)
VALUES
  ('f3850000-0000-4000-8000-000000000001', 'f3820000-0000-4000-8000-000000000001', 'Fictional', 'Learner', 'fictional', 'learner'),
  ('f3850000-0000-4000-8000-000000000002', 'f3820000-0000-4000-8000-000000000001', 'Fictional', 'Neighbor', 'fictional', 'neighbor');
INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id, status)
VALUES
  ('f3820000-0000-4000-8000-000000000001', 'f3850000-0000-4000-8000-000000000001', 'f3830000-0000-4000-8000-000000000001', 'active'),
  ('f3820000-0000-4000-8000-000000000001', 'f3850000-0000-4000-8000-000000000002', 'f3830000-0000-4000-8000-000000000001', 'active');
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  drive_access_state, drive_trashed, drive_file_id, drive_file_name,
  drive_mime_type, drive_modified_at, settings
) VALUES (
  'f3860000-0000-4000-8000-000000000001', 'f3820000-0000-4000-8000-000000000001',
  'application_responses', 'Fictional application responses',
  'f3830000-0000-4000-8000-000000000001', 'google_sheets',
  'accessible', false, 'fictional-scoped-application-file', 'Fictional applications',
  'application/vnd.google-apps.spreadsheet', '2039-09-01T00:00:00Z',
  '{"sourceKind":"application_responses","evidenceRevision":"41","mappingVersion":1}'::jsonb
);
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata, mapping_snapshot, mapping_version,
  source_content_hash, snapshot_hash, snapshot_row_count, snapshot_contract_version
) VALUES (
  'f3870000-0000-4000-8000-000000000001', 'f3820000-0000-4000-8000-000000000001',
  'f3860000-0000-4000-8000-000000000001', 'f3810000-0000-4000-8000-000000000001',
  'preview', 'needs_resolution', 'application_responses',
  'fictional-scoped-application-file', 'Fictional applications', 'Responses', 'Responses!A1:Z9',
  '2039-09-01T00:00:00Z',
  jsonb_build_object('id', 'fictional-scoped-application-file', 'sourceProvider', 'google_sheets',
    'name', 'Fictional applications', 'mimeType', 'application/vnd.google-apps.spreadsheet',
    'version', '41', 'modifiedTime', '2039-09-01T00:00:00Z',
    'accessState', 'accessible', 'trashed', false),
  jsonb_build_object('version', 1, 'sourceType', 'application_responses',
    'sourceFileId', 'fictional-scoped-application-file', 'sourceProvider', 'google_sheets',
    'tabs', jsonb_build_array(jsonb_build_object('tabName', 'Responses',
      'range', 'Responses!A1:Z9', 'headerRow', 1))),
  1, repeat('a', 64), repeat('b', 64), 2, 'csf-normalized-import/v1'
);
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, term_id, sheet_tab_name,
  row_number, source_range, raw_data, normalized_data, row_hash,
  matched_profile_id, import_status, resolution_status, resolution_reason_code,
  resolution_notes, resolved_by, resolved_at, mapping_version
) VALUES
  (
    'f3880000-0000-4000-8000-000000000001', 'f3820000-0000-4000-8000-000000000001',
    'f3870000-0000-4000-8000-000000000001', 'f3860000-0000-4000-8000-000000000001',
    'f3830000-0000-4000-8000-000000000001', 'f3840000-0000-4000-8000-000000000001',
    'Responses', 2, 'Responses!A1:Z9', '{"fixture":"one"}'::jsonb,
    jsonb_build_object('commitPayload', jsonb_build_object('version', 'csf-commit-payload/v1',
      'sourceType', 'application_responses',
      'identity', jsonb_build_object('firstName', 'Fictional', 'lastName', 'Learner',
        'normalizedFirstName', 'fictional', 'normalizedLastName', 'learner'),
      'canonicalEmails', jsonb_build_object('schoolEmail', 'fictional@students.example.net',
        'normalizedSchoolEmail', 'fictional@students.example.net'),
      'applicationData', jsonb_build_object('currentGradeLevel', 11))),
    repeat('c', 64), 'f3850000-0000-4000-8000-000000000001',
    'pending', 'resolved', 'match', 'Officer verified this fictional response.',
    'f3810000-0000-4000-8000-000000000001', now(), 1
  ),
  (
    'f3880000-0000-4000-8000-000000000002', 'f3820000-0000-4000-8000-000000000001',
    'f3870000-0000-4000-8000-000000000001', 'f3860000-0000-4000-8000-000000000001',
    'f3830000-0000-4000-8000-000000000001', 'f3840000-0000-4000-8000-000000000001',
    'Responses', 3, 'Responses!A1:Z9', '{"fixture":"two"}'::jsonb,
    jsonb_build_object('commitPayload', jsonb_build_object('version', 'csf-commit-payload/v1',
      'sourceType', 'application_responses',
      'identity', jsonb_build_object('firstName', 'Fictional', 'lastName', 'Neighbor',
        'normalizedFirstName', 'fictional', 'normalizedLastName', 'neighbor'),
      'canonicalEmails', jsonb_build_object('schoolEmail', 'neighbor@students.example.net',
        'normalizedSchoolEmail', 'neighbor@students.example.net'),
      'applicationData', jsonb_build_object('currentGradeLevel', 11))),
    repeat('d', 64), NULL,
    'ambiguous', 'pending', NULL, NULL, NULL, NULL, 1
  );

CREATE TEMP TABLE scoped_expected_review AS
SELECT matched_profile_id, resolved_at
FROM plugin_data.csf_sheet_import_rows
WHERE id = 'f3880000-0000-4000-8000-000000000001';
CREATE FUNCTION pg_temp.queue_scoped_fixture(
  p_organization_id uuid, p_row_id uuid, p_actor_id uuid,
  p_request_id uuid, p_reason text
) RETURNS jsonb LANGUAGE sql AS $fixture$
  SELECT plugin_data.csf_queue_scoped_application_import(
    p_organization_id, p_row_id, p_actor_id,
    (SELECT matched_profile_id FROM pg_temp.scoped_expected_review),
    (SELECT resolved_at FROM pg_temp.scoped_expected_review),
    p_request_id, p_reason
  );
$fixture$;

SELECT extensions.ok(to_regclass('plugin_data.csf_scoped_application_imports') IS NOT NULL,
  'scoped import receipts have a durable ledger');
SELECT extensions.ok(NOT has_function_privilege('authenticated',
  'plugin_data.csf_queue_scoped_application_import(uuid,uuid,uuid,uuid,timestamptz,uuid,text)', 'EXECUTE'),
  'members cannot call the scoped import function');
SELECT extensions.ok((
  SELECT position('csf_staff_access_lock_key' IN prosrc) > 0
    AND position('csf_staff_access_lock_key' IN prosrc)
      < position('csf_assert_import_actor_for_job' IN prosrc)
    AND position('csf_assert_import_actor_for_job' IN prosrc)
      < position('csf_lock_import_commit_coordinate' IN prosrc)
  FROM pg_catalog.pg_proc
  WHERE oid = 'plugin_data.csf_queue_scoped_application_import(uuid,uuid,uuid,uuid,timestamptz,uuid,text)'::regprocedure
), 'staff access is locked before authorization and the import coordinate');
SELECT extensions.throws_ok($sql$SELECT pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000002', 'f3890000-0000-4000-8000-000000000001',
  'Unauthorized request')$sql$, '42501', NULL,
  'an outsider cannot queue a resolved application row');
SELECT extensions.throws_ok($sql$SELECT pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000002',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000002',
  'Unresolved sibling')$sql$, '55000', NULL,
  'an unresolved sibling cannot be imported by itself');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_scoped_application_imports), 0,
  'refused attempts do not leave scope receipts');
UPDATE public.organization_members SET status = 'inactive'
WHERE organization_id = 'f3820000-0000-4000-8000-000000000001'
  AND user_id = 'f3810000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($sql$SELECT pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000008',
  'Staff access has been revoked.')$sql$, '42501', NULL,
  'revoked staff cannot create a scoped import');
UPDATE public.organization_members SET status = 'active'
WHERE organization_id = 'f3820000-0000-4000-8000-000000000001'
  AND user_id = 'f3810000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_sheet_import_jobs
SET status = 'failed'
WHERE id = 'f3870000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($sql$SELECT pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000005',
  'Officer checked the preview state.')$sql$, '55000', NULL,
  'a failed preview cannot create a scoped import');
SELECT extensions.is((SELECT import_status FROM plugin_data.csf_sheet_import_rows
  WHERE id = 'f3880000-0000-4000-8000-000000000001'), 'pending',
  'a failed preview does not supersede the reviewed parent');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_scoped_application_imports), 0,
  'a failed preview leaves no scoped receipt');
UPDATE plugin_data.csf_sheet_import_jobs
SET status = 'needs_resolution'
WHERE id = 'f3870000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_sheet_import_rows
SET resolved_at = resolved_at + interval '1 second'
WHERE id = 'f3880000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($sql$SELECT pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000006',
  'This screen has an old reviewed match.')$sql$, '55000', NULL,
  'a changed review timestamp refuses an old officer screen');
UPDATE plugin_data.csf_sheet_import_rows
SET resolved_at = (SELECT resolved_at FROM pg_temp.scoped_expected_review)
WHERE id = 'f3880000-0000-4000-8000-000000000001';
CREATE TEMP TABLE scoped_result (receipt jsonb);
INSERT INTO scoped_result SELECT pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000003',
  'Officer approved just this source response.');
SELECT extensions.is((SELECT receipt ->> 'queued' FROM scoped_result), 'true',
  'the approved row enters the normal queue');
SELECT extensions.is((SELECT receipt ->> 'queueStatus' FROM scoped_result), 'queued',
  'the first receipt records the current queue status');
SELECT extensions.is((SELECT snapshot_row_count FROM plugin_data.csf_sheet_import_jobs
  WHERE id = (SELECT (receipt ->> 'scopedJobId')::uuid FROM scoped_result)), 1,
  'the derived preview has one row');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows
  WHERE job_id = (SELECT (receipt ->> 'scopedJobId')::uuid FROM scoped_result)), 1,
  'the derived preview cannot carry its sibling');
SELECT extensions.is((SELECT import_status FROM plugin_data.csf_sheet_import_rows
  WHERE id = 'f3880000-0000-4000-8000-000000000002'), 'ambiguous',
  'the unresolved sibling retains its review state');
SELECT extensions.is((SELECT import_status FROM plugin_data.csf_sheet_import_rows
  WHERE id = 'f3880000-0000-4000-8000-000000000001'), 'superseded',
  'the selected parent row is marked as scoped');
SELECT extensions.is((SELECT resolution_notes FROM plugin_data.csf_sheet_import_rows
  WHERE id = 'f3880000-0000-4000-8000-000000000001'),
  'Officer verified this fictional response.',
  'scoping preserves the officer match explanation');
SELECT extensions.is((SELECT resolved_by::text FROM plugin_data.csf_sheet_import_rows
  WHERE id = 'f3880000-0000-4000-8000-000000000001'),
  'f3810000-0000-4000-8000-000000000001',
  'scoping preserves the original match reviewer');
SELECT extensions.is((SELECT retry_of_row_id::text FROM plugin_data.csf_sheet_import_rows
  WHERE job_id = (SELECT (receipt ->> 'scopedJobId')::uuid FROM scoped_result)),
  'f3880000-0000-4000-8000-000000000001', 'the selected row retains immutable lineage');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_import_commit_queue
  WHERE preview_job_id = (SELECT (receipt ->> 'scopedJobId')::uuid FROM scoped_result)), 1,
  'exactly one queue item was created');
SELECT extensions.is(cardinality(plugin_data.csf_import_preview_claim_blockers(
  'f3820000-0000-4000-8000-000000000001',
  (SELECT (receipt ->> 'scopedJobId')::uuid FROM scoped_result))), 0,
  'the derived preview passes the normal commit claim evidence shape');
SELECT extensions.is(pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000003',
  'Officer approved just this source response.') ->> 'replayed', 'true',
  'a lost-response retry returns the existing receipt');
SELECT extensions.is(pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000003',
  'Officer approved just this source response.') ->> 'queueStatus', 'queued',
  'a queued replay reports the live queue state');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_scoped_application_imports), 1,
  'a retry does not duplicate scoped imports');
UPDATE plugin_data.csf_sheet_sources
SET drive_modified_at = '2039-09-02T00:00:00Z'
WHERE id = 'f3860000-0000-4000-8000-000000000001';
SELECT extensions.ok(cardinality(plugin_data.csf_import_preview_claim_blockers(
  'f3820000-0000-4000-8000-000000000001',
  (SELECT (receipt ->> 'scopedJobId')::uuid FROM scoped_result))) > 0,
  'a later Sheet revision blocks the worker claim');
SELECT extensions.throws_ok($sql$SELECT pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000003',
  'Officer approved just this source response.')$sql$, '55000', NULL,
  'a queued replay refuses changed source evidence');
UPDATE plugin_data.csf_sheet_sources
SET drive_modified_at = '2039-09-01T00:00:00Z'
WHERE id = 'f3860000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_import_commit_queue
SET status = 'blocked', finished_at = now()
WHERE preview_job_id = (SELECT (receipt ->> 'scopedJobId')::uuid FROM scoped_result);
SELECT extensions.throws_ok($sql$SELECT pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000003',
  'Officer approved just this source response.')$sql$, '55000', NULL,
  'a blocked scoped queue cannot replay success');
UPDATE plugin_data.csf_import_commit_queue
SET status = 'failed'
WHERE preview_job_id = (SELECT (receipt ->> 'scopedJobId')::uuid FROM scoped_result);
SELECT extensions.throws_ok($sql$SELECT pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000003',
  'Officer approved just this source response.')$sql$, '55000', NULL,
  'a failed scoped queue cannot replay success');
UPDATE plugin_data.csf_import_commit_queue
SET status = 'completed', finished_at = now()
WHERE preview_job_id = (SELECT (receipt ->> 'scopedJobId')::uuid FROM scoped_result);
SELECT extensions.is(pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000003',
  'Officer approved just this source response.') ->> 'replayed', 'true',
  'the same request reads its receipt after queue completion');
SELECT extensions.is(pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000003',
  'Officer approved just this source response.') ->> 'queueStatus', 'completed',
  'a completed replay reports completion rather than a pending queue');
SELECT extensions.throws_ok($sql$SELECT plugin_data.csf_queue_scoped_application_import(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3850000-0000-4000-8000-000000000002',
  (SELECT resolved_at FROM pg_temp.scoped_expected_review),
  'f3890000-0000-4000-8000-000000000003',
  'Officer approved just this source response.')$sql$, '55000', NULL,
  'the same request cannot replay with a different displayed profile');
SELECT extensions.throws_ok($sql$SELECT plugin_data.csf_queue_scoped_application_import(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3850000-0000-4000-8000-000000000001',
  (SELECT resolved_at + interval '1 second' FROM pg_temp.scoped_expected_review),
  'f3890000-0000-4000-8000-000000000003',
  'Officer approved just this source response.')$sql$, '55000', NULL,
  'the same request cannot replay with a different review timestamp');
SELECT extensions.throws_ok($sql$SELECT pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000002',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000003',
  'Another row with the same request ID.')$sql$, '55000', NULL,
  'one request ID cannot approve another source row');
SELECT extensions.throws_ok($sql$SELECT pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000004',
  'Different request')$sql$, '55000', NULL,
  'a new request cannot approve the same parent row twice');
UPDATE plugin_data.csf_sheet_sources
SET drive_modified_at = '2039-09-02T00:00:00Z'
WHERE id = 'f3860000-0000-4000-8000-000000000001';
SELECT extensions.ok(cardinality(plugin_data.csf_import_preview_claim_blockers(
  'f3820000-0000-4000-8000-000000000001',
  (SELECT (receipt ->> 'scopedJobId')::uuid FROM scoped_result))) > 0,
  'a later Sheet revision blocks the worker claim');
SELECT extensions.is(pg_temp.queue_scoped_fixture(
  'f3820000-0000-4000-8000-000000000001', 'f3880000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001', 'f3890000-0000-4000-8000-000000000003',
  'Officer approved just this source response.') ->> 'replayed', 'true',
  'a changed Sheet does not erase the existing request receipt');
UPDATE plugin_data.csf_sheet_sources
SET drive_modified_at = '2039-09-01T00:00:00Z'
WHERE id = 'f3860000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_sheet_import_rows
SET import_status = 'pending', resolution_status = 'resolved',
    matched_profile_id = 'f3850000-0000-4000-8000-000000000002',
    resolution_reason_code = 'match',
    resolution_notes = 'Officer verified the other fictional response.',
    resolved_by = 'f3810000-0000-4000-8000-000000000001',
    resolved_at = now()
WHERE id = 'f3880000-0000-4000-8000-000000000002';
SELECT extensions.is(plugin_data.csf_queue_import_preview_batch(
  'f3820000-0000-4000-8000-000000000001',
  'f3810000-0000-4000-8000-000000000001',
  ARRAY['f3870000-0000-4000-8000-000000000001']::uuid[],
  'f3890000-0000-4000-8000-000000000007') ->> 'queued', '1',
  'the parent preview can later queue its remaining resolved sibling');
SELECT extensions.is(cardinality(plugin_data.csf_import_preview_claim_blockers(
  'f3820000-0000-4000-8000-000000000001',
  'f3870000-0000-4000-8000-000000000001')), 0,
  'the superseded row does not block the parent preview claim');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_applications
  WHERE organization_id = 'f3820000-0000-4000-8000-000000000001'), 0,
  'queueing never commits an application before the worker runs');
CREATE TEMP TABLE scoped_purge_result (receipt jsonb);
SELECT pg_catalog.set_config('plugin_data.csf_recovery_purge_organization',
  'f3820000-0000-4000-8000-000000000001', true);
INSERT INTO scoped_purge_result SELECT plugin_data.csf_purge_import_recovery(
  'f3820000-0000-4000-8000-000000000001');
SELECT extensions.is((SELECT receipt ->> 'scopedImportReceipts' FROM scoped_purge_result), '1',
  'import recovery reports the removed scoped receipt');
SELECT extensions.is((SELECT receipt ->> 'importRows' FROM scoped_purge_result), '3',
  'import recovery deletes parent, sibling, and derived rows after the receipt');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_scoped_application_imports
  WHERE organization_id = 'f3820000-0000-4000-8000-000000000001'), 0,
  'organization purge leaves no scoped receipt');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_sheet_import_jobs
  WHERE organization_id = 'f3820000-0000-4000-8000-000000000001'), 0,
  'organization purge clears the referenced import jobs');
SELECT * FROM extensions.finish();
ROLLBACK;
