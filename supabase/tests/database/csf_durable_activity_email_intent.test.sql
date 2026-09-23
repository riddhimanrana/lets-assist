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

INSERT INTO plugin_data.csf_cohort_terms(organization_id,cohort_id,term_id) VALUES('ef100000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001','ef500000-0000-4000-8000-000000000001');
CREATE FUNCTION pg_temp.publish(n integer,send_email boolean DEFAULT true,cohort uuid DEFAULT 'ef400000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
SELECT plugin_data.csf_create_activity_with_email('ef100000-0000-4000-8000-000000000001','ef500000-0000-4000-8000-000000000001',cohort,
jsonb_build_object('title','Fictional activity '||n,'body','<p>Frozen description.</p>','status','published','signupMode','none','pointValue',2,'pointType','non_drive'),
'ef200000-0000-4000-8000-000000000001',('ef800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,send_email,
'{"topicKey":"announcements","resendTopicId":"resend_topic_publication_fixture"}'); $$;
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_create_activity_with_email(uuid,uuid,uuid,jsonb,uuid,uuid,boolean,jsonb)','execute'),'browser cannot request durable activity emails');
SELECT extensions.is((plugin_data.csf_preview_activity_email('ef100000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000001','ef500000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001')->>'recipients')::integer,1,'preview uses the verified class audience without accepted membership');
CREATE TEMP TABLE published(n integer PRIMARY KEY,result jsonb);
INSERT INTO published VALUES(1,pg_temp.publish(1,false)),(2,pg_temp.publish(2));
SELECT extensions.is((SELECT result->>'emailStatus' FROM published WHERE n=1),'not_requested','publishing without opt-in records no email work');
SELECT extensions.is((SELECT result->>'emailStatus' FROM published WHERE n=2),'pending','publication atomically persists requested email work');
SELECT extensions.is(pg_temp.publish(2)->>'idempotent','true','a lost publication response replays the same request');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_events WHERE organization_id='ef100000-0000-4000-8000-000000000001' AND activity_email_requested),1,'publication retry does not create another intent');
SELECT extensions.throws_ok($q$SELECT pg_temp.publish(1,true)$q$,'22023',NULL,'a retry cannot change an earlier no-email choice');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_set_activity_status_with_email('ef100000-0000-4000-8000-000000000001',(SELECT (result->>'activityId')::uuid FROM published WHERE n=1),'published',NULL,'ef200000-0000-4000-8000-000000000001','ef800000-0000-4000-8000-000000000010',true,'{"topicKey":"announcements","resendTopicId":"resend_topic_publication_fixture"}')$q$,'P0001','Only draft activities can be published.','republishing cannot create an email for an earlier publication');
CREATE TEMP TABLE claimed AS SELECT value AS claim FROM jsonb_array_elements(plugin_data.csf_claim_activity_email_preparations(3));
SELECT extensions.is((SELECT count(*)::integer FROM claimed),1,'worker claims only the explicit pending intent');
SELECT extensions.is(jsonb_array_length(plugin_data.csf_claim_activity_email_preparations(3)),0,'another worker cannot claim the active lease');
SELECT extensions.is((SELECT claim#>>'{sourceSnapshot,body}' FROM claimed),'<p>Frozen description.</p>','worker receives the frozen publication body');
SELECT extensions.is((SELECT jsonb_array_length(claim->'recipients') FROM claimed),1,'worker receives one frozen class recipient');
UPDATE plugin_data.csf_opportunities SET body='<p>Later edit.</p>' WHERE id=(SELECT (result->>'activityId')::uuid FROM published WHERE n=2);
SELECT extensions.is((SELECT activity_email_snapshot#>>'{sourceSnapshot,body}' FROM plugin_data.csf_publication_events WHERE id=(SELECT (claim->>'eventId')::uuid FROM claimed)),'<p>Frozen description.</p>','later edits cannot change frozen email content');
SELECT extensions.throws_ok($q$UPDATE plugin_data.csf_publication_events SET activity_email_snapshot='{}' WHERE id=(SELECT (claim->>'eventId')::uuid FROM claimed)$q$,'55000',NULL,'the stored email snapshot is immutable');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_finish_activity_email_preparation('ef100000-0000-4000-8000-000000000001',(SELECT (claim->>'eventId')::uuid FROM claimed),gen_random_uuid(),NULL,'transient')$q$,'55000',NULL,'stale lease cannot finish another worker attempt');
CREATE TEMP TABLE campaign AS SELECT (plugin_data.csf_open_activity_email_preparation_campaign('ef100000-0000-4000-8000-000000000001',(claim->>'eventId')::uuid,(claim->>'leaseToken')::uuid,'New activity: Fictional activity 2','Frozen description.','<p>Frozen description.</p>','{"csf_environment":"local"}','intent-campaign')->>'campaignId')::uuid AS id FROM claimed;
SELECT extensions.is((SELECT activity_email_campaign_id FROM plugin_data.csf_publication_events WHERE id=(SELECT (claim->>'eventId')::uuid FROM claimed)),(SELECT id FROM campaign),'campaign creation immediately binds the durable intent before any response');
SELECT extensions.is((plugin_data.csf_open_activity_email_preparation_campaign('ef100000-0000-4000-8000-000000000001',(SELECT (claim->>'eventId')::uuid FROM claimed),(SELECT (claim->>'leaseToken')::uuid FROM claimed),'New activity: Fictional activity 2','Frozen description.','<p>Frozen description.</p>','{"csf_environment":"local"}','intent-campaign')->>'campaignId')::uuid,(SELECT id FROM campaign),'repeated preparation finds the same campaign');
SELECT plugin_data.csf_finalize_activity_email_campaign_content('ef100000-0000-4000-8000-000000000001',(SELECT id FROM campaign),'ef200000-0000-4000-8000-000000000001','intent-content');
SELECT plugin_data.csf_snapshot_communication_recipients('ef100000-0000-4000-8000-000000000001',(SELECT id FROM campaign),(SELECT claim->'recipients' FROM claimed));
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_communication_recipient_snapshots WHERE campaign_id=(SELECT id FROM campaign)),1,'only the frozen recipient is snapshotted');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_snapshot_communication_recipients('ef100000-0000-4000-8000-000000000001',(SELECT id FROM campaign),'[{"email":"injected@local.test","provenance":"account_email","profileId":"ef300000-0000-4000-8000-000000000003","userId":"ef200000-0000-4000-8000-000000000004"}]')$q$,'42501',NULL,'worker cannot expand the frozen audience');
UPDATE public.notification_settings SET email_notifications=false WHERE user_id='ef200000-0000-4000-8000-000000000002';
SELECT extensions.ok(NOT(SELECT plugin_data.csf_publication_email_recipient_allowed('ef100000-0000-4000-8000-000000000001',id) FROM plugin_data.csf_communication_recipient_snapshots WHERE campaign_id=(SELECT id FROM campaign)),'dispatch still respects a later email opt-out');
SELECT extensions.is((plugin_data.csf_finish_activity_email_preparation('ef100000-0000-4000-8000-000000000001',(SELECT (claim->>'eventId')::uuid FROM claimed),(SELECT (claim->>'leaseToken')::uuid FROM claimed),NULL,'transient')->>'status'),'pending','transient preparation failure remains durable for retry');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_memberships WHERE organization_id='ef100000-0000-4000-8000-000000000001'),0,'email preparation never grants semester membership');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_credit_records WHERE organization_id='ef100000-0000-4000-8000-000000000001'),0,'email preparation creates no credits');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_preview_activity_email('ef100000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000002','ef500000-0000-4000-8000-000000000001',NULL)$q$,'42501',NULL,'members cannot inspect activity email audiences');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_preview_activity_email('ef100000-0000-4000-8000-000000000002','ef200000-0000-4000-8000-000000000001','ef500000-0000-4000-8000-000000000001',NULL)$q$,'42501',NULL,'cross-chapter audience access is denied');
SELECT extensions.is(pg_temp.publish(30,true,NULL)->>'emailStatus','blocked','an empty term audience remains a visible durable outcome');
SAVEPOINT missing_topic;
UPDATE public.organization_plugin_installs SET configuration='{}' WHERE organization_id='ef100000-0000-4000-8000-000000000001' AND plugin_key='dvhs-csf';
SELECT extensions.throws_ok($q$SELECT pg_temp.publish(31)$q$,'55000',NULL,'missing email settings refuse the atomic publication');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_opportunities WHERE title='Fictional activity 31'),0,'failed email intent cannot leave a published activity without its requested intent');
ROLLBACK TO missing_topic;
UPDATE plugin_data.csf_publication_events SET activity_email_next_attempt_at=now() WHERE id=(SELECT (claim->>'eventId')::uuid FROM claimed);
SAVEPOINT source_move;
UPDATE plugin_data.csf_opportunities SET cohort_id='ef400000-0000-4000-8000-000000000002' WHERE id=(SELECT (result->>'activityId')::uuid FROM published WHERE n=2);
SELECT extensions.is(jsonb_array_length(plugin_data.csf_claim_activity_email_preparations(3)),0,'a changed class is not prepared');
SELECT extensions.is((SELECT activity_email_error_code FROM plugin_data.csf_publication_events WHERE id=(SELECT (claim->>'eventId')::uuid FROM claimed)),'source_changed','source changes have a specific recovery reason');
ROLLBACK TO source_move;
SAVEPOINT revoked_actor;
UPDATE public.organization_members SET role='member' WHERE organization_id='ef100000-0000-4000-8000-000000000001' AND user_id='ef200000-0000-4000-8000-000000000001';
SELECT extensions.is(jsonb_array_length(plugin_data.csf_claim_activity_email_preparations(3)),0,'revoked publisher authority blocks preparation');
SELECT extensions.is((SELECT activity_email_error_code FROM plugin_data.csf_publication_events WHERE id=(SELECT (claim->>'eventId')::uuid FROM claimed)),'unauthorized','revocation leaves an actionable status');
ROLLBACK TO revoked_actor;
SAVEPOINT changed_topic;
UPDATE public.organization_plugin_installs SET configuration=jsonb_set(configuration,'{communications,broadcastTopics,term_members,resendTopicId}','"changed_topic"') WHERE organization_id='ef100000-0000-4000-8000-000000000001';
SELECT extensions.is(jsonb_array_length(plugin_data.csf_claim_activity_email_preparations(3)),0,'topic changes cannot silently replace frozen consent scope');
SELECT extensions.is((SELECT activity_email_error_code FROM plugin_data.csf_publication_events WHERE id=(SELECT (claim->>'eventId')::uuid FROM claimed)),'topic_changed','topic change remains visible');
ROLLBACK TO changed_topic;
SAVEPOINT cancelled_campaign;
SELECT plugin_data.csf_cancel_communication_campaign('ef100000-0000-4000-8000-000000000001',(SELECT id FROM campaign),'Fictional cancellation','ef200000-0000-4000-8000-000000000001',NULL);
SELECT extensions.is(jsonb_array_length(plugin_data.csf_claim_activity_email_preparations(3)),0,'a cancelled campaign is not recreated by the worker');
SELECT extensions.is((SELECT activity_email_campaign_id FROM plugin_data.csf_publication_events WHERE id=(SELECT (claim->>'eventId')::uuid FROM claimed)),(SELECT id FROM campaign),'cancelled campaign identity remains bound');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_create_activity_email_campaign_draft('ef100000-0000-4000-8000-000000000001',(SELECT (result->>'activityId')::uuid FROM published WHERE n=2),'Replacement','Replacement','ef200000-0000-4000-8000-000000000001','ef500000-0000-4000-8000-000000000001','cohort_members','<p>Replacement</p>','announcements','resend_topic_publication_fixture','{"csf_environment":"local"}','replacement','ef400000-0000-4000-8000-000000000001')$q$,'55000',NULL,'even a direct campaign retry cannot replace a cancelled bound campaign');
ROLLBACK TO cancelled_campaign;
SAVEPOINT retry_limit;
UPDATE plugin_data.csf_publication_events SET activity_email_attempts=5 WHERE id=(SELECT (claim->>'eventId')::uuid FROM claimed);
SELECT extensions.is(jsonb_array_length(plugin_data.csf_claim_activity_email_preparations(3)),0,'automatic preparation retries are bounded');
SELECT extensions.is((SELECT activity_email_error_code FROM plugin_data.csf_publication_events WHERE id=(SELECT (claim->>'eventId')::uuid FROM claimed)),'retry_limit','exhausted attempts stay visible');
ROLLBACK TO retry_limit;
CREATE TEMP TABLE replacement_claim AS SELECT value AS claim FROM jsonb_array_elements(plugin_data.csf_claim_activity_email_preparations(3));
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_finish_activity_email_preparation('ef100000-0000-4000-8000-000000000001',(SELECT (claim->>'eventId')::uuid FROM claimed),(SELECT (claim->>'leaseToken')::uuid FROM claimed),NULL,'transient')$q$,'55000',NULL,'a replaced lease cannot finish the next attempt');
UPDATE public.notification_settings SET email_notifications=true WHERE user_id='ef200000-0000-4000-8000-000000000002';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_finalize_communication_recipient_snapshot('ef100000-0000-4000-8000-000000000001',(SELECT id FROM campaign),1)$q$,'55000',NULL,'generic finalization cannot bypass the preparation lease');
SAVEPOINT expired_finalize;
UPDATE plugin_data.csf_publication_events SET activity_email_lease_expires_at=now()-interval '1 minute' WHERE id=(SELECT (claim->>'eventId')::uuid FROM replacement_claim);
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_finalize_activity_email_preparation_campaign('ef100000-0000-4000-8000-000000000001',(SELECT (claim->>'eventId')::uuid FROM replacement_claim),(SELECT (claim->>'leaseToken')::uuid FROM replacement_claim),(SELECT id FROM campaign),1)$q$,'55000',NULL,'expired worker cannot queue after preparation');
SELECT extensions.is((SELECT status FROM plugin_data.csf_communication_campaigns WHERE id=(SELECT id FROM campaign)),'draft','stale finalization creates no sendable campaign');
ROLLBACK TO expired_finalize;
SAVEPOINT revoked_finalize;
UPDATE public.organization_members SET role='member' WHERE organization_id='ef100000-0000-4000-8000-000000000001' AND user_id='ef200000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_finalize_activity_email_preparation_campaign('ef100000-0000-4000-8000-000000000001',(SELECT (claim->>'eventId')::uuid FROM replacement_claim),(SELECT (claim->>'leaseToken')::uuid FROM replacement_claim),(SELECT id FROM campaign),1)$q$,'42501',NULL,'publisher revocation prevents the final queue transition');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_communication_dispatch_attempts WHERE campaign_id=(SELECT id FROM campaign)),0,'refused finalization creates no delivery attempts');
ROLLBACK TO revoked_finalize;

