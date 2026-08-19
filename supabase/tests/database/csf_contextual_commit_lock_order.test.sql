-- Contextual CSF commits hold their whole authoritative population while they decide.
--
-- The partner-audit commit that used to share this file was retired with the
-- partner-clubs simplification (20260817120000): partner submission batches and rows,
-- the audit-import RPCs, and the provenance acknowledgement are gone, and
-- `csf_lock_contextual_commit_population` now refuses a non-null partner batch id
-- outright. Only the meeting-attendance commit remains under test.
--
-- Two kinds of assertion, because neither alone is enough.
--
-- Part A pins the ORDER in the source. A deadlock is precisely the failure a functional
-- test cannot reproduce on demand -- it needs two sessions interleaved at one instruction
-- -- so the direction (population before readiness, rows before source) is asserted as
-- source text, where a regression is visible at review time instead of at load.
--
-- Part B proves the SCOPE with two live sessions over dblink. The old commit locked only
-- the rows it was about to write: an already-settled sibling of the same preview was
-- never held, so a concurrent reconciliation could move it between the readiness read and
-- the write loop. The fixture below contends on exactly such a row, which is why the
-- second session blocking is the regression proof -- against the predecessor it would not
-- have blocked at all.
--
-- This file does NOT run inside one rolled-back transaction: a second connection cannot
-- see fixtures this session has not committed. It follows
-- csf_term_close_serialization.test.sql and keeps its namespaced synthetic fixture for the
-- remainder of the disposable replay rather than defeating an immutable-audit trigger with
-- cleanup-only mutation. The row-level readiness contract is covered separately, and
-- transactionally, in csf_contextual_commit_readiness.test.sql.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(28);

-- The readiness projections are server-only; the population lock is internal even to
-- service-role callers.
SELECT extensions.ok(NOT has_function_privilege('anon', 'plugin_data.csf_import_preview_row_readiness_blockers(uuid,uuid)', 'EXECUTE'), 'anonymous clients cannot read CSF preview row readiness');
SELECT extensions.ok(NOT has_function_privilege('authenticated', 'plugin_data.csf_import_preview_row_readiness_blockers(uuid,uuid)', 'EXECUTE'), 'authenticated clients cannot read CSF preview row readiness directly');
SELECT extensions.ok(has_function_privilege('service_role', 'plugin_data.csf_import_preview_row_readiness_blockers(uuid,uuid)', 'EXECUTE'), 'the server role can read CSF preview row readiness');
SELECT extensions.ok(NOT has_function_privilege('anon', 'plugin_data.csf_meeting_attendance_preview_readiness_blockers(uuid,uuid)', 'EXECUTE'), 'anonymous clients cannot read CSF meeting-attendance row readiness');
SELECT extensions.ok(NOT has_function_privilege('authenticated', 'plugin_data.csf_meeting_attendance_preview_readiness_blockers(uuid,uuid)', 'EXECUTE'), 'authenticated clients cannot read CSF meeting-attendance row readiness directly');
SELECT extensions.ok(has_function_privilege('service_role', 'plugin_data.csf_meeting_attendance_preview_readiness_blockers(uuid,uuid)', 'EXECUTE'), 'the server role can read CSF meeting-attendance row readiness');
SELECT extensions.ok(NOT has_function_privilege('anon', 'plugin_data.csf_lock_contextual_commit_population(uuid,uuid,uuid)', 'EXECUTE'), 'anonymous clients cannot take a contextual commit population lock');
SELECT extensions.ok(NOT has_function_privilege('authenticated', 'plugin_data.csf_lock_contextual_commit_population(uuid,uuid,uuid)', 'EXECUTE'), 'authenticated clients cannot take a contextual commit population lock');
SELECT extensions.ok(NOT has_function_privilege('service_role', 'plugin_data.csf_lock_contextual_commit_population(uuid,uuid,uuid)', 'EXECUTE'), 'not even the server role may take the population lock outside the owned commits');

