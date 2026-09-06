BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(61);

-- ACL surface: browser roles must not settle rows.
SELECT has_function(
  'plugin_data', 'csf_apply_import_annotation_interpretation',
  ARRAY['uuid', 'uuid', 'text', 'text', 'uuid'],
  'annotation settlement RPC exists'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_apply_import_annotation_interpretation(uuid, uuid, text, text, uuid)',
    'EXECUTE'
  ),
  'anon cannot settle'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_apply_import_annotation_interpretation(uuid, uuid, text, text, uuid)',
    'EXECUTE'
  ),
  'authenticated cannot settle'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_apply_import_annotation_interpretation(uuid, uuid, text, text, uuid)',
    'EXECUTE'
  ),
  'service_role cannot bypass officer review through the legacy helper'
);

-- Fixture: one org, one actor, one source, one job, three rows.
INSERT INTO auth.users (id, email)
VALUES ('a1a10000-0000-4000-8000-000000000001', 'annotation-actor@local.test');
INSERT INTO public.organizations (id, name, username, type, join_code, created_by)
VALUES ('a1a10000-0000-4000-8000-000000000002', 'Annotation Settlement Org',
        'annotation-settlement-org', 'school', '990001',
        'a1a10000-0000-4000-8000-000000000001');
INSERT INTO public.organization_members (organization_id,user_id,role,status)
VALUES ('a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, title, provider, spreadsheet_id
) VALUES (
  'a1a10000-0000-4000-8000-000000000003',
  'a1a10000-0000-4000-8000-000000000002',
  'Annotation fixture workbook', 'google_sheets', 'annotation-fixture'
);
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_sheet_tab, mapping_version
) VALUES (
  'a1a10000-0000-4000-8000-000000000004',
  'a1a10000-0000-4000-8000-000000000002',
  'a1a10000-0000-4000-8000-000000000003',
  'a1a10000-0000-4000-8000-000000000001',
  'preview', 'needs_resolution', 'class_history', 'S26', 1
);

-- Row 2: the settleable shape -- only the activity-points error, annotated.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, import_status, errors, mapping_version
) VALUES (
  'a1a10000-0000-4000-8000-000000000005',
  'a1a10000-0000-4000-8000-000000000002',
  'a1a10000-0000-4000-8000-000000000004',
  'a1a10000-0000-4000-8000-000000000003',
  'S26', 2, '{}'::jsonb,
  jsonb_build_object(
    'annotations', jsonb_build_object('4', jsonb_build_object('background', '#b7e1cd')),
    'commitPayload', jsonb_build_object('allRequirementsMet', NULL)
  ),
  repeat('a', 64), 'error',
  ARRAY['Activity values without explicit numeric points require officer reconciliation: Activity 1.'],
  1
);
-- Row 3: carries a foreign blocker that must keep blocking.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, import_status, errors, mapping_version
) VALUES (
  'a1a10000-0000-4000-8000-000000000006',
  'a1a10000-0000-4000-8000-000000000002',
  'a1a10000-0000-4000-8000-000000000004',
  'a1a10000-0000-4000-8000-000000000003',
  'S26', 3, '{}'::jsonb,
  jsonb_build_object(
    'annotations', jsonb_build_object('4', jsonb_build_object('background', '#f4c7c3'))
  ),
  repeat('b', 64), 'error',
  ARRAY['Row has an incomplete name.'],
  1
);
-- Row 4: no presentation evidence at all.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, import_status, errors, mapping_version
) VALUES (
  'a1a10000-0000-4000-8000-000000000007',
  'a1a10000-0000-4000-8000-000000000002',
  'a1a10000-0000-4000-8000-000000000004',
  'a1a10000-0000-4000-8000-000000000003',
  'S26', 4, '{}'::jsonb,
  jsonb_build_object('annotations', '{}'::jsonb),
  repeat('c', 64), 'error',
  ARRAY['Activity values without explicit numeric points require officer reconciliation: Activity 1.'],
  1
);

