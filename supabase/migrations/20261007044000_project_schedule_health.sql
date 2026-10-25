-- Refuse newly invalid published schedules and record maintenance health without repeated warnings.
BEGIN;

CREATE TABLE app_private.project_schedule_health (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 invalid_count bigint NOT NULL CHECK (invalid_count >= 0),
 fingerprint text NOT NULL,
 checked_at timestamptz NOT NULL,
 changed_at timestamptz NOT NULL
);
ALTER TABLE app_private.project_schedule_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.project_schedule_health FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON app_private.project_schedule_health TO service_role;

CREATE FUNCTION private.guard_published_project_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF coalesce(NEW.workflow_status, 'published') <> 'published' THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND coalesce(OLD.workflow_status, 'published') = 'published'
  AND NEW.schedule IS NOT DISTINCT FROM OLD.schedule
  AND NEW.event_type IS NOT DISTINCT FROM OLD.event_type
  AND NEW.project_timezone IS NOT DISTINCT FROM OLD.project_timezone THEN
  RETURN NEW;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM private.project_status_schedule_window(
  NEW.event_type, NEW.schedule, NEW.project_timezone)) THEN
  RAISE EXCEPTION 'Published projects require a valid schedule and timezone.' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_published_project_schedule() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.guard_published_project_schedule() TO postgres;
CREATE TRIGGER validate_published_project_schedule BEFORE INSERT OR UPDATE ON public.projects
 FOR EACH ROW EXECUTE FUNCTION private.guard_published_project_schedule();

CREATE OR REPLACE FUNCTION public.process_projects()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
 project record;
 schedule_window record;
 target_status text;
 run_at timestamptz := clock_timestamp();
 backlog_count bigint;
 backlog_fingerprint text;
 previous app_private.project_schedule_health%ROWTYPE;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('lets-assist-project-status-maintenance', 0)) THEN RETURN; END IF;
 FOR project IN
  SELECT id, event_type, schedule, project_timezone, status FROM public.projects
  WHERE coalesce(workflow_status, 'published') = 'published' AND status IN ('in-progress', 'upcoming')
  FOR UPDATE SKIP LOCKED
 LOOP
  SELECT * INTO schedule_window FROM private.project_status_schedule_window(
   project.event_type, project.schedule, project.project_timezone);
  IF NOT FOUND THEN CONTINUE; END IF;
  target_status := CASE WHEN run_at > schedule_window.ends_at THEN 'completed'
   WHEN run_at >= schedule_window.starts_at THEN 'in-progress' ELSE 'upcoming' END;
  IF project.status IS DISTINCT FROM target_status THEN
   UPDATE public.projects SET status = target_status WHERE id = project.id;
  END IF;
 END LOOP;

 -- Include locked rows in the health observation even when maintenance skipped them.
 SELECT count(*), md5(coalesce(string_agg(p.id::text || ':' || md5(
   jsonb_build_array(p.event_type, p.schedule, p.project_timezone)::text), ',' ORDER BY p.id), ''))
 INTO backlog_count, backlog_fingerprint FROM public.projects p
 WHERE coalesce(p.workflow_status, 'published') = 'published' AND p.status IN ('in-progress', 'upcoming')
  AND NOT EXISTS (SELECT 1 FROM private.project_status_schedule_window(p.event_type, p.schedule, p.project_timezone));
 SELECT * INTO previous FROM app_private.project_schedule_health WHERE singleton;
 INSERT INTO app_private.project_schedule_health(singleton, invalid_count, fingerprint, checked_at, changed_at)
 VALUES (true, backlog_count, backlog_fingerprint, run_at, run_at)
 ON CONFLICT (singleton) DO UPDATE SET invalid_count = EXCLUDED.invalid_count,
  fingerprint = EXCLUDED.fingerprint, checked_at = EXCLUDED.checked_at,
  changed_at = CASE WHEN project_schedule_health.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint
   THEN EXCLUDED.changed_at ELSE project_schedule_health.changed_at END;
 IF previous.fingerprint IS DISTINCT FROM backlog_fingerprint THEN
  IF backlog_count > 0 THEN
   RAISE WARNING 'Project schedule health changed: % published projects need schedule correction.', backlog_count;
  ELSIF previous.invalid_count > 0 THEN
   RAISE NOTICE 'Project schedule health recovered: no published schedules await correction.';
  END IF;
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.process_projects() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_projects() TO service_role;

CREATE FUNCTION public.get_project_schedule_health(p_actor_id uuid, p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Schedule health limit must be between 1 and 100.' USING ERRCODE = '22023';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_actor_id
  AND (u.raw_app_meta_data->'is_super_admin' = 'true'::jsonb
    OR lower(btrim(u.raw_app_meta_data->>'role')) = 'super_admin')
  AND app_private.account_deletion_actor_is_active(u.id)) THEN
  RAISE EXCEPTION 'Super admin access required.' USING ERRCODE = '42501';
 END IF;
 WITH invalid AS MATERIALIZED (
  SELECT p.id, p.title, p.event_type, p.organization_id FROM public.projects p
  WHERE coalesce(p.workflow_status, 'published') = 'published' AND p.status IN ('in-progress', 'upcoming')
   AND NOT EXISTS (SELECT 1 FROM private.project_status_schedule_window(p.event_type, p.schedule, p.project_timezone))
 ), limited AS (SELECT * FROM invalid ORDER BY id LIMIT p_limit)
 SELECT jsonb_build_object('invalid_count', (SELECT count(*) FROM invalid),
  'projects', coalesce((SELECT jsonb_agg(to_jsonb(limited) ORDER BY id) FROM limited), '[]'::jsonb),
  'last_run', (SELECT jsonb_build_object('invalid_count', h.invalid_count, 'fingerprint', h.fingerprint,
   'checked_at', h.checked_at, 'changed_at', h.changed_at) FROM app_private.project_schedule_health h WHERE singleton))
 INTO result;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_project_schedule_health(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_project_schedule_health(uuid, integer) TO service_role;
COMMIT;
