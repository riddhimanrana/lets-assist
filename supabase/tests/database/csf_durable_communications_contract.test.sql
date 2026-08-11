-- Durable CSF communications: the unknown-outcome / provider-acceptance contract.
--
-- This suite exists because of one incoherence that no single-layer test could
-- catch. Migration 20260730001003 maps a signed `email.sent` to attempt state
-- 'accepted', and csf_resolve_communication_provider_evidence() duly wrote
-- reconciled_outcome = 'accepted' when that evidence arrived late -- but
--
--   * csf_communication_dispatch_attempts_reconciled_outcome_check excluded
--     'accepted', and
--   * the lifecycle trigger's unknown_outcome transition set excluded it too.
--
-- So the webhook transaction raised 23514 and retried forever. Verified provider
-- evidence about a real send was never recorded, and the attempt stayed ambiguous
-- waiting for a human who had nothing left to decide.
--
-- Sections A and B pin the source contract so re-narrowing either the CHECK or the
-- transition set fails by name. Sections C onward exercise it.
--
-- Every value here is synthetic. The whole file runs inside one transaction and
-- ends in ROLLBACK, so it leaves no rows behind and does not depend on the order it
-- is run relative to any other suite.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- AN EXACT PLAN, NOT no_plan().
--
-- no_plan() reports whatever ran. If a statement above an assertion raises, or a
-- section is skipped, the suite still finishes green with fewer assertions than
-- it was written with -- which is precisely the failure a durable-evidence suite
-- must not be able to hide. The count below is derived from the parse tree, not
-- from a grep, and must be updated whenever an assertion is added or removed.
SELECT extensions.plan(125);

-- This transaction is one synthetic local backend. Direct fixture inserts do
-- not pass through the server wrapper that derives the hosted project ref, so
-- make their signed environment coordinate explicit at the table boundary.
ALTER TABLE plugin_data.csf_communication_campaigns
  ALTER COLUMN metadata
  SET DEFAULT '{"csf_environment":"local"}'::jsonb;

-- ---------------------------------------------------------------------------
-- A. THE AT-REST CONTRACT
--
-- Mutation assertions, not descriptions. Deleting 'accepted' from the reconciled
-- outcome CHECK fails here by name, before any behaviour is exercised.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (
    SELECT pg_get_constraintdef(constraint_row.oid)
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conname
      = 'csf_communication_dispatch_attempts_reconciled_outcome_check'
      AND constraint_row.conrelid
        = 'plugin_data.csf_communication_dispatch_attempts'::regclass
  ) LIKE '%accepted%',
  'the reconciled outcome CHECK admits ''accepted'', so late provider acceptance can be recorded at rest'
);

-- The converse guard: the CHECK must not have been widened into a free-for-all.
-- 'queued', 'processing', and 'retryable_failure' are retry-shaped and must never
-- be reachable as a recorded resolution.
SELECT extensions.ok(
  (
    SELECT pg_get_constraintdef(constraint_row.oid)
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conname
      = 'csf_communication_dispatch_attempts_reconciled_outcome_check'
      AND constraint_row.conrelid
        = 'plugin_data.csf_communication_dispatch_attempts'::regclass
  ) NOT LIKE '%retryable_failure%',
  'the reconciled outcome CHECK still refuses every retry-shaped resolution'
);

-- Each permitted resolved state must be individually present. A test that only
-- looked for 'accepted' would pass against a CHECK that had lost the others.
SELECT extensions.ok(
  (
    SELECT bool_and(
      (
        SELECT pg_get_constraintdef(constraint_row.oid)
        FROM pg_constraint AS constraint_row
        WHERE constraint_row.conname
          = 'csf_communication_dispatch_attempts_reconciled_outcome_check'
          AND constraint_row.conrelid
            = 'plugin_data.csf_communication_dispatch_attempts'::regclass
      ) LIKE '%' || resolved_state || '%'
    )
    FROM unnest(ARRAY[
      'accepted', 'delivered', 'bounced', 'complained', 'suppressed', 'failed'
    ]) AS resolved_state
  ),
  'every permitted resolved state is present in the reconciled outcome CHECK'
);

-- CONSTRAINTS AND LIFECYCLE MUST AGREE. reconciled_outcome records the outcome
-- that RESOLVED the ambiguity; the attempt then keeps advancing as more evidence
-- arrives. The at-rest check therefore permits exactly the forward closure of each
-- resolved state, and nothing wider.
SELECT extensions.ok(
  (
    SELECT pg_get_constraintdef(constraint_row.oid)
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conname = 'csf_comm_attempt_reconciled_state_check'
      AND constraint_row.conrelid
        = 'plugin_data.csf_communication_dispatch_attempts'::regclass
  ) LIKE '%accepted%',
  'the reconciled-state agreement CHECK knows an accepted resolution may still advance'
);

-- ---------------------------------------------------------------------------
-- B. THE TRANSITION CONTRACT
--
-- Removing 'accepted' from the unknown-outcome transition set, or removing the
-- provider-evidence gate that guards it, fails here.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_enforce_dispatch_attempt_lifecycle()'::regprocedure
  ) ~ 'OLD\.state = ''unknown_outcome''\s+AND NEW\.state IN \(\s*''accepted''',
  'the lifecycle trigger admits unknown_outcome -> accepted in its transition set'
);

-- THE GATE IS THE WHOLE SAFETY ARGUMENT. Widening the transition set without it
-- would make any service-role UPDATE that merely sets state = ''accepted'' legal.
SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_enforce_dispatch_attempt_lifecycle()'::regprocedure
  ) ~ 'OLD\.state = ''unknown_outcome'' AND NEW\.state = ''accepted''',
  'the lifecycle trigger gates the accepted edge on its own explicit branch'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_get_functiondef(
        'plugin_data.csf_enforce_dispatch_attempt_lifecycle()'::regprocedure
      ) LIKE '%' || required_condition || '%'
    )
    FROM unnest(ARRAY[
      -- provider evidence, never a human decision
      'NEW.reconciled_actor_kind IS DISTINCT FROM ''provider''',
      -- and never one wearing the provider's clothes
      'NEW.reconciled_by IS NOT NULL',
      'NEW.reconciled_by_identity IS NOT NULL',
      -- coherent recorded outcome
      'NEW.reconciled_outcome IS DISTINCT FROM ''accepted''',
      -- review actually resolved
      'NEW.review_state <> ''resolved''',
      -- bound to the message the provider signed about
      'NEW.provider_message_id IS NULL',
      'NEW.settlement_source IS DISTINCT FROM ''provider'''
    ]) AS required_condition
  ),
  'the accepted edge requires provider actor kind, no staff account, coherent outcome, resolved review, and a bound provider message'
);

-- THE STAFF PATH IS STILL CLOSED. Acceptance is a claim only the provider can
-- make, and the reconciliation RPC rejects it by name.
SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_reconcile_communication_unknown_outcome(uuid,uuid,text,text,text,uuid,text,text)'::regprocedure
  ) ~ 'p_resolution IN \(''queued'', ''processing'', ''accepted''',
  'the staff reconciliation RPC still refuses to let a human assert provider acceptance'
);

-- The generic exit guard still demands complete evidence for EVERY exit.
SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_get_functiondef(
        'plugin_data.csf_enforce_dispatch_attempt_lifecycle()'::regprocedure
      ) LIKE '%' || required_condition || '%'
    )
    FROM unnest(ARRAY[
      'NEW.reconciled_at IS NULL',
      'NEW.reconciled_outcome IS NULL',
      'NEW.reconciled_actor_kind IS NULL',
      'NEW.reconciliation_reason IS NULL',
      'NEW.reconciled_outcome <> NEW.state',
      'NEW.review_state <> ''resolved'''
    ]) AS required_condition
  ),
  'leaving an unknown outcome still requires a complete, coherent resolution record'
);

-- No retry edge was opened anywhere.
SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_enforce_dispatch_attempt_lifecycle()'::regprocedure
  ) LIKE '%OLD.state = ''unknown_outcome'' AND NEW.state IN (''queued'', ''processing'')%',
  'an unknown outcome still can never return to queued or processing'
);

