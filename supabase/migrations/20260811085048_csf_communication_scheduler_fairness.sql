-- B84 / V122: the application worker previously discovered work by scanning a
-- capped prefix of campaign rows. That prefix was not a queue: a review-blocked
-- campaign never left it, so enough old rows could permanently hide every later
-- organization and campaign. The same scan excluded cancelled campaigns even
-- though a cancelled campaign can still own a processing lease whose provider
-- outcome becomes ambiguous when the lease expires.
--
-- Keep provider transport in the application, but move scheduler scope and
-- terminalization maintenance behind service-only database RPCs. Durable
-- tenant-fairness timestamps advance only when the application acknowledges a
-- short-lived scope reservation immediately before a worker pass, while
-- per-tenant cyclic campaign cursors advance even when a selected row stays
-- nonterminal or one finalizer faults. The existing
-- claim/reaper/finalizer RPCs remain the only authorities on dispatch state and
-- retain their canonical campaign lock order.

CREATE TABLE plugin_data.csf_scheduler_state (
  organization_id uuid PRIMARY KEY
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_worker_attempted_at timestamptz,
  scope_reservation_id uuid,
  scope_reserved_until timestamptz,
  last_maintenance_at timestamptz,
  last_campaign_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plugin_data.csf_scheduler_state
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE plugin_data.csf_scheduler_state
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE plugin_data.csf_scheduler_state IS
  'Private per-organization cursors for bounded CSF communications scheduling. These operational coordinates contain no recipient, message, or provider data, have no browser policy, and are reachable only through service-role scheduler RPCs.';

CREATE INDEX csf_scheduler_scope_fairness_idx
  ON plugin_data.csf_scheduler_state (
    last_worker_attempted_at NULLS FIRST,
    organization_id
  );

CREATE INDEX csf_scheduler_maintenance_fairness_idx
  ON plugin_data.csf_scheduler_state (
    last_maintenance_at NULLS FIRST,
    organization_id
  );

-- Global scope discovery needs available time before tenant. The existing claim
-- index starts with organization_id because it serves an already-scoped worker;
-- this complementary partial index serves only the service scheduler.
CREATE INDEX csf_comm_attempts_scheduler_queue_idx
  ON plugin_data.csf_communication_dispatch_attempts (
    available_at,
    organization_id,
    campaign_id
  )
  WHERE state = 'queued';

-- The maintenance pass walks open campaigns by UUID from its durable cursor.
CREATE INDEX csf_comm_campaigns_scheduler_idx
  ON plugin_data.csf_communication_campaigns (organization_id, id)
  WHERE status IN ('queued', 'sending');

-- Scope discovery creates a short reservation but does not advance fairness. A
-- slow response can arrive after the application has too little time left to
-- start a worker; its unacknowledged reservation expires, while other tenants are
-- immediately selectable. A separate acknowledgement commits the bounded worker
-- attempt before any campaign lock is acquired. That makes a claim-time fault
-- rotate fairly without inserting a scheduler-row lock into campaign work.
CREATE OR REPLACE FUNCTION plugin_data.csf_acknowledge_communication_scheduler_scope(
  p_organization_id uuid,
  p_reservation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_acknowledged boolean := false;
BEGIN
  IF p_organization_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'A CSF scheduler acknowledgement requires its reserved scope.'
      USING ERRCODE = '22004';
  END IF;

  UPDATE plugin_data.csf_scheduler_state AS state
  SET
    last_worker_attempted_at = now(),
    scope_reservation_id = NULL,
    scope_reserved_until = NULL,
    updated_at = now()
  WHERE state.organization_id = p_organization_id
    AND state.scope_reservation_id = p_reservation_id
    AND state.scope_reserved_until > now();

  v_acknowledged := FOUND;

  RETURN pg_catalog.jsonb_build_object('acknowledged', v_acknowledged);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_acknowledge_communication_scheduler_scope(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_acknowledge_communication_scheduler_scope(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_acknowledge_communication_scheduler_scope(uuid, uuid) IS
  'Acknowledges one unexpired service-only scheduler reservation immediately before its worker pass. This advances tenant attempt fairness even if the following claim faults, and takes no campaign lock.';

CREATE OR REPLACE FUNCTION plugin_data.csf_claim_communication_scheduler_scope(
  p_max_organizations integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Return exactly one tenant so the application cannot preallocate an
  -- unprocessed suffix. Discovery reserves but does not advance attempt
  -- fairness; the application must acknowledge the exact reservation before it
  -- starts the worker.
  c_max_organizations constant integer := 1;
  c_reservation_seconds constant integer := 120;
  v_now timestamptz := now();
  v_organization_ids uuid[] := '{}'::uuid[];
  v_reservation_id uuid;
BEGIN
  IF p_max_organizations IS NULL
    OR p_max_organizations < 1
    OR p_max_organizations > c_max_organizations
  THEN
    RAISE EXCEPTION
      'A CSF scheduler scope takes exactly 1 organization.'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize only scope allocation. The transaction ends as soon as this RPC
  -- returns; no provider call or worker pass happens while this advisory lock is
  -- held. Fairness remains durable in tenant-shaped state rows.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('csf-communication-scheduler-scope', 0)
  );

  WITH eligible AS (
    -- A queued attempt is actionable only after its availability time and only
    -- while its campaign remains open for dispatch.
    SELECT DISTINCT attempt.organization_id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_campaigns AS campaign
      ON campaign.id = attempt.campaign_id
      AND campaign.organization_id = attempt.organization_id
    WHERE attempt.state = 'queued'
      AND attempt.available_at <= v_now
      AND campaign.status IN ('queued', 'sending')

    UNION

    -- An expired processing lease is actionable regardless of campaign status.
    -- In particular, cancellation deliberately leaves a still-live lease with
    -- its worker; if that worker dies, the cancelled campaign must be rediscovered
    -- so the existing claim/reaper path can mark the outcome unknown for review.
    SELECT DISTINCT attempt.organization_id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.state = 'processing'
      AND attempt.lease_expires_at IS NOT NULL
      AND attempt.lease_expires_at <= v_now
  ),
  selected AS (
    SELECT eligible.organization_id
    FROM eligible
    LEFT JOIN plugin_data.csf_scheduler_state AS state
      ON state.organization_id = eligible.organization_id
    WHERE state.scope_reserved_until IS NULL
      OR state.scope_reserved_until <= v_now
    ORDER BY state.last_worker_attempted_at NULLS FIRST, eligible.organization_id
    LIMIT p_max_organizations
  )
  SELECT coalesce(
    pg_catalog.array_agg(selected.organization_id ORDER BY selected.organization_id),
    '{}'::uuid[]
  )
  INTO v_organization_ids
  FROM selected;

  IF pg_catalog.array_length(v_organization_ids, 1) IS NOT NULL THEN
    v_reservation_id := pg_catalog.gen_random_uuid();

    INSERT INTO plugin_data.csf_scheduler_state (
      organization_id,
      scope_reservation_id,
      scope_reserved_until,
      updated_at
    )
    VALUES (
      v_organization_ids[1],
      v_reservation_id,
      v_now + pg_catalog.make_interval(secs => c_reservation_seconds),
      v_now
    )
    ON CONFLICT (organization_id) DO UPDATE
    SET
      scope_reservation_id = EXCLUDED.scope_reservation_id,
      scope_reserved_until = EXCLUDED.scope_reserved_until,
      updated_at = EXCLUDED.updated_at;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'organizationCount', coalesce(
      pg_catalog.array_length(v_organization_ids, 1), 0
    ),
    'organizationIds', pg_catalog.to_jsonb(v_organization_ids),
    'reservationId', v_reservation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_claim_communication_scheduler_scope(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_communication_scheduler_scope(integer)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_claim_communication_scheduler_scope(integer) IS
  'Reserves exactly one durably fair service-only organization scope derived from actionable queued attempts and expired processing leases. The short reservation excludes that tenant without advancing worker-attempt fairness until exact acknowledgement. Expired leases remain discoverable even after cancellation.';

CREATE OR REPLACE FUNCTION plugin_data.csf_maintain_communication_campaigns(
  p_max_campaigns integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_campaigns constant integer := 200;
  c_max_organizations constant integer := 10;
  v_now timestamptz := now();
  v_organization_ids uuid[] := '{}'::uuid[];
  v_organization_id uuid;
  v_organization_count integer;
  v_per_organization_limit integer;
  v_organization_limit integer;
  v_cursor uuid;
  v_candidate record;
  v_result jsonb;
  v_last_campaign_id uuid;
  v_checked integer := 0;
  v_terminalized integer := 0;
  v_nonterminal integer := 0;
  v_faults integer := 0;
BEGIN
  IF p_max_campaigns IS NULL
    OR p_max_campaigns < 1
    OR p_max_campaigns > c_max_campaigns
  THEN
    RAISE EXCEPTION
      'A CSF campaign maintenance pass takes between 1 and % campaigns.',
      c_max_campaigns
      USING ERRCODE = '22023';
  END IF;

  -- Serialize only maintenance allocation. The existing finalizer still owns
  -- the canonical campaign advisory-lock -> campaign-row-lock order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('csf-communication-scheduler-maintenance', 0)
  );

  WITH eligible AS (
    SELECT DISTINCT campaign.organization_id
    FROM plugin_data.csf_communication_campaigns AS campaign
    WHERE campaign.status IN ('queued', 'sending')
  ),
  selected AS (
    SELECT eligible.organization_id
    FROM eligible
    LEFT JOIN plugin_data.csf_scheduler_state AS state
      ON state.organization_id = eligible.organization_id
    ORDER BY state.last_maintenance_at NULLS FIRST, eligible.organization_id
    LIMIT CASE
      WHEN p_max_campaigns < c_max_organizations THEN p_max_campaigns
      ELSE c_max_organizations
    END
  )
  SELECT coalesce(
    pg_catalog.array_agg(selected.organization_id ORDER BY selected.organization_id),
    '{}'::uuid[]
  )
  INTO v_organization_ids
  FROM selected;

  v_organization_count := coalesce(
    pg_catalog.array_length(v_organization_ids, 1),
    0
  );

  IF v_organization_count > 0 THEN
    v_per_organization_limit := CASE
      WHEN pg_catalog.floor(
        p_max_campaigns::numeric / v_organization_count::numeric
      )::integer < 1 THEN 1
      ELSE pg_catalog.floor(
        p_max_campaigns::numeric / v_organization_count::numeric
      )::integer
    END;
  END IF;

  FOREACH v_organization_id IN ARRAY v_organization_ids
  LOOP
    EXIT WHEN v_checked >= p_max_campaigns;

    v_last_campaign_id := NULL;
    SELECT state.last_campaign_id
    INTO v_cursor
    FROM plugin_data.csf_scheduler_state AS state
    WHERE state.organization_id = v_organization_id;

    v_organization_limit := CASE
      WHEN v_per_organization_limit < p_max_campaigns - v_checked
        THEN v_per_organization_limit
      ELSE p_max_campaigns - v_checked
    END;

    FOR v_candidate IN
      WITH forward_scope AS (
        SELECT campaign.id
        FROM plugin_data.csf_communication_campaigns AS campaign
        WHERE campaign.organization_id = v_organization_id
          AND campaign.status IN ('queued', 'sending')
          AND (v_cursor IS NULL OR campaign.id > v_cursor)
        ORDER BY campaign.id
        LIMIT v_organization_limit
      ),
      wrapped_scope AS (
        SELECT campaign.id
        FROM plugin_data.csf_communication_campaigns AS campaign
        WHERE campaign.organization_id = v_organization_id
          AND campaign.status IN ('queued', 'sending')
          AND v_cursor IS NOT NULL
          AND campaign.id <= v_cursor
        ORDER BY campaign.id
        LIMIT v_organization_limit
      )
      SELECT scope.id
      FROM (
        SELECT forward_scope.id, 0 AS cycle
        FROM forward_scope
        UNION ALL
        SELECT wrapped_scope.id, 1 AS cycle
        FROM wrapped_scope
      ) AS scope
      ORDER BY scope.cycle, scope.id
      LIMIT v_organization_limit
    LOOP
      v_checked := v_checked + 1;
      v_last_campaign_id := v_candidate.id;

      BEGIN
        v_result := plugin_data.csf_finalize_communication_campaign(
          v_organization_id,
          v_candidate.id
        );

        IF coalesce((v_result->>'terminalized')::boolean, false) THEN
          v_terminalized := v_terminalized + 1;
        ELSE
          v_nonterminal := v_nonterminal + 1;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          -- One malformed or concurrently changing campaign cannot pin either
          -- cursor or hide later work. The route receives only this count; no
          -- database diagnostic, campaign identity, or recipient data escapes.
          v_faults := v_faults + 1;
      END;
    END LOOP;

    INSERT INTO plugin_data.csf_scheduler_state (
      organization_id,
      last_maintenance_at,
      last_campaign_id,
      updated_at
    ) VALUES (
      v_organization_id,
      v_now,
      v_last_campaign_id,
      v_now
    )
    ON CONFLICT (organization_id) DO UPDATE
    SET
      last_maintenance_at = EXCLUDED.last_maintenance_at,
      last_campaign_id = coalesce(
        EXCLUDED.last_campaign_id,
        csf_scheduler_state.last_campaign_id
      ),
      updated_at = EXCLUDED.updated_at;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'checked', v_checked,
    'terminalized', v_terminalized,
    'nonterminal', v_nonterminal,
    'faults', v_faults
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_maintain_communication_campaigns(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_maintain_communication_campaigns(integer)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_maintain_communication_campaigns(integer) IS
  'Runs the existing locked campaign finalizer over a bounded cyclic slice of queued/sending campaigns. The durable cursor advances after every considered campaign, including nonterminal and faulting rows, so a blocked prefix can never starve later work. Returns aggregate counts only.';
