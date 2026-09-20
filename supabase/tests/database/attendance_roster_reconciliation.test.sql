BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

CREATE TEMP TABLE reconciliation_fixture AS SELECT
  gen_random_uuid() AS owner,gen_random_uuid() AS volunteer,gen_random_uuid() AS outsider,
  gen_random_uuid() AS project,gen_random_uuid() AS signup,gen_random_uuid() AS primary_batch,
  gen_random_uuid() AS primary_row,gen_random_uuid() AS primary_request;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT actor,'authenticated','authenticated',actor||'@local.test',now(),'{}',jsonb_build_object('username','reconcile_'||left(actor::text,8)),now(),now()
FROM reconciliation_fixture CROSS JOIN LATERAL unnest(ARRAY[owner,volunteer,outsider]) actor;
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,require_login,status,project_timezone)
SELECT project,owner,'Roster reconciliation fixture','Local','Synthetic attendance','oneTime','manual',
 '{"oneTime":{"date":"2021-08-11","startTime":"09:00","endTime":"15:00","volunteers":20}}',true,'upcoming','UTC' FROM reconciliation_fixture;
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status)
SELECT signup,project,volunteer,'oneTime','approved' FROM reconciliation_fixture;
INSERT INTO public.project_paper_scan_batches(id,project_id,schedule_id,created_by,status,image_count)
SELECT primary_batch,project,'oneTime',owner,'review',1 FROM reconciliation_fixture;
INSERT INTO public.project_paper_scan_rows(id,batch_id,project_id,sheet_row_number,raw_extraction,name,decision,match_signup_id,attendance_intervals,review_acknowledged,identity_confirmed)
SELECT primary_row,primary_batch,project,1,'{"source":"primary"}','Known volunteer','include',signup,
 '[{"checkIn":"2021-08-11T09:00:00Z","checkOut":"2021-08-11T10:00:00Z"},{"checkIn":"2021-08-11T10:00:00Z","checkOut":"2021-08-11T11:00:00Z"},{"checkIn":"2021-08-11T12:00:00Z","checkOut":"2021-08-11T13:00:00Z"}]',true,true
FROM reconciliation_fixture;
SELECT result.* FROM reconciliation_fixture f CROSS JOIN LATERAL public.commit_paper_signup_batch(f.primary_batch,f.owner,ARRAY[f.primary_row],false,f.primary_request) result;
SELECT public.publish_volunteer_hours_transactional(owner,project,'oneTime',jsonb_build_array(jsonb_build_object('signupId',signup,'checkIn','2021-08-11T09:00:00Z','checkOut','2021-08-11T13:00:00Z','attendanceRevision',1)),
 'hours-publication:v1:abababababababababababababababababababababababababababababababab') FROM reconciliation_fixture;