-- Settling the green row clears its error and records the resolution.
SELECT is(
  (plugin_data.csf_review_import_annotation(
    'a1a10000-0000-4000-8000-000000000002',
    'a1a10000-0000-4000-8000-000000000001',
    'a1a10000-0000-4000-8000-000000000005',
    'a1a10000-0000-4000-8000-000000000010',
    'met', 'Officer confirmed the fictional semester completion record.'
  )) ->> 'status',
  'settled',
  'explicit officer decision settles the row'
);
SELECT results_eq(
  $q$SELECT import_status, resolution_status, resolution_reason_code,
        errors = ARRAY[]::text[],
        jsonb_typeof(normalized_data -> 'commitPayload' -> 'allRequirementsMet')
      FROM plugin_data.csf_sheet_import_rows
      WHERE id = 'a1a10000-0000-4000-8000-000000000005'$q$,
  $q$VALUES ('pending'::text, 'resolved'::text, 'annotation_met'::text, true, 'null'::text)$q$,
  'settlement resolves via reason code and leaves evidence immutable'
);
-- The commit path carries the settled outcome as the completion override.
SELECT ok(
  pg_get_functiondef((
    SELECT p.oid FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plugin_data'
      AND p.proname = 'csf_commit_import_row_for_attempt_identity_base'
  )) LIKE '%annotation_met%',
  'commit honors annotation settlement outcomes'
);
SELECT is(
  (plugin_data.csf_apply_import_annotation_interpretation(
    'a1a10000-0000-4000-8000-000000000002',
    'a1a10000-0000-4000-8000-000000000005',
    'met', 'Replay of the same settlement.',
    'a1a10000-0000-4000-8000-000000000001'
  )) ->> 'status',
  'already_settled',
  'settlement is idempotent'
);

-- A row with any other blocker refuses settlement.
SELECT throws_like(
  $q$SELECT plugin_data.csf_apply_import_annotation_interpretation(
    'a1a10000-0000-4000-8000-000000000002',
    'a1a10000-0000-4000-8000-000000000006',
    'not_met', 'Red fill on the whole row.',
    'a1a10000-0000-4000-8000-000000000001'
  )$q$,
  '%non-annotation blocker%',
  'foreign blockers keep blocking'
);
-- A row without presentation evidence refuses settlement.
SELECT throws_like(
  $q$SELECT plugin_data.csf_apply_import_annotation_interpretation(
    'a1a10000-0000-4000-8000-000000000002',
    'a1a10000-0000-4000-8000-000000000007',
    'met', 'No evidence exists for this row.',
    'a1a10000-0000-4000-8000-000000000001'
  )$q$,
  '%no presentation evidence%',
  'evidence is required'
);
-- Outcome vocabulary is closed.
SELECT throws_like(
  $q$SELECT plugin_data.csf_apply_import_annotation_interpretation(
    'a1a10000-0000-4000-8000-000000000002',
    'a1a10000-0000-4000-8000-000000000005',
    'maybe', 'Bad outcome.',
    'a1a10000-0000-4000-8000-000000000001'
  )$q$,
  '%must be met, exception_met, or not_met%',
  'outcome vocabulary is closed'
);
-- A reason is required.
SELECT throws_like(
  $q$SELECT plugin_data.csf_apply_import_annotation_interpretation(
    'a1a10000-0000-4000-8000-000000000002',
    'a1a10000-0000-4000-8000-000000000005',
    'met', ' ',
    'a1a10000-0000-4000-8000-000000000001'
  )$q$,
  '%reason is required%',
  'a reason is required'
);
-- Cross-organization settlement is refused.
SELECT throws_like(
  $q$SELECT plugin_data.csf_apply_import_annotation_interpretation(
    'a1a10000-0000-4000-8000-0000000000ff',
    'a1a10000-0000-4000-8000-000000000005',
    'met', 'Wrong organization.',
    'a1a10000-0000-4000-8000-000000000001'
  )$q$,
  '%not found%',
  'cross-organization settlement is refused'
);

