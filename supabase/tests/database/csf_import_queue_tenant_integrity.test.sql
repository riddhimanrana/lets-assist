BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(19);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'd1000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'queue-integrity-officer@local.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    'd1000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'queue-integrity-applications@local.test', now(),
    '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'd1100000-0000-4000-8000-000000000001',
    'Queue Integrity One', 'queue-integrity-one', 'school', '996101'
  ),
  (
    'd1100000-0000-4000-8000-000000000002',
    'Queue Integrity Two', 'queue-integrity-two', 'school', '996102'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  (
    'd1100000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'admin', 'active'
  ),
  (
    'd1100000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000002',
    'staff', 'active'
  );

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'd1200000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  2035,
  'Class of 2035'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'd1210000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'F34', 'Fall 2034', '2034-2035', 'fall', true
);

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, role_type
) VALUES (
  'd1220000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'application-importer', 'Application importer', 'custom'
);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES (
  'd1100000-0000-4000-8000-000000000001',
  'd1220000-0000-4000-8000-000000000001',
  'import_applications', true
);

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title, status
) VALUES (
  'd1100000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002',
  'd1220000-0000-4000-8000-000000000001',
  '2034-2035', 'Application importer', 'active'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, initiated_by, mode, status, source_type, preview_job_id
) VALUES
  (
    'd1300000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'preview', 'failed', 'student_roster', NULL
  ),
  (
    'd1300000-0000-4000-8000-000000000002',
    'd1100000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'preview', 'failed', 'student_roster', NULL
  ),
  (
    'd1300000-0000-4000-8000-000000000003',
    'd1100000-0000-4000-8000-000000000002',
    NULL,
    'preview', 'completed', 'student_roster', NULL
  ),
  (
    'd1300000-0000-4000-8000-000000000004',
    'd1100000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'commit', 'completed', 'student_roster',
    'd1300000-0000-4000-8000-000000000001'
  );

SELECT extensions.ok(
  to_regprocedure(
    'plugin_data.csf_register_class_workbook(uuid,uuid,text,uuid,text,text,jsonb)'
  ) IS NULL,
  'the obsolete workbook registration RPC is absent'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)',
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(
        routine.proacl,
        pg_catalog.acldefault('f', routine.proowner)
      )
    ) AS acl
    WHERE routine.oid =
      'plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'only service role can queue an approval batch'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_finish_import_commit_queue(uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_finish_import_commit_queue(uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_finish_import_commit_queue(uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(
        routine.proacl,
        pg_catalog.acldefault('f', routine.proowner)
      )
    ) AS acl
    WHERE routine.oid =
      'plugin_data.csf_finish_import_commit_queue(uuid,uuid,text,jsonb,text)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'only service role can settle an import queue item'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_constraint
    WHERE conname IN (
      'csf_sheet_sources_cohort_organization_fkey',
      'csf_import_approval_batches_id_organization_key',
      'csf_import_commit_queue_id_organization_key',
      'csf_import_row_batches_id_organization_key',
      'csf_import_approval_items_batch_organization_fkey',
      'csf_import_approval_items_queue_organization_fkey',
      'csf_import_row_outcomes_batch_organization_fkey'
    )
      AND convalidated
  ),
  7,
  'all new tenant constraints are present and validated'
);

SELECT extensions.has_index(
  'plugin_data',
  'csf_import_approval_batch_items',
  'csf_import_approval_items_org_queue_idx',
  'queue settlement uses the tenant and queue lookup index'
);

SELECT extensions.matches(
  pg_catalog.pg_get_constraintdef(
    (
      SELECT oid FROM pg_catalog.pg_constraint
      WHERE conname = 'csf_sheet_sources_cohort_organization_fkey'
    ),
    true
  ),
  'FOREIGN KEY \(cohort_id, organization_id\).*csf_cohorts\(id, organization_id\).*ON DELETE SET NULL \(cohort_id\)',
  'sheet sources bind an optional class to the same organization'
);

SELECT extensions.matches(
  pg_catalog.pg_get_constraintdef(
    (
      SELECT oid FROM pg_catalog.pg_constraint
      WHERE conname = 'csf_import_approval_items_batch_organization_fkey'
    ),
    true
  ),
  'FOREIGN KEY \(batch_id, organization_id\).*csf_import_approval_batches\(id, organization_id\)',
  'approval items bind their batch to the same organization'
);

SELECT extensions.matches(
  pg_catalog.pg_get_constraintdef(
    (
      SELECT oid FROM pg_catalog.pg_constraint
      WHERE conname = 'csf_import_approval_items_queue_organization_fkey'
    ),
    true
  ),
  'FOREIGN KEY \(queue_id, organization_id\).*csf_import_commit_queue\(id, organization_id\).*ON DELETE SET NULL \(queue_id\)',
  'approval items bind an optional queue receipt to the same organization'
);

