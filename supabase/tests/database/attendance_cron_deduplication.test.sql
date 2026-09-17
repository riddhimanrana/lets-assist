BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(3);

SELECT is(
  (SELECT count(*) FROM cron.job
   WHERE jobname IN ('Auto check-in signups', 'Auto check-out signups')),
  0::bigint,
  'Legacy attendance schedules no longer duplicate the current jobs'
);
SELECT is(
  (SELECT count(*) FROM cron.job
   WHERE (jobname, regexp_replace(lower(command), '[[:space:];]', '', 'g')) IN (
     ('process-automatic-check-ins', 'selectpublic.process_automatic_check_ins()'),
     ('process-automatic-check-outs', 'selectpublic.process_automatic_check_outs()'))
     AND active AND schedule = '* * * * *'),
  2::bigint,
  'Both canonical attendance jobs still run once per minute'
);
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.pronargs=0 AND (
     (p.proname='checkin_signups' AND regexp_replace(lower(p.prosrc), '[[:space:]]', '', 'g') = 'beginperformpublic.process_automatic_check_ins();end;')
     OR (p.proname='checkout_signups' AND regexp_replace(lower(p.prosrc), '[[:space:]]', '', 'g') = 'beginperformpublic.process_automatic_check_outs();end;'))),
  2::bigint,
  'Legacy callable entrypoints remain compatible with the canonical functions'
);
SELECT * FROM finish();
ROLLBACK;
