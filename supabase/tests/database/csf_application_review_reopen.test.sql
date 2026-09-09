BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(24);

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('cf000000-0000-4000-8000-000000000001','authenticated','authenticated','reopen-admin@local.test',now(),'{}','{}',now(),now()),
('cf000000-0000-4000-8000-000000000002','authenticated','authenticated','reopen-member@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES
('cf100000-0000-4000-8000-000000000001','Application reopen fixture','csf-reopen-fixture','school','974931');
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES
('cf100000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001','admin','active'),
('cf100000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000002','member','active');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester) VALUES
('cf200000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','F28','Fall 2028','2028-2029','fall');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label) VALUES
('cf500000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001',2029,'Class of 2029');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name) VALUES
('cf300000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','Fictional','Accepted','fictional','accepted'),
('cf300000-0000-4000-8000-000000000002','cf100000-0000-4000-8000-000000000001','Fictional','Rejected','fictional','rejected');
INSERT INTO plugin_data.csf_term_applications(id,organization_id,profile_id,cohort_id,term_id,source,status,reviewed_by,reviewed_at,review_notes) VALUES
('cf400000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','cf300000-0000-4000-8000-000000000001','cf500000-0000-4000-8000-000000000001','cf200000-0000-4000-8000-000000000001','manual','accepted','cf000000-0000-4000-8000-000000000001','2028-09-01T12:00:00Z','Original approval'),
('cf400000-0000-4000-8000-000000000002','cf100000-0000-4000-8000-000000000001','cf300000-0000-4000-8000-000000000002','cf500000-0000-4000-8000-000000000001','cf200000-0000-4000-8000-000000000001','manual','rejected','cf000000-0000-4000-8000-000000000001','2028-09-01T12:00:00Z','Original rejection');
INSERT INTO plugin_data.csf_review_periods(id,organization_id,term_id,kind,status,title,instructions,opened_by,opened_at,closed_by,closed_at,created_by)
SELECT ('cf600000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'cf100000-0000-4000-8000-000000000001','cf200000-0000-4000-8000-000000000001',kind::plugin_data.csf_review_period_kind,
 'closed',title,'Keep all prior decisions','cf000000-0000-4000-8000-000000000001','2028-09-01T12:00:00Z',
 'cf000000-0000-4000-8000-000000000001','2028-09-02T12:00:00Z','cf000000-0000-4000-8000-000000000001'
FROM (VALUES(1,'membership_applications','Application review'),(2,'member_points','Point review'),(3,'club_audit','Club review')) AS fixtures(n,kind,title);
INSERT INTO plugin_data.csf_review_decisions(organization_id,period_id,subject_kind,subject_id,decision,reason,decided_by,decided_at)
SELECT 'cf100000-0000-4000-8000-000000000001','cf600000-0000-4000-8000-000000000001','application',
 ('cf400000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,decision::plugin_data.csf_review_decision_state,
 'Original evidence reviewed','cf000000-0000-4000-8000-000000000001','2028-09-01T12:00:00Z'
FROM (VALUES(1,'approved'),(2,'rejected')) AS fixtures(n,decision);
INSERT INTO plugin_data.csf_review_assignments(organization_id,period_id,reviewer_user_id,start_index,end_index,from_label,to_label,assigned_by) VALUES
('cf100000-0000-4000-8000-000000000001','cf600000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001',1,2,'Accepted','Rejected','cf000000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_review_notes(organization_id,period_id,subject_kind,subject_id,body,author_user_id) VALUES
('cf100000-0000-4000-8000-000000000001','cf600000-0000-4000-8000-000000000001','application','cf400000-0000-4000-8000-000000000001','Retain officer note','cf000000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_application_private_notes(organization_id,application_id,body,author_user_id) VALUES
('cf100000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000001','Retain private application note','cf000000-0000-4000-8000-000000000001');

CREATE FUNCTION pg_temp.application_review_snapshot() RETURNS jsonb LANGUAGE sql AS $$
SELECT jsonb_build_object(
 'applications',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM plugin_data.csf_term_applications r WHERE organization_id='cf100000-0000-4000-8000-000000000001'),
 'decisions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM plugin_data.csf_review_decisions r WHERE organization_id='cf100000-0000-4000-8000-000000000001'),
 'assignments',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM plugin_data.csf_review_assignments r WHERE organization_id='cf100000-0000-4000-8000-000000000001'),
 'notes',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM plugin_data.csf_review_notes r WHERE organization_id='cf100000-0000-4000-8000-000000000001'),
 'privateNotes',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM plugin_data.csf_application_private_notes r WHERE organization_id='cf100000-0000-4000-8000-000000000001'));
$$;
CREATE TEMP TABLE review_history_snapshot AS SELECT pg_temp.application_review_snapshot() AS history;
CREATE FUNCTION pg_temp.change_review(p_kind text DEFAULT 'membership_applications',p_status text DEFAULT 'open',p_actor uuid DEFAULT 'cf000000-0000-4000-8000-000000000001',p_title text DEFAULT 'Application review') RETURNS jsonb LANGUAGE sql AS $$
SELECT plugin_data.csf_set_review_period('cf100000-0000-4000-8000-000000000001',p_actor,'cf200000-0000-4000-8000-000000000001',p_kind,p_status,p_title,'Keep all prior decisions',NULL,NULL);
$$;

SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_set_review_period(uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz)','EXECUTE'),'anonymous execution remains denied');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_set_review_period(uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz)','EXECUTE'),'browser execution remains denied');
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.csf_set_review_period(uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz)','EXECUTE'),'server execution remains granted');
SELECT extensions.throws_ok($q$SELECT pg_temp.change_review(p_actor=>'cf000000-0000-4000-8000-000000000002')$q$,'42501','Not authorized to manage CSF review periods.','ordinary member cannot reopen review');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_set_review_period('cf100000-0000-4000-8000-000000000002','cf000000-0000-4000-8000-000000000001','cf200000-0000-4000-8000-000000000001','membership_applications','open','Application review')$q$,'42501','Not authorized to manage CSF review periods.','admin cannot reopen another organization');
SELECT extensions.throws_ok($q$SELECT pg_temp.change_review(p_status=>'draft')$q$,'23514','This review period is already closed.','closed application review cannot reset to draft');
SELECT extensions.throws_ok($q$SELECT pg_temp.change_review(p_kind=>'member_points',p_title=>'Point review')$q$,'23514','This review period is already closed.','closed point review remains terminal');
SELECT extensions.throws_ok($q$SELECT pg_temp.change_review(p_kind=>'club_audit',p_title=>'Club review')$q$,'23514','This review period is already closed.','closed club audit remains terminal');
SELECT extensions.lives_ok($q$SELECT pg_temp.change_review()$q$,'authorized staff can reopen application review');
SELECT extensions.ok(EXISTS(SELECT 1 FROM plugin_data.csf_review_periods WHERE id='cf600000-0000-4000-8000-000000000001' AND status='open' AND closed_at IS NULL AND closed_by IS NULL AND opened_at='2028-09-01T12:00:00Z'::timestamptz),'reopening preserves period identity and original opening while clearing closure metadata');
SELECT extensions.is(pg_temp.application_review_snapshot()->'applications',(SELECT history->'applications' FROM review_history_snapshot),'reopening preserves application outcomes byte for byte');
SELECT extensions.is(pg_temp.application_review_snapshot()->'decisions',(SELECT history->'decisions' FROM review_history_snapshot),'reopening preserves review decisions byte for byte');
SELECT extensions.is(pg_temp.application_review_snapshot()->'assignments',(SELECT history->'assignments' FROM review_history_snapshot),'reopening preserves reviewer assignments byte for byte');
SELECT extensions.is(pg_temp.application_review_snapshot()->'notes',(SELECT history->'notes' FROM review_history_snapshot),'reopening preserves officer notes byte for byte');
SELECT extensions.is(pg_temp.application_review_snapshot()->'privateNotes',(SELECT history->'privateNotes' FROM review_history_snapshot),'reopening preserves private application notes byte for byte');
SELECT extensions.ok(EXISTS(SELECT 1 FROM plugin_data.csf_admin_audit_events WHERE organization_id='cf100000-0000-4000-8000-000000000001' AND target_id='cf600000-0000-4000-8000-000000000001' AND action='review_period.reopened' AND actor_user_id='cf000000-0000-4000-8000-000000000001' AND before_data->>'status'='closed' AND after_data->>'status'='open' AND before_data->>'closed_at' IS NOT NULL AND after_data->>'closed_at' IS NULL),'reopening audits the actor and full before and after state');
CREATE TEMP TABLE reopened_snapshot AS SELECT to_jsonb(r) AS row FROM plugin_data.csf_review_periods r WHERE id='cf600000-0000-4000-8000-000000000001';
SELECT extensions.lives_ok($q$SELECT pg_temp.change_review()$q$,'an exact open retry succeeds');
SELECT extensions.is((SELECT to_jsonb(r) FROM plugin_data.csf_review_periods r WHERE id='cf600000-0000-4000-8000-000000000001'),(SELECT row FROM reopened_snapshot),'an exact retry does not rewrite the period');
SELECT extensions.ok((SELECT count(*)=1 FROM plugin_data.csf_admin_audit_events WHERE organization_id='cf100000-0000-4000-8000-000000000001' AND target_id='cf600000-0000-4000-8000-000000000001'),'an exact retry does not duplicate audit');
SELECT extensions.lives_ok($q$SELECT pg_temp.change_review(p_status=>'closed')$q$,'reopened application review can close again');
SELECT extensions.lives_ok($q$SELECT pg_temp.change_review(p_status=>'closed')$q$,'an exact close retry succeeds without reopening');
SELECT extensions.ok((SELECT count(*)=2 FROM plugin_data.csf_admin_audit_events WHERE organization_id='cf100000-0000-4000-8000-000000000001' AND target_id='cf600000-0000-4000-8000-000000000001'),'close retry preserves the two transition audits');
SELECT extensions.throws_ok($q$SELECT pg_temp.change_review(p_status=>'closed',p_title=>'Changed closed title')$q$,'23514','This review period is already closed.','closed metadata cannot be silently rewritten');
SELECT extensions.ok((SELECT prosrc ~ 'csf_staff_access_lock_key[^;]+;[[:space:]]+IF NOT plugin_data.csf_actor_has_permission' FROM pg_proc WHERE oid='plugin_data.csf_set_review_period(uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz)'::regprocedure),'review period permission is rechecked under the shared staff access lock');

SELECT * FROM extensions.finish();
ROLLBACK;
