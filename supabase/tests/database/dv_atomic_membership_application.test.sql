-- Fictional membership writes, correction refusals, and retry evidence.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(30);

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('da200000-0000-4000-8000-000000000001','authenticated','authenticated','dv-atomic@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES ('da100000-0000-4000-8000-000000000001','DV atomic fixture','dv-atomic-fixture','school','518001'),
('da100000-0000-4000-8000-000000000002','Other DV atomic fixture','other-dv-atomic-fixture','school','518002');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES ('da100000-0000-4000-8000-000000000001','da200000-0000-4000-8000-000000000001','member','active');
INSERT INTO public.organization_plugin_installs(organization_id,plugin_key,installed_version,enabled)
VALUES ('da100000-0000-4000-8000-000000000001','dv-speech-debate','2.0.2',true);
INSERT INTO public.organization_plugin_entitlements(organization_id,plugin_key,status)
VALUES ('da100000-0000-4000-8000-000000000001','dv-speech-debate','active');
INSERT INTO plugin_data.org_seasons(id,organization_id,label,starts_at,ends_at,is_current)
VALUES ('da300000-0000-4000-8000-000000000001','da100000-0000-4000-8000-000000000001','2040-2041','2040-08-01','2041-06-01',true),
('da300000-0000-4000-8000-000000000002','da100000-0000-4000-8000-000000000002','2040-2041','2040-08-01','2041-06-01',true);

CREATE FUNCTION pg_temp.apply_dv(p_changes jsonb DEFAULT '{}', p_submit boolean DEFAULT false,
  p_request uuid DEFAULT gen_random_uuid()) RETURNS jsonb LANGUAGE sql AS $$
  SELECT plugin_data.save_dv_membership_application(
    'da100000-0000-4000-8000-000000000001','da200000-0000-4000-8000-000000000001',p_request,
    '{"organizationId":"da100000-0000-4000-8000-000000000001","seasonId":"da300000-0000-4000-8000-000000000001",
      "legalName":"Fictional Student","applicationData":{"studentFirstName":"Fictional"},
      "guardians":[{"fullName":"Fictional Guardian","email":"guardian@local.test","isPrimaryContact":true}]}'::jsonb || p_changes,p_submit);
$$;

SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.save_dv_membership_application(uuid,uuid,uuid,jsonb,boolean)','EXECUTE'),'anon cannot execute');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.save_dv_membership_application(uuid,uuid,uuid,jsonb,boolean)','EXECUTE'),'authenticated cannot execute');
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.save_dv_membership_application(uuid,uuid,uuid,jsonb,boolean)','EXECUTE'),'service role can execute');
SELECT extensions.ok(NOT has_table_privilege('authenticated','plugin_data.dv_sd_membership_write_receipts','SELECT'),'browser cannot read retry receipts');
SELECT extensions.throws_ok($$SELECT pg_temp.apply_dv('{"seasonId":"da300000-0000-4000-8000-000000000002"}')$$,'22023','Applications require the current organization season.','cross-tenant season refused');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.dv_sd_students WHERE organization_id='da100000-0000-4000-8000-000000000001'),0,'refused season creates no student');
SELECT extensions.is(pg_temp.apply_dv('{}',false,'da400000-0000-4000-8000-000000000001')->>'status','draft','save creates draft');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.dv_sd_audit_events WHERE organization_id='da100000-0000-4000-8000-000000000001'),1,'save commits one audit event');
SELECT extensions.is(pg_temp.apply_dv('{}',false,'da400000-0000-4000-8000-000000000001')->>'status','draft','same retry returns original result');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.dv_sd_audit_events WHERE organization_id='da100000-0000-4000-8000-000000000001'),1,'same retry creates no duplicate audit');
SELECT extensions.throws_ok($$SELECT pg_temp.apply_dv('{"legalName":"Different"}',false,'da400000-0000-4000-8000-000000000001')$$,'22023','Request ID was already used for different membership data.','retry key cannot hide a changed payload');
SELECT extensions.throws_ok($$SELECT pg_temp.apply_dv('{"legalName":"Invalid guardian edit","guardians":[{"fullName":"Missing email"}]}')$$,'22023','Invalid guardian contact.','late validation error refuses save');
SELECT extensions.is((SELECT legal_name FROM plugin_data.dv_sd_students WHERE user_id='da200000-0000-4000-8000-000000000001'),'Fictional Student','late error rolls back identity write');

