-- The legacy cron entrypoints delegate to the newer jobs already scheduled
-- every minute. Remove only verified duplicate jobs, preserving their successors.
DO $$
DECLARE
  mapping record;
  legacy cron.job%ROWTYPE;
  canonical cron.job%ROWTYPE;
  wrapper_body text;
BEGIN
  FOR mapping IN SELECT * FROM (VALUES
    ('Auto check-in signups', 'process-automatic-check-ins',
      'checkin_signups', 'process_automatic_check_ins'),
    ('Auto check-out signups', 'process-automatic-check-outs',
      'checkout_signups', 'process_automatic_check_outs')
  ) AS names(legacy_name, canonical_name, wrapper_name, target_name)
  LOOP
    SELECT * INTO legacy FROM cron.job WHERE jobname = mapping.legacy_name;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO canonical FROM cron.job WHERE jobname = mapping.canonical_name;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Attendance cron replacement is missing: %', mapping.canonical_name;
    END IF;
    IF NOT canonical.active
      OR canonical.schedule <> '* * * * *'
      OR canonical.database <> legacy.database
      OR canonical.username <> legacy.username
      OR legacy.schedule <> canonical.schedule
      OR regexp_replace(lower(canonical.command), '[[:space:];]', '', 'g')
        <> 'selectpublic.' || mapping.target_name || '()'
      OR regexp_replace(lower(legacy.command), '[[:space:];]', '', 'g')
        <> 'selectpublic.' || mapping.wrapper_name || '()'
    THEN
      RAISE EXCEPTION 'Attendance cron replacement does not match the reviewed duplicate job: %', mapping.legacy_name;
    END IF;
    SELECT regexp_replace(lower(prosrc), '[[:space:]]', '', 'g')
      INTO wrapper_body FROM pg_proc
      WHERE oid = to_regprocedure('public.' || mapping.wrapper_name || '()');
    IF wrapper_body IS DISTINCT FROM
      'beginperformpublic.' || mapping.target_name || '();end;'
    THEN
      RAISE EXCEPTION 'Attendance cron wrapper no longer delegates only to its replacement: %', mapping.wrapper_name;
    END IF;
    PERFORM cron.unschedule(legacy.jobid);
  END LOOP;
END;
$$;
