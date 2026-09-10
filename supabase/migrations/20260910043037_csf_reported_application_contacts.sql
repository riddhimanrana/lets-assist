-- Reported application contacts are display and staff-review context, never account ownership proof.
ALTER TABLE plugin_data.csf_profiles
  ADD COLUMN reported_application_school_email text,
  ADD COLUMN reported_application_personal_email text;
COMMENT ON COLUMN plugin_data.csf_profiles.reported_application_school_email IS
  'Unverified contact reported in an application. Never use for account ownership or automatic connection.';
COMMENT ON COLUMN plugin_data.csf_profiles.reported_application_personal_email IS
  'Unverified contact reported in an application. Never use for account ownership or automatic connection.';

CREATE OR REPLACE FUNCTION plugin_data.csf_fill_application_profile_contacts(
  p_organization_id uuid, p_import_row_id uuid, p_profile_id uuid, p_actor_user_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_contacts jsonb := '{}'::jsonb;
  v_field text; v_email text; v_school text; v_personal text;
  
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  SELECT * INTO v_row FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id=p_organization_id AND id=p_import_row_id FOR UPDATE;
  IF NOT FOUND OR v_row.normalized_data->>'sourceType' IS DISTINCT FROM 'application_responses'
    OR v_row.matched_profile_id IS DISTINCT FROM p_profile_id
    OR (v_row.commit_frozen_at IS NOT NULL AND v_row.commit_target_profile_id IS DISTINCT FROM p_profile_id) THEN
    RAISE EXCEPTION 'Application contacts require the resolved import profile.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_profile FROM plugin_data.csf_profiles
    WHERE organization_id=p_organization_id AND id=p_profile_id AND merged_into_profile_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The application profile is no longer active.' USING ERRCODE='23514'; END IF;
  FOREACH v_field IN ARRAY ARRAY['schoolEmail','personalEmail','preferredContactEmail','responseEmail'] LOOP
    v_email := plugin_data.csf_normalize_email_text(v_row.normalized_data#>>ARRAY['record','contact',v_field]);
    IF length(v_email)<=254
      AND coalesce(v_row.normalized_data#>>ARRAY['record','contact',v_field||'State'],'valid')='valid'
      AND v_email ~ $email$^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:[.][a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:[.][a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$$email$ THEN
      v_contacts := v_contacts || jsonb_build_object(v_field,v_email);
    END IF;
  END LOOP;
  v_school := CASE WHEN nullif(btrim(v_profile.reported_application_school_email),'') IS NULL
    THEN v_contacts->>'schoolEmail' END;
  v_personal := CASE WHEN nullif(btrim(v_profile.reported_application_personal_email),'') IS NULL
    THEN coalesce(v_contacts->>'preferredContactEmail',v_contacts->>'personalEmail',v_contacts->>'responseEmail') END;
  IF v_personal IS NOT NULL AND v_personal=coalesce(v_school,v_profile.reported_application_school_email) THEN v_personal:=NULL; END IF;
  IF v_school IS NULL AND v_personal IS NULL THEN RETURN; END IF;
  UPDATE plugin_data.csf_profiles SET
    reported_application_school_email=coalesce(v_school,reported_application_school_email),
    reported_application_personal_email=coalesce(v_personal,reported_application_personal_email),
    updated_at=now()
  WHERE organization_id=p_organization_id AND id=p_profile_id;
  INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,before_data,after_data,correlation_id)
  VALUES(p_organization_id,p_actor_user_id,'profile.reported_application_contacts_captured','csf_profiles',p_profile_id,
    jsonb_build_object('reportedApplicationSchoolEmail',v_profile.reported_application_school_email,
      'reportedApplicationPersonalEmail',v_profile.reported_application_personal_email),
    jsonb_build_object('reportedApplicationSchoolEmail',coalesce(v_school,v_profile.reported_application_school_email),
      'reportedApplicationPersonalEmail',coalesce(v_personal,v_profile.reported_application_personal_email),
      'importRowId',p_import_row_id,'accountLinked',false,'ownershipVerified',false),v_row.correlation_id);
END;
$function$;
REVOKE ALL ON FUNCTION plugin_data.csf_fill_application_profile_contacts(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_fill_application_profile_contacts(uuid,uuid,uuid,uuid) TO postgres;

-- Move only values whose original blank-to-filled helper audit still explains
-- the current field. A later staff change or any account history needs review.
CREATE OR REPLACE FUNCTION plugin_data.csf_reclassify_captured_application_contacts(p_organization_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_audit plugin_data.csf_admin_audit_events%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_school text; v_personal text; v_count integer := 0;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  FOR v_audit IN
    SELECT a.* FROM plugin_data.csf_admin_audit_events a
    JOIN plugin_data.csf_sheet_import_rows r
      ON r.organization_id=a.organization_id AND r.id::text=a.after_data->>'importRowId'
      AND r.matched_profile_id=a.target_id
      AND r.normalized_data->>'sourceType'='application_responses'
    WHERE a.organization_id=p_organization_id
      AND a.action='profile.application_contacts_captured' AND a.target_type='csf_profiles'
      AND a.after_data->'accountLinked'='false'::jsonb
    ORDER BY a.target_id,a.created_at,a.id
  LOOP
    SELECT * INTO v_profile FROM plugin_data.csf_profiles
      WHERE organization_id=p_organization_id AND id=v_audit.target_id
        AND merged_into_profile_id IS NULL FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts
      WHERE organization_id=p_organization_id AND profile_id=v_profile.id)
      OR EXISTS (SELECT 1 FROM plugin_data.csf_admin_audit_events later
        WHERE later.organization_id=p_organization_id AND later.target_id=v_profile.id
          AND later.target_type='csf_profiles' AND later.id<>v_audit.id
          AND later.created_at>=v_audit.created_at AND later.action<>'profile.create') THEN
      CONTINUE;
    END IF;
    v_school := CASE
      WHEN v_audit.before_data ? 'schoolEmail'
        AND nullif(btrim(v_audit.before_data->>'schoolEmail'),'') IS NULL
        AND v_profile.school_email=v_audit.after_data->>'schoolEmail'
        AND v_profile.normalized_school_email=v_audit.after_data->>'schoolEmail'
        AND v_profile.school_email=plugin_data.csf_normalize_email_text(v_profile.school_email)
        AND (v_profile.reported_application_school_email IS NULL
          OR v_profile.reported_application_school_email=v_profile.school_email)
      THEN v_profile.school_email END;
    v_personal := CASE
      WHEN v_audit.before_data ? 'personalEmail'
        AND nullif(btrim(v_audit.before_data->>'personalEmail'),'') IS NULL
        AND v_profile.personal_email=v_audit.after_data->>'personalEmail'
        AND v_profile.normalized_personal_email=v_audit.after_data->>'personalEmail'
        AND v_profile.personal_email=plugin_data.csf_normalize_email_text(v_profile.personal_email)
        AND (v_profile.reported_application_personal_email IS NULL
          OR v_profile.reported_application_personal_email=v_profile.personal_email)
      THEN v_profile.personal_email END;
    IF v_school IS NULL AND v_personal IS NULL THEN CONTINUE; END IF;
    UPDATE plugin_data.csf_profiles SET
      reported_application_school_email=coalesce(v_school,reported_application_school_email),
      reported_application_personal_email=coalesce(v_personal,reported_application_personal_email),
      school_email=CASE WHEN v_school IS NOT NULL THEN NULL ELSE school_email END,
      normalized_school_email=CASE WHEN v_school IS NOT NULL THEN NULL ELSE normalized_school_email END,
      personal_email=CASE WHEN v_personal IS NOT NULL THEN NULL ELSE personal_email END,
      normalized_personal_email=CASE WHEN v_personal IS NOT NULL THEN NULL ELSE normalized_personal_email END,
      updated_at=now()
    WHERE organization_id=p_organization_id AND id=v_profile.id;
    INSERT INTO plugin_data.csf_admin_audit_events
      (organization_id,action,target_type,target_id,before_data,after_data,correlation_id)
    VALUES (p_organization_id,'profile.application_contacts_reclassified','csf_profiles',v_profile.id,
      jsonb_build_object('schoolEmail',v_profile.school_email,'personalEmail',v_profile.personal_email,
        'reportedApplicationSchoolEmail',v_profile.reported_application_school_email,
        'reportedApplicationPersonalEmail',v_profile.reported_application_personal_email),
      jsonb_build_object('sourceAuditId',v_audit.id,'importRowId',v_audit.after_data->>'importRowId',
        'movedSchoolEmail',v_school,'movedPersonalEmail',v_personal,'accountLinksChanged',false),
      v_audit.id);
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION plugin_data.csf_reclassify_captured_application_contacts(uuid)
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reclassify_captured_application_contacts(uuid) TO postgres;

DO $migration$
DECLARE v_organization_id uuid;
BEGIN
  FOR v_organization_id IN SELECT DISTINCT organization_id FROM plugin_data.csf_admin_audit_events
    WHERE action='profile.application_contacts_captured' ORDER BY organization_id
  LOOP
    PERFORM plugin_data.csf_reclassify_captured_application_contacts(v_organization_id);
  END LOOP;
END;
$migration$;
