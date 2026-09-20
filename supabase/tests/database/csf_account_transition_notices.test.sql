-- Synthetic account and decision notices. No provider calls.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(24);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('ec200000-0000-4000-8000-000000000001','authenticated','authenticated','publication-admin@local.test',now(),'{}','{}',now(),now()),
('ec200000-0000-4000-8000-000000000002','authenticated','authenticated','publication-member@local.test',now(),'{}','{}',now(),now()),
('ec200000-0000-4000-8000-000000000003','authenticated','authenticated','publication-pending@local.test',now(),'{}','{}',now(),now()),
('ec200000-0000-4000-8000-000000000004','authenticated','authenticated','publication-other-class@local.test',now(),'{}','{}',now(),now()),
('ec200000-0000-4000-8000-000000000005','authenticated','authenticated','publication-unlinked@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES
('ec100000-0000-4000-8000-000000000001','Publication fixture','publication-fixture','school','514001'),
('ec100000-0000-4000-8000-000000000002','Other publication fixture','other-publication-fixture','school','514002');
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES
('ec100000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000001','admin','active'),('ec100000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000002','member','active'),
('ec100000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000003','member','active'),('ec100000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000004','member','active'),('ec100000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000005','member','active');
INSERT INTO public.organization_plugin_installs(organization_id,plugin_key,installed_version,configuration,installed_by)
VALUES('ec100000-0000-4000-8000-000000000001','dvhs-csf','0.1.0','{"communications":{"broadcastTopics":{"term_members":{"topicKey":"announcements","resendTopicId":"resend_topic_publication_fixture"}}}}','ec200000-0000-4000-8000-000000000001');
INSERT INTO public.organization_plugin_entitlements(organization_id,plugin_key,status,created_by)
VALUES('ec100000-0000-4000-8000-000000000001','dvhs-csf','active','ec200000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester,lifecycle_status,is_current)
VALUES('ec500000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000001','F40','Fall 2040','2040-2041','fall','open',true);
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label) VALUES
('ec400000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000001',2041,'Class of 2041'),('ec400000-0000-4000-8000-000000000002','ec100000-0000-4000-8000-000000000001',2042,'Class of 2042');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,personal_email,normalized_personal_email) VALUES
('ec300000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000001','Fictional','Member','fictional','member','publication-member@local.test','publication-member@local.test'),
('ec300000-0000-4000-8000-000000000002','ec100000-0000-4000-8000-000000000001','Fictional','Pending','fictional','pending','publication-pending@local.test','publication-pending@local.test'),
('ec300000-0000-4000-8000-000000000003','ec100000-0000-4000-8000-000000000001','Fictional','Other','fictional','other','publication-other-class@local.test','publication-other-class@local.test');
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id,status) VALUES
('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','active'),('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000002','ec400000-0000-4000-8000-000000000001','active'),('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000003','ec400000-0000-4000-8000-000000000002','active');
INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status,is_primary,linked_by,connection_basis) VALUES
('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000002','verified',true,'ec200000-0000-4000-8000-000000000001','officer_decision'),
('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000002','ec200000-0000-4000-8000-000000000003','pending',false,'ec200000-0000-4000-8000-000000000001','unknown'),
('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000003','ec200000-0000-4000-8000-000000000004','verified',true,'ec200000-0000-4000-8000-000000000001','officer_decision');


SET CONSTRAINTS ALL IMMEDIATE;
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_events
 WHERE organization_id='ec100000-0000-4000-8000-000000000001' AND event_key LIKE 'account_connected:%'),2,
 'verified connections queue notices without requiring an accepted membership');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_notification_deliveries d
 JOIN plugin_data.csf_publication_events e ON e.id=d.event_id WHERE e.event_key LIKE 'account_connected:%'
 AND d.user_id='ec200000-0000-4000-8000-000000000003'),0,'pending ownership queues no notice');
UPDATE plugin_data.csf_profile_accounts SET notes='Synthetic internal note'
 WHERE organization_id='ec100000-0000-4000-8000-000000000001';
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_events
 WHERE organization_id='ec100000-0000-4000-8000-000000000001' AND event_key LIKE 'account_connected:%'),2,
 'ordinary connection updates do not resend the notice');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_events
 WHERE organization_id='ec100000-0000-4000-8000-000000000001' AND event_key LIKE 'access_granted:%'),4,
 'organization and class access each queue notices for the two verified owners');
SELECT extensions.ok(NOT plugin_data.csf_transition_notice_recipient_allowed(
 'ec100000-0000-4000-8000-000000000001','profile','ec300000-0000-4000-8000-000000000001',
 'ec200000-0000-4000-8000-000000000002','application_decision:fixture'),
 'a notice without its committed subject and state is refused');
