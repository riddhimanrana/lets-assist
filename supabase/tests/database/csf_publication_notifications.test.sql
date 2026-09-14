-- Synthetic publication and lease behavior. No provider calls.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(37);
-- Emit schema-only receipts before fixtures, including when a later test fails.
DO $receipt$
DECLARE v_receipt jsonb;
BEGIN
WITH signatures(signature) AS (
  VALUES
    ('plugin_data.csf_publication_account_is_owned(uuid,uuid,uuid)'),
    ('plugin_data.csf_publication_recipient_allowed(uuid,text,uuid,uuid)'),
    ('plugin_data.csf_record_publication_notifications()'),
    ('plugin_data.csf_claim_publication_notifications(integer)'),
    ('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)'),
    ('plugin_data.csf_finish_publication_notification(uuid,uuid,uuid,text)'),
    ('plugin_data.csf_publication_email_recipient_allowed(uuid,uuid)'),
    ('plugin_data.csf_authorize_communication_dispatch(uuid,uuid,text,text)')
), functions AS (
  SELECT signature,md5(pg_get_functiondef(p.oid)) AS definition_md5,
    pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS security_definer,
    p.provolatile AS volatility,p.proconfig AS settings,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
    (SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type)
      FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) AS acl
  FROM signatures JOIN pg_proc p ON p.oid=to_regprocedure(signature)
), relations AS (
SELECT c.relname, md5(jsonb_build_object(
  'owner', pg_get_userbyid(c.relowner), 'kind', c.relkind,
  'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
  'acl', c.relacl::text,
  'columns', (SELECT jsonb_agg(jsonb_build_array(a.attname,
    format_type(a.atttypid,a.atttypmod), a.attnotnull,
    pg_get_expr(d.adbin,d.adrelid), a.attidentity, a.attgenerated, a.attacl::text)
    ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d
    ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'constraints', (SELECT jsonb_agg(jsonb_build_array(k.conname,
    pg_get_constraintdef(k.oid),k.convalidated,k.condeferrable,k.condeferred)
    ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid),
  'indexes', (SELECT jsonb_agg(jsonb_build_array(pg_get_indexdef(i.indexrelid),
    i.indisvalid,i.indisready) ORDER BY pg_get_indexdef(i.indexrelid) COLLATE "C")
    FROM pg_index i WHERE i.indrelid=c.oid),
  'triggers', (SELECT jsonb_agg(jsonb_build_array(pg_get_triggerdef(t.oid),
    t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t
    WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
  'policies', (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)
)::text) AS digest,
NOT EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) roles(name)
  WHERE has_table_privilege(roles.name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege(roles.name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) AS runtime_denied
FROM pg_class c WHERE c.relpersistence = 'p' AND c.oid IN (
  to_regclass('plugin_data.csf_publication_events'),
  to_regclass('plugin_data.csf_publication_notification_deliveries'))
), tables AS (
  SELECT c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
    has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
    has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select,
    has_table_privilege('service_role',c.oid,'SELECT') AS service_select,
    has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE') AS service_write
  FROM pg_class c WHERE c.oid IN ('plugin_data.csf_publication_events'::regclass,
    'plugin_data.csf_publication_notification_deliveries'::regclass)
)
SELECT jsonb_build_object('migration','20260914033117','functionCount',(SELECT count(*) FROM functions),
  'functions',(SELECT jsonb_agg(to_jsonb(f) ORDER BY signature) FROM functions f),
  'relations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY relname) FROM relations r),
  'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY name) FROM tables t)) INTO v_receipt
;
RAISE NOTICE 'publication_schema_receipt: %', v_receipt;
END;
$receipt$;

SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_events WHERE organization_id='ec100000-0000-4000-8000-000000000001'),0,'the fictional organization starts without publication events');

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

SELECT extensions.ok((SELECT organization_updates FROM public.notification_settings WHERE user_id='ec200000-0000-4000-8000-000000000002'),'organization updates default on');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_table_privilege(r,'plugin_data.csf_publication_events','SELECT') OR has_table_privilege(r,'plugin_data.csf_publication_notification_deliveries','INSERT')),'browser and service roles cannot access the outbox tables directly');
SELECT extensions.ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('plugin_data.csf_publication_events'::regclass,'plugin_data.csf_publication_notification_deliveries'::regclass)),'both outbox tables have RLS');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r CROSS JOIN unnest(ARRAY['plugin_data.csf_claim_publication_notifications(integer)','plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)','plugin_data.csf_finish_publication_notification(uuid,uuid,uuid,text)']) f WHERE has_function_privilege(r,f,'EXECUTE')),'browser roles cannot claim, authorize, or settle notices');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['plugin_data.csf_publication_account_is_owned(uuid,uuid,uuid)','plugin_data.csf_publication_recipient_allowed(uuid,text,uuid,uuid)','plugin_data.csf_record_publication_notifications()','plugin_data.csf_publication_email_recipient_allowed(uuid,uuid)']) f WHERE has_function_privilege('service_role',f,'EXECUTE')),'internal helpers remain owner-only');
CREATE TEMP TABLE publication_test_ids(kind text PRIMARY KEY,id uuid);
INSERT INTO publication_test_ids SELECT 'post',(plugin_data.csf_mutate_post('ec100000-0000-4000-8000-000000000001','create',NULL,'{"title":"Fictional post","body":"Synthetic text.","audience":"members","audienceCohortId":null,"pinned":false,"scheduledFor":null,"publish":true,"sendEmail":false}', 'ec200000-0000-4000-8000-000000000001','ec600000-0000-4000-8000-000000000001')->>'postId')::uuid;
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_events WHERE organization_id='ec100000-0000-4000-8000-000000000001'),1,'create-published records one event in the publication transaction');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_notification_deliveries WHERE organization_id='ec100000-0000-4000-8000-000000000001'),5,'organization-wide post recipients follow the current member-feed visibility');
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_mutate_post('ec100000-0000-4000-8000-000000000001','create',NULL,'{"title":"Fictional post","body":"Synthetic text.","audience":"members","audienceCohortId":null,"pinned":false,"scheduledFor":null,"publish":true,"sendEmail":false}','ec200000-0000-4000-8000-000000000001','ec600000-0000-4000-8000-000000000001')$q$,'same request can replay');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_events WHERE organization_id='ec100000-0000-4000-8000-000000000001'),1,'publication retry does not duplicate its event');
UPDATE plugin_data.csf_announcements SET body='Edited fictional text.' WHERE id=(SELECT id FROM publication_test_ids WHERE kind='post');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_events WHERE organization_id='ec100000-0000-4000-8000-000000000001'),1,'ordinary edits do not notify');
INSERT INTO publication_test_ids SELECT 'activity',(plugin_data.csf_create_activity('ec100000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001',NULL,'{"title":"Fictional activity","status":"published","signupMode":"none","pointValue":1}','ec200000-0000-4000-8000-000000000001','ec600000-0000-4000-8000-000000000002')->>'activityId')::uuid;
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_notification_deliveries d JOIN plugin_data.csf_publication_events e ON e.id=d.event_id WHERE e.source_kind='activity' AND e.organization_id='ec100000-0000-4000-8000-000000000001'),5,'chapter-wide activities follow the public activity reader for active organization members');
INSERT INTO publication_test_ids SELECT 'draft',(plugin_data.csf_create_activity('ec100000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001',NULL,'{"title":"Fictional draft","status":"draft","signupMode":"none","pointValue":1}','ec200000-0000-4000-8000-000000000001','ec600000-0000-4000-8000-000000000003')->>'activityId')::uuid;
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_events WHERE organization_id='ec100000-0000-4000-8000-000000000001'),2,'draft creation records no publication');
SELECT plugin_data.csf_set_activity_status('ec100000-0000-4000-8000-000000000001',(SELECT id FROM publication_test_ids WHERE kind='draft'),'published','Fictional publication','ec200000-0000-4000-8000-000000000001','ec600000-0000-4000-8000-000000000004');
SELECT plugin_data.csf_set_activity_status('ec100000-0000-4000-8000-000000000001',(SELECT id FROM publication_test_ids WHERE kind='draft'),'published','Fictional publication','ec200000-0000-4000-8000-000000000001','ec600000-0000-4000-8000-000000000004');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_events WHERE organization_id='ec100000-0000-4000-8000-000000000001'),3,'draft publication and replay produce one event');
INSERT INTO plugin_data.csf_announcements(id,organization_id,title,body,audience,audience_cohort_id,status,published_at,created_by,updated_by) VALUES
('ec700000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000001','Fictional class post','Synthetic text.','class','ec400000-0000-4000-8000-000000000001','published',now(),'ec200000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000001'),
('ec700000-0000-4000-8000-000000000002','ec100000-0000-4000-8000-000000000001','Fictional officer post','Synthetic text.','officers',NULL,'published',now(),'ec200000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000001');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_notification_deliveries d JOIN plugin_data.csf_publication_events e ON e.id=d.event_id WHERE e.source_id='ec700000-0000-4000-8000-000000000001'),1,'class post excludes pending links, other classes, and unlinked accounts');
SELECT extensions.is((SELECT user_id FROM plugin_data.csf_publication_notification_deliveries d JOIN plugin_data.csf_publication_events e ON e.id=d.event_id WHERE e.source_id='ec700000-0000-4000-8000-000000000001'),'ec200000-0000-4000-8000-000000000002'::uuid,'class notice targets the actual verified user');
SELECT extensions.is((SELECT user_id FROM plugin_data.csf_publication_notification_deliveries d JOIN plugin_data.csf_publication_events e ON e.id=d.event_id WHERE e.source_id='ec700000-0000-4000-8000-000000000002'),'ec200000-0000-4000-8000-000000000001'::uuid,'authorized officer without a CSF profile receives the officer post');
SELECT extensions.ok(NOT plugin_data.csf_publication_recipient_allowed('ec100000-0000-4000-8000-000000000002','post','ec700000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000002'),'cross-organization coordinates fail closed');
-- Limit the remaining lease exercises to this one fictional class delivery.
UPDATE plugin_data.csf_publication_notification_deliveries SET status='skipped',completed_at=now() WHERE event_id NOT IN(SELECT id FROM plugin_data.csf_publication_events WHERE source_id='ec700000-0000-4000-8000-000000000001');
CREATE TEMP TABLE publication_claim AS SELECT plugin_data.csf_claim_publication_notifications(1)->0 AS value;
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_notification_deliveries WHERE status='processing'),1,'claim leases only the requested row');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_authorize_publication_notification('ec100000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM publication_claim),'ec800000-0000-4000-8000-000000000001')$q$,'40001','Notification lease is not current.','an incorrect lease token cannot authorize');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_authorize_publication_notification('ec100000-0000-4000-8000-000000000002',(SELECT (value->>'id')::uuid FROM publication_claim),(SELECT (value->>'leaseToken')::uuid FROM publication_claim))$q$,'40001','Notification lease is not current.','the lease is organization-scoped');
UPDATE public.organization_plugin_entitlements SET status='inactive' WHERE organization_id='ec100000-0000-4000-8000-000000000001' AND plugin_key='dvhs-csf';
SELECT extensions.ok(NOT plugin_data.csf_publication_recipient_allowed('ec100000-0000-4000-8000-000000000001','post','ec700000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000002'),'revoked plugin entitlement suppresses queued publication delivery');
UPDATE public.organization_plugin_entitlements SET status='active',starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE organization_id='ec100000-0000-4000-8000-000000000001' AND plugin_key='dvhs-csf';
SELECT extensions.ok(NOT plugin_data.csf_publication_recipient_allowed('ec100000-0000-4000-8000-000000000001','post','ec700000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000002'),'expired plugin entitlement suppresses queued publication delivery');
UPDATE public.organization_plugin_entitlements SET ends_at=NULL WHERE organization_id='ec100000-0000-4000-8000-000000000001' AND plugin_key='dvhs-csf';
CREATE TEMP TABLE publication_notice AS SELECT plugin_data.csf_authorize_publication_notification('ec100000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM publication_claim),(SELECT (value->>'leaseToken')::uuid FROM publication_claim)) AS value;
SELECT extensions.is((SELECT value->>'authorized' FROM publication_notice),'true','current verified recipient is authorized');
SELECT extensions.ok((SELECT value->>'actionUrl'='/organization/ec100000-0000-4000-8000-000000000001?tab=csf-home' AND NOT(value ? 'title') AND NOT(value ? 'body') AND NOT(value ? 'email') FROM publication_notice),'authorization exposes only a checked route and identifiers');
SELECT plugin_data.csf_finish_publication_notification('ec100000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM publication_claim),(SELECT (value->>'leaseToken')::uuid FROM publication_claim),'retryable');
SELECT extensions.ok((SELECT status='queued' AND next_attempt_at>now() AND lease_token IS NULL FROM plugin_data.csf_publication_notification_deliveries WHERE id=(SELECT (value->>'id')::uuid FROM publication_claim)),'retryable insertion waits before another claim and clears its lease');
SELECT extensions.is(plugin_data.csf_claim_publication_notifications(1),'[]'::jsonb,'backoff prevents immediate reclaim');
UPDATE plugin_data.csf_publication_notification_deliveries SET next_attempt_at=now()-interval '1 second' WHERE status='queued';
UPDATE publication_claim SET value=plugin_data.csf_claim_publication_notifications(1)->0;
SELECT extensions.is(plugin_data.csf_authorize_publication_notification('ec100000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM publication_claim),(SELECT (value->>'leaseToken')::uuid FROM publication_claim))->>'dedupeKey',(SELECT value->>'dedupeKey' FROM publication_notice),'retry preserves the host notification dedupe key');
UPDATE public.notification_settings SET organization_updates=false WHERE user_id='ec200000-0000-4000-8000-000000000002';
SELECT extensions.is(plugin_data.csf_authorize_publication_notification('ec100000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM publication_claim),(SELECT (value->>'leaseToken')::uuid FROM publication_claim)),'{"authorized":false}'::jsonb,'preference changes after queueing suppress delivery');
SELECT extensions.is((SELECT status FROM plugin_data.csf_publication_notification_deliveries WHERE id=(SELECT (value->>'id')::uuid FROM publication_claim)),'skipped','refusal durably settles without sending');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_finish_publication_notification('ec100000-0000-4000-8000-000000000001',(SELECT (value->>'id')::uuid FROM publication_claim),(SELECT (value->>'leaseToken')::uuid FROM publication_claim),'delivered')$q$,'40001','Notification lease is not current.','stale completion cannot overwrite a settled refusal');
UPDATE plugin_data.csf_profile_accounts SET connection_basis='unknown' WHERE user_id='ec200000-0000-4000-8000-000000000002';
SELECT extensions.ok(NOT plugin_data.csf_publication_recipient_allowed('ec100000-0000-4000-8000-000000000001','post','ec700000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000002'),'verified status with unknown ownership cannot authorize a class notice');
UPDATE plugin_data.csf_profile_accounts SET connection_basis='verified_email' WHERE user_id='ec200000-0000-4000-8000-000000000002';
SELECT extensions.ok(NOT plugin_data.csf_publication_account_is_owned('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000002'),'verified-email label without independently owned source metadata fails closed');
UPDATE plugin_data.csf_profiles SET source_summary='{"createdBy":"permanent_class_code","accountOwnerUserId":"ec200000-0000-4000-8000-000000000002"}' WHERE id='ec300000-0000-4000-8000-000000000001';
SELECT extensions.ok(plugin_data.csf_publication_account_is_owned('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000002'),'independent verified-email creation metadata retains ownership');
UPDATE plugin_data.csf_profile_accounts SET status='revoked' WHERE user_id='ec200000-0000-4000-8000-000000000002';
SELECT extensions.ok(NOT plugin_data.csf_publication_recipient_allowed('ec100000-0000-4000-8000-000000000001','post','ec700000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000002'),'revoked account connection loses class notice access');
DELETE FROM public.organization_members WHERE user_id='ec200000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT plugin_data.csf_publication_recipient_allowed('ec100000-0000-4000-8000-000000000001','post','ec700000-0000-4000-8000-000000000002','ec200000-0000-4000-8000-000000000001'),'revoked organization membership loses officer notice access');
SELECT extensions.is((SELECT count(*)::integer FROM public.notifications WHERE user_id IN('ec200000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000002','ec200000-0000-4000-8000-000000000003','ec200000-0000-4000-8000-000000000004','ec200000-0000-4000-8000-000000000005')),0,'database preparation does not send or insert host notifications');
SELECT * FROM extensions.finish();
ROLLBACK;
