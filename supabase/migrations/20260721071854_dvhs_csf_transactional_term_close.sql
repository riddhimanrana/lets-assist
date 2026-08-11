-- Derive semester outcomes inside the close transaction. The browser supplies
-- only the evidence hash it reviewed; it never supplies membership decisions.

BEGIN;

ALTER TABLE plugin_data.csf_term_closures
  ADD COLUMN evidence_hash text,
  ADD CONSTRAINT csf_term_closures_evidence_hash_check CHECK (
    evidence_hash IS NULL OR evidence_hash ~ '^[0-9a-f]{64}$'
  );

ALTER FUNCTION plugin_data.csf_term_closure_readiness(uuid, uuid)
  RENAME TO csf_term_closure_readiness_base;

-- A finalized membership can be restored only while the server-only reopen
-- wrapper is executing in the same database transaction. The custom GUC makes
-- the intended closure explicit to the trigger, while this private ledger
-- prevents callers from spoofing the GUC and issuing a direct UPDATE.
CREATE TABLE plugin_data.csf_term_reopen_authorizations (
  transaction_id bigint NOT NULL,
  organization_id uuid NOT NULL,
  term_id uuid NOT NULL,
  closure_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_id, organization_id, term_id, closure_id)
);

ALTER TABLE plugin_data.csf_term_reopen_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_term_reopen_authorizations
  FROM PUBLIC, anon, authenticated, service_role;

-- Closing a term is also an authorized lifecycle transition. The close RPC
-- records its exact transaction, closure revision, actor, and correlation in
-- this private ledger before it flips the parent term to closed. The lifecycle
-- trigger consumes that shape; a service-role UPDATE cannot manufacture it.
CREATE TABLE plugin_data.csf_term_close_authorizations (
  transaction_id bigint NOT NULL,
  organization_id uuid NOT NULL,
  term_id uuid NOT NULL,
  closure_id uuid NOT NULL,
  closure_revision integer NOT NULL CHECK (closure_revision > 0),
  actor_user_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_id, organization_id, term_id, closure_id)
);

ALTER TABLE plugin_data.csf_term_close_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_term_close_authorizations
  FROM PUBLIC, anon, authenticated, service_role;

-- Tenant identity belongs in every relationship, not only in query filters.
-- The pre-existing single-column foreign keys retain their cascade/SET NULL
-- behavior; these composite constraints make a cross-organization reference
-- structurally impossible without rewriting any valid historical rows.
ALTER TABLE plugin_data.csf_terms
  ADD CONSTRAINT csf_terms_organization_id_id_key
    UNIQUE (organization_id, id);

ALTER TABLE plugin_data.csf_meetings
  ADD CONSTRAINT csf_meetings_organization_id_key
    UNIQUE (organization_id, id),
  ADD CONSTRAINT csf_meetings_organization_term_id_key
    UNIQUE (organization_id, term_id, id),
  ADD CONSTRAINT csf_meetings_term_organization_fkey
    FOREIGN KEY (organization_id, term_id)
    REFERENCES plugin_data.csf_terms (organization_id, id);

ALTER TABLE plugin_data.csf_term_meetings
  ADD CONSTRAINT csf_term_meetings_organization_id_key
    UNIQUE (organization_id, id),
  ADD CONSTRAINT csf_term_meetings_organization_term_id_key
    UNIQUE (organization_id, term_id, id),
  ADD CONSTRAINT csf_term_meetings_term_organization_fkey
    FOREIGN KEY (organization_id, term_id)
    REFERENCES plugin_data.csf_terms (organization_id, id);

ALTER TABLE plugin_data.csf_meeting_sessions
  ADD CONSTRAINT csf_meeting_sessions_organization_meeting_id_key
    UNIQUE (organization_id, meeting_id, id),
  ADD CONSTRAINT csf_meeting_sessions_meeting_organization_fkey
    FOREIGN KEY (organization_id, meeting_id)
    REFERENCES plugin_data.csf_meetings (organization_id, id),
  ADD CONSTRAINT csf_meeting_sessions_legacy_organization_fkey
    FOREIGN KEY (organization_id, legacy_term_meeting_id)
    REFERENCES plugin_data.csf_term_meetings (organization_id, id);

ALTER TABLE plugin_data.csf_meeting_attendance
  ADD CONSTRAINT csf_meeting_attendance_profile_organization_fkey
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id),
  ADD CONSTRAINT csf_meeting_attendance_term_organization_fkey
    FOREIGN KEY (organization_id, term_id)
    REFERENCES plugin_data.csf_terms (organization_id, id),
  ADD CONSTRAINT csf_meeting_attendance_meeting_term_organization_fkey
    FOREIGN KEY (organization_id, term_id, meeting_id)
    REFERENCES plugin_data.csf_meetings (organization_id, term_id, id),
  ADD CONSTRAINT csf_meeting_attendance_legacy_term_organization_fkey
    FOREIGN KEY (organization_id, term_id, term_meeting_id)
    REFERENCES plugin_data.csf_term_meetings (organization_id, term_id, id),
  ADD CONSTRAINT csf_meeting_attendance_session_meeting_organization_fkey
    FOREIGN KEY (organization_id, meeting_id, meeting_session_id)
    REFERENCES plugin_data.csf_meeting_sessions (organization_id, meeting_id, id),
  ADD CONSTRAINT csf_meeting_attendance_session_requires_meeting_check
    CHECK (meeting_session_id IS NULL OR meeting_id IS NOT NULL);

