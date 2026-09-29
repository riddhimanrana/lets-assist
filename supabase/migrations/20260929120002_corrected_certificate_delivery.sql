-- An explicit corrected-certificate send gets its own revision-bound receipt.
-- Original publication retries keep their original provider idempotency key.
BEGIN;
ALTER TABLE public.hours_publication_email_outbox
  ADD COLUMN delivery_revision integer NOT NULL DEFAULT 0 CHECK (delivery_revision >= 0),
  ADD COLUMN certificate_snapshot jsonb CHECK (certificate_snapshot IS NULL OR
    (jsonb_typeof(certificate_snapshot)='object' AND octet_length(certificate_snapshot::text)<=16384));
ALTER TABLE public.hours_publication_email_outbox DROP CONSTRAINT hours_publication_email_outbox_certificate_key;
ALTER TABLE public.hours_publication_email_outbox ADD CONSTRAINT hours_publication_email_outbox_certificate_revision_key UNIQUE(certificate_id,delivery_revision);

DO $update_initial_delivery_conflicts$
DECLARE v_signature text; v_definition text; v_updated text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'private.publish_volunteer_hours_transactional_legacy_status_fallback(uuid,uuid,text,jsonb,text)',
    'app_private.issue_verified_certificate_for_late_attendance()'
  ] LOOP
    SELECT pg_get_functiondef(v_signature::regprocedure) INTO v_definition;
    v_updated:=replace(v_definition,'ON CONFLICT (certificate_id) DO NOTHING','ON CONFLICT (certificate_id, delivery_revision) DO NOTHING');
    IF v_updated=v_definition THEN RAISE EXCEPTION 'reviewed initial delivery function changed: %',v_signature; END IF;
    EXECUTE v_updated;
  END LOOP;
