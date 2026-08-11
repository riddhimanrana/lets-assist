-- DVHS CSF private plugin foundation.
--
-- This migration creates the server-only plugin_data model for cohort/term
-- membership, CSF profiles, applications, staff permissions, restrictions,
-- opportunity posts, point submissions, sheet sync, and audit events.
--
-- Privacy boundary:
-- - base CSF tables live in plugin_data and are not exposed to anon/authenticated
--   Data API clients;
-- - RLS is enabled as defense in depth;
-- - service_role is the only role granted direct table access;
-- - browser/plugin UI must go through host server actions, route handlers, or
--   reviewed read models declared in the plugin manifest.

BEGIN;

INSERT INTO public.plugins (
  key,
  name,
  description,
  visibility,
  is_active,
  latest_version,
  private_codebase,
  metadata
)
VALUES (
  'dvhs-csf',
  'DVHS CSF',
  'Private DVHS CSF workflow plugin for cohort membership, semester applications, officer roles, protected point tracking, opportunity posts, and Google Sheets sync.',
  'private',
  true,
  '0.1.0',
  true,
  jsonb_build_object(
    'owner', jsonb_build_object('name', 'Let''s Assist', 'type', 'platform-official'),
    'privacyMode', 'strict-minor-safe',
    'defaultOwnerEmails', jsonb_build_array('dvhighcsf@gmail.com')
  )
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  visibility = EXCLUDED.visibility,
  is_active = EXCLUDED.is_active,
  latest_version = EXCLUDED.latest_version,
  private_codebase = EXCLUDED.private_codebase,
  metadata = public.plugins.metadata || EXCLUDED.metadata,
  updated_at = now();

CREATE TABLE IF NOT EXISTS plugin_data.csf_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  school_year text NOT NULL,
  semester text NOT NULL CHECK (semester IN ('fall', 'spring', 'summer', 'other')),
  starts_at date,
  ends_at date,
  application_opens_at timestamptz,
  application_closes_at timestamptz,
  is_current boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS csf_terms_one_current_per_org_idx
  ON plugin_data.csf_terms (organization_id)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS csf_terms_org_school_year_idx
  ON plugin_data.csf_terms (organization_id, school_year, semester);

CREATE TABLE IF NOT EXISTS plugin_data.csf_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  graduation_year integer NOT NULL CHECK (graduation_year BETWEEN 2000 AND 2100),
  label text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'archived')),
  default_sheet_source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, graduation_year)
);

CREATE INDEX IF NOT EXISTS csf_cohorts_org_status_idx
  ON plugin_data.csf_cohorts (organization_id, status);

CREATE TABLE IF NOT EXISTS plugin_data.csf_cohort_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cohort_id uuid NOT NULL REFERENCES plugin_data.csf_cohorts(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  grade_level integer CHECK (grade_level BETWEEN 9 AND 12),
  sheet_tab_name text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cohort_id, term_id)
);

CREATE INDEX IF NOT EXISTS csf_cohort_terms_org_idx
  ON plugin_data.csf_cohort_terms (organization_id, cohort_id, term_id);

CREATE TABLE IF NOT EXISTS plugin_data.csf_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  preferred_name text,
  nicknames text[] NOT NULL DEFAULT ARRAY[]::text[],
  school_email text,
  personal_email text,
  normalized_first_name text NOT NULL,
  normalized_last_name text NOT NULL,
  normalized_school_email text,
  normalized_personal_email text,
  privacy_flags jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(privacy_flags) = 'object'),
  source_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_summary) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_profiles_org_name_idx
  ON plugin_data.csf_profiles (organization_id, normalized_last_name, normalized_first_name);

CREATE INDEX IF NOT EXISTS csf_profiles_org_school_email_idx
  ON plugin_data.csf_profiles (organization_id, normalized_school_email)
  WHERE normalized_school_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS csf_profiles_org_personal_email_idx
  ON plugin_data.csf_profiles (organization_id, normalized_personal_email)
  WHERE normalized_personal_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS plugin_data.csf_profile_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected', 'revoked')),
  is_primary boolean NOT NULL DEFAULT false,
  linked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  notes text,
  UNIQUE (organization_id, profile_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS csf_profile_accounts_one_primary_idx
  ON plugin_data.csf_profile_accounts (profile_id)
  WHERE is_primary = true AND status = 'verified';

CREATE INDEX IF NOT EXISTS csf_profile_accounts_user_idx
  ON plugin_data.csf_profile_accounts (organization_id, user_id, status);

CREATE TABLE IF NOT EXISTS plugin_data.csf_profile_cohort_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  cohort_id uuid NOT NULL REFERENCES plugin_data.csf_cohorts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'transferred', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, cohort_id)
);

CREATE INDEX IF NOT EXISTS csf_profile_cohort_memberships_org_idx
  ON plugin_data.csf_profile_cohort_memberships (organization_id, cohort_id, status);

