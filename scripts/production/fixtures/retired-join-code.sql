INSERT INTO auth.users (id, instance_id, email, email_confirmed_at, aud, role)
VALUES ('bb000000-0000-4000-8000-000000000001',
        '00000000-0000-0000-0000-000000000000',
        'retention.backfill@example.test', now(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('bb100000-0000-4000-8000-000000000001',
        'Backfill Fixture Chapter', 'backfill-fixture-chapter', 'school', '884002')
ON CONFLICT (id) DO NOTHING;
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES ('bb200000-0000-4000-8000-000000000001',
        'bb100000-0000-4000-8000-000000000001', 2024, 'Class of 2024')
ON CONFLICT (id) DO NOTHING;
INSERT INTO plugin_data.csf_class_join_codes
  (id, organization_id, cohort_id, code, created_by)
VALUES ('bb210000-0000-4000-8000-000000000001',
        'bb100000-0000-4000-8000-000000000001',
        'bb200000-0000-4000-8000-000000000001',
        'ABC234', 'bb000000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_retention_runs
  (id, organization_id, request_id, actor_user_id, graduation_years,
   state, profile_digest, eligible_profile_count, blocked_profile_count,
   reason, committed_at, committed_by, commit_request_id, committed_counts)
VALUES ('bb220000-0000-4000-8000-000000000001',
        'bb100000-0000-4000-8000-000000000001',
        'bb220000-0000-4000-8000-000000000002',
        __RETENTION_ACTOR__,
        ARRAY[2024], 'committed', repeat('a',64), 0, 0,
        'Synthetic backfill test', now(),
        __RETENTION_ACTOR__,
        'bb220000-0000-4000-8000-000000000003', '{}'::jsonb);
ALTER TABLE plugin_data.csf_retention_retired_cohorts
  DISABLE TRIGGER csf_retention_retired_cohorts_status_projection;
INSERT INTO plugin_data.csf_retention_retired_cohorts
  (organization_id, cohort_id, run_id, graduation_year)
VALUES ('bb100000-0000-4000-8000-000000000001',
        'bb200000-0000-4000-8000-000000000001',
        'bb220000-0000-4000-8000-000000000001', 2024);
ALTER TABLE plugin_data.csf_retention_retired_cohorts
  ENABLE TRIGGER csf_retention_retired_cohorts_status_projection;
UPDATE plugin_data.csf_cohorts
SET status = 'retired'
WHERE id = 'bb200000-0000-4000-8000-000000000001';
