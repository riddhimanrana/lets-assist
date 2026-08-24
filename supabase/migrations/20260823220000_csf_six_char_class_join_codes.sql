-- Class join codes shrink from 8 uppercase hex chars to 6 chars drawn from an
-- unambiguous uppercase alphabet (no 0/O/1/I): officers read these codes off
-- projectors and whiteboards, so lookalike glyphs cost real support time.
-- Existing rows are regenerated in place (preview-only deployment; codes have
-- not been distributed) because the CHECK constraint applies table-wide, and
-- csf_join_class_by_code matches upper(btrim(p_code)) with no length gate, so
-- it needs no change.

CREATE OR REPLACE FUNCTION plugin_data.csf_generate_class_join_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(6);
  v_code text := '';
  v_index integer;
BEGIN
  FOR v_index IN 0..5 LOOP
    v_code := v_code
      || substr(v_alphabet, (get_byte(v_bytes, v_index) % 32) + 1, 1);
  END LOOP;
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_generate_class_join_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_generate_class_join_code()
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_generate_class_join_code() IS
  'Six characters from a 32-letter alphabet that omits 0/O/1/I. Callers own collision retries against csf_class_join_codes_code_uidx.';

-- Drop the 8-hex CHECK BEFORE regenerating, not after.
--
-- The constraint validates every row, so rewriting existing codes into the new
-- six-character alphabet while the old CHECK is still installed fails outright:
--   new row for relation "csf_class_join_codes" violates check constraint
--   "csf_class_join_codes_code_check"
-- This ordering passed everywhere the table happened to be empty (the loop
-- simply never ran) and failed the first time it met an environment holding a
-- real code, which is exactly what happened on Production.
DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT conname
  INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'plugin_data.csf_class_join_codes'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%[A-F0-9]{8}%';
  IF v_constraint IS NULL THEN
    RAISE EXCEPTION
      'Expected the 8-hex CHECK on plugin_data.csf_class_join_codes; refusing to guess.';
  END IF;
  EXECUTE format(
    'ALTER TABLE plugin_data.csf_class_join_codes DROP CONSTRAINT %I',
    v_constraint
  );
END;
$$;

-- Regenerate every existing code (active and historical) now that the old
-- CHECK is gone and the new one is not yet installed.
DO $$
DECLARE
  v_row record;
  v_code text;
  v_attempt integer;
BEGIN
  FOR v_row IN
    SELECT id FROM plugin_data.csf_class_join_codes ORDER BY created_at
  LOOP
    v_attempt := 0;
    LOOP
      v_attempt := v_attempt + 1;
      v_code := plugin_data.csf_generate_class_join_code();
      BEGIN
        UPDATE plugin_data.csf_class_join_codes
        SET code = v_code
        WHERE id = v_row.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_attempt >= 8 THEN
          RAISE EXCEPTION
            'Could not regenerate a unique CSF class code for row %.',
            v_row.id;
        END IF;
      END;
    END LOOP;
  END LOOP;
END;
$$;

ALTER TABLE plugin_data.csf_class_join_codes
  ADD CONSTRAINT csf_class_join_codes_code_check
  CHECK (code ~ '^[A-HJ-NP-Z2-9]{6}$');

-- Same body as 20260817021000; only the code-generation line changes.
CREATE OR REPLACE FUNCTION plugin_data.csf_rotate_class_join_code(
  p_organization_id uuid,
  p_cohort_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous plugin_data.csf_class_join_codes%ROWTYPE;
  v_created plugin_data.csf_class_join_codes%ROWTYPE;
  v_code text;
  v_attempt integer := 0;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_cohorts_terms'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF class codes.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':class-code:' || p_cohort_id::text,
      0
    )
  );

  PERFORM 1
  FROM plugin_data.csf_cohorts AS cohort
  WHERE cohort.organization_id = p_organization_id
    AND cohort.id = p_cohort_id
    AND cohort.status <> 'archived'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The active CSF class was not found.';
  END IF;

  SELECT join_code.*
  INTO v_previous
  FROM plugin_data.csf_class_join_codes AS join_code
  WHERE join_code.organization_id = p_organization_id
    AND join_code.cohort_id = p_cohort_id
    AND join_code.status = 'active'
  FOR UPDATE;

  IF v_previous.id IS NOT NULL THEN
    UPDATE plugin_data.csf_class_join_codes
    SET status = 'rotated',
        revoked_by = p_actor_user_id,
        revoked_at = now(),
        revoke_reason = 'Rotated by an authorized CSF owner.'
    WHERE id = v_previous.id;
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_code := plugin_data.csf_generate_class_join_code();
    BEGIN
      INSERT INTO plugin_data.csf_class_join_codes (
        organization_id, cohort_id, code, replaces_code_id, created_by
      ) VALUES (
        p_organization_id, p_cohort_id, v_code, v_previous.id, p_actor_user_id
      ) RETURNING * INTO v_created;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 8 THEN
        RAISE EXCEPTION 'Could not generate a unique CSF class code.';
      END IF;
    END;
  END LOOP;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'class.join_code.rotated',
    'csf_class_join_codes', v_created.id,
    jsonb_build_object(
      'cohortId', p_cohort_id,
      'replacedCodeId', v_previous.id,
      'status', v_created.status
    ),
    v_correlation_id, 'class_join_code', v_created.id::text,
    CASE WHEN v_previous.id IS NULL THEN 'class_code_created' ELSE 'class_code_rotated' END
  );

  RETURN jsonb_build_object(
    'id', v_created.id,
    'cohortId', v_created.cohort_id,
    'code', v_created.code,
    'status', v_created.status,
    'createdAt', v_created.created_at,
    'correlationId', v_correlation_id
  );
END;
$$;
