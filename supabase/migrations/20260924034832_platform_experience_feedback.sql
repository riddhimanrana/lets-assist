BEGIN;

-- Existing requests keep their organizer purpose, including already issued links.
ALTER TABLE public.project_feedback_requests
  ADD COLUMN purpose text NOT NULL DEFAULT 'organizer'
  CHECK (purpose IN ('organizer', 'platform_experience'));
-- Keep unannotated legacy callers on organizer feedback; the new enqueue sets its purpose explicitly.
ALTER TABLE public.notification_settings ADD COLUMN feedback_requests boolean;
UPDATE public.notification_settings SET feedback_requests = coalesce(project_updates, true);
ALTER TABLE public.notification_settings ALTER COLUMN feedback_requests SET DEFAULT true;

CREATE TABLE app_private.platform_feedback_rollout (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_private.platform_feedback_rollout DEFAULT VALUES;
ALTER TABLE app_private.platform_feedback_rollout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.platform_feedback_rollout FROM PUBLIC, anon, authenticated;
GRANT SELECT ON app_private.platform_feedback_rollout TO service_role;

ALTER TABLE public.feedback
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN purpose text NOT NULL DEFAULT 'general' CHECK (purpose IN ('general', 'platform_experience')),
  ADD COLUMN rating smallint CHECK (rating BETWEEN 1 AND 5),
  ADD COLUMN context_kind text CHECK (context_kind IN ('project', 'csf_term')),
  ADD COLUMN context_id uuid,
  ADD COLUMN project_request_id uuid REFERENCES public.project_feedback_requests(id) ON DELETE CASCADE,
  ADD COLUMN anonymous_id uuid REFERENCES public.anonymous_signups(id) ON DELETE CASCADE,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT feedback_experience_identity CHECK (
    (purpose = 'general' AND user_id IS NOT NULL AND anonymous_id IS NULL
      AND context_kind IS NULL AND context_id IS NULL AND project_request_id IS NULL AND rating IS NULL)
    OR (purpose = 'platform_experience' AND rating IS NOT NULL AND context_id IS NOT NULL AND context_kind IS NOT NULL
      AND num_nonnulls(user_id, anonymous_id) = 1
      AND ((context_kind = 'project' AND project_request_id IS NOT NULL AND context_id = project_request_id)
        OR (context_kind = 'csf_term' AND user_id IS NOT NULL AND project_request_id IS NULL)))
  );
CREATE UNIQUE INDEX feedback_experience_context ON public.feedback(context_kind, context_id)
  WHERE purpose = 'platform_experience';

-- Experience writes use checked server functions. Existing general feedback stays editable.
DROP POLICY feedback_insert_authenticated ON public.feedback;
CREATE POLICY feedback_insert_authenticated ON public.feedback FOR INSERT TO authenticated
  WITH CHECK (purpose = 'general' AND user_id = (SELECT auth.uid()));
DROP POLICY feedback_update_authenticated ON public.feedback;
CREATE POLICY feedback_update_authenticated ON public.feedback FOR UPDATE TO authenticated
  USING (purpose = 'general' AND user_id = (SELECT auth.uid()))
  WITH CHECK (purpose = 'general' AND user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION app_private.save_platform_experience_feedback(
  p_user_id uuid, p_anonymous_id uuid, p_context_kind text, p_context_id uuid,
  p_rating smallint, p_comment text, p_update_comment boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_feedback public.feedback%ROWTYPE;
  v_email text;
BEGIN
  IF num_nonnulls(p_user_id, p_anonymous_id) <> 1 OR p_context_id IS NULL OR p_context_kind IS NULL
    OR p_context_kind NOT IN ('project', 'csf_term')
    OR (p_rating IS NOT NULL AND p_rating NOT BETWEEN 1 AND 5)
    OR p_update_comment IS NULL OR (p_update_comment AND char_length(coalesce(p_comment, '')) > 2000)
    OR (NOT p_update_comment AND p_rating IS NULL) THEN
    RAISE EXCEPTION 'Invalid experience feedback.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('experience-feedback:' || p_context_id::text, 0));
  SELECT * INTO v_feedback FROM public.feedback
    WHERE purpose = 'platform_experience' AND context_kind = p_context_kind AND context_id = p_context_id FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.save_platform_experience_from_request(
  p_request_id uuid, p_rating smallint, p_comment text, p_update_comment boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.project_feedback_requests%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_request FROM public.project_feedback_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.purpose <> 'platform_experience' THEN
    RAISE EXCEPTION 'Experience request is not eligible.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.projects WHERE id = v_request.project_id AND status = 'completed' AND cancelled_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project is not complete.' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.project_signups WHERE id = v_request.signup_id AND project_id = v_request.project_id
    AND status = 'attended' AND user_id IS NOT DISTINCT FROM v_request.user_id
    AND anonymous_id IS NOT DISTINCT FROM v_request.anonymous_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance could not be verified.' USING ERRCODE = '42501'; END IF;
  RETURN app_private.save_platform_experience_feedback(v_request.user_id, v_request.anonymous_id,
    'project', v_request.id, p_rating, p_comment, p_update_comment);
END;
$$;
REVOKE ALL ON FUNCTION public.save_platform_experience_from_request(uuid, smallint, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_platform_experience_from_request(uuid, smallint, text, boolean) TO service_role;

-- One unique attendee/project request remains the dispatch and retry boundary.
CREATE OR REPLACE FUNCTION public.enqueue_project_feedback_requests(p_project_id uuid, p_eligible_at timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_inserted integer := 0;
BEGIN
  IF p_project_id IS NULL OR p_eligible_at IS NULL THEN RAISE EXCEPTION 'Invalid feedback enqueue request.'; END IF;
  IF p_eligible_at < (SELECT enabled_at FROM app_private.platform_feedback_rollout WHERE singleton) THEN RETURN 0; END IF;
  WITH attendees AS (
    SELECT DISTINCT ON (coalesce(s.user_id::text, s.anonymous_id::text))
      s.id AS signup_id, s.user_id, s.anonymous_id, coalesce(p.email, a.email) AS email
    FROM public.project_signups s LEFT JOIN public.profiles p ON p.id = s.user_id
    LEFT JOIN public.anonymous_signups a ON a.id = s.anonymous_id
    WHERE s.project_id = p_project_id AND s.status = 'attended'
      AND (s.anonymous_id IS NULL OR a.email_opt_out_at IS NULL)
    ORDER BY coalesce(s.user_id::text, s.anonymous_id::text), s.created_at
  ), inserted AS (
    INSERT INTO public.project_feedback_requests(project_id, signup_id, user_id, anonymous_id,
      recipient_email_hash, eligible_at, purpose)
    SELECT p_project_id, signup_id, user_id, anonymous_id,
      encode(extensions.digest(lower(btrim(email)), 'sha256'), 'hex'), p_eligible_at, 'platform_experience'
    FROM attendees WHERE nullif(btrim(email), '') IS NOT NULL ON CONFLICT DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_inserted FROM inserted;
  RETURN v_inserted;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_project_feedback_requests(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_project_feedback_requests(uuid, timestamptz) TO service_role;

CREATE TABLE plugin_data.csf_experience_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  qualifying_points numeric NOT NULL,
  requirement numeric NOT NULL,
  UNIQUE (organization_id, profile_id, term_id)
);
ALTER TABLE plugin_data.csf_experience_prompts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_experience_prompts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON plugin_data.csf_experience_prompts TO service_role;
INSERT INTO plugin_data.csf_retention_reference_policy(parent_table, child_table, child_column, policy, note)
VALUES ('csf_profiles', 'csf_experience_prompts', 'profile_id', 'delete_with_owner', 'once-only experience prompt receipt');

-- Prompt receipts preserve the identity and totals observed before a profile merge.
ALTER FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid,uuid)
  RENAME TO csf_profile_merge_reference_plan_experience_base;
CREATE FUNCTION plugin_data.csf_profile_merge_reference_plan(p_organization_id uuid,p_source_profile_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE plan jsonb;
BEGIN
  plan:=plugin_data.csf_profile_merge_reference_plan_experience_base(p_organization_id,p_source_profile_id);
  RETURN jsonb_set(plan,'{immutableHistoryRetentions}',
    coalesce(plan->'immutableHistoryRetentions','[]'::jsonb)||jsonb_build_array(
      jsonb_build_object('reference','plugin_data.csf_experience_prompts.profile_id',
        'scope','consumed experience prompt evidence remains attached to its source profile tombstone',
        'sourceCount',(SELECT count(*) FROM plugin_data.csf_experience_prompts p
          WHERE p.organization_id=p_organization_id AND p.profile_id=p_source_profile_id))));
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan_experience_base(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_reference_plan_experience_base(uuid,uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid,uuid) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_consume_experience_prompt(
  p_organization_id uuid, p_term_id uuid, p_actor_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_profile uuid; v_prompt uuid; v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_row record; v_used jsonb := '{}'::jsonb; v_drive numeric := 0;
  v_total numeric := 0; v_points numeric; v_key text; v_cap numeric;
BEGIN
  PERFORM plugin_data.csf_assert_point_actor_authority(p_organization_id, p_actor_user_id, ARRAY[]::text[]);
  SELECT profile_id INTO v_profile FROM plugin_data.csf_profile_accounts
    WHERE organization_id = p_organization_id AND user_id = p_actor_user_id AND status = 'verified'
    ORDER BY is_primary DESC, linked_at DESC LIMIT 1 FOR SHARE;
  IF v_profile IS NULL THEN RETURN jsonb_build_object('show', false); END IF;
  -- Staff member-view previews do not consume the student's automatic prompt.
  IF EXISTS (SELECT 1 FROM plugin_data.csf_staff_positions WHERE organization_id = p_organization_id
    AND user_id = p_actor_user_id AND status = 'active') OR EXISTS (
      SELECT 1 FROM public.organization_members WHERE organization_id = p_organization_id
      AND user_id = p_actor_user_id AND status = 'active' AND role IN ('admin', 'staff')
    ) THEN RETURN jsonb_build_object('show', false); END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('csf-experience:' || p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_term_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('csf-experience-profile:' || p_organization_id::text || ':' || v_profile::text || ':' || p_term_id::text, 0));
  IF EXISTS (
    WITH RECURSIVE history_profiles AS (
      SELECT id FROM plugin_data.csf_profiles WHERE organization_id=p_organization_id AND id=v_profile
      UNION
      SELECT prior.id FROM plugin_data.csf_profiles prior JOIN history_profiles current_profile
        ON prior.merged_into_profile_id=current_profile.id
        WHERE prior.organization_id=p_organization_id
    )
    SELECT 1 FROM plugin_data.csf_experience_prompts prompt
      WHERE prompt.organization_id=p_organization_id AND prompt.term_id=p_term_id
        AND (prompt.user_id=p_actor_user_id OR prompt.profile_id IN (SELECT id FROM history_profiles))
  ) THEN RETURN jsonb_build_object('show', false); END IF;
  PERFORM 1 FROM plugin_data.csf_terms WHERE organization_id = p_organization_id AND id = p_term_id
    AND is_current AND lifecycle_status NOT IN ('closed', 'archived') FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('show', false); END IF;
  PERFORM 1 FROM plugin_data.csf_term_memberships WHERE organization_id = p_organization_id AND term_id = p_term_id
    AND profile_id = v_profile AND status IN ('accepted', 'active') FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('show', false); END IF;
  SELECT * INTO v_policy FROM plugin_data.csf_term_policies WHERE organization_id = p_organization_id AND term_id = p_term_id FOR SHARE;
  IF NOT FOUND OR v_policy.total_points_required <= 0 THEN RETURN jsonb_build_object('show', false); END IF;
  -- One snapshot, approved first, with the same activity/drive allocation as member progress.
  FOR v_row IN
    SELECT points.* FROM (
      SELECT 0 AS priority, c.id, c.opportunity_id, c.submission_id, c.point_type, c.points AS amount,
        o.point_cap, (c.source = 'sheet' AND c.evidence->>'legacyPointType' = 'unknown') AS unknown_category
      FROM plugin_data.csf_credit_records c LEFT JOIN plugin_data.csf_opportunities o
        ON o.id = c.opportunity_id AND o.organization_id = c.organization_id
      WHERE c.organization_id = p_organization_id AND c.profile_id = v_profile AND c.term_id = p_term_id AND c.status = 'verified'
      UNION ALL
      SELECT 1, s.id, s.opportunity_id, s.id, s.point_type, s.claimed_points, o.point_cap, false
      FROM plugin_data.csf_point_submissions s LEFT JOIN plugin_data.csf_opportunities o
        ON o.id = s.opportunity_id AND o.organization_id = s.organization_id
      WHERE s.organization_id = p_organization_id AND s.profile_id = v_profile AND s.term_id = p_term_id
        AND s.status = 'submitted' AND s.request_kind <> 'exception'
        AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_credit_records c WHERE c.organization_id = p_organization_id
          AND c.profile_id = v_profile AND c.term_id = p_term_id AND c.submission_id = s.id AND c.status = 'verified')
    ) points ORDER BY priority, id
  LOOP
    IF v_row.unknown_category OR v_row.point_type IS NULL OR v_row.point_type NOT IN ('drive', 'non_drive') THEN
      RETURN jsonb_build_object('show', false);
    END IF;
    v_key := coalesce('activity:' || v_row.opportunity_id::text, 'claim:' || coalesce(v_row.submission_id, v_row.id)::text);
    v_cap := least(v_policy.max_points_per_activity, coalesce(v_row.point_cap, v_policy.max_points_per_activity));
    v_points := least(greatest(v_row.amount, 0), greatest(0, v_cap - coalesce((v_used->>v_key)::numeric, 0)));
    IF v_row.point_type = 'drive' THEN v_points := least(v_points, greatest(0, v_policy.max_drive_points - v_drive)); END IF;
    v_used := jsonb_set(v_used, ARRAY[v_key], to_jsonb(coalesce((v_used->>v_key)::numeric, 0) + v_points));
    IF v_row.point_type = 'drive' THEN v_drive := v_drive + v_points; END IF;
    v_total := v_total + v_points;
  END LOOP;
  IF v_total < v_policy.total_points_required THEN RETURN jsonb_build_object('show', false); END IF;
  INSERT INTO plugin_data.csf_experience_prompts(organization_id, profile_id, term_id, user_id, qualifying_points, requirement)
    VALUES(p_organization_id, v_profile, p_term_id, p_actor_user_id, v_total, v_policy.total_points_required)
    RETURNING id INTO v_prompt;
  RETURN jsonb_build_object('show', true, 'promptId', v_prompt);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_consume_experience_prompt(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_consume_experience_prompt(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_save_experience_feedback(
  p_organization_id uuid, p_term_id uuid, p_actor_user_id uuid,
  p_rating smallint, p_comment text, p_update_comment boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_prompt plugin_data.csf_experience_prompts%ROWTYPE;
BEGIN
  PERFORM plugin_data.csf_assert_point_actor_authority(p_organization_id, p_actor_user_id, ARRAY[]::text[]);
  SELECT p.* INTO v_prompt FROM plugin_data.csf_experience_prompts p
    WHERE p.organization_id = p_organization_id AND p.term_id = p_term_id AND p.user_id = p_actor_user_id
    AND EXISTS (
      WITH RECURSIVE lineage AS (
        SELECT id,merged_into_profile_id FROM plugin_data.csf_profiles
          WHERE organization_id=p.organization_id AND id=p.profile_id
        UNION
        SELECT next_profile.id,next_profile.merged_into_profile_id FROM plugin_data.csf_profiles next_profile
          JOIN lineage prior ON prior.merged_into_profile_id=next_profile.id
          WHERE next_profile.organization_id=p.organization_id
      )
      SELECT 1 FROM plugin_data.csf_profile_accounts a JOIN lineage ON lineage.id=a.profile_id
        WHERE a.organization_id=p.organization_id AND a.user_id=p_actor_user_id AND a.status='verified'
    ) ORDER BY p.consumed_at,p.id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experience prompt is not available.' USING ERRCODE = '42501'; END IF;
  RETURN app_private.save_platform_experience_feedback(p_actor_user_id, NULL, 'csf_term', v_prompt.id,
    p_rating, p_comment, p_update_comment);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_save_experience_feedback(uuid, uuid, uuid, smallint, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_save_experience_feedback(uuid, uuid, uuid, smallint, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_project_feedback_from_request(
  p_request_id uuid,
  p_rating smallint,
  p_comment text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.project_feedback_requests%ROWTYPE;
  v_feedback_id uuid;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING errcode = '42501';
  END IF;
  IF p_request_id IS NULL OR p_rating NOT BETWEEN 1 AND 5
     OR (p_comment IS NOT NULL AND char_length(p_comment) > 2000) THEN
    RAISE EXCEPTION 'invalid feedback request' USING errcode = '22023';
  END IF;

  SELECT requests.*
  INTO v_request
  FROM public.project_feedback_requests AS requests
  WHERE requests.id = p_request_id
  FOR UPDATE;

  IF NOT found OR v_request.purpose <> 'organizer' THEN
    RAISE EXCEPTION 'feedback request is not eligible' USING errcode = '42501';
  END IF;

  PERFORM 1
  FROM public.projects AS projects
  WHERE projects.id = v_request.project_id
    AND projects.status = 'completed'
    AND projects.cancelled_at IS NULL
  FOR UPDATE;
  IF NOT found THEN
    RAISE EXCEPTION 'feedback request is not eligible' USING errcode = '42501';
  END IF;

  PERFORM 1
  FROM public.project_signups AS signups
  WHERE signups.id = v_request.signup_id
    AND signups.project_id = v_request.project_id
    AND signups.status = 'attended'
    AND signups.user_id IS NOT DISTINCT FROM v_request.user_id
    AND signups.anonymous_id IS NOT DISTINCT FROM v_request.anonymous_id
  FOR UPDATE;
  IF NOT found THEN
    RAISE EXCEPTION 'feedback request is not eligible' USING errcode = '42501';
  END IF;

  SELECT feedback.id
  INTO v_feedback_id
  FROM public.project_feedback AS feedback
  WHERE feedback.project_id = v_request.project_id
    AND feedback.user_id IS NOT DISTINCT FROM v_request.user_id
    AND feedback.anonymous_id IS NOT DISTINCT FROM v_request.anonymous_id
  FOR UPDATE;

  IF v_feedback_id IS NULL THEN
    INSERT INTO public.project_feedback (
      project_id,
      user_id,
      anonymous_id,
      signup_id,
      rating,
      comment,
      submitted_via,
      comment_moderation_status,
      comment_flag_reason
    )
    VALUES (
      v_request.project_id,
      v_request.user_id,
      v_request.anonymous_id,
      v_request.signup_id,
      p_rating,
      p_comment,
      'email_link',
      CASE WHEN p_comment IS NULL THEN 'not_applicable' ELSE 'pending' END,
      NULL
    )
    RETURNING id INTO v_feedback_id;
  ELSE
    UPDATE public.project_feedback
    SET
      rating = p_rating,
      comment = p_comment,
      signup_id = v_request.signup_id,
      submitted_via = 'email_link',
      comment_moderation_status = CASE
        WHEN p_comment IS NULL THEN 'not_applicable'
        ELSE 'pending'
      END,
      comment_flag_reason = NULL,
      updated_at = now()
    WHERE id = v_feedback_id;
  END IF;

  RETURN v_feedback_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_project_feedback_from_request(uuid, smallint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_project_feedback_from_request(uuid, smallint, text)
  TO service_role;

COMMIT;
