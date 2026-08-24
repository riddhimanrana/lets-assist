-- Append-only repair for the six-character class join code swap.
--
-- 20260823220000 rewrote every existing code into the new alphabet and only
-- afterwards swapped the CHECK. A CHECK validates every row, so on a database
-- that actually held a code the first UPDATE was refused:
--
--   new row for relation "csf_class_join_codes" violates check constraint
--   "csf_class_join_codes_code_check"
--
-- It succeeded wherever the table happened to be empty, because the loop never
-- ran. That is why local, hosted Development and CI all passed and Production,
-- holding one legacy eight-character code, failed and rolled back.
--
-- 20260823220000 is deliberately NOT edited. Every database that ran it ran the
-- version recorded in the ledger, and rewriting an applied migration would make
-- that history unreproducible. This migration repairs forward instead, and is
-- a no-op on every environment that is already correct.
DO $$
DECLARE
  v_legacy_constraint text;
  v_row record;
  v_code text;
  v_attempt integer;
BEGIN
  -- Nothing to do unless the legacy eight-hex CHECK is still installed. On an
  -- environment 20260823220000 completed on, this is already the six-character
  -- constraint and the block exits without touching a row.
  SELECT conname
  INTO v_legacy_constraint
  FROM pg_constraint
  WHERE conrelid = 'plugin_data.csf_class_join_codes'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%[A-F0-9]{8}%';

  IF v_legacy_constraint IS NULL THEN
    RETURN;
  END IF;

  -- Drop first. This is the ordering 20260823220000 needed: the rewrite below
  -- cannot satisfy the constraint it is replacing.
  EXECUTE format(
    'ALTER TABLE plugin_data.csf_class_join_codes DROP CONSTRAINT %I',
    v_legacy_constraint
  );

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

  -- Only add the six-character CHECK if the swap did not already install it.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_class_join_codes'::regclass
      AND conname = 'csf_class_join_codes_code_check'
  ) THEN
    ALTER TABLE plugin_data.csf_class_join_codes
      ADD CONSTRAINT csf_class_join_codes_code_check
      CHECK (code ~ '^[A-HJ-NP-Z2-9]{6}$');
  END IF;
END;
$$;
