-- Volunteer-hours publication is one permission-rechecked, replay-safe
-- transaction. All fixtures are synthetic and roll back with this test.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(46);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_index AS indexes
    JOIN pg_class AS relations ON relations.oid = indexes.indexrelid
    WHERE relations.relname = 'certificates_verified_signup_unique'
      AND indexes.indisunique
      AND indexes.indpred IS NOT NULL
  ),
  'verified certificates are unique per non-null signup through a partial index'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.prepare_hours_publication_email_delivery(uuid,text,text,text)',
    'EXECUTE'
  ) AND NOT has_function_privilege(
    'authenticated',
    'public.prepare_hours_publication_email_delivery(uuid,text,text,text)',
    'EXECUTE'
  ),
  'only the server role can prepare immutable provider payloads'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.publish_volunteer_hours_transactional(uuid,text,jsonb,text)',
    'EXECUTE'
  ),
  'authenticated organizers can enter the permission-rechecked publication RPC'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.publish_volunteer_hours_transactional(uuid,text,jsonb,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot publish hours'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.claim_hours_publication_email_delivery(uuid,uuid)',
    'EXECUTE'
  ) AND NOT has_function_privilege(
    'authenticated',
    'public.claim_hours_publication_email_delivery(uuid,uuid)',
    'EXECUTE'
  ),
  'only the server role can claim durable email work'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.settle_hours_publication_email_delivery(uuid,uuid,text,text,text)',
    'EXECUTE'
  ) AND NOT has_function_privilege(
    'authenticated',
    'public.settle_hours_publication_email_delivery(uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'only the server role can settle durable email work'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.hours_publication_receipts', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.hours_publication_email_outbox', 'SELECT'),
  'publication receipts and recipient work are not browser-readable'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('ab000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'hours-creator@local.test', now(), '{}', '{"full_name":"Project Creator"}', now(), now()),
  ('ab000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'hours-staff@local.test', now(), '{}', '{"full_name":"Project Staff"}', now(), now()),
  ('ab000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'same-one@local.test', now(), '{}', '{"full_name":"Same Volunteer"}', now(), now()),
  ('ab000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'same-two@local.test', now(), '{}', '{"full_name":"Same Volunteer"}', now(), now()),
  ('ab000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
   'hours-outsider@local.test', now(), '{}', '{"full_name":"Outside User"}', now(), now());

UPDATE public.profiles
SET full_name = CASE id
  WHEN 'ab000000-0000-4000-8000-000000000001' THEN 'Project Creator'
  WHEN 'ab000000-0000-4000-8000-000000000002' THEN 'Project Staff'
  WHEN 'ab000000-0000-4000-8000-000000000003' THEN 'Same Volunteer'
  WHEN 'ab000000-0000-4000-8000-000000000004' THEN 'Same Volunteer'
  ELSE 'Outside User'
END,
email = CASE id
  WHEN 'ab000000-0000-4000-8000-000000000003' THEN 'same-one@local.test'
  WHEN 'ab000000-0000-4000-8000-000000000004' THEN 'same-two@local.test'
  ELSE email
END
WHERE id::text LIKE 'ab000000-0000-4000-8000-00000000000%';

INSERT INTO public.organizations (
  id, name, username, type, join_code, verified
)
VALUES (
  'ab100000-0000-4000-8000-000000000001',
  'Synthetic Hours Organization',
  'synthetic-hours-organization',
  'school',
  '810001',
  true
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'ab100000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000002',
  'staff',
  'active'
);

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, organization_id,
  can_be_managed_by_staff
)
VALUES
  (
    'ab200000-0000-4000-8000-000000000001',
    'ab000000-0000-4000-8000-000000000001',
    'Atomic Hours Project', 'Local', 'Synthetic publication fixture',
    'oneTime', 'manual',
    '{"oneTime":{"date":"2030-08-11","startTime":"09:00","endTime":"12:00","volunteers":20}}',
    true, 'ab100000-0000-4000-8000-000000000001', true
  ),
  (
    'ab200000-0000-4000-8000-000000000002',
    'ab000000-0000-4000-8000-000000000001',
    'Creator Only Hours Project', 'Local', 'Synthetic authorization fixture',
    'oneTime', 'manual',
    '{"oneTime":{"date":"2030-08-12","startTime":"09:00","endTime":"12:00","volunteers":20}}',
    true, 'ab100000-0000-4000-8000-000000000001', false
  ),
  (
    'ab200000-0000-4000-8000-000000000003',
    'ab000000-0000-4000-8000-000000000001',
    'Unpublished Validation Project', 'Local', 'Synthetic validation fixture',
    'oneTime', 'manual',
    '{"oneTime":{"date":"2030-08-13","startTime":"09:00","endTime":"12:00","volunteers":20}}',
    true, NULL, true
  );

INSERT INTO public.project_signups (
  id, project_id, user_id, schedule_id, status
)
VALUES
  ('ab300000-0000-4000-8000-000000000001', 'ab200000-0000-4000-8000-000000000001',
   'ab000000-0000-4000-8000-000000000003', 'oneTime', 'attended'),
  ('ab300000-0000-4000-8000-000000000002', 'ab200000-0000-4000-8000-000000000001',
   'ab000000-0000-4000-8000-000000000004', 'oneTime', 'approved'),
  ('ab300000-0000-4000-8000-000000000003', 'ab200000-0000-4000-8000-000000000002',
   'ab000000-0000-4000-8000-000000000003', 'oneTime', 'approved'),
  ('ab300000-0000-4000-8000-000000000004', 'ab200000-0000-4000-8000-000000000003',
   'ab000000-0000-4000-8000-000000000004', 'oneTime', 'approved');

SELECT set_config(
  'request.jwt.claim.sub',
  'ab000000-0000-4000-8000-000000000002',
  true
);

CREATE TEMP TABLE first_publication AS
SELECT public.publish_volunteer_hours_transactional(
  'ab200000-0000-4000-8000-000000000001',
  'oneTime',
  '[
    {"signupId":"ab300000-0000-4000-8000-000000000001","checkIn":"2030-08-11T16:00:00Z","checkOut":"2030-08-11T18:30:00Z","userId":"ab000000-0000-4000-8000-000000000005","name":"Forged","email":"forged@local.test"},
    {"signupId":"ab300000-0000-4000-8000-000000000002","checkIn":"2030-08-11T16:15:00Z","checkOut":"2030-08-11T18:45:00Z","userId":"ab000000-0000-4000-8000-000000000005","name":"Forged","email":"forged@local.test"}
  ]'::jsonb,
  'hours-publication:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
) AS result;

SELECT extensions.is(
  (SELECT result ->> 'outcome' FROM first_publication),
  'accepted',
  'authorized staff can atomically publish a staff-manageable project'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.certificates
   WHERE project_id = 'ab200000-0000-4000-8000-000000000001' AND type = 'verified'),
  2::bigint,
  'both verified certificates commit in the publication transaction'
);

SELECT extensions.results_eq(
  $$
    SELECT certificates.signup_id, certificates.volunteer_name, certificates.volunteer_email
    FROM public.certificates AS certificates
    WHERE certificates.project_id = 'ab200000-0000-4000-8000-000000000001'
    ORDER BY certificates.signup_id
  $$,
  $$VALUES
    ('ab300000-0000-4000-8000-000000000001'::uuid, 'Same Volunteer'::text, 'same-one@local.test'::text),
    ('ab300000-0000-4000-8000-000000000002'::uuid, 'Same Volunteer'::text, 'same-two@local.test'::text)
  $$,
  'same-name identities and emails are derived from each exact signup, not the client payload'
);

SELECT extensions.results_eq(
  $$
    SELECT notifications.user_id, notifications.action_url
    FROM public.notifications AS notifications
    WHERE notifications.dedupe_key LIKE 'hours-publication:certificate:%'
    ORDER BY notifications.user_id
  $$,
  $$
    SELECT certificates.user_id, '/certificates/' || certificates.id
    FROM public.certificates AS certificates
    WHERE certificates.project_id = 'ab200000-0000-4000-8000-000000000001'
    ORDER BY certificates.user_id
  $$,
  'in-app notifications are bound to the exact signup certificate even for same-name volunteers'
);

SELECT extensions.ok(
  (SELECT (published ->> 'oneTime')::boolean
   FROM public.projects WHERE id = 'ab200000-0000-4000-8000-000000000001'),
  'project publication state commits with the certificates'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.hours_publication_email_outbox
   WHERE receipt_id = ((SELECT result ->> 'receiptId' FROM first_publication)::uuid)
     AND state = 'queued'),
  2::bigint,
  'one durable email work item exists for each certificate'
);

CREATE TEMP TABLE replayed_publication AS
SELECT public.publish_volunteer_hours_transactional(
  'ab200000-0000-4000-8000-000000000001',
  'oneTime',
  '[
    {"signupId":"ab300000-0000-4000-8000-000000000001","checkIn":"2030-08-11T16:00:00Z","checkOut":"2030-08-11T18:30:00Z"},
    {"signupId":"ab300000-0000-4000-8000-000000000002","checkIn":"2030-08-11T16:15:00Z","checkOut":"2030-08-11T18:45:00Z"}
  ]'::jsonb,
  'hours-publication:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
) AS result;

