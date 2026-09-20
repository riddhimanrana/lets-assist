-- Printed references identify a roster snapshot. They never authorize access.
CREATE TABLE public.project_attendance_print_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  schedule_id text NOT NULL CHECK (length(schedule_id) BETWEEN 1 AND 200),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  project_title text NOT NULL,
  project_timezone text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  UNIQUE (id, project_id),
  CHECK (ends_at > starts_at)
);
CREATE INDEX project_attendance_print_sheets_project_idx
  ON public.project_attendance_print_sheets(project_id, created_at DESC);

CREATE INDEX project_attendance_print_sheets_creator_idx
  ON public.project_attendance_print_sheets(created_by) WHERE created_by IS NOT NULL;

CREATE TABLE public.project_attendance_print_rows (
  sheet_id uuid NOT NULL,
  project_id uuid NOT NULL,
  row_reference text NOT NULL DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
    CHECK (row_reference ~ '^[0-9a-f]{12}$'),
  row_number integer NOT NULL CHECK (row_number > 0),
  row_kind text NOT NULL CHECK (row_kind IN ('signup', 'walk_in', 'continuation')),
  signup_id uuid,
  printed_name text NOT NULL DEFAULT '',
  PRIMARY KEY (sheet_id, row_reference),
  UNIQUE (sheet_id, row_number),
  FOREIGN KEY (sheet_id, project_id)
    REFERENCES public.project_attendance_print_sheets(id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (signup_id, project_id)
    REFERENCES public.project_signups(id, project_id) ON DELETE CASCADE,
  CHECK ((row_kind = 'signup') = (signup_id IS NOT NULL)),
  CHECK (row_kind = 'signup' OR printed_name = '')
);
CREATE INDEX project_attendance_print_rows_signup_idx
  ON public.project_attendance_print_rows(signup_id, project_id) WHERE signup_id IS NOT NULL;
ALTER TABLE public.project_attendance_print_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_attendance_print_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_attendance_print_sheets, public.project_attendance_print_rows
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.project_attendance_print_sheets, public.project_attendance_print_rows TO service_role;

CREATE FUNCTION public.create_attendance_print_sheet(
  p_project_id uuid,
  p_schedule_id text,
  p_actor_id uuid,
  p_blank_rows integer DEFAULT 10,
  p_continuation_rows integer DEFAULT 4
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sheet_id uuid;
  v_project public.projects%ROWTYPE;
  v_slot record;
  v_count integer;
BEGIN
  IF NOT app_private.can_manage_project(p_project_id, p_actor_id) THEN
    RAISE EXCEPTION 'Not authorized to print this project' USING ERRCODE = '42501';
  END IF;
  IF p_blank_rows IS NULL OR p_blank_rows NOT BETWEEN 0 AND 100
    OR p_continuation_rows IS NULL OR p_continuation_rows NOT BETWEEN 0 AND 30
    OR p_schedule_id IS NULL OR length(p_schedule_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid print options' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
  SELECT * INTO v_slot FROM private.resolve_project_schedule_slot(p_project_id, p_schedule_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid schedule session' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.project_attendance_print_sheets
    (project_id, schedule_id, created_by, project_title, project_timezone, starts_at, ends_at)
  VALUES (p_project_id, p_schedule_id, p_actor_id, v_project.title,
    coalesce(nullif(v_project.project_timezone, ''), 'America/Los_Angeles'), v_slot.starts_at, v_slot.ends_at)
  RETURNING id INTO v_sheet_id;

  INSERT INTO public.project_attendance_print_rows
    (sheet_id, project_id, row_number, row_kind, signup_id, printed_name)
  SELECT v_sheet_id, p_project_id,
    row_number() OVER (ORDER BY lower(coalesce(nullif(profile.full_name, ''), nullif(anonymous.name, ''), 'Volunteer')), signup.id),
    'signup', signup.id,
    coalesce(nullif(profile.full_name, ''), nullif(anonymous.name, ''), 'Volunteer')
  FROM public.project_signups AS signup
  LEFT JOIN public.profiles AS profile ON profile.id = signup.user_id
  LEFT JOIN public.anonymous_signups AS anonymous ON anonymous.id = signup.anonymous_id
  WHERE signup.project_id = p_project_id AND signup.schedule_id = p_schedule_id
    AND signup.status IN ('approved', 'attended');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 5000 THEN
    RAISE EXCEPTION 'This roster is too large for a single print request' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.project_attendance_print_rows
    (sheet_id, project_id, row_number, row_kind)
  SELECT v_sheet_id, p_project_id, v_count + n, 'walk_in'
    FROM generate_series(1, p_blank_rows) AS n;
  INSERT INTO public.project_attendance_print_rows
    (sheet_id, project_id, row_number, row_kind)
  SELECT v_sheet_id, p_project_id, v_count + p_blank_rows + n, 'continuation'
    FROM generate_series(1, p_continuation_rows) AS n;
  RETURN v_sheet_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_attendance_print_sheet(uuid, text, uuid, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_attendance_print_sheet(uuid, text, uuid, integer, integer)
  TO service_role;
