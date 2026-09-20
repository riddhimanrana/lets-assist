-- Reviewed attendance is stored separately from the legacy envelope. Historical
-- certificates retain their original award until an explicit correction.
BEGIN;
ALTER TABLE public.project_paper_scan_batches
  ADD COLUMN input_method text NOT NULL DEFAULT 'scan' CHECK (input_method IN ('scan', 'manual')),
  ADD COLUMN creation_request_id uuid UNIQUE;
ALTER TABLE public.project_paper_scan_rows
  ADD COLUMN attendance_intervals jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attendance_intervals) = 'array'),
  ADD COLUMN review_acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN identity_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN time_exception_reason text CHECK (char_length(time_exception_reason) <= 1000),
  ADD COLUMN review_revision integer NOT NULL DEFAULT 0 CHECK (review_revision >= 0),
  ADD COLUMN creation_request_id uuid UNIQUE;
ALTER TABLE public.project_signups
  ADD COLUMN attendance_revision integer NOT NULL DEFAULT 0 CHECK (attendance_revision >= 0);
ALTER TABLE public.certificates
  ADD COLUMN credited_minutes integer CHECK (credited_minutes BETWEEN 1 AND 1440),
  ADD COLUMN attendance_revision integer NOT NULL DEFAULT 0 CHECK (attendance_revision >= 0);
