BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(16);

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('af000000-0000-4000-8000-000000000001','authenticated','authenticated','intake-admin@local.test',now(),'{}','{}',now(),now()),
('af000000-0000-4000-8000-000000000002','authenticated','authenticated','intake-member@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES
('af100000-0000-4000-8000-000000000001','Application intake fixture','csf-intake-fixture','school','850001');
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES
('af100000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000001','admin','active'),
('af100000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000002','member','active');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester) VALUES
('af200000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001','F28','Fall 2028','2028-2029','fall'),
('af200000-0000-4000-8000-000000000002','af100000-0000-4000-8000-000000000001','S29','Spring 2029','2028-2029','spring');
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_terms
    WHERE organization_id = 'af100000-0000-4000-8000-000000000001'
      AND accepts_new_applications
  ),
  'existing and newly created terms fail closed until authorized staff opens intake'
);
UPDATE plugin_data.csf_terms SET is_current = true, lifecycle_status = 'open'
WHERE id = 'af200000-0000-4000-8000-000000000001';
SELECT plugin_data.csf_set_application_intake(
  'af100000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001',true,'af000000-0000-4000-8000-000000000001'
);
UPDATE plugin_data.csf_terms SET is_current = false
WHERE id = 'af200000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_terms SET is_current = true, lifecycle_status = 'open'
WHERE id = 'af200000-0000-4000-8000-000000000002';
SELECT plugin_data.csf_set_application_intake(
  'af100000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000002',true,'af000000-0000-4000-8000-000000000001'
);
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label) VALUES
('af500000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001',2029,'Class of 2029');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name) VALUES
('af300000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001','Existing','Applicant','existing','applicant'),
('af300000-0000-4000-8000-000000000002','af100000-0000-4000-8000-000000000001','Native','Blocked','native','blocked'),
('af300000-0000-4000-8000-000000000003','af100000-0000-4000-8000-000000000001','Imported','Allowed','imported','allowed'),
('af300000-0000-4000-8000-000000000004','af100000-0000-4000-8000-000000000001','Other','Semester','other','semester');
INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status,is_primary,linked_at) VALUES
('af100000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000002','verified',true,now());
INSERT INTO plugin_data.csf_term_applications(id,organization_id,profile_id,cohort_id,term_id,source,status) VALUES
('af400000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000001','af500000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001','native','submitted');
SELECT plugin_data.csf_set_review_period(
  'af100000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000001',
  'af200000-0000-4000-8000-000000000001','membership_applications','open','Fall application review'
);
SELECT plugin_data.csf_set_review_period(
  'af100000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000001',
  'af200000-0000-4000-8000-000000000002','membership_applications','open','Spring application review'
);
SELECT plugin_data.csf_set_review_period(
  'af100000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000001',
  'af200000-0000-4000-8000-000000000002','membership_applications','closed','Spring application review'
);

SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid)','EXECUTE'),'anonymous execution is denied');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid)','EXECUTE'),'browser execution is denied');
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid)','EXECUTE'),'the server role may use the checked RPC');
SELECT extensions.ok(
  position('pg_advisory_xact_lock' IN pg_catalog.pg_get_functiondef('plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid)'::regprocedure)) > 0
    AND position('p_organization_id::text' IN pg_catalog.pg_get_functiondef('plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid)'::regprocedure)) > 0
    AND position('p_term_id::text' IN pg_catalog.pg_get_functiondef('plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid)'::regprocedure)) > 0,
  'the staff switch takes the canonical organization and term lock'
);
SELECT extensions.ok(
  position('pg_advisory_xact_lock' IN pg_catalog.pg_get_functiondef('plugin_data.csf_enforce_new_application_intake()'::regprocedure)) > 0
    AND position('NEW.organization_id::text' IN pg_catalog.pg_get_functiondef('plugin_data.csf_enforce_new_application_intake()'::regprocedure)) > 0
    AND position('NEW.term_id::text' IN pg_catalog.pg_get_functiondef('plugin_data.csf_enforce_new_application_intake()'::regprocedure)) > 0,
  'the native insert guard takes the same canonical organization and term lock'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_set_application_intake('af100000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001',false,'af000000-0000-4000-8000-000000000002')$$,
  '42501','Not authorized to manage CSF application intake.','a member cannot close intake'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_set_application_intake('af100000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001',false,'af000000-0000-4000-8000-000000000001')$$,
  'authorized staff can close intake'
);
SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_term_applications(organization_id,profile_id,cohort_id,term_id,source,status) VALUES('af100000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000002','af500000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001','native','submitted')$$,
  '23514','New applications are closed for this semester.','closure rejects a new native website application'
);
SELECT extensions.lives_ok(
  $$INSERT INTO plugin_data.csf_term_applications(organization_id,profile_id,cohort_id,term_id,source,status) VALUES('af100000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000003','af500000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001','google_form_sheet','submitted')$$,
  'Google Form source sync remains available while website intake is closed'
);
SELECT extensions.lives_ok(
  $$INSERT INTO plugin_data.csf_term_applications(organization_id,profile_id,cohort_id,term_id,source,status) VALUES('af100000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000004','af500000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000002','native','submitted')$$,
  'closing one term does not close new intake for another term'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_submit_application_correction('af100000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001','required_information','Updated application details','{"answer":"corrected"}'::jsonb,'af000000-0000-4000-8000-000000000002')$$,
  'an existing applicant can submit a correction while intake is closed'
);
SELECT extensions.lives_ok(
  format($sql$SELECT plugin_data.csf_record_review_decision('af100000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000001',%L,'application','af400000-0000-4000-8000-000000000001','approved')$sql$,
    (SELECT id FROM plugin_data.csf_review_periods WHERE term_id='af200000-0000-4000-8000-000000000001' AND kind='membership_applications')),
  'officers can record an existing application decision while intake is closed'
);
SELECT extensions.is(
  (SELECT status::text FROM plugin_data.csf_review_periods WHERE term_id='af200000-0000-4000-8000-000000000002' AND kind='membership_applications'),
  'closed','the historical term review remains closed and scoped to its term'
);
SELECT extensions.ok(
  EXISTS(SELECT 1 FROM plugin_data.csf_admin_audit_events WHERE action='application_intake.closed' AND term_id='af200000-0000-4000-8000-000000000001' AND actor_user_id='af000000-0000-4000-8000-000000000001'),
  'the intake change records its actor and term'
);
SELECT extensions.ok(
  (SELECT accepts_new_applications FROM plugin_data.csf_terms WHERE id='af200000-0000-4000-8000-000000000002'),
  'the other term keeps its independent intake state'
);

SELECT * FROM extensions.finish();
ROLLBACK;
