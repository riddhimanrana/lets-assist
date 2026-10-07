BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(29);
DELETE FROM app_private.project_schedule_health;
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
VALUES ('fc900000-0000-4000-8000-000000000001','authenticated','authenticated','schedule-owner@local.test','{}','{}'),
 ('fc900000-0000-4000-8000-000000000002','authenticated','authenticated','schedule-admin@local.test','{"is_super_admin":true}','{}'),
 ('fc900000-0000-4000-8000-000000000003','authenticated','authenticated','schedule-spoof@local.test','{}','{"is_super_admin":true}');
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone,workflow_status)
VALUES
 ('fc910000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000001','Incomplete draft','Local','Synthetic','oneTime','manual','{}','upcoming','UTC','draft'),
 ('fc910000-0000-4000-8000-000000000002','fc900000-0000-4000-8000-000000000001','One time','Local','Synthetic','oneTime','manual','{"oneTime":{"date":"2020-01-01","startTime":"09:00","endTime":"10:00"}}','upcoming','UTC','draft'),
 ('fc910000-0000-4000-8000-000000000003','fc900000-0000-4000-8000-000000000001','Multiple days','Local','Synthetic','multiDay','manual','{"multiDay":[{"date":"2020-01-01","slots":[{"startTime":"09:00","endTime":"10:00"}]}]}','upcoming','UTC','draft'),
 ('fc910000-0000-4000-8000-000000000004','fc900000-0000-4000-8000-000000000001','Multiple roles','Local','Synthetic','sameDayMultiArea','manual','{"sameDayMultiArea":{"date":"2020-01-01","overallStart":"09:00","overallEnd":"10:00","roles":[{"startTime":"09:15","endTime":"09:45"}]}}','upcoming','UTC','draft');
ALTER TABLE public.projects DISABLE TRIGGER validate_published_project_schedule;
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone,workflow_status)
VALUES ('fc910000-0000-4000-8000-000000000005','fc900000-0000-4000-8000-000000000001','Legacy invalid','Local','Synthetic','oneTime','manual','{}','upcoming','UTC','published');
ALTER TABLE public.projects ENABLE TRIGGER validate_published_project_schedule;
SELECT extensions.ok(NOT has_table_privilege('authenticated','app_private.project_schedule_health','SELECT')
 AND NOT has_table_privilege('anon','app_private.project_schedule_health','SELECT'),'health state is not browser-readable');
SELECT extensions.ok(has_function_privilege('service_role','public.get_project_schedule_health(uuid,integer)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.get_project_schedule_health(uuid,integer)','EXECUTE')
 AND NOT has_function_privilege('anon','public.get_project_schedule_health(uuid,integer)','EXECUTE'),'health projection has explicit service-only execution');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.get_project_schedule_health('fc900000-0000-4000-8000-000000000001')$$,
 '42501','Super admin access required.','a normal actor cannot read the service projection');
SELECT extensions.throws_ok($$SELECT public.get_project_schedule_health('fc900000-0000-4000-8000-000000000003')$$,
 '42501','Super admin access required.','user metadata cannot grant health access');
SELECT extensions.throws_ok($$SELECT public.get_project_schedule_health('fc900000-0000-4000-8000-000000000002',101)$$,
 '22023','Schedule health limit must be between 1 and 100.','health correction lists are bounded');
SELECT extensions.is(public.get_project_schedule_health('fc900000-0000-4000-8000-000000000002')->'last_run',
 'null'::jsonb,'no recorded run differs from a zero backlog');
SELECT extensions.ok((public.get_project_schedule_health('fc900000-0000-4000-8000-000000000002')->>'invalid_count')::bigint >= 1,
 'the live backlog includes invalid legacy rows before the worker runs');
SELECT extensions.is(jsonb_array_length(public.get_project_schedule_health('fc900000-0000-4000-8000-000000000002',1)->'projects'),
 1,'the correction list obeys its exact bound');
SELECT extensions.throws_ok($$UPDATE public.projects SET workflow_status='published' WHERE id='fc910000-0000-4000-8000-000000000001'$$,
 '23514','Published projects require a valid schedule and timezone.','incomplete drafts cannot publish');
SELECT extensions.throws_ok($$UPDATE public.projects SET workflow_status=NULL WHERE id='fc910000-0000-4000-8000-000000000001'$$,
 '23514','Published projects require a valid schedule and timezone.','legacy null publication cannot bypass validation');
SELECT extensions.lives_ok($$UPDATE public.projects SET workflow_status='published' WHERE id IN
 ('fc910000-0000-4000-8000-000000000002','fc910000-0000-4000-8000-000000000003','fc910000-0000-4000-8000-000000000004')$$,
 'all three supported schedule shapes can publish');
SELECT extensions.throws_ok($$INSERT INTO public.projects(creator_id,title,location,description,event_type,verification_method,schedule,status,workflow_status)
 VALUES('fc900000-0000-4000-8000-000000000001','Invalid insert','Local','Synthetic','oneTime','manual','{}','upcoming','published')$$,
 '23514','Published projects require a valid schedule and timezone.','new invalid published projects are refused');