-- ---------------------------------------------------------------------------
-- C. Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ce000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'contract-officer@local.test', now(), '{}', '{}', now(), now()),
  ('ce000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'contract-other-officer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('ce100000-0000-4000-8000-000000000001', 'CSF Contract One', 'csf-contract-one', 'school', '992001'),
  ('ce100000-0000-4000-8000-000000000002', 'CSF Contract Two', 'csf-contract-two', 'school', '992002');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('ce100000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000002', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  ('ce200000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001', 'S32', 'Spring 2032', '2031-2032', 'spring', true),
  ('ce200000-0000-4000-8000-000000000002', 'ce100000-0000-4000-8000-000000000002', 'S32', 'Spring 2032', '2031-2032', 'spring', true);

INSERT INTO plugin_data.csf_communication_campaigns (
  id, organization_id, campaign_kind, status, sender_name, sender_email,
  reply_to_email, subject, body_text, body_text_hash, term_id,
  audience_kind, broadcast_topic_key, resend_topic_id, created_by_identity,
  content_finalized_at, content_finalized_by_identity,
  audience_snapshot_version, provider_idempotency_key
) VALUES
  -- The blocker itself: an attempt settled unknown_outcome, then a signed
  -- email.sent arrives.
  (
    'ce400000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001',
    'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
    'dvhighcsf@gmail.com', 'Late acceptance after an unknown outcome',
    'The provider accepted this after the worker lost its response.', repeat('1', 64),
    'ce200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
    'topic_synthetic_contract_a', 'contract-officer@local.test',
    now(), 'contract-officer@local.test', 1, 'contract-late-accept-key'
  ),
  -- Late terminal evidence, which must keep its existing semantics.
  (
    'ce400000-0000-4000-8000-000000000002', 'ce100000-0000-4000-8000-000000000001',
    'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
    'dvhighcsf@gmail.com', 'Late bounce after an unknown outcome',
    'The provider bounced this after the worker lost its response.', repeat('2', 64),
    'ce200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
    'topic_synthetic_contract_b', 'contract-officer@local.test',
    now(), 'contract-officer@local.test', 1, 'contract-late-bounce-key'
  ),
  -- The forward-advance case: accepted by late evidence, then delivered.
  (
    'ce400000-0000-4000-8000-000000000003', 'ce100000-0000-4000-8000-000000000001',
    'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
    'dvhighcsf@gmail.com', 'Accepted late, then delivered',
    'Acceptance and delivery arrive as separate signed events.', repeat('3', 64),
    'ce200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
    'topic_synthetic_contract_c', 'contract-officer@local.test',
    now(), 'contract-officer@local.test', 1, 'contract-accept-then-deliver-key'
  ),
  -- The negative-path campaign: nothing may resolve this one.
  (
    'ce400000-0000-4000-8000-000000000004', 'ce100000-0000-4000-8000-000000000001',
    'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
    'dvhighcsf@gmail.com', 'Unknown outcome that must stay unknown',
    'No unbound, unsigned, or cross-tenant evidence may resolve this.', repeat('4', 64),
    'ce200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
    'topic_synthetic_contract_d', 'contract-officer@local.test',
    now(), 'contract-officer@local.test', 1, 'contract-stays-unknown-key'
  );

SET CONSTRAINTS ALL IMMEDIATE;

-- Drive one campaign to a settled 'unknown_outcome' attempt: snapshot, finalize,
-- claim, authorize (an unknown outcome only makes sense for a try the ledger
-- actually released), then settle ambiguous.
CREATE OR REPLACE FUNCTION pg_temp.settle_unknown(
  p_campaign_id uuid,
  p_email text,
  p_worker text
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_attempt_id uuid;
BEGIN
  PERFORM plugin_data.csf_snapshot_communication_recipients(
    'ce100000-0000-4000-8000-000000000001',
    p_campaign_id,
    jsonb_build_array(
      jsonb_build_object('email', p_email, 'provenance', 'staff_entry')
    )
  );

  PERFORM plugin_data.csf_finalize_communication_recipient_snapshot(
    'ce100000-0000-4000-8000-000000000001', p_campaign_id, 1
  );

  PERFORM plugin_data.csf_claim_communication_dispatch_batch(
    'ce100000-0000-4000-8000-000000000001', p_campaign_id, p_worker, 25, 120
  );

  SELECT attempt.id
  INTO v_attempt_id
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.campaign_id = p_campaign_id
    AND attempt.state = 'processing'
  LIMIT 1;

  PERFORM plugin_data.csf_authorize_communication_dispatch(
    'ce100000-0000-4000-8000-000000000001', v_attempt_id, p_worker, NULL
  );

  PERFORM plugin_data.csf_settle_communication_dispatch_attempt(
    'ce100000-0000-4000-8000-000000000001', v_attempt_id, p_worker,
    'unknown_outcome', NULL, NULL, 'transport_exception',
    'Socket closed before the provider answered.'
  );

  RETURN v_attempt_id;
END;
$$;

CREATE TEMP TABLE t_attempts AS
SELECT
  pg_temp.settle_unknown(
    'ce400000-0000-4000-8000-000000000001', 'late.accept@local.test', 'worker-a'
  ) AS accept_attempt,
  pg_temp.settle_unknown(
    'ce400000-0000-4000-8000-000000000002', 'late.bounce@local.test', 'worker-b'
  ) AS bounce_attempt,
  pg_temp.settle_unknown(
    'ce400000-0000-4000-8000-000000000003', 'accept.then.deliver@local.test', 'worker-c'
  ) AS advance_attempt,
  pg_temp.settle_unknown(
    'ce400000-0000-4000-8000-000000000004', 'stays.unknown@local.test', 'worker-d'
  ) AS unresolved_attempt;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND attempt.state = 'unknown_outcome'
      AND attempt.review_state = 'pending'
  ),
  4,
  'all four fixtures settle as unknown outcomes awaiting review'
);

-- ---------------------------------------------------------------------------
-- D. A SIGNED, BOUND email.sent RESOLVES AN UNKNOWN OUTCOME AS 'accepted'
--
-- This is the case that raised 23514 and retried forever before the correction.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE t_late_accept AS
SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000001',
  'evt_contract_late_accept_1',
  'email.sent',
  'resend-message-contract-accept',
  now() + interval '3 minutes',
  repeat('a', 64),
  true,
  'svix',
  'whsec_test_key',
  '{}'::jsonb,
  (SELECT accept_attempt FROM t_attempts),
  'ce400000-0000-4000-8000-000000000001'
) AS result;

SELECT extensions.is(
  (SELECT result->>'processingState' FROM t_late_accept),
  'reduced',
  'the late acceptance event is reduced rather than raising inside the webhook transaction'
);

SELECT extensions.is(
  (SELECT result->>'attemptAdvanced' FROM t_late_accept),
  'true',
  'the late acceptance event advances the attempt'
);

SELECT extensions.is(
  (
    SELECT attempt.state
      || '|' || attempt.review_state
      || '|' || attempt.reconciled_outcome
      || '|' || attempt.reconciled_actor_kind
      || '|' || (attempt.reconciled_by IS NULL)::text
      || '|' || attempt.provider_message_id
      || '|' || attempt.settlement_source
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.id = (SELECT accept_attempt FROM t_attempts)
  ),
  -- 'accepted', NOT 'delivered'. email.sent means the provider took the message;
  -- whether a mailbox did is a different event and a later state.
  'accepted|resolved|accepted|provider|true|resend-message-contract-accept|provider',
  'a signed, bound email.sent resolves the unknown outcome as provider-evidenced acceptance'
);

SELECT extensions.is(
  (
    SELECT (attempt.reconciled_at IS NOT NULL)::text
      || '|' || (attempt.reconciliation_reason IS NOT NULL)::text
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.id = (SELECT accept_attempt FROM t_attempts)
  ),
  'true|true',
  'the resolution records when it happened and why, as write-once evidence'
);

SELECT extensions.is(
  (
    SELECT delivery.review_state
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'ce400000-0000-4000-8000-000000000001'
  ),
  'resolved',
  'the delivery review flag resolves with the attempt, in the same transaction'
);

-- ---------------------------------------------------------------------------
-- D2. EXACTLY ONCE. A duplicate of the same signed event is idempotent.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE t_late_accept_replay AS
SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000001',
  'evt_contract_late_accept_1',
  'email.sent',
  'resend-message-contract-accept',
  now() + interval '3 minutes',
  repeat('a', 64),
  true,
  'svix',
  'whsec_test_key',
  '{}'::jsonb,
  (SELECT accept_attempt FROM t_attempts),
  'ce400000-0000-4000-8000-000000000001'
) AS result;

SELECT extensions.is(
  (SELECT result->>'duplicate' FROM t_late_accept_replay),
  'true',
  'the replayed provider event is recognised as a duplicate'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_provider_events AS event
    WHERE event.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND event.provider_event_id = 'evt_contract_late_accept_1'
  ),
  1,
  'the duplicate is stored once, not twice'
);

-- The resolution is write-once: a replay must not restamp it.
SELECT extensions.is(
  (
    SELECT count(DISTINCT attempt.reconciled_at)::integer
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.id = (SELECT accept_attempt FROM t_attempts)
  ),
  1,
  'the duplicate leaves the recorded resolution exactly as it was'
);

-- ---------------------------------------------------------------------------
-- D3. THE ACCEPTED ATTEMPT STILL ADVANCES. Acceptance resolved the ambiguity;
-- it did not freeze the lifecycle. This is the case the old
-- `reconciled_outcome = state` CHECK made unsatisfiable at rest.
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000001',
  'evt_contract_advance_sent',
  'email.sent',
  'resend-message-contract-advance',
  now() + interval '1 minute',
  repeat('b', 64),
  true, 'svix', 'whsec_test_key', '{}'::jsonb,
  (SELECT advance_attempt FROM t_attempts),
  'ce400000-0000-4000-8000-000000000003'
);

SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000001',
  'evt_contract_advance_delivered',
  'email.delivered',
  'resend-message-contract-advance',
  now() + interval '4 minutes',
  repeat('c', 64),
  true, 'svix', 'whsec_test_key', '{}'::jsonb,
  (SELECT advance_attempt FROM t_attempts),
  'ce400000-0000-4000-8000-000000000003'
);

SELECT extensions.is(
  (
    SELECT attempt.state || '|' || attempt.reconciled_outcome
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.id = (SELECT advance_attempt FROM t_attempts)
  ),
  -- The state moved on; the reconciliation still records what resolved the
  -- ambiguity. Both facts are true and both are kept.
  'delivered|accepted',
  'an attempt accepted by late evidence still advances to delivered, and the resolution record survives'
);

-- ---------------------------------------------------------------------------
-- D4. LATE TERMINAL EVIDENCE KEEPS ITS EXISTING SEMANTICS.
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000001',
  'evt_contract_late_bounce',
  'email.bounced',
  'resend-message-contract-bounce',
  now() + interval '3 minutes',
  repeat('d', 64),
  true, 'svix', 'whsec_test_key',
  -- 'Permanent', not the undocumented 'hard' alias this fixture used to carry.
  -- The classifier is exact and case-sensitive now, so 'hard' would land on
  -- 'undetermined' and this case would be testing a different thing than its
  -- name claims.
  '{"smtpCode":550,"bounceType":"Permanent","bounceSubtype":"General"}'::jsonb,
  (SELECT bounce_attempt FROM t_attempts),
  'ce400000-0000-4000-8000-000000000002'
);

SELECT extensions.is(
  (
    SELECT attempt.state
      || '|' || attempt.review_state
      || '|' || attempt.reconciled_outcome
      || '|' || attempt.reconciled_actor_kind
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.id = (SELECT bounce_attempt FROM t_attempts)
  ),
  'bounced|resolved|bounced|provider',
  'late bounce evidence resolves the unknown outcome exactly as it always did'
);

-- The bounce is evidence about the ADDRESS, and still updates the safety
-- projection rather than the topic-scoped consent table.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000001'
  ),
  1,
  'the late bounce still updates the address-safety projection'
);

-- ---------------------------------------------------------------------------
-- E. WHAT MAY NOT RESOLVE AN UNKNOWN OUTCOME
--
-- Each case runs in its own subtransaction and is then asserted on the END STATE,
-- so the invariant tested is "the attempt was not resolved" regardless of whether
-- the path raises or quietly declines to bind.
-- ---------------------------------------------------------------------------

