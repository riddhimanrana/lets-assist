-- CSF partner-project linking and attendance-backed point submissions.
--
-- One migration so the two halves can never apply separately (review R10).
--
-- Part 1, linking: a CSF activity may link its own organization's project or
-- a public, published, uncancelled partner project. Linking grants metadata
-- only. The four owner-only activity implementations keep their signatures and
-- V128 wrappers, lock the stored and requested projects first, apply the
-- predicate on create, on a link change, and on publish or restore, clear
-- links for other signup modes, and re-run the attendance backfill when a
-- change makes an enabled activity projectable.
--
-- Part 2, attendance: a verified Let's Assist certificate is the only
-- attendance source. CSF-owned statement triggers on public.certificates
-- project eligible chapter members' certificates into pending point
-- submissions inside the host transaction without ever waiting on a CSF lock.
-- Contention defers the source; the next event or a staff retry replays it.
-- Staff approval through the existing review transaction is the only way to
-- award credit.
--
-- Lock order: the host holds public.projects FOR UPDATE and the publisher's
-- organization_members row FOR UPDATE before these triggers run. Service
-- wrappers lock the project before the staff-access lock and member row. The
-- projection takes the current semester lock, then profile, term,
-- membership, policy, opportunity, and account (FOR SHARE), then the
-- submission FOR UPDATE, then evidence rows.

BEGIN;

-- ===========================================================================
-- Part 2 objects first: tables and helpers the linking implementations call.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. Opt-in column
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_opportunities
  ADD COLUMN attendance_submission_mode text NOT NULL DEFAULT 'off',
  ADD CONSTRAINT csf_opportunities_attendance_submission_mode_check
    CHECK (attendance_submission_mode IN ('off', 'pending_submission'));

CREATE INDEX csf_opportunities_attendance_project_idx
  ON plugin_data.csf_opportunities (linked_project_id, organization_id)
  WHERE attendance_submission_mode = 'pending_submission'
    AND linked_project_id IS NOT NULL;

COMMENT ON COLUMN plugin_data.csf_opportunities.attendance_submission_mode IS
  'off, or pending_submission: verified Let''s Assist attendance creates pending point submissions that staff still review. Set only by csf_set_activity_attendance_submissions.';