CREATE OR REPLACE FUNCTION plugin_data.csf_guard_term_lifecycle_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_lock_key bigint;
  v_new_lock_key bigint;
  v_close_authorized boolean := false;
  v_reopen_authorized boolean := false;
  v_close_shape boolean := false;
  v_reopen_shape boolean := false;
  v_close_keys text[] := ARRAY[
    'lifecycle_status', 'is_current', 'closed_at', 'closed_by',
    'closure_policy_version', 'closure_revision', 'latest_closure_id',
    'active_closure_id', 'updated_at'
  ];
  v_reopen_keys text[] := ARRAY[
    'lifecycle_status', 'is_current', 'closed_at', 'closed_by',
    'closure_policy_version', 'active_closure_id', 'updated_at'
  ];
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_lock_key := pg_catalog.hashtextextended(
      OLD.organization_id::text || ':' || OLD.id::text,
      0
    );
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_lock_key := pg_catalog.hashtextextended(
      NEW.organization_id::text || ':' || NEW.id::text,
      0
    );
  END IF;

  IF v_old_lock_key IS NOT NULL AND v_new_lock_key IS NOT NULL
    AND v_old_lock_key IS DISTINCT FROM v_new_lock_key THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(least(v_old_lock_key, v_new_lock_key));
    PERFORM pg_catalog.pg_advisory_xact_lock(greatest(v_old_lock_key, v_new_lock_key));
  ELSIF coalesce(v_new_lock_key, v_old_lock_key) IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(coalesce(v_new_lock_key, v_old_lock_key));
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_status IN ('closed', 'archived') THEN
      RAISE EXCEPTION 'Closed or archived CSF semesters cannot be inserted directly.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.lifecycle_status IN ('closed', 'archived') THEN
      RAISE EXCEPTION 'Closed or archived CSF semester records are immutable.';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'CSF semester identity is immutable.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_close_authorizations AS close_auth
    JOIN plugin_data.csf_term_closures AS closure
      ON closure.organization_id = close_auth.organization_id
     AND closure.term_id = close_auth.term_id
     AND closure.id = close_auth.closure_id
     AND closure.revision = close_auth.closure_revision
     AND closure.closed_by = close_auth.actor_user_id
     AND closure.correlation_id = close_auth.correlation_id
    WHERE close_auth.transaction_id = pg_catalog.txid_current()
      AND close_auth.organization_id = OLD.organization_id
      AND close_auth.term_id = OLD.id
      AND close_auth.closure_id = NEW.active_closure_id
      AND close_auth.closure_revision = NEW.closure_revision
      AND close_auth.actor_user_id = NEW.closed_by
  ) INTO v_close_authorized;

  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_reopen_authorizations AS reopen_auth
    WHERE reopen_auth.transaction_id = pg_catalog.txid_current()
      AND reopen_auth.organization_id = OLD.organization_id
      AND reopen_auth.term_id = OLD.id
      AND reopen_auth.closure_id = OLD.active_closure_id
      AND pg_catalog.current_setting('plugin_data.csf_reopen_closure_id', true)
        = reopen_auth.closure_id::text
  ) INTO v_reopen_authorized;

  v_close_shape :=
    v_close_authorized
    AND OLD.lifecycle_status NOT IN ('closed', 'archived')
    AND NEW.lifecycle_status = 'closed'
    AND NOT NEW.is_current
    AND NEW.closed_at IS NOT NULL
    AND NEW.closed_by IS NOT NULL
    AND NEW.closure_policy_version IS NOT NULL
    AND NEW.closure_revision = OLD.closure_revision + 1
    AND NEW.latest_closure_id = NEW.active_closure_id
    AND NEW.active_closure_id IS NOT NULL
    AND (to_jsonb(NEW) - v_close_keys)
      IS NOT DISTINCT FROM (to_jsonb(OLD) - v_close_keys);

  v_reopen_shape :=
    v_reopen_authorized
    AND OLD.lifecycle_status = 'closed'
    AND NEW.lifecycle_status = 'open'
    AND NOT NEW.is_current
    AND NEW.active_closure_id IS NULL
    AND NEW.closed_at IS NULL
    AND NEW.closed_by IS NULL
    AND NEW.closure_policy_version IS NULL
    AND NEW.closure_revision = OLD.closure_revision
    AND NEW.latest_closure_id = OLD.latest_closure_id
    AND (to_jsonb(NEW) - v_reopen_keys)
      IS NOT DISTINCT FROM (to_jsonb(OLD) - v_reopen_keys);

  IF OLD.lifecycle_status IN ('closed', 'archived') AND NOT v_reopen_shape THEN
    RAISE EXCEPTION 'Closed or archived CSF semester records are immutable; use the audited reopen operation.';
  END IF;

  IF NEW.lifecycle_status = 'closed' AND NOT v_close_shape THEN
    RAISE EXCEPTION 'CSF semesters must be closed through the audited close operation.';
  END IF;

  IF NEW.lifecycle_status = 'archived' THEN
    RAISE EXCEPTION 'CSF semesters must be archived through an audited lifecycle operation.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_terms_lifecycle_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_terms
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_term_lifecycle_write();

REVOKE ALL ON FUNCTION plugin_data.csf_guard_term_lifecycle_write()
  FROM PUBLIC, anon, authenticated, service_role;

-- Every term-scoped evidence writer takes the same transaction advisory lock
-- as semester close.  A writer that starts first commits before close computes
-- its hash; a writer that starts after close begins waits, then observes the
-- closed term and fails.  Row locks alone cannot protect against phantom
-- inserts, which is why this guard lives below every Server Action/RPC.
CREATE OR REPLACE FUNCTION plugin_data.csf_guard_term_evidence_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_organization_id uuid;
  v_old_term_id uuid;
  v_new_organization_id uuid;
  v_new_term_id uuid;
  v_old_lock_key bigint;
  v_new_lock_key bigint;
  v_lifecycle_status text;
  v_active_closure_id uuid;
  v_membership_restore boolean := false;
