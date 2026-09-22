CREATE FUNCTION pg_temp.fid(text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(h,1,12) || '4' || substr(h,14,3) || '8' || substr(h,18,15))::uuid
  FROM (SELECT md5('runidplaceholder' || $1) AS h) digest
$$;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(pg_temp.fid('officer'),'authenticated','authenticated','release-runidplaceholder@local.test',now(),'{}','{}');
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES(pg_temp.fid('org'),'Release benchmark','release-runidplaceholder','school',(100000 + mod(abs(hashtextextended('runidplaceholder',0)),900000))::text);
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES(pg_temp.fid('org'),pg_temp.fid('officer'),'admin','active');
INSERT INTO public.organization_plugin_installs(organization_id,plugin_key,installed_version,installed_by)
VALUES(pg_temp.fid('org'),'dvhs-csf','0.1.0',pg_temp.fid('officer'));
INSERT INTO public.organization_plugin_entitlements(organization_id,plugin_key,status,created_by)
VALUES(pg_temp.fid('org'),'dvhs-csf','active',pg_temp.fid('officer'));
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester,is_current,application_review_source) VALUES(pg_temp.fid('term'),pg_temp.fid('org'),'F30','Fall 2030','2030-2031','fall',true,'sheet');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label) SELECT pg_temp.fid('cohort'||n),pg_temp.fid('org'),2031+n,'Class fixture '||n FROM generate_series(1,4)n;
INSERT INTO plugin_data.csf_cohort_terms(organization_id,cohort_id,term_id) SELECT pg_temp.fid('org'),pg_temp.fid('cohort'||n),pg_temp.fid('term') FROM generate_series(1,4)n;
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name) SELECT pg_temp.fid('profile'||n),pg_temp.fid('org'),'Fictional'||n,'Applicant','fictional'||n,'applicant' FROM generate_series(1,622)n;
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id) SELECT pg_temp.fid('org'),pg_temp.fid('profile'||n),pg_temp.fid('cohort'||(1+n%4)) FROM generate_series(1,622)n;
INSERT INTO plugin_data.csf_term_applications(id,organization_id,profile_id,cohort_id,term_id,source,status) SELECT pg_temp.fid('app'||n),pg_temp.fid('org'),pg_temp.fid('profile'||n),pg_temp.fid('cohort'||(1+n%4)),pg_temp.fid('term'),'manual','submitted' FROM generate_series(1,622)n;
INSERT INTO plugin_data.csf_sheet_sources(id,organization_id,title,provider,source_type,drive_file_id,spreadsheet_id) VALUES(pg_temp.fid('source'),pg_temp.fid('org'),'Fictional responses','google_sheets','application_responses','fictional-runidplaceholder-responses','fictional-runidplaceholder-responses');
INSERT INTO plugin_data.csf_application_decision_mappings(organization_id,source_id,decision_columns,reason_columns) VALUES(pg_temp.fid('org'),pg_temp.fid('source'),ARRAY[7],ARRAY[]::integer[]);
INSERT INTO plugin_data.csf_application_decision_sync_runs(id,organization_id,term_id,actor_user_id,request_id,request_fingerprint,status) VALUES(pg_temp.fid('sync'),pg_temp.fid('org'),pg_temp.fid('term'),pg_temp.fid('officer'),pg_temp.fid('sync-request'),'fixture','completed');
INSERT INTO plugin_data.csf_application_decision_sync_sources(organization_id,run_id,source_id,read_status,spreadsheet_file_id,provider_version,sheet_tab_name,requested_range,content_hash,mapping_version) VALUES(pg_temp.fid('org'),pg_temp.fid('sync'),pg_temp.fid('source'),'read','fictional-runidplaceholder-responses','1','Responses','A1:H623','fixture','1');
INSERT INTO plugin_data.csf_application_decision_stages(organization_id,application_id,term_id,profile_id,source_id,staged_decision,block_reason,last_sync_run_id) SELECT pg_temp.fid('org'),pg_temp.fid('app'||n),pg_temp.fid('term'),pg_temp.fid('profile'||n),pg_temp.fid('source'),CASE WHEN n<=580 THEN 'accepted' WHEN n<=600 THEN 'rejected' WHEN n<=620 THEN 'on_hold' ELSE 'conflict' END,CASE WHEN n BETWEEN 601 AND 620 THEN 'awaiting_review' WHEN n=621 THEN 'mixed_colors' ELSE NULL END,pg_temp.fid('sync') FROM generate_series(1,621)n;
INSERT INTO plugin_data.csf_sheet_sync_destinations(id,organization_id,spreadsheet_file_id,sheet_id,kind,cohort_id,term_id,is_test,configured_by,enabled,privacy_verified_at,comment_capability,discussion_transport) SELECT pg_temp.fid('destination'||n),pg_temp.fid('org'),'fictional-runidplaceholder-export-'||n,0,CASE WHEN n=0 THEN 'applications' ELSE 'class' END,CASE WHEN n=0 THEN NULL ELSE pg_temp.fid('cohort'||n) END,pg_temp.fid('term'),true,pg_temp.fid('officer'),true,now(),'available','none' FROM generate_series(0,4)n;


INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status,is_primary,linked_by,connection_basis)
VALUES(pg_temp.fid('org'),pg_temp.fid('profile1'),pg_temp.fid('officer'),'verified',true,pg_temp.fid('officer'),'officer_decision');
SELECT encode(extensions.digest(convert_to(string_agg(application_id::text||'|'||staged_decision||'|'||coalesce(block_reason,'')||'|'||release_state||'|'||last_sync_run_id::text,E'\n' ORDER BY application_id),'UTF8'),'sha256'),'hex')
FROM plugin_data.csf_application_decision_stages WHERE organization_id=pg_temp.fid('org');
