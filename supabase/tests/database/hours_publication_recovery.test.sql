-- Automatic hours publication claims complete, explicitly approved sessions
-- fairly, holds everything else whole, and publishes a claim only while it is
-- still current. Email recovery is covered in
-- hours_publication_email_recovery.test.sql.
-- All fixtures are synthetic and roll back with this test.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

-- ---------------------------------------------------------------------------
-- 1. Service-only boundary
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (
    SELECT count(*) = 5 AND bool_and(
      has_function_privilege('service_role', proc.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', proc.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', proc.oid, 'EXECUTE')
      AND proc.prosecdef
      AND proc.proconfig @> ARRAY['search_path=""']::text[]
    )
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid IN (
      'public.claim_due_hours_publications(timestamptz,integer)'::regprocedure,
      'public.publish_claimed_volunteer_hours_automatic(uuid,uuid,text,jsonb,text)'::regprocedure,
      'public.recover_supplemental_verified_certificates(uuid,text,uuid[],uuid)'::regprocedure,
      'public.claim_hours_publication_email_recovery(integer)'::regprocedure,
      'public.publish_volunteer_hours_transactional_automatic(uuid,uuid,text,jsonb,text)'::regprocedure
    )
  ),
  'the recovery RPCs and the replaced automatic entrypoint are fixed-path definers executable only by service_role'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'private.hours_attendance_row_state(text,timestamptz,timestamptz)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.hours_attendance_row_state(text,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'the attendance row classifier is not directly executable by any API role'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      NOT has_table_privilege(role_name, 'app_private.hours_publication_discovery_attempts', 'SELECT')
      AND NOT has_table_privilege(role_name, 'app_private.hours_publication_discovery_attempts', 'INSERT')
      AND NOT has_table_privilege(role_name, 'app_private.hours_publication_discovery_attempts', 'UPDATE')
      AND NOT has_table_privilege(role_name, 'app_private.hours_publication_discovery_attempts', 'DELETE')
    )
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS role_name
  )
  AND (
    SELECT relrowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'app_private.hours_publication_discovery_attempts'::regclass
  ),
  'discovery attempts are reachable only through the claim RPC'
);

SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$SELECT public.claim_due_hours_publications(now() - interval '1 day')$$,
  '42501', NULL,
  'a browser role cannot claim publication work'
);
SELECT extensions.throws_ok(
  $$SELECT public.claim_hours_publication_email_recovery(25)$$,
  '42501', NULL,
  'a browser role cannot claim email recovery work'
);
SELECT extensions.throws_ok(
  $$SELECT public.recover_supplemental_verified_certificates(
    'c7200000-0000-4000-8000-000000000002', 'oneTime',
    ARRAY['c7300002-0000-4000-8000-000000000011']::uuid[],
    'c7100000-0000-4000-8000-000000000001')$$,
  '42501', NULL,
  'a browser role cannot spoof an organizer into supplemental recovery'
);
SELECT extensions.throws_ok(
  $$SELECT public.publish_claimed_volunteer_hours_automatic(
    'c7100000-0000-4000-8000-000000000001',
    'c7200000-0000-4000-8000-000000000001', 'oneTime', '[]'::jsonb,
    'hours-publication:v1:' || repeat('a1', 32))$$,
  '42501', NULL,
  'a browser role cannot publish a claimed snapshot'
);

RESET ROLE;

SELECT extensions.throws_ok(
  $$SELECT public.claim_due_hours_publications(NULL)$$,
  '22023', 'an explicit past approval boundary is required',
  'an absent approval boundary is refused, never defaulted'
);
SELECT extensions.throws_ok(
  $$SELECT public.claim_due_hours_publications('infinity'::timestamptz)$$,
  '22023', 'an explicit past approval boundary is required',
  'a non-finite approval boundary is refused'
);
SELECT extensions.throws_ok(
  $$SELECT public.claim_due_hours_publications('-infinity'::timestamptz)$$,
  '22023', 'an explicit past approval boundary is required',
  'an unbounded historical approval is refused'
);
SELECT extensions.throws_ok(
  $$SELECT public.claim_due_hours_publications(clock_timestamp() + interval '1 minute')$$,
  '22023', 'an explicit past approval boundary is required',
  'a future approval boundary is refused'
);

