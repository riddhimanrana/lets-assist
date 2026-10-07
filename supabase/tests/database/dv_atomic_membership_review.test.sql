-- Fictional staff decisions use the same authorization and retry boundary as the UI.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(28);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('db200000-0000-4000-8000-000000000001','authenticated','authenticated','dv-review-staff@local.test',now(),'{}','{}',now(),now()),
('db200000-0000-4000-8000-000000000002','authenticated','authenticated','dv-review-student@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES ('db100000-0000-4000-8000-000000000001','DV review fixture','dv-review-fixture','school','518011');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES ('db100000-0000-4000-8000-000000000001','db200000-0000-4000-8000-000000000001','staff','active'),
('db100000-0000-4000-8000-000000000001','db200000-0000-4000-8000-000000000002','member','active');
INSERT INTO public.organization_plugin_installs(organization_id,plugin_key,installed_version,enabled)
VALUES ('db100000-0000-4000-8000-000000000001','dv-speech-debate','2.0.2',true);
INSERT INTO public.organization_plugin_entitlements(organization_id,plugin_key,status)
VALUES ('db100000-0000-4000-8000-000000000001','dv-speech-debate','active');
INSERT INTO plugin_data.org_seasons(id,organization_id,label,starts_at,ends_at,is_current)
VALUES ('db300000-0000-4000-8000-000000000001','db100000-0000-4000-8000-000000000001','2040-2041','2040-08-01','2041-06-01',true);
SELECT plugin_data.save_dv_membership_application('db100000-0000-4000-8000-000000000001','db200000-0000-4000-8000-000000000002',gen_random_uuid(),
'{"organizationId":"db100000-0000-4000-8000-000000000001","seasonId":"db300000-0000-4000-8000-000000000001","legalName":"Fictional Student","applicationData":{"studentFirstName":"Fictional"},"guardians":[{"fullName":"Fictional Guardian","email":"review-guardian@local.test"}]}'::jsonb,true);
CREATE TEMP TABLE review_fixture_input AS SELECT jsonb_build_object(
  'organizationId',organization_id,'seasonId',season_id,'membershipId',id,
  'expectedStatus',status,'expectedUpdatedAt',updated_at,'status','approved','notes','Reviewed fixture') AS input
  FROM plugin_data.dv_sd_seasonal_memberships WHERE organization_id='db100000-0000-4000-8000-000000000001';
CREATE FUNCTION pg_temp.review_dv(p_changes jsonb DEFAULT '{}',p_request uuid DEFAULT gen_random_uuid(),
  p_actor uuid DEFAULT 'db200000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
  SELECT plugin_data.review_dv_membership_application('db100000-0000-4000-8000-000000000001',p_actor,p_request,input || p_changes)
    FROM review_fixture_input;
$$;
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.review_dv_membership_application(uuid,uuid,uuid,jsonb)','EXECUTE'),'anon cannot review');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.review_dv_membership_application(uuid,uuid,uuid,jsonb)','EXECUTE'),'browser cannot review directly');
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.review_dv_membership_application(uuid,uuid,uuid,jsonb)','EXECUTE'),'checked server can review');
SELECT extensions.throws_ok($$SELECT pg_temp.review_dv('{}',gen_random_uuid(),'db200000-0000-4000-8000-000000000002')$$,'42501','Active organization staff access required.','member cannot approve themself');
SELECT extensions.throws_ok($$SELECT pg_temp.review_dv('{"membershipId":"db500000-0000-4000-8000-000000000099"}')$$,'42501','Membership does not belong to this organization and season.','out-of-scope membership refused');
SELECT extensions.throws_ok($$SELECT pg_temp.review_dv('{"expectedUpdatedAt":"2000-01-01T00:00:00Z"}')$$,'PT409','Membership changed. Reload before reviewing.','old timestamp refused');
SELECT extensions.throws_ok($$SELECT pg_temp.review_dv('{"expectedStatus":"approved"}')$$,'PT409','Membership changed. Reload before reviewing.','old status refused');
UPDATE plugin_data.dv_sd_seasonal_memberships SET status='draft' WHERE organization_id='db100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.review_dv('{"expectedStatus":"draft"}')$$,'55000','A draft must be submitted before staff review.','unsubmitted draft refused');
UPDATE plugin_data.dv_sd_seasonal_memberships SET status='submitted' WHERE organization_id='db100000-0000-4000-8000-000000000001';
UPDATE plugin_data.org_seasons SET is_current=false WHERE id='db300000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.review_dv()$$,'55000','Historical memberships require a separate correction workflow.','normal decisions cannot change historical records');
UPDATE plugin_data.org_seasons SET is_current=true WHERE id='db300000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.dv_sd_membership_requirements(membership_id,requirement_type,status)
SELECT id,'receipt','missing' FROM plugin_data.dv_sd_seasonal_memberships WHERE organization_id='db100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.review_dv()$$,'55000','Outstanding membership requirements must be verified or waived.','missing requirement blocks approval');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.dv_sd_membership_requirements r JOIN plugin_data.dv_sd_seasonal_memberships m ON m.id=r.membership_id WHERE m.organization_id='db100000-0000-4000-8000-000000000001' AND r.requirement_type='staff_review'),0,'refused approval creates no staff review');
UPDATE plugin_data.dv_sd_membership_requirements SET status='waived' WHERE membership_id=(SELECT (input->>'membershipId')::uuid FROM review_fixture_input);
SELECT extensions.is(pg_temp.review_dv('{}','db400000-0000-4000-8000-000000000001')->>'status','approved','waived requirement permits explicit approval');
SELECT extensions.is((SELECT r.status FROM plugin_data.dv_sd_membership_requirements r WHERE membership_id=(SELECT (input->>'membershipId')::uuid FROM review_fixture_input) AND requirement_type='staff_review'),'verified','approval records staff verification');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.dv_sd_audit_events WHERE organization_id='db100000-0000-4000-8000-000000000001' AND action='membership.approved'),1,'approval commits one audit');
SELECT extensions.is(pg_temp.review_dv('{}','db400000-0000-4000-8000-000000000001')->>'status','approved','same request is acknowledged after revision changes');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.dv_sd_audit_events WHERE organization_id='db100000-0000-4000-8000-000000000001' AND action='membership.approved'),1,'retry does not duplicate audit');
SELECT extensions.throws_ok($$SELECT pg_temp.review_dv('{"notes":"Different decision text"}','db400000-0000-4000-8000-000000000001')$$,'22023','Request ID was already used for different membership data.','request key cannot hide changed notes');
SELECT extensions.throws_ok($$SELECT pg_temp.review_dv('{"status":"needs_action"}')$$,'PT409','Membership changed. Reload before reviewing.','another decision must reload the changed record');

