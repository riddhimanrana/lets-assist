BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('ca100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','certificate-consistency-'||n||'@local.test',now(),'{}',jsonb_build_object('username','certificate_consistency_'||n,'full_name','Certificate volunteer '||n),now(),now() FROM generate_series(1,4) n;
CREATE TEMP TABLE certificate_cases(id integer,label text,prior_intervals jsonb,reviewed_intervals jsonb,minutes integer,revision integer,accepted boolean);
INSERT INTO certificate_cases VALUES
 (1,'canonical stale minutes',NULL,'[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"},{"checkIn":"2020-09-18T12:00:00Z","checkOut":"2020-09-18T13:00:00Z"}]',240,1,false),
 (2,'same total with changed canonical intervals','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"},{"checkIn":"2020-09-18T12:00:00Z","checkOut":"2020-09-18T13:00:00Z"}]','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:30:00Z"},{"checkIn":"2020-09-18T12:30:00Z","checkOut":"2020-09-18T13:00:00Z"}]',120,1,false),
 (3,'unchanged intervals with stale certificate revision','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"},{"checkIn":"2020-09-18T12:00:00Z","checkOut":"2020-09-18T13:00:00Z"}]','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"},{"checkIn":"2020-09-18T12:00:00Z","checkOut":"2020-09-18T13:00:00Z"}]',120,0,false),
 (4,'legacy envelope excludes a reviewed break',NULL,'[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"},{"checkIn":"2020-09-18T12:00:00Z","checkOut":"2020-09-18T13:00:00Z"}]',NULL,0,false),
 (5,'fractional legacy duration cannot be rounded into an award',NULL,'[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:30Z"}]',NULL,0,false),
 (6,'matching legacy single interval',NULL,'[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]',NULL,0,true),
 (7,'matching canonical split intervals','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"},{"checkIn":"2020-09-18T12:00:00Z","checkOut":"2020-09-18T13:00:00Z"}]','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"},{"checkIn":"2020-09-18T12:00:00Z","checkOut":"2020-09-18T13:00:00Z"}]',120,1,true),
 (8,'certificate revision cannot jump ahead of the saved attendance','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"},{"checkIn":"2020-09-18T12:00:00Z","checkOut":"2020-09-18T13:00:00Z"}]','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:30:00Z"},{"checkIn":"2020-09-18T12:30:00Z","checkOut":"2020-09-18T13:00:00Z"}]',120,2,false);
CREATE FUNCTION pg_temp.consistency_snapshot(p_project uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'project',(SELECT to_jsonb(p) FROM public.projects p WHERE p.id=p_project),
  'signups',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.project_signups s WHERE s.project_id=p_project),
  'intervals',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.project_attendance_intervals i WHERE i.project_id=p_project),
  'certificates',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.certificates c WHERE c.project_id=p_project),
  'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.hours_publication_receipts r WHERE r.project_id=p_project),
  'outbox',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.hours_publication_email_outbox o JOIN public.certificates c ON c.id=o.certificate_id WHERE c.project_id=p_project),
  'notifications',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.id) FROM public.notifications n WHERE n.action_url IN(SELECT '/certificates/'||c.id FROM public.certificates c WHERE c.project_id=p_project)));
$$;
CREATE FUNCTION pg_temp.exercise_certificate_consistency() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE c certificate_cases%ROWTYPE; p uuid; s uuid; before_signup uuid; after_signup uuid; actor uuid:='ca100000-0000-4000-8000-000000000001';
 entries jsonb; request text; result jsonb; snapshot jsonb; award jsonb; revision integer; error_state text; error_message text; visits jsonb;
