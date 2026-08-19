BEGIN;

SELECT extensions.plan(9);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.update_paper_scan_review_row(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE'),
  'anonymous clients cannot edit paper scan review rows'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'public.update_paper_scan_review_row(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE'),
  'authenticated clients cannot bypass the server action'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'public.update_paper_scan_review_row(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE'),
  'the server can execute the atomic review edit'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  'bb000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'atomic-edit@local.test', now(),
  '{}', '{"username":"atomic_edit"}', now(), now()
);

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES (
  'bb100000-0000-4000-8000-000000000001',
  'bb000000-0000-4000-8000-000000000001',
  'Atomic edit fixture', 'Local', 'Atomic edit fixture', 'oneTime', 'manual',
  '{"oneTime":{"date":"2026-08-01","startTime":"10:00","endTime":"12:00","volunteers":5}}',
  true, 'completed'
);

INSERT INTO public.project_paper_scan_batches (
  id, project_id, schedule_id, created_by, status, committed_at
)
VALUES
  ('bb200000-0000-4000-8000-000000000001', 'bb100000-0000-4000-8000-000000000001', 'oneTime', 'bb000000-0000-4000-8000-000000000001', 'review', NULL),
  ('bb200000-0000-4000-8000-000000000002', 'bb100000-0000-4000-8000-000000000001', 'oneTime', 'bb000000-0000-4000-8000-000000000001', 'committed', now());

INSERT INTO public.project_paper_scan_rows (
  id, batch_id, project_id, sheet_row_number, raw_extraction, name, email, decision
)
VALUES
  ('bb300000-0000-4000-8000-000000000001', 'bb200000-0000-4000-8000-000000000001', 'bb100000-0000-4000-8000-000000000001', 1, '{}', 'Before', 'BEFORE@LOCAL.TEST', 'pending'),
  ('bb300000-0000-4000-8000-000000000002', 'bb200000-0000-4000-8000-000000000002', 'bb100000-0000-4000-8000-000000000001', 1, '{}', 'Committed', NULL, 'include');

SELECT extensions.is(
  public.update_paper_scan_review_row(
    'bb200000-0000-4000-8000-000000000001', 'bb100000-0000-4000-8000-000000000001',
    'bb300000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001',
    '{"name":"After","email":"AFTER@LOCAL.TEST","decision":"include","signaturePresent":true}'
  ),
  'updated',
  'a review row is updated while its parent remains reviewable'
);
SELECT extensions.is(
  (SELECT name FROM public.project_paper_scan_rows WHERE id = 'bb300000-0000-4000-8000-000000000001'),
  'After',
  'the requested working-copy field changes'
);
SELECT extensions.is(
  (SELECT email FROM public.project_paper_scan_rows WHERE id = 'bb300000-0000-4000-8000-000000000001'),
  'after@local.test',
  'email normalization remains server-enforced'
);
SELECT extensions.ok(
  (SELECT signature_present AND decision = 'include' FROM public.project_paper_scan_rows WHERE id = 'bb300000-0000-4000-8000-000000000001'),
  'boolean and decision patches are applied'
);
SELECT extensions.is(
  public.update_paper_scan_review_row(
    'bb200000-0000-4000-8000-000000000002', 'bb100000-0000-4000-8000-000000000001',
    'bb300000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001',
    '{"name":"Too late"}'
  ),
  'not_review',
  'a terminal parent rejects later edits'
);
SELECT extensions.is(
  (SELECT name FROM public.project_paper_scan_rows WHERE id = 'bb300000-0000-4000-8000-000000000002'),
  'Committed',
  'the rejected edit leaves the committed row unchanged'
);

SELECT * FROM extensions.finish();
ROLLBACK;