SELECT extensions.is(
  (SELECT result ->> 'outcome' FROM replayed_publication),
  'replayed',
  'an exact request-key retry returns the durable receipt'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.certificates
   WHERE project_id = 'ab200000-0000-4000-8000-000000000001' AND type = 'verified'),
  2::bigint,
  'a retry does not duplicate verified certificates'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.notifications
   WHERE dedupe_key LIKE 'hours-publication:certificate:%'),
  2::bigint,
  'a retry does not duplicate intentional one-time notifications'
);

SELECT extensions.throws_ok(
  $$SELECT public.publish_volunteer_hours_transactional(
    'ab200000-0000-4000-8000-000000000002', 'oneTime',
    '[{"signupId":"ab300000-0000-4000-8000-000000000003","checkIn":"2030-08-12T16:00:00Z","checkOut":"2030-08-12T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )$$,
  '42501',
  'not authorized to publish project hours',
  'staff cannot manage a project that explicitly disables staff management'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'ab000000-0000-4000-8000-000000000005',
  true
);

SELECT extensions.throws_ok(
  $$SELECT public.publish_volunteer_hours_transactional(
    'ab200000-0000-4000-8000-000000000003', 'oneTime',
    '[{"signupId":"ab300000-0000-4000-8000-000000000004","checkIn":"2030-08-13T16:00:00Z","checkOut":"2030-08-13T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  )$$,
  '42501',
  'not authorized to publish project hours',
  'an unrelated authenticated user cannot publish project hours'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'ab000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$SELECT public.publish_volunteer_hours_transactional(
    'ab200000-0000-4000-8000-000000000003', 'forged-session',
    '[{"signupId":"ab300000-0000-4000-8000-000000000004","checkIn":"2030-08-13T16:00:00Z","checkOut":"2030-08-13T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
  )$$,
  '22023',
  'project session is not valid',
  'a forged session identifier is rejected before any write'
);

SELECT extensions.throws_ok(
  $$SELECT public.publish_volunteer_hours_transactional(
    'ab200000-0000-4000-8000-000000000003', 'oneTime',
    '[{"signupId":"ab300000-0000-4000-8000-000000000001","checkIn":"2030-08-13T16:00:00Z","checkOut":"2030-08-13T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  )$$,
  '22023',
  'one or more signups, sessions, statuses, or time ranges are invalid',
  'a signup from another project cannot be forged into the publication'
);

SELECT extensions.throws_ok(
  $$SELECT public.publish_volunteer_hours_transactional(
    'ab200000-0000-4000-8000-000000000003', 'oneTime',
    '[{"signupId":"ab300000-0000-4000-8000-000000000004","checkIn":"2030-08-13T16:00:00Z","checkOut":"2030-08-13T16:00:10Z"}]'::jsonb,
    'hours-publication:v1:1212121212121212121212121212121212121212121212121212121212121212'
  )$$,
  '22023',
  'one or more signups, sessions, statuses, or time ranges are invalid',
  'a positive duration that rounds to zero minutes is rejected at the database boundary'
);

SELECT extensions.throws_ok(
  $$SELECT public.publish_volunteer_hours_transactional(
    'ab200000-0000-4000-8000-000000000003', 'oneTime',
    '[{"signupId":"ab300000-0000-4000-8000-000000000004","checkIn":"2030-08-13T16:00:00Z","checkOut":"2030-08-14T17:00:00Z"}]'::jsonb,
    'hours-publication:v1:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  )$$,
  '22023',
  'one or more signups, sessions, statuses, or time ranges are invalid',
  'a duration over 24 hours is rejected server-side'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.hours_publication_receipts
   WHERE project_id = 'ab200000-0000-4000-8000-000000000003'),
  0::bigint,
  'rejected forged requests leave no receipt or partial publication'
);

CREATE FUNCTION pg_temp.inject_conflicting_hours_certificate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.project_id = 'ab200000-0000-4000-8000-000000000003'::uuid THEN
    INSERT INTO public.certificates (
      project_id,
      project_title,
      is_certified,
      event_start,
      event_end,
      check_in_method,
      signup_id,
      type
    ) VALUES (
      NEW.project_id,
      'Injected stale certificate',
      false,
      '2030-08-13T15:00:00Z',
      '2030-08-13T17:00:00Z',
      'manual',
      'ab300000-0000-4000-8000-000000000004',
      'verified'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER inject_conflicting_hours_certificate
AFTER INSERT ON public.hours_publication_receipts
FOR EACH ROW EXECUTE FUNCTION pg_temp.inject_conflicting_hours_certificate();

SELECT extensions.throws_ok(
  $$SELECT public.publish_volunteer_hours_transactional(
    'ab200000-0000-4000-8000-000000000003', 'oneTime',
    '[{"signupId":"ab300000-0000-4000-8000-000000000004","checkIn":"2030-08-13T16:00:00Z","checkOut":"2030-08-13T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:9999999999999999999999999999999999999999999999999999999999999999'
  )$$,
  '23505',
  'an existing verified certificate conflicts with canonical publication data',
  'a conflict inserted after the precheck is revalidated instead of silently adopted'
);

DROP TRIGGER inject_conflicting_hours_certificate
  ON public.hours_publication_receipts;

SELECT extensions.is(
  (SELECT count(*) FROM public.certificates
   WHERE signup_id = 'ab300000-0000-4000-8000-000000000004'
     AND type = 'verified'),
  0::bigint,
  'the raced conflict aborts the receipt and certificate transaction'
);

CREATE TEMP TABLE alias_publication AS
SELECT public.publish_volunteer_hours_transactional(
  'ab200000-0000-4000-8000-000000000003',
  '0',
  '[{"signupId":"ab300000-0000-4000-8000-000000000004","checkIn":"2030-08-13T16:00:00Z","checkOut":"2030-08-13T17:30:30Z"}]'::jsonb,
  'hours-publication:v1:3434343434343434343434343434343434343434343434343434343434343434'
) AS result;

SELECT extensions.is(
  (SELECT result ->> 'outcome' FROM alias_publication),
  'accepted',
  'a supported session alias publishes through its canonical project session'
);

SELECT extensions.is(
  (SELECT schedule_id FROM public.hours_publication_receipts
   WHERE project_id = 'ab200000-0000-4000-8000-000000000003'),
  'oneTime',
  'the durable receipt stores the canonical session identifier'
);

SELECT extensions.is(
  (SELECT schedule_id FROM public.certificates
   WHERE signup_id = 'ab300000-0000-4000-8000-000000000004'
     AND type = 'verified'),
  'oneTime',
  'the certificate stores the canonical session used by resend lookup'
);

SELECT extensions.is(
  (SELECT body FROM public.notifications
   WHERE user_id = 'ab000000-0000-4000-8000-000000000004'
     AND dedupe_key LIKE 'hours-publication:certificate:%'
   ORDER BY created_at DESC
   LIMIT 1),
  'Your volunteer certificate for "Unpublished Validation Project" is now available. You volunteered for 1 hours and 31 minutes.',
  'notification duration decomposes the same rounded total minutes as the publication review'
);

CREATE TEMP TABLE claimed_delivery AS
SELECT id
FROM public.hours_publication_email_outbox
WHERE receipt_id = ((SELECT result ->> 'receiptId' FROM first_publication)::uuid)
ORDER BY id
LIMIT 1;

CREATE TEMP TABLE prepared_payload AS
SELECT public.prepare_hours_publication_email_delivery(
  (SELECT id FROM claimed_delivery),
  'Let''s Assist <projects@notifications.lets-assist.com>',
  'Synthetic certificate subject',
  '<p>Immutable synthetic certificate</p>'
) AS result;

SELECT extensions.is(
  (SELECT result ->> 'subject' FROM prepared_payload),
  'Synthetic certificate subject',
  'the first provider payload is durably snapshotted before claim'
);

SELECT extensions.ok(
  (SELECT payload_hash ~ '^[0-9a-f]{64}$'
      AND payload_prepared_at IS NOT NULL
   FROM public.hours_publication_email_outbox
   WHERE id = (SELECT id FROM claimed_delivery)),
  'the provider snapshot carries a durable integrity hash and preparation time'
);

CREATE TEMP TABLE replayed_payload AS
SELECT public.prepare_hours_publication_email_delivery(
  (SELECT id FROM claimed_delivery),
  'Changed Sender <changed@local.test>',
  'Changed subject',
  '<p>Changed deployment template</p>'
) AS result;

SELECT extensions.is(
  (SELECT result FROM replayed_payload),
  (SELECT result FROM prepared_payload),
  'recovery returns the exact first payload despite deployment or project drift'
);

SELECT extensions.ok(
  public.claim_hours_publication_email_delivery(
    (SELECT id FROM claimed_delivery),
    'ab400000-0000-4000-8000-000000000001'
  ),
  'the server can claim queued provider work exactly once'
);

SELECT extensions.ok(
  NOT public.claim_hours_publication_email_delivery(
    (SELECT id FROM claimed_delivery),
    'ab400000-0000-4000-8000-000000000002'
  ),
  'a concurrent worker cannot claim already-processing provider work'
);

SELECT extensions.ok(
  public.settle_hours_publication_email_delivery(
    (SELECT id FROM claimed_delivery),
    'ab400000-0000-4000-8000-000000000001',
    'accepted',
    'synthetic-provider-message',
    NULL
  ),
  'the owning claim can settle an accepted provider response'
);

SELECT extensions.is(
  (SELECT state FROM public.hours_publication_email_outbox
   WHERE id = (SELECT id FROM claimed_delivery)),
  'accepted',
  'accepted provider settlement is durable'
);

SELECT extensions.ok(
  public.settle_hours_publication_email_delivery(
    (SELECT id FROM claimed_delivery),
    'ab400000-0000-4000-8000-000000000001',
    'accepted',
    'synthetic-provider-message',
    NULL
  ),
  'an exact claim-token settlement replay confirms the durable outcome'
);

SELECT extensions.ok(
  NOT public.settle_hours_publication_email_delivery(
    (SELECT id FROM claimed_delivery),
    'ab400000-0000-4000-8000-000000000001',
    'accepted',
    'different-provider-message',
    NULL
  ),
  'a settlement replay cannot change the provider outcome metadata'
);

CREATE TEMP TABLE retryable_delivery AS
SELECT id
FROM public.hours_publication_email_outbox
WHERE receipt_id = ((SELECT result ->> 'receiptId' FROM first_publication)::uuid)
  AND id <> (SELECT id FROM claimed_delivery)
LIMIT 1;

CREATE TEMP TABLE retryable_prepared_payload AS
SELECT public.prepare_hours_publication_email_delivery(
  (SELECT id FROM retryable_delivery),
  'Let''s Assist <projects@notifications.lets-assist.com>',
  'Synthetic retryable certificate subject',
  '<p>Immutable retryable certificate</p>'
) AS result;

SELECT extensions.ok(
  public.claim_hours_publication_email_delivery(
    (SELECT id FROM retryable_delivery),
    'ab400000-0000-4000-8000-000000000003'
  ),
  'the remaining queued delivery can be claimed'
);

SELECT extensions.ok(
  public.settle_hours_publication_email_delivery(
    (SELECT id FROM retryable_delivery),
    'ab400000-0000-4000-8000-000000000003',
    'retryable_failure',
    NULL,
    'provider_unavailable'
  ),
  'a pre-send provider refusal returns durable work to retryable state'
);

SELECT extensions.ok(
  public.claim_hours_publication_email_delivery(
    (SELECT id FROM retryable_delivery),
    'ab400000-0000-4000-8000-000000000004'
  ),
  'an explicit durable drain can claim retryable work again'
);

UPDATE public.hours_publication_email_outbox
SET
  first_attempt_at = now() - interval '20 minutes',
  last_attempt_at = now() - interval '16 minutes'
WHERE id = (SELECT id FROM retryable_delivery);

CREATE TEMP TABLE retryable_first_attempt AS
SELECT first_attempt_at
FROM public.hours_publication_email_outbox
WHERE id = (SELECT id FROM retryable_delivery);

SELECT extensions.ok(
  public.claim_hours_publication_email_delivery(
    (SELECT id FROM retryable_delivery),
    'ab400000-0000-4000-8000-000000000005'
  ),
  'an explicit drain reclaims a stale interrupted claim with the same provider idempotency key'
);

SELECT extensions.is(
  (
    SELECT first_attempt_at
    FROM public.hours_publication_email_outbox
    WHERE id = (SELECT id FROM retryable_delivery)
  ),
  (SELECT first_attempt_at FROM retryable_first_attempt),
  'reclaiming a stale lease does not slide the provider idempotency window'
);

UPDATE public.hours_publication_email_outbox
SET
  first_attempt_at = now() - interval '25 hours',
  last_attempt_at = now() - interval '16 minutes'
WHERE id = (SELECT id FROM retryable_delivery);

SELECT extensions.ok(
  NOT public.claim_hours_publication_email_delivery(
    (SELECT id FROM retryable_delivery),
    'ab400000-0000-4000-8000-000000000006'
  ),
  'a recently reclaimed claim outside the original provider idempotency window is never resent'
);

SELECT extensions.results_eq(
  $$
    SELECT state, safe_code
    FROM public.hours_publication_email_outbox
    WHERE id = (SELECT id FROM retryable_delivery)
  $$,
  $$VALUES ('unknown_outcome'::text, 'settlement_unconfirmed'::text)$$,
  'expired ambiguous work is terminalized honestly for reconciliation'
);

DROP INDEX public.certificates_verified_signup_unique;
INSERT INTO public.certificates (
  project_title,
  is_certified,
  event_start,
  event_end,
  check_in_method,
  signup_id,
  type
)
VALUES (
  'Synthetic conflicting certificate',
  false,
  '2030-08-11T16:00:00Z',
  '2030-08-11T18:30:00Z',
  'manual',
  'ab300000-0000-4000-8000-000000000001',
  'verified'
);

SELECT extensions.throws_ok(
  $$DO $migration_preflight$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM public.certificates
      WHERE type = 'verified'
        AND signup_id IS NOT NULL
      GROUP BY signup_id
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'cannot enforce verified certificate uniqueness: duplicate signup certificates exist',
        HINT = 'Resolve the conflicting verified certificates explicitly before retrying this migration.';
    END IF;
  END;
  $migration_preflight$;$$,
  '23505',
  'cannot enforce verified certificate uniqueness: duplicate signup certificates exist',
  'the migration aborts on pre-existing conflicts instead of deleting evidence'
);

SELECT * FROM extensions.finish();

ROLLBACK;
