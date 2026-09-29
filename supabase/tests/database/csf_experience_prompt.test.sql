BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ec000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'exception-member@local.test', now(), '{}', '{}', now(), now()),
  ('ec000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'exception-reviewer@local.test', now(), '{}', '{}', now(), now()),
  ('ec000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'exception-processor@local.test', now(), '{}', '{}', now(), now()),
  ('ec000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'exception-other-org@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'ec100000-0000-4000-8000-000000000001',
    'CSF Point Receipt Safety',
    'csf-point-exception-safety',
    'school',
    '998201'
  ),
  (
    'ec100000-0000-4000-8000-000000000002',
    'CSF Point Receipt Other',
    'csf-point-exception-other',
    'school',
    '998202'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000001', 'member', 'active'),
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002', 'staff', 'active'),
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000003', 'staff', 'active'),
  ('ec100000-0000-4000-8000-000000000002', 'ec000000-0000-4000-8000-000000000004', 'admin', 'active');

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, public_title, role_type, is_system
) VALUES
  ('ec200000-0000-4000-8000-000000000001', 'ec100000-0000-4000-8000-000000000001', 'exception-reviewer', 'Receipt reviewer', 'Receipt reviewer', 'custom', false),
  ('ec200000-0000-4000-8000-000000000002', 'ec100000-0000-4000-8000-000000000001', 'exception-processor', 'Receipt processor', 'Receipt processor', 'custom', false);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES
  ('ec100000-0000-4000-8000-000000000001', 'ec200000-0000-4000-8000-000000000001', 'verify_submissions', true),
  ('ec100000-0000-4000-8000-000000000001', 'ec200000-0000-4000-8000-000000000002', 'process_points', true);

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title,
  status, starts_at, ends_at
) VALUES
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002', 'ec200000-0000-4000-8000-000000000001', '2099-2100', 'Receipt reviewer', 'active', current_date - 1, current_date + 30),
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000003', 'ec200000-0000-4000-8000-000000000002', '2099-2100', 'Receipt processor', 'active', current_date - 1, current_date + 30);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  is_current, lifecycle_status
) VALUES (
  'ec300000-0000-4000-8000-000000000001',
  'ec100000-0000-4000-8000-000000000001',
  'F99',
  'Fall 2099',
  '2099-2100',
  'fall',
  true,
  'open'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label, status
) VALUES (
  'ec310000-0000-4000-8000-000000000001',
  'ec100000-0000-4000-8000-000000000001',
  2100,
  'Class of 2100',
  'active'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name, record_status
) VALUES (
  'ec400000-0000-4000-8000-000000000001',
  'ec100000-0000-4000-8000-000000000001',
  'Receipt',
  'Member',
  'exception',
  'member',
  'active'
);

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'ec100000-0000-4000-8000-000000000001',
  'ec400000-0000-4000-8000-000000000001',
  'ec000000-0000-4000-8000-000000000001',
  'verified',
  true
);

INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, status, accepted_at
) VALUES (
  'ec100000-0000-4000-8000-000000000001',
  'ec400000-0000-4000-8000-000000000001',
  'ec300000-0000-4000-8000-000000000001',
  'ec310000-0000-4000-8000-000000000001',
  'accepted',
  now()
);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity,
  outside_volunteering_allowed, published_at
) VALUES (
  'ec100000-0000-4000-8000-000000000001',
  'ec300000-0000-4000-8000-000000000001',
  3,
  false,
  now()
);



