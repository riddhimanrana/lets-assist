-- The email recovery claim is a counted inventory of committed delivery
-- ledgers. It selects at most 25 deliveries fairly, counts what stays pending
-- or held in the same statement, and never creates approval that no organizer
-- gave. All fixtures are synthetic and roll back with this test.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

-- ---------------------------------------------------------------------------
-- 1. Neutralize pre-existing deliveries, then measure the baseline inventory
-- ---------------------------------------------------------------------------

-- Deliveries already in this database are put into cooldown, so the claims
-- below can only select this file's fixtures. Counts are compared as
-- differences from the baseline taken here.
DO $neutralize$
DECLARE
  v_round integer := 0;
BEGIN
  LOOP
    v_round := v_round + 1;
    EXIT WHEN v_round > 500
      OR public.claim_hours_publication_email_recovery(25) -> 'groups' = '[]'::jsonb;
  END LOOP;
  UPDATE public.hours_publication_email_outbox
  SET recovery_selected_at = clock_timestamp() + interval '1 day'
  WHERE recovery_selected_at IS NOT NULL;
END;
$neutralize$;

CREATE TEMP TABLE baseline AS
SELECT public.claim_hours_publication_email_recovery(25) AS result;

SELECT extensions.ok(
  (SELECT (result ->> 'counted')::boolean AND result -> 'groups' = '[]'::jsonb
     AND jsonb_typeof(result -> 'pendingDeliveries') = 'number'
     AND jsonb_typeof(result -> 'heldDeliveries') = 'number'
   FROM baseline),
  'the claim is a counted inventory envelope even when it selects nothing'
);

-- Pending and held counts this file added on top of the baseline.
CREATE FUNCTION pg_temp.inventory(p_result jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'counted', (p_result ->> 'counted')::boolean,
    'pending', (p_result ->> 'pendingDeliveries')::integer
      - (SELECT (result ->> 'pendingDeliveries')::integer FROM baseline),
    'held', (p_result ->> 'heldDeliveries')::integer
      - (SELECT (result ->> 'heldDeliveries')::integer FROM baseline));
$$;

CREATE FUNCTION pg_temp.selected(p_result jsonb)
RETURNS uuid[] LANGUAGE sql AS $$
  SELECT COALESCE(
    array_agg((delivery.value ->> 'deliveryId')::uuid ORDER BY (delivery.value ->> 'deliveryId')::uuid),
    ARRAY[]::uuid[])
  FROM jsonb_array_elements(p_result -> 'groups') AS receipt_group(value),
    jsonb_array_elements(receipt_group.value -> 'publication' -> 'deliveries') AS delivery(value);
$$;

