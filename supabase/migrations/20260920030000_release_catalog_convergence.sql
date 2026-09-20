-- Converge known upgrade-history differences without expanding runtime access.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $permissions$
DECLARE v_table record;
BEGIN
  FOR v_table IN
    SELECT n.nspname, c.relname FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','plugin_data') AND c.relkind IN ('r','p','m','v')
      AND c.relowner='postgres'::regrole
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
        WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
  LOOP
    EXECUTE pg_catalog.format('REVOKE MAINTAIN ON TABLE %I.%I FROM PUBLIC, anon, authenticated, service_role',
      v_table.nspname,v_table.relname);
  END LOOP;
END;
$permissions$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, plugin_data
  REVOKE MAINTAIN ON TABLES FROM PUBLIC, postgres, anon, authenticated, service_role;

-- The earlier duplicate cleanup retained different equivalent names depending
-- on whether the database already had descriptive indexes. Preserve one name.
DO $indexes$
DECLARE
  v_pair record;
  v_name text;
  v_index oid;
BEGIN
  FOR v_pair IN SELECT * FROM (VALUES
    ('dv_sd_judge_assignments','idx_dv_sd_assignments_org','idx_dv_sd_judge_assignments_org'),
    ('dv_sd_parent_student_links','idx_dv_sd_links_org','idx_dv_sd_parent_student_links_org'),
    ('dv_sd_signup_forms','idx_dv_sd_forms_org','idx_dv_sd_signup_forms_org'),
    ('dv_sd_signup_questions','idx_dv_sd_questions_org','idx_dv_sd_signup_questions_org'),
    ('dv_sd_signup_submissions','idx_dv_sd_submissions_org','idx_dv_sd_signup_submissions_org'),
    ('dv_sd_submission_answers','idx_dv_sd_answers_org','idx_dv_sd_submission_answers_org')
  ) names(table_name,canonical_name,alternate_name)
  LOOP
    IF pg_catalog.to_regclass('plugin_data.'||v_pair.canonical_name) IS NULL
      AND pg_catalog.to_regclass('plugin_data.'||v_pair.alternate_name) IS NULL THEN
      RAISE EXCEPTION 'Missing reviewed organization index for %',v_pair.table_name;
    END IF;
    FOREACH v_name IN ARRAY ARRAY[v_pair.canonical_name,v_pair.alternate_name]
    LOOP
      v_index := pg_catalog.to_regclass('plugin_data.'||v_name);
      IF v_index IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid=v_index
          AND i.indrelid=pg_catalog.to_regclass('plugin_data.'||v_pair.table_name)
          AND i.indisvalid AND i.indisready AND i.indislive
          AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
          AND pg_catalog.pg_get_indexdef(i.indexrelid)=pg_catalog.format(
            'CREATE INDEX %I ON plugin_data.%I USING btree (organization_id)',v_name,v_pair.table_name)
      ) THEN
        RAISE EXCEPTION 'Incompatible organization index %. Review its definition before release.',v_name;
      END IF;
    END LOOP;
    IF pg_catalog.to_regclass('plugin_data.'||v_pair.alternate_name) IS NOT NULL THEN
      IF pg_catalog.to_regclass('plugin_data.'||v_pair.canonical_name) IS NOT NULL THEN
        EXECUTE pg_catalog.format('DROP INDEX plugin_data.%I',v_pair.alternate_name);
      ELSE
        EXECUTE pg_catalog.format('ALTER INDEX plugin_data.%I RENAME TO %I',v_pair.alternate_name,v_pair.canonical_name);
      END IF;
    END IF;
  END LOOP;
END;
$indexes$;

-- Development retained the 20260817110500 definition despite applying the later
-- ledger entry. Accept only that known body or the final 20260817120000 body.
DO $staff_guard$
BEGIN
  IF coalesce((SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))
    FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(
      'plugin_data.csf_actor_can_manage_staff(uuid,uuid)')), '') NOT IN (
      '530882d2033a56597b48349b8b4c9005','aa7d27b251ae2219ed91263b7fe4aafa') THEN
    RAISE EXCEPTION 'Unreviewed staff authority definition. Reconcile before release.';
  END IF;
END;
$staff_guard$;

CREATE OR REPLACE FUNCTION plugin_data.csf_actor_can_manage_staff(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = p_actor_user_id
        AND member.role = 'admin'
        AND coalesce(member.status, 'active') = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM auth.users AS actor
      WHERE actor.id = p_actor_user_id
        AND lower(actor.email) = 'dvhighcsf@gmail.com'
    )
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_staff_positions AS position
      JOIN plugin_data.csf_role_permissions AS permission
        ON permission.organization_id = position.organization_id
       AND permission.role_id = position.role_id
       AND permission.permission_key = 'manage_roles'
       AND permission.enabled = true
      WHERE position.organization_id = p_organization_id
        AND position.user_id = p_actor_user_id
        AND position.status = 'active'
        AND position.school_year = plugin_data.csf_current_school_year(p_organization_id)
        AND (position.starts_at IS NULL OR position.starts_at <= (now() AT TIME ZONE 'America/Los_Angeles')::date)
        AND (position.ends_at IS NULL OR position.ends_at >= (now() AT TIME ZONE 'America/Los_Angeles')::date)
    );
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_actor_can_manage_staff(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_actor_can_manage_staff(uuid, uuid) TO postgres, service_role;

COMMIT;
