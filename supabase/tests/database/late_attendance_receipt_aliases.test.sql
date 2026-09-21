BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('bc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','late-receipt-'||n||'@local.test',now(),'{}',jsonb_build_object('username','late_receipt_'||n,'full_name','Receipt volunteer '||n),now(),now() FROM generate_series(1,5) n;
CREATE TEMP TABLE receipt_alias_cases(id integer,event_type text,canonical_id text,late_id text,other_id text);
INSERT INTO receipt_alias_cases VALUES
 (1,'multiDay','2020-09-18-0','2020-09-18-0-0','2020-09-18-1'),
 (2,'multiDay','2020-09-18-0','day-0-slot-0','2020-09-18-1'),
 (3,'multiDay','2020-09-18-0','0-0','2020-09-18-1'),
 (4,'oneTime','oneTime','0',NULL),(5,'oneTime','oneTime','default',NULL),
 (6,'sameDayMultiArea','Morning','role-0','Afternoon');
CREATE FUNCTION pg_temp.receipt_snapshot(p_project uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.hours_publication_receipts r WHERE r.project_id=p_project),
  'certificates',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.certificates c WHERE c.project_id=p_project),
  'deliveries',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.hours_publication_email_outbox o JOIN public.hours_publication_receipts r ON r.id=o.receipt_id WHERE r.project_id=p_project));
$$;
CREATE FUNCTION pg_temp.exercise_receipt_aliases() RETURNS SETOF text LANGUAGE plpgsql AS $$
#variable_conflict use_variable
DECLARE c receipt_alias_cases%ROWTYPE; p uuid; s1 uuid; s2 uuid; late uuid; other uuid; actor uuid:='bc100000-0000-4000-8000-000000000001';
 schedule jsonb; entries jsonb; request text; result jsonb; initial_awards jsonb; receipt uuid; other_receipt uuid; late_request uuid; snapshot jsonb;
 visits jsonb:='[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]';