END;
$update_initial_delivery_conflicts$;
REVOKE ALL ON FUNCTION private.publish_volunteer_hours_transactional_legacy_status_fallback(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.publish_volunteer_hours_transactional_legacy_status_fallback(uuid,uuid,text,jsonb,text) TO postgres;
REVOKE ALL ON FUNCTION app_private.issue_verified_certificate_for_late_attendance() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.issue_verified_certificate_for_late_attendance() TO postgres;

CREATE FUNCTION private.protect_corrected_certificate_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.certificate_snapshot IS DISTINCT FROM OLD.certificate_snapshot
    OR NEW.delivery_revision IS DISTINCT FROM OLD.delivery_revision
    OR NEW.certificate_id IS DISTINCT FROM OLD.certificate_id
    OR NEW.receipt_id IS DISTINCT FROM OLD.receipt_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'certificate delivery identity and snapshot are immutable' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_corrected_certificate_snapshot() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.protect_corrected_certificate_snapshot() TO postgres;
CREATE TRIGGER protect_corrected_certificate_snapshot BEFORE UPDATE ON public.hours_publication_email_outbox
FOR EACH ROW EXECUTE FUNCTION private.protect_corrected_certificate_snapshot();

CREATE TABLE private.corrected_certificate_delivery_requests (
  request_id uuid PRIMARY KEY,
  request_hash text NOT NULL,
  receipt_id uuid NOT NULL REFERENCES public.hours_publication_receipts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.corrected_certificate_delivery_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.corrected_certificate_delivery_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT ALL ON private.corrected_certificate_delivery_requests TO postgres;

CREATE FUNCTION public.request_corrected_certificate_delivery(p_project_id uuid,p_certificate_id uuid,p_expected_revision integer,p_request_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_certificate public.certificates%ROWTYPE;
  v_receipt public.hours_publication_receipts%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_request_key text;
  v_request_hash text;
  v_prior private.corrected_certificate_delivery_requests%ROWTYPE;
  v_publish_key text;
  v_snapshot jsonb;
BEGIN
  IF p_request_id IS NULL OR p_actor_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1 THEN
    RAISE EXCEPTION 'invalid corrected certificate request' USING ERRCODE='22023';
  END IF;
  IF NOT private.lock_attendance_management(p_project_id,p_actor_id) THEN
    RAISE EXCEPTION 'not authorized to send corrected certificate' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT v_project FROM public.projects WHERE id=p_project_id;
  SELECT * INTO v_certificate FROM public.certificates WHERE id=p_certificate_id AND project_id=p_project_id AND (type='verified' OR type IS NULL) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'verified certificate not found' USING ERRCODE='22023'; END IF;
  v_request_key:='hours-publication:v1:'||encode(extensions.digest('corrected-certificate:'||p_request_id::text,'sha256'),'hex');
  v_request_hash:=encode(extensions.digest(jsonb_build_object('projectId',p_project_id,'certificateId',p_certificate_id,
    'attendanceRevision',p_expected_revision,'actorId',p_actor_id)::text,'sha256'),'hex');
  SELECT * INTO v_prior FROM private.corrected_certificate_delivery_requests WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_prior.request_hash<>v_request_hash THEN RAISE EXCEPTION 'corrected certificate request key reused' USING ERRCODE='22023'; END IF;
    RETURN private.hours_publication_result(v_prior.receipt_id,'replayed');
  END IF;
  IF v_certificate.attendance_revision<>p_expected_revision THEN
    RAISE EXCEPTION 'certificate changed; refresh before sending' USING ERRCODE='40001';
  END IF;
  v_publish_key:='certificate-correction:'||p_certificate_id::text||':'||p_expected_revision::text;
  SELECT * INTO v_receipt FROM public.hours_publication_receipts WHERE project_id=p_project_id AND publish_key=v_publish_key;
  IF FOUND THEN
    INSERT INTO private.corrected_certificate_delivery_requests(request_id,request_hash,receipt_id)
      VALUES(p_request_id,v_request_hash,v_receipt.id);
    RETURN private.hours_publication_result(v_receipt.id,'replayed');
  END IF;
  IF v_certificate.credited_minutes IS NULL OR NOT EXISTS(
    SELECT 1 FROM private.project_attendance_changes changes WHERE changes.signup_id=v_certificate.signup_id
      AND changes.new_revision=p_expected_revision AND changes.old_credited_minutes IS NOT NULL
  ) THEN RAISE EXCEPTION 'certificate has no reviewed award correction' USING ERRCODE='22023'; END IF;
  v_snapshot:=jsonb_build_object('volunteerName',v_certificate.volunteer_name,'volunteerEmail',v_certificate.volunteer_email,
    'eventStart',v_certificate.event_start,'eventEnd',v_certificate.event_end,'creditedMinutes',v_certificate.credited_minutes,
    'attendanceRevision',v_certificate.attendance_revision,'projectTitle',v_certificate.project_title,'projectTimezone',v_project.project_timezone);
  INSERT INTO public.hours_publication_receipts(project_id,schedule_id,publish_key,request_key,request_hash,requested_by,certificate_count,email_work_count)
    VALUES(p_project_id,v_certificate.schedule_id,v_publish_key,v_request_key,v_request_hash,p_actor_id,1,1) RETURNING * INTO v_receipt;
  INSERT INTO public.hours_publication_email_outbox(receipt_id,certificate_id,idempotency_key,delivery_revision,certificate_snapshot,state,settled_at,safe_code)
    VALUES(v_receipt.id,p_certificate_id,'hours-correction:v1:certificate:'||p_certificate_id::text||':revision:'||p_expected_revision::text,
      p_expected_revision,v_snapshot,
      CASE WHEN NULLIF(btrim(v_certificate.volunteer_email),'') IS NULL OR NULLIF(btrim(v_certificate.volunteer_name),'') IS NULL THEN 'skipped' ELSE 'queued' END,
      CASE WHEN NULLIF(btrim(v_certificate.volunteer_email),'') IS NULL OR NULLIF(btrim(v_certificate.volunteer_name),'') IS NULL THEN now() ELSE NULL END,
      CASE WHEN NULLIF(btrim(v_certificate.volunteer_email),'') IS NULL OR NULLIF(btrim(v_certificate.volunteer_name),'') IS NULL THEN 'recipient_missing' ELSE NULL END);
  INSERT INTO private.corrected_certificate_delivery_requests(request_id,request_hash,receipt_id)
    VALUES(p_request_id,v_request_hash,v_receipt.id);
  RETURN private.hours_publication_result(v_receipt.id,'accepted');
END;
$$;
REVOKE ALL ON FUNCTION public.request_corrected_certificate_delivery(uuid,uuid,integer,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.request_corrected_certificate_delivery(uuid,uuid,integer,uuid,uuid) TO service_role;

-- The Hours page lists only awards with a correction at their current revision.
CREATE FUNCTION public.project_corrected_certificate_ids(p_project_id uuid,p_actor_id uuid)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ids uuid[];
BEGIN
  IF NOT private.lock_attendance_management(p_project_id,p_actor_id) THEN
    RAISE EXCEPTION 'not authorized to read corrected certificates' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(array_agg(certificates.id ORDER BY certificates.id),ARRAY[]::uuid[]) INTO v_ids
  FROM public.certificates certificates
  WHERE certificates.project_id=p_project_id AND (certificates.type='verified' OR certificates.type IS NULL)
    AND certificates.credited_minutes IS NOT NULL
    AND EXISTS(SELECT 1 FROM private.project_attendance_changes changes
      WHERE changes.signup_id=certificates.signup_id
        AND changes.new_revision=certificates.attendance_revision
        AND changes.old_credited_minutes IS NOT NULL);
  RETURN v_ids;
END;
$$;
REVOKE ALL ON FUNCTION public.project_corrected_certificate_ids(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.project_corrected_certificate_ids(uuid,uuid) TO service_role;

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
    'projectTitle', COALESCE(max(outbox.certificate_snapshot->>'projectTitle'),projects.title),
    'projectTimezone', CASE WHEN bool_or(outbox.certificate_snapshot IS NOT NULL) THEN max(outbox.certificate_snapshot->>'projectTimezone') ELSE projects.project_timezone END,
    'publicationOrigin', receipts.publication_origin,
    'deliveries', COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'deliveryId', outbox.id,
          'state', outbox.state,
          'payloadPrepared', outbox.payload_snapshot IS NOT NULL,
          'idempotencyKey', outbox.idempotency_key,
          'certificateId', certificates.id,
          'volunteerName', CASE WHEN outbox.certificate_snapshot IS NOT NULL THEN outbox.certificate_snapshot->'volunteerName' ELSE to_jsonb(certificates.volunteer_name) END,
          'volunteerEmail', CASE WHEN outbox.certificate_snapshot IS NOT NULL THEN outbox.certificate_snapshot->'volunteerEmail' ELSE to_jsonb(certificates.volunteer_email) END,
          'eventStart', CASE WHEN outbox.certificate_snapshot IS NOT NULL THEN outbox.certificate_snapshot->'eventStart' ELSE to_jsonb(certificates.event_start) END,
          'eventEnd', CASE WHEN outbox.certificate_snapshot IS NOT NULL THEN outbox.certificate_snapshot->'eventEnd' ELSE to_jsonb(certificates.event_end) END,
          'creditedMinutes', CASE WHEN outbox.certificate_snapshot IS NOT NULL THEN outbox.certificate_snapshot->'creditedMinutes' ELSE to_jsonb(certificates.credited_minutes) END,
          'attendanceRevision', CASE WHEN outbox.certificate_snapshot IS NOT NULL THEN outbox.certificate_snapshot->'attendanceRevision' ELSE to_jsonb(certificates.attendance_revision) END
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

CREATE OR REPLACE FUNCTION public.prepare_hours_publication_email_delivery(
  p_delivery_id uuid,
  p_sender text DEFAULT NULL,
  p_subject text DEFAULT NULL,
  p_html text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_outbox public.hours_publication_email_outbox%ROWTYPE;
  v_recipient text;
  v_snapshot jsonb;
  v_hash text;
BEGIN
  IF p_delivery_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT outbox.*
  INTO v_outbox
  FROM public.hours_publication_email_outbox AS outbox
  WHERE outbox.id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_outbox.payload_snapshot IS NOT NULL THEN
    v_hash := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(v_outbox.payload_snapshot::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    IF v_outbox.payload_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION USING ERRCODE = '22000', MESSAGE = 'durable email payload integrity check failed';
    END IF;
    RETURN v_outbox.payload_snapshot;
  END IF;

  SELECT CASE WHEN v_outbox.certificate_snapshot IS NOT NULL THEN v_outbox.certificate_snapshot->>'volunteerEmail' ELSE certificates.volunteer_email END
  INTO v_recipient
  FROM public.certificates AS certificates
  WHERE certificates.id = v_outbox.certificate_id;

  IF NULLIF(pg_catalog.btrim(v_recipient), '') IS NULL
    OR char_length(v_recipient) > 320
    OR NULLIF(pg_catalog.btrim(p_sender), '') IS NULL
    OR char_length(p_sender) > 500
    OR NULLIF(pg_catalog.btrim(p_subject), '') IS NULL
    OR char_length(p_subject) > 998
    OR NULLIF(p_html, '') IS NULL
    OR pg_catalog.octet_length(p_html) > 1000000
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid durable email payload';
  END IF;

  v_snapshot := pg_catalog.jsonb_build_object(
    'version', 1,
    'to', v_recipient,
    'from', p_sender,
    'subject', p_subject,
    'html', p_html,
    'tags', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'name', 'workflow',
        'value', 'volunteer-hours-publication'
      ),
      pg_catalog.jsonb_build_object(
        'name', 'receipt',
        'value', v_outbox.receipt_id::text
      )
    )
  );
  v_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_snapshot::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  UPDATE public.hours_publication_email_outbox
  SET
    payload_snapshot = v_snapshot,
    payload_hash = v_hash,
    payload_prepared_at = now(),
    updated_at = now()
  WHERE id = p_delivery_id;

  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_hours_publication_email_delivery(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_hours_publication_email_delivery(uuid,text,text,text) TO service_role;
COMMIT;
