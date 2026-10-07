-- In-app platform rating prompts. Adds three signed-in context kinds to
-- platform experience feedback and one service-role entry point that rechecks
-- ownership before it reaches the existing private writer.

BEGIN;

ALTER TABLE public.feedback DROP CONSTRAINT feedback_context_kind_check;
ALTER TABLE public.feedback ADD CONSTRAINT feedback_context_kind_check CHECK (
  context_kind IN ('project', 'csf_term', 'organizer_project', 'volunteer_signup', 'volunteer_hours')
);

-- The general, project and csf_term branches keep their earlier meaning.
ALTER TABLE public.feedback DROP CONSTRAINT feedback_experience_identity;
ALTER TABLE public.feedback ADD CONSTRAINT feedback_experience_identity CHECK (
  (purpose = 'general' AND user_id IS NOT NULL AND anonymous_id IS NULL
    AND context_kind IS NULL AND context_id IS NULL AND project_request_id IS NULL AND rating IS NULL)
  OR (purpose = 'platform_experience' AND rating IS NOT NULL AND context_id IS NOT NULL AND context_kind IS NOT NULL
    AND num_nonnulls(user_id, anonymous_id) = 1
    AND ((context_kind = 'project' AND project_request_id IS NOT NULL AND context_id = project_request_id)
      OR (context_kind = 'csf_term' AND user_id IS NOT NULL AND project_request_id IS NULL)
      OR (context_kind IN ('organizer_project', 'volunteer_signup')
        AND user_id IS NOT NULL AND anonymous_id IS NULL AND project_request_id IS NULL)
      OR (context_kind = 'volunteer_hours'
        AND user_id IS NOT NULL AND anonymous_id IS NULL AND project_request_id IS NULL
        AND context_id = user_id)))
);

CREATE OR REPLACE FUNCTION app_private.save_platform_experience_feedback(
  p_user_id uuid, p_anonymous_id uuid, p_context_kind text, p_context_id uuid,
  p_rating smallint, p_comment text, p_update_comment boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_feedback public.feedback%ROWTYPE;
  v_email text;
BEGIN
  IF num_nonnulls(p_user_id, p_anonymous_id) <> 1 OR p_context_id IS NULL OR p_context_kind IS NULL
    OR p_context_kind NOT IN ('project', 'csf_term', 'organizer_project', 'volunteer_signup', 'volunteer_hours')
    OR (p_context_kind IN ('organizer_project', 'volunteer_signup', 'volunteer_hours') AND p_user_id IS NULL)
    OR (p_context_kind = 'volunteer_hours' AND p_context_id IS DISTINCT FROM p_user_id)
    OR (p_rating IS NOT NULL AND p_rating NOT BETWEEN 1 AND 5)
    OR p_update_comment IS NULL OR (p_update_comment AND char_length(coalesce(p_comment, '')) > 2000)
    OR (NOT p_update_comment AND p_rating IS NULL) THEN
    RAISE EXCEPTION 'Invalid experience feedback.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('experience-feedback:' || p_context_id::text, 0));
  SELECT * INTO v_feedback FROM public.feedback
    WHERE purpose = 'platform_experience' AND context_kind = p_context_kind AND context_id = p_context_id FOR UPDATE;
  -- One response per context. A second project manager cannot overwrite the first.
  IF FOUND AND (v_feedback.user_id IS DISTINCT FROM p_user_id OR v_feedback.anonymous_id IS DISTINCT FROM p_anonymous_id) THEN
    RAISE EXCEPTION 'Feedback belongs to a different attendee.' USING ERRCODE = '42501';
  END IF;
  IF v_feedback.id IS NULL THEN
    IF p_rating IS NULL OR p_update_comment THEN
      RAISE EXCEPTION 'Choose a rating before sending a comment.' USING ERRCODE = '22023';
    END IF;
    IF p_user_id IS NOT NULL THEN
      SELECT email INTO v_email FROM public.profiles WHERE id = p_user_id;
    ELSE
      SELECT email INTO v_email FROM public.anonymous_signups WHERE id = p_anonymous_id;
    END IF;
    INSERT INTO public.feedback(user_id, anonymous_id, purpose, rating, context_kind, context_id,
      project_request_id, section, email, title, feedback)
    VALUES(p_user_id, p_anonymous_id, 'platform_experience', p_rating, p_context_kind, p_context_id,
      CASE WHEN p_context_kind = 'project' THEN p_context_id END, 'other', coalesce(v_email, ''),
      'Using Let''s Assist', '') RETURNING * INTO v_feedback;
  ELSE
    UPDATE public.feedback SET rating = coalesce(p_rating, rating),
      feedback = CASE WHEN p_update_comment THEN btrim(coalesce(p_comment, '')) ELSE feedback END,
      updated_at = now() WHERE id = v_feedback.id RETURNING * INTO v_feedback;
  END IF;
  IF p_update_comment THEN
    -- A changed comment returns to the existing platform-admin moderation queue.
    UPDATE public.feedback SET metadata = coalesce(metadata, '{}'::jsonb) - 'adminModeration'
      WHERE id = v_feedback.id;
    IF pg_catalog.to_regclass('public.feedback_moderation') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.feedback_moderation WHERE feedback_id = $1' USING v_feedback.id;
    END IF;
  END IF;
  RETURN jsonb_build_object('id', v_feedback.id, 'rating', v_feedback.rating, 'comment', v_feedback.feedback);
END;
$$;
REVOKE ALL ON FUNCTION app_private.save_platform_experience_feedback(uuid, uuid, text, uuid, smallint, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.save_platform_experience_feedback(uuid, uuid, text, uuid, smallint, text, boolean) TO postgres;

-- The Server Action passes the session user id. Ownership is rechecked here
-- because the service role bypasses RLS.
CREATE FUNCTION public.save_platform_experience_for_user(
  p_user_id uuid, p_context_kind text, p_context_id uuid,
  p_rating smallint, p_comment text, p_update_comment boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_context_id IS NULL OR p_context_kind IS NULL
    OR p_context_kind NOT IN ('organizer_project', 'volunteer_signup', 'volunteer_hours') THEN
    RAISE EXCEPTION 'Invalid experience feedback.' USING ERRCODE = '22023';
  END IF;
  IF p_context_kind = 'organizer_project' THEN
    PERFORM 1 FROM public.projects
      WHERE id = p_context_id AND status = 'completed' AND cancelled_at IS NULL FOR SHARE;
    IF NOT FOUND OR NOT app_private.can_manage_project(p_context_id, p_user_id) THEN
      RAISE EXCEPTION 'Experience prompt is not available.' USING ERRCODE = '42501';
    END IF;
  ELSIF p_context_kind = 'volunteer_signup' THEN
    PERFORM 1 FROM public.project_signups WHERE id = p_context_id AND user_id = p_user_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Experience prompt is not available.' USING ERRCODE = '42501';
    END IF;
  ELSIF p_context_id <> p_user_id THEN
    RAISE EXCEPTION 'Experience prompt is not available.' USING ERRCODE = '42501';
  END IF;
  RETURN app_private.save_platform_experience_feedback(p_user_id, NULL, p_context_kind, p_context_id,
    p_rating, p_comment, p_update_comment);
END;
$$;
REVOKE ALL ON FUNCTION public.save_platform_experience_for_user(uuid, text, uuid, smallint, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_platform_experience_for_user(uuid, text, uuid, smallint, text, boolean)
  TO service_role;

COMMIT;
