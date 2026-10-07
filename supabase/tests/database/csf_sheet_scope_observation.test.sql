BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(33);
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
 VALUES('fb900000-0000-4000-8000-000000000001','authenticated','authenticated','scope-admin@local.test','{}','{}');
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES
 ('fb910000-0000-4000-8000-000000000001','Scope chapter','scope-chapter','school','839981'),
 ('fb910000-0000-4000-8000-000000000002','Other scope chapter','scope-other','school','839982');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
 VALUES('fb910000-0000-4000-8000-000000000001','fb900000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester) VALUES
 ('fb920000-0000-4000-8000-000000000001','fb910000-0000-4000-8000-000000000001','F30','Fall 2030','2030-2031','fall'),
 ('fb920000-0000-4000-8000-000000000002','fb910000-0000-4000-8000-000000000001','S31','Spring 2031','2030-2031','spring');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label) VALUES
 ('fb930000-0000-4000-8000-000000000001','fb910000-0000-4000-8000-000000000001',2033,'Class of 2033'),
 ('fb930000-0000-4000-8000-000000000002','fb910000-0000-4000-8000-000000000001',2034,'Class of 2034');
INSERT INTO plugin_data.csf_cohort_terms(organization_id,cohort_id,term_id)
 VALUES('fb910000-0000-4000-8000-000000000001','fb930000-0000-4000-8000-000000000001','fb920000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name)
 SELECT ('fb940000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fb910000-0000-4000-8000-000000000001',
  'Fictional','Student '||n,'fictional','student '||n FROM generate_series(1,500) n;
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name)
 VALUES('fb940000-0000-4000-8000-000000900001','fb910000-0000-4000-8000-000000000002','Other','Fictional','other','fictional');
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id)
 SELECT organization_id,id,'fb930000-0000-4000-8000-000000000001' FROM plugin_data.csf_profiles
 WHERE organization_id='fb910000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_term_applications(id,organization_id,profile_id,cohort_id,term_id,source,status,application_data)
 SELECT ('fb950000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fb910000-0000-4000-8000-000000000001',
  ('fb940000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fb930000-0000-4000-8000-000000000001',
  'fb920000-0000-4000-8000-000000000001','manual','submitted',
  jsonb_build_object('synthetic_history',repeat('Fixture-only retained detail. ',100)) FROM generate_series(1,100) n;
INSERT INTO plugin_data.csf_term_applications(id,organization_id,profile_id,cohort_id,term_id,source,status) VALUES
 ('fb950000-0000-4000-8000-000000000101','fb910000-0000-4000-8000-000000000001','fb940000-0000-4000-8000-000000000001','fb930000-0000-4000-8000-000000000001','fb920000-0000-4000-8000-000000000002','manual','submitted'),
 ('fb950000-0000-4000-8000-000000000102','fb910000-0000-4000-8000-000000000001','fb940000-0000-4000-8000-000000000102','fb930000-0000-4000-8000-000000000002','fb920000-0000-4000-8000-000000000001','manual','submitted');
INSERT INTO plugin_data.csf_point_submissions(id,organization_id,profile_id,term_id,source,status,description,claimed_points) VALUES
 ('fb960000-0000-4000-8000-000000000001','fb910000-0000-4000-8000-000000000001','fb940000-0000-4000-8000-000000000001','fb920000-0000-4000-8000-000000000001','manual','submitted','Fictional activity',1),
 ('fb960000-0000-4000-8000-000000000002','fb910000-0000-4000-8000-000000000001','fb940000-0000-4000-8000-000000000001','fb920000-0000-4000-8000-000000000002','manual','submitted','Other fictional term',1);
INSERT INTO plugin_data.csf_sheet_sync_destinations(id,organization_id,spreadsheet_file_id,sheet_id,kind,cohort_id,term_id,is_test,configured_by)
 SELECT ('fb970000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fb910000-0000-4000-8000-000000000001',
  'fictional-scope-sheet-'||n,0,kind,'fb930000-0000-4000-8000-000000000001','fb920000-0000-4000-8000-000000000001',false,'fb900000-0000-4000-8000-000000000001'
 FROM (VALUES(1,'class'),(2,'applications'),(3,'point_submissions')) fixture(n,kind);
INSERT INTO plugin_data.csf_sheet_sync_bindings(organization_id,destination_id,record_kind,record_id,profile_id,logical_key,sheet_id,scope_revision)
 SELECT organization_id,'fb970000-0000-4000-8000-000000000001','profile',id,id,'profile:'||id,0,7
 FROM plugin_data.csf_profiles WHERE organization_id='fb910000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_sheet_sync_bindings(organization_id,destination_id,record_kind,record_id,profile_id,logical_key,sheet_id,scope_revision)
 SELECT organization_id,'fb970000-0000-4000-8000-000000000002','application',id,profile_id,'application:'||id,0,11
 FROM plugin_data.csf_term_applications WHERE organization_id='fb910000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_sheet_sync_bindings(organization_id,destination_id,record_kind,record_id,profile_id,logical_key,sheet_id,scope_revision)
 SELECT organization_id,'fb970000-0000-4000-8000-000000000003','point_submission',id,profile_id,'point_submission:'||id,0,13
 FROM plugin_data.csf_point_submissions WHERE organization_id='fb910000-0000-4000-8000-000000000001';
CREATE TEMP TABLE scope_cases(destination_id uuid,kind text,id uuid,expected text);
INSERT INTO scope_cases VALUES
 ('fb970000-0000-4000-8000-000000000001','profile','fb940000-0000-4000-8000-000000000001','in_scope'),
 ('fb970000-0000-4000-8000-000000000001','profile','fb940000-0000-4000-8000-000000900001','unavailable'),
 ('fb970000-0000-4000-8000-000000000001','profile','fb940000-0000-4000-8000-000000999999','unavailable'),
 ('fb970000-0000-4000-8000-000000000002','application','fb950000-0000-4000-8000-000000000001','in_scope'),
 ('fb970000-0000-4000-8000-000000000002','application','fb950000-0000-4000-8000-000000000101','out_of_scope'),
 ('fb970000-0000-4000-8000-000000000002','application','fb950000-0000-4000-8000-000000000102','out_of_scope'),
 ('fb970000-0000-4000-8000-000000000003','point_submission','fb960000-0000-4000-8000-000000000001','in_scope'),
 ('fb970000-0000-4000-8000-000000000003','point_submission','fb960000-0000-4000-8000-000000000002','out_of_scope');
GRANT SELECT ON scope_cases TO service_role;
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.csf_sheet_sync_scope_statuses(uuid,uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','plugin_data.csf_sheet_sync_scope_statuses(uuid,uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','plugin_data.csf_sheet_sync_scope_statuses(uuid,uuid,jsonb)','EXECUTE'),'scope projection is service-only');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_sheet_sync_scope_statuses_internal(uuid,plugin_data.csf_sheet_sync_destinations,jsonb)','EXECUTE'),
 'the caller cannot forge internal destination metadata');
SET LOCAL ROLE service_role;
SELECT extensions.is(plugin_data.csf_sheet_sync_scope_statuses('fb910000-0000-4000-8000-000000000001',destination_id,
 jsonb_build_array(jsonb_build_object('record_kind',kind,'record_id',id)))->0->>'state',expected,
 'scope state matches the tenant, term, cohort, and record contract: '||kind||':'||id) FROM scope_cases ORDER BY destination_id,id;
SELECT extensions.is(plugin_data.csf_sheet_sync_scope_statuses('fb910000-0000-4000-8000-000000000001',destination_id,
 jsonb_build_array(jsonb_build_object('record_kind',kind,'record_id',id)))->0->>'state',
 CASE WHEN full_snapshot IS NULL THEN 'unavailable' WHEN full_snapshot->>'out_of_scope'='true' THEN 'out_of_scope' ELSE 'in_scope' END,
 'full snapshot and metadata observation agree: '||kind||':'||id)
 FROM scope_cases CROSS JOIN LATERAL (SELECT plugin_data.csf_sheet_sync_destination_snapshot(
 'fb910000-0000-4000-8000-000000000001',destination_id,kind,id) AS full_snapshot) full_result ORDER BY destination_id,id;
SELECT extensions.throws_ok($$SELECT plugin_data.csf_sheet_sync_scope_statuses('fb910000-0000-4000-8000-000000000002','fb970000-0000-4000-8000-000000000001','[{"record_kind":"profile","record_id":"fb940000-0000-4000-8000-000000000001"}]')$$,
 'P0001','Destination not found.','another tenant cannot use a destination');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_sheet_sync_scope_statuses('fb910000-0000-4000-8000-000000000001','fb970000-0000-4000-8000-000000000001','[{"record_kind":"application","record_id":"fb950000-0000-4000-8000-000000000001"}]')$$,
 'P0001','Record kind does not match this destination.','a class destination cannot observe applications');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_sheet_sync_scope_statuses('fb910000-0000-4000-8000-000000000001','fb970000-0000-4000-8000-000000000001','[]')$$,
 '22023','Sheet scope batches must contain 1 to 100 records.','empty batches are refused');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_sheet_sync_scope_statuses('fb910000-0000-4000-8000-000000000001','fb970000-0000-4000-8000-000000000001',NULL)$$,
 '22023','Sheet scope records must be an array.','null batches are refused');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_sheet_sync_scope_statuses('fb910000-0000-4000-8000-000000000001','fb970000-0000-4000-8000-000000000001',(SELECT jsonb_agg(jsonb_build_object('record_kind','profile','record_id','fb940000-0000-4000-8000-000000000001')) FROM generate_series(1,101)))$$,
 '22023','Sheet scope batches must contain 1 to 100 records.','oversized batches are refused');
