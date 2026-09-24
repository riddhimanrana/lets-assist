BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('ef200000-0000-4000-8000-000000000001','authenticated','authenticated','publication-admin@local.test',now(),'{}','{}',now(),now()),
('ef200000-0000-4000-8000-000000000002','authenticated','authenticated','publication-member@local.test',now(),'{}','{}',now(),now()),
('ef200000-0000-4000-8000-000000000003','authenticated','authenticated','publication-pending@local.test',now(),'{}','{}',now(),now()),
('ef200000-0000-4000-8000-000000000004','authenticated','authenticated','publication-other-class@local.test',now(),'{}','{}',now(),now()),
('ef200000-0000-4000-8000-000000000005','authenticated','authenticated','publication-unlinked@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES
('ef100000-0000-4000-8000-000000000001','Publication fixture','email-intent-fixture','school','514011'),
('ef100000-0000-4000-8000-000000000002','Other publication fixture','other-email-intent-fixture','school','514012');
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES
('ef100000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000001','admin','active'),('ef100000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000002','member','active'),
('ef100000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000003','member','active'),('ef100000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000004','member','active'),('ef100000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000005','member','active');
INSERT INTO public.organization_plugin_installs(organization_id,plugin_key,installed_version,configuration,installed_by)
VALUES('ef100000-0000-4000-8000-000000000001','dvhs-csf','0.1.0','{"communications":{"broadcastTopics":{"term_members":{"topicKey":"announcements","resendTopicId":"resend_topic_publication_fixture"}}}}','ef200000-0000-4000-8000-000000000001');
INSERT INTO public.organization_plugin_entitlements(organization_id,plugin_key,status,created_by)
VALUES('ef100000-0000-4000-8000-000000000001','dvhs-csf','active','ef200000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester,lifecycle_status,is_current)
VALUES('ef500000-0000-4000-8000-000000000001','ef100000-0000-4000-8000-000000000001','F40','Fall 2040','2040-2041','fall','open',true);
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label) VALUES
('ef400000-0000-4000-8000-000000000001','ef100000-0000-4000-8000-000000000001',2041,'Class of 2041'),('ef400000-0000-4000-8000-000000000002','ef100000-0000-4000-8000-000000000001',2042,'Class of 2042');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,personal_email,normalized_personal_email) VALUES
('ef300000-0000-4000-8000-000000000001','ef100000-0000-4000-8000-000000000001','Fictional','Member','fictional','member','publication-member@local.test','publication-member@local.test'),
('ef300000-0000-4000-8000-000000000002','ef100000-0000-4000-8000-000000000001','Fictional','Pending','fictional','pending','publication-pending@local.test','publication-pending@local.test'),
('ef300000-0000-4000-8000-000000000003','ef100000-0000-4000-8000-000000000001','Fictional','Other','fictional','other','publication-other-class@local.test','publication-other-class@local.test');
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id,status) VALUES
('ef100000-0000-4000-8000-000000000001','ef300000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001','active'),('ef100000-0000-4000-8000-000000000001','ef300000-0000-4000-8000-000000000002','ef400000-0000-4000-8000-000000000001','active'),('ef100000-0000-4000-8000-000000000001','ef300000-0000-4000-8000-000000000003','ef400000-0000-4000-8000-000000000002','active');
INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status,is_primary,linked_by,connection_basis) VALUES
('ef100000-0000-4000-8000-000000000001','ef300000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000002','verified',true,'ef200000-0000-4000-8000-000000000001','officer_decision'),
('ef100000-0000-4000-8000-000000000001','ef300000-0000-4000-8000-000000000002','ef200000-0000-4000-8000-000000000003','pending',false,'ef200000-0000-4000-8000-000000000001','unknown'),
('ef100000-0000-4000-8000-000000000001','ef300000-0000-4000-8000-000000000003','ef200000-0000-4000-8000-000000000004','verified',true,'ef200000-0000-4000-8000-000000000001','officer_decision');


INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,personal_email,normalized_personal_email)
SELECT ('ef300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ef100000-0000-4000-8000-000000000001','Fictional','Contact '||n,'fictional','contact '||n,
CASE n WHEN 4 THEN 'profile-contact@local.test' WHEN 5 THEN 'profile-contact@local.test' WHEN 7 THEN 'opted-out@local.test' END,
CASE n WHEN 4 THEN 'profile-contact@local.test' WHEN 5 THEN 'profile-contact@local.test' WHEN 7 THEN 'opted-out@local.test' END
FROM generate_series(4,7) n;
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id,status)
SELECT organization_id,id,'ef400000-0000-4000-8000-000000000001','active' FROM plugin_data.csf_profiles
WHERE organization_id='ef100000-0000-4000-8000-000000000001' AND id::text >= 'ef300000-0000-4000-8000-000000000004';
INSERT INTO plugin_data.csf_term_memberships(organization_id,profile_id,term_id,status)
SELECT organization_id,id,'ef500000-0000-4000-8000-000000000001','accepted' FROM plugin_data.csf_profiles
WHERE organization_id='ef100000-0000-4000-8000-000000000001' AND id<>'ef300000-0000-4000-8000-000000000002';
INSERT INTO plugin_data.csf_communication_broadcast_preferences(organization_id,topic_key,recipient_email,subscription_state,opt_out_at,opt_out_source)
VALUES('ef100000-0000-4000-8000-000000000001','announcements','opted-out@local.test','unsubscribed',now(),'recipient_unsubscribe_link');
CREATE FUNCTION pg_temp.preview(cohort uuid DEFAULT 'ef400000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT plugin_data.csf_preview_activity_email('ef100000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000001','ef500000-0000-4000-8000-000000000001',cohort);
$$;
SELECT extensions.is(pg_temp.preview()->>'recipients','2','class email includes accountless term member and linked member');
SELECT extensions.is(pg_temp.preview()->'summary','{"members":5,"unavailable":1,"unsubscribed":1,"duplicates":1}'::jsonb,'preview explains every difference between membership and recipient counts');
SELECT extensions.is(pg_temp.preview(NULL)->>'recipients','3','all classes include the other class without duplicating shared email');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_preview_activity_email(uuid,uuid,uuid,uuid)','execute'),'browser cannot read private audience counts directly');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_activity_email_audience_snapshot(uuid,uuid,uuid,uuid,uuid)','execute'),'raw audience snapshot remains internal');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_preview_activity_email('ef100000-0000-4000-8000-000000000002','ef200000-0000-4000-8000-000000000001','ef500000-0000-4000-8000-000000000001',NULL)$q$,'42501',NULL,'another chapter cannot reuse officer identity');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_preview_activity_email('ef100000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000002','ef500000-0000-4000-8000-000000000001',NULL)$q$,'42501',NULL,'member cannot preview the roster audience');
SAVEPOINT master_opt_out;
INSERT INTO public.notification_settings(user_id,email_notifications,organization_updates) VALUES('ef200000-0000-4000-8000-000000000002',false,true)
ON CONFLICT(user_id) DO UPDATE SET email_notifications=false;
SELECT extensions.is(pg_temp.preview()->>'recipients','1','master email opt-out excludes connected profile contact');
ROLLBACK TO master_opt_out;
SAVEPOINT organization_opt_out;
INSERT INTO public.notification_settings(user_id,email_notifications,organization_updates) VALUES('ef200000-0000-4000-8000-000000000002',true,false)
ON CONFLICT(user_id) DO UPDATE SET organization_updates=false;
SELECT extensions.is(pg_temp.preview()->>'recipients','1','organization opt-out excludes connected profile contact');
ROLLBACK TO organization_opt_out;

INSERT INTO plugin_data.csf_term_applications(id,organization_id,profile_id,cohort_id,term_id,most_checked_email)
VALUES('ef600000-0000-4000-8000-000000000006','ef100000-0000-4000-8000-000000000001','ef300000-0000-4000-8000-000000000006','ef400000-0000-4000-8000-000000000001','ef500000-0000-4000-8000-000000000001','application-contact@local.test');
SELECT extensions.is(pg_temp.preview()->>'recipients','2','an unassociated application cannot supply a membership contact');
UPDATE plugin_data.csf_term_memberships SET application_id='ef600000-0000-4000-8000-000000000006' WHERE profile_id='ef300000-0000-4000-8000-000000000006';
SELECT extensions.is(pg_temp.preview()->>'recipients','3','the accepted membership can use its own application contact');
SELECT extensions.is(pg_temp.preview()->'summary','{"members":5,"unavailable":0,"unsubscribed":1,"duplicates":1}'::jsonb,'application fallback reconciles the membership count');
SAVEPOINT application_opt_out;
INSERT INTO plugin_data.csf_communication_broadcast_preferences(organization_id,topic_key,recipient_email,subscription_state,opt_out_at,opt_out_source)
VALUES('ef100000-0000-4000-8000-000000000001','announcements','application-contact@local.test','unsubscribed',now(),'recipient_unsubscribe_link');
SELECT extensions.is(pg_temp.preview()->>'recipients','2','application contacts retain the same broadcast opt-out');
ROLLBACK TO application_opt_out;

