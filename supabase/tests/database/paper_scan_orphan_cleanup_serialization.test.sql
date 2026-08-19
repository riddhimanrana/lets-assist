BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(8);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.acquire_paper_scan_storage_cleanup_lock(uuid,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot acquire the paper-scan cleanup lease'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.acquire_paper_scan_storage_cleanup_lock(uuid,integer)',
    'EXECUTE'
  ),
  'the cleanup worker can acquire its durable lease'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.queue_orphaned_paper_scan_uploads(text[])',
    'EXECUTE'
  ),
  'authenticated clients cannot invoke the orphan cleanup writer directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.queue_orphaned_paper_scan_uploads(text[])',
    'EXECUTE'
  ),
  'the service boundary can atomically queue verified orphan uploads'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'app_private.guard_paper_scan_registration_during_cleanup()',
    'EXECUTE'
  ),
  'the registration guard is trigger-only'
);

SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ef900000-0000-4000-8000-000000000001","role":"service_role"}';

SELECT extensions.ok(
  public.acquire_paper_scan_storage_cleanup_lock(
    'ef900000-0000-4000-8000-000000000002',
    900
  ),
  'the worker acquires the cleanup lease'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.project_paper_scan_images (
      batch_id, project_id, bucket_id, object_path, sequence,
      byte_size, content_type
    ) VALUES (
      'ef900000-0000-4000-8000-000000000003',
      'ef900000-0000-4000-8000-000000000004',
      'paper-signup-scans',
      'paper_signups/ef900000-0000-4000-8000-000000000004/test/0_photo.jpg',
      0,
      100,
      'image/jpeg'
    )
  $$,
  '40001',
  'paper scan storage cleanup is in progress',
  'a scan photo cannot become registered while cleanup can delete it'
);

SELECT extensions.ok(
  public.release_paper_scan_storage_cleanup_lock(
    'ef900000-0000-4000-8000-000000000002'
  ),
  'the worker releases its cleanup lease'
);

SELECT * FROM extensions.finish();
ROLLBACK;