-- ---------------------------------------------------------------------------
-- 2. Fixtures: one published session of eight awards, one of a single award
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  ('c8100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'authenticated', 'authenticated',
  'email-recovery-' || n || '@local.test', now(), '{}',
  jsonb_build_object(
    'username', 'email_recovery_' || n,
    'full_name', 'Email recovery volunteer ' || n
  ),
  now(), now()
FROM generate_series(1, 25) AS n;

UPDATE public.profiles AS profiles
SET full_name = 'Email recovery volunteer', email = users.email
FROM auth.users AS users
WHERE users.id = profiles.id
  AND profiles.id::text LIKE 'c8100000-0000-4000-8000-%';

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, status, project_timezone
)
SELECT
  ('c8200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'c8100000-0000-4000-8000-000000000001',
  'Email recovery fixture ' || n, 'Local', 'Synthetic email recovery fixture',
  'oneTime', 'manual',
  '{"oneTime":{"date":"2020-09-18","startTime":"09:00","endTime":"12:00","volunteers":100}}'::jsonb,
  'upcoming', 'UTC'
FROM generate_series(1, 2) AS n;

CREATE FUNCTION pg_temp.attend(
  p_project integer, p_first integer, p_last integer,
  p_status text, p_in timestamptz, p_out timestamptz
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.project_signups (
    id, project_id, user_id, schedule_id, status, check_in_time, check_out_time
  )
  SELECT
    ('c83' || lpad(p_project::text, 5, '0') || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
    ('c8200000-0000-4000-8000-' || lpad(p_project::text, 12, '0'))::uuid,
    ('c8100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
    'oneTime', p_status, p_in, p_out
  FROM generate_series(p_first, p_last) AS n;
$$;

CREATE FUNCTION pg_temp.publish(p_project integer, p_key_pair text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.publish_volunteer_hours_transactional(
    'c8100000-0000-4000-8000-000000000001',
    ('c8200000-0000-4000-8000-' || lpad(p_project::text, 12, '0'))::uuid,
    'oneTime',
    (SELECT jsonb_agg(jsonb_build_object('signupId', id, 'checkIn', check_in_time,
        'checkOut', check_out_time, 'attendanceRevision', attendance_revision) ORDER BY id)
     FROM public.project_signups
     WHERE project_id = ('c8200000-0000-4000-8000-' || lpad(p_project::text, 12, '0'))::uuid
       AND status = 'attended'),
    'hours-publication:v1:' || repeat(p_key_pair, 32));
$$;

-- A reviewed correction of one published award, as an organizer makes it.
CREATE FUNCTION pg_temp.correct_award(p_certificate uuid, p_request integer)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.correct_project_attendance(
    certificates.signup_id, certificates.attendance_revision,
    'Synthetic reviewed correction',
    '[{"checkIn":"2020-09-18T10:00:00Z","checkOut":"2020-09-18T10:45:00Z"}]'::jsonb,
    ('c8400000-0000-4000-8000-' || lpad(p_request::text, 12, '0'))::uuid,
    'c8100000-0000-4000-8000-000000000001')
  FROM public.certificates AS certificates WHERE certificates.id = p_certificate;
$$;

SELECT pg_temp.attend(1, 3, 10, 'attended', '2020-09-18T10:00:00Z', '2020-09-18T11:00:00Z');
SELECT pg_temp.attend(2, 11, 11, 'attended', '2020-09-18T10:00:00Z', '2020-09-18T11:30:00Z');

CREATE TEMP TABLE publication AS SELECT pg_temp.publish(1, 'a1') AS result;

CREATE TEMP TABLE work AS
SELECT outbox.id, outbox.certificate_id, row_number() OVER (ORDER BY outbox.id) AS slot
FROM public.hours_publication_email_outbox AS outbox
WHERE outbox.receipt_id = (SELECT (result ->> 'receiptId')::uuid FROM publication);

SELECT extensions.is(
  (SELECT count(*) FROM work), 8::bigint,
  'the first session publishes eight awards with one delivery each'
);

UPDATE public.hours_publication_email_outbox
SET state = 'queued', settled_at = NULL, safe_code = NULL
WHERE id IN (SELECT id FROM work);

-- Slot 1 stays queued. Slot 2 failed before sending. Slot 3 is an abandoned
-- lease. Slot 4 is a live lease. Slot 5 is accepted, 6 unknown, 7 a
-- definitive provider refusal, 8 an intentional skip.
UPDATE public.hours_publication_email_outbox
SET state = 'retryable_failure', attempt_count = 1,
  last_attempt_at = now() - interval '1 hour', safe_code = 'provider_unavailable'
WHERE id = (SELECT id FROM work WHERE slot = 2);
UPDATE public.hours_publication_email_outbox
SET state = 'processing', claim_token = gen_random_uuid(), attempt_count = 1,
  first_attempt_at = now() - interval '20 minutes', last_attempt_at = now() - interval '16 minutes'
WHERE id = (SELECT id FROM work WHERE slot = 3);
UPDATE public.hours_publication_email_outbox
SET state = 'processing', claim_token = gen_random_uuid(), attempt_count = 1,
  first_attempt_at = now() - interval '1 minute', last_attempt_at = now() - interval '1 minute'
WHERE id = (SELECT id FROM work WHERE slot = 4);
UPDATE public.hours_publication_email_outbox AS outbox
SET state = terminal.state, attempt_count = 1, settled_at = now(),
  first_attempt_at = now() - interval '1 hour', last_attempt_at = now() - interval '1 hour'
FROM (VALUES (5, 'accepted'), (6, 'unknown_outcome'), (7, 'definitive_failure')) AS terminal(slot, state)
WHERE outbox.id = (SELECT id FROM work WHERE work.slot = terminal.slot);
UPDATE public.hours_publication_email_outbox
SET state = 'skipped', settled_at = now(), safe_code = 'recipient_missing'
WHERE id = (SELECT id FROM work WHERE slot = 8);

-- A later delivery revision with no snapshot and no organizer request, as a
-- bare attendance revision would leave it.
INSERT INTO public.hours_publication_email_outbox (
  receipt_id, certificate_id, idempotency_key, delivery_revision, state
)
SELECT (SELECT (result ->> 'receiptId')::uuid FROM publication),
  work.certificate_id, 'synthetic-unapproved-revision', 1, 'queued'
FROM work WHERE work.slot = 1;

CREATE TEMP TABLE ledger_before AS
SELECT outbox.id,
  to_jsonb(outbox) - 'recovery_selected_at' - 'recovery_selection_count' AS row_data
FROM public.hours_publication_email_outbox AS outbox
WHERE outbox.receipt_id = (SELECT (result ->> 'receiptId')::uuid FROM publication);

-- ---------------------------------------------------------------------------
-- 3. Selection, inventory, and the provider timeline
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE first_claim AS
SELECT public.claim_hours_publication_email_recovery(25) AS result;

SELECT extensions.is(
  (SELECT pg_temp.selected(result) FROM first_claim),
  (SELECT array_agg(id ORDER BY id) FROM work WHERE slot IN (1, 2, 3)),
  'queued, retryable, and abandoned-lease deliveries are selected; nothing else is'
);

SELECT extensions.is(
  (SELECT pg_temp.inventory(result) FROM first_claim),
  '{"counted":true,"pending":1,"held":1}'::jsonb,
  'the live lease is counted pending and the unknown outcome held; accepted, refused, skipped, and unapproved rows are not counted'
);

SELECT extensions.ok(
  (
    SELECT jsonb_array_length(result -> 'groups') = 1
      AND result -> 'groups' -> 0 ->> 'projectId' = 'c8200000-0000-4000-8000-000000000001'
      AND result -> 'groups' -> 0 -> 'publication' ->> 'outcome' = 'replayed'
      AND result -> 'groups' -> 0 -> 'publication' ->> 'publicationOrigin' = 'manual'
      AND result -> 'groups' -> 0 -> 'publication' ->> 'receiptId'
        = (SELECT result ->> 'receiptId' FROM publication)
      AND (
        SELECT bool_and(delivery.value ->> 'idempotencyKey'
            = 'hours-publication:v1:certificate:' || (delivery.value ->> 'certificateId')
          AND NOT (delivery.value ->> 'payloadPrepared')::boolean)
        FROM jsonb_array_elements(result -> 'groups' -> 0 -> 'publication' -> 'deliveries') AS delivery(value)
      )
    FROM first_claim
  ),
  'selected work is grouped under its receipt with the original provider idempotency keys'
);

SELECT extensions.is(
  (SELECT array_agg(outbox.id ORDER BY outbox.id)
   FROM public.hours_publication_email_outbox AS outbox
   JOIN ledger_before ON ledger_before.id = outbox.id
   WHERE to_jsonb(outbox) - 'recovery_selected_at' - 'recovery_selection_count'
     IS DISTINCT FROM ledger_before.row_data),
  NULL::uuid[],
  'selection writes only its own ledger: no state, key, receipt, lease, or attempt window changes'
);

SELECT extensions.ok(
  (SELECT bool_and((outbox.recovery_selected_at IS NOT NULL) = (work.slot IN (1, 2, 3))
       AND outbox.recovery_selection_count = CASE WHEN work.slot IN (1, 2, 3) THEN 1 ELSE 0 END)
   FROM public.hours_publication_email_outbox AS outbox JOIN work ON work.id = outbox.id)
  AND (SELECT recovery_selected_at IS NULL AND recovery_selection_count = 0
       FROM public.hours_publication_email_outbox
       WHERE idempotency_key = 'synthetic-unapproved-revision'),
  'only the selected deliveries record a selection'
);

CREATE TEMP TABLE cooling_claim AS
SELECT public.claim_hours_publication_email_recovery(25) AS result;

SELECT extensions.ok(
  (SELECT result -> 'groups' = '[]'::jsonb
     AND pg_temp.inventory(result) = '{"counted":true,"pending":4,"held":1}'::jsonb
   FROM cooling_claim),
  'deliveries inside the selection cooldown are pending, not reselected and not forgotten'
);

UPDATE public.hours_publication_email_outbox AS outbox
SET recovery_selected_at = clock_timestamp() - CASE work.slot
  WHEN 1 THEN interval '20 minutes'
  WHEN 2 THEN interval '30 minutes'
  ELSE interval '40 minutes'
END
FROM work WHERE work.id = outbox.id AND work.slot IN (1, 2, 3);

CREATE TEMP TABLE bounded_claim AS
SELECT public.claim_hours_publication_email_recovery(1) AS result;

SELECT extensions.ok(
  (SELECT pg_temp.selected(result) = (SELECT ARRAY[id] FROM work WHERE slot = 3)
     AND pg_temp.inventory(result) = '{"counted":true,"pending":3,"held":1}'::jsonb
   FROM bounded_claim),
  'a full batch takes the least recently selected delivery and counts the eligible rest as pending'
);

SELECT extensions.is(
  pg_temp.selected(public.claim_hours_publication_email_recovery(1)),
  (SELECT ARRAY[id] FROM work WHERE slot = 2),
  'the next claim moves on to the next oldest selection'
);

-- The per-delivery claim still owns the provider window. An abandoned lease
-- older than 24 hours becomes unknown, and unknown is held for good.
UPDATE public.hours_publication_email_outbox
SET first_attempt_at = now() - interval '25 hours', recovery_selected_at = NULL
WHERE id = (SELECT id FROM work WHERE slot = 3);

SELECT extensions.ok(
  NOT public.claim_hours_publication_email_delivery(
    (SELECT id FROM work WHERE slot = 3), gen_random_uuid()),
  'an abandoned lease outside the provider idempotency window cannot be reclaimed'
);
SELECT extensions.is(
  (SELECT state FROM public.hours_publication_email_outbox
   WHERE id = (SELECT id FROM work WHERE slot = 3)),
  'unknown_outcome',
  'the expired lease settles as unknown instead of resending'
);

UPDATE public.hours_publication_email_outbox SET recovery_selected_at = NULL
WHERE id IN (SELECT id FROM work);

CREATE TEMP TABLE unknown_claim AS
SELECT public.claim_hours_publication_email_recovery(25) AS result;

SELECT extensions.ok(
  (SELECT pg_temp.selected(result) = (SELECT array_agg(id ORDER BY id) FROM work WHERE slot IN (1, 2))
     AND pg_temp.inventory(result) = '{"counted":true,"pending":1,"held":2}'::jsonb
   FROM unknown_claim),
  'an unknown outcome is held and counted, and is never offered for resend'
);

SELECT extensions.throws_ok(
  $$UPDATE public.hours_publication_email_outbox
    SET idempotency_key = 'synthetic-rewritten-key'
    WHERE id = (SELECT id FROM work WHERE slot = 1)$$,
  '22023', 'certificate delivery identity and snapshot are immutable',
  'the delivery scope of committed work cannot be rewritten'
);

-- ---------------------------------------------------------------------------
-- 4. An unfrozen initial delivery is held once its award has been corrected
-- ---------------------------------------------------------------------------

-- Slot 2 was never frozen. Its award is now corrected, so sending it would
-- put the corrected hours under the original send intent.
SELECT extensions.is(
  pg_temp.correct_award((SELECT certificate_id FROM work WHERE slot = 2), 1) ->> 'outcome',
  'accepted',
  'the organizer corrects an award whose initial email is still unsent'
);

UPDATE public.hours_publication_email_outbox SET recovery_selected_at = NULL
WHERE id IN (SELECT id FROM work WHERE slot IN (1, 2));

CREATE TEMP TABLE stale_claim AS
SELECT public.claim_hours_publication_email_recovery(25) AS result;

SELECT extensions.ok(
  (SELECT pg_temp.selected(result) = (SELECT ARRAY[id] FROM work WHERE slot = 1)
     AND pg_temp.inventory(result) = '{"counted":true,"pending":1,"held":3}'::jsonb
   FROM stale_claim),
  'the corrected, unfrozen initial delivery is held and counted instead of sent'
);

SELECT extensions.ok(
  (SELECT state = 'retryable_failure' AND payload_snapshot IS NULL
     AND recovery_selected_at IS NULL AND recovery_selection_count = 3
   FROM public.hours_publication_email_outbox
   WHERE id = (SELECT id FROM work WHERE slot = 2)),
  'the hold changes nothing on the held delivery'
);

-- Slot 1 is frozen first and corrected afterwards. Its original payload and
-- key already exist, so it continues.
SELECT extensions.ok(
  public.prepare_hours_publication_email_delivery(
    (SELECT id FROM work WHERE slot = 1),
    'Fictional <fictional@local.test>', 'Original subject', '<p>Original award</p>'
  ) ->> 'subject' = 'Original subject'
  AND pg_temp.correct_award((SELECT certificate_id FROM work WHERE slot = 1), 2) ->> 'outcome' = 'accepted',
  'an initial delivery is frozen before its award is corrected'
);

UPDATE public.hours_publication_email_outbox SET recovery_selected_at = NULL
WHERE id = (SELECT id FROM work WHERE slot = 1);

CREATE TEMP TABLE frozen_claim AS
SELECT public.claim_hours_publication_email_recovery(25) AS result;

SELECT extensions.ok(
  (SELECT pg_temp.selected(result) = (SELECT ARRAY[id] FROM work WHERE slot = 1)
     AND (result -> 'groups' -> 0 -> 'publication' -> 'deliveries' -> 0 ->> 'payloadPrepared')::boolean
     AND pg_temp.inventory(result) = '{"counted":true,"pending":1,"held":3}'::jsonb
   FROM frozen_claim),
  'a frozen initial delivery keeps its original payload and is still recovered after a correction'
);

-- A change recorded before the award existed is not a correction of it. Late
-- reviewed attendance on a published session creates such a change, then the
-- award and its delivery.
CREATE TEMP TABLE second_publication AS SELECT pg_temp.publish(2, 'b2') AS result;

SELECT pg_temp.attend(2, 12, 12, 'approved', NULL, NULL);

CREATE TEMP TABLE late_attendance AS
SELECT public.record_project_attendance(
  'c8300002-0000-4000-8000-000000000012', 0, 'Reviewed late attendance',
  '[{"checkIn":"2020-09-18T10:00:00Z","checkOut":"2020-09-18T11:00:00Z"}]'::jsonb,
  'c8400000-0000-4000-8000-000000000003',
  'c8100000-0000-4000-8000-000000000001') AS result;

CREATE TEMP TABLE late_delivery AS
SELECT outbox.id FROM public.hours_publication_email_outbox AS outbox
WHERE outbox.certificate_id = (SELECT (result ->> 'certificateId')::uuid FROM late_attendance);

SELECT extensions.ok(
  (SELECT count(*) = 1 FROM late_delivery)
  AND EXISTS (SELECT 1 FROM private.project_attendance_changes
              WHERE signup_id = 'c8300002-0000-4000-8000-000000000012'
                AND old_credited_minutes IS NULL),
  'late reviewed attendance records a pre-award change and one initial delivery'
);

CREATE TEMP TABLE late_claim AS
SELECT public.claim_hours_publication_email_recovery(25) AS result;

SELECT extensions.ok(
  (SELECT (SELECT id FROM late_delivery) = ANY (pg_temp.selected(result))
     AND cardinality(pg_temp.selected(result)) = 2
     AND pg_temp.inventory(result) = '{"counted":true,"pending":2,"held":3}'::jsonb
   FROM late_claim),
  'a pre-award attendance change does not hold the award''s initial delivery'
);

-- ---------------------------------------------------------------------------
-- 5. Corrected deliveries continue only with a proven organizer request
-- ---------------------------------------------------------------------------

-- Slot 5 was already delivered. The organizer corrects it and asks for the
-- corrected certificate to be sent: the only way a correction ledger exists.
SELECT extensions.is(
  pg_temp.correct_award((SELECT certificate_id FROM work WHERE slot = 5), 4) ->> 'outcome',
  'accepted',
  'the organizer corrects an award that was already emailed'
);

CREATE TEMP TABLE correction_request AS
SELECT public.request_corrected_certificate_delivery(
  'c8200000-0000-4000-8000-000000000001',
  (SELECT certificate_id FROM work WHERE slot = 5), 2,
  'c8400000-0000-4000-8000-000000000005',
  'c8100000-0000-4000-8000-000000000001') AS result;

CREATE TEMP TABLE correction_ledger AS
SELECT outbox.id, outbox.receipt_id, outbox.certificate_snapshot
FROM public.hours_publication_email_outbox AS outbox
WHERE outbox.id = (SELECT (result -> 'deliveries' -> 0 ->> 'deliveryId')::uuid FROM correction_request);

SELECT extensions.ok(
  (SELECT result ->> 'outcome' = 'accepted' FROM correction_request)
  AND (SELECT count(*) = 1 AND bool_and(certificate_snapshot ->> 'creditedMinutes' = '45')
       FROM correction_ledger),
  'the organizer request creates one corrected delivery with a frozen snapshot'
);

-- Today's metadata changes after the request. A delivery with a snapshot and
-- a coherent key but no request ledger also appears, as an edit would leave it.
UPDATE public.projects SET title = 'Renamed after the correction request'
WHERE id = 'c8200000-0000-4000-8000-000000000001';

INSERT INTO public.hours_publication_email_outbox (
  receipt_id, certificate_id, idempotency_key, delivery_revision, certificate_snapshot, state
)
SELECT (SELECT (result ->> 'receiptId')::uuid FROM publication),
  work.certificate_id,
  'hours-correction:v1:certificate:' || work.certificate_id || ':revision:3', 3,
  '{"volunteerEmail":"edited-without-approval@local.test","creditedMinutes":30}'::jsonb,
  'queued'
FROM work WHERE work.slot = 6;

CREATE TEMP TABLE correction_claim AS
SELECT public.claim_hours_publication_email_recovery(25) AS result;

SELECT extensions.ok(
  (SELECT pg_temp.selected(result) = (SELECT ARRAY[id] FROM correction_ledger)
     AND pg_temp.inventory(result) = '{"counted":true,"pending":4,"held":3}'::jsonb
   FROM correction_claim),
  'only the explicitly requested correction continues; unrequested revisions and edits are neither sent nor counted'
);

SELECT extensions.ok(
  (
    SELECT claim.result -> 'groups' -> 0 -> 'publication' ->> 'receiptId' = ledger.receipt_id::text
      AND claim.result -> 'groups' -> 0 -> 'publication' ->> 'projectTitle' = 'Email recovery fixture 1'
      AND delivery.value ->> 'volunteerEmail' = ledger.certificate_snapshot ->> 'volunteerEmail'
      AND delivery.value ->> 'volunteerName' = ledger.certificate_snapshot ->> 'volunteerName'
      AND delivery.value -> 'eventEnd' = ledger.certificate_snapshot -> 'eventEnd'
      AND (delivery.value ->> 'creditedMinutes')::integer = 45
      AND (delivery.value ->> 'attendanceRevision')::integer = 2
      AND delivery.value ->> 'idempotencyKey'
        = 'hours-correction:v1:certificate:' || (delivery.value ->> 'certificateId') || ':revision:2'
    FROM correction_claim AS claim, correction_ledger AS ledger,
      jsonb_array_elements(claim.result -> 'groups' -> 0 -> 'publication' -> 'deliveries') AS delivery(value)
  ),
  'a recovered correction is described by its frozen snapshot and original key, not by today''s project'
);

SELECT extensions.ok(
  (SELECT count(*) = 1 FROM public.hours_publication_receipts
   WHERE project_id = 'c8200000-0000-4000-8000-000000000001'
     AND publish_key LIKE 'certificate-correction:%')
  AND (SELECT count(*) = 1 FROM private.corrected_certificate_delivery_requests
       WHERE receipt_id = (SELECT receipt_id FROM correction_ledger))
  AND (SELECT count(*) = 1 FROM public.hours_publication_email_outbox
       WHERE receipt_id = (SELECT receipt_id FROM correction_ledger))
  AND (SELECT bool_and(recovery_selected_at IS NULL AND recovery_selection_count = 0)
       FROM public.hours_publication_email_outbox
       WHERE idempotency_key = 'synthetic-unapproved-revision'
          OR idempotency_key LIKE 'hours-correction:v1:certificate:%:revision:3'),
  'the claim creates no correction receipt, request, or delivery, and never selects an unapproved one'
);

UPDATE public.hours_publication_email_outbox
SET state = 'unknown_outcome', attempt_count = 1, settled_at = now(),
  first_attempt_at = now() - interval '1 hour', last_attempt_at = now() - interval '1 hour',
  safe_code = 'settlement_unconfirmed', recovery_selected_at = NULL
WHERE id = (SELECT id FROM correction_ledger);

CREATE TEMP TABLE corrected_unknown_claim AS
SELECT public.claim_hours_publication_email_recovery(25) AS result;

SELECT extensions.ok(
  (SELECT result -> 'groups' = '[]'::jsonb
     AND pg_temp.inventory(result) = '{"counted":true,"pending":4,"held":4}'::jsonb
   FROM corrected_unknown_claim),
  'a corrected delivery with an unknown outcome is held and is not resent'
);

-- ---------------------------------------------------------------------------
-- 6. Supplemental awards commit with their ledger; unledgered awards stay out
-- ---------------------------------------------------------------------------

-- Attendance recorded after publication without an award: the state the
-- supplemental path exists to repair. Only the automatic award trigger is
-- switched off, and only around this one insert.
--
-- project_signups_user_id_fkey1 is DEFERRABLE INITIALLY DEFERRED, so every
-- signup this file inserted earlier still has a foreign-key check queued for
-- commit, and PostgreSQL refuses ALTER TABLE on a table with pending trigger
-- events. Making that one constraint IMMEDIATE runs the queued checks now,
-- which clears the way for the first ALTER. Keeping it IMMEDIATE until the
-- trigger is back on means the insert below is checked at the end of its own
-- statement and queues nothing, which clears the way for the second ALTER.
-- The constraint is still enforced throughout, then returned to DEFERRED.
SET CONSTRAINTS public.project_signups_user_id_fkey1 IMMEDIATE;
ALTER TABLE public.project_signups DISABLE TRIGGER issue_verified_certificate_for_late_attendance;
SELECT pg_temp.attend(2, 20, 21, 'attended', '2020-09-18T10:00:00Z', '2020-09-18T11:00:00Z');
ALTER TABLE public.project_signups ENABLE TRIGGER issue_verified_certificate_for_late_attendance;
SET CONSTRAINTS public.project_signups_user_id_fkey1 DEFERRED;

SELECT extensions.ok(
  (SELECT count(*) = 2 AND bool_and(status = 'attended' AND check_out_time IS NOT NULL)
   FROM public.project_signups
   WHERE id IN ('c8300002-0000-4000-8000-000000000020', 'c8300002-0000-4000-8000-000000000021'))
  AND NOT EXISTS (
    SELECT 1 FROM public.certificates
    WHERE signup_id IN ('c8300002-0000-4000-8000-000000000020', 'c8300002-0000-4000-8000-000000000021'))
  AND (SELECT tgenabled = 'O' FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.project_signups'::regclass
         AND tgname = 'issue_verified_certificate_for_late_attendance'
         AND NOT tgisinternal),
  'both late attendance rows exist without an award, and the automatic award trigger is enabled again before recovery runs'
);

SELECT extensions.throws_ok(
  $$SELECT public.recover_supplemental_verified_certificates(
    'c8200000-0000-4000-8000-000000000002', 'oneTime',
    ARRAY['c8300002-0000-4000-8000-000000000020']::uuid[],
    'c8100000-0000-4000-8000-000000000002')$$,
  '42501', 'not authorized to recover certificates',
  'an account that does not manage the project cannot recover its awards'
);

CREATE TEMP TABLE supplemental_first AS
SELECT public.recover_supplemental_verified_certificates(
  'c8200000-0000-4000-8000-000000000002', 'oneTime',
  ARRAY['c8300002-0000-4000-8000-000000000020']::uuid[],
  'c8100000-0000-4000-8000-000000000001') AS result;

SELECT extensions.ok(
  (
    SELECT (result ->> 'issued')::integer = 1
      AND NOT (result ->> 'recoveryRequired')::boolean
      AND jsonb_array_length(result -> 'publication' -> 'deliveries') = 1
      AND result -> 'publication' -> 'deliveries' -> 0 ->> 'state' = 'queued'
      AND result -> 'publication' -> 'deliveries' -> 0 ->> 'certificateId' = (
        SELECT id::text FROM public.certificates
        WHERE signup_id = 'c8300002-0000-4000-8000-000000000020' AND type = 'verified')
    FROM supplemental_first
  ),
  'a new award returns exactly its own queued delivery, not the rest of the session'
);

SELECT extensions.ok(
  (SELECT count(*) = 1 FROM public.hours_publication_email_outbox AS outbox
   JOIN public.certificates AS certificates ON certificates.id = outbox.certificate_id
   WHERE certificates.signup_id = 'c8300002-0000-4000-8000-000000000020')
  AND (SELECT count(*) = 1 FROM public.notifications AS notifications
       JOIN public.certificates AS certificates
         ON notifications.dedupe_key = 'hours-publication:certificate:' || certificates.id
       WHERE certificates.signup_id = 'c8300002-0000-4000-8000-000000000020')
  AND (SELECT count(*) = 1 AND bool_and(certificate_count = 3 AND email_work_count = 3)
       FROM public.hours_publication_receipts
       WHERE project_id = 'c8200000-0000-4000-8000-000000000002'),
  'the award, its email work, its notification, and the shared receipt counts commit together'
);

CREATE TEMP TABLE supplemental_replay AS
SELECT public.recover_supplemental_verified_certificates(
  'c8200000-0000-4000-8000-000000000002', 'oneTime',
  ARRAY['c8300002-0000-4000-8000-000000000020']::uuid[],
  'c8100000-0000-4000-8000-000000000001') AS result;

SELECT extensions.ok(
  (
    SELECT (replay.result ->> 'issued')::integer = 0
      AND NOT (replay.result ->> 'recoveryRequired')::boolean
      AND replay.result -> 'publication' -> 'deliveries' -> 0 ->> 'deliveryId'
        = first.result -> 'publication' -> 'deliveries' -> 0 ->> 'deliveryId'
      AND jsonb_array_length(replay.result -> 'publication' -> 'deliveries') = 1
    FROM supplemental_replay AS replay, supplemental_first AS first
  )
  AND (SELECT count(*) = 3 FROM public.hours_publication_email_outbox AS outbox
       JOIN public.hours_publication_receipts AS receipt ON receipt.id = outbox.receipt_id
       WHERE receipt.project_id = 'c8200000-0000-4000-8000-000000000002')
  AND (SELECT count(*) = 1 FROM public.notifications AS notifications
       JOIN public.certificates AS certificates
         ON notifications.dedupe_key = 'hours-publication:certificate:' || certificates.id
       WHERE certificates.signup_id = 'c8300002-0000-4000-8000-000000000020'),
  'a retry issues nothing, duplicates nothing, and returns the same tracked delivery'
);

-- An award issued by the older path has no ledger entry. Whether its email
-- was sent is unknown, so it is reported and never enqueued or counted.
SELECT extensions.is(
  (SELECT count(*) FROM public.issue_supplemental_verified_certificates(
    'c8200000-0000-4000-8000-000000000002', 'oneTime',
    ARRAY['c8300002-0000-4000-8000-000000000021']::uuid[],
    'c8100000-0000-4000-8000-000000000001')),
  1::bigint,
  'the older issuance path creates an award without delivery work'
);

CREATE TEMP TABLE supplemental_historical AS
SELECT public.recover_supplemental_verified_certificates(
  'c8200000-0000-4000-8000-000000000002', 'oneTime',
  ARRAY['c8300002-0000-4000-8000-000000000020', 'c8300002-0000-4000-8000-000000000021']::uuid[],
  'c8100000-0000-4000-8000-000000000001') AS result;

SELECT extensions.ok(
  (
    SELECT (result ->> 'issued')::integer = 0
      AND (result ->> 'recoveryRequired')::boolean
      AND jsonb_array_length(result -> 'publication' -> 'deliveries') = 1
    FROM supplemental_historical
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.hours_publication_email_outbox AS outbox
    JOIN public.certificates AS certificates ON certificates.id = outbox.certificate_id
    WHERE certificates.signup_id = 'c8300002-0000-4000-8000-000000000021'),
  'a historical award without a ledger is held for review and gains no delivery work'
);

SELECT extensions.ok(
  (
    SELECT (result ->> 'issued')::integer = 0
      AND NOT (result ->> 'recoveryRequired')::boolean
      AND result -> 'publication' -> 'deliveries' = '[]'::jsonb
    FROM (
      SELECT public.recover_supplemental_verified_certificates(
        'c8200000-0000-4000-8000-000000000002', 'oneTime',
        ARRAY['c8300001-0000-4000-8000-000000000003']::uuid[],
        'c8100000-0000-4000-8000-000000000001') AS result
    ) AS foreign_request
  ),
  'a signup from another project is outside the recovery scope'
);

-- ---------------------------------------------------------------------------
-- 7. A delivery that keeps failing before its provider claim cannot starve
--    a later receipt
-- ---------------------------------------------------------------------------

-- Slot 1 is older than the supplemental delivery and has never reached a
-- provider claim, as when its send fails before the claim on every run. Its
-- provider timeline is still empty, so only the selection ledger can move it
-- behind work that has not had a turn.
UPDATE public.hours_publication_email_outbox
SET recovery_selected_at = clock_timestamp() - interval '16 minutes'
WHERE id = (SELECT id FROM work WHERE slot = 1);

CREATE TEMP TABLE later_receipt_claim AS
SELECT public.claim_hours_publication_email_recovery(1) AS result;

SELECT extensions.ok(
  (SELECT pg_temp.selected(result) = ARRAY[
       (SELECT (result -> 'publication' -> 'deliveries' -> 0 ->> 'deliveryId')::uuid FROM supplemental_first)]
     -- Slot 1 is eligible and unselected, beside two cooling deliveries and
     -- the live lease. The unledgered award adds nothing to either count.
     AND pg_temp.inventory(result) = '{"counted":true,"pending":4,"held":4}'::jsonb
   FROM later_receipt_claim),
  'a never-selected delivery of a later receipt is recovered before a repeatedly selected older one'
);

CREATE TEMP TABLE remaining_claim AS
SELECT public.claim_hours_publication_email_recovery(25) AS result;

SELECT extensions.ok(
  (SELECT pg_temp.selected(result) = (SELECT ARRAY[id] FROM work WHERE slot = 1) FROM remaining_claim)
  AND NOT (SELECT pg_temp.selected(later.result) && pg_temp.selected(remaining.result)
           FROM later_receipt_claim AS later, remaining_claim AS remaining),
  'the older delivery still gets its turn, and consecutive claims never return the same delivery'
);

SELECT extensions.ok(
  (SELECT state = 'queued' AND attempt_count = 0
     AND first_attempt_at IS NULL AND last_attempt_at IS NULL
     AND recovery_selection_count = 5
   FROM public.hours_publication_email_outbox
   WHERE id = (SELECT id FROM work WHERE slot = 1)),
  'repeated selection never wrote the provider lease or idempotency window'
);

-- Two-connection acceptance, run by the parent against an isolated database
-- because one pgTAP transaction cannot hold two snapshots. With at least 30
-- queued deliveries committed:
--   A: BEGIN; SELECT public.claim_hours_publication_email_recovery(25);
--   B: BEGIN; SELECT public.claim_hours_publication_email_recovery(25);
--   B returns at once with only deliveries A did not return, and counts the
--   deliveries A holds as pending. COMMIT both. No delivery id appears in
--   both results, and none has recovery_selection_count above 1.

SELECT * FROM extensions.finish();

ROLLBACK;