-- ---------------------------------------------------------------------------
-- 2. Neutralize pre-existing rows, then measure baselines
-- ---------------------------------------------------------------------------

-- Any session or delivery already in this database is put into cooldown so
-- the claims below can only select this file's fixtures. Counts are compared
-- as differences from the baselines taken here.
DO $neutralize$
DECLARE
  v_round integer := 0;
BEGIN
  LOOP
    v_round := v_round + 1;
    EXIT WHEN v_round > 500 OR jsonb_array_length(
      public.claim_due_hours_publications('2020-09-18T10:30:00Z', 10) -> 'sessions'
    ) = 0;
  END LOOP;
  UPDATE app_private.hours_publication_discovery_attempts
  SET last_attempt_at = clock_timestamp() + interval '1 day';

  v_round := 0;
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
SELECT
  public.claim_due_hours_publications(now() - interval '1 day') AS recent,
  public.claim_due_hours_publications('2020-09-18T10:30:00Z') AS mixed;

SELECT extensions.is(
  (SELECT mixed -> 'sessions' FROM baseline),
  '[]'::jsonb,
  'pre-existing sessions are in cooldown before the fixtures are created'
);

CREATE FUNCTION pg_temp.held_delta(p_result jsonb, p_baseline jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_object_agg(
    held.key,
    held.value::integer - (p_baseline -> 'heldSessions' ->> held.key)::integer
  )
  FROM jsonb_each_text(p_result -> 'heldSessions') AS held(key, value);
$$;

CREATE FUNCTION pg_temp.claimed_projects(p_result jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(claimed.value ->> 'projectId' ORDER BY claimed.position), '[]'::jsonb)
  FROM jsonb_array_elements(p_result -> 'sessions') WITH ORDINALITY AS claimed(value, position);
$$;

-- ---------------------------------------------------------------------------
-- 3. Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  ('c7100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'authenticated', 'authenticated',
  'hours-recovery-' || n || '@local.test', now(), '{}',
  jsonb_build_object(
    'username', 'hours_recovery_' || n,
    'full_name', 'Recovery volunteer ' || n
  ),
  now(), now()
FROM generate_series(1, 1010) AS n;

UPDATE public.profiles AS profiles
SET full_name = 'Recovery volunteer', email = users.email
FROM auth.users AS users
WHERE users.id = profiles.id
  AND profiles.id::text LIKE 'c7100000-0000-4000-8000-%';

-- Project 1: ready, eight volunteers.        Project 2: ready, qr-code.
-- Project 3: one invalid required row.        Project 4: 1,001 volunteers.
-- Project 5: ready, plus an approved no-show. Project 6: mixed boundary.
-- Project 7: not a manual or qr-code project.
INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, status, project_timezone
)
SELECT
  ('c7200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'c7100000-0000-4000-8000-000000000001',
  'Hours recovery fixture ' || n, 'Local', 'Synthetic recovery fixture',
  'oneTime',
  CASE n WHEN 2 THEN 'qr-code' WHEN 7 THEN 'auto' ELSE 'manual' END,
  '{"oneTime":{"date":"2020-09-18","startTime":"09:00","endTime":"12:00","volunteers":1000}}'::jsonb,
  'upcoming', 'UTC'
FROM generate_series(1, 7) AS n;

CREATE FUNCTION pg_temp.attend(
  p_project integer, p_first integer, p_last integer,
  p_status text, p_in timestamptz, p_out timestamptz
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.project_signups (
    id, project_id, user_id, schedule_id, status, check_in_time, check_out_time
  )
  SELECT
    ('c73' || lpad(p_project::text, 5, '0') || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
    ('c7200000-0000-4000-8000-' || lpad(p_project::text, 12, '0'))::uuid,
    ('c7100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
    'oneTime', p_status, p_in, p_out
  FROM generate_series(p_first, p_last) AS n;
$$;

SELECT pg_temp.attend(1, 3, 10, 'attended', '2020-09-18T10:00:00Z', '2020-09-18T11:00:00Z');
SELECT pg_temp.attend(2, 11, 11, 'attended', '2020-09-18T10:00:00Z', '2020-09-18T11:30:00Z');
SELECT pg_temp.attend(3, 12, 12, 'attended', '2020-09-18T10:00:00Z', '2020-09-18T11:00:00Z');
SELECT pg_temp.attend(3, 13, 13, 'attended', '2020-09-18T10:00:00Z', NULL);
SELECT pg_temp.attend(4, 3, 1003, 'attended', '2020-09-18T10:00:00Z', '2020-09-18T11:00:00Z');
SELECT pg_temp.attend(5, 14, 14, 'attended', '2020-09-18T10:00:00Z', '2020-09-18T11:00:00Z');
SELECT pg_temp.attend(5, 15, 15, 'approved', NULL, NULL);
SELECT pg_temp.attend(6, 16, 16, 'attended', '2020-09-18T09:30:00Z', '2020-09-18T10:00:00Z');
SELECT pg_temp.attend(6, 17, 17, 'attended', '2020-09-18T10:30:00Z', '2020-09-18T11:00:00Z');
SELECT pg_temp.attend(7, 18, 18, 'attended', '2020-09-18T10:00:00Z', '2020-09-18T11:00:00Z');

-- ---------------------------------------------------------------------------
-- 4. Historical, mixed-boundary, invalid, and oversized sessions are held
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE recent_claim AS
SELECT public.claim_due_hours_publications(now() - interval '1 day') AS result;

SELECT extensions.is(
  (SELECT pg_temp.held_delta(recent_claim.result, baseline.recent) FROM recent_claim, baseline),
  '{"historical":4,"oversized":1,"invalidAttendance":1,"missingCreator":0,"invalidSchedule":0}'::jsonb,
  'checkouts older than the approval boundary are held as historical, beside the invalid and oversized sessions'
);

SELECT extensions.ok(
  (SELECT result -> 'sessions' = '[]'::jsonb
     AND (result ->> 'pendingSessions')::integer = (SELECT (recent ->> 'pendingSessions')::integer FROM baseline)
     AND (result ->> 'counted')::boolean AND NOT (result ->> 'contended')::boolean
   FROM recent_claim),
  'no historical backlog is claimed or counted as pending without explicit approval'
);

SELECT extensions.is(
  (SELECT count(*) FROM app_private.hours_publication_discovery_attempts
   WHERE project_id::text LIKE 'c7200000-0000-4000-8000-%'),
  0::bigint,
  'a held session never records a claim attempt'
);

CREATE TEMP TABLE first_claim AS
SELECT public.claim_due_hours_publications('2020-09-18T10:30:00Z') AS result;

SELECT extensions.is(
  (SELECT pg_temp.claimed_projects(result) FROM first_claim),
  '["c7200000-0000-4000-8000-000000000001","c7200000-0000-4000-8000-000000000005","c7200000-0000-4000-8000-000000000002"]'::jsonb,
  'approved sessions are claimed by latest checkout, then project, while held sessions take no slot'
);

SELECT extensions.is(
  (SELECT pg_temp.held_delta(first_claim.result, baseline.mixed) FROM first_claim, baseline),
  '{"historical":1,"oversized":1,"invalidAttendance":1,"missingCreator":0,"invalidSchedule":0}'::jsonb,
  'a session straddling the boundary, an invalid required row, and 1,001 volunteers each hold their whole session'
);

SELECT extensions.ok(
  (SELECT bool_and(jsonb_array_length(claimed.value -> 'entries') BETWEEN 1 AND 1000)
   FROM first_claim, jsonb_array_elements(first_claim.result -> 'sessions') AS claimed(value)),
  'no claimed payload exceeds the publication bound or is empty'
);

SELECT extensions.ok(
  (
    SELECT jsonb_array_length(claimed.value -> 'entries') = 8
      AND claimed.value ->> 'creatorId' = 'c7100000-0000-4000-8000-000000000001'
      AND claimed.value ->> 'publishKey' = 'oneTime'
      AND (
        SELECT bool_and(
            (entry.value ->> 'attendanceRevision')::integer = 0
            AND (entry.value ->> 'checkIn')::timestamptz = '2020-09-18T10:00:00Z'
            AND (entry.value ->> 'checkOut')::timestamptz = '2020-09-18T11:00:00Z')
          AND array_agg((entry.value ->> 'signupId')::uuid ORDER BY entry.position)
            = (SELECT array_agg(id ORDER BY id) FROM public.project_signups
               WHERE project_id = 'c7200000-0000-4000-8000-000000000001')
        FROM jsonb_array_elements(claimed.value -> 'entries') WITH ORDINALITY AS entry(value, position)
      )
    FROM first_claim, jsonb_array_elements(first_claim.result -> 'sessions') AS claimed(value)
    WHERE claimed.value ->> 'projectId' = 'c7200000-0000-4000-8000-000000000001'
  ),
  'a claimed snapshot lists every required signup once, in id order, with its times and revision'
);

SELECT extensions.is(
  (
    SELECT jsonb_array_length(claimed.value -> 'entries')
    FROM first_claim, jsonb_array_elements(first_claim.result -> 'sessions') AS claimed(value)
    WHERE claimed.value ->> 'projectId' = 'c7200000-0000-4000-8000-000000000005'
  ),
  1,
  'an approved signup with no recorded attendance is not part of the snapshot'
);

-- ---------------------------------------------------------------------------
-- 5. Cooldown and fair rotation of repeatedly failing sessions
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT count(*) FROM app_private.hours_publication_discovery_attempts
   WHERE project_id::text LIKE 'c7200000-0000-4000-8000-%' AND attempt_count = 1),
  3::bigint,
  'each claimed session records its attempt before publication'
);

CREATE TEMP TABLE cooling_claim AS
SELECT public.claim_due_hours_publications('2020-09-18T10:30:00Z') AS result;

SELECT extensions.ok(
  (SELECT result -> 'sessions' = '[]'::jsonb
     AND (result ->> 'pendingSessions')::integer
       = (SELECT (mixed ->> 'pendingSessions')::integer + 3 FROM baseline)
   FROM cooling_claim),
  'an unpublished session inside its 15 minute cooldown is pending, not reclaimed'
);

UPDATE app_private.hours_publication_discovery_attempts
SET last_attempt_at = clock_timestamp() - CASE project_id
  WHEN 'c7200000-0000-4000-8000-000000000001' THEN interval '20 minutes'
  WHEN 'c7200000-0000-4000-8000-000000000002' THEN interval '30 minutes'
  ELSE interval '40 minutes'
END
WHERE project_id::text LIKE 'c7200000-0000-4000-8000-%';

SELECT extensions.is(
  pg_temp.claimed_projects(public.claim_due_hours_publications('2020-09-18T10:30:00Z', 1)),
  '["c7200000-0000-4000-8000-000000000005"]'::jsonb,
  'after the cooldown the least recently attempted session is claimed first'
);
SELECT extensions.is(
  pg_temp.claimed_projects(public.claim_due_hours_publications('2020-09-18T10:30:00Z', 1)),
  '["c7200000-0000-4000-8000-000000000002"]'::jsonb,
  'a session that just failed rotates behind the next oldest attempt'
);
SELECT extensions.is(
  pg_temp.claimed_projects(public.claim_due_hours_publications('2020-09-18T10:30:00Z', 1)),
  '["c7200000-0000-4000-8000-000000000001"]'::jsonb,
  'every waiting session is reached before any is attempted twice'
);
SELECT extensions.is(
  pg_temp.claimed_projects(public.claim_due_hours_publications('2020-09-18T10:30:00Z', 1)),
  '[]'::jsonb,
  'nothing is reclaimed while every ready session is cooling down'
);

UPDATE app_private.hours_publication_discovery_attempts
SET last_attempt_at = clock_timestamp() - interval '16 minutes'
WHERE project_id = 'c7200000-0000-4000-8000-000000000005';

-- A statement cannot see rows its own function call wrote, so each claim and
-- the read that checks its effect are separate statements.
SELECT extensions.is(
  pg_temp.claimed_projects(public.claim_due_hours_publications('2020-09-18T10:30:00Z')),
  '["c7200000-0000-4000-8000-000000000005"]'::jsonb,
  'a session that keeps failing stays retryable after each cooldown'
);
SELECT extensions.is(
  (SELECT attempt_count FROM app_private.hours_publication_discovery_attempts
   WHERE project_id = 'c7200000-0000-4000-8000-000000000005'),
  3,
  'every repeated attempt is counted on the same session record'
);

-- ---------------------------------------------------------------------------
-- 6. A claimed snapshot is published only while it is still current
-- ---------------------------------------------------------------------------

UPDATE app_private.hours_publication_discovery_attempts
SET last_attempt_at = clock_timestamp() - interval '16 minutes'
WHERE project_id = 'c7200000-0000-4000-8000-000000000001';

CREATE TEMP TABLE project_one_claim AS
SELECT claimed.value AS claimed_session
FROM jsonb_array_elements(
  public.claim_due_hours_publications('2020-09-18T10:30:00Z', 1) -> 'sessions'
) AS claimed(value);

SELECT extensions.is(
  (SELECT array_agg(claimed_session ->> 'projectId') FROM project_one_claim),
  ARRAY['c7200000-0000-4000-8000-000000000001'],
  'the snapshot under test is the eight-volunteer session'
);

CREATE FUNCTION pg_temp.publish_project_one(p_actor uuid)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.publish_claimed_volunteer_hours_automatic(
    p_actor, 'c7200000-0000-4000-8000-000000000001', 'oneTime',
    (SELECT claimed_session -> 'entries' FROM project_one_claim),
    'hours-publication:v1:' || repeat('a1', 32)
  );
$$;

SELECT extensions.throws_ok(
  $$SELECT pg_temp.publish_project_one('c7100000-0000-4000-8000-000000000002')$$,
  '42501', 'automatic publication is attributed to the project creator',
  'automatic publication cannot be attributed to another account'
);

UPDATE public.project_signups SET attendance_revision = attendance_revision + 1
WHERE id = 'c7300001-0000-4000-8000-000000000003';
SELECT extensions.throws_ok(
  $$SELECT pg_temp.publish_project_one('c7100000-0000-4000-8000-000000000001')$$,
  'PT409', 'claimed attendance snapshot changed',
  'an attendance revision that advanced after the claim refuses the publication'
);
UPDATE public.project_signups SET attendance_revision = attendance_revision - 1
WHERE id = 'c7300001-0000-4000-8000-000000000003';

UPDATE public.project_signups SET check_out_time = check_out_time - interval '5 minutes'
WHERE id = 'c7300001-0000-4000-8000-000000000004';
SELECT extensions.throws_ok(
  $$SELECT pg_temp.publish_project_one('c7100000-0000-4000-8000-000000000001')$$,
  'PT409', 'claimed attendance snapshot changed',
  'a checkout edited after the claim refuses the publication even without a revision change'
);
UPDATE public.project_signups SET check_out_time = check_out_time + interval '5 minutes'
WHERE id = 'c7300001-0000-4000-8000-000000000004';

-- The claim approved checkouts at or after 10:30. One moved before that
-- boundary afterwards must refuse, not widen what was approved.
UPDATE public.project_signups SET check_out_time = '2020-09-18T10:20:00Z'
WHERE id = 'c7300001-0000-4000-8000-000000000005';
SELECT extensions.throws_ok(
  $$SELECT pg_temp.publish_project_one('c7100000-0000-4000-8000-000000000001')$$,
  'PT409', 'claimed attendance snapshot changed',
  'a checkout moved across the approval boundary after the claim refuses the publication'
);
UPDATE public.project_signups SET check_out_time = '2020-09-18T11:00:00Z'
WHERE id = 'c7300001-0000-4000-8000-000000000005';

SELECT pg_temp.attend(1, 19, 19, 'attended', '2020-09-18T10:00:00Z', '2020-09-18T11:00:00Z');
SELECT extensions.throws_ok(
  $$SELECT pg_temp.publish_project_one('c7100000-0000-4000-8000-000000000001')$$,
  'PT409', 'claimed attendance snapshot changed',
  'attendance recorded after the claim is never silently left out'
);
UPDATE public.project_signups SET status = 'rejected'
WHERE id = 'c7300001-0000-4000-8000-000000000019';

SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM public.certificates
              WHERE project_id = 'c7200000-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.hours_publication_receipts
                  WHERE project_id = 'c7200000-0000-4000-8000-000000000001')
  AND (SELECT COALESCE(published ->> 'oneTime', '') <> 'true' FROM public.projects
       WHERE id = 'c7200000-0000-4000-8000-000000000001'),
  'every refused publication leaves no award, receipt, or published flag'
);

CREATE TEMP TABLE project_one_publication AS
SELECT pg_temp.publish_project_one('c7100000-0000-4000-8000-000000000001') AS result;

SELECT extensions.ok(
  (SELECT result ->> 'outcome' = 'accepted'
     AND (result ->> 'certificatesCreated')::integer = 8
     AND result ->> 'publicationOrigin' = 'automatic'
     AND jsonb_array_length(result -> 'deliveries') = 8
   FROM project_one_publication)
  AND (SELECT count(*) = 8 FROM public.certificates
       WHERE project_id = 'c7200000-0000-4000-8000-000000000001' AND type = 'verified')
  AND (SELECT published ->> 'oneTime' = 'true' FROM public.projects
       WHERE id = 'c7200000-0000-4000-8000-000000000001'),
  'the current snapshot publishes through the existing atomic transaction with automatic origin'
);

SELECT extensions.ok(
  (SELECT pg_temp.publish_project_one('c7100000-0000-4000-8000-000000000001') ->> 'outcome') = 'replayed'
  AND (SELECT count(*) = 8 FROM public.certificates
       WHERE project_id = 'c7200000-0000-4000-8000-000000000001' AND type = 'verified'),
  'a lost-response retry replays the receipt after publication advanced the revisions'
);

SELECT extensions.is(
  pg_temp.claimed_projects(public.claim_due_hours_publications('2020-09-18T10:30:00Z')),
  '[]'::jsonb,
  'a published session leaves discovery'
);
SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM app_private.hours_publication_discovery_attempts
              WHERE project_id = 'c7200000-0000-4000-8000-000000000001'),
  'the attempt record of a published session is retired'
);

