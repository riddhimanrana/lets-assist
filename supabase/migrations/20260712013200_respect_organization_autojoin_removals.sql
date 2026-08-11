-- Remember an explicit membership removal so verified-domain auto-join does
-- not silently recreate access on the user's next login.
CREATE TABLE public.organization_autojoin_suppressions (
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  removed_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

ALTER TABLE public.organization_autojoin_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_autojoin_suppressions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.organization_autojoin_suppressions TO service_role;

CREATE INDEX organization_autojoin_suppressions_user_id_idx
  ON public.organization_autojoin_suppressions (user_id);
CREATE INDEX organization_autojoin_suppressions_removed_by_idx
  ON public.organization_autojoin_suppressions (removed_by)
  WHERE removed_by IS NOT NULL;

CREATE OR REPLACE FUNCTION private.record_organization_autojoin_suppression()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.organization_autojoin_suppressions (
    organization_id,
    user_id,
    removed_by
  )
  VALUES (OLD.organization_id, OLD.user_id, auth.uid())
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.record_organization_autojoin_suppression()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER record_organization_autojoin_suppression
AFTER DELETE ON public.organization_members
FOR EACH ROW
EXECUTE FUNCTION private.record_organization_autojoin_suppression();

CREATE OR REPLACE FUNCTION public.remove_organization_member_with_autojoin_suppression(
  p_organization_id uuid,
  p_membership_id uuid,
  p_removed_by uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT members.user_id
  INTO v_user_id
  FROM public.organization_members AS members
  WHERE members.id = p_membership_id
    AND members.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.organization_autojoin_suppressions (
    organization_id,
    user_id,
    removed_by
  )
  VALUES (p_organization_id, v_user_id, p_removed_by)
  ON CONFLICT (organization_id, user_id) DO UPDATE
  SET removed_by = EXCLUDED.removed_by,
      created_at = now();

  DELETE FROM public.organization_members
  WHERE id = p_membership_id
    AND organization_id = p_organization_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_organization_member_with_autojoin_suppression(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_organization_member_with_autojoin_suppression(uuid, uuid, uuid)
  TO service_role;

-- This legacy trigger helper performed affiliation before email verification.
-- Keep it as a no-op in case an older remote project still has a trigger bound
-- to it; the application now applies affiliation only after a fresh, verified
-- auth-user lookup.
CREATE OR REPLACE FUNCTION public.handle_auto_join_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_auto_join_on_signup()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.organization_autojoin_suppressions IS
  'Service-only tombstones that prevent verified-domain affiliation from undoing an explicit membership removal.';