-- ---------------------------------------------------------------------------
-- B. Evidence and outcomes
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_attendance_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  term_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  user_id uuid NOT NULL,
  certificate_id uuid NOT NULL,
  signup_id uuid NOT NULL,
  project_id uuid NOT NULL,
  schedule_id text NOT NULL,
  publish_key text,
  event_start timestamptz NOT NULL,
  event_end timestamptz NOT NULL,
  verified_minutes integer NOT NULL,
  matched_shift_key text,
  identity_origin text NOT NULL,
  source_revision text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  invalidated_at timestamptz,
  invalidation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_attendance_evidence_opportunity_fkey
    FOREIGN KEY (opportunity_id, organization_id)
    REFERENCES plugin_data.csf_opportunities(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_attendance_evidence_term_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_attendance_evidence_submission_fkey
    FOREIGN KEY (submission_id, organization_id)
    REFERENCES plugin_data.csf_point_submissions(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT csf_attendance_evidence_minutes_check CHECK (verified_minutes > 0),
  CONSTRAINT csf_attendance_evidence_window_check CHECK (event_end > event_start),
  CONSTRAINT csf_attendance_evidence_identity_origin_check
    CHECK (identity_origin IN ('account', 'guest_claim')),
  CONSTRAINT csf_attendance_evidence_revision_check
    CHECK (source_revision ~ '^[0-9a-f]{64}$'),
  CONSTRAINT csf_attendance_evidence_shift_key_check
    CHECK (matched_shift_key IS NULL OR matched_shift_key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  CONSTRAINT csf_attendance_evidence_state_check
    CHECK (state IN ('active', 'stale')),
  CONSTRAINT csf_attendance_evidence_reason_check CHECK (
    invalidation_reason IS NULL OR invalidation_reason IN (
      'certificate_removed', 'source_changed', 'account_revoked',
      'membership_inactive', 'activity_relinked', 'activity_unavailable',
      'attendance_disabled', 'project_unavailable'
    )
  ),
  CONSTRAINT csf_attendance_evidence_state_shape CHECK (
    (state = 'active' AND invalidated_at IS NULL AND invalidation_reason IS NULL)
    OR (state = 'stale' AND invalidated_at IS NOT NULL AND invalidation_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX csf_attendance_evidence_one_active_certificate_idx
  ON plugin_data.csf_attendance_evidence (organization_id, certificate_id)
  WHERE state = 'active';
CREATE INDEX csf_attendance_evidence_certificate_idx
  ON plugin_data.csf_attendance_evidence (certificate_id, organization_id);
CREATE INDEX csf_attendance_evidence_submission_idx
  ON plugin_data.csf_attendance_evidence (submission_id, organization_id);
CREATE INDEX csf_attendance_evidence_opportunity_idx
  ON plugin_data.csf_attendance_evidence (opportunity_id, organization_id, state);
CREATE INDEX csf_attendance_evidence_term_idx
  ON plugin_data.csf_attendance_evidence (term_id, organization_id);
CREATE INDEX csf_attendance_evidence_project_idx
  ON plugin_data.csf_attendance_evidence (project_id, organization_id)
  WHERE state = 'active';
CREATE INDEX csf_attendance_evidence_user_idx
  ON plugin_data.csf_attendance_evidence (organization_id, user_id)
  WHERE state = 'active';

ALTER TABLE plugin_data.csf_attendance_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_attendance_evidence FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE plugin_data.csf_attendance_evidence TO service_role;

COMMENT ON TABLE plugin_data.csf_attendance_evidence IS
  'Immutable snapshot of one verified Let''s Assist certificate attached to a CSF point submission. The projection never deletes rows; state moves active -> stale. Rows follow their submission when it is deleted (V132 Unsubmit, retention).';

CREATE TABLE plugin_data.csf_attendance_projection_outcomes (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  certificate_id uuid NOT NULL,
  project_id uuid,
  opportunity_id uuid,
  submission_id uuid,
  evidence_id uuid,
  outcome text NOT NULL,
  sqlstate text,
  attempt_count integer NOT NULL DEFAULT 1,
  first_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  source_revision text,
  PRIMARY KEY (organization_id, certificate_id),
  CONSTRAINT csf_attendance_outcomes_opportunity_fkey
    FOREIGN KEY (opportunity_id, organization_id)
    REFERENCES plugin_data.csf_opportunities(id, organization_id)
    ON DELETE SET NULL (opportunity_id),
  CONSTRAINT csf_attendance_outcomes_submission_fkey
    FOREIGN KEY (submission_id, organization_id)
    REFERENCES plugin_data.csf_point_submissions(id, organization_id)
    ON DELETE SET NULL (submission_id),
  CONSTRAINT csf_attendance_outcomes_outcome_check CHECK (outcome IN (
    'projected', 'attached', 'prior_decision', 'not_member', 'not_eligible',
    'term_closed', 'project_unavailable', 'rule_not_derivable', 'capped',
    'failed', 'stale', 'released'
  )),
  CONSTRAINT csf_attendance_outcomes_sqlstate_check
    CHECK (sqlstate IS NULL OR sqlstate ~ '^[0-9A-Z]{5}$'),
  CONSTRAINT csf_attendance_outcomes_failure_shape
    CHECK ((outcome = 'failed') = (sqlstate IS NOT NULL)),
  CONSTRAINT csf_attendance_outcomes_attempt_check CHECK (attempt_count >= 1),
  CONSTRAINT csf_attendance_outcomes_revision_check
    CHECK (source_revision IS NULL OR source_revision ~ '^[0-9a-f]{64}$')
);

CREATE INDEX csf_attendance_outcomes_opportunity_idx
  ON plugin_data.csf_attendance_projection_outcomes (opportunity_id, organization_id, outcome);
CREATE INDEX csf_attendance_outcomes_project_idx
  ON plugin_data.csf_attendance_projection_outcomes (organization_id, project_id, outcome);
CREATE INDEX csf_attendance_outcomes_submission_idx
  ON plugin_data.csf_attendance_projection_outcomes (submission_id, organization_id)
  WHERE submission_id IS NOT NULL;

ALTER TABLE plugin_data.csf_attendance_projection_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_attendance_projection_outcomes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE plugin_data.csf_attendance_projection_outcomes TO service_role;

COMMENT ON TABLE plugin_data.csf_attendance_projection_outcomes IS
  'Latest projection outcome per chapter and certificate. Failed rows carry only a SQLSTATE. Only certificates of accounts verified in the chapter are recorded.';

-- Transition receipts for projection audits and the two service wrappers.
CREATE UNIQUE INDEX csf_admin_audit_events_attendance_projection_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE source_type = 'attendance_projection';
CREATE UNIQUE INDEX csf_admin_audit_events_attendance_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE action IN (
    'activity.attendance_submissions_set',
    'activity.attendance_sync_retried'
  );

-- Retention (V124/V132 companions): evidence follows its submission; the
-- identity-free outcome ledger keeps only a cleared submission link.
INSERT INTO plugin_data.csf_retention_reference_policy (parent_table, child_table, child_column, policy, note)
VALUES
  ('csf_point_submissions', 'csf_attendance_evidence', 'submission_id', 'delete_with_owner',
   'Organizer attendance evidence follows its submission.'),
  ('csf_point_submissions', 'csf_attendance_projection_outcomes', 'submission_id', 'retain_immutable',
   'Identity-free projection outcome; the submission link is cleared when the claim is deleted.');

-- ---------------------------------------------------------------------------
-- C. Evidence immutability and the Unsubmit decline marker (C6)
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_release_attendance_evidence_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only referential cascades (submission, activity, semester, or
    -- organization removal) may delete evidence. A direct delete is refused.
    IF pg_catalog.pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'CSF attendance evidence is retained; mark it stale instead.'
        USING ERRCODE = '55000';
    END IF;
    -- C6: when the claim itself was deleted (member Unsubmit or retention),
    -- keep an identity-free marker so the certificate is never projected
    -- again. Skipped while the organization itself is being removed.
    IF NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_point_submissions AS submission
        WHERE submission.id = OLD.submission_id
      )
      AND EXISTS (
        SELECT 1 FROM public.organizations AS organization
        WHERE organization.id = OLD.organization_id
      ) THEN
      INSERT INTO plugin_data.csf_attendance_projection_outcomes AS outcome (
        organization_id, certificate_id, project_id, outcome, source_revision
      ) VALUES (
        OLD.organization_id, OLD.certificate_id, OLD.project_id, 'released', OLD.source_revision
      )
      ON CONFLICT (organization_id, certificate_id) DO UPDATE
      SET outcome = 'released',
          sqlstate = NULL,
          submission_id = NULL,
          evidence_id = NULL,
          attempt_count = outcome.attempt_count + 1,
          last_attempt_at = pg_catalog.now();
    END IF;
    RETURN OLD;
  END IF;

  IF ROW(NEW.id, NEW.organization_id, NEW.opportunity_id, NEW.term_id, NEW.submission_id,
      NEW.user_id, NEW.certificate_id, NEW.signup_id, NEW.project_id, NEW.schedule_id,
      NEW.publish_key, NEW.event_start, NEW.event_end, NEW.verified_minutes,
      NEW.matched_shift_key, NEW.identity_origin, NEW.source_revision, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.organization_id, OLD.opportunity_id, OLD.term_id,
      OLD.submission_id, OLD.user_id, OLD.certificate_id, OLD.signup_id, OLD.project_id,
      OLD.schedule_id, OLD.publish_key, OLD.event_start, OLD.event_end, OLD.verified_minutes,
      OLD.matched_shift_key, OLD.identity_origin, OLD.source_revision, OLD.created_at) THEN
    RAISE EXCEPTION 'CSF attendance evidence snapshots are immutable.'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.state <> 'active' AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'Invalidated CSF attendance evidence cannot be reactivated.'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.state <> 'active'
    AND ROW(NEW.invalidated_at, NEW.invalidation_reason)
      IS DISTINCT FROM ROW(OLD.invalidated_at, OLD.invalidation_reason) THEN
    RAISE EXCEPTION 'CSF attendance evidence invalidation is immutable.'
      USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_attendance_evidence_guard
  BEFORE UPDATE OR DELETE ON plugin_data.csf_attendance_evidence
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_release_attendance_evidence_on_delete();

-- ---------------------------------------------------------------------------
-- D. Pure helpers
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_attendance_source_revision(
  p_certificate_id uuid,
  p_signup_id uuid,
  p_project_id uuid,
  p_publish_key text,
  p_user_id uuid,
  p_event_start timestamptz,
  p_event_end timestamptz
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.concat_ws(
          '|',
          'csf-attendance-source:v1',
          p_certificate_id::text,
          coalesce(p_signup_id::text, ''),
          coalesce(p_project_id::text, ''),
          coalesce(p_publish_key, ''),
          coalesce(p_user_id::text, ''),
          coalesce(pg_catalog.to_char(p_event_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
          coalesce(pg_catalog.to_char(p_event_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE FUNCTION plugin_data.csf_attendance_correlation_id(p_parts text[])
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.md5('csf-attendance-projection:v1|' || pg_catalog.array_to_string(p_parts, '|'))::uuid;
$$;

-- Scheduled window of one host slot, as wall time in the project time zone.
CREATE FUNCTION plugin_data.csf_attendance_slot_window(
  p_event_type text,
  p_schedule jsonb,
  p_timezone text,
  p_publish_key text
)
RETURNS tstzrange
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_zone text := coalesce(nullif(pg_catalog.btrim(coalesce(p_timezone, '')), ''), 'America/Los_Angeles');
  v_date text;
  v_start text;
  v_end text;
  v_start_at timestamptz;
  v_end_at timestamptz;
BEGIN
  IF p_publish_key IS NULL OR p_schedule IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_event_type = 'oneTime' AND p_publish_key = 'oneTime' THEN
    v_date := p_schedule -> 'oneTime' ->> 'date';
    v_start := p_schedule -> 'oneTime' ->> 'startTime';
    v_end := p_schedule -> 'oneTime' ->> 'endTime';
  ELSIF p_event_type = 'multiDay'
    AND pg_catalog.jsonb_typeof(p_schedule -> 'multiDay') = 'array' THEN
    SELECT day_item.value ->> 'date', slot_item.value ->> 'startTime', slot_item.value ->> 'endTime'
    INTO v_date, v_start, v_end
    FROM pg_catalog.jsonb_array_elements(p_schedule -> 'multiDay') AS day_item(value)
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(day_item.value -> 'slots') = 'array'
        THEN day_item.value -> 'slots' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS slot_item(value, ordinal)
    WHERE pg_catalog.format('%s-%s', day_item.value ->> 'date', slot_item.ordinal - 1) = p_publish_key
    LIMIT 1;
  ELSIF p_event_type = 'sameDayMultiArea'
    AND pg_catalog.jsonb_typeof(p_schedule -> 'sameDayMultiArea' -> 'roles') = 'array' THEN
    v_date := p_schedule -> 'sameDayMultiArea' ->> 'date';
    SELECT role_item.value ->> 'startTime', role_item.value ->> 'endTime'
    INTO v_start, v_end
    FROM pg_catalog.jsonb_array_elements(p_schedule -> 'sameDayMultiArea' -> 'roles') AS role_item(value)
    WHERE role_item.value ->> 'name' = p_publish_key
    LIMIT 1;
  ELSE
    RETURN NULL;
  END IF;

  IF v_date !~ '^\d{4}-\d{2}-\d{2}$' OR v_start !~ '^\d{1,2}:\d{2}$' OR v_end !~ '^\d{1,2}:\d{2}$' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_start_at := pg_catalog.timezone(v_zone, (v_date || ' ' || v_start)::timestamp);
    v_end_at := pg_catalog.timezone(v_zone, (v_date || ' ' || v_end)::timestamp);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF v_end_at <= v_start_at THEN
    v_end_at := v_end_at + interval '1 day';
  END IF;
  RETURN pg_catalog.tstzrange(v_start_at, v_end_at, '[]');
END;
$$;

-- The one shift component whose window contains the slot window, or NULL.
CREATE FUNCTION plugin_data.csf_attendance_shift_key(p_rules jsonb, p_window tstzrange)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN pg_catalog.count(*) = 1 THEN pg_catalog.min(component.value ->> 'key') END
  FROM pg_catalog.jsonb_array_elements(
    CASE WHEN pg_catalog.jsonb_typeof(p_rules -> 'components') = 'array'
      THEN p_rules -> 'components' ELSE '[]'::jsonb END
  ) AS component(value)
  WHERE p_window IS NOT NULL
    AND p_rules ->> 'mode' = 'shifts'
    AND component.value ->> 'kind' = 'shift'
    AND nullif(component.value ->> 'startsAt', '') IS NOT NULL
    AND nullif(component.value ->> 'endsAt', '') IS NOT NULL
    AND (component.value ->> 'startsAt')::timestamptz <= pg_catalog.lower(p_window)
    AND (component.value ->> 'endsAt')::timestamptz >= pg_catalog.upper(p_window);
$$;

-- Whether one active evidence row still describes a current verified source
-- the chapter may use. Plain reads; callers hold the semester lock.
CREATE FUNCTION plugin_data.csf_attendance_evidence_is_current(
  p_evidence plugin_data.csf_attendance_evidence
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_evidence.state = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.certificates AS certificate
      WHERE certificate.id = p_evidence.certificate_id
        AND certificate.type = 'verified'
        AND certificate.user_id = p_evidence.user_id
        AND certificate.project_id = p_evidence.project_id
        AND certificate.signup_id = p_evidence.signup_id
    )
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      JOIN plugin_data.csf_profiles AS profile
        ON profile.organization_id = account.organization_id
       AND profile.id = account.profile_id
       AND profile.record_status = 'active'
      WHERE account.organization_id = p_evidence.organization_id
        AND account.user_id = p_evidence.user_id
        AND account.status = 'verified'
    )
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_opportunities AS activity
      WHERE activity.organization_id = p_evidence.organization_id
        AND activity.id = p_evidence.opportunity_id
        AND activity.linked_project_id = p_evidence.project_id
        AND activity.attendance_submission_mode = 'pending_submission'
        AND activity.status IN ('published', 'closed')
    );
$$;

CREATE FUNCTION plugin_data.csf_attendance_claim_valid_evidence(
  p_organization_id uuid,
  p_submission_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.count(*)::integer
  FROM plugin_data.csf_attendance_evidence AS evidence
  WHERE evidence.organization_id = p_organization_id
    AND evidence.submission_id = p_submission_id
    AND evidence.state = 'active'
    AND plugin_data.csf_attendance_evidence_is_current(evidence);
$$;

-- ---------------------------------------------------------------------------
-- E. Invalidation (evidence rows only; claims settle under the semester lock)
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_invalidate_attendance_evidence(
  p_organization_id uuid,
  p_evidence_ids uuid[],
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_reason IS NULL THEN
    RAISE EXCEPTION 'A stale evidence reason is required.';
  END IF;
  IF p_evidence_ids IS NULL OR pg_catalog.cardinality(p_evidence_ids) = 0 THEN
    RETURN 0;
  END IF;
  WITH locked AS (
    SELECT evidence.id
    FROM plugin_data.csf_attendance_evidence AS evidence
    WHERE evidence.organization_id = p_organization_id
      AND evidence.id = ANY (p_evidence_ids)
      AND evidence.state = 'active'
    ORDER BY evidence.id
    FOR UPDATE
  )
  UPDATE plugin_data.csf_attendance_evidence AS evidence
  SET state = 'stale',
      invalidated_at = pg_catalog.now(),
      invalidation_reason = p_reason
  FROM locked
  WHERE evidence.id = locked.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE plugin_data.csf_attendance_projection_outcomes AS outcome
  SET outcome = 'stale',
      sqlstate = NULL,
      attempt_count = outcome.attempt_count + 1,
      last_attempt_at = pg_catalog.now()
  FROM plugin_data.csf_attendance_evidence AS evidence
  WHERE evidence.organization_id = p_organization_id
    AND evidence.id = ANY (p_evidence_ids)
    AND evidence.state = 'stale'
    AND outcome.organization_id = evidence.organization_id
    AND outcome.certificate_id = evidence.certificate_id
    AND outcome.evidence_id = evidence.id;
  RETURN v_count;
END;
$$;

CREATE FUNCTION plugin_data.csf_invalidate_activity_attendance_evidence(
  p_organization_id uuid,
  p_opportunity_id uuid,
  p_reason text,
  p_keep_project_id uuid
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT plugin_data.csf_invalidate_attendance_evidence(
    p_organization_id,
    ARRAY(
      SELECT evidence.id
      FROM plugin_data.csf_attendance_evidence AS evidence
      WHERE evidence.organization_id = p_organization_id
        AND evidence.opportunity_id = p_opportunity_id
        AND evidence.state = 'active'
        AND evidence.project_id IS DISTINCT FROM p_keep_project_id
      ORDER BY evidence.id
    ),
    p_reason
  );
$$;

-- C4: account revocation and inactive membership mark evidence only.
CREATE FUNCTION plugin_data.csf_stale_attendance_evidence_for_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'verified'
    AND (TG_OP = 'DELETE' OR NEW.status IS DISTINCT FROM 'verified'
      OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    PERFORM plugin_data.csf_invalidate_attendance_evidence(
      OLD.organization_id,
      ARRAY(
        SELECT evidence.id
        FROM plugin_data.csf_attendance_evidence AS evidence
        WHERE evidence.organization_id = OLD.organization_id
          AND evidence.user_id = OLD.user_id
          AND evidence.state = 'active'
        ORDER BY evidence.id
      ),
      'account_revoked'
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER csf_attendance_account_staleness
  AFTER UPDATE OR DELETE ON plugin_data.csf_profile_accounts
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_stale_attendance_evidence_for_account();

CREATE FUNCTION plugin_data.csf_stale_attendance_evidence_for_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IN ('accepted', 'active')
    AND (TG_OP = 'DELETE' OR NEW.status NOT IN ('accepted', 'active')
      OR NEW.cohort_id IS DISTINCT FROM OLD.cohort_id) THEN
    PERFORM plugin_data.csf_invalidate_attendance_evidence(
      OLD.organization_id,
      ARRAY(
        SELECT evidence.id
        FROM plugin_data.csf_attendance_evidence AS evidence
        JOIN plugin_data.csf_point_submissions AS submission
          ON submission.organization_id = evidence.organization_id
         AND submission.id = evidence.submission_id
        WHERE evidence.organization_id = OLD.organization_id
          AND evidence.term_id = OLD.term_id
          AND evidence.state = 'active'
          AND submission.profile_id = OLD.profile_id
        ORDER BY evidence.id
      ),
      'membership_inactive'
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER csf_attendance_membership_staleness
  AFTER UPDATE OR DELETE ON plugin_data.csf_term_memberships
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_stale_attendance_evidence_for_membership();

-- ---------------------------------------------------------------------------
-- F. Claim settlement (caller holds the semester lock)
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_attendance_claim_is_system_only(
  p_submission plugin_data.csf_point_submissions
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_submission.source = 'attendance'
    AND p_submission.status = 'submitted'
    AND p_submission.submitted_by IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM plugin_data.csf_submission_reviews AS review
      WHERE review.organization_id = p_submission.organization_id
        AND review.submission_id = p_submission.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_submission.organization_id
        AND proof.submission_id = p_submission.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM plugin_data.csf_submission_edit_requests AS edit
      WHERE edit.organization_id = p_submission.organization_id
        AND edit.submission_id = p_submission.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM plugin_data.csf_point_appeals AS appeal
      WHERE appeal.organization_id = p_submission.organization_id
        AND appeal.submission_id = p_submission.id
    );
$$;

-- Proposed points for a claim from its active evidence, under its own rules
-- snapshot, after caps. Returns NULL points when attendance cannot supply a
-- selection or nothing remains under the caps.
CREATE FUNCTION plugin_data.csf_attendance_claim_calculation(
  p_organization_id uuid,
  p_profile_id uuid,
  p_opportunity_id uuid,
  p_submission_id uuid,
  p_rules jsonb,
  p_keys text[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_activity plugin_data.csf_opportunities%ROWTYPE;
  v_policy_max numeric;
  v_person_cap numeric;
  v_verified numeric;
  v_selection jsonb;
  v_calculation jsonb;
  v_ceiling numeric;
  v_points numeric;
  v_keys text[];
BEGIN
  SELECT activity.* INTO v_activity
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_opportunity_id;
  IF NOT FOUND OR p_rules IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'rule_not_derivable');
  END IF;

  IF p_rules ->> 'mode' = 'fixed' THEN
    v_selection := plugin_data.csf_default_earning_selection(p_rules);
  ELSIF p_rules ->> 'mode' = 'shifts' THEN
    SELECT pg_catalog.array_agg(DISTINCT key ORDER BY key)
    INTO v_keys
    FROM pg_catalog.unnest(p_keys) AS key
    WHERE key IS NOT NULL;
    IF coalesce(pg_catalog.cardinality(v_keys), 0) = 0 THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'rule_not_derivable');
    END IF;
    IF coalesce((p_rules -> 'shiftPolicy' ->> 'allowMultiple')::boolean, false) = false THEN
      v_keys := ARRAY[p_keys[1]];
    END IF;
    SELECT pg_catalog.jsonb_build_object(
      'version', 1,
      'items', pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', key) ORDER BY key)
    )
    INTO v_selection
    FROM pg_catalog.unnest(v_keys) AS key;
  ELSE
    RETURN pg_catalog.jsonb_build_object('outcome', 'rule_not_derivable');
  END IF;
  IF v_selection IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'rule_not_derivable');
  END IF;

  BEGIN
    v_calculation := plugin_data.csf_calculate_earning(p_rules, v_selection);
  EXCEPTION WHEN OTHERS THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'rule_not_derivable');
  END;
  IF (v_calculation ->> 'assessment')::boolean IS TRUE
    OR (v_calculation ->> 'pointType') NOT IN ('non_drive', 'drive') THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'rule_not_derivable');
  END IF;

  SELECT policy.max_points_per_activity INTO v_policy_max
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = v_activity.term_id
    AND policy.published_at IS NOT NULL;
  IF v_policy_max IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'not_eligible');
  END IF;
  v_person_cap := least(coalesce(v_activity.point_cap, v_policy_max), v_policy_max);
  SELECT coalesce(pg_catalog.sum(credit.points), 0) INTO v_verified
  FROM plugin_data.csf_credit_records AS credit
  WHERE credit.organization_id = p_organization_id
    AND credit.profile_id = p_profile_id
    AND credit.opportunity_id = p_opportunity_id
    AND credit.status = 'verified'
    AND credit.submission_id IS DISTINCT FROM p_submission_id;

  v_points := (v_calculation ->> 'points')::numeric;
  IF (p_rules -> 'legacy') IS DISTINCT FROM 'true'::jsonb THEN
    BEGIN
      v_ceiling := (plugin_data.csf_normalize_earning_rules(p_rules) ->> 'ceilingPoints')::numeric;
      v_points := least(v_points, v_ceiling);
    EXCEPTION WHEN OTHERS THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'rule_not_derivable');
    END;
  END IF;
  v_points := pg_catalog.round(least(v_points, v_policy_max, v_person_cap - v_verified), 2);
  IF v_points IS NULL OR v_points <= 0 THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'capped');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'ok',
    'points', v_points,
    'pointType', v_calculation ->> 'pointType',
    'selection', v_selection,
    'calculatedPoints', (v_calculation ->> 'points')::numeric
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_settle_attendance_claim(
  p_organization_id uuid,
  p_submission_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_keys text[];
  v_active integer;
  v_calculation jsonb;
  v_first_date date;
  v_correlation uuid;
BEGIN
  SELECT submission.* INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;
  IF NOT plugin_data.csf_attendance_claim_is_system_only(v_submission) THEN
    RETURN 'unchanged';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id AND term.id = v_submission.term_id
      AND term.is_current AND term.lifecycle_status = 'open'
  ) THEN
    RETURN 'unchanged';
  END IF;

  SELECT pg_catalog.count(*)::integer,
    pg_catalog.array_agg(evidence.matched_shift_key ORDER BY evidence.event_start, evidence.id)
      FILTER (WHERE evidence.matched_shift_key IS NOT NULL),
    pg_catalog.min(pg_catalog.timezone('America/Los_Angeles', evidence.event_start)::date)
  INTO v_active, v_keys, v_first_date
  FROM plugin_data.csf_attendance_evidence AS evidence
  WHERE evidence.organization_id = p_organization_id
    AND evidence.submission_id = p_submission_id
    AND evidence.state = 'active';

  IF v_active = 0 THEN
    UPDATE plugin_data.csf_point_submissions
    SET status = 'withdrawn', updated_at = pg_catalog.now()
    WHERE organization_id = p_organization_id AND id = p_submission_id;
    INSERT INTO plugin_data.csf_submission_reviews (
      organization_id, submission_id, actor_user_id, action,
      previous_status, next_status, notes, details
    ) VALUES (
      p_organization_id, p_submission_id, NULL, 'source_withdrawn',
      'submitted', 'withdrawn', NULL,
      pg_catalog.jsonb_build_object('source', 'attendance_projection')
    );
    v_correlation := plugin_data.csf_attendance_correlation_id(ARRAY[
      p_organization_id::text, p_submission_id::text, 'withdrawn'
    ]);
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id, term_id,
      before_data, after_data, correlation_id, source_type, source_id, reason_code
    ) VALUES (
      p_organization_id, NULL, 'point_submission.attendance_withdrawn',
      'csf_point_submissions', p_submission_id, v_submission.term_id,
      pg_catalog.jsonb_build_object('status', 'submitted', 'claimedPoints', v_submission.claimed_points),
      pg_catalog.jsonb_build_object('status', 'withdrawn'),
      v_correlation, 'attendance_projection', p_submission_id::text, 'attendance_source_removed'
    )
    ON CONFLICT (organization_id, correlation_id) WHERE source_type = 'attendance_projection'
    DO NOTHING;
    RETURN 'withdrawn';
  END IF;

  v_calculation := plugin_data.csf_attendance_claim_calculation(
    p_organization_id, v_submission.profile_id, v_submission.opportunity_id,
    v_submission.id, v_submission.earning_rules_snapshot, v_keys
  );
  IF v_calculation ->> 'outcome' <> 'ok' THEN
    RETURN v_calculation ->> 'outcome';
  END IF;
  IF (v_calculation ->> 'points')::numeric IS NOT DISTINCT FROM v_submission.claimed_points
    AND (v_calculation -> 'selection') IS NOT DISTINCT FROM v_submission.earning_selection
    AND v_first_date IS NOT DISTINCT FROM v_submission.activity_date THEN
    RETURN 'unchanged';
  END IF;

  UPDATE plugin_data.csf_point_submissions
  SET claimed_points = (v_calculation ->> 'points')::numeric,
      suggested_points = (v_calculation ->> 'points')::numeric,
      earning_selection = v_calculation -> 'selection',
      activity_date = v_first_date,
      updated_at = pg_catalog.now()
  WHERE organization_id = p_organization_id AND id = p_submission_id;
  v_correlation := plugin_data.csf_attendance_correlation_id(ARRAY[
    p_organization_id::text, p_submission_id::text, 'recomputed',
    (v_submission.revision + 1)::text
  ]);
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, NULL, 'point_submission.attendance_recomputed',
    'csf_point_submissions', p_submission_id, v_submission.term_id,
    pg_catalog.jsonb_build_object('claimedPoints', v_submission.claimed_points,
      'selection', v_submission.earning_selection),
    pg_catalog.jsonb_build_object('claimedPoints', (v_calculation ->> 'points')::numeric,
      'selection', v_calculation -> 'selection', 'activeEvidence', v_active),
    v_correlation, 'attendance_projection', p_submission_id::text, 'attendance_evidence_changed'
  )
  ON CONFLICT (organization_id, correlation_id) WHERE source_type = 'attendance_projection'
  DO NOTHING;
  RETURN 'recomputed';
END;
$$;

-- ---------------------------------------------------------------------------
-- G. Outcome recording
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_record_attendance_outcome(
  p_organization_id uuid,
  p_certificate_id uuid,
  p_project_id uuid,
  p_opportunity_id uuid,
  p_submission_id uuid,
  p_evidence_id uuid,
  p_outcome text,
  p_sqlstate text,
  p_source_revision text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO plugin_data.csf_attendance_projection_outcomes AS outcome (
    organization_id, certificate_id, project_id, opportunity_id, submission_id,
    evidence_id, outcome, sqlstate, source_revision
  ) VALUES (
    p_organization_id, p_certificate_id, p_project_id, p_opportunity_id,
    p_submission_id, p_evidence_id, p_outcome, p_sqlstate, p_source_revision
  )
  ON CONFLICT (organization_id, certificate_id) DO UPDATE
  SET project_id = coalesce(EXCLUDED.project_id, outcome.project_id),
      opportunity_id = coalesce(EXCLUDED.opportunity_id, outcome.opportunity_id),
      submission_id = coalesce(EXCLUDED.submission_id, outcome.submission_id),
      evidence_id = coalesce(EXCLUDED.evidence_id, outcome.evidence_id),
      outcome = EXCLUDED.outcome,
      sqlstate = EXCLUDED.sqlstate,
      source_revision = coalesce(EXCLUDED.source_revision, outcome.source_revision),
      attempt_count = outcome.attempt_count + 1,
      last_attempt_at = pg_catalog.now()
  WHERE (outcome.outcome, outcome.sqlstate, outcome.opportunity_id,
      outcome.submission_id, outcome.evidence_id, outcome.source_revision)
    IS DISTINCT FROM (EXCLUDED.outcome, EXCLUDED.sqlstate,
      coalesce(EXCLUDED.opportunity_id, outcome.opportunity_id),
      coalesce(EXCLUDED.submission_id, outcome.submission_id),
      coalesce(EXCLUDED.evidence_id, outcome.evidence_id),
      coalesce(EXCLUDED.source_revision, outcome.source_revision))
    OR EXCLUDED.outcome = 'failed';
$$;

CREATE FUNCTION plugin_data.csf_record_attendance_failure(
  p_organization_id uuid,
  p_project_id uuid,
  p_certificate_ids uuid[],
  p_sqlstate text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_certificate_id uuid;
BEGIN
  BEGIN
    FOR v_certificate_id IN
      SELECT certificate.id
      FROM public.certificates AS certificate
      JOIN plugin_data.csf_profile_accounts AS account
        ON account.organization_id = p_organization_id
       AND account.user_id = certificate.user_id
       AND account.status = 'verified'
      WHERE certificate.project_id = p_project_id
        AND certificate.type = 'verified'
        AND (p_certificate_ids IS NULL OR certificate.id = ANY (p_certificate_ids))
      ORDER BY certificate.id
      LIMIT 2000
    LOOP
      PERFORM plugin_data.csf_record_attendance_outcome(
        p_organization_id, v_certificate_id, p_project_id, NULL, NULL, NULL,
        'failed', coalesce(nullif(p_sqlstate, ''), 'XX000'), NULL
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Recording a failure must never fail the host transaction.
    NULL;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- H. Projection core
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_project_attendance_sources(
  p_organization_id uuid,
  p_project_id uuid,
  p_certificate_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_project_found boolean;
  v_linkable boolean;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_has_term boolean := false;
  v_counts jsonb := '{}'::jsonb;
  v_evidence record;
  v_source record;
  v_activity plugin_data.csf_opportunities%ROWTYPE;
  v_membership plugin_data.csf_term_memberships%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_rules jsonb;
  v_publish_key text;
  v_window tstzrange;
  v_key text;
  v_revision text;
  v_outcome text;
  v_evidence_id uuid;
  v_submission_id uuid;
  v_calculation jsonb;
  v_settle text;
  v_affected_claims uuid[] := ARRAY[]::uuid[];
  v_stale_ids uuid[];
  v_reason text;
  v_origin text;
  v_claim_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_project_id IS NULL THEN
    RAISE EXCEPTION 'Organization and project are required.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_plugin_access AS access
    WHERE access.organization_id = p_organization_id
      AND access.plugin_key = 'dvhs-csf'
      AND access.enabled
      AND access.is_accessible
  ) THEN
    RETURN pg_catalog.jsonb_build_object('skipped', 'plugin_unavailable');
  END IF;

  SELECT project.* INTO v_project
  FROM public.projects AS project
  WHERE project.id = p_project_id;
  v_project_found := FOUND;
  v_linkable := v_project_found AND (
    v_project.organization_id = p_organization_id
    OR plugin_data.csf_project_is_linkable(p_organization_id, p_project_id)
  );

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.is_current
    AND term.lifecycle_status = 'open'
  ORDER BY term.id
  LIMIT 1;
  v_has_term := FOUND;
  IF v_has_term THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      p_organization_id::text || ':' || v_term.id::text,
      0
    ));
  END IF;

  -- 1. Invalidate evidence whose source or activity no longer qualifies.
  FOR v_reason IN SELECT unnest(ARRAY[
    'certificate_removed', 'project_unavailable', 'activity_relinked',
    'activity_unavailable', 'attendance_disabled', 'account_revoked'
  ]) LOOP
    SELECT pg_catalog.array_agg(evidence.id ORDER BY evidence.id)
    INTO v_stale_ids
    FROM plugin_data.csf_attendance_evidence AS evidence
    LEFT JOIN plugin_data.csf_opportunities AS activity
      ON activity.organization_id = evidence.organization_id
     AND activity.id = evidence.opportunity_id
    WHERE evidence.organization_id = p_organization_id
      AND evidence.state = 'active'
      AND (evidence.project_id = p_project_id
        OR evidence.certificate_id = ANY (coalesce(p_certificate_ids, ARRAY[]::uuid[])))
      AND CASE v_reason
        WHEN 'certificate_removed' THEN NOT EXISTS (
          SELECT 1 FROM public.certificates AS certificate
          WHERE certificate.id = evidence.certificate_id
            AND certificate.type = 'verified'
            AND certificate.user_id = evidence.user_id
            AND certificate.project_id = evidence.project_id
            AND certificate.signup_id = evidence.signup_id
        )
        WHEN 'project_unavailable' THEN NOT v_linkable AND evidence.project_id = p_project_id
        WHEN 'activity_relinked' THEN activity.linked_project_id IS DISTINCT FROM evidence.project_id
        WHEN 'activity_unavailable' THEN activity.status NOT IN ('published', 'closed')
        WHEN 'attendance_disabled' THEN activity.attendance_submission_mode <> 'pending_submission'
        WHEN 'account_revoked' THEN NOT EXISTS (
          SELECT 1 FROM plugin_data.csf_profile_accounts AS account
          WHERE account.organization_id = evidence.organization_id
            AND account.user_id = evidence.user_id
            AND account.status = 'verified'
        )
        ELSE false
      END;
    IF v_stale_ids IS NOT NULL THEN
      SELECT pg_catalog.array_agg(DISTINCT evidence.submission_id) || v_affected_claims
      INTO v_affected_claims
      FROM plugin_data.csf_attendance_evidence AS evidence
      WHERE evidence.id = ANY (v_stale_ids) AND evidence.submission_id IS NOT NULL;
      -- Lock the claims before their evidence (submission, then evidence).
      PERFORM 1 FROM plugin_data.csf_point_submissions AS submission
      WHERE submission.organization_id = p_organization_id
        AND submission.id = ANY (v_affected_claims)
      ORDER BY submission.id
      FOR UPDATE;
      PERFORM plugin_data.csf_invalidate_attendance_evidence(p_organization_id, v_stale_ids, v_reason);
      v_counts := v_counts || pg_catalog.jsonb_build_object(
        'stale', coalesce((v_counts ->> 'stale')::integer, 0) + pg_catalog.cardinality(v_stale_ids)
      );
    END IF;
  END LOOP;

  -- 2. Project each eligible chapter member's verified certificate.
  IF v_project_found THEN
    FOR v_source IN
      SELECT certificate.id AS certificate_id,
        certificate.signup_id,
        certificate.user_id,
        certificate.schedule_id,
        certificate.event_start,
        certificate.event_end,
        account.profile_id,
        account.id AS account_id
      FROM public.certificates AS certificate
      JOIN plugin_data.csf_profile_accounts AS account
        ON account.organization_id = p_organization_id
       AND account.user_id = certificate.user_id
       AND account.status = 'verified'
      JOIN plugin_data.csf_profiles AS profile
        ON profile.organization_id = account.organization_id
       AND profile.id = account.profile_id
       AND profile.record_status = 'active'
      WHERE certificate.project_id = p_project_id
        AND certificate.type = 'verified'
        AND certificate.signup_id IS NOT NULL
        AND certificate.user_id IS NOT NULL
        AND certificate.event_end > certificate.event_start
      ORDER BY certificate.id
    LOOP
      v_publish_key := private.project_hours_publish_key(
        v_project.event_type, v_project.schedule, v_source.schedule_id
      );
      v_revision := plugin_data.csf_attendance_source_revision(
        v_source.certificate_id, v_source.signup_id, p_project_id,
        coalesce(v_publish_key, v_source.schedule_id), v_source.user_id,
        v_source.event_start, v_source.event_end
      );

      -- Already attached and still current: nothing to do.
      IF EXISTS (
        SELECT 1 FROM plugin_data.csf_attendance_evidence AS evidence
        WHERE evidence.organization_id = p_organization_id
          AND evidence.certificate_id = v_source.certificate_id
          AND evidence.state = 'active'
      ) THEN
        CONTINUE;
      END IF;
      -- A member Unsubmit (or any claim removal) is a durable decline.
      IF EXISTS (
        SELECT 1 FROM plugin_data.csf_attendance_projection_outcomes AS outcome
        WHERE outcome.organization_id = p_organization_id
          AND outcome.certificate_id = v_source.certificate_id
          AND outcome.outcome = 'released'
      ) THEN
        CONTINUE;
      END IF;

      v_outcome := NULL;
      v_evidence_id := NULL;
      v_submission_id := NULL;
      v_activity := NULL;

      IF NOT v_linkable THEN
        v_outcome := 'project_unavailable';
      ELSIF NOT v_has_term THEN
        v_outcome := 'term_closed';
      END IF;

      IF v_outcome IS NULL THEN
        SELECT membership.* INTO v_membership
        FROM plugin_data.csf_term_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = v_source.profile_id
          AND membership.term_id = v_term.id
          AND membership.status IN ('accepted', 'active');
        IF NOT FOUND THEN
          v_outcome := CASE
            WHEN EXISTS (
              SELECT 1 FROM plugin_data.csf_opportunities AS activity
              JOIN plugin_data.csf_terms AS term
                ON term.organization_id = activity.organization_id AND term.id = activity.term_id
              WHERE activity.organization_id = p_organization_id
                AND activity.linked_project_id = p_project_id
                AND activity.attendance_submission_mode = 'pending_submission'
                AND (term.lifecycle_status <> 'open' OR term.is_current IS DISTINCT FROM true)
            ) AND NOT EXISTS (
              SELECT 1 FROM plugin_data.csf_opportunities AS activity
              WHERE activity.organization_id = p_organization_id
                AND activity.linked_project_id = p_project_id
                AND activity.attendance_submission_mode = 'pending_submission'
                AND activity.term_id = v_term.id
            ) THEN 'term_closed'
            ELSE 'not_member'
          END;
        END IF;
      END IF;

      IF v_outcome IS NULL THEN
        SELECT activity.* INTO v_activity
        FROM plugin_data.csf_opportunities AS activity
        WHERE activity.organization_id = p_organization_id
          AND activity.linked_project_id = p_project_id
          AND activity.attendance_submission_mode = 'pending_submission'
          AND activity.status IN ('published', 'closed')
          AND activity.requires_point_submission
          AND activity.term_id = v_term.id
          AND (activity.cohort_id IS NULL OR activity.cohort_id = v_membership.cohort_id)
        ORDER BY activity.created_at, activity.id
        LIMIT 1;
        IF NOT FOUND THEN
          v_outcome := CASE
            WHEN NOT EXISTS (
              SELECT 1 FROM plugin_data.csf_opportunities AS activity
              WHERE activity.organization_id = p_organization_id
                AND activity.linked_project_id = p_project_id
                AND activity.attendance_submission_mode = 'pending_submission'
                AND activity.term_id = v_term.id
            ) THEN 'term_closed'
            ELSE 'not_eligible'
          END;
        END IF;
      END IF;

      -- An open member-points verification period freezes new member claims.
      IF v_outcome IS NULL AND EXISTS (
        SELECT 1 FROM plugin_data.csf_review_periods AS period
        WHERE period.organization_id = p_organization_id
          AND period.term_id = v_term.id
          AND period.kind = 'member_points'
          AND period.status = 'open'
          AND NOT EXISTS (
            SELECT 1 FROM plugin_data.csf_review_decisions AS decision
            WHERE decision.organization_id = p_organization_id
              AND decision.period_id = period.id
              AND decision.subject_kind = 'profile'
              AND decision.subject_id = v_source.profile_id
              AND decision.submission_lock_override
          )
      ) THEN
        v_outcome := 'not_eligible';
      END IF;

      IF v_outcome IS NULL THEN
        v_rules := plugin_data.csf_effective_earning_rules(
          v_activity.earning_rules, v_activity.point_value, v_activity.point_type
        );
        v_key := NULL;
        IF v_rules IS NULL OR v_rules ->> 'mode' NOT IN ('fixed', 'shifts') THEN
          v_outcome := 'rule_not_derivable';
        ELSIF v_rules ->> 'mode' = 'shifts' THEN
          v_window := plugin_data.csf_attendance_slot_window(
            v_project.event_type, v_project.schedule, v_project.project_timezone, v_publish_key
          );
          v_key := plugin_data.csf_attendance_shift_key(v_rules, v_window);
          IF v_key IS NULL THEN
            v_outcome := 'rule_not_derivable';
          END IF;
        END IF;
      END IF;

      IF v_outcome IS NULL THEN
        -- Row locks in the begin-transaction order.
        PERFORM 1 FROM plugin_data.csf_profiles AS profile
        WHERE profile.organization_id = p_organization_id AND profile.id = v_source.profile_id
          AND profile.record_status = 'active'
        FOR SHARE;
        IF NOT FOUND THEN
          v_outcome := 'not_member';
        END IF;
      END IF;
      IF v_outcome IS NULL THEN
        PERFORM 1 FROM plugin_data.csf_terms AS term
        WHERE term.organization_id = p_organization_id AND term.id = v_term.id
          AND term.is_current AND term.lifecycle_status = 'open'
        FOR SHARE;
        IF NOT FOUND THEN v_outcome := 'term_closed'; END IF;
      END IF;
      IF v_outcome IS NULL THEN
        PERFORM 1 FROM plugin_data.csf_term_memberships AS membership
        WHERE membership.organization_id = p_organization_id AND membership.id = v_membership.id
          AND membership.status IN ('accepted', 'active')
        FOR SHARE;
        IF NOT FOUND THEN v_outcome := 'not_member'; END IF;
      END IF;
      IF v_outcome IS NULL THEN
        PERFORM 1 FROM plugin_data.csf_term_policies AS policy
        WHERE policy.organization_id = p_organization_id AND policy.term_id = v_term.id
          AND policy.published_at IS NOT NULL
        FOR SHARE;
        IF NOT FOUND THEN v_outcome := 'not_eligible'; END IF;
      END IF;
      IF v_outcome IS NULL THEN
        PERFORM 1 FROM plugin_data.csf_opportunities AS activity
        WHERE activity.organization_id = p_organization_id AND activity.id = v_activity.id
          AND activity.attendance_submission_mode = 'pending_submission'
          AND activity.linked_project_id = p_project_id
        FOR SHARE;
        IF NOT FOUND THEN v_outcome := 'not_eligible'; END IF;
      END IF;
      IF v_outcome IS NULL THEN
        PERFORM 1 FROM plugin_data.csf_profile_accounts AS account
        WHERE account.organization_id = p_organization_id AND account.id = v_source.account_id
          AND account.status = 'verified'
        FOR SHARE;
        IF NOT FOUND THEN v_outcome := 'not_member'; END IF;
      END IF;

      -- Prior decisions: a rejected or approved fixed claim, or a reviewed
      -- shift claim that already covers this shift key.
      IF v_outcome IS NULL THEN
        SELECT submission.id INTO v_claim_id
        FROM plugin_data.csf_point_submissions AS submission
        WHERE submission.organization_id = p_organization_id
          AND submission.profile_id = v_source.profile_id
          AND submission.term_id = v_term.id
          AND submission.opportunity_id = v_activity.id
          AND submission.status IN ('approved', 'rejected')
          AND (
            v_rules ->> 'mode' <> 'shifts'
            OR EXISTS (
              SELECT 1
              FROM pg_catalog.jsonb_array_elements(
                coalesce(submission.earning_selection -> 'items', '[]'::jsonb)
              ) AS item(value)
              WHERE item.value ->> 'key' = v_key
            )
          )
        ORDER BY submission.created_at DESC, submission.id
        LIMIT 1;
        IF FOUND THEN
          v_outcome := 'prior_decision';
          v_submission_id := v_claim_id;
        END IF;
      END IF;

      IF v_outcome IS NULL THEN
        -- C7: a guest who later claimed this account on the same project.
        v_origin := CASE
          WHEN EXISTS (
            SELECT 1 FROM public.anonymous_signups AS guest
            WHERE guest.project_id = p_project_id
              AND guest.linked_user_id = v_source.user_id
          ) THEN 'guest_claim'
          ELSE 'account'
        END;

        SELECT submission.* INTO v_submission
        FROM plugin_data.csf_point_submissions AS submission
        WHERE submission.organization_id = p_organization_id
          AND submission.profile_id = v_source.profile_id
          AND submission.term_id = v_term.id
          AND submission.opportunity_id = v_activity.id
          AND submission.status IN ('draft', 'submitted', 'needs_action')
        ORDER BY submission.created_at, submission.id
        LIMIT 1
        FOR UPDATE;

        IF FOUND THEN
          INSERT INTO plugin_data.csf_attendance_evidence (
            organization_id, opportunity_id, term_id, submission_id, user_id,
            certificate_id, signup_id, project_id, schedule_id, publish_key,
            event_start, event_end, verified_minutes, matched_shift_key,
            identity_origin, source_revision
          ) VALUES (
            p_organization_id, v_activity.id, v_term.id, v_submission.id, v_source.user_id,
            v_source.certificate_id, v_source.signup_id, p_project_id, v_source.schedule_id,
            v_publish_key, v_source.event_start, v_source.event_end,
            greatest(1, (pg_catalog.date_part('epoch', v_source.event_end - v_source.event_start) / 60)::integer),
            v_key, v_origin, v_revision
          )
          RETURNING id INTO v_evidence_id;
          v_submission_id := v_submission.id;
          v_outcome := CASE WHEN v_submission.status = 'needs_action' THEN 'prior_decision' ELSE 'attached' END;
          INSERT INTO plugin_data.csf_admin_audit_events (
            organization_id, actor_user_id, action, target_type, target_id, term_id,
            before_data, after_data, correlation_id, source_type, source_id, reason_code
          ) VALUES (
            p_organization_id, NULL, 'point_submission.attendance_attached',
            'csf_point_submissions', v_submission.id, v_term.id, NULL,
            pg_catalog.jsonb_build_object('evidenceId', v_evidence_id,
              'certificateId', v_source.certificate_id, 'sourceRevision', v_revision,
              'matchedShiftKey', v_key),
            plugin_data.csf_attendance_correlation_id(ARRAY[
              p_organization_id::text, v_source.certificate_id::text, v_revision, 'attached'
            ]),
            'attendance_projection', v_evidence_id::text, 'attendance_verified'
          )
          ON CONFLICT (organization_id, correlation_id) WHERE source_type = 'attendance_projection'
          DO NOTHING;
          IF plugin_data.csf_attendance_claim_is_system_only(v_submission) THEN
            v_settle := plugin_data.csf_settle_attendance_claim(p_organization_id, v_submission.id);
          END IF;
        ELSE
          v_calculation := plugin_data.csf_attendance_claim_calculation(
            p_organization_id, v_source.profile_id, v_activity.id, NULL, v_rules,
            CASE WHEN v_key IS NULL THEN ARRAY[]::text[] ELSE ARRAY[v_key] END
          );
          IF v_calculation ->> 'outcome' <> 'ok' THEN
            v_outcome := v_calculation ->> 'outcome';
          ELSE
            INSERT INTO plugin_data.csf_point_submissions (
              organization_id, profile_id, term_id, opportunity_id, source, description,
              claimed_points, point_type, status, submitted_by, submitted_at, activity_date,
              earning_rules_version, earning_rules_snapshot, earning_selection, suggested_points
            ) VALUES (
              p_organization_id, v_source.profile_id, v_term.id, v_activity.id, 'attendance',
              v_activity.title,
              (v_calculation ->> 'points')::numeric, v_calculation ->> 'pointType',
              'submitted', NULL, pg_catalog.now(),
              pg_catalog.timezone('America/Los_Angeles', v_source.event_start)::date,
              v_activity.earning_rules_version, v_rules, v_calculation -> 'selection',
              (v_calculation ->> 'points')::numeric
            )
            RETURNING id INTO v_submission_id;
            INSERT INTO plugin_data.csf_attendance_evidence (
              organization_id, opportunity_id, term_id, submission_id, user_id,
              certificate_id, signup_id, project_id, schedule_id, publish_key,
              event_start, event_end, verified_minutes, matched_shift_key,
              identity_origin, source_revision
            ) VALUES (
              p_organization_id, v_activity.id, v_term.id, v_submission_id, v_source.user_id,
              v_source.certificate_id, v_source.signup_id, p_project_id, v_source.schedule_id,
              v_publish_key, v_source.event_start, v_source.event_end,
              greatest(1, (pg_catalog.date_part('epoch', v_source.event_end - v_source.event_start) / 60)::integer),
              v_key, v_origin, v_revision
            )
            RETURNING id INTO v_evidence_id;
            INSERT INTO plugin_data.csf_admin_audit_events (
              organization_id, actor_user_id, action, target_type, target_id, term_id,
              before_data, after_data, correlation_id, source_type, source_id, reason_code
            ) VALUES (
              p_organization_id, NULL, 'point_submission.attendance_created',
              'csf_point_submissions', v_submission_id, v_term.id, NULL,
              pg_catalog.jsonb_build_object('evidenceId', v_evidence_id,
                'certificateId', v_source.certificate_id, 'sourceRevision', v_revision,
                'claimedPoints', (v_calculation ->> 'points')::numeric,
                'selection', v_calculation -> 'selection', 'status', 'submitted'),
              plugin_data.csf_attendance_correlation_id(ARRAY[
                p_organization_id::text, v_source.certificate_id::text, v_revision, 'created'
              ]),
              'attendance_projection', v_evidence_id::text, 'attendance_verified'
            )
            ON CONFLICT (organization_id, correlation_id) WHERE source_type = 'attendance_projection'
            DO NOTHING;
            v_outcome := 'projected';
          END IF;
        END IF;
      END IF;

      PERFORM plugin_data.csf_record_attendance_outcome(
        p_organization_id, v_source.certificate_id, p_project_id, v_activity.id,
        v_submission_id, v_evidence_id, v_outcome, NULL, v_revision
      );
      v_counts := v_counts || pg_catalog.jsonb_build_object(
        v_outcome, coalesce((v_counts ->> v_outcome)::integer, 0) + 1
      );
    END LOOP;
  END IF;

  -- 3. Settle claims that lost evidence (current open term only). This also
  -- settles claims whose evidence a C4 trigger or a relink staled earlier.
  IF v_has_term THEN
    SELECT coalesce(pg_catalog.array_agg(DISTINCT evidence.submission_id), ARRAY[]::uuid[])
      || v_affected_claims
    INTO v_affected_claims
    FROM plugin_data.csf_attendance_evidence AS evidence
    JOIN plugin_data.csf_opportunities AS activity
      ON activity.organization_id = evidence.organization_id
     AND activity.id = evidence.opportunity_id
    JOIN plugin_data.csf_point_submissions AS submission
      ON submission.organization_id = evidence.organization_id
     AND submission.id = evidence.submission_id
    WHERE evidence.organization_id = p_organization_id
      AND evidence.state = 'stale'
      AND (evidence.project_id = p_project_id OR activity.linked_project_id = p_project_id)
      AND submission.source = 'attendance'
      AND submission.status = 'submitted'
      AND submission.term_id = v_term.id;
    FOR v_claim_id IN
      SELECT DISTINCT claim_id
      FROM pg_catalog.unnest(v_affected_claims) AS claim_id
      WHERE claim_id IS NOT NULL
      ORDER BY claim_id
    LOOP
      IF EXISTS (
        SELECT 1 FROM plugin_data.csf_point_submissions AS submission
        WHERE submission.organization_id = p_organization_id
          AND submission.id = v_claim_id
          AND submission.term_id = v_term.id
      ) THEN
        v_settle := plugin_data.csf_settle_attendance_claim(p_organization_id, v_claim_id);
        v_counts := v_counts || pg_catalog.jsonb_build_object(
          'settled_' || v_settle,
          coalesce((v_counts ->> ('settled_' || v_settle))::integer, 0) + 1
        );
      END IF;
    END LOOP;
  END IF;

  RETURN v_counts;
END;
$$;

-- ---------------------------------------------------------------------------
-- I. Statement triggers on public.certificates
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_certificates_attendance_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_changes jsonb;
  v_pair record;
  v_sqlstate text;
BEGIN
  -- Collect changed certificates as (id, old project, new project).
  IF TG_OP = 'INSERT' THEN
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', new_row.id, 'project', new_row.project_id))
    INTO v_changes
    FROM csf_new_certificates AS new_row
    WHERE new_row.type = 'verified' AND new_row.project_id IS NOT NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT pg_catalog.jsonb_agg(change.value)
    INTO v_changes
    FROM (
      SELECT pg_catalog.jsonb_build_object('id', new_row.id, 'project', new_row.project_id) AS value
      FROM csf_new_certificates AS new_row
      JOIN csf_old_certificates AS old_row ON old_row.id = new_row.id
      WHERE (new_row.type = 'verified' OR old_row.type = 'verified')
        AND ROW(new_row.user_id, new_row.signup_id, new_row.project_id, new_row.type,
            new_row.event_start, new_row.event_end)
          IS DISTINCT FROM ROW(old_row.user_id, old_row.signup_id, old_row.project_id,
            old_row.type, old_row.event_start, old_row.event_end)
        AND new_row.project_id IS NOT NULL
      UNION ALL
      SELECT pg_catalog.jsonb_build_object('id', old_row.id, 'project', old_row.project_id)
      FROM csf_new_certificates AS new_row
      JOIN csf_old_certificates AS old_row ON old_row.id = new_row.id
      WHERE old_row.type = 'verified'
        AND old_row.project_id IS NOT NULL
        AND ROW(new_row.user_id, new_row.signup_id, new_row.project_id, new_row.type,
            new_row.event_start, new_row.event_end)
          IS DISTINCT FROM ROW(old_row.user_id, old_row.signup_id, old_row.project_id,
            old_row.type, old_row.event_start, old_row.event_end)
        AND old_row.project_id IS DISTINCT FROM new_row.project_id
    ) AS change;
  ELSE
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', old_row.id, 'project', old_row.project_id))
    INTO v_changes
    FROM csf_old_certificates AS old_row
    WHERE old_row.type = 'verified' AND old_row.project_id IS NOT NULL;
  END IF;

  IF v_changes IS NULL THEN
    RETURN NULL;
  END IF;

  -- Cheap filter: only chapters with an enabled activity linked to the project,
  -- or chapters holding active evidence for one of these certificates.
  FOR v_pair IN
    WITH change AS (
      SELECT (item.value ->> 'id')::uuid AS certificate_id,
        (item.value ->> 'project')::uuid AS project_id
      FROM pg_catalog.jsonb_array_elements(v_changes) AS item(value)
    ),
    targets AS (
      SELECT activity.organization_id, change.project_id, change.certificate_id
      FROM change
      JOIN plugin_data.csf_opportunities AS activity
        ON activity.linked_project_id = change.project_id
       AND activity.attendance_submission_mode = 'pending_submission'
      UNION
      SELECT evidence.organization_id, evidence.project_id, evidence.certificate_id
      FROM change
      JOIN plugin_data.csf_attendance_evidence AS evidence
        ON evidence.certificate_id = change.certificate_id
       AND evidence.state = 'active'
    )
    SELECT targets.organization_id, targets.project_id,
      pg_catalog.array_agg(DISTINCT targets.certificate_id) AS certificate_ids
    FROM targets
    GROUP BY targets.organization_id, targets.project_id
    ORDER BY targets.organization_id, targets.project_id
  LOOP
    BEGIN
      PERFORM plugin_data.csf_project_attendance_sources(
        v_pair.organization_id, v_pair.project_id, v_pair.certificate_ids
      );
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      PERFORM plugin_data.csf_record_attendance_failure(
        v_pair.organization_id, v_pair.project_id, v_pair.certificate_ids, v_sqlstate
      );
    END;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER csf_certificates_attendance_insert
  AFTER INSERT ON public.certificates
  REFERENCING NEW TABLE AS csf_new_certificates
  FOR EACH STATEMENT EXECUTE FUNCTION plugin_data.csf_certificates_attendance_projection();
CREATE TRIGGER csf_certificates_attendance_update
  AFTER UPDATE ON public.certificates
  REFERENCING OLD TABLE AS csf_old_certificates NEW TABLE AS csf_new_certificates
  FOR EACH STATEMENT EXECUTE FUNCTION plugin_data.csf_certificates_attendance_projection();
CREATE TRIGGER csf_certificates_attendance_delete
  AFTER DELETE ON public.certificates
  REFERENCING OLD TABLE AS csf_old_certificates
  FOR EACH STATEMENT EXECUTE FUNCTION plugin_data.csf_certificates_attendance_projection();

-- ---------------------------------------------------------------------------
-- J. Service wrappers (V128 style; project lock first, deviation D1)
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_lock_attendance_wrapper(
  p_organization_id uuid,
  p_opportunity_id uuid,
  p_actor_user_id uuid,
  p_permissions text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_member uuid;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.unnest(p_permissions) AS permission
    WHERE plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, permission)
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.' USING ERRCODE = '42501';
  END IF;
  SELECT activity.linked_project_id INTO v_project_id
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_opportunity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF activity was not found in this organization.';
  END IF;
  -- The host publication transaction locks the project, then the publisher's
  -- membership row, then fires the projection. Take the project first.
  IF v_project_id IS NOT NULL THEN
    PERFORM 1 FROM public.projects AS project WHERE project.id = v_project_id FOR KEY SHARE;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  SELECT member.user_id INTO v_member
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.unnest(p_permissions) AS permission
    WHERE plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, permission)
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.' USING ERRCODE = '42501';
  END IF;
  RETURN v_project_id;
END;
$$;

CREATE FUNCTION plugin_data.csf_set_activity_attendance_submissions(
  p_organization_id uuid,
  p_opportunity_id uuid,
  p_mode text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_before plugin_data.csf_opportunities%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request jsonb;
  v_rules jsonb;
  v_term_id uuid;
  v_backfill jsonb := NULL;
  v_invalidated integer := 0;
  v_claim uuid;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('off', 'pending_submission') THEN
    RAISE EXCEPTION 'Choose whether verified attendance creates pending point submissions.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable activity request identifier is required.';
  END IF;
  v_project_id := plugin_data.csf_lock_attendance_wrapper(
    p_organization_id, p_opportunity_id, p_actor_user_id, ARRAY['manage_opportunities']
  );

  v_request := pg_catalog.jsonb_build_object('activityId', p_opportunity_id, 'mode', p_mode);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_atomic_request:' || p_organization_id::text || ':' || p_request_id::text, 0
  ));
  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'activity.attendance_submissions_set'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_id IS DISTINCT FROM p_opportunity_id
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That activity request identifier is already bound to a different change.';
    END IF;
    RETURN (v_receipt.after_data -> 'result') || pg_catalog.jsonb_build_object('idempotent', true);
  END IF;

  SELECT term.id INTO v_term_id
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id AND term.is_current AND term.lifecycle_status = 'open'
  ORDER BY term.id LIMIT 1;
  IF v_term_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      p_organization_id::text || ':' || v_term_id::text, 0
    ));
  END IF;

  SELECT activity.* INTO v_before
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_opportunity_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF activity was not found in this organization.';
  END IF;
  IF v_before.linked_project_id IS DISTINCT FROM v_project_id THEN
    RAISE EXCEPTION 'CSF activity changed; refresh and try again.' USING ERRCODE = '40001';
  END IF;

  IF p_mode = 'pending_submission' THEN
    IF v_before.signup_mode <> 'lets_assist_project' OR v_before.linked_project_id IS NULL THEN
      RAISE EXCEPTION 'Link a Let''s Assist project before creating submissions from attendance.';
    END IF;
    IF v_before.status NOT IN ('draft', 'published', 'closed') THEN
      RAISE EXCEPTION 'Cancelled or archived activities cannot create submissions from attendance.';
    END IF;
    IF v_before.requires_point_submission IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Credit for this activity is recorded outside member point submissions.';
    END IF;
    v_rules := plugin_data.csf_effective_earning_rules(
      v_before.earning_rules, v_before.point_value, v_before.point_type
    );
    IF v_rules IS NULL OR v_rules ->> 'mode' NOT IN ('fixed', 'shifts')
      OR (v_rules ->> 'mode' = 'fixed'
        AND (v_rules -> 'components' -> 0 ->> 'category') NOT IN ('non_drive', 'drive')) THEN
      RAISE EXCEPTION 'Verified attendance can only supply fixed or shift-based points.';
    END IF;
    IF NOT plugin_data.csf_project_is_linkable(p_organization_id, v_before.linked_project_id) THEN
      RAISE EXCEPTION 'Linked project is not available to this organization.';
    END IF;
  END IF;

  IF v_before.attendance_submission_mode IS DISTINCT FROM p_mode THEN
    UPDATE plugin_data.csf_opportunities
    SET attendance_submission_mode = p_mode, updated_at = pg_catalog.now()
    WHERE organization_id = p_organization_id AND id = p_opportunity_id;
  END IF;

  IF p_mode = 'off' THEN
    FOR v_claim IN
      SELECT DISTINCT evidence.submission_id
      FROM plugin_data.csf_attendance_evidence AS evidence
      WHERE evidence.organization_id = p_organization_id
        AND evidence.opportunity_id = p_opportunity_id
        AND evidence.state = 'active'
      ORDER BY evidence.submission_id
    LOOP
      PERFORM 1 FROM plugin_data.csf_point_submissions AS submission
      WHERE submission.organization_id = p_organization_id AND submission.id = v_claim
      FOR UPDATE;
    END LOOP;
    v_invalidated := plugin_data.csf_invalidate_activity_attendance_evidence(
      p_organization_id, p_opportunity_id, 'attendance_disabled', NULL
    );
    FOR v_claim IN
      SELECT DISTINCT evidence.submission_id
      FROM plugin_data.csf_attendance_evidence AS evidence
      JOIN plugin_data.csf_point_submissions AS submission
        ON submission.organization_id = evidence.organization_id
       AND submission.id = evidence.submission_id
      WHERE evidence.organization_id = p_organization_id
        AND evidence.opportunity_id = p_opportunity_id
        AND evidence.invalidation_reason = 'attendance_disabled'
        AND submission.term_id = v_term_id
      ORDER BY evidence.submission_id
    LOOP
      PERFORM plugin_data.csf_settle_attendance_claim(p_organization_id, v_claim);
    END LOOP;
  ELSIF v_before.status IN ('published', 'closed') THEN
    v_backfill := plugin_data.csf_project_attendance_sources(
      p_organization_id, v_before.linked_project_id, NULL
    );
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'activity.attendance_submissions_set',
    'csf_opportunities', p_opportunity_id, v_before.term_id,
    pg_catalog.jsonb_build_object('mode', v_before.attendance_submission_mode),
    pg_catalog.jsonb_build_object(
      'request', v_request,
      'result', pg_catalog.jsonb_build_object(
        'activityId', p_opportunity_id,
        'mode', p_mode,
        'changed', v_before.attendance_submission_mode IS DISTINCT FROM p_mode,
        'invalidated', v_invalidated,
        'backfill', v_backfill,
        'correlationId', p_request_id
      )
    ),
    p_request_id, 'activity_attendance_submissions_set'
  );
  RETURN pg_catalog.jsonb_build_object(
    'activityId', p_opportunity_id,
    'mode', p_mode,
    'changed', v_before.attendance_submission_mode IS DISTINCT FROM p_mode,
    'invalidated', v_invalidated,
    'backfill', v_backfill,
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_retry_activity_attendance_sync(
  p_organization_id uuid,
  p_opportunity_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_activity plugin_data.csf_opportunities%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request jsonb;
  v_result jsonb;
  v_term_id uuid;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable activity request identifier is required.';
  END IF;
  v_project_id := plugin_data.csf_lock_attendance_wrapper(
    p_organization_id, p_opportunity_id, p_actor_user_id,
    ARRAY['manage_opportunities', 'verify_submissions']
  );
  v_request := pg_catalog.jsonb_build_object('activityId', p_opportunity_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_atomic_request:' || p_organization_id::text || ':' || p_request_id::text, 0
  ));
  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'activity.attendance_sync_retried'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_id IS DISTINCT FROM p_opportunity_id
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That activity request identifier is already bound to a different change.';
    END IF;
    RETURN (v_receipt.after_data -> 'result') || pg_catalog.jsonb_build_object('idempotent', true);
  END IF;

  SELECT term.id INTO v_term_id
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id AND term.is_current AND term.lifecycle_status = 'open'
  ORDER BY term.id LIMIT 1;
  IF v_term_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      p_organization_id::text || ':' || v_term_id::text, 0
    ));
  END IF;
  SELECT activity.* INTO v_activity
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_opportunity_id
  FOR SHARE;
  IF v_activity.linked_project_id IS DISTINCT FROM v_project_id THEN
    RAISE EXCEPTION 'CSF activity changed; refresh and try again.' USING ERRCODE = '40001';
  END IF;
  IF v_activity.attendance_submission_mode <> 'pending_submission' OR v_project_id IS NULL THEN
    RAISE EXCEPTION 'Automatic submissions from attendance are off for this activity.';
  END IF;

  v_result := plugin_data.csf_project_attendance_sources(p_organization_id, v_project_id, NULL);

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'activity.attendance_sync_retried',
    'csf_opportunities', p_opportunity_id, v_activity.term_id, NULL,
    pg_catalog.jsonb_build_object('request', v_request, 'result',
      pg_catalog.jsonb_build_object('activityId', p_opportunity_id, 'outcomes', v_result,
        'correlationId', p_request_id)),
    p_request_id, 'activity_attendance_sync_retried'
  );
  RETURN pg_catalog.jsonb_build_object(
    'activityId', p_opportunity_id,
    'outcomes', v_result,
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- K. Reads (TS authorizes the caller first)
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_linked_project_attendance_summary(
  p_organization_id uuid,
  p_opportunity_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_activity plugin_data.csf_opportunities%ROWTYPE;
BEGIN
  SELECT activity.* INTO v_activity
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_opportunity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF activity was not found in this organization.';
  END IF;
  IF v_activity.linked_project_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('state', 'not_linked');
  END IF;
  IF v_activity.attendance_submission_mode <> 'pending_submission' THEN
    RETURN pg_catalog.jsonb_build_object('state', 'disabled');
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'state', 'enabled',
    'verifiedMembers', (
      SELECT pg_catalog.count(DISTINCT evidence.user_id)
      FROM plugin_data.csf_attendance_evidence AS evidence
      WHERE evidence.organization_id = p_organization_id
        AND evidence.opportunity_id = p_opportunity_id
        AND evidence.state = 'active'
    ),
    'pendingSubmissions', (
      SELECT pg_catalog.count(*)
      FROM plugin_data.csf_point_submissions AS submission
      WHERE submission.organization_id = p_organization_id
        AND submission.opportunity_id = p_opportunity_id
        AND submission.source = 'attendance'
        AND submission.status IN ('draft', 'submitted')
    ),
    'needsStaffAttention', (
      SELECT pg_catalog.count(*)
      FROM plugin_data.csf_attendance_projection_outcomes AS outcome
      LEFT JOIN plugin_data.csf_point_submissions AS submission
        ON submission.organization_id = outcome.organization_id
       AND submission.id = outcome.submission_id
      WHERE outcome.organization_id = p_organization_id
        AND (outcome.opportunity_id = p_opportunity_id
          OR (outcome.opportunity_id IS NULL AND outcome.project_id = v_activity.linked_project_id))
        AND (
          outcome.outcome = 'failed'
          OR (outcome.outcome IN ('prior_decision', 'stale')
            AND submission.status IN ('approved', 'rejected', 'needs_action'))
        )
    ),
    'lastProjectedAt', (
      SELECT pg_catalog.max(outcome.last_attempt_at)
      FROM plugin_data.csf_attendance_projection_outcomes AS outcome
      WHERE outcome.organization_id = p_organization_id
        AND (outcome.opportunity_id = p_opportunity_id
          OR outcome.project_id = v_activity.linked_project_id)
    )
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_attendance_submission_provenance(
  p_organization_id uuid,
  p_submission_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'submissionId', p_submission_id,
    'evidence', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', evidence.id,
      'state', evidence.state,
      'currentlyValid', plugin_data.csf_attendance_evidence_is_current(evidence),
      'invalidationReason', evidence.invalidation_reason,
      'projectId', evidence.project_id,
      'scheduleKey', coalesce(evidence.publish_key, evidence.schedule_id),
      'eventStart', evidence.event_start,
      'eventEnd', evidence.event_end,
      'verifiedMinutes', evidence.verified_minutes,
      'matchedShiftKey', evidence.matched_shift_key,
      'identityOrigin', evidence.identity_origin,
      'recordedAt', evidence.created_at,
      'invalidatedAt', evidence.invalidated_at
    ) ORDER BY evidence.event_start, evidence.id), '[]'::jsonb)
  )
  FROM plugin_data.csf_attendance_evidence AS evidence
  WHERE evidence.organization_id = p_organization_id
    AND evidence.submission_id = p_submission_id;
