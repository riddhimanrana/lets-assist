BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(10);

INSERT INTO public.organizations (id, name, username, type, join_code) VALUES
('c9100000-0000-4000-8000-000000000001', 'Archived directory fixture', 'archived-directory-fixture', 'school', '976411');
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status) VALUES
('c9200000-0000-4000-8000-000000000001', 'c9100000-0000-4000-8000-000000000001', 2030, 'Active class', 'active'),
('c9200000-0000-4000-8000-000000000002', 'c9100000-0000-4000-8000-000000000001', 2029, 'Archived class', 'archived');
INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name) VALUES
('c9300000-0000-4000-8000-000000000001', 'c9100000-0000-4000-8000-000000000001', 'Active', 'Fixture', 'active', 'fixture'),
('c9300000-0000-4000-8000-000000000002', 'c9100000-0000-4000-8000-000000000001', 'Archived', 'Fixture', 'archived', 'fixture'),
('c9300000-0000-4000-8000-000000000003', 'c9100000-0000-4000-8000-000000000001', 'Unassigned', 'Fixture', 'unassigned', 'fixture');
INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id, status) VALUES
('c9100000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-000000000001', 'active'),
('c9100000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000002', 'c9200000-0000-4000-8000-000000000002', 'active');

SELECT extensions.ok(NOT has_function_privilege('anon', 'plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer)', 'EXECUTE'), 'anonymous clients cannot read the directory');
SELECT extensions.ok(NOT has_function_privilege('authenticated', 'plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer)', 'EXECUTE'), 'browser clients cannot read the directory directly');
SELECT extensions.ok(has_function_privilege('service_role', 'plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer)', 'EXECUTE'), 'the server retains directory access');
SELECT extensions.is((SELECT count(profile_id) FROM plugin_data.csf_list_profiles_page('c9100000-0000-4000-8000-000000000001')), 2::bigint, 'the default directory retains active and unassigned profiles');
SELECT extensions.is((SELECT total_count FROM plugin_data.csf_list_profiles_page('c9100000-0000-4000-8000-000000000001') LIMIT 1), 2::bigint, 'counts exclude archived classes before pagination');
SELECT extensions.is((SELECT count(profile_id) FROM plugin_data.csf_list_profiles_page('c9100000-0000-4000-8000-000000000001', p_search => 'Archived')), 0::bigint, 'general search excludes archived class members');
SELECT extensions.is((SELECT count(profile_id) FROM plugin_data.csf_list_profiles_page('c9100000-0000-4000-8000-000000000001', p_cohort_id => 'c9200000-0000-4000-8000-000000000002')), 1::bigint, 'explicit archived-class review preserves the retained record');
UPDATE plugin_data.csf_cohorts SET status = 'active' WHERE id = 'c9200000-0000-4000-8000-000000000002';
SELECT extensions.is((SELECT count(profile_id) FROM plugin_data.csf_list_profiles_page('c9100000-0000-4000-8000-000000000001')), 3::bigint, 'restoring the class restores directory visibility');

UPDATE plugin_data.csf_cohorts SET status = 'archived' WHERE id = 'c9200000-0000-4000-8000-000000000002';
INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id, status, created_at) VALUES
('c9100000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-000000000002', 'transferred', now() + interval '1 day');
SELECT extensions.is((SELECT count(profile_id) FROM plugin_data.csf_list_profiles_page('c9100000-0000-4000-8000-000000000001', p_search => 'Active')), 1::bigint, 'a reactivated older membership stays visible after the intermediate class is archived');
SELECT extensions.is((SELECT count(profile_id) FROM plugin_data.csf_list_profiles_page('c9100000-0000-4000-8000-000000000001', p_search => 'Active', p_cohort_id => 'c9200000-0000-4000-8000-000000000001')), 1::bigint, 'the directory selects the active class instead of the newer transferred membership');

SELECT * FROM extensions.finish();
ROLLBACK;
