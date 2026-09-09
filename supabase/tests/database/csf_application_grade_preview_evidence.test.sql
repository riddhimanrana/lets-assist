BEGIN;
SELECT no_plan();

INSERT INTO auth.users(id,email)
VALUES ('a9a90000-0000-4000-8000-000000000001','grade-envelope@local.test');
INSERT INTO public.organizations(id,name,username,type,join_code,created_by)
VALUES ('a9a90000-0000-4000-8000-000000000002','Grade evidence fixture',
  'grade-evidence-fixture','school','990009','a9a90000-0000-4000-8000-000000000001');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES ('a9a90000-0000-4000-8000-000000000002','a9a90000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_sheet_sources(id,organization_id,title,provider,spreadsheet_id,source_type)
VALUES ('a9a90000-0000-4000-8000-000000000003','a9a90000-0000-4000-8000-000000000002',
  'Fictional grade responses','google_sheets','fictional-grade-evidence','application_responses');
INSERT INTO plugin_data.csf_sheet_import_jobs
  (id,organization_id,source_id,initiated_by,mode,status,source_type,source_sheet_tab,mapping_version)
VALUES ('a9a90000-0000-4000-8000-000000000004','a9a90000-0000-4000-8000-000000000002',
  'a9a90000-0000-4000-8000-000000000003','a9a90000-0000-4000-8000-000000000001',
  'preview','running','application_responses','Responses',1);

CREATE TEMP TABLE grade_rows AS
SELECT grade, jsonb_build_object(
  'sheet_tab_name','Responses','row_number',grade-7,'import_status','ambiguous',
  'normalized_data',jsonb_build_object(
    'contractVersion','csf-normalized-import/v1','sourceType','application_responses',
    'record',jsonb_build_object(
      'identity',jsonb_build_object('firstName','Fictional','lastName','Grade',
        'normalizedFirstName','fictional','normalizedLastName','grade'),
      'cohort',jsonb_build_object('gradeLevel',grade)
    ),
    'applicationGradeEvidence',jsonb_build_object('basis','date_formatted_numeric_grade',
      'columnNumber',7,'display','1/' || grade::text || '/1900','value',grade)
  )
) AS payload FROM generate_series(9,12) grade;

SELECT lives_ok(format($sql$SELECT plugin_data.csf_append_import_preview_rows(
  'a9a90000-0000-4000-8000-000000000002','a9a90000-0000-4000-8000-000000000001',
  'a9a90000-0000-4000-8000-000000000004',jsonb_build_array(%L::jsonb))$sql$,payload),
  'mapped numeric grade ' || grade || ' crosses the actual preview RPC') FROM grade_rows;

SELECT is((SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows
  WHERE job_id='a9a90000-0000-4000-8000-000000000004'
    AND normalized_data #> '{applicationGradeEvidence,value}' = normalized_data #> '{record,cohort,gradeLevel}'),
  4,'all mapped grade evidence agrees with the canonical recorded grade');
SELECT is((SELECT count(*)::integer FROM plugin_data.csf_term_applications
  WHERE organization_id='a9a90000-0000-4000-8000-000000000002'),0,
  'retaining grade evidence does not import or approve an application');

CREATE TEMP TABLE invalid_grade_evidence(label,evidence) AS VALUES
  ('missing evidence fields','{}'::jsonb),
  ('unknown field','{"basis":"date_formatted_numeric_grade","columnNumber":7,"display":"1/9/1900","value":9,"extra":"discarded"}'::jsonb),
  ('text instead of number','{"basis":"date_formatted_numeric_grade","columnNumber":7,"display":"1/9/1900","value":"9"}'::jsonb),
  ('out of range grade','{"basis":"date_formatted_numeric_grade","columnNumber":7,"display":"1/13/1900","value":13}'::jsonb),
  ('disagreeing grade','{"basis":"date_formatted_numeric_grade","columnNumber":7,"display":"1/10/1900","value":10}'::jsonb),
  ('unbounded column','{"basis":"date_formatted_numeric_grade","columnNumber":1000,"display":"1/9/1900","value":9}'::jsonb),
  ('blank provider display','{"basis":"date_formatted_numeric_grade","columnNumber":7,"display":" ","value":9}'::jsonb);

SELECT throws_ok(format($sql$SELECT plugin_data.csf_append_import_preview_rows(
  'a9a90000-0000-4000-8000-000000000002','a9a90000-0000-4000-8000-000000000001',
  'a9a90000-0000-4000-8000-000000000004',jsonb_build_array(%L::jsonb))$sql$,
  jsonb_set(g.payload || '{"row_number":20}'::jsonb,'{normalized_data,applicationGradeEvidence}',bad.evidence)),
  '23514','Mapped grade evidence must contain a bounded column, provider display, and the recorded grade from 9 to 12.',
  bad.label || ' is refused')
FROM invalid_grade_evidence bad CROSS JOIN grade_rows g WHERE g.grade=9;

SELECT lives_ok(format($sql$SELECT plugin_data.csf_append_import_preview_rows(
  'a9a90000-0000-4000-8000-000000000002','a9a90000-0000-4000-8000-000000000001',
  'a9a90000-0000-4000-8000-000000000004',jsonb_build_array(%L::jsonb))$sql$,payload),
  'identical numeric evidence replay is idempotent') FROM grade_rows WHERE grade=9;
SELECT is((SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows
  WHERE job_id='a9a90000-0000-4000-8000-000000000004'),4,
  'refusals and replay create no extra preview rows');
SELECT ok(NOT has_function_privilege('authenticated',
  'plugin_data.csf_append_import_preview_rows(uuid,uuid,uuid,jsonb)','EXECUTE'),
  'members cannot write grade evidence');
SELECT * FROM finish();
ROLLBACK;
