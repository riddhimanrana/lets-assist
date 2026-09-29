BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(3);
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES ('fc100000-0000-4000-8000-000000000099','Contact scale','contact-scale','school','993499');
INSERT INTO plugin_data.csf_profiles(organization_id,first_name,last_name,normalized_first_name,normalized_last_name,reported_application_school_email,reported_application_personal_email)
SELECT 'fc100000-0000-4000-8000-000000000099','Synthetic','Member '||i,'synthetic','member '||i,'school'||i||'@local.test','personal'||i||'@local.test' FROM generate_series(1,20000) i;
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester,lifecycle_status)
VALUES ('fc200000-0000-4000-8000-000000000099','fc100000-0000-4000-8000-000000000099','F40','Fall 2040','2040-2041','fall','open');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label) VALUES ('fc300000-0000-4000-8000-000000000099','fc100000-0000-4000-8000-000000000099',2041,'Class of 2041');
INSERT INTO plugin_data.csf_term_applications(organization_id,profile_id,term_id,cohort_id,most_checked_email)
SELECT organization_id,id,'fc200000-0000-4000-8000-000000000099','fc300000-0000-4000-8000-000000000099',reported_application_personal_email FROM plugin_data.csf_profiles WHERE organization_id='fc100000-0000-4000-8000-000000000099';
ANALYZE plugin_data.csf_profiles;
ANALYZE plugin_data.csf_term_applications;
CREATE FUNCTION pg_temp.contact_plan(query text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE plan json;
BEGIN EXECUTE 'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' || query INTO plan; RETURN plan::text; END;
$$;
SELECT extensions.ok(pg_temp.contact_plan($q$SELECT 1 FROM plugin_data.csf_profiles WHERE organization_id='fc100000-0000-4000-8000-000000000099' AND record_status='active' AND plugin_data.csf_normalize_email_text(reported_application_school_email)=ANY(ARRAY['personal19999@local.test','school19999@local.test'])$q$) LIKE '%csf_profiles_reported_school_lookup_idx%', 'reported_application_school_email uses its index with 20000 synthetic records');
SELECT extensions.ok(pg_temp.contact_plan($q$SELECT 1 FROM plugin_data.csf_profiles WHERE organization_id='fc100000-0000-4000-8000-000000000099' AND record_status='active' AND plugin_data.csf_normalize_email_text(reported_application_personal_email)=ANY(ARRAY['personal19999@local.test','school19999@local.test'])$q$) LIKE '%csf_profiles_reported_personal_lookup_idx%', 'reported_application_personal_email uses its index with 20000 synthetic records');
SELECT extensions.ok(pg_temp.contact_plan($q$SELECT 1 FROM plugin_data.csf_term_applications WHERE organization_id='fc100000-0000-4000-8000-000000000099' AND plugin_data.csf_normalize_email_text(most_checked_email)=ANY(ARRAY['personal19999@local.test','school19999@local.test'])$q$) LIKE '%csf_applications_contact_lookup_idx%', 'most_checked_email uses its index with 20000 synthetic records');
SELECT * FROM extensions.finish();
ROLLBACK;
