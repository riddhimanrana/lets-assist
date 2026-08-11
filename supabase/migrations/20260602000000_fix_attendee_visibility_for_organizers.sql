-- Update get_public_attendees to allow project organizers to see attendees even if show_attendees_publicly is false
CREATE OR REPLACE FUNCTION "public"."get_public_attendees"("p_project_id" "uuid") RETURNS TABLE("signup_id" "uuid", "schedule_id" "text", "user_id" "uuid", "full_name" "text", "username" "text", "avatar_url" "text", "volunteer_comment" "text", "is_anonymous" boolean, "anonymous_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_show_publicly boolean;
  v_visibility text;
  v_is_organizer boolean;
BEGIN
  -- Check if project exists and get its settings
  SELECT 
    p.show_attendees_publicly,
    p.visibility
  INTO v_show_publicly, v_visibility
  FROM projects p
  WHERE p.id = p_project_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Check if the current user is an organizer or super admin
  v_is_organizer := public.is_project_organizer(p_project_id, auth.uid()) OR public.is_super_admin();

  -- If not an organizer, enforce public display settings
  IF NOT v_is_organizer THEN
    IF NOT v_show_publicly OR v_visibility NOT IN ('public', 'unlisted') THEN
      RETURN;
    END IF;
  END IF;

  -- Return attendee details for approved/attended signups, grouped by schedule_id
  RETURN QUERY
  SELECT 
    ps.id AS signup_id,
    ps.schedule_id,
    ps.user_id,
    COALESCE(prof.full_name, '') AS full_name,
    COALESCE(prof.username, '') AS username,
    COALESCE(prof.avatar_url, '') AS avatar_url,
    COALESCE(ps.volunteer_comment, '') AS volunteer_comment,
    (ps.anonymous_id IS NOT NULL) AS is_anonymous,
    COALESCE(anon.name, '') AS anonymous_name
  FROM project_signups ps
  LEFT JOIN profiles prof ON prof.id = ps.user_id
  LEFT JOIN anonymous_signups anon ON anon.id = ps.anonymous_id
  WHERE ps.project_id = p_project_id
    AND ps.status IN ('approved', 'attended')
  ORDER BY ps.created_at ASC;
END;
$$;
