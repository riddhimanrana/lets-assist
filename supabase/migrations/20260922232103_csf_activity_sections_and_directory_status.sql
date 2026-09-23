BEGIN;

CREATE TABLE plugin_data.csf_activity_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  term_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 100),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id, term_id),
  FOREIGN KEY (term_id, organization_id) REFERENCES plugin_data.csf_terms(id, organization_id) ON DELETE CASCADE
);
CREATE TABLE plugin_data.csf_activity_layouts (
  organization_id uuid NOT NULL,
  term_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, term_id),
  FOREIGN KEY (term_id, organization_id) REFERENCES plugin_data.csf_terms(id, organization_id) ON DELETE CASCADE
);
ALTER TABLE plugin_data.csf_activity_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_activity_layouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_activity_sections, plugin_data.csf_activity_layouts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON plugin_data.csf_activity_sections, plugin_data.csf_activity_layouts TO service_role;
CREATE INDEX csf_activity_sections_term_order ON plugin_data.csf_activity_sections(organization_id, term_id, position, id);
ALTER TABLE plugin_data.csf_opportunities
  ADD COLUMN section_id uuid,
  ADD COLUMN section_position integer NOT NULL DEFAULT 2147483647,
  ADD COLUMN catalog_position bigint NOT NULL DEFAULT 2147483647,
  ADD CONSTRAINT csf_activity_section_scope FOREIGN KEY(section_id, organization_id, term_id)
    REFERENCES plugin_data.csf_activity_sections(id, organization_id, term_id);
CREATE INDEX csf_opportunity_catalog_order ON plugin_data.csf_opportunities(organization_id, term_id, catalog_position, id);

