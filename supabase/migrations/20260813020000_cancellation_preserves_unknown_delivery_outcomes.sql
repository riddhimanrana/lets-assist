-- Stop campaign cancellation from overwriting an ambiguous delivery with a
-- definite, terminal 'failed'.
--
-- THE SEQUENCE, INSIDE ONE CALL.
--
-- plugin_data.csf_cancel_communication_campaign() reaps lapsed leases first, on
-- purpose: an attempt whose lease expired may already have been handed to the
-- provider, so the reaper settles it 'unknown_outcome', stamps the delivery's
-- unknown_outcome_at, and puts the delivery and the campaign under review. That
-- part is right and is not changed here.
--
-- What followed was not. The delivery sweep two statements later matched every
-- delivery still 'queued' with no attempt left in ('queued', 'processing') --
-- and the reap had just moved that exact attempt to 'unknown_outcome', which is
-- neither. So the same call that said "we do not know whether this was sent"
-- immediately recorded status = 'failed', which asserts that it was not, and
-- overwrote last_error -- the reaper's lapsed-lease sentence -- with the
-- officer's cancellation reason.
--
-- 'failed' IS TERMINAL, SO THIS WAS NOT SELF-CORRECTING. It appears in no
-- p_from branch of plugin_data.csf_communication_delivery_transition_allowed(),
-- so when the message HAD been accepted and Resend's email.delivered or
-- email.bounced arrived afterwards, the webhook could not move the row. The
-- provider's own evidence was filed as an ignored conflict and the ledger kept
-- telling the chapter that a student who was mailed was not.
--
-- The honest state is the one the reaper already wrote: the delivery stays
-- 'queued' with unknown_outcome_at set and review_state 'pending', exactly as it
-- would if the lease had lapsed without a cancellation. Cancellation is exempt
-- from the terminalization guard for precisely this reason -- see
-- plugin_data.csf_enforce_campaign_terminalization(), which excludes 'cancelled'
-- because withdrawing a send is an honest terminal answer for the CAMPAIGN even
-- when an individual recipient's outcome is unknown -- so leaving the row queued
-- and reviewable strands nothing. A later provider event can still carry it
-- forward to 'sent', 'bounced', or 'suppressed', and the review queue is what
-- surfaces it if none ever comes.
--
-- Deliveries that were never dispatched still settle 'failed'. Those are
-- provably pre-provider: the attempt sat in 'queued' and never held a lease, so
-- nothing was handed over for them and 'failed' is the truth.
--
-- Only the delivery sweep changes. Signature, ACL, authorization, locking, the
-- reap, the queued-attempt settlement, and the returned shape are preserved
-- byte-for-byte, and 'deliveriesSettled' keeps its meaning: the number of
-- deliveries this cancellation itself settled.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_cancel_communication_campaign(
  p_organization_id uuid,
  p_campaign_id uuid,
  p_reason text,
  p_actor_user_id uuid DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- 'manage_settings' is the existing chapter-administration capability -- held by
  -- owner, advisor, and co-president -- and withdrawing a chapter-wide send is
  -- exactly that kind of decision. csf_actor_has_permission() is tenant-scoped and
  -- requires an ACTIVE membership plus an in-date staff position, so a former
  -- officer, a member of another chapter, or any signed-in account that merely
  -- exists is refused.
  c_capability constant text := 'manage_settings';
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_correlation text := nullif(btrim(coalesce(p_correlation_id, '')), '');
  v_actor_identity text;
  v_now timestamptz := now();
  v_campaign plugin_data.csf_communication_campaigns%ROWTYPE;
  v_reaped jsonb;
  v_settled integer := 0;
  v_deliveries integer := 0;
  v_still_leased integer := 0;
  v_ambiguous integer := 0;
BEGIN
  IF p_organization_id IS NULL OR p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'A CSF campaign cancellation requires an organization and a campaign.'
      USING ERRCODE = '22004';
  END IF;

  IF v_reason IS NULL OR pg_catalog.char_length(v_reason) > 300 THEN
    RAISE EXCEPTION
      'A CSF campaign cancellation records a reason of 1 to 300 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_correlation IS NOT NULL
    AND (v_correlation ~ '\s' OR pg_catalog.char_length(v_correlation) > 128)
  THEN
    RAISE EXCEPTION
      'A CSF cancellation correlation identifier is whitespace-free and at most 128 characters.'
      USING ERRCODE = '22023';
  END IF;

  -- THE ACTOR IS AUTHORIZATION, NOT DECORATION.
  --
  -- Checking only that the account exists would let any signed-in user in any
  -- organization stop another chapter's send, because service_role reaches this
  -- RPC on behalf of whoever is holding the session.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF campaign cancellation must record the staff account that decided it.'
      USING ERRCODE = '22004';
  END IF;

  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, c_capability
  ) THEN
    RAISE EXCEPTION
      'That account does not hold the CSF staff capability required to cancel a campaign in this organization.'
      USING ERRCODE = '42501';
  END IF;

  SELECT lower(btrim(coalesce(account.email, '')))
  INTO v_actor_identity
  FROM auth.users AS account
  WHERE account.id = p_actor_user_id;

  -- The durable actor record. created_by-style references are ON DELETE SET NULL,
  -- so an account removal must not erase who cancelled a send.
  v_actor_identity := coalesce(
    nullif(v_actor_identity, ''), 'user:' || p_actor_user_id::text
  );

  -- The same campaign advisory lock plugin_data.csf_settle_communication_dispatch_attempt()
  -- takes, so a live worker's settlement and this cancellation cannot interleave
  -- into a rolled-back settlement and a fabricated unknown outcome.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-campaign:' || p_organization_id::text || ':'
        || p_campaign_id::text,
      0
    )
  );

  SELECT campaign.*
  INTO v_campaign
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_campaign.status = 'cancelled' THEN
    -- A lost response followed by an idempotent retry must report the ledger as
    -- it exists now, not fabricate the all-clear values that originally lived
    -- in this branch. The campaign lock above makes these two counts one
    -- coherent officer-facing snapshot.
    SELECT count(*)::integer
    INTO v_still_leased
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.organization_id = p_organization_id
      AND attempt.campaign_id = p_campaign_id
      AND attempt.state = 'processing'
      AND attempt.lease_expires_at > pg_catalog.clock_timestamp();

    SELECT count(*)::integer
    INTO v_ambiguous
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.organization_id = p_organization_id
      AND delivery.campaign_id = p_campaign_id
      AND delivery.status = 'queued'
      AND delivery.unknown_outcome_at IS NOT NULL;

    RETURN pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'campaignId', p_campaign_id,
      'status', 'cancelled',
      'attemptsSettled', 0,
      'deliveriesSettled', 0,
      'deliveriesLeftAmbiguous', v_ambiguous,
      'attemptsStillLeased', v_still_leased,
      'expiredLeasesSettledUnknown', 0,
      'idempotentReplay', true
    );
  END IF;

  IF v_campaign.status NOT IN ('draft', 'queued', 'sending') THEN
    RAISE EXCEPTION
      'A settled CSF campaign ("%") cannot be cancelled.', v_campaign.status
      USING ERRCODE = '23514';
  END IF;

  -- CANCELLATION SETTLES EXPIRED LEASED WORK HONESTLY.
  --
  -- Work whose lease already lapsed is ambiguous: the holder may have sent it. If
  -- cancellation left it in 'processing', nothing would ever settle it -- the claim
  -- path refuses to yield work for a cancelled campaign, so no later sweep would
  -- reach it, and the ledger would carry a permanently unsettled attempt that no
  -- review queue surfaces. Reaping first turns each of those into an honest
  -- unknown_outcome with review evidence.
  --
  -- This is deliberately NOT a retry. Nothing here re-enqueues anything, and the
  -- attempts it settles are unretryable by construction.
  v_reaped := plugin_data.csf_reap_communication_dispatch_leases(
    p_organization_id, p_campaign_id
  );

  -- Queued work settles now. queued -> failed is a legal attempt transition, and
  -- a queued attempt is provably pre-provider: it never held a lease, so nothing
  -- was ever handed over for it.
  UPDATE plugin_data.csf_communication_dispatch_attempts AS attempt
  SET
    state = 'failed',
    failure_class = 'campaign_cancelled',
    outcome_detail = v_reason,
    correlation_id = coalesce(attempt.correlation_id, v_correlation),
    settlement_source = 'cancellation',
    lease_owner = NULL,
    leased_at = NULL,
    lease_expires_at = NULL,
    settled_at = v_now,
    updated_at = v_now
  WHERE attempt.organization_id = p_organization_id
    AND attempt.campaign_id = p_campaign_id
    AND attempt.state = 'queued';
  GET DIAGNOSTICS v_settled = ROW_COUNT;

  -- Anything STILL leased holds a live lease and belongs to a worker that may yet
  -- settle it honestly. It is reported, not stolen; the campaign-status filter on
  -- the claim path stops it being handed to anybody else, and when its lease does
  -- lapse the reaper settles it as an unknown outcome rather than a retry.
  SELECT count(*)::integer
  INTO v_still_leased
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.organization_id = p_organization_id
    AND attempt.campaign_id = p_campaign_id
    AND attempt.state = 'processing';

  -- CANCELLATION DOES NOT RESOLVE AN AMBIGUITY IT JUST CREATED.
  --
  -- The reap above may have moved an attempt to 'unknown_outcome' microseconds
  -- ago. Such a delivery has no attempt in ('queued', 'processing') either, so
  -- the sweep below would have matched it and written the one status this
  -- ledger cannot walk back: 'failed' is terminal in
  -- plugin_data.csf_communication_delivery_transition_allowed(), so the
  -- provider's own later email.delivered could never correct it.
  --
  -- Ambiguity is read from unknown_outcome_at, the delivery's own durable record
  -- of it, so a delivery reaped by an earlier sweep is covered as well as one
  -- reaped by this call. Those rows keep the state the reaper left -- 'queued',
  -- unknown_outcome_at set, review_state 'pending' -- which is reviewable and
  -- still reachable by provider evidence.
  UPDATE plugin_data.csf_communication_deliveries AS delivery
  SET
    status = 'failed',
    failed_at = coalesce(delivery.failed_at, greatest(v_now, delivery.queued_at)),
    last_error = v_reason,
    updated_at = v_now
  WHERE delivery.organization_id = p_organization_id
    AND delivery.campaign_id = p_campaign_id
    AND delivery.status = 'queued'
    AND delivery.unknown_outcome_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_communication_dispatch_attempts AS attempt
      WHERE attempt.organization_id = delivery.organization_id
        AND attempt.delivery_id = delivery.id
        AND attempt.state IN ('queued', 'processing', 'unknown_outcome')
    );
  GET DIAGNOSTICS v_deliveries = ROW_COUNT;

  -- Reported, not hidden. An officer who cancels a send is entitled to know that
  -- some recipients may have been mailed anyway and are waiting on review.
  SELECT count(*)::integer
  INTO v_ambiguous
  FROM plugin_data.csf_communication_deliveries AS delivery
  WHERE delivery.organization_id = p_organization_id
    AND delivery.campaign_id = p_campaign_id
    AND delivery.status = 'queued'
    AND delivery.unknown_outcome_at IS NOT NULL;

  UPDATE plugin_data.csf_communication_campaigns
  SET
    status = 'cancelled',
    cancelled_at = v_now,
    cancellation_reason = v_reason,
    cancelled_by = p_actor_user_id,
    cancelled_by_identity = v_actor_identity,
    correlation_id = coalesce(correlation_id, v_correlation),
    completed_at = coalesce(completed_at, v_now),
    updated_at = v_now
  WHERE id = p_campaign_id
    AND organization_id = p_organization_id;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'campaignId', p_campaign_id,
    'status', 'cancelled',
    'attemptsSettled', v_settled,
    'deliveriesSettled', v_deliveries,
    'deliveriesLeftAmbiguous', v_ambiguous,
    'attemptsStillLeased', v_still_leased,
    'expiredLeasesSettledUnknown', coalesce(
      (v_reaped->>'settledUnknownOutcomes')::integer, 0
    ),
    'actorUserId', p_actor_user_id,
    'actorIdentity', v_actor_identity,
    'correlationId', v_correlation,
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_cancel_communication_campaign(uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_cancel_communication_campaign(uuid, uuid, text, uuid, text)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_cancel_communication_campaign(uuid, uuid, text, uuid, text) IS
  'Withdraws a CSF campaign under the campaign advisory lock: reaps lapsed leases as unknown outcomes, settles queued attempts and never-dispatched deliveries as failed, reports live leases rather than stealing them, and records the staff actor and reason. Deliveries whose outcome is unknown keep their reviewable queued state -- ''failed'' is terminal, so asserting it would block the provider''s own later evidence from ever correcting the record.';

COMMIT;
