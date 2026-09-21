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
  v_schedule_key text;
BEGIN
  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR NOT private.lock_attendance_management(p_project_id, p_actor_id) THEN
    RAISE EXCEPTION 'Not authorized to print this project' USING ERRCODE = '42501';
  END IF;
  IF p_blank_rows IS NULL OR p_blank_rows NOT BETWEEN 0 AND 100
    OR p_continuation_rows IS NULL OR p_continuation_rows NOT BETWEEN 0 AND 30
    OR p_schedule_id IS NULL OR length(p_schedule_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid print options' USING ERRCODE = '22023';
  END IF;
  v_schedule_key:=private.project_hours_publish_key(v_project.event_type,v_project.schedule,p_schedule_id);
  IF v_schedule_key IS NULL THEN
    RAISE EXCEPTION 'Invalid schedule session' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_slot FROM private.resolve_project_schedule_slot(p_project_id, v_schedule_key);
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
  WHERE signup.project_id = p_project_id
    AND private.project_hours_publish_key(v_project.event_type,v_project.schedule,signup.schedule_id)=v_schedule_key
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


CREATE TABLE private.attendance_print_requests (
  request_id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload)='object'),
  sheets jsonb NOT NULL CHECK (jsonb_typeof(sheets)='array'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_print_requests_project_idx ON private.attendance_print_requests(project_id);
ALTER TABLE private.attendance_print_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.attendance_print_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT ALL ON private.attendance_print_requests TO postgres;

CREATE FUNCTION public.create_attendance_print_sheets(
  p_project_id uuid,p_schedule_ids text[],p_actor_id uuid,
  p_blank_rows integer,p_continuation_rows integer,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_prior private.attendance_print_requests%ROWTYPE;
  v_payload jsonb;
  v_sheets jsonb:='[]'::jsonb;
  v_schedule_id text;
  v_sheet_id uuid;
BEGIN
  PERFORM id FROM public.projects WHERE id=p_project_id FOR UPDATE;
  IF NOT FOUND OR NOT private.lock_attendance_management(p_project_id,p_actor_id) THEN
    RAISE EXCEPTION 'Not authorized to print this project' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR p_schedule_ids IS NULL OR cardinality(p_schedule_ids) NOT BETWEEN 1 AND 50
    OR array_ndims(p_schedule_ids) IS DISTINCT FROM 1 OR array_position(p_schedule_ids,NULL) IS NOT NULL
    OR EXISTS(SELECT 1 FROM unnest(p_schedule_ids) id WHERE length(id) NOT BETWEEN 1 AND 200)
    OR (SELECT count(DISTINCT id) FROM unnest(p_schedule_ids) id)<>cardinality(p_schedule_ids)
    OR p_blank_rows IS NULL OR p_blank_rows NOT BETWEEN 0 AND 100
    OR p_continuation_rows IS NULL OR p_continuation_rows NOT BETWEEN 0 AND 30 THEN
    RAISE EXCEPTION 'Invalid print options' USING ERRCODE='22023';
  END IF;
  -- A request UUID cannot create sheets in two projects concurrently.
  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-attendance-print:'||p_request_id::text,0));
  v_payload:=jsonb_build_object('projectId',p_project_id,'actorId',p_actor_id,
    'scheduleIds',to_jsonb(p_schedule_ids),'blankRows',p_blank_rows,'continuationRows',p_continuation_rows);
  SELECT * INTO v_prior FROM private.attendance_print_requests WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_prior.request_payload IS DISTINCT FROM v_payload THEN
      RAISE EXCEPTION 'print request key reused' USING ERRCODE='22023';
    END IF;
    RETURN v_prior.sheets;
  END IF;
  FOREACH v_schedule_id IN ARRAY p_schedule_ids LOOP
    v_sheet_id:=public.create_attendance_print_sheet(p_project_id,v_schedule_id,p_actor_id,p_blank_rows,p_continuation_rows);
    v_sheets:=v_sheets||jsonb_build_array(jsonb_build_object('sheet_id',v_sheet_id,'schedule_id',v_schedule_id));
  END LOOP;
  INSERT INTO private.attendance_print_requests(request_id,project_id,actor_id,request_payload,sheets)
    VALUES(p_request_id,p_project_id,p_actor_id,v_payload,v_sheets);
  RETURN v_sheets;
END;
$$;
REVOKE ALL ON FUNCTION public.create_attendance_print_sheets(uuid,text[],uuid,integer,integer,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_attendance_print_sheets(uuid,text[],uuid,integer,integer,uuid) TO service_role;