BEGIN
 FOR c IN SELECT * FROM certificate_cases ORDER BY id LOOP
  p:=gen_random_uuid();s:=('ca200000-0000-4000-8000-'||lpad((c.id*10+2)::text,12,'0'))::uuid;
  before_signup:=('ca200000-0000-4000-8000-'||lpad((c.id*10+1)::text,12,'0'))::uuid;
  after_signup:=('ca200000-0000-4000-8000-'||lpad((c.id*10+3)::text,12,'0'))::uuid;
  visits:=private.normalize_attendance_intervals(c.reviewed_intervals);
  request:='hours-publication:v1:'||repeat(lpad(c.id::text,2,'0'),32);
  INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone)
   VALUES(p,actor,'Certificate consistency fixture','Local','Synthetic publication checks','oneTime','manual','{"oneTime":{"date":"2020-09-18","startTime":"09:00","endTime":"15:00","volunteers":10}}','upcoming','UTC');
  INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES
   (before_signup,p,'ca100000-0000-4000-8000-000000000002','oneTime','approved'),
   (s,p,'ca100000-0000-4000-8000-000000000003','oneTime','approved'),
   (after_signup,p,'ca100000-0000-4000-8000-000000000004','oneTime','approved');
  IF c.prior_intervals IS NOT NULL THEN PERFORM private.set_project_attendance_intervals(s,c.prior_intervals); END IF;
  INSERT INTO public.certificates(project_id,user_id,signup_id,volunteer_name,volunteer_email,project_title,project_location,event_start,event_end,organization_name,creator_name,is_certified,creator_id,type,check_in_method,schedule_id)
   SELECT p,v.id,s,v.full_name,v.email,'Certificate consistency fixture','Local',(visits->0->>'checkIn')::timestamptz,(visits->-1->>'checkOut')::timestamptz,NULL,owner.full_name,false,actor,'verified','manual','oneTime'
   FROM public.profiles v CROSS JOIN public.profiles owner WHERE v.id='ca100000-0000-4000-8000-000000000003' AND owner.id=actor;
  -- Seed historical or stale snapshots without the new-certificate stamp.
  UPDATE public.certificates SET credited_minutes=c.minutes,attendance_revision=c.revision WHERE signup_id=s;
  SELECT to_jsonb(cert) INTO award FROM public.certificates cert WHERE signup_id=s;
  SELECT attendance_revision INTO revision FROM public.project_signups WHERE id=s;
  entries:=jsonb_build_array(
   jsonb_build_object('signupId',before_signup,'checkIn','2020-09-18T09:00:00Z','checkOut','2020-09-18T10:00:00Z','attendanceRevision',0),
   jsonb_build_object('signupId',s,'checkIn',visits->0->>'checkIn','checkOut',visits->-1->>'checkOut','intervals',visits,'attendanceRevision',revision),
   jsonb_build_object('signupId',after_signup,'checkIn','2020-09-18T09:00:00Z','checkOut','2020-09-18T10:00:00Z','attendanceRevision',0));
  snapshot:=pg_temp.consistency_snapshot(p);
  error_state:=NULL;error_message:=NULL;
  BEGIN result:=public.publish_volunteer_hours_transactional(actor,p,'oneTime',entries,request);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS error_state=RETURNED_SQLSTATE,error_message=MESSAGE_TEXT;
  END;
  IF NOT c.accepted THEN
   RETURN NEXT extensions.is(error_state,'23505',c.label||': publication rejects conflicting award');
   RETURN NEXT extensions.is(error_message,'existing certificate attendance differs; use the correction workflow',c.label||': rejection gives correction guidance');
   RETURN NEXT extensions.is(pg_temp.consistency_snapshot(p),snapshot,c.label||': rejection rolls back all project, signup, interval, award, receipt and delivery writes');
   RETURN NEXT extensions.is((SELECT count(*)::integer FROM public.hours_publication_receipts WHERE project_id=p),0,c.label||': no publication receipt');
   RETURN NEXT extensions.is((SELECT count(*)::integer FROM public.hours_publication_email_outbox o JOIN public.certificates cert ON cert.id=o.certificate_id WHERE cert.project_id=p),0,c.label||': no delivery work');
   RETURN NEXT extensions.ok(NOT EXISTS(SELECT 1 FROM public.project_attendance_intervals WHERE signup_id IN(before_signup,after_signup)),c.label||': other valid rows do not partially save');
   RETURN NEXT extensions.is((SELECT to_jsonb(cert) FROM public.certificates cert WHERE signup_id=s),award,c.label||': historical award stays byte-for-byte unchanged');
   IF c.id=1 THEN
    UPDATE public.project_signups SET status='attended' WHERE id=s;
    snapshot:=pg_temp.consistency_snapshot(p);
    RETURN NEXT extensions.is((SELECT count(*)::integer FROM public.issue_supplemental_verified_certificates(p,'oneTime',ARRAY[s],actor)),0,'supplemental issuance skips the existing award');
    RETURN NEXT extensions.is(pg_temp.consistency_snapshot(p),snapshot,'supplemental retry neither adopts nor rewrites the conflicting award');
    result:=public.correct_project_attendance(s,revision,'Reconcile the reviewed break',visits,gen_random_uuid(),actor);
    RETURN NEXT extensions.is(result->>'creditedMinutes','120','explicit correction repairs the existing award');
    RETURN NEXT extensions.is((SELECT id::text FROM public.certificates WHERE signup_id=s),award->>'id','explicit correction retains the historical certificate URL');
    RETURN NEXT extensions.is((SELECT count(*)::integer FROM public.hours_publication_email_outbox o JOIN public.certificates cert ON cert.id=o.certificate_id WHERE cert.project_id=p),0,'correction does not queue delivery');
    entries:=jsonb_set(entries,'{1,attendanceRevision}',result->'attendanceRevision');
    RETURN NEXT extensions.is(public.publish_volunteer_hours_transactional(actor,p,'oneTime',entries,request)->>'outcome','accepted','corrected canonical award can subsequently publish');
    RETURN NEXT extensions.is((SELECT count(*)::integer FROM public.certificates WHERE project_id=p),3,'repair and publication retain one award per participant');
   END IF;
  ELSE
   RETURN NEXT extensions.is(error_state,NULL::text,c.label||': publication has no error');
   RETURN NEXT extensions.is(result->>'outcome','accepted',c.label||': matching award is accepted');
   RETURN NEXT extensions.is((SELECT to_jsonb(cert) FROM public.certificates cert WHERE signup_id=s),award,c.label||': accepted historical snapshot remains unchanged');
   RETURN NEXT extensions.is((SELECT count(*)::integer FROM public.certificates WHERE project_id=p),3,c.label||': exactly one award per participant');
   RETURN NEXT extensions.is((SELECT count(*)::integer FROM public.hours_publication_email_outbox o JOIN public.certificates cert ON cert.id=o.certificate_id WHERE cert.project_id=p),3,c.label||': one initial delivery per participant');
   snapshot:=pg_temp.consistency_snapshot(p);
   RETURN NEXT extensions.is(public.publish_volunteer_hours_transactional(actor,p,'oneTime',entries,request)->>'outcome','replayed',c.label||': original request replays');
   RETURN NEXT extensions.is(pg_temp.consistency_snapshot(p),snapshot,c.label||': retry changes nothing');
   PERFORM public.correct_project_attendance(s,(SELECT attendance_revision FROM public.project_signups WHERE id=s),'Reviewed corrected visit','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T09:30:00Z"}]',gen_random_uuid(),actor);
   snapshot:=pg_temp.consistency_snapshot(p);
   RETURN NEXT extensions.is(public.publish_volunteer_hours_transactional(actor,p,'oneTime',entries,request)->>'outcome','replayed',c.label||': durable original request still replays after an audited correction');
   RETURN NEXT extensions.is(pg_temp.consistency_snapshot(p),snapshot,c.label||': old retry cannot overwrite corrected credit or queue another delivery');
  END IF;
 END LOOP;
END;
$$;
SELECT * FROM pg_temp.exercise_certificate_consistency();
SELECT * FROM extensions.finish();
ROLLBACK;
