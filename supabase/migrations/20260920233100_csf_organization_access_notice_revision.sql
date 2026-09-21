-- Keep restored organization access distinct from its previous grant.
BEGIN;

ALTER TABLE public.organization_members
  ADD COLUMN access_revision uuid NOT NULL DEFAULT gen_random_uuid();

CREATE FUNCTION plugin_data.csf_stamp_organization_access_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.access_revision := gen_random_uuid();
  ELSIF (NEW.organization_id, NEW.user_id, NEW.status)
    IS DISTINCT FROM (OLD.organization_id, OLD.user_id, OLD.status) THEN
    NEW.access_revision := gen_random_uuid();
  ELSE
    NEW.access_revision := OLD.access_revision;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_stamp_organization_access_revision() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_stamp_organization_access_revision() TO postgres;

CREATE TRIGGER csf_organization_access_revision
BEFORE INSERT OR UPDATE ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_stamp_organization_access_revision();

CREATE OR REPLACE FUNCTION plugin_data.csf_transition_notice_fingerprint(
  p_organization_id uuid, p_profile_id uuid, p_user_id uuid,
  p_kind text, p_subject_id uuid
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organization_plugin_access
    WHERE organization_id=p_organization_id AND plugin_key='dvhs-csf' AND enabled AND is_accessible)
    OR plugin_data.csf_publication_profile_owner(p_organization_id,p_profile_id) IS DISTINCT FROM p_user_id
    OR p_user_id IS NULL THEN RETURN NULL; END IF;
  IF p_kind='account_connected' THEN
    SELECT jsonb_build_array('account',id,profile_id,user_id,status,connection_basis,linked_at,revoked_at)
      INTO v_state FROM plugin_data.csf_profile_accounts
      WHERE organization_id=p_organization_id AND id=p_subject_id
        AND profile_id=p_profile_id AND user_id=p_user_id AND status='verified';
  ELSIF p_kind='application_decision' THEN
    SELECT jsonb_build_array('application',id,profile_id,term_id,decision_status,reviewed_by,reviewed_at)
      INTO v_state FROM plugin_data.csf_term_applications
      WHERE organization_id=p_organization_id AND id=p_subject_id AND profile_id=p_profile_id
        AND decision_status IN ('approved','rejected') AND reviewed_by IS NOT NULL;
  ELSIF p_kind='access_granted' THEN
    SELECT jsonb_build_array('class',id,profile_id,cohort_id,status,updated_at)
      INTO v_state FROM plugin_data.csf_profile_cohort_memberships
      WHERE organization_id=p_organization_id AND id=p_subject_id AND profile_id=p_profile_id AND status='active';
    IF v_state IS NULL THEN
      SELECT jsonb_build_array('organization',id,user_id,status,access_revision)
        INTO v_state FROM public.organization_members member
        WHERE organization_id=p_organization_id AND id=p_subject_id AND user_id=p_user_id AND status='active';
    END IF;
  END IF;
  IF v_state IS NULL THEN RETURN NULL; END IF;
  RETURN encode(extensions.digest(convert_to(v_state::text,'UTF8'),'sha256'),'hex');
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_transition_notice_fingerprint(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_transition_notice_fingerprint(uuid,uuid,uuid,text,uuid) TO postgres;

COMMIT;