CREATE FUNCTION pg_temp.saved_roster(p_intervals jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE f reconciliation_fixture%ROWTYPE; b uuid; r uuid; photo uuid;
BEGIN
 SELECT * INTO f FROM reconciliation_fixture;
 b:=public.create_manual_attendance_batch(f.project,'oneTime',f.owner,gen_random_uuid());
 r:=public.add_paper_attendance_row(f.project,b,f.owner,gen_random_uuid());
 INSERT INTO public.project_paper_scan_images(batch_id,project_id,object_path,sequence,byte_size,content_type)
 VALUES(b,f.project,'fictional-reconciliation/'||r||'.png',0,1024,'image/png') RETURNING id INTO photo;
 UPDATE public.project_paper_scan_rows SET image_id=photo,raw_extraction='{"source":"Fictional handwritten sheet","unresolvedName":"Volunteer"}' WHERE id=r;
 PERFORM public.update_paper_scan_review_row(b,f.project,r,f.owner,jsonb_build_object('expectedRevision',0,'name','Unidentified volunteer','decision','include','attendanceIntervals',p_intervals,'reviewAcknowledged',true,'identityConfirmed',true));
 PERFORM public.commit_paper_signup_batch(b,f.owner,ARRAY[r],false,gen_random_uuid());
 PERFORM public.update_paper_scan_review_row(b,f.project,r,f.owner,jsonb_build_object('expectedRevision',1,'matchSignupId',f.signup,'reviewAcknowledged',true,'identityConfirmed',true));
 RETURN r;
END; $$;
CREATE FUNCTION pg_temp.commit_row(p_row uuid,p_request uuid DEFAULT gen_random_uuid()) RETURNS TABLE(outcome text,detail text) LANGUAGE sql AS $$
 SELECT result.outcome,result.detail FROM reconciliation_fixture f JOIN public.project_paper_scan_rows rows ON rows.id=p_row
 CROSS JOIN LATERAL public.commit_paper_signup_batch(rows.batch_id,f.owner,ARRAY[p_row],false,p_request) result;
$$;
CREATE TEMP TABLE candidates AS SELECT
 pg_temp.saved_roster('[{"checkIn":"2021-08-11T09:00:00Z","checkOut":"2021-08-11T11:00:00Z"},{"checkIn":"2021-08-11T12:00:00Z","checkOut":"2021-08-11T13:00:00Z"}]') AS complete,
 pg_temp.saved_roster('[{"checkIn":"2021-08-11T09:30:00Z","checkOut":"2021-08-11T10:30:00Z"}]') AS partial,
 pg_temp.saved_roster('[{"checkIn":"2021-08-11T10:30:00Z","checkOut":"2021-08-11T12:30:00Z"}]') AS gap,
 pg_temp.saved_roster('[{"checkIn":"2021-08-11T09:00:00Z","checkOut":"2021-08-11T13:00:00Z"}]') AS envelope,
 pg_temp.saved_roster('[{"checkIn":"2021-08-11T13:00:00Z","checkOut":"2021-08-11T14:00:00Z"}]') AS uncovered,
 pg_temp.saved_roster('[{"checkIn":"2021-08-11T09:00:00Z","checkOut":"2021-08-11T10:00:00Z"}]') AS unreviewed,
 pg_temp.saved_roster('[{"checkIn":"2021-08-11T09:00:00Z","checkOut":"2021-08-11T10:00:00Z"}]') AS unconfirmed,
 gen_random_uuid() AS request;
CREATE TEMP TABLE preserved AS SELECT
 (SELECT to_jsonb(s) FROM public.project_signups s WHERE s.id=f.signup) AS signup,
 (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.project_attendance_intervals i WHERE i.signup_id=f.signup) AS intervals,
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.certificates c WHERE c.signup_id=f.signup) AS certificates,
 (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.hours_publication_email_outbox o JOIN public.certificates c ON c.id=o.certificate_id WHERE c.signup_id=f.signup) AS outbox,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.request_id) FROM private.paper_attendance_commit_receipts r) AS receipts,
 (SELECT to_jsonb(r) FROM public.project_paper_roster_entries r WHERE r.scan_row_id=candidates.complete) AS roster,
 (SELECT to_jsonb(r) FROM public.project_paper_scan_rows r WHERE r.id=candidates.complete) AS source
 FROM reconciliation_fixture f CROSS JOIN candidates;
SELECT extensions.throws_ok($$SELECT public.commit_paper_signup_batch(rows.batch_id,f.outsider,ARRAY[c.complete],false,gen_random_uuid()) FROM candidates c JOIN public.project_paper_scan_rows rows ON rows.id=c.complete CROSS JOIN reconciliation_fixture f$$,
 '42501','commit_paper_signup_batch: actor is not a project organizer','reconciliation requires current management authority');
SELECT extensions.throws_ok($$SELECT public.update_paper_scan_review_row(rows.batch_id,f.project,c.complete,f.owner,'{"expectedRevision":1,"name":"Stale match"}') FROM candidates c JOIN public.project_paper_scan_rows rows ON rows.id=c.complete CROSS JOIN reconciliation_fixture f$$,
 '40001','review row changed; refresh before saving','stale review cannot replace the confirmed match');
