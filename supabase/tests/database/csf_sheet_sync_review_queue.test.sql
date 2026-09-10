BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) VALUES
('ea000000-0000-4000-8000-000000000001','authenticated','authenticated','sheet-admin@local.test','{}','{}'),
('ea000000-0000-4000-8000-000000000002','authenticated','authenticated','sheet-outsider@local.test','{}','{}');
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES
('ea100000-0000-4000-8000-000000000001','Sheet sync fixtures','sheet-sync-fixtures','school','739284'),
('ea100000-0000-4000-8000-000000000002','Sheet sync other','sheet-sync-other','school','739285');
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester) VALUES('ea200000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000001','F30','Fall 2030','2030-2031','fall');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label) VALUES('ea500000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000001',2033,'Class of 2033');
SELECT plugin_data.csf_register_sheet_sync_test_workspace('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name) VALUES
('ea300000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000001','Test','Student','test','student'),
('ea300000-0000-4000-8000-000000000002','ea100000-0000-4000-8000-000000000002','Other','Student','other','student');
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id) VALUES('ea100000-0000-4000-8000-000000000001','ea300000-0000-4000-8000-000000000001','ea500000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_term_applications(id,organization_id,profile_id,cohort_id,term_id,source,status) VALUES('ea600000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000001','ea300000-0000-4000-8000-000000000001','ea500000-0000-4000-8000-000000000001','ea200000-0000-4000-8000-000000000001','manual','submitted');
CREATE TEMP TABLE sync_fixture(name text PRIMARY KEY,value jsonb);
INSERT INTO sync_fixture VALUES('destination',plugin_data.csf_configure_sheet_sync_destination('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001','fixture-sheet-copy',0,'applications','ea500000-0000-4000-8000-000000000001','ea200000-0000-4000-8000-000000000001',true,23,'["Record ID","Status"]'));
SELECT extensions.is((SELECT value->>'enabled' FROM sync_fixture WHERE name='destination'),'false','destinations start disabled');
SELECT extensions.ok(NOT has_table_privilege('authenticated','plugin_data.csf_sheet_sync_changes','SELECT'),'browser cannot read inbound changes');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_review_sheet_sync_change(uuid,uuid,uuid,boolean,text)','EXECUTE'),'browser cannot invoke privileged reviews');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_configure_sheet_sync_destination('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000002','fixture-untrusted',0,'applications',NULL,'ea200000-0000-4000-8000-000000000001',true)$$,'P0001','Not authorized.','outsider cannot configure');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_configure_sheet_sync_destination('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001','fixture-sheet-copy',0,'applications',NULL,'ea200000-0000-4000-8000-000000000001',true)$$,'P0001','This spreadsheet is already bound to a different destination.','configuration retry cannot retarget class');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_set_sheet_sync_destination_state('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM sync_fixture WHERE name='destination'),true,true,'blocked')$$,'23514',NULL,'unavailable native comments prevent enablement');
SELECT plugin_data.csf_set_sheet_sync_destination_state('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM sync_fixture WHERE name='destination'),true,true,'available');
INSERT INTO sync_fixture VALUES('export',plugin_data.csf_queue_sheet_sync_record('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM sync_fixture WHERE name='destination'),'application','ea600000-0000-4000-8000-000000000001'));
SELECT plugin_data.csf_queue_sheet_sync_record('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM sync_fixture WHERE name='destination'),'application','ea600000-0000-4000-8000-000000000001');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id='ea100000-0000-4000-8000-000000000001'),1::bigint,'repeat snapshot creates one export');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_sheet_sync_snapshot('ea100000-0000-4000-8000-000000000001','profile','ea300000-0000-4000-8000-000000000002')$$,'P0001','Record not found.','snapshot excludes another organization');
INSERT INTO sync_fixture VALUES('lease',plugin_data.csf_claim_sheet_sync_destination('ea100000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM sync_fixture WHERE name='destination'),true));
SELECT extensions.ok(plugin_data.csf_claim_sheet_sync_destination('ea100000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM sync_fixture WHERE name='destination'),true) IS NULL,'manual and cron cannot share a destination lease');
INSERT INTO sync_fixture SELECT 'claimed',to_jsonb(l) FROM plugin_data.csf_claim_sheet_sync_exports('ea100000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM sync_fixture WHERE name='destination'),(SELECT (value->>'poll_lease_token')::uuid FROM sync_fixture WHERE name='lease'),25) l;
SELECT plugin_data.csf_finish_sheet_sync_export('ea100000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM sync_fixture WHERE name='claimed'),(SELECT (value->>'lease_token')::uuid FROM sync_fixture WHERE name='claimed'),'exported','remote-v1',NULL);
INSERT INTO sync_fixture VALUES('change',plugin_data.csf_record_sheet_sync_change('ea100000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM sync_fixture WHERE name='destination'),'application','ea600000-0000-4000-8000-000000000001',(SELECT value->>'source_version' FROM sync_fixture WHERE name='export'),'remote-v2','{"action":"approved","author_display_name":"Not a verified officer"}'));
SELECT extensions.is((SELECT status FROM plugin_data.csf_term_applications WHERE id='ea600000-0000-4000-8000-000000000001'),'submitted','Sheet decision does not approve the application');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_review_sheet_sync_change('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000002',(SELECT (value->>'id')::uuid FROM sync_fixture WHERE name='change'),true,'Approve')$$,'P0001','Not authorized.','unverified external author grants no review authority');
UPDATE plugin_data.csf_term_applications SET updated_at=now()+interval '1 second' WHERE id='ea600000-0000-4000-8000-000000000001';
SELECT extensions.is(plugin_data.csf_review_sheet_sync_change('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM sync_fixture WHERE name='change'),true,'Review current record')->>'status','stale','newer application prevents stale decision');
SELECT extensions.is((SELECT status FROM plugin_data.csf_term_applications WHERE id='ea600000-0000-4000-8000-000000000001'),'submitted','stale suggestion preserves current decision');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_profile_accounts WHERE organization_id='ea100000-0000-4000-8000-000000000001'),0::bigint,'sync never links an account');
SELECT plugin_data.csf_set_sheet_sync_destination_state('ea100000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM sync_fixture WHERE name='destination'),false,true,'available');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_assert_sheet_sync_destination_lease('ea100000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM sync_fixture WHERE name='destination'),(SELECT (value->>'poll_lease_token')::uuid FROM sync_fixture WHERE name='lease'))$$,'P0001','Sync lease expired or access changed.','disabling sync invalidates existing lease');
SELECT * FROM extensions.finish();
ROLLBACK;
