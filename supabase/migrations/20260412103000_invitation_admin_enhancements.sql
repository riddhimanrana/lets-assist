-- Invitation admin enhancements
-- Adds configurable invite duration and email delivery status tracking

ALTER TABLE public.organization_invitations
  ADD COLUMN IF NOT EXISTS invitation_duration text NOT NULL DEFAULT '1_week'
    CHECK (invitation_duration IN ('1_week', '1_month')),
  ADD COLUMN IF NOT EXISTS email_delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (email_delivery_status IN ('pending', 'sent', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS email_delivery_error text,
  ADD COLUMN IF NOT EXISTS last_email_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_message_id text,
  ADD COLUMN IF NOT EXISTS email_transport text;

ALTER TABLE public.organization_contact_import_jobs
  ADD COLUMN IF NOT EXISTS invitation_duration text NOT NULL DEFAULT '1_week'
    CHECK (invitation_duration IN ('1_week', '1_month'));

CREATE INDEX IF NOT EXISTS organization_invitations_delivery_status_idx
  ON public.organization_invitations (organization_id, email_delivery_status, created_at DESC);
