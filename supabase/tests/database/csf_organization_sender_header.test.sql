-- Synthetic provider payloads. No messages leave the database.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(11);
INSERT INTO public.organizations(id,name,username,type,join_code)
 VALUES('ed100000-0000-4000-8000-000000000001','Header fixture','header-fixture','school','515001');
CREATE TEMP TABLE header_cases(name text, expected text);
INSERT INTO header_cases VALUES
 ('Example School, CSF','"Example School, CSF" <updates@notifications.lets-assist.com>'),
 ('Chapter "A"',E'"Chapter \\"A\\"" <updates@notifications.lets-assist.com>'),
 (E'Chapter \\ A',E'"Chapter \\\\ A" <updates@notifications.lets-assist.com>'),
 ('School: [CSF] @ North; (Chapter)','"School: [CSF] @ North; (Chapter)" <updates@notifications.lets-assist.com>'),
 ('Plain Chapter','"Plain Chapter" <updates@notifications.lets-assist.com>'),
 ('École CSF','"École CSF" <updates@notifications.lets-assist.com>'),
 (E'Chapter\r\nBcc:Other','"ChapterBcc:Other" <updates@notifications.lets-assist.com>');
ALTER TABLE header_cases ADD COLUMN sender_email text DEFAULT 'csf@notifications.lets-assist.com';
INSERT INTO header_cases VALUES ('DVHS CSF (Let''s Assist)','DVHS CSF (Let''s Assist) <projects@notifications.lets-assist.com>','projects@notifications.lets-assist.com');
CREATE TEMP TABLE header_results(name text, actual text, expected text, reply_to text, stable boolean);
DO $$
DECLARE r record; v_campaign uuid; v_recipient uuid; v_request jsonb;
BEGIN
 FOR r IN SELECT * FROM header_cases LOOP
  UPDATE public.organizations SET name=r.name WHERE id='ed100000-0000-4000-8000-000000000001';
  INSERT INTO plugin_data.csf_communication_campaigns(organization_id,campaign_kind,status,sender_name,sender_email,reply_to_email,subject,metadata,audience_snapshot_version,provider_idempotency_key)
   VALUES('ed100000-0000-4000-8000-000000000001','transactional','draft',CASE WHEN r.sender_email='projects@notifications.lets-assist.com' THEN r.name ELSE 'DVHS CSF' END,r.sender_email,'dvhighcsf@gmail.com','Header fixture','{"csf_environment":"local"}',1,gen_random_uuid()::text)
   RETURNING id INTO v_campaign;
  INSERT INTO plugin_data.csf_communication_recipient_snapshots(organization_id,campaign_id,snapshot_version,recipient_email,subscription_decision)
   VALUES('ed100000-0000-4000-8000-000000000001',v_campaign,1,'fictional@local.test','included') RETURNING id INTO v_recipient;
  v_request := plugin_data.csf_communication_provider_request('ed100000-0000-4000-8000-000000000001',v_campaign,v_recipient,'ed200000-0000-4000-8000-000000000001',1);
  INSERT INTO header_results VALUES(r.name,v_request#>>'{providerPayload,from}',r.expected,v_request#>>'{providerPayload,replyTo}',
   v_request=plugin_data.csf_communication_provider_request('ed100000-0000-4000-8000-000000000001',v_campaign,v_recipient,'ed200000-0000-4000-8000-000000000001',1));
 END LOOP;
END;
$$;
SELECT extensions.is(actual,expected,'sender header preserves and quotes '||name) FROM header_results;
SELECT extensions.ok(bool_and(reply_to='dvhighcsf@gmail.com'),'the monitored Reply-To is unchanged') FROM header_results;
SELECT extensions.ok(bool_and(stable),'request retries retain the same payload') FROM header_results;
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_communication_provider_request(uuid,uuid,uuid,uuid,integer)','EXECUTE'),
 'provider payloads remain unavailable to clients');
SELECT * FROM extensions.finish();
ROLLBACK;