-- ---------------------------------------------------------------------------
-- A. THE ORDER, PINNED IN THE SOURCE
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'csf_lock_identity_mutation'
      ) > 0
      AND pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'csf_lock_identity_mutation'
      ) < pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'csf_assert_import_actor'
      )
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_commit_meeting_attendance_import(uuid,uuid,uuid,text,uuid,uuid)',
      'plugin_data.csf_commit_meeting_attendance_import(uuid,uuid,uuid,text,uuid,uuid,boolean)'
    ]) AS routine_name
  ),
  'every public contextual commit signature locks organization identity before actor authorization'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'csf_lock_contextual_commit_population'
      ) > 0
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid,uuid,uuid,text,uuid,uuid,boolean)'
    ]) AS routine_name
  ),
  'the owner-internal contextual commit takes its population through the one canonical lock helper'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'csf_lock_contextual_commit_population'
      ) < pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        '_readiness_blockers'
      )
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid,uuid,uuid,text,uuid,uuid,boolean)'
    ]) AS routine_name
  ),
  'the population lock precedes the readiness read in the contextual commit'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        '''idempotent'', true'
      ) < pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'csf_lock_contextual_commit_population'
      )
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid,uuid,uuid,text,uuid,uuid,boolean)'
    ]) AS routine_name
  ),
  'the idempotent replay return precedes the population lock, so a replay stays a read'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        '_readiness_blockers'
      ) < pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'INSERT INTO plugin_data.'
      )
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid,uuid,uuid,text,uuid,uuid,boolean)'
    ]) AS routine_name
  ),
  'readiness is read before the first business write in the contextual commit'
);

-- The partner half of the population lock is not merely unused: the argument survives
-- only so the meeting call site keeps its shape, and a non-null value is a hard refusal.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_lock_contextual_commit_population(
      'e2100000-0000-4000-8000-0000000000ff',
      NULL,
      'e2900000-0000-4000-8000-0000000000ff'
    )
  $$,
  '22023',
  'Partner audit batch commits were removed; only preview populations can be locked.',
  'the population lock refuses a partner audit batch id outright'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'ORDER BY import_row.sheet_tab_name, import_row.row_number, import_row.id'
      ) > 0
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_lock_import_commit_coordinate(uuid,uuid,boolean)',
      'plugin_data.csf_lock_contextual_commit_population(uuid,uuid,uuid)'
    ]) AS routine_name
  ),
  'the contextual population walks import rows in the central coordinate''s stable order'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'CONTINUE'
      ) = 0
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid,uuid,uuid,text,uuid,uuid,boolean)'
    ]) AS routine_name
  ),
  'the contextual commit does not continue past a refused row into a partial success'
);

-- --- The evidence receipt, pinned in the same place and the same way ---------
--
-- These four are ordering assertions for the same reason the ones above are: the failure
-- they guard against is an ABBA deadlock between the contextual commit and the central
-- importer, and a deadlock is precisely what a functional test cannot reproduce on
-- demand. `csf_claim_import_commit_attempt` takes `csf_lock_import_commit_coordinate`
-- first -- which locks the preview's import rows at step 5 and the SOURCE at step 6 --
-- and consumes second. Consuming before the population here would be source-before-rows
-- against rows-before-source there, on two objects both paths hold.

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'csf_consume_sheet_source_evidence'
      ) > 0
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid,uuid,uuid,text,uuid,uuid,boolean)'
    ]) AS routine_name
  ),
  'the contextual commit spends the source-evidence receipt inside the commit transaction'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'csf_lock_contextual_commit_population'
      ) < pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'csf_consume_sheet_source_evidence'
      )
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid,uuid,uuid,text,uuid,uuid,boolean)'
    ]) AS routine_name
  ),
  'the population lock precedes the consume, so rows are taken before the source'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_get_functiondef(
      'plugin_data.csf_claim_import_commit_attempt_identity_base(uuid,uuid,uuid,integer,uuid)'::regprocedure
    ),
    'csf_lock_import_commit_coordinate'
  ) < pg_catalog.strpos(
    pg_get_functiondef(
      'plugin_data.csf_claim_import_commit_attempt_identity_base(uuid,uuid,uuid,integer,uuid)'::regprocedure
    ),
    'csf_consume_sheet_source_evidence'
  ),
  'the central claim takes its coordinate before its consume, which is the direction the contextual commit matches'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'csf_consume_sheet_source_evidence'
      ) < pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'INSERT INTO plugin_data.'
      )
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid,uuid,uuid,text,uuid,uuid,boolean)'
    ]) AS routine_name
  ),
  'the receipt is spent before the first business write in the contextual commit'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        '''idempotent'', true'
      ) < pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'csf_consume_sheet_source_evidence'
      )
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid,uuid,uuid,text,uuid,uuid,boolean)'
    ]) AS routine_name
  ),
  'the idempotent replay return precedes the consume, so a replay needs no fresh receipt'
);