CREATE FUNCTION pg_temp.reject_dv_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END;
$$;
CREATE TRIGGER dv_atomic_fixture_audit_failure BEFORE INSERT ON plugin_data.dv_sd_audit_events
FOR EACH ROW WHEN (NEW.organization_id = 'da100000-0000-4000-8000-000000000001') EXECUTE FUNCTION pg_temp.reject_dv_audit();
SELECT extensions.throws_ok($$SELECT pg_temp.apply_dv('{"legalName":"Must roll back"}',true)$$,'P0001','Synthetic audit failure','audit failure refuses whole submission');
SELECT extensions.is((SELECT status FROM plugin_data.dv_sd_seasonal_memberships WHERE organization_id='da100000-0000-4000-8000-000000000001'),'draft','audit failure restores draft');
SELECT extensions.is((SELECT legal_name FROM plugin_data.dv_sd_students WHERE user_id='da200000-0000-4000-8000-000000000001'),'Fictional Student','audit failure restores identity');
DROP TRIGGER dv_atomic_fixture_audit_failure ON plugin_data.dv_sd_audit_events;
SELECT extensions.is(pg_temp.apply_dv('{}',true,'da400000-0000-4000-8000-000000000002')->>'status','submitted','submit commits canonical submitted state');
SELECT extensions.throws_ok($$SELECT pg_temp.apply_dv('{"legalName":"Refused edit"}',true)$$,'55000','Only draft or needs-action memberships can be edited.','submitted application cannot be edited');
SELECT extensions.is((SELECT legal_name FROM plugin_data.dv_sd_students WHERE user_id='da200000-0000-4000-8000-000000000001'),'Fictional Student','refused resubmission cannot alter identity');
UPDATE plugin_data.dv_sd_seasonal_memberships SET status='needs_action',review_notes='Correct the name'
WHERE organization_id='da100000-0000-4000-8000-000000000001';
SELECT extensions.is(pg_temp.apply_dv('{"legalName":"Corrected Student","applicationData":{"studentFirstName":"Corrected"}}',true)->>'status','submitted','requested correction can be resubmitted');
SELECT extensions.is((SELECT legal_name FROM plugin_data.dv_sd_students WHERE user_id='da200000-0000-4000-8000-000000000001'),'Corrected Student','accepted correction updates identity');
UPDATE plugin_data.dv_sd_seasonal_memberships SET status='approved'
WHERE organization_id='da100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.apply_dv('{"legalName":"Race loser"}',true)$$,'55000','Only draft or needs-action memberships can be edited.','staff decision wins before member correction');
SELECT extensions.is(pg_temp.apply_dv('{}',true,'da400000-0000-4000-8000-000000000002')->>'status','submitted','a committed request can be acknowledged after review');
SELECT extensions.is((SELECT status FROM plugin_data.dv_sd_seasonal_memberships WHERE organization_id='da100000-0000-4000-8000-000000000001'),'approved','replayed request cannot reverse staff review');
UPDATE public.organization_plugin_installs SET enabled=false
WHERE organization_id='da100000-0000-4000-8000-000000000001' AND plugin_key='dv-speech-debate';
SELECT extensions.throws_ok($$SELECT pg_temp.apply_dv()$$,'42501','DV plugin access is unavailable.','disabled plugin blocks writes');
UPDATE public.organization_members SET status='inactive'
WHERE organization_id='da100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.apply_dv()$$,'42501','Active organization membership required.','inactive member blocks writes');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.dv_sd_membership_write_receipts WHERE organization_id='da100000-0000-4000-8000-000000000001'),3,'only committed writes receive retry receipts');

UPDATE public.organization_members SET status='active'
WHERE organization_id='da100000-0000-4000-8000-000000000001';
UPDATE public.organization_plugin_installs SET enabled=true
WHERE organization_id='da100000-0000-4000-8000-000000000001' AND plugin_key='dv-speech-debate';
INSERT INTO private.plugin_control_plane_transition_locks(organization_id,plugin_key,lock_token,acquired_at,expires_at)
VALUES ('da100000-0000-4000-8000-000000000001','dv-speech-debate',gen_random_uuid(),now(),now()+interval '5 minutes');
SELECT extensions.throws_ok($$SELECT pg_temp.apply_dv()$$,'40001','DV plugin transition is in progress.','control-plane transition blocks writes');
DELETE FROM private.plugin_control_plane_transition_locks WHERE organization_id='da100000-0000-4000-8000-000000000001';
INSERT INTO app_private.account_deletion_operations(target_user_id,requested_by,mode,phase)
VALUES ('da200000-0000-4000-8000-000000000001','da200000-0000-4000-8000-000000000001','self_delete','database_pending');
SELECT extensions.throws_ok($$SELECT pg_temp.apply_dv()$$,'42501','Account is not available for membership changes.','pending account deletion blocks plugin writes');
SELECT extensions.is((SELECT legal_name FROM plugin_data.dv_sd_students WHERE user_id='da200000-0000-4000-8000-000000000001'),'Corrected Student','all later refusals preserve accepted identity');

SELECT * FROM extensions.finish();
ROLLBACK;