RESET ROLE;
UPDATE plugin_data.csf_profile_cohort_memberships SET status='archived'
 WHERE organization_id='fb910000-0000-4000-8000-000000000001' AND profile_id='fb940000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT extensions.is(plugin_data.csf_sheet_sync_scope_statuses('fb910000-0000-4000-8000-000000000001',destination_id,
 jsonb_build_array(jsonb_build_object('record_kind',kind,'record_id',id)))->0->>'state','out_of_scope',
 'archiving cohort membership removes every previously bound kind: '||kind) FROM scope_cases WHERE expected='in_scope';
SELECT extensions.is(plugin_data.csf_sheet_sync_scope_statuses('fb910000-0000-4000-8000-000000000001','fb970000-0000-4000-8000-000000000001',
 '[{"record_kind":"profile","record_id":"fb940000-0000-4000-8000-000000000001"}]')->0->'scope_revision',
 plugin_data.csf_sheet_sync_destination_snapshot('fb910000-0000-4000-8000-000000000001','fb970000-0000-4000-8000-000000000001','profile','fb940000-0000-4000-8000-000000000001')->'scope_revision',
 'tombstone observation retains the authoritative retry revision');
RESET ROLE;
UPDATE plugin_data.csf_profile_cohort_memberships SET status='active'
 WHERE organization_id='fb910000-0000-4000-8000-000000000001' AND profile_id='fb940000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_cohort_terms WHERE organization_id='fb910000-0000-4000-8000-000000000001';
