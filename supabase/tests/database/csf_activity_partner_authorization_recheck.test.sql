-- Real two-connection proof that the nine CSF activity and partner-club
-- service transactions cannot commit with authority that was removed while the
-- call waited, and that the actor's host membership row is genuinely held for
-- the rest of the transaction. This file intentionally runs in autocommit so
-- dblink sessions observe committed role edits, position revocations, and
-- membership changes made from the primary connection.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(73);

-- 1-8: exact catalog, ACL, fixed-path, signature, and lock-order contract.
SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_update_activity(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_set_activity_status(uuid,uuid,text,text,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_link_activity_project(uuid,uuid,uuid,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_set_partner_club_status(uuid,uuid,text,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_upsert_partner_club_policy(uuid,uuid,uuid,jsonb)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_assign_partner_representative(uuid,uuid,text,text,text,date,boolean,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_revoke_partner_representative(uuid,uuid,uuid,text,uuid,uuid)') IS NOT NULL,
  'all nine stable activity and partner-club wrappers exist'
);
SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_create_activity_locked_impl(uuid,uuid,uuid,jsonb,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_update_activity_locked_impl(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_set_activity_status_locked_impl(uuid,uuid,text,text,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_link_activity_project_locked_impl(uuid,uuid,uuid,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_set_partner_club_status_locked_impl(uuid,uuid,text,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_set_partner_club_term_status_locked_impl(uuid,uuid,text,text,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_upsert_partner_club_policy_locked_impl(uuid,uuid,uuid,jsonb)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_assign_partner_representative_locked_impl(uuid,uuid,text,text,text,date,boolean,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_revoke_partner_representative_locked_impl(uuid,uuid,uuid,text,uuid,uuid)') IS NOT NULL,
  'all nine prior transactions remain behind clearly named implementations'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid,uuid)',
      'plugin_data.csf_update_activity(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)',
      'plugin_data.csf_set_activity_status(uuid,uuid,text,text,uuid,uuid)',
      'plugin_data.csf_link_activity_project(uuid,uuid,uuid,uuid,uuid)',
      'plugin_data.csf_set_partner_club_status(uuid,uuid,text,uuid,uuid)',
      'plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)',
      'plugin_data.csf_upsert_partner_club_policy(uuid,uuid,uuid,jsonb)',
      'plugin_data.csf_assign_partner_representative(uuid,uuid,text,text,text,date,boolean,uuid,uuid)',
      'plugin_data.csf_revoke_partner_representative(uuid,uuid,uuid,text,uuid,uuid)'
    ]) AS operation(signature)
    CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated']) AS client(role_name)
    WHERE has_function_privilege(client.role_name::name, operation.signature, 'EXECUTE')
  )
  AND (
    SELECT bool_and(has_function_privilege('service_role', operation.signature, 'EXECUTE'))
    FROM unnest(ARRAY[
      'plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid,uuid)',
      'plugin_data.csf_update_activity(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)',
      'plugin_data.csf_set_activity_status(uuid,uuid,text,text,uuid,uuid)',
      'plugin_data.csf_link_activity_project(uuid,uuid,uuid,uuid,uuid)',
      'plugin_data.csf_set_partner_club_status(uuid,uuid,text,uuid,uuid)',
      'plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)',
      'plugin_data.csf_upsert_partner_club_policy(uuid,uuid,uuid,jsonb)',
      'plugin_data.csf_assign_partner_representative(uuid,uuid,text,text,text,date,boolean,uuid,uuid)',
      'plugin_data.csf_revoke_partner_representative(uuid,uuid,uuid,text,uuid,uuid)'
    ]) AS operation(signature)
  ),
  'only service_role can execute the nine stable wrappers'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_create_activity_locked_impl(uuid,uuid,uuid,jsonb,uuid,uuid)',
      'plugin_data.csf_update_activity_locked_impl(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)',
      'plugin_data.csf_set_activity_status_locked_impl(uuid,uuid,text,text,uuid,uuid)',
      'plugin_data.csf_link_activity_project_locked_impl(uuid,uuid,uuid,uuid,uuid)',
      'plugin_data.csf_set_partner_club_status_locked_impl(uuid,uuid,text,uuid,uuid)',
      'plugin_data.csf_set_partner_club_term_status_locked_impl(uuid,uuid,text,text,uuid,uuid)',
      'plugin_data.csf_upsert_partner_club_policy_locked_impl(uuid,uuid,uuid,jsonb)',
      'plugin_data.csf_assign_partner_representative_locked_impl(uuid,uuid,text,text,text,date,boolean,uuid,uuid)',
      'plugin_data.csf_revoke_partner_representative_locked_impl(uuid,uuid,uuid,text,uuid,uuid)'
    ]) AS implementation(signature)
    CROSS JOIN unnest(
      ARRAY['public', 'anon', 'authenticated', 'service_role']
    ) AS caller(role_name)
    WHERE has_function_privilege(
      caller.role_name::name,
      implementation.signature,
      'EXECUTE'
    )
  ),
  'the nine implementations are executable only by their owner'
);
SELECT extensions.ok(
  (
    SELECT bool_and(proc.prosecdef AND proc.proconfig @> ARRAY['search_path=""']::text[])
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid IN (
      'plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid,uuid)'::regprocedure,
      'plugin_data.csf_update_activity(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)'::regprocedure,
      'plugin_data.csf_set_activity_status(uuid,uuid,text,text,uuid,uuid)'::regprocedure,
      'plugin_data.csf_link_activity_project(uuid,uuid,uuid,uuid,uuid)'::regprocedure,
      'plugin_data.csf_set_partner_club_status(uuid,uuid,text,uuid,uuid)'::regprocedure,
      'plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)'::regprocedure,
      'plugin_data.csf_upsert_partner_club_policy(uuid,uuid,uuid,jsonb)'::regprocedure,
      'plugin_data.csf_assign_partner_representative(uuid,uuid,text,text,text,date,boolean,uuid,uuid)'::regprocedure,
      'plugin_data.csf_revoke_partner_representative(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure
    )
  ),
  'every stable wrapper is SECURITY DEFINER with an empty search path'
);
SELECT extensions.ok(
  (
    SELECT bool_and(proc.prosecdef AND proc.proconfig @> ARRAY['search_path=""']::text[])
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid IN (
      'plugin_data.csf_create_activity_locked_impl(uuid,uuid,uuid,jsonb,uuid,uuid)'::regprocedure,
      'plugin_data.csf_update_activity_locked_impl(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)'::regprocedure,
      'plugin_data.csf_set_activity_status_locked_impl(uuid,uuid,text,text,uuid,uuid)'::regprocedure,
      'plugin_data.csf_link_activity_project_locked_impl(uuid,uuid,uuid,uuid,uuid)'::regprocedure,
      'plugin_data.csf_set_partner_club_status_locked_impl(uuid,uuid,text,uuid,uuid)'::regprocedure,
      'plugin_data.csf_set_partner_club_term_status_locked_impl(uuid,uuid,text,text,uuid,uuid)'::regprocedure,
      'plugin_data.csf_upsert_partner_club_policy_locked_impl(uuid,uuid,uuid,jsonb)'::regprocedure,
      'plugin_data.csf_assign_partner_representative_locked_impl(uuid,uuid,text,text,text,date,boolean,uuid,uuid)'::regprocedure,
      'plugin_data.csf_revoke_partner_representative_locked_impl(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure
    )
  ),
  'every retained implementation is still SECURITY DEFINER with an empty search path'
);
WITH wrapper_contract(name, signature, permission_key) AS (
  VALUES
    ('csf_create_activity', 'plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid,uuid)', 'manage_opportunities'),
    ('csf_update_activity', 'plugin_data.csf_update_activity(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)', 'manage_opportunities'),
    ('csf_set_activity_status', 'plugin_data.csf_set_activity_status(uuid,uuid,text,text,uuid,uuid)', 'manage_opportunities'),
    ('csf_link_activity_project', 'plugin_data.csf_link_activity_project(uuid,uuid,uuid,uuid,uuid)', 'manage_opportunities'),
    ('csf_set_partner_club_status', 'plugin_data.csf_set_partner_club_status(uuid,uuid,text,uuid,uuid)', 'manage_partner_clubs'),
    ('csf_set_partner_club_term_status', 'plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)', 'manage_partner_clubs'),
    ('csf_upsert_partner_club_policy', 'plugin_data.csf_upsert_partner_club_policy(uuid,uuid,uuid,jsonb)', 'manage_partner_clubs'),
    ('csf_assign_partner_representative', 'plugin_data.csf_assign_partner_representative(uuid,uuid,text,text,text,date,boolean,uuid,uuid)', 'manage_partner_clubs'),
    ('csf_revoke_partner_representative', 'plugin_data.csf_revoke_partner_representative(uuid,uuid,uuid,text,uuid,uuid)', 'manage_partner_clubs')
),
definitions AS (
  SELECT
    contract.*,
    pg_get_functiondef(contract.signature::regprocedure) AS definition
  FROM wrapper_contract AS contract
)
SELECT extensions.ok(
  bool_and(
    (
      pg_catalog.length(definition)
        - pg_catalog.length(
            pg_catalog.replace(definition, 'csf_actor_has_permission', '')
          )
    ) / pg_catalog.length('csf_actor_has_permission') = 2
    AND pg_catalog.strpos(definition, 'csf_actor_has_permission')
      < pg_catalog.strpos(definition, 'csf_staff_access_lock_key')
    AND pg_catalog.strpos(definition, 'csf_staff_access_lock_key')
      < pg_catalog.strpos(definition, 'FROM public.organization_members AS member')
    AND pg_catalog.strpos(definition, 'FROM public.organization_members AS member')
      < pg_catalog.strpos(definition, 'FOR SHARE')
    AND pg_catalog.strpos(definition, 'FOR SHARE')
      < pg_catalog.strpos(definition, 'IF NOT FOUND')
    AND pg_catalog.strpos(definition, 'IF NOT FOUND')
      < pg_catalog.strpos(definition, name || '_locked_impl')
    AND definition LIKE '%' || permission_key || '%'
    AND definition LIKE '%member.status = ''active''%'
  ),
  'each wrapper checks its exact permission twice and takes staff access then the active membership share lock before delegation'
)
FROM definitions;
WITH expected_arguments(signature, arguments) AS (
  VALUES
    (
      'plugin_data.csf_create_activity(uuid,uuid,uuid,jsonb,uuid,uuid)',
      'p_organization_id uuid, p_term_id uuid, p_cohort_id uuid, p_activity jsonb, p_actor_user_id uuid, p_request_id uuid'
    ),
    (
      'plugin_data.csf_update_activity(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)',
      'p_organization_id uuid, p_activity_id uuid, p_term_id uuid, p_cohort_id uuid, p_activity jsonb, p_actor_user_id uuid, p_request_id uuid'
    ),
    (
      'plugin_data.csf_set_activity_status(uuid,uuid,text,text,uuid,uuid)',
      'p_organization_id uuid, p_activity_id uuid, p_status text, p_reason text, p_actor_user_id uuid, p_request_id uuid'
    ),
    (
      'plugin_data.csf_link_activity_project(uuid,uuid,uuid,uuid,uuid)',
      'p_organization_id uuid, p_activity_id uuid, p_project_id uuid, p_actor_user_id uuid, p_request_id uuid'
    ),
    (
      'plugin_data.csf_set_partner_club_status(uuid,uuid,text,uuid,uuid)',
      'p_organization_id uuid, p_partner_club_id uuid, p_status text, p_actor_user_id uuid, p_request_id uuid'
    ),
    (
      'plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)',
      'p_organization_id uuid, p_partner_club_term_id uuid, p_status text, p_reason text, p_actor_user_id uuid, p_correlation_id uuid'
    ),
    (
      'plugin_data.csf_upsert_partner_club_policy(uuid,uuid,uuid,jsonb)',
      'p_organization_id uuid, p_actor_user_id uuid, p_request_id uuid, p_request jsonb'
    ),
    (
      'plugin_data.csf_assign_partner_representative(uuid,uuid,text,text,text,date,boolean,uuid,uuid)',
      'p_organization_id uuid, p_partner_club_term_id uuid, p_display_name text, p_email text, p_role text, p_effective_start date, p_is_primary boolean, p_request_id uuid, p_actor_user_id uuid'
    ),
    (
      'plugin_data.csf_revoke_partner_representative(uuid,uuid,uuid,text,uuid,uuid)',
      'p_organization_id uuid, p_assignment_id uuid, p_partner_club_term_id uuid, p_reason text, p_request_id uuid, p_actor_user_id uuid'
    )
)
SELECT extensions.ok(
  bool_and(
    pg_get_function_arguments(signature::regprocedure) = arguments
    AND pg_get_function_result(signature::regprocedure) = 'jsonb'
  ),
  'every wrapper preserves its exact prior named arguments and jsonb result'
)
FROM expected_arguments;

-- The dblink sessions below commit independently, so a previous interrupted
-- run can leave these fixed synthetic fixtures behind. Clean before setup as
-- well as at EOF to make the next replay self-healing.
CREATE OR REPLACE FUNCTION pg_temp.cleanup_csf_activity_partner_fixtures()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  DELETE FROM plugin_data.csf_partner_club_representatives
  WHERE organization_id IN (
    'f9100000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_partner_club_terms
  WHERE organization_id IN (
    'f9100000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_partner_submission_batches
  WHERE organization_id IN (
    'f9100000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_partner_club_aliases
  WHERE organization_id IN (
    'f9100000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_opportunities
  WHERE organization_id IN (
    'f9100000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_partner_clubs
  WHERE organization_id IN (
    'f9100000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000002'
  );
  DELETE FROM public.projects
  WHERE organization_id IN (
    'f9100000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_terms
  WHERE organization_id IN (
    'f9100000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_staff_positions
  WHERE organization_id = 'f9100000-0000-4000-8000-000000000001';
  DELETE FROM plugin_data.csf_role_permissions
  WHERE organization_id = 'f9100000-0000-4000-8000-000000000001';
  DELETE FROM plugin_data.csf_roles
  WHERE organization_id = 'f9100000-0000-4000-8000-000000000001';
  DELETE FROM public.organization_members
  WHERE organization_id IN (
    'f9100000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000002'
  );
  DELETE FROM public.organizations
  WHERE id IN (
    'f9100000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000002'
  );
  DELETE FROM auth.users
  WHERE id IN (
    'f9000000-0000-4000-8000-000000000001',
    'f9000000-0000-4000-8000-000000000002',
    'f9000000-0000-4000-8000-000000000003',
    'f9000000-0000-4000-8000-000000000004',
    'f9000000-0000-4000-8000-000000000005',
    'f9000000-0000-4000-8000-000000000006',
    'f9000000-0000-4000-8000-000000000007',
    'f9000000-0000-4000-8000-000000000008',
    'f9000000-0000-4000-8000-000000000009',
    'f9000000-0000-4000-8000-000000000010',
    'f9000000-0000-4000-8000-000000000011',
    'f9000000-0000-4000-8000-000000000012'
  );
END;
$function$;

-- The immutable audit and append-only lifecycle triggers require replica mode
-- for test-only deletion. SET LOCAL confines it to this transaction even when
-- deletion raises and the transaction is rolled back, so an interrupted run
-- cannot leak replica mode.
CREATE OR REPLACE FUNCTION pg_temp.cleanup_csf_activity_partner_receipts()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  DELETE FROM plugin_data.csf_admin_audit_events
  WHERE organization_id IN (
    'f9100000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_partner_club_term_events
  WHERE organization_id IN (
    'f9100000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000002'
  );
  DELETE FROM plugin_data.csf_staff_position_history
  WHERE organization_id = 'f9100000-0000-4000-8000-000000000001';
END;
$function$;

BEGIN;
SET LOCAL session_replication_role = replica;
SELECT pg_temp.cleanup_csf_activity_partner_receipts();
COMMIT;
SELECT pg_temp.cleanup_csf_activity_partner_fixtures();

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('f9000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'activity-fence-admin@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'activity-fence-create@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'activity-fence-update@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'activity-fence-status@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'activity-fence-link@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'activity-fence-partner@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'activity-fence-other-admin@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'activity-fence-standing@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'activity-fence-policy@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'activity-fence-retry@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'activity-fence-representative-assign@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'activity-fence-representative-revoke@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('f9100000-0000-4000-8000-000000000001', 'Activity Authorization Fence', 'activity-authorization-fence', 'school', '995501'),
  ('f9100000-0000-4000-8000-000000000002', 'Independent Activity Fence', 'independent-activity-fence', 'school', '995502');

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  ('f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000003', 'member', 'active'),
  ('f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000004', 'member', 'active'),
  ('f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000005', 'member', 'active'),
  ('f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000006', 'member', 'active'),
  ('f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000008', 'member', 'active'),
  ('f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000009', 'member', 'active'),
  ('f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000010', 'member', 'active'),
  ('f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000011', 'member', 'active'),
  ('f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000012', 'member', 'active'),
  ('f9100000-0000-4000-8000-000000000002', 'f9000000-0000-4000-8000-000000000007', 'admin', 'active');

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, public_title,
  responsibility_label, description, role_type, is_system, sort_order
) VALUES
  ('f9700000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'activity-fence-create', 'Create officer', 'Create officer', 'Activity creation', 'Synthetic authorization-fence role.', 'custom', false, 501),
  ('f9700000-0000-4000-8000-000000000002', 'f9100000-0000-4000-8000-000000000001', 'activity-fence-update', 'Update officer', 'Update officer', 'Activity updates', 'Synthetic authorization-fence role.', 'custom', false, 502),
  ('f9700000-0000-4000-8000-000000000003', 'f9100000-0000-4000-8000-000000000001', 'activity-fence-status', 'Status officer', 'Status officer', 'Activity status', 'Synthetic authorization-fence role.', 'custom', false, 503),
  ('f9700000-0000-4000-8000-000000000004', 'f9100000-0000-4000-8000-000000000001', 'activity-fence-link', 'Link officer', 'Link officer', 'Project links', 'Synthetic authorization-fence role.', 'custom', false, 504),
  ('f9700000-0000-4000-8000-000000000005', 'f9100000-0000-4000-8000-000000000001', 'activity-fence-partner', 'Partner officer', 'Partner officer', 'Partner clubs', 'Synthetic authorization-fence role.', 'custom', false, 505),
  ('f9700000-0000-4000-8000-000000000006', 'f9100000-0000-4000-8000-000000000001', 'activity-fence-standing', 'Standing officer', 'Standing officer', 'Club standing', 'Synthetic authorization-fence role.', 'custom', false, 506),
  ('f9700000-0000-4000-8000-000000000007', 'f9100000-0000-4000-8000-000000000001', 'activity-fence-policy', 'Policy officer', 'Policy officer', 'Club policy', 'Synthetic authorization-fence role.', 'custom', false, 507),
  ('f9700000-0000-4000-8000-000000000008', 'f9100000-0000-4000-8000-000000000001', 'activity-fence-retry', 'Retry officer', 'Retry officer', 'Activity retries', 'Synthetic authorization-fence role.', 'custom', false, 508),
  ('f9700000-0000-4000-8000-000000000009', 'f9100000-0000-4000-8000-000000000001', 'activity-fence-representative-assign', 'Representative assignment officer', 'Representative assignment officer', 'Representative assignments', 'Synthetic authorization-fence role.', 'custom', false, 509),
  ('f9700000-0000-4000-8000-000000000010', 'f9100000-0000-4000-8000-000000000001', 'activity-fence-representative-revoke', 'Representative revocation officer', 'Representative revocation officer', 'Representative revocations', 'Synthetic authorization-fence role.', 'custom', false, 510);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES
  ('f9100000-0000-4000-8000-000000000001', 'f9700000-0000-4000-8000-000000000001', 'manage_opportunities', true),
  ('f9100000-0000-4000-8000-000000000001', 'f9700000-0000-4000-8000-000000000002', 'manage_opportunities', true),
  ('f9100000-0000-4000-8000-000000000001', 'f9700000-0000-4000-8000-000000000003', 'manage_opportunities', true),
  ('f9100000-0000-4000-8000-000000000001', 'f9700000-0000-4000-8000-000000000004', 'manage_opportunities', true),
  ('f9100000-0000-4000-8000-000000000001', 'f9700000-0000-4000-8000-000000000005', 'manage_partner_clubs', true),
  ('f9100000-0000-4000-8000-000000000001', 'f9700000-0000-4000-8000-000000000006', 'manage_partner_clubs', true),
  ('f9100000-0000-4000-8000-000000000001', 'f9700000-0000-4000-8000-000000000007', 'manage_partner_clubs', true),
  ('f9100000-0000-4000-8000-000000000001', 'f9700000-0000-4000-8000-000000000008', 'manage_opportunities', true),
  ('f9100000-0000-4000-8000-000000000001', 'f9700000-0000-4000-8000-000000000009', 'manage_partner_clubs', true),
  ('f9100000-0000-4000-8000-000000000001', 'f9700000-0000-4000-8000-000000000010', 'manage_partner_clubs', true);

INSERT INTO plugin_data.csf_staff_positions (
  id, organization_id, user_id, role_id, school_year,
  display_title, status, starts_at, ends_at
) VALUES
  ('f9800000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000002', 'f9700000-0000-4000-8000-000000000001', '2040-2041', 'Create officer', 'active', current_date - 1, current_date + 30),
  ('f9800000-0000-4000-8000-000000000002', 'f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000003', 'f9700000-0000-4000-8000-000000000002', '2040-2041', 'Update officer', 'active', current_date - 1, current_date + 30),
  ('f9800000-0000-4000-8000-000000000003', 'f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000004', 'f9700000-0000-4000-8000-000000000003', '2040-2041', 'Status officer', 'active', current_date - 1, current_date + 30),
  ('f9800000-0000-4000-8000-000000000004', 'f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000005', 'f9700000-0000-4000-8000-000000000004', '2040-2041', 'Link officer', 'active', current_date - 1, current_date + 30),
  ('f9800000-0000-4000-8000-000000000005', 'f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000006', 'f9700000-0000-4000-8000-000000000005', '2040-2041', 'Partner officer', 'active', current_date - 1, current_date + 30),
  ('f9800000-0000-4000-8000-000000000006', 'f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000008', 'f9700000-0000-4000-8000-000000000006', '2040-2041', 'Standing officer', 'active', current_date - 1, current_date + 30),
  ('f9800000-0000-4000-8000-000000000007', 'f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000009', 'f9700000-0000-4000-8000-000000000007', '2040-2041', 'Policy officer', 'active', current_date - 1, current_date + 30),
  ('f9800000-0000-4000-8000-000000000008', 'f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000010', 'f9700000-0000-4000-8000-000000000008', '2040-2041', 'Retry officer', 'active', current_date - 1, current_date + 30),
  ('f9800000-0000-4000-8000-000000000009', 'f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000011', 'f9700000-0000-4000-8000-000000000009', '2040-2041', 'Representative assignment officer', 'active', current_date - 1, current_date + 30),
  ('f9800000-0000-4000-8000-000000000010', 'f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000012', 'f9700000-0000-4000-8000-000000000010', '2040-2041', 'Representative revocation officer', 'active', current_date - 1, current_date + 30);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES
  ('f9200000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'F40', 'Fall 2040', '2040-2041', 'fall', 'open', true),
  ('f9200000-0000-4000-8000-000000000002', 'f9100000-0000-4000-8000-000000000002', 'F40', 'Fall 2040', '2040-2041', 'fall', 'open', true);

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description,
  event_type, verification_method, schedule, require_login
) VALUES
  ('f9400000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'Fence Project', 'Local', 'Synthetic project.', 'single', 'manual', '{}'::jsonb, true),
  ('f9400000-0000-4000-8000-000000000002', 'f9000000-0000-4000-8000-000000000007', 'f9100000-0000-4000-8000-000000000002', 'Independent Project', 'Local', 'Synthetic project.', 'single', 'manual', '{}'::jsonb, true);

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, title, body, starts_at, status,
  signup_mode, created_by_user_id
) VALUES
  ('f9500000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'f9200000-0000-4000-8000-000000000001', 'Update unchanged', 'Update unchanged', '2040-09-10 17:00:00+00', 'draft', 'none', 'f9000000-0000-4000-8000-000000000001'),
  ('f9500000-0000-4000-8000-000000000002', 'f9100000-0000-4000-8000-000000000001', 'f9200000-0000-4000-8000-000000000001', 'Status unchanged', 'Status unchanged', '2040-09-11 17:00:00+00', 'draft', 'none', 'f9000000-0000-4000-8000-000000000001'),
  ('f9500000-0000-4000-8000-000000000003', 'f9100000-0000-4000-8000-000000000001', 'f9200000-0000-4000-8000-000000000001', 'Link unchanged', 'Link unchanged', '2040-09-12 17:00:00+00', 'draft', 'none', 'f9000000-0000-4000-8000-000000000001');

INSERT INTO plugin_data.csf_partner_clubs (
  id, organization_id, name, status, created_by
) VALUES
  ('f9600000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'Fence Club', 'active', 'f9000000-0000-4000-8000-000000000001'),
  ('f9600000-0000-4000-8000-000000000002', 'f9100000-0000-4000-8000-000000000002', 'Independent Club', 'active', 'f9000000-0000-4000-8000-000000000007'),
  ('f9600000-0000-4000-8000-000000000003', 'f9100000-0000-4000-8000-000000000001', 'Standing Fence Club', 'active', 'f9000000-0000-4000-8000-000000000001');

INSERT INTO plugin_data.csf_partner_club_terms (
  id, organization_id, partner_club_id, term_id, relationship_status,
  workflow_status, approved_point_types, non_drive_points, drive_points,
  proof_required
) VALUES
  ('f9b00000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'f9600000-0000-4000-8000-000000000003', 'f9200000-0000-4000-8000-000000000001', 'new', 'active', ARRAY['non_drive']::text[], 2, 0, true);

INSERT INTO plugin_data.csf_partner_club_representatives (
  id, organization_id, partner_club_term_id, role, display_name, email,
  status, effective_start, is_primary, created_by, metadata
) VALUES (
  'f9c00000-0000-4000-8000-000000000001',
  'f9100000-0000-4000-8000-000000000001',
  'f9b00000-0000-4000-8000-000000000001',
  'coordinator',
  'Revocation Target',
  'revocation-target@local.test',
  'invited',
  current_date,
  false,
  'f9000000-0000-4000-8000-000000000001',
  '{}'::jsonb
);

CREATE TEMP TABLE csf_activity_partner_fence_results (
  key text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT PRESERVE ROWS;

CREATE FUNCTION pg_temp.wait_for_csf_activity_partner_lock(p_marker text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_waiting boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '5 seconds';
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity AS activity
      WHERE activity.pid <> pg_catalog.pg_backend_pid()
        AND activity.query LIKE '%' || p_marker || '%'
        AND activity.wait_event_type = 'Lock'
        AND activity.wait_event = 'advisory'
    )
    INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  RETURN v_waiting;
END;
$$;

CREATE FUNCTION pg_temp.wait_for_csf_activity_partner_result(p_connection text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_complete boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '5 seconds';
BEGIN
  LOOP
    v_complete := extensions.dblink_is_busy(p_connection) = 0;
    EXIT WHEN v_complete OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  RETURN v_complete;
END;
$$;

CREATE FUNCTION pg_temp.csf_activity_partner_fence_dsn()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'hostaddr=' || host(inet_server_addr()) ||
    ' port=' || current_setting('port') ||
    ' dbname=' || current_database() ||
    ' user=' || current_user ||
    ' password=' || current_user ||
    ' sslmode=disable'
$$;

-- 9-10: establish one committed receipt whose exact replay must later be denied.
INSERT INTO csf_activity_partner_fence_results (key, payload)
SELECT 'authorized_replay_baseline', plugin_data.csf_create_activity(
  'f9100000-0000-4000-8000-000000000001',
  'f9200000-0000-4000-8000-000000000001',
  NULL,
  '{"title":"Authorized replay baseline","startsAt":"2040-09-20T17:00:00Z","status":"draft","signupMode":"none"}'::jsonb,
  'f9000000-0000-4000-8000-000000000002',
  'f9a00000-0000-4000-8000-000000000000'
);
SELECT extensions.is(
  (SELECT payload ->> 'idempotent'
   FROM csf_activity_partner_fence_results
   WHERE key = 'authorized_replay_baseline'),
  'false',
  'the activity officer can commit the baseline request before revocation'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_opportunities AS activity
    JOIN csf_activity_partner_fence_results AS result
      ON result.key = 'authorized_replay_baseline'
     AND activity.id = (result.payload ->> 'activityId')::uuid
    WHERE activity.organization_id = 'f9100000-0000-4000-8000-000000000001'
      AND activity.title = 'Authorized replay baseline'
  )
  AND (
    SELECT count(*) = 1
    FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000000'
  ),
  'the baseline request writes one target and one immutable receipt'
);

-- 11-15: create queued behind a role-permission edit.
SELECT extensions.dblink_connect(
  'activity_create_role_revoked',
  pg_temp.csf_activity_partner_fence_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('f9100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'activity_create_role_revoked',
  $query$
    SELECT plugin_data.csf_create_activity(
      'f9100000-0000-4000-8000-000000000001'::uuid,
      'f9200000-0000-4000-8000-000000000001'::uuid,
      NULL,
      '{"title":"Revoked queued create","startsAt":"2040-09-21T17:00:00Z","status":"draft","signupMode":"none"}'::jsonb,
      'f9000000-0000-4000-8000-000000000002'::uuid,
      'f9a00000-0000-4000-8000-000000000001'::uuid
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_lock('f9a00000-0000-4000-8000-000000000001'),
  'the queued create passes its first check and waits on the staff-access lock'
);
SELECT plugin_data.csf_update_role(
  'f9100000-0000-4000-8000-000000000001',
  'f9700000-0000-4000-8000-000000000001',
  'Create officer', 'Activity creation',
  'Permission revoked while an activity create waits.',
  ARRAY[]::text[], NULL,
  'f9000000-0000-4000-8000-000000000001'
);
COMMIT;
SELECT *
FROM extensions.dblink_get_result('activity_create_role_revoked', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF activities.'
    IN extensions.dblink_error_message('activity_create_role_revoked')
  ) > 0,
  'the queued create fails after the role edit commits'
);
SELECT extensions.dblink_disconnect('activity_create_role_revoked');
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_opportunities
   WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
     AND title = 'Revoked queued create'),
  0,
  'the revoked queued create writes no activity'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000001'),
  0,
  'the revoked queued create writes no audit receipt'
);
SELECT extensions.is(
  (SELECT enabled::text
   FROM plugin_data.csf_role_permissions
   WHERE role_id = 'f9700000-0000-4000-8000-000000000001'
     AND permission_key = 'manage_opportunities'),
  'false',
  'the create actor role edit committed before the queued call resumed'
);

-- 16-20: update queued behind a position revocation.
SELECT extensions.dblink_connect(
  'activity_update_position_revoked',
  pg_temp.csf_activity_partner_fence_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('f9100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'activity_update_position_revoked',
  $query$
    SELECT plugin_data.csf_update_activity(
      'f9100000-0000-4000-8000-000000000001'::uuid,
      'f9500000-0000-4000-8000-000000000001'::uuid,
      'f9200000-0000-4000-8000-000000000001'::uuid,
      NULL,
      '{"title":"Revoked queued update","startsAt":"2040-09-22T17:00:00Z","signupMode":"none"}'::jsonb,
      'f9000000-0000-4000-8000-000000000003'::uuid,
      'f9a00000-0000-4000-8000-000000000002'::uuid
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_lock('f9a00000-0000-4000-8000-000000000002'),
  'the queued update passes its first check and waits on the staff-access lock'
);
SELECT plugin_data.csf_revoke_staff_position(
  'f9100000-0000-4000-8000-000000000001',
  'f9800000-0000-4000-8000-000000000002',
  NULL,
  'Revoke the queued update actor position',
  'f9000000-0000-4000-8000-000000000001'
);
COMMIT;
SELECT *
FROM extensions.dblink_get_result('activity_update_position_revoked', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF activities.'
    IN extensions.dblink_error_message('activity_update_position_revoked')
  ) > 0,
  'the queued update fails after the position revocation commits'
);
SELECT extensions.dblink_disconnect('activity_update_position_revoked');
SELECT extensions.is(
  (SELECT title
   FROM plugin_data.csf_opportunities
   WHERE id = 'f9500000-0000-4000-8000-000000000001'),
  'Update unchanged',
  'the revoked queued update leaves its target unchanged'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000002'),
  0,
  'the revoked queued update writes no audit receipt'
);
SELECT extensions.is(
  (SELECT status
   FROM plugin_data.csf_staff_positions
   WHERE id = 'f9800000-0000-4000-8000-000000000002'),
  'ended',
  'the update actor position revocation committed before the call resumed'
);

-- 21-25: status transition queued behind a role-permission edit.
SELECT extensions.dblink_connect(
  'activity_status_role_revoked',
  pg_temp.csf_activity_partner_fence_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('f9100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'activity_status_role_revoked',
  $query$
    SELECT plugin_data.csf_set_activity_status(
      'f9100000-0000-4000-8000-000000000001'::uuid,
      'f9500000-0000-4000-8000-000000000002'::uuid,
      'published', NULL,
      'f9000000-0000-4000-8000-000000000004'::uuid,
      'f9a00000-0000-4000-8000-000000000003'::uuid
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_lock('f9a00000-0000-4000-8000-000000000003'),
  'the queued status call passes its first check and waits on the staff-access lock'
);
SELECT plugin_data.csf_update_role(
  'f9100000-0000-4000-8000-000000000001',
  'f9700000-0000-4000-8000-000000000003',
  'Status officer', 'Activity status',
  'Permission revoked while a status transition waits.',
  ARRAY[]::text[], NULL,
  'f9000000-0000-4000-8000-000000000001'
);
COMMIT;
SELECT *
FROM extensions.dblink_get_result('activity_status_role_revoked', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF activities.'
    IN extensions.dblink_error_message('activity_status_role_revoked')
  ) > 0,
  'the queued status call fails after the role edit commits'
);
SELECT extensions.dblink_disconnect('activity_status_role_revoked');
SELECT extensions.is(
  (SELECT status
   FROM plugin_data.csf_opportunities
   WHERE id = 'f9500000-0000-4000-8000-000000000002'),
  'draft',
  'the revoked queued status call leaves its target unchanged'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000003'),
  0,
  'the revoked queued status call writes no audit receipt'
);
SELECT extensions.is(
  (SELECT enabled::text
   FROM plugin_data.csf_role_permissions
   WHERE role_id = 'f9700000-0000-4000-8000-000000000003'
     AND permission_key = 'manage_opportunities'),
  'false',
  'the status actor role edit committed before the call resumed'
);

-- 26-30: project link queued behind a position revocation.
SELECT extensions.ok(
  plugin_data.csf_actor_has_permission(
    'f9100000-0000-4000-8000-000000000001',
    'f9000000-0000-4000-8000-000000000005',
    'manage_opportunities'
  ),
  'the project-link actor is authorized before the concurrent revocation'
);
SELECT extensions.dblink_connect(
  'activity_link_position_revoked',
  pg_temp.csf_activity_partner_fence_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('f9100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'activity_link_position_revoked',
  $query$
    SELECT plugin_data.csf_link_activity_project(
      'f9100000-0000-4000-8000-000000000001'::uuid,
      'f9500000-0000-4000-8000-000000000003'::uuid,
      'f9400000-0000-4000-8000-000000000001'::uuid,
      'f9000000-0000-4000-8000-000000000005'::uuid,
      'f9a00000-0000-4000-8000-000000000004'::uuid
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_lock('f9a00000-0000-4000-8000-000000000004'),
  'the queued link passes its first check and waits on the staff-access lock'
);
SELECT plugin_data.csf_revoke_staff_position(
  'f9100000-0000-4000-8000-000000000001',
  'f9800000-0000-4000-8000-000000000004',
  NULL,
  'Revoke the queued project-link actor position',
  'f9000000-0000-4000-8000-000000000001'
);
COMMIT;
SELECT *
FROM extensions.dblink_get_result('activity_link_position_revoked', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF activities.'
    IN extensions.dblink_error_message('activity_link_position_revoked')
  ) > 0,
  'the queued link fails after the position revocation commits'
);
SELECT extensions.dblink_disconnect('activity_link_position_revoked');
SELECT extensions.ok(
  (SELECT linked_project_id IS NULL AND signup_mode = 'none'
   FROM plugin_data.csf_opportunities
   WHERE id = 'f9500000-0000-4000-8000-000000000003'),
  'the revoked queued link leaves its target unchanged'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000004'),
  0,
  'the revoked queued link writes no audit receipt'
);
SELECT extensions.is(
  (SELECT status
   FROM plugin_data.csf_staff_positions
   WHERE id = 'f9800000-0000-4000-8000-000000000004'),
  'ended',
  'the link actor position revocation committed before the call resumed'
);

-- 31-35: partner-club status queued behind a role-permission edit.
SELECT extensions.dblink_connect(
  'partner_status_role_revoked',
  pg_temp.csf_activity_partner_fence_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('f9100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'partner_status_role_revoked',
  $query$
    SELECT plugin_data.csf_set_partner_club_status(
      'f9100000-0000-4000-8000-000000000001'::uuid,
      'f9600000-0000-4000-8000-000000000001'::uuid,
      'archived',
      'f9000000-0000-4000-8000-000000000006'::uuid,
      'f9a00000-0000-4000-8000-000000000005'::uuid
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_lock('f9a00000-0000-4000-8000-000000000005'),
  'the queued partner call passes its first check and waits on the staff-access lock'
);
SELECT plugin_data.csf_update_role(
  'f9100000-0000-4000-8000-000000000001',
  'f9700000-0000-4000-8000-000000000005',
  'Partner officer', 'Partner clubs',
  'Permission revoked while a partner status call waits.',
  ARRAY[]::text[], NULL,
  'f9000000-0000-4000-8000-000000000001'
);
COMMIT;
SELECT *
FROM extensions.dblink_get_result('partner_status_role_revoked', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF partner clubs.'
    IN extensions.dblink_error_message('partner_status_role_revoked')
  ) > 0,
  'the queued partner call fails after the role edit commits'
);
SELECT extensions.dblink_disconnect('partner_status_role_revoked');
SELECT extensions.is(
  (SELECT status
   FROM plugin_data.csf_partner_clubs
   WHERE id = 'f9600000-0000-4000-8000-000000000001'),
  'active',
  'the revoked queued partner call leaves its target unchanged'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000005'),
  0,
  'the revoked queued partner call writes no audit receipt'
);
SELECT extensions.is(
  (SELECT enabled::text
   FROM plugin_data.csf_role_permissions
   WHERE role_id = 'f9700000-0000-4000-8000-000000000005'
     AND permission_key = 'manage_partner_clubs'),
  'false',
  'the partner actor role edit committed before the call resumed'
);

-- 36-40: partner-club semester standing queued behind a host membership
-- deactivation. The implementation's own key is per club term, so only the
-- wrapper's staff-access lock can order this call against the membership edit.
SELECT extensions.ok(
  plugin_data.csf_actor_has_permission(
    'f9100000-0000-4000-8000-000000000001',
    'f9000000-0000-4000-8000-000000000008',
    'manage_partner_clubs'
  ),
  'the standing actor is authorized before the concurrent membership deactivation'
);
SELECT extensions.dblink_connect(
  'partner_standing_membership_deactivated',
  pg_temp.csf_activity_partner_fence_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('f9100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'partner_standing_membership_deactivated',
  $query$
    SELECT plugin_data.csf_set_partner_club_term_status(
      'f9100000-0000-4000-8000-000000000001'::uuid,
      'f9b00000-0000-4000-8000-000000000001'::uuid,
      'inactive',
      'Standing change queued behind a membership deactivation.',
      'f9000000-0000-4000-8000-000000000008'::uuid,
      'f9a00000-0000-4000-8000-000000000006'::uuid
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_lock('f9a00000-0000-4000-8000-000000000006'),
  'the queued standing call passes its first check and waits on the staff-access lock'
);
UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
  AND user_id = 'f9000000-0000-4000-8000-000000000008';
COMMIT;
SELECT *
FROM extensions.dblink_get_result('partner_standing_membership_deactivated', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF partner clubs.'
    IN extensions.dblink_error_message('partner_standing_membership_deactivated')
  ) > 0,
  'the queued standing call fails after the host membership is deactivated'
);
SELECT extensions.dblink_disconnect('partner_standing_membership_deactivated');
SELECT extensions.is(
  (SELECT workflow_status
   FROM plugin_data.csf_partner_club_terms
   WHERE id = 'f9b00000-0000-4000-8000-000000000001'),
  'active',
  'the deactivated queued standing call leaves its target unchanged'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000006')
  + (SELECT count(*)::integer
     FROM plugin_data.csf_partner_club_term_events
     WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000006'),
  0,
  'the deactivated queued standing call writes no audit or lifecycle receipt'
);
SELECT extensions.is(
  (SELECT status
   FROM public.organization_members
   WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
     AND user_id = 'f9000000-0000-4000-8000-000000000008'),
  'inactive',
  'the standing actor membership deactivation committed before the call resumed'
);

-- 41-45: partner-club policy review queued behind a host membership deletion,
-- which is the wrapper's IF NOT FOUND branch.
SELECT extensions.dblink_connect(
  'partner_policy_membership_deleted',
  pg_temp.csf_activity_partner_fence_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('f9100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'partner_policy_membership_deleted',
  $query$
    SELECT plugin_data.csf_upsert_partner_club_policy(
      'f9100000-0000-4000-8000-000000000001'::uuid,
      'f9000000-0000-4000-8000-000000000009'::uuid,
      'f9a00000-0000-4000-8000-000000000007'::uuid,
      '{"termId":"f9200000-0000-4000-8000-000000000001","termStatus":"new","name":"Deleted membership club","approvedPointTypes":["non_drive"],"nonDrivePoints":"2","drivePoints":"0","proofRequired":"true"}'::jsonb
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_lock('f9a00000-0000-4000-8000-000000000007'),
  'the queued policy call passes its first check and waits on the staff-access lock'
);
DELETE FROM public.organization_members
WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
  AND user_id = 'f9000000-0000-4000-8000-000000000009';
COMMIT;
SELECT *
FROM extensions.dblink_get_result('partner_policy_membership_deleted', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF partner clubs.'
    IN extensions.dblink_error_message('partner_policy_membership_deleted')
  ) > 0,
  'the queued policy call fails after the host membership row is deleted'
);
SELECT extensions.dblink_disconnect('partner_policy_membership_deleted');
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_partner_clubs
   WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
     AND name = 'Deleted membership club'),
  0,
  'the deleted-membership queued policy call writes no partner club'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000007')
  + (SELECT count(*)::integer
     FROM plugin_data.csf_partner_club_term_events
     WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000007'),
  0,
  'the deleted-membership queued policy call writes no audit or lifecycle receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM public.organization_members
   WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
     AND user_id = 'f9000000-0000-4000-8000-000000000009'),
  0,
  'the policy actor membership deletion committed before the call resumed'
);

-- 46-49: representative assignment queued behind a role-permission edit.
SELECT extensions.ok(
  plugin_data.csf_actor_has_permission(
    'f9100000-0000-4000-8000-000000000001',
    'f9000000-0000-4000-8000-000000000011',
    'manage_partner_clubs'
  ),
  'the assignment actor is authorized before the concurrent role edit'
);
SELECT extensions.dblink_connect(
  'representative_assignment_role_revoked',
  pg_temp.csf_activity_partner_fence_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('f9100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'representative_assignment_role_revoked',
  $query$
    SELECT plugin_data.csf_assign_partner_representative(
      'f9100000-0000-4000-8000-000000000001'::uuid,
      'f9b00000-0000-4000-8000-000000000001'::uuid,
      'Queued Assignment',
      'queued-assignment@local.test',
      'coordinator',
      current_date,
      false,
      'f9a00000-0000-4000-8000-000000000008'::uuid,
      'f9000000-0000-4000-8000-000000000011'::uuid
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_lock('f9a00000-0000-4000-8000-000000000008'),
  'the queued assignment passes its first check and waits on the staff-access lock'
);
SELECT plugin_data.csf_update_role(
  'f9100000-0000-4000-8000-000000000001',
  'f9700000-0000-4000-8000-000000000009',
  'Representative assignment officer', 'Representative assignments',
  'Permission revoked while a representative assignment waits.',
  ARRAY[]::text[], NULL,
  'f9000000-0000-4000-8000-000000000001'
);
COMMIT;
SELECT *
FROM extensions.dblink_get_result('representative_assignment_role_revoked', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF partner clubs.'
    IN extensions.dblink_error_message('representative_assignment_role_revoked')
  ) > 0,
  'the queued assignment fails after the role edit commits'
);
SELECT extensions.dblink_disconnect('representative_assignment_role_revoked');
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_partner_club_representatives
   WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
     AND normalized_email = 'queued-assignment@local.test')
  + (SELECT count(*)::integer
     FROM plugin_data.csf_partner_club_term_events
     WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
       AND idempotency_key = 'representative:assignment-request:f9a00000-0000-4000-8000-000000000008')
  + (SELECT count(*)::integer
     FROM plugin_data.csf_admin_audit_events
     WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
       AND actor_user_id = 'f9000000-0000-4000-8000-000000000011'
       AND action = 'partner_representative.assign'),
  0,
  'the revoked queued assignment writes no representative, lifecycle event, or audit receipt'
);
SELECT extensions.is(
  (SELECT enabled::text
   FROM plugin_data.csf_role_permissions
   WHERE role_id = 'f9700000-0000-4000-8000-000000000009'
     AND permission_key = 'manage_partner_clubs'),
  'false',
  'the assignment actor role edit committed before the queued call resumed'
);

-- 50-53: representative revocation queued behind a staff-position revocation.
SELECT extensions.ok(
  plugin_data.csf_actor_has_permission(
    'f9100000-0000-4000-8000-000000000001',
    'f9000000-0000-4000-8000-000000000012',
    'manage_partner_clubs'
  ),
  'the revocation actor is authorized before the concurrent position revocation'
);
SELECT extensions.dblink_connect(
  'representative_revocation_position_revoked',
  pg_temp.csf_activity_partner_fence_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('f9100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'representative_revocation_position_revoked',
  $query$
    SELECT plugin_data.csf_revoke_partner_representative(
      'f9100000-0000-4000-8000-000000000001'::uuid,
      'f9c00000-0000-4000-8000-000000000001'::uuid,
      'f9b00000-0000-4000-8000-000000000001'::uuid,
      'Revocation queued behind a concurrent position revocation.',
      'f9a00000-0000-4000-8000-000000000009'::uuid,
      'f9000000-0000-4000-8000-000000000012'::uuid
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_lock('f9a00000-0000-4000-8000-000000000009'),
  'the queued revocation passes its first check and waits on the staff-access lock'
);
SELECT plugin_data.csf_revoke_staff_position(
  'f9100000-0000-4000-8000-000000000001',
  'f9800000-0000-4000-8000-000000000010',
  NULL,
  'Revoke the queued representative-revocation actor position',
  'f9000000-0000-4000-8000-000000000001'
);
COMMIT;
SELECT *
FROM extensions.dblink_get_result('representative_revocation_position_revoked', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF partner clubs.'
    IN extensions.dblink_error_message('representative_revocation_position_revoked')
  ) > 0,
  'the queued revocation fails after the position revocation commits'
);
SELECT extensions.dblink_disconnect('representative_revocation_position_revoked');
SELECT extensions.ok(
  (SELECT status = 'invited' AND effective_end IS NULL
   FROM plugin_data.csf_partner_club_representatives
   WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
     AND id = 'f9c00000-0000-4000-8000-000000000001')
  AND (
    (SELECT count(*)
     FROM plugin_data.csf_partner_club_term_events
     WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000009')
    + (SELECT count(*)
       FROM plugin_data.csf_admin_audit_events
       WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000009')
  ) = 0,
  'the revoked queued revocation leaves the assignment unchanged and writes no lifecycle or audit receipt'
);
SELECT extensions.is(
  (SELECT status
   FROM plugin_data.csf_staff_positions
   WHERE id = 'f9800000-0000-4000-8000-000000000010'),
  'ended',
  'the revocation actor position revocation committed before the queued call resumed'
);

-- 54-56: the actor membership row is genuinely held for the whole transaction,
-- not merely re-read. A concurrent deactivation must block behind the share
-- lock while an open wrapper transaction is still uncommitted.
SELECT extensions.dblink_connect(
  'membership_share_hold',
  pg_temp.csf_activity_partner_fence_dsn()
);
SELECT extensions.dblink_exec('membership_share_hold', 'BEGIN');
SELECT *
FROM extensions.dblink(
  'membership_share_hold',
  $query$
    SELECT plugin_data.csf_create_activity(
      'f9100000-0000-4000-8000-000000000001'::uuid,
      'f9200000-0000-4000-8000-000000000001'::uuid,
      NULL,
      '{"title":"Share lock hold","startsAt":"2040-09-25T17:00:00Z","status":"draft","signupMode":"none"}'::jsonb,
      'f9000000-0000-4000-8000-000000000010'::uuid,
      'f9a00000-0000-4000-8000-000000000040'::uuid
    )::text
  $query$
) AS held(payload text);
SET lock_timeout = '750ms';
SELECT extensions.throws_ok(
  $$
    UPDATE public.organization_members
    SET status = 'inactive'
    WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
      AND user_id = 'f9000000-0000-4000-8000-000000000010'
  $$,
  '55P03',
  'canceling statement due to lock timeout',
  'a concurrent membership deactivation blocks while the wrapper holds the actor membership row'
);
RESET lock_timeout;
SELECT extensions.dblink_exec('membership_share_hold', 'ROLLBACK');
SELECT extensions.dblink_disconnect('membership_share_hold');
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_opportunities
   WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
     AND title = 'Share lock hold'),
  0,
  'the rolled-back share-lock transaction leaves no activity behind'
);
SELECT extensions.is(
  (SELECT status
   FROM public.organization_members
   WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
     AND user_id = 'f9000000-0000-4000-8000-000000000010'),
  'active',
  'the blocked deactivation left the retry actor membership active'
);

-- 57-60: a still-authorized queued call is not denied, and its exact retry is
-- still idempotent through the wrapper.
SELECT extensions.dblink_connect(
  'activity_retry_after_benign_edit',
  pg_temp.csf_activity_partner_fence_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('f9100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'activity_retry_after_benign_edit',
  $query$
    SELECT plugin_data.csf_create_activity(
      'f9100000-0000-4000-8000-000000000001'::uuid,
      'f9200000-0000-4000-8000-000000000001'::uuid,
      NULL,
      '{"title":"Retry queued create","startsAt":"2040-09-26T17:00:00Z","status":"draft","signupMode":"none"}'::jsonb,
      'f9000000-0000-4000-8000-000000000010'::uuid,
      'f9a00000-0000-4000-8000-000000000030'::uuid
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_lock('f9a00000-0000-4000-8000-000000000030'),
  'the still-authorized queued create waits on the staff-access lock'
);
SELECT plugin_data.csf_update_role(
  'f9100000-0000-4000-8000-000000000001',
  'f9700000-0000-4000-8000-000000000008',
  'Retry officer', 'Activity retries',
  'A benign staff edit that keeps the queued permission.',
  ARRAY['manage_opportunities']::text[], NULL,
  'f9000000-0000-4000-8000-000000000001'
);
COMMIT;
INSERT INTO csf_activity_partner_fence_results (key, payload)
SELECT 'retry_first', payload::jsonb
FROM extensions.dblink_get_result('activity_retry_after_benign_edit', false)
  AS result(payload text);
SELECT extensions.dblink_disconnect('activity_retry_after_benign_edit');
SELECT extensions.is(
  (SELECT payload ->> 'idempotent'
   FROM csf_activity_partner_fence_results
   WHERE key = 'retry_first'),
  'false',
  'a benign concurrent staff edit does not deny the still-authorized queued create'
);
INSERT INTO csf_activity_partner_fence_results (key, payload)
SELECT 'retry_second', plugin_data.csf_create_activity(
  'f9100000-0000-4000-8000-000000000001',
  'f9200000-0000-4000-8000-000000000001',
  NULL,
  '{"title":"Retry queued create","startsAt":"2040-09-26T17:00:00Z","status":"draft","signupMode":"none"}'::jsonb,
  'f9000000-0000-4000-8000-000000000010',
  'f9a00000-0000-4000-8000-000000000030'
);
SELECT extensions.ok(
  (
    SELECT (payload ->> 'idempotent')::boolean
    FROM csf_activity_partner_fence_results
    WHERE key = 'retry_second'
  )
  AND (
    SELECT first.payload ->> 'activityId' = second.payload ->> 'activityId'
    FROM csf_activity_partner_fence_results AS first
    CROSS JOIN csf_activity_partner_fence_results AS second
    WHERE first.key = 'retry_first'
      AND second.key = 'retry_second'
  ),
  'the exact retry of a committed request still returns its idempotent receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_opportunities
   WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
     AND title = 'Retry queued create')
  + (SELECT count(*)::integer
     FROM plugin_data.csf_admin_audit_events
     WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000030'),
  2,
  'the retried request leaves exactly one target row and one audit receipt'
);

-- 61-63: replay lookup never bypasses current authorization. The committed
-- outcome stays durable; only re-reading it through this boundary is denied.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_activity(
      'f9100000-0000-4000-8000-000000000001',
      'f9200000-0000-4000-8000-000000000001',
      NULL,
      '{"title":"Authorized replay baseline","startsAt":"2040-09-20T17:00:00Z","status":"draft","signupMode":"none"}'::jsonb,
      'f9000000-0000-4000-8000-000000000002',
      'f9a00000-0000-4000-8000-000000000000'
    )
  $$,
  'P0001',
  'Not authorized to manage CSF activities.',
  'an exact committed replay is denied after the actor loses permission'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_opportunities
   WHERE id = (
     SELECT (payload ->> 'activityId')::uuid
     FROM csf_activity_partner_fence_results
     WHERE key = 'authorized_replay_baseline'
   )
     AND title = 'Authorized replay baseline'),
  1,
  'the denied replay leaves the committed activity unchanged'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000000'),
  1,
  'the denied replay leaves exactly the original audit receipt'
);

-- 64-66: active organization admins retain the unchanged nine-RPC semantics.
INSERT INTO csf_activity_partner_fence_results (key, payload)
VALUES
  (
    'admin_create',
    plugin_data.csf_create_activity(
      'f9100000-0000-4000-8000-000000000001',
      'f9200000-0000-4000-8000-000000000001',
      NULL,
      '{"title":"Admin created","startsAt":"2040-09-23T17:00:00Z","status":"draft","signupMode":"none"}'::jsonb,
      'f9000000-0000-4000-8000-000000000001',
      'f9a00000-0000-4000-8000-000000000011'
    )
  ),
  (
    'admin_update',
    plugin_data.csf_update_activity(
      'f9100000-0000-4000-8000-000000000001',
      'f9500000-0000-4000-8000-000000000001',
      'f9200000-0000-4000-8000-000000000001',
      NULL,
      '{"title":"Admin updated","startsAt":"2040-09-24T17:00:00Z","signupMode":"none"}'::jsonb,
      'f9000000-0000-4000-8000-000000000001',
      'f9a00000-0000-4000-8000-000000000012'
    )
  ),
  (
    'admin_status',
    plugin_data.csf_set_activity_status(
      'f9100000-0000-4000-8000-000000000001',
      'f9500000-0000-4000-8000-000000000002',
      'published', NULL,
      'f9000000-0000-4000-8000-000000000001',
      'f9a00000-0000-4000-8000-000000000013'
    )
  ),
  (
    'admin_link',
    plugin_data.csf_link_activity_project(
      'f9100000-0000-4000-8000-000000000001',
      'f9500000-0000-4000-8000-000000000003',
      'f9400000-0000-4000-8000-000000000001',
      'f9000000-0000-4000-8000-000000000001',
      'f9a00000-0000-4000-8000-000000000014'
    )
  ),
  (
    'admin_partner',
    plugin_data.csf_set_partner_club_status(
      'f9100000-0000-4000-8000-000000000001',
      'f9600000-0000-4000-8000-000000000001',
      'inactive',
      'f9000000-0000-4000-8000-000000000001',
      'f9a00000-0000-4000-8000-000000000015'
    )
  ),
  (
    'admin_standing',
    plugin_data.csf_set_partner_club_term_status(
      'f9100000-0000-4000-8000-000000000001',
      'f9b00000-0000-4000-8000-000000000001',
      'inactive',
      'Admin standing change.',
      'f9000000-0000-4000-8000-000000000001',
      'f9a00000-0000-4000-8000-000000000016'
    )
  ),
  (
    'admin_policy',
    plugin_data.csf_upsert_partner_club_policy(
      'f9100000-0000-4000-8000-000000000001',
      'f9000000-0000-4000-8000-000000000001',
      'f9a00000-0000-4000-8000-000000000017',
      '{"termId":"f9200000-0000-4000-8000-000000000001","termStatus":"new","name":"Admin policy club","approvedPointTypes":["non_drive"],"nonDrivePoints":"3","drivePoints":"0","proofRequired":"true"}'::jsonb
    )
  ),
  (
    'admin_representative_assign',
    plugin_data.csf_assign_partner_representative(
      'f9100000-0000-4000-8000-000000000001',
      'f9b00000-0000-4000-8000-000000000001',
      'Admin Assigned Representative',
      'admin-assigned-representative@local.test',
      'coordinator',
      current_date,
      false,
      'f9a00000-0000-4000-8000-000000000018',
      'f9000000-0000-4000-8000-000000000001'
    )
  ),
  (
    'admin_representative_revoke',
    plugin_data.csf_revoke_partner_representative(
      'f9100000-0000-4000-8000-000000000001',
      'f9c00000-0000-4000-8000-000000000001',
      'f9b00000-0000-4000-8000-000000000001',
      'Admin revocation control proves unchanged representative semantics.',
      'f9a00000-0000-4000-8000-000000000019',
      'f9000000-0000-4000-8000-000000000001'
    )
  );
SELECT extensions.ok(
  (
    SELECT count(*) = 9
      AND bool_and((payload ->> 'idempotent')::boolean = false)
    FROM csf_activity_partner_fence_results
    WHERE key LIKE 'admin_%'
  ),
  'the active admin receives the unchanged non-idempotent result contract from all nine RPCs'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_opportunities
    WHERE id = (
      SELECT (payload ->> 'activityId')::uuid
      FROM csf_activity_partner_fence_results
      WHERE key = 'admin_create'
    )
      AND title = 'Admin created'
  )
  AND (
    SELECT title = 'Admin updated'
    FROM plugin_data.csf_opportunities
    WHERE id = 'f9500000-0000-4000-8000-000000000001'
  )
  AND (
    SELECT status = 'published'
    FROM plugin_data.csf_opportunities
    WHERE id = 'f9500000-0000-4000-8000-000000000002'
  )
  AND (
    SELECT linked_project_id = 'f9400000-0000-4000-8000-000000000001'
      AND signup_mode = 'lets_assist_project'
    FROM plugin_data.csf_opportunities
    WHERE id = 'f9500000-0000-4000-8000-000000000003'
  )
  AND (
    SELECT status = 'inactive'
    FROM plugin_data.csf_partner_clubs
    WHERE id = 'f9600000-0000-4000-8000-000000000001'
  )
  AND (
    SELECT workflow_status = 'inactive'
    FROM plugin_data.csf_partner_club_terms
    WHERE id = 'f9b00000-0000-4000-8000-000000000001'
  )
  AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_partner_club_terms AS term
    JOIN plugin_data.csf_partner_clubs AS club
      ON club.organization_id = term.organization_id
     AND club.id = term.partner_club_id
    WHERE term.id = (
      SELECT (payload ->> 'partnerClubTermId')::uuid
      FROM csf_activity_partner_fence_results
      WHERE key = 'admin_policy'
    )
      AND club.name = 'Admin policy club'
      AND term.workflow_status = 'active'
  )
  AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_partner_club_representatives AS representative
    WHERE representative.id = (
      SELECT (payload ->> 'assignmentId')::uuid
      FROM csf_activity_partner_fence_results
      WHERE key = 'admin_representative_assign'
    )
      AND representative.organization_id = 'f9100000-0000-4000-8000-000000000001'
      AND representative.partner_club_term_id = 'f9b00000-0000-4000-8000-000000000001'
      AND representative.normalized_email = 'admin-assigned-representative@local.test'
      AND representative.status = 'invited'
  )
  AND (
    SELECT status = 'revoked'
      AND effective_end IS NOT NULL
    FROM plugin_data.csf_partner_club_representatives
    WHERE id = 'f9c00000-0000-4000-8000-000000000001'
  ),
  'the active admin preserves each target mutation semantics'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id IN (
     'f9a00000-0000-4000-8000-000000000011',
     'f9a00000-0000-4000-8000-000000000012',
     'f9a00000-0000-4000-8000-000000000013',
     'f9a00000-0000-4000-8000-000000000014',
     'f9a00000-0000-4000-8000-000000000015',
     'f9a00000-0000-4000-8000-000000000016',
     'f9a00000-0000-4000-8000-000000000017',
     'f9a00000-0000-4000-8000-000000000019'
   ))
  + (SELECT count(*)::integer
     FROM plugin_data.csf_admin_audit_events
     WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
       AND actor_user_id = 'f9000000-0000-4000-8000-000000000001'
       AND action = 'partner_representative.assign'
       AND target_id = (
         SELECT (payload ->> 'assignmentId')::uuid
         FROM csf_activity_partner_fence_results
         WHERE key = 'admin_representative_assign'
       )),
  9,
  'the nine admin mutations retain one immutable receipt apiece'
);

-- 67-69: an organization A staff lock cannot block organization B.
SELECT extensions.dblink_connect(
  'activity_partner_cross_org',
  pg_temp.csf_activity_partner_fence_dsn()
);
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key('f9100000-0000-4000-8000-000000000001')
);
SELECT extensions.dblink_send_query(
  'activity_partner_cross_org',
  $query$
    SELECT plugin_data.csf_set_partner_club_status(
      'f9100000-0000-4000-8000-000000000002'::uuid,
      'f9600000-0000-4000-8000-000000000002'::uuid,
      'inactive',
      'f9000000-0000-4000-8000-000000000007'::uuid,
      'f9a00000-0000-4000-8000-000000000020'::uuid
    )::text
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_activity_partner_result('activity_partner_cross_org'),
  'a cross-organization wrapper completes while the first organization lock is held'
);
COMMIT;
INSERT INTO csf_activity_partner_fence_results (key, payload)
SELECT 'cross_org', payload::jsonb
FROM extensions.dblink_get_result('activity_partner_cross_org', false)
  AS result(payload text);
SELECT extensions.is(
  (SELECT payload ->> 'idempotent'
   FROM csf_activity_partner_fence_results
   WHERE key = 'cross_org'),
  'false',
  'the independent organization receives its committed result before lock release'
);
SELECT extensions.dblink_disconnect('activity_partner_cross_org');
SELECT extensions.ok(
  (
    SELECT status = 'inactive'
    FROM plugin_data.csf_partner_clubs
    WHERE id = 'f9600000-0000-4000-8000-000000000002'
  )
  AND (
    SELECT count(*) = 1
    FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'f9a00000-0000-4000-8000-000000000020'
  ),
  'the cross-organization call commits its target and one audit receipt'
);

-- Remove every durable synthetic fixture so later files in the same isolated
-- replay remain independent. The preflight call above recovers interrupted
-- runs; SET LOCAL always restores session_replication_role before ordinary FK
-- cleanup, including if the receipt deletion transaction rolls back.
BEGIN;
SET LOCAL session_replication_role = replica;
SELECT pg_temp.cleanup_csf_activity_partner_receipts();
COMMIT;
SELECT pg_temp.cleanup_csf_activity_partner_fixtures();

DROP TABLE csf_activity_partner_fence_results;

SELECT * FROM extensions.finish();
