-- Publication email uses current account preferences without inferring ownership.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(20);

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

INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,personal_email,normalized_personal_email)
VALUES('ec300000-0000-4000-8000-000000000004','ec100000-0000-4000-8000-000000000001','Fictional','Contact','fictional','contact','publication-unlinked@local.test','publication-unlinked@local.test');
INSERT INTO plugin_data.csf_term_memberships(organization_id,profile_id,term_id,status,accepted_at)
SELECT 'ec100000-0000-4000-8000-000000000001',id,'ec500000-0000-4000-8000-000000000001','accepted',now()
FROM plugin_data.csf_profiles WHERE organization_id='ec100000-0000-4000-8000-000000000001';
CREATE TEMP TABLE email_activity AS SELECT (plugin_data.csf_create_activity('ec100000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001',NULL,'{"title":"Fictional email activity","status":"published","signupMode":"none","pointValue":1}','ec200000-0000-4000-8000-000000000001','ec600000-0000-4000-8000-000000000007')->>'activityId')::uuid AS id;
CREATE TEMP TABLE email_campaign AS SELECT (plugin_data.csf_create_activity_email_campaign_draft('ec100000-0000-4000-8000-000000000001',(SELECT id FROM email_activity),'Fictional activity','A new activity is available.','ec200000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001','term_members','<p>A new activity is available.</p>','announcements','resend_topic_publication_fixture','{"csf_environment":"local"}','publication-email-draft')->>'campaignId')::uuid AS id;
SELECT plugin_data.csf_finalize_activity_email_campaign_content('ec100000-0000-4000-8000-000000000001',(SELECT id FROM email_campaign),'ec200000-0000-4000-8000-000000000001','publication-email-content');
SELECT plugin_data.csf_snapshot_communication_recipients('ec100000-0000-4000-8000-000000000001',(SELECT id FROM email_campaign),
'[{"email":"publication-member@local.test","provenance":"preferred_contact","profileId":"ec300000-0000-4000-8000-000000000001","userId":"ec200000-0000-4000-8000-000000000002"},
{"email":"publication-pending@local.test","provenance":"preferred_contact","profileId":"ec300000-0000-4000-8000-000000000002","userId":"ec200000-0000-4000-8000-000000000003"},
{"email":"publication-other-class@local.test","provenance":"preferred_contact","profileId":"ec300000-0000-4000-8000-000000000003","userId":"ec200000-0000-4000-8000-000000000004"},
{"email":"publication-unlinked@local.test","provenance":"preferred_contact","profileId":"ec300000-0000-4000-8000-000000000004"}]');
CREATE TEMP VIEW email_snapshots AS SELECT id,profile_id FROM plugin_data.csf_communication_recipient_snapshots WHERE campaign_id=(SELECT id FROM email_campaign);
SELECT extensions.ok(plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',(SELECT id FROM email_snapshots WHERE profile_id='ec300000-0000-4000-8000-000000000001')),'accepted member with reviewed account and enabled preferences is eligible');
SELECT extensions.ok(NOT plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',(SELECT id FROM email_snapshots WHERE profile_id='ec300000-0000-4000-8000-000000000002')),'a pending account cannot stand in for an authorized account');
UPDATE plugin_data.csf_profile_accounts SET connection_basis='unknown' WHERE user_id='ec200000-0000-4000-8000-000000000004';
SELECT extensions.ok(NOT plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',(SELECT id FROM email_snapshots WHERE profile_id='ec300000-0000-4000-8000-000000000003')),'verified status with unknown basis cannot authorize the frozen account');
UPDATE public.notification_settings SET email_notifications=false,organization_updates=false WHERE user_id='ec200000-0000-4000-8000-000000000005';
SELECT extensions.ok(plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',(SELECT id FROM email_snapshots WHERE profile_id='ec300000-0000-4000-8000-000000000004')),'an unlinked contact remains under chapter consent, without email-based account or preference inference');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profile_accounts WHERE profile_id='ec300000-0000-4000-8000-000000000004'),0,'contact authorization creates no account ownership');
UPDATE public.notification_settings SET email_notifications=false WHERE user_id='ec200000-0000-4000-8000-000000000002';
SELECT extensions.ok(NOT plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',(SELECT id FROM email_snapshots WHERE profile_id='ec300000-0000-4000-8000-000000000001')),'global email opt-out suppresses the linked publication recipient');
UPDATE public.notification_settings SET email_notifications=true,organization_updates=false WHERE user_id='ec200000-0000-4000-8000-000000000002';
SELECT extensions.ok(NOT plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',(SELECT id FROM email_snapshots WHERE profile_id='ec300000-0000-4000-8000-000000000001')),'organization category opt-out also suppresses publication email');
UPDATE public.notification_settings SET organization_updates=true WHERE user_id='ec200000-0000-4000-8000-000000000002';
UPDATE plugin_data.csf_term_memberships SET status='revoked' WHERE profile_id='ec300000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',(SELECT id FROM email_snapshots WHERE profile_id='ec300000-0000-4000-8000-000000000001')),'a frozen recipient loses eligibility when term membership is revoked');
UPDATE plugin_data.csf_term_memberships SET status='accepted' WHERE profile_id='ec300000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_profiles SET personal_email='changed-publication-contact@local.test',normalized_personal_email='changed-publication-contact@local.test' WHERE id='ec300000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',(SELECT id FROM email_snapshots WHERE profile_id='ec300000-0000-4000-8000-000000000001')),'contact changes cannot send a frozen message to an old address');
UPDATE plugin_data.csf_profiles SET personal_email='publication-member@local.test',normalized_personal_email='publication-member@local.test' WHERE id='ec300000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000002',(SELECT id FROM email_snapshots WHERE profile_id='ec300000-0000-4000-8000-000000000001'))$q$,'P0002',NULL,'cross-organization email snapshot cannot authorize');
SELECT plugin_data.csf_finalize_communication_recipient_snapshot('ec100000-0000-4000-8000-000000000001',(SELECT id FROM email_campaign),4);
SELECT plugin_data.csf_claim_communication_dispatch_batch('ec100000-0000-4000-8000-000000000001',(SELECT id FROM email_campaign),'publication-fixture-worker',10,120);
UPDATE public.notification_settings SET organization_updates=false WHERE user_id='ec200000-0000-4000-8000-000000000002';
CREATE TEMP TABLE refused_publication AS SELECT plugin_data.csf_authorize_communication_dispatch('ec100000-0000-4000-8000-000000000001',(SELECT id FROM plugin_data.csf_communication_dispatch_attempts WHERE recipient_snapshot_id=(SELECT id FROM email_snapshots WHERE profile_id='ec300000-0000-4000-8000-000000000001')),'publication-fixture-worker','publication-fixture') AS value;
SELECT extensions.is((SELECT value->>'blockedBy' FROM refused_publication),'publication_recipient','the existing immediately-before-send gate enforces account preferences');
SELECT extensions.ok((SELECT value->'providerPayload'='null'::jsonb AND value->>'attemptState'='suppressed' FROM refused_publication),'suppression returns no provider payload and settles the attempt');
SELECT extensions.is((SELECT state FROM plugin_data.csf_communication_dispatch_attempts WHERE recipient_snapshot_id=(SELECT id FROM email_snapshots WHERE profile_id='ec300000-0000-4000-8000-000000000001')),'suppressed','refusal remains durable after the action response');
UPDATE plugin_data.csf_opportunities SET status='closed' WHERE id=(SELECT id FROM email_activity);
SELECT extensions.ok(NOT plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',(SELECT id FROM email_snapshots WHERE profile_id='ec300000-0000-4000-8000-000000000004')),'source withdrawal suppresses even an otherwise eligible unlinked contact');
SELECT extensions.ok(position('csf_communication_dispatch_decision' in pg_get_functiondef('plugin_data.csf_authorize_communication_dispatch(uuid,uuid,text,text)'::regprocedure)) < position('csf_publication_email_recipient_allowed' in pg_get_functiondef('plugin_data.csf_authorize_communication_dispatch(uuid,uuid,text,text)'::regprocedure)),'chapter topic and provider safety checks run before the added account preference gate');

-- Posts without a stored term use the campaign's reviewed semester, as the existing post campaign action permits.
UPDATE public.notification_settings SET organization_updates=true WHERE user_id='ec200000-0000-4000-8000-000000000002';
INSERT INTO plugin_data.csf_announcements(id,organization_id,title,body,audience,status,created_by,updated_by)
VALUES('ec700000-0000-4000-8000-000000000003','ec100000-0000-4000-8000-000000000001','Fictional termless post','Synthetic text.','members','published','ec200000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000001');
CREATE TEMP TABLE post_email_campaign AS SELECT (plugin_data.csf_create_post_email_campaign_draft('ec100000-0000-4000-8000-000000000001','ec700000-0000-4000-8000-000000000003','Fictional post','A new post is available.','ec200000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001','term_members','<p>A new post is available.</p>','announcements','resend_topic_publication_fixture','{"csf_environment":"local"}','publication-post-draft')->>'campaignId')::uuid AS id;
SELECT plugin_data.csf_finalize_post_email_campaign_content('ec100000-0000-4000-8000-000000000001',(SELECT id FROM post_email_campaign),'ec200000-0000-4000-8000-000000000001','publication-post-content');
SELECT plugin_data.csf_snapshot_communication_recipients('ec100000-0000-4000-8000-000000000001',(SELECT id FROM post_email_campaign),'[{"email":"publication-member@local.test","provenance":"preferred_contact","profileId":"ec300000-0000-4000-8000-000000000001","userId":"ec200000-0000-4000-8000-000000000002"}]');
SELECT extensions.ok(plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',(SELECT id FROM plugin_data.csf_communication_recipient_snapshots WHERE campaign_id=(SELECT id FROM post_email_campaign))),'normal termless post remains eligible through its frozen campaign semester');
UPDATE plugin_data.csf_announcements SET audience='officers' WHERE id='ec700000-0000-4000-8000-000000000003';
SELECT extensions.ok(NOT plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',(SELECT id FROM plugin_data.csf_communication_recipient_snapshots WHERE campaign_id=(SELECT id FROM post_email_campaign))),'changing a published post audience suppresses stale frozen recipients');
INSERT INTO plugin_data.csf_communication_campaigns(id,organization_id,campaign_kind,status,sender_name,sender_email,reply_to_email,subject,body_text,body_text_hash,term_id,audience_kind,created_by,created_by_identity,content_finalized_at,content_finalized_by,content_finalized_by_identity,audience_snapshot_version,provider_idempotency_key,metadata)
VALUES('ec900000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000001','transactional','draft','Fictional organization','csf@notifications.lets-assist.com','fictional-officer@local.test','Fictional transactional notice','Synthetic body.',repeat('a',64),'ec500000-0000-4000-8000-000000000001','applicants','ec200000-0000-4000-8000-000000000001','publication-admin@local.test',now(),'ec200000-0000-4000-8000-000000000001','publication-admin@local.test',1,'publication-transactional-fixture','{"csf_environment":"local"}');
SELECT plugin_data.csf_snapshot_communication_recipients('ec100000-0000-4000-8000-000000000001','ec900000-0000-4000-8000-000000000001','[{"email":"publication-member@local.test","provenance":"staff_entry","userId":"ec200000-0000-4000-8000-000000000002"}]');
UPDATE public.notification_settings SET organization_updates=false,email_notifications=false WHERE user_id='ec200000-0000-4000-8000-000000000002';
SELECT extensions.ok(plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',(SELECT id FROM plugin_data.csf_communication_recipient_snapshots WHERE campaign_id='ec900000-0000-4000-8000-000000000001')),'mandatory transactional notices retain the existing separate policy');

UPDATE public.organization_plugin_installs SET configuration=configuration||'{"communications":{"broadcastTopics":{"term_members":{"topicKey":"announcements","resendTopicId":"resend_topic_publication_fixture"},"staff":{"topicKey":"announcements","resendTopicId":"resend_topic_publication_fixture"}}}}'::jsonb WHERE organization_id='ec100000-0000-4000-8000-000000000001' AND plugin_key='dvhs-csf';
INSERT INTO plugin_data.csf_announcements(id,organization_id,title,body,audience,status,created_by,updated_by)
VALUES('ec700000-0000-4000-8000-000000000004','ec100000-0000-4000-8000-000000000001','Fictional staff post','Synthetic text.','officers','published','ec200000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000001');
CREATE TEMP TABLE staff_email_campaign AS SELECT (plugin_data.csf_create_post_email_campaign_draft('ec100000-0000-4000-8000-000000000001','ec700000-0000-4000-8000-000000000004','Fictional staff post','A new post is available.','ec200000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001','staff','<p>A new post is available.</p>','announcements','resend_topic_publication_fixture','{"csf_environment":"local"}','publication-staff-draft')->>'campaignId')::uuid AS id;
SELECT plugin_data.csf_finalize_post_email_campaign_content('ec100000-0000-4000-8000-000000000001',(SELECT id FROM staff_email_campaign),'ec200000-0000-4000-8000-000000000001','publication-staff-content');
SELECT plugin_data.csf_snapshot_communication_recipients('ec100000-0000-4000-8000-000000000001',(SELECT id FROM staff_email_campaign),'[{"email":"publication-admin@local.test","provenance":"account_email","userId":"ec200000-0000-4000-8000-000000000001"}]');
SELECT extensions.ok(plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',(SELECT id FROM plugin_data.csf_communication_recipient_snapshots WHERE campaign_id=(SELECT id FROM staff_email_campaign))),'authorized staff without a CSF profile retain staff publication email eligibility');
UPDATE public.notification_settings SET organization_updates=false WHERE user_id='ec200000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',(SELECT id FROM plugin_data.csf_communication_recipient_snapshots WHERE campaign_id=(SELECT id FROM staff_email_campaign))),'unlinked staff account preferences are checked directly by its authorized user ID');
SELECT * FROM extensions.finish();
ROLLBACK;