INSERT INTO plugin_data.csf_cohort_terms(organization_id,cohort_id,term_id) VALUES('ef100000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001','ef500000-0000-4000-8000-000000000001');
CREATE TEMP TABLE publication AS SELECT plugin_data.csf_create_activity_with_email(
'ef100000-0000-4000-8000-000000000001','ef500000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001',
'{"title":"Fictional accountless activity","body":"<p>Bring books.</p>","status":"published","signupMode":"none","pointValue":2,"pointType":"non_drive"}',
'ef200000-0000-4000-8000-000000000001','ef800000-0000-4000-8000-000000000001',true,
'{"topicKey":"announcements","resendTopicId":"resend_topic_publication_fixture"}') AS result;
CREATE TEMP TABLE claimed AS SELECT value AS claim FROM jsonb_array_elements(plugin_data.csf_claim_activity_email_preparations(3));
SELECT extensions.is((SELECT jsonb_array_length(claim->'recipients') FROM claimed),3,'publication freezes the same recipients as the preview');
SELECT extensions.is((SELECT activity_email_snapshot->>'audienceVersion' FROM plugin_data.csf_publication_events WHERE id=(SELECT (result->>'emailEventId')::uuid FROM publication)),'2','new audience rules are tagged without rewriting old intents');
CREATE TEMP TABLE campaign AS SELECT (plugin_data.csf_open_activity_email_preparation_campaign('ef100000-0000-4000-8000-000000000001',(claim->>'eventId')::uuid,(claim->>'leaseToken')::uuid,'New activity: Fictional','Bring books.','<p>Bring books.</p>','{"csf_environment":"local"}','profile-audience-campaign')->>'campaignId')::uuid AS id FROM claimed;
SELECT plugin_data.csf_finalize_activity_email_campaign_content('ef100000-0000-4000-8000-000000000001',(SELECT id FROM campaign),'ef200000-0000-4000-8000-000000000001','profile-audience-content');
SELECT plugin_data.csf_snapshot_communication_recipients('ef100000-0000-4000-8000-000000000001',(SELECT id FROM campaign),(SELECT claim->'recipients' FROM claimed));
CREATE FUNCTION pg_temp.contact_allowed() RETURNS boolean LANGUAGE sql AS $$
 SELECT plugin_data.csf_publication_email_recipient_allowed('ef100000-0000-4000-8000-000000000001',id)
 FROM plugin_data.csf_communication_recipient_snapshots WHERE campaign_id=(SELECT id FROM campaign) AND normalized_recipient_email='profile-contact@local.test';
$$;
SELECT extensions.ok(pg_temp.contact_allowed(),'accountless class profile passes the actual delivery authorization');
CREATE FUNCTION pg_temp.application_contact_allowed() RETURNS boolean LANGUAGE sql AS $$
 SELECT plugin_data.csf_publication_email_recipient_allowed('ef100000-0000-4000-8000-000000000001',id)
 FROM plugin_data.csf_communication_recipient_snapshots WHERE campaign_id=(SELECT id FROM campaign) AND normalized_recipient_email='application-contact@local.test';
$$;
SELECT extensions.ok(pg_temp.application_contact_allowed(),'accountless application contact passes delivery authorization');
SAVEPOINT application_contact_changed;
UPDATE plugin_data.csf_term_applications SET most_checked_email='changed-application@local.test' WHERE id='ef600000-0000-4000-8000-000000000006';
SELECT extensions.ok(NOT pg_temp.application_contact_allowed(),'delivery rejects a changed application contact');
ROLLBACK TO application_contact_changed;
SAVEPOINT application_detached;
UPDATE plugin_data.csf_term_memberships SET application_id=NULL WHERE profile_id='ef300000-0000-4000-8000-000000000006';
SELECT extensions.ok(NOT pg_temp.application_contact_allowed(),'delivery rejects a detached application');
ROLLBACK TO application_detached;
SAVEPOINT membership_changed;
UPDATE plugin_data.csf_term_memberships SET status='withdrawn' WHERE profile_id='ef300000-0000-4000-8000-000000000004';
SELECT extensions.ok(NOT pg_temp.contact_allowed(),'withdrawn term membership blocks frozen delivery');
ROLLBACK TO membership_changed;
SAVEPOINT class_changed;
UPDATE plugin_data.csf_profile_cohort_memberships SET status='transferred' WHERE profile_id='ef300000-0000-4000-8000-000000000004';
SELECT extensions.ok(NOT pg_temp.contact_allowed(),'leaving the class blocks frozen delivery');
ROLLBACK TO class_changed;
SAVEPOINT address_changed;
UPDATE plugin_data.csf_profiles SET personal_email='changed@local.test' WHERE id='ef300000-0000-4000-8000-000000000004';
SELECT extensions.ok(NOT pg_temp.contact_allowed(),'changed profile address blocks sending to stale frozen contact');
ROLLBACK TO address_changed;
SELECT extensions.is(jsonb_array_length(plugin_data.csf_claim_activity_email_preparations(3)),0,'claimed publication cannot create duplicate preparation work');
SELECT * FROM extensions.finish();
ROLLBACK;