CREATE TABLE IF NOT EXISTS plugin_data.csf_term_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  cohort_id uuid NOT NULL REFERENCES plugin_data.csf_cohorts(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'google_form_sheet'
    CHECK (source IN ('native', 'sheet', 'google_form_sheet', 'manual', 'legacy_import')),
  source_row_id uuid,
  google_form_response_id text,
  source_url text,
  source_submitted_at timestamptz,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'needs_review', 'needs_action', 'accepted', 'rejected', 'withdrawn', 'blocked')),
  current_grade_level integer CHECK (current_grade_level BETWEEN 9 AND 12),
  returning_status text CHECK (returning_status IN ('new', 'returning', 'unknown')),
  shirt_size text CHECK (shirt_size IN ('S', 'M', 'L', 'XL', 'returning_member', 'unknown')),
  most_checked_email text,
  list_i_points numeric(5,2),
  list_i_ii_points numeric(5,2),
  grand_total_points numeric(5,2),
  social_confirmation boolean,
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  application_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(application_data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, term_id)
);

CREATE INDEX IF NOT EXISTS csf_term_applications_org_term_status_idx
  ON plugin_data.csf_term_applications (organization_id, term_id, status);

CREATE INDEX IF NOT EXISTS csf_term_applications_profile_idx
  ON plugin_data.csf_term_applications (profile_id, term_id);

CREATE TABLE IF NOT EXISTS plugin_data.csf_application_course_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES plugin_data.csf_term_applications(id) ON DELETE CASCADE,
  course_list text NOT NULL CHECK (course_list IN ('I', 'II', 'III')),
  course_name text NOT NULL,
  grade text,
  points numeric(5,2),
  is_bonus boolean NOT NULL DEFAULT false,
  raw_line text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_application_course_entries_application_idx
  ON plugin_data.csf_application_course_entries (application_id, course_list);

CREATE INDEX IF NOT EXISTS csf_application_course_entries_org_application_idx
  ON plugin_data.csf_application_course_entries (organization_id, application_id, course_list);

CREATE TABLE IF NOT EXISTS plugin_data.csf_application_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES plugin_data.csf_term_applications(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  file_type text NOT NULL CHECK (file_type IN ('transcript', 'webstore_receipt', 'submission_evidence', 'import_snapshot', 'other')),
  bucket text NOT NULL DEFAULT 'csf-private',
  object_path text NOT NULL,
  original_filename text,
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_application_files_application_idx
  ON plugin_data.csf_application_files (application_id, file_type);

CREATE INDEX IF NOT EXISTS csf_application_files_org_application_idx
  ON plugin_data.csf_application_files (organization_id, application_id, file_type);

CREATE TABLE IF NOT EXISTS plugin_data.csf_application_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES plugin_data.csf_term_applications(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_status text,
  next_status text NOT NULL,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_application_status_events_application_idx
  ON plugin_data.csf_application_status_events (application_id, created_at);

CREATE INDEX IF NOT EXISTS csf_application_status_events_org_application_idx
  ON plugin_data.csf_application_status_events (organization_id, application_id, created_at);

CREATE TABLE IF NOT EXISTS plugin_data.csf_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  display_name text NOT NULL,
  description text,
  role_type text NOT NULL DEFAULT 'custom'
    CHECK (role_type IN ('owner', 'officer_template', 'custom')),
  is_system boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

CREATE TABLE IF NOT EXISTS plugin_data.csf_role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES plugin_data.csf_roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_key)
);

CREATE INDEX IF NOT EXISTS csf_role_permissions_org_permission_idx
  ON plugin_data.csf_role_permissions (organization_id, permission_key, enabled);

CREATE TABLE IF NOT EXISTS plugin_data.csf_staff_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES plugin_data.csf_profiles(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role_id uuid NOT NULL REFERENCES plugin_data.csf_roles(id) ON DELETE RESTRICT,
  school_year text NOT NULL,
  display_title text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'ended')),
  starts_at date,
  ends_at date,
  appointed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_staff_positions_org_active_idx
  ON plugin_data.csf_staff_positions (organization_id, school_year, status);

CREATE INDEX IF NOT EXISTS csf_staff_positions_user_idx
  ON plugin_data.csf_staff_positions (organization_id, user_id, status)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS plugin_data.csf_staff_position_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  staff_position_id uuid REFERENCES plugin_data.csf_staff_positions(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_staff_position_history_org_position_idx
  ON plugin_data.csf_staff_position_history (organization_id, staff_position_id, created_at);

CREATE TABLE IF NOT EXISTS plugin_data.csf_profile_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (
    scope IN (
      'application_block',
      'manual_review_required',
      'event_signup_block',
      'point_credit_block',
      'officer_eligibility_block',
      'communication_block'
    )
  ),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'resolved', 'expired')),
  reason_category text,
  private_notes text,
  visible_message text,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_profile_restrictions_active_idx
  ON plugin_data.csf_profile_restrictions (organization_id, profile_id, scope, status);