CREATE FUNCTION plugin_data.csf_edit_activity_layout(
  p_organization_id uuid, p_term_id uuid, p_actor_user_id uuid,
  p_request_id uuid, p_expected_revision bigint, p_operation text, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_revision bigint;
  v_id uuid;
  v_section uuid;
  v_before uuid;
  v_title text;
  v_ids uuid[];
  v_index integer;
  v_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_result jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM 1 FROM public.organization_members WHERE organization_id=p_organization_id AND user_id=p_actor_user_id AND status='active' FOR SHARE;
  IF NOT FOUND OR plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_opportunities') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to organize activities.' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM plugin_data.csf_terms WHERE id=p_term_id AND organization_id=p_organization_id AND lifecycle_status IN ('planned','open') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an open semester in this chapter.'; END IF;
  IF p_request_id IS NULL OR p_expected_revision IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'A complete layout request is required.'; END IF;
  v_fingerprint := encode(extensions.digest(jsonb_build_object('term',p_term_id,'revision',p_expected_revision,'operation',p_operation,'payload',p_payload)::text,'sha256'),'hex');
  SELECT * INTO v_receipt FROM plugin_data.csf_admin_audit_events WHERE organization_id=p_organization_id AND correlation_id=p_request_id AND action='activity.layout_updated' LIMIT 1;
  IF FOUND THEN
    IF v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id OR v_receipt.after_data->>'requestFingerprint' IS DISTINCT FROM v_fingerprint THEN RAISE EXCEPTION 'That request belongs to a different change.'; END IF;
    RETURN v_receipt.after_data->'result';
  END IF;
  INSERT INTO plugin_data.csf_activity_layouts(organization_id,term_id) VALUES(p_organization_id,p_term_id) ON CONFLICT DO NOTHING;
  SELECT revision INTO v_revision FROM plugin_data.csf_activity_layouts WHERE organization_id=p_organization_id AND term_id=p_term_id FOR UPDATE;
  IF v_revision <> p_expected_revision THEN RAISE EXCEPTION 'Activities changed. Reload before organizing them.' USING ERRCODE='40001'; END IF;
  v_id := nullif(p_payload->>'id','')::uuid;
  v_before := nullif(p_payload->>'beforeId','')::uuid;
  v_section := nullif(p_payload->>'sectionId','')::uuid;
  v_title := nullif(btrim(p_payload->>'title'),'');
  IF p_operation IN ('create_section','rename_section') AND (v_title IS NULL OR length(v_title)>100) THEN RAISE EXCEPTION 'Name the section in 1 to 100 characters.'; END IF;
  IF p_operation = 'create_section' THEN
    IF (SELECT count(*) FROM plugin_data.csf_activity_sections WHERE organization_id=p_organization_id AND term_id=p_term_id)>=100 THEN RAISE EXCEPTION 'This semester already has 100 sections.'; END IF;
    INSERT INTO plugin_data.csf_activity_sections(organization_id,term_id,title,position) SELECT p_organization_id,p_term_id,v_title,coalesce(max(position),0)+1 FROM plugin_data.csf_activity_sections WHERE organization_id=p_organization_id AND term_id=p_term_id RETURNING id INTO v_id;
  ELSIF p_operation IN ('rename_section','delete_section','move_section') THEN
    PERFORM 1 FROM plugin_data.csf_activity_sections WHERE id=v_id AND organization_id=p_organization_id AND term_id=p_term_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That section is no longer available.'; END IF;
    IF p_operation='rename_section' THEN UPDATE plugin_data.csf_activity_sections SET title=v_title WHERE id=v_id;
    ELSIF p_operation='delete_section' THEN
      UPDATE plugin_data.csf_opportunities SET section_id=NULL,section_position=2147483647 WHERE section_id=v_id AND organization_id=p_organization_id AND term_id=p_term_id;
      DELETE FROM plugin_data.csf_activity_sections WHERE id=v_id;
    ELSE
      SELECT coalesce(array_agg(id ORDER BY position,id),'{}'::uuid[]) INTO v_ids FROM plugin_data.csf_activity_sections WHERE organization_id=p_organization_id AND term_id=p_term_id AND id<>v_id;
    END IF;
  ELSIF p_operation='move_activity' THEN
    PERFORM 1 FROM plugin_data.csf_opportunities WHERE id=v_id AND organization_id=p_organization_id AND term_id=p_term_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That activity is no longer available.'; END IF;
    IF v_section IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_activity_sections WHERE id=v_section AND organization_id=p_organization_id AND term_id=p_term_id) THEN RAISE EXCEPTION 'Choose a section in this semester.'; END IF;
    UPDATE plugin_data.csf_opportunities SET section_id=v_section WHERE id=v_id;
    SELECT coalesce(array_agg(id ORDER BY section_position,created_at,id),'{}'::uuid[]) INTO v_ids FROM plugin_data.csf_opportunities WHERE organization_id=p_organization_id AND term_id=p_term_id AND section_id IS NOT DISTINCT FROM v_section AND id<>v_id;
  ELSE RAISE EXCEPTION 'Unknown activity layout operation.';
  END IF;
  IF p_operation IN ('move_section','move_activity') THEN
    v_index := CASE WHEN v_before IS NULL THEN cardinality(v_ids)+1 ELSE array_position(v_ids,v_before) END;
    IF v_index IS NULL THEN RAISE EXCEPTION 'The target position changed. Reload the activities.'; END IF;
    v_ids := coalesce(v_ids[1:v_index-1],'{}'::uuid[]) || ARRAY[v_id] || coalesce(v_ids[v_index:cardinality(v_ids)],'{}'::uuid[]);
    IF p_operation='move_section' THEN
      UPDATE plugin_data.csf_activity_sections s SET position=r.n FROM unnest(v_ids) WITH ORDINALITY r(id,n) WHERE s.id=r.id;
    ELSE
      UPDATE plugin_data.csf_opportunities a SET section_position=r.n FROM unnest(v_ids) WITH ORDINALITY r(id,n) WHERE a.id=r.id;
    END IF;
  END IF;
  WITH ordered AS (SELECT a.id,row_number() OVER(ORDER BY coalesce(s.position,2147483647),s.id NULLS LAST,a.section_position,a.created_at,a.id) AS n FROM plugin_data.csf_opportunities a LEFT JOIN plugin_data.csf_activity_sections s ON s.id=a.section_id WHERE a.organization_id=p_organization_id AND a.term_id=p_term_id)
  UPDATE plugin_data.csf_opportunities a SET catalog_position=ordered.n FROM ordered WHERE a.id=ordered.id;
  UPDATE plugin_data.csf_activity_layouts SET revision=revision+1 WHERE organization_id=p_organization_id AND term_id=p_term_id RETURNING revision INTO v_revision;
  v_result:=jsonb_build_object('id',v_id,'revision',v_revision);
  INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,term_id,before_data,after_data,correlation_id,reason_code)
  VALUES(p_organization_id,p_actor_user_id,'activity.layout_updated','csf_terms',p_term_id,p_term_id,jsonb_build_object('revision',p_expected_revision),jsonb_build_object('requestFingerprint',v_fingerprint,'operation',p_operation,'payload',p_payload,'result',v_result),p_request_id,'officer_activity_organization');
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_edit_activity_layout(uuid,uuid,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_edit_activity_layout(uuid,uuid,uuid,uuid,bigint,text,jsonb) TO service_role;

-- Preserve retirement and identity projections while correcting decision precedence.
DO $migration$
DECLARE v_signature text; v_definition text; v_before text; v_after text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer)',
    'plugin_data.csf_list_class_directory_page(uuid,uuid,uuid,text,text,text,text,text,text,uuid,integer)'
  ] LOOP
    v_definition:=pg_get_functiondef(v_signature::regprocedure);
    FOREACH v_before IN ARRAY ARRAY['OR application_needs','OR eligibility_needs','OR dues_needs','OR membership_needs'] LOOP
      v_after:=CASE WHEN v_before='OR membership_needs' THEN 'OR (coalesce(decision_status, ''pending'') NOT IN (''rejected'',''withdrawn'') AND membership_needs)' ELSE replace(v_before,'OR ','OR (coalesce(decision_status, ''pending'') NOT IN (''approved'',''rejected'',''withdrawn'') AND ')||')' END;
      IF position(v_before IN v_definition)=0 THEN RAISE EXCEPTION 'Directory status projection changed: %',v_before; END IF;
      v_definition:=replace(v_definition,v_before,v_after);
      v_definition:=replace(v_definition,replace(v_before,'OR ','AND '),replace(v_after,'OR (','AND ('));
    END LOOP;
    v_before:='count(*) FILTER (WHERE needs_attention) AS attention_count';
    v_after:='count(*) FILTER (WHERE needs_attention AND (p_view=''directory'' OR (p_view=''current'' AND '||CASE WHEN v_signature LIKE '%class_directory%' THEN 'is_current_member' ELSE 'has_current_record' END||') OR (p_view=''seniors'' AND is_senior))) AS attention_count';
    IF position(v_before IN v_definition)=0 THEN RAISE EXCEPTION 'Directory attention count changed.'; END IF;
    EXECUTE replace(v_definition,v_before,v_after);
  END LOOP;