SELECT extensions.is(plugin_data.csf_sheet_sync_scope_statuses('fb910000-0000-4000-8000-000000000001','fb970000-0000-4000-8000-000000000001',
 '[{"record_kind":"profile","record_id":"fb940000-0000-4000-8000-000000000001"}]')->0->>'state','out_of_scope',
 'an unconfigured class and term produces a bound tombstone');
INSERT INTO plugin_data.csf_cohort_terms(organization_id,cohort_id,term_id,status)
 VALUES('fb910000-0000-4000-8000-000000000001','fb930000-0000-4000-8000-000000000001','fb920000-0000-4000-8000-000000000001','inactive');
SELECT extensions.is(plugin_data.csf_sheet_sync_scope_statuses('fb910000-0000-4000-8000-000000000001','fb970000-0000-4000-8000-000000000001',
 '[{"record_kind":"profile","record_id":"fb940000-0000-4000-8000-000000000001"}]')->0->>'state','in_scope',
 'configured-pair existence retains the previous contract independently of pair status');
CREATE TEMP TABLE scope_measurements(name text PRIMARY KEY, elapsed_ms numeric, payload jsonb);
DO $$ DECLARE records jsonb; payload jsonb; started timestamptz;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('record_kind','profile','record_id',id) ORDER BY id) INTO records
 FROM (SELECT id FROM plugin_data.csf_profiles WHERE organization_id='fb910000-0000-4000-8000-000000000001' ORDER BY id LIMIT 100) selected;
 started:=clock_timestamp();
 payload:=plugin_data.csf_sheet_sync_scope_statuses('fb910000-0000-4000-8000-000000000001','fb970000-0000-4000-8000-000000000001',records);
 INSERT INTO scope_measurements VALUES('metadata',extract(epoch FROM clock_timestamp()-started)*1000,payload);
 started:=clock_timestamp();
 payload:=plugin_data.csf_sheet_sync_destination_snapshots('fb910000-0000-4000-8000-000000000001','fb970000-0000-4000-8000-000000000001',records);
 INSERT INTO scope_measurements VALUES('full',extract(epoch FROM clock_timestamp()-started)*1000,payload);
END $$;
SELECT extensions.is(jsonb_array_length(payload),100,'scope observation returns the complete bounded page') FROM scope_measurements WHERE name='metadata';
SELECT extensions.ok(octet_length(payload::text)<40000,'100 scope results stay below the 40 KB metadata budget') FROM scope_measurements WHERE name='metadata';
SELECT extensions.ok((SELECT octet_length(payload::text) FROM scope_measurements WHERE name='metadata')*5 <
 (SELECT octet_length(payload::text) FROM scope_measurements WHERE name='full'),'metadata avoids at least 80 percent of this synthetic history payload');
SELECT extensions.ok(payload::text NOT LIKE '%Fixture-only retained detail%' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(payload) item
 WHERE item-ARRAY['organization_id','destination_id','record_kind','record_id','state','scope_revision']<>'{}'::jsonb),
 'scope projection excludes names, evidence, review history, and provider payloads') FROM scope_measurements WHERE name='metadata';
SELECT extensions.diag(format('Synthetic 500-profile chapter, 100-row %s observation: %s ms, %s bytes',name,elapsed_ms,octet_length(payload::text))) FROM scope_measurements ORDER BY name;
SELECT * FROM extensions.finish();
ROLLBACK;