-- The receipt-less signatures are GONE, not merely unused. A surviving overload would
-- still resolve from `plugin.rpc(...)` with the old argument set and still commit. Every
-- overload that does exist -- the 20260812071500 shape and the allow-unresolved shape
-- from 20260817131000 -- must carry the receipt argument.
SELECT extensions.ok(
  (SELECT count(*) > 0
     AND bool_and('p_evidence_token' = ANY (proc.proargnames))
   FROM pg_catalog.pg_proc AS proc
   JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
   WHERE namespace.nspname = 'plugin_data'
     AND proc.proname = 'csf_commit_meeting_attendance_import'),
  'every meeting-attendance commit signature carries the receipt, so no receipt-less overload resolves'
);
SELECT extensions.ok(
  (SELECT bool_and(proc.pronargdefaults = 0)
   FROM pg_catalog.pg_proc AS proc
   JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
   WHERE namespace.nspname = 'plugin_data'
     AND proc.proname = 'csf_commit_meeting_attendance_import'),
  'and no meeting commit signature declares defaults, so the receipt cannot be omitted'
);

-- ---------------------------------------------------------------------------
-- B. THE SCOPE, PROVED WITH TWO LIVE SESSIONS
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'e2000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'contextual-lock-order-officer@local.test', now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'e2100000-0000-4000-8000-000000000001',
  'CSF Contextual Commit Lock Order',
  'csf-contextual-commit-lock-order',
  'school',
  '995111'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES (
  'e2100000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'e2200000-0000-4000-8000-000000000001',
  'e2100000-0000-4000-8000-000000000001',
  'F32', 'Fall 2032', '2032-2033', 'fall'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  (
    'e2300000-0000-4000-8000-000000000001',
    'e2100000-0000-4000-8000-000000000001',
    'First', 'Contender', 'first', 'contender'
  ),
  (
    'e2300000-0000-4000-8000-000000000002',
    'e2100000-0000-4000-8000-000000000001',
    'Second', 'Contender', 'second', 'contender'
  );

INSERT INTO plugin_data.csf_term_meetings (
  id, organization_id, term_id, meeting_key, label, meeting_date
) VALUES (
  'e2400000-0000-4000-8000-000000000001',
  'e2100000-0000-4000-8000-000000000001',
  'e2200000-0000-4000-8000-000000000001',
  'lock-order-meeting', 'Lock order meeting', '2032-09-01'
);

INSERT INTO plugin_data.csf_meetings (
  id, organization_id, term_id, meeting_key, label
) VALUES (
  'e2b00000-0000-4000-8000-000000000001',
  'e2100000-0000-4000-8000-000000000001',
  'e2200000-0000-4000-8000-000000000001',
  'lock-order-meeting', 'Lock order meeting'
);

INSERT INTO plugin_data.csf_meeting_sessions (
  id, organization_id, meeting_id, legacy_term_meeting_id, session_date
) VALUES (
  'e2c00000-0000-4000-8000-000000000001',
  'e2100000-0000-4000-8000-000000000001',
  'e2b00000-0000-4000-8000-000000000001',
  'e2400000-0000-4000-8000-000000000001',
  '2032-09-01'
);

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, provider, spreadsheet_id, uploaded_file_path,
  drive_file_id, drive_mime_type, drive_modified_at, sync_status, settings
) VALUES (
  'e2500000-0000-4000-8000-000000000001',
  'e2100000-0000-4000-8000-000000000001',
  'meeting_attendance',
  'Lock order meeting source',
  'google_sheets', 'contextual-lock-order-meeting', NULL,
  'contextual-lock-order-meeting', 'application/vnd.google-apps.spreadsheet',
  '2032-08-01T00:00:00Z', 'not_synced',
  '{"sourceKind":"meeting_attendance","meetingId":"e2400000-0000-4000-8000-000000000001"}'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  mapping_snapshot, mapping_version, correlation_id, summary, completed_at
) VALUES (
  'e2600000-0000-4000-8000-000000000001',
  'e2100000-0000-4000-8000-000000000001',
  'e2500000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'meeting_attendance',
  'contextual-lock-order-meeting', 'Lock Order Meeting', 'Responses', 'Responses!A1:C10',
  '{"version":1,"sourceType":"meeting_attendance"}', 1,
  'e2d00000-0000-4000-8000-000000000001', '{}', now()
);