BEGIN
  IF TG_TABLE_SCHEMA = 'plugin_data' AND TG_TABLE_NAME = 'csf_meeting_sessions' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT meeting.organization_id, meeting.term_id
      INTO v_old_organization_id, v_old_term_id
      FROM plugin_data.csf_meetings AS meeting
      WHERE meeting.id = (to_jsonb(OLD)->>'meeting_id')::uuid
        AND meeting.organization_id = (to_jsonb(OLD)->>'organization_id')::uuid;

      IF NOT FOUND THEN
        -- A parent meeting DELETE has already passed this same term guard when
        -- its FK cascade reaches the dated sessions.
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'The parent CSF meeting for this session no longer exists.';
      END IF;
    END IF;

    IF TG_OP <> 'DELETE' THEN
      SELECT meeting.organization_id, meeting.term_id
      INTO v_new_organization_id, v_new_term_id
      FROM plugin_data.csf_meetings AS meeting
      WHERE meeting.id = (to_jsonb(NEW)->>'meeting_id')::uuid
        AND meeting.organization_id = (to_jsonb(NEW)->>'organization_id')::uuid;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'The parent CSF meeting for this session no longer exists.';
      END IF;
    END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      v_old_organization_id := nullif(to_jsonb(OLD)->>'organization_id', '')::uuid;
      v_old_term_id := nullif(to_jsonb(OLD)->>'term_id', '')::uuid;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_new_organization_id := nullif(to_jsonb(NEW)->>'organization_id', '')::uuid;
      v_new_term_id := nullif(to_jsonb(NEW)->>'term_id', '')::uuid;
    END IF;
  END IF;

  IF v_old_organization_id IS NOT NULL AND v_old_term_id IS NOT NULL THEN
    v_old_lock_key := pg_catalog.hashtextextended(
      v_old_organization_id::text || ':' || v_old_term_id::text,
      0
    );
  END IF;
  IF v_new_organization_id IS NOT NULL AND v_new_term_id IS NOT NULL THEN
    v_new_lock_key := pg_catalog.hashtextextended(
      v_new_organization_id::text || ':' || v_new_term_id::text,
      0
    );
  END IF;

  IF v_old_lock_key IS NOT NULL AND v_new_lock_key IS NOT NULL
    AND v_old_lock_key IS DISTINCT FROM v_new_lock_key THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(least(v_old_lock_key, v_new_lock_key));
    PERFORM pg_catalog.pg_advisory_xact_lock(greatest(v_old_lock_key, v_new_lock_key));
  ELSIF coalesce(v_new_lock_key, v_old_lock_key) IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(coalesce(v_new_lock_key, v_old_lock_key));
  END IF;

  -- Reopen restores finalized membership rows before it flips the parent term
  -- back to open.  Permit only that exact snapshot-restoration shape; all other
  -- writes to closed evidence remain rejected.
  IF TG_TABLE_SCHEMA = 'plugin_data'
    AND TG_TABLE_NAME = 'csf_term_memberships'
    AND TG_OP = 'UPDATE'
    AND v_old_organization_id IS NOT DISTINCT FROM v_new_organization_id
    AND v_old_term_id IS NOT DISTINCT FROM v_new_term_id
    AND (to_jsonb(OLD)->>'finalized_closure_id') IS NOT NULL
    AND (to_jsonb(NEW)->>'finalized_closure_id') IS NULL
    AND (to_jsonb(NEW)->>'finalized_revision') IS NULL
    AND (to_jsonb(NEW)->>'finalized_correlation_id') IS NULL
    AND (to_jsonb(OLD)->>'status') IN ('completed', 'not_completed')
    AND (to_jsonb(NEW)->>'status') IN ('pending', 'accepted', 'active')
    AND pg_catalog.current_setting('plugin_data.csf_reopen_closure_id', true)
      = to_jsonb(OLD)->>'finalized_closure_id'
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_term_reopen_authorizations AS reopen_auth
      WHERE reopen_auth.transaction_id = pg_catalog.txid_current()
        AND reopen_auth.organization_id = v_old_organization_id
        AND reopen_auth.term_id = v_old_term_id
        AND reopen_auth.closure_id = (to_jsonb(OLD)->>'finalized_closure_id')::uuid
    ) THEN
    v_membership_restore := true;
  END IF;

  IF v_old_organization_id IS NOT NULL AND v_old_term_id IS NOT NULL THEN
    SELECT term.lifecycle_status, term.active_closure_id
    INTO v_lifecycle_status, v_active_closure_id
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = v_old_organization_id
      AND term.id = v_old_term_id;

    IF NOT FOUND THEN
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'The CSF semester for this operational record no longer exists.';
    END IF;

    IF v_lifecycle_status IN ('closed', 'archived')
      AND NOT (
        v_membership_restore
        AND (to_jsonb(OLD)->>'finalized_closure_id')::uuid IS NOT DISTINCT FROM v_active_closure_id
      ) THEN
      RAISE EXCEPTION 'Closed CSF semester evidence is immutable; reopen the semester before making changes.';
    END IF;
  END IF;

  IF v_new_organization_id IS NOT NULL AND v_new_term_id IS NOT NULL
    AND (
      v_old_organization_id IS DISTINCT FROM v_new_organization_id
      OR v_old_term_id IS DISTINCT FROM v_new_term_id
      OR TG_OP = 'INSERT'
    ) THEN
    SELECT term.lifecycle_status
    INTO v_lifecycle_status
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = v_new_organization_id
      AND term.id = v_new_term_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The CSF semester for this operational record no longer exists.';
    END IF;
    IF v_lifecycle_status IN ('closed', 'archived') THEN
      RAISE EXCEPTION 'Closed CSF semester evidence is immutable; reopen the semester before making changes.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_term_memberships_evidence_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_term_memberships
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_term_evidence_write();
CREATE TRIGGER csf_credit_records_evidence_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_credit_records
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_term_evidence_write();
CREATE TRIGGER csf_meeting_attendance_evidence_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_meeting_attendance
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_term_evidence_write();
CREATE TRIGGER csf_dues_records_evidence_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_dues_records
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_term_evidence_write();
CREATE TRIGGER csf_sheet_import_rows_evidence_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_sheet_import_rows
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_term_evidence_write();
CREATE TRIGGER csf_term_applications_evidence_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_term_applications
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_term_evidence_write();
CREATE TRIGGER csf_point_submissions_evidence_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_point_submissions
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_term_evidence_write();
CREATE TRIGGER csf_point_appeals_evidence_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_point_appeals
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_term_evidence_write();
CREATE TRIGGER csf_term_policies_evidence_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_term_policies
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_term_evidence_write();
CREATE TRIGGER csf_term_meetings_evidence_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_term_meetings
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_term_evidence_write();
CREATE TRIGGER csf_meetings_evidence_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_meetings
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_term_evidence_write();
CREATE TRIGGER csf_meeting_sessions_evidence_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_meeting_sessions
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_term_evidence_write();

