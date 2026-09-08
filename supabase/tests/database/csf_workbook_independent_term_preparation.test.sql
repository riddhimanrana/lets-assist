BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(5);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'ce000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'workbook-generation-officer@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
), (
  'ce000000-0000-4000-8000-000000000002',
  'authenticated',
  'authenticated',
  'workbook-generation-checker@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ce100000-0000-4000-8000-000000000001',
  'Workbook Generation Fence',
  'workbook-generation-fence',
  'school',
  '986305'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'ce100000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001',
  'admin',
  'active'
), (
  'ce100000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000002',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'ce200000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  2035,
  'Class of 2035'
);

INSERT INTO plugin_data.csf_class_workbooks (
  id, organization_id, cohort_id, drive_file_id, drive_owner_user_id,
  provider_version, provider_modified_at, discovered_tabs,
  source_candidates, last_checked_at, last_prepared_version, state
) VALUES (
  'ce300000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  'synthetic-generation-file',
  'ce000000-0000-4000-8000-000000000001',
  '701',
  '2026-09-02T00:00:00Z',
  '[{"tabName":"baseline"}]'::jsonb,
  '["synthetic-generation-file"]'::jsonb,
  now(),
  '700',
  'linked'
);


INSERT INTO plugin_data.csf_class_workbook_refresh_jobs
 (id,organization_id,workbook_id,drive_file_id,provider_version,requested_by,status,
  lease_token,lease_expires_at,claimed_owner_user_id,attempt_count,started_at)
VALUES ('ce400000-0000-4000-8000-000000000009','ce100000-0000-4000-8000-000000000001',
 'ce300000-0000-4000-8000-000000000001','synthetic-generation-file','701',
 'ce000000-0000-4000-8000-000000000001','running','ce500000-0000-4000-8000-000000000009',
 now()+interval '5 minutes','ce000000-0000-4000-8000-000000000001',1,now());
SELECT extensions.is(plugin_data.csf_finish_class_workbook_refresh_job(
 'ce400000-0000-4000-8000-000000000009','ce500000-0000-4000-8000-000000000009','completed',
 '[{"tabName":"F24"},{"tabName":"S25"},{"tabName":"F25"},{"tabName":"S26"}]'::jsonb,2,1,1,NULL)->>'status',
 'completed','a finished preparation cycle can retain a term-level review exception');
SELECT extensions.is((SELECT result_counts FROM plugin_data.csf_class_workbook_refresh_jobs
 WHERE id='ce400000-0000-4000-8000-000000000009'),'{"prepared":2,"templates":1,"blocked":1}'::jsonb,
 'the durable worker receipt preserves prepared and blocked counts separately');
SELECT extensions.is((SELECT status FROM plugin_data.csf_class_workbook_refresh_jobs
 WHERE id='ce400000-0000-4000-8000-000000000009'),'completed',
 'the generation remains eligible for independent ready-preview commits');
SELECT extensions.ok((SELECT state='linked' AND last_prepared_version='701'
 FROM plugin_data.csf_class_workbooks WHERE id='ce300000-0000-4000-8000-000000000001'),
 'the exact prepared generation is recorded without deleting the workbook link');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_memberships
 WHERE organization_id='ce100000-0000-4000-8000-000000000001'),0,
 'preparation settlement does not turn imported profiles into active memberships');
SELECT * FROM extensions.finish();
ROLLBACK;