-- E1. A DIRECT UPDATE CANNOT FABRICATE THE TRANSITION.
DO $$
BEGIN
  UPDATE plugin_data.csf_communication_dispatch_attempts
  SET state = 'accepted'
  WHERE id = (SELECT unresolved_attempt FROM t_attempts);
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT extensions.is(
  (
    SELECT attempt.state
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.id = (SELECT unresolved_attempt FROM t_attempts)
  ),
  'unknown_outcome',
  'a bare UPDATE to accepted is refused; acceptance is not something the ledger can assert about itself'
);

-- E2. NOT EVEN A DIRECT UPDATE THAT DRESSES ITSELF AS PROVIDER EVIDENCE. Without
-- a bound provider message the claim is an assertion, not evidence.
DO $$
BEGIN
  UPDATE plugin_data.csf_communication_dispatch_attempts
  SET
    state = 'accepted',
    review_state = 'resolved',
    reconciled_outcome = 'accepted',
    reconciled_at = now(),
    reconciled_actor_kind = 'provider',
    reconciliation_reason = 'fabricated',
    settlement_source = 'provider'
  WHERE id = (SELECT unresolved_attempt FROM t_attempts);
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT extensions.is(
  (
    SELECT attempt.state
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.id = (SELECT unresolved_attempt FROM t_attempts)
  ),
  'unknown_outcome',
  'provider-shaped evidence that names no provider message cannot resolve an unknown outcome'
);

-- E3. A STAFF ACTOR CANNOT ASSERT PROVIDER ACCEPTANCE.
SELECT extensions.throws_ok(
  format(
    $fmt$
      SELECT plugin_data.csf_reconcile_communication_unknown_outcome(
        'ce100000-0000-4000-8000-000000000001'::uuid,
        %L::uuid,
        'accepted',
        'The officer believes it went out.',
        NULL,
        'ce000000-0000-4000-8000-000000000001'::uuid
      )
    $fmt$,
    (SELECT unresolved_attempt FROM t_attempts)
  ),
  '23514',
  NULL,
  'a staff reconciliation may never resolve an unknown outcome as accepted'
);

-- E4. AN UNVERIFIED EVENT IS NOT EVIDENCE.
DO $$
BEGIN
  PERFORM plugin_data.csf_record_communication_provider_event(
    'ce100000-0000-4000-8000-000000000001',
    'evt_contract_unverified',
    'email.sent',
    'resend-message-contract-unverified',
    now() + interval '5 minutes',
    repeat('e', 64),
    false,
    'svix', 'whsec_test_key', '{}'::jsonb,
    (SELECT unresolved_attempt FROM t_attempts),
    'ce400000-0000-4000-8000-000000000004'
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT extensions.is(
  (
    SELECT attempt.state
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.id = (SELECT unresolved_attempt FROM t_attempts)
  ),
  'unknown_outcome',
  'an unverified webhook cannot resolve an unknown outcome'
);

-- E5. WRONG ORGANIZATION. Another chapter's signed event may not reach this
-- attempt.
DO $$
BEGIN
  PERFORM plugin_data.csf_record_communication_provider_event(
    'ce100000-0000-4000-8000-000000000002',
    'evt_contract_cross_tenant',
    'email.sent',
    'resend-message-contract-cross-tenant',
    now() + interval '5 minutes',
    repeat('f', 64),
    true, 'svix', 'whsec_test_key', '{}'::jsonb,
    (SELECT unresolved_attempt FROM t_attempts),
    'ce400000-0000-4000-8000-000000000004'
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT extensions.is(
  (
    SELECT attempt.state
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.id = (SELECT unresolved_attempt FROM t_attempts)
  ),
  'unknown_outcome',
  'a signed event recorded under the wrong organization cannot resolve this attempt'
);

-- E6. WRONG ATTEMPT / WRONG CAMPAIGN BINDING. A tag naming an attempt that
-- belongs to a different campaign is contradictory evidence and must not bind.
DO $$
BEGIN
  PERFORM plugin_data.csf_record_communication_provider_event(
    'ce100000-0000-4000-8000-000000000001',
    'evt_contract_wrong_binding',
    'email.sent',
    'resend-message-contract-wrong-binding',
    now() + interval '5 minutes',
    repeat('1', 64),
    true, 'svix', 'whsec_test_key', '{}'::jsonb,
    (SELECT unresolved_attempt FROM t_attempts),
    -- The attempt above belongs to campaign ...0004, not ...0001.
    'ce400000-0000-4000-8000-000000000001'
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT extensions.is(
  (
    SELECT attempt.state
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.id = (SELECT unresolved_attempt FROM t_attempts)
  ),
  'unknown_outcome',
  'evidence whose attempt and campaign disagree cannot resolve either of them'
);

-- E7. AND THE UNRESOLVED ATTEMPT NEVER BECAME RETRYABLE ALONG THE WAY.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'ce400000-0000-4000-8000-000000000004'
  ),
  1,
  'no successor attempt was ever enqueued behind the unresolved unknown outcome'
);

-- ---------------------------------------------------------------------------
-- F. THE AUTHORING AND CONSENT ENTRYPOINTS
--
-- Section J revokes every write privilege on all ten ledgers and grants
-- service_role SELECT alone, which is correct and unchanged. These are the
-- least-privilege doors through that wall.
-- ---------------------------------------------------------------------------

-- Actors: an authorized officer, an ordinary member, a staff-role member with no
-- CSF capability, an inactive admin, and an officer of the other chapter.
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ce000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'contract-member@local.test', now(), '{}', '{}', now(), now()),
  ('ce000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'contract-inactive@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000003', 'member', 'active'),
  -- An admin whose MEMBERSHIP is not active. Authority is the current, active
  -- membership, never a role string that outlived it.
  ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000004', 'admin', 'inactive');

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_communication_campaign_draft(
      'ce100000-0000-4000-8000-000000000001'::uuid,
      'broadcast',
      'Authored through the authorized door',
      'This campaign was created by an RPC rather than a fixture.',
      'ce000000-0000-4000-8000-000000000001'::uuid,
      'ce200000-0000-4000-8000-000000000001'::uuid,
      'term_members',
      NULL,
      'partner_clubs',
      'topic_synthetic_contract_authored'
    )
  $$,
  'an officer holding the tenant capability can author a draft campaign'
);

SELECT extensions.is(
  (
    SELECT campaign.status
      || '|' || campaign.sender_name
      || '|' || campaign.sender_email
      || '|' || campaign.reply_to_email
      || '|' || campaign.channel
      || '|' || (campaign.content_hash IS NULL)::text
    FROM plugin_data.csf_communication_campaigns AS campaign
    WHERE campaign.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND campaign.subject = 'Authored through the authorized door'
  ),
  -- The chapter contract, derived rather than accepted, and still only a draft.
  'draft|DVHS CSF|csf@notifications.lets-assist.com|dvhighcsf@gmail.com|email|true',
  'the authored draft carries the fixed chapter sender identity and is not yet dispatch-ready'
);

-- EVERY UNAUTHORIZED ACTOR PATH RECEIVES 42501.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_communication_campaign_draft(
      'ce100000-0000-4000-8000-000000000001'::uuid, 'broadcast', 'Ordinary member',
      'Body.', 'ce000000-0000-4000-8000-000000000003'::uuid, NULL, NULL, NULL,
      'partner_clubs', 'topic_synthetic_contract_x'
    )
  $$,
  '42501',
  NULL,
  'an ordinary member cannot author a communications campaign'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_communication_campaign_draft(
      'ce100000-0000-4000-8000-000000000001'::uuid, 'broadcast', 'Inactive admin',
      'Body.', 'ce000000-0000-4000-8000-000000000004'::uuid, NULL, NULL, NULL,
      'partner_clubs', 'topic_synthetic_contract_x'
    )
  $$,
  '42501',
  NULL,
  'an inactive membership carries no authoring authority, whatever its role says'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_communication_campaign_draft(
      'ce100000-0000-4000-8000-000000000001'::uuid, 'broadcast', 'Wrong chapter',
      'Body.', 'ce000000-0000-4000-8000-000000000002'::uuid, NULL, NULL, NULL,
      'partner_clubs', 'topic_synthetic_contract_x'
    )
  $$,
  '42501',
  NULL,
  'an officer of another chapter cannot author into this organization'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_communication_campaign_draft(
      'ce100000-0000-4000-8000-000000000001'::uuid, 'broadcast', 'Absent actor',
      'Body.', 'ce000000-0000-4000-8000-000000000099'::uuid, NULL, NULL, NULL,
      'partner_clubs', 'topic_synthetic_contract_x'
    )
  $$,
  '42501',
  NULL,
  'an account that is no member of the organization cannot author'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_communication_campaign_draft(
      'ce100000-0000-4000-8000-000000000001'::uuid, 'broadcast', 'No actor',
      'Body.', NULL, NULL, NULL, NULL, 'partner_clubs', 'topic_synthetic_contract_x'
    )
  $$,
  '22004',
  NULL,
  'an absent actor is refused outright; authorship is always attributed'
);

-- MANDATORY TRANSACTIONAL MAIL CARRIES NO TOPIC, refused at the door.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_communication_campaign_draft(
      'ce100000-0000-4000-8000-000000000001'::uuid, 'transactional', 'Refusable mandatory mail',
      'Body.', 'ce000000-0000-4000-8000-000000000001'::uuid, NULL, NULL, NULL,
      'partner_clubs', 'topic_synthetic_contract_x'
    )
  $$,
  '22023',
  NULL,
  'a transactional campaign cannot be given a topic that would offer an unsubscribe'
);

-- F2. A DRAFT IS EDITABLE; ANYTHING ELSE IS NOT.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_update_communication_campaign_draft(
      'ce100000-0000-4000-8000-000000000001'::uuid,
      (SELECT campaign.id FROM plugin_data.csf_communication_campaigns AS campaign
       WHERE campaign.subject = 'Authored through the authorized door'),
      'ce000000-0000-4000-8000-000000000001'::uuid,
      'Authored, then revised'
    )
  $$,
  'a draft campaign''s subject can be revised by an authorized officer'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_communication_campaign_draft(
      'ce100000-0000-4000-8000-000000000001'::uuid,
      (SELECT campaign.id FROM plugin_data.csf_communication_campaigns AS campaign
       WHERE campaign.subject = 'Authored, then revised'),
      'ce000000-0000-4000-8000-000000000003'::uuid,
      'Edited by an ordinary member'
    )
  $$,
  '42501',
  NULL,
  'an ordinary member cannot edit a draft campaign'
);

