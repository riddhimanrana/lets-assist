-- Both anonymous-retention entry points preserve waiver cleanup and certificate provenance.
BEGIN;

CREATE FUNCTION private.anonymous_signup_retention_eligible(p_anonymous_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_anonymous public.anonymous_signups%ROWTYPE;
  v_project record;
  v_has_project boolean := false;
  v_cutoff timestamptz := now() - interval '30 days';
BEGIN
  SELECT * INTO v_anonymous FROM public.anonymous_signups WHERE id = p_anonymous_id;
  IF NOT FOUND OR v_anonymous.linked_user_id IS NOT NULL THEN RETURN false; END IF;
  FOR v_project IN
    SELECT p.* FROM (
      SELECT v_anonymous.project_id AS id WHERE v_anonymous.project_id IS NOT NULL
      UNION SELECT project_id FROM public.project_signups WHERE anonymous_id = p_anonymous_id
    ) related LEFT JOIN public.projects p ON p.id = related.id
  LOOP
    v_has_project := true;
    IF v_project.status = 'cancelled' THEN
      IF v_project.cancelled_at IS NULL OR v_project.cancelled_at > v_cutoff THEN RETURN false; END IF;
    ELSIF v_project.status = 'completed' THEN
      IF NOT EXISTS (SELECT 1 FROM private.project_status_schedule_window(
        v_project.event_type, v_project.schedule, v_project.project_timezone) w
        WHERE w.ends_at <= v_cutoff) THEN RETURN false; END IF;
    ELSE
      RETURN false;
    END IF;
  END LOOP;
  RETURN v_has_project OR v_anonymous.created_at < v_cutoff;
END;
$$;
REVOKE ALL ON FUNCTION private.anonymous_signup_retention_eligible(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.anonymous_signup_retention_eligible(uuid) TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.archive_anonymous_signups_for_cleanup(p_anonymous_ids uuid[])
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_signup_ids uuid[];
  v_signature_ids uuid[];
  v_paths text[];
  v_source_paths text[];
  v_source_path text;
  v_deleted bigint := 0;
  v_count bigint;
BEGIN
  IF cardinality(coalesce(p_anonymous_ids, ARRAY[]::uuid[])) > 500 THEN
    RAISE EXCEPTION 'too many anonymous profiles in one cleanup batch';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('lets-assist-anonymous-retention',0)) THEN RETURN 0; END IF;
  FOR v_id IN SELECT DISTINCT id FROM unnest(coalesce(p_anonymous_ids,ARRAY[]::uuid[])) id
    WHERE id IS NOT NULL ORDER BY id
  LOOP
    BEGIN
      -- NOWAIT avoids inverting a live signup transaction's project-first locks.
      -- A busy candidate rolls back its locks and remains for the next bounded pass.
      PERFORM 1 FROM public.anonymous_signups WHERE id=v_id FOR UPDATE NOWAIT;
      IF NOT FOUND THEN CONTINUE; END IF;
      PERFORM 1 FROM public.project_signups WHERE anonymous_id=v_id ORDER BY id FOR UPDATE NOWAIT;
      PERFORM 1 FROM public.projects WHERE id IN (
        SELECT project_id FROM public.anonymous_signups WHERE id=v_id
        UNION SELECT project_id FROM public.project_signups WHERE anonymous_id=v_id
      ) ORDER BY id FOR SHARE NOWAIT;
      IF NOT private.anonymous_signup_retention_eligible(v_id) THEN CONTINUE; END IF;

      SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO v_signup_ids
        FROM public.project_signups WHERE anonymous_id=v_id;
      PERFORM 1 FROM public.waiver_signatures
        WHERE anonymous_id=v_id OR signup_id=ANY(v_signup_ids) ORDER BY id FOR UPDATE NOWAIT;
      SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO v_signature_ids
        FROM public.waiver_signatures WHERE anonymous_id=v_id OR signup_id=ANY(v_signup_ids);
      SELECT coalesce(array_agg(object_path),ARRAY[]::text[]) INTO v_paths
        FROM private.waiver_storage_paths_for_signatures(v_signature_ids);
      SELECT coalesce(array_agg(DISTINCT waiver_pdf_storage_path),ARRAY[]::text[])
        INTO v_source_paths FROM public.waiver_signatures
        WHERE id=ANY(v_signature_ids) AND waiver_pdf_storage_path IS NOT NULL;

      DELETE FROM public.waiver_signatures WHERE id=ANY(v_signature_ids);
      -- Existing SET NULL foreign keys preserve certificate issuance evidence.
      DELETE FROM public.project_signups WHERE id=ANY(v_signup_ids);
      DELETE FROM public.anonymous_signups WHERE id=v_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      PERFORM private.enqueue_unreferenced_waiver_storage_paths(v_paths);
      FOREACH v_source_path IN ARRAY v_source_paths LOOP
        PERFORM public.enqueue_superseded_waiver_source(v_source_path);
      END LOOP;
      v_deleted := v_deleted + v_count;
    EXCEPTION WHEN lock_not_available THEN
      CONTINUE;
    END;
  END LOOP;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.archive_anonymous_signups_for_cleanup(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archive_anonymous_signups_for_cleanup(uuid[]) TO service_role;
COMMENT ON FUNCTION public.archive_anonymous_signups_for_cleanup(uuid[]) IS
  'Revalidates at most 500 unlinked expired anonymous accounts under row locks, preserves certificates, and queues unreferenced waiver evidence atomically. Busy candidates remain for retry.';

CREATE OR REPLACE FUNCTION public.delete_old_anonymous_signups()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ids uuid[];
BEGIN
  SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO v_ids FROM (
    SELECT a.id FROM public.anonymous_signups a
    WHERE a.linked_user_id IS NULL AND private.anonymous_signup_retention_eligible(a.id)
    ORDER BY a.created_at,a.id LIMIT 500
  ) candidates;
  RETURN public.archive_anonymous_signups_for_cleanup(v_ids)::integer;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_old_anonymous_signups() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_old_anonymous_signups() TO service_role;
COMMENT ON FUNCTION public.delete_old_anonymous_signups() IS
  'Bounded cron adapter for the same validated anonymous-retention transaction used by the application cleanup worker.';
COMMIT;