SELECT extensions.is((SELECT outcome FROM candidates c CROSS JOIN LATERAL pg_temp.commit_row(c.complete,c.request)), 'skipped','complete union reconciles even when adjacent intervals have different segmentation');
SELECT extensions.is((SELECT detail FROM candidates c CROSS JOIN LATERAL pg_temp.commit_row(c.complete,c.request)), 'reconciled_existing_attendance','receipt replay preserves the reconciliation result');
SELECT extensions.is((SELECT count(*)::integer FROM private.paper_attendance_commit_receipts r JOIN candidates c ON c.request=r.request_id),1,'retry records one immutable receipt');
SELECT extensions.ok((SELECT r.results->0->'reconciliation'->'prior_roster'=p.roster
 AND (r.results->0->'reconciliation'->>'review_revision')::integer=2
 AND (r.results->0->'reconciliation'->>'attendance_revision')::integer=1
 AND r.results->0->'reconciliation'->>'primary_scan_row_id'=f.primary_row::text
 AND r.results->0->'reconciliation'->'authoritative_intervals'=private.signup_attendance_intervals(f.signup)
 AND r.results->0->'reconciliation'->'reviewed_intervals'=rows.attendance_intervals
 AND r.actor_id=f.owner AND r.batch_id=rows.batch_id AND r.row_ids=ARRAY[rows.id]
 FROM candidates c JOIN private.paper_attendance_commit_receipts r ON r.request_id=c.request JOIN public.project_paper_scan_rows rows ON rows.id=c.complete CROSS JOIN preserved p CROSS JOIN reconciliation_fixture f),'immutable receipt binds source roster, both revisions, reviewed time, target time, primary row, actor and request');
SELECT extensions.ok((SELECT rows.raw_extraction=p.source->'raw_extraction' AND rows.image_id IS NOT DISTINCT FROM (p.source->>'image_id')::uuid AND rows.committed_signup_id=f.signup AND rows.outcome_detail='reconciled_existing_attendance' FROM candidates c JOIN public.project_paper_scan_rows rows ON rows.id=c.complete CROSS JOIN preserved p CROSS JOIN reconciliation_fixture f),'reconciled reference preserves source and target identity');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_paper_roster_entries r JOIN candidates c ON r.scan_row_id=c.complete),0,'reconciliation removes only the duplicate saved roster');
SELECT extensions.is((SELECT committed_row_count FROM public.project_paper_scan_batches b JOIN public.project_paper_scan_rows r ON r.batch_id=b.id JOIN candidates c ON c.complete=r.id),0,'reference row does not count as a new attendance award');
SELECT extensions.is((SELECT detail FROM candidates c CROSS JOIN LATERAL pg_temp.commit_row(c.complete)), 'reconciled_existing_attendance','new request after completion returns existing reconciliation');
SELECT extensions.is((SELECT outcome FROM candidates c CROSS JOIN LATERAL pg_temp.commit_row(c.partial)), 'skipped','partial visit crossing adjacent authoritative intervals is covered');
SELECT extensions.is((SELECT detail FROM candidates c CROSS JOIN LATERAL pg_temp.commit_row(c.gap)), 'duplicate_attendance_requires_correction','covered endpoints cannot conceal an uncredited break');
SELECT extensions.is((SELECT detail FROM candidates c CROSS JOIN LATERAL pg_temp.commit_row(c.envelope)), 'duplicate_attendance_requires_correction','same outer envelope does not cover the break');
SELECT extensions.is((SELECT detail FROM candidates c CROSS JOIN LATERAL pg_temp.commit_row(c.uncovered)), 'duplicate_attendance_requires_correction','time beyond authoritative attendance cannot reconcile');
UPDATE public.project_paper_scan_rows SET review_acknowledged=false WHERE id=(SELECT unreviewed FROM candidates);
UPDATE public.project_paper_scan_rows SET identity_confirmed=false WHERE id=(SELECT unconfirmed FROM candidates);
SELECT extensions.is((SELECT detail FROM candidates c CROSS JOIN LATERAL pg_temp.commit_row(c.unreviewed)), 'review_required','unreviewed saved roster cannot reconcile');
SELECT extensions.is((SELECT detail FROM candidates c CROSS JOIN LATERAL pg_temp.commit_row(c.unconfirmed)), 'identity_confirmation_required','suggested identity alone cannot reconcile');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_paper_roster_entries r WHERE r.scan_row_id IN (SELECT gap FROM candidates UNION ALL SELECT envelope FROM candidates UNION ALL SELECT uncovered FROM candidates UNION ALL SELECT unreviewed FROM candidates UNION ALL SELECT unconfirmed FROM candidates)),5,'failed candidates retain all their unresolved roster records');