END;
$migration$;
REVOKE ALL ON FUNCTION plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_list_class_directory_page(uuid,uuid,uuid,text,text,text,text,text,text,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_list_class_directory_page(uuid,uuid,uuid,text,text,text,text,text,text,uuid,integer) TO service_role;
CREATE OR REPLACE FUNCTION plugin_data.csf_personal_calendar_source_is_authorized(
  p_organization_id uuid,
  p_user_id uuid,
  p_source_kind text,
  p_source_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_term_id uuid;
  v_audience text;
  v_is_member boolean := false;
  v_is_applicant boolean := false;
BEGIN
  SELECT account.profile_id
  INTO v_profile_id
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_user_id
    AND account.status = 'verified'
  ORDER BY account.is_primary DESC, account.linked_at DESC
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_source_kind = 'csf_opportunity' THEN
    SELECT opportunity.term_id
    INTO v_term_id
    FROM plugin_data.csf_opportunities AS opportunity
    JOIN plugin_data.csf_terms AS term
      ON term.organization_id = opportunity.organization_id
     AND term.id = opportunity.term_id
     AND term.lifecycle_status IN ('planned', 'open')
    WHERE opportunity.organization_id = p_organization_id
      AND opportunity.id = p_source_id
      AND opportunity.status = 'published'
      AND (opportunity.starts_at IS NOT NULL OR opportunity.earning_rules->>'mode' = 'shifts')
      AND (opportunity.cohort_id IS NULL OR EXISTS (
        SELECT 1 FROM plugin_data.csf_profile_cohort_memberships AS class_member
        WHERE class_member.organization_id=p_organization_id
          AND class_member.profile_id=v_profile_id
          AND class_member.cohort_id=opportunity.cohort_id
          AND class_member.status='active'
      ));
  ELSIF p_source_kind = 'csf_meeting_session' THEN
    SELECT meeting.term_id
    INTO v_term_id
    FROM plugin_data.csf_meeting_sessions AS session
    JOIN plugin_data.csf_meetings AS meeting
      ON meeting.organization_id = session.organization_id
     AND meeting.id = session.meeting_id
     AND meeting.status = 'active'
    JOIN plugin_data.csf_terms AS term
      ON term.organization_id = meeting.organization_id
     AND term.id = meeting.term_id
     AND term.lifecycle_status IN ('planned', 'open')
    WHERE session.organization_id = p_organization_id
      AND session.id = p_source_id
      AND session.status IN ('scheduled', 'open')
      AND (session.starts_at IS NOT NULL OR session.session_date IS NOT NULL);
  ELSIF p_source_kind = 'csf_deadline' THEN
    SELECT deadline.term_id, deadline.audience
    INTO v_term_id, v_audience
    FROM plugin_data.csf_term_deadlines AS deadline
    JOIN plugin_data.csf_terms AS term
      ON term.organization_id = deadline.organization_id
     AND term.id = deadline.term_id
     AND term.lifecycle_status IN ('planned', 'open')
    WHERE deadline.organization_id = p_organization_id
      AND deadline.id = p_source_id
      AND deadline.status IN ('planned', 'open')
      AND deadline.audience IN ('members', 'applicants', 'all');
  ELSE
    RETURN false;
  END IF;

  IF v_term_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.profile_id = v_profile_id
      AND membership.term_id = v_term_id
      AND membership.status IN ('accepted', 'active', 'completed')
  ) INTO v_is_member;

  IF p_source_kind IN ('csf_opportunity', 'csf_meeting_session') THEN
    RETURN v_is_member;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.profile_id = v_profile_id
      AND application.term_id = v_term_id
      AND application.submission_status IN ('missing_information', 'ready', 'under_review', 'decided')
      AND application.decision_status NOT IN ('rejected', 'withdrawn')
  ) INTO v_is_applicant;

  RETURN CASE v_audience
    WHEN 'members' THEN v_is_member
    WHEN 'applicants' THEN v_is_applicant
    WHEN 'all' THEN v_is_member OR v_is_applicant
    ELSE false
  END;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_personal_calendar_source_is_authorized(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_personal_calendar_source_is_authorized(uuid,uuid,text,uuid) TO service_role;
COMMIT;