UPDATE plugin_data.dv_sd_seasonal_memberships SET status='submitted',updated_at=clock_timestamp() WHERE organization_id='db100000-0000-4000-8000-000000000001';
UPDATE review_fixture_input SET input=input || (SELECT jsonb_build_object('expectedStatus',status,'expectedUpdatedAt',updated_at) FROM plugin_data.dv_sd_seasonal_memberships WHERE organization_id='db100000-0000-4000-8000-000000000001');
UPDATE plugin_data.dv_sd_membership_requirements SET status='missing' WHERE membership_id=(SELECT (input->>'membershipId')::uuid FROM review_fixture_input) AND requirement_type='staff_review';
CREATE FUNCTION pg_temp.reject_dv_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Synthetic review audit failure'; END;
$$;
CREATE TRIGGER dv_review_fixture_audit_failure BEFORE INSERT ON plugin_data.dv_sd_audit_events
FOR EACH ROW WHEN (NEW.organization_id='db100000-0000-4000-8000-000000000001') EXECUTE FUNCTION pg_temp.reject_dv_review_audit();
SELECT extensions.throws_ok($$SELECT pg_temp.review_dv()$$,'P0001','Synthetic review audit failure','audit failure aborts approval');
SELECT extensions.is((SELECT status FROM plugin_data.dv_sd_seasonal_memberships WHERE organization_id='db100000-0000-4000-8000-000000000001'),'submitted','failed audit restores membership state');
SELECT extensions.is((SELECT r.status FROM plugin_data.dv_sd_membership_requirements r WHERE membership_id=(SELECT (input->>'membershipId')::uuid FROM review_fixture_input) AND requirement_type='staff_review'),'missing','failed audit restores staff requirement');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.dv_sd_membership_write_receipts WHERE organization_id='db100000-0000-4000-8000-000000000001' AND actor_user_id='db200000-0000-4000-8000-000000000001'),1,'failed decision has no retry receipt');
DROP TRIGGER dv_review_fixture_audit_failure ON plugin_data.dv_sd_audit_events;
SELECT extensions.is(pg_temp.review_dv('{"status":"needs_action","notes":"Correct the guardian name"}')->>'status','needs_action','staff can return the canonical application for correction');
SELECT extensions.is((SELECT review_notes FROM plugin_data.dv_sd_seasonal_memberships WHERE organization_id='db100000-0000-4000-8000-000000000001'),'Correct the guardian name','student correction notes persist with status');
UPDATE public.organization_members SET status='inactive' WHERE user_id='db200000-0000-4000-8000-000000000001' AND organization_id='db100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.review_dv()$$,'42501','Active organization staff access required.','revoked staff cannot replay or change decisions');
UPDATE public.organization_members SET status='active' WHERE user_id='db200000-0000-4000-8000-000000000001' AND organization_id='db100000-0000-4000-8000-000000000001';
UPDATE public.organization_plugin_installs SET enabled=false WHERE organization_id='db100000-0000-4000-8000-000000000001' AND plugin_key='dv-speech-debate';
SELECT extensions.throws_ok($$SELECT pg_temp.review_dv()$$,'42501','DV plugin access is unavailable.','disabled plugin refuses decisions');
UPDATE public.organization_plugin_installs SET enabled=true WHERE organization_id='db100000-0000-4000-8000-000000000001' AND plugin_key='dv-speech-debate';
INSERT INTO private.plugin_control_plane_transition_locks(organization_id,plugin_key,lock_token,acquired_at,expires_at)
VALUES ('db100000-0000-4000-8000-000000000001','dv-speech-debate',gen_random_uuid(),now(),now()+interval '5 minutes');
SELECT extensions.throws_ok($$SELECT pg_temp.review_dv()$$,'PT409','DV plugin transition is in progress.','plugin transition refuses decisions');
DELETE FROM private.plugin_control_plane_transition_locks WHERE organization_id='db100000-0000-4000-8000-000000000001';
INSERT INTO app_private.account_deletion_operations(target_user_id,requested_by,mode,phase)
VALUES ('db200000-0000-4000-8000-000000000001','db200000-0000-4000-8000-000000000001','self_delete','database_pending');
SELECT extensions.throws_ok($$SELECT pg_temp.review_dv()$$,'42501','Account is not available for membership changes.','pending deletion refuses staff writes');
SELECT * FROM extensions.finish();
ROLLBACK;