-- ---------------------------------------------------------------------------
-- 7. Automatic origin is recorded only for a receipt the automatic call created
-- ---------------------------------------------------------------------------

CREATE FUNCTION pg_temp.project_five_entries()
RETURNS jsonb LANGUAGE sql AS $$
  SELECT '[{"signupId":"c7300005-0000-4000-8000-000000000014","checkIn":"2020-09-18T10:00:00Z","checkOut":"2020-09-18T11:00:00Z","attendanceRevision":0}]'::jsonb;
$$;

SELECT extensions.is(
  public.publish_volunteer_hours_transactional(
    'c7100000-0000-4000-8000-000000000001',
    'c7200000-0000-4000-8000-000000000005', 'oneTime',
    pg_temp.project_five_entries(), 'hours-publication:v1:' || repeat('c5', 32)
  ) ->> 'publicationOrigin',
  'manual',
  'the organizer publishes the fifth session manually'
);

CREATE TEMP TABLE automatic_replays AS
SELECT
  public.publish_volunteer_hours_transactional_automatic(
    'c7100000-0000-4000-8000-000000000001',
    'c7200000-0000-4000-8000-000000000005', 'oneTime',
    pg_temp.project_five_entries(), 'hours-publication:v1:' || repeat('c5', 32)) AS same_key,
  public.publish_volunteer_hours_transactional_automatic(
    'c7100000-0000-4000-8000-000000000001',
    'c7200000-0000-4000-8000-000000000005', 'oneTime',
    pg_temp.project_five_entries(), 'hours-publication:v1:' || repeat('d6', 32)) AS other_key;

