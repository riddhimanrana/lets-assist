-- Stage member edits separately and commit them against the reviewed revision.
BEGIN;
ALTER TABLE plugin_data.csf_point_submissions ADD COLUMN revision bigint NOT NULL DEFAULT 0;
ALTER TABLE plugin_data.csf_submission_files ADD COLUMN superseded_at timestamptz;
DROP INDEX plugin_data.csf_submission_files_one_proof_idx;
CREATE UNIQUE INDEX csf_submission_files_one_proof_idx ON plugin_data.csf_submission_files (submission_id) WHERE superseded_at IS NULL;
COMMENT ON INDEX plugin_data.csf_submission_files_one_proof_idx IS 'One current proof per submission; superseded proof remains in revision history.';
CREATE FUNCTION plugin_data.csf_increment_submission_revision() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN NEW.revision:=OLD.revision+1; RETURN NEW; END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_increment_submission_revision() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_increment_submission_revision() TO postgres;
-- Run after the existing freeze guard so an officer's decision-only update stays valid.
CREATE TRIGGER zz_csf_submission_revision BEFORE UPDATE ON plugin_data.csf_point_submissions
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_increment_submission_revision();

CREATE TABLE plugin_data.csf_submission_edit_requests (
  request_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  submission_id uuid NOT NULL REFERENCES plugin_data.csf_point_submissions(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  expected_revision bigint NOT NULL CHECK(expected_revision>=0),
  fingerprint text NOT NULL,
  intent jsonb NOT NULL,
  proof jsonb,
  object_path text,
  file_id uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','committed','expired')),
  result jsonb,
  prior_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz
);
ALTER TABLE plugin_data.csf_submission_edit_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_submission_edit_requests FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX csf_submission_edit_org ON plugin_data.csf_submission_edit_requests(organization_id);
CREATE INDEX csf_submission_edit_submission ON plugin_data.csf_submission_edit_requests(submission_id);
CREATE INDEX csf_submission_edit_actor ON plugin_data.csf_submission_edit_requests(actor_user_id);
CREATE INDEX csf_submission_edit_pending ON plugin_data.csf_submission_edit_requests(created_at) WHERE status='pending';
INSERT INTO plugin_data.csf_retention_reference_policy(parent_table,child_table,child_column,policy,note)
VALUES ('csf_point_submissions','csf_submission_edit_requests','submission_id','delete_with_owner','Submission revisions and staged proof follow their submission.');
CREATE FUNCTION plugin_data.csf_cleanup_deleted_submission_edit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.object_path IS NOT NULL AND OLD.status <> 'committed' THEN
    INSERT INTO plugin_data.csf_storage_deletion_queue(organization_id,bucket,object_path)
    VALUES(OLD.organization_id,'plugins',OLD.object_path) ON CONFLICT(bucket,object_path) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_cleanup_deleted_submission_edit() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_cleanup_deleted_submission_edit() TO postgres;
CREATE TRIGGER csf_cleanup_deleted_submission_edit BEFORE DELETE ON plugin_data.csf_submission_edit_requests
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_cleanup_deleted_submission_edit();


CREATE FUNCTION plugin_data.csf_validate_submission_edit(p_organization_id uuid,p_submission_id uuid,p_actor_user_id uuid,p_expected_revision bigint,p_intent jsonb,p_has_replacement boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  s plugin_data.csf_point_submissions%ROWTYPE;
  a plugin_data.csf_opportunities%ROWTYPE;
  rules jsonb; selection jsonb; calculation jsonb;
  has_proof boolean; points numeric; category text; description text;
BEGIN
  PERFORM plugin_data.csf_assert_point_actor_authority(p_organization_id,p_actor_user_id,ARRAY[]::text[]);
  SELECT * INTO s FROM plugin_data.csf_point_submissions WHERE id=p_submission_id AND organization_id=p_organization_id;
  IF NOT FOUND OR s.source<>'student' THEN RAISE EXCEPTION 'Only the connected member may edit this submission.' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||s.term_id::text,0));
  PERFORM 1 FROM plugin_data.csf_profile_accounts WHERE organization_id=p_organization_id AND profile_id=s.profile_id AND user_id=p_actor_user_id AND status='verified' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the connected member may edit this submission.' USING ERRCODE='42501'; END IF;
  points:=(p_intent->>'claimedPoints')::numeric; category:=p_intent->>'pointType'; description:=btrim(p_intent->>'description');
  IF description IS NULL OR length(description) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Describe what you did in 1 to 4000 characters.'; END IF;
  PERFORM nullif(p_intent->>'activityDate','')::date;
  SELECT EXISTS(SELECT 1 FROM plugin_data.csf_submission_files WHERE organization_id=p_organization_id AND submission_id=p_submission_id AND upload_status='finalized' AND superseded_at IS NULL AND bucket='plugins' AND nullif(object_path,'') IS NOT NULL) INTO has_proof;
  PERFORM plugin_data.csf_assert_point_submission_row_eligibility(s.id,s.organization_id,s.profile_id,s.term_id,s.opportunity_id,s.partner_club_term_id,s.source,points,category,has_proof OR p_has_replacement,false,false);
  SELECT * INTO s FROM plugin_data.csf_point_submissions WHERE id=p_submission_id AND organization_id=p_organization_id FOR UPDATE;
  IF p_expected_revision IS NULL OR s.revision<>p_expected_revision OR s.status NOT IN ('submitted','needs_action') THEN RAISE EXCEPTION 'This submission changed or was reviewed. Reload before editing.' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM plugin_data.csf_review_periods r WHERE r.organization_id=p_organization_id AND r.term_id=s.term_id AND r.kind='member_points' AND r.status='open'
    AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_review_decisions d WHERE d.organization_id=p_organization_id AND d.period_id=r.id AND d.subject_kind='profile' AND d.subject_id=s.profile_id AND d.submission_lock_override)) THEN
    RAISE EXCEPTION 'Point submissions are locked while officers verify this semester.';
  END IF;
  IF s.opportunity_id IS NOT NULL THEN
    SELECT * INTO a FROM plugin_data.csf_opportunities WHERE id=s.opportunity_id AND organization_id=p_organization_id;
    IF a.starts_at>now() THEN RAISE EXCEPTION 'Wait until this activity starts before submitting points.'; END IF;
    rules:=plugin_data.csf_effective_earning_rules(a.earning_rules,a.point_value,a.point_type);
    IF rules IS NOT NULL THEN
      selection:=coalesce(nullif(p_intent->'earningSelection','null'::jsonb),CASE WHEN s.earning_rules_version IS NOT DISTINCT FROM a.earning_rules_version THEN s.earning_selection END,plugin_data.csf_default_earning_selection(rules));
      IF selection IS NULL THEN RAISE EXCEPTION 'Choose what you did for this activity.'; END IF;
      calculation:=plugin_data.csf_calculate_earning(rules,selection);
      IF rules->'legacy' IS DISTINCT FROM 'true'::jsonb AND (round(points,2) IS DISTINCT FROM (calculation->>'points')::numeric OR category IS DISTINCT FROM calculation->>'pointType') THEN RAISE EXCEPTION 'Points must match the selected earning components.'; END IF;
      PERFORM plugin_data.csf_assert_activity_earning_award(p_organization_id,s.profile_id,s.opportunity_id,s.id,points,rules,selection);
    END IF;
  END IF;
  RETURN jsonb_build_object('rules',rules,'selection',selection,'rulesVersion',a.earning_rules_version,'suggestedPoints',calculation->'suggestedPoints');
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_validate_submission_edit(uuid,uuid,uuid,bigint,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_validate_submission_edit(uuid,uuid,uuid,bigint,jsonb,boolean) TO postgres;

CREATE FUNCTION plugin_data.csf_begin_submission_edit(p_organization_id uuid,p_submission_id uuid,p_actor_user_id uuid,p_request_id uuid,p_expected_revision bigint,p_intent jsonb,p_proof jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r plugin_data.csf_submission_edit_requests%ROWTYPE; fingerprint text;
BEGIN
  IF p_request_id IS NULL OR jsonb_typeof(p_intent) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'A complete edit request is required.'; END IF;
  PERFORM plugin_data.csf_assert_point_actor_authority(p_organization_id,p_actor_user_id,ARRAY[]::text[]);
  PERFORM 1 FROM plugin_data.csf_point_submissions owned JOIN plugin_data.csf_profile_accounts a ON a.profile_id=owned.profile_id AND a.organization_id=owned.organization_id
    WHERE owned.id=p_submission_id AND owned.organization_id=p_organization_id AND a.user_id=p_actor_user_id AND a.status='verified' AND owned.source='student';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the connected member may edit this submission.' USING ERRCODE='42501'; END IF;
  fingerprint:=plugin_data.csf_point_request_fingerprint('edit_submission',p_organization_id,p_actor_user_id,jsonb_build_object('submissionId',p_submission_id,'revision',p_expected_revision,'intent',p_intent,'proof',p_proof));
  PERFORM pg_advisory_xact_lock(hashtextextended('csf_submission_edit:'||p_request_id::text,0));
  SELECT * INTO r FROM plugin_data.csf_submission_edit_requests WHERE request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF r.fingerprint IS DISTINCT FROM fingerprint OR r.organization_id<>p_organization_id OR r.actor_user_id<>p_actor_user_id THEN RAISE EXCEPTION 'This edit request belongs to different changes.'; END IF;
    IF r.status='committed' THEN RETURN r.result||jsonb_build_object('status','committed'); END IF;
    IF r.status='expired' THEN RAISE EXCEPTION 'This edit upload expired. Reload before editing.' USING ERRCODE='40001'; END IF;
  END IF;
  IF p_proof IS NOT NULL AND (jsonb_typeof(p_proof) IS DISTINCT FROM 'object' OR coalesce(p_proof->>'sha256','') !~ '^[0-9a-f]{64}$' OR coalesce(p_proof->>'mimeType','') NOT IN ('image/jpeg','image/png','image/webp','image/heic','application/pdf') OR coalesce((p_proof->>'size')::bigint,0) NOT BETWEEN 1 AND 10485760 OR length(coalesce(p_proof->>'filename','')) NOT BETWEEN 1 AND 255) THEN RAISE EXCEPTION 'Validated proof metadata and digest are required.'; END IF;
  PERFORM plugin_data.csf_validate_submission_edit(p_organization_id,p_submission_id,p_actor_user_id,p_expected_revision,p_intent,p_proof IS NOT NULL);
  IF r.request_id IS NULL THEN
    INSERT INTO plugin_data.csf_submission_edit_requests(request_id,organization_id,submission_id,actor_user_id,expected_revision,fingerprint,intent,proof,object_path)
    VALUES(p_request_id,p_organization_id,p_submission_id,p_actor_user_id,p_expected_revision,fingerprint,p_intent,p_proof,
      CASE WHEN p_proof IS NOT NULL THEN 'dvhs-csf/'||p_organization_id||'/submission-edits/'||p_request_id||'/'||gen_random_uuid()||'-proof' END) RETURNING * INTO r;
  END IF;
  UPDATE plugin_data.csf_submission_edit_requests SET created_at=now() WHERE request_id=p_request_id;
  RETURN jsonb_build_object('status','pending','submissionId',p_submission_id,'objectPath',r.object_path,'proofSha256',r.proof->>'sha256');
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_begin_submission_edit(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_submission_edit(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb) TO service_role;

CREATE FUNCTION plugin_data.csf_commit_submission_edit(p_organization_id uuid,p_submission_id uuid,p_actor_user_id uuid,p_request_id uuid,p_verified_sha256 text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r plugin_data.csf_submission_edit_requests%ROWTYPE; s plugin_data.csf_point_submissions%ROWTYPE; earning jsonb; v_result jsonb;
BEGIN
  PERFORM plugin_data.csf_assert_point_actor_authority(p_organization_id,p_actor_user_id,ARRAY[]::text[]);
  PERFORM 1 FROM plugin_data.csf_point_submissions owned JOIN plugin_data.csf_profile_accounts a ON a.profile_id=owned.profile_id AND a.organization_id=owned.organization_id
    WHERE owned.id=p_submission_id AND owned.organization_id=p_organization_id AND a.user_id=p_actor_user_id AND a.status='verified' AND owned.source='student';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the connected member may edit this submission.' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('csf_submission_edit:'||p_request_id::text,0));
  SELECT * INTO r FROM plugin_data.csf_submission_edit_requests WHERE request_id=p_request_id AND organization_id=p_organization_id AND submission_id=p_submission_id AND actor_user_id=p_actor_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The staged edit was not found.'; END IF;
  IF r.status='committed' THEN RETURN r.result; END IF;
  IF r.status<>'pending' THEN RAISE EXCEPTION 'This edit upload expired. Reload before editing.' USING ERRCODE='40001'; END IF;
  earning:=plugin_data.csf_validate_submission_edit(p_organization_id,p_submission_id,p_actor_user_id,r.expected_revision,r.intent,r.proof IS NOT NULL);
  SELECT * INTO s FROM plugin_data.csf_point_submissions WHERE id=p_submission_id AND organization_id=p_organization_id FOR UPDATE;
  IF r.proof IS NOT NULL THEN
    IF p_verified_sha256 IS DISTINCT FROM r.proof->>'sha256' OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='plugins' AND name=r.object_path AND (metadata->>'size')::bigint=(r.proof->>'size')::bigint) THEN RAISE EXCEPTION 'The replacement proof has not been verified.'; END IF;
    UPDATE plugin_data.csf_submission_files SET superseded_at=now() WHERE organization_id=p_organization_id AND submission_id=p_submission_id AND superseded_at IS NULL;
    INSERT INTO plugin_data.csf_submission_files(id,organization_id,submission_id,profile_id,term_id,bucket,object_path,original_filename,mime_type,size_bytes,uploaded_by,upload_status,upload_correlation_id,finalized_at)
    VALUES(r.file_id,p_organization_id,p_submission_id,s.profile_id,s.term_id,'plugins',r.object_path,r.proof->>'filename',r.proof->>'mimeType',(r.proof->>'size')::bigint,p_actor_user_id,'finalized',p_request_id,now());
  END IF;
  UPDATE plugin_data.csf_point_submissions SET description=btrim(r.intent->>'description'),claimed_points=(r.intent->>'claimedPoints')::numeric,point_type=r.intent->>'pointType',activity_date=nullif(r.intent->>'activityDate','')::date,
    earning_rules_snapshot=nullif(earning->'rules','null'::jsonb),earning_selection=nullif(earning->'selection','null'::jsonb),earning_rules_version=(earning->>'rulesVersion')::integer,suggested_points=(earning->>'suggestedPoints')::numeric,
    status='submitted',submitted_at=now(),submitted_by=p_actor_user_id,reviewed_at=NULL,reviewed_by=NULL,review_notes=NULL,updated_at=now()
    WHERE id=p_submission_id AND organization_id=p_organization_id;
  v_result:=jsonb_build_object('submissionId',p_submission_id,'revision',s.revision+1,'status','submitted');
  INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,actor_profile_id,action,target_type,target_id,term_id,before_data,after_data,correlation_id,source_type,source_id,reason_code)
    VALUES(p_organization_id,p_actor_user_id,s.profile_id,'point_submission.revised','csf_point_submissions',p_submission_id,s.term_id,to_jsonb(s),jsonb_build_object('intent',r.intent,'earning',earning,'replacementFileId',CASE WHEN r.proof IS NOT NULL THEN r.file_id END,'result',v_result),p_request_id,'point_submission_revision',p_submission_id::text,'member_submission_edit');
  INSERT INTO plugin_data.csf_submission_reviews(organization_id,submission_id,actor_user_id,action,previous_status,next_status,notes,details)
    VALUES(p_organization_id,p_submission_id,p_actor_user_id,'resubmitted',s.status,'submitted','Member edited this submission.',jsonb_build_object('requestId',p_request_id,'previousRevision',s.revision,'revision',s.revision+1));
  UPDATE plugin_data.csf_submission_edit_requests SET status='committed',result=v_result,prior_data=to_jsonb(s),committed_at=now() WHERE request_id=p_request_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_submission_edit(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_submission_edit(uuid,uuid,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_enqueue_stale_submission_proof_cleanup(p_cutoff timestamp with time zone, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_file record;
  v_count integer := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 250), 1), 500);
  v_now timestamptz := now();
BEGIN
  IF p_cutoff IS NULL OR p_cutoff > v_now - interval '5 minutes' THEN
    RAISE EXCEPTION 'Stale-proof cutoff must be at least five minutes old.';
  END IF;

  FOR v_file IN
    SELECT proof.*, submission.profile_id AS submission_profile_id,
      submission.term_id AS submission_term_id, submission.status AS submission_status
    FROM plugin_data.csf_submission_files AS proof
    JOIN plugin_data.csf_point_submissions AS submission
      ON submission.id = proof.submission_id
      AND submission.organization_id = proof.organization_id
    WHERE proof.upload_status = 'pending'
      AND proof.created_at <= p_cutoff
    ORDER BY proof.created_at, proof.id
    LIMIT v_limit
    FOR UPDATE OF proof SKIP LOCKED
  LOOP
    UPDATE plugin_data.csf_submission_files
    SET upload_status = 'failed', failed_at = v_now, finalized_at = NULL,
        last_error = 'Proof upload expired before finalization.', updated_at = v_now
    WHERE id = v_file.id AND organization_id = v_file.organization_id;

    IF v_file.submission_status = 'draft' THEN
      UPDATE plugin_data.csf_point_submissions
      SET status = 'withdrawn', updated_at = v_now
      WHERE id = v_file.submission_id
        AND organization_id = v_file.organization_id;
    END IF;

    INSERT INTO plugin_data.csf_storage_deletion_queue (
      organization_id, submission_file_id, bucket, object_path
    ) VALUES (
      v_file.organization_id, v_file.id, v_file.bucket, v_file.object_path
    ) ON CONFLICT (bucket, object_path) DO NOTHING;

    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_profile_id, action, target_type, target_id, term_id,
      before_data, after_data, correlation_id, source_type, source_id, reason_code
    ) VALUES (
      v_file.organization_id, v_file.submission_profile_id,
      'point_submission.proof_abandoned', 'csf_point_submissions', v_file.submission_id,
      v_file.submission_term_id,
      jsonb_build_object('status', v_file.submission_status, 'proofStatus', 'pending'),
      jsonb_build_object('status', 'withdrawn', 'proofStatus', 'failed'),
      v_file.upload_correlation_id, 'point_submission', v_file.submission_id::text,
      'point_proof_upload_abandoned'
    );
    v_count := v_count + 1;
  END LOOP;

  FOR v_file IN SELECT * FROM plugin_data.csf_submission_edit_requests WHERE status='pending' AND created_at<=least(p_cutoff,v_now-interval '24 hours') ORDER BY created_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE plugin_data.csf_submission_edit_requests SET status='expired' WHERE request_id=v_file.request_id;
    IF v_file.object_path IS NOT NULL THEN
      INSERT INTO plugin_data.csf_storage_deletion_queue(organization_id,bucket,object_path) VALUES(v_file.organization_id,'plugins',v_file.object_path) ON CONFLICT(bucket,object_path) DO NOTHING;
      v_count:=v_count+1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('enqueued' , v_count, 'cutoff', p_cutoff);
END;
$function$;


REVOKE ALL ON FUNCTION plugin_data.csf_enqueue_stale_submission_proof_cleanup(timestamptz,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_enqueue_stale_submission_proof_cleanup(timestamptz,integer) TO service_role;

-- Bind an officer decision to the exact submission revision they inspected.

CREATE FUNCTION plugin_data.csf_review_point_submission_revision_request(
  p_organization_id uuid, p_submission_id uuid, p_action text,
  p_awarded_points numeric, p_review_notes text, p_actor_user_id uuid,
  p_request_id uuid, p_expected_revision bigint, p_awarded_point_type text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  s plugin_data.csf_point_submissions%ROWTYPE;
  receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  fingerprint text; result jsonb; resulting_revision bigint;
BEGIN
  PERFORM plugin_data.csf_assert_point_actor_authority(p_organization_id,p_actor_user_id,ARRAY['verify_submissions']::text[]);
  IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 THEN
    RAISE EXCEPTION 'Reload this submission before reviewing its current revision.' USING ERRCODE='40001';
  END IF;
  SELECT * INTO s FROM plugin_data.csf_point_submissions WHERE organization_id=p_organization_id AND id=p_submission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Point submission was not found.'; END IF;
  fingerprint:=plugin_data.csf_point_request_fingerprint('review_submission_revision',p_organization_id,p_actor_user_id,
    jsonb_build_object('submissionId',p_submission_id,'expectedRevision',p_expected_revision,'action',p_action,'points',p_awarded_points,'notes',p_review_notes,'pointType',p_awarded_point_type));
  PERFORM pg_advisory_xact_lock(hashtextextended('plugin_data.csf_point_action_request:'||p_organization_id::text||':'||p_request_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||s.term_id::text,0));
  SELECT * INTO s FROM plugin_data.csf_point_submissions WHERE organization_id=p_organization_id AND id=p_submission_id FOR UPDATE;
  SELECT * INTO receipt FROM plugin_data.csf_admin_audit_events WHERE organization_id=p_organization_id AND correlation_id=p_request_id AND source_type='point_review_revision' LIMIT 1;
  IF FOUND THEN
    IF receipt.actor_user_id IS DISTINCT FROM p_actor_user_id OR receipt.target_id IS DISTINCT FROM p_submission_id OR receipt.after_data->>'fingerprint' IS DISTINCT FROM fingerprint THEN
      RAISE EXCEPTION 'That point request identifier is already bound to a different change.';
    END IF;
    IF s.revision IS DISTINCT FROM (receipt.after_data->>'resultingRevision')::bigint THEN
      RAISE EXCEPTION 'This submission changed. Reload its details and proof before reviewing.' USING ERRCODE='40001';
    END IF;
  ELSIF s.revision<>p_expected_revision OR s.status<>'submitted' THEN
    RAISE EXCEPTION 'This submission changed. Reload its details and proof before reviewing.' USING ERRCODE='40001';
  END IF;
  IF s.request_kind='exception' AND p_action='approved' THEN
    result:=plugin_data.csf_review_point_exception_request(p_organization_id,p_submission_id,p_action,p_awarded_points,p_review_notes,p_actor_user_id,p_request_id,p_awarded_point_type);
  ELSE
    result:=plugin_data.csf_review_point_submission_request(p_organization_id,p_submission_id,p_action,p_awarded_points,p_review_notes,p_actor_user_id,p_request_id);
  END IF;
  IF receipt.id IS NULL THEN
    SELECT revision INTO resulting_revision FROM plugin_data.csf_point_submissions WHERE id=p_submission_id AND organization_id=p_organization_id;
    INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,actor_profile_id,action,target_type,target_id,term_id,before_data,after_data,correlation_id,source_type,source_id,reason_code)
    VALUES(p_organization_id,p_actor_user_id,s.profile_id,'point_submission.revision_reviewed','csf_point_submissions',p_submission_id,s.term_id,
      jsonb_build_object('revision',p_expected_revision),jsonb_build_object('fingerprint',fingerprint,'resultingRevision',resulting_revision),p_request_id,'point_review_revision',p_submission_id::text,'officer_review_revision_fence');
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_review_point_submission_revision_request(uuid,uuid,text,numeric,text,uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_submission_revision_request(uuid,uuid,text,numeric,text,uuid,uuid,bigint,text) TO service_role;
COMMIT;