SELECT has_function('plugin_data','csf_review_import_annotation',
  ARRAY['uuid','uuid','uuid','uuid','text','text'],'audited review RPC exists');
SELECT ok(has_function_privilege('service_role','plugin_data.csf_review_import_annotation(uuid,uuid,uuid,uuid,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','plugin_data.csf_review_import_annotation(uuid,uuid,uuid,uuid,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','plugin_data.csf_review_import_annotation(uuid,uuid,uuid,uuid,text,text)','EXECUTE'),
  'only service role can call the officer review boundary');
SELECT is(plugin_data.csf_review_import_annotation(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000001',
  'a1a10000-0000-4000-8000-000000000005','a1a10000-0000-4000-8000-000000000010',
  'met','Officer confirmed the fictional semester completion record.')->>'replayed','true',
  'a lost response replays the same receipt');
SELECT is((SELECT count(*) FROM plugin_data.csf_admin_audit_events
  WHERE organization_id='a1a10000-0000-4000-8000-000000000002' AND action='sheets.annotation_reviewed'),1::bigint,
  'retry creates no duplicate audit event');
SELECT throws_like($q$SELECT plugin_data.csf_review_import_annotation(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000001',
  'a1a10000-0000-4000-8000-000000000005','a1a10000-0000-4000-8000-000000000010',
  'not_met','Officer confirmed the fictional semester completion record.')$q$,
  '%another decision%','same request cannot overwrite its decision');
SELECT throws_like($q$SELECT plugin_data.csf_review_import_annotation(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000001',
  'a1a10000-0000-4000-8000-000000000005','a1a10000-0000-4000-8000-000000000011',
  'not_met','A conflicting second review.')$q$,'%already reviewed%',
  'a second request cannot replace a completed review');
SELECT throws_like($q$SELECT plugin_data.csf_review_import_annotation(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-0000000000ff',
  'a1a10000-0000-4000-8000-000000000006','a1a10000-0000-4000-8000-000000000012',
  'met','Unknown actor cannot review.')$q$,'%not a known user%','unknown actor refused');
SELECT throws_like($q$SELECT plugin_data.csf_review_import_annotation(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000001',
  'a1a10000-0000-4000-8000-000000000006','a1a10000-0000-4000-8000-000000000012',
  'met','Other blockers must remain.')$q$,'%non-annotation blocker%','officer cannot clear identity errors');
SELECT throws_like($q$SELECT plugin_data.csf_review_import_annotation(
  'a1a10000-0000-4000-8000-0000000000ff','a1a10000-0000-4000-8000-000000000001',
  'a1a10000-0000-4000-8000-000000000006','a1a10000-0000-4000-8000-000000000012',
  'met','Wrong organization.')$q$,'%not an active member%','cross-organization review refused');
SELECT throws_like($q$SELECT plugin_data.csf_review_import_annotation(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000001',
  'a1a10000-0000-4000-8000-000000000006','a1a10000-0000-4000-8000-000000000012',
  NULL,'No outcome selected.')$q$,'%Choose an outcome%','null outcome refused');
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES ('a1a10000-0000-4000-8000-000000000020',
  'a1a10000-0000-4000-8000-000000000002',2036,'Class of 2036');
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES ('a1a10000-0000-4000-8000-000000000021',
  'a1a10000-0000-4000-8000-000000000002','Synthetic','Member','synthetic','member');
INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id,profile_id,cohort_id,status)
VALUES ('a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000021',
  'a1a10000-0000-4000-8000-000000000020','active');
