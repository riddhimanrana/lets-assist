-- A bulk import announces nothing to a member.
--
-- 20260917080000 added personal notices and a transaction-local switch,
-- app.csf_suppress_notices, for lanes that rewrite records in bulk. The source
-- reconciliation and retention lanes set it already. The application and
-- class-history import lanes did not, so committing an import that touched a
-- profile's contact columns could queue a notice, and an email, about a
-- correction no member was waiting on.
--
-- Three approaches were ruled out before this one:
--
--   * Detecting an import from its own evidence does not work. The class
--     history lane updates plugin_data.csf_profiles hundreds of lines before it
--     touches plugin_data.csf_sheet_import_rows, so a trigger on the import
--     tables would set the switch after the write it needed to suppress.
--   * Restating those functions to add one PERFORM does not work. The
--     class-history identity base is nearly seven hundred lines; re-emitting it
--     by hand to insert a single call is the kind of transcription that becomes
--     a silent data defect.
--   * Attaching the switch with ALTER FUNCTION ... SET does not work either,
--     and this is the correction to the previous attempt. PostgreSQL allows any
--     role to set a custom placeholder parameter for its own session, which is
--     why set_config works, but PERSISTING one onto a function is a separate
--     privilege: ALTER FUNCTION ... SET runs pg_parameter_aclcheck for SET on
--     that parameter name. The migration role is not a superuser and holds no
--     such grant, so the replay failed with 42501. Granting it would mean
--     handing out a parameter privilege to work around a missing call, which is
--     a worse trade than the one below.
--
-- So the reader is taught to recognise the lane it is already running inside.
-- PL/pgSQL exposes its own call stack through GET DIAGNOSTICS PG_CONTEXT, and a
-- notice recorded while an import lane is on that stack is by definition part
-- of that import. No parameter privilege, no body rewrite, no ordering
-- assumption, and no role gains anything.
--
-- The explicit switch is unchanged and still authoritative: a lane that sets it
-- is suppressed whether or not it appears below. This only adds a second way to
-- be suppressed, never a way to stop being.
--
-- What deliberately stays announcing:
--   * Every officer-facing profile edit. A staff correction to a current
--     member's record is exactly what a notice is for, and no officer review
--     function appears in the lane list.
--   * Decision staging, sync and release, which never queue a personal notice
--     at all and must never email.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_publication_notices_suppressed()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- The bulk lanes that rewrite member records, as the name prefixes PL/pgSQL
  -- writes into a stack frame. Each entry covers its own delegates:
  -- csf_commit_import_row_for_attempt also matches its identity base, and
  -- csf_import_class_history_row matches every versioned entry point plus the
  -- identity base behind them, so a future version needs no migration.
  c_lanes constant text[] := ARRAY[
    -- Application response import: the commit entry point, the identity base it
    -- delegates to, and the contact fill that writes the email columns.
    'csf_commit_import_row_for_attempt',
    'csf_fill_application_profile_contacts',
    -- Automatic application profile preparation, which creates and reconciles
    -- profiles ahead of a commit.
    'csf_prepare_automatic_application_profiles',
    -- Class history import.
    'csf_import_class_history_row'
  ];
  v_stack text;
  v_lane text;
BEGIN
  -- The explicit switch first. It is the authoritative signal and the one the
  -- source reconciliation and retention lanes use.
  IF coalesce(
    pg_catalog.current_setting('app.csf_suppress_notices', true), ''
  ) = 'on' THEN
    RETURN true;
  END IF;

  -- Otherwise, ask what is actually running. A notice raised while an import
  -- lane is on the stack belongs to that import.
  GET DIAGNOSTICS v_stack = PG_CONTEXT;
  IF v_stack IS NULL THEN RETURN false; END IF;
  FOREACH v_lane IN ARRAY c_lanes LOOP
    -- Anchored to the phrase PL/pgSQL writes for a frame, so a name appearing
    -- in some other text cannot match. Both spellings are checked because the
    -- frame signature is rendered with format_procedure, which qualifies the
    -- schema only when it is outside the search path at compile time.
    IF pg_catalog.strpos(v_stack, 'function plugin_data.' || v_lane) > 0
      OR pg_catalog.strpos(v_stack, 'function ' || v_lane) > 0
    THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;

-- Restated verbatim after the replacement. CREATE OR REPLACE preserves the
-- existing ACL, but stating it keeps the reviewed posture readable in one place
-- and makes a future replacement that forgets it visibly wrong.
REVOKE ALL ON FUNCTION plugin_data.csf_publication_notices_suppressed()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_publication_notices_suppressed()
  TO postgres;

COMMENT ON FUNCTION plugin_data.csf_publication_notices_suppressed() IS
  'True while personal notices are switched off. Either the caller set app.csf_suppress_notices for its transaction, which the source reconciliation and retention lanes do, or a bulk application or class-history import lane is on the PL/pgSQL call stack. A direct staff edit satisfies neither and still announces.';

COMMIT;
