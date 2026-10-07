BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(24);

SELECT extensions.lives_ok(format($case$
  DO $body$
  DECLARE v_id uuid := gen_random_uuid(); v_rows jsonb;
  BEGIN
    PERFORM public.start_worker_run_receipt(v_id,%1$L,'local',repeat('a',40));
    PERFORM public.finish_worker_run_receipt(v_id,%1$L,'local',
      '{"outcome":"no_run","code":"empty_queue","durationMs":800000,"attempted":0,"completed":0,"failed":0,"pending":0,"refused":0,"faults":0,"deadlineReached":false}'::jsonb);
    v_rows := public.read_worker_run_receipts(%1$L,'local');
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r->>'run_id'=v_id::text AND r->>'duration_ms'='800000') THEN
      RAISE EXCEPTION 'Worker receipt was not persisted in its requested scope';
    END IF;
    IF jsonb_array_length(public.read_worker_run_receipts(%1$L,'production')) <> 0 THEN
      RAISE EXCEPTION 'Worker receipt crossed environment scope';
    END IF;
  END $body$;
$case$,worker),worker || ' records and reads a scoped enabled pass')
FROM (VALUES
  ('project-cancellations'),('csf-communications-dispatch'),('data-exports'),
  ('ai-moderation'),('anonymous-cleanup'),('auto-publish-hours'),
  ('csf-class-workbook-refresh'),('csf-import-commit'),('csf-proof-cleanup'),
  ('csf-publication-notifications'),('generate-recurring-projects'),
  ('organization-calendar-sync'),('organization-sheet-sync'),
  ('paper-scan-cleanup'),('paper-signup-notifications'),
  ('project-feedback-followups'),('waiver-cleanup'),('public-image-cleanup')
) w(worker);

SELECT extensions.throws_ok($$SELECT public.start_worker_run_receipt(gen_random_uuid(),'csf-scheduled-post-publisher','local')$$,'23514',NULL,'retired publisher cannot create an execution receipt');
SELECT extensions.throws_ok($$SELECT public.read_worker_run_receipts('csf-scheduled-post-publisher','local')$$,'22023','Invalid worker receipt scope.','retired publisher cannot claim observed scope');
SELECT extensions.throws_ok($$UPDATE app_private.worker_run_receipts SET duration_ms=900001 WHERE environment='local'$$,'23514',NULL,'duration above the observation budget is refused');
SELECT extensions.ok(NOT has_function_privilege('anon','public.read_worker_run_receipts(text,text)','EXECUTE'),'anonymous cannot read expanded worker scope');
SELECT extensions.ok(NOT has_function_privilege('authenticated','public.read_worker_run_receipts(text,text)','EXECUTE'),'authenticated client cannot read expanded worker scope');
SELECT extensions.ok(has_function_privilege('service_role','public.read_worker_run_receipts(text,text)','EXECUTE'),'service role retains reviewed read access');
SELECT * FROM extensions.finish();
ROLLBACK;