CREATE TEMP TABLE unsaved AS SELECT public.create_manual_attendance_batch(project,'oneTime',owner,gen_random_uuid()) AS batch FROM reconciliation_fixture;
INSERT INTO public.project_paper_scan_rows(batch_id,project_id,sheet_row_number,raw_extraction,name,decision,match_signup_id,attendance_intervals,review_acknowledged,identity_confirmed)
SELECT u.batch,f.project,1,'{}','Unsaved duplicate','include',f.signup,'[{"checkIn":"2021-08-11T09:00:00Z","checkOut":"2021-08-11T10:00:00Z"}]',true,true FROM unsaved u CROSS JOIN reconciliation_fixture f;
SELECT extensions.is((SELECT result.detail FROM public.project_paper_scan_rows r JOIN unsaved u ON r.batch_id=u.batch CROSS JOIN LATERAL pg_temp.commit_row(r.id) result),'duplicate_attendance_requires_correction','ordinary unsaved duplicate still requires correction');
SELECT extensions.is((SELECT public.update_paper_scan_review_row(rows.batch_id,f.project,c.complete,f.owner,'{"expectedRevision":2,"decision":"exclude"}') FROM candidates c JOIN public.project_paper_scan_rows rows ON rows.id=c.complete CROSS JOIN reconciliation_fixture f),'already_committed','reconciled references cannot be edited or excluded');
SELECT extensions.is((SELECT public.discard_paper_scan_batch(rows.batch_id,f.project,f.owner) FROM candidates c JOIN public.project_paper_scan_rows rows ON rows.id=c.complete CROSS JOIN reconciliation_fixture f),'committed','reconciled source batch cannot be discarded');
SELECT extensions.throws_ok($$SELECT public.combine_paper_attendance_rows(f.project,rows.batch_id,f.owner,c.complete,ARRAY[c.partial],gen_random_uuid()) FROM candidates c JOIN public.project_paper_scan_rows rows ON rows.id=c.complete CROSS JOIN reconciliation_fixture f$$,
 '22023','batch is not in review','reconciled references cannot become a combine target');
SELECT extensions.throws_ok($$INSERT INTO public.project_paper_scan_rows(batch_id,project_id,sheet_row_number,raw_extraction,committed_signup_id,outcome) SELECT u.batch,f.project,2,'{}',f.signup,'signup_updated' FROM unsaved u CROSS JOIN reconciliation_fixture f$$,
 '23505',NULL,'database still enforces exactly one primary committed scan row');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_paper_scan_rows r JOIN reconciliation_fixture f ON r.committed_signup_id=f.signup AND r.outcome<>'skipped'),1,'one primary row survives both references');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_paper_scan_rows r JOIN reconciliation_fixture f ON r.committed_signup_id=f.signup AND r.outcome='skipped'),2,'covered roster rows retain separate immutable source references');