INSERT INTO plugin_data.csf_sheet_import_rows (
  id,organization_id,job_id,source_id,cohort_id,sheet_tab_name,row_number,
  raw_data,normalized_data,row_hash,import_status,errors,mapping_version
)
SELECT id,'a1a10000-0000-4000-8000-000000000002',
  'a1a10000-0000-4000-8000-000000000004','a1a10000-0000-4000-8000-000000000003',
  'a1a10000-0000-4000-8000-000000000020','S26',row_number,'{}'::jsonb,
  '{"annotations":{"4":{"background":"#b7e1cd"}},"commitPayload":{"allRequirementsMet":null}}'::jsonb,
  repeat('d',64),'error',ARRAY['Activity values without explicit numeric points require officer reconciliation: Activity 1.'],1
FROM (VALUES ('a1a10000-0000-4000-8000-000000000022'::uuid,5),
             ('a1a10000-0000-4000-8000-000000000023'::uuid,6)) fixture(id,row_number);

SELECT lives_ok($q$SELECT plugin_data.csf_review_import_annotation(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000001',
  'a1a10000-0000-4000-8000-000000000022','a1a10000-0000-4000-8000-000000000024',
  'exception_met','Reviewed the fictional annotation evidence.')$q$,
  'annotation review can precede missing-key identity review');
SELECT lives_ok($q$SELECT plugin_data.csf_reconcile_sheet_import_row(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000022',
  'a1a10000-0000-4000-8000-000000000021','match','Officer verified the fictional identity.',
  'a1a10000-0000-4000-8000-000000000001',NULL,'{"basis":"officer_evidence"}'::jsonb)$q$,
  'identity review remains available after annotation review');
SELECT ok((SELECT matched_profile_id='a1a10000-0000-4000-8000-000000000021'::uuid
  AND resolution_reason_code='annotation_exception_met' AND import_status='pending'
  FROM plugin_data.csf_sheet_import_rows WHERE id='a1a10000-0000-4000-8000-000000000022'),
  'identity review preserves the annotation outcome used by commit');
SELECT lives_ok($q$SELECT plugin_data.csf_reconcile_sheet_import_row(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000023',
  'a1a10000-0000-4000-8000-000000000021','match','Officer verified the fictional identity.',
  'a1a10000-0000-4000-8000-000000000001',NULL,'{"basis":"officer_evidence"}'::jsonb)$q$,
  'identity review can precede annotation review');
SELECT ok((SELECT import_status='error' AND cardinality(errors)=1
  AND resolution_reason_code='matched_existing_profile'
  FROM plugin_data.csf_sheet_import_rows WHERE id='a1a10000-0000-4000-8000-000000000023'),
  'identity review leaves annotation errors blocked until their own decision');
SELECT lives_ok($q$SELECT plugin_data.csf_reconcile_sheet_import_row(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000023',
  'a1a10000-0000-4000-8000-000000000021','match','Officer verified the fictional identity.',
  'a1a10000-0000-4000-8000-000000000001',NULL,'{"basis":"officer_evidence"}'::jsonb)$q$,
  'identity confirmation retries before annotation settlement');
SELECT lives_ok($q$SELECT plugin_data.csf_review_import_annotation(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000001',
  'a1a10000-0000-4000-8000-000000000023','a1a10000-0000-4000-8000-000000000025',
  'not_met','Reviewed the fictional annotation evidence.')$q$,
  'annotation review remains available after identity review');
SELECT ok((SELECT matched_profile_id='a1a10000-0000-4000-8000-000000000021'::uuid
  AND resolution_reason_code='annotation_not_met' AND resolution_metadata->>'basis'='officer_evidence'
  FROM plugin_data.csf_sheet_import_rows WHERE id='a1a10000-0000-4000-8000-000000000023'),
  'annotation review preserves the matched profile and identity evidence');
SELECT is((SELECT count(*) FROM plugin_data.csf_admin_audit_events
  WHERE target_id IN ('a1a10000-0000-4000-8000-000000000022','a1a10000-0000-4000-8000-000000000023')
  AND action IN ('sheets.annotation_reviewed','sheets.row_match_resolved')),4::bigint,
  'both review orders retain separate audit decisions');
