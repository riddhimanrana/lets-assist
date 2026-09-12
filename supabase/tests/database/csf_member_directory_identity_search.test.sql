BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(7);

INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES
  ('de100000-0000-4000-8000-000000000001', 'verified-login@local.test', now()),
  ('de100000-0000-4000-8000-000000000002', 'pending-login@local.test', now());

UPDATE public.profiles
SET full_name = 'Verified Login Name',
    username = 'verified-login',
    email = 'stale-profile-email@local.test'
WHERE id = 'de100000-0000-4000-8000-000000000001';

UPDATE public.profiles
SET full_name = 'Pending Candidate Name', username = 'pending-candidate'
WHERE id = 'de100000-0000-4000-8000-000000000002';

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('de200000-0000-4000-8000-000000000001', 'Directory Search A', 'directory-search-a', 'school', '983001'),
  ('de200000-0000-4000-8000-000000000002', 'Directory Search B', 'directory-search-b', 'school', '983002');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  ('de300000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001', 'F30', 'Fall 2030', '2030-2031', 'fall', true),
  ('de300000-0000-4000-8000-000000000002', 'de200000-0000-4000-8000-000000000002', 'F30', 'Fall 2030', '2030-2031', 'fall', true);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES
  ('de400000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001', 2031, 'Class of 2031'),
  ('de400000-0000-4000-8000-000000000002', 'de200000-0000-4000-8000-000000000002', 2031, 'Class of 2031');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email,
  reported_application_school_email,
  reported_application_personal_email
) VALUES
  ('de500000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001', 'Fictional', 'Member', 'fictional', 'member', 'canonical-one@local.test', 'canonical-one@local.test', 'reported-school@local.test', 'reported-personal@local.test'),
  ('de500000-0000-4000-8000-000000000002', 'de200000-0000-4000-8000-000000000001', 'Pending', 'Member', 'pending', 'member', 'canonical-two@local.test', 'canonical-two@local.test', NULL, NULL),
  ('de500000-0000-4000-8000-000000000003', 'de200000-0000-4000-8000-000000000002', 'Other', 'Tenant', 'other', 'tenant', 'other@local.test', 'other@local.test', 'reported-school@local.test', NULL);

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('de200000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000001', 'de400000-0000-4000-8000-000000000001', 'active'),
  ('de200000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000002', 'de400000-0000-4000-8000-000000000001', 'active'),
  ('de200000-0000-4000-8000-000000000002', 'de500000-0000-4000-8000-000000000003', 'de400000-0000-4000-8000-000000000002', 'active');

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES
  ('de200000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001', 'verified', true),
  ('de200000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000002', 'pending', true);

SELECT extensions.is(
  (SELECT count(profile_id) FROM plugin_data.csf_list_profiles_page(
    'de200000-0000-4000-8000-000000000001', p_search => 'reported-school@local.test'
  )),
  1::bigint,
  'organization directory search includes reported school contact data'
);

SELECT extensions.is(
  (SELECT count(profile_id) FROM plugin_data.csf_list_profiles_page(
    'de200000-0000-4000-8000-000000000001', p_search => 'reported-personal@local.test'
  )),
  1::bigint,
  'organization directory search includes reported personal contact data'
);

SELECT extensions.is(
  (SELECT count(profile_id) FROM plugin_data.csf_list_profiles_page(
    'de200000-0000-4000-8000-000000000001', p_search => 'verified-login'
  )),
  1::bigint,
  'organization directory search includes a verified login username'
);

SELECT extensions.is(
  (SELECT count(profile_id) FROM plugin_data.csf_list_profiles_page(
    'de200000-0000-4000-8000-000000000001', p_search => 'verified-login@local.test'
  )),
  1::bigint,
  'organization directory search includes a verified login email'
);

SELECT extensions.is(
  (SELECT count(profile_id) FROM plugin_data.csf_list_profiles_page(
    'de200000-0000-4000-8000-000000000001', p_search => 'pending-candidate'
  )),
  0::bigint,
  'pending account candidates do not add login identity to staff search'
);

SELECT extensions.is(
  (SELECT count(profile_id) FROM plugin_data.csf_list_class_directory_page(
    'de200000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000001',
    'de400000-0000-4000-8000-000000000001',
    p_search => 'Verified Login Name'
  )),
  1::bigint,
  'class directory search includes the verified login display name'
);

SELECT extensions.is(
  (SELECT count(profile_id) FROM plugin_data.csf_list_profiles_page(
    'de200000-0000-4000-8000-000000000002', p_search => 'verified-login'
  )),
  0::bigint,
  'login identity search remains organization scoped'
);

SELECT * FROM extensions.finish();

ROLLBACK;
