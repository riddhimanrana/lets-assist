CREATE TABLE IF NOT EXISTS plugin_data.csf_term_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  meeting_key text NOT NULL,
  label text NOT NULL,
  meeting_date date,
  starts_at timestamptz,
  location text,
  attendance_source_url text,
  required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'archived')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, term_id, meeting_key)
);

CREATE INDEX IF NOT EXISTS csf_term_meetings_org_term_idx
  ON plugin_data.csf_term_meetings (organization_id, term_id, status, sort_order);

ALTER TABLE plugin_data.csf_meeting_attendance
  ADD COLUMN IF NOT EXISTS term_meeting_id uuid REFERENCES plugin_data.csf_term_meetings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_status text NOT NULL DEFAULT 'confirmed'
    CHECK (match_status IN ('confirmed', 'needs_review', 'ambiguous', 'unmatched')),
  ADD COLUMN IF NOT EXISTS match_confidence numeric(5, 4),
  ADD COLUMN IF NOT EXISTS submitted_name text,
  ADD COLUMN IF NOT EXISTS submitted_email text,
  ADD COLUMN IF NOT EXISTS source_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS match_details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(match_details) = 'object');

CREATE INDEX IF NOT EXISTS csf_meeting_attendance_term_meeting_idx
  ON plugin_data.csf_meeting_attendance (organization_id, term_meeting_id, match_status);

ALTER TABLE plugin_data.csf_term_meetings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_term_meetings FROM anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_term_meetings TO service_role;

COMMENT ON TABLE plugin_data.csf_term_meetings IS
  'Editable per-term CSF meeting requirements and attendance import settings.';

COMMENT ON COLUMN plugin_data.csf_meeting_attendance.match_status IS
  'Matching disposition for attendance evidence imported from forms, sheets, or manual review.';