SELECT ok((SELECT bool_and(normalized_data=
  '{"annotations":{"4":{"background":"#b7e1cd"}},"commitPayload":{"allRequirementsMet":null}}'::jsonb)
  FROM plugin_data.csf_sheet_import_rows WHERE id IN
  ('a1a10000-0000-4000-8000-000000000022','a1a10000-0000-4000-8000-000000000023')),
  'both review orders preserve immutable source evidence');
SELECT lives_ok($q$SELECT plugin_data.csf_reconcile_sheet_import_row(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000023',
  'a1a10000-0000-4000-8000-000000000021','match','Officer verified the fictional identity.',
  'a1a10000-0000-4000-8000-000000000001',NULL,'{"basis":"officer_evidence"}'::jsonb)$q$,
  'identity replay remains available after annotation review');
SELECT throws_like($q$SELECT plugin_data.csf_review_import_annotation(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000001',
  'a1a10000-0000-4000-8000-000000000023','a1a10000-0000-4000-8000-000000000026',
  'met','Conflicting second annotation review.')$q$,'%already reviewed%',
  'composable review does not allow annotation replacement');
INSERT INTO plugin_data.csf_sheet_import_rows (
  id,organization_id,job_id,source_id,cohort_id,sheet_tab_name,row_number,
  raw_data,normalized_data,row_hash,import_status,errors,mapping_version
) SELECT 'a1a10000-0000-4000-8000-000000000027',organization_id,job_id,source_id,cohort_id,
  sheet_tab_name,7,raw_data,normalized_data,repeat('e',64),'error',
  ARRAY['Activity values without explicit numeric points require officer reconciliation: Activity 1.','Invalid semester.'],1
FROM plugin_data.csf_sheet_import_rows WHERE id='a1a10000-0000-4000-8000-000000000023';
SELECT throws_like($q$SELECT plugin_data.csf_reconcile_sheet_import_row(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000027',
  'a1a10000-0000-4000-8000-000000000021','match','Officer verified the fictional identity.',
  'a1a10000-0000-4000-8000-000000000001',NULL,'{}'::jsonb)$q$,
  '%no longer needs a matching decision%','identity review refuses mixed annotation and unrelated errors');
SELECT ok((SELECT matched_profile_id IS NULL AND import_status='error' AND cardinality(errors)=2
  FROM plugin_data.csf_sheet_import_rows WHERE id='a1a10000-0000-4000-8000-000000000027'),
  'refused identity review preserves all blockers');
-- An approved row stays frozen even when its worker never started an attempt.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id,organization_id,job_id,source_id,cohort_id,sheet_tab_name,row_number,
  raw_data,normalized_data,row_hash,import_status,errors,mapping_version,
  matched_profile_id,commit_frozen_at,commit_frozen_by_job_id,
  commit_frozen_row_hash,commit_frozen_source_id,commit_frozen_payload_hash,
  commit_frozen_actor_snapshot,commit_resolution_snapshot,commit_target_profile_id,
  commit_outcome_state
) SELECT fixture.frozen_id,organization_id,job_id,source_id,
  cohort_id,sheet_tab_name,fixture.frozen_number,raw_data,normalized_data,repeat('f',64),'pending',
  ARRAY[]::text[],1,'a1a10000-0000-4000-8000-000000000021',now(),job_id,
  repeat('f',64),source_id,repeat('f',64),'{}'::jsonb,
  '{"resolutionStatus":"pending"}'::jsonb,
  'a1a10000-0000-4000-8000-000000000021','frozen'
FROM plugin_data.csf_sheet_import_rows
CROSS JOIN (VALUES ('a1a10000-0000-4000-8000-000000000030'::uuid,8),
  ('a1a10000-0000-4000-8000-000000000032'::uuid,9)) fixture(frozen_id,frozen_number)
