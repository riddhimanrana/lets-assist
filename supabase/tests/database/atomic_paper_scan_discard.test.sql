BEGIN;

SELECT extensions.plan(11);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.discard_paper_scan_batch(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot discard paper scans'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.discard_paper_scan_batch(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot discard paper scans'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.discard_paper_scan_batch(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the server can execute the atomic discard'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  'ba000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'atomic-discard@local.test', now(),
  '{}', '{"username":"atomic_discard"}', now(), now()
);

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES (
  'ba100000-0000-4000-8000-000000000001',
  'ba000000-0000-4000-8000-000000000001',
  'Atomic discard fixture', 'Local', 'Atomic discard fixture',
  'oneTime', 'manual',
  jsonb_build_object('oneTime', jsonb_build_object(
    'date', to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '2 day', 'YYYY-MM-DD'),
    'startTime', '10:00', 'endTime', '12:00', 'volunteers', 5
  )),
  true, 'completed'
);

INSERT INTO public.project_paper_scan_batches (
  id, project_id, schedule_id, created_by, status, committed_at
)
VALUES
  (
    'ba200000-0000-4000-8000-000000000001',
    'ba100000-0000-4000-8000-000000000001', 'oneTime',
    'ba000000-0000-4000-8000-000000000001', 'review', NULL
  ),
  (
    'ba200000-0000-4000-8000-000000000002',
    'ba100000-0000-4000-8000-000000000001', 'oneTime',
    'ba000000-0000-4000-8000-000000000001', 'committed', now()
  );

INSERT INTO public.project_paper_scan_images (
  id, batch_id, project_id, object_path, sequence, byte_size, content_type
)
VALUES
  (
    'ba300000-0000-4000-8000-000000000001',
    'ba200000-0000-4000-8000-000000000001',
    'ba100000-0000-4000-8000-000000000001',
    'paper_signups/ba100000-0000-4000-8000-000000000001/discard/0_a.jpg',
    0, 1024, 'image/jpeg'
  ),
  (
    'ba300000-0000-4000-8000-000000000002',
    'ba200000-0000-4000-8000-000000000002',
    'ba100000-0000-4000-8000-000000000001',
    'paper_signups/ba100000-0000-4000-8000-000000000001/committed/0_b.jpg',
    0, 1024, 'image/jpeg'
  );

SELECT extensions.is(
  public.discard_paper_scan_batch(
    'ba200000-0000-4000-8000-000000000001',
    'ba100000-0000-4000-8000-000000000001',
    'ba000000-0000-4000-8000-000000000001'
  ),
  'discarded',
  'an eligible batch is discarded'
);
SELECT extensions.is(
  (SELECT status FROM public.project_paper_scan_batches
   WHERE id = 'ba200000-0000-4000-8000-000000000001'),
  'discarded',
  'the batch reaches the discarded terminal state'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.paper_scan_storage_deletion_queue
   WHERE object_path LIKE '%/discard/%'),
  1::bigint,
  'discard enqueues the image for durable Storage deletion'
);
SELECT extensions.ok(
  (SELECT purged_at IS NOT NULL FROM public.project_paper_scan_images
   WHERE id = 'ba300000-0000-4000-8000-000000000001'),
  'the image purge marker is written in the same transaction'
);
SELECT extensions.is(
  public.discard_paper_scan_batch(
    'ba200000-0000-4000-8000-000000000001',
    'ba100000-0000-4000-8000-000000000001',
    'ba000000-0000-4000-8000-000000000001'
  ),
  'discarded',
  'discard is idempotent'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.paper_scan_storage_deletion_queue
   WHERE object_path LIKE '%/discard/%'),
  1::bigint,
  'idempotent discard never duplicates the outbox row'
);
SELECT extensions.is(
  public.discard_paper_scan_batch(
    'ba200000-0000-4000-8000-000000000002',
    'ba100000-0000-4000-8000-000000000001',
    'ba000000-0000-4000-8000-000000000001'
  ),
  'committed',
  'a committed batch cannot be discarded'
);
SELECT extensions.is(
  (SELECT status FROM public.project_paper_scan_batches
   WHERE id = 'ba200000-0000-4000-8000-000000000002'),
  'committed',
  'the committed terminal state is preserved'
);

SELECT * FROM extensions.finish();
ROLLBACK;
