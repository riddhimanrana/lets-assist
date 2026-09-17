-- A committed retention run leaves cohort rows as foreign-key anchors for
-- immutable import and audit evidence. Mark those anchors as retired so normal
-- class lists and intake do not present them as operational classes.
BEGIN;

ALTER TABLE plugin_data.csf_cohorts
  DROP CONSTRAINT csf_cohorts_status_check;
ALTER TABLE plugin_data.csf_cohorts
  ADD CONSTRAINT csf_cohorts_status_check
  CHECK (status IN ('active', 'inactive', 'archived', 'retired'));

CREATE FUNCTION plugin_data.csf_guard_retired_cohort_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_retired boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_retention_retired_cohorts AS retired
    WHERE retired.organization_id = NEW.organization_id
      AND retired.cohort_id = NEW.id
  ) INTO v_retired;

  IF (v_retired AND NEW.status <> 'retired')
    OR (NOT v_retired AND NEW.status = 'retired') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'A CSF class may be marked retired only by its completed retention operation.',
      DETAIL = 'CSF_RETIRED_COHORT_STATUS=' || NEW.id::text;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_cohorts_retired_status_guard
  BEFORE INSERT OR UPDATE OF status
  ON plugin_data.csf_cohorts
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_guard_retired_cohort_status();

CREATE FUNCTION plugin_data.csf_project_retired_cohort_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE plugin_data.csf_cohorts AS cohort
  SET status = 'retired', updated_at = now()
  WHERE cohort.id = NEW.cohort_id
    AND cohort.organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'The retained CSF class anchor is missing.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_retention_retired_cohorts_status_projection
  AFTER INSERT
  ON plugin_data.csf_retention_retired_cohorts
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_project_retired_cohort_status();

-- Existing committed receipts, if any, must project the same status. This
-- migration has no student-data effect and does not start a retention run.
UPDATE plugin_data.csf_cohorts AS cohort
SET status = 'retired', updated_at = now()
FROM plugin_data.csf_retention_retired_cohorts AS retired
WHERE retired.cohort_id = cohort.id
  AND retired.organization_id = cohort.organization_id
  AND cohort.status <> 'retired';

ALTER FUNCTION plugin_data.csf_guard_retired_cohort_status() OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_project_retired_cohort_status() OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_retired_cohort_status()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_project_retired_cohort_status()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_retired_cohort_status() TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_project_retired_cohort_status() TO postgres;

-- Imported Drive attachments have no Storage bucket or object path. Only
-- Storage-backed application files can enter the Storage deletion queue.
-- Replace the reviewed statement in the latest retention function without
-- changing its authorization, sealed scope, or audit behavior.
DO $$
DECLARE
  v_definition text;
  v_before text := $before$    FROM plugin_data.csf_application_files AS attachment
    WHERE attachment.organization_id = p_organization_id
      AND attachment.profile_id = v_profile_id
    ON CONFLICT ON CONSTRAINT csf_storage_deletion_queue_bucket_path_key DO NOTHING;$before$;
  v_after text := $after$    FROM plugin_data.csf_application_files AS attachment
    WHERE attachment.organization_id = p_organization_id
      AND attachment.profile_id = v_profile_id
      AND attachment.provider = 'supabase_storage'
      AND nullif(pg_catalog.btrim(attachment.bucket), '') IS NOT NULL
      AND nullif(pg_catalog.btrim(attachment.object_path), '') IS NOT NULL
    ON CONFLICT ON CONSTRAINT csf_storage_deletion_queue_bucket_path_key DO NOTHING;$after$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'plugin_data.csf_retention_commit(uuid,uuid,uuid,uuid,text,integer[],uuid[])'::regprocedure
  ) INTO v_definition;

  IF pg_catalog.strpos(v_definition, v_before) = 0
    OR pg_catalog.strpos(
      pg_catalog.substr(v_definition, pg_catalog.strpos(v_definition, v_before) + pg_catalog.length(v_before)),
      v_before
    ) > 0 THEN
    RAISE EXCEPTION 'The reviewed application-file queue statement changed.'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE pg_catalog.replace(v_definition, v_before, v_after);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_retention_commit(uuid, uuid, uuid, uuid, text, integer[], uuid[])
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_commit(uuid, uuid, uuid, uuid, text, integer[], uuid[])
  TO postgres, service_role;

COMMIT;
