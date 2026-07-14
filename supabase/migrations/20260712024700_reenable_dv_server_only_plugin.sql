-- Restore DV Speech & Debate after its browser data access was replaced by
-- authenticated Server Actions and service-role-only plugin_data clients.
--
-- Keep existing install choices intact. Forced, active entitlements remain
-- accessible through organization_plugin_access; non-forced installs that were
-- disabled during the transition must be deliberately enabled again.

BEGIN;

UPDATE public.plugins
SET
  name = 'DV Speech & Debate Ops',
  description = 'Server-only seasonal membership, tournament, guardian, and team operations for speech and debate organizations.',
  is_active = true,
  latest_version = '2.0.0',
  force_update_version = '2.0.0',
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'backend_access', 'server-only',
    'direct_client_access', false,
    'security_redesign', '2026-07'
  ),
  updated_at = now()
WHERE key = 'dv-speech-debate';

INSERT INTO public.plugin_versions (
  plugin_key,
  version,
  status,
  changelog,
  published_at
)
VALUES (
  'dv-speech-debate',
  '2.0.0',
  'published',
  'Server-only plugin_data access, authenticated action boundaries, and hardened seasonal workflows.',
  now()
)
ON CONFLICT (plugin_key, version) DO UPDATE
SET
  status = EXCLUDED.status,
  changelog = EXCLUDED.changelog,
  published_at = coalesce(public.plugin_versions.published_at, EXCLUDED.published_at);

UPDATE public.organization_plugin_installs
SET installed_version = '0.0.0'
WHERE plugin_key = 'dv-speech-debate'
  AND installed_version IS NULL;

-- The temporary shutdown disabled every install. Restore only platform-forced
-- installs already upgraded to the server-only version; ordinary organization
-- choices and stale installs remain disabled until an authorized lifecycle
-- transition upgrades and enables them.
UPDATE public.organization_plugin_installs AS installs
SET
  enabled = true,
  updated_at = now()
WHERE installs.plugin_key = 'dv-speech-debate'
  AND installs.installed_version = '2.0.0'
  AND EXISTS (
    SELECT 1
    FROM public.organization_plugin_entitlements AS entitlements
    WHERE entitlements.organization_id = installs.organization_id
      AND entitlements.plugin_key = installs.plugin_key
      AND entitlements.status = 'active'
      AND entitlements.is_forced
      AND (entitlements.starts_at IS NULL OR entitlements.starts_at <= now())
      AND (entitlements.ends_at IS NULL OR entitlements.ends_at >= now())
  );

-- Browser roles have no plugin_data grants, so every current and future data
-- boundary should describe the actual service-only contract.
ALTER TABLE public.organization_plugin_data_boundaries
  ALTER COLUMN direct_client_access SET DEFAULT 'blocked';

UPDATE public.organization_plugin_data_boundaries
SET
  direct_client_access = 'blocked',
  updated_at = now()
WHERE direct_client_access <> 'blocked';

CREATE OR REPLACE FUNCTION private.sync_organization_plugin_data_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  INSERT INTO public.organization_plugin_data_boundaries (
    organization_id,
    plugin_key,
    boundary_status,
    data_schema,
    data_prefix,
    isolation_mode,
    direct_client_access,
    allowed_relation_patterns,
    notes
  )
  VALUES (
    NEW.organization_id,
    NEW.plugin_key,
    CASE WHEN NEW.enabled THEN 'active' ELSE 'disabled' END,
    'plugin_data',
    NEW.plugin_key,
    'shared',
    'blocked',
    ARRAY[]::text[],
    'Created from organization_plugin_installs trigger with service-only access.'
  )
  ON CONFLICT (organization_id, plugin_key) DO UPDATE
  SET
    boundary_status = EXCLUDED.boundary_status,
    direct_client_access = 'blocked',
    updated_at = now();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_organization_plugin_data_boundary()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sync_organization_plugin_data_boundary()
  TO service_role;

INSERT INTO public.organization_plugin_data_boundaries (
  organization_id,
  plugin_key,
  boundary_status,
  data_schema,
  data_prefix,
  isolation_mode,
  direct_client_access,
  allowed_relation_patterns,
  notes
)
SELECT
  entitlements.organization_id,
  entitlements.plugin_key,
  'active',
  'plugin_data',
  entitlements.plugin_key,
  'shared',
  'blocked',
  ARRAY[]::text[],
  'Created for a platform-forced server-only entitlement.'
