-- Officers asked to be able to correct a past semester without reopening it.
--
-- csf_reopen_term stays the way a semester goes back to being worked in: it
-- restores finalized memberships, clears the closure pointer and puts the term
-- back on the roster. What it is not is a way to fix one wrong row, and making
-- an officer reopen and reclose a semester to correct a typo is why those rows
-- stayed wrong.
--
-- So the closed-evidence guard now yields to one narrow thing: a transaction
-- that has already proven officer authority and carries an explicit, recorded
-- acknowledgement that the semester is closed. Nothing else about the guard
-- moves, including the reopen path's membership-restore exception. The flag is
-- transaction-local, no client role can set it, and only the officer
-- entrypoints below set it -- after authorizing, and only when the officer
-- said so in the request.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_closed_term_edit_attested()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    pg_catalog.current_setting('plugin_data.csf_closed_term_edit_attested', true),
    'off'
  ) = 'on';
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_closed_term_edit_attested()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_closed_term_edit_attested() TO postgres;

-- The guard exactly as it was, with one added condition on each closed-term
-- refusal. Reproduced from the live definition rather than retyped.
CREATE OR REPLACE FUNCTION plugin_data.csf_guard_term_evidence_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      )
      AND NOT plugin_data.csf_closed_term_edit_attested() THEN
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
    IF v_lifecycle_status IN ('closed', 'archived')
      AND NOT plugin_data.csf_closed_term_edit_attested() THEN
      RAISE EXCEPTION 'Closed CSF semester evidence is immutable; reopen the semester before making changes.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;


COMMENT ON FUNCTION plugin_data.csf_closed_term_edit_attested() IS
  'True only inside a transaction where an officer entrypoint has recorded an explicit acknowledgement that it is editing a closed semester.';

COMMIT;
