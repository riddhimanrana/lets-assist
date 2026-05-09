-- Migration: DV Speech & Debate Premium Features
-- Adds leadership tracking, teacher profiles, and meeting attendance system.

-- 1. Add leadership_title to memberships
ALTER TABLE plugin_data.dv_sd_memberships 
ADD COLUMN IF NOT EXISTS leadership_title text;

-- 2. Teacher Profiles
CREATE TABLE IF NOT EXISTS plugin_data.dv_sd_teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text,
  department text,
  is_advisor boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dv_sd_teachers_org ON plugin_data.dv_sd_teachers(organization_id);

-- 3. Meetings (for recurring attendance)
CREATE TABLE IF NOT EXISTS plugin_data.dv_sd_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  season_id uuid REFERENCES plugin_data.org_seasons(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  meeting_type text DEFAULT 'general' CHECK (meeting_type IN ('general', 'officer', 'category', 'prep')),
  category text, -- e.g. 'PF', 'LD', 'Speech'
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer DEFAULT 60,
  location text,
  qr_code_enabled boolean DEFAULT true,
  is_recurring boolean DEFAULT false,
  recurrence_rule text, -- Simplified iCal-like rule
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dv_sd_meetings_org ON plugin_data.dv_sd_meetings(organization_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_meetings_date ON plugin_data.dv_sd_meetings(scheduled_at);

-- 4. Meeting Attendance
CREATE TABLE IF NOT EXISTS plugin_data.dv_sd_meeting_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES plugin_data.dv_sd_meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  check_in_time timestamptz DEFAULT now(),
  check_out_time timestamptz,
  status text NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'excused', 'late')),
  notes text,
  UNIQUE (meeting_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dv_sd_attendance_meeting ON plugin_data.dv_sd_meeting_attendance(meeting_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_attendance_user ON plugin_data.dv_sd_meeting_attendance(user_id);

-- 5. RLS Policies
ALTER TABLE plugin_data.dv_sd_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_meeting_attendance ENABLE ROW LEVEL SECURITY;

-- Teachers
CREATE POLICY "dv_sd_teachers_read" ON plugin_data.dv_sd_teachers
  FOR SELECT USING (private.is_org_member(organization_id));

CREATE POLICY "dv_sd_teachers_write" ON plugin_data.dv_sd_teachers
  FOR ALL TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- Meetings
CREATE POLICY "dv_sd_meetings_read" ON plugin_data.dv_sd_meetings
  FOR SELECT USING (private.is_org_member(organization_id));

CREATE POLICY "dv_sd_meetings_write" ON plugin_data.dv_sd_meetings
  FOR ALL TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- Attendance
CREATE POLICY "dv_sd_attendance_read" ON plugin_data.dv_sd_meeting_attendance
  FOR SELECT USING (
    user_id = (SELECT auth.uid()) 
    OR private.is_org_staff_or_admin(organization_id)
  );

CREATE POLICY "dv_sd_attendance_insert" ON plugin_data.dv_sd_meeting_attendance
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid()) 
    OR private.is_org_staff_or_admin(organization_id)
  );

CREATE POLICY "dv_sd_attendance_update" ON plugin_data.dv_sd_meeting_attendance
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));
