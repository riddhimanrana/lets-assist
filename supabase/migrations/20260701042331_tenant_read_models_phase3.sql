-- Phase 3 tenant read models.
-- These views are intentionally narrow and server-consumed first. They create a
-- stable boundary for public/cross-domain reads before broad base-table grants
-- are reduced in later phases.

BEGIN;

DROP VIEW IF EXISTS public.public_profile_read_model;
CREATE VIEW public.public_profile_read_model
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.username,
  p.full_name,
  p.avatar_url,
  p.created_at,
  p.profile_visibility,
  p.trusted_member
FROM public.profiles p
WHERE p.profile_visibility = 'public';

COMMENT ON VIEW public.public_profile_read_model IS
  'Narrow public profile read model. Excludes email, phone, goals, metadata, and update timestamps.';

DROP VIEW IF EXISTS public.project_discovery_read_model;
CREATE VIEW public.project_discovery_read_model
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.creator_id,
  p.title,
  p.location,
  p.description,
  p.event_type,
  p.verification_method,
  p.created_at,
  p.schedule,
  p.status,
  p.require_login,
  p.cover_image_url,
  p.documents,
  p.organization_id,
  p.cancellation_reason,
  p.cancelled_at,
  p.location_data,
  p.pause_signups,
  p.session_id,
  p.published,
  p.creator_calendar_event_id,
  p.creator_synced_at,
  p.project_timezone,
  p.restrict_to_org_domains,
  p.visibility,
  p.can_be_managed_by_staff,
  p.workflow_status,
  p.enable_volunteer_comments,
  p.show_attendees_publicly,
  p.recurrence_rule,
  p.recurrence_parent_id,
  p.recurrence_sequence,
  p.waiver_required,
  p.waiver_allow_upload,
  p.waiver_pdf_storage_path,
  p.waiver_pdf_url,
  p.waiver_disable_esignature,
  p.signup_form_schema,
  pr.full_name AS creator_full_name,
  pr.avatar_url AS creator_avatar_url,
  pr.username AS creator_username,
  pr.created_at AS creator_created_at,
  o.name AS organization_name,
  o.username AS organization_username,
  o.logo_url AS organization_logo_url,
  o.verified AS organization_verified,
  o.type AS organization_type
FROM public.projects p
LEFT JOIN public.profiles pr ON pr.id = p.creator_id
LEFT JOIN public.organizations o ON o.id = p.organization_id
WHERE p.visibility = 'public'
  AND (p.workflow_status IS NULL OR p.workflow_status = 'published');

COMMENT ON VIEW public.project_discovery_read_model IS
  'Public project discovery read model with narrow creator and organization fields. Excludes review notes and staff-only workflow data.';

CREATE INDEX IF NOT EXISTS idx_projects_public_discovery_created_at
  ON public.projects (created_at DESC)
  WHERE visibility = 'public'
    AND (workflow_status IS NULL OR workflow_status = 'published');

DROP VIEW IF EXISTS public.certificate_verification_read_model;
CREATE VIEW public.certificate_verification_read_model
WITH (security_invoker = true)
AS
SELECT
  c.id,
  c.project_title,
  c.creator_name,
  c.is_certified,
  c.type,
  c.event_start,
  c.event_end,
  c.user_id,
  c.check_in_method,
  c.created_at,
  c.organization_name,
  c.project_id,
  c.schedule_id,
  c.issued_at,
  c.signup_id,
  c.volunteer_name,
  c.project_location,
  c.description,
  p.username AS creator_username
FROM public.certificates c
LEFT JOIN public.profiles p ON p.id = c.creator_id;

COMMENT ON VIEW public.certificate_verification_read_model IS
  'Certificate verification read model. Excludes volunteer email and other private profile fields from public certificate rendering.';

DROP VIEW IF EXISTS public.user_certificate_read_model;
CREATE VIEW public.user_certificate_read_model
WITH (security_invoker = true)
AS
SELECT
  c.id,
  c.project_title,
  c.creator_name,
  c.is_certified,
  c.type,
  c.event_start,
  c.event_end,
  c.volunteer_email,
  c.user_id,
  c.check_in_method,
  c.created_at,
  c.organization_name,
  c.project_id,
  c.schedule_id,
  c.issued_at,
  c.signup_id,
  c.volunteer_name,
  c.project_location,
  c.description,
  p.project_timezone
FROM public.certificates c
LEFT JOIN public.projects p ON p.id = c.project_id;

COMMENT ON VIEW public.user_certificate_read_model IS
  'Authenticated user certificate list read model. Keeps certificate list joins stable while base-table exposure is reduced.';

COMMIT;
