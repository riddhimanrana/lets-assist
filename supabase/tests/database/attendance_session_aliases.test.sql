BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('ba100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','session-alias-'||n||'@local.test',now(),'{}',jsonb_build_object('username','session_alias_'||n),now(),now() FROM generate_series(1,3) n;
CREATE TEMP TABLE alias_cases(id integer,event_type text,stored_id text,batch_id text,canonical_id text,email_match boolean);
INSERT INTO alias_cases VALUES
 (1,'oneTime','0','oneTime','oneTime',false),(2,'oneTime','default','0','oneTime',true),
 (3,'multiDay','day-0-slot-0','2020-09-18-0','2020-09-18-0',false),(4,'multiDay','0-0','day-0-slot-0','2020-09-18-0',true),
 (5,'multiDay','2020-09-18-0-0','0-0','2020-09-18-0',false),(6,'multiDay','2020-09-18-0','day-0-slot-0','2020-09-18-0',true),
 (7,'sameDayMultiArea','role-0','Morning','Morning',false),(8,'sameDayMultiArea','Morning','role-0','Morning',true);
CREATE TEMP TABLE alias_fixtures(id integer,project uuid,signup uuid,batch uuid,row_id uuid);
CREATE FUNCTION pg_temp.exercise_aliases() RETURNS SETOF text LANGUAGE plpgsql AS $$
#variable_conflict use_variable
DECLARE c alias_cases%ROWTYPE; project_id uuid; signup_id uuid; batch_id uuid; row_id uuid; sheet_id uuid; request_id uuid; result record; schedule jsonb;
BEGIN
 FOR c IN SELECT * FROM alias_cases ORDER BY id LOOP
  project_id:=gen_random_uuid(); signup_id:=gen_random_uuid(); request_id:=gen_random_uuid();
  schedule:=CASE c.event_type
   WHEN 'oneTime' THEN '{"oneTime":{"date":"2020-09-18","startTime":"09:00","endTime":"12:00","volunteers":1}}'::jsonb
   WHEN 'multiDay' THEN '{"multiDay":[{"date":"2020-09-18","slots":[{"startTime":"09:00","endTime":"12:00","volunteers":1},{"startTime":"12:00","endTime":"15:00","volunteers":1}]},{"date":"2020-09-19","slots":[{"startTime":"09:00","endTime":"12:00","volunteers":1}]}]}'::jsonb
   ELSE '{"sameDayMultiArea":{"date":"2020-09-18","roles":[{"name":"Morning","startTime":"09:00","endTime":"12:00","volunteers":1},{"name":"Afternoon","startTime":"12:00","endTime":"15:00","volunteers":1}]}}'::jsonb END;
  INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone,published)
  VALUES(project_id,'ba100000-0000-4000-8000-000000000001','Session aliases fixture','Local','Synthetic schedule alias',c.event_type,'manual',schedule,'upcoming','UTC',jsonb_build_object(c.canonical_id,true));
  INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status)
  VALUES(signup_id,project_id,'ba100000-0000-4000-8000-000000000002',c.stored_id,'approved');
  sheet_id:=public.create_attendance_print_sheet(project_id,c.batch_id,'ba100000-0000-4000-8000-000000000001',0,0);
  RETURN NEXT extensions.is((SELECT count(*)::integer FROM public.project_attendance_print_rows r WHERE r.sheet_id=sheet_id AND r.signup_id=signup_id),1,'alias '||c.id||': print includes existing roster signup');
  RETURN NEXT extensions.is((SELECT s.schedule_id FROM public.project_attendance_print_sheets s WHERE s.id=sheet_id),c.batch_id,'alias '||c.id||': print preserves requested session reference');
  batch_id:=public.create_manual_attendance_batch(project_id,c.batch_id,'ba100000-0000-4000-8000-000000000001',request_id);
  row_id:=public.add_paper_attendance_row(project_id,batch_id,'ba100000-0000-4000-8000-000000000001',gen_random_uuid());
  RETURN NEXT extensions.is(public.update_paper_scan_review_row(batch_id,project_id,row_id,'ba100000-0000-4000-8000-000000000001',jsonb_build_object('expectedRevision',0,'name','Known volunteer','decision','include','attendanceIntervals','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]'::jsonb,'reviewAcknowledged',true,'identityConfirmed',true)||CASE WHEN c.email_match THEN '{"email":"session-alias-2@local.test"}'::jsonb ELSE jsonb_build_object('matchSignupId',signup_id) END),'updated','alias '||c.id||': review accepts the confirmed identity');
  SELECT * INTO result FROM public.commit_paper_signup_batch(batch_id,'ba100000-0000-4000-8000-000000000001',ARRAY[row_id],false,gen_random_uuid());
  RETURN NEXT extensions.is(result.outcome,'signup_updated','alias '||c.id||': commit resolves existing signup');
  RETURN NEXT extensions.is(result.signup_id,signup_id,'alias '||c.id||': commit retains exact signup identity');
  RETURN NEXT extensions.is((SELECT count(*)::integer FROM public.project_signups s WHERE s.project_id=project_id),1,'alias '||c.id||': email or explicit resolution creates no duplicate signup');
  RETURN NEXT extensions.is((SELECT s.schedule_id FROM public.project_signups s WHERE s.id=signup_id),c.stored_id,'alias '||c.id||': original signup session ID remains unchanged');
  RETURN NEXT extensions.is((SELECT cert.credited_minutes FROM public.certificates cert WHERE cert.signup_id=signup_id),60,'alias '||c.id||': published session issues actual reviewed credit');
  RETURN NEXT extensions.is((SELECT count(*)::integer FROM public.hours_publication_email_outbox o JOIN public.certificates cert ON cert.id=o.certificate_id WHERE cert.signup_id=signup_id),1,'alias '||c.id||': late certificate has one delivery');
  INSERT INTO alias_fixtures VALUES(c.id,project_id,signup_id,batch_id,row_id);
 END LOOP;
