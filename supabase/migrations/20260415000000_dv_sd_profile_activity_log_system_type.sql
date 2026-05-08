-- Allow DV Speech & Debate system-level activity entries for sync and automation logs.

DO $$
DECLARE
  constraint_name text;
BEGIN
  IF to_regclass('plugin_data.dv_sd_profile_activity_log') IS NULL THEN
    RETURN;
  END IF;

  SELECT c.conname
    INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'plugin_data'
    AND t.relname = 'dv_sd_profile_activity_log'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%profile_type%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE plugin_data.dv_sd_profile_activity_log DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;

  EXECUTE '
    ALTER TABLE plugin_data.dv_sd_profile_activity_log
      ADD CONSTRAINT dv_sd_profile_activity_log_profile_type_check
      CHECK (profile_type IN (''student'', ''parent'', ''link'', ''submission'', ''bulk_import'', ''system''))
  ';
END $$;