BEGIN
 FOR c IN SELECT * FROM receipt_alias_cases ORDER BY id LOOP
  p:=gen_random_uuid();s1:=gen_random_uuid();s2:=gen_random_uuid();late:=gen_random_uuid();other:=gen_random_uuid();late_request:=gen_random_uuid();
  request:='hours-publication:v1:'||repeat(lpad(c.id::text,2,'0'),32);
  schedule:=CASE c.event_type
   WHEN 'oneTime' THEN '{"oneTime":{"date":"2020-09-18","startTime":"09:00","endTime":"12:00","volunteers":10}}'::jsonb
   WHEN 'multiDay' THEN '{"multiDay":[{"date":"2020-09-18","slots":[{"startTime":"09:00","endTime":"12:00","volunteers":10},{"startTime":"12:00","endTime":"15:00","volunteers":10}]}]}'::jsonb
   ELSE '{"sameDayMultiArea":{"date":"2020-09-18","roles":[{"name":"Morning","startTime":"09:00","endTime":"12:00","volunteers":10},{"name":"Afternoon","startTime":"12:00","endTime":"15:00","volunteers":10}]}}'::jsonb END;
  INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone)
  VALUES(p,actor,'Late receipt alias fixture','Local','Synthetic late publication counts',c.event_type,'manual',schedule,'upcoming','UTC');
  INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES
   (s1,p,'bc100000-0000-4000-8000-000000000002',c.canonical_id,'approved'),
   (s2,p,'bc100000-0000-4000-8000-000000000003',c.canonical_id,'approved');
  entries:=jsonb_build_array(jsonb_build_object('signupId',s1,'checkIn','2020-09-18T09:00:00Z','checkOut','2020-09-18T10:00:00Z','attendanceRevision',0),jsonb_build_object('signupId',s2,'checkIn','2020-09-18T09:00:00Z','checkOut','2020-09-18T10:00:00Z','attendanceRevision',0));
  result:=public.publish_volunteer_hours_transactional(actor,p,c.canonical_id,entries,request);
  RETURN NEXT extensions.is(result->>'outcome','accepted','alias '||c.id||': normal initial publication succeeds');
  SELECT id INTO receipt FROM public.hours_publication_receipts WHERE project_id=p AND publish_key=c.canonical_id;
  RETURN NEXT extensions.is((SELECT certificate_count FROM public.hours_publication_receipts WHERE id=receipt),2,'alias '||c.id||': initial receipt counts two awards');
  SELECT jsonb_agg(to_jsonb(cert) ORDER BY cert.id) INTO initial_awards FROM public.certificates cert WHERE signup_id IN(s1,s2);
  RETURN NEXT extensions.is((SELECT count(*)::integer FROM public.certificates WHERE signup_id IN(s1,s2) AND schedule_id=c.canonical_id),2,'alias '||c.id||': initial certificates store the canonical key');
  IF c.other_id IS NOT NULL THEN
   INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES(other,p,'bc100000-0000-4000-8000-000000000005',c.other_id,'approved');
   PERFORM public.publish_volunteer_hours_transactional(actor,p,c.other_id,jsonb_build_array(jsonb_build_object('signupId',other,'checkIn','2020-09-18T12:00:00Z','checkOut','2020-09-18T13:00:00Z','attendanceRevision',0)),'hours-publication:v1:'||repeat(lpad((c.id+10)::text,2,'0'),32));
   SELECT id INTO other_receipt FROM public.hours_publication_receipts WHERE project_id=p AND publish_key=c.other_id;
  END IF;
  INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES(late,p,'bc100000-0000-4000-8000-000000000004',c.late_id,'approved');
  result:=public.record_project_attendance(late,0,'Reviewed late paper attendance',visits,late_request,actor);
  RETURN NEXT extensions.ok(result->>'certificateId' IS NOT NULL,'alias '||c.id||': late reviewed attendance publishes its award');
  RETURN NEXT extensions.is((SELECT schedule_id FROM public.certificates WHERE signup_id=late),c.late_id,'alias '||c.id||': late certificate keeps the original session reference');
  RETURN NEXT extensions.is((SELECT certificate_count FROM public.hours_publication_receipts WHERE id=receipt),3,'alias '||c.id||': shared receipt counts both canonical and late alias certificates');
  RETURN NEXT extensions.is((SELECT email_work_count FROM public.hours_publication_receipts WHERE id=receipt),3,'alias '||c.id||': shared receipt counts three delivery items');
  RETURN NEXT extensions.is((SELECT count(DISTINCT certificate_id)::integer FROM public.hours_publication_email_outbox WHERE receipt_id=receipt),3,'alias '||c.id||': all three awards have one delivery each');
  RETURN NEXT extensions.is((SELECT jsonb_agg(to_jsonb(cert) ORDER BY cert.id) FROM public.certificates cert WHERE signup_id IN(s1,s2)),initial_awards,'alias '||c.id||': late publication preserves original certificate snapshots');
  IF c.other_id IS NOT NULL THEN
   RETURN NEXT extensions.ok((SELECT certificate_count=1 AND email_work_count=1 FROM public.hours_publication_receipts WHERE id=other_receipt),'alias '||c.id||': another session retains its separate award and delivery count');
   RETURN NEXT extensions.ok(NOT EXISTS(SELECT 1 FROM public.hours_publication_email_outbox o JOIN public.certificates cert ON cert.id=o.certificate_id WHERE o.receipt_id=receipt AND cert.signup_id=other),'alias '||c.id||': other-session award is excluded from this receipt');
  END IF;
  snapshot:=pg_temp.receipt_snapshot(p);
  RETURN NEXT extensions.is(public.record_project_attendance(late,0,'Reviewed late paper attendance',visits,late_request,actor)->>'outcome','replayed','alias '||c.id||': late attendance retry replays');
  result:=public.publish_volunteer_hours_transactional(actor,p,c.canonical_id,entries,request);
  RETURN NEXT extensions.is(result->>'certificatesCreated','3','alias '||c.id||': publication retry reports the complete durable count');
  RETURN NEXT extensions.is(pg_temp.receipt_snapshot(p),snapshot,'alias '||c.id||': retries change no receipt, award, or delivery');
 END LOOP;
END; $$;
SELECT * FROM pg_temp.exercise_receipt_aliases();
SELECT * FROM extensions.finish();
ROLLBACK;
