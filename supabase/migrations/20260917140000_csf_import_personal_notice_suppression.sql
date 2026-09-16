-- A bulk import announces nothing to a member.
--
-- 20260917080000 added personal notices and a transaction-local switch,
-- app.csf_suppress_notices, for lanes that rewrite records in bulk. The source
-- reconciliation lane sets it already. The application and class-history import
-- lanes did not, so committing an import that touched a profile's contact
-- columns could queue a notice, and therefore an email, about a correction no
-- member was waiting on.
--
-- Two things ruled out the obvious fixes:
--
--   * Detecting an import from its own evidence does not work. The class
--     history lane updates plugin_data.csf_profiles well before it touches
--     plugin_data.csf_sheet_import_rows, so a trigger on the import tables
--     would set the switch after the write it needed to suppress.
--   * Restating those functions to add one PERFORM does not work either. The
--     class-history identity base is nearly seven hundred lines. Re-emitting it
--     to insert a single call is exactly the kind of transcription this ledger
--     should not carry, and a mistake in it would be a silent data defect.
--
-- So the switch is attached to the functions rather than written into them.
-- ALTER FUNCTION ... SET applies a setting for the duration of a call and
-- restores the previous value when the call returns, which is a tighter scope
-- than the transaction-local set_config the source lane uses: suppression
-- cannot outlive the import function even within the same transaction. No
-- function body changes here, and no historical migration is rewritten.
--
-- What deliberately does NOT get the switch:
--   * Every officer-facing profile edit. A staff correction to a current
--     member's record is exactly what a notice is for.
--   * Decision staging, decision sync and decision release. Those never queue
--     a personal notice in the first place, and they must never email.
BEGIN;

-- The lanes that rewrite member records in bulk.
--
-- Resolved from the catalog rather than spelled out, because two of these carry
-- long argument lists and a mistyped signature here would silently alter
-- nothing. A name that resolves to no function is an error, not a no-op.
DO $$
DECLARE
  c_lanes constant text[] := ARRAY[
    -- Application response import: the commit entry point, the identity base it
    -- delegates to, and the contact fill that writes the email columns.
    'csf_commit_import_row_for_attempt',
    'csf_commit_import_row_for_attempt_identity_base',
    'csf_fill_application_profile_contacts',
    -- Automatic application profile preparation, which creates and reconciles
    -- profiles ahead of a commit.
    'csf_prepare_automatic_application_profiles',
    -- Class history import: the identity base that writes profile names and
    -- contacts, plus every versioned row entry point in front of it.
    'csf_import_class_history_row_identity_base'
  ];
  v_target text;
  v_altered int := 0;
  v_missing text[] := ARRAY[]::text[];
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY c_lanes LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'plugin_data' AND p.proname = v_name
    ) THEN
      v_missing := v_missing || v_name;
    END IF;
  END LOOP;
  IF pg_catalog.array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'These CSF import lanes do not exist, so notice suppression would be attached to nothing: %',
      pg_catalog.array_to_string(v_missing, ', ')
      USING ERRCODE = '42883';
  END IF;

  FOR v_target IN
    SELECT p.oid::regprocedure::text
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plugin_data'
      AND (
        p.proname = ANY (c_lanes)
        -- Every versioned class-history row entry point. New versions are added
        -- over time and each one reaches the same identity base.
        OR p.proname LIKE 'csf\_import\_class\_history\_row\_v%'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET "app.csf_suppress_notices" = ''on''', v_target
    );
    v_altered := v_altered + 1;
  END LOOP;

  -- One per named lane at minimum, plus at least one versioned history entry
  -- point. A run that attached fewer has not covered what this migration says
  -- it covers.
  IF v_altered < pg_catalog.array_length(c_lanes, 1) + 1 THEN
    RAISE EXCEPTION
      'Notice suppression reached only % CSF import functions; expected at least %.',
      v_altered, pg_catalog.array_length(c_lanes, 1) + 1
      USING ERRCODE = '23514';
  END IF;
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_publication_notices_suppressed() IS
  'True while a bulk import, source reconciliation or retention lane has switched personal notices off. The source lane sets app.csf_suppress_notices for its transaction; the application and class-history import lanes carry it as a per-function setting attached in 20260917140000, which reverts when the function returns. A direct staff edit never sets it and still announces.';

COMMIT;