CREATE TABLE IF NOT EXISTS plugin_data.csf_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid REFERENCES plugin_data.csf_terms(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  signup_url text,
  contact_email text,
  point_value numeric(6,2) NOT NULL DEFAULT 0,
  point_type text NOT NULL DEFAULT 'service'
    CHECK (point_type IN ('non_drive', 'drive', 'meeting', 'service', 'other')),
  signup_mode text NOT NULL DEFAULT 'external'
    CHECK (signup_mode IN ('external', 'lets_assist_project', 'none')),
  requires_point_submission boolean NOT NULL DEFAULT true,
  evidence_policy text NOT NULL DEFAULT 'optional'
    CHECK (evidence_policy IN ('none', 'optional', 'required')),
  source_organization text,
  source_contact_name text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_staff_position_id uuid REFERENCES plugin_data.csf_staff_positions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived', 'cancelled')),
  calendar_event_id text,
  linked_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  external_sheet_url text,
  sheet_export_status text NOT NULL DEFAULT 'not_exported'
    CHECK (sheet_export_status IN ('not_exported', 'pending', 'exported', 'failed')),
  sheet_export_row_id text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_opportunities_org_status_idx
  ON plugin_data.csf_opportunities (organization_id, status, starts_at);

CREATE TABLE IF NOT EXISTS plugin_data.csf_point_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

CREATE TABLE IF NOT EXISTS plugin_data.csf_term_point_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  point_type text NOT NULL CHECK (point_type IN ('non_drive', 'drive', 'meeting', 'service', 'other')),
  label text NOT NULL,
  min_required numeric(6,2) NOT NULL DEFAULT 0,
  max_counted numeric(6,2),
  is_required boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 100,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, term_id, point_type)
);

CREATE INDEX IF NOT EXISTS csf_term_point_rules_org_term_idx
  ON plugin_data.csf_term_point_rules (organization_id, term_id, display_order);

CREATE TABLE IF NOT EXISTS plugin_data.csf_point_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES plugin_data.csf_opportunities(id) ON DELETE SET NULL,
  category_id uuid REFERENCES plugin_data.csf_point_categories(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'student'
    CHECK (source IN ('student', 'staff', 'attendance', 'sheet', 'manual')),
  description text,
  claimed_points numeric(6,2) NOT NULL DEFAULT 0,
  point_type text NOT NULL DEFAULT 'non_drive'
    CHECK (point_type IN ('non_drive', 'drive')),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('draft', 'submitted', 'needs_action', 'approved', 'rejected', 'duplicate', 'withdrawn')),
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_point_submissions_org_term_status_idx
  ON plugin_data.csf_point_submissions (organization_id, term_id, status);

CREATE INDEX IF NOT EXISTS csf_point_submissions_profile_idx
  ON plugin_data.csf_point_submissions (profile_id, term_id);

CREATE TABLE IF NOT EXISTS plugin_data.csf_submission_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES plugin_data.csf_point_submissions(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  bucket text NOT NULL DEFAULT 'csf-private',
  object_path text NOT NULL,
  original_filename text,
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_submission_files_org_submission_idx
  ON plugin_data.csf_submission_files (organization_id, submission_id, created_at);

CREATE TABLE IF NOT EXISTS plugin_data.csf_credit_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  submission_id uuid REFERENCES plugin_data.csf_point_submissions(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES plugin_data.csf_opportunities(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('submission', 'attendance', 'sheet', 'manual')),
  points numeric(6,2) NOT NULL DEFAULT 0,
  point_type text NOT NULL DEFAULT 'non_drive'
    CHECK (point_type IN ('non_drive', 'drive')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected', 'revoked')),
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_credit_records_profile_term_idx
  ON plugin_data.csf_credit_records (profile_id, term_id, status);

CREATE INDEX IF NOT EXISTS csf_credit_records_org_term_status_idx
  ON plugin_data.csf_credit_records (organization_id, term_id, status);

CREATE TABLE IF NOT EXISTS plugin_data.csf_submission_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES plugin_data.csf_point_submissions(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  previous_status text,
  next_status text,
  notes text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_submission_reviews_org_submission_idx
  ON plugin_data.csf_submission_reviews (organization_id, submission_id, created_at);

CREATE TABLE IF NOT EXISTS plugin_data.csf_meeting_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  meeting_key text NOT NULL,
  meeting_label text NOT NULL,
  status text NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('unknown', 'attended', 'excused', 'missed', 'not_required')),
  source text NOT NULL DEFAULT 'sheet'
    CHECK (source IN ('sheet', 'manual', 'attendance')),
  source_row_id uuid,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, term_id, meeting_key)
);

CREATE INDEX IF NOT EXISTS csf_meeting_attendance_org_term_idx
  ON plugin_data.csf_meeting_attendance (organization_id, term_id, status);

CREATE TABLE IF NOT EXISTS plugin_data.csf_sheet_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cohort_id uuid REFERENCES plugin_data.csf_cohorts(id) ON DELETE SET NULL,
  title text NOT NULL,
  provider text NOT NULL DEFAULT 'google_sheets'
    CHECK (provider IN ('google_sheets', 'uploaded_xlsx', 'uploaded_csv')),
  spreadsheet_id text,
  sheet_url text,
  uploaded_file_path text,
  sync_owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sync_mode text NOT NULL DEFAULT 'manual'
    CHECK (sync_mode IN ('manual', 'scheduled', 'disabled')),
  tab_mappings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tab_mappings) = 'array'),
  last_synced_at timestamptz,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, cohort_id, title)
);