FROM public.organization_plugin_entitlements AS entitlements
WHERE entitlements.plugin_key = 'dv-speech-debate'
  AND entitlements.status = 'active'
  AND entitlements.is_forced
  AND (entitlements.starts_at IS NULL OR entitlements.starts_at <= now())
  AND (entitlements.ends_at IS NULL OR entitlements.ends_at >= now())
ON CONFLICT (organization_id, plugin_key) DO UPDATE
SET
  boundary_status = 'active',
  direct_client_access = 'blocked',
  updated_at = now();

UPDATE public.organization_plugin_data_boundaries AS boundaries
SET
  boundary_status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.organization_plugin_installs AS installs
      WHERE installs.organization_id = boundaries.organization_id
        AND installs.plugin_key = boundaries.plugin_key
        AND installs.enabled
    ) OR EXISTS (
      SELECT 1
      FROM public.organization_plugin_entitlements AS entitlements
      WHERE entitlements.organization_id = boundaries.organization_id
        AND entitlements.plugin_key = boundaries.plugin_key
        AND entitlements.status = 'active'
        AND entitlements.is_forced
        AND (entitlements.starts_at IS NULL OR entitlements.starts_at <= now())
        AND (entitlements.ends_at IS NULL OR entitlements.ends_at >= now())
    ) THEN 'active'
    ELSE 'disabled'
  END,
  direct_client_access = 'blocked',
  notes = coalesce(boundaries.notes || E'\n', '') ||
    'DV server-only redesign completed; browser roles retain no plugin_data grants.',
  updated_at = now()
WHERE boundaries.plugin_key = 'dv-speech-debate';

