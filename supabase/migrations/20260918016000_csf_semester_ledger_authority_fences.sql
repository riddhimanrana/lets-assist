-- Keep reviewed authority in place until each provider write is settled.
BEGIN;

CREATE FUNCTION plugin_data.csf_guard_semester_write_destination_authority()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND
    (to_jsonb(NEW)-ARRAY['configured_by','updated_at','poll_lease_token',
      'poll_lease_expires_at','seed_cursor','seed_completed','next_poll_at',
      'last_synced_at','observation_state']) IS NOT DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['configured_by','updated_at','poll_lease_token',
      'poll_lease_expires_at','seed_cursor','seed_completed','next_poll_at',
      'last_synced_at','observation_state']) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_semester_ledger_writes w
    WHERE w.organization_id=OLD.organization_id AND w.destination_id=OLD.id
      AND w.status IN ('claimed','unknown_outcome')) THEN
    RAISE EXCEPTION 'Reconcile the semester Sheet write before changing its destination.' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_semester_write_destination_authority()
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_semester_write_destination_authority() TO postgres;
CREATE TRIGGER csf_semester_write_destination_authority
  BEFORE UPDATE OR DELETE ON plugin_data.csf_sheet_sync_destinations
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_semester_write_destination_authority();

CREATE FUNCTION plugin_data.csf_guard_semester_write_mapping_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_semester_ledger_writes w
    WHERE w.organization_id=OLD.organization_id AND w.mapping_id=OLD.id
      AND w.status IN ('claimed','unknown_outcome')) THEN
    RAISE EXCEPTION 'Reconcile the semester Sheet write before deleting its mapping.' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_semester_write_mapping_delete()
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_semester_write_mapping_delete() TO postgres;
CREATE TRIGGER csf_semester_write_mapping_delete
  BEFORE DELETE ON plugin_data.csf_sheet_semester_ledger_mappings
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_semester_write_mapping_delete();

CREATE OR REPLACE FUNCTION plugin_data.csf_guard_workbook_link_unsettled_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_semester_ledger_writes w
    WHERE w.organization_id=OLD.organization_id AND w.source_link_id=OLD.id
      AND w.status IN ('claimed','unknown_outcome')) THEN
    RAISE EXCEPTION 'Reconcile the semester Sheet write before moving this workbook link.' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_workbook_link_unsettled_write()
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_workbook_link_unsettled_write() TO postgres;
DROP TRIGGER csf_workbook_link_unsettled_write ON plugin_data.csf_reviewed_workbook_profile_links;
CREATE TRIGGER csf_workbook_link_unsettled_write
  BEFORE UPDATE OR DELETE ON plugin_data.csf_reviewed_workbook_profile_links
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_workbook_link_unsettled_write();

CREATE OR REPLACE FUNCTION plugin_data.csf_guard_semester_write_link_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE link_row plugin_data.csf_reviewed_workbook_profile_links%ROWTYPE;
  mapping_row plugin_data.csf_sheet_semester_ledger_mappings%ROWTYPE;
BEGIN
  SELECT * INTO link_row FROM plugin_data.csf_reviewed_workbook_profile_links
  WHERE id=NEW.source_link_id AND organization_id=NEW.organization_id FOR UPDATE;
  SELECT * INTO mapping_row FROM plugin_data.csf_sheet_semester_ledger_mappings
  WHERE id=NEW.mapping_id AND organization_id=NEW.organization_id;
  IF link_row.id IS NULL OR mapping_row.id IS NULL
    OR link_row.revoked_at IS NOT NULL
    OR link_row.profile_id IS DISTINCT FROM NEW.profile_id
    OR link_row.cohort_id IS DISTINCT FROM mapping_row.cohort_id
    OR link_row.source_file_id IS DISTINCT FROM mapping_row.source_file_id THEN
    RAISE EXCEPTION 'The reviewed workbook link changed. Preview again.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_semester_write_link_owner()
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_semester_write_link_owner() TO postgres;

CREATE FUNCTION plugin_data.csf_guard_semester_write_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE mapping_row plugin_data.csf_sheet_semester_ledger_mappings%ROWTYPE;
BEGIN
  SELECT * INTO mapping_row FROM plugin_data.csf_sheet_semester_ledger_mappings
    WHERE id=NEW.mapping_id AND organization_id=NEW.organization_id;
  PERFORM 1 FROM plugin_data.csf_profile_cohort_memberships c
    WHERE c.organization_id=NEW.organization_id AND c.cohort_id=mapping_row.cohort_id
      AND c.profile_id=NEW.profile_id AND c.status='active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The active cohort membership changed. Preview again.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_semester_write_membership()
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_semester_write_membership() TO postgres;
CREATE TRIGGER csf_semester_write_membership
  BEFORE INSERT ON plugin_data.csf_sheet_semester_ledger_writes
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_semester_write_membership();

CREATE FUNCTION plugin_data.csf_guard_membership_unsettled_semester_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND
    (NEW.organization_id,NEW.cohort_id,NEW.profile_id,NEW.status)
      IS NOT DISTINCT FROM
    (OLD.organization_id,OLD.cohort_id,OLD.profile_id,OLD.status) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_semester_ledger_writes w
    JOIN plugin_data.csf_sheet_semester_ledger_mappings m
      ON m.id=w.mapping_id AND m.organization_id=w.organization_id
    WHERE w.organization_id=OLD.organization_id AND w.profile_id=OLD.profile_id
      AND m.cohort_id=OLD.cohort_id AND w.status IN ('claimed','unknown_outcome')) THEN
    RAISE EXCEPTION 'Reconcile the semester Sheet write before changing this membership.' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_membership_unsettled_semester_write()
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_membership_unsettled_semester_write() TO postgres;
CREATE TRIGGER csf_membership_unsettled_semester_write
  BEFORE UPDATE OR DELETE ON plugin_data.csf_profile_cohort_memberships
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_membership_unsettled_semester_write();

COMMIT;