CREATE INDEX IF NOT EXISTS csf_sheet_sources_org_idx
  ON plugin_data.csf_sheet_sources (organization_id, cohort_id, sync_mode);

CREATE TABLE IF NOT EXISTS plugin_data.csf_onboarding_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  cohort_id uuid REFERENCES plugin_data.csf_cohorts(id) ON DELETE SET NULL,
  sheet_source_id uuid REFERENCES plugin_data.csf_sheet_sources(id) ON DELETE SET NULL,
  code text NOT NULL,
  title text NOT NULL,
  link_type text NOT NULL DEFAULT 'profile_connect'
    CHECK (link_type IN ('profile_connect', 'application_google_form', 'combined')),
  google_form_url text,
  landing_message text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS csf_onboarding_links_org_term_idx
  ON plugin_data.csf_onboarding_links (organization_id, term_id, cohort_id, is_active);

CREATE TABLE IF NOT EXISTS plugin_data.csf_sheet_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_id uuid REFERENCES plugin_data.csf_sheet_sources(id) ON DELETE SET NULL,
  initiated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'preview'
    CHECK (mode IN ('preview', 'commit', 'scheduled')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_sheet_import_jobs_org_idx
  ON plugin_data.csf_sheet_import_jobs (organization_id, source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS plugin_data.csf_sheet_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES plugin_data.csf_sheet_import_jobs(id) ON DELETE CASCADE,
  source_id uuid REFERENCES plugin_data.csf_sheet_sources(id) ON DELETE SET NULL,
  cohort_id uuid REFERENCES plugin_data.csf_cohorts(id) ON DELETE SET NULL,
  term_id uuid REFERENCES plugin_data.csf_terms(id) ON DELETE SET NULL,
  sheet_tab_name text NOT NULL,
  row_number integer NOT NULL CHECK (row_number > 0),
  source_range text,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_data) = 'object'),
  normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(normalized_data) = 'object'),
  row_hash text,
  matched_profile_id uuid REFERENCES plugin_data.csf_profiles(id) ON DELETE SET NULL,
  matched_application_id uuid REFERENCES plugin_data.csf_term_applications(id) ON DELETE SET NULL,
  import_status text NOT NULL DEFAULT 'pending'
    CHECK (import_status IN ('pending', 'created', 'updated', 'skipped', 'ambiguous', 'duplicate', 'conflict', 'error')),
  errors text[] NOT NULL DEFAULT ARRAY[]::text[],
  warnings text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_sheet_import_rows_job_idx
  ON plugin_data.csf_sheet_import_rows (job_id, import_status);

CREATE INDEX IF NOT EXISTS csf_sheet_import_rows_match_idx
  ON plugin_data.csf_sheet_import_rows (organization_id, matched_profile_id)
  WHERE matched_profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS plugin_data.csf_partner_clubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  continuation_status text,
  club_type text,
  contact_name text,
  contact_email text,
  president_name text,
  advisor_name text,
  recruiting_new_members boolean,
  public_description text,
  instagram_url text,
  allocation_satisfied boolean,
  allocation_notes text,
  communication_method text,
  approved_point_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  notes text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'archived')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS csf_partner_clubs_org_status_idx
  ON plugin_data.csf_partner_clubs (organization_id, status, name);