SELECT extensions.matches(
  pg_catalog.pg_get_constraintdef(
    (
      SELECT oid FROM pg_catalog.pg_constraint
      WHERE conname = 'csf_import_row_outcomes_batch_organization_fkey'
    ),
    true
  ),
  'FOREIGN KEY \(batch_id, organization_id\).*csf_import_row_batches\(id, organization_id\)',
  'row outcomes bind their batch to the same organization'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_queue_import_preview_batch(
    'd1100000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000002',
    ARRAY['d1300000-0000-4000-8000-000000000001']::uuid[],
    'd1900000-0000-4000-8000-000000000002'
  )$$,
  '42501',
  NULL,
  'an officer with application access cannot approve a roster preview'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_import_approval_batches AS batch
    WHERE batch.organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND batch.request_id = 'd1900000-0000-4000-8000-000000000002'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_import_approval_batch_items AS item
    JOIN plugin_data.csf_import_approval_batches AS batch
      ON batch.id = item.batch_id
     AND batch.organization_id = item.organization_id
    WHERE batch.organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND batch.request_id = 'd1900000-0000-4000-8000-000000000002'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_import_commit_queue AS queue
    WHERE queue.organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND queue.actor_user_id = 'd1000000-0000-4000-8000-000000000002'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND audit.actor_user_id = 'd1000000-0000-4000-8000-000000000002'
      AND audit.action IN (
        'sheets.import_batch_approved',
        'sheets.import_batch_settled'
      )
  ),
  'authorization denial creates no batch, queue item, or audit receipt'
);

SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_sheet_sources (
    organization_id, cohort_id, title
  ) VALUES (
    'd1100000-0000-4000-8000-000000000002',
    'd1200000-0000-4000-8000-000000000001',
    'Cross-tenant source'
  )$$,
  '23503',
  NULL,
  'a sheet source cannot point at another tenant class'
);

INSERT INTO plugin_data.csf_import_approval_batches (
  id, organization_id, request_id
) VALUES (
  'd1400000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000002'
);

INSERT INTO plugin_data.csf_import_commit_queue (
  id, organization_id, preview_job_id, status
) VALUES (
  'd1500000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000002',
  'd1300000-0000-4000-8000-000000000003',
  'queued'
);

SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_import_approval_batch_items (
    organization_id, batch_id, preview_job_id, state
  ) VALUES (
    'd1100000-0000-4000-8000-000000000002',
    'd1400000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000003',
    'stale'
  )$$,
  '23503',
  NULL,
  'an approval item cannot point at another tenant batch'
);

SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_import_approval_batch_items (
    organization_id, batch_id, preview_job_id, queue_id, state
  ) VALUES (
    'd1100000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'queued'
  )$$,
  '23503',
  NULL,
  'an approval item cannot point at another tenant queue receipt'
);

INSERT INTO plugin_data.csf_sheet_import_commit_attempts (
  id, organization_id, commit_job_id, attempt_number, status, completed_at
) VALUES (
  'd1600000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000004',
  1,
  'completed',
  now()
);

INSERT INTO plugin_data.csf_import_row_batches (
  id, organization_id, attempt_id, request_id, row_ids, status, completed_at
) VALUES (
  'd1700000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1700000-0000-4000-8000-000000000002',
  ARRAY['d1800000-0000-4000-8000-000000000001']::uuid[],
  'completed',
  now()
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, sheet_tab_name, row_number, import_status
) VALUES (
  'd1800000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000002',
  'd1300000-0000-4000-8000-000000000003',
  'Synthetic', 2, 'error'
);

SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_import_row_batch_outcomes (
    organization_id, batch_id, import_row_id, outcome
  ) VALUES (
    'd1100000-0000-4000-8000-000000000002',
    'd1700000-0000-4000-8000-000000000001',
    'd1800000-0000-4000-8000-000000000001',
    'failed'
  )$$,
  '23503',
  NULL,
  'a row outcome cannot point at another tenant batch'
);

CREATE TEMP TABLE queue_integrity_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

INSERT INTO queue_integrity_state
SELECT 'first', plugin_data.csf_queue_import_preview_batch(
  'd1100000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  ARRAY['d1300000-0000-4000-8000-000000000001']::uuid[],
  'd1900000-0000-4000-8000-000000000001'
);

SELECT extensions.is(
  plugin_data.csf_queue_import_preview_batch(
    'd1100000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    ARRAY['d1300000-0000-4000-8000-000000000001']::uuid[],
    'd1900000-0000-4000-8000-000000000001'
  ) ->> 'replayed',
  'true',
  'the same actor and preview set can replay the durable batch receipt'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_queue_import_preview_batch(
    'd1100000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    ARRAY['d1300000-0000-4000-8000-000000000002']::uuid[],
    'd1900000-0000-4000-8000-000000000001'
  )$$,
  '22023',
  'This batch request ID belongs to a different approval request.',
  'the same request ID cannot replay a different preview set'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)'::regprocedure
    ),
    'v_batch.actor_user_id IS DISTINCT FROM p_actor_user_id'
  ) > 0
  AND pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)'::regprocedure
    ),
    'v_existing_preview_ids IS DISTINCT FROM v_requested_preview_ids'
  ) > 0
  AND pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)'::regprocedure
    ),
    'PERFORM plugin_data.csf_assert_import_actor('
  ) > 0,
  'batch replay binds authorization, actor, and normalized preview set'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_finish_import_commit_queue(uuid,uuid,text,jsonb,text)'::regprocedure
    ),
    'WHERE organization_id = v_item.organization_id'
  ) > 0
  AND pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_finish_import_commit_queue(uuid,uuid,text,jsonb,text)'::regprocedure
    ),
    'AND queue_id = p_queue_id'
  ) > 0,
  'queue settlement scopes child receipt updates to the claimed organization'
);

SELECT * FROM extensions.finish();
ROLLBACK;