-- Two ready rows the commit will write, and one ALREADY SETTLED sibling it will not. The
-- settled row is the contended one on purpose: the predecessor's write loop selected
-- `import_status = 'pending'`, so nothing ever held this row.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, term_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, matched_profile_id, import_status,
  resolution_status, resolution_reason_code, resolution_notes, resolved_by, resolved_at,
  correlation_id
) VALUES
  (
    'e2700000-0000-4000-8000-000000000001',
    'e2100000-0000-4000-8000-000000000001',
    'e2600000-0000-4000-8000-000000000001',
    'e2500000-0000-4000-8000-000000000001',
    'e2200000-0000-4000-8000-000000000001',
    'Responses', 2, '{"Name":"First Contender"}',
    '{"meetingId":"e2400000-0000-4000-8000-000000000001","submittedName":"First Contender"}',
    'contextual-lock-order-first-hash', 'e2300000-0000-4000-8000-000000000001', 'pending',
    'pending', NULL, NULL, NULL, NULL,
    'e2d00000-0000-4000-8000-000000000001'
  ),
  (
    'e2700000-0000-4000-8000-000000000002',
    'e2100000-0000-4000-8000-000000000001',
    'e2600000-0000-4000-8000-000000000001',
    'e2500000-0000-4000-8000-000000000001',
    'e2200000-0000-4000-8000-000000000001',
    'Responses', 3, '{"Name":"Second Contender"}',
    '{"meetingId":"e2400000-0000-4000-8000-000000000001","submittedName":"Second Contender"}',
    'contextual-lock-order-second-hash', 'e2300000-0000-4000-8000-000000000002', 'pending',
    'pending', NULL, NULL, NULL, NULL,
    'e2d00000-0000-4000-8000-000000000001'
  ),
  (
    'e2700000-0000-4000-8000-000000000003',
    'e2100000-0000-4000-8000-000000000001',
    'e2600000-0000-4000-8000-000000000001',
    'e2500000-0000-4000-8000-000000000001',
    'e2200000-0000-4000-8000-000000000001',
    'Responses', 4, '{"Name":"Settled Contender"}',
    '{"meetingId":"e2400000-0000-4000-8000-000000000001","submittedName":"Settled Contender"}',
    'contextual-lock-order-settled-hash', NULL, 'skipped',
    'ignored', 'officer_skipped', 'Settled before the contention test.',
    'e2000000-0000-4000-8000-000000000001', now(),
    'e2d00000-0000-4000-8000-000000000001'
  );