SELECT extensions.ok(NOT plugin_data.csf_transition_notice_recipient_allowed(
 'ec100000-0000-4000-8000-000000000001','profile','ec300000-0000-4000-8000-000000000001',
 'ec200000-0000-4000-8000-000000000003','application_decision:fixture'),
 'another account cannot receive the applicant notice');
SELECT extensions.ok(NOT plugin_data.csf_transition_notice_recipient_allowed(
 'ec100000-0000-4000-8000-000000000001','profile','ec300000-0000-4000-8000-000000000001',
 'ec200000-0000-4000-8000-000000000002','profile_correction:fixture'),
 'generic profile corrections keep the existing membership rule');
INSERT INTO plugin_data.csf_term_applications (id,organization_id,profile_id,term_id,cohort_id,status)
 VALUES ('ec800000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000001',
 'ec300000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','submitted');
UPDATE plugin_data.csf_term_applications SET decision_status='rejected',status='rejected',
 reviewed_by='ec200000-0000-4000-8000-000000000001', reviewed_at=now(), decision_reason='Private fixture'
 WHERE id='ec800000-0000-4000-8000-000000000001';
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_events
 WHERE organization_id='ec100000-0000-4000-8000-000000000001' AND event_key LIKE 'application_decision:%'),1,
 'a published rejection queues one notice');
UPDATE plugin_data.csf_term_applications SET decision_reason='Changed fixture'
 WHERE id='ec800000-0000-4000-8000-000000000001';
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_events
 WHERE organization_id='ec100000-0000-4000-8000-000000000001' AND event_key LIKE 'application_decision:%'),1,
 'editing an internal reason does not resend a decision');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM plugin_data.csf_publication_events
 WHERE organization_id='ec100000-0000-4000-8000-000000000001' AND event_key LIKE '%Private fixture%'),
 'event identities contain no private reason');
CREATE TEMP TABLE transition_fixture AS SELECT e.id,event_key,d.id AS delivery_id
 FROM plugin_data.csf_publication_events e JOIN plugin_data.csf_publication_notification_deliveries d ON d.event_id=e.id
 WHERE e.organization_id='ec100000-0000-4000-8000-000000000001'
 AND e.event_key LIKE 'application_decision:%';
SELECT extensions.ok(plugin_data.csf_transition_notice_recipient_allowed(
 'ec100000-0000-4000-8000-000000000001','profile','ec300000-0000-4000-8000-000000000001',
 'ec200000-0000-4000-8000-000000000002',(SELECT event_key FROM transition_fixture)),
 'editing a private note preserves the queued published decision notice');
UPDATE plugin_data.csf_term_applications SET decision_status='pending',status='submitted',reviewed_by=NULL,reviewed_at=NULL
 WHERE id='ec800000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT plugin_data.csf_transition_notice_recipient_allowed(
 'ec100000-0000-4000-8000-000000000001','profile','ec300000-0000-4000-8000-000000000001',
 'ec200000-0000-4000-8000-000000000002',(SELECT event_key FROM transition_fixture)),
 'reopening the application blocks its queued decision notice');
INSERT INTO plugin_data.csf_term_memberships(organization_id,profile_id,term_id,cohort_id,status)
 VALUES('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001',
 'ec500000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','active');
SELECT extensions.ok(plugin_data.csf_publication_recipient_allowed(
 'ec100000-0000-4000-8000-000000000001','profile','ec300000-0000-4000-8000-000000000001',
 'ec200000-0000-4000-8000-000000000002'),'fixture has general profile-notice access');
UPDATE plugin_data.csf_publication_notification_deliveries SET status='processing',lease_token='ec900000-0000-4000-8000-000000000001',lease_expires_at=now()+interval '1 hour'
 WHERE id=(SELECT delivery_id FROM transition_fixture);
SELECT extensions.is(plugin_data.csf_authorize_publication_notification(
 'ec100000-0000-4000-8000-000000000001',(SELECT delivery_id FROM transition_fixture),
 'ec900000-0000-4000-8000-000000000001')->>'authorized','false',
 'general membership cannot bypass the stale-transition check');
INSERT INTO plugin_data.csf_communication_campaigns(id,organization_id,campaign_kind,status,sender_email,subject,source_publication_event_id,audience_snapshot_version,provider_idempotency_key,audience_kind,term_id)
 VALUES('ec910000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000001','transactional','draft','draft@local.test','Fixture',(SELECT id FROM transition_fixture),1,'transition-notice-fixture','custom_list','ec500000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_communication_recipient_snapshots(id,organization_id,campaign_id,snapshot_version,recipient_email,subscription_decision,user_id)
 VALUES('ec920000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000001','ec910000-0000-4000-8000-000000000001',1,'publication-member@local.test','included','ec200000-0000-4000-8000-000000000002');
SELECT extensions.ok(NOT plugin_data.csf_publication_email_recipient_allowed(
 'ec100000-0000-4000-8000-000000000001','ec920000-0000-4000-8000-000000000001'),
 'email handoff also refuses the stale transition despite active membership');
UPDATE plugin_data.csf_term_applications SET decision_status='approved',status='accepted',reviewed_by='ec200000-0000-4000-8000-000000000001',reviewed_at=now()+interval '1 second'
 WHERE id='ec800000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT plugin_data.csf_transition_notice_recipient_allowed(
 'ec100000-0000-4000-8000-000000000001','profile','ec300000-0000-4000-8000-000000000001',
 'ec200000-0000-4000-8000-000000000002',(SELECT event_key FROM transition_fixture)),
 'a new acceptance does not revive the old rejection notice');