WHERE id='a1a10000-0000-4000-8000-000000000027';
SELECT throws_like($q$SELECT plugin_data.csf_apply_import_annotation_interpretation(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000032',
  'met','A new decision after approval.',
  'a1a10000-0000-4000-8000-000000000001')$q$,
  '%no longer settleable%','internal annotation helper refuses a frozen unstarted row');
SELECT throws_like($q$SELECT plugin_data.csf_review_import_annotation(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000001',
  'a1a10000-0000-4000-8000-000000000030','a1a10000-0000-4000-8000-000000000031',
  'met','A new decision after approval.')$q$,
  '%already reviewed or approved%','officer review refuses a frozen row without an active queue');
SELECT ok((SELECT resolution_status='pending' AND resolution_reason_code IS NULL
  AND commit_attempt_id IS NULL AND commit_outcome_state='frozen'
  AND commit_resolution_snapshot='{"resolutionStatus":"pending"}'::jsonb
  FROM plugin_data.csf_sheet_import_rows WHERE id='a1a10000-0000-4000-8000-000000000030'),
  'frozen resolution and snapshot remain unchanged');
SELECT is((SELECT count(*) FROM plugin_data.csf_admin_audit_events
  WHERE target_id='a1a10000-0000-4000-8000-000000000030'),0::bigint,
  'refused frozen reviews write no audit receipt');

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id,organization_id,source_id,initiated_by,mode,status,source_type,source_sheet_tab,mapping_version
) SELECT md5('annotation-state-job-'||state)::uuid,
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000003',
  'a1a10000-0000-4000-8000-000000000001','preview',state,'class_history','S26',1
FROM unnest(ARRAY['pending','running','failed','cancelled','completed']) AS state;
INSERT INTO plugin_data.csf_sheet_import_rows (
  id,organization_id,job_id,source_id,sheet_tab_name,row_number,
  raw_data,normalized_data,row_hash,import_status,errors,mapping_version
) SELECT md5('annotation-state-row-'||state)::uuid,
  'a1a10000-0000-4000-8000-000000000002',md5('annotation-state-job-'||state)::uuid,
  'a1a10000-0000-4000-8000-000000000003','S26',2,'{}'::jsonb,
  '{"annotations":{"4":{"background":"#b7e1cd"}}}'::jsonb,
  repeat('a',64),'pending',ARRAY[]::text[],1
FROM unnest(ARRAY['pending','running','failed','cancelled','completed']) AS state;
SELECT throws_like(format($q$SELECT plugin_data.csf_review_import_annotation(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000001',
  %L::uuid,%L::uuid,'met','Review before completed preparation.')$q$,
  md5('annotation-state-row-'||state),md5('annotation-state-request-'||state)),
  '%completed class history preview%',state||' preview refuses annotation review')
FROM unnest(ARRAY['pending','running','failed','cancelled']) AS state;
SELECT is((SELECT count(*) FROM plugin_data.csf_sheet_import_rows
  WHERE job_id IN (SELECT md5('annotation-state-job-'||state)::uuid
    FROM unnest(ARRAY['pending','running','failed','cancelled']) AS state)
  AND resolution_status='pending' AND resolved_at IS NULL),4::bigint,
  'unprepared rows retain their unresolved state');
SELECT lives_ok($q$SELECT plugin_data.csf_review_import_annotation(
  'a1a10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000001',
  md5('annotation-state-row-completed')::uuid,md5('annotation-state-request-completed')::uuid,
  'met','Review after completed preparation.')$q$,
  'completed preview remains reviewable');
INSERT INTO plugin_data.csf_sheet_import_rows (
  id,organization_id,job_id,source_id,cohort_id,sheet_tab_name,row_number,
  raw_data,normalized_data,row_hash,import_status,errors,mapping_version
) SELECT md5('identity-state-row-'||state)::uuid,
  'a1a10000-0000-4000-8000-000000000002',md5('annotation-state-job-'||state)::uuid,
  'a1a10000-0000-4000-8000-000000000003','a1a10000-0000-4000-8000-000000000020',
  'S26',3,'{}'::jsonb,'{}'::jsonb,repeat('b',64),'pending',ARRAY[]::text[],1
