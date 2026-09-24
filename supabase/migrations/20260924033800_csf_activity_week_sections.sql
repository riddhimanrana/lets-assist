-- Persist manual activity placements and derive Pacific week order for the catalog.
BEGIN;

ALTER TABLE plugin_data.csf_opportunities
  ADD COLUMN section_assignment text NOT NULL DEFAULT 'automatic'
  CHECK (section_assignment IN ('automatic','manual'));
UPDATE plugin_data.csf_opportunities SET section_assignment='manual' WHERE section_id IS NOT NULL;

CREATE FUNCTION plugin_data.csf_activity_automatic_week(p_starts_at timestamptz, p_rules jsonb)
RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
  WITH earliest AS (
    SELECT CASE WHEN p_rules->>'mode'='shifts' THEN
      (SELECT min(nullif(shift->>'startsAt','')::timestamptz)
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_rules->'components')='array' THEN p_rules->'components' ELSE '[]'::jsonb END) AS shift
       WHERE shift->>'kind'='shift') ELSE p_starts_at END AS starts_at
  )
  SELECT coalesce(to_char((starts_at AT TIME ZONE 'America/Los_Angeles')::date
    - extract(dow FROM starts_at AT TIME ZONE 'America/Los_Angeles')::integer,'YYYY-MM-DD'),'undated') FROM earliest;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_activity_automatic_week(timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_activity_automatic_week(timestamptz,jsonb) TO postgres;


ALTER TABLE plugin_data.csf_activity_sections ADD COLUMN week_key text;
ALTER TABLE plugin_data.csf_activity_sections ADD CONSTRAINT csf_activity_week_unique UNIQUE(organization_id,term_id,week_key);
ALTER TABLE plugin_data.csf_activity_sections ADD CONSTRAINT csf_activity_week_format CHECK(week_key IS NULL OR week_key='undated' OR week_key ~ '^\d{4}-\d{2}-\d{2}$');

CREATE OR REPLACE FUNCTION plugin_data.csf_edit_activity_layout(
  p_organization_id uuid, p_term_id uuid, p_actor_user_id uuid,
  p_request_id uuid, p_expected_revision bigint, p_operation text, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_revision bigint;
  v_id uuid;
  v_section uuid;
  v_before uuid;
  v_title text;
  v_week text;
  v_week_section uuid;
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
  v_week := nullif(p_payload->>'week','');
  IF v_week IS NOT NULL THEN
    IF v_week <> 'undated' THEN
      IF v_week !~ '^\d{4}-\d{2}-\d{2}$' OR to_char(v_week::date,'YYYY-MM-DD') <> v_week
        OR extract(dow FROM v_week::date) <> 0 THEN
        RAISE EXCEPTION 'Choose a valid activity week.' USING ERRCODE='22023';
      END IF;
    END IF;
    IF p_operation NOT IN ('rename_week','move_activity') THEN RAISE EXCEPTION 'This operation does not accept a week.'; END IF;
    SELECT id INTO v_week_section FROM plugin_data.csf_activity_sections
      WHERE organization_id=p_organization_id AND term_id=p_term_id AND week_key=v_week FOR UPDATE;
    IF v_week_section IS NULL THEN
      IF (SELECT count(*) FROM plugin_data.csf_activity_sections WHERE organization_id=p_organization_id AND term_id=p_term_id)>=100 THEN RAISE EXCEPTION 'This semester already has 100 sections.'; END IF;
      INSERT INTO plugin_data.csf_activity_sections(organization_id,term_id,title,position,week_key)
        SELECT p_organization_id,p_term_id,CASE WHEN v_week='undated' THEN 'No date' ELSE to_char(v_week::date,'Mon FMDD, YYYY')||' to '||to_char(v_week::date+6,'Mon FMDD, YYYY') END,
        coalesce(max(position),0)+1,v_week FROM plugin_data.csf_activity_sections WHERE organization_id=p_organization_id AND term_id=p_term_id
        RETURNING id INTO v_week_section;
    END IF;
    IF p_operation='rename_week' THEN v_id:=v_week_section;
    ELSE v_section:=v_week_section; END IF;
  END IF;
  IF p_operation='rename_week' AND v_week IS NULL THEN RAISE EXCEPTION 'Choose a valid activity week.' USING ERRCODE='22023'; END IF;
  IF p_operation IN ('create_section','rename_section','rename_week') AND (v_title IS NULL OR length(v_title)>100) THEN RAISE EXCEPTION 'Name the section in 1 to 100 characters.'; END IF;
  IF p_operation = 'create_section' THEN
    IF (SELECT count(*) FROM plugin_data.csf_activity_sections WHERE organization_id=p_organization_id AND term_id=p_term_id)>=100 THEN RAISE EXCEPTION 'This semester already has 100 sections.'; END IF;
    INSERT INTO plugin_data.csf_activity_sections(organization_id,term_id,title,position) SELECT p_organization_id,p_term_id,v_title,coalesce(max(position),0)+1 FROM plugin_data.csf_activity_sections WHERE organization_id=p_organization_id AND term_id=p_term_id RETURNING id INTO v_id;
  ELSIF p_operation IN ('rename_section','rename_week','delete_section','move_section') THEN
    PERFORM 1 FROM plugin_data.csf_activity_sections WHERE id=v_id AND organization_id=p_organization_id AND term_id=p_term_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That section is no longer available.'; END IF;
    IF p_operation IN ('rename_section','rename_week') THEN UPDATE plugin_data.csf_activity_sections SET title=v_title WHERE id=v_id;
    ELSIF p_operation='delete_section' THEN
      UPDATE plugin_data.csf_opportunities SET section_id=NULL,section_assignment='manual',section_position=2147483647 WHERE organization_id=p_organization_id AND term_id=p_term_id AND (section_id=v_id OR section_id IS NULL AND section_assignment='automatic' AND plugin_data.csf_activity_automatic_week(starts_at,earning_rules)=(SELECT week_key FROM plugin_data.csf_activity_sections WHERE id=v_id));
      DELETE FROM plugin_data.csf_activity_sections WHERE id=v_id;
    ELSE
      SELECT coalesce(array_agg(id ORDER BY position,id),'{}'::uuid[]) INTO v_ids FROM plugin_data.csf_activity_sections WHERE organization_id=p_organization_id AND term_id=p_term_id AND id<>v_id;
    END IF;
  ELSIF p_operation='move_activity' THEN
    PERFORM 1 FROM plugin_data.csf_opportunities WHERE id=v_id AND organization_id=p_organization_id AND term_id=p_term_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That activity is no longer available.'; END IF;
    IF v_section IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_activity_sections WHERE id=v_section AND organization_id=p_organization_id AND term_id=p_term_id) THEN RAISE EXCEPTION 'Choose a section in this semester.'; END IF;
    SELECT week_key INTO v_week FROM plugin_data.csf_activity_sections WHERE id=v_section;
    UPDATE plugin_data.csf_opportunities SET section_id=v_section,section_assignment='manual' WHERE id=v_id;
    SELECT coalesce(array_agg(id ORDER BY section_position,starts_at NULLS LAST,created_at,id),'{}'::uuid[]) INTO v_ids
    FROM plugin_data.csf_opportunities
    WHERE organization_id=p_organization_id AND term_id=p_term_id AND id<>v_id
      AND (section_id IS NOT DISTINCT FROM v_section AND (v_section IS NOT NULL OR section_assignment='manual' OR plugin_data.csf_activity_automatic_week(starts_at,earning_rules)='undated')
        OR v_week IS NOT NULL AND section_id IS NULL AND section_assignment='automatic' AND plugin_data.csf_activity_automatic_week(starts_at,earning_rules)=v_week);
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
  PERFORM plugin_data.csf_refresh_activity_catalog(p_organization_id,p_term_id);
  UPDATE plugin_data.csf_activity_layouts SET revision=revision+1 WHERE organization_id=p_organization_id AND term_id=p_term_id RETURNING revision INTO v_revision;
  v_result:=jsonb_build_object('id',v_id,'revision',v_revision);
  INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,term_id,before_data,after_data,correlation_id,reason_code)
  VALUES(p_organization_id,p_actor_user_id,'activity.layout_updated','csf_terms',p_term_id,p_term_id,jsonb_build_object('revision',p_expected_revision),jsonb_build_object('requestFingerprint',v_fingerprint,'operation',p_operation,'payload',p_payload,'result',v_result),p_request_id,'officer_activity_organization');
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_edit_activity_layout(uuid,uuid,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_edit_activity_layout(uuid,uuid,uuid,uuid,bigint,text,jsonb) TO service_role;

CREATE FUNCTION plugin_data.csf_refresh_activity_catalog(p_organization_id uuid,p_term_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  WITH placement AS (
    SELECT a.id,a.section_position,a.starts_at,a.created_at,
      CASE WHEN a.section_id IS NOT NULL THEN coalesce(s.week_key,'custom')
        WHEN a.section_assignment='manual' THEN 'undated'
        ELSE plugin_data.csf_activity_automatic_week(a.starts_at,a.earning_rules) END AS week,
      s.position,s.id AS section_id
    FROM plugin_data.csf_opportunities a LEFT JOIN plugin_data.csf_activity_sections s ON s.id=a.section_id
    WHERE a.organization_id=p_organization_id AND a.term_id=p_term_id
  ), ordered AS (
    SELECT id,row_number() OVER(ORDER BY
      CASE WHEN week='custom' THEN 0 WHEN week='undated' THEN 2 ELSE 1 END,
      CASE WHEN week='custom' THEN position END,week,
      section_position,starts_at NULLS LAST,created_at,id) AS n FROM placement
  )
  UPDATE plugin_data.csf_opportunities a SET catalog_position=ordered.n FROM ordered
  WHERE a.id=ordered.id AND a.catalog_position IS DISTINCT FROM ordered.n;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_refresh_activity_catalog(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_refresh_activity_catalog(uuid,uuid) TO postgres;

CREATE FUNCTION plugin_data.csf_activity_catalog_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.starts_at IS NOT DISTINCT FROM OLD.starts_at
    AND NEW.earning_rules IS NOT DISTINCT FROM OLD.earning_rules
    AND NEW.term_id IS NOT DISTINCT FROM OLD.term_id THEN RETURN NEW; END IF;
  PERFORM 1 FROM plugin_data.csf_terms WHERE id=NEW.term_id AND organization_id=NEW.organization_id FOR UPDATE;
  PERFORM plugin_data.csf_refresh_activity_catalog(NEW.organization_id,NEW.term_id);
  INSERT INTO plugin_data.csf_activity_layouts(organization_id,term_id,revision)
    SELECT NEW.organization_id,NEW.term_id,1 WHERE NEW.term_id IS NOT NULL
    ON CONFLICT(organization_id,term_id) DO UPDATE SET revision=csf_activity_layouts.revision+1;
  IF TG_OP='UPDATE' AND OLD.term_id IS DISTINCT FROM NEW.term_id AND OLD.term_id IS NOT NULL THEN
    PERFORM plugin_data.csf_refresh_activity_catalog(OLD.organization_id,OLD.term_id);
    UPDATE plugin_data.csf_activity_layouts SET revision=revision+1 WHERE organization_id=OLD.organization_id AND term_id=OLD.term_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_activity_catalog_changed() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_activity_catalog_changed() TO postgres;
CREATE TRIGGER csf_activity_catalog_changed AFTER INSERT OR UPDATE OF starts_at,earning_rules,term_id
  ON plugin_data.csf_opportunities FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_activity_catalog_changed();

SELECT plugin_data.csf_refresh_activity_catalog(organization_id,term_id)
FROM (SELECT DISTINCT organization_id,term_id FROM plugin_data.csf_opportunities WHERE term_id IS NOT NULL) AS terms;
UPDATE plugin_data.csf_activity_layouts SET revision=revision+1;
COMMIT;
