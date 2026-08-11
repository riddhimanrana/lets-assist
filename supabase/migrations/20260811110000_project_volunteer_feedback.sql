-- Post-project volunteer feedback: a private 1-5 star rating plus optional
-- comment from attendees, visible only to the volunteer who wrote it and to
-- project managers (creator / org admin / staff on opted-in projects).
-- Nothing here is ever public. Builds on app_private.can_manage_project
-- from 20260811100000_project_paper_signup_scans.sql.

-- ---------------------------------------------------------------------------
-- 1. Policy helper: feedback opens when the project is completed
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so an organization_only/unlisted project's visibility
-- rules cannot deny an attendee their own feedback row.
CREATE OR REPLACE FUNCTION app_private.project_feedback_window_open(
  p_project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects AS projects
    WHERE projects.id = p_project_id
      AND projects.status = 'completed'
  );
$$;

REVOKE ALL ON FUNCTION app_private.project_feedback_window_open(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.project_feedback_window_open(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Feedback table: one rating per attendee per project
-- ---------------------------------------------------------------------------

CREATE TABLE public.project_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  anonymous_id uuid REFERENCES public.anonymous_signups(id) ON DELETE CASCADE,
  -- Provenance: which attendance established eligibility. Not the
  -- uniqueness key — a multiDay volunteer with four slot signups gets one
  -- rating, not four.
  signup_id uuid REFERENCES public.project_signups(id) ON DELETE SET NULL,
  rating smallint NOT NULL,
  comment text,
  comment_moderation_status text NOT NULL DEFAULT 'not_applicable',
  comment_flag_reason text,
  submitted_via text NOT NULL DEFAULT 'app',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_feedback_rating_range CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT project_feedback_comment_length
    CHECK (comment IS NULL OR char_length(comment) <= 2000),
  -- Mirrors project_signups' own user_or_anonymous constraint.
  CONSTRAINT project_feedback_author_identity CHECK (
    (user_id IS NOT NULL AND anonymous_id IS NULL)
    OR (user_id IS NULL AND anonymous_id IS NOT NULL)
  ),
  CONSTRAINT project_feedback_moderation_status_check CHECK (
    comment_moderation_status IN
      ('not_applicable', 'pending', 'allowed', 'flagged', 'blocked')
  ),
  CONSTRAINT project_feedback_submitted_via_check
    CHECK (submitted_via IN ('app', 'email_link'))
);

COMMENT ON TABLE public.project_feedback IS
  'Private post-project volunteer ratings. Visible only to the author and project managers; never shown publicly.';

CREATE UNIQUE INDEX project_feedback_project_user_uidx
  ON public.project_feedback (project_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX project_feedback_project_anonymous_uidx
  ON public.project_feedback (project_id, anonymous_id)
  WHERE anonymous_id IS NOT NULL;
CREATE INDEX project_feedback_project_recent_idx
  ON public.project_feedback (project_id, created_at DESC);

-- Companion FK to profiles (same pattern as
-- project_signups_user_id_fkey_profiles) so PostgREST can embed the
-- author's profile in organizer reads.
ALTER TABLE public.project_feedback
  ADD CONSTRAINT project_feedback_user_id_fkey_profiles
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Grants and RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.project_feedback ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.project_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.project_feedback TO authenticated;
-- Deliberately nothing for anon: email-token submissions go through the
-- service role after HMAC verification.
GRANT ALL ON TABLE public.project_feedback TO service_role;

CREATE POLICY project_feedback_select_own_or_manager
  ON public.project_feedback FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_super_admin()
    OR app_private.can_manage_project(project_id, (SELECT auth.uid()))
  );

CREATE POLICY project_feedback_insert_own_attended
  ON public.project_feedback FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND anonymous_id IS NULL
    AND submitted_via = 'app'
    AND comment_moderation_status IN ('not_applicable', 'pending')
    AND app_private.project_feedback_window_open(project_id)
    AND EXISTS (
      SELECT 1 FROM public.project_signups AS signups
      WHERE signups.id = project_feedback.signup_id
        AND signups.project_id = project_feedback.project_id
        AND signups.user_id = (SELECT auth.uid())
        AND signups.status = 'attended'
    )
  );

CREATE POLICY project_feedback_update_own
  ON public.project_feedback FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- No DELETE policy at all: an organizer must never be able to erase
-- feedback they dislike. Platform admins act through the service role.

-- ---------------------------------------------------------------------------
-- 4. Column immutability: RLS has no column granularity
-- ---------------------------------------------------------------------------

-- Without this, a bare UPDATE policy would let an author flip
-- comment_moderation_status to 'allowed' or repoint project_id.
-- Deliberately SECURITY INVOKER: under DEFINER, current_user inside the
-- function is the owner (postgres) for every caller, which would make the
-- privileged-writer check below unsatisfiable and silently revert the
-- moderation pipeline's own settlements.
CREATE OR REPLACE FUNCTION app_private.project_feedback_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.project_id := OLD.project_id;
  NEW.user_id := OLD.user_id;
  NEW.anonymous_id := OLD.anonymous_id;
  NEW.signup_id := OLD.signup_id;
  NEW.submitted_via := OLD.submitted_via;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  -- Only privileged writers settle a moderation verdict. A client edit that
  -- changes the text re-enters review; one that does not keeps its verdict.
  IF current_user NOT IN ('service_role', 'postgres') THEN
    IF NEW.comment IS DISTINCT FROM OLD.comment THEN
      NEW.comment_moderation_status :=
        CASE WHEN NEW.comment IS NULL THEN 'not_applicable' ELSE 'pending' END;
      NEW.comment_flag_reason := NULL;
    ELSE
      NEW.comment_moderation_status := OLD.comment_moderation_status;
      NEW.comment_flag_reason := OLD.comment_flag_reason;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.project_feedback_guard_update()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER project_feedback_guard_update
  BEFORE UPDATE ON public.project_feedback
  FOR EACH ROW EXECUTE FUNCTION app_private.project_feedback_guard_update();