CREATE TABLE IF NOT EXISTS plugin_data.csf_partner_submission_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  partner_club_id uuid NOT NULL REFERENCES plugin_data.csf_partner_clubs(id) ON DELETE CASCADE,
  term_id uuid REFERENCES plugin_data.csf_terms(id) ON DELETE SET NULL,
  title text NOT NULL,
  source text NOT NULL DEFAULT 'sheet'
    CHECK (source IN ('sheet', 'form', 'manual')),
  source_url text,
  status text NOT NULL DEFAULT 'needs_verification'
    CHECK (status IN ('draft', 'needs_verification', 'verified', 'rejected', 'archived')),
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_partner_submission_batches_org_status_idx
  ON plugin_data.csf_partner_submission_batches (organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS plugin_data.csf_partner_submission_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES plugin_data.csf_partner_submission_batches(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES plugin_data.csf_profiles(id) ON DELETE SET NULL,
  matched_status text NOT NULL DEFAULT 'pending'
    CHECK (matched_status IN ('pending', 'matched', 'ambiguous', 'unmatched', 'duplicate', 'rejected')),
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_data) = 'object'),
  normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(normalized_data) = 'object'),
  claimed_points numeric(6,2),
  point_type text CHECK (point_type IN ('non_drive', 'drive', 'meeting', 'service', 'other')),
  generated_submission_id uuid REFERENCES plugin_data.csf_point_submissions(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_partner_submission_rows_batch_status_idx
  ON plugin_data.csf_partner_submission_rows (batch_id, matched_status);

CREATE INDEX IF NOT EXISTS csf_partner_submission_rows_org_status_idx
  ON plugin_data.csf_partner_submission_rows (organization_id, matched_status, created_at DESC);

CREATE TABLE IF NOT EXISTS plugin_data.csf_profile_link_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  onboarding_link_id uuid REFERENCES plugin_data.csf_onboarding_links(id) ON DELETE SET NULL,
  term_id uuid REFERENCES plugin_data.csf_terms(id) ON DELETE SET NULL,
  cohort_id uuid REFERENCES plugin_data.csf_cohorts(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  signed_in_email text,
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  preferred_name text,
  personal_email text,
  school_email text,
  normalized_first_name text NOT NULL,
  normalized_last_name text NOT NULL,
  normalized_personal_email text,
  normalized_school_email text,
  matched_profile_id uuid REFERENCES plugin_data.csf_profiles(id) ON DELETE SET NULL,
  candidate_profile_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  match_status text NOT NULL DEFAULT 'pending'
    CHECK (match_status IN ('pending', 'auto_linked', 'needs_review', 'rejected', 'resolved')),
  resolution_notes text,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_profile_link_requests_org_status_idx
  ON plugin_data.csf_profile_link_requests (organization_id, match_status, created_at DESC);

CREATE INDEX IF NOT EXISTS csf_profile_link_requests_user_idx
  ON plugin_data.csf_profile_link_requests (organization_id, user_id, match_status)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS plugin_data.csf_profile_merge_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  target_profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_profile_id <> target_profile_id)
);

CREATE INDEX IF NOT EXISTS csf_profile_merge_reviews_org_status_idx
  ON plugin_data.csf_profile_merge_reviews (organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS plugin_data.csf_profile_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  term_id uuid REFERENCES plugin_data.csf_terms(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES plugin_data.csf_opportunities(id) ON DELETE SET NULL,
  credit_record_id uuid REFERENCES plugin_data.csf_credit_records(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('opportunity', 'meeting', 'application', 'manual_adjustment', 'legacy_import')),
  title text NOT NULL,
  description text,
  event_at timestamptz,
  point_type text CHECK (point_type IN ('non_drive', 'drive', 'meeting', 'service', 'other')),
  raw_points numeric(6,2),
  counted_points numeric(6,2),
  status text NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'pending', 'verified', 'rejected', 'superseded')),
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('sheet', 'lets_assist_project', 'submission', 'manual', 'legacy_import')),
  source_ref jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_ref) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_profile_activity_events_org_profile_idx
  ON plugin_data.csf_profile_activity_events (organization_id, profile_id, event_at DESC);