-- A campaign whose content is already finalized is immutable through this path.
-- The fixture campaigns were inserted with content_finalized_at set.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_communication_campaign_draft(
      'ce100000-0000-4000-8000-000000000001'::uuid,
      'ce400000-0000-4000-8000-000000000001'::uuid,
      'ce000000-0000-4000-8000-000000000001'::uuid,
      'Rewriting a published campaign'
    )
  $$,
  '23514',
  NULL,
  'a published or finalized campaign is immutable through the draft edit path'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_communication_campaign_draft(
      'ce100000-0000-4000-8000-000000000002'::uuid,
      (SELECT campaign.id FROM plugin_data.csf_communication_campaigns AS campaign
       WHERE campaign.subject = 'Authored, then revised'),
      'ce000000-0000-4000-8000-000000000002'::uuid,
      'Reaching across chapters'
    )
  $$,
  '23503',
  NULL,
  'another chapter''s officer cannot reach this campaign even by naming it exactly'
);

-- F3. BROADCAST CONSENT DECISIONS.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_record_broadcast_preference_decision(
      'ce100000-0000-4000-8000-000000000001', 'partner_clubs',
      'Opt.Out@Local.Test', 'opt_out', 'recipient', NULL, NULL,
      encode(extensions.digest('opt.out@local.test', 'sha256'), 'hex')
    )->>'subscriptionState'
  ),
  'unsubscribed',
  'a verified recipient can durably opt out of a broadcast topic'
);

-- THE STRUCTURAL SEPARATION, PROVEN. The same address, same organization: the
-- broadcast is refused and the mandatory transactional message is not.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_communication_preference_decision(
      'ce100000-0000-4000-8000-000000000001', 'broadcast', 'partner_clubs',
      'opt.out@local.test'
    )->>'suppressed'
  ),
  'true',
  'the opt-out blocks broadcasts on that topic'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_communication_preference_decision(
      'ce100000-0000-4000-8000-000000000001', 'transactional', NULL,
      'opt.out@local.test'
    )->>'decision'
  ),
  'mandatory_transactional',
  'the very same opt-out cannot suppress mandatory operational mail'
);

-- ADDRESS-BOUND. A verified link for one address may not decide for another.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_broadcast_preference_decision(
      'ce100000-0000-4000-8000-000000000001'::uuid, 'partner_clubs',
      'someone.else@local.test', 'opt_out', 'recipient', NULL, NULL,
      encode(extensions.digest('opt.out@local.test', 'sha256'), 'hex')
    )
  $$,
  '42501',
  NULL,
  'a recipient path verified for one address cannot opt out a different address'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_broadcast_preference_decision(
      'ce100000-0000-4000-8000-000000000001'::uuid, 'partner_clubs',
      'no.proof@local.test', 'opt_out', 'recipient'
    )
  $$,
  '42501',
  NULL,
  'a recipient decision with no verified address binding is refused'
);

-- THE RESERVED TOPIC CANNOT BE NAMED AT ALL.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_broadcast_preference_decision(
      'ce100000-0000-4000-8000-000000000001'::uuid, 'transactional',
      'mandatory@local.test', 'opt_out', 'staff',
      'Tried to switch off mandatory mail.',
      'ce000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '22023',
  NULL,
  'no actor can express an opt-out from mandatory transactional mail'
);

-- STAFF DECISIONS NAME AN ACCOUNT WITH AUTHORITY AND DOCUMENT THE REQUEST.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_broadcast_preference_decision(
      'ce100000-0000-4000-8000-000000000001'::uuid, 'partner_clubs',
      'staffed@local.test', 'opt_out', 'staff',
      'Relaying a request.', 'ce000000-0000-4000-8000-000000000003'::uuid
    )
  $$,
  '42501',
  NULL,
  'an ordinary member cannot record a staff preference decision'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_broadcast_preference_decision(
      'ce100000-0000-4000-8000-000000000001'::uuid, 'partner_clubs',
      'staffed@local.test', 'opt_out', 'staff', NULL,
      'ce000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '22004',
  NULL,
  'a staff preference decision must document the request it is acting on'
);

-- PROVIDER EVIDENCE MUST BE EVIDENCE.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_broadcast_preference_decision(
      'ce100000-0000-4000-8000-000000000001'::uuid, 'partner_clubs',
      'claimed@local.test', 'opt_out', 'provider'
    )
  $$,
  '42501',
  NULL,
  'a provider preference decision naming no stored verified event is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_broadcast_preference_decision(
      'ce100000-0000-4000-8000-000000000001'::uuid, 'partner_clubs',
      'claimed@local.test', 'resubscribe', 'provider', NULL, NULL, NULL,
      'corr-provider-resubscribe-refused'
    )
  $$,
  '42501',
  NULL,
  'provider feedback cannot restore topic consent either'
);

-- NO SILENT OVERWRITE, AND NO BACKDATING. occurred-at is server-stamped, and a
-- repeat of a decision that already stands reports rather than rewrites.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_record_broadcast_preference_decision(
      'ce100000-0000-4000-8000-000000000001', 'partner_clubs',
      'opt.out@local.test', 'opt_out', 'recipient', NULL, NULL,
      encode(extensions.digest('opt.out@local.test', 'sha256'), 'hex')
    )->>'applied'
  ),
  'false',
  'a repeated opt-out reports that the decision already stands rather than rewriting it'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_preference_events AS event
    WHERE event.organization_id = 'ce100000-0000-4000-8000-000000000001'
  ),
  1,
  'the repeated decision wrote no second history record'
);

-- A RESUBSCRIBE KEEPS THE OPT-OUT AS HISTORY.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_record_broadcast_preference_decision(
      'ce100000-0000-4000-8000-000000000001', 'partner_clubs',
      'opt.out@local.test', 'resubscribe', 'recipient', NULL, NULL,
      encode(extensions.digest('opt.out@local.test', 'sha256'), 'hex')
    )->>'subscriptionState'
  ),
  'subscribed',
  'a verified recipient can resubscribe to a broadcast topic'
);

SELECT extensions.is(
  (
    SELECT (preference.opt_out_at IS NOT NULL)::text
      || '|' || (preference.resubscribed_at IS NOT NULL)::text
      || '|' || preference.subscription_state
    FROM plugin_data.csf_communication_broadcast_preferences AS preference
    WHERE preference.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND preference.normalized_recipient_email = 'opt.out@local.test'
  ),
  'true|true|subscribed',
  'a recorded opt-out is never erased; resubscribing keeps it as history'
);

-- THE ADDRESS ITSELF NEVER COMES BACK OUT.
SELECT extensions.ok(
  (
    SELECT plugin_data.csf_record_broadcast_preference_decision(
      'ce100000-0000-4000-8000-000000000001', 'partner_clubs',
      'hashed.only@local.test', 'opt_out', 'recipient', NULL, NULL,
      encode(extensions.digest('hashed.only@local.test', 'sha256'), 'hex')
    )::text NOT LIKE '%hashed.only@local.test%'
  ),
  'a preference decision returns the address hash, never the address'
);

