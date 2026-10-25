-- Extend aggregate execution evidence to every active platform cron route.
BEGIN;
ALTER TABLE app_private.worker_run_receipts
  DROP CONSTRAINT worker_run_receipts_worker_key_check,
  ADD CONSTRAINT worker_run_receipts_worker_key_check CHECK (worker_key IN ('project-cancellations','csf-communications-dispatch','data-exports','ai-moderation','anonymous-cleanup','auto-publish-hours','csf-class-workbook-refresh','csf-import-commit','csf-proof-cleanup','csf-publication-notifications','generate-recurring-projects','organization-calendar-sync','organization-sheet-sync','paper-scan-cleanup','paper-signup-notifications','project-feedback-followups','waiver-cleanup','public-image-cleanup')),
  DROP CONSTRAINT worker_run_receipts_duration_ms_check,
  ADD CONSTRAINT worker_run_receipts_duration_ms_check CHECK (duration_ms BETWEEN 0 AND 900000);

CREATE OR REPLACE FUNCTION public.read_worker_run_receipts(p_worker_key text,p_environment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_worker_key IS NULL OR p_worker_key NOT IN ('project-cancellations','csf-communications-dispatch','data-exports','ai-moderation','anonymous-cleanup','auto-publish-hours','csf-class-workbook-refresh','csf-import-commit','csf-proof-cleanup','csf-publication-notifications','generate-recurring-projects','organization-calendar-sync','organization-sheet-sync','paper-scan-cleanup','paper-signup-notifications','project-feedback-followups','waiver-cleanup','public-image-cleanup')
    OR p_environment IS NULL OR p_environment NOT IN ('local','development','production') THEN
    RAISE EXCEPTION 'Invalid worker receipt scope.' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(recent) ORDER BY recent.started_at DESC,recent.run_id DESC),'[]'::jsonb)
    INTO v_result FROM (
      SELECT * FROM app_private.worker_run_receipts
      WHERE worker_key=p_worker_key AND environment=p_environment
        AND started_at>=clock_timestamp()-interval '30 days'
      ORDER BY started_at DESC,run_id DESC LIMIT 20
    ) recent;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.read_worker_run_receipts(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_worker_run_receipts(text,text) TO service_role;
-- The existing service RPC catalog retains this service-only function.
COMMIT;