SELECT extensions.ok(
  (SELECT same_key ->> 'outcome' = 'replayed' AND same_key ->> 'publicationOrigin' = 'manual'
     AND other_key ->> 'outcome' = 'replayed' AND other_key ->> 'publicationOrigin' = 'manual'
   FROM automatic_replays)
  AND (SELECT count(*) = 1 AND bool_and(publication_origin = 'manual')
       FROM public.hours_publication_receipts
       WHERE project_id = 'c7200000-0000-4000-8000-000000000005'),
  'an identical automatic request replays the manual receipt and leaves its origin manual'
);

-- The worker that claimed this session before the organizer published loses
-- the race: its snapshot is stale, and the manual receipt is untouched.
SELECT extensions.throws_ok(
  $$SELECT public.publish_claimed_volunteer_hours_automatic(
    'c7100000-0000-4000-8000-000000000001',
    'c7200000-0000-4000-8000-000000000005', 'oneTime',
    pg_temp.project_five_entries(), 'hours-publication:v1:' || repeat('e7', 32))$$,
  'PT409', 'claimed attendance snapshot changed',
  'an automatic claim that raced a manual publication is refused'
);

SELECT extensions.ok(
  (SELECT count(*) = 1 AND bool_and(publication_origin = 'manual')
   FROM public.hours_publication_receipts
   WHERE project_id = 'c7200000-0000-4000-8000-000000000005')
  AND (SELECT count(*) = 1 FROM public.certificates
       WHERE project_id = 'c7200000-0000-4000-8000-000000000005' AND type = 'verified')
  AND (SELECT publication_origin = 'automatic' FROM public.hours_publication_receipts
       WHERE project_id = 'c7200000-0000-4000-8000-000000000001' AND publish_key = 'oneTime'),
  'the lost race adds no award, and a receipt the worker created stays automatic after its own replay'
);