-- ---------------------------------------------------------------------------
-- G. email.suppressed SUBTYPE SEPARATION
--
-- Resend documents exactly one subtype for this event -- the case-sensitive
-- literal 'OnAccountSuppressionList'
-- (https://resend.com/docs/webhooks/emails/suppressed) -- and types the field as
-- a bare `string`, not an enum (resend 6.18.1). Treating every suppression as an
-- account-level block meant the FIRST new subtype Resend shipped would silently
-- create indefinite, tenant-wide blocks against real addresses on evidence that
-- says nothing of the sort.
--
-- Everything below runs in organization ...0002 so the counts are not entangled
-- with the consent fixtures of section F.
-- ---------------------------------------------------------------------------

-- G1. THE METADATA ALLOWLIST.
--
-- 'suppressiontype' is admitted as a bounded token; the free-text sibling has no
-- key at all, so it is rejected rather than truncated.
SELECT extensions.ok(
  plugin_data.csf_provider_event_metadata_allowlisted(
    '{"suppressionType":"OnAccountSuppressionList"}'::jsonb
  ),
  'the bounded suppression subtype token is allowlisted metadata'
);

SELECT extensions.ok(
  NOT plugin_data.csf_provider_event_metadata_allowlisted(
    '{"suppressionMessage":"The recipient is on the account suppression list."}'::jsonb
  ),
  'the provider free-text suppression message has no allowlisted key and is refused'
);

SELECT extensions.ok(
  NOT plugin_data.csf_provider_event_metadata_allowlisted(
    '{"suppressed":{"type":"OnAccountSuppressionList","message":"free text"}}'::jsonb
  ),
  'the nested provider suppression object is refused; only the flattened token travels'
);

SELECT extensions.ok(
  NOT plugin_data.csf_provider_event_metadata_allowlisted(
    ('{"suppressionType":"' || repeat('A', 400) || '"}')::jsonb
  ),
  'an overlong suppression subtype is refused rather than silently truncated'
);

INSERT INTO plugin_data.csf_communication_campaigns (
  id, organization_id, campaign_kind, status, sender_name, sender_email,
  reply_to_email, subject, body_text, body_text_hash, term_id,
  audience_kind, broadcast_topic_key, resend_topic_id, created_by_identity,
  content_finalized_at, content_finalized_by_identity,
  audience_snapshot_version, provider_idempotency_key
) VALUES
  (
    'ce400000-0000-4000-8000-000000000011', 'ce100000-0000-4000-8000-000000000002',
    'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
    'dvhighcsf@gmail.com', 'Recognized account suppression',
    'The provider says this address is on the account suppression list.', repeat('5', 64),
    'ce200000-0000-4000-8000-000000000002', 'term_members', 'partner_clubs',
    'topic_synthetic_contract_s1', 'contract-other-officer@local.test',
    now(), 'contract-other-officer@local.test', 1, 'contract-suppress-known-key'
  ),
  (
    'ce400000-0000-4000-8000-000000000012', 'ce100000-0000-4000-8000-000000000002',
    'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
    'dvhighcsf@gmail.com', 'Unrecognized suppression subtype',
    'The provider suppressed this with a subtype we do not model.', repeat('6', 64),
    'ce200000-0000-4000-8000-000000000002', 'term_members', 'partner_clubs',
    'topic_synthetic_contract_s2', 'contract-other-officer@local.test',
    now(), 'contract-other-officer@local.test', 1, 'contract-suppress-unknown-key'
  ),
  (
    'ce400000-0000-4000-8000-000000000013', 'ce100000-0000-4000-8000-000000000002',
    'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
    'dvhighcsf@gmail.com', 'Missing suppression subtype',
    'The provider sent no subtype at all.', repeat('7', 64),
    'ce200000-0000-4000-8000-000000000002', 'term_members', 'partner_clubs',
    'topic_synthetic_contract_s3', 'contract-other-officer@local.test',
    now(), 'contract-other-officer@local.test', 1, 'contract-suppress-missing-key'
  );

SET CONSTRAINTS ALL IMMEDIATE;

-- Drive a campaign to an in-flight, authorized attempt so a suppression event
-- has a real try to bind to.
CREATE OR REPLACE FUNCTION pg_temp.inflight(
  p_campaign_id uuid,
  p_email text,
  p_worker text
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_attempt_id uuid;
BEGIN
  PERFORM plugin_data.csf_snapshot_communication_recipients(
    'ce100000-0000-4000-8000-000000000002',
    p_campaign_id,
    jsonb_build_array(
      jsonb_build_object('email', p_email, 'provenance', 'staff_entry')
    )
  );
  PERFORM plugin_data.csf_finalize_communication_recipient_snapshot(
    'ce100000-0000-4000-8000-000000000002', p_campaign_id, 1
  );
  PERFORM plugin_data.csf_claim_communication_dispatch_batch(
    'ce100000-0000-4000-8000-000000000002', p_campaign_id, p_worker, 25, 120
  );

  SELECT attempt.id
  INTO v_attempt_id
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.campaign_id = p_campaign_id
    AND attempt.state = 'processing'
  LIMIT 1;

  PERFORM plugin_data.csf_authorize_communication_dispatch(
    'ce100000-0000-4000-8000-000000000002', v_attempt_id, p_worker, NULL
  );

  RETURN v_attempt_id;
END;
$$;

CREATE TEMP TABLE t_suppress AS
SELECT
  pg_temp.inflight(
    'ce400000-0000-4000-8000-000000000011', 'known.suppressed@local.test', 'worker-s1'
  ) AS known_attempt,
  pg_temp.inflight(
    'ce400000-0000-4000-8000-000000000012', 'future.subtype@local.test', 'worker-s2'
  ) AS unknown_attempt,
  pg_temp.inflight(
    'ce400000-0000-4000-8000-000000000013', 'no.subtype@local.test', 'worker-s3'
  ) AS missing_attempt;

-- G2. THE RECOGNIZED SUBTYPE EARNS AN ADDRESS BLOCK, EXACTLY ONCE.
CREATE TEMP TABLE t_known_suppression AS
SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000002',
  'evt_contract_suppress_known',
  'email.suppressed',
  'resend-message-suppress-known',
  now() + interval '2 minutes',
  repeat('2', 64),
  true, 'svix', 'whsec_test_key',
  '{"suppressionType":"OnAccountSuppressionList"}'::jsonb,
  (SELECT known_attempt FROM t_suppress),
  'ce400000-0000-4000-8000-000000000011'
) AS result;

SELECT extensions.is(
  (SELECT result->>'processingState' FROM t_known_suppression),
  'reduced',
  'a recognized account suppression reduces the delivery'
);

SELECT extensions.is(
  (
    SELECT delivery.status || '|' || attempt.state
    FROM plugin_data.csf_communication_deliveries AS delivery
    JOIN plugin_data.csf_communication_dispatch_attempts AS attempt
      ON attempt.delivery_id = delivery.id
    WHERE delivery.campaign_id = 'ce400000-0000-4000-8000-000000000011'
  ),
  'suppressed|suppressed',
  'the recognized suppression settles exactly this delivery and its bound attempt'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND safety.normalized_recipient_email = 'known.suppressed@local.test'
      AND safety.safety_state <> 'safe'
  ),
  1,
  'exactly one terminal provider-suppression safety observation is created'
);

-- A REPLAY ADDS NOTHING. Same envelope id, same evidence.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_record_communication_provider_event(
      'ce100000-0000-4000-8000-000000000002',
      'evt_contract_suppress_known',
      'email.suppressed',
      'resend-message-suppress-known',
      now() + interval '2 minutes',
      repeat('2', 64),
      true, 'svix', 'whsec_test_key',
      '{"suppressionType":"OnAccountSuppressionList"}'::jsonb,
      (SELECT known_attempt FROM t_suppress),
      'ce400000-0000-4000-8000-000000000011'
    )->>'duplicate'
  ),
  'true',
  'the replayed suppression event is a recognized duplicate'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_address_safety_events AS event
    WHERE event.organization_id = 'ce100000-0000-4000-8000-000000000002'
  ),
  1,
  'the replay creates no second safety observation'
);

-- G3. AN UNRECOGNIZED SUBTYPE SUPPRESSES THE MESSAGE AND NOTHING ELSE.
CREATE TEMP TABLE t_unknown_suppression AS
SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000002',
  'evt_contract_suppress_unknown',
  'email.suppressed',
  'resend-message-suppress-unknown',
  now() + interval '2 minutes',
  repeat('3', 64),
  true, 'svix', 'whsec_test_key',
  -- A subtype Resend has not documented. Also covers the case-mutated and
  -- prefixed forms, which the route persists verbatim as bounded tokens.
  '{"suppressionType":"onaccountsuppressionlist"}'::jsonb,
  (SELECT unknown_attempt FROM t_suppress),
  'ce400000-0000-4000-8000-000000000012'
) AS result;

SELECT extensions.is(
  (
    SELECT delivery.status || '|' || attempt.state
    FROM plugin_data.csf_communication_deliveries AS delivery
    JOIN plugin_data.csf_communication_dispatch_attempts AS attempt
      ON attempt.delivery_id = delivery.id
    WHERE delivery.campaign_id = 'ce400000-0000-4000-8000-000000000012'
  ),
  -- The provider DID refuse this message, so this delivery is settled and is
  -- never auto-retried. What it did not do is say anything about the address.
  'suppressed|suppressed',
  'an unrecognized subtype still suppresses exactly this delivery and attempt'
);

SELECT extensions.is(
  (
    SELECT delivery.review_state || '|' || delivery.review_reason
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'ce400000-0000-4000-8000-000000000012'
  ),
  'escalated|unknown_suppression_type',
  'an unrecognized subtype escalates the delivery with a fixed bounded reason code'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_provider_events AS event
    WHERE event.provider_event_id = 'evt_contract_suppress_unknown'
      AND event.signature_verified = true
  ),
  1,
  'the signed evidence for an unrecognized subtype is still durable'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND safety.normalized_recipient_email = 'future.subtype@local.test'
  ),
  0,
  'an unrecognized subtype creates zero address-safety rows'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_address_safety_events AS event
    WHERE event.organization_id = 'ce100000-0000-4000-8000-000000000002'
  ),
  1,
  'an unrecognized subtype creates zero additional safety observations'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_broadcast_preferences AS preference
    WHERE preference.organization_id = 'ce100000-0000-4000-8000-000000000002'
  ),
  0,
  'no email.suppressed event of any subtype writes a broadcast preference row'
);

-- THE ADDRESS IS STILL MAILABLE FOR MANDATORY OPERATIONAL MAIL. This is the
-- whole point of refusing to manufacture a block from a token we do not model.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_communication_address_safety_decision(
      'ce100000-0000-4000-8000-000000000002', 'future.subtype@local.test'
    )->>'safe'
  ),
  'true',
  'an unrecognized subtype leaves the address safety projection untouched'
);

-- The composite decision, which is what dispatch actually asks.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_communication_dispatch_decision(
      'ce100000-0000-4000-8000-000000000002', 'transactional', NULL,
      'future.subtype@local.test'
    )->>'authorized'
  ),
  'true',
  'a later otherwise-safe transactional send to that address is still allowed'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_communication_address_safety_decision(
      'ce100000-0000-4000-8000-000000000002', 'known.suppressed@local.test'
    )->>'safe'
  ),
  'false',
  'the recognized account suppression does block the address, as it should'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_communication_dispatch_decision(
      'ce100000-0000-4000-8000-000000000002', 'transactional', NULL,
      'known.suppressed@local.test'
    )->>'blockedBy'
  ),
  'address_safety',
  'and it blocks even mandatory transactional mail, because the address itself is unusable'
);

-- AND THIS EXACT DELIVERY IS NEVER RETRIED.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'ce400000-0000-4000-8000-000000000012'
  ),
  1,
  'no successor attempt is enqueued behind an unrecognized suppression'
);

-- G4. A MISSING SUBTYPE BEHAVES EXACTLY AS AN UNRECOGNIZED ONE.
SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000002',
  'evt_contract_suppress_missing',
  'email.suppressed',
  'resend-message-suppress-missing',
  now() + interval '2 minutes',
  repeat('4', 64),
  true, 'svix', 'whsec_test_key',
  '{}'::jsonb,
  (SELECT missing_attempt FROM t_suppress),
  'ce400000-0000-4000-8000-000000000013'
);

SELECT extensions.is(
  (
    SELECT delivery.status || '|' || delivery.review_state
      || '|' || delivery.review_reason
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'ce400000-0000-4000-8000-000000000013'
  ),
  'suppressed|escalated|unknown_suppression_type',
  'a missing subtype suppresses the delivery and escalates, exactly as an unknown one'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND safety.normalized_recipient_email = 'no.subtype@local.test'
  ),
  0,
  'a missing subtype creates zero address-safety rows'
);

