BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
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

INSERT INTO plugin_data.csf_announcements(id,organization_id,title,body,audience,audience_cohort_id,status,published_at,created_by,updated_by)
VALUES('ec700000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000001','Fictional class reminder','Bring a notebook.','class','ec400000-0000-4000-8000-000000000001','published',now(),'ec200000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000001');
CREATE TEMP VIEW candidates AS SELECT * FROM plugin_data.csf_class_publication_email_candidates('ec100000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','post','ec700000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000001');
SELECT extensions.is((SELECT count(*)::integer FROM candidates),1,'only verified class link receives class email; pending links, other classes and unlinked accounts do not');
SELECT extensions.is((SELECT email FROM candidates),'publication-member@local.test','use the confirmed linked account address');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_memberships WHERE organization_id='ec100000-0000-4000-8000-000000000001'),0,'class notice does not require or create acceptance');
SELECT extensions.ok(plugin_data.csf_publication_recipient_allowed('ec100000-0000-4000-8000-000000000001','post','ec700000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000002'),'same class source is authorized in app before acceptance');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_class_publication_email_candidates(uuid,uuid,uuid,text,uuid,uuid,integer,integer)','execute'),'browser cannot enumerate class email addresses');
SELECT extensions.throws_ok($q$SELECT * FROM plugin_data.csf_class_publication_email_candidates('ec100000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','post','ec700000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000002')$q$,'42501',NULL,'member cannot request publication email audience');
CREATE TEMP TABLE campaign AS SELECT (plugin_data.csf_create_post_email_campaign_draft('ec100000-0000-4000-8000-000000000001','ec700000-0000-4000-8000-000000000001','Fictional class reminder','Bring a notebook.','ec200000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001','cohort_members','<p>Bring a notebook.</p>','announcements','resend_topic_publication_fixture','{"csf_environment":"local"}','class-notice-draft','ec400000-0000-4000-8000-000000000001')->>'campaignId')::uuid AS id;
SELECT plugin_data.csf_finalize_post_email_campaign_content('ec100000-0000-4000-8000-000000000001',(SELECT id FROM campaign),'ec200000-0000-4000-8000-000000000001','class-notice-content');
SELECT plugin_data.csf_snapshot_communication_recipients('ec100000-0000-4000-8000-000000000001',(SELECT id FROM campaign),'[{"email":"publication-member@local.test","provenance":"account_email","profileId":"ec300000-0000-4000-8000-000000000001","userId":"ec200000-0000-4000-8000-000000000002"}]');
CREATE TEMP VIEW eligible AS SELECT plugin_data.csf_publication_email_recipient_allowed('ec100000-0000-4000-8000-000000000001',id) AS allowed FROM plugin_data.csf_communication_recipient_snapshots WHERE campaign_id=(SELECT id FROM campaign);
SELECT extensions.ok((SELECT allowed FROM eligible),'frozen class email passes delivery gate without accepted membership');
UPDATE public.notification_settings SET email_notifications=false WHERE user_id='ec200000-0000-4000-8000-000000000002';
SELECT extensions.ok(NOT (SELECT allowed FROM eligible),'global email opt out blocks already queued delivery');
UPDATE public.notification_settings SET email_notifications=true WHERE user_id='ec200000-0000-4000-8000-000000000002';
UPDATE public.notification_settings SET organization_updates=false WHERE user_id='ec200000-0000-4000-8000-000000000002';
SELECT extensions.ok(NOT (SELECT allowed FROM eligible),'organization update opt out blocks already queued delivery');
UPDATE public.notification_settings SET organization_updates=true WHERE user_id='ec200000-0000-4000-8000-000000000002';
UPDATE plugin_data.csf_profile_accounts SET status='pending',is_primary=false WHERE user_id='ec200000-0000-4000-8000-000000000002';
SELECT extensions.ok(NOT (SELECT allowed FROM eligible),'revoked verified link blocks already queued delivery');
UPDATE plugin_data.csf_profile_accounts SET status='verified',is_primary=true WHERE user_id='ec200000-0000-4000-8000-000000000002';
UPDATE plugin_data.csf_announcements SET status='draft' WHERE id='ec700000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT (SELECT allowed FROM eligible),'withdrawn source blocks already queued delivery');
UPDATE plugin_data.csf_announcements SET status='published' WHERE id='ec700000-0000-4000-8000-000000000001';
UPDATE auth.users SET email='new-confirmed@local.test' WHERE id='ec200000-0000-4000-8000-000000000002';
SELECT extensions.ok(NOT (SELECT allowed FROM eligible),'changed account address blocks already queued delivery');
UPDATE auth.users SET email='publication-member@local.test' WHERE id='ec200000-0000-4000-8000-000000000002';
SELECT extensions.is((SELECT body_text FROM plugin_data.csf_communication_campaigns WHERE id=(SELECT id FROM campaign)),'Bring a notebook.','email contains authorized publication content only');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_memberships WHERE organization_id='ec100000-0000-4000-8000-000000000001'),0,'publication leaves private application and membership state unchanged');
UPDATE plugin_data.csf_profile_cohort_memberships SET cohort_id='ec400000-0000-4000-8000-000000000002' WHERE profile_id='ec300000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT (SELECT allowed FROM eligible),'moving to another class revokes frozen delivery');
SELECT extensions.is((SELECT count(*)::integer FROM candidates),0,'moved account no longer appears in the class audience');
UPDATE plugin_data.csf_profile_cohort_memberships SET cohort_id='ec400000-0000-4000-8000-000000000001' WHERE profile_id='ec300000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_cohort_terms(organization_id,cohort_id,term_id) VALUES('ec100000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001');
CREATE TEMP TABLE activity AS SELECT (plugin_data.csf_create_activity('ec100000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','{"title":"Fictional class activity","status":"published","signupMode":"none","pointValue":1}','ec200000-0000-4000-8000-000000000001','ec600000-0000-4000-8000-000000000007')->>'activityId')::uuid AS id;
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_class_publication_email_candidates('ec100000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','activity',(SELECT id FROM activity),'ec200000-0000-4000-8000-000000000001')),1,'class activity uses the same verified linked pending audience');
SELECT extensions.ok(plugin_data.csf_publication_recipient_allowed('ec100000-0000-4000-8000-000000000001','activity',(SELECT id FROM activity),'ec200000-0000-4000-8000-000000000002'),'activity is already authorized in app for the email recipient');
SELECT extensions.ok(NOT plugin_data.csf_publication_recipient_allowed('ec100000-0000-4000-8000-000000000001','profile','ec300000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000002'),'class audience does not widen private profile update access before release');
SELECT * FROM extensions.finish();
ROLLBACK;