-- The email subject prefix is derived from this origin alone, so each
-- receipt's pending mail is recovered under the origin it was created with.
CREATE TEMP TABLE origin_claim AS
SELECT public.claim_hours_publication_email_recovery(25) AS result;

SELECT extensions.is(
  (SELECT jsonb_object_agg(receipt_group.value ->> 'projectId',
       receipt_group.value -> 'publication' ->> 'publicationOrigin')
   FROM origin_claim, jsonb_array_elements(origin_claim.result -> 'groups') AS receipt_group(value)
   WHERE receipt_group.value ->> 'projectId' IN (
     'c7200000-0000-4000-8000-000000000001', 'c7200000-0000-4000-8000-000000000005')),
  '{"c7200000-0000-4000-8000-000000000001":"automatic","c7200000-0000-4000-8000-000000000005":"manual"}'::jsonb,
  'recovered mail carries the manual origin for the manual receipt and automatic for the worker''s own'
);

-- Two-connection acceptance for the approved scope, run by the parent against
-- an isolated database because one pgTAP transaction cannot hold two
-- snapshots. With one ready session S of two attendees committed, every
-- checkout at or after the boundary and at least 48 hours old:
--   A: BEGIN; SELECT public.claim_due_hours_publications(<boundary>, 10);
--      keep the returned entries E for S. COMMIT.
--   B: commit one of: a new attended signup in S with valid times; an edit
--      moving one claimed checkout before <boundary>; an edit moving one
--      claimed checkout inside the last 48 hours.
--   A: SELECT public.publish_claimed_volunteer_hours_automatic(
--        <creator>, <project>, <key>, E, <request key>);
--   Expected in all three cases: SQLSTATE PT409, no certificate, no receipt,
--   published flag unset, and E still lists exactly the two original signups.
--   Repeating the claim holds S as historical in the boundary case, excludes
--   it as not due in the 48 hour case, and returns all three attendees in
--   the newcomer case. Running B between A's BEGIN and its claim instead
--   changes only what the single claim statement sees: E either contains the
--   change completely or not at all, never a session classified without it.

SELECT * FROM extensions.finish();

ROLLBACK;