CREATE TEMP TABLE access_fixture AS SELECT e.event_key FROM plugin_data.csf_publication_events e
 JOIN plugin_data.csf_profile_cohort_memberships m ON m.id::text=split_part(e.event_key,':',2)
 WHERE m.profile_id='ec300000-0000-4000-8000-000000000001' AND e.event_key LIKE 'access_granted:%';
SELECT extensions.ok(plugin_data.csf_transition_notice_recipient_allowed(
 'ec100000-0000-4000-8000-000000000001','profile','ec300000-0000-4000-8000-000000000001',
 'ec200000-0000-4000-8000-000000000002',(SELECT event_key FROM access_fixture)),
 'current class access authorizes its own event');
UPDATE plugin_data.csf_profile_cohort_memberships SET status='archived'
 WHERE profile_id='ec300000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT plugin_data.csf_transition_notice_recipient_allowed(
 'ec100000-0000-4000-8000-000000000001','profile','ec300000-0000-4000-8000-000000000001',
 'ec200000-0000-4000-8000-000000000002',(SELECT event_key FROM access_fixture)),
 'revoking class access blocks its queued grant notice');
SELECT extensions.ok(NOT has_function_privilege('service_role',
 'plugin_data.csf_transition_notice_fingerprint(uuid,uuid,uuid,text,uuid)','EXECUTE'),
 'transition state fingerprinting is internal');
SELECT extensions.ok(NOT plugin_data.csf_transition_notice_recipient_allowed(
 'ec100000-0000-4000-8000-000000000002','profile','ec300000-0000-4000-8000-000000000001',
 'ec200000-0000-4000-8000-000000000002',(SELECT event_key FROM access_fixture)),
 'a transition cannot cross organizations');
UPDATE plugin_data.csf_profile_accounts SET status='revoked',is_primary=false
 WHERE profile_id='ec300000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT plugin_data.csf_transition_notice_recipient_allowed(
 'ec100000-0000-4000-8000-000000000001','profile','ec300000-0000-4000-8000-000000000001',
 'ec200000-0000-4000-8000-000000000002','application_decision:fixture'),
 'revocation blocks delivery of a queued notice');
SELECT extensions.ok(NOT has_function_privilege('service_role',
 'plugin_data.csf_transition_notice_recipient_allowed(uuid,text,uuid,uuid,text)','EXECUTE'),
 'the recipient helper remains internal');
SET CONSTRAINTS ALL DEFERRED;
UPDATE plugin_data.csf_profile_accounts SET status='verified', connection_basis='officer_decision', is_primary=true
 WHERE profile_id='ec300000-0000-4000-8000-000000000002';
UPDATE plugin_data.csf_profile_accounts SET status='revoked', is_primary=false
 WHERE profile_id='ec300000-0000-4000-8000-000000000002';
SET CONSTRAINTS ALL IMMEDIATE;
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_events
 WHERE organization_id='ec100000-0000-4000-8000-000000000001' AND event_key LIKE 'account_connected:%'),2,
 'a connection revoked in the same transaction sends no connection notice');
SELECT plugin_data.csf_record_personal_notification('ec100000-0000-4000-8000-000000000001','profile',
 'ec300000-0000-4000-8000-000000000003','ec300000-0000-4000-8000-000000000003','account_connected:' || (SELECT id::text FROM plugin_data.csf_profile_accounts WHERE profile_id='ec300000-0000-4000-8000-000000000003') || ':retry-fixture');
SELECT plugin_data.csf_record_personal_notification('ec100000-0000-4000-8000-000000000001','profile',
 'ec300000-0000-4000-8000-000000000003','ec300000-0000-4000-8000-000000000003','account_connected:' || (SELECT id::text FROM plugin_data.csf_profile_accounts WHERE profile_id='ec300000-0000-4000-8000-000000000003') || ':retry-fixture');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_notification_deliveries d
 JOIN plugin_data.csf_publication_events e ON e.id=d.event_id WHERE e.event_key LIKE 'account_connected:%:retry-fixture:%'),1,
 'replaying the same event queues exactly one recipient delivery');
SELECT * FROM extensions.finish();
ROLLBACK;