SELECT extensions.ok((SELECT to_jsonb(s)=p.signup FROM public.project_signups s JOIN reconciliation_fixture f ON s.id=f.signup CROSS JOIN preserved p),'entire signup and attendance revision are unchanged');
SELECT extensions.is((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.project_attendance_intervals i JOIN reconciliation_fixture f ON i.signup_id=f.signup),(SELECT intervals FROM preserved),'authoritative interval records are byte-for-byte unchanged');
SELECT extensions.is((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.certificates c JOIN reconciliation_fixture f ON c.signup_id=f.signup),(SELECT certificates FROM preserved),'one original certificate and its complete snapshot remain unchanged');
SELECT extensions.is((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.hours_publication_email_outbox o JOIN public.certificates c ON c.id=o.certificate_id JOIN reconciliation_fixture f ON c.signup_id=f.signup),(SELECT outbox FROM preserved),'delivery records are unchanged');
SELECT extensions.ok((SELECT bool_and(to_jsonb(r)=old.value) FROM preserved p CROSS JOIN LATERAL jsonb_array_elements(p.receipts) old(value) JOIN private.paper_attendance_commit_receipts r ON r.request_id=(old.value->>'request_id')::uuid),'original commit receipts remain unchanged');
SELECT extensions.is((SELECT count(*)::integer FROM private.project_attendance_changes a JOIN reconciliation_fixture f ON a.signup_id=f.signup),0,'identity reconciliation creates no attendance correction');
CREATE TEMP TABLE foreign_scope AS SELECT gen_random_uuid() AS project,gen_random_uuid() AS signup;
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone)
SELECT other.project,f.owner,'Other project','Local','Synthetic scope','sameDayMultiArea','manual','{"sameDayMultiArea":{"date":"2021-08-11","roles":[{"name":"First","startTime":"09:00","endTime":"12:00","volunteers":20},{"name":"Second","startTime":"12:00","endTime":"15:00","volunteers":20}]}}','upcoming','UTC' FROM foreign_scope other CROSS JOIN reconciliation_fixture f;
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status)
SELECT other.signup,other.project,f.volunteer,'Second','approved' FROM foreign_scope other CROSS JOIN reconciliation_fixture f;
SELECT extensions.throws_ok($$SELECT public.update_paper_scan_review_row(rows.batch_id,f.project,c.gap,f.owner,jsonb_build_object('expectedRevision',2,'matchSignupId',other.signup,'reviewAcknowledged',true,'identityConfirmed',true)) FROM candidates c JOIN public.project_paper_scan_rows rows ON rows.id=c.gap CROSS JOIN reconciliation_fixture f CROSS JOIN foreign_scope other$$,
 '22023','invalid signup match','review rejects an explicit cross-project reconciliation target');
SELECT extensions.throws_ok($$UPDATE public.project_paper_scan_rows SET match_signup_id=(SELECT signup FROM foreign_scope) WHERE id=(SELECT gap FROM candidates)$$,
 '23503',NULL,'tenant foreign key also rejects cross-project match injection');
CREATE TEMP TABLE wrong_session AS SELECT gen_random_uuid() AS batch,gen_random_uuid() AS row;
INSERT INTO public.project_paper_scan_batches(id,project_id,schedule_id,created_by,status,image_count)
SELECT w.batch,other.project,'First',f.owner,'review',0 FROM wrong_session w CROSS JOIN foreign_scope other CROSS JOIN reconciliation_fixture f;
INSERT INTO public.project_paper_scan_rows(id,batch_id,project_id,sheet_row_number,raw_extraction,name,decision,match_signup_id,attendance_intervals,review_acknowledged,identity_confirmed)
SELECT w.row,w.batch,other.project,1,'{}','Wrong session','include',other.signup,'[{"checkIn":"2021-08-11T09:00:00Z","checkOut":"2021-08-11T10:00:00Z"}]',true,true FROM wrong_session w CROSS JOIN foreign_scope other;
SELECT extensions.is((SELECT result.detail FROM wrong_session w CROSS JOIN reconciliation_fixture f CROSS JOIN LATERAL public.commit_paper_signup_batch(w.batch,f.owner,ARRAY[w.row],false,gen_random_uuid()) result),'invalid_signup_match','commit rechecks the exact session of an explicit identity match');
UPDATE public.project_paper_scan_batches SET status='review' WHERE id=(SELECT batch_id FROM public.project_paper_scan_rows WHERE id=(SELECT complete FROM candidates));
CREATE TEMP TABLE combine_peer AS SELECT public.add_paper_attendance_row(f.project,rows.batch_id,f.owner,gen_random_uuid()) AS id FROM candidates c JOIN public.project_paper_scan_rows rows ON rows.id=c.complete CROSS JOIN reconciliation_fixture f;
UPDATE public.project_paper_scan_rows SET identity_confirmed=true,match_signup_id=(SELECT signup FROM reconciliation_fixture) WHERE id=(SELECT id FROM combine_peer);
SELECT extensions.throws_ok($$SELECT public.combine_paper_attendance_rows(f.project,rows.batch_id,f.owner,c.complete,ARRAY[peer.id],gen_random_uuid()) FROM candidates c JOIN public.project_paper_scan_rows rows ON rows.id=c.complete CROSS JOIN reconciliation_fixture f CROSS JOIN combine_peer peer$$,
 '22023','confirm an uncommitted identity before combining','partial review batches still protect reconciled combine targets');