-- The receipt the meeting commit spends, written exactly as
-- `csf_refresh_sheet_source_evidence` writes one: the same canonical metadata digest,
-- the same `evidenceRevision`/`evidenceDigest` pair on the source, the same generation.
-- `csf_consume_sheet_source_evidence` re-derives all three, so a receipt that did not
-- describe itself would be refused here rather than quietly accepted.
WITH coordinate AS (
  SELECT
    source.id AS source_id,
    source.spreadsheet_id AS provider_file_id,
    source.drive_modified_at AS modified_time,
    encode(
      sha256(convert_to(
        plugin_data.csf_canonical_json(jsonb_build_object(
          'fileId', source.spreadsheet_id,
          'mimeType', 'application/vnd.google-apps.spreadsheet',
          'modifiedTime', to_char(
            source.drive_modified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'version', '11',
          'trashed', false
        )),
        'UTF8'
      )),
      'hex'
    ) AS metadata_digest
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.id = 'e2500000-0000-4000-8000-000000000001'
),
refreshed AS (
  UPDATE plugin_data.csf_sheet_sources AS source
  SET evidence_generation = 1,
      evidence_refreshed_at = now(),
      settings = source.settings || jsonb_build_object(
        'evidenceRevision', '11',
        'evidenceDigest', coordinate.metadata_digest
      )
  FROM coordinate
  WHERE source.id = coordinate.source_id
  RETURNING source.id
)
INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
  organization_id, source_id, actor_user_id, preview_job_id, provider, nonce,
  evidence_generation, metadata_digest, provider_file_id, provider_version,
  mime_type, modified_time, access_checked_at, expires_at
)
SELECT
  'e2100000-0000-4000-8000-000000000001', coordinate.source_id,
  'e2000000-0000-4000-8000-000000000001', 'e2600000-0000-4000-8000-000000000001',
  'google_sheets', 'e2e00000-0000-4000-8000-000000000001', 1, coordinate.metadata_digest,
  coordinate.provider_file_id, '11',
  'application/vnd.google-apps.spreadsheet', coordinate.modified_time,
  now(), now() + interval '10 minutes'
FROM coordinate;

CREATE TEMP TABLE csf_contextual_lock_order_results (
  label text NOT NULL,
  payload text
) ON COMMIT PRESERVE ROWS;

-- A dedicated connection per contention probe: dblink requires a sent query to be
-- drained to an empty result set before its connection can be reused, and disconnecting
-- after a single get_result is the shape csf_term_close_serialization.test.sql proves.
SELECT extensions.dblink_connect(
  'meeting_writer',
  -- Use the container interface rather than loopback. Supabase's local pg_hba trusts
  -- loopback, and dblink correctly refuses a non-superuser connection when the supplied
  -- password was not actually used.
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  -- The disposable local Supabase image uses its bootstrap role name as the bootstrap
  -- password. Build that connection value from the active role so no credential-shaped
  -- fixture is committed to the repository.
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);

-- --- Meeting attendance ----------------------------------------------------

BEGIN;

SELECT plugin_data.csf_commit_meeting_attendance_import(
  'e2100000-0000-4000-8000-000000000001',
  'e2600000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'Committed the synthetic lock-order attendance preview.',
  'e2d00000-0000-4000-8000-000000000001',
  'e2e00000-0000-4000-8000-000000000001'
);

SELECT extensions.dblink_send_query(
  'meeting_writer',
  $query$
  SELECT plugin_data.csf_reconcile_sheet_import_row(
    'e2100000-0000-4000-8000-000000000001',
    'e2700000-0000-4000-8000-000000000003',
    NULL,
    'skip',
    'Concurrent reconciliation of an already-settled sibling row.',
    'e2000000-0000-4000-8000-000000000001',
    NULL
  )::text
  $query$
);

SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('meeting_writer'),
  1,
  'a concurrent reconciliation of an already-settled sibling waits on the meeting commit'
);

COMMIT;

INSERT INTO csf_contextual_lock_order_results (label, payload)
SELECT 'meeting', payload
FROM extensions.dblink_get_result('meeting_writer', false) AS result(payload text);

SELECT extensions.dblink_disconnect('meeting_writer');

SELECT extensions.ok(
  (
    SELECT (payload::jsonb->>'idempotent')::boolean
    FROM csf_contextual_lock_order_results
    WHERE label = 'meeting'
  ),
  'the queued reconciliation runs once the commit releases the population'
);
SELECT extensions.is(
  (SELECT import_status FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'e2700000-0000-4000-8000-000000000003'),
  'skipped',
  'the contended settled sibling is unchanged by either session'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE term_meeting_id = 'e2400000-0000-4000-8000-000000000001'),
  2,
  'the meeting commit wrote exactly its two ready rows'
);

SELECT * FROM extensions.finish();
