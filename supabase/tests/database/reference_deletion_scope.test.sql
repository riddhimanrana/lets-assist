BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

SELECT extensions.is(
  (SELECT count(*) FROM pg_constraint c
   JOIN pg_class r ON r.oid = c.conrelid
   JOIN pg_namespace n ON n.oid = r.relnamespace
   JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = ANY(c.conkey)
   WHERE c.contype = 'f' AND c.confdeltype = 'n'
     AND n.nspname IN ('public', 'plugin_data', 'private', 'app_private')
     AND a.attnotnull
     AND (c.confdelsetcols IS NULL OR a.attnum = ANY(c.confdelsetcols))),
  0::bigint,
  'no foreign-key deletion action tries to clear a required column'
);

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('fa000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'deletion-scope@local.test', now(), '{}', '{}', now(), now());
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('fa100000-0000-4000-8000-000000000001', 'Deletion scope', 'deletion-scope', 'school', '839701');
INSERT INTO public.projects (id, creator_id, title, location, description,
  event_type, verification_method, schedule, require_login, status)
SELECT id, 'fa000000-0000-4000-8000-000000000001', 'Deletion fixture', 'Local', 'Synthetic',
  'oneTime', 'manual', jsonb_build_object('oneTime', jsonb_build_object(
    'date', to_char(CURRENT_DATE - age_days, 'YYYY-MM-DD'),
    'startTime', '10:00', 'endTime', '12:00', 'volunteers', 5)), false, 'completed'
FROM (VALUES ('fa200000-0000-4000-8000-000000000001'::uuid, 40),
             ('fa200000-0000-4000-8000-000000000002'::uuid, 5)) fixtures(id, age_days);
INSERT INTO public.anonymous_signups (id, project_id, email, name, confirmed_at, created_at)
SELECT id, project_id, email, 'Synthetic Person', now(), now() - interval '45 days'
FROM (VALUES
 ('fa300000-0000-4000-8000-000000000001'::uuid, 'fa200000-0000-4000-8000-000000000001'::uuid, 'expired-paper@local.test'),
 ('fa300000-0000-4000-8000-000000000002'::uuid, 'fa200000-0000-4000-8000-000000000001'::uuid, 'expired-plain@local.test'),
 ('fa300000-0000-4000-8000-000000000003'::uuid, 'fa200000-0000-4000-8000-000000000002'::uuid, 'recent-project@local.test')
) fixtures(id, project_id, email);
INSERT INTO public.project_signups (id, project_id, anonymous_id, schedule_id, status, source)
SELECT id, project_id, anonymous_id, 'oneTime', 'attended', 'paper_scan'
FROM (VALUES
 ('fa400000-0000-4000-8000-000000000001'::uuid, 'fa200000-0000-4000-8000-000000000001'::uuid, 'fa300000-0000-4000-8000-000000000001'::uuid),
 ('fa400000-0000-4000-8000-000000000002'::uuid, 'fa200000-0000-4000-8000-000000000001'::uuid, 'fa300000-0000-4000-8000-000000000002'::uuid),
 ('fa400000-0000-4000-8000-000000000003'::uuid, 'fa200000-0000-4000-8000-000000000002'::uuid, 'fa300000-0000-4000-8000-000000000003'::uuid)
) fixtures(id, project_id, anonymous_id);
INSERT INTO public.project_paper_scan_batches (id, project_id, schedule_id, created_by, status)
VALUES ('fa500000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001',
  'oneTime', 'fa000000-0000-4000-8000-000000000001', 'draft');
INSERT INTO public.project_paper_scan_rows (id, batch_id, project_id, sheet_row_number,
  raw_extraction, name, decision, match_signup_id, committed_signup_id, committed_anonymous_id)
VALUES ('fa600000-0000-4000-8000-000000000001', 'fa500000-0000-4000-8000-000000000001',
 'fa200000-0000-4000-8000-000000000001', 1, '{"synthetic":true}', 'Synthetic Person', 'include',
 'fa400000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000001',
 'fa300000-0000-4000-8000-000000000001');

SELECT extensions.throws_ok(
 $$UPDATE public.project_paper_scan_rows SET match_signup_id = 'fa400000-0000-4000-8000-000000000003'
   WHERE id = 'fa600000-0000-4000-8000-000000000001'$$,
 '23503', NULL, 'the match reference still rejects another project');
SELECT extensions.throws_ok(
 $$UPDATE public.project_paper_scan_rows SET committed_signup_id = 'fa400000-0000-4000-8000-000000000003'
   WHERE id = 'fa600000-0000-4000-8000-000000000001'$$,
 '23503', NULL, 'the committed reference still rejects another project');
SELECT extensions.is(public.delete_old_anonymous_signups(), 2,
 'retention deletes both expired anonymous signups despite paper scan references');
SELECT extensions.is((SELECT count(*) FROM public.project_signups
 WHERE id IN ('fa400000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000002')),
 0::bigint, 'retention removes expired project signups');
SELECT extensions.ok((SELECT project_id = 'fa200000-0000-4000-8000-000000000001'
 AND match_signup_id IS NULL AND committed_signup_id IS NULL AND committed_anonymous_id IS NULL
 AND raw_extraction = '{"synthetic":true}'::jsonb
 FROM public.project_paper_scan_rows WHERE id = 'fa600000-0000-4000-8000-000000000001'),
 'paper scan evidence retains project scope while optional identity links clear');
SELECT extensions.is((SELECT count(*) FROM public.project_signups
 WHERE id = 'fa400000-0000-4000-8000-000000000003'), 1::bigint,
 'a signup for a recent project remains');
SELECT extensions.is(public.delete_old_anonymous_signups(), 0, 'retention retries without further deletion');

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES ('fa700000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 2034, 'Synthetic 2034', 'active');
INSERT INTO plugin_data.csf_class_join_codes (id, organization_id, cohort_id, code, status,
 created_by, revoked_by, revoked_at, replaces_code_id)
VALUES ('fa800000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001',
 'fa700000-0000-4000-8000-000000000001', 'FA2222', 'rotated',
 'fa000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', now(), NULL),
 ('fa800000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001',
 'fa700000-0000-4000-8000-000000000001', 'FA2223', 'active',
 'fa000000-0000-4000-8000-000000000001', NULL, NULL, 'fa800000-0000-4000-8000-000000000001');
SELECT extensions.lives_ok($$DELETE FROM plugin_data.csf_class_join_codes
 WHERE id = 'fa800000-0000-4000-8000-000000000001'$$, 'removing an old class code clears its replacement pointer');
SELECT extensions.ok((SELECT organization_id = 'fa100000-0000-4000-8000-000000000001' AND replaces_code_id IS NULL
 FROM plugin_data.csf_class_join_codes WHERE id = 'fa800000-0000-4000-8000-000000000002'),
 'the current class code retains its organization');

INSERT INTO public.organization_sheet_syncs (id, organization_id, created_by, sheet_id, sheet_url)
VALUES ('fa900000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001',
 'fa000000-0000-4000-8000-000000000001', 'synthetic', 'https://example.invalid/synthetic');
SELECT extensions.throws_ok($$DELETE FROM public.profiles WHERE id = 'fa000000-0000-4000-8000-000000000001'$$,
 '23503', NULL, 'an owned sheet sync prevents deleting its required owner');
SELECT extensions.is((SELECT created_by FROM public.organization_sheet_syncs
 WHERE id = 'fa900000-0000-4000-8000-000000000001'), 'fa000000-0000-4000-8000-000000000001'::uuid,
 'a refused profile deletion preserves sync ownership');
SELECT extensions.is((SELECT count(*) FROM public.profiles WHERE id = 'fa000000-0000-4000-8000-000000000001'),
 1::bigint, 'a refused profile deletion leaves the profile intact');
SELECT * FROM extensions.finish();
ROLLBACK;
