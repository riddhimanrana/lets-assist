-- The populated-table case the six-character swap was never exercised against.
--
-- 20260823220000 rewrote every existing join code and only then swapped the
-- CHECK. A CHECK validates every row, so the rewrite could not satisfy the
-- constraint it was replacing. Every environment that ran it happened to hold
-- an empty table, so the regeneration loop never ran and nothing caught it.
-- Production held one legacy eight-character code and the push failed there.
--
-- 20260824040000 repairs forward. These assertions pin the property that was
-- missing: with rows present and the legacy constraint installed, the repair
-- converges the table onto the six-character alphabet instead of erroring.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(4);

-- A database still carrying the legacy CHECK and a real eight-hex code.
ALTER TABLE plugin_data.csf_class_join_codes
  DROP CONSTRAINT IF EXISTS csf_class_join_codes_code_check;
ALTER TABLE plugin_data.csf_class_join_codes
  ADD CONSTRAINT csf_class_join_codes_code_check
  CHECK (code ~ '^[A-F0-9]{8}$');

DELETE FROM plugin_data.csf_class_join_codes;
INSERT INTO plugin_data.csf_class_join_codes
  (id, organization_id, cohort_id, code, status, created_by, created_at)
SELECT
  '00000000-0000-4000-8000-00000000f001',
  cohort.organization_id,
  cohort.id,
  'ABCD1234',
  'active',
  (
    SELECT member.user_id
    FROM public.organization_members AS member
    WHERE member.organization_id = cohort.organization_id
    LIMIT 1
  ),
  now()
FROM plugin_data.csf_cohorts AS cohort
LIMIT 1;

SELECT extensions.is(
  (SELECT code FROM plugin_data.csf_class_join_codes
   WHERE id = '00000000-0000-4000-8000-00000000f001'),
  'ABCD1234',
  'the legacy eight-character code is the starting state'
);

-- Rewriting into the new alphabet under the legacy CHECK is exactly what the
-- original swap attempted, and exactly what Production refused.
SELECT extensions.throws_ok(
  $$UPDATE plugin_data.csf_class_join_codes
      SET code = 'ABCDEF'
      WHERE id = '00000000-0000-4000-8000-00000000f001'$$,
  '23514',
  NULL,
  'the legacy CHECK refuses a six-character code, which is why the swap failed'
);

-- The repair drops the legacy CHECK first, then rewrites, then installs the new
-- one. Running its body here proves it converges a populated table.
DO $$
DECLARE
  v_legacy_constraint text;
  v_row record;
  v_code text;
BEGIN
  SELECT conname INTO v_legacy_constraint
  FROM pg_constraint
  WHERE conrelid = 'plugin_data.csf_class_join_codes'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%[A-F0-9]{8}%';
  IF v_legacy_constraint IS NULL THEN RETURN; END IF;
  EXECUTE format(
    'ALTER TABLE plugin_data.csf_class_join_codes DROP CONSTRAINT %I',
    v_legacy_constraint
  );
  FOR v_row IN SELECT id FROM plugin_data.csf_class_join_codes LOOP
    v_code := plugin_data.csf_generate_class_join_code();
    UPDATE plugin_data.csf_class_join_codes SET code = v_code WHERE id = v_row.id;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_class_join_codes'::regclass
      AND conname = 'csf_class_join_codes_code_check'
  ) THEN
    ALTER TABLE plugin_data.csf_class_join_codes
      ADD CONSTRAINT csf_class_join_codes_code_check
      CHECK (code ~ '^[A-HJ-NP-Z2-9]{6}$');
  END IF;
END;
$$;

SELECT extensions.matches(
  (SELECT code FROM plugin_data.csf_class_join_codes
   WHERE id = '00000000-0000-4000-8000-00000000f001'),
  '^[A-HJ-NP-Z2-9]{6}$',
  'the populated row is rewritten onto the six-character alphabet'
);

SELECT extensions.is(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid = 'plugin_data.csf_class_join_codes'::regclass
     AND conname = 'csf_class_join_codes_code_check'),
  'CHECK ((code ~ ''^[A-HJ-NP-Z2-9]{6}$''::text))',
  'the six-character CHECK is the constraint left installed'
);

SELECT * FROM extensions.finish();
ROLLBACK;