SELECT extensions.throws_ok($$SELECT public.combine_paper_attendance_rows(f.project,rows.batch_id,f.owner,peer.id,ARRAY[c.complete],gen_random_uuid()) FROM candidates c JOIN public.project_paper_scan_rows rows ON rows.id=c.complete CROSS JOIN reconciliation_fixture f CROSS JOIN combine_peer peer$$,
 '22023','source rows must have the same confirmed identity','partial review batches still protect reconciled combine sources');
SELECT extensions.is((SELECT public.discard_paper_scan_batch(rows.batch_id,f.project,f.owner) FROM candidates c JOIN public.project_paper_scan_rows rows ON rows.id=c.complete CROSS JOIN reconciliation_fixture f),'committed','an open batch cannot discard its reconciled source reference');
SELECT extensions.ok(NOT has_table_privilege('service_role','private.paper_attendance_commit_receipts','UPDATE') AND NOT has_table_privilege('authenticated','private.paper_attendance_commit_receipts','SELECT'),'receipt evidence is immutable to service callers and private from browsers');

UPDATE public.project_signups SET status='attended',check_in_time='2021-08-11T12:00:00Z',check_out_time='2021-08-11T13:00:00Z' WHERE id=(SELECT signup FROM foreign_scope);
CREATE TEMP TABLE legacy_roster AS SELECT public.create_manual_attendance_batch(other.project,'Second',f.owner,gen_random_uuid()) AS batch FROM foreign_scope other CROSS JOIN reconciliation_fixture f;
ALTER TABLE legacy_roster ADD COLUMN row uuid;
UPDATE legacy_roster SET row=public.add_paper_attendance_row(other.project,legacy_roster.batch,f.owner,gen_random_uuid()) FROM foreign_scope other CROSS JOIN reconciliation_fixture f;
SELECT public.update_paper_scan_review_row(l.batch,other.project,l.row,f.owner,'{"expectedRevision":0,"name":"Legacy roster","decision":"include","attendanceIntervals":[{"checkIn":"2021-08-11T12:00:00Z","checkOut":"2021-08-11T13:00:00Z"}],"identityConfirmed":true,"reviewAcknowledged":true}') FROM legacy_roster l CROSS JOIN foreign_scope other CROSS JOIN reconciliation_fixture f;
SELECT public.commit_paper_signup_batch(l.batch,f.owner,ARRAY[l.row],false,gen_random_uuid()) FROM legacy_roster l CROSS JOIN reconciliation_fixture f;
SELECT public.update_paper_scan_review_row(l.batch,other.project,l.row,f.owner,jsonb_build_object('expectedRevision',1,'matchSignupId',other.signup,'identityConfirmed',true,'reviewAcknowledged',true)) FROM legacy_roster l CROSS JOIN foreign_scope other CROSS JOIN reconciliation_fixture f;
SELECT extensions.is((SELECT result.detail FROM legacy_roster l CROSS JOIN reconciliation_fixture f CROSS JOIN LATERAL public.commit_paper_signup_batch(l.batch,f.owner,ARRAY[l.row],false,gen_random_uuid()) result),'duplicate_attendance_requires_correction','legacy summary without canonical intervals cannot establish reconciliation coverage');
SELECT extensions.is((SELECT private.signup_attendance_intervals(signup) FROM foreign_scope),'[]'::jsonb,'reconciliation never promotes legacy envelope times into authoritative intervals');
SELECT * FROM extensions.finish();
ROLLBACK;