SELECT plugin_data.csf_finalize_activity_email_preparation_campaign('ef100000-0000-4000-8000-000000000001',(SELECT (claim->>'eventId')::uuid FROM replacement_claim),(SELECT (claim->>'leaseToken')::uuid FROM replacement_claim),(SELECT id FROM campaign),1);
SELECT extensions.is((plugin_data.csf_finish_activity_email_preparation('ef100000-0000-4000-8000-000000000001',(SELECT (claim->>'eventId')::uuid FROM replacement_claim),(SELECT (claim->>'leaseToken')::uuid FROM replacement_claim),(SELECT id FROM campaign),NULL)->>'status'),'queued','prepared campaign closes the durable handoff');
SELECT extensions.is(jsonb_array_length(plugin_data.csf_claim_activity_email_preparations(3)),0,'queued campaign is never prepared again');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,personal_email,normalized_personal_email)
VALUES('ef300000-0000-4000-8000-000000000004','ef100000-0000-4000-8000-000000000001','Fictional','Accountless','fictional','accountless','accountless@local.test','accountless@local.test');
INSERT INTO plugin_data.csf_term_memberships(organization_id,profile_id,term_id,status)
VALUES('ef100000-0000-4000-8000-000000000001','ef300000-0000-4000-8000-000000000001','ef500000-0000-4000-8000-000000000001','accepted'),
('ef100000-0000-4000-8000-000000000001','ef300000-0000-4000-8000-000000000004','ef500000-0000-4000-8000-000000000001','active');
INSERT INTO published VALUES(40,pg_temp.publish(40,true,NULL));
SELECT extensions.is((SELECT jsonb_array_length(activity_email_snapshot->'recipients') FROM plugin_data.csf_publication_events WHERE id=(SELECT (result->>'emailEventId')::uuid FROM published WHERE n=40)),2,'term email keeps accepted account and accountless profile recipients');
SELECT extensions.ok((SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(activity_email_snapshot->'recipients') r WHERE r->>'email'='accountless@local.test' AND NOT(r?'userId')) FROM plugin_data.csf_publication_events WHERE id=(SELECT (result->>'emailEventId')::uuid FROM published WHERE n=40)),'accountless term member retains the exact chapter contact without inventing an account');

SELECT * FROM extensions.finish();
ROLLBACK;