END; $$;
SELECT * FROM pg_temp.exercise_aliases();

CREATE FUNCTION pg_temp.new_alias_row(p_case integer,p_email text,p_match uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE f alias_fixtures%ROWTYPE; c alias_cases%ROWTYPE; b uuid; r uuid;
BEGIN
 SELECT * INTO f FROM alias_fixtures WHERE id=p_case; SELECT * INTO c FROM alias_cases WHERE id=p_case;
 b:=public.create_manual_attendance_batch(f.project,c.canonical_id,'ba100000-0000-4000-8000-000000000001',gen_random_uuid());
 r:=public.add_paper_attendance_row(f.project,b,'ba100000-0000-4000-8000-000000000001',gen_random_uuid());
 PERFORM public.update_paper_scan_review_row(b,f.project,r,'ba100000-0000-4000-8000-000000000001',jsonb_build_object('expectedRevision',0,'name','Alias guest','email',p_email,'matchSignupId',p_match,'decision','include','attendanceIntervals','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]'::jsonb,'reviewAcknowledged',true,'identityConfirmed',true));
 RETURN r;
END; $$;
CREATE FUNCTION pg_temp.commit_alias_row(p_row uuid,p_override boolean DEFAULT false) RETURNS TABLE(outcome text,detail text,over_capacity boolean) LANGUAGE sql AS $$
 SELECT result.outcome,result.detail,result.over_capacity FROM public.project_paper_scan_rows r CROSS JOIN LATERAL public.commit_paper_signup_batch(r.batch_id,'ba100000-0000-4000-8000-000000000001',ARRAY[p_row],p_override,gen_random_uuid()) result WHERE r.id=p_row;
$$;
CREATE TEMP TABLE capacity_cases AS SELECT f.id,pg_temp.new_alias_row(f.id,'alias-capacity-'||f.id||'@local.test') AS row FROM alias_fixtures f WHERE f.id IN (1,4,7);
SELECT extensions.is((SELECT detail FROM pg_temp.commit_alias_row(c.row)),'slot_full','capacity counts legacy aliases for case '||c.id) FROM capacity_cases c ORDER BY c.id;
SELECT extensions.ok((SELECT outcome='signup_created' AND over_capacity FROM pg_temp.commit_alias_row(c.row,true)),'explicit capacity override works across aliases for case '||c.id) FROM capacity_cases c ORDER BY c.id;

CREATE TEMP TABLE ambiguity AS SELECT pg_temp.new_alias_row(2,'session-alias-2@local.test') AS email_row,pg_temp.new_alias_row(2,NULL,(SELECT signup FROM alias_fixtures WHERE id=2)) AS explicit_row;
INSERT INTO public.project_signups(project_id,user_id,schedule_id,status) SELECT project,'ba100000-0000-4000-8000-000000000002','oneTime','approved' FROM alias_fixtures WHERE id=2;
SELECT extensions.is((SELECT detail FROM ambiguity a CROSS JOIN LATERAL pg_temp.commit_alias_row(a.email_row)),'ambiguous_identity','verified email with multiple session aliases remains unresolved');
SELECT extensions.is((SELECT detail FROM ambiguity a CROSS JOIN LATERAL pg_temp.commit_alias_row(a.explicit_row)),'ambiguous_identity','explicit ID does not bypass duplicate participant ambiguity');
CREATE TEMP TABLE ambiguous_print AS SELECT public.create_attendance_print_sheet(project,'oneTime','ba100000-0000-4000-8000-000000000001',0,0) AS sheet FROM alias_fixtures WHERE id=2;
SELECT extensions.is((SELECT count(*)::integer FROM public.project_attendance_print_rows r JOIN ambiguous_print p ON r.sheet_id=p.sheet),2,'printing keeps both distinct signup rows for later identity review');
SELECT extensions.is((SELECT count(DISTINCT r.row_reference)::integer FROM public.project_attendance_print_rows r JOIN ambiguous_print p ON r.sheet_id=p.sheet),2,'duplicate participant aliases retain separate opaque print references');

CREATE TEMP TABLE invalid_rows AS SELECT pg_temp.new_alias_row(3,NULL) AS row;
SELECT extensions.throws_ok($$SELECT public.update_paper_scan_review_row(r.batch_id,r.project_id,r.id,'ba100000-0000-4000-8000-000000000001',jsonb_build_object('expectedRevision',1,'matchSignupId',f.signup)) FROM invalid_rows i JOIN public.project_paper_scan_rows r ON r.id=i.row CROSS JOIN alias_fixtures f WHERE f.id=1$$,'22023','invalid signup match','cross-project match fails despite equivalent-looking session IDs');
INSERT INTO public.project_signups(project_id,user_id,schedule_id,status) SELECT project,'ba100000-0000-4000-8000-000000000003','day-0-slot-1','approved' FROM alias_fixtures WHERE id=3;
SELECT extensions.throws_ok($$SELECT public.update_paper_scan_review_row(r.batch_id,r.project_id,r.id,'ba100000-0000-4000-8000-000000000001',jsonb_build_object('expectedRevision',1,'matchSignupId',s.id)) FROM invalid_rows i JOIN public.project_paper_scan_rows r ON r.id=i.row JOIN public.project_signups s ON s.project_id=r.project_id AND s.schedule_id='day-0-slot-1'$$,'22023','invalid signup match','different canonical session cannot match');
UPDATE public.project_paper_scan_rows SET match_signup_id=(SELECT s.id FROM public.project_signups s JOIN alias_fixtures f ON f.project=s.project_id WHERE f.id=3 AND s.schedule_id='day-0-slot-1') WHERE id=(SELECT row FROM invalid_rows);
SELECT extensions.is((SELECT detail FROM invalid_rows i CROSS JOIN LATERAL pg_temp.commit_alias_row(i.row)),'invalid_signup_match','commit independently rejects another session');
CREATE TEMP TABLE other_print AS SELECT public.create_attendance_print_sheet(project,'2020-09-18-1','ba100000-0000-4000-8000-000000000001',0,0) AS sheet FROM alias_fixtures WHERE id=3;
SELECT extensions.is((SELECT count(*)::integer FROM public.project_attendance_print_rows r JOIN other_print p ON r.sheet_id=p.sheet),1,'other-session print contains only its own legacy signup');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.project_attendance_print_rows r JOIN other_print p ON r.sheet_id=p.sheet JOIN alias_fixtures f ON f.id=3 AND f.signup=r.signup_id),'other-session print excludes first-session participant');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheet(project,'day-99-slot-0','ba100000-0000-4000-8000-000000000001',0,0) FROM alias_fixtures WHERE id=3$$,'22023','Invalid schedule session','unknown alias cannot print');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheet(project,NULL,'ba100000-0000-4000-8000-000000000001',0,0) FROM alias_fixtures WHERE id=3$$,'22023','Invalid print options','NULL session cannot print');
SELECT extensions.throws_ok($$SELECT public.create_manual_attendance_batch(project,'day-99-slot-0','ba100000-0000-4000-8000-000000000001',gen_random_uuid()) FROM alias_fixtures WHERE id=3$$,'22023','invalid schedule','unknown alias cannot create a manual draft');
UPDATE public.project_paper_scan_batches SET schedule_id='day-99-slot-0' WHERE id=(SELECT r.batch_id FROM invalid_rows i JOIN public.project_paper_scan_rows r ON r.id=i.row);
SELECT extensions.throws_ok($$SELECT * FROM pg_temp.commit_alias_row((SELECT row FROM invalid_rows))$$,'22023','invalid_schedule','commit refuses an invalid batch key before saving rows');
SELECT * FROM extensions.finish();
ROLLBACK;