$$;

-- ---------------------------------------------------------------------------
-- L. Privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION plugin_data.csf_release_attendance_evidence_on_delete() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_release_attendance_evidence_on_delete() TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_attendance_source_revision(uuid, uuid, uuid, text, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_attendance_source_revision(uuid, uuid, uuid, text, uuid, timestamptz, timestamptz) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_attendance_correlation_id(text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_attendance_correlation_id(text[]) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_attendance_slot_window(text, jsonb, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_attendance_slot_window(text, jsonb, text, text) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_attendance_shift_key(jsonb, tstzrange) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_attendance_shift_key(jsonb, tstzrange) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_attendance_evidence_is_current(plugin_data.csf_attendance_evidence) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_attendance_evidence_is_current(plugin_data.csf_attendance_evidence) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_attendance_claim_valid_evidence(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_attendance_claim_valid_evidence(uuid, uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_invalidate_attendance_evidence(uuid, uuid[], text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_invalidate_attendance_evidence(uuid, uuid[], text) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_invalidate_activity_attendance_evidence(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_invalidate_activity_attendance_evidence(uuid, uuid, text, uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_stale_attendance_evidence_for_account() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_stale_attendance_evidence_for_account() TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_stale_attendance_evidence_for_membership() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_stale_attendance_evidence_for_membership() TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_attendance_claim_is_system_only(plugin_data.csf_point_submissions) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_attendance_claim_is_system_only(plugin_data.csf_point_submissions) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_attendance_claim_calculation(uuid, uuid, uuid, uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_attendance_claim_calculation(uuid, uuid, uuid, uuid, jsonb, text[]) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_settle_attendance_claim(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_settle_attendance_claim(uuid, uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_record_attendance_outcome(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_attendance_outcome(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_record_attendance_failure(uuid, uuid, uuid[], text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_attendance_failure(uuid, uuid, uuid[], text) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_project_attendance_sources(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_project_attendance_sources(uuid, uuid, uuid[]) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_certificates_attendance_projection() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_certificates_attendance_projection() TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_lock_attendance_wrapper(uuid, uuid, uuid, text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_lock_attendance_wrapper(uuid, uuid, uuid, text[]) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_set_activity_attendance_submissions(uuid, uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_activity_attendance_submissions(uuid, uuid, text, uuid, uuid) TO postgres, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_retry_activity_attendance_sync(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retry_activity_attendance_sync(uuid, uuid, uuid, uuid) TO postgres, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_linked_project_attendance_summary(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_linked_project_attendance_summary(uuid, uuid) TO postgres, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_attendance_submission_provenance(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_attendance_submission_provenance(uuid, uuid) TO postgres, service_role;

COMMENT ON FUNCTION plugin_data.csf_project_attendance_sources(uuid, uuid, uuid[]) IS
  'Projects verified certificates of eligible chapter members on one project into pending CSF point submissions. Idempotent by certificate; returns outcome counts only.';
COMMENT ON FUNCTION plugin_data.csf_set_activity_attendance_submissions(uuid, uuid, text, uuid, uuid) IS
  'Service-only V128-style wrapper that turns automatic pending submissions from verified attendance on or off. Enabling runs the backfill in the same transaction.';
COMMENT ON FUNCTION plugin_data.csf_retry_activity_attendance_sync(uuid, uuid, uuid, uuid) IS
  'Service-only staff retry of the attendance projection for one linked activity.';

-- ---------------------------------------------------------------------------
-- M. Forward replacements (C3 evidence as proof; C6 Unsubmit of attendance claims)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_point_submission_eligibility(p_organization_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_points numeric, p_point_type text, p_has_proof boolean, p_allow_closed_activity boolean, p_allow_legacy_manual boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_membership plugin_data.csf_term_memberships%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_opportunity plugin_data.csf_opportunities%ROWTYPE;
  v_partner_term plugin_data.csf_partner_club_terms%ROWTYPE;
  v_source_cap numeric(6,2);
  v_effective_cap numeric(6,2);
  v_proof_required boolean := false;
BEGIN
  IF p_opportunity_id IS NOT NULL AND p_partner_club_term_id IS NOT NULL THEN
    RAISE EXCEPTION 'Choose one structured point source.';
  END IF;
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'Points must be greater than zero.';
  END IF;
  IF p_point_type IS NULL OR p_point_type NOT IN ('non_drive', 'drive') THEN
    RAISE EXCEPTION 'Point type is invalid.';
  END IF;
  IF p_source IS NULL OR (p_source NOT IN ('student', 'staff')
    AND NOT (coalesce(p_allow_legacy_manual, false) AND p_source = 'manual')
    AND NOT (p_source = 'attendance' AND p_opportunity_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'This point source must use its dedicated reconciliation workflow.';
  END IF;
  IF p_source = 'manual'
    AND (p_opportunity_id IS NOT NULL OR p_partner_club_term_id IS NOT NULL) THEN
    RAISE EXCEPTION 'A manual award cannot use a structured point source.';
  END IF;

  -- Match the canonical semester-close/evidence-writer lock before taking
  -- term-scoped row locks. This prevents a close from racing a validated
  -- point transition after its authority snapshot.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || p_term_id::text,
    0
  ));

  SELECT profile.*
  INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id
  FOR UPDATE;
  IF NOT FOUND OR v_profile.record_status <> 'active' THEN
    RAISE EXCEPTION 'An active CSF profile is required for this point action.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND OR v_term.is_current IS DISTINCT FROM true
    OR v_term.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Point actions are only available for the current open semester.';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = p_profile_id
    AND membership.term_id = p_term_id
  FOR UPDATE;
  IF NOT FOUND OR v_membership.status NOT IN ('accepted', 'active') THEN
    RAISE EXCEPTION 'An accepted or active semester membership is required for this point action.';
  END IF;

  SELECT policy.*
  INTO v_policy
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = p_term_id
  FOR UPDATE;
  IF NOT FOUND OR v_policy.published_at IS NULL THEN
    RAISE EXCEPTION 'A published semester policy is required for this point action.';
  END IF;
  IF p_points > v_policy.max_points_per_activity THEN
    RAISE EXCEPTION 'Points exceed the semester activity limit of %.',
      v_policy.max_points_per_activity;
  END IF;

  IF p_opportunity_id IS NOT NULL THEN
    SELECT opportunity.*
    INTO v_opportunity
    FROM plugin_data.csf_opportunities AS opportunity
    WHERE opportunity.organization_id = p_organization_id
      AND opportunity.id = p_opportunity_id
      AND opportunity.term_id = p_term_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CSF activity belongs to a different organization or semester.';
    END IF;
    IF (coalesce(p_allow_closed_activity, false)
        AND v_opportunity.status NOT IN ('published', 'closed'))
      OR (NOT coalesce(p_allow_closed_activity, false)
        AND v_opportunity.status <> 'published') THEN
      RAISE EXCEPTION 'This CSF activity is not available for this point action.';
    END IF;
    IF v_opportunity.requires_point_submission IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Credit for this activity is recorded outside member point submissions.';
    END IF;
    -- Rule-driven activities resolve the category from the selected
    -- components; the stored point_type is only the lead category there.
    IF v_opportunity.point_type NOT IN ('non_drive', 'drive')
      OR (v_opportunity.earning_rules IS NULL
        AND v_opportunity.point_type <> p_point_type) THEN
      RAISE EXCEPTION 'Point type does not match the selected CSF activity.';
    END IF;
    IF v_opportunity.cohort_id IS NOT NULL
      AND v_membership.cohort_id IS DISTINCT FROM v_opportunity.cohort_id THEN
      RAISE EXCEPTION 'This CSF activity is assigned to a different class.';
    END IF;

    v_source_cap := coalesce(
      v_opportunity.point_cap,
      CASE WHEN v_opportunity.point_value > 0 THEN v_opportunity.point_value END,
      v_policy.max_points_per_activity
    );
    v_effective_cap := least(v_policy.max_points_per_activity, v_source_cap);
    IF p_points > v_effective_cap THEN
      RAISE EXCEPTION 'Points exceed the selected activity limit of %.', v_effective_cap;
    END IF;
    v_proof_required := v_opportunity.evidence_policy = 'required';
  ELSIF p_partner_club_term_id IS NOT NULL THEN
    SELECT club_term.*
    INTO v_partner_term
    FROM plugin_data.csf_partner_club_terms AS club_term
    JOIN plugin_data.csf_partner_clubs AS club
      ON club.organization_id = club_term.organization_id
     AND club.id = club_term.partner_club_id
    WHERE club_term.organization_id = p_organization_id
      AND club_term.id = p_partner_club_term_id
      AND club_term.term_id = p_term_id
      AND club.status = 'active'
    FOR UPDATE OF club_term, club;
    IF NOT FOUND OR v_partner_term.workflow_status <> 'active' THEN
      RAISE EXCEPTION 'This partner club is not active for the current semester.';
    END IF;
    -- Per-club point-type approvals and caps were removed with the partner
    -- policy simplification; officers vet points manually at approval time.
    -- Only active standing is enforced here, bounded by the semester policy
    -- cap already checked above.
    v_proof_required := p_source = 'student';
  ELSE
    IF p_source = 'student' THEN
      IF v_policy.outside_volunteering_allowed IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Outside volunteering is not allowed by the published semester policy.';
      END IF;
      v_proof_required := true;
    ELSE
      -- An authorized staff/manual entry is the only unstructured source that
      -- may intentionally waive a proof file.
      v_proof_required := false;
    END IF;
  END IF;

  IF v_proof_required AND p_has_proof IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A proof file is required for this point action.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_point_submission_v2(p_organization_id uuid, p_submission_id uuid, p_action text, p_awarded_points numeric, p_review_notes text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_awarded_points numeric(6,2);
  v_has_finalized_proof boolean := false;
  v_lock_term_id uuid;
  v_review_notes text := nullif(pg_catalog.btrim(coalesce(p_review_notes, '')), '');
BEGIN
  IF p_action IS NULL
    OR p_action NOT IN ('approved', 'rejected', 'needs_action', 'duplicate') THEN
    RAISE EXCEPTION 'Invalid point-submission review action.';
  END IF;

  -- Permission is resolved and locked before any private submission evidence.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY['verify_submissions']::text[]
  );

  SELECT submission.term_id
  INTO v_lock_term_id
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || v_lock_term_id::text,
    0
  ));

  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;
  IF v_submission.term_id IS DISTINCT FROM v_lock_term_id THEN
    RAISE EXCEPTION 'Point submission semester changed; refresh and try again.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_submission.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_term.is_current IS DISTINCT FROM true
    OR v_term.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Point submissions can only be reviewed in the current open semester.';
  END IF;

  IF p_action='approved' AND v_submission.request_kind='exception' THEN RAISE EXCEPTION 'Explicit exception review is required before awarding points.'; END IF;
  IF p_action = 'approved' THEN
    SELECT policy.*
    INTO v_policy
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.organization_id = p_organization_id
      AND policy.term_id = v_submission.term_id
    FOR UPDATE;
    IF NOT FOUND OR v_policy.published_at IS NULL THEN
      RAISE EXCEPTION 'A published semester policy is required before approving points.';
    END IF;

    v_awarded_points := coalesce(p_awarded_points, v_submission.claimed_points);
    IF v_awarded_points IS NULL OR v_awarded_points <= 0
      OR v_awarded_points > v_policy.max_points_per_activity THEN
      RAISE EXCEPTION 'Awarded points must be between 0 and %.',
        v_policy.max_points_per_activity;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = p_submission_id
        AND proof.upload_status <> 'finalized'
    ) THEN
      RAISE EXCEPTION 'Point-submission proof must be finalized before approval.';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = p_submission_id
        AND proof.upload_status = 'finalized'
        AND proof.bucket = 'plugins'
        AND nullif(pg_catalog.btrim(proof.object_path), '') IS NOT NULL
    ) INTO v_has_finalized_proof;

    -- Organizer evidence: an active, still-current verified certificate
    -- satisfies the proof requirement. An attendance claim without one cannot
    -- be approved.
    IF plugin_data.csf_attendance_claim_valid_evidence(p_organization_id, p_submission_id) > 0 THEN
      v_has_finalized_proof := true;
    ELSIF v_submission.source = 'attendance' THEN
      RAISE EXCEPTION 'Organizer evidence no longer valid. Retry attendance sync or reject this claim.'
        USING ERRCODE = '55000';
    END IF;

    PERFORM plugin_data.csf_assert_point_submission_eligibility(
      p_organization_id,
      v_submission.profile_id,
      v_submission.term_id,
      v_submission.opportunity_id,
      v_submission.partner_club_term_id,
      v_submission.source,
      v_awarded_points,
      v_submission.point_type,
      v_has_finalized_proof,
      true,
      true
    );

    -- Rule-driven submissions: an award that departs from the calculated value, or
    -- any officer-assessed award, carries a written reason into the audit.
    IF v_submission.earning_rules_snapshot IS NOT NULL
      AND (v_submission.earning_rules_snapshot -> 'legacy') IS DISTINCT FROM 'true'::jsonb THEN
      IF v_submission.earning_rules_snapshot ->> 'mode' = 'assessment'
        AND v_review_notes IS NULL THEN
        RAISE EXCEPTION 'Officer assessment requires review notes that explain the awarded points.';
      END IF;
      IF v_submission.suggested_points IS NOT NULL
        AND v_awarded_points <> v_submission.suggested_points
        AND v_review_notes IS NULL THEN
        RAISE EXCEPTION 'Explain why the awarded points differ from the calculated %.',
          v_submission.suggested_points;
      END IF;
    END IF;
    IF v_submission.opportunity_id IS NOT NULL THEN
      PERFORM plugin_data.csf_assert_activity_earning_award(
        p_organization_id,
        v_submission.profile_id,
        v_submission.opportunity_id,
        v_submission.id,
        v_awarded_points,
        v_submission.earning_rules_snapshot,
        v_submission.earning_selection
      );
    END IF;
  END IF;

  RETURN plugin_data.csf_review_point_submission_v2_authority_base_20260810(
    p_organization_id,
    p_submission_id,
    p_action,
    p_awarded_points,
    p_review_notes,
    p_actor_user_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_delete_member_point_submission_request(p_organization_id uuid, p_profile_id uuid, p_submission_id uuid, p_actor_user_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s plugin_data.csf_point_submissions%ROWTYPE; d plugin_data.csf_member_submission_deletions%ROWTYPE;
BEGIN
  IF p_request_id IS NULL OR p_submission_id IS NULL THEN RAISE EXCEPTION 'A submission and stable request identifier are required.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a JOIN plugin_data.csf_profiles p ON p.id=a.profile_id AND p.organization_id=a.organization_id
    JOIN public.organization_members m ON m.organization_id=a.organization_id AND m.user_id=a.user_id
    WHERE a.organization_id=p_organization_id AND a.profile_id=p_profile_id AND a.user_id=p_actor_user_id
      AND a.status='verified' AND p.record_status='active' AND m.status='active') THEN
    RAISE EXCEPTION 'Only the connected member may unsubmit this submission.' USING ERRCODE='42501';
  END IF;
  PERFORM plugin_data.csf_assert_point_actor_authority(p_organization_id,p_actor_user_id,ARRAY[]::text[]);
  SELECT * INTO s FROM plugin_data.csf_point_submissions WHERE id=p_submission_id;
  IF FOUND THEN
    IF s.organization_id<>p_organization_id OR s.profile_id<>p_profile_id OR s.source NOT IN ('student','attendance') THEN
      RAISE EXCEPTION 'Only the connected member may unsubmit this submission.' USING ERRCODE='42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||s.term_id::text,0));
  END IF;
  PERFORM plugin_data.csf_assert_member_submission_deletion_owner(p_organization_id,p_profile_id,p_actor_user_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('csf-member-delete:'||p_submission_id,0));
  SELECT * INTO d FROM plugin_data.csf_member_submission_deletions WHERE submission_id=p_submission_id;
  IF FOUND THEN
    IF d.organization_id<>p_organization_id OR d.profile_id<>p_profile_id OR d.actor_user_id<>p_actor_user_id OR d.request_id<>p_request_id THEN
      RAISE EXCEPTION 'Only the connected member may unsubmit this submission.' USING ERRCODE='42501';
    END IF;
    RETURN plugin_data.csf_deleted_submission_result(p_organization_id,p_submission_id);
  END IF;
  SELECT * INTO s FROM plugin_data.csf_point_submissions WHERE id=p_submission_id;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM plugin_data.csf_member_submission_deletion_paths WHERE submission_id=p_submission_id) THEN
      RAISE EXCEPTION 'Proof cleanup is still pending. Retry shortly.' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('submissionId',p_submission_id,'status','deleted','files','[]'::jsonb);
  END IF;
  IF s.organization_id<>p_organization_id OR s.profile_id<>p_profile_id OR s.source NOT IN ('student','attendance') THEN
    RAISE EXCEPTION 'Only the connected member may unsubmit this submission.' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||s.term_id::text,0));
  SELECT * INTO s FROM plugin_data.csf_point_submissions WHERE id=p_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM plugin_data.csf_member_submission_deletion_paths WHERE submission_id=p_submission_id) THEN
      RAISE EXCEPTION 'Proof cleanup is still pending. Retry shortly.' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('submissionId',p_submission_id,'status','deleted','files','[]'::jsonb);
  END IF;
  IF s.status NOT IN ('draft','submitted','needs_action','withdrawn')
    OR EXISTS (SELECT 1 FROM plugin_data.csf_submission_reviews WHERE submission_id=s.id AND action IN ('approved','rejected','duplicate'))
    OR EXISTS (SELECT 1 FROM plugin_data.csf_credit_records WHERE submission_id=s.id)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_point_appeals WHERE submission_id=s.id)
  THEN RAISE EXCEPTION 'Reviewed or awarded submissions require the correction workflow.' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_terms t WHERE t.id=s.term_id AND t.organization_id=p_organization_id AND t.lifecycle_status='open' AND t.is_current)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_review_periods r WHERE r.organization_id=p_organization_id AND r.term_id=s.term_id AND r.kind='member_points' AND r.status='open'
      AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_review_decisions x WHERE x.organization_id=p_organization_id AND x.period_id=r.id AND x.subject_kind='profile' AND x.subject_id=p_profile_id AND x.submission_lock_override))
  THEN RAISE EXCEPTION 'Point submissions are locked for this semester.' USING ERRCODE='55000'; END IF;

  PERFORM 1 FROM plugin_data.csf_term_memberships m WHERE m.organization_id=p_organization_id AND m.profile_id=p_profile_id AND m.term_id=s.term_id AND m.status IN ('active','accepted') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'An accepted or active semester membership is required to unsubmit points.' USING ERRCODE='55000'; END IF;
  -- Hold each destination before examining its export ledger. The export worker
  -- takes the same destination lock before claiming a row, so an unsubmitted
  -- claim cannot be sent after this transaction decides that no send started.
  PERFORM destination.id FROM plugin_data.csf_sheet_sync_destinations destination
  WHERE destination.organization_id=p_organization_id AND destination.id IN (
    SELECT b.destination_id FROM plugin_data.csf_sheet_sync_bindings b
      WHERE b.organization_id=p_organization_id AND b.record_kind='point_submission' AND b.record_id=s.id
    UNION SELECT l.destination_id FROM plugin_data.csf_sheet_writeback_ledger l
      WHERE l.organization_id=p_organization_id AND l.record_kind='point_submission' AND l.record_id=s.id AND l.destination_id IS NOT NULL
  ) ORDER BY destination.id FOR NO KEY UPDATE;
  PERFORM b.id FROM plugin_data.csf_sheet_sync_bindings b
    WHERE b.organization_id=p_organization_id AND b.record_kind='point_submission' AND b.record_id=s.id
    ORDER BY b.id FOR UPDATE;
  PERFORM l.id FROM plugin_data.csf_sheet_writeback_ledger l
    WHERE l.organization_id=p_organization_id AND l.record_kind='point_submission' AND l.record_id=s.id
    ORDER BY l.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_sync_bindings b
      WHERE b.organization_id=p_organization_id AND b.record_kind='point_submission' AND b.record_id=s.id
        AND (b.last_export_version IS NOT NULL OR b.remote_version IS NOT NULL
          OR b.last_seen_request_source_version IS NOT NULL OR b.last_seen_request <> '{}'::jsonb
          OR b.thread_bindings <> '{}'::jsonb
          OR EXISTS (SELECT 1 FROM plugin_data.csf_sheet_sync_local_messages m WHERE m.binding_id=b.id)))
    OR EXISTS (SELECT 1 FROM plugin_data.csf_sheet_sync_changes c
      WHERE c.organization_id=p_organization_id AND c.record_kind='point_submission' AND c.record_id=s.id)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger l
      WHERE l.organization_id=p_organization_id AND l.record_kind='point_submission' AND l.record_id=s.id
        AND (l.status NOT IN ('pending_export','superseded') OR l.attempts<>0
          OR l.attempt_receipts<>'{}'::jsonb OR l.lease_token IS NOT NULL OR l.sent_at IS NOT NULL))
  THEN RAISE EXCEPTION 'This submission has synchronized records. Use the correction workflow.' USING ERRCODE='55000'; END IF;

  -- Mail campaigns own external delivery evidence. They require the correction
  -- workflow; unsubmit must not claim to erase an already handed-off email.
  PERFORM 1 FROM plugin_data.csf_publication_notification_deliveries n
  JOIN plugin_data.csf_publication_events e ON e.id=n.event_id
  WHERE e.organization_id=p_organization_id AND e.source_kind='point_submission' AND e.source_id=s.id FOR UPDATE OF n;
  PERFORM 1 FROM plugin_data.csf_publication_events e
  WHERE e.organization_id=p_organization_id AND e.source_kind='point_submission' AND e.source_id=s.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_publication_notification_deliveries n JOIN plugin_data.csf_publication_events e ON e.id=n.event_id
    WHERE e.organization_id=p_organization_id AND e.source_kind='point_submission' AND e.source_id=s.id AND n.status='processing')
    OR EXISTS (SELECT 1 FROM plugin_data.csf_communication_campaigns c JOIN plugin_data.csf_publication_events e ON e.id=c.source_publication_event_id
      WHERE e.organization_id=p_organization_id AND e.source_kind='point_submission' AND e.source_id=s.id)
  THEN RAISE EXCEPTION 'This submission has a review notice in delivery. Use the correction workflow.' USING ERRCODE='55000'; END IF;

  INSERT INTO plugin_data.csf_member_submission_deletions(organization_id,submission_id,profile_id,actor_user_id,request_id,authorization_xid)
  VALUES(p_organization_id,s.id,p_profile_id,p_actor_user_id,p_request_id,txid_current());
  INSERT INTO plugin_data.csf_member_submission_deletion_paths(organization_id,submission_id,bucket,object_path)
  SELECT p_organization_id,s.id,f.bucket,f.object_path FROM plugin_data.csf_submission_files f WHERE f.submission_id=s.id
  UNION SELECT p_organization_id,s.id,'plugins',r.object_path FROM plugin_data.csf_submission_edit_requests r WHERE r.submission_id=s.id AND r.object_path IS NOT NULL
  ON CONFLICT(bucket,object_path) DO NOTHING;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_submission_files f JOIN plugin_data.csf_member_submission_deletion_paths p ON p.bucket=f.bucket AND p.object_path=f.object_path
      WHERE f.submission_id=s.id AND (p.organization_id<>p_organization_id OR p.submission_id<>s.id))
    OR EXISTS (SELECT 1 FROM plugin_data.csf_submission_edit_requests r JOIN plugin_data.csf_member_submission_deletion_paths p ON p.bucket='plugins' AND p.object_path=r.object_path
      WHERE r.submission_id=s.id AND (p.organization_id<>p_organization_id OR p.submission_id<>s.id))
  THEN RAISE EXCEPTION 'Proof cleanup is already owned by another record.' USING ERRCODE='55000'; END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_member_submission_deletion_paths p JOIN plugin_data.csf_submission_files f
    ON f.bucket=p.bucket AND f.object_path=p.object_path WHERE p.submission_id=s.id AND f.submission_id<>s.id)
  THEN RAISE EXCEPTION 'Proof is shared with another record. Use the correction workflow.' USING ERRCODE='55000'; END IF;
  INSERT INTO plugin_data.csf_storage_deletion_queue(organization_id,bucket,object_path)
  SELECT organization_id,bucket,object_path FROM plugin_data.csf_member_submission_deletion_paths WHERE submission_id=s.id
  ON CONFLICT(bucket,object_path) DO NOTHING;

  DELETE FROM public.notifications n USING plugin_data.csf_publication_events e
  WHERE e.organization_id=p_organization_id AND e.source_kind='point_submission' AND e.source_id=s.id AND n.dedupe_key='csf-publication:'||e.id::text;
  DELETE FROM plugin_data.csf_publication_events WHERE organization_id=p_organization_id AND source_kind='point_submission' AND source_id=s.id;
  DELETE FROM plugin_data.csf_sheet_sync_changes WHERE organization_id=p_organization_id AND record_kind='point_submission' AND record_id=s.id;
  DELETE FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND record_kind='point_submission' AND record_id=s.id;
  DELETE FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id=p_organization_id AND record_kind='point_submission' AND record_id=s.id;
  DELETE FROM plugin_data.csf_admin_audit_events WHERE organization_id=p_organization_id AND target_type='csf_point_submissions' AND target_id=s.id;
  DELETE FROM plugin_data.csf_point_submissions WHERE id=s.id;
  DELETE FROM plugin_data.csf_sheet_sync_changes WHERE organization_id=p_organization_id AND record_kind='point_submission' AND record_id=s.id;
  DELETE FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND record_kind='point_submission' AND record_id=s.id;
  DELETE FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id=p_organization_id AND record_kind='point_submission' AND record_id=s.id;
  UPDATE plugin_data.csf_member_submission_deletions SET authorization_xid=NULL WHERE submission_id=s.id;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_member_submission_deletion_paths WHERE submission_id=s.id) THEN
    DELETE FROM plugin_data.csf_member_submission_deletions WHERE submission_id=s.id;
  END IF;
  RETURN plugin_data.csf_deleted_submission_result(p_organization_id,s.id);
END;
$function$;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_point_submission_eligibility(
  uuid, uuid, uuid, uuid, uuid, text, numeric, text, boolean, boolean, boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_point_submission_eligibility(
  uuid, uuid, uuid, uuid, uuid, text, numeric, text, boolean, boolean, boolean
) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_review_point_submission_v2(
  uuid, uuid, text, numeric, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_submission_v2(
  uuid, uuid, text, numeric, text, uuid
) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_delete_member_point_submission_request(
  uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_delete_member_point_submission_request(
  uuid, uuid, uuid, uuid, uuid
) TO postgres, service_role;

-- ===========================================================================
-- Part 1: partner-project linking
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_project_is_linkable(
  p_organization_id uuid,
  p_project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects AS project
    WHERE project.id = p_project_id
      AND p_organization_id IS NOT NULL
      AND (
        project.organization_id = p_organization_id
        OR (
          project.visibility = 'public'
          AND coalesce(project.workflow_status, 'published') = 'published'
          AND project.status IS DISTINCT FROM 'cancelled'
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_project_is_linkable(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_project_is_linkable(uuid, uuid) TO postgres;
COMMENT ON FUNCTION plugin_data.csf_project_is_linkable(uuid, uuid) IS
  'Partner metadata eligibility: the chapter''s own project, or a public, published, uncancelled project of any organizer. Grants no roster or attendance access.';

CREATE OR REPLACE FUNCTION plugin_data.csf_create_activity_locked_impl(p_organization_id uuid, p_term_id uuid, p_cohort_id uuid, p_activity jsonb, p_actor_user_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_activity plugin_data.csf_opportunities%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request jsonb;
  v_status text;
  v_title text;
  v_signup_mode text;
  v_linked_project_id uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_rules_input jsonb := p_activity -> 'earningRules';
  v_normalized jsonb;
  v_rules jsonb;
  v_point_value numeric;
  v_point_type text;
  v_external_capacity text;
  v_signup_links jsonb;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_opportunities'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable activity request identifier is required.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_activity) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Activity payload must be an object.';
  END IF;

  v_status := coalesce(nullif(pg_catalog.btrim(p_activity ->> 'status'), ''), 'draft');
  v_title := nullif(pg_catalog.btrim(p_activity ->> 'title'), '');
  v_signup_mode := coalesce(nullif(pg_catalog.btrim(p_activity ->> 'signupMode'), ''), 'external');
  BEGIN
    v_linked_project_id := nullif(p_activity ->> 'linkedProjectId', '')::uuid;
    v_starts_at := nullif(p_activity ->> 'startsAt', '')::timestamptz;
    v_ends_at := nullif(p_activity ->> 'endsAt', '')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Activity dates and linked project must be valid.';
  END;

  IF p_term_id IS NULL THEN RAISE EXCEPTION 'A CSF semester is required.'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'Activity title is required.'; END IF;
  IF v_status NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'New activities must be saved as draft or published.'; END IF;
  IF v_signup_mode NOT IN ('external', 'lets_assist_project', 'none') THEN RAISE EXCEPTION 'Choose a valid activity signup source.'; END IF;
  IF v_ends_at IS NOT NULL AND v_starts_at IS NULL THEN
    RAISE EXCEPTION 'Add a start before giving the activity an end time.';
  END IF;
  IF v_starts_at IS NOT NULL AND v_ends_at IS NOT NULL AND v_ends_at < v_starts_at THEN
    RAISE EXCEPTION 'The activity end time must be after its start time.';
  END IF;
  IF v_signup_mode = 'lets_assist_project' AND v_linked_project_id IS NULL THEN
    RAISE EXCEPTION 'A Let''s Assist project is required for this signup source.';
  END IF;
  -- A stored link only exists for Let's Assist project signups.
  IF v_signup_mode <> 'lets_assist_project' THEN
    v_linked_project_id := NULL;
  END IF;
  IF v_status = 'published' AND v_signup_mode = 'external'
    AND nullif(pg_catalog.btrim(p_activity ->> 'signupUrl'), '') IS NULL THEN
    RAISE EXCEPTION 'External signup posts need a signup URL.';
  END IF;

  -- Versioned earning rules are optional; a payload without them keeps the
  -- legacy fixed award. With rules, the stored point value is the per-submission
  -- ceiling and the stored point type is the lead category.
  IF v_rules_input IS NOT NULL AND pg_catalog.jsonb_typeof(v_rules_input) <> 'null' THEN
    v_normalized := plugin_data.csf_normalize_earning_rules(v_rules_input);
    v_rules := v_normalized -> 'rules';
    v_point_value := (v_normalized ->> 'ceilingPoints')::numeric;
    v_point_type := v_normalized ->> 'ceilingPointType';
  ELSE
    v_rules := NULL;
    v_point_value := coalesce((p_activity ->> 'pointValue')::numeric, 0);
    v_point_type := coalesce(nullif(p_activity ->> 'pointType', ''), 'non_drive');
  END IF;
  v_external_capacity := nullif(pg_catalog.btrim(coalesce(p_activity ->> 'externalCapacity', '')), '');
  IF v_external_capacity IS NOT NULL AND pg_catalog.length(v_external_capacity) > 500 THEN
    RAISE EXCEPTION 'External volunteer capacity must be 500 characters or fewer.';
  END IF;
  v_signup_links := plugin_data.csf_normalize_signup_links(p_activity -> 'signupLinks');

  v_request := pg_catalog.jsonb_build_object(
    'termId', p_term_id,
    'cohortId', p_cohort_id,
    'activity', p_activity
  );
  -- Project before request, semester, or CSF row locks (contract 1.9).
  IF v_linked_project_id IS NOT NULL THEN
    PERFORM 1 FROM public.projects AS project
    WHERE project.id = v_linked_project_id
    FOR KEY SHARE;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_atomic_request:' || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'activity.create'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_opportunities'
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That activity request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'activityId', v_receipt.target_id,
      'status', v_receipt.after_data ->> 'status',
      'correlationId', p_request_id,
      'idempotent', true
    );
  END IF;

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF semester was not found in this organization.'; END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Activities cannot be created in a closed or archived semester.';
  END IF;

  IF p_cohort_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_cohorts AS cohort
    JOIN plugin_data.csf_cohort_terms AS cohort_term
      ON cohort_term.organization_id = cohort.organization_id
      AND cohort_term.cohort_id = cohort.id
      AND cohort_term.term_id = p_term_id
      AND cohort_term.status <> 'archived'
    WHERE cohort.organization_id = p_organization_id
      AND cohort.id = p_cohort_id
  ) THEN
    RAISE EXCEPTION 'That semester is not active for the selected graduating class in this organization.';
  END IF;
  IF v_linked_project_id IS NOT NULL
    AND NOT plugin_data.csf_project_is_linkable(p_organization_id, v_linked_project_id) THEN
    RAISE EXCEPTION 'Linked project is not available to this organization.';
  END IF;

  INSERT INTO plugin_data.csf_opportunities (
    organization_id, term_id, cohort_id, title, body, starts_at, ends_at,
    location, signup_url, contact_email, point_value, point_type, point_cap,
    signup_mode, requires_point_submission, evidence_policy, source_organization,
    created_by_user_id, status, linked_project_id, published_at,
    earning_rules, earning_rules_version, external_capacity, signup_links
  ) VALUES (
    p_organization_id,
    p_term_id,
    p_cohort_id,
    v_title,
    coalesce(nullif(p_activity ->> 'body', ''), v_title),
    v_starts_at,
    v_ends_at,
    nullif(p_activity ->> 'location', ''),
    CASE
      WHEN v_signup_mode = 'lets_assist_project' THEN '/projects/' || v_linked_project_id::text
      ELSE nullif(p_activity ->> 'signupUrl', '')
    END,
    nullif(p_activity ->> 'contactEmail', ''),
    v_point_value,
    v_point_type,
    nullif(p_activity ->> 'pointCap', '')::numeric,
    v_signup_mode,
    coalesce((p_activity ->> 'requiresPointSubmission')::boolean, true),
    coalesce(nullif(p_activity ->> 'evidencePolicy', ''), 'required'),
    nullif(p_activity ->> 'sourceOrganization', ''),
    p_actor_user_id,
    v_status,
    v_linked_project_id,
    CASE WHEN v_status = 'published' THEN pg_catalog.now() ELSE NULL END,
    v_rules,
    1,
    v_external_capacity,
    v_signup_links
  ) RETURNING * INTO v_activity;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'activity.create',
    'csf_opportunities', v_activity.id, p_term_id,
    pg_catalog.jsonb_build_object(
      'request', v_request,
      'title', v_activity.title,
      'status', v_activity.status,
      'cohortId', v_activity.cohort_id,
      'linkedProjectId', v_activity.linked_project_id,
      'earningRulesVersion', v_activity.earning_rules_version
    ),
    p_request_id, 'activity_created'
  );

  RETURN pg_catalog.jsonb_build_object(
    'activityId', v_activity.id,
    'status', v_activity.status,
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_update_activity_locked_impl(p_organization_id uuid, p_activity_id uuid, p_term_id uuid, p_cohort_id uuid, p_activity jsonb, p_actor_user_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_before plugin_data.csf_opportunities%ROWTYPE;
  v_after plugin_data.csf_opportunities%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request jsonb;
  v_title text;
  v_signup_mode text;
  v_linked_project_id uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_rules_input jsonb := p_activity -> 'earningRules';
  v_normalized jsonb;
  v_rules jsonb;
  v_point_value numeric;
  v_point_type text;
  v_point_cap numeric;
  v_external_capacity text;
  v_signup_links jsonb;
  v_rules_version integer;
  v_stored_project_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_opportunities') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable activity request identifier is required.'; END IF;
  IF p_activity_id IS NULL OR p_term_id IS NULL THEN RAISE EXCEPTION 'Activity and semester are required.'; END IF;
  IF pg_catalog.jsonb_typeof(p_activity) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Activity payload must be an object.'; END IF;

  v_title := nullif(pg_catalog.btrim(p_activity ->> 'title'), '');
  v_signup_mode := coalesce(nullif(pg_catalog.btrim(p_activity ->> 'signupMode'), ''), 'external');
  BEGIN
    v_linked_project_id := nullif(p_activity ->> 'linkedProjectId', '')::uuid;
    v_starts_at := nullif(p_activity ->> 'startsAt', '')::timestamptz;
    v_ends_at := nullif(p_activity ->> 'endsAt', '')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Activity dates and linked project must be valid.';
  END;
  IF v_title IS NULL THEN RAISE EXCEPTION 'Activity title is required.'; END IF;
  IF v_signup_mode NOT IN ('external', 'lets_assist_project', 'none') THEN RAISE EXCEPTION 'Choose a valid activity signup source.'; END IF;
  IF v_ends_at IS NOT NULL AND v_starts_at IS NULL THEN
    RAISE EXCEPTION 'Add a start before giving the activity an end time.';
  END IF;
  IF v_starts_at IS NOT NULL AND v_ends_at IS NOT NULL AND v_ends_at < v_starts_at THEN
    RAISE EXCEPTION 'The activity end time must be after its start time.';
  END IF;
  IF v_signup_mode = 'lets_assist_project' AND v_linked_project_id IS NULL THEN
    RAISE EXCEPTION 'A Let''s Assist project is required for this signup source.';
  END IF;
  -- A stored link only exists for Let's Assist project signups.
  IF v_signup_mode <> 'lets_assist_project' THEN
    v_linked_project_id := NULL;
  END IF;

  IF v_rules_input IS NOT NULL AND pg_catalog.jsonb_typeof(v_rules_input) <> 'null' THEN
    v_normalized := plugin_data.csf_normalize_earning_rules(v_rules_input);
    v_rules := v_normalized -> 'rules';
    v_point_value := (v_normalized ->> 'ceilingPoints')::numeric;
    v_point_type := v_normalized ->> 'ceilingPointType';
  ELSE
    v_rules := NULL;
    v_point_value := coalesce((p_activity ->> 'pointValue')::numeric, 0);
    v_point_type := coalesce(nullif(p_activity ->> 'pointType', ''), 'non_drive');
  END IF;
  v_point_cap := nullif(p_activity ->> 'pointCap', '')::numeric;
  v_external_capacity := nullif(pg_catalog.btrim(coalesce(p_activity ->> 'externalCapacity', '')), '');
  IF v_external_capacity IS NOT NULL AND pg_catalog.length(v_external_capacity) > 500 THEN
    RAISE EXCEPTION 'External volunteer capacity must be 500 characters or fewer.';
  END IF;
  v_signup_links := plugin_data.csf_normalize_signup_links(p_activity -> 'signupLinks');

  v_request := pg_catalog.jsonb_build_object(
    'activityId', p_activity_id,
    'termId', p_term_id,
    'cohortId', p_cohort_id,
    'activity', p_activity
  );
  -- Stored and requested projects before request, semester, or CSF row locks
  -- (contract 1.9). The V128 wrapper's staff-access lock serializes activity
  -- edits, so the stored link read here stays current.
  SELECT activity.linked_project_id INTO v_stored_project_id
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_activity_id;
  PERFORM 1 FROM public.projects AS project
  WHERE project.id IN (v_stored_project_id, v_linked_project_id)
  ORDER BY project.id
  FOR KEY SHARE;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_atomic_request:' || p_organization_id::text || ':' || p_request_id::text,
    0
  ));
  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'activity.update'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_opportunities'
      OR v_receipt.target_id IS DISTINCT FROM p_activity_id
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That activity request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'activityId', p_activity_id,
      'status', v_receipt.after_data ->> 'status',
      'correlationId', p_request_id,
      'idempotent', true
    );
  END IF;

  SELECT activity.* INTO v_before
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_activity_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF activity was not found in this organization.'; END IF;
  IF v_before.status IN ('closed', 'cancelled', 'archived') THEN
    RAISE EXCEPTION 'Closed, cancelled, or archived activities cannot be edited.';
  END IF;
  IF v_before.status = 'published' AND v_signup_mode = 'external'
    AND nullif(pg_catalog.btrim(p_activity ->> 'signupUrl'), '') IS NULL THEN
    RAISE EXCEPTION 'Published external-signup activities require a signup URL.';
  END IF;

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF semester was not found in this organization.'; END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Activities in a closed or archived semester cannot be edited.';
  END IF;
  IF p_cohort_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_cohorts AS cohort
    JOIN plugin_data.csf_cohort_terms AS cohort_term
      ON cohort_term.organization_id = cohort.organization_id
      AND cohort_term.cohort_id = cohort.id
      AND cohort_term.term_id = p_term_id
      AND cohort_term.status <> 'archived'
    WHERE cohort.organization_id = p_organization_id AND cohort.id = p_cohort_id
  ) THEN
    RAISE EXCEPTION 'That semester is not active for the selected graduating class in this organization.';
  END IF;
  IF v_before.linked_project_id IS DISTINCT FROM v_stored_project_id THEN
    RAISE EXCEPTION 'CSF activity changed; refresh and try again.';
  END IF;
  IF v_linked_project_id IS NOT NULL
    AND v_linked_project_id IS DISTINCT FROM v_before.linked_project_id
    AND NOT plugin_data.csf_project_is_linkable(p_organization_id, v_linked_project_id) THEN
    RAISE EXCEPTION 'Linked project is not available to this organization.';
  END IF;

  -- Any change to how points are earned starts a new rules version. Existing
  -- submissions keep the snapshot they were evaluated under.
  v_rules_version := CASE
    WHEN v_before.earning_rules IS DISTINCT FROM v_rules
      OR v_before.point_value IS DISTINCT FROM v_point_value::numeric(6,2)
      OR v_before.point_type IS DISTINCT FROM v_point_type
      OR v_before.point_cap IS DISTINCT FROM v_point_cap::numeric(6,2)
    THEN v_before.earning_rules_version + 1
    ELSE v_before.earning_rules_version
  END;

  UPDATE plugin_data.csf_opportunities
  SET term_id = p_term_id,
      cohort_id = p_cohort_id,
      title = v_title,
      body = coalesce(nullif(p_activity ->> 'body', ''), v_title),
      starts_at = v_starts_at,
      ends_at = v_ends_at,
      location = nullif(p_activity ->> 'location', ''),
      signup_url = CASE
        WHEN v_signup_mode = 'lets_assist_project' THEN '/projects/' || v_linked_project_id::text
        ELSE nullif(p_activity ->> 'signupUrl', '')
      END,
      contact_email = nullif(p_activity ->> 'contactEmail', ''),
      point_value = v_point_value,
      point_type = v_point_type,
      point_cap = v_point_cap,
      signup_mode = v_signup_mode,
      requires_point_submission = coalesce((p_activity ->> 'requiresPointSubmission')::boolean, true),
      evidence_policy = coalesce(nullif(p_activity ->> 'evidencePolicy', ''), 'required'),
      source_organization = nullif(p_activity ->> 'sourceOrganization', ''),
      linked_project_id = v_linked_project_id,
      earning_rules = v_rules,
      earning_rules_version = v_rules_version,
      external_capacity = v_external_capacity,
      signup_links = v_signup_links,
      updated_at = pg_catalog.now()
  WHERE organization_id = p_organization_id AND id = p_activity_id
  RETURNING * INTO v_after;

  -- Organizer evidence for a project this activity no longer links is stale.
  IF v_after.linked_project_id IS DISTINCT FROM v_before.linked_project_id THEN
    PERFORM plugin_data.csf_invalidate_activity_attendance_evidence(
      p_organization_id, p_activity_id, 'activity_relinked', v_after.linked_project_id
    );
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'activity.update',
    'csf_opportunities', p_activity_id, p_term_id,
    pg_catalog.jsonb_build_object(
      'title', v_before.title, 'status', v_before.status, 'termId', v_before.term_id,
      'cohortId', v_before.cohort_id, 'linkedProjectId', v_before.linked_project_id,
      'earningRulesVersion', v_before.earning_rules_version
    ),
    pg_catalog.jsonb_build_object(
      'request', v_request,
      'title', v_after.title, 'status', v_after.status, 'termId', v_after.term_id,
      'cohortId', v_after.cohort_id, 'linkedProjectId', v_after.linked_project_id,
      'earningRulesVersion', v_after.earning_rules_version
    ),
    p_request_id, 'activity_updated'
  );
  RETURN pg_catalog.jsonb_build_object(
    'activityId', v_after.id,
    'status', v_after.status,
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_link_activity_project_locked_impl(p_organization_id uuid, p_activity_id uuid, p_project_id uuid, p_actor_user_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_before plugin_data.csf_opportunities%ROWTYPE;
  v_after plugin_data.csf_opportunities%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request jsonb;
  v_stored_project_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_opportunities') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable project-link request identifier is required.'; END IF;
  IF p_activity_id IS NULL OR p_project_id IS NULL THEN RAISE EXCEPTION 'Activity and project are required.'; END IF;

  v_request := pg_catalog.jsonb_build_object('activityId', p_activity_id, 'projectId', p_project_id);
  -- Stored and requested projects before request or CSF row locks (1.9).
  SELECT activity.linked_project_id INTO v_stored_project_id
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_activity_id;
  PERFORM 1 FROM public.projects AS project
  WHERE project.id IN (v_stored_project_id, p_project_id)
  ORDER BY project.id
  FOR KEY SHARE;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_atomic_request:' || p_organization_id::text || ':' || p_request_id::text,
    0
  ));
  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'opportunity.link_project'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_opportunities'
      OR v_receipt.target_id IS DISTINCT FROM p_activity_id
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That project-link request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'activityId', p_activity_id, 'projectId', p_project_id,
      'correlationId', p_request_id, 'idempotent', true
    );
  END IF;

  SELECT activity.* INTO v_before
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_activity_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF activity was not found in this organization.'; END IF;
  IF v_before.linked_project_id IS DISTINCT FROM v_stored_project_id THEN
    RAISE EXCEPTION 'CSF activity changed; refresh and try again.';
  END IF;
  IF p_project_id IS DISTINCT FROM v_before.linked_project_id
    AND NOT plugin_data.csf_project_is_linkable(p_organization_id, p_project_id) THEN
    RAISE EXCEPTION 'Linked project is not available to this organization.';
  END IF;

  UPDATE plugin_data.csf_opportunities
  SET signup_mode = 'lets_assist_project',
      linked_project_id = p_project_id,
      signup_url = '/projects/' || p_project_id::text,
      updated_at = pg_catalog.now()
  WHERE organization_id = p_organization_id AND id = p_activity_id
  RETURNING * INTO v_after;

  IF v_after.linked_project_id IS DISTINCT FROM v_before.linked_project_id THEN
    PERFORM plugin_data.csf_invalidate_activity_attendance_evidence(
      p_organization_id, p_activity_id, 'activity_relinked', v_after.linked_project_id
    );
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'opportunity.link_project',
    'csf_opportunities', p_activity_id, v_after.term_id,
    pg_catalog.jsonb_build_object(
      'signupMode', v_before.signup_mode,
      'linkedProjectId', v_before.linked_project_id,
      'signupUrl', v_before.signup_url
    ),
    pg_catalog.jsonb_build_object(
      'request', v_request,
      'signupMode', v_after.signup_mode,
      'linkedProjectId', v_after.linked_project_id,
      'signupUrl', v_after.signup_url
    ),
    p_request_id, 'activity_project_linked'
  );
  RETURN pg_catalog.jsonb_build_object(
    'activityId', p_activity_id, 'projectId', p_project_id,
    'correlationId', p_request_id, 'idempotent', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_activity_status_locked_impl(p_organization_id uuid, p_activity_id uuid, p_status text, p_reason text, p_actor_user_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_before plugin_data.csf_opportunities%ROWTYPE;
  v_after plugin_data.csf_opportunities%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_lock_term_id uuid;
  v_request jsonb;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_now timestamptz := pg_catalog.now();
  v_target_status text := CASE WHEN p_status = 'restored' THEN 'published' ELSE p_status END;
  v_stored_project_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_opportunities'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable activity request identifier is required.';
  END IF;
  IF p_status IS NULL
    OR p_status NOT IN ('published', 'restored', 'closed', 'cancelled', 'archived') THEN
    RAISE EXCEPTION 'Invalid activity status.';
  END IF;
  IF p_status = 'cancelled' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required.';
  END IF;

  -- Project before semester, request, or CSF row locks (contract 1.9).
  SELECT activity.linked_project_id INTO v_stored_project_id
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_activity_id;
  IF v_stored_project_id IS NOT NULL THEN
    PERFORM 1 FROM public.projects AS project
    WHERE project.id = v_stored_project_id
    FOR KEY SHARE;
  END IF;

  IF v_target_status = 'published' THEN
    SELECT activity.term_id
    INTO v_lock_term_id
    FROM plugin_data.csf_opportunities AS activity
    WHERE activity.organization_id = p_organization_id
      AND activity.id = p_activity_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CSF activity was not found in this organization.';
    END IF;
    IF v_lock_term_id IS NULL THEN
      RAISE EXCEPTION 'A semester is required before publishing.';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_organization_id::text || ':' || v_lock_term_id::text,
        0
      )
    );
  END IF;

  v_request := pg_catalog.jsonb_build_object(
    'activityId', p_activity_id,
    'status', p_status,
    'reason', v_reason
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_atomic_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );
  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'activity.status_change'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_opportunities'
      OR v_receipt.target_id IS DISTINCT FROM p_activity_id
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That activity request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'activityId', p_activity_id,
      'status', v_target_status,
      'correlationId', p_request_id,
      'idempotent', true
    );
  END IF;

  SELECT activity.*
  INTO v_before
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id
    AND activity.id = p_activity_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF activity was not found in this organization.';
  END IF;
  IF v_before.status = 'archived' THEN
    RAISE EXCEPTION 'Archived activities cannot be changed.';
  END IF;
  IF p_status = 'published' AND v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft activities can be published.';
  END IF;
  IF p_status = 'restored' AND v_before.status <> 'closed' THEN
    RAISE EXCEPTION 'Only closed activities can be restored.';
  END IF;
  IF p_status IN ('closed', 'cancelled') AND v_before.status <> 'published' THEN
    RAISE EXCEPTION 'Only published activities can be closed or cancelled.';
  END IF;
  IF v_target_status = 'published'
    AND v_before.term_id IS NULL THEN
    RAISE EXCEPTION 'A semester is required before publishing.';
  END IF;

  IF v_target_status = 'published' AND v_before.ends_at IS NOT NULL AND v_before.starts_at IS NULL THEN
    RAISE EXCEPTION 'Add a start before giving the activity an end time.';
  END IF;
  IF v_target_status = 'published' AND v_before.starts_at IS NOT NULL AND v_before.ends_at IS NOT NULL AND v_before.ends_at < v_before.starts_at THEN
    RAISE EXCEPTION 'The activity end time must be after its start time.';
  END IF;

  IF v_target_status = 'published' THEN
    IF v_before.term_id IS DISTINCT FROM v_lock_term_id THEN
      RAISE EXCEPTION 'CSF activity semester changed; refresh and try again.';
    END IF;

    SELECT term.*
    INTO v_term
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = v_before.term_id
    FOR UPDATE;
    IF NOT FOUND OR v_term.lifecycle_status <> 'open' THEN
      RAISE EXCEPTION 'Activities cannot be published in a closed or archived semester.';
    END IF;
  END IF;

  IF v_before.linked_project_id IS DISTINCT FROM v_stored_project_id THEN
    RAISE EXCEPTION 'CSF activity changed; refresh and try again.';
  END IF;
  IF v_target_status = 'published'
    AND v_before.signup_mode = 'lets_assist_project'
    AND (v_before.linked_project_id IS NULL
      OR NOT plugin_data.csf_project_is_linkable(p_organization_id, v_before.linked_project_id)) THEN
    RAISE EXCEPTION 'Linked project is not available to this organization.';
  END IF;

  UPDATE plugin_data.csf_opportunities
  SET status = v_target_status,
      published_at = CASE
        WHEN v_target_status = 'published' THEN coalesce(published_at, v_now)
        ELSE published_at
      END,
      closed_at = CASE
        WHEN p_status = 'closed' THEN v_now
        WHEN v_target_status = 'published' THEN NULL
        ELSE closed_at
      END,
      cancelled_at = CASE
        WHEN p_status = 'cancelled' THEN v_now
        ELSE cancelled_at
      END,
      cancellation_reason = CASE
        WHEN p_status = 'cancelled' THEN v_reason
        ELSE cancellation_reason
      END,
      archived_at = CASE
        WHEN p_status = 'archived' THEN v_now
        ELSE archived_at
      END,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_activity_id
  RETURNING *
  INTO v_after;

  IF v_target_status IN ('cancelled', 'archived') THEN
    PERFORM plugin_data.csf_invalidate_activity_attendance_evidence(
      p_organization_id, p_activity_id, 'activity_unavailable', NULL
    );
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'activity.status_change',
    'csf_opportunities',
    p_activity_id,
    v_after.term_id,
    pg_catalog.jsonb_build_object('status', v_before.status),
    pg_catalog.jsonb_build_object(
      'request', v_request,
      'status', v_after.status,
      'reason', v_reason
    ),
    p_request_id,
    CASE
      WHEN p_status = 'restored' THEN 'activity_restored'
      WHEN p_status = 'cancelled' THEN 'activity_cancelled'
      ELSE 'activity_status_changed'
    END
  );
  RETURN pg_catalog.jsonb_build_object(
    'activityId', p_activity_id,
    'status', v_after.status,
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION plugin_data.csf_create_activity_locked_impl(uuid, uuid, uuid, jsonb, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_activity_locked_impl(uuid, uuid, uuid, jsonb, uuid, uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_update_activity_locked_impl(uuid, uuid, uuid, uuid, jsonb, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_activity_locked_impl(uuid, uuid, uuid, uuid, jsonb, uuid, uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_link_activity_project_locked_impl(uuid, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_link_activity_project_locked_impl(uuid, uuid, uuid, uuid, uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_set_activity_status_locked_impl(uuid, uuid, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_activity_status_locked_impl(uuid, uuid, text, text, uuid, uuid) TO postgres;

NOTIFY pgrst, 'reload schema';

COMMIT;
