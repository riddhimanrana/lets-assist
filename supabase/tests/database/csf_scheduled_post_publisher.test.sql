-- Retired scheduling never publishes. Synthetic legacy fixtures roll back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(12);
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'scheduler-a@local.test', now(), '{}', '{}', now(), now()),
  ('fb000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'scheduler-b@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('fb100000-0000-4000-8000-000000000001', 'Scheduled Posts A', 'scheduled-posts-a', 'school', '996101'),
  ('fb100000-0000-4000-8000-000000000002', 'Scheduled Posts B', 'scheduled-posts-b', 'school', '996102');

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('fb100000-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-000000000002', 'admin', 'active');

INSERT INTO public.organization_plugin_entitlements (
  id, organization_id, plugin_key, status, created_by
) VALUES
  ('fb150000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'dvhs-csf', 'active', 'fb000000-0000-4000-8000-000000000001'),
  ('fb150000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000002', 'dvhs-csf', 'active', 'fb000000-0000-4000-8000-000000000002');

INSERT INTO public.organization_plugin_installs (
  id, organization_id, plugin_key, installed_version, enabled, installed_by
) VALUES
  ('fb160000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'dvhs-csf', '0.1.0', true, 'fb000000-0000-4000-8000-000000000001'),
  ('fb160000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000002', 'dvhs-csf', '0.1.0', true, 'fb000000-0000-4000-8000-000000000002');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  is_current, lifecycle_status
) VALUES
  ('fb200000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'F99', 'Fall 2099', '2099-2100', 'fall', true, 'open'),
  ('fb200000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000002', 'F99', 'Fall 2099', '2099-2100', 'fall', true, 'open');

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label, status
) VALUES
  ('fb250000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 2099, 'Class of 2099', 'active'),
  ('fb250000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000002', 2099, 'Class of 2099', 'active');


SELECT extensions.ok(NOT has_function_privilege('service_role',
  'app_private.retire_csf_scheduled_posts()', 'EXECUTE'), 'conversion is operator-only');
SELECT extensions.ok(NOT has_function_privilege('authenticated',
  'plugin_data.csf_publish_due_posts(integer,text)', 'EXECUTE'), 'browser cannot call retired publisher');
SELECT extensions.is(plugin_data.csf_publish_due_posts(50, 'test')->>'published', '0', 'retired publisher writes nothing');
SELECT extensions.is(plugin_data.csf_publish_due_posts(50, 'test')->>'retired', 'true', 'retirement is explicit');

-- Reproduce a valid pre-retirement row, not a member action on the new schema.
ALTER TABLE plugin_data.csf_announcements DISABLE TRIGGER csf_announcements_schedule_lifecycle_guard;
INSERT INTO plugin_data.csf_announcements
  (id, organization_id, term_id, title, body, audience, status, scheduled_for,
   scheduled_by, schedule_revision, created_by, updated_by)
VALUES
  ('fb400000-0000-4000-8000-000000000001',
   'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001',
   'Fictional legacy post', 'Keep this content.', 'members', 'scheduled',
   '2099-01-02T12:00:00Z', 'fb000000-0000-4000-8000-000000000001',
   'fb500000-0000-4000-8000-000000000001',
   'fb000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001');
ALTER TABLE plugin_data.csf_announcements ENABLE TRIGGER csf_announcements_schedule_lifecycle_guard;
SELECT extensions.is(app_private.retire_csf_scheduled_posts(), 1, 'one legacy post returns to draft');
SELECT extensions.is((SELECT status FROM plugin_data.csf_announcements
  WHERE id='fb400000-0000-4000-8000-000000000001'), 'draft', 'draft remains editable');
SELECT extensions.is((SELECT body FROM plugin_data.csf_announcements
  WHERE id='fb400000-0000-4000-8000-000000000001'), 'Keep this content.', 'content is preserved');
SELECT extensions.ok((SELECT scheduled_for IS NULL AND published_at IS NULL
  FROM plugin_data.csf_announcements WHERE id='fb400000-0000-4000-8000-000000000001'),
  'conversion neither schedules nor publishes');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
  WHERE target_id='fb400000-0000-4000-8000-000000000001' AND action='post_schedule_retired'), 1,
  'conversion records one audit receipt');
SELECT extensions.is(app_private.retire_csf_scheduled_posts(), 0, 'conversion replay is a no-op');
SELECT extensions.throws_ok($sql$
  UPDATE plugin_data.csf_announcements SET status='scheduled', scheduled_for='2099-01-03T12:00:00Z'
  WHERE id='fb400000-0000-4000-8000-000000000001'
$sql$, '55000', 'Post scheduling has been removed. Publish now or save a draft.',
  'direct writes cannot restore scheduling');
SELECT extensions.throws_ok($sql$
  SELECT app_private.set_csf_release_worker_control(repeat('a',40),
    'scheduled_post_publisher', true, 0, gen_random_uuid(), 'fixture', 'test')
$sql$, '55000', 'Scheduled publishing has been removed', 'runtime activation is refused');
SELECT * FROM extensions.finish();
ROLLBACK;