CREATE TABLE IF NOT EXISTS plugin_data.csf_admin_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_profile_id uuid REFERENCES plugin_data.csf_profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  term_id uuid REFERENCES plugin_data.csf_terms(id) ON DELETE SET NULL,
  before_data jsonb,
  after_data jsonb,
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_admin_audit_events_org_action_idx
  ON plugin_data.csf_admin_audit_events (organization_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS csf_admin_audit_events_actor_profile_id_idx ON plugin_data.csf_admin_audit_events (actor_profile_id);
CREATE INDEX IF NOT EXISTS csf_admin_audit_events_actor_user_id_idx ON plugin_data.csf_admin_audit_events (actor_user_id);
CREATE INDEX IF NOT EXISTS csf_admin_audit_events_term_id_idx ON plugin_data.csf_admin_audit_events (term_id);
CREATE INDEX IF NOT EXISTS csf_application_files_profile_id_idx ON plugin_data.csf_application_files (profile_id);
CREATE INDEX IF NOT EXISTS csf_application_files_term_id_idx ON plugin_data.csf_application_files (term_id);
CREATE INDEX IF NOT EXISTS csf_application_files_uploaded_by_idx ON plugin_data.csf_application_files (uploaded_by);
CREATE INDEX IF NOT EXISTS csf_application_status_events_actor_user_id_idx ON plugin_data.csf_application_status_events (actor_user_id);
CREATE INDEX IF NOT EXISTS csf_cohort_terms_term_id_idx ON plugin_data.csf_cohort_terms (term_id);
CREATE INDEX IF NOT EXISTS csf_credit_records_opportunity_id_idx ON plugin_data.csf_credit_records (opportunity_id);
CREATE INDEX IF NOT EXISTS csf_credit_records_submission_id_idx ON plugin_data.csf_credit_records (submission_id);
CREATE INDEX IF NOT EXISTS csf_credit_records_term_id_idx ON plugin_data.csf_credit_records (term_id);
CREATE INDEX IF NOT EXISTS csf_credit_records_verified_by_idx ON plugin_data.csf_credit_records (verified_by);
CREATE INDEX IF NOT EXISTS csf_meeting_attendance_recorded_by_idx ON plugin_data.csf_meeting_attendance (recorded_by);
CREATE INDEX IF NOT EXISTS csf_meeting_attendance_term_id_idx ON plugin_data.csf_meeting_attendance (term_id);
CREATE INDEX IF NOT EXISTS csf_onboarding_links_cohort_id_idx ON plugin_data.csf_onboarding_links (cohort_id);
CREATE INDEX IF NOT EXISTS csf_onboarding_links_created_by_idx ON plugin_data.csf_onboarding_links (created_by);
CREATE INDEX IF NOT EXISTS csf_onboarding_links_sheet_source_id_idx ON plugin_data.csf_onboarding_links (sheet_source_id);
CREATE INDEX IF NOT EXISTS csf_onboarding_links_term_id_idx ON plugin_data.csf_onboarding_links (term_id);
CREATE INDEX IF NOT EXISTS csf_opportunities_created_by_staff_position_id_idx ON plugin_data.csf_opportunities (created_by_staff_position_id);
CREATE INDEX IF NOT EXISTS csf_opportunities_created_by_user_id_idx ON plugin_data.csf_opportunities (created_by_user_id);
CREATE INDEX IF NOT EXISTS csf_opportunities_linked_project_id_idx ON plugin_data.csf_opportunities (linked_project_id);
CREATE INDEX IF NOT EXISTS csf_opportunities_term_id_idx ON plugin_data.csf_opportunities (term_id);
CREATE INDEX IF NOT EXISTS csf_partner_clubs_created_by_idx ON plugin_data.csf_partner_clubs (created_by);
CREATE INDEX IF NOT EXISTS csf_partner_submission_batches_partner_club_id_idx ON plugin_data.csf_partner_submission_batches (partner_club_id);
CREATE INDEX IF NOT EXISTS csf_partner_submission_batches_reviewed_by_idx ON plugin_data.csf_partner_submission_batches (reviewed_by);
CREATE INDEX IF NOT EXISTS csf_partner_submission_batches_submitted_by_idx ON plugin_data.csf_partner_submission_batches (submitted_by);
CREATE INDEX IF NOT EXISTS csf_partner_submission_batches_term_id_idx ON plugin_data.csf_partner_submission_batches (term_id);
CREATE INDEX IF NOT EXISTS csf_partner_submission_rows_generated_submission_id_idx ON plugin_data.csf_partner_submission_rows (generated_submission_id);
CREATE INDEX IF NOT EXISTS csf_partner_submission_rows_profile_id_idx ON plugin_data.csf_partner_submission_rows (profile_id);
CREATE INDEX IF NOT EXISTS csf_point_submissions_category_id_idx ON plugin_data.csf_point_submissions (category_id);
CREATE INDEX IF NOT EXISTS csf_point_submissions_opportunity_id_idx ON plugin_data.csf_point_submissions (opportunity_id);
CREATE INDEX IF NOT EXISTS csf_point_submissions_reviewed_by_idx ON plugin_data.csf_point_submissions (reviewed_by);
CREATE INDEX IF NOT EXISTS csf_point_submissions_submitted_by_idx ON plugin_data.csf_point_submissions (submitted_by);
CREATE INDEX IF NOT EXISTS csf_point_submissions_term_id_idx ON plugin_data.csf_point_submissions (term_id);
CREATE INDEX IF NOT EXISTS csf_profile_accounts_linked_by_idx ON plugin_data.csf_profile_accounts (linked_by);
CREATE INDEX IF NOT EXISTS csf_profile_accounts_user_id_idx ON plugin_data.csf_profile_accounts (user_id);
CREATE INDEX IF NOT EXISTS csf_profile_activity_events_credit_record_id_idx ON plugin_data.csf_profile_activity_events (credit_record_id);
CREATE INDEX IF NOT EXISTS csf_profile_activity_events_opportunity_id_idx ON plugin_data.csf_profile_activity_events (opportunity_id);
CREATE INDEX IF NOT EXISTS csf_profile_activity_events_profile_id_idx ON plugin_data.csf_profile_activity_events (profile_id);
CREATE INDEX IF NOT EXISTS csf_profile_activity_events_term_id_idx ON plugin_data.csf_profile_activity_events (term_id);
CREATE INDEX IF NOT EXISTS csf_profile_cohort_memberships_cohort_id_idx ON plugin_data.csf_profile_cohort_memberships (cohort_id);
CREATE INDEX IF NOT EXISTS csf_profile_link_requests_cohort_id_idx ON plugin_data.csf_profile_link_requests (cohort_id);
CREATE INDEX IF NOT EXISTS csf_profile_link_requests_matched_profile_id_idx ON plugin_data.csf_profile_link_requests (matched_profile_id);
CREATE INDEX IF NOT EXISTS csf_profile_link_requests_onboarding_link_id_idx ON plugin_data.csf_profile_link_requests (onboarding_link_id);
CREATE INDEX IF NOT EXISTS csf_profile_link_requests_resolved_by_idx ON plugin_data.csf_profile_link_requests (resolved_by);
CREATE INDEX IF NOT EXISTS csf_profile_link_requests_term_id_idx ON plugin_data.csf_profile_link_requests (term_id);
CREATE INDEX IF NOT EXISTS csf_profile_link_requests_user_id_idx ON plugin_data.csf_profile_link_requests (user_id);
CREATE INDEX IF NOT EXISTS csf_profile_merge_reviews_requested_by_idx ON plugin_data.csf_profile_merge_reviews (requested_by);
CREATE INDEX IF NOT EXISTS csf_profile_merge_reviews_reviewed_by_idx ON plugin_data.csf_profile_merge_reviews (reviewed_by);
CREATE INDEX IF NOT EXISTS csf_profile_merge_reviews_source_profile_id_idx ON plugin_data.csf_profile_merge_reviews (source_profile_id);
CREATE INDEX IF NOT EXISTS csf_profile_merge_reviews_target_profile_id_idx ON plugin_data.csf_profile_merge_reviews (target_profile_id);
CREATE INDEX IF NOT EXISTS csf_profile_restrictions_created_by_idx ON plugin_data.csf_profile_restrictions (created_by);
CREATE INDEX IF NOT EXISTS csf_profile_restrictions_profile_id_idx ON plugin_data.csf_profile_restrictions (profile_id);
CREATE INDEX IF NOT EXISTS csf_profile_restrictions_resolved_by_idx ON plugin_data.csf_profile_restrictions (resolved_by);
CREATE INDEX IF NOT EXISTS csf_sheet_import_jobs_initiated_by_idx ON plugin_data.csf_sheet_import_jobs (initiated_by);
CREATE INDEX IF NOT EXISTS csf_sheet_import_jobs_source_id_idx ON plugin_data.csf_sheet_import_jobs (source_id);
CREATE INDEX IF NOT EXISTS csf_sheet_import_rows_cohort_id_idx ON plugin_data.csf_sheet_import_rows (cohort_id);
CREATE INDEX IF NOT EXISTS csf_sheet_import_rows_matched_application_id_idx ON plugin_data.csf_sheet_import_rows (matched_application_id);
CREATE INDEX IF NOT EXISTS csf_sheet_import_rows_matched_profile_id_idx ON plugin_data.csf_sheet_import_rows (matched_profile_id);
CREATE INDEX IF NOT EXISTS csf_sheet_import_rows_source_id_idx ON plugin_data.csf_sheet_import_rows (source_id);
CREATE INDEX IF NOT EXISTS csf_sheet_import_rows_term_id_idx ON plugin_data.csf_sheet_import_rows (term_id);
CREATE INDEX IF NOT EXISTS csf_sheet_sources_cohort_id_idx ON plugin_data.csf_sheet_sources (cohort_id);
CREATE INDEX IF NOT EXISTS csf_sheet_sources_sync_owner_user_id_idx ON plugin_data.csf_sheet_sources (sync_owner_user_id);
CREATE INDEX IF NOT EXISTS csf_staff_position_history_actor_user_id_idx ON plugin_data.csf_staff_position_history (actor_user_id);
CREATE INDEX IF NOT EXISTS csf_staff_position_history_staff_position_id_idx ON plugin_data.csf_staff_position_history (staff_position_id);
CREATE INDEX IF NOT EXISTS csf_staff_positions_appointed_by_idx ON plugin_data.csf_staff_positions (appointed_by);
CREATE INDEX IF NOT EXISTS csf_staff_positions_profile_id_idx ON plugin_data.csf_staff_positions (profile_id);
CREATE INDEX IF NOT EXISTS csf_staff_positions_role_id_idx ON plugin_data.csf_staff_positions (role_id);
CREATE INDEX IF NOT EXISTS csf_staff_positions_user_id_idx ON plugin_data.csf_staff_positions (user_id);
CREATE INDEX IF NOT EXISTS csf_submission_files_profile_id_idx ON plugin_data.csf_submission_files (profile_id);
CREATE INDEX IF NOT EXISTS csf_submission_files_submission_id_idx ON plugin_data.csf_submission_files (submission_id);
CREATE INDEX IF NOT EXISTS csf_submission_files_term_id_idx ON plugin_data.csf_submission_files (term_id);
CREATE INDEX IF NOT EXISTS csf_submission_files_uploaded_by_idx ON plugin_data.csf_submission_files (uploaded_by);
CREATE INDEX IF NOT EXISTS csf_submission_reviews_actor_user_id_idx ON plugin_data.csf_submission_reviews (actor_user_id);
CREATE INDEX IF NOT EXISTS csf_submission_reviews_submission_id_idx ON plugin_data.csf_submission_reviews (submission_id);
CREATE INDEX IF NOT EXISTS csf_term_applications_cohort_id_idx ON plugin_data.csf_term_applications (cohort_id);
CREATE INDEX IF NOT EXISTS csf_term_applications_reviewed_by_idx ON plugin_data.csf_term_applications (reviewed_by);
CREATE INDEX IF NOT EXISTS csf_term_applications_term_id_idx ON plugin_data.csf_term_applications (term_id);
CREATE INDEX IF NOT EXISTS csf_term_point_rules_term_id_idx ON plugin_data.csf_term_point_rules (term_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'csf-private',
  'csf-private',
  false,
  20971520,
  ARRAY['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  updated_at = now();

DO $$
DECLARE
  _table text;
  _tables text[] := ARRAY[
    'csf_terms',
    'csf_cohorts',
    'csf_cohort_terms',
    'csf_profiles',
    'csf_profile_accounts',
    'csf_profile_cohort_memberships',
    'csf_term_applications',
    'csf_application_course_entries',
    'csf_application_files',
    'csf_application_status_events',
    'csf_roles',
    'csf_role_permissions',
    'csf_staff_positions',
    'csf_staff_position_history',
    'csf_profile_restrictions',
    'csf_opportunities',
    'csf_point_categories',
    'csf_term_point_rules',
    'csf_point_submissions',
    'csf_submission_files',
    'csf_credit_records',
    'csf_submission_reviews',
    'csf_meeting_attendance',
    'csf_sheet_sources',
    'csf_onboarding_links',
    'csf_sheet_import_jobs',
    'csf_sheet_import_rows',
    'csf_partner_clubs',
    'csf_partner_submission_batches',
    'csf_partner_submission_rows',
    'csf_profile_link_requests',
    'csf_profile_merge_reviews',
    'csf_profile_activity_events',
    'csf_admin_audit_events'
  ];
BEGIN
  FOREACH _table IN ARRAY _tables LOOP
    EXECUTE format('ALTER TABLE plugin_data.%I ENABLE ROW LEVEL SECURITY', _table);
    EXECUTE format('REVOKE ALL ON TABLE plugin_data.%I FROM anon, authenticated', _table);
    EXECUTE format('GRANT ALL ON TABLE plugin_data.%I TO service_role', _table);
  END LOOP;
END $$;

COMMENT ON TABLE plugin_data.csf_profiles IS
  'Protected CSF student/person profiles. Server-only access; do not expose through direct Data API.';

COMMENT ON TABLE plugin_data.csf_term_applications IS
  'Semester-specific CSF membership application records, normally imported from Google Form response sheets. Profiles persist; membership is term-scoped.';

COMMENT ON TABLE plugin_data.csf_onboarding_links IS
  'Class/term-specific Let''s Assist profile connection links that can point students toward official Google Forms.';

COMMENT ON TABLE plugin_data.csf_term_point_rules IS
  'Per-term CSF point requirements and countable caps, such as drive/non-drive limits.';

COMMENT ON TABLE plugin_data.csf_profile_link_requests IS
  'Student account/profile linking requests for resolving school email, personal email, and duplicate-account ambiguity.';

COMMENT ON TABLE plugin_data.csf_profile_activity_events IS
  'Normalized profile timeline records for imported history, meetings, opportunity credits, and manual adjustments.';

COMMENT ON TABLE plugin_data.csf_partner_clubs IS
  'Partner clubs and outside organizations whose participant rosters can be reviewed for CSF point credit.';

COMMENT ON TABLE plugin_data.csf_partner_submission_batches IS
  'Partner-submitted sheets/forms/lists awaiting CSF verification and profile matching.';

COMMENT ON TABLE plugin_data.csf_profile_restrictions IS
  'Private restriction/block/manual-review layer. Historical CSF profile data is retained separately from active restrictions.';

COMMENT ON TABLE plugin_data.csf_sheet_import_rows IS
  'Raw and normalized source evidence from cohort workbook/sheet imports for audit and conflict review.';

COMMENT ON TABLE plugin_data.csf_admin_audit_events IS
  'Immutable audit stream for consequential CSF plugin actions.';

COMMIT;
