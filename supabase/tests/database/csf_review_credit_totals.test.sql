BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

SELECT extensions.ok(NOT has_function_privilege('anon', 'plugin_data.csf_review_credit_totals(uuid,uuid,uuid[])', 'EXECUTE'), 'anonymous callers cannot read review totals');
SELECT extensions.ok(NOT has_function_privilege('authenticated', 'plugin_data.csf_review_credit_totals(uuid,uuid,uuid[])', 'EXECUTE'), 'browser callers cannot read review totals');
SELECT extensions.ok(has_function_privilege('service_role', 'plugin_data.csf_review_credit_totals(uuid,uuid,uuid[])', 'EXECUTE'), 'authorized server readers can read review totals');

INSERT INTO public.organizations(id, name, username, type, join_code) VALUES
  ('fe110000-0000-4000-8000-000000000001', 'Review totals fixture', 'review-totals-fixture', 'school', '982001'),
  ('fe110000-0000-4000-8000-000000000002', 'Other totals fixture', 'review-totals-other', 'school', '982002');
INSERT INTO plugin_data.csf_terms(id, organization_id, code, label, school_year, semester, lifecycle_status) VALUES
  ('fe120000-0000-4000-8000-000000000001', 'fe110000-0000-4000-8000-000000000001', 'F26', 'Fall 2026', '2026-2027', 'fall', 'open'),
  ('fe120000-0000-4000-8000-000000000002', 'fe110000-0000-4000-8000-000000000001', 'S27', 'Spring 2027', '2026-2027', 'spring', 'open'),
  ('fe120000-0000-4000-8000-000000000003', 'fe110000-0000-4000-8000-000000000002', 'F26', 'Fall 2026', '2026-2027', 'fall', 'open');
INSERT INTO plugin_data.csf_profiles(id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name)
SELECT ('fe130000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'fe110000-0000-4000-8000-000000000001', 'Fictional', 'Member ' || i, 'fictional', 'member ' || i
FROM generate_series(1, 1001) i;
INSERT INTO plugin_data.csf_profiles(id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name) VALUES
  ('fe130000-0000-4000-8000-000000002001', 'fe110000-0000-4000-8000-000000000002', 'Other', 'Member', 'other', 'member');
INSERT INTO plugin_data.csf_credit_records(organization_id, term_id, profile_id, source, points, status)
SELECT organization_id, 'fe120000-0000-4000-8000-000000000001', id, 'manual', 1.25, 'verified'
FROM plugin_data.csf_profiles WHERE organization_id='fe110000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_credit_records(organization_id, term_id, profile_id, source, points, status) VALUES
  ('fe110000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000001', 'fe130000-0000-4000-8000-000000000001', 'manual', 2.5, 'verified'),
  ('fe110000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000001', 'fe130000-0000-4000-8000-000000000001', 'manual', 9, 'pending'),
  ('fe110000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000001', 'fe130000-0000-4000-8000-000000000001', 'manual', 9, 'rejected'),
  ('fe110000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000001', 'fe130000-0000-4000-8000-000000000001', 'manual', 9, 'revoked'),
  ('fe110000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000002', 'fe130000-0000-4000-8000-000000000001', 'manual', 9, 'verified'),
  ('fe110000-0000-4000-8000-000000000002', 'fe120000-0000-4000-8000-000000000003', 'fe130000-0000-4000-8000-000000002001', 'manual', 9, 'verified');

SELECT extensions.is(plugin_data.csf_review_credit_totals('fe110000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000001', ARRAY['fe130000-0000-4000-8000-000000000001','fe130000-0000-4000-8000-000000000001','fe130000-0000-4000-8000-000000002001']::uuid[]),
  '[{"profile_id":"fe130000-0000-4000-8000-000000000001","points":3.75}]'::jsonb,
  'sums verified credit once per profile within the requested chapter and semester');
SELECT extensions.is(plugin_data.csf_review_credit_totals('fe110000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000003', ARRAY['fe130000-0000-4000-8000-000000002001']::uuid[]), '[]'::jsonb, 'cross-chapter semester and profile IDs expose no totals');
SELECT extensions.is(plugin_data.csf_review_credit_totals('fe110000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000001', '{}'::uuid[]), '[]'::jsonb, 'empty rosters return an empty result');
SELECT extensions.is(jsonb_array_length(plugin_data.csf_review_credit_totals('fe110000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000001', ARRAY(SELECT ('fe130000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid FROM generate_series(1,1000) i))), 1000, 'the maximum batch retains all 1000 totals');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_review_credit_totals('fe110000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000001', ARRAY(SELECT ('fe130000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid FROM generate_series(1,1001) i))$q$, '22023', NULL, 'oversized batches are refused');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_review_credit_totals(NULL, 'fe120000-0000-4000-8000-000000000001', '{}'::uuid[])$q$, '22023', NULL, 'missing chapter is refused');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_review_credit_totals('fe110000-0000-4000-8000-000000000001', NULL, '{}'::uuid[])$q$, '22023', NULL, 'missing semester is refused');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_review_credit_totals('fe110000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000001', NULL)$q$, '22023', NULL, 'missing profile list is refused');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_review_credit_totals('fe110000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000001', ARRAY[NULL]::uuid[])$q$, '22023', NULL, 'null profile IDs are refused');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_credit_records WHERE organization_id IN ('fe110000-0000-4000-8000-000000000001', 'fe110000-0000-4000-8000-000000000002')), 1007, 'reads preserve all credits');
INSERT INTO plugin_data.csf_credit_records(organization_id, term_id, profile_id, source, points, status)
SELECT 'fe110000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000001', 'fe130000-0000-4000-8000-000000000002', 'manual', 0.25, 'verified'
FROM generate_series(1, 1201);
SELECT extensions.is(plugin_data.csf_review_credit_totals('fe110000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000001', ARRAY['fe130000-0000-4000-8000-000000000002']::uuid[]),
  '[{"profile_id":"fe130000-0000-4000-8000-000000000002","points":301.50}]'::jsonb,
  'one total includes credits beyond a provider row cap');
SELECT * FROM extensions.finish();
ROLLBACK;
