-- Add immutable, revisioned CSF semester close outcomes. A reasoned reopen
-- restores the exact pre-close membership state and never makes a historical
-- semester current again.

BEGIN;

ALTER TABLE plugin_data.csf_term_closures
  DROP CONSTRAINT IF EXISTS csf_term_closures_organization_id_term_id_key,
  DROP CONSTRAINT IF EXISTS csf_term_closures_term_id_fkey,
  ADD COLUMN IF NOT EXISTS revision integer,
  ADD COLUMN IF NOT EXISTS snapshot_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS supersedes_closure_id uuid,
  ADD COLUMN IF NOT EXISTS reopenable boolean NOT NULL DEFAULT false;

WITH ranked AS (
  SELECT
    closure.id,
    row_number() OVER (
      PARTITION BY closure.organization_id, closure.term_id
      ORDER BY closure.closed_at, closure.id
    )::integer AS revision
  FROM plugin_data.csf_term_closures AS closure
)
UPDATE plugin_data.csf_term_closures AS closure
SET revision = ranked.revision
FROM ranked
WHERE ranked.id = closure.id
  AND closure.revision IS NULL;

UPDATE plugin_data.csf_term_closures
SET correlation_id = CASE
  WHEN coalesce(summary->>'correlationId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN (summary->>'correlationId')::uuid
  ELSE gen_random_uuid()
END
WHERE correlation_id IS NULL;

ALTER TABLE plugin_data.csf_term_closures
  ALTER COLUMN revision SET NOT NULL,
  ALTER COLUMN correlation_id SET NOT NULL,
  ADD CONSTRAINT csf_term_closures_revision_check CHECK (revision > 0),
  ADD CONSTRAINT csf_term_closures_snapshot_version_check CHECK (snapshot_version > 0),
  ADD CONSTRAINT csf_term_closures_id_organization_term_key UNIQUE (id, organization_id, term_id),
  ADD CONSTRAINT csf_term_closures_organization_term_revision_key UNIQUE (organization_id, term_id, revision),
  ADD CONSTRAINT csf_term_closures_organization_correlation_key UNIQUE (organization_id, correlation_id),
  ADD CONSTRAINT csf_term_closures_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT csf_term_closures_supersedes_organization_term_fkey
    FOREIGN KEY (supersedes_closure_id, organization_id, term_id)
    REFERENCES plugin_data.csf_term_closures (id, organization_id, term_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS csf_term_closures_history_idx
  ON plugin_data.csf_term_closures (organization_id, term_id, revision DESC);

ALTER TABLE plugin_data.csf_terms
  ADD COLUMN IF NOT EXISTS closure_revision integer NOT NULL DEFAULT 0 CHECK (closure_revision >= 0),
  ADD COLUMN IF NOT EXISTS latest_closure_id uuid,
  ADD COLUMN IF NOT EXISTS active_closure_id uuid;

WITH latest AS (
  SELECT DISTINCT ON (closure.organization_id, closure.term_id)
    closure.organization_id,
    closure.term_id,
    closure.id,
    closure.revision
  FROM plugin_data.csf_term_closures AS closure
  ORDER BY closure.organization_id, closure.term_id, closure.revision DESC
)
UPDATE plugin_data.csf_terms AS term
SET
  closure_revision = latest.revision,
  latest_closure_id = latest.id,
  active_closure_id = CASE WHEN term.lifecycle_status = 'closed' THEN latest.id ELSE NULL END
FROM latest
WHERE term.organization_id = latest.organization_id
  AND term.id = latest.term_id;

ALTER TABLE plugin_data.csf_terms
  ADD CONSTRAINT csf_terms_latest_closure_organization_term_fkey
    FOREIGN KEY (latest_closure_id, organization_id, id)
    REFERENCES plugin_data.csf_term_closures (id, organization_id, term_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT csf_terms_active_closure_organization_term_fkey
    FOREIGN KEY (active_closure_id, organization_id, id)
    REFERENCES plugin_data.csf_term_closures (id, organization_id, term_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT csf_terms_closure_pointer_check CHECK (
    (lifecycle_status = 'closed' AND active_closure_id IS NOT NULL)
    OR (lifecycle_status <> 'closed' AND active_closure_id IS NULL)
  );

ALTER TABLE plugin_data.csf_term_memberships
  ADD CONSTRAINT csf_term_memberships_id_organization_term_key UNIQUE (id, organization_id, term_id),
  ADD COLUMN IF NOT EXISTS finalized_closure_id uuid,
  ADD COLUMN IF NOT EXISTS finalized_revision integer,
  ADD COLUMN IF NOT EXISTS finalized_correlation_id uuid,
  ADD CONSTRAINT csf_term_memberships_finalized_revision_check CHECK (
    finalized_revision IS NULL OR finalized_revision > 0
  ),
  ADD CONSTRAINT csf_term_memberships_finalized_state_check CHECK (
    (
      finalized_closure_id IS NULL
      AND finalized_revision IS NULL
      AND finalized_correlation_id IS NULL
    )
    OR
    (
      finalized_closure_id IS NOT NULL
      AND finalized_revision IS NOT NULL
      AND finalized_correlation_id IS NOT NULL
      AND status IN ('completed', 'not_completed')
    )
  ),
  ADD CONSTRAINT csf_term_memberships_finalized_closure_organization_term_fkey
    FOREIGN KEY (finalized_closure_id, organization_id, term_id)
    REFERENCES plugin_data.csf_term_closures (id, organization_id, term_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE plugin_data.csf_term_membership_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid NOT NULL,
  closure_id uuid NOT NULL,
  closure_revision integer NOT NULL CHECK (closure_revision > 0),
  membership_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  derived_status text NOT NULL CHECK (derived_status IN ('completed', 'not_completed')),
  effective_status text NOT NULL CHECK (effective_status IN ('completed', 'not_completed')),
  reason_code text NOT NULL,
  reason text NOT NULL,
  progress_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(progress_snapshot) = 'object'),
  prior_status text NOT NULL CHECK (prior_status IN ('pending', 'accepted', 'active')),
  prior_status_reason text,
  prior_eligibility_snapshot jsonb NOT NULL CHECK (jsonb_typeof(prior_eligibility_snapshot) = 'object'),
  prior_completed_at timestamptz,
  prior_override_status text CHECK (prior_override_status IN ('completed', 'not_completed')),
  prior_override_reason text,
  prior_overridden_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  prior_overridden_at timestamptz,
  final_status text NOT NULL CHECK (final_status IN ('completed', 'not_completed')),
  final_status_reason text NOT NULL,
  final_eligibility_snapshot jsonb NOT NULL CHECK (jsonb_typeof(final_eligibility_snapshot) = 'object'),
  final_completed_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL,
  UNIQUE (organization_id, closure_id, membership_id),
  FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (closure_id, organization_id, term_id)
    REFERENCES plugin_data.csf_term_closures (id, organization_id, term_id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id, organization_id, term_id)
    REFERENCES plugin_data.csf_term_memberships (id, organization_id, term_id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX csf_term_membership_outcomes_history_idx
  ON plugin_data.csf_term_membership_outcomes (organization_id, term_id, closure_revision DESC, profile_id);

CREATE TABLE plugin_data.csf_term_reopen_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid NOT NULL,
  closure_id uuid NOT NULL,
  closure_revision integer NOT NULL CHECK (closure_revision > 0),
  reason_code text NOT NULL CHECK (reason_code IN (
    'data_correction',
    'appeal_resolution',
    'attendance_correction',
    'dues_correction',
    'administrative_correction',
    'other'
  )),
  reason text NOT NULL CHECK (char_length(btrim(reason)) >= 10),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  correlation_id uuid NOT NULL,
  restored_membership_count integer NOT NULL CHECK (restored_membership_count >= 0),
  reopened_at timestamptz NOT NULL DEFAULT now(),
  before_state jsonb NOT NULL CHECK (jsonb_typeof(before_state) = 'object'),
  after_state jsonb NOT NULL CHECK (jsonb_typeof(after_state) = 'object'),
  UNIQUE (organization_id, closure_id),
  UNIQUE (organization_id, correlation_id),
  FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (closure_id, organization_id, term_id)
    REFERENCES plugin_data.csf_term_closures (id, organization_id, term_id) ON DELETE CASCADE
);

CREATE INDEX csf_term_reopen_events_history_idx
  ON plugin_data.csf_term_reopen_events (organization_id, term_id, reopened_at DESC, id DESC);

CREATE OR REPLACE FUNCTION plugin_data.csf_reject_semester_history_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'CSF semester history snapshots are immutable.';
END;
$$;

CREATE TRIGGER csf_term_closures_immutable_snapshot
BEFORE UPDATE ON plugin_data.csf_term_closures
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_reject_semester_history_update();

CREATE TRIGGER csf_term_membership_outcomes_immutable_snapshot
BEFORE UPDATE ON plugin_data.csf_term_membership_outcomes
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_reject_semester_history_update();

CREATE TRIGGER csf_term_reopen_events_immutable_snapshot
BEFORE UPDATE ON plugin_data.csf_term_reopen_events
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_reject_semester_history_update();

CREATE OR REPLACE FUNCTION plugin_data.csf_close_term(
  p_organization_id uuid,
  p_term_id uuid,
  p_policy_version integer,
  p_decisions jsonb,
  p_summary jsonb,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_membership plugin_data.csf_term_memberships%ROWTYPE;
  v_item jsonb;
  v_profile_id uuid;
  v_derived_status text;
  v_effective_status text;
  v_effective_reason text;
  v_reason_code text;
  v_final_snapshot jsonb;
  v_now timestamptz := now();
  v_updated integer := 0;
  v_membership_count integer := 0;
  v_decision_count integer := 0;
  v_distinct_decision_count integer := 0;
  v_current_policy_version integer;
  v_readiness jsonb;
  v_correlation_id uuid := gen_random_uuid();
  v_closure_summary jsonb;
  v_closure_id uuid := gen_random_uuid();
  v_next_revision integer;
  v_audit_action text;
  v_audit_reason text;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Semester close requires an actor.';
  END IF;
  IF jsonb_typeof(p_decisions) <> 'array' OR jsonb_array_length(p_decisions) = 0 THEN
    RAISE EXCEPTION 'Term close requires at least one membership decision.';
  END IF;
  IF p_summary IS NULL OR jsonb_typeof(p_summary) <> 'object' THEN
    RAISE EXCEPTION 'Term close summary must be an object.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
    AND term.lifecycle_status NOT IN ('closed', 'archived')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF semester is missing, closed, or archived.';
  END IF;

  SELECT policy.policy_version
  INTO v_current_policy_version
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF semester policy is missing.';
  END IF;
  IF p_policy_version <> v_current_policy_version THEN
    RAISE EXCEPTION 'CSF semester policy changed; refresh closure readiness and try again.';
  END IF;

  v_readiness := plugin_data.csf_term_closure_readiness(p_organization_id, p_term_id);
  IF coalesce((v_readiness->>'totalBlockers')::integer, 0) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'CSF semester cannot be closed while operational work remains.',
      DETAIL = v_readiness::text,
      HINT = 'Resolve applications, point submissions and appeals, attendance reconciliation, and dues before closing.';
  END IF;

  SELECT count(*)::integer
  INTO v_membership_count
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.term_id = p_term_id
    AND membership.status IN ('pending', 'accepted', 'active');

  SELECT count(*)::integer, count(DISTINCT decision.value->>'profileId')::integer
  INTO v_decision_count, v_distinct_decision_count
  FROM jsonb_array_elements(p_decisions) AS decision(value);

  IF v_membership_count = 0 THEN
    RAISE EXCEPTION 'No active term memberships are available to close.';
  END IF;
  IF v_decision_count <> v_membership_count OR v_distinct_decision_count <> v_membership_count THEN
    RAISE EXCEPTION 'Term close requires exactly one decision for every active membership.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_decisions) AS decision(value)
    LEFT JOIN plugin_data.csf_term_memberships AS membership
      ON membership.organization_id = p_organization_id
      AND membership.term_id = p_term_id
      AND membership.profile_id = (decision.value->>'profileId')::uuid
      AND membership.status IN ('pending', 'accepted', 'active')
    WHERE membership.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Term close includes a decision outside the active membership roster.';
  END IF;

  v_next_revision := v_term.closure_revision + 1;
  v_closure_summary := p_summary || jsonb_build_object(
    'readiness', v_readiness,
    'correlationId', v_correlation_id,
    'revision', v_next_revision
  );

  INSERT INTO plugin_data.csf_term_closures (
    id, organization_id, term_id, policy_version, summary, decisions,
    closed_by, closed_at, revision, snapshot_version, correlation_id,
    supersedes_closure_id, reopenable
  ) VALUES (
    v_closure_id, p_organization_id, p_term_id, p_policy_version,
    v_closure_summary, p_decisions, p_actor_user_id, v_now,
    v_next_revision, 2, v_correlation_id, v_term.latest_closure_id, true
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_decisions)
  LOOP
    v_profile_id := (v_item->>'profileId')::uuid;
    v_derived_status := v_item->>'status';
    IF v_derived_status NOT IN ('completed', 'not_completed') THEN
      RAISE EXCEPTION 'Invalid term-close decision for profile %.', v_profile_id;
    END IF;

    SELECT membership.*
    INTO v_membership
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.term_id = p_term_id
      AND membership.profile_id = v_profile_id
      AND membership.status IN ('pending', 'accepted', 'active')
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active term membership not found for profile %.', v_profile_id;
    END IF;

    v_effective_status := coalesce(v_membership.override_status, v_derived_status);
    v_effective_reason := coalesce(
      nullif(btrim(v_item->>'reason'), ''),
      v_membership.status_reason,
      CASE WHEN v_effective_status = 'completed' THEN 'All term requirements met.' ELSE 'Term requirements incomplete.' END
    );
    v_reason_code := coalesce(
      nullif(btrim(v_item->>'reasonCode'), ''),
      CASE WHEN v_membership.override_status IS NOT NULL THEN 'officer_override'
        WHEN v_effective_status = 'completed' THEN 'requirements_met'
        ELSE 'requirements_incomplete'
      END
    );
    v_final_snapshot := v_membership.eligibility_snapshot || jsonb_build_object(
      'termClose', v_item,
      'policyVersion', p_policy_version,
      'closureId', v_closure_id,
      'revision', v_next_revision,
      'correlationId', v_correlation_id,
      'closedAt', v_now
    );

    INSERT INTO plugin_data.csf_term_membership_outcomes (
      organization_id, term_id, closure_id, closure_revision,
      membership_id, profile_id, policy_version, derived_status,
      effective_status, reason_code, reason, progress_snapshot,
      prior_status, prior_status_reason, prior_eligibility_snapshot,
      prior_completed_at, prior_override_status, prior_override_reason,
      prior_overridden_by, prior_overridden_at, final_status,
      final_status_reason, final_eligibility_snapshot, final_completed_at,
      created_by, created_at, correlation_id
    ) VALUES (
      p_organization_id, p_term_id, v_closure_id, v_next_revision,
      v_membership.id, v_membership.profile_id, p_policy_version,
      v_derived_status, v_effective_status, v_reason_code, v_effective_reason,
      coalesce(v_item->'progress', '{}'::jsonb), v_membership.status,
      v_membership.status_reason, v_membership.eligibility_snapshot,
      v_membership.completed_at, v_membership.override_status,
      v_membership.override_reason, v_membership.overridden_by,
      v_membership.overridden_at, v_effective_status, v_effective_reason,
      v_final_snapshot, v_now, p_actor_user_id, v_now, v_correlation_id
    );

    UPDATE plugin_data.csf_term_memberships
    SET
      status = v_effective_status,
      status_reason = v_effective_reason,
      eligibility_snapshot = v_final_snapshot,
      completed_at = v_now,
      finalized_closure_id = v_closure_id,
      finalized_revision = v_next_revision,
      finalized_correlation_id = v_correlation_id,
      updated_at = v_now
    WHERE id = v_membership.id
      AND organization_id = p_organization_id
      AND term_id = p_term_id;
    v_updated := v_updated + 1;
  END LOOP;

  UPDATE plugin_data.csf_terms
  SET
    lifecycle_status = 'closed',
    is_current = false,
    closed_at = v_now,
    closed_by = p_actor_user_id,
    closure_policy_version = p_policy_version,
    closure_revision = v_next_revision,
    latest_closure_id = v_closure_id,
    active_closure_id = v_closure_id,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_term_id;

  v_audit_action := CASE WHEN v_next_revision = 1 THEN 'term.close' ELSE 'term.reclose' END;
  v_audit_reason := CASE WHEN v_next_revision = 1 THEN 'semester_closed' ELSE 'semester_reclosed' END;
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_audit_action, 'csf_terms', p_term_id, p_term_id,
    jsonb_build_object(
      'lifecycleStatus', v_term.lifecycle_status,
      'closureRevision', v_term.closure_revision,
      'latestClosureId', v_term.latest_closure_id
    ),
    jsonb_build_object(
      'policyVersion', p_policy_version,
      'summary', v_closure_summary,
      'membershipCount', v_updated,
      'closureId', v_closure_id,
      'revision', v_next_revision
    ),
    v_correlation_id, 'term_closure', v_closure_id::text, v_audit_reason
  );

  RETURN jsonb_build_object(
    'termId', p_term_id,
    'closureId', v_closure_id,
    'revision', v_next_revision,
    'membershipCount', v_updated,
    'closedAt', v_now,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_reopen_term(
  p_organization_id uuid,
  p_term_id uuid,
  p_expected_closure_id uuid,
  p_expected_revision integer,
  p_reason_code text,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_closure plugin_data.csf_term_closures%ROWTYPE;
  v_outcome plugin_data.csf_term_membership_outcomes%ROWTYPE;
  v_existing plugin_data.csf_term_reopen_events%ROWTYPE;
  v_reason text := nullif(btrim(p_reason), '');
  v_now timestamptz := now();
  v_outcome_count integer := 0;
  v_finalized_count integer := 0;
  v_restored integer := 0;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Semester reopen requires an actor and correlation ID.';
  END IF;
  IF p_expected_closure_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'Semester reopen requires the expected close revision.';
  END IF;
  IF p_reason_code NOT IN (
    'data_correction', 'appeal_resolution', 'attendance_correction',
    'dues_correction', 'administrative_correction', 'other'
  ) THEN
    RAISE EXCEPTION 'Semester reopen reason code is invalid.';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Semester reopen requires a reason of at least 10 characters.';
  END IF;

  SELECT event.*
  INTO v_existing
  FROM plugin_data.csf_term_reopen_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.correlation_id = p_correlation_id;
  IF FOUND THEN
    IF v_existing.term_id <> p_term_id OR v_existing.closure_id <> p_expected_closure_id THEN
      RAISE EXCEPTION 'Semester reopen correlation ID is already in use.';
    END IF;
    RETURN jsonb_build_object(
      'termId', v_existing.term_id,
      'closureId', v_existing.closure_id,
      'revision', v_existing.closure_revision,
      'restoredMembershipCount', v_existing.restored_membership_count,
      'reopenedAt', v_existing.reopened_at,
      'correlationId', v_existing.correlation_id,
      'idempotentReplay', true
    );
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
    AND term.lifecycle_status = 'closed'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF semester is missing or is not closed.';
  END IF;
  IF v_term.active_closure_id IS DISTINCT FROM p_expected_closure_id
    OR v_term.closure_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'The semester close revision changed; refresh and try again.';
  END IF;

  SELECT closure.*
  INTO v_closure
  FROM plugin_data.csf_term_closures AS closure
  WHERE closure.organization_id = p_organization_id
    AND closure.term_id = p_term_id
    AND closure.id = p_expected_closure_id
    AND closure.revision = p_expected_revision
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The active CSF semester closure snapshot is missing.';
  END IF;
  IF NOT v_closure.reopenable OR v_closure.snapshot_version < 2 THEN
    RAISE EXCEPTION 'This legacy semester close cannot be reopened automatically.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_reopen_events AS event
    WHERE event.organization_id = p_organization_id
      AND event.closure_id = v_closure.id
  ) THEN
    RAISE EXCEPTION 'This semester close revision has already been reopened.';
  END IF;

  SELECT count(*)::integer
  INTO v_outcome_count
  FROM plugin_data.csf_term_membership_outcomes AS outcome
  WHERE outcome.organization_id = p_organization_id
    AND outcome.term_id = p_term_id
    AND outcome.closure_id = v_closure.id;

  SELECT count(*)::integer
  INTO v_finalized_count
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.term_id = p_term_id
    AND membership.finalized_closure_id = v_closure.id;

  IF v_outcome_count = 0 OR v_outcome_count <> v_finalized_count THEN
    RAISE EXCEPTION 'Semester membership outcome history is incomplete.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_membership_outcomes AS outcome
    JOIN plugin_data.csf_term_memberships AS membership
      ON membership.organization_id = outcome.organization_id
      AND membership.term_id = outcome.term_id
      AND membership.id = outcome.membership_id
    WHERE outcome.organization_id = p_organization_id
      AND outcome.term_id = p_term_id
      AND outcome.closure_id = v_closure.id
      AND (
        membership.finalized_closure_id IS DISTINCT FROM outcome.closure_id
        OR membership.finalized_revision IS DISTINCT FROM outcome.closure_revision
        OR membership.finalized_correlation_id IS DISTINCT FROM outcome.correlation_id
        OR membership.status IS DISTINCT FROM outcome.final_status
        OR membership.status_reason IS DISTINCT FROM outcome.final_status_reason
        OR membership.eligibility_snapshot IS DISTINCT FROM outcome.final_eligibility_snapshot
        OR membership.completed_at IS DISTINCT FROM outcome.final_completed_at
      )
  ) THEN
    RAISE EXCEPTION 'A finalized membership changed after semester close; reconcile it before reopening.';
  END IF;

  v_before := jsonb_build_object(
    'lifecycleStatus', v_term.lifecycle_status,
    'isCurrent', v_term.is_current,
    'activeClosureId', v_term.active_closure_id,
    'latestClosureId', v_term.latest_closure_id,
    'revision', v_term.closure_revision,
    'closedAt', v_term.closed_at,
    'closedBy', v_term.closed_by,
    'policyVersion', v_term.closure_policy_version
  );

  FOR v_outcome IN
    SELECT outcome.*
    FROM plugin_data.csf_term_membership_outcomes AS outcome
    WHERE outcome.organization_id = p_organization_id
      AND outcome.term_id = p_term_id
      AND outcome.closure_id = v_closure.id
    ORDER BY outcome.membership_id
    FOR UPDATE
  LOOP
    UPDATE plugin_data.csf_term_memberships
    SET
      status = v_outcome.prior_status,
      status_reason = v_outcome.prior_status_reason,
      eligibility_snapshot = v_outcome.prior_eligibility_snapshot,
      completed_at = v_outcome.prior_completed_at,
      override_status = v_outcome.prior_override_status,
      override_reason = v_outcome.prior_override_reason,
      overridden_by = v_outcome.prior_overridden_by,
      overridden_at = v_outcome.prior_overridden_at,
      finalized_closure_id = NULL,
      finalized_revision = NULL,
      finalized_correlation_id = NULL,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND term_id = p_term_id
      AND id = v_outcome.membership_id;
    v_restored := v_restored + 1;
  END LOOP;

  v_after := jsonb_build_object(
    'lifecycleStatus', 'open',
    'isCurrent', false,
    'activeClosureId', NULL,
    'latestClosureId', v_term.latest_closure_id,
    'revision', v_term.closure_revision,
    'restoredMembershipCount', v_restored,
    'reasonCode', p_reason_code,
    'reason', v_reason
  );

  INSERT INTO plugin_data.csf_term_reopen_events (
    organization_id, term_id, closure_id, closure_revision,
    reason_code, reason, actor_user_id, correlation_id,
    restored_membership_count, reopened_at, before_state, after_state
  ) VALUES (
    p_organization_id, p_term_id, v_closure.id, v_closure.revision,
    p_reason_code, v_reason, p_actor_user_id, p_correlation_id,
    v_restored, v_now, v_before, v_after
  );

  UPDATE plugin_data.csf_terms
  SET
    lifecycle_status = 'open',
    is_current = false,
    active_closure_id = NULL,
    closed_at = NULL,
    closed_by = NULL,
    closure_policy_version = NULL,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_term_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'term.reopen', 'csf_terms', p_term_id, p_term_id,
    v_before, v_after, p_correlation_id, 'term_closure', v_closure.id::text,
    'semester_reopened_' || p_reason_code
  );

  RETURN jsonb_build_object(
    'termId', p_term_id,
    'closureId', v_closure.id,
    'revision', v_closure.revision,
    'restoredMembershipCount', v_restored,
    'reopenedAt', v_now,
    'correlationId', p_correlation_id,
    'idempotentReplay', false
  );
END;
$$;

ALTER TABLE plugin_data.csf_term_membership_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_term_reopen_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE plugin_data.csf_term_membership_outcomes, plugin_data.csf_term_reopen_events
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_term_membership_outcomes, plugin_data.csf_term_reopen_events
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_reject_semester_history_update()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_close_term(uuid, uuid, integer, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_close_term(uuid, uuid, integer, jsonb, jsonb, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_reopen_term(uuid, uuid, uuid, integer, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reopen_term(uuid, uuid, uuid, integer, text, text, uuid, uuid)
  TO service_role;

COMMENT ON TABLE plugin_data.csf_term_membership_outcomes IS
  'Immutable before-and-after membership outcome for one revisioned CSF semester close.';
COMMENT ON TABLE plugin_data.csf_term_reopen_events IS
  'Immutable adviser-authorized record of a reasoned semester reopen.';
COMMENT ON FUNCTION plugin_data.csf_reopen_term(uuid, uuid, uuid, integer, text, text, uuid, uuid) IS
  'Atomically validates a close revision, restores exact pre-close membership state, keeps the semester non-current, and writes correlated immutable history.';

COMMIT;