-- G5. TOPIC OPT-OUT IS CONSENT, NOT ADDRESS SAFETY, AND SUPPRESSION CANNOT
-- TOUCH IT.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_record_broadcast_preference_decision(
      'ce100000-0000-4000-8000-000000000002', 'partner_clubs',
      'topic.optout@local.test', 'opt_out', 'recipient', NULL, NULL,
      encode(extensions.digest('topic.optout@local.test', 'sha256'), 'hex')
    )->>'subscriptionState'
  ),
  'unsubscribed',
  'a topic opt-out is recorded for the broadcast topic'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_communication_preference_decision(
      'ce100000-0000-4000-8000-000000000002', 'broadcast', 'partner_clubs',
      'topic.optout@local.test'
    )->>'suppressed'
  ),
  'true',
  'the matching broadcast is denied by consent'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_communication_preference_decision(
      'ce100000-0000-4000-8000-000000000002', 'transactional', NULL,
      'topic.optout@local.test'
    )->>'decision'
  ),
  'mandatory_transactional',
  'transactional mail to the same address remains mandatory'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND safety.normalized_recipient_email = 'topic.optout@local.test'
  ),
  0,
  'a topic opt-out creates zero address-safety rows; consent never becomes safety'
);

-- An unrecognized suppression carrying a CSF topic tag must not be reinterpreted
-- as a consent decision about that topic.
SELECT extensions.is(
  (
    SELECT preference.subscription_state || '|' || preference.decision_actor_kind
    FROM plugin_data.csf_communication_broadcast_preferences AS preference
    WHERE preference.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND preference.normalized_recipient_email = 'topic.optout@local.test'
  ),
  'unsubscribed|recipient',
  'the recipient''s own decision still stands, unaltered by any provider event'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_preference_events AS event
    WHERE event.organization_id = 'ce100000-0000-4000-8000-000000000002'
  ),
  1,
  'the only consent history in this organization is the recipient''s own decision'
);

-- ---------------------------------------------------------------------------
-- G6. THE METADATA ALLOWLIST IS THE AT-REST BOUNDARY
--
-- The route not emitting a key is not a security boundary. A direct service-role
-- caller reaches this RPC, and while 'suppressionreason' was allowlisted it could
-- persist data.suppressed.message -- provider free text carrying an address,
-- control bytes, and log-injection payloads -- simply by renaming it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.hostile_metadata_sqlstate(p_metadata jsonb)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM plugin_data.csf_record_communication_provider_event(
    'ce100000-0000-4000-8000-000000000002',
    'evt_contract_hostile_metadata',
    'email.suppressed',
    'resend-message-hostile-metadata',
    now() + interval '9 minutes',
    repeat('9', 64),
    true, 'svix', 'whsec_test_key',
    p_metadata,
    NULL, NULL
  );
  RETURN 'accepted';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$;

SELECT extensions.is(
  pg_temp.hostile_metadata_sqlstate(
    ('{"suppressionReason":"student.one@local.test asked us to stop; DROP TABLE x; --"}')::jsonb
  ),
  '22023',
  'a renamed free-text suppression reason is refused with an exact SQLSTATE'
);

SELECT extensions.is(
  pg_temp.hostile_metadata_sqlstate('{"suppressionMessage":"free text"}'::jsonb),
  '22023',
  'suppressionMessage has no allowlisted key either'
);

-- The allowlist compares names with case and punctuation removed, so every
-- spelling of the same key must fail the same way.
SELECT extensions.is(
  (
    SELECT string_agg(DISTINCT pg_temp.hostile_metadata_sqlstate(
      jsonb_build_object(variant, 'free text')
    ), ',')
    FROM unnest(ARRAY[
      'suppressionreason', 'SUPPRESSIONREASON', 'Suppression_Reason',
      'suppression-reason', 'suppression.reason', 'SuppressionReason'
    ]) AS variant
  ),
  '22023',
  'every case and punctuation variant of the free-text key is refused identically'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_provider_events AS event
    WHERE event.provider_event_id = 'evt_contract_hostile_metadata'
  ),
  0,
  'no hostile-metadata attempt persisted an event row'
);

SELECT extensions.is(
  pg_temp.hostile_metadata_sqlstate(
    '{"suppressionType":"OnAccountSuppressionList"}'::jsonb
  ),
  'accepted',
  'the bounded suppression token remains the one accepted suppression key'
);

-- ---------------------------------------------------------------------------
-- G7. PROVIDER FEEDBACK IS NOT TOPIC-CONSENT AUTHORITY
--
-- A Resend event names an ADDRESS and a MESSAGE. It does not name a chapter and
-- it does not name a CSF topic, so no verified event can authorize opting a given
-- address out of a given topic. The draft that allowed it accepted ANY verified
-- event in the organization as authority over ANY address and topic.
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_broadcast_preference_decision(
      'ce100000-0000-4000-8000-000000000002'::uuid, 'partner_clubs',
      'topic.optout@local.test', 'opt_out', 'provider'
    )
  $$,
  '42501',
  NULL,
  'actor kind "provider" is refused outright'
);

-- The draft signature carried p_provider_event_row_id. It must not remain
-- executable alongside the corrected one: an ignored parameter is still a
-- callable shape that reads as supported.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_proc AS routine
    JOIN pg_namespace AS ns ON ns.oid = routine.pronamespace
    WHERE ns.nspname = 'plugin_data'
      AND routine.proname = 'csf_record_broadcast_preference_decision'
  ),
  1,
  'exactly one broadcast preference decision function exists; the draft overload is gone'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.oidvectortypes(routine.proargtypes)
    FROM pg_proc AS routine
    JOIN pg_namespace AS ns ON ns.oid = routine.pronamespace
    WHERE ns.nspname = 'plugin_data'
      AND routine.proname = 'csf_record_broadcast_preference_decision'
  ),
  'uuid, text, text, text, text, text, uuid, text, text',
  'the canonical signature carries no provider-event parameter'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_broadcast_preferences AS preference
    WHERE preference.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND preference.decision_actor_kind = 'provider'
  ),
  0,
  'no preference row was ever authored by a provider actor'
);

-- ---------------------------------------------------------------------------
-- G8. ADDRESS EVIDENCE IS NOT GATED ON THE DELIVERY REDUCER
--
-- The exact account suppression below arrives AFTER the unknown-subtype one, so
-- the delivery is already at 'suppressed' and the reducer answers ignored_stale.
-- While address safety was gated on that answer, the terminal block was never
-- created and the ledger kept mailing an address the provider had told it, in
-- writing, was on the account suppression list.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND safety.normalized_recipient_email = 'future.subtype@local.test'
  ),
  0,
  'the unknown-subtype suppression left the address unblocked, as it must'
);

CREATE TEMP TABLE t_known_after_unknown AS
SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000002',
  'evt_contract_known_after_unknown',
  'email.suppressed',
  'resend-message-suppress-unknown',
  now() + interval '6 minutes',
  repeat('8', 64),
  true, 'svix', 'whsec_test_key',
  '{"suppressionType":"OnAccountSuppressionList"}'::jsonb,
  (SELECT unknown_attempt FROM t_suppress),
  'ce400000-0000-4000-8000-000000000012'
) AS result;

SELECT extensions.is(
  (SELECT result->>'processingState' FROM t_known_after_unknown),
  'ignored_stale',
  'the delivery reducer correctly declines to move an already-suppressed delivery'
);

SELECT extensions.is(
  (
    SELECT safety.safety_state || '|' || safety.suppression_kind
      || '|' || safety.suppression_class
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND safety.normalized_recipient_email = 'future.subtype@local.test'
  ),
  'suppressed|indefinite|provider_suppression',
  'the exact account suppression still creates the terminal block, despite ignored_stale'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_communication_address_safety_decision(
      'ce100000-0000-4000-8000-000000000002', 'future.subtype@local.test'
    )->>'safe'
  ),
  'false',
  'and the address is now blocked for every requirement, including transactional'
);

-- REPLAY ADDS NOTHING. Same envelope, same evidence.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_record_communication_provider_event(
      'ce100000-0000-4000-8000-000000000002',
      'evt_contract_known_after_unknown',
      'email.suppressed',
      'resend-message-suppress-unknown',
      now() + interval '6 minutes',
      repeat('8', 64),
      true, 'svix', 'whsec_test_key',
      '{"suppressionType":"OnAccountSuppressionList"}'::jsonb,
      (SELECT unknown_attempt FROM t_suppress),
      'ce400000-0000-4000-8000-000000000012'
    )->>'duplicate'
  ),
  'true',
  'the replayed account suppression is a recognized duplicate'
);

SELECT extensions.is(
  (
    SELECT safety.observation_count::integer
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND safety.normalized_recipient_email = 'future.subtype@local.test'
  ),
  1,
  'the replay did not increment the observation count'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_address_safety_events AS event
    WHERE event.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND event.normalized_recipient_email = 'future.subtype@local.test'
  ),
  1,
  'and it duplicated no evidence row'
);

-- The delivery and attempt stayed terminal throughout.
SELECT extensions.is(
  (
    SELECT delivery.status || '|' || attempt.state
    FROM plugin_data.csf_communication_deliveries AS delivery
    JOIN plugin_data.csf_communication_dispatch_attempts AS attempt
      ON attempt.delivery_id = delivery.id
    WHERE delivery.campaign_id = 'ce400000-0000-4000-8000-000000000012'
  ),
  'suppressed|suppressed',
  'stronger address evidence never regressed the delivery or attempt'
);

-- ---------------------------------------------------------------------------
-- G9. AN EXACT Permanent BOUNCE TIGHTENS TRANSIENT STATE
--
-- Both reduce the DELIVERY to 'bounced', so the second event is equal-rank and
-- ignored_stale. The ADDRESS projection must still tighten from an expiring hold
-- to an indefinite block.
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_communication_campaigns (
  id, organization_id, campaign_kind, status, sender_name, sender_email,
  reply_to_email, subject, body_text, body_text_hash, term_id,
  audience_kind, broadcast_topic_key, resend_topic_id, created_by_identity,
  content_finalized_at, content_finalized_by_identity,
  audience_snapshot_version, provider_idempotency_key
) VALUES (
  'ce400000-0000-4000-8000-000000000014', 'ce100000-0000-4000-8000-000000000002',
  'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
  'dvhighcsf@gmail.com', 'Transient then permanent',
  'The first bounce is soft; the second is not.', repeat('a', 64),
  'ce200000-0000-4000-8000-000000000002', 'term_members', 'partner_clubs',
  'topic_synthetic_contract_s4', 'contract-other-officer@local.test',
  now(), 'contract-other-officer@local.test', 1, 'contract-bounce-upgrade-key'
);

SET CONSTRAINTS ALL IMMEDIATE;

CREATE TEMP TABLE t_bounce_upgrade AS
SELECT pg_temp.inflight(
  'ce400000-0000-4000-8000-000000000014', 'upgrade.bounce@local.test', 'worker-s4'
) AS attempt_id;

SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000002',
  'evt_contract_bounce_transient',
  'email.bounced',
  'resend-message-bounce-transient',
  now() + interval '2 minutes',
  repeat('b', 64),
  true, 'svix', 'whsec_test_key',
  '{"bounceType":"Transient","bounceSubtype":"MailboxFull"}'::jsonb,
  (SELECT attempt_id FROM t_bounce_upgrade),
  'ce400000-0000-4000-8000-000000000014'
);

SELECT extensions.is(
  (
    SELECT safety.suppression_kind || '|' || safety.bounce_class
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND safety.normalized_recipient_email = 'upgrade.bounce@local.test'
  ),
  'expiring|transient',
  'a Transient bounce earns an expiring hold, not a block'
);

CREATE TEMP TABLE t_bounce_permanent AS
SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000002',
  'evt_contract_bounce_permanent',
  'email.bounced',
  -- A second event about the SAME send carries the same provider message id.
  -- Using a different id here described contradictory evidence for one attempt
  -- and correctly tripped the delivery/message binding guard before this
  -- address-severity regression could run.
  'resend-message-bounce-transient',
  now() + interval '5 minutes',
  repeat('c', 64),
  true, 'svix', 'whsec_test_key',
  '{"bounceType":"Permanent","bounceSubtype":"General"}'::jsonb,
  (SELECT attempt_id FROM t_bounce_upgrade),
  'ce400000-0000-4000-8000-000000000014'
) AS result;

SELECT extensions.is(
  (SELECT result->>'processingState' FROM t_bounce_permanent),
  'ignored_stale',
  'the second bounce is equal-rank at the delivery level'
);

SELECT extensions.is(
  (
    SELECT safety.suppression_kind || '|' || safety.bounce_class
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND safety.normalized_recipient_email = 'upgrade.bounce@local.test'
  ),
  'indefinite|permanent',
  'the exact Permanent bounce still tightens the address projection'
);

-- A WEAKER LATER EVENT NEVER LOOSENS IT.
SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000002',
  'evt_contract_bounce_transient_late',
  'email.bounced',
  'resend-message-bounce-transient',
  now() + interval '8 minutes',
  repeat('d', 64),
  true, 'svix', 'whsec_test_key',
  '{"bounceType":"Transient","bounceSubtype":"MailboxFull"}'::jsonb,
  (SELECT attempt_id FROM t_bounce_upgrade),
  'ce400000-0000-4000-8000-000000000014'
);

SELECT extensions.is(
  (
    SELECT safety.suppression_kind || '|' || safety.bounce_class
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND safety.normalized_recipient_email = 'upgrade.bounce@local.test'
  ),
  'indefinite|permanent',
  'a later Transient bounce cannot loosen an indefinite block'
);

-- HOSTILE BOUNCE TOKENS CLASSIFY AS UNDETERMINED, NEVER PERMANENT.
SELECT extensions.is(
  (
    SELECT string_agg(
      plugin_data.csf_comm_bounce_class(candidate), ',' ORDER BY candidate
    )
    FROM unnest(ARRAY[
      'hard', 'HardBounce', 'permanent', 'PERMANENT', ' Permanent',
      'Permanent ', 'Permanent!!!', 'P e r m a n e n t', 'XPermanent',
      'Unknown', 'soft', 'delayed'
    ]) AS candidate
  ),
  'undetermined,undetermined,undetermined,undetermined,undetermined,undetermined,undetermined,undetermined,undetermined,undetermined,undetermined,undetermined',
  'no alias, case mutation, padding, or spacing reaches permanent or transient'
);

SELECT extensions.is(
  plugin_data.csf_comm_bounce_class('Permanent')
    || '|' || plugin_data.csf_comm_bounce_class('Transient')
    || '|' || plugin_data.csf_comm_bounce_class('Undetermined'),
  'permanent|transient|undetermined',
  'only the exact reviewed literals classify'
);

-- ---------------------------------------------------------------------------
-- G10. FIXED REASON CODES CARRY NO PROVIDER VALUE
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT string_agg(DISTINCT safety.suppression_reason, ',' ORDER BY safety.suppression_reason)
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
  ),
  'provider_account_suppression,provider_bounce_permanent',
  'durable safety reasons are fixed application codes, not provider prose'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      safety.suppression_reason ~ '^[a-z_]+$'
    )
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
  ),
  'every durable safety reason is a bare lowercase code with no punctuation, address, or control text'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      delivery.review_reason IS NULL
      OR delivery.review_reason ~ '^[a-z_]+$'
    )
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.organization_id = 'ce100000-0000-4000-8000-000000000002'
  ),
  'every durable delivery review reason is a bare lowercase code'
);

-- ---------------------------------------------------------------------------
-- G11. AN UNKNOWN SUPPRESSION IS TERMINAL FOR THAT DELIVERY
--
-- Not asserted by reading the row: by calling the surfaces that would actually
-- produce a retry, and proving they produce none.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'ce100000-0000-4000-8000-000000000002',
      'ce400000-0000-4000-8000-000000000012', 'worker-retry-probe', 25, 120
    )->>'claimedCount'
  ),
  '0',
  'the claim surface finds no work behind an unknown suppression'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_reap_communication_dispatch_leases(
      'ce100000-0000-4000-8000-000000000002',
      'ce400000-0000-4000-8000-000000000012'
    )->>'settledUnknownOutcomes'
  ),
  '0',
  'the lease reaper finds nothing to settle'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'ce400000-0000-4000-8000-000000000012'
  ),
  1,
  'no successor attempt exists after the claim and reap surfaces both ran'
);

-- Enqueueing a successor by hand is refused by the enqueue guard.
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_dispatch_attempts (
      organization_id, campaign_id, recipient_snapshot_id, delivery_id,
      content_hash, recipient_email_hash, provider_idempotency_key,
      request_payload_hash
    )
    SELECT
      attempt.organization_id, attempt.campaign_id, attempt.recipient_snapshot_id,
      attempt.delivery_id, attempt.content_hash, attempt.recipient_email_hash,
      'forced-successor-key', attempt.request_payload_hash
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'ce400000-0000-4000-8000-000000000012'
  $$,
  '23514',
  NULL,
  'the enqueue guard refuses a successor behind a settled suppression'
);

-- ---------------------------------------------------------------------------
-- G12. A PROVIDER EVENT NEVER TOUCHES CONSENT
--
-- A real recipient decision exists for this address and topic. Processing a
-- provider event about the same address must leave both consent tables byte
-- identical.
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_record_broadcast_preference_decision(
  'ce100000-0000-4000-8000-000000000002', 'partner_clubs',
  'consent.probe@local.test', 'opt_out', 'recipient', NULL, NULL,
  encode(extensions.digest('consent.probe@local.test', 'sha256'), 'hex')
);

CREATE TEMP TABLE t_consent_before AS
SELECT
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_broadcast_preferences
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000002'
  ) AS preferences,
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_preference_events
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000002'
  ) AS history,
  (
    SELECT md5(string_agg(
      preference.normalized_recipient_email || '|' || preference.topic_key
        || '|' || preference.subscription_state || '|' || preference.decision_actor_kind
        || '|' || preference.last_decision_at::text,
      ',' ORDER BY preference.normalized_recipient_email
    ))
    FROM plugin_data.csf_communication_broadcast_preferences AS preference
    WHERE preference.organization_id = 'ce100000-0000-4000-8000-000000000002'
  ) AS digest;

INSERT INTO plugin_data.csf_communication_campaigns (
  id, organization_id, campaign_kind, status, sender_name, sender_email,
  reply_to_email, subject, body_text, body_text_hash, term_id,
  audience_kind, broadcast_topic_key, resend_topic_id, created_by_identity,
  content_finalized_at, content_finalized_by_identity,
  audience_snapshot_version, provider_idempotency_key
) VALUES (
  'ce400000-0000-4000-8000-000000000015', 'ce100000-0000-4000-8000-000000000002',
  -- The address is deliberately opted out of partner-club broadcasts above. Use
  -- mandatory transactional mail here so it remains an included recipient and
  -- the provider-evidence test can prove that address safety never mutates the
  -- separate topic-consent history.
  'transactional', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
  'dvhighcsf@gmail.com', 'Consent probe',
  'A provider event about an address that has a consent decision.', repeat('e', 64),
  'ce200000-0000-4000-8000-000000000002', 'applicants', NULL,
  NULL, 'contract-other-officer@local.test',
  now(), 'contract-other-officer@local.test', 1, 'contract-consent-probe-key'
);

SET CONSTRAINTS ALL IMMEDIATE;

CREATE TEMP TABLE t_consent_probe AS
SELECT pg_temp.inflight(
  'ce400000-0000-4000-8000-000000000015', 'consent.probe@local.test', 'worker-s5'
) AS attempt_id;

-- An account suppression, a bounce, and a complaint about the very address that
-- carries a topic consent decision.
SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000002',
  'evt_contract_consent_probe_suppressed',
  'email.suppressed',
  'resend-message-consent-probe',
  now() + interval '3 minutes',
  repeat('f', 64),
  true, 'svix', 'whsec_test_key',
  '{"suppressionType":"OnAccountSuppressionList"}'::jsonb,
  (SELECT attempt_id FROM t_consent_probe),
  'ce400000-0000-4000-8000-000000000015'
);

SELECT extensions.is(
  (
    SELECT (
      SELECT count(*)::integer
      FROM plugin_data.csf_communication_broadcast_preferences
      WHERE organization_id = 'ce100000-0000-4000-8000-000000000002'
    ) || '|' || (
      SELECT count(*)::integer
      FROM plugin_data.csf_communication_preference_events
      WHERE organization_id = 'ce100000-0000-4000-8000-000000000002'
    )
    FROM t_consent_before
    LIMIT 1
  ),
  (
    SELECT preferences || '|' || history FROM t_consent_before
  ),
  'a provider event created no preference row and no consent history'
);

SELECT extensions.is(
  (
    SELECT md5(string_agg(
      preference.normalized_recipient_email || '|' || preference.topic_key
        || '|' || preference.subscription_state || '|' || preference.decision_actor_kind
        || '|' || preference.last_decision_at::text,
      ',' ORDER BY preference.normalized_recipient_email
    ))
    FROM plugin_data.csf_communication_broadcast_preferences AS preference
    WHERE preference.organization_id = 'ce100000-0000-4000-8000-000000000002'
  ),
  (SELECT digest FROM t_consent_before),
  'and every existing consent decision is byte identical afterwards'
);