SELECT extensions.throws_ok($$UPDATE public.projects SET schedule='{}' WHERE id='fc910000-0000-4000-8000-000000000002'$$,
 '23514','Published projects require a valid schedule and timezone.','published schedule edits cannot introduce an invalid shape');
SELECT extensions.throws_ok($$UPDATE public.projects SET project_timezone='Invalid/Zone' WHERE id='fc910000-0000-4000-8000-000000000002'$$,
 '22023','projects.project_timezone must be a valid IANA timezone','published timezone edits are validated');
SELECT extensions.throws_ok($$UPDATE public.projects SET event_type='multiDay' WHERE id='fc910000-0000-4000-8000-000000000002'$$,
 '23514','Published projects require a valid schedule and timezone.','published event-type edits require a matching schedule');
SELECT extensions.throws_ok($$UPDATE public.projects SET schedule='{"multiDay":[{"date":"2020-01-01","slots":[]}]}' WHERE id='fc910000-0000-4000-8000-000000000003'$$,
 '23514','Published projects require a valid schedule and timezone.','empty multi-day slots cannot be published');
SELECT extensions.throws_ok($$UPDATE public.projects SET schedule='{"sameDayMultiArea":{"date":"2020-01-01","overallStart":"09:00","overallEnd":"10:00","roles":[{"startTime":"08:00","endTime":"09:45"}]}}' WHERE id='fc910000-0000-4000-8000-000000000004'$$,
 '23514','Published projects require a valid schedule and timezone.','roles outside the overall window cannot be published');
SELECT extensions.lives_ok($$UPDATE public.projects SET title='Legacy organizer correction pending' WHERE id='fc910000-0000-4000-8000-000000000005'$$,
 'legacy invalid schedules allow unrelated edits');
SELECT extensions.lives_ok($$SELECT public.process_projects()$$,'invalid schedules do not abort valid project maintenance');
SELECT extensions.is((SELECT count(*) FROM public.projects WHERE id IN ('fc910000-0000-4000-8000-000000000002','fc910000-0000-4000-8000-000000000003','fc910000-0000-4000-8000-000000000004') AND status='completed'),
 3::bigint,'maintenance completes valid projects of every supported shape');
SELECT extensions.is((SELECT status FROM public.projects WHERE id='fc910000-0000-4000-8000-000000000005'),
 'upcoming','maintenance preserves the unresolved legacy row');
SELECT extensions.ok((SELECT invalid_count>=1 AND length(fingerprint)=32 AND checked_at IS NOT NULL FROM app_private.project_schedule_health),
 'maintenance records a count, opaque fingerprint, and check time');
RESET ROLE;
CREATE TEMP TABLE prior_schedule_health AS SELECT * FROM app_private.project_schedule_health;
UPDATE app_private.project_schedule_health SET checked_at=checked_at-interval '1 hour';
SET LOCAL ROLE service_role;
SELECT public.process_projects();
RESET ROLE;
SELECT extensions.is((SELECT changed_at FROM app_private.project_schedule_health),(SELECT changed_at FROM prior_schedule_health),
 'unchanged backlog does not create a new change event');
SELECT extensions.is((SELECT fingerprint FROM app_private.project_schedule_health),(SELECT fingerprint FROM prior_schedule_health),
 'unchanged backlog keeps its fingerprint');
SELECT extensions.ok((SELECT h.checked_at>prior.checked_at-interval '1 hour' FROM app_private.project_schedule_health h,prior_schedule_health prior),
 'unchanged backlog still records worker liveness');
SET LOCAL ROLE service_role;
UPDATE public.projects SET schedule='{"oneTime":{"date":"2020-01-01","startTime":"09:00","endTime":"10:00"}}'
 WHERE id='fc910000-0000-4000-8000-000000000005';
SELECT public.process_projects();
RESET ROLE;
SELECT extensions.is((SELECT invalid_count FROM app_private.project_schedule_health),(SELECT invalid_count-1 FROM prior_schedule_health),
 'verified schedule correction removes exactly its backlog entry');
SELECT extensions.is((SELECT status FROM public.projects WHERE id='fc910000-0000-4000-8000-000000000005'),
 'completed','a corrected legacy project resumes status maintenance');
SELECT extensions.ok((SELECT h.fingerprint<>prior.fingerprint AND h.changed_at>=prior.changed_at FROM app_private.project_schedule_health h,prior_schedule_health prior),
 'a changed backlog gets a new fingerprint and change timestamp');
INSERT INTO app_private.account_deletion_operations(target_user_id,requested_by,mode,delete_projects,phase)
 VALUES('fc900000-0000-4000-8000-000000000002','fc900000-0000-4000-8000-000000000002','self_delete',true,'external_pending');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.get_project_schedule_health('fc900000-0000-4000-8000-000000000002')$$,
 '42501','Super admin access required.','a pending-deletion administrator cannot read the projection');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