FROM unnest(ARRAY['pending','running','failed','cancelled','completed']) AS state;
SELECT throws_like(format($q$SELECT plugin_data.csf_reconcile_sheet_import_row(
  'a1a10000-0000-4000-8000-000000000002',%L::uuid,
  'a1a10000-0000-4000-8000-000000000021','match','Reviewed fictional source identity.',
  'a1a10000-0000-4000-8000-000000000001',NULL,'{}'::jsonb)$q$,
  md5('identity-state-row-'||state)),
  '%%completed preview%%',state||' preview refuses identity review')
FROM unnest(ARRAY['pending','running','failed','cancelled']) AS state;
SELECT is((SELECT count(*) FROM plugin_data.csf_sheet_import_rows
  WHERE id IN (SELECT md5('identity-state-row-'||state)::uuid
    FROM unnest(ARRAY['pending','running','failed','cancelled']) AS state)
  AND matched_profile_id IS NULL AND resolution_status='pending' AND resolved_at IS NULL),4::bigint,
  'unprepared identity rows remain unchanged');
SELECT throws_like(format($q$SELECT plugin_data.csf_reconcile_sheet_import_row(
  'a1a10000-0000-4000-8000-000000000002',%L::uuid,NULL,'skip',
  'Cannot skip a row before preparation settles.',
  'a1a10000-0000-4000-8000-000000000001',NULL,'{}'::jsonb)$q$,
  md5('identity-state-row-'||state)),
  '%%completed preview%%',state||' preview refuses skipping')
FROM unnest(ARRAY['pending','running','failed','cancelled']) AS state;
SELECT is((SELECT count(*) FROM plugin_data.csf_admin_audit_events
  WHERE target_id IN (SELECT md5('identity-state-row-'||state)::uuid
    FROM unnest(ARRAY['pending','running','failed','cancelled']) AS state)),0::bigint,
  'unprepared identity reviews create no audit events');
SELECT lives_ok($q$SELECT plugin_data.csf_reconcile_sheet_import_row(
  'a1a10000-0000-4000-8000-000000000002',md5('identity-state-row-completed')::uuid,
  'a1a10000-0000-4000-8000-000000000021','match','Reviewed fictional source identity.',
  'a1a10000-0000-4000-8000-000000000001',NULL,'{}'::jsonb)$q$,
  'completed preview remains available for identity review');
SELECT lives_ok($q$SELECT plugin_data.csf_reconcile_sheet_import_row(
  'a1a10000-0000-4000-8000-000000000002',md5('identity-state-row-completed')::uuid,
  'a1a10000-0000-4000-8000-000000000021','match','Reviewed fictional source identity.',
  'a1a10000-0000-4000-8000-000000000001',NULL,'{}'::jsonb)$q$,
  'completed identity review retains exact replay');
UPDATE plugin_data.csf_sheet_import_jobs SET status='cancelled'
WHERE id=md5('annotation-state-job-completed')::uuid;
SELECT throws_like($q$SELECT plugin_data.csf_reconcile_sheet_import_row(
  'a1a10000-0000-4000-8000-000000000002',md5('identity-state-row-completed')::uuid,
  'a1a10000-0000-4000-8000-000000000021','match','Reviewed fictional source identity.',
  'a1a10000-0000-4000-8000-000000000001',NULL,'{}'::jsonb)$q$,
  '%completed preview%','identity replay rechecks a cancelled preview');
SELECT is((SELECT count(*) FROM plugin_data.csf_admin_audit_events
  WHERE target_id=md5('identity-state-row-completed')::uuid
    AND action='sheets.row_match_resolved'),1::bigint,
  'exact and refused replays add no identity audit events');
SELECT * FROM finish();
ROLLBACK;