CREATE TABLE public.project_attendance_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signup_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  check_in_time timestamptz NOT NULL,
  check_out_time timestamptz NOT NULL,
  FOREIGN KEY (signup_id, project_id) REFERENCES public.project_signups(id, project_id) ON DELETE CASCADE,
  CHECK (isfinite(check_in_time) AND isfinite(check_out_time) AND check_out_time > check_in_time
    AND check_out_time <= check_in_time + interval '24 hours'),
  UNIQUE (signup_id, check_in_time)
);
ALTER TABLE public.project_attendance_intervals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_attendance_intervals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_attendance_intervals TO service_role;
CREATE INDEX project_attendance_intervals_project_idx ON public.project_attendance_intervals(project_id);
CREATE TABLE private.project_attendance_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signup_id uuid NOT NULL REFERENCES public.project_signups(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  request_id uuid NOT NULL UNIQUE,
  request_payload jsonb NOT NULL,
  reason text NOT NULL,
  old_intervals jsonb NOT NULL,
  new_intervals jsonb NOT NULL,
  old_credited_minutes integer,
  new_credited_minutes integer NOT NULL,
  old_revision integer NOT NULL,
  new_revision integer NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.project_attendance_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.project_attendance_changes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON private.project_attendance_changes TO service_role;
CREATE INDEX project_attendance_changes_signup_idx ON private.project_attendance_changes(signup_id);
CREATE TABLE private.paper_attendance_review_operations (
  request_id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.project_paper_scan_batches(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  operation text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.paper_attendance_review_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.paper_attendance_review_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON private.paper_attendance_review_operations TO service_role;

CREATE FUNCTION private.lock_attendance_management(p_project_id uuid,p_actor_id uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_project public.projects%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_project FROM public.projects WHERE id=p_project_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_project.creator_id=p_actor_id THEN RETURN true; END IF;
  PERFORM members.user_id FROM public.organization_members members WHERE members.organization_id=v_project.organization_id
    AND members.user_id=p_actor_id AND members.status='active'
    AND (members.role='admin' OR (members.role='staff' AND v_project.can_be_managed_by_staff IS TRUE)) FOR SHARE;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION private.lock_attendance_management(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.lock_attendance_management(uuid,uuid) TO postgres;

-- Drafts may have missing endpoints, but a reviewed actual time cannot be future.
CREATE FUNCTION private.assert_attendance_not_future(p_intervals jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE v_visit jsonb; v_endpoint text; v_time timestamptz;
BEGIN
  FOR v_visit IN SELECT value FROM jsonb_array_elements(COALESCE(p_intervals,'[]'::jsonb)) LOOP
    FOREACH v_endpoint IN ARRAY ARRAY['checkIn','checkOut'] LOOP
      IF v_visit->>v_endpoint IS NOT NULL THEN
        v_time:=(v_visit->>v_endpoint)::timestamptz;
        IF NOT isfinite(v_time) OR v_time>clock_timestamp() THEN
          RAISE EXCEPTION 'attendance times cannot be in the future' USING ERRCODE='22023';
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_attendance_not_future(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.assert_attendance_not_future(jsonb) TO postgres;

CREATE FUNCTION private.assert_attendance_session_ended(p_project_id uuid,p_schedule_id text)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE v_slot record;
BEGIN
  SELECT slot.* INTO v_slot FROM public.projects project CROSS JOIN LATERAL private.resolve_project_schedule_slot(
    project.id,private.project_hours_publish_key(project.event_type,project.schedule,p_schedule_id)) slot WHERE project.id=p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid attendance session' USING ERRCODE='22023'; END IF;
  IF v_slot.ends_at>clock_timestamp() THEN
    RAISE EXCEPTION 'project session has not ended' USING ERRCODE='22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_attendance_session_ended(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.assert_attendance_session_ended(uuid,text) TO postgres;

-- An older account award without a signup link needs explicit reconciliation.
CREATE FUNCTION private.assert_no_unlinked_platform_award(p_signup_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.project_signups signup JOIN public.projects project ON project.id=signup.project_id
    JOIN public.certificates certificate ON certificate.project_id=signup.project_id AND certificate.user_id=signup.user_id
    WHERE signup.id=p_signup_id AND certificate.signup_id IS NULL AND (certificate.type='verified' OR certificate.type IS NULL)
      AND (private.project_hours_publish_key(project.event_type,project.schedule,certificate.schedule_id) IS NULL
        OR private.project_hours_publish_key(project.event_type,project.schedule,certificate.schedule_id)
          =private.project_hours_publish_key(project.event_type,project.schedule,signup.schedule_id))) THEN
    RAISE EXCEPTION 'unlinked platform award requires reconciliation' USING ERRCODE='23505';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_no_unlinked_platform_award(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.assert_no_unlinked_platform_award(uuid) TO postgres;

-- Keep historical NULL-type awards in place. Serialize new award inserts with
-- publication without rewriting or deduplicating any historical certificate.
CREATE FUNCTION private.protect_legacy_platform_award()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.signup_id IS NOT NULL AND (NEW.type='verified' OR NEW.type IS NULL) THEN
    PERFORM projects.id FROM public.projects projects JOIN public.project_signups signups ON signups.project_id=projects.id
      WHERE signups.id=NEW.signup_id FOR UPDATE OF projects;
    PERFORM private.assert_no_unlinked_platform_award(NEW.signup_id);
    IF EXISTS(SELECT 1 FROM public.certificates existing WHERE existing.signup_id=NEW.signup_id
      AND existing.id<>NEW.id AND (existing.type='verified' OR existing.type IS NULL)
      AND (NEW.type IS NULL OR existing.type IS NULL)) THEN
      RAISE EXCEPTION 'platform award already exists; use the correction workflow' USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_legacy_platform_award() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.protect_legacy_platform_award() TO postgres;
CREATE TRIGGER protect_legacy_platform_award BEFORE INSERT OR UPDATE OF type,signup_id ON public.certificates
FOR EACH ROW EXECUTE FUNCTION private.protect_legacy_platform_award();

CREATE FUNCTION private.normalize_attendance_intervals(p_intervals jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_entry jsonb;
  v_in timestamptz;
  v_out timestamptz;
  v_last timestamptz;
  v_first timestamptz;
  v_total numeric := 0;
BEGIN
  IF p_intervals IS NULL OR jsonb_typeof(p_intervals) <> 'array'
    OR jsonb_array_length(p_intervals) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'attendance requires between 1 and 50 complete intervals' USING ERRCODE = '22023';
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_intervals) LOOP
    IF jsonb_typeof(v_entry) <> 'object'
      OR jsonb_typeof(v_entry->'checkIn') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_entry->'checkOut') IS DISTINCT FROM 'string'
      OR (v_entry->>'checkIn') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      OR (v_entry->>'checkOut') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      RAISE EXCEPTION 'attendance requires complete timestamps with a timezone' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('checkIn', (value->>'checkIn')::timestamptz,
    'checkOut', (value->>'checkOut')::timestamptz) ORDER BY (value->>'checkIn')::timestamptz)
    INTO v_result FROM jsonb_array_elements(p_intervals);
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_result) LOOP
    v_in := (v_entry->>'checkIn')::timestamptz;
    v_out := (v_entry->>'checkOut')::timestamptz;
    IF NOT isfinite(v_in) OR NOT isfinite(v_out) OR v_out <= v_in OR v_in < v_last THEN
      RAISE EXCEPTION 'attendance intervals must be positive and disjoint' USING ERRCODE = '22023';
    END IF;
    v_first := COALESCE(v_first, v_in);
    v_last := v_out;
    v_total := v_total + extract(epoch FROM v_out - v_in) / 60;
  END LOOP;
  IF v_last > v_first + interval '24 hours' OR round(v_total) NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'attendance must total at least one minute within a 24 hour envelope' USING ERRCODE = '22023';
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION private.normalize_attendance_intervals(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.normalize_attendance_intervals(jsonb) TO postgres;

CREATE FUNCTION private.attendance_interval_minutes(p_intervals jsonb)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT round(sum(extract(epoch FROM (value->>'checkOut')::timestamptz - (value->>'checkIn')::timestamptz) / 60))::integer
  FROM jsonb_array_elements(p_intervals);
$$;
REVOKE ALL ON FUNCTION private.attendance_interval_minutes(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.attendance_interval_minutes(jsonb) TO postgres;

CREATE FUNCTION private.signup_attendance_intervals(p_signup_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('checkIn', check_in_time, 'checkOut', check_out_time)
    ORDER BY check_in_time), '[]'::jsonb)
  FROM public.project_attendance_intervals WHERE signup_id = p_signup_id;
$$;
REVOKE ALL ON FUNCTION private.signup_attendance_intervals(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.signup_attendance_intervals(uuid) TO postgres;

-- The project lock serializes all identities and sessions for this project.
-- It is also the publication and paper-commit lock.
CREATE FUNCTION private.set_project_attendance_intervals(
  p_signup_id uuid, p_intervals jsonb, p_exception_reason text DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_signup public.project_signups%ROWTYPE;
  v_intervals jsonb := private.normalize_attendance_intervals(p_intervals);
  v_slot record;
  v_email text;
  v_first timestamptz := (v_intervals->0->>'checkIn')::timestamptz;
  v_last timestamptz := (v_intervals->-1->>'checkOut')::timestamptz;
BEGIN
  PERFORM projects.id FROM public.projects projects JOIN public.project_signups signups ON signups.project_id = projects.id
    WHERE signups.id = p_signup_id FOR UPDATE OF projects;
  SELECT * INTO STRICT v_signup FROM public.project_signups WHERE id = p_signup_id FOR UPDATE;
  PERFORM private.assert_attendance_not_future(v_intervals);
  PERFORM private.assert_no_unlinked_platform_award(p_signup_id);
  SELECT * INTO v_slot FROM private.resolve_project_schedule_slot(v_signup.project_id, v_signup.schedule_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid attendance session' USING ERRCODE = '22023'; END IF;
  IF (v_first < v_slot.starts_at OR v_last > v_slot.ends_at)
    AND NULLIF(btrim(p_exception_reason), '') IS NULL THEN
    RAISE EXCEPTION 'outside_schedule_requires_reason' USING ERRCODE = '22023';
  END IF;
  SELECT lower(COALESCE(account.email::text, anonymous.email)) INTO v_email
  FROM public.project_signups signup
  LEFT JOIN auth.users account ON account.id = signup.user_id AND account.email_confirmed_at IS NOT NULL
  LEFT JOIN public.anonymous_signups anonymous ON anonymous.id = signup.anonymous_id
  WHERE signup.id = p_signup_id;
  IF EXISTS (
    SELECT 1 FROM public.project_signups other
    LEFT JOIN auth.users account ON account.id = other.user_id AND account.email_confirmed_at IS NOT NULL
    LEFT JOIN public.anonymous_signups anonymous ON anonymous.id = other.anonymous_id
    CROSS JOIN LATERAL jsonb_array_elements(CASE
      WHEN EXISTS (SELECT 1 FROM public.project_attendance_intervals intervals WHERE intervals.signup_id = other.id)
        THEN private.signup_attendance_intervals(other.id)
      WHEN other.check_in_time IS NOT NULL AND other.check_out_time > other.check_in_time
        THEN jsonb_build_array(jsonb_build_object('checkIn',other.check_in_time,'checkOut',other.check_out_time))
      ELSE '[]'::jsonb END) prior
    CROSS JOIN jsonb_array_elements(v_intervals) fresh
    WHERE other.project_id = v_signup.project_id AND other.id <> p_signup_id
      AND (other.status IN ('approved','attended') OR EXISTS(SELECT 1 FROM public.certificates award WHERE award.signup_id=other.id AND (award.type='verified' OR award.type IS NULL)))
      AND (other.user_id = v_signup.user_id OR other.anonymous_id = v_signup.anonymous_id
        OR lower(COALESCE(account.email::text, anonymous.email)) = v_email
        OR EXISTS(SELECT 1 FROM public.user_emails alias WHERE alias.verified_at IS NOT NULL
          AND ((alias.user_id=other.user_id AND lower(alias.email)=v_email)
            OR (alias.user_id=v_signup.user_id AND lower(alias.email)=lower(anonymous.email)))))
      AND (fresh.value->>'checkIn')::timestamptz < (prior.value->>'checkOut')::timestamptz
      AND (fresh.value->>'checkOut')::timestamptz > (prior.value->>'checkIn')::timestamptz
  ) THEN RAISE EXCEPTION 'attendance_overlaps_another_session' USING ERRCODE = '22023'; END IF;
  IF private.signup_attendance_intervals(p_signup_id) = v_intervals THEN
    RETURN private.attendance_interval_minutes(v_intervals);
  END IF;
  DELETE FROM public.project_attendance_intervals WHERE signup_id = p_signup_id;
  INSERT INTO public.project_attendance_intervals(signup_id,project_id,check_in_time,check_out_time)
  SELECT p_signup_id,v_signup.project_id,(value->>'checkIn')::timestamptz,(value->>'checkOut')::timestamptz
  FROM jsonb_array_elements(v_intervals);
  UPDATE public.project_signups SET attendance_revision = attendance_revision + 1,
    check_in_time = v_first, check_out_time = v_last WHERE id = p_signup_id;
  RETURN private.attendance_interval_minutes(v_intervals);
END;
$$;
REVOKE ALL ON FUNCTION private.set_project_attendance_intervals(uuid,jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.set_project_attendance_intervals(uuid,jsonb,text) TO postgres;

CREATE FUNCTION private.stamp_certificate_attendance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_intervals jsonb;
BEGIN
  IF NEW.type = 'verified' AND NEW.signup_id IS NOT NULL THEN
    PERFORM private.assert_attendance_session_ended((SELECT project_id FROM public.project_signups WHERE id=NEW.signup_id),(SELECT schedule_id FROM public.project_signups WHERE id=NEW.signup_id));
    PERFORM private.assert_attendance_not_future(jsonb_build_array(jsonb_build_object('checkIn',NEW.event_start,'checkOut',NEW.event_end)));
    v_intervals := private.signup_attendance_intervals(NEW.signup_id);
    IF jsonb_array_length(v_intervals) > 0 THEN
      NEW.credited_minutes := private.attendance_interval_minutes(v_intervals);
      SELECT attendance_revision INTO NEW.attendance_revision FROM public.project_signups WHERE id = NEW.signup_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.stamp_certificate_attendance() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.stamp_certificate_attendance() TO postgres;
CREATE TRIGGER stamp_certificate_attendance BEFORE INSERT ON public.certificates
FOR EACH ROW EXECUTE FUNCTION private.stamp_certificate_attendance();

CREATE FUNCTION private.guard_reviewed_attendance_envelope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_intervals jsonb;
BEGIN
  IF (current_setting('role', true) IN ('anon','authenticated'))
    AND ((TG_OP='INSERT' AND NEW.attendance_revision<>0)
      OR (TG_OP='UPDATE' AND NEW.attendance_revision IS DISTINCT FROM OLD.attendance_revision)) THEN
    RAISE EXCEPTION 'reviewed attendance revision is server-owned' USING ERRCODE = '42501';
  END IF;
  v_intervals := private.signup_attendance_intervals(NEW.id);
  IF jsonb_array_length(v_intervals) > 0 AND
    (NEW.check_in_time IS DISTINCT FROM (v_intervals->0->>'checkIn')::timestamptz
     OR NEW.check_out_time IS DISTINCT FROM (v_intervals->-1->>'checkOut')::timestamptz) THEN
    RAISE EXCEPTION 'reviewed attendance requires the correction workflow' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_reviewed_attendance_envelope() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.guard_reviewed_attendance_envelope() TO postgres;
CREATE TRIGGER guard_reviewed_attendance_envelope BEFORE INSERT OR UPDATE OF check_in_time,check_out_time,attendance_revision ON public.project_signups
FOR EACH ROW EXECUTE FUNCTION private.guard_reviewed_attendance_envelope();

CREATE FUNCTION public.correct_project_attendance(
  p_signup_id uuid, p_expected_revision integer, p_reason text,
  p_intervals jsonb, p_request_id uuid, p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_signup public.project_signups%ROWTYPE;
  v_certificate public.certificates%ROWTYPE;
  v_prior private.project_attendance_changes%ROWTYPE;
  v_intervals jsonb;
  v_old jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_minutes integer;
  v_revision integer;
BEGIN
  IF p_actor_id IS NULL OR p_request_id IS NULL OR p_expected_revision IS NULL
    OR NULLIF(btrim(p_reason),'') IS NULL OR char_length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'invalid attendance correction' USING ERRCODE = '22023';
  END IF;
  PERFORM projects.id FROM public.projects projects JOIN public.project_signups signups ON signups.project_id=projects.id
    WHERE signups.id=p_signup_id FOR UPDATE OF projects;
  SELECT * INTO STRICT v_signup FROM public.project_signups WHERE id=p_signup_id FOR UPDATE;
  IF NOT private.lock_attendance_management(v_signup.project_id,p_actor_id) THEN
    RAISE EXCEPTION 'not authorized to correct attendance' USING ERRCODE='42501';
  END IF;
  v_intervals := private.normalize_attendance_intervals(p_intervals);
  v_payload := jsonb_build_object('signupId',p_signup_id,'actorId',p_actor_id,'expectedRevision',p_expected_revision,
    'reason',btrim(p_reason),'intervals',v_intervals);
  SELECT * INTO v_prior FROM private.project_attendance_changes WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_prior.request_payload <> v_payload THEN RAISE EXCEPTION 'correction request key reused' USING ERRCODE='22023'; END IF;
    RETURN v_prior.result || jsonb_build_object('outcome','replayed');
  END IF;
  IF v_signup.attendance_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'attendance changed; refresh before correcting' USING ERRCODE='40001';
  END IF;
  IF v_signup.status NOT IN ('approved','attended') THEN
    RAISE EXCEPTION 'signup is not eligible for attendance' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(*) FROM public.certificates WHERE signup_id=p_signup_id AND (type='verified' OR type IS NULL))>1 THEN
    RAISE EXCEPTION 'multiple platform awards require reconciliation' USING ERRCODE='23505';
  END IF;
  SELECT * INTO v_certificate FROM public.certificates WHERE signup_id=p_signup_id AND (type='verified' OR type IS NULL) FOR UPDATE;
  v_old := private.signup_attendance_intervals(p_signup_id);
  IF v_old = '[]'::jsonb THEN
    v_old := jsonb_build_array(jsonb_build_object('checkIn',v_signup.check_in_time,'checkOut',v_signup.check_out_time));
  END IF;
  PERFORM set_config('app.paper_commit_actor_id',p_actor_id::text,true);
  PERFORM set_config('app.attendance_correction','on',true);
  v_minutes := private.set_project_attendance_intervals(p_signup_id,v_intervals,p_reason);
  PERFORM set_config('app.attendance_correction','',true);
  SELECT attendance_revision INTO v_revision FROM public.project_signups WHERE id=p_signup_id;
  -- A no-op correction still consumes the optimistic revision.
  IF v_revision = v_signup.attendance_revision THEN
    UPDATE public.project_signups SET attendance_revision=attendance_revision+1 WHERE id=p_signup_id RETURNING attendance_revision INTO v_revision;
  END IF;
  UPDATE public.certificates SET credited_minutes=v_minutes,attendance_revision=v_revision,
    event_start=(v_intervals->0->>'checkIn')::timestamptz,
    event_end=(v_intervals->-1->>'checkOut')::timestamptz
  WHERE signup_id=p_signup_id AND (type='verified' OR type IS NULL) RETURNING id INTO v_certificate.id;
  v_result := jsonb_build_object('outcome','accepted','signupId',p_signup_id,'attendanceRevision',v_revision,
    'creditedMinutes',v_minutes,'certificateId',v_certificate.id);
  INSERT INTO private.project_attendance_changes(signup_id,project_id,actor_id,request_id,request_payload,reason,
    old_intervals,new_intervals,old_credited_minutes,new_credited_minutes,old_revision,new_revision,result)
  VALUES(p_signup_id,v_signup.project_id,p_actor_id,p_request_id,v_payload,btrim(p_reason),v_old,v_intervals,
    COALESCE(v_certificate.credited_minutes,round(extract(epoch FROM v_certificate.event_end-v_certificate.event_start)/60)::integer),
    v_minutes,v_signup.attendance_revision,v_revision,v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.correct_project_attendance(uuid,integer,text,jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_project_attendance(uuid,integer,text,jsonb,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.update_paper_scan_review_row(
  p_batch_id uuid,
  p_project_id uuid,
  p_row_id uuid,
  p_actor_id uuid,
  p_patch jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch public.project_paper_scan_batches%ROWTYPE;
  v_row public.project_paper_scan_rows%ROWTYPE;
  v_item jsonb;
  v_changed boolean;
  v_name text;
  v_email text;
  v_phone text;
  v_check_in_time timestamptz;
  v_check_out_time timestamptz;
  v_signature_present boolean;
  v_decision text;
  v_match_signup_id uuid;
BEGIN
  IF p_batch_id IS NULL OR p_project_id IS NULL OR p_row_id IS NULL
     OR p_actor_id IS NULL OR p_patch IS NULL
     OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'update_paper_scan_review_row: invalid input';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_patch) AS supplied(key)
    WHERE supplied.key NOT IN (
      'name', 'email', 'phone', 'checkInTime', 'checkOutTime',
      'signaturePresent', 'decision', 'matchSignupId', 'expectedRevision',
      'attendanceIntervals', 'reviewAcknowledged', 'identityConfirmed', 'timeExceptionReason'
    )
  ) THEN
    RAISE EXCEPTION 'update_paper_scan_review_row: unsupported patch key';
  END IF;

  SELECT batches.*
  INTO v_batch
  FROM public.project_paper_scan_batches AS batches
  WHERE batches.id = p_batch_id
    AND batches.project_id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF NOT private.lock_attendance_management(v_batch.project_id, p_actor_id) THEN
    RAISE EXCEPTION 'update_paper_scan_review_row: actor is not a project organizer';
  END IF;

  IF v_batch.status NOT IN ('review','committed') THEN
    RETURN 'not_review';
  END IF;

  SELECT * INTO v_row FROM public.project_paper_scan_rows WHERE id=p_row_id AND batch_id=p_batch_id AND project_id=p_project_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_row.committed_signup_id IS NOT NULL THEN RETURN 'already_committed'; END IF;
  IF v_batch.status='committed' THEN
    IF v_row.outcome<>'roster_only' THEN RETURN 'not_review'; END IF;
    UPDATE public.project_paper_scan_batches SET status='review' WHERE id=p_batch_id;
  END IF;
  IF p_patch ? 'expectedRevision' AND
    (jsonb_typeof(p_patch->'expectedRevision') IS DISTINCT FROM 'number'
     OR (p_patch->>'expectedRevision')::integer <> v_row.review_revision) THEN
    RAISE EXCEPTION 'review row changed; refresh before saving' USING ERRCODE='40001';
  END IF;
  IF p_patch ? 'attendanceIntervals' THEN
    IF jsonb_typeof(p_patch->'attendanceIntervals') <> 'array' OR jsonb_array_length(p_patch->'attendanceIntervals') > 50 THEN
      RAISE EXCEPTION 'invalid attendance interval draft' USING ERRCODE='22023';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'attendanceIntervals') LOOP
      IF jsonb_typeof(v_item) <> 'object' OR NOT v_item ?& ARRAY['checkIn','checkOut']
        OR jsonb_typeof(v_item->'checkIn') NOT IN ('string','null')
        OR jsonb_typeof(v_item->'checkOut') NOT IN ('string','null') THEN
        RAISE EXCEPTION 'invalid attendance interval draft' USING ERRCODE='22023';
      END IF;
    END LOOP;
  END IF;
  IF (p_patch ? 'reviewAcknowledged' AND jsonb_typeof(p_patch->'reviewAcknowledged') <> 'boolean')
    OR (p_patch ? 'identityConfirmed' AND jsonb_typeof(p_patch->'identityConfirmed') <> 'boolean')
    OR (p_patch ? 'timeExceptionReason' AND jsonb_typeof(p_patch->'timeExceptionReason') NOT IN ('string','null')) THEN
    RAISE EXCEPTION 'invalid attendance review confirmation' USING ERRCODE='22023';
  END IF;
  v_changed := (p_patch - ARRAY['expectedRevision','reviewAcknowledged','identityConfirmed','decision']) <> '{}'::jsonb;

  IF p_patch ? 'name' THEN
    IF jsonb_typeof(p_patch->'name') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid name';
    END IF;
    v_name := CASE WHEN jsonb_typeof(p_patch->'name') = 'null' THEN NULL ELSE p_patch->>'name' END;
  END IF;
  IF p_patch ? 'email' THEN
    IF jsonb_typeof(p_patch->'email') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid email';
    END IF;
    v_email := CASE WHEN jsonb_typeof(p_patch->'email') = 'null' THEN NULL ELSE lower(p_patch->>'email') END;
  END IF;
  IF p_patch ? 'phone' THEN
    IF jsonb_typeof(p_patch->'phone') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid phone';
    END IF;
    v_phone := CASE WHEN jsonb_typeof(p_patch->'phone') = 'null' THEN NULL ELSE p_patch->>'phone' END;
  END IF;
  IF p_patch ? 'checkInTime' THEN
    IF jsonb_typeof(p_patch->'checkInTime') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid check-in';
    END IF;
    IF jsonb_typeof(p_patch->'checkInTime') <> 'null' THEN
      v_check_in_time := (p_patch->>'checkInTime')::timestamptz;
    END IF;
  END IF;
  IF p_patch ? 'checkOutTime' THEN
    IF jsonb_typeof(p_patch->'checkOutTime') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid check-out';
    END IF;
    IF jsonb_typeof(p_patch->'checkOutTime') <> 'null' THEN
      v_check_out_time := (p_patch->>'checkOutTime')::timestamptz;
    END IF;
  END IF;
  IF p_patch ? 'signaturePresent' THEN
    IF jsonb_typeof(p_patch->'signaturePresent') <> 'boolean' THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid signature flag';
    END IF;
    v_signature_present := (p_patch->>'signaturePresent')::boolean;
  END IF;
  IF p_patch ? 'decision' THEN
    IF jsonb_typeof(p_patch->'decision') <> 'string'
       OR (p_patch->>'decision') NOT IN ('pending', 'include', 'exclude') THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid decision';
    END IF;
    v_decision := p_patch->>'decision';
  END IF;
  IF p_patch ? 'matchSignupId' THEN
    IF jsonb_typeof(p_patch->'matchSignupId') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'update_paper_scan_review_row: invalid signup match';
    END IF;
    IF jsonb_typeof(p_patch->'matchSignupId') <> 'null' THEN
      v_match_signup_id := (p_patch->>'matchSignupId')::uuid;
    END IF;
  END IF;

  IF v_match_signup_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.project_signups WHERE id=v_match_signup_id AND project_id=p_project_id
      AND schedule_id=v_batch.schedule_id AND status <> 'rejected'
  ) THEN RAISE EXCEPTION 'invalid signup match' USING ERRCODE='22023'; END IF;

  UPDATE public.project_paper_scan_rows AS rows
  SET name = CASE WHEN p_patch ? 'name' THEN v_name ELSE rows.name END,
      email = CASE WHEN p_patch ? 'email' THEN v_email ELSE rows.email END,
      phone = CASE WHEN p_patch ? 'phone' THEN v_phone ELSE rows.phone END,
      check_in_time = CASE WHEN p_patch ? 'checkInTime' THEN v_check_in_time ELSE rows.check_in_time END,
      check_out_time = CASE WHEN p_patch ? 'checkOutTime' THEN v_check_out_time ELSE rows.check_out_time END,
      signature_present = CASE WHEN p_patch ? 'signaturePresent' THEN v_signature_present ELSE rows.signature_present END,
      decision = CASE WHEN p_patch ? 'decision' THEN v_decision ELSE rows.decision END,
      match_signup_id = CASE WHEN p_patch ? 'matchSignupId' THEN v_match_signup_id ELSE rows.match_signup_id END,
      attendance_intervals = CASE WHEN p_patch ? 'attendanceIntervals' THEN p_patch->'attendanceIntervals'
        WHEN p_patch ?| ARRAY['checkInTime','checkOutTime'] THEN jsonb_build_array(jsonb_build_object(
          'checkIn',CASE WHEN p_patch ? 'checkInTime' THEN v_check_in_time ELSE rows.check_in_time END,
          'checkOut',CASE WHEN p_patch ? 'checkOutTime' THEN v_check_out_time ELSE rows.check_out_time END))
        ELSE rows.attendance_intervals END,
      review_acknowledged = CASE WHEN p_patch ? 'reviewAcknowledged' THEN (p_patch->>'reviewAcknowledged')::boolean WHEN v_changed THEN false ELSE rows.review_acknowledged END,
      identity_confirmed = CASE WHEN p_patch ? 'identityConfirmed' THEN (p_patch->>'identityConfirmed')::boolean WHEN p_patch ?| ARRAY['name','email','matchSignupId'] THEN false ELSE rows.identity_confirmed END,
      time_exception_reason = CASE WHEN p_patch ? 'timeExceptionReason' THEN NULLIF(btrim(p_patch->>'timeExceptionReason'),'') ELSE rows.time_exception_reason END,
      outcome = 'pending', outcome_detail = NULL, review_revision = rows.review_revision+1
  WHERE rows.id = p_row_id
    AND rows.batch_id = p_batch_id
    AND rows.project_id = p_project_id;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  RETURN 'updated';
END;
$$;

REVOKE ALL ON FUNCTION public.update_paper_scan_review_row(uuid, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_paper_scan_review_row(uuid, uuid, uuid, uuid, jsonb)
  TO service_role;


-- Reopened drafts retain saved attendance and its source evidence.
CREATE OR REPLACE FUNCTION public.discard_paper_scan_batch(
  p_batch_id uuid,
  p_project_id uuid,
  p_actor_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch public.project_paper_scan_batches%ROWTYPE;
BEGIN
  IF p_batch_id IS NULL OR p_project_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'discard_paper_scan_batch: invalid input';
  END IF;

  SELECT batches.*
  INTO v_batch
  FROM public.project_paper_scan_batches AS batches
  WHERE batches.id = p_batch_id
    AND batches.project_id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF NOT private.lock_attendance_management(v_batch.project_id, p_actor_id) THEN
    RAISE EXCEPTION 'discard_paper_scan_batch: actor is not a project organizer';
  END IF;

  -- commit_paper_signup_batch holds this same row lock for its entire
  -- transaction. After waiting for it, this branch observes committed and
  -- cannot overwrite the terminal state.
  IF v_batch.status = 'committed'
    OR EXISTS (SELECT 1 FROM public.project_paper_scan_rows
      WHERE batch_id=p_batch_id AND committed_signup_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.project_paper_roster_entries
      WHERE batch_id=p_batch_id AND project_id=p_project_id) THEN
    RETURN 'committed';
  END IF;

  IF v_batch.status NOT IN ('draft', 'extracting', 'review', 'failed', 'discarded') THEN
    RETURN 'unavailable';
  END IF;

  INSERT INTO public.paper_scan_storage_deletion_queue (bucket_id, object_path)
  SELECT images.bucket_id, images.object_path
  FROM public.project_paper_scan_images AS images
  WHERE images.batch_id = p_batch_id
    AND images.purged_at IS NULL
  ON CONFLICT (bucket_id, object_path) DO NOTHING;

  UPDATE public.project_paper_scan_images
  SET purged_at = now()
  WHERE batch_id = p_batch_id
    AND purged_at IS NULL;

  UPDATE public.project_paper_scan_batches
  SET status = 'discarded',
      extraction_claim_id = NULL
  WHERE id = p_batch_id;

  RETURN 'discarded';
END;
$$;

REVOKE ALL ON FUNCTION public.discard_paper_scan_batch(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.discard_paper_scan_batch(uuid, uuid, uuid)
  TO service_role;


CREATE FUNCTION public.create_manual_attendance_batch(p_project_id uuid,p_schedule_id text,p_actor_id uuid,p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_batch public.project_paper_scan_batches%ROWTYPE; v_id uuid;
BEGIN
  IF p_request_id IS NULL OR p_actor_id IS NULL OR NULLIF(btrim(p_schedule_id),'') IS NULL THEN RAISE EXCEPTION 'invalid manual attendance request' USING ERRCODE='22023'; END IF;
  PERFORM id FROM public.projects WHERE id=p_project_id FOR UPDATE;
  IF NOT FOUND OR NOT private.lock_attendance_management(p_project_id,p_actor_id) THEN RAISE EXCEPTION 'project permission denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_batch FROM public.project_paper_scan_batches WHERE creation_request_id=p_request_id;
  IF FOUND THEN
    IF v_batch.project_id<>p_project_id OR v_batch.schedule_id<>p_schedule_id OR v_batch.created_by<>p_actor_id THEN
      RAISE EXCEPTION 'manual attendance request key reused' USING ERRCODE='22023';
    END IF;
    RETURN v_batch.id;
  END IF;
  PERFORM 1 FROM private.resolve_project_schedule_slot(p_project_id,p_schedule_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid schedule' USING ERRCODE='22023'; END IF;
  INSERT INTO public.project_paper_scan_batches(project_id,schedule_id,created_by,status,input_method,image_count,creation_request_id)
  VALUES(p_project_id,p_schedule_id,p_actor_id,'review','manual',0,p_request_id) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_manual_attendance_batch(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_manual_attendance_batch(uuid,text,uuid,uuid) TO service_role;

CREATE FUNCTION public.add_paper_attendance_row(p_project_id uuid,p_batch_id uuid,p_actor_id uuid,p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_batch public.project_paper_scan_batches%ROWTYPE; v_row public.project_paper_scan_rows%ROWTYPE; v_id uuid; v_number integer;
BEGIN
  IF p_request_id IS NULL OR p_actor_id IS NULL THEN RAISE EXCEPTION 'invalid attendance row request' USING ERRCODE='22023'; END IF;
  SELECT * INTO STRICT v_batch FROM public.project_paper_scan_batches WHERE id=p_batch_id AND project_id=p_project_id FOR UPDATE;
  IF NOT private.lock_attendance_management(p_project_id,p_actor_id) THEN RAISE EXCEPTION 'project permission denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.project_paper_scan_rows WHERE creation_request_id=p_request_id;
  IF FOUND THEN
    IF v_row.batch_id<>p_batch_id OR v_row.project_id<>p_project_id THEN RAISE EXCEPTION 'attendance row request key reused' USING ERRCODE='22023'; END IF;
    RETURN v_row.id;
  END IF;
  IF v_batch.status<>'review' THEN RAISE EXCEPTION 'batch is not in review' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(max(sheet_row_number),0)+1 INTO v_number FROM public.project_paper_scan_rows WHERE batch_id=p_batch_id;
  IF v_number>300 THEN RAISE EXCEPTION 'batch row limit reached' USING ERRCODE='22023'; END IF;
  INSERT INTO public.project_paper_scan_rows(batch_id,project_id,sheet_row_number,raw_extraction,creation_request_id)
  VALUES(p_batch_id,p_project_id,v_number,jsonb_build_object('inputMethod','manual','recordedBy',p_actor_id),p_request_id) RETURNING id INTO v_id;
  UPDATE public.project_paper_scan_batches SET extracted_row_count=extracted_row_count+1 WHERE id=p_batch_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.add_paper_attendance_row(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.add_paper_attendance_row(uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.combine_paper_attendance_rows(p_project_id uuid,p_batch_id uuid,p_actor_id uuid,p_target_row_id uuid,p_source_row_ids uuid[],p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_batch public.project_paper_scan_batches%ROWTYPE; v_target public.project_paper_scan_rows%ROWTYPE;
  v_source public.project_paper_scan_rows%ROWTYPE; v_payload jsonb; v_prior jsonb; v_intervals jsonb;
BEGIN
  IF p_request_id IS NULL OR cardinality(p_source_row_ids) NOT BETWEEN 1 AND 49
    OR p_target_row_id=ANY(p_source_row_ids) OR array_position(p_source_row_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid attendance combine request' USING ERRCODE='22023';
  END IF;
  SELECT * INTO STRICT v_batch FROM public.project_paper_scan_batches WHERE id=p_batch_id AND project_id=p_project_id FOR UPDATE;
  IF NOT private.lock_attendance_management(p_project_id,p_actor_id) THEN RAISE EXCEPTION 'project permission denied' USING ERRCODE='42501'; END IF;
  v_payload:=jsonb_build_object('targetRowId',p_target_row_id,'sourceRowIds',to_jsonb(p_source_row_ids),'actorId',p_actor_id);
  SELECT payload INTO v_prior FROM private.paper_attendance_review_operations WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_prior<>v_payload THEN RAISE EXCEPTION 'combine request key reused' USING ERRCODE='22023'; END IF;
    RETURN p_target_row_id;
  END IF;
  IF v_batch.status<>'review' THEN RAISE EXCEPTION 'batch is not in review' USING ERRCODE='22023'; END IF;
  SELECT * INTO STRICT v_target FROM public.project_paper_scan_rows WHERE id=p_target_row_id AND batch_id=p_batch_id AND project_id=p_project_id FOR UPDATE;
  IF NOT v_target.identity_confirmed OR v_target.committed_signup_id IS NOT NULL OR v_target.outcome='roster_only'
    OR EXISTS (SELECT 1 FROM public.project_paper_roster_entries WHERE scan_row_id=v_target.id) THEN
    RAISE EXCEPTION 'confirm an uncommitted identity before combining' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(*) FROM public.project_paper_scan_rows WHERE id=ANY(p_source_row_ids) AND batch_id=p_batch_id AND project_id=p_project_id) <> cardinality(p_source_row_ids) THEN
    RAISE EXCEPTION 'invalid source rows' USING ERRCODE='22023';
  END IF;
  v_intervals:=v_target.attendance_intervals;
  IF v_intervals='[]'::jsonb THEN v_intervals:=jsonb_build_array(jsonb_build_object('checkIn',v_target.check_in_time,'checkOut',v_target.check_out_time)); END IF;
  FOR v_source IN SELECT * FROM public.project_paper_scan_rows WHERE id=ANY(p_source_row_ids) ORDER BY id FOR UPDATE LOOP
    IF NOT v_source.identity_confirmed OR v_source.committed_signup_id IS NOT NULL OR v_source.outcome='roster_only'
      OR EXISTS (SELECT 1 FROM public.project_paper_roster_entries WHERE scan_row_id=v_source.id)
      OR NOT ((v_target.match_signup_id IS NOT NULL AND v_target.match_signup_id=v_source.match_signup_id)
        OR (v_target.match_signup_id IS NULL AND v_source.match_signup_id IS NULL AND
          NULLIF(lower(btrim(v_target.email)),'') IS NOT NULL AND lower(btrim(v_target.email))=lower(btrim(v_source.email)))
        OR (v_target.match_signup_id IS NULL AND v_source.match_signup_id IS NULL AND
          NULLIF(btrim(v_target.email),'') IS NULL AND NULLIF(btrim(v_source.email),'') IS NULL AND
          NULLIF(lower(btrim(v_target.name)),'') IS NOT NULL AND lower(btrim(v_target.name))=lower(btrim(v_source.name)))) THEN
      RAISE EXCEPTION 'source rows must have the same confirmed identity' USING ERRCODE='22023';
    END IF;
    v_intervals:=v_intervals || CASE WHEN v_source.attendance_intervals='[]'::jsonb
      THEN jsonb_build_array(jsonb_build_object('checkIn',v_source.check_in_time,'checkOut',v_source.check_out_time)) ELSE v_source.attendance_intervals END;
  END LOOP;
  IF jsonb_array_length(v_intervals)>50 THEN RAISE EXCEPTION 'too many attendance intervals' USING ERRCODE='22023'; END IF;
  UPDATE public.project_paper_scan_rows SET attendance_intervals=v_intervals,review_acknowledged=false,review_revision=review_revision+1,
    outcome='pending',outcome_detail=NULL WHERE id=p_target_row_id;
  UPDATE public.project_paper_scan_rows SET decision='exclude',review_acknowledged=false,review_revision=review_revision+1,
    outcome='skipped',outcome_detail='combined_into:'||p_target_row_id::text WHERE id=ANY(p_source_row_ids);
  INSERT INTO private.paper_attendance_review_operations(request_id,project_id,batch_id,actor_id,operation,payload)
    VALUES(p_request_id,p_project_id,p_batch_id,p_actor_id,'combine',v_payload);
  RETURN p_target_row_id;
END;
$$;
REVOKE ALL ON FUNCTION public.combine_paper_attendance_rows(uuid,uuid,uuid,uuid,uuid[],uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.combine_paper_attendance_rows(uuid,uuid,uuid,uuid,uuid[],uuid) TO service_role;

ALTER TABLE public.project_paper_roster_entries ADD COLUMN attendance_intervals jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE private.paper_attendance_commit_receipts (
  request_id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES public.project_paper_scan_batches(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  row_ids uuid[] NOT NULL,
  allow_over_capacity boolean NOT NULL,
  results jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.paper_attendance_commit_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.paper_attendance_commit_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.paper_attendance_commit_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.commit_paper_signup_batch(
  p_batch_id uuid,p_actor_id uuid,p_row_ids uuid[],p_allow_over_capacity boolean DEFAULT false,p_idempotency_key uuid DEFAULT NULL
) RETURNS TABLE(row_id uuid,outcome text,signup_id uuid,anonymous_id uuid,user_id uuid,over_capacity boolean,detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_batch public.project_paper_scan_batches%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_row public.project_paper_scan_rows%ROWTYPE;
  v_existing public.project_signups%ROWTYPE;
  v_prior private.paper_attendance_commit_receipts%ROWTYPE;
  v_slot record;
  v_email text;
  v_intervals jsonb;
  v_first timestamptz;
  v_last timestamptz;
  v_candidates uuid[];
  v_profile_id uuid;
  v_anon_id uuid;
  v_signup_id uuid;
  v_active_count integer;
  v_over boolean;
  v_detail text;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF p_batch_id IS NULL OR p_actor_id IS NULL OR p_idempotency_key IS NULL OR p_row_ids IS NULL
    OR cardinality(p_row_ids) NOT BETWEEN 1 AND 1000 OR array_position(p_row_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: invalid input' USING ERRCODE='22023';
  END IF;
  SELECT * INTO STRICT v_batch FROM public.project_paper_scan_batches WHERE id=p_batch_id FOR UPDATE;
  SELECT * INTO STRICT v_project FROM public.projects WHERE id=v_batch.project_id FOR UPDATE;
  IF NOT private.lock_attendance_management(v_batch.project_id,p_actor_id) THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: actor is not a project organizer' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('app.paper_commit_actor_id',p_actor_id::text,true);
  SELECT * INTO v_prior FROM private.paper_attendance_commit_receipts WHERE request_id=p_idempotency_key;
  IF FOUND THEN
    IF v_prior.batch_id<>p_batch_id OR v_prior.actor_id<>p_actor_id OR v_prior.row_ids<>p_row_ids
      OR v_prior.allow_over_capacity IS DISTINCT FROM COALESCE(p_allow_over_capacity,false) THEN
      RAISE EXCEPTION 'paper commit request key reused' USING ERRCODE='22023';
    END IF;
    RETURN QUERY SELECT saved.row_id,saved.outcome,saved.signup_id,saved.anonymous_id,saved.user_id,saved.over_capacity,saved.detail
    FROM jsonb_to_recordset(v_prior.results) AS saved(row_id uuid,outcome text,signup_id uuid,anonymous_id uuid,user_id uuid,over_capacity boolean,detail text);
    RETURN;
  END IF;
  IF v_batch.status='committed' THEN
    RETURN QUERY SELECT rows.id,rows.outcome,rows.committed_signup_id,rows.committed_anonymous_id,signups.user_id,rows.over_capacity,rows.outcome_detail
      FROM public.project_paper_scan_rows rows LEFT JOIN public.project_signups signups ON signups.id=rows.committed_signup_id
      WHERE rows.batch_id=p_batch_id AND rows.id=ANY(p_row_ids);
    RETURN;
  END IF;
  IF v_batch.status<>'review' THEN RAISE EXCEPTION 'batch is not reviewable' USING ERRCODE='22023'; END IF;
  IF COALESCE(v_project.workflow_status,'published')<>'published' THEN RAISE EXCEPTION 'project is not published' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_slot FROM private.resolve_project_schedule_slot(v_batch.project_id,v_batch.schedule_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_schedule' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-project-signup:'||v_batch.project_id::text||':'||v_batch.schedule_id,0));
  UPDATE public.project_paper_scan_batches SET status='committing',commit_idempotency_key=p_idempotency_key WHERE id=p_batch_id;
  FOR v_row IN SELECT * FROM public.project_paper_scan_rows rows WHERE rows.batch_id=p_batch_id AND rows.id=ANY(p_row_ids)
    AND rows.decision='include' ORDER BY rows.sheet_row_number FOR UPDATE LOOP
    row_id:=v_row.id; signup_id:=NULL; anonymous_id:=NULL; user_id:=NULL; over_capacity:=false; detail:=NULL; outcome:='failed';
    BEGIN
      IF v_row.committed_signup_id IS NOT NULL OR v_row.outcome='roster_only' THEN
        outcome:=v_row.outcome; signup_id:=v_row.committed_signup_id; anonymous_id:=v_row.committed_anonymous_id;
        SELECT signups.user_id INTO user_id FROM public.project_signups signups WHERE signups.id=signup_id;
        over_capacity:=v_row.over_capacity; detail:=v_row.outcome_detail;
      ELSE
        IF NOT v_row.review_acknowledged THEN RAISE EXCEPTION 'review_required' USING ERRCODE='22023'; END IF;
        IF NOT v_row.identity_confirmed THEN RAISE EXCEPTION 'identity_confirmation_required' USING ERRCODE='22023'; END IF;
        v_intervals:=private.normalize_attendance_intervals(CASE WHEN v_row.attendance_intervals='[]'::jsonb
          THEN jsonb_build_array(jsonb_build_object('checkIn',v_row.check_in_time,'checkOut',v_row.check_out_time)) ELSE v_row.attendance_intervals END);
        PERFORM private.assert_attendance_not_future(v_intervals);
        v_first:=(v_intervals->0->>'checkIn')::timestamptz; v_last:=(v_intervals->-1->>'checkOut')::timestamptz;
        IF (v_first<v_slot.starts_at OR v_last>v_slot.ends_at) AND NULLIF(btrim(v_row.time_exception_reason),'') IS NULL THEN
          RAISE EXCEPTION 'outside_schedule_requires_reason' USING ERRCODE='22023';
        END IF;
        v_email:=NULLIF(lower(btrim(v_row.email)),''); v_profile_id:=NULL; v_anon_id:=NULL; v_signup_id:=NULL;
        v_existing:=NULL;
        IF v_row.match_signup_id IS NOT NULL THEN
          SELECT * INTO v_existing FROM public.project_signups WHERE id=v_row.match_signup_id AND project_id=v_batch.project_id
            AND schedule_id=v_batch.schedule_id AND status<>'rejected' FOR UPDATE;
          IF NOT FOUND THEN RAISE EXCEPTION 'invalid_signup_match' USING ERRCODE='22023'; END IF;
        ELSIF v_email IS NOT NULL THEN
          SELECT array_agg(DISTINCT candidate.id) INTO v_candidates FROM (
            SELECT accounts.id FROM auth.users accounts WHERE lower(accounts.email::text)=v_email AND accounts.email_confirmed_at IS NOT NULL
            UNION SELECT emails.user_id FROM public.user_emails emails WHERE lower(emails.email)=v_email AND emails.verified_at IS NOT NULL
          ) candidate;
          IF cardinality(v_candidates)>1 THEN RAISE EXCEPTION 'ambiguous_identity' USING ERRCODE='22023'; END IF;
          v_profile_id:=v_candidates[1];
          SELECT array_agg(DISTINCT signups.id) INTO v_candidates FROM public.project_signups signups
            LEFT JOIN public.anonymous_signups anonymous ON anonymous.id=signups.anonymous_id
            WHERE signups.project_id=v_batch.project_id AND signups.schedule_id=v_batch.schedule_id AND signups.status<>'rejected'
              AND (signups.user_id=v_profile_id OR lower(anonymous.email)=v_email);
          IF cardinality(v_candidates)>1 THEN RAISE EXCEPTION 'ambiguous_identity' USING ERRCODE='22023'; END IF;
          IF cardinality(v_candidates)=1 THEN SELECT * INTO v_existing FROM public.project_signups WHERE id=v_candidates[1] FOR UPDATE; END IF;
        END IF;
        IF v_existing.id IS NOT NULL THEN
          IF EXISTS(SELECT 1 FROM public.project_paper_scan_rows rows WHERE rows.committed_signup_id=v_existing.id) THEN
            RAISE EXCEPTION 'duplicate_attendance_requires_correction' USING ERRCODE='22023';
          END IF;
          IF EXISTS(SELECT 1 FROM public.certificates certificates WHERE certificates.signup_id=v_existing.id AND (certificates.type='verified' OR certificates.type IS NULL)
            AND (certificates.event_start IS DISTINCT FROM v_first OR certificates.event_end IS DISTINCT FROM v_last
              OR COALESCE(certificates.credited_minutes,round(extract(epoch FROM certificates.event_end-certificates.event_start)/60)::integer)
                IS DISTINCT FROM private.attendance_interval_minutes(v_intervals)
              OR v_intervals IS DISTINCT FROM COALESCE(NULLIF(private.signup_attendance_intervals(v_existing.id),'[]'::jsonb),
                private.normalize_attendance_intervals(jsonb_build_array(jsonb_build_object('checkIn',certificates.event_start,'checkOut',certificates.event_end))))))
            OR (v_existing.attendance_revision>0 AND private.signup_attendance_intervals(v_existing.id)<>v_intervals) THEN
            RAISE EXCEPTION 'published_attendance_requires_correction' USING ERRCODE='22023';
          END IF;
          v_signup_id:=v_existing.id; outcome:='signup_updated';
          anonymous_id:=v_existing.anonymous_id; user_id:=v_existing.user_id;
        ELSIF v_email IS NULL THEN
          IF NULLIF(btrim(v_row.name),'') IS NULL THEN RAISE EXCEPTION 'missing_name' USING ERRCODE='22023'; END IF;
          INSERT INTO public.project_paper_roster_entries(project_id,batch_id,scan_row_id,schedule_id,name,phone,check_in_time,check_out_time,signature_present,recorded_by,attendance_intervals)
            VALUES(v_batch.project_id,p_batch_id,v_row.id,v_batch.schedule_id,btrim(v_row.name),v_row.phone,v_first,v_last,v_row.signature_present,p_actor_id,v_intervals)
            ON CONFLICT(scan_row_id) WHERE scan_row_id IS NOT NULL DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,
              check_in_time=EXCLUDED.check_in_time,check_out_time=EXCLUDED.check_out_time,attendance_intervals=EXCLUDED.attendance_intervals,
              signature_present=EXCLUDED.signature_present,recorded_by=EXCLUDED.recorded_by;
          outcome:='roster_only';
        ELSE
          IF v_project.waiver_required THEN RAISE EXCEPTION 'waiver_required' USING ERRCODE='22023'; END IF;
          SELECT count(*) INTO v_active_count FROM public.project_signups signups WHERE signups.project_id=v_batch.project_id
            AND signups.schedule_id=v_batch.schedule_id AND signups.status IN ('approved','attended');
          v_over:=v_active_count>=v_slot.capacity;
          IF v_over AND NOT COALESCE(p_allow_over_capacity,false) THEN RAISE EXCEPTION 'slot_full' USING ERRCODE='22023'; END IF;
          IF v_profile_id IS NULL THEN
            IF NULLIF(btrim(v_row.name),'') IS NULL THEN RAISE EXCEPTION 'missing_name' USING ERRCODE='22023'; END IF;
            INSERT INTO public.anonymous_signups AS anonymous(project_id,email,name,phone_number,confirmed_at)
              VALUES(v_batch.project_id,v_email,btrim(v_row.name),v_row.phone,now())
              ON CONFLICT((lower(email)),project_id) DO UPDATE SET name=COALESCE(anonymous.name,EXCLUDED.name),confirmed_at=COALESCE(anonymous.confirmed_at,EXCLUDED.confirmed_at)
              RETURNING id INTO v_anon_id;
          END IF;
          -- Inserting attendance with blank times avoids late issuance from
          -- seeing a temporary first-to-last envelope.
          INSERT INTO public.project_signups(project_id,user_id,anonymous_id,schedule_id,status,source)
            VALUES(v_batch.project_id,v_profile_id,v_anon_id,v_batch.schedule_id,'attended',CASE WHEN v_batch.input_method='manual' THEN 'organizer_manual' ELSE 'paper_scan' END)
            RETURNING id INTO v_signup_id;
          outcome:='signup_created'; anonymous_id:=v_anon_id; user_id:=v_profile_id; over_capacity:=v_over;
        END IF;
        IF v_signup_id IS NOT NULL THEN
          PERFORM private.set_project_attendance_intervals(v_signup_id,v_intervals,v_row.time_exception_reason);
          UPDATE public.project_signups SET status='attended' WHERE id=v_signup_id;
          signup_id:=v_signup_id;
          DELETE FROM public.project_paper_roster_entries WHERE scan_row_id=v_row.id;
        END IF;
        UPDATE public.project_paper_scan_rows rows SET outcome=commit_paper_signup_batch.outcome,outcome_detail=NULL,
          committed_signup_id=commit_paper_signup_batch.signup_id,committed_anonymous_id=commit_paper_signup_batch.anonymous_id,
          over_capacity=commit_paper_signup_batch.over_capacity,attendance_intervals=v_intervals WHERE rows.id=v_row.id;
      END IF;
    EXCEPTION WHEN SQLSTATE '22023' OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
      GET STACKED DIAGNOSTICS v_detail=MESSAGE_TEXT;
      outcome:='failed'; signup_id:=NULL; anonymous_id:=NULL; user_id:=NULL; over_capacity:=false;
      detail:=CASE WHEN v_detail IN ('review_required','identity_confirmation_required','outside_schedule_requires_reason','invalid_signup_match',
        'ambiguous_identity','duplicate_attendance_requires_correction','published_attendance_requires_correction','missing_name','waiver_required','slot_full',
        'attendance_overlaps_another_session') THEN v_detail ELSE 'invalid_time_window' END;
      UPDATE public.project_paper_scan_rows rows SET outcome='failed',outcome_detail=commit_paper_signup_batch.detail WHERE rows.id=v_row.id;
    END;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('row_id',row_id,'outcome',outcome,'signup_id',signup_id,'anonymous_id',anonymous_id,'user_id',user_id,'over_capacity',over_capacity,'detail',detail));
    RETURN NEXT;
  END LOOP;
  UPDATE public.project_paper_scan_batches SET
    status=CASE WHEN EXISTS(SELECT 1 FROM public.project_paper_scan_rows rows WHERE rows.batch_id=p_batch_id AND rows.decision<>'exclude'
      AND rows.committed_signup_id IS NULL AND rows.outcome<>'roster_only') THEN 'review' ELSE 'committed' END,
    committed_at=now(),
    committed_row_count=(SELECT count(*) FROM public.project_paper_scan_rows rows WHERE rows.batch_id=p_batch_id AND rows.committed_signup_id IS NOT NULL),
    roster_row_count=(SELECT count(*) FROM public.project_paper_scan_rows rows WHERE rows.batch_id=p_batch_id AND rows.outcome='roster_only')
    WHERE id=p_batch_id;
  INSERT INTO private.paper_attendance_commit_receipts(request_id,batch_id,actor_id,row_ids,allow_over_capacity,results)
    VALUES(p_idempotency_key,p_batch_id,p_actor_id,p_row_ids,COALESCE(p_allow_over_capacity,false),v_results);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_paper_signup_batch(uuid,uuid,uuid[],boolean,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_paper_signup_batch(uuid,uuid,uuid[],boolean,uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.publish_volunteer_hours_transactional_legacy_status_fallback(
  p_actor_id uuid,
  p_project_id uuid,
  p_schedule_id text,
  p_entries jsonb,
  p_request_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := p_actor_id;
  v_entry jsonb;
  v_intervals jsonb;
  v_signup public.project_signups%ROWTYPE;
  v_exception_reason text;
  v_project public.projects%ROWTYPE;
  v_publish_key text;
  v_entries jsonb;
  v_entry_count integer;
  v_valid_count integer;
  v_request_hash text;
  v_receipt public.hours_publication_receipts%ROWTYPE;
  v_creator_name text;
  v_organization_name text;
  v_organization_verified boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  IF p_request_key IS NULL
    OR p_request_key !~ '^hours-publication:v1:[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid publication request key';
  END IF;

  IF pg_catalog.jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'publication entries must be an array';
  END IF;

  v_entry_count := pg_catalog.jsonb_array_length(p_entries);
  IF v_entry_count < 1 OR v_entry_count > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'publication entries must contain between 1 and 1000 signups';
  END IF;

  SELECT projects.*
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'project not found';
  END IF;

  IF v_project.creator_id <> v_actor_id THEN
    PERFORM members.user_id
    FROM public.organization_members AS members
    WHERE members.organization_id = v_project.organization_id
      AND members.user_id = v_actor_id
      AND COALESCE(members.status, 'active') = 'active'
      AND (
        members.role = 'admin'
        OR (
          members.role = 'staff'
          AND v_project.can_be_managed_by_staff IS TRUE
        )
      )
    FOR UPDATE OF members;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized to publish project hours';
    END IF;
  END IF;

  v_publish_key := private.project_hours_publish_key(
    v_project.event_type,
    v_project.schedule,
    p_schedule_id
  );
  IF v_publish_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'project session is not valid';
  END IF;

  BEGIN
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'signupId', (entry.value ->> 'signupId')::uuid,
        'checkIn', (entry.value ->> 'checkIn')::timestamptz,
        'checkOut', (entry.value ->> 'checkOut')::timestamptz
      ) || CASE WHEN entry.value ? 'intervals' THEN jsonb_build_object('intervals', private.normalize_attendance_intervals(entry.value->'intervals')) ELSE '{}'::jsonb END
        || CASE WHEN entry.value ? 'attendanceRevision' THEN jsonb_build_object('attendanceRevision',(entry.value->>'attendanceRevision')::integer) ELSE '{}'::jsonb END
        || CASE WHEN entry.value ? 'timeExceptionReason' THEN jsonb_build_object('timeExceptionReason',NULLIF(btrim(entry.value->>'timeExceptionReason'),'')) ELSE '{}'::jsonb END
      ORDER BY entry.value ->> 'signupId'
    )
    INTO v_entries
    FROM pg_catalog.jsonb_array_elements(p_entries) AS entry(value)
    WHERE pg_catalog.jsonb_typeof(entry.value) = 'object'
      AND entry.value ? 'signupId'
      AND entry.value ? 'checkIn'
      AND entry.value ? 'checkOut';
  EXCEPTION
    WHEN invalid_text_representation OR datetime_field_overflow THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'publication entries contain invalid identifiers or timestamps';
  END;

  IF v_entries IS NULL OR pg_catalog.jsonb_array_length(v_entries) <> v_entry_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'every publication entry requires a signup and two timestamps';
  END IF;

  IF (
    SELECT count(DISTINCT entry.value ->> 'signupId')
    FROM pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
  ) <> v_entry_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'a signup can appear only once in a publication';
  END IF;

  -- Lock every referenced signup in deterministic order before checking its
  -- project, status, session, or time range. Direct status changes therefore
  -- serialize with publication instead of racing certificate creation.
  PERFORM signups.id
  FROM pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
  JOIN public.project_signups AS signups
    ON signups.id = (entry.value ->> 'signupId')::uuid
  ORDER BY signups.id
  FOR UPDATE OF signups;

  v_request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'projectId', p_project_id,
          'publishKey', v_publish_key,
          'entries', v_entries
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT receipts.*
  INTO v_receipt
  FROM public.hours_publication_receipts AS receipts
  WHERE receipts.request_key = p_request_key;

  IF FOUND THEN
    IF v_receipt.project_id <> p_project_id
      OR v_receipt.publish_key <> v_publish_key
      OR v_receipt.request_hash <> v_request_hash
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'publication request key was already used for different input';
    END IF;
    RETURN private.hours_publication_result(v_receipt.id, 'replayed');
  END IF;

  SELECT receipts.*
  INTO v_receipt
  FROM public.hours_publication_receipts AS receipts
  WHERE receipts.project_id = p_project_id
    AND receipts.publish_key = v_publish_key;

  IF FOUND THEN
    IF v_receipt.request_hash <> v_request_hash THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'project session was already published with different hours';
    END IF;
    RETURN private.hours_publication_result(v_receipt.id, 'replayed');
  END IF;

  PERFORM private.assert_attendance_session_ended(p_project_id,p_schedule_id);

  SELECT count(*)
  INTO v_valid_count
  FROM pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
  JOIN public.project_signups AS signups
    ON signups.id = (entry.value ->> 'signupId')::uuid
  WHERE signups.project_id = p_project_id
    AND signups.status IN ('approved', 'attended')
    AND private.project_hours_publish_key(
      v_project.event_type,
      v_project.schedule,
      signups.schedule_id
    ) = v_publish_key
    AND (entry.value ->> 'checkOut')::timestamptz
      > (entry.value ->> 'checkIn')::timestamptz
    AND pg_catalog.round(
      extract(epoch FROM (
        (entry.value ->> 'checkOut')::timestamptz
          - (entry.value ->> 'checkIn')::timestamptz
      )) / 60
    ) > 0
    AND (entry.value ->> 'checkOut')::timestamptz
      <= (entry.value ->> 'checkIn')::timestamptz + interval '24 hours';

  IF v_valid_count <> v_entry_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'one or more signups, sessions, statuses, or time ranges are invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
    JOIN public.certificates AS certificates
      ON certificates.signup_id = (entry.value ->> 'signupId')::uuid
     AND certificates.type = 'verified'
    WHERE certificates.project_id IS DISTINCT FROM p_project_id
      OR certificates.event_start IS DISTINCT FROM (entry.value ->> 'checkIn')::timestamptz
      OR certificates.event_end IS DISTINCT FROM (entry.value ->> 'checkOut')::timestamptz
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'an existing verified certificate conflicts with the requested hours';
  END IF;

  IF EXISTS(SELECT 1 FROM public.certificates certificates JOIN jsonb_array_elements(v_entries) entry(value)
    ON certificates.signup_id=(entry.value->>'signupId')::uuid WHERE certificates.type IS NULL) THEN
    RAISE EXCEPTION 'platform award already exists; use the correction workflow' USING ERRCODE='23505';
  END IF;

  SELECT profiles.full_name
  INTO v_creator_name
  FROM public.profiles AS profiles
  WHERE profiles.id = v_project.creator_id;
  v_creator_name := COALESCE(NULLIF(v_creator_name, ''), 'Project Organizer');

  IF v_project.organization_id IS NOT NULL THEN
    SELECT organizations.name, COALESCE(organizations.verified, false)
    INTO v_organization_name, v_organization_verified
    FROM public.organizations AS organizations
    WHERE organizations.id = v_project.organization_id;
  END IF;

  INSERT INTO public.hours_publication_receipts (
    project_id,
    schedule_id,
    publish_key,
    request_key,
    request_hash,
    requested_by
  ) VALUES (
    p_project_id,
    v_publish_key,
    v_publish_key,
    p_request_key,
    v_request_hash,
    v_actor_id
  )
  RETURNING * INTO v_receipt;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_entries) LOOP
    SELECT * INTO STRICT v_signup FROM public.project_signups WHERE id=(v_entry->>'signupId')::uuid;
    IF v_entry ? 'attendanceRevision' AND (v_entry->>'attendanceRevision')::integer IS DISTINCT FROM v_signup.attendance_revision THEN
      RAISE EXCEPTION 'attendance changed; refresh before publishing' USING ERRCODE='40001';
    END IF;
    v_intervals:=private.signup_attendance_intervals(v_signup.id);
    v_exception_reason:=v_entry->>'timeExceptionReason';
    IF v_entry ? 'intervals' THEN
      v_intervals:=v_entry->'intervals';
    ELSIF v_intervals='[]'::jsonb THEN
      v_intervals:=private.normalize_attendance_intervals(jsonb_build_array(jsonb_build_object('checkIn',v_entry->'checkIn','checkOut',v_entry->'checkOut')));
    END IF;
    IF (v_intervals->0->>'checkIn')::timestamptz IS DISTINCT FROM (v_entry->>'checkIn')::timestamptz
      OR (v_intervals->-1->>'checkOut')::timestamptz IS DISTINCT FROM (v_entry->>'checkOut')::timestamptz THEN
      RAISE EXCEPTION 'attendance interval envelope does not match publication' USING ERRCODE='22023';
    END IF;
    -- A reviewed paper exception already has an actor-approved reason. Reuse
    -- that reason only when publication preserves those exact intervals.
    IF private.signup_attendance_intervals(v_signup.id)=v_intervals AND v_exception_reason IS NULL THEN
      SELECT rows.time_exception_reason INTO v_exception_reason FROM public.project_paper_scan_rows rows
        WHERE rows.committed_signup_id=v_signup.id AND rows.review_acknowledged;
      IF v_exception_reason IS NULL THEN
        SELECT changes.reason INTO v_exception_reason FROM private.project_attendance_changes changes
          WHERE changes.signup_id=v_signup.id AND changes.new_revision=v_signup.attendance_revision;
      END IF;
    END IF;
    PERFORM private.set_project_attendance_intervals(v_signup.id,v_intervals,v_exception_reason);
  END LOOP;

  UPDATE public.project_signups AS signups
  SET
    check_in_time = (entry.value ->> 'checkIn')::timestamptz,
    check_out_time = (entry.value ->> 'checkOut')::timestamptz
  FROM pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
  WHERE signups.id = (entry.value ->> 'signupId')::uuid;

  INSERT INTO public.certificates (
    project_id,
    user_id,
    signup_id,
    volunteer_name,
    volunteer_email,
    project_title,
    project_location,
    event_start,
    event_end,
    organization_name,
    creator_name,
    is_certified,
    creator_id,
    type,
    check_in_method,
    schedule_id
  )
  SELECT
    p_project_id,
    signups.user_id,
    signups.id,
    COALESCE(
      NULLIF(profiles.full_name, ''),
      NULLIF(anonymous_signups.name, ''),
      'No Name Volunteer'
    ),
    COALESCE(profiles.email::text, anonymous_signups.email),
    v_project.title,
    v_project.location,
    (entry.value ->> 'checkIn')::timestamptz,
    (entry.value ->> 'checkOut')::timestamptz,
    v_organization_name,
    v_creator_name,
    v_organization_verified,
    v_project.creator_id,
    'verified',
    v_project.verification_method,
    v_publish_key
  FROM pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
  JOIN public.project_signups AS signups
    ON signups.id = (entry.value ->> 'signupId')::uuid
  LEFT JOIN public.profiles AS profiles ON profiles.id = signups.user_id
  LEFT JOIN public.anonymous_signups
    ON anonymous_signups.id = signups.anonymous_id
  ON CONFLICT (signup_id)
    WHERE type = 'verified' AND signup_id IS NOT NULL
    DO NOTHING;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
    JOIN public.project_signups AS signups
      ON signups.id = (entry.value ->> 'signupId')::uuid
    JOIN public.certificates AS certificates
      ON certificates.signup_id = signups.id
     AND certificates.type = 'verified'
    LEFT JOIN public.profiles AS profiles ON profiles.id = signups.user_id
    LEFT JOIN public.anonymous_signups
      ON anonymous_signups.id = signups.anonymous_id
    WHERE certificates.project_id IS DISTINCT FROM p_project_id
      OR certificates.user_id IS DISTINCT FROM signups.user_id
      OR certificates.volunteer_name IS DISTINCT FROM COALESCE(
        NULLIF(profiles.full_name, ''),
        NULLIF(anonymous_signups.name, ''),
        'No Name Volunteer'
      )
      OR certificates.volunteer_email IS DISTINCT FROM
        COALESCE(profiles.email::text, anonymous_signups.email)
      OR certificates.project_title IS DISTINCT FROM v_project.title
      OR certificates.project_location IS DISTINCT FROM v_project.location
      OR certificates.event_start IS DISTINCT FROM
        (entry.value ->> 'checkIn')::timestamptz
      OR certificates.event_end IS DISTINCT FROM
        (entry.value ->> 'checkOut')::timestamptz
      OR certificates.organization_name IS DISTINCT FROM v_organization_name
      OR certificates.creator_name IS DISTINCT FROM v_creator_name
      OR certificates.is_certified IS DISTINCT FROM v_organization_verified
      OR certificates.creator_id IS DISTINCT FROM v_project.creator_id
      OR certificates.check_in_method IS DISTINCT FROM v_project.verification_method
      OR certificates.schedule_id IS DISTINCT FROM v_publish_key
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'an existing verified certificate conflicts with canonical publication data';
  END IF;

  IF (
    SELECT count(*)
    FROM public.certificates AS certificates
    JOIN pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
      ON certificates.signup_id = (entry.value ->> 'signupId')::uuid
    WHERE certificates.type = 'verified'
  ) <> v_entry_count THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'verified certificate creation was incomplete';
  END IF;

  INSERT INTO public.notifications (
    user_id,
    title,
    body,
    type,
    severity,
    action_url,
    displayed,
    read,
    dedupe_key
  )
  SELECT
    signups.user_id,
    'Your Volunteer Hours Have Been Published! 🎉',
    pg_catalog.format(
      'Your volunteer certificate for "%s" is now available. You volunteered for %s hours and %s minutes.',
      v_project.title,
      floor(
        COALESCE(certificates.credited_minutes, pg_catalog.round(
          extract(epoch FROM (certificates.event_end - certificates.event_start)) / 60
        )) / 60
      ),
      COALESCE(certificates.credited_minutes, pg_catalog.round(
        extract(epoch FROM (certificates.event_end - certificates.event_start)) / 60
      )::integer) % 60
    ),
    'project_updates',
    'success',
    '/certificates/' || certificates.id,
    false,
    false,
    'hours-publication:certificate:' || certificates.id
  FROM public.certificates AS certificates
  JOIN public.project_signups AS signups ON signups.id = certificates.signup_id
  JOIN pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
    ON certificates.signup_id = (entry.value ->> 'signupId')::uuid
  WHERE signups.user_id IS NOT NULL
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  INSERT INTO public.hours_publication_email_outbox (
    receipt_id,
    certificate_id,
    idempotency_key,
    state,
    settled_at,
    safe_code
  )
  SELECT
    v_receipt.id,
    certificates.id,
    'hours-publication:v1:certificate:' || certificates.id,
    CASE
      WHEN NULLIF(certificates.volunteer_email, '') IS NULL
        OR NULLIF(certificates.volunteer_name, '') IS NULL
      THEN 'skipped'
      ELSE 'queued'
    END,
    CASE
      WHEN NULLIF(certificates.volunteer_email, '') IS NULL
        OR NULLIF(certificates.volunteer_name, '') IS NULL
      THEN now()
      ELSE NULL
    END,
    CASE
      WHEN NULLIF(certificates.volunteer_email, '') IS NULL
        OR NULLIF(certificates.volunteer_name, '') IS NULL
      THEN 'recipient_missing'
      ELSE NULL
    END
  FROM public.certificates AS certificates
  JOIN pg_catalog.jsonb_array_elements(v_entries) AS entry(value)
    ON certificates.signup_id = (entry.value ->> 'signupId')::uuid
  WHERE certificates.type = 'verified'
  ON CONFLICT (certificate_id) DO NOTHING;

  UPDATE public.projects
  SET published = COALESCE(published, '{}'::jsonb)
    || pg_catalog.jsonb_build_object(v_publish_key, true)
  WHERE id = p_project_id;

  UPDATE public.hours_publication_receipts
  SET
    certificate_count = v_entry_count,
    email_work_count = (
      SELECT count(*)
      FROM public.hours_publication_email_outbox AS outbox
      WHERE outbox.receipt_id = v_receipt.id
    )
  WHERE id = v_receipt.id
  RETURNING * INTO v_receipt;

  RETURN private.hours_publication_result(v_receipt.id, 'accepted');
END;
$$;

REVOKE ALL ON FUNCTION private.publish_volunteer_hours_transactional_legacy_status_fallback(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.publish_volunteer_hours_transactional_legacy_status_fallback(uuid,uuid,text,jsonb,text) TO postgres;

CREATE OR REPLACE FUNCTION private.hours_publication_result(
  p_receipt_id uuid,
  p_outcome text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'outcome', p_outcome,
    'receiptId', receipts.id,
    'requestKey', receipts.request_key,
    'certificatesCreated', receipts.certificate_count,
    'projectTitle', projects.title,
    'projectTimezone', projects.project_timezone,
    'publicationOrigin', receipts.publication_origin,
    'deliveries', COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'deliveryId', outbox.id,
          'state', outbox.state,
          'payloadPrepared', outbox.payload_snapshot IS NOT NULL,
          'idempotencyKey', outbox.idempotency_key,
          'certificateId', certificates.id,
          'volunteerName', certificates.volunteer_name,
          'volunteerEmail', certificates.volunteer_email,
          'eventStart', certificates.event_start,
          'eventEnd', certificates.event_end,
          'creditedMinutes', certificates.credited_minutes,
          'attendanceRevision', certificates.attendance_revision
        ) ORDER BY certificates.signup_id
      ) FILTER (WHERE outbox.id IS NOT NULL),
      '[]'::jsonb
    )
  )
  FROM public.hours_publication_receipts AS receipts
  JOIN public.projects AS projects ON projects.id = receipts.project_id
  LEFT JOIN public.hours_publication_email_outbox AS outbox
    ON outbox.receipt_id = receipts.id
  LEFT JOIN public.certificates AS certificates
    ON certificates.id = outbox.certificate_id
  WHERE receipts.id = p_receipt_id
  GROUP BY receipts.id, projects.id;
$$;

REVOKE ALL ON FUNCTION private.hours_publication_result(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.hours_publication_result(uuid, text)
  TO postgres;


CREATE OR REPLACE VIEW public.certificate_verification_read_model
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
  p.username AS creator_username,
  c.credited_minutes,
  c.attendance_revision
FROM public.certificates c
LEFT JOIN public.profiles p ON p.id = c.creator_id;

COMMENT ON VIEW public.certificate_verification_read_model IS
  'Certificate verification read model. Excludes volunteer email and other private profile fields from public certificate rendering.';


CREATE OR REPLACE VIEW public.user_certificate_read_model
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
  p.project_timezone,
  c.credited_minutes,
  c.attendance_revision
FROM public.certificates c
LEFT JOIN public.projects p ON p.id = c.project_id;

COMMENT ON VIEW public.user_certificate_read_model IS
  'Authenticated user certificate list read model. Keeps certificate list joins stable while base-table exposure is reduced.';


CREATE OR REPLACE FUNCTION app_private.issue_verified_certificate_for_late_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_publish_key text;
  v_certificate_id uuid;
  v_receipt_id uuid;
  v_request_hash text;
  v_commit_actor_id uuid := NULLIF(
    pg_catalog.current_setting('app.paper_commit_actor_id', true),
    ''
  )::uuid;
BEGIN
  IF current_setting('app.attendance_correction',true) = 'on' THEN RETURN NEW; END IF;

  IF session_user <> 'postgres'
    AND COALESCE(auth.role()::text, '') <> 'service_role'
  THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'attended'
    OR NEW.check_in_time IS NULL
    OR NEW.check_out_time IS NULL
    OR NEW.check_out_time <= NEW.check_in_time
    OR NEW.check_out_time > NEW.check_in_time + interval '24 hours'
  THEN
    RETURN NEW;
  END IF;

  SELECT projects.*
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = NEW.project_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_publish_key := private.project_hours_publish_key(
    v_project.event_type,
    v_project.schedule,
    NEW.schedule_id
  );

  PERFORM private.assert_attendance_not_future(jsonb_build_array(jsonb_build_object('checkIn',NEW.check_in_time,'checkOut',NEW.check_out_time)));
  IF NOT EXISTS(SELECT 1 FROM private.resolve_project_schedule_slot(NEW.project_id,NEW.schedule_id) slot WHERE slot.ends_at<=clock_timestamp()) THEN
    RETURN NEW;
  END IF;

  IF v_publish_key IS NOT NULL
    AND COALESCE((v_project.published ->> v_publish_key)::boolean, false)
  THEN
    -- This executes inside the attendance write transaction. A paper batch
    -- cannot commit a late attendee to an already-published session without
    -- also committing that attendee's verified certificate.
    SELECT issued.id
    INTO v_certificate_id
    FROM public.issue_supplemental_verified_certificates(
      NEW.project_id,
      NEW.schedule_id,
      ARRAY[NEW.id],
      COALESCE(v_commit_actor_id, v_project.creator_id)
    ) AS issued;

    IF v_certificate_id IS NOT NULL THEN
      v_request_hash := pg_catalog.encode(
        extensions.digest(
          'late-certificate:' || v_certificate_id::text,
          'sha256'
        ),
        'hex'
      );

      INSERT INTO public.hours_publication_receipts (
        project_id,
        schedule_id,
        publish_key,
        request_key,
        request_hash,
        requested_by,
        certificate_count,
        email_work_count
      ) VALUES (
        NEW.project_id,
        NEW.schedule_id,
        v_publish_key,
        'hours-publication:v1:' || v_request_hash,
        v_request_hash,
        COALESCE(v_commit_actor_id, v_project.creator_id),
        0,
        0
      )
      ON CONFLICT (project_id, publish_key) DO UPDATE
        SET project_id = EXCLUDED.project_id
      RETURNING id INTO v_receipt_id;

      INSERT INTO public.hours_publication_email_outbox (
        receipt_id,
        certificate_id,
        idempotency_key,
        state,
        settled_at,
        safe_code
      )
      SELECT
        v_receipt_id,
        certificates.id,
        'hours-publication:v1:certificate:' || certificates.id,
        CASE
          WHEN NULLIF(certificates.volunteer_email, '') IS NULL
            OR NULLIF(certificates.volunteer_name, '') IS NULL
          THEN 'skipped'
          ELSE 'queued'
        END,
        CASE
          WHEN NULLIF(certificates.volunteer_email, '') IS NULL
            OR NULLIF(certificates.volunteer_name, '') IS NULL
          THEN now()
          ELSE NULL
        END,
        CASE
          WHEN NULLIF(certificates.volunteer_email, '') IS NULL
            OR NULLIF(certificates.volunteer_name, '') IS NULL
          THEN 'recipient_missing'
          ELSE NULL
        END
      FROM public.certificates AS certificates
      WHERE certificates.id = v_certificate_id
      ON CONFLICT (certificate_id) DO NOTHING;

      UPDATE public.hours_publication_receipts AS receipts
      SET
        certificate_count = (
          SELECT count(*)::integer
          FROM public.certificates AS certificates
          WHERE certificates.project_id = NEW.project_id
            AND certificates.schedule_id = NEW.schedule_id
            AND certificates.type = 'verified'
        ),
        email_work_count = (
          SELECT count(*)::integer
          FROM public.hours_publication_email_outbox AS outbox
          WHERE outbox.receipt_id = v_receipt_id
        )
      WHERE receipts.id = v_receipt_id;
    END IF;

    IF v_certificate_id IS NOT NULL AND NEW.user_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id,
        title,
        body,
        type,
        severity,
        action_url,
        displayed,
        read,
        dedupe_key
      ) VALUES (
        NEW.user_id,
        'Your Volunteer Hours Have Been Published! 🎉',
        pg_catalog.format(
          'Your volunteer certificate for "%s" is now available.',
          v_project.title
        ),
        'project_updates',
        'success',
        '/certificates/' || v_certificate_id,
        false,
        false,
        'hours-publication:certificate:' || v_certificate_id
      )
      ON CONFLICT (user_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL
        DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.issue_verified_certificate_for_late_attendance()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.issue_verified_certificate_for_late_attendance()
  TO postgres;


CREATE OR REPLACE FUNCTION public.purge_expired_paper_scan_batches(p_limit integer DEFAULT 50)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_batch_ids uuid[];
BEGIN
  SELECT COALESCE(array_agg(candidates.id),ARRAY[]::uuid[]) INTO v_batch_ids FROM (
    SELECT batches.id FROM public.project_paper_scan_batches batches
    WHERE EXISTS(SELECT 1 FROM public.project_paper_scan_images images WHERE images.batch_id=batches.id AND images.purged_at IS NULL)
      AND ((batches.status='committed' AND batches.committed_at<now()-interval '7 days')
        OR (batches.status<>'committed' AND batches.created_at<now()-interval '30 days')
        OR (batches.status='discarded' AND batches.updated_at<now()-interval '1 day'))
    ORDER BY batches.created_at LIMIT GREATEST(LEAST(COALESCE(p_limit,50),500),1) FOR UPDATE SKIP LOCKED
  ) candidates;
  IF cardinality(v_batch_ids)=0 THEN RETURN 0; END IF;
  INSERT INTO public.paper_scan_storage_deletion_queue(bucket_id,object_path)
    SELECT bucket_id,object_path FROM public.project_paper_scan_images WHERE batch_id=ANY(v_batch_ids) AND purged_at IS NULL
    ON CONFLICT(bucket_id,object_path) DO NOTHING;
  UPDATE public.project_paper_scan_images SET purged_at=now() WHERE batch_id=ANY(v_batch_ids) AND purged_at IS NULL;
  -- Retain structured review rows and lineage after source-photo expiry.
  RETURN cardinality(v_batch_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.purge_expired_paper_scan_batches(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_paper_scan_batches(integer) TO service_role;

CREATE FUNCTION public.record_project_attendance(p_signup_id uuid,p_expected_revision integer,p_reason text,p_intervals jsonb,p_request_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb; v_certificate_id uuid;
BEGIN
  v_result:=public.correct_project_attendance(p_signup_id,p_expected_revision,p_reason,p_intervals,p_request_id,p_actor_id);
  -- A first attendance record uses the existing late-publication transaction.
  -- Certificate uniqueness and the outbox dedupe key make retries harmless.
  IF v_result->>'outcome' <> 'replayed' THEN
    UPDATE public.project_signups SET status='attended' WHERE id=p_signup_id;
  END IF;
  SELECT id INTO v_certificate_id FROM public.certificates WHERE signup_id=p_signup_id AND (type='verified' OR type IS NULL);
  RETURN v_result || jsonb_build_object('certificateId',v_certificate_id);
END;
$$;
REVOKE ALL ON FUNCTION public.record_project_attendance(uuid,integer,text,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_project_attendance(uuid,integer,text,jsonb,uuid,uuid) TO service_role;
CREATE INDEX project_attendance_changes_project_idx ON private.project_attendance_changes(project_id);
CREATE INDEX project_attendance_changes_actor_idx ON private.project_attendance_changes(actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX paper_attendance_review_operations_project_idx ON private.paper_attendance_review_operations(project_id);
CREATE INDEX paper_attendance_review_operations_batch_idx ON private.paper_attendance_review_operations(batch_id);
CREATE INDEX paper_attendance_review_operations_actor_idx ON private.paper_attendance_review_operations(actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX paper_attendance_commit_receipts_batch_idx ON private.paper_attendance_commit_receipts(batch_id);

DROP FUNCTION public.issue_supplemental_verified_certificates(uuid,text,uuid[],uuid);
CREATE OR REPLACE FUNCTION public.issue_supplemental_verified_certificates(
  p_project_id uuid,
  p_schedule_id text,
  p_signup_ids uuid[],
  p_actor_id uuid
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  volunteer_name text,
  volunteer_email text,
  project_title text,
  event_start timestamptz,
  event_end timestamptz,
  credited_minutes integer,
  attendance_revision integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_project_id IS NULL
    OR p_actor_id IS NULL
    OR NULLIF(pg_catalog.btrim(p_schedule_id), '') IS NULL
    OR char_length(p_schedule_id) > 200
    OR p_signup_ids IS NULL
    OR cardinality(p_signup_ids) < 1
    OR cardinality(p_signup_ids) > 500
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid supplemental certificate request';
  END IF;

  IF NOT private.lock_attendance_management(p_project_id,p_actor_id) THEN
    RAISE EXCEPTION 'not authorized to issue certificates' USING ERRCODE='42501';
  END IF;

  PERFORM private.assert_attendance_session_ended(p_project_id,p_schedule_id);

  RETURN QUERY
  INSERT INTO public.certificates AS inserted_certificates (
    project_id,
    user_id,
    signup_id,
    volunteer_name,
    volunteer_email,
    project_title,
    project_location,
    event_start,
    event_end,
    organization_name,
    creator_name,
    is_certified,
    creator_id,
    type,
    check_in_method,
    schedule_id
  )
  SELECT
    projects.id,
    signups.user_id,
    signups.id,
    COALESCE(
      NULLIF(volunteer_profiles.full_name, ''),
      NULLIF(anonymous_signups.name, ''),
      'No Name Volunteer'
    ),
    COALESCE(volunteer_profiles.email::text, anonymous_signups.email),
    projects.title,
    projects.location,
    signups.check_in_time,
    signups.check_out_time,
    organizations.name,
    COALESCE(NULLIF(creator_profiles.full_name, ''), 'Project Organizer'),
    COALESCE(organizations.verified, false),
    p_actor_id,
    'verified',
    projects.verification_method,
    p_schedule_id
  FROM public.project_signups AS signups
  JOIN public.projects AS projects
    ON projects.id = signups.project_id
  LEFT JOIN public.profiles AS volunteer_profiles
    ON volunteer_profiles.id = signups.user_id
  LEFT JOIN public.anonymous_signups
    ON anonymous_signups.id = signups.anonymous_id
  LEFT JOIN public.profiles AS creator_profiles
    ON creator_profiles.id = projects.creator_id
  LEFT JOIN public.organizations
    ON organizations.id = projects.organization_id
  WHERE signups.id = ANY (p_signup_ids)
    AND signups.project_id = p_project_id
    AND private.project_hours_publish_key(projects.event_type,projects.schedule,signups.schedule_id)
      = private.project_hours_publish_key(projects.event_type,projects.schedule,p_schedule_id)
    AND signups.status = 'attended'
    AND signups.check_in_time IS NOT NULL
    AND signups.check_out_time IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.certificates existing WHERE existing.signup_id=signups.id AND (existing.type='verified' OR existing.type IS NULL))
  ON CONFLICT (signup_id)
    WHERE type = 'verified' AND signup_id IS NOT NULL
    DO NOTHING
  RETURNING
    inserted_certificates.id,
    inserted_certificates.user_id,
    inserted_certificates.volunteer_name,
    inserted_certificates.volunteer_email,
    inserted_certificates.project_title,
    inserted_certificates.event_start,
    inserted_certificates.event_end,
    inserted_certificates.credited_minutes,
    inserted_certificates.attendance_revision;
END;
$$;


REVOKE ALL ON FUNCTION public.issue_supplemental_verified_certificates(uuid,text,uuid[],uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_supplemental_verified_certificates(uuid,text,uuid[],uuid) TO service_role;
CREATE OR REPLACE FUNCTION app_private.guard_hours_publication_completeness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_publish_key text;
BEGIN
  FOR v_publish_key IN
    SELECT published.key
    FROM pg_catalog.jsonb_each_text(COALESCE(NEW.published, '{}'::jsonb)) AS published(key, value)
    WHERE published.value = 'true'
      AND COALESCE(OLD.published ->> published.key, 'false') <> 'true'
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.project_signups AS signups
      LEFT JOIN public.certificates AS certificates
        ON certificates.signup_id = signups.id
       AND (certificates.type = 'verified' OR certificates.type IS NULL)
      WHERE signups.project_id = NEW.id
        AND signups.status = 'attended'
        AND signups.check_in_time IS NOT NULL
        AND signups.check_out_time IS NOT NULL
        AND signups.check_out_time > signups.check_in_time
        AND signups.check_out_time <= signups.check_in_time + interval '24 hours'
        AND private.project_hours_publish_key(
          NEW.event_type,
          NEW.schedule,
          signups.schedule_id
        ) = v_publish_key
        AND certificates.id IS NULL
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'publication snapshot is stale; refresh attendance before publishing';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.guard_hours_publication_completeness()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.guard_hours_publication_completeness()
  TO postgres;


COMMIT;