REVOKE ALL ON FUNCTION plugin_data.csf_guard_term_evidence_write()
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the validated reopen implementation, but expose it only through a
-- wrapper that checks the database permission and creates a transaction-local
-- restoration authorization consumed by the evidence trigger.
ALTER FUNCTION plugin_data.csf_reopen_term(uuid, uuid, uuid, integer, text, text, uuid, uuid)
  RENAME TO csf_reopen_term_base;

REVOKE ALL ON FUNCTION plugin_data.csf_reopen_term_base(uuid, uuid, uuid, integer, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

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
  v_result jsonb;
  v_transaction_id bigint := pg_catalog.txid_current();
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'reopen_term'
    ) THEN
    RAISE EXCEPTION 'Not authorized to reopen this CSF semester.';
  END IF;
  IF p_expected_closure_id IS NULL THEN
    RAISE EXCEPTION 'Semester reopen requires the expected close revision.';
  END IF;

  INSERT INTO plugin_data.csf_term_reopen_authorizations (
    transaction_id, organization_id, term_id, closure_id
  ) VALUES (
    v_transaction_id, p_organization_id, p_term_id, p_expected_closure_id
  );

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_reopen_closure_id',
    p_expected_closure_id::text,
    true
  );

  BEGIN
    v_result := plugin_data.csf_reopen_term_base(
      p_organization_id,
      p_term_id,
      p_expected_closure_id,
      p_expected_revision,
      p_reason_code,
      p_reason,
      p_actor_user_id,
      p_correlation_id
    );
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM plugin_data.csf_term_reopen_authorizations AS reopen_auth
    WHERE reopen_auth.transaction_id = v_transaction_id
      AND reopen_auth.organization_id = p_organization_id
      AND reopen_auth.term_id = p_term_id
      AND reopen_auth.closure_id = p_expected_closure_id;
    PERFORM pg_catalog.set_config('plugin_data.csf_reopen_closure_id', '', true);
    RAISE;
  END;

  DELETE FROM plugin_data.csf_term_reopen_authorizations AS reopen_auth
  WHERE reopen_auth.transaction_id = v_transaction_id
    AND reopen_auth.organization_id = p_organization_id
    AND reopen_auth.term_id = p_term_id
    AND reopen_auth.closure_id = p_expected_closure_id;
  PERFORM pg_catalog.set_config('plugin_data.csf_reopen_closure_id', '', true);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_reopen_term(uuid, uuid, uuid, integer, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reopen_term(uuid, uuid, uuid, integer, text, text, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_term_closure_evidence_hash(
  p_organization_id uuid,
  p_term_id uuid
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT encode(
    extensions.digest(
      jsonb_build_object(
        'term', (
          SELECT jsonb_build_object(
            'id', term.id,
            'lifecycleStatus', term.lifecycle_status,
            'closureRevision', term.closure_revision,
            'updatedAt', term.updated_at
          )
          FROM plugin_data.csf_terms AS term
          WHERE term.organization_id = p_organization_id
            AND term.id = p_term_id
        ),
        'policy', (
          SELECT jsonb_build_object(
            'id', policy.id,
            'version', policy.policy_version,
            'totalPoints', policy.total_points_required,
            'driveCap', policy.max_drive_points,
            'activityCap', policy.max_points_per_activity,
            'meetings', policy.required_meetings,
            'absences', policy.allowed_absences,
            'duesRequired', policy.dues_required,
            'updatedAt', policy.updated_at
          )
          FROM plugin_data.csf_term_policies AS policy
          WHERE policy.organization_id = p_organization_id
            AND policy.term_id = p_term_id
        ),
        'memberships', (
          SELECT coalesce(jsonb_agg(
            jsonb_build_object(
              'id', membership.id,
              'profileId', membership.profile_id,
              'status', membership.status,
              'overrideStatus', membership.override_status,
              'overrideReason', membership.override_reason,
              'updatedAt', membership.updated_at
            ) ORDER BY membership.id
          ), '[]'::jsonb)
          FROM plugin_data.csf_term_memberships AS membership
          WHERE membership.organization_id = p_organization_id
            AND membership.term_id = p_term_id
            AND membership.status IN ('pending', 'accepted', 'active')
        ),
        'credits', (
          SELECT coalesce(jsonb_agg(
            jsonb_build_object(
              'id', credit.id,
              'profileId', credit.profile_id,
              'points', credit.points,
              'pointType', credit.point_type,
              'status', credit.status,
              'updatedAt', credit.updated_at
            ) ORDER BY credit.id
          ), '[]'::jsonb)
          FROM plugin_data.csf_credit_records AS credit
          WHERE credit.organization_id = p_organization_id
            AND credit.term_id = p_term_id
        ),
        'meetings', (
          SELECT coalesce(jsonb_agg(
            jsonb_build_object(
              'id', meeting.id,
              'meetingKey', meeting.meeting_key,
              'label', meeting.label,
              'required', meeting.required,
              'sortOrder', meeting.sort_order,
              'status', meeting.status,
              'updatedAt', meeting.updated_at
            ) ORDER BY meeting.id
          ), '[]'::jsonb)
          FROM plugin_data.csf_meetings AS meeting
          WHERE meeting.organization_id = p_organization_id
            AND meeting.term_id = p_term_id
        ),
        'meetingSessions', (
          SELECT coalesce(jsonb_agg(
            jsonb_build_object(
              'id', session.id,
              'meetingId', session.meeting_id,
              'legacyTermMeetingId', session.legacy_term_meeting_id,
              'sessionDate', session.session_date,
              'startsAt', session.starts_at,
              'location', session.location,
              'attendanceSourceUrl', session.attendance_source_url,
              'status', session.status,
              'settings', session.settings,
              'updatedAt', session.updated_at
            ) ORDER BY session.id
          ), '[]'::jsonb)
          FROM plugin_data.csf_meeting_sessions AS session
          JOIN plugin_data.csf_meetings AS meeting
            ON meeting.organization_id = session.organization_id
           AND meeting.id = session.meeting_id
          WHERE meeting.organization_id = p_organization_id
            AND meeting.term_id = p_term_id
        ),
        'legacyTermMeetings', (
          SELECT coalesce(jsonb_agg(
            jsonb_build_object(
              'id', meeting.id,
              'meetingKey', meeting.meeting_key,
              'label', meeting.label,
              'meetingDate', meeting.meeting_date,
              'startsAt', meeting.starts_at,
              'location', meeting.location,
              'attendanceSourceUrl', meeting.attendance_source_url,
              'required', meeting.required,
              'sortOrder', meeting.sort_order,
              'status', meeting.status,
              'settings', meeting.settings,
              'updatedAt', meeting.updated_at
            ) ORDER BY meeting.id
          ), '[]'::jsonb)
          FROM plugin_data.csf_term_meetings AS meeting
          WHERE meeting.organization_id = p_organization_id
            AND meeting.term_id = p_term_id
        ),
        'attendance', (
          SELECT coalesce(jsonb_agg(
            jsonb_build_object(
              'id', attendance.id,
              'profileId', attendance.profile_id,
              'meetingId', attendance.meeting_id,
              'termMeetingId', attendance.term_meeting_id,
              'meetingSessionId', attendance.meeting_session_id,
              'meetingKey', attendance.meeting_key,
              'status', attendance.status,
              'matchStatus', attendance.match_status,
              'source', attendance.source,
              'sourceRowId', attendance.source_row_id,
              'updatedAt', attendance.updated_at
            ) ORDER BY attendance.id
          ), '[]'::jsonb)
          FROM plugin_data.csf_meeting_attendance AS attendance
          WHERE attendance.organization_id = p_organization_id
            AND attendance.term_id = p_term_id
        ),
        'dues', (
          SELECT coalesce(jsonb_agg(
            jsonb_build_object(
              'id', dues.id,
              'profileId', dues.profile_id,
              'status', dues.status,
              'updatedAt', dues.updated_at
            ) ORDER BY dues.id
          ), '[]'::jsonb)
          FROM plugin_data.csf_dues_records AS dues
          WHERE dues.organization_id = p_organization_id
            AND dues.term_id = p_term_id
        ),
        'applications', (
          SELECT coalesce(jsonb_agg(
            jsonb_build_object(
              'id', application.id,
              'decisionStatus', application.decision_status,
              'updatedAt', application.updated_at
            ) ORDER BY application.id
          ), '[]'::jsonb)
          FROM plugin_data.csf_term_applications AS application
          WHERE application.organization_id = p_organization_id
            AND application.term_id = p_term_id
        ),
        'pointSubmissions', (
          SELECT coalesce(jsonb_agg(
            jsonb_build_object(
              'id', submission.id,
              'status', submission.status,
              'updatedAt', submission.updated_at
            ) ORDER BY submission.id
          ), '[]'::jsonb)
          FROM plugin_data.csf_point_submissions AS submission
          WHERE submission.organization_id = p_organization_id
            AND submission.term_id = p_term_id
        ),
        'pointAppeals', (
          SELECT coalesce(jsonb_agg(
            jsonb_build_object(
              'id', appeal.id,
              'status', appeal.status,
              'updatedAt', appeal.updated_at
            ) ORDER BY appeal.id
          ), '[]'::jsonb)
          FROM plugin_data.csf_point_appeals AS appeal
          WHERE appeal.organization_id = p_organization_id
            AND appeal.term_id = p_term_id
        ),
        'importRows', (
          SELECT coalesce(jsonb_agg(
            jsonb_build_object(
              'id', import_row.id,
              'jobId', import_row.job_id,
              'importStatus', import_row.import_status,
              'resolutionStatus', import_row.resolution_status,
              'resolvedAt', import_row.resolved_at,
              'createdAt', import_row.created_at
            ) ORDER BY import_row.id
          ), '[]'::jsonb)
          FROM plugin_data.csf_sheet_import_rows AS import_row
          WHERE import_row.organization_id = p_organization_id
            AND import_row.term_id = p_term_id
        )
      )::text,
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_term_closure_readiness(
  p_organization_id uuid,
  p_term_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_base jsonb;
  v_import_count integer := 0;
  v_import_sample jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_hash text;
BEGIN
  v_base := plugin_data.csf_term_closure_readiness_base(p_organization_id, p_term_id);

  SELECT count(*)::integer
  INTO v_import_count
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.term_id = p_term_id
    AND import_row.resolution_status = 'pending'
    AND import_row.import_status IN ('pending', 'ambiguous', 'duplicate', 'conflict', 'error');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', import_row.id,
    'jobId', import_row.job_id,
    'sourceId', import_row.source_id,
    'sheetTabName', import_row.sheet_tab_name,
    'rowNumber', import_row.row_number,
    'importStatus', import_row.import_status,
    'resolutionStatus', import_row.resolution_status
  )), '[]'::jsonb)
  INTO v_import_sample
  FROM (
    SELECT import_row.*
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.term_id = p_term_id
      AND import_row.resolution_status = 'pending'
      AND import_row.import_status IN ('pending', 'ambiguous', 'duplicate', 'conflict', 'error')
    ORDER BY import_row.created_at, import_row.id
    LIMIT 25
  ) AS import_row;

  v_total := coalesce((v_base->>'totalBlockers')::integer, 0) + v_import_count;
  v_hash := plugin_data.csf_term_closure_evidence_hash(p_organization_id, p_term_id);

  RETURN v_base || jsonb_build_object(
    'ready', v_total = 0 AND coalesce(v_base->>'lifecycleStatus', '') NOT IN ('closed', 'archived'),
    'totalBlockers', v_total,
    'counts', coalesce(v_base->'counts', '{}'::jsonb) || jsonb_build_object('imports', v_import_count),
    'samples', coalesce(v_base->'samples', '{}'::jsonb) || jsonb_build_object('imports', v_import_sample),
    'evidenceHash', v_hash,
    'evidenceRevision', jsonb_build_object(
      'hash', v_hash,
      'policyVersion', (
        SELECT policy.policy_version
        FROM plugin_data.csf_term_policies AS policy
        WHERE policy.organization_id = p_organization_id
          AND policy.term_id = p_term_id
      ),
      'closureRevision', (
        SELECT term.closure_revision
        FROM plugin_data.csf_terms AS term
        WHERE term.organization_id = p_organization_id
          AND term.id = p_term_id
      )
    )
  );
END;
$$;

-- Keep the historic signature for migration compatibility, but make it
-- impossible for any caller to submit hand-authored membership decisions.  All
-- close operations must use csf_close_term_v2 and its reviewed evidence hash.
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
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Legacy CSF semester close is disabled; use the evidence-bound close operation.';
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_close_term_v2(
  p_organization_id uuid,
  p_term_id uuid,
  p_policy_version integer,
  p_expected_evidence_hash text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_membership plugin_data.csf_term_memberships%ROWTYPE;
  v_item jsonb;
  v_readiness jsonb;
  v_current_hash text;
  v_decisions jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_progress jsonb;
  v_unmet_reasons text[];
  v_derived_status text;
  v_effective_status text;
  v_effective_reason text;
  v_reason_code text;
  v_final_snapshot jsonb;
  v_raw_non_drive numeric := 0;
  v_raw_drive numeric := 0;
  v_qualifying_non_drive numeric := 0;
  v_qualifying_drive numeric := 0;
  v_counted_drive numeric := 0;
  v_total_counted numeric := 0;
  v_remaining numeric := 0;
  v_attended integer := 0;
  v_excused integer := 0;
  v_missed integer := 0;
  v_satisfied integer := 0;
  v_points_complete boolean := false;
  v_meetings_complete boolean := false;
  v_membership_count integer := 0;
  v_completed_count integer := 0;
  v_not_completed_count integer := 0;
  v_now timestamptz := now();
  v_correlation_id uuid := gen_random_uuid();
  v_closure_id uuid := gen_random_uuid();
  v_next_revision integer;
  v_audit_action text;
  v_audit_reason text;
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'close_term') THEN
    RAISE EXCEPTION 'Not authorized to close this CSF semester.';
  END IF;
  IF p_expected_evidence_hash IS NULL
    OR p_expected_evidence_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Semester close requires a valid preflight evidence hash.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_term_id::text, 0)
  );

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

  SELECT policy.*
  INTO v_policy
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Publish the semester policy before closing this term.';
  END IF;
  IF v_policy.policy_version IS DISTINCT FROM p_policy_version THEN
    RAISE EXCEPTION 'CSF semester policy changed; refresh closure readiness and try again.';
  END IF;

  PERFORM membership.id
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.term_id = p_term_id
  FOR UPDATE;
  PERFORM credit.id
  FROM plugin_data.csf_credit_records AS credit
  WHERE credit.organization_id = p_organization_id
    AND credit.term_id = p_term_id
  FOR UPDATE;
  PERFORM meeting.id
  FROM plugin_data.csf_meetings AS meeting
  WHERE meeting.organization_id = p_organization_id
    AND meeting.term_id = p_term_id
  FOR UPDATE;
  PERFORM session.id
  FROM plugin_data.csf_meeting_sessions AS session
  JOIN plugin_data.csf_meetings AS meeting
    ON meeting.organization_id = session.organization_id
   AND meeting.id = session.meeting_id
  WHERE meeting.organization_id = p_organization_id
    AND meeting.term_id = p_term_id
  FOR UPDATE OF session;
  PERFORM meeting.id
  FROM plugin_data.csf_term_meetings AS meeting
  WHERE meeting.organization_id = p_organization_id
    AND meeting.term_id = p_term_id
  FOR UPDATE;
  PERFORM attendance.id
  FROM plugin_data.csf_meeting_attendance AS attendance
  WHERE attendance.organization_id = p_organization_id
    AND attendance.term_id = p_term_id
  FOR UPDATE;
  PERFORM dues.id
  FROM plugin_data.csf_dues_records AS dues
  WHERE dues.organization_id = p_organization_id
    AND dues.term_id = p_term_id
  FOR UPDATE;
  PERFORM import_row.id
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.term_id = p_term_id
  FOR UPDATE;
  PERFORM application.id
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.term_id = p_term_id
  FOR UPDATE;
  PERFORM submission.id
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.term_id = p_term_id
  FOR UPDATE;
  PERFORM appeal.id
  FROM plugin_data.csf_point_appeals AS appeal
  WHERE appeal.organization_id = p_organization_id
    AND appeal.term_id = p_term_id
  FOR UPDATE;

  v_readiness := plugin_data.csf_term_closure_readiness(p_organization_id, p_term_id);
  v_current_hash := v_readiness->>'evidenceHash';
  IF v_current_hash IS DISTINCT FROM p_expected_evidence_hash THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Semester records changed after preflight; refresh and review the close checks again.',
      DETAIL = jsonb_build_object(
        'expectedEvidenceHash', p_expected_evidence_hash,
        'currentEvidenceHash', v_current_hash
      )::text;
  END IF;
  IF coalesce((v_readiness->>'totalBlockers')::integer, 0) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'CSF semester cannot be closed while operational work remains.',
      DETAIL = v_readiness::text,
      HINT = 'Resolve applications, points, appeals, attendance, dues, and import reconciliation before closing.';
  END IF;

  SELECT count(*)::integer
  INTO v_membership_count
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.term_id = p_term_id
    AND membership.status IN ('pending', 'accepted', 'active');
  IF v_membership_count = 0 THEN
    RAISE EXCEPTION 'No active term memberships are available to close.';
  END IF;

  FOR v_membership IN
    SELECT membership.*
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.term_id = p_term_id
      AND membership.status IN ('pending', 'accepted', 'active')
    ORDER BY membership.profile_id, membership.id
  LOOP
    SELECT
      coalesce(sum(greatest(credit.points, 0)) FILTER (WHERE credit.point_type = 'non_drive'), 0),
      coalesce(sum(greatest(credit.points, 0)) FILTER (WHERE credit.point_type = 'drive'), 0),
      coalesce(sum(least(greatest(credit.points, 0), v_policy.max_points_per_activity)) FILTER (WHERE credit.point_type = 'non_drive'), 0),
      coalesce(sum(least(greatest(credit.points, 0), v_policy.max_points_per_activity)) FILTER (WHERE credit.point_type = 'drive'), 0)
    INTO v_raw_non_drive, v_raw_drive, v_qualifying_non_drive, v_qualifying_drive
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.organization_id = p_organization_id
      AND credit.term_id = p_term_id
      AND credit.profile_id = v_membership.profile_id
      AND credit.status = 'verified';

    v_counted_drive := least(v_qualifying_drive, v_policy.max_drive_points);
    v_total_counted := v_qualifying_non_drive + v_counted_drive;
    v_remaining := greatest(0, v_policy.total_points_required - v_total_counted);

    SELECT
      count(*) FILTER (WHERE attendance.status = 'attended')::integer,
      count(*) FILTER (WHERE attendance.status = 'excused')::integer,
      count(*) FILTER (WHERE attendance.status = 'missed')::integer
    INTO v_attended, v_excused, v_missed
    FROM plugin_data.csf_meeting_attendance AS attendance
    LEFT JOIN plugin_data.csf_meetings AS meeting
      ON meeting.organization_id = attendance.organization_id
     AND meeting.term_id = attendance.term_id
     AND (
       meeting.id = attendance.meeting_id
       OR (
         attendance.meeting_id IS NULL
         AND meeting.meeting_key = attendance.meeting_key
       )
     )
    LEFT JOIN plugin_data.csf_term_meetings AS legacy_meeting
      ON legacy_meeting.organization_id = attendance.organization_id
     AND legacy_meeting.term_id = attendance.term_id
     AND legacy_meeting.id = attendance.term_meeting_id
    LEFT JOIN plugin_data.csf_meeting_sessions AS session
      ON session.organization_id = attendance.organization_id
     AND session.id = attendance.meeting_session_id
     AND session.meeting_id = meeting.id
    WHERE attendance.organization_id = p_organization_id
      AND attendance.term_id = p_term_id
      AND attendance.profile_id = v_membership.profile_id
      AND coalesce(meeting.required, legacy_meeting.required, false)
      AND coalesce(meeting.status, legacy_meeting.status) = 'active'
      AND (
        attendance.meeting_session_id IS NULL
        OR (
          session.id IS NOT NULL
          AND session.status NOT IN ('cancelled', 'archived')
        )
      );

    v_attended := coalesce(v_attended, 0);
    v_excused := coalesce(v_excused, 0);
    v_missed := coalesce(v_missed, 0);
    v_satisfied := v_attended + v_excused;
    v_points_complete := v_total_counted >= v_policy.total_points_required;
    v_meetings_complete := v_missed <= v_policy.allowed_absences
      AND v_satisfied + v_policy.allowed_absences >= v_policy.required_meetings;
    v_unmet_reasons := array_remove(ARRAY[
      CASE WHEN NOT v_points_complete THEN
        'Earn ' || v_remaining::text || ' more qualifying point' || CASE WHEN v_remaining = 1 THEN '.' ELSE 's.' END
      END,
      CASE WHEN NOT v_meetings_complete THEN
        'Complete ' || greatest(0, v_policy.required_meetings - v_satisfied)::text
        || ' more required meeting'
        || CASE WHEN greatest(0, v_policy.required_meetings - v_satisfied) = 1 THEN '.' ELSE 's.' END
      END
    ], NULL);

    v_derived_status := CASE WHEN v_points_complete AND v_meetings_complete
      THEN 'completed' ELSE 'not_completed' END;
    v_effective_status := coalesce(v_membership.override_status, v_derived_status);
    v_effective_reason := coalesce(
      nullif(btrim(v_membership.override_reason), ''),
      CASE WHEN v_derived_status = 'completed'
        THEN 'All term requirements met.'
        ELSE array_to_string(v_unmet_reasons, ' ')
      END
    );
    v_reason_code := CASE
      WHEN v_membership.override_status IS NOT NULL THEN 'officer_override'
      WHEN v_derived_status = 'completed' THEN 'requirements_met'
      ELSE 'requirements_incomplete'
    END;
    v_progress := jsonb_build_object(
      'rawNonDrive', v_raw_non_drive,
      'rawDrive', v_raw_drive,
      'qualifyingNonDrive', v_qualifying_non_drive,
      'qualifyingDrive', v_qualifying_drive,
      'countedDrive', v_counted_drive,
      'totalCounted', v_total_counted,
      'remaining', v_remaining,
      'attendedMeetings', v_attended,
      'excusedMeetings', v_excused,
      'missedMeetings', v_missed,
      'satisfiedMeetings', v_satisfied,
      'pointsComplete', v_points_complete,
      'meetingsComplete', v_meetings_complete,
      'isComplete', v_points_complete AND v_meetings_complete,
      'unmetReasons', to_jsonb(v_unmet_reasons),
      'minimumTotalPoints', v_policy.total_points_required,
      'maxDrivePoints', v_policy.max_drive_points,
      'maxPointsPerActivity', v_policy.max_points_per_activity,
      'requiredMeetings', v_policy.required_meetings,
      'allowedAbsences', v_policy.allowed_absences,
      'policyVersion', v_policy.policy_version
    );
    v_item := jsonb_build_object(
      'membershipId', v_membership.id,
      'profileId', v_membership.profile_id,
      'derivedStatus', v_derived_status,
      'status', v_effective_status,
      'reasonCode', v_reason_code,
      'reason', v_effective_reason,
      'progress', v_progress
    );
    v_decisions := v_decisions || jsonb_build_array(v_item);
    IF v_effective_status = 'completed' THEN
      v_completed_count := v_completed_count + 1;
    ELSE
      v_not_completed_count := v_not_completed_count + 1;
    END IF;
  END LOOP;

  v_next_revision := v_term.closure_revision + 1;
  v_summary := jsonb_build_object(
    'termCode', v_term.code,
    'completed', v_completed_count,
    'notCompleted', v_not_completed_count,
    'membershipCount', v_membership_count,
    'readiness', v_readiness,
    'evidenceHash', v_current_hash,
    'correlationId', v_correlation_id,
    'revision', v_next_revision
  );

  INSERT INTO plugin_data.csf_term_closures (
    id, organization_id, term_id, policy_version, summary, decisions,
    closed_by, closed_at, revision, snapshot_version, correlation_id,
    supersedes_closure_id, reopenable, evidence_hash
  ) VALUES (
    v_closure_id, p_organization_id, p_term_id, v_policy.policy_version,
    v_summary, v_decisions, p_actor_user_id, v_now, v_next_revision,
    3, v_correlation_id, v_term.latest_closure_id, true, v_current_hash
  );

  INSERT INTO plugin_data.csf_term_close_authorizations (
    transaction_id, organization_id, term_id, closure_id,
    closure_revision, actor_user_id, correlation_id
  ) VALUES (
    pg_catalog.txid_current(), p_organization_id, p_term_id, v_closure_id,
    v_next_revision, p_actor_user_id, v_correlation_id
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_decisions)
  LOOP
    SELECT membership.*
    INTO v_membership
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.term_id = p_term_id
      AND membership.id = (v_item->>'membershipId')::uuid
      AND membership.profile_id = (v_item->>'profileId')::uuid
      AND membership.status IN ('pending', 'accepted', 'active')
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'An active membership changed during semester close.';
    END IF;

    v_derived_status := v_item->>'derivedStatus';
    v_effective_status := v_item->>'status';
    v_effective_reason := v_item->>'reason';
    v_reason_code := v_item->>'reasonCode';
    v_final_snapshot := v_membership.eligibility_snapshot || jsonb_build_object(
      'termClose', v_item,
      'policyVersion', v_policy.policy_version,
      'closureId', v_closure_id,
      'revision', v_next_revision,
      'evidenceHash', v_current_hash,
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
      v_membership.id, v_membership.profile_id, v_policy.policy_version,
      v_derived_status, v_effective_status, v_reason_code, v_effective_reason,
      v_item->'progress', v_membership.status, v_membership.status_reason,
      v_membership.eligibility_snapshot, v_membership.completed_at,
      v_membership.override_status, v_membership.override_reason,
      v_membership.overridden_by, v_membership.overridden_at,
      v_effective_status, v_effective_reason, v_final_snapshot, v_now,
      p_actor_user_id, v_now, v_correlation_id
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
  END LOOP;

  UPDATE plugin_data.csf_terms
  SET
    lifecycle_status = 'closed',
    is_current = false,
    closed_at = v_now,
    closed_by = p_actor_user_id,
    closure_policy_version = v_policy.policy_version,
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
      'policyVersion', v_policy.policy_version,
      'evidenceHash', v_current_hash,
      'summary', v_summary,
      'membershipCount', v_membership_count,
      'closureId', v_closure_id,
      'revision', v_next_revision
    ),
    v_correlation_id, 'term_closure', v_closure_id::text, v_audit_reason
  );

  DELETE FROM plugin_data.csf_term_close_authorizations AS close_auth
  WHERE close_auth.transaction_id = pg_catalog.txid_current()
    AND close_auth.organization_id = p_organization_id
    AND close_auth.term_id = p_term_id
    AND close_auth.closure_id = v_closure_id;

  RETURN jsonb_build_object(
    'termId', p_term_id,
    'closureId', v_closure_id,
    'revision', v_next_revision,
    'membershipCount', v_membership_count,
    'completed', v_completed_count,
    'notCompleted', v_not_completed_count,
    'evidenceHash', v_current_hash,
    'closedAt', v_now,
    'correlationId', v_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_term_closure_readiness_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_term_closure_evidence_hash(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_term_closure_evidence_hash(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_term_closure_readiness(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_term_closure_readiness(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_close_term_v2(uuid, uuid, integer, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_close_term_v2(uuid, uuid, integer, text, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_close_term(uuid, uuid, integer, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON COLUMN plugin_data.csf_term_closures.evidence_hash IS
  'SHA-256 revision of the policy and operational records locked for this close.';
COMMENT ON FUNCTION plugin_data.csf_close_term_v2(uuid, uuid, integer, text, uuid) IS
  'Locks semester evidence, rejects stale preflight state, derives every membership outcome, and commits closure plus immutable audit history atomically.';
COMMENT ON FUNCTION plugin_data.csf_close_term(uuid, uuid, integer, jsonb, jsonb, uuid) IS
  'Disabled legacy semester-close signature retained only to fail closed for stale callers; use csf_close_term_v2.';

COMMIT;