-- Immutable ledgers stay immutable for ordinary callers. The service-only,
-- transactional organization erasure RPC sets this transaction-local flag so
-- GDPR/offboarding deletion can remove the complete tenant dataset.
CREATE OR REPLACE FUNCTION private.prevent_immutable_dv_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('app.dv_organization_data_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'DV immutable records cannot be updated or deleted';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_immutable_dv_mutation()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION plugin_data.delete_dv_organization_data(
  p_organization_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_table record;
  v_rows integer;
  v_total integer := 0;
  v_remaining integer;
  v_progress boolean;
  v_pass integer;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization id is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.dv_organization_data_delete', 'on', true);

  -- Shared plugin platform rows are removed only when they are explicitly
  -- owned by DV. org_seasons is intentionally preserved because it has no
  -- plugin ownership discriminator.
  DELETE FROM plugin_data.org_form_definitions
  WHERE organization_id = p_organization_id
    AND plugin_key = 'dv-speech-debate';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  DELETE FROM plugin_data.org_member_profiles
  WHERE organization_id = p_organization_id
    AND plugin_key = 'dv-speech-debate';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  -- Delete every current and future DV relation carrying organization_id.
  -- Retry FK-blocked parents after their tenant-scoped children are removed;
  -- the enclosing function remains one atomic transaction.
  FOR v_pass IN 1..64 LOOP
    v_progress := false;

    FOR v_table IN
      SELECT columns.table_name
      FROM information_schema.columns AS columns
      WHERE columns.table_schema = 'plugin_data'
        AND columns.column_name = 'organization_id'
        AND columns.table_name LIKE 'dv_sd_%'
      ORDER BY columns.table_name
    LOOP
      BEGIN
        EXECUTE format(
          'DELETE FROM plugin_data.%I WHERE organization_id = $1',
          v_table.table_name
        ) USING p_organization_id;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows > 0 THEN
          v_progress := true;
          v_total := v_total + v_rows;
        END IF;
      EXCEPTION
        WHEN foreign_key_violation THEN
          NULL;
      END;
    END LOOP;

    v_remaining := 0;
    FOR v_table IN
      SELECT columns.table_name
      FROM information_schema.columns AS columns
      WHERE columns.table_schema = 'plugin_data'
        AND columns.column_name = 'organization_id'
        AND columns.table_name LIKE 'dv_sd_%'
      ORDER BY columns.table_name
    LOOP
      EXECUTE format(
        'SELECT count(*)::integer FROM plugin_data.%I WHERE organization_id = $1',
        v_table.table_name
      ) INTO v_rows USING p_organization_id;
      v_remaining := v_remaining + v_rows;
    END LOOP;

    EXIT WHEN v_remaining = 0;
    IF NOT v_progress THEN
      RAISE EXCEPTION
        'DV organization data deletion is blocked with % tenant rows remaining',
        v_remaining;
    END IF;
  END LOOP;

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION
      'DV organization data deletion exceeded the dependency retry limit';
  END IF;

  PERFORM set_config('app.dv_organization_data_delete', 'off', true);
  RETURN v_total;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.dv_organization_data_delete', 'off', true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.delete_dv_organization_data(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.delete_dv_organization_data(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.consume_dv_guardian_availability(
  p_token_hash text,
  p_status text,
  p_available_rounds text[] DEFAULT ARRAY[]::text[],
  p_notes text DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token plugin_data.dv_sd_guardian_action_tokens%ROWTYPE;
  v_tournament_id uuid;
  v_judge_id uuid;
  v_consumed_at timestamptz := clock_timestamp();
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_status NOT IN ('available', 'limited', 'unavailable')
    OR coalesce(array_length(p_available_rounds, 1), 0) > 50
    OR EXISTS (
      SELECT 1
      FROM unnest(coalesce(p_available_rounds, ARRAY[]::text[])) AS rounds(round_name)
      WHERE btrim(round_name) = '' OR char_length(round_name) > 100
    )
    OR char_length(coalesce(p_notes, '')) > 2000
  THEN
    RAISE EXCEPTION 'invalid guardian availability input'
      USING ERRCODE = '22023';
  END IF;

  SELECT tokens.*
  INTO v_token
  FROM plugin_data.dv_sd_guardian_action_tokens AS tokens
  WHERE tokens.token_hash = p_token_hash
    AND tokens.purpose = 'confirm_availability'
    AND tokens.consumed_at IS NULL
    AND tokens.expires_at > v_consumed_at
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'guardian link is unavailable'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.dv_sd_guardians AS guardians
    WHERE guardians.id = v_token.guardian_id
      AND guardians.organization_id = v_token.organization_id
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.organization_plugin_access AS access
    WHERE access.organization_id = v_token.organization_id
      AND access.plugin_key = 'dv-speech-debate'
      AND access.is_accessible
  ) THEN
    RAISE EXCEPTION 'guardian link is unavailable'
      USING ERRCODE = 'P0002';
  END IF;

  BEGIN
    v_tournament_id := nullif(v_token.payload ->> 'tournamentId', '')::uuid;
    v_judge_id := nullif(v_token.payload ->> 'judgeId', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'guardian link binding is invalid'
        USING ERRCODE = '22023';
  END;

  IF v_tournament_id IS NULL
    OR v_judge_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM plugin_data.dv_sd_tournaments AS tournaments
      WHERE tournaments.id = v_tournament_id
        AND tournaments.organization_id = v_token.organization_id
    )
    OR NOT EXISTS (
      SELECT 1
      FROM plugin_data.dv_sd_judges AS judges
      WHERE judges.id = v_judge_id
        AND judges.organization_id = v_token.organization_id
        AND judges.guardian_id = v_token.guardian_id
    )
    OR EXISTS (
      SELECT 1
      FROM plugin_data.dv_sd_judge_availability AS availability
      WHERE availability.tournament_id = v_tournament_id
        AND availability.judge_id = v_judge_id
        AND availability.organization_id <> v_token.organization_id
    )
  THEN
    RAISE EXCEPTION 'guardian link binding is invalid'
      USING ERRCODE = '22023';
  END IF;

  UPDATE plugin_data.dv_sd_guardian_action_tokens
  SET consumed_at = v_consumed_at
  WHERE id = v_token.id;

  INSERT INTO plugin_data.dv_sd_judge_availability (
    organization_id,
    tournament_id,
    judge_id,
    status,
    available_rounds,
    notes,
    confirmed_at,
    updated_at
  )
  VALUES (
    v_token.organization_id,
    v_tournament_id,
    v_judge_id,
    p_status,
    coalesce(p_available_rounds, ARRAY[]::text[]),
    nullif(btrim(p_notes), ''),
    v_consumed_at,
    v_consumed_at
  )
  ON CONFLICT (tournament_id, judge_id) DO UPDATE
  SET
    status = EXCLUDED.status,
    available_rounds = EXCLUDED.available_rounds,
    notes = EXCLUDED.notes,
    confirmed_at = EXCLUDED.confirmed_at,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO plugin_data.dv_sd_audit_events (
    organization_id,
    action,
    entity_type,
    entity_id,
    after_data,
    metadata
  )
  VALUES (
    v_token.organization_id,
    'guardian.availability_confirmed',
    'judge_availability',
    v_judge_id,
    jsonb_build_object(
      'tournamentId', v_tournament_id,
      'status', p_status,
      'availableRounds', to_jsonb(coalesce(p_available_rounds, ARRAY[]::text[]))
    ),
    jsonb_build_object('tokenId', v_token.id)
  );

  RETURN v_consumed_at;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.consume_dv_guardian_availability(text, text, text[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.consume_dv_guardian_availability(text, text, text[], text)
  TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM plugin_data.dv_sd_family_service_ledger
    WHERE source_id IS NOT NULL
    GROUP BY account_id, source_type, source_id, entry_type
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'duplicate DV family-service source ledger rows must be reconciled before the 2.0 cutover';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS dv_family_service_ledger_source_once_idx
  ON plugin_data.dv_sd_family_service_ledger (
    account_id,
    source_type,
    source_id,
    entry_type
  )
  WHERE source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION plugin_data.complete_dv_judge_assignment(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_season_id uuid,
  p_credits numeric,
  p_actor_user_id uuid
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_assignment plugin_data.dv_sd_judge_assignments_v2%ROWTYPE;
  v_account_id uuid;
  v_account_ids uuid[];
  v_completed_at timestamptz;
BEGIN
  IF p_credits <= 0 OR p_credits > 100 THEN
    RAISE EXCEPTION 'judge service credits must be greater than zero and at most 100'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members AS members
    WHERE members.organization_id = p_organization_id
      AND members.user_id = p_actor_user_id
      AND members.role IN ('admin', 'staff')
  ) THEN
    RAISE EXCEPTION 'organization staff access is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT assignments.*
  INTO v_assignment
  FROM plugin_data.dv_sd_judge_assignments_v2 AS assignments
  WHERE assignments.id = p_assignment_id
    AND assignments.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'judge assignment not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- A guardian can be linked to more than one household. Never choose a
  -- service-credit destination with LIMIT 1: an ambiguous household/account
  -- mapping would silently credit whichever row happened to be returned first.
  SELECT coalesce(
    array_agg(DISTINCT accounts.id ORDER BY accounts.id),
    ARRAY[]::uuid[]
  )
  INTO v_account_ids
  FROM plugin_data.dv_sd_judges AS judges
  JOIN plugin_data.dv_sd_guardians AS guardians
    ON guardians.id = judges.guardian_id
   AND guardians.organization_id = p_organization_id
   AND guardians.status = 'active'
  JOIN plugin_data.dv_sd_household_guardians AS household_guardians
    ON household_guardians.guardian_id = judges.guardian_id
  JOIN plugin_data.dv_sd_households AS households
    ON households.id = household_guardians.household_id
   AND households.organization_id = p_organization_id
   AND households.status = 'active'
  JOIN plugin_data.dv_sd_family_service_accounts AS accounts
    ON accounts.organization_id = p_organization_id
   AND accounts.season_id = p_season_id
   AND accounts.household_id = households.id
  JOIN plugin_data.dv_sd_tournaments AS tournaments
    ON tournaments.id = v_assignment.tournament_id
   AND tournaments.organization_id = p_organization_id
   AND tournaments.season_id = p_season_id
  WHERE judges.id = v_assignment.judge_id
    AND judges.organization_id = p_organization_id;
  IF cardinality(v_account_ids) = 0 THEN
    RAISE EXCEPTION 'assignment service account or season binding is invalid'
      USING ERRCODE = '23503';
  END IF;
  IF cardinality(v_account_ids) > 1 THEN
    RAISE EXCEPTION 'judge assignment maps to multiple family service accounts'
      USING ERRCODE = '23503';
  END IF;
  v_account_id := v_account_ids[1];

  IF v_assignment.status = 'completed' THEN
    IF EXISTS (
      SELECT 1
      FROM plugin_data.dv_sd_family_service_ledger AS ledger
      WHERE ledger.account_id = v_account_id
        AND ledger.source_type = 'judge_assignment'
        AND ledger.source_id = p_assignment_id
        AND ledger.entry_type = 'earned'
    ) THEN
      RETURN v_assignment.completed_at;
    END IF;
    RAISE EXCEPTION 'completed judge assignment is missing its service ledger entry';
  END IF;
  IF v_assignment.status NOT IN ('assigned', 'confirmed') THEN
    RAISE EXCEPTION 'assignment cannot be completed from its current status';
  END IF;

  v_completed_at := clock_timestamp();
  UPDATE plugin_data.dv_sd_judge_assignments_v2
  SET status = 'completed', completed_at = v_completed_at, updated_at = v_completed_at
  WHERE id = p_assignment_id;

  INSERT INTO plugin_data.dv_sd_family_service_ledger (
    account_id,
    entry_type,
    credits,
    source_type,
    source_id,
    note,
    created_by
  )
  VALUES (
    v_account_id,
    'earned',
    p_credits,
    'judge_assignment',
    p_assignment_id,
    'Completed tournament assignment ' || v_assignment.tournament_id::text || '.',
    p_actor_user_id
  );

  INSERT INTO plugin_data.dv_sd_audit_events (
    organization_id,
    season_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data
  )
  VALUES (
    p_organization_id,
    p_season_id,
    p_actor_user_id,
    'judge.assignment_completed',
    'judge_assignment',
    p_assignment_id,
    jsonb_build_object('status', v_assignment.status),
    jsonb_build_object('status', 'completed', 'credits', p_credits)
  );

  RETURN v_completed_at;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.complete_dv_judge_assignment(uuid, uuid, uuid, numeric, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.complete_dv_judge_assignment(uuid, uuid, uuid, numeric, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.approve_dv_allocation(
  p_organization_id uuid,
  p_draft_id uuid,
  p_actor_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft plugin_data.dv_sd_allocation_drafts%ROWTYPE;
  v_assignments jsonb;
  v_assignment jsonb;
  v_judge_id uuid;
  v_event_code text;
  v_round_code text;
  v_max_rounds integer;
  v_existing_rounds integer;
  v_proposed_rounds integer;
  v_approved_at timestamptz := clock_timestamp();
  v_count integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members AS members
    WHERE members.organization_id = p_organization_id
      AND members.user_id = p_actor_user_id
      AND members.role IN ('admin', 'staff')
  ) THEN
    RAISE EXCEPTION 'organization staff access is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT drafts.*
  INTO v_draft
  FROM plugin_data.dv_sd_allocation_drafts AS drafts
  WHERE drafts.id = p_draft_id
    AND drafts.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'allocation draft not found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_draft.status = 'approved' THEN
    RETURN (
      SELECT count(*)::integer
      FROM plugin_data.dv_sd_judge_assignments_v2 AS assignments
      WHERE assignments.allocation_draft_id = p_draft_id
        AND assignments.organization_id = p_organization_id
    );
  END IF;
  IF v_draft.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft allocations can be approved';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.dv_sd_tournaments AS tournaments
    WHERE tournaments.id = v_draft.tournament_id
      AND tournaments.organization_id = p_organization_id
  ) OR v_draft.proposal -> 'request' ->> 'organizationId' <> p_organization_id::text
    OR v_draft.proposal -> 'request' ->> 'tournamentId' <> v_draft.tournament_id::text
  THEN
    RAISE EXCEPTION 'allocation draft tenant binding is invalid';
  END IF;

  v_assignments := v_draft.proposal -> 'assignments';
  IF jsonb_typeof(v_assignments) <> 'array'
    OR jsonb_array_length(v_assignments) < 1
    OR jsonb_array_length(v_assignments) > 500
  THEN
    RAISE EXCEPTION 'allocation draft must contain 1-500 assignments';
  END IF;

  FOR v_assignment IN SELECT value FROM jsonb_array_elements(v_assignments)
  LOOP
    BEGIN
      v_judge_id := (v_assignment ->> 'judgeId')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'allocation contains an invalid judge id';
    END;
    v_event_code := btrim(coalesce(v_assignment ->> 'eventCode', ''));
    v_round_code := btrim(coalesce(v_assignment ->> 'roundCode', ''));
    IF v_event_code = '' OR char_length(v_event_code) > 100
      OR v_round_code = '' OR char_length(v_round_code) > 100
    THEN
      RAISE EXCEPTION 'allocation event and round codes must be 1-100 characters';
    END IF;

    SELECT judges.max_rounds_per_day
    INTO v_max_rounds
    FROM plugin_data.dv_sd_judges AS judges
    WHERE judges.id = v_judge_id
      AND judges.organization_id = p_organization_id
      AND judges.active
      AND judges.clearance_status IN ('verified', 'waived')
      AND judges.training_status IN ('verified', 'waived')
      AND (
        coalesce(cardinality(judges.event_qualifications), 0) = 0
        OR v_event_code = ANY(judges.event_qualifications)
      )
    FOR UPDATE OF judges;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'allocation judge is no longer eligible';
    END IF;

    -- v2 assignments do not yet carry a separate competition date, so a
    -- tournament is the smallest persisted day/load boundary. Count every
    -- non-cancelled assignment already committed for that judge and serialize
    -- approvals on the judge row. Excluding this draft avoids double-counting
    -- rows inserted by an earlier iteration of this loop.
    SELECT count(*)::integer
    INTO v_existing_rounds
    FROM plugin_data.dv_sd_judge_assignments_v2 AS assignments
    WHERE assignments.organization_id = p_organization_id
      AND assignments.tournament_id = v_draft.tournament_id
      AND assignments.judge_id = v_judge_id
      AND assignments.allocation_draft_id <> p_draft_id
      AND assignments.status <> 'cancelled';

    SELECT count(*)::integer
    INTO v_proposed_rounds
    FROM jsonb_array_elements(v_assignments) AS proposed(value)
    WHERE proposed.value ->> 'judgeId' = v_judge_id::text;

    IF v_max_rounds IS NOT NULL
      AND v_existing_rounds + v_proposed_rounds > v_max_rounds
    THEN
      RAISE EXCEPTION 'allocation exceeds a judge round limit';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.dv_sd_judge_availability AS availability
      WHERE availability.organization_id = p_organization_id
        AND availability.tournament_id = v_draft.tournament_id
        AND availability.judge_id = v_judge_id
        AND availability.status IN ('available', 'limited')
        AND (
          coalesce(cardinality(availability.available_rounds), 0) = 0
          OR v_round_code = ANY(availability.available_rounds)
        )
        AND NOT coalesce(v_round_code = ANY(availability.unavailable_rounds), false)
    ) OR EXISTS (
      SELECT 1
      FROM plugin_data.dv_sd_judge_conflicts AS conflicts
      WHERE conflicts.organization_id = p_organization_id
        AND conflicts.tournament_id = v_draft.tournament_id
        AND conflicts.judge_id = v_judge_id
        AND (
          (conflicts.conflict_type = 'event' AND conflicts.conflict_value = v_event_code)
          OR (conflicts.conflict_type = 'round' AND conflicts.conflict_value = v_round_code)
        )
    ) THEN
      RAISE EXCEPTION 'allocation changed during database revalidation';
    END IF;

    INSERT INTO plugin_data.dv_sd_judge_assignments_v2 (
      organization_id,
      tournament_id,
      judge_id,
      allocation_draft_id,
      event_code,
      round_code,
      created_by
    )
    VALUES (
      p_organization_id,
      v_draft.tournament_id,
      v_judge_id,
      p_draft_id,
      v_event_code,
      v_round_code,
      p_actor_user_id
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE plugin_data.dv_sd_allocation_drafts
  SET
    status = 'approved',
    approved_by = p_actor_user_id,
    approved_at = v_approved_at
  WHERE id = p_draft_id;

  INSERT INTO plugin_data.dv_sd_audit_events (
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    after_data
  )
  VALUES (
    p_organization_id,
    p_actor_user_id,
    'allocation.approved',
    'allocation_draft',
    p_draft_id,
    jsonb_build_object('assignments', v_assignments)
  );

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.approve_dv_allocation(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.approve_dv_allocation(uuid, uuid, uuid)
  TO service_role;

COMMIT;