-- ---------------------------------------------------------------------------
-- G13. RECORD VERSUS REBIND PRODUCE THE SAME RESULT
--
-- The rebind path re-runs the SAME primitive once the delivery it always
-- described finally exists. Known and unknown suppression must land identically
-- through both doors.
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_communication_campaigns (
  id, organization_id, campaign_kind, status, sender_name, sender_email,
  reply_to_email, subject, body_text, body_text_hash, term_id,
  audience_kind, broadcast_topic_key, resend_topic_id, created_by_identity,
  content_finalized_at, content_finalized_by_identity,
  audience_snapshot_version, provider_idempotency_key
) VALUES
  (
    'ce400000-0000-4000-8000-000000000016', 'ce100000-0000-4000-8000-000000000002',
    'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
    'dvhighcsf@gmail.com', 'Rebind known suppression',
    'The known suppression arrives before the delivery exists.', repeat('1', 64),
    'ce200000-0000-4000-8000-000000000002', 'term_members', 'partner_clubs',
    'topic_synthetic_contract_s6', 'contract-other-officer@local.test',
    now(), 'contract-other-officer@local.test', 1, 'contract-rebind-known-key'
  ),
  (
    'ce400000-0000-4000-8000-000000000017', 'ce100000-0000-4000-8000-000000000002',
    'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
    'dvhighcsf@gmail.com', 'Rebind unknown suppression',
    'The unknown suppression arrives before the delivery exists.', repeat('2', 64),
    'ce200000-0000-4000-8000-000000000002', 'term_members', 'partner_clubs',
    'topic_synthetic_contract_s7', 'contract-other-officer@local.test',
    now(), 'contract-other-officer@local.test', 1, 'contract-rebind-unknown-key'
  );

SET CONSTRAINTS ALL IMMEDIATE;

-- Evidence first, with no delivery yet: both file as unmatched.
CREATE TEMP TABLE t_rebind_known_initial AS
SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000002',
  'evt_contract_rebind_known',
  'email.suppressed',
  'resend-message-rebind-known',
  now() + interval '2 minutes',
  repeat('3', 64),
  true, 'svix', 'whsec_test_key',
  '{"suppressionType":"OnAccountSuppressionList"}'::jsonb,
  NULL, NULL
) AS result;

CREATE TEMP TABLE t_rebind_unknown_initial AS
SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000002',
  'evt_contract_rebind_unknown',
  'email.suppressed',
  'resend-message-rebind-unknown',
  now() + interval '2 minutes',
  repeat('4', 64),
  true, 'svix', 'whsec_test_key',
  '{"suppressionType":"SomeFutureSubtype"}'::jsonb,
  NULL, NULL
) AS result;

SELECT extensions.is(
  (SELECT result->>'processingState' FROM t_rebind_known_initial)
    || '|' || (SELECT result->>'processingState' FROM t_rebind_unknown_initial),
  'unmatched|unmatched',
  'evidence naming no known delivery files as unmatched through both doors'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_address_safety_events AS event
    WHERE event.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND event.provider_event_id IN (
        'evt_contract_rebind_known', 'evt_contract_rebind_unknown'
      )
  ),
  0,
  'unmatched evidence creates no address observation'
);

-- Now the deliveries exist and the provider message identities are bound to
-- both sides of the per-try ledger. A delivery-level identity alone cannot prove
-- which retry produced the message, so the resolver correctly refuses to guess
-- an attempt unless its matching identity (or a signed attempt tag) exists.
CREATE TEMP TABLE t_rebind_attempts AS
SELECT
  pg_temp.inflight(
    'ce400000-0000-4000-8000-000000000016', 'rebind.known@local.test', 'worker-s6'
  ) AS known_attempt,
  pg_temp.inflight(
    'ce400000-0000-4000-8000-000000000017', 'rebind.unknown@local.test', 'worker-s7'
  ) AS unknown_attempt;

UPDATE plugin_data.csf_communication_dispatch_attempts AS attempt
SET provider_message_id = 'resend-message-rebind-known'
WHERE attempt.id = (SELECT known_attempt FROM t_rebind_attempts);

UPDATE plugin_data.csf_communication_dispatch_attempts AS attempt
SET provider_message_id = 'resend-message-rebind-unknown'
WHERE attempt.id = (SELECT unknown_attempt FROM t_rebind_attempts);

UPDATE plugin_data.csf_communication_deliveries AS delivery
SET provider_message_id = 'resend-message-rebind-known'
WHERE delivery.campaign_id = 'ce400000-0000-4000-8000-000000000016';

UPDATE plugin_data.csf_communication_deliveries AS delivery
SET provider_message_id = 'resend-message-rebind-unknown'
WHERE delivery.campaign_id = 'ce400000-0000-4000-8000-000000000017';

CREATE TEMP TABLE t_rebind_known AS
SELECT plugin_data.csf_rebind_communication_provider_event(
  'ce100000-0000-4000-8000-000000000002', 'evt_contract_rebind_known'
) AS result;

CREATE TEMP TABLE t_rebind_unknown AS
SELECT plugin_data.csf_rebind_communication_provider_event(
  'ce100000-0000-4000-8000-000000000002', 'evt_contract_rebind_unknown'
) AS result;

-- KNOWN, VIA REBIND: identical to the record path in section G2.
SELECT extensions.is(
  (
    SELECT delivery.status || '|' || attempt.state
    FROM plugin_data.csf_communication_deliveries AS delivery
    JOIN plugin_data.csf_communication_dispatch_attempts AS attempt
      ON attempt.delivery_id = delivery.id
    WHERE delivery.campaign_id = 'ce400000-0000-4000-8000-000000000016'
  ),
  'suppressed|suppressed',
  'rebound known suppression suppresses the delivery and attempt'
);

SELECT extensions.is(
  (
    SELECT safety.safety_state || '|' || safety.suppression_kind
      || '|' || safety.suppression_reason
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND safety.normalized_recipient_email = 'rebind.known@local.test'
  ),
  'suppressed|indefinite|provider_account_suppression',
  'rebound known suppression creates the same terminal block the record path does'
);

-- UNKNOWN, VIA REBIND: identical to the record path in section G3.
SELECT extensions.is(
  (
    SELECT delivery.status || '|' || delivery.review_state
      || '|' || delivery.review_reason
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'ce400000-0000-4000-8000-000000000017'
  ),
  'suppressed|escalated|unknown_suppression_type',
  'rebound unknown suppression escalates with the same fixed reason code'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND safety.normalized_recipient_email = 'rebind.unknown@local.test'
  ),
  0,
  'rebound unknown suppression creates zero address-safety rows, as the record path does'
);

-- ---------------------------------------------------------------------------
-- G14. A LATE UNKNOWN SUPPRESSION OVERWRITES A STALE REVIEW REASON
--
-- The attempt is settled unknown_outcome first, so the resolver's earlier step
-- writes 'resolved_by_verified_provider_evidence' onto the delivery. The
-- escalation that follows must NOT coalesce that stale reason over its own: the
-- operator would be told the delivery was resolved while it sits escalated.
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_communication_campaigns (
  id, organization_id, campaign_kind, status, sender_name, sender_email,
  reply_to_email, subject, body_text, body_text_hash, term_id,
  audience_kind, broadcast_topic_key, resend_topic_id, created_by_identity,
  content_finalized_at, content_finalized_by_identity,
  audience_snapshot_version, provider_idempotency_key
) VALUES (
  'ce400000-0000-4000-8000-000000000018', 'ce100000-0000-4000-8000-000000000002',
  'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
  'dvhighcsf@gmail.com', 'Unknown outcome then unknown suppression',
  'The worker lost its response, then an unmodelled suppression arrived.', repeat('5', 64),
  'ce200000-0000-4000-8000-000000000002', 'term_members', 'partner_clubs',
  'topic_synthetic_contract_s8', 'contract-other-officer@local.test',
  now(), 'contract-other-officer@local.test', 1, 'contract-late-unknown-key'
);

SET CONSTRAINTS ALL IMMEDIATE;

CREATE TEMP TABLE t_late_unknown AS
SELECT pg_temp.inflight(
  'ce400000-0000-4000-8000-000000000018', 'late.unknown@local.test', 'worker-s8'
) AS attempt_id;

SELECT plugin_data.csf_settle_communication_dispatch_attempt(
  'ce100000-0000-4000-8000-000000000002',
  (SELECT attempt_id FROM t_late_unknown),
  'worker-s8', 'unknown_outcome', NULL, NULL, 'transport_exception',
  'Socket closed before the provider answered.'
);

SELECT extensions.is(
  (
    SELECT attempt.state || '|' || delivery.review_state
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_deliveries AS delivery
      ON delivery.id = attempt.delivery_id
    WHERE attempt.id = (SELECT attempt_id FROM t_late_unknown)
  ),
  'unknown_outcome|pending',
  'the attempt is settled ambiguous and its delivery is pending review'
);

SELECT plugin_data.csf_record_communication_provider_event(
  'ce100000-0000-4000-8000-000000000002',
  'evt_contract_late_unknown_suppression',
  'email.suppressed',
  'resend-message-late-unknown',
  now() + interval '7 minutes',
  repeat('6', 64),
  true, 'svix', 'whsec_test_key',
  '{"suppressionType":"SomeFutureSubtype"}'::jsonb,
  (SELECT attempt_id FROM t_late_unknown),
  'ce400000-0000-4000-8000-000000000018'
);

SELECT extensions.is(
  (
    SELECT delivery.review_state || '|' || delivery.review_reason
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'ce400000-0000-4000-8000-000000000018'
  ),
  -- Not 'escalated|resolved_by_verified_provider_evidence', which is what the
  -- coalesce produced: escalated, and telling the operator it was resolved.
  'escalated|unknown_suppression_type',
  'the late unknown suppression names itself; no stale reason survives'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'ce100000-0000-4000-8000-000000000002'
      AND safety.normalized_recipient_email = 'late.unknown@local.test'
  ),
  0,
  'and it still creates no address block'
);


SELECT * FROM extensions.finish();
ROLLBACK;
