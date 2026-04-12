-- Store optional invitee profile hints for smoother signup prefill and invitation history UI

ALTER TABLE public.organization_invitations
  ADD COLUMN IF NOT EXISTS invited_full_name text,
  ADD COLUMN IF NOT EXISTS invited_phone text,
  ADD COLUMN IF NOT EXISTS invited_profile_data jsonb NOT NULL DEFAULT '{}'::jsonb;
