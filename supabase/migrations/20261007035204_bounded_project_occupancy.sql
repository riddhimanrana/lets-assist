-- Aggregate feed occupancy inside PostgreSQL so Data API row limits cannot
-- truncate signup counts. Only the server role can request this projection.

BEGIN;

CREATE FUNCTION public.project_occupancy_for_visible_projects(
  p_project_ids uuid[],
  p_viewer_id uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL
)
RETURNS TABLE (
  project_id uuid,
  slots_filled bigint,
  slots_filled_by_schedule jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_project_ids IS NULL
    OR pg_catalog.cardinality(p_project_ids) > 100
    OR pg_catalog.array_ndims(p_project_ids) > 1 THEN
    RAISE EXCEPTION 'Project occupancy requires an array of at most 100 project IDs.'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.array_position(p_project_ids, NULL::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'Project occupancy IDs cannot be null.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH visible AS MATERIALIZED (
    SELECT project.id
    FROM public.projects AS project
    WHERE project.id = ANY(p_project_ids)
      AND (
        -- Match project_discovery_read_model for the public feed.
        (p_organization_id IS NULL
          AND project.visibility = 'public'
          AND (project.workflow_status IS NULL OR project.workflow_status = 'published'))
        OR (
          p_organization_id IS NOT NULL
          AND project.organization_id = p_organization_id
          -- Match the existing projects SELECT policies. The server supplies
          -- the authenticated viewer, never an action argument from the browser.
          AND (
            (project.visibility IN ('public', 'unlisted')
              AND (project.workflow_status IS NULL OR project.workflow_status = 'published'))
            OR (p_viewer_id IS NOT NULL AND (
              project.creator_id = p_viewer_id
              OR EXISTS (
                SELECT 1 FROM public.organization_members AS member
                WHERE member.organization_id = project.organization_id
                  AND member.user_id = p_viewer_id
                  AND member.role IN ('admin', 'staff')
              )
            ))
          )
        )
      )
  ), schedule_counts AS (
    SELECT signup.project_id, signup.schedule_id, count(*) AS filled
    FROM public.project_signups AS signup
    JOIN visible ON visible.id = signup.project_id
    WHERE signup.status IN ('pending', 'approved', 'attended')
    GROUP BY signup.project_id, signup.schedule_id
  )
  SELECT visible.id,
    coalesce(sum(schedule_counts.filled), 0)::bigint,
    coalesce(
      jsonb_object_agg(schedule_counts.schedule_id, schedule_counts.filled)
        FILTER (WHERE schedule_counts.schedule_id IS NOT NULL AND schedule_counts.schedule_id <> ''),
      '{}'::jsonb
    )
  FROM visible
  LEFT JOIN schedule_counts ON schedule_counts.project_id = visible.id
  GROUP BY visible.id
  ORDER BY visible.id;
END;
$$;

REVOKE ALL ON FUNCTION public.project_occupancy_for_visible_projects(uuid[], uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.project_occupancy_for_visible_projects(uuid[], uuid, uuid)
  TO service_role;
COMMENT ON FUNCTION public.project_occupancy_for_visible_projects(uuid[], uuid, uuid) IS
  'Service-only exact feed counts for at most 100 project IDs. The trusted server derives viewer identity from the authenticated session. Null organization selects public discovery; an organization selects only projects readable under the existing project SELECT contract. Omits unreadable IDs and returns zero counts for readable empty projects. No signup identity data is returned.';

COMMIT;