CREATE FUNCTION pg_temp.consume_prompt() RETURNS jsonb LANGUAGE sql AS $$
SELECT plugin_data.csf_consume_experience_prompt('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000001');
$$;
SELECT extensions.is(pg_temp.consume_prompt()->>'show','false','zero progress does not prompt');
INSERT INTO plugin_data.csf_opportunities(id,organization_id,term_id,title,body,point_value,point_type,requires_point_submission,evidence_policy,status)
SELECT ('ec500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','Experience fixture '||n,'Fictional activity',CASE WHEN n=4 THEN 2 ELSE 3 END,CASE WHEN n IN (2,3) THEN 'drive' ELSE 'non_drive' END,true,'optional','published' FROM generate_series(1,4) n;
INSERT INTO plugin_data.csf_point_submissions(id,organization_id,profile_id,term_id,opportunity_id,description,claimed_points,point_type,status,source,submitted_by,activity_date)
SELECT ('ec510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ec100000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001',('ec500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Fictional claim',CASE WHEN n=4 THEN 2 ELSE 3 END,CASE WHEN n IN (2,3) THEN 'drive' ELSE 'non_drive' END,CASE WHEN n=4 THEN 'needs_action' ELSE 'submitted' END,'student','ec000000-0000-4000-8000-000000000001',current_date FROM generate_series(1,4) n;
SELECT extensions.is(pg_temp.consume_prompt()->>'show','false','drive cap and changes-requested exclusion prevent an early prompt');
SAVEPOINT awarded_duplicate;
INSERT INTO plugin_data.csf_credit_records(organization_id,profile_id,term_id,opportunity_id,submission_id,points,point_type,source,status)
VALUES('ec100000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001','ec510000-0000-4000-8000-000000000001',3,'non_drive','manual','verified');
SELECT extensions.is(pg_temp.consume_prompt()->>'show','false','awarded credit replaces its submission without double counting');
INSERT INTO plugin_data.csf_credit_records(organization_id,profile_id,term_id,opportunity_id,points,point_type,source,status)
VALUES('ec100000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001',3,'non_drive','manual','verified');
SELECT extensions.is(pg_temp.consume_prompt()->>'show','false','activity cap prevents repeated credit from reaching the goal');
ROLLBACK TO awarded_duplicate;
UPDATE plugin_data.csf_point_submissions SET status='submitted' WHERE id='ec510000-0000-4000-8000-000000000004';
SAVEPOINT unknown_category;
INSERT INTO plugin_data.csf_credit_records(organization_id,profile_id,term_id,points,point_type,source,status,evidence)
VALUES('ec100000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001',1,'non_drive','sheet','verified','{"legacyPointType":"unknown"}');
SELECT extensions.is(pg_temp.consume_prompt()->>'show','false','unknown imported category prevents completion');
ROLLBACK TO unknown_category;
SAVEPOINT historical;
UPDATE plugin_data.csf_terms SET is_current=false WHERE id='ec300000-0000-4000-8000-000000000001';
SELECT extensions.is(pg_temp.consume_prompt()->>'show','false','historical semesters never consume a prompt');
ROLLBACK TO historical;
SAVEPOINT preview;
UPDATE public.organization_members SET role='staff' WHERE organization_id='ec100000-0000-4000-8000-000000000001' AND user_id='ec000000-0000-4000-8000-000000000001';
SELECT extensions.is(pg_temp.consume_prompt()->>'show','false','officer previews do not consume a prompt');
ROLLBACK TO preview;
SELECT extensions.is(pg_temp.consume_prompt()->>'show','true','seven qualifying submitted points prompt once');
SELECT extensions.is((SELECT qualifying_points FROM plugin_data.csf_experience_prompts WHERE profile_id='ec400000-0000-4000-8000-000000000001'),7::numeric,'receipt stores capped qualifying total');
SELECT extensions.is(pg_temp.consume_prompt()->>'show','false','another device cannot consume the same term prompt');
UPDATE plugin_data.csf_point_submissions SET status='withdrawn' WHERE id='ec510000-0000-4000-8000-000000000004';
SELECT extensions.is(pg_temp.consume_prompt()->>'show','false','withdrawal does not reset consumed prompt');
UPDATE plugin_data.csf_point_submissions SET status='submitted' WHERE id='ec510000-0000-4000-8000-000000000004';
SELECT extensions.is(pg_temp.consume_prompt()->>'show','false','regaining the threshold never repeats the prompt');
SELECT extensions.is(plugin_data.csf_save_experience_feedback('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000001',4::smallint,NULL,false)->>'rating','4','consumed prompt accepts an optional rating');
SELECT extensions.is(plugin_data.csf_save_experience_feedback('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000001',NULL,'Easy to submit proof',true)->>'rating','4','comment save preserves star rating');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_save_experience_feedback('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000002',5::smallint,NULL,false)$q$,'42501','Experience prompt is not available.','officer cannot author member feedback');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_consume_experience_prompt(uuid,uuid,uuid)','execute'),'browser cannot consume another identity prompt');
SELECT extensions.ok(NOT has_table_privilege('authenticated','plugin_data.csf_experience_prompts','SELECT'),'private prompt records stay server-only');
SELECT extensions.is((SELECT status FROM plugin_data.csf_term_memberships WHERE profile_id='ec400000-0000-4000-8000-000000000001'),'accepted','submission milestone never changes official standing');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_credit_records WHERE profile_id='ec400000-0000-4000-8000-000000000001'),0,'celebration awards no official credit');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,record_status)
VALUES('ec400000-0000-4000-8000-000000000002','ec100000-0000-4000-8000-000000000001','Receipt','Member','exception','member','active');
UPDATE plugin_data.csf_profiles SET school_email='experience-merge@local.test',normalized_school_email='experience-merge@local.test' WHERE organization_id='ec100000-0000-4000-8000-000000000001';
UPDATE public.organization_members SET role='admin' WHERE organization_id='ec100000-0000-4000-8000-000000000001' AND user_id='ec000000-0000-4000-8000-000000000002';
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_merge_profiles('ec100000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000002','Synthetic merge preserves experience receipt.','ec000000-0000-4000-8000-000000000002','ec990000-0000-4000-8000-000000000001')$q$,'canonical profile merge preserves consumed experience history');
SELECT extensions.is(pg_temp.consume_prompt()->>'show','false','profile merge never repeats the same member term prompt');
SELECT extensions.is(plugin_data.csf_save_experience_feedback('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000001',5::smallint,NULL,false)->>'rating','5','verified owner can update the retained response after profile merge');
SELECT extensions.is((SELECT profile_id FROM plugin_data.csf_experience_prompts WHERE user_id='ec000000-0000-4000-8000-000000000001'),'ec400000-0000-4000-8000-000000000001'::uuid,'prompt receipt keeps its original profile identity');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES('ec100000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000004','member','active');
INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status,is_primary)
VALUES('ec100000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000002','ec000000-0000-4000-8000-000000000004','verified',false);
SELECT extensions.is(plugin_data.csf_consume_experience_prompt('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000004')->>'show','false','another verified account on the merged profile cannot consume its historical prompt again');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_experience_prompts WHERE organization_id='ec100000-0000-4000-8000-000000000001'),1,'profile lineage retains one consumed prompt across linked accounts');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_save_experience_feedback('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000004',1::smallint,NULL,false)$q$,'42501','Experience prompt is not available.','shared profile history does not expose another account response for editing');
SAVEPOINT unlink_feedback;
DELETE FROM plugin_data.csf_profile_accounts WHERE user_id='ec000000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_save_experience_feedback('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000001',1::smallint,NULL,false)$q$,'42501','Experience prompt is not available.','merged history does not bypass current verified ownership');
ROLLBACK TO unlink_feedback;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"role":"authenticated","sub":"ec000000-0000-4000-8000-000000000002"}';
SELECT extensions.is((SELECT count(*)::int FROM public.feedback WHERE purpose='platform_experience'),0,'CSF officers cannot read member platform feedback');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
