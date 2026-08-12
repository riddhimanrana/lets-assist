-- Behavioral contract for the DVHS CSF import commit ledger, the frozen
-- authoritative decision, the durable outcome state machine, and the generation-safe
-- uploaded staging lifecycle.
--
-- Rewritten rather than patched. The previous version described a design that no
-- longer exists: it called an open/consume staging pair, inspected a `consumed_at`
-- column, invoked signatures with caller-supplied identity, and expected an
-- application import to create a profile from a name. Adjusting its plan count would
-- have left every one of those assertions asserting the wrong contract.
--
-- Every value here is synthetic. Addresses use only RFC 2606 reserved domains.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(597);

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) VALUES
  (
    'df000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'import-officer@local.test', now(), '{}', '{}',
    now(), now()
  ),
  (
    'df000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'other-tenant-officer@local.test', now(), '{}', '{}',
    now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'df100000-0000-4000-8000-000000000001',
    'CSF Import Commit Recovery',
    'csf-import-commit-recovery',
    'school',
    '996201'
  ),
  (
    'df100000-0000-4000-8000-000000000002',
    'CSF Import Other Tenant',
    'csf-import-other-tenant',
    'school',
    '996202'
  );


-- ---------------------------------------------------------------------------
-- Authorization fixtures.
--
-- Every import mutation now proves the acting officer holds the source's
-- capability, so the tenancy these tests act in has to be real: an active
-- membership, a role, an enabled permission, and an in-date staff position.
-- Seeding them is not scaffolding around the contract -- it IS the contract, and
-- a fixture without them would make every assertion below a 42501.
--
-- Five actors, one per case the matrix distinguishes:
--   ...0001 permitted officer   -- active member, in-date position, exact grant
--   ...0002 cross-tenant        -- an officer of the other organization ONLY
--   ...0003 organization admin  -- bypasses position and capability
--   ...0004 inactive member     -- membership row present but not active
--   ...0005 expired position    -- active member, position ended yesterday
--   ...0006 second officer      -- a SECOND fully authorized org-one officer
--   ...0007 owner position      -- active member, explicit in-date owner position
--   ...0008 ended owner         -- active member, owner position that has ended
--   ...0009 cross-tenant owner  -- owner position in org two, member of org two
--   ...000a mailbox holder      -- holds the chapter's operational address and
--                                  nothing else: an ordinary member, no position
--
-- ...0006 exists because ...0002 does not belong to organization one at all.
-- The takeover assertions below used ...0002 as though it were a legitimate
-- second officer of organization one, which only ever passed because
-- `csf_assert_import_actor` was not actually requiring membership: it selected a
-- literal `true` beside an aggregate, and an aggregate over zero matching rows
-- still returns one row. With membership genuinely required, a takeover needs a
-- real second officer, and ...0002 goes back to being what its comment says it
-- is -- the negative cross-tenant case.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) VALUES
  ('df000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'import-admin@local.test', now(), '{}', '{}', now(), now()),
  ('df000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'import-inactive@local.test', now(), '{}', '{}', now(), now()),
  ('df000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
   'import-expired@local.test', now(), '{}', '{}', now(), now()),
  ('df000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated',
   'import-second-officer@local.test', now(), '{}', '{}', now(), now()),
  ('df000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated',
   'import-owner@local.test', now(), '{}', '{}', now(), now()),
  ('df000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated',
   'import-ended-owner@local.test', now(), '{}', '{}', now(), now()),
  ('df000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated',
   'import-other-owner@local.test', now(), '{}', '{}', now(), now()),
  -- The account that, in production, holds the chapter's operational mailbox:
  -- an ordinary member with no CSF position at all. The address itself is
  -- deliberately a reserved-domain stand-in -- every value in this file is
  -- synthetic, and an assertion below enforces that -- because what is being
  -- tested here is the SHAPE of the actor, not the spelling of one address. That
  -- no address whatsoever can authorize an import is asserted structurally
  -- against the function body instead.
  ('df000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated',
   'chapter-mailbox-holder@local.test', now(), '{}', '{}', now(), now()),
  -- A known user who belongs to no organization at all.
  ('df000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated',
   'import-no-membership@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000001', 'staff', 'active'),
  ('df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000003', 'admin', 'active'),
  ('df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000004', 'staff', 'removed'),
  ('df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000005', 'staff', 'active'),
  ('df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000006', 'staff', 'active'),
  ('df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000007', 'staff', 'active'),
  ('df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000008', 'staff', 'active'),
  ('df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-00000000000a', 'staff', 'active'),
  ('df100000-0000-4000-8000-000000000002', 'df000000-0000-4000-8000-000000000002', 'staff', 'active'),
  ('df100000-0000-4000-8000-000000000002', 'df000000-0000-4000-8000-000000000009', 'staff', 'active');

INSERT INTO plugin_data.csf_roles (id, organization_id, key, display_name, role_type)
VALUES
  ('df170000-0000-4000-8000-000000000001', 'df100000-0000-4000-8000-000000000001',
   'data-management', 'Data Management', 'officer_template'),
  -- A role whose grant exists but is switched off, and one that holds a grant for
  -- a different source. Neither may authorize a roster import.
  ('df170000-0000-4000-8000-000000000002', 'df100000-0000-4000-8000-000000000001',
   'disabled-grant', 'Disabled Grant', 'custom'),
  ('df170000-0000-4000-8000-000000000003', 'df100000-0000-4000-8000-000000000001',
   'wrong-source', 'Meetings Only', 'custom'),
  -- The chapter owner role, in each tenant. It carries NO import permission row
  -- on purpose: owner authority has to come from the position itself, or the
  -- assertion below would only be re-testing the ordinary capability path.
  ('df170000-0000-4000-8000-000000000004', 'df100000-0000-4000-8000-000000000001',
   'owner', 'CSF Owner', 'owner'),
  ('df170000-0000-4000-8000-000000000005', 'df100000-0000-4000-8000-000000000002',
   'owner', 'CSF Owner', 'owner');

INSERT INTO plugin_data.csf_role_permissions (organization_id, role_id, permission_key, enabled)
VALUES
  ('df100000-0000-4000-8000-000000000001', 'df170000-0000-4000-8000-000000000001',
   'import_members', true),
  ('df100000-0000-4000-8000-000000000001', 'df170000-0000-4000-8000-000000000001',
   'import_applications', true),
  ('df100000-0000-4000-8000-000000000001', 'df170000-0000-4000-8000-000000000001',
   'import_meetings', true),
  ('df100000-0000-4000-8000-000000000001', 'df170000-0000-4000-8000-000000000002',
   'import_members', false),
  ('df100000-0000-4000-8000-000000000001', 'df170000-0000-4000-8000-000000000003',
   'import_meetings', true);

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title, status, starts_at, ends_at
) VALUES
  ('df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000001',
   'df170000-0000-4000-8000-000000000001', '2028-2029', 'Data Management',
   'active', NULL, NULL),
  -- Ended on the chapter's yesterday, in America/Los_Angeles. Not UTC: between
  -- Pacific midnight and 07:00Z those disagree, and the disagreement is exactly
  -- the window an evening import runs in.
  ('df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000005',
   'df170000-0000-4000-8000-000000000001', '2028-2029', 'Former Officer',
   'active', NULL, (now() AT TIME ZONE 'America/Los_Angeles')::date - 1),
  -- The second authorized officer of organization one, who performs the
  -- legitimate takeover.
  ('df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000006',
   'df170000-0000-4000-8000-000000000001', '2028-2029', 'Second Data Management',
   'active', NULL, NULL),
  -- An explicit, active, in-date owner position: the only thing that now confers
  -- owner authority, in place of the removed mailbox comparison.
  ('df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000007',
   'df170000-0000-4000-8000-000000000004', '2028-2029', 'CSF Owner',
   'active', NULL, NULL),
  -- An owner position that has ended. An ex-owner is not an owner.
  ('df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000008',
   'df170000-0000-4000-8000-000000000004', '2028-2029', 'Former CSF Owner',
   'active', NULL, (now() AT TIME ZONE 'America/Los_Angeles')::date - 1),
  -- An owner of the OTHER tenant. Owner authority is scoped to one organization.
  ('df100000-0000-4000-8000-000000000002', 'df000000-0000-4000-8000-000000000009',
   'df170000-0000-4000-8000-000000000005', '2028-2029', 'Other CSF Owner',
   'active', NULL, NULL);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES (
  'df150000-0000-4000-8000-000000000001',
  'df100000-0000-4000-8000-000000000001',
  2028,
  'Class of 2028'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'df160000-0000-4000-8000-000000000001',
  'df100000-0000-4000-8000-000000000001',
  'F28', 'Fall 2028', '2028-2029', 'fall'
);

INSERT INTO plugin_data.csf_cohort_terms (organization_id, cohort_id, term_id)
VALUES (
  'df100000-0000-4000-8000-000000000001',
  'df150000-0000-4000-8000-000000000001',
  'df160000-0000-4000-8000-000000000001'
);

-- An uploaded roster source: the only shape `csf_open_staging_object` accepts, with
-- its typed source_type and its legacy settings discriminator in agreement.
-- Drive evidence is explicit on every happy-path fixture.
--
-- `drive_access_state` defaults to `unknown` and a job's `source_file_metadata` defaults
-- to `{}`, so a fixture that omits them is an *inaccessible* source with no recorded
-- evidence. The readiness contract refuses exactly that, and it is right to: the first
-- assertion in this file expects no blockers, and blessing a default-inaccessible
-- fixture would have meant weakening the contract to match the test rather than seeding
-- the state the test claims to describe. The uploaded source therefore carries the
-- staging identity and digest a preview of it would have claimed.
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  drive_access_state, drive_trashed, drive_file_name, drive_mime_type, settings
) VALUES (
  'df200000-0000-4000-8000-000000000001',
  'df100000-0000-4000-8000-000000000001',
  'student_roster',
  'Synthetic recovery roster',
  'df150000-0000-4000-8000-000000000001',
  'uploaded_xlsx',
  'accessible', false, 'Synthetic roster.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jsonb_build_object(
    'sourceKind', 'student_roster',
    'contentHash', repeat('a', 64)
  )
);

-- A separate uploaded source owns the low-level staging lifecycle assertions.
-- Keeping it distinct from the attachment compare-and-swap source means each
-- section begins at generation one and neither can satisfy the other's lookups.
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  drive_access_state, drive_trashed, drive_file_name, drive_mime_type, settings
) VALUES (
  'df200000-0000-4000-8000-00000000000e',
  'df100000-0000-4000-8000-000000000001',
  'student_roster',
  'Synthetic staging lifecycle roster',
  'df150000-0000-4000-8000-000000000001',
  'uploaded_xlsx',
  'accessible', false, 'Synthetic staging lifecycle roster.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jsonb_build_object(
    'sourceKind', 'student_roster',
    'contentHash', repeat('c', 64)
  )
);

-- An application source, for the "an application never creates a member" contract.
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  drive_access_state, drive_trashed, drive_file_id, drive_file_name,
  drive_mime_type, drive_modified_at, settings
) VALUES (
  'df200000-0000-4000-8000-000000000002',
  'df100000-0000-4000-8000-000000000001',
  'application_responses',
  'Synthetic application responses',
  'df150000-0000-4000-8000-000000000001',
  'google_sheets',
  'accessible', false, 'synthetic-application-file', 'Synthetic applications',
  'application/vnd.google-apps.spreadsheet',
  '2026-07-01T00:00:00Z',
  -- `evidenceRevision` is the exact Drive `version` a previous receipt issuance
  -- read and stored. It is seeded here because a Google source that has never
  -- been refreshed has no server-issued version to compare a preview against,
  -- and the readiness gate treats that as missing evidence -- correctly, but it
  -- would then mask the one coordinate each drift assertion below is about.
  jsonb_build_object(
    'sourceKind', 'application_responses',
    'evidenceRevision', '41'
  )
);

-- A contextual source, to prove the attempt ledger is scoped away from it.
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, settings
) VALUES (
  'df200000-0000-4000-8000-000000000003',
  'df100000-0000-4000-8000-000000000001',
  'meeting_attendance',
  'Synthetic attendance source',
  '{"sourceKind":"meeting_attendance","meetingId":"fixture-meeting"}'::jsonb
);

-- A source belonging to the other tenant, for isolation.
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, provider, settings
) VALUES (
  'df200000-0000-4000-8000-000000000004',
  'df100000-0000-4000-8000-000000000002',
  'student_roster',
  'Other tenant roster',
  'uploaded_xlsx',
  '{"sourceKind":"student_roster"}'::jsonb
);

-- ---------------------------------------------------------------------------
-- The uploaded roster the commit-recovery previews are taken from, with a REAL
-- staged generation behind it.
--
-- Separate from `...0001` on purpose. `...0001` hosts the staging lifecycle
-- assertions, which open the first generation of a fresh source and assert it is
-- generation 1; a source cannot both start empty and already carry the readable
-- generation its preview read.
--
-- The staging row and the source's attachment are seeded directly rather than
-- through `csf_open_staging_object` / `csf_attach_sheet_source_generation`,
-- because those are the subject of assertions further down and running them here
-- would move the generation numbers those assertions name. This is privileged
-- fixture setup: it runs as the test's own superuser role, explicitly OUTSIDE any
-- `SET ROLE service_role`, and rolls back with the transaction. `service_role`
-- itself still holds no write privilege on either table, which the boundary
-- assertions below prove.
--
-- The source is inserted first because the staging row's composite foreign key
-- requires `(source_id, organization_id)` to exist. Its attachment coordinates
-- are JSON fixture evidence, so they can name the staging object before that row
-- is inserted without weakening either relational constraint.
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  drive_access_state, drive_trashed, drive_file_name, drive_mime_type,
  uploaded_file_path, settings
) VALUES (
  'df200000-0000-4000-8000-000000000007',
  'df100000-0000-4000-8000-000000000001',
  'student_roster',
  'Synthetic previewed roster',
  'df150000-0000-4000-8000-000000000001',
  'uploaded_xlsx',
  'accessible', false, 'Synthetic roster.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'df100000-0000-4000-8000-000000000001/df200000-0000-4000-8000-000000000007/1.xlsx',
  -- Exactly what `csf_attach_sheet_source_generation` writes. The uploaded
  -- receipt issuer reads these four and then proves them against the staging row
  -- and the preview's frozen metadata, so any one of them drifting is a refusal.
  --
  -- `evidenceRevision` is the THIRD digest the claim gate requires, and it is
  -- seeded for the same reason the Google fixtures seed theirs: it is written by
  -- `csf_issue_uploaded_source_evidence` from a locked read of the staged bytes,
  -- and the gate runs inside the claim AFTER that receipt is consumed. A source
  -- that has never had one issued has no receipt-written digest to compare
  -- against, which the gate treats as missing evidence -- correctly, but it
  -- would then mask the attachment drift each assertion below is actually about.
  jsonb_build_object(
    'sourceKind', 'student_roster',
    'stagedUpload', true,
    'stagingObjectId', 'df210000-0000-4000-8000-000000000001',
    'stagingGeneration', 1,
    'stagingContentHash', repeat('5', 64),
    'stagingByteLength', 2048,
    'stagingReadyAt', now(),
    'evidenceRevision', repeat('5', 64)
  )
);

INSERT INTO plugin_data.csf_sheet_import_staging_objects (
  id, organization_id, source_id, generation, status, bucket, object_path,
  file_extension, content_hash, byte_length, upload_expires_at, ready_at,
  ready_expires_at
) VALUES (
  'df210000-0000-4000-8000-000000000001',
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000007',
  1, 'ready', 'csf-private',
  'df100000-0000-4000-8000-000000000001/df200000-0000-4000-8000-000000000007/1.xlsx',
  'xlsx', repeat('5', 64), 2048,
  now() + interval '1 hour', now(), now() + interval '1 hour'
);

-- A complete roster preview: contract version, digests, row count, and a structured
-- multi-tab mapping snapshot whose second tab legitimately carries a comma in its
-- name. `source_range` is a single-tab display field and is deliberately a value the
-- old comma-splitting check would have mangled.
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
) VALUES (
  'df300000-0000-4000-8000-000000000001',
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000007',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster',
  'df210000-0000-4000-8000-000000000001',
  'Synthetic roster.xlsx', 'Roster', 'Roster!C5:E7',
  now(),
  -- The uploaded generation this preview read: the staging object's own id plus
  -- the digest that generation was finalized with. Both match the live source
  -- above, which is what lets the uploaded receipt be issued at all.
  jsonb_build_object(
    'id', 'df210000-0000-4000-8000-000000000001',
    'sourceProvider', 'uploaded_xlsx',
    'name', 'Synthetic roster.xlsx',
    'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'headRevisionId', repeat('5', 64),
    'stagingGeneration', 1,
    'readyAt', now(),
    'accessState', 'accessible',
    'trashed', false
  ),
  jsonb_build_object(
    'version', 1,
    'sourceType', 'student_roster',
    'sourceFileId', 'df210000-0000-4000-8000-000000000001',
    'sourceProvider', 'uploaded_xlsx',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Roster', 'range', 'Roster!C5:E7', 'headerRow', 5),
      jsonb_build_object('tabName', 'Fall, 2025', 'range', '''Fall, 2025''!A2:D9', 'headerRow', 2)
    )
  ),
  -- `source_content_hash` is the preview's OWN record of the uploaded bytes it
  -- read, so it is bound to the staged digest above rather than being an
  -- unrelated literal. It previously named `1...1` while the frozen
  -- `headRevisionId` and the attachment both named `5...5`, which is a preview
  -- whose two records of one sequence of bytes contradict each other -- exactly
  -- what the issuer and the claim gate now refuse. `snapshot_hash` stays
  -- independent: it digests the normalized snapshot, not the uploaded bytes.
  1, repeat('5', 64), repeat('2', 64), 2, 'csf-normalized-import/v1'
);

-- An application preview, complete on the same terms.
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
) VALUES (
  'df300000-0000-4000-8000-000000000002',
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000002',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'application_responses',
  'synthetic-application-file', 'Synthetic applications', 'Responses', 'Responses!A1:Z9',
  -- Drive freshness evidence, matching the live source's modified time exactly.
  --
  -- The four coordinates a native Sheet actually exposes: `id`, the exact Google
  -- Sheets `mimeType`, `modifiedTime`, and Drive's own `version`. Deliberately
  -- NO `headRevisionId`: Drive never populates one for a Docs Editors file, so a
  -- fixture carrying one would be describing a provider response that cannot
  -- occur, and the assertions below would be proving a contract against fiction.
  '2026-07-01T00:00:00Z',
  jsonb_build_object(
    'id', 'synthetic-application-file',
    'sourceProvider', 'google_sheets',
    'name', 'Synthetic applications',
    'mimeType', 'application/vnd.google-apps.spreadsheet',
    'version', '41',
    'modifiedTime', '2026-07-01T00:00:00Z',
    'accessState', 'accessible',
    'trashed', false
  ),
  jsonb_build_object(
    'version', 1,
    'sourceType', 'application_responses',
    'sourceFileId', 'synthetic-application-file',
    'sourceProvider', 'google_sheets',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Responses', 'range', 'Responses!A1:Z9', 'headerRow', 1)
    )
  ),
  1, repeat('3', 64), repeat('4', 64), 1, 'csf-normalized-import/v1'
);

-- A contextual preview, which must never receive an attempt.
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, mode, status, source_type
) VALUES (
  'df300000-0000-4000-8000-000000000003',
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000003',
  'preview', 'completed', 'meeting_attendance'
);

-- Two roster rows, each carrying the immutable allowlisted commit payload the
-- wrapper consumes. No caller-supplied identity appears anywhere.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, sheet_tab_name, row_number,
  source_range, import_status, row_hash, normalized_data
) VALUES
  (
    'df500000-0000-4000-8000-000000000001',
    'df100000-0000-4000-8000-000000000001',
    'df300000-0000-4000-8000-000000000001',
    'df200000-0000-4000-8000-000000000007',
    'df150000-0000-4000-8000-000000000001',
    'Roster', 6, 'Roster!C5:E7', 'pending', repeat('a', 64),
    jsonb_build_object(
      'commitPayload', jsonb_build_object(
        'version', 'csf-commit-payload/v1',
        'sourceType', 'student_roster',
        'identity', jsonb_build_object(
          'firstName', 'Marisol', 'lastName', 'Quill',
          'normalizedFirstName', 'marisol', 'normalizedLastName', 'quill'
        ),
        'canonicalEmails', jsonb_build_object(
          'schoolEmail', 'mquill@students.example.net',
          'normalizedSchoolEmail', 'mquill@students.example.net'
        )
      )
    )
  ),
  (
    'df500000-0000-4000-8000-000000000002',
    'df100000-0000-4000-8000-000000000001',
    'df300000-0000-4000-8000-000000000001',
    'df200000-0000-4000-8000-000000000007',
    'df150000-0000-4000-8000-000000000001',
    'Fall, 2025', 3, '''Fall, 2025''!A2:D9', 'pending', repeat('b', 64),
    jsonb_build_object(
      'commitPayload', jsonb_build_object(
        'version', 'csf-commit-payload/v1',
        'sourceType', 'student_roster',
        'identity', jsonb_build_object(
          'firstName', 'Rowan', 'lastName', 'Sable',
          'normalizedFirstName', 'rowan', 'normalizedLastName', 'sable'
        ),
        'canonicalEmails', '{}'::jsonb
      )
    )
  );

-- One application row with a full name and no reviewed target: exactly the shape
-- that must never bring a member into being.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, term_id, sheet_tab_name,
  row_number, source_range, import_status, row_hash, normalized_data
) VALUES (
  'df500000-0000-4000-8000-000000000003',
  'df100000-0000-4000-8000-000000000001',
  'df300000-0000-4000-8000-000000000002',
  'df200000-0000-4000-8000-000000000002',
  'df150000-0000-4000-8000-000000000001',
  'df160000-0000-4000-8000-000000000001',
  'Responses', 2, 'Responses!A1:Z9', 'pending', repeat('c', 64),
  jsonb_build_object(
    'commitPayload', jsonb_build_object(
      'version', 'csf-commit-payload/v1',
      'sourceType', 'application_responses',
      'identity', jsonb_build_object(
        'firstName', 'Wren', 'lastName', 'Alder',
        'normalizedFirstName', 'wren', 'normalizedLastName', 'alder'
      ),
      'canonicalEmails', jsonb_build_object(
        'schoolEmail', 'walder@students.example.net',
        'normalizedSchoolEmail', 'walder@students.example.net'
      ),
      'applicationData', jsonb_build_object('currentGradeLevel', 11)
    )
  )
);

-- ---------------------------------------------------------------------------
-- Shape: the ledger, the freeze, and the outcome state machine.
-- ---------------------------------------------------------------------------

SELECT extensions.has_table(
  'plugin_data', 'csf_sheet_import_commit_attempts',
  'the fenced commit attempt ledger exists'
);

SELECT extensions.has_table(
  'plugin_data', 'csf_sheet_import_staging_objects',
  'uploaded staging objects are a typed server-only model'
);

SELECT extensions.has_table(
  'plugin_data', 'csf_sheet_import_staging_claims',
  'live readers of a staging generation are a real relation'
);

SELECT extensions.has_column(
  'plugin_data', 'csf_sheet_import_commit_attempts', 'correlation_id',
  'each attempt carries one shared correlation'
);

SELECT extensions.has_column(
  'plugin_data', 'csf_sheet_import_jobs', 'commit_actor_user_id',
  'the logical commit records the officer whose decision it executes'
);

SELECT extensions.has_column(
  'plugin_data', 'csf_sheet_import_rows', 'commit_frozen_payload_hash',
  'each row records a digest of the exact payload that was reviewed'
);

SELECT extensions.has_column(
  'plugin_data', 'csf_sheet_import_rows', 'commit_target_profile_id',
  'each row records the explicit target its commit may attach to'
);

SELECT extensions.has_column(
  'plugin_data', 'csf_sheet_import_rows', 'commit_intent_correlation_id',
  'each row records the correlation of the write intent that touched it'
);

SELECT extensions.has_column(
  'plugin_data', 'csf_sheet_import_rows', 'commit_outcome_state',
  'each row records a durable recovery state'
);

-- The replaced designs must be gone, not merely unused.
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'plugin_data'
      AND table_name = 'csf_sheet_import_staging_objects'
      AND column_name = 'consumed_at'
  ),
  'the digest-keyed consume design is removed from staging'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'plugin_data'
      AND proc.proname IN (
        'csf_open_csf_import_staging_object',
        'csf_consume_csf_import_staging_object'
      )
  ),
  'the replaced open/consume staging pair does not exist'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'plugin_data'
      AND table_name = 'csf_sheet_import_rows'
      AND column_name IN ('commit_job_id', 'commit_correlation_id', 'commit_checkpoint_at')
  ),
  'the clearable commit_job_id and mutable row correlation design is removed'
);

-- ---------------------------------------------------------------------------
-- Indexes, with their exact columns and predicates.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT indexdef FROM pg_indexes
   WHERE schemaname = 'plugin_data' AND indexname = 'csf_commit_attempts_one_running_idx'),
  'CREATE UNIQUE INDEX csf_commit_attempts_one_running_idx ON plugin_data.csf_sheet_import_commit_attempts USING btree (commit_job_id) WHERE (status = ''running''::text)',
  'only one attempt per logical commit may be running'
);

-- The logical-commit coordinate. This index, not a read-then-write check, is what
-- arbitrates two workers racing the same immutable preview.
SELECT extensions.is(
  (SELECT indexdef FROM pg_indexes
   WHERE schemaname = 'plugin_data' AND indexname = 'csf_sheet_import_jobs_one_commit_per_preview_idx'),
  'CREATE UNIQUE INDEX csf_sheet_import_jobs_one_commit_per_preview_idx ON plugin_data.csf_sheet_import_jobs USING btree (organization_id, preview_job_id) WHERE ((mode = ''commit''::text) AND (preview_job_id IS NOT NULL))',
  'one logical commit per preview, arbitrated by a unique coordinate index'
);

SELECT extensions.is(
  (SELECT indexdef FROM pg_indexes
   WHERE schemaname = 'plugin_data' AND indexname = 'csf_staging_objects_one_upload_per_source_idx'),
  'CREATE UNIQUE INDEX csf_staging_objects_one_upload_per_source_idx ON plugin_data.csf_sheet_import_staging_objects USING btree (source_id) WHERE (status = ''uploading''::text)',
  'a source may hold at most one in-flight upload, and a readable generation alongside it'
);

SELECT extensions.is(
  (SELECT indexdef FROM pg_indexes
   WHERE schemaname = 'plugin_data' AND indexname = 'csf_sheet_import_rows_pending_commit_idx'),
  'CREATE INDEX csf_sheet_import_rows_pending_commit_idx ON plugin_data.csf_sheet_import_rows USING btree (job_id, sheet_tab_name, row_number, id) WHERE (import_status = ''pending''::text)',
  'still-pending rows are indexed in a total order for deterministic paging'
);

SELECT extensions.has_index(
  'plugin_data', 'csf_sheet_import_rows', 'csf_sheet_import_rows_open_outcome_idx',
  'the unsettled-outcome recovery worklist is indexed'
);

SELECT extensions.has_index(
  'plugin_data', 'csf_sheet_import_rows', 'csf_sheet_import_rows_frozen_target_idx',
  'the frozen target reference is indexed on its referencing side'
);

SELECT extensions.has_index(
  'plugin_data', 'csf_sheet_import_staging_claims', 'csf_staging_claims_expired_sweep_idx',
  'the global expired-claim sweep has an index matching its scan'
);

-- ---------------------------------------------------------------------------
-- Readiness: structured tabs are the sole range authority.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  plugin_data.csf_import_preview_claim_blockers(
    'df100000-0000-4000-8000-000000000001',
    'df300000-0000-4000-8000-000000000001'
  ),
  ARRAY[]::text[],
  'a complete preview with a comma-bearing tab name has no claim blockers'
);

-- A tab really named `Fall, 2025` is one tab. Splitting `source_range` on commas
-- turned it into two meaningless fragments a reader could not tell apart from a
-- genuine two-tab import.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM jsonb_array_elements(
      (SELECT mapping_snapshot -> 'tabs' FROM plugin_data.csf_sheet_import_jobs
       WHERE id = 'df300000-0000-4000-8000-000000000001')
    ) AS tab
    WHERE tab->>'tabName' = 'Fall, 2025'
  ),
  1,
  'a tab whose name contains a comma is exactly one mapped tab'
);

-- ---------------------------------------------------------------------------
-- Live source identity and revision drift, per dimension.
--
-- The gate validated the frozen preview's own evidence and the live source's access and
-- trash state, but never compared *which file* the source now points at or whether its
-- contents had moved on. Re-pointing a source at a different spreadsheet, or editing the
-- Sheet after previewing it, reached a gate that froze the old reviewed decision against
-- the new file.
-- ---------------------------------------------------------------------------

-- Drive file ID replacement.
UPDATE plugin_data.csf_sheet_sources
SET drive_file_id = 'synthetic-replacement-file'
WHERE id = 'df200000-0000-4000-8000-000000000002';

SELECT extensions.ok(
  'This source now points at a different file. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000002'
    )
  ),
  'replacing the Drive file behind a preview blocks the claim'
);

UPDATE plugin_data.csf_sheet_sources
SET drive_file_id = 'synthetic-application-file'
WHERE id = 'df200000-0000-4000-8000-000000000002';

-- Revision drift: the Sheet was edited after it was previewed.
UPDATE plugin_data.csf_sheet_sources
SET drive_modified_at = '2026-07-02T00:00:00Z'
WHERE id = 'df200000-0000-4000-8000-000000000002';

SELECT extensions.ok(
  'This source changed after it was previewed. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000002'
    )
  ),
  'a source modified after the preview blocks the claim'
);

UPDATE plugin_data.csf_sheet_sources
SET drive_modified_at = '2026-07-01T00:00:00Z'
WHERE id = 'df200000-0000-4000-8000-000000000002';

-- Provider replacement: the frozen provider family no longer agrees with the
-- locked source row, so the gate refuses to guess a different family's rules.
UPDATE plugin_data.csf_sheet_sources
SET provider = 'uploaded_csv'
WHERE id = 'df200000-0000-4000-8000-000000000002';

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000002'
    )
  ),
  'a provider that disagrees with the frozen provider family blocks the claim'
);

UPDATE plugin_data.csf_sheet_sources
SET provider = 'google_sheets'
WHERE id = 'df200000-0000-4000-8000-000000000002';

-- An unrecognised provider is fail-closed rather than unchecked.
UPDATE plugin_data.csf_sheet_sources
SET provider = 'uploaded_xlsx'
WHERE id = 'df200000-0000-4000-8000-000000000002';

SELECT extensions.ok(
  array_length(
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000002'
    ), 1
  ) > 0,
  'a source whose provider no longer matches its previewed evidence cannot be claimed'
);

UPDATE plugin_data.csf_sheet_sources
SET provider = 'google_sheets'
WHERE id = 'df200000-0000-4000-8000-000000000002';

-- Uploaded workbooks drift on the staging generation and its digest. Applied to
-- the source the roster preview was actually taken from.
UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('stagingContentHash', repeat('6', 64))
WHERE id = 'df200000-0000-4000-8000-000000000007';

SELECT extensions.ok(
  'A newer workbook was uploaded for this source. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000001'
    )
  ),
  'a newer uploaded workbook digest blocks a claim against the older preview'
);

UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('stagingContentHash', repeat('5', 64))
WHERE id = 'df200000-0000-4000-8000-000000000007';

UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object(
      'stagingObjectId', 'df210000-0000-4000-8000-000000000002'
    )
WHERE id = 'df200000-0000-4000-8000-000000000007';

SELECT extensions.ok(
  'A newer workbook was uploaded for this source. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000001'
    )
  ),
  'a newer staging generation blocks a claim against the older preview'
);

UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object(
      'stagingObjectId', 'df210000-0000-4000-8000-000000000001'
    )
WHERE id = 'df200000-0000-4000-8000-000000000007';

-- ---------------------------------------------------------------------------
-- Malformed and drifted evidence, on purpose-built fixtures.
--
-- Every case below gets its own preview job, inserted with the shape it is testing
-- already in place. The previous version mutated the shared preview instead -- but
-- `csf_reject_import_provenance_mutation` makes `source_file_metadata` and
-- `mapping_snapshot` immutable, and `csf_sheet_import_jobs_source_file_metadata_object_check`
-- forbids a non-object -- so those statements raised 55000/23514 and aborted the whole
-- run before any of the assertions they set up could be reached. Disabling the trigger
-- to test around it would have been worse: the invariant is the thing being relied on
-- everywhere else in this file.
--
-- These fixtures carry no rows, so each also reports the row-count and no-ready-rows
-- blockers. That is why every assertion here tests *membership* of the specific blocker
-- rather than the exact blocker array.
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
)
SELECT
  shape.id,
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000002',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'application_responses',
  'synthetic-application-file', 'Synthetic applications', 'Responses', 'Responses!A1:Z9',
  '2026-07-01T00:00:00Z',
  shape.metadata,
  shape.mapping,
  1, repeat('3', 64), repeat('4', 64), 1, 'csf-normalized-import/v1'
FROM (
  VALUES
    -- `trashed` present but not a boolean. `(... ->> 'trashed')::boolean` raised
    -- invalid_text_representation from inside a STABLE function for each of these.
    (
      'df310000-0000-4000-8000-000000000001'::uuid,
      jsonb_build_object(
        'id', 'synthetic-application-file',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'version', '41',
        'modifiedTime', '2026-07-01T00:00:00Z',
        'accessState', 'accessible',
        'trashed', 'no'
      ),
      jsonb_build_object(
        'version', 1, 'sourceType', 'application_responses',
        'sourceFileId', 'synthetic-application-file',
        'tabs', jsonb_build_array(
          jsonb_build_object('tabName', 'Responses', 'range', 'Responses!A1:Z9', 'headerRow', 1)
        )
      )
    ),
    (
      'df310000-0000-4000-8000-000000000002'::uuid,
      jsonb_build_object(
        'id', 'synthetic-application-file',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'version', '41',
        'modifiedTime', '2026-07-01T00:00:00Z',
        'accessState', 'accessible',
        'trashed', 3
      ),
      jsonb_build_object(
        'version', 1, 'sourceType', 'application_responses',
        'sourceFileId', 'synthetic-application-file',
        'tabs', jsonb_build_array(
          jsonb_build_object('tabName', 'Responses', 'range', 'Responses!A1:Z9', 'headerRow', 1)
        )
      )
    ),
    -- An object with no evidence in it at all. The column CHECK forbids a non-object, so
    -- "not an object" is unreachable by construction; empty is the reachable shape.
    (
      'df310000-0000-4000-8000-000000000003'::uuid,
      '{}'::jsonb,
      jsonb_build_object(
        'version', 1, 'sourceType', 'application_responses',
        'sourceFileId', 'synthetic-application-file',
        'tabs', jsonb_build_array(
          jsonb_build_object('tabName', 'Responses', 'range', 'Responses!A1:Z9', 'headerRow', 1)
        )
      )
    ),
    -- Absent structured tabs.
    (
      'df310000-0000-4000-8000-000000000004'::uuid,
      jsonb_build_object(
        'id', 'synthetic-application-file',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'version', '41',
        'modifiedTime', '2026-07-01T00:00:00Z',
        'accessState', 'accessible', 'trashed', false
      ),
      jsonb_build_object(
        'version', 1, 'sourceType', 'application_responses',
        'sourceFileId', 'synthetic-application-file'
      )
    ),
    -- The same tab mapped twice.
    (
      'df310000-0000-4000-8000-000000000005'::uuid,
      jsonb_build_object(
        'id', 'synthetic-application-file',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'version', '41',
        'modifiedTime', '2026-07-01T00:00:00Z',
        'accessState', 'accessible', 'trashed', false
      ),
      jsonb_build_object(
        'version', 1, 'sourceType', 'application_responses',
        'sourceFileId', 'synthetic-application-file',
        'tabs', jsonb_build_array(
          jsonb_build_object('tabName', 'Responses', 'range', 'Responses!A1:Z9', 'headerRow', 1),
          jsonb_build_object('tabName', 'Responses', 'range', 'Responses!A1:Z9', 'headerRow', 1)
        )
      )
    ),
    -- A used-range placeholder names no cells and can never be provenance.
    (
      'df310000-0000-4000-8000-000000000006'::uuid,
      jsonb_build_object(
        'id', 'synthetic-application-file',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'version', '41',
        'modifiedTime', '2026-07-01T00:00:00Z',
        'accessState', 'accessible', 'trashed', false
      ),
      jsonb_build_object(
        'version', 1, 'sourceType', 'application_responses',
        'sourceFileId', 'synthetic-application-file',
        'tabs', jsonb_build_array(
          jsonb_build_object('tabName', 'Responses', 'range', 'used-range', 'headerRow', 1)
        )
      )
    ),
    -- A non-positive header row.
    (
      'df310000-0000-4000-8000-000000000007'::uuid,
      jsonb_build_object(
        'id', 'synthetic-application-file',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'version', '41',
        'modifiedTime', '2026-07-01T00:00:00Z',
        'accessState', 'accessible', 'trashed', false
      ),
      jsonb_build_object(
        'version', 1, 'sourceType', 'application_responses',
        'sourceFileId', 'synthetic-application-file',
        'tabs', jsonb_build_array(
          jsonb_build_object('tabName', 'Responses', 'range', 'Responses!A1:Z9', 'headerRow', 0)
        )
      )
    ),
    -- A mapping snapshot that names a different source type than the job it belongs to.
    (
      'df310000-0000-4000-8000-000000000008'::uuid,
      jsonb_build_object(
        'id', 'synthetic-application-file',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'version', '41',
        'modifiedTime', '2026-07-01T00:00:00Z',
        'accessState', 'accessible', 'trashed', false
      ),
      jsonb_build_object(
        'version', 1, 'sourceType', 'class_history',
        'sourceFileId', 'synthetic-application-file',
        'tabs', jsonb_build_array(
          jsonb_build_object('tabName', 'Responses', 'range', 'Responses!A1:Z9', 'headerRow', 1)
        )
      )
    ),
    -- Scalar `tabs`: `jsonb_array_length` on a scalar raises, so the shape check has to
    -- be in separate control flow from the length call rather than relying on SQL
    -- short-circuiting a single boolean expression.
    (
      'df310000-0000-4000-8000-000000000009'::uuid,
      jsonb_build_object(
        'id', 'synthetic-application-file',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'version', '41',
        'modifiedTime', '2026-07-01T00:00:00Z',
        'accessState', 'accessible', 'trashed', false
      ),
      jsonb_build_object(
        'version', 1, 'sourceType', 'application_responses',
        'sourceFileId', 'synthetic-application-file',
        'tabs', 7
      )
    ),
    (
      'df310000-0000-4000-8000-000000000010'::uuid,
      jsonb_build_object(
        'id', 'synthetic-application-file',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'version', '41',
        'modifiedTime', '2026-07-01T00:00:00Z',
        'accessState', 'accessible', 'trashed', false
      ),
      jsonb_build_object(
        'version', 1, 'sourceType', 'application_responses',
        'sourceFileId', 'synthetic-application-file',
        'tabs', jsonb_build_object('tabName', 'Responses')
      )
    ),
    (
      'df310000-0000-4000-8000-000000000011'::uuid,
      jsonb_build_object(
        'id', 'synthetic-application-file',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'version', '41',
        'modifiedTime', '2026-07-01T00:00:00Z',
        'accessState', 'accessible', 'trashed', false
      ),
      jsonb_build_object(
        'version', 1, 'sourceType', 'application_responses',
        'sourceFileId', 'synthetic-application-file',
        'tabs', 'null'::jsonb
      )
    )
) AS shape(id, metadata, mapping);

-- Malformed `trashed`, both non-boolean shapes: a bounded result, never a raised cast.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df310000-0000-4000-8000-000000000001'
    )
  $$,
  'a string trashed flag returns a bounded blocker list rather than raising a cast error'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df310000-0000-4000-8000-000000000001'
    )
  ),
  'a string trashed flag blocks the claim'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df310000-0000-4000-8000-000000000002'
    )
  $$,
  'a numeric trashed flag returns a bounded blocker list rather than raising a cast error'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df310000-0000-4000-8000-000000000002'
    )
  ),
  'a numeric trashed flag blocks the claim'
);

SELECT extensions.ok(
  'Reconnect the source file before importing.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df310000-0000-4000-8000-000000000003'
    )
  ),
  'source evidence with nothing recorded in it blocks the claim'
);

-- Structured tab shapes.
SELECT extensions.ok(
  'Select at least one exact Sheet tab and range.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df310000-0000-4000-8000-000000000004'
    )
  ),
  'an absent structured tab list blocks the claim'
);

SELECT extensions.ok(
  'The Responses tab is mapped more than once.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df310000-0000-4000-8000-000000000005'
    )
  ),
  'the same tab mapped twice blocks the claim'
);

SELECT extensions.ok(
  'Select an exact Sheet range.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df310000-0000-4000-8000-000000000006'
    )
  ),
  'a used-range placeholder blocks the claim'
);

SELECT extensions.ok(
  'Choose the header row for every selected tab.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df310000-0000-4000-8000-000000000007'
    )
  ),
  'a non-positive header row blocks the claim'
);

SELECT extensions.ok(
  'Inspect and map the selected columns again.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df310000-0000-4000-8000-000000000008'
    )
  ),
  'a mapping snapshot that names another source type blocks the claim'
);

-- Non-array `tabs` of every JSON shape: each must be a bounded blocker, not a raise.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df310000-0000-4000-8000-000000000009'
    )
  $$,
  'a numeric tabs value returns a bounded blocker list rather than raising on jsonb_array_length'
);

SELECT extensions.ok(
  'Select at least one exact Sheet tab and range.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df310000-0000-4000-8000-000000000009'
    )
  ),
  'a numeric tabs value blocks the claim'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df310000-0000-4000-8000-000000000010'
    )
  $$,
  'an object tabs value returns a bounded blocker list rather than raising on jsonb_array_length'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df310000-0000-4000-8000-000000000011'
    )
  $$,
  'a JSON null tabs value returns a bounded blocker list rather than raising on jsonb_array_length'
);

-- A benign rename is evidence, not identity. Asserted on the shared roster preview,
-- whose immutable metadata is left exactly as inserted; only the mutable source row is
-- renamed.
UPDATE plugin_data.csf_sheet_sources
SET drive_file_name = 'Synthetic roster (renamed).xlsx',
    title = 'Synthetic recovery roster (renamed)'
WHERE id = 'df200000-0000-4000-8000-000000000001';

SELECT extensions.is(
  plugin_data.csf_import_preview_claim_blockers(
    'df100000-0000-4000-8000-000000000001',
    'df300000-0000-4000-8000-000000000001'
  ),
  ARRAY[]::text[],
  'renaming the source file does not block a commit, because a name is evidence and not identity'
);

-- ---------------------------------------------------------------------------
-- Claiming: one logical commit, a frozen decision, a canonical lock order.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_claim_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001', 300,
      (plugin_data.csf_issue_uploaded_source_evidence(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        'df200000-0000-4000-8000-000000000007',
        'df300000-0000-4000-8000-000000000001'
       ) ->> 'evidenceToken')::uuid
    )
  $$,
  'a first commit attempt can be claimed for a complete central preview'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_jobs
   WHERE mode = 'commit' AND preview_job_id = 'df300000-0000-4000-8000-000000000001'),
  1,
  'claiming creates exactly one logical commit job for the preview'
);

-- The unique coordinate index, not the RPC's own bookkeeping, is what forbids a
-- second logical commit. Asserted by trying to insert one directly.
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, source_id, mode, status, source_type, preview_job_id
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'commit', 'running', 'student_roster',
      'df300000-0000-4000-8000-000000000001'
    )
  $$,
  '23505',
  NULL,
  'a second logical commit for the same preview is refused by the coordinate index'
);

-- Behavioral evidence that claiming took the coordinate's advisory lock. It is
-- transaction-scoped, so it is still held here.
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_locks
    WHERE locktype = 'advisory'
      AND pid = pg_backend_pid()
      AND granted
  ),
  'claiming takes a transaction-scoped advisory lock on the logical coordinate'
);

SELECT extensions.is(
  (SELECT commit_actor_user_id FROM plugin_data.csf_sheet_import_jobs
   WHERE mode = 'commit' AND preview_job_id = 'df300000-0000-4000-8000-000000000001'),
  'df000000-0000-4000-8000-000000000001'::uuid,
  'the logical commit freezes the officer whose decision it executes'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows
   WHERE job_id = 'df300000-0000-4000-8000-000000000001'
     AND commit_outcome_state = 'frozen'),
  2,
  'the first claim freezes every ready row of the preview'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      commit_frozen_at IS NOT NULL
      AND commit_frozen_row_hash = row_hash
      AND commit_frozen_source_id = source_id
      AND commit_frozen_source_revision = repeat('5', 64)
      AND commit_frozen_payload_hash ~ '^[0-9a-f]{64}$'
      AND commit_frozen_actor_user_id = 'df000000-0000-4000-8000-000000000001'
      AND commit_resolution_snapshot ? 'basis'
    )
    FROM plugin_data.csf_sheet_import_rows
    WHERE job_id = 'df300000-0000-4000-8000-000000000001'
  ),
  'the freeze records the row digest, source, source revision, payload digest, and actor'
);

SELECT extensions.is(
  (SELECT commit_resolution_snapshot->>'basis' FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'df500000-0000-4000-8000-000000000001'),
  'unmatched',
  'a roster row with no reviewed match is frozen as unmatched, not silently targeted'
);

SELECT extensions.is(
  (SELECT commit_target_profile_id FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'df500000-0000-4000-8000-000000000001'),
  NULL,
  'an unmatched row freezes no target'
);

-- ---------------------------------------------------------------------------
-- The frozen decision cannot be re-aimed or re-frozen.
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  school_email, personal_email,
  normalized_first_name, normalized_last_name,
  normalized_school_email, normalized_personal_email
) VALUES (
  'df600000-0000-4000-8000-000000000001',
  'df100000-0000-4000-8000-000000000001',
  'Marisol', 'Quill',
  'mquill@students.example.net', 'marisol.quill@example.test',
  'marisol', 'quill',
  'mquill@students.example.net', 'marisol.quill@example.test'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET commit_frozen_row_hash = repeat('f', 64)
    WHERE id = 'df500000-0000-4000-8000-000000000001'
  $$,
  '55000',
  NULL,
  'a frozen row digest cannot be rewritten'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET commit_target_profile_id = 'df600000-0000-4000-8000-000000000001'
    WHERE id = 'df500000-0000-4000-8000-000000000001'
  $$,
  '55000',
  NULL,
  'a frozen row cannot gain a target after the decision was approved'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET commit_resolution_snapshot = '{"basis":"officer_resolved"}'::jsonb
    WHERE id = 'df500000-0000-4000-8000-000000000001'
  $$,
  '55000',
  NULL,
  'a frozen resolution snapshot cannot be rewritten'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET commit_outcome_state = 'succeeded'
    WHERE id = 'df500000-0000-4000-8000-000000000001'
  $$,
  '55000',
  NULL,
  'a frozen row cannot jump straight to succeeded without a write intent'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET commit_outcome_state = 'unknown',
        commit_outcome_unresolved = true,
        commit_outcome_note = 'forged'
    WHERE id = 'df500000-0000-4000-8000-000000000001'
  $$,
  '55000',
  NULL,
  'a frozen row cannot be declared unknown without a write intent'
);

-- The all-or-none freeze constraint: a half-written freeze is a forged one.
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET commit_frozen_at = now()
    WHERE id = 'df500000-0000-4000-8000-000000000003'
  $$,
  '23514',
  NULL,
  'a partial freeze is refused by the all-or-none constraint'
);

-- Deletion of anything frozen evidence names is restricted rather than cascaded or
-- nulled. NO ACTION rather than RESTRICT deliberately: both refuse the delete, but
-- NO ACTION is checked at the end of the statement, so deleting a whole organization
-- -- which cascades to profiles, jobs, attempts *and* these rows in one statement --
-- still succeeds instead of depending on cascade ordering.
SELECT extensions.is(
  (
    SELECT string_agg(constraint_reference.confdeltype::text, '' ORDER BY constraint_reference.conname)
    FROM pg_constraint AS constraint_reference
    WHERE constraint_reference.conrelid = 'plugin_data.csf_sheet_import_rows'::regclass
      AND constraint_reference.conname IN (
        'csf_sheet_import_rows_frozen_job_organization_fkey',
        'csf_sheet_import_rows_frozen_source_organization_fkey',
        'csf_sheet_import_rows_frozen_target_organization_fkey',
        'csf_sheet_import_rows_intent_attempt_organization_fkey'
      )
  ),
  'aaaa',
  'every frozen-evidence reference refuses deletion of what it names'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_constraint AS constraint_reference
    WHERE constraint_reference.conrelid = 'plugin_data.csf_sheet_import_rows'::regclass
      AND constraint_reference.contype = 'f'
      AND constraint_reference.conname IN (
        'csf_sheet_import_rows_frozen_job_organization_fkey',
        'csf_sheet_import_rows_frozen_source_organization_fkey',
        'csf_sheet_import_rows_frozen_target_organization_fkey',
        'csf_sheet_import_rows_intent_attempt_organization_fkey'
      )
      AND array_length(constraint_reference.conkey, 1) = 2
  ),
  4,
  'every frozen-evidence reference is composite, so it cannot cross a tenant'
);

-- ---------------------------------------------------------------------------
-- Begin-intent, and the states that follow it.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT plugin_data.csf_begin_import_row_for_attempt(
      'df100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_commit_attempts WHERE attempt_number = 1),
      'df500000-0000-4000-8000-000000000001'
    ) ->> 'outcomeState'
  ),
  'in_flight',
  'begin-intent moves the exact frozen row into flight'
);

SELECT extensions.ok(
  (
    SELECT commit_intent_attempt_id
      = (SELECT id FROM plugin_data.csf_sheet_import_commit_attempts WHERE attempt_number = 1)
      AND commit_intent_correlation_id
        = (SELECT correlation_id FROM plugin_data.csf_sheet_import_commit_attempts WHERE attempt_number = 1)
      AND commit_intent_started_at IS NOT NULL
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'df500000-0000-4000-8000-000000000001'
  ),
  'the intent records the attempt, its correlation, and when it started'
);

-- Replaying the same attempt's own intent is idempotent, not a second write.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_begin_import_row_for_attempt(
      'df100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_commit_attempts WHERE attempt_number = 1),
      'df500000-0000-4000-8000-000000000001'
    ) ->> 'replayedIntent'
  ),
  'true',
  'an attempt replaying its own begin-intent observes it, and starts nothing new'
);

-- A row that belongs to another preview is refused, whatever its id.
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_begin_import_row_for_attempt(
        'df100000-0000-4000-8000-000000000001', %L,
        'df500000-0000-4000-8000-000000000003')$$,
    (SELECT id FROM plugin_data.csf_sheet_import_commit_attempts WHERE attempt_number = 1)
  ),
  '23503',
  NULL,
  'begin-intent refuses a row from another preview'
);

-- Recovery readback distinguishes in-flight from never-attempted.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_import_row_recovery_state(
      'df100000-0000-4000-8000-000000000001',
      'df500000-0000-4000-8000-000000000001'
    ) ->> 'outcomeState'
  ),
  'in_flight',
  'recovery readback reports a live in-flight write'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_import_row_recovery_state(
      'df100000-0000-4000-8000-000000000001',
      'df500000-0000-4000-8000-000000000001'
    ) ->> 'intentStale'
  ),
  'false',
  'an intent whose attempt still holds its lease is reported live, not stale'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_import_row_recovery_state(
      'df100000-0000-4000-8000-000000000001',
      'df500000-0000-4000-8000-000000000002'
    ) ->> 'safeToRetry'
  ),
  'true',
  'a frozen row that was never attempted is reported safe to retry'
);

-- A lost response is durably unknown, never a blind retry and never a fabricated
-- failure.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_fail_import_row_for_attempt(
      'df100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_commit_attempts WHERE attempt_number = 1),
      'df500000-0000-4000-8000-000000000001',
      'transport_failure',
      'The connection closed before the import replied.',
      false
    ) ->> 'outcomeState'
  ),
  'unknown',
  'a failure with no trustworthy response is recorded as unknown, not failed'
);

SELECT extensions.ok(
  (
    SELECT commit_outcome_unresolved
      AND commit_outcome_state = 'unknown'
      AND import_status = 'pending'
      AND commit_outcome_correlation_id IS NOT NULL
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'df500000-0000-4000-8000-000000000001'
  ),
  'an unknown row stays out of the terminal statuses and keeps the correlation to reconcile against'
);

SELECT extensions.is(
  (SELECT commit_outcome_code FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'df500000-0000-4000-8000-000000000001'),
  'transport_failure',
  'the durable evidence is the closed reason code that was supplied'
);

-- Prose that reads like a database or provider message is dropped, not clipped: a
-- truncated raw message is still a raw message.
SELECT extensions.is(
  plugin_data.csf_bounded_failure_detail(
    'ERROR: duplicate key value violates unique constraint "csf_profiles_pkey"'
  ),
  NULL,
  'a raw database message is dropped rather than truncated into durable evidence'
);

SELECT extensions.is(
  plugin_data.csf_bounded_failure_detail(
    'The connection closed before the import replied at https://internal.example.test/rpc'
  ),
  NULL,
  'a message carrying a URI is dropped rather than persisted'
);

SELECT extensions.is(
  plugin_data.csf_bounded_failure_detail('The import failed'),
  'The import failed',
  'plain operational prose survives sanitizing'
);

SELECT extensions.is(
  plugin_data.csf_bounded_reason_code('Totally Invalid Code!', 'commit_failed'),
  'commit_failed',
  'a reason that is not a closed code falls back to the classified default'
);

-- An unknown row may not be committed, begun again, or blindly retried.
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_begin_import_row_for_attempt(
        'df100000-0000-4000-8000-000000000001', %L,
        'df500000-0000-4000-8000-000000000001')$$,
    (SELECT id FROM plugin_data.csf_sheet_import_commit_attempts WHERE attempt_number = 1)
  ),
  '23514',
  NULL,
  'an unknown row cannot be begun again until it is reconciled'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_commit_import_row_for_attempt(
        'df100000-0000-4000-8000-000000000001', %L,
        'df500000-0000-4000-8000-000000000001')$$,
    (SELECT id FROM plugin_data.csf_sheet_import_commit_attempts WHERE attempt_number = 1)
  ),
  '23514',
  NULL,
  'an unknown row cannot be committed on top of its unresolved outcome'
);

-- Committing without a live intent for this attempt is refused outright.
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_commit_import_row_for_attempt(
        'df100000-0000-4000-8000-000000000001', %L,
        'df500000-0000-4000-8000-000000000002')$$,
    (SELECT id FROM plugin_data.csf_sheet_import_commit_attempts WHERE attempt_number = 1)
  ),
  '55000',
  NULL,
  'a row with no live write intent for this attempt cannot be committed'
);

-- ---------------------------------------------------------------------------
-- Reconciliation is explicit, attributed, and bound to the original correlation.
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_reconcile_import_row_outcome(
      'df100000-0000-4000-8000-000000000001',
      'df500000-0000-4000-8000-000000000001',
      NULL, 'accepted_as_not_written',
      (SELECT commit_outcome_correlation_id FROM plugin_data.csf_sheet_import_rows
       WHERE id = 'df500000-0000-4000-8000-000000000001'),
      'officer_reconciled', NULL
    )
  $$,
  '23502',
  NULL,
  'reconciling an unknown outcome without an officer is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_reconcile_import_row_outcome(
      'df100000-0000-4000-8000-000000000001',
      'df500000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001', 'looks_fine',
      (SELECT commit_outcome_correlation_id FROM plugin_data.csf_sheet_import_rows
       WHERE id = 'df500000-0000-4000-8000-000000000001'),
      'officer_reconciled', NULL
    )
  $$,
  '22023',
  NULL,
  'reconciling without one of the two explicit decisions is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_reconcile_import_row_outcome(
      'df100000-0000-4000-8000-000000000001',
      'df500000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001', 'accepted_as_not_written',
      'df900000-0000-4000-8000-000000000009',
      'officer_reconciled', NULL
    )
  $$,
  '55P03',
  NULL,
  'reconciling against a correlation the unknown was not recorded under is refused'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_reconcile_import_row_outcome(
      'df100000-0000-4000-8000-000000000001',
      'df500000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001', 'accepted_as_not_written',
      (SELECT commit_outcome_correlation_id FROM plugin_data.csf_sheet_import_rows
       WHERE id = 'df500000-0000-4000-8000-000000000001'),
      'officer_reconciled', 'Reviewed and no record was written'
    ) ->> 'outcomeState'
  ),
  'failed',
  'an unknown outcome accepted as not written settles as a deterministic failure'
);

SELECT extensions.ok(
  (
    SELECT NOT commit_outcome_unresolved
      AND commit_outcome_resolution = 'accepted_as_not_written'
      AND commit_outcome_resolved_by = 'df000000-0000-4000-8000-000000000001'
      AND commit_outcome_resolved_at IS NOT NULL
      AND import_status = 'error'
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'df500000-0000-4000-8000-000000000001'
  ),
  'a reconciled outcome records the decision, the officer, and the time'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
    WHERE action = 'sheet_import.outcome_reconciled'
      AND target_id = 'df500000-0000-4000-8000-000000000001'
  ),
  1,
  'reconciliation appends exactly one auditable event'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET commit_outcome_resolution = 'accepted_as_written',
        commit_outcome_resolved_by = 'df000000-0000-4000-8000-000000000002',
        commit_outcome_resolved_at = now()
    WHERE id = 'df500000-0000-4000-8000-000000000001'
  $$,
  '55000',
  NULL,
  'a settled outcome cannot be re-reconciled by a later writer'
);

-- ---------------------------------------------------------------------------
-- An application never creates a member. Not in any layer, not with a name.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_claim_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000002',
      'df000000-0000-4000-8000-000000000001', 300,
      (plugin_data.csf_refresh_sheet_source_evidence(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        'df200000-0000-4000-8000-000000000002',
        'df300000-0000-4000-8000-000000000002',
        (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
          WHERE id = 'df200000-0000-4000-8000-000000000002'),
        'synthetic-application-file', 'application/vnd.google-apps.spreadsheet',
        '2026-07-01T00:00:00Z', '41', false, 'accessible', 'Synthetic applications'
       ) ->> 'evidenceToken')::uuid
    )
  $$,
  'an application preview can be claimed'
);

SELECT extensions.is(
  (SELECT commit_target_profile_id FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'df500000-0000-4000-8000-000000000003'),
  NULL,
  'a targetless application row freezes no target, even carrying a full name'
);

SELECT extensions.lives_ok(
  format(
    $$SELECT plugin_data.csf_begin_import_row_for_attempt(
        'df100000-0000-4000-8000-000000000001', %L,
        'df500000-0000-4000-8000-000000000003')$$,
    (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
     JOIN plugin_data.csf_sheet_import_jobs AS commit_job
       ON commit_job.id = attempt.commit_job_id
     WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000002')
  ),
  'an intent may be recorded for the application row before its outcome is known'
);

-- The refusal happens before the legacy row RPC is reached, so its name-only
-- fallback is unreachable rather than merely unused.
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_commit_import_row_for_attempt(
        'df100000-0000-4000-8000-000000000001', %L,
        'df500000-0000-4000-8000-000000000003')$$,
    (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
     JOIN plugin_data.csf_sheet_import_jobs AS commit_job
       ON commit_job.id = attempt.commit_job_id
     WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000002')
  ),
  '23514',
  NULL,
  'a targetless application row is refused before any authoritative write'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profiles
   WHERE organization_id = 'df100000-0000-4000-8000-000000000001'),
  1,
  'no member is created for a targetless application row, name or not'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profiles
    WHERE normalized_first_name = 'wren' AND normalized_last_name = 'alder'
  ),
  'the name on a targetless application row never becomes a member record'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_term_applications
   WHERE organization_id = 'df100000-0000-4000-8000-000000000001'),
  0,
  'no application record is created for a row with no reviewed member'
);

-- The wrapper is the only reachable central import path: service_role cannot call
-- the legacy row RPCs directly, so the fallback cannot be reached around it either.
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_import_application_response_row(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass the fenced wrapper to import an application row directly'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_import_student_roster_row(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass the fenced wrapper to import a roster row directly'
);

-- A null canonical pair matches no member, so unverified form evidence cannot
-- auto-link. The wrapper passes nulls for all four canonical email arguments on an
-- application source unconditionally.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = 'df100000-0000-4000-8000-000000000001'
      AND (
        profile.normalized_school_email = nullif(btrim(NULL), '')
        OR profile.normalized_personal_email = nullif(btrim(NULL), '')
      )
  ),
  0,
  'a null canonical pair matches no member, so a form address cannot auto-link'
);

SELECT extensions.is(
  (
    SELECT coalesce(profile.school_email, nullif(btrim(NULL), ''))
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.id = 'df600000-0000-4000-8000-000000000001'
  ),
  'mquill@students.example.net',
  'a null canonical school address leaves an existing canonical address untouched'
);

-- ---------------------------------------------------------------------------
-- Takeover, and what a stale worker can do: nothing.
-- ---------------------------------------------------------------------------

-- The application attempt still has a row in flight, so its takeover is refused.
UPDATE plugin_data.csf_sheet_import_commit_attempts AS attempt
SET lease_expires_at = now() - interval '1 minute'
WHERE attempt.commit_job_id = (
  SELECT id FROM plugin_data.csf_sheet_import_jobs
  WHERE preview_job_id = 'df300000-0000-4000-8000-000000000002'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_claim_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000002',
      'df000000-0000-4000-8000-000000000001', 300,
      (plugin_data.csf_refresh_sheet_source_evidence(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        'df200000-0000-4000-8000-000000000002',
        'df300000-0000-4000-8000-000000000002',
        (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
          WHERE id = 'df200000-0000-4000-8000-000000000002'),
        'synthetic-application-file', 'application/vnd.google-apps.spreadsheet',
        '2026-07-01T00:00:00Z', '41', false, 'accessible', 'Synthetic applications'
       ) ->> 'evidenceToken')::uuid
    )
  $$,
  '23514',
  NULL,
  -- A genuine receipt, so the refusal is provably about the in-flight row rather
  -- than about missing evidence. The whole statement rolls back with the raise,
  -- so neither the receipt nor the generation bump survives.
  'a takeover is refused while the previous attempt left a write in flight'
);

-- Aborting the stranded attempt turns its own in-flight rows into durable unknowns
-- rather than leaving them for the next attempt to write a second time. The lease has
-- lapsed, so this is also the bounded no-op path.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_abort_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
       JOIN plugin_data.csf_sheet_import_jobs AS commit_job
         ON commit_job.id = attempt.commit_job_id
       WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000002'),
      'commit_failed', 'Aborted for the contract test'
    ) ->> 'reason'
  ),
  'ownership_lost',
  'an attempt whose lease has lapsed cannot abort, and writes nothing'
);

SELECT extensions.is(
  (SELECT commit_outcome_state FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'df500000-0000-4000-8000-000000000003'),
  'in_flight',
  'a bounded no-op abort leaves the row state exactly as it was'
);

-- Now the roster attempt: expire its lease and take it over legitimately. Its only
-- unsettled row was reconciled above, so nothing blocks the takeover.
UPDATE plugin_data.csf_sheet_import_commit_attempts AS attempt
SET lease_expires_at = now() - interval '1 minute'
WHERE attempt.commit_job_id = (
  SELECT id FROM plugin_data.csf_sheet_import_jobs
  WHERE preview_job_id = 'df300000-0000-4000-8000-000000000001'
)
  AND attempt.status = 'running';

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_claim_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000001',
      -- A SECOND officer of THIS organization. This used to name ...0002, who
      -- belongs only to the other tenant; it passed because membership was not
      -- actually being enforced.
      'df000000-0000-4000-8000-000000000006', 300,
      (plugin_data.csf_issue_uploaded_source_evidence(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000006',
        'df200000-0000-4000-8000-000000000007',
        'df300000-0000-4000-8000-000000000001'
       ) ->> 'evidenceToken')::uuid
    )
  $$,
  'an expired roster attempt may be taken over once nothing is unsettled'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    JOIN plugin_data.csf_sheet_import_jobs AS commit_job
      ON commit_job.id = attempt.commit_job_id
    WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
  ),
  2,
  'takeover produces a second attempt of the same logical commit'
);

-- The takeover reuses the frozen actor. It does not inherit the authority of the
-- officer who reviewed the preview, and it does not re-freeze the decision.
SELECT extensions.is(
  (
    SELECT attempt.actor_user_id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    JOIN plugin_data.csf_sheet_import_jobs AS commit_job
      ON commit_job.id = attempt.commit_job_id
    WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
      AND attempt.attempt_number = 2
  ),
  'df000000-0000-4000-8000-000000000001'::uuid,
  'a takeover attempt records the frozen logical actor, not whoever retried'
);

SELECT extensions.is(
  (
    SELECT attempt.actor_snapshot->>'claimedBy'
    FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    JOIN plugin_data.csf_sheet_import_jobs AS commit_job
      ON commit_job.id = attempt.commit_job_id
    WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
      AND attempt.attempt_number = 2
  ),
  'df000000-0000-4000-8000-000000000006',
  'the snapshot still records who actually ran the takeover'
);

SELECT extensions.is(
  (SELECT commit_frozen_actor_user_id FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'df500000-0000-4000-8000-000000000002'),
  'df000000-0000-4000-8000-000000000001'::uuid,
  'a takeover reuses the existing freeze rather than re-copying it'
);

SELECT extensions.is(
  (
    SELECT count(DISTINCT correlation_id)::integer
    FROM plugin_data.csf_sheet_import_commit_attempts
  ),
  3,
  'every attempt carries its own correlation'
);

SELECT extensions.is(
  (
    SELECT attempt.status FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    JOIN plugin_data.csf_sheet_import_jobs AS commit_job
      ON commit_job.id = attempt.commit_job_id
    WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
      AND attempt.attempt_number = 1
  ),
  'superseded',
  'the taken-over attempt is superseded rather than deleted'
);

-- Everything the superseded attempt might try is a no-op or a refusal.
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_heartbeat_import_commit_attempt(
        'df100000-0000-4000-8000-000000000001', %L, 300)$$,
    (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
     JOIN plugin_data.csf_sheet_import_jobs AS commit_job
       ON commit_job.id = attempt.commit_job_id
     WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
       AND attempt.attempt_number = 1)
  ),
  '55P03',
  NULL,
  'a superseded attempt cannot heartbeat'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_begin_import_row_for_attempt(
        'df100000-0000-4000-8000-000000000001', %L,
        'df500000-0000-4000-8000-000000000002')$$,
    (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
     JOIN plugin_data.csf_sheet_import_jobs AS commit_job
       ON commit_job.id = attempt.commit_job_id
     WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
       AND attempt.attempt_number = 1)
  ),
  '55P03',
  NULL,
  'a superseded attempt cannot start a write intent'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_fail_import_row_for_attempt(
        'df100000-0000-4000-8000-000000000001', %L,
        'df500000-0000-4000-8000-000000000002', 'commit_failed', NULL, true)$$,
    (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
     JOIN plugin_data.csf_sheet_import_jobs AS commit_job
       ON commit_job.id = attempt.commit_job_id
     WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
       AND attempt.attempt_number = 1)
  ),
  '55P03',
  NULL,
  'a superseded attempt cannot mark a row failed'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_flag_import_row_outcome_unknown(
        'df100000-0000-4000-8000-000000000001', %L,
        'df500000-0000-4000-8000-000000000002', 'row_outcome_unknown', NULL)$$,
    (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
     JOIN plugin_data.csf_sheet_import_jobs AS commit_job
       ON commit_job.id = attempt.commit_job_id
     WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
       AND attempt.attempt_number = 1)
  ),
  '55P03',
  NULL,
  'a superseded attempt cannot declare an outcome unknown'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_finalize_import_commit_attempt(
        'df100000-0000-4000-8000-000000000001', %L, '{}'::jsonb)$$,
    (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
     JOIN plugin_data.csf_sheet_import_jobs AS commit_job
       ON commit_job.id = attempt.commit_job_id
     WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
       AND attempt.attempt_number = 1)
  ),
  '55P03',
  NULL,
  'a superseded attempt cannot finalize the logical commit'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_commit_import_row_for_attempt(
        'df100000-0000-4000-8000-000000000001', %L,
        'df500000-0000-4000-8000-000000000002')$$,
    (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
     JOIN plugin_data.csf_sheet_import_jobs AS commit_job
       ON commit_job.id = attempt.commit_job_id
     WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
       AND attempt.attempt_number = 1)
  ),
  '55P03',
  NULL,
  'a superseded attempt cannot commit a row'
);

SELECT extensions.throws_ok(
  format(
    $$UPDATE plugin_data.csf_sheet_import_commit_attempts
      SET status = 'running', lease_expires_at = now() + interval '5 minutes',
          completed_at = NULL
      WHERE id = %L$$,
    (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
     JOIN plugin_data.csf_sheet_import_jobs AS commit_job
       ON commit_job.id = attempt.commit_job_id
     WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
       AND attempt.attempt_number = 1)
  ),
  '55000',
  NULL,
  'a finished attempt cannot be resurrected'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_commit_attempts
    SET correlation_id = gen_random_uuid()
    WHERE attempt_number = 2
  $$,
  '55000',
  NULL,
  'attempt correlation cannot be rewritten'
);

-- Row lineage cannot be forged, cleared, or re-pointed.
SELECT extensions.throws_ok(
  format(
    $$UPDATE plugin_data.csf_sheet_import_rows
      SET commit_attempt_id = %L
      WHERE id = 'df500000-0000-4000-8000-000000000002'$$,
    (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
     JOIN plugin_data.csf_sheet_import_jobs AS commit_job
       ON commit_job.id = attempt.commit_job_id
     WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
       AND attempt.attempt_number = 2)
  ),
  '23514',
  NULL,
  'a pending row cannot claim committed lineage'
);

-- ---------------------------------------------------------------------------
-- Finalization is honest about what is unresolved.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
       JOIN plugin_data.csf_sheet_import_jobs AS commit_job
         ON commit_job.id = attempt.commit_job_id
       WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
         AND attempt.attempt_number = 2),
      '{}'::jsonb
    ) ->> 'status'
  ),
  'partially_completed',
  'a preview with a still-pending row cannot finish as completed'
);

SELECT extensions.is(
  (SELECT active_commit_attempt_id FROM plugin_data.csf_sheet_import_jobs
   WHERE mode = 'commit' AND preview_job_id = 'df300000-0000-4000-8000-000000000001'),
  NULL,
  'a terminal logical commit retains no active attempt'
);

SELECT extensions.is(
  (
    SELECT sync_status FROM plugin_data.csf_sheet_sources
    WHERE id = 'df200000-0000-4000-8000-000000000007'
  ),
  'needs_attention',
  'finalize moves source health itself, in the same transaction as the job'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
    WHERE action = 'sheet_import.commit_finalized'
  ),
  1,
  'finalize appends exactly one auditable event'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE action IN (
      'sheet_import.commit_claimed',
      'sheet_import.commit_finalized',
      'sheet_import.outcome_reconciled'
    )
      AND plugin_data.csf_jsonb_carries_raw_content(after_data)
  ),
  'no import audit event carries raw student content'
);

SELECT extensions.ok(
  (
    SELECT bool_and(correlation_id IS NOT NULL)
    FROM plugin_data.csf_admin_audit_events
    WHERE action IN ('sheet_import.commit_claimed', 'sheet_import.commit_finalized')
  ),
  'every claim and finalize event records its correlation in the indexed column'
);

-- ---------------------------------------------------------------------------
-- Contextual imports are out of scope for the ledger.
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_claim_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000003',
      'df000000-0000-4000-8000-000000000001', 300,
      -- Deliberately a receipt that does not exist. The source-type refusal is
      -- raised before the consume is reached, and passing a real one would hide
      -- that ordering rather than prove it.
      'df220000-0000-4000-8000-0000000000ff'::uuid
    )
  $$,
  '23514',
  NULL,
  'an attendance preview is refused a commit attempt'
);

SELECT extensions.ok(
  NOT (
    SELECT summary ? 'commitAttemptHistory'
    FROM plugin_data.csf_sheet_import_jobs
    WHERE id = 'df300000-0000-4000-8000-000000000003'
  ),
  'a contextual attendance job is not annotated with attempt history'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    JOIN plugin_data.csf_sheet_import_jobs AS commit_job
      ON commit_job.id = attempt.commit_job_id
    WHERE commit_job.source_type NOT IN
      ('application_responses', 'student_roster', 'class_history')
  ),
  0,
  'no contextual source type ever owns a commit attempt'
);

-- ---------------------------------------------------------------------------
-- Tenant isolation.
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_claim_import_commit_attempt(
      'df100000-0000-4000-8000-000000000002',
      'df300000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000002', 300,
      'df220000-0000-4000-8000-0000000000ff'::uuid
    )
  $$,
  -- Authorization, not a missing row. `csf_assert_import_actor_for_job` is the
  -- claim's first statement, and it cannot resolve this preview inside the other
  -- organization, so the refusal is 42501 and no lookup ever reports whether the
  -- preview exists. The previous 23503 described a preview-lookup failure that
  -- can no longer be reached from another tenant.
  '42501',
  NULL,
  'another tenant cannot claim a commit attempt for this preview'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_import_row_recovery_state(
      'df100000-0000-4000-8000-000000000002',
      'df500000-0000-4000-8000-000000000002'
    )
  $$,
  '23503',
  NULL,
  'another tenant cannot read a row recovery state'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_reconcile_import_row_outcome(
      'df100000-0000-4000-8000-000000000002',
      'df500000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000002', 'accepted_as_written',
      gen_random_uuid(), 'officer_reconciled', NULL
    )
  $$,
  -- The actor/job authorization boundary runs before the row lookup, just as it
  -- does for a cross-tenant claim above, so the row's existence is not leaked.
  '42501',
  NULL,
  'another tenant cannot reconcile this organization''s import outcome'
);

SELECT extensions.is(
  plugin_data.csf_import_preview_claim_blockers(
    'df100000-0000-4000-8000-000000000002',
    'df300000-0000-4000-8000-000000000001'
  ),
  ARRAY['The preview job was not found.'],
  'readiness for another tenant''s preview reports nothing about it'
);

-- ---------------------------------------------------------------------------
-- Generation-safe staging: open, finalize, claim, retire, release.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT plugin_data.csf_open_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-00000000000e',
      'csf-private', 'xlsx', repeat('c', 64), 2048, 3600
    ) ->> 'generation'
  ),
  '1',
  'the first staging generation for a source is 1'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_open_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-00000000000e',
      'some-public-bucket', 'xlsx', repeat('c', 64), 2048, 3600
    )
  $$,
  '22023',
  NULL,
  'staging is refused in any bucket but the one private bucket'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_open_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-00000000000e',
      'csf-private', 'csv', repeat('c', 64), 2048, 3600
    )
  $$,
  '23514',
  NULL,
  'an extension that disagrees with the source provider is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_open_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000003',
      'csf-private', 'xlsx', repeat('c', 64), 2048, 3600
    )
  $$,
  '23514',
  NULL,
  'a contextual source may not stage a workbook through this lifecycle'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_staging_objects WHERE source_id = 'df200000-0000-4000-8000-00000000000e' AND generation = 1)
    ) ->> 'contentHash'
  ),
  repeat('c', 64),
  'finalizing returns the immutable content evidence for the readable generation'
);

SELECT extensions.is(
  (SELECT uploaded_file_path FROM plugin_data.csf_sheet_sources
   WHERE id = 'df200000-0000-4000-8000-00000000000e'),
  NULL,
  'finalizing makes bytes readable without publishing them onto the source'
);

-- Claims resolve the source's published attachment, not whichever ready row is
-- newest. Publish generation 1 as fixture choreography after proving finalize
-- itself did not do so. This is deliberately a plain setup block rather than a
-- new pgTAP assertion, so the behavioral plan remains exactly 596 assertions.
DO $attach_staging_lifecycle_generation_one$
DECLARE
  v_staging_object_id uuid;
BEGIN
  SELECT id INTO STRICT v_staging_object_id
  FROM plugin_data.csf_sheet_import_staging_objects
  WHERE source_id = 'df200000-0000-4000-8000-00000000000e'
    AND generation = 1;

  PERFORM plugin_data.csf_attach_sheet_source_generation(
    'df100000-0000-4000-8000-000000000001',
    'df000000-0000-4000-8000-000000000001',
    'df200000-0000-4000-8000-00000000000e',
    v_staging_object_id,
    1,
    repeat('c', 64),
    NULL,
    1
  );
END;
$attach_staging_lifecycle_generation_one$;

-- A replacement may be written while the readable generation stays claimable. The
-- previous single index over ('uploading','ready') forbade exactly this.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_open_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-00000000000e',
      'csf-private', 'xlsx', repeat('c', 64), 2048, 3600
    ) ->> 'generation'
  ),
  '2',
  'a re-upload opens a later generation'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_staging_objects
   WHERE source_id = 'df200000-0000-4000-8000-00000000000e' AND status = 'ready'),
  1,
  'the previous generation stays readable while its replacement is being written'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-00000000000e',
      'df000000-0000-4000-8000-000000000001', 900
    ) ->> 'generation'
  ),
  '1',
  'a claim resolves the readable generation, not the one still uploading'
);

SELECT extensions.ok(
  (
    SELECT (claim ->> 'contentHash') = repeat('c', 64)
      AND (claim ->> 'byteLength') = '2048'
      AND (claim ->> 'readyAt') IS NOT NULL
      AND (claim ->> 'objectPath') IS NOT NULL
      AND (claim ->> 'status') = 'ready'
    FROM (
      SELECT plugin_data.csf_claim_staging_object(
        'df100000-0000-4000-8000-000000000001',
        'df200000-0000-4000-8000-00000000000e',
        'df000000-0000-4000-8000-000000000001', 900
      ) AS claim
    ) AS claimed
  ),
  'a claim carries the object path, digest, byte length, ready state and timestamp'
);

-- A generation may retire only itself. An older worker holding a stale object id
-- cannot retire a newer upload.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_retire_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_staging_objects WHERE source_id = 'df200000-0000-4000-8000-00000000000e' AND generation = 2),
      'upload_failed',
      1
    )
  $$,
  '55P03',
  NULL,
  'retiring is fenced on the generation, so a stale worker cannot retire a newer upload'
);

-- Retirement cannot settle while a live claim remains.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_retire_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_staging_objects WHERE source_id = 'df200000-0000-4000-8000-00000000000e' AND generation = 1),
      'superseded_by_new_generation',
      1
    ) ->> 'queued'
  ),
  'false',
  'a generation with live readers is not queued for deletion'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_storage_deletion_queue),
  0,
  'nothing is queued for deletion while a reader still holds a claim'
);

SELECT extensions.is(
  (SELECT uploaded_file_path FROM plugin_data.csf_sheet_sources
   WHERE id = 'df200000-0000-4000-8000-00000000000e'),
  (SELECT object_path FROM plugin_data.csf_sheet_import_staging_objects
   WHERE source_id = 'df200000-0000-4000-8000-00000000000e' AND generation = 1),
  'a pending retirement preserves the attached path while readers remain'
);

-- Releasing the last claim settles the retirement and names the exact path to delete.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_release_staging_claim(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      (SELECT claim_token FROM plugin_data.csf_sheet_import_staging_claims
       ORDER BY claimed_at, id LIMIT 1),
      'preview_finished', false
    ) ->> 'queued'
  ),
  'false',
  'releasing one of two claims does not yet settle the retirement'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_release_staging_claim(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      (SELECT claim_token FROM plugin_data.csf_sheet_import_staging_claims
       WHERE released_at IS NULL ORDER BY claimed_at, id LIMIT 1),
      'preview_finished', true
    ) ->> 'queued'
  ),
  'true',
  'releasing the last claim settles the retirement and queues the bytes'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_storage_deletion_queue),
  1,
  'the retired generation is queued for deletion exactly once'
);

SELECT extensions.is(
  (SELECT uploaded_file_path FROM plugin_data.csf_sheet_sources
   WHERE id = 'df200000-0000-4000-8000-00000000000e'),
  NULL,
  'settling a retirement clears the source path only because it still named those bytes'
);

-- A replay of the same release reports the same queued path, so a retried cleanup
-- deletes exactly the object the first release named.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_release_staging_claim(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      (SELECT claim_token FROM plugin_data.csf_sheet_import_staging_claims
       WHERE release_reason = 'preview_finished' AND retire_intent ORDER BY claimed_at, id LIMIT 1),
      'preview_finished', true
    ) ->> 'objectPath'
  ),
  (SELECT object_path FROM plugin_data.csf_storage_deletion_queue
   WHERE organization_id = 'df100000-0000-4000-8000-000000000001'
   LIMIT 1),
  'a replayed release reports the same queued path rather than a new decision'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_release_staging_claim(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      (SELECT claim_token FROM plugin_data.csf_sheet_import_staging_claims
       WHERE release_reason = 'preview_finished' AND retire_intent ORDER BY claimed_at, id LIMIT 1),
      'preview_finished', false
    )
  $$,
  '55000',
  NULL,
  'a release cannot contradict the retirement decision the first release persisted'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_storage_deletion_queue),
  1,
  'a replayed release does not queue the same bytes a second time'
);

-- Finalizing the replacement promotes it before superseding what it replaces, so the
-- source is never momentarily unreadable.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_staging_objects WHERE source_id = 'df200000-0000-4000-8000-00000000000e' AND generation = 2)
    ) ->> 'generation'
  ),
  '2',
  'the replacement generation becomes the readable one'
);

SELECT extensions.is(
  (SELECT uploaded_file_path FROM plugin_data.csf_sheet_sources
   WHERE id = 'df200000-0000-4000-8000-00000000000e'),
  NULL,
  'finalizing the replacement still does not publish it without an attachment CAS'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_storage_deletion_queue AS queued
    JOIN plugin_data.csf_sheet_import_staging_objects AS staging
      ON staging.bucket = queued.bucket AND staging.object_path = queued.object_path
    WHERE staging.status <> 'queued'
  ),
  'no readable staging generation is ever queued for deletion'
);

-- Tenant isolation for staging.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_claim_staging_object(
      'df100000-0000-4000-8000-000000000002',
      'df200000-0000-4000-8000-00000000000e',
      'df000000-0000-4000-8000-000000000002', 900
    )
  $$,
  -- Authorization is evaluated before any attachment coordinate, so the
  -- cross-tenant caller learns only that this organization has no such source.
  '42501',
  NULL,
  'another tenant cannot claim this organization''s staged workbook'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_retire_staging_object(
      'df100000-0000-4000-8000-000000000002',
      'df000000-0000-4000-8000-000000000002',
      (SELECT id FROM plugin_data.csf_sheet_import_staging_objects WHERE source_id = 'df200000-0000-4000-8000-00000000000e' AND generation = 2),
      'upload_failed', 2
    )
  $$,
  '23503',
  NULL,
  'another tenant cannot retire this organization''s staged workbook'
);

-- The sweeper is bounded and idempotent.
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_sweep_staging_objects(100)$$,
  'the staging sweeper runs within its bound'
);

SELECT extensions.is(
  (SELECT plugin_data.csf_sweep_staging_objects(100) ->> 'abandonedUploads'),
  '0',
  'a second sweep finds nothing left to abandon'
);

-- ---------------------------------------------------------------------------
-- Server-only boundary.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'plugin_data'
      AND tablename IN (
        'csf_sheet_import_jobs', 'csf_sheet_import_rows',
        'csf_sheet_import_commit_attempts',
        'csf_sheet_import_staging_objects', 'csf_sheet_import_staging_claims'
      )
  ),
  'no policy exposes CSF import state to a browser role'
);

SELECT extensions.ok(
  (
    SELECT bool_and(relrowsecurity)
    FROM pg_class
    WHERE relnamespace = 'plugin_data'::regnamespace
      AND relname IN (
        'csf_sheet_import_jobs', 'csf_sheet_import_rows',
        'csf_sheet_import_commit_attempts',
        'csf_sheet_import_staging_objects', 'csf_sheet_import_staging_claims'
      )
  ),
  'row level security remains enabled on every CSF import table'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'plugin_data'
      AND table_name IN (
        'csf_sheet_import_jobs', 'csf_sheet_import_rows',
        'csf_sheet_import_commit_attempts',
        'csf_sheet_import_staging_objects', 'csf_sheet_import_staging_claims'
      )
      AND grantee IN ('anon', 'authenticated', 'PUBLIC')
  ),
  'anon and authenticated hold no grant on any CSF import table'
);

-- Read-only for the server role. Every state transition goes through a narrow
-- lifecycle RPC, so no caller can invent one by writing the table directly.
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'plugin_data'
      AND table_name IN ('csf_sheet_import_staging_objects', 'csf_sheet_import_staging_claims')
      AND grantee = 'service_role'
      AND privilege_type <> 'SELECT'
  ),
  'staging state is read-only for the server role; every transition goes through an RPC'
);

-- Every RPC the action layer speaks, and no client role on any of them.
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'plugin_data'
      AND proc.proname IN (
        'csf_lock_import_commit_coordinate',
        'csf_freeze_import_commit_decision',
        'csf_claim_import_commit_attempt',
        'csf_heartbeat_import_commit_attempt',
        'csf_assert_active_import_commit_attempt',
        'csf_assert_import_row_for_attempt',
        'csf_begin_import_row_for_attempt',
        'csf_commit_import_row_for_attempt',
        'csf_fail_import_row_for_attempt',
        'csf_flag_import_row_outcome_unknown',
        'csf_reconcile_import_row_outcome',
        'csf_accept_historical_import_outcome',
        'csf_import_row_recovery_state',
        'csf_finalize_import_commit_attempt',
        'csf_abort_import_commit_attempt',
        'csf_bounded_reason_code',
        'csf_bounded_failure_detail',
        'csf_open_staging_object',
        'csf_finalize_staging_object',
        'csf_claim_staging_object',
        'csf_release_staging_claim',
        'csf_retire_staging_object',
        'csf_settle_staging_retirement',
        'csf_sweep_staging_objects'
      )
      AND (
        has_function_privilege('anon', proc.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', proc.oid, 'EXECUTE')
      )
  ),
  'client roles cannot execute any CSF import commit or staging function'
);

-- ---------------------------------------------------------------------------
-- The exact privilege set, compared in both directions.
--
-- `bool_and(has_function_privilege(...))` over a hand-listed subset could only ever
-- detect a *missing* grant on a function somebody remembered to list. It could not
-- detect an extra grant, a grant on an overload, or a function left off the list --
-- and since `CREATE OR REPLACE FUNCTION` preserves the ACL, an inherited draft grant on
-- an internal helper is exactly the thing that needed detecting.
--
-- So the whole 01004 inventory is declared once here and compared with `EXCEPT` in both
-- directions: anything intended-but-absent and anything present-but-unintended fails.
-- ---------------------------------------------------------------------------

CREATE TEMPORARY TABLE csf_intended_import_acl (
  signature text PRIMARY KEY,
  service_role_execute boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO csf_intended_import_acl (signature, service_role_execute) VALUES
  ('plugin_data.csf_has_edge_padding(text)', false),
  ('plugin_data.csf_bounded_reason_code(text, text)', false),
  ('plugin_data.csf_bounded_failure_detail(text)', false),
  ('plugin_data.csf_settle_staging_retirement(uuid)', false),
  ('plugin_data.csf_retire_expired_staging_objects(integer)', false),
  ('plugin_data.csf_lock_import_commit_coordinate(uuid, uuid, boolean)', false),
  ('plugin_data.csf_freeze_import_commit_decision(uuid, uuid, uuid, uuid, jsonb)', false),
  ('plugin_data.csf_assert_active_import_commit_attempt(uuid, uuid)', false),
  ('plugin_data.csf_assert_import_row_for_attempt(uuid, uuid, uuid)', false),
  ('plugin_data.csf_enforce_import_row_attempt_lineage()', false),
  ('plugin_data.csf_preserve_import_commit_attempt()', false),
  ('plugin_data.csf_reject_audit_mutation()', false),
  ('plugin_data.csf_retire_staging_object_internal(uuid, uuid, text, integer, uuid)', false),
  ('plugin_data.csf_retire_staging_object(uuid, uuid, uuid, text, integer)', true),
  ('plugin_data.csf_open_staging_object(uuid, uuid, uuid, text, text, text, bigint, integer)', true),
  ('plugin_data.csf_finalize_staging_object(uuid, uuid, uuid)', true),
  ('plugin_data.csf_claim_staging_object(uuid, uuid, uuid, integer)', true),
  ('plugin_data.csf_release_staging_claim(uuid, uuid, uuid, text, boolean)', true),
  ('plugin_data.csf_sweep_staging_objects(integer)', true),
  ('plugin_data.csf_import_preview_claim_blockers(uuid, uuid)', true),
  ('plugin_data.csf_claim_import_commit_attempt(uuid, uuid, uuid, integer, uuid)', true),
  ('plugin_data.csf_heartbeat_import_commit_attempt(uuid, uuid, integer)', true),
  ('plugin_data.csf_begin_import_row_for_attempt(uuid, uuid, uuid)', true),
  ('plugin_data.csf_import_row_recovery_state(uuid, uuid)', true),
  ('plugin_data.csf_commit_import_row_for_attempt(uuid, uuid, uuid)', true),
  ('plugin_data.csf_fail_import_row_for_attempt(uuid, uuid, uuid, text, text, boolean)', true),
  ('plugin_data.csf_flag_import_row_outcome_unknown(uuid, uuid, uuid, text, text)', true),
  ('plugin_data.csf_reconcile_import_row_outcome(uuid, uuid, uuid, text, uuid, text, text)', true),
  ('plugin_data.csf_accept_historical_import_outcome(uuid, uuid, uuid, text)', true),
  ('plugin_data.csf_recover_stale_import_intents(uuid, uuid, uuid, text)', true),
  ('plugin_data.csf_settle_failed_import_row(uuid, uuid, uuid, text, text)', true),
  ('plugin_data.csf_finalize_import_commit_attempt(uuid, uuid, jsonb)', true),
  ('plugin_data.csf_assert_preview_payload_bounds(jsonb)', false),
  ('plugin_data.csf_open_import_preview(uuid, uuid, uuid, text, text, text, text, text, timestamptz, jsonb, jsonb, integer, uuid, text, text, integer, text)', true),
  ('plugin_data.csf_append_import_preview_rows(uuid, uuid, uuid, jsonb)', true),
  ('plugin_data.csf_seal_import_preview(uuid, uuid, uuid, text, jsonb)', true),
  ('plugin_data.csf_fail_import_preview(uuid, uuid, uuid, text, text)', true),
  ('plugin_data.csf_abort_import_commit_attempt(uuid, uuid, text, text)', true),
  -- Wave 3: authorization, canonical form and payload derivation are internal;
  -- the evidence refresh, its consumption, and the cleanup sweeper are reachable.
  ('plugin_data.csf_chapter_today()', false),
  ('plugin_data.csf_import_source_permission(text)', false),
  ('plugin_data.csf_import_compatibility_permissions(text)', false),
  ('plugin_data.csf_assert_import_actor(uuid, uuid, text)', false),
  ('plugin_data.csf_assert_import_cleanup_actor(uuid, uuid, uuid)', false),
  ('plugin_data.csf_assert_import_actor_for_source(uuid, uuid, uuid)', false),
  ('plugin_data.csf_assert_import_actor_for_job(uuid, uuid, uuid)', false),
  ('plugin_data.csf_assert_import_actor_for_row(uuid, uuid, uuid)', false),
  ('plugin_data.csf_sheet_source_settings_schema()', false),
  ('plugin_data.csf_sheet_source_attachment_keys()', false),
  ('plugin_data.csf_assert_sheet_source_settings(jsonb)', false),
  ('plugin_data.csf_register_sheet_source(uuid, uuid, uuid, text, jsonb)', true),
  ('plugin_data.csf_record_sheet_source_sync(uuid, uuid, uuid, text, text, text, boolean)', true),
  ('plugin_data.csf_refresh_sheet_source_drive_metadata(uuid, uuid, uuid, text, text, text, jsonb)', true),
  ('plugin_data.csf_attach_sheet_source_generation(uuid, uuid, uuid, uuid, integer, text, integer, integer)', true),
  ('plugin_data.csf_reconcile_sheet_source_generation(uuid, uuid, uuid, uuid, integer, text, integer, integer)', true),
  ('plugin_data.csf_js_number_text(double precision)', false),
  ('plugin_data.csf_canonical_number_text(numeric)', false),
  ('plugin_data.csf_canonical_json(jsonb)', false),
  ('plugin_data.csf_canonical_digest(jsonb)', false),
  ('plugin_data.csf_payload_string(jsonb)', false),
  ('plugin_data.csf_payload_number(jsonb)', false),
  ('plugin_data.csf_normalize_identity_part(text)', false),
  ('plugin_data.csf_normalize_email_text(text)', false),
  ('plugin_data.csf_meeting_key_from_label(text, integer)', false),
  ('plugin_data.csf_meeting_attendance_value(text)', false),
  ('plugin_data.csf_normalized_record_schema(text)', false),
  ('plugin_data.csf_assert_canonical_record(text, jsonb)', false),
  ('plugin_data.csf_derive_row_commit_payload(text, jsonb)', false),
  ('plugin_data.csf_purge_import_recovery(uuid)', false),
  ('plugin_data.csf_record_import_cleanup_recovery(uuid, uuid, text, text, integer)', true),
  ('plugin_data.csf_sweep_import_cleanup_recovery(integer)', true),
  ('plugin_data.csf_refresh_sheet_source_evidence(uuid, uuid, uuid, uuid, bigint, text, text, timestamptz, text, boolean, text, text)', true),
  -- The uploaded-workbook receipt issuer, reachable for exactly the same reason
  -- the Google refresh is: the server action calls one or the other before every
  -- claim. It performs no provider call, so reachability grants a service caller
  -- nothing beyond a receipt for state already in the database.
  ('plugin_data.csf_issue_uploaded_source_evidence(uuid, uuid, uuid, uuid)', true),
  ('plugin_data.csf_consume_sheet_source_evidence(uuid, uuid, uuid, uuid, uuid)', false),
  ('plugin_data.csf_purge_recovery_foundations(uuid)', true);

-- Every intended signature resolves. A renamed or re-signatured function fails here
-- rather than silently dropping out of every set comparison below.
SELECT extensions.lives_ok(
  $$SELECT signature::regprocedure FROM csf_intended_import_acl$$,
  'every function the privilege contract names actually exists with that exact signature'
);

-- The inventory is exhaustive: no non-trigger 01004 function is missing from the
-- contract, and the contract names nothing that is not there.
SELECT extensions.is(
  (
    SELECT count(*)::integer FROM (
      SELECT proc.oid::regprocedure::text AS signature
      FROM pg_catalog.pg_proc AS proc
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
      WHERE namespace.nspname = 'plugin_data'
        AND proc.proname IN (
          SELECT split_part(split_part(signature, '(', 1), '.', 2)
          FROM csf_intended_import_acl
        )
      EXCEPT
      SELECT signature::regprocedure::text FROM csf_intended_import_acl
    ) AS unaccounted
  ),
  0,
  'no function sharing a name this migration owns is absent from the privilege contract'
);

-- service_role EXECUTE, exact in both directions.
SELECT extensions.is(
  (
    SELECT count(*)::integer FROM (
      (
        SELECT signature::regprocedure::text
        FROM csf_intended_import_acl
        WHERE service_role_execute
        EXCEPT
        SELECT acl.signature::regprocedure::text
        FROM csf_intended_import_acl AS acl
        WHERE has_function_privilege('service_role', acl.signature::regprocedure, 'EXECUTE')
      )
      UNION ALL
      (
        SELECT acl.signature::regprocedure::text
        FROM csf_intended_import_acl AS acl
        WHERE has_function_privilege('service_role', acl.signature::regprocedure, 'EXECUTE')
        EXCEPT
        SELECT signature::regprocedure::text
        FROM csf_intended_import_acl
        WHERE service_role_execute
      )
    ) AS divergent
  ),
  0,
  'the service_role EXECUTE set matches the contract exactly, with nothing missing and nothing extra'
);

-- No client role holds EXECUTE anywhere in the inventory, including on the trigger
-- functions and the internal helpers.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM csf_intended_import_acl AS acl
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('public')) AS client(role_name)
    WHERE has_function_privilege(client.role_name, acl.signature::regprocedure, 'EXECUTE')
  ),
  0,
  'no client role holds EXECUTE on any function this migration owns'
);

-- Search path, compared against the representation PostgreSQL actually stores.
--
-- `SET search_path = ''` lands in `pg_proc.proconfig` as `search_path=""`: search_path is
-- a GUC_LIST_QUOTE setting, so the empty element is serialized quoted. Comparing against
-- `ARRAY['search_path=']` therefore never matched anything and the assertion would have
-- failed for every function in the inventory. The predicate below reads the entry and
-- checks that its value is empty once unquoted, so it accepts either representation and
-- still rejects a non-empty search_path -- rather than being weakened to "mentions
-- search_path somewhere".
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM csf_intended_import_acl AS acl
    JOIN pg_catalog.pg_proc AS proc ON proc.oid = acl.signature::regprocedure
    WHERE NOT EXISTS (
      SELECT 1
      FROM unnest(coalesce(proc.proconfig, ARRAY[]::text[])) AS entry
      WHERE split_part(entry, '=', 1) = 'search_path'
        AND btrim(substring(entry FROM position('=' IN entry) + 1), '"') = ''
    )
  ),
  0,
  'every function this migration owns pins an empty search_path'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM csf_intended_import_acl AS acl
    JOIN pg_catalog.pg_proc AS proc ON proc.oid = acl.signature::regprocedure
    WHERE cardinality(coalesce(proc.proconfig, ARRAY[]::text[]))
          <> CASE
               WHEN acl.signature = 'plugin_data.csf_js_number_text(double precision)'
                 THEN 2
               ELSE 1
             END
      OR (
        acl.signature = 'plugin_data.csf_js_number_text(double precision)'
        AND NOT ('extra_float_digits=1' = ANY (coalesce(proc.proconfig, ARRAY[]::text[])))
      )
  ),
  0,
  'only canonical number rendering pins the required extra_float_digits setting'
);

-- Ownership, scoped to the exact 01004 inventory and named rather than merely uniform.
--
-- The previous query scanned every `plugin_data.csf_%` function and asserted they all
-- happened to share one owner: it could fail because an unrelated CSF function from
-- another migration belongs to a different role, and it would have passed if every
-- function here were uniformly owned by the *wrong* role. Every SECURITY DEFINER function
-- in this inventory executes as its owner, so the owner has to be the trusted migration
-- owner specifically.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM csf_intended_import_acl AS acl
    JOIN pg_catalog.pg_proc AS proc ON proc.oid = acl.signature::regprocedure
    WHERE proc.proowner <> (
      SELECT owner.oid FROM pg_catalog.pg_roles AS owner
      WHERE owner.rolname = (
        SELECT schema_owner.rolname
        FROM pg_catalog.pg_namespace AS namespace
        JOIN pg_catalog.pg_roles AS schema_owner ON schema_owner.oid = namespace.nspowner
        WHERE namespace.nspname = 'plugin_data'
      )
    )
  ),
  0,
  'every function this migration owns belongs to the plugin_data schema owner, not merely to one shared role'
);

-- ---------------------------------------------------------------------------
-- Pre-ledger history is marked unknown, never given fabricated provenance.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.import_status = 'pending'
      AND import_row.commit_attempt_id IS NOT NULL
  ),
  'no pending row carries fabricated attempt lineage'
);

-- A frozen decision, or an explicit officer acceptance of pre-ledger history. There
-- is no third way for a row to be recorded as succeeded.
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_sheet_import_rows
    WHERE commit_outcome_state = 'succeeded'
      AND commit_frozen_at IS NULL
      AND commit_outcome_resolution IS NULL
  ),
  'nothing is recorded as succeeded without a frozen decision or an explicit acceptance'
);

SELECT extensions.ok(
  (
    SELECT bool_and(commit_outcome_unresolved)
    FROM plugin_data.csf_sheet_import_rows
    WHERE commit_outcome_state IN ('unknown', 'historical_unknown')
  ) IS NOT FALSE,
  'the unresolved flag and the outcome state can never disagree'
);

-- A pre-ledger row can only leave `historical_unknown` through its own narrow,
-- audited RPC, and only with an explicit decision and a named officer.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, sheet_tab_name, row_number,
  import_status, row_hash, commit_outcome_state, commit_outcome_unresolved,
  commit_outcome_code, commit_outcome_note
) VALUES (
  'df500000-0000-4000-8000-000000000009',
  'df100000-0000-4000-8000-000000000001',
  'df300000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000007',
  'df150000-0000-4000-8000-000000000001',
  'Roster', 99,
  'updated', repeat('e', 64), 'historical_unknown', true,
  'pre_ledger_commit', 'This row was imported before commit attempts were recorded.'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_reconcile_import_row_outcome(
      'df100000-0000-4000-8000-000000000001',
      'df500000-0000-4000-8000-000000000009',
      'df000000-0000-4000-8000-000000000001', 'accepted_as_written',
      gen_random_uuid(), 'officer_reconciled', NULL
    ) ->> 'reason'
  ),
  'not_unknown',
  'the live reconciliation path refuses a pre-ledger row, which has no correlation'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_accept_historical_import_outcome(
      'df100000-0000-4000-8000-000000000001',
      'df500000-0000-4000-8000-000000000009',
      NULL, 'historical_accepted'
    )
  $$,
  '23502',
  NULL,
  'accepting a pre-ledger outcome without an officer is refused'
);

-- The contradictory decision is not refused at runtime -- it cannot be expressed. The
-- signature offers no decision at all, because only one is coherent: the row's status
-- already records a written member, so relabelling it as never written would be a
-- durable claim that the record both exists and was never made.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'plugin_data'
      AND proc.proname = 'csf_accept_historical_import_outcome'
      AND oidvectortypes(proc.proargtypes) = 'uuid, uuid, uuid, text'
  ),
  1,
  'historical acceptance takes no decision argument, so the contradiction is unreachable'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_accept_historical_import_outcome(
      'df100000-0000-4000-8000-000000000001',
      'df500000-0000-4000-8000-000000000009',
      'df000000-0000-4000-8000-000000000001',
      'historical_accepted'
    ) ->> 'outcomeState'
  ),
  'succeeded',
  'a pre-ledger outcome is acknowledged through its own audited RPC'
);

SELECT extensions.ok(
  (
    SELECT NOT commit_outcome_unresolved
      AND commit_outcome_resolution = 'historical_accepted'
      AND commit_outcome_resolved_by = 'df000000-0000-4000-8000-000000000001'
      -- Coherent: the outcome and the status agree that a record exists.
      AND import_status IN ('created', 'updated')
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'df500000-0000-4000-8000-000000000009'
  ),
  'acknowledging pre-ledger history records the officer and leaves every dimension coherent'
);

-- The contradiction is refused by the table itself, not only by the RPC that avoids it.
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET commit_outcome_state = 'failed'
    WHERE id = 'df500000-0000-4000-8000-000000000009'
  $$,
  '55000',
  NULL,
  'a pre-ledger row cannot be moved to failed while its status records a written member'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_rows (
      organization_id, job_id, source_id, cohort_id, sheet_tab_name, row_number,
      import_status, row_hash, commit_outcome_state
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df150000-0000-4000-8000-000000000001',
      'Roster', 97,
      'created', repeat('7', 64), 'failed'
    )
  $$,
  '23514',
  NULL,
  'no row may ever record a failed outcome beside a created or updated status'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_rows (
      organization_id, job_id, source_id, cohort_id, sheet_tab_name, row_number,
      import_status, row_hash, commit_outcome_state
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df150000-0000-4000-8000-000000000001',
      'Roster', 96,
      'pending', repeat('8', 64), 'succeeded'
    )
  $$,
  '23514',
  NULL,
  'no row may ever record a succeeded outcome beside a pending status'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
    WHERE action = 'sheet_import.historical_outcome_accepted'
  ),
  1,
  'accepting pre-ledger history appends exactly one auditable event'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    WHERE attempt.actor_snapshot ? 'firstName'
      OR attempt.actor_snapshot ? 'lastName'
      OR attempt.actor_snapshot ? 'email'
  ),
  'an attempt actor snapshot carries identifiers, never student or officer identity fields'
);

-- ---------------------------------------------------------------------------
-- Obsolete draft overloads: absent, and only the canonical signatures granted.
-- ---------------------------------------------------------------------------

-- An old three-argument retire beside the canonical four-argument-with-default makes
-- every existing three-argument call ambiguous rather than merely untidy, and the
-- unsafe sixteen-argument wrapper carried its own service_role grant.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    JOIN (VALUES
      ('csf_retire_staging_object', ARRAY['uuid','uuid','text']),
      ('csf_fail_import_row_for_attempt', ARRAY['uuid','uuid','uuid','text']),
      ('csf_abort_import_commit_attempt', ARRAY['uuid','uuid','text']),
      ('csf_flag_import_row_outcome_unknown', ARRAY['uuid','uuid','uuid','text']),
      ('csf_reconcile_import_row_outcome', ARRAY['uuid','uuid','uuid','text']),
      ('csf_accept_historical_import_outcome', ARRAY['uuid','uuid','uuid','text','text']),
      ('csf_commit_import_row_for_attempt', ARRAY[
        'uuid','uuid','uuid','uuid',
        'text','text','text','text','text','text','text','text',
        'jsonb','jsonb','jsonb','boolean'
      ]),
      ('csf_open_csf_import_staging_object',
        ARRAY['uuid','uuid','text','text','text','bigint','integer']),
      ('csf_consume_csf_import_staging_object', ARRAY['uuid','uuid','text'])
    ) AS draft(proname, arg_types)
      ON draft.proname = proc.proname
    WHERE namespace.nspname = 'plugin_data'
      -- Structural, not textual. `pg_get_function_identity_arguments` renders the
      -- declared parameter *names* alongside the types, so a comparison against bare
      -- type strings never matched a named function -- which is exactly how the repair
      -- block came to classify every canonical function as obsolete.
      AND proc.pronargs = cardinality(draft.arg_types)
      AND proc.proargmodes IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(draft.arg_types) WITH ORDINALITY AS expected(type_name, position)
        WHERE proc.proargtypes[expected.position - 1]
          IS DISTINCT FROM expected.type_name::regtype::oid
      )
  ),
  0,
  'every obsolete draft overload is absent, compared on catalog structure'
);

-- The defect itself, demonstrated rather than described: the text the old repair block
-- compared carries parameter names, so it could never equal a bare type list.
SELECT extensions.isnt(
  pg_get_function_identity_arguments(
    'plugin_data.csf_retire_staging_object(uuid, uuid, uuid, text, integer)'::regprocedure
  ),
  'uuid, uuid, uuid, text, integer',
  'identity-argument text embeds parameter names, so comparing it to bare types misclassifies every named function'
);

SELECT extensions.is(
  pg_catalog.oidvectortypes(
    (SELECT proargtypes FROM pg_catalog.pg_proc
     WHERE oid = 'plugin_data.csf_retire_staging_object(uuid, uuid, uuid, text, integer)'::regprocedure)
  ),
  'uuid, uuid, uuid, text, integer',
  'the type vector alone is name-independent, which is what identity is now compared on'
);

-- The closest executable upgrade-path fixture this harness allows: introduce a *named*
-- historical draft overload beside the canonical function, then run the migration's own
-- classification against both. A post-migration count alone could not distinguish "the
-- sweep worked" from "there was never anything to sweep".
CREATE FUNCTION plugin_data.csf_retire_staging_object(
  p_organization_id uuid,
  p_staging_object_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE sql
SET search_path = ''
AS $draft_fixture$ SELECT '{}'::jsonb $draft_fixture$;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'plugin_data'
      AND proc.proname = 'csf_retire_staging_object'
  ),
  2,
  'a named historical draft overload can coexist with the canonical function'
);

-- Canonical recognition: exactly one of the two matches the canonical contract, and it
-- is the FIVE-argument one -- (organization, actor, staging object, reason, expected
-- generation) -- identified without reference to any parameter name. This fixture
-- described a four-argument canonical shape that has not existed since the acting
-- officer became an argument, so it was asserting a count of one against a contract
-- nothing in the migration matches.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'plugin_data'
      AND proc.proname = 'csf_retire_staging_object'
      AND proc.prokind = 'f'
      AND proc.proargmodes IS NULL
      AND proc.pronargs = 5
      AND proc.prorettype = 'jsonb'::regtype::oid
      AND proc.proargtypes[0] = 'uuid'::regtype::oid
      AND proc.proargtypes[1] = 'uuid'::regtype::oid
      AND proc.proargtypes[2] = 'uuid'::regtype::oid
      AND proc.proargtypes[3] = 'text'::regtype::oid
      AND proc.proargtypes[4] = 'integer'::regtype::oid
  ),
  1,
  'the canonical named function is recognized by its exact structural contract'
);

-- Draft recognition: the three-argument shape is classified as the allowlisted draft,
-- so the repair block would drop that one and only that one.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'plugin_data'
      AND proc.proname = 'csf_retire_staging_object'
      AND proc.prokind = 'f'
      AND proc.proargmodes IS NULL
      AND proc.pronargs = 3
      AND proc.proargtypes[0] = 'uuid'::regtype::oid
      AND proc.proargtypes[1] = 'uuid'::regtype::oid
      AND proc.proargtypes[2] = 'text'::regtype::oid
  ),
  1,
  'the named historical draft is recognized as the allowlisted draft shape'
);

-- And an overload that is neither canonical nor allowlisted is classified as neither, so
-- the repair block raises on it instead of dropping something it cannot identify.
CREATE FUNCTION plugin_data.csf_retire_staging_object(p_only uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path = ''
AS $unknown_fixture$ SELECT '{}'::jsonb $unknown_fixture$;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'plugin_data'
      AND proc.proname = 'csf_retire_staging_object'
      -- Neither the canonical five-argument contract nor the allowlisted three.
      AND proc.pronargs NOT IN (3, 5)
  ),
  1,
  'an unrecognized same-name overload is classified as neither canonical nor a known draft'
);

DROP FUNCTION plugin_data.csf_retire_staging_object(uuid);
DROP FUNCTION plugin_data.csf_retire_staging_object(uuid, uuid, text);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'plugin_data'
      AND proc.proname = 'csf_retire_staging_object'
  ),
  1,
  'the fixture leaves only the canonical function behind'
);

-- Exactly one overload of each name this migration owns, so no call can be ambiguous.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM (
      SELECT proc.proname
      FROM pg_proc AS proc
      JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
      WHERE namespace.nspname = 'plugin_data'
        AND proc.proname IN (
          'csf_retire_staging_object', 'csf_open_staging_object',
          'csf_finalize_staging_object', 'csf_claim_staging_object',
          'csf_release_staging_claim', 'csf_sweep_staging_objects',
          'csf_commit_import_row_for_attempt', 'csf_fail_import_row_for_attempt',
          'csf_flag_import_row_outcome_unknown', 'csf_reconcile_import_row_outcome',
          'csf_accept_historical_import_outcome', 'csf_abort_import_commit_attempt',
          'csf_recover_stale_import_intents', 'csf_settle_failed_import_row'
        )
      GROUP BY proc.proname
      HAVING count(*) > 1
    ) AS ambiguous
  ),
  0,
  'no CSF import function name carries more than one overload'
);

SELECT extensions.ok(
  (
    SELECT bool_and(has_function_privilege('service_role', proc.oid, 'EXECUTE'))
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'plugin_data'
      AND proc.proname IN (
        'csf_recover_stale_import_intents',
        'csf_settle_failed_import_row'
      )
  ),
  'the new recovery RPCs carry the intended service-role EXECUTE grant'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_retire_expired_staging_objects(integer)',
    'EXECUTE'
  ),
  'the crash-durable retirement helper stays internal to the sweeper'
);

-- ---------------------------------------------------------------------------
-- Legacy reconciliation racing a frozen decision.
-- ---------------------------------------------------------------------------

-- Row 2 of the roster preview is frozen and still pending. The pre-existing
-- reconciliation RPC in an older migration knows nothing about that freeze, and
-- skipping the row would drop it from the commit worklist while letting finalize report
-- the logical commit complete without it.
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET import_status = 'skipped',
        resolution_status = 'ignored',
        resolution_reason_code = 'officer_skipped',
        resolved_by = 'df000000-0000-4000-8000-000000000002',
        resolved_at = now()
    WHERE id = 'df500000-0000-4000-8000-000000000002'
  $$,
  '55000',
  NULL,
  'a frozen row cannot be skipped out from under an outstanding commit'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET import_status = 'ambiguous'
    WHERE id = 'df500000-0000-4000-8000-000000000002'
  $$,
  '55000',
  NULL,
  'a frozen row cannot be pushed back into an unreconciled status'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET matched_profile_id = 'df600000-0000-4000-8000-000000000001'
    WHERE id = 'df500000-0000-4000-8000-000000000002'
  $$,
  '55000',
  NULL,
  'a frozen row cannot be re-aimed at another member by a racing reconciliation'
);

SELECT extensions.is(
  (SELECT import_status FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'df500000-0000-4000-8000-000000000002'),
  'pending',
  'the frozen row is left exactly as the reviewed decision described it'
);

-- ---------------------------------------------------------------------------
-- A stale write intent, recovered exactly once, opening no successor writer.
-- ---------------------------------------------------------------------------

-- The application attempt still owns an in-flight row and its lease has already been
-- expired earlier in this file, so it is the crash case: abort refuses ownership, the
-- unknown-outcome RPC needs the active attempt, and reconciliation only accepts
-- `unknown`. Before this transition existed, nothing could act on it at all.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_recover_stale_import_intents(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000002',
      'df000000-0000-4000-8000-000000000001',
      'intent_stale_after_lease_expiry'
    ) ->> 'promotedRows'
  ),
  '1',
  'a stale in-flight intent is promoted to unknown'
);

SELECT extensions.ok(
  (
    SELECT commit_outcome_state = 'unknown'
      AND commit_outcome_unresolved
      AND commit_outcome_code = 'intent_stale_after_lease_expiry'
      -- The intent's own correlation, so the officer reconciles this exact attempt.
      AND commit_outcome_correlation_id = commit_intent_correlation_id
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'df500000-0000-4000-8000-000000000003'
  ),
  'the promoted row is review-blocked and names the attempt that started it'
);

SELECT extensions.is(
  (
    SELECT attempt.status FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    JOIN plugin_data.csf_sheet_import_jobs AS commit_job
      ON commit_job.id = attempt.commit_job_id
    WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000002'
  ),
  'superseded',
  'the dead attempt is superseded rather than left describing a writer that is gone'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    JOIN plugin_data.csf_sheet_import_jobs AS commit_job
      ON commit_job.id = attempt.commit_job_id
    WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000002'
  ),
  1,
  'recovering a stale intent opens no successor writer'
);

-- Exactly once. A second run finds nothing to promote.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_recover_stale_import_intents(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000002',
      'df000000-0000-4000-8000-000000000001',
      'intent_stale_after_lease_expiry'
    ) ->> 'promotedRows'
  ),
  '0',
  'recovering a stale intent twice promotes nothing the second time'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
    WHERE action = 'sheet_import.stale_intent_recovered'
  ),
  1,
  'stale-intent recovery appends exactly one auditable event'
);

-- And the commit stays blocked: recovery does not re-open it.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_claim_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000002',
      'df000000-0000-4000-8000-000000000001', 300,
      (plugin_data.csf_refresh_sheet_source_evidence(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        'df200000-0000-4000-8000-000000000002',
        'df300000-0000-4000-8000-000000000002',
        (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
          WHERE id = 'df200000-0000-4000-8000-000000000002'),
        'synthetic-application-file', 'application/vnd.google-apps.spreadsheet',
        '2026-07-01T00:00:00Z', '41', false, 'accessible', 'Synthetic applications'
       ) ->> 'evidenceToken')::uuid
    )
  $$,
  '23514',
  NULL,
  'a recovered but unreconciled row still blocks the next commit attempt'
);

-- There has to be a commit to recover in the first place.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_recover_stale_import_intents(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000003',
      'df000000-0000-4000-8000-000000000001',
      'intent_stale_after_lease_expiry'
    )
  $$,
  '23503',
  NULL,
  'recovery refuses a preview whose commit does not exist'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_recover_stale_import_intents(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000002',
      NULL,
      'intent_stale_after_lease_expiry'
    )
  $$,
  '23502',
  NULL,
  'recovering a stale intent without an acting officer is refused'
);

-- ---------------------------------------------------------------------------
-- A deterministically failed row, retried and terminally skipped.
-- ---------------------------------------------------------------------------

-- Row 1 was reconciled to `failed` with `error` status earlier in this file, but it has
-- no attempt lineage, so it is not the deterministic-failure shape this path decides.
-- Row 1 reached `failed`/`error` through reconciliation, so it has no attempt lineage --
-- no attempt wrote it, which is the whole finding. It must still be decidable.
--
-- Requiring lineage here left it with no retry, no skip, hidden from the recovery
-- projection, excluded from the commit worklist, and counted as unresolved by finalize
-- forever, while the officer copy promised a retry that could not be reached.
SELECT extensions.is(
  (SELECT commit_attempt_id FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'df500000-0000-4000-8000-000000000001'),
  NULL,
  'a reconciled not-written row carries no attempt lineage, because no attempt wrote it'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_settle_failed_import_row(
      'df100000-0000-4000-8000-000000000001',
      'df500000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001', 'retry', 'officer_requested_retry'
    ) ->> 'importStatus'
  ),
  'pending',
  'a reconciled not-written row is reachable for retry'
);

SELECT extensions.ok(
  (
    SELECT commit_outcome_state = 'frozen'
      AND import_status = 'pending'
      AND commit_retry_count = 1
      -- Nothing to name, and nothing invented to name.
      AND commit_last_failed_attempt_id IS NULL
      AND commit_outcome_resolution IS NULL
      AND commit_frozen_at IS NOT NULL
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'df500000-0000-4000-8000-000000000001'
  ),
  'retrying a reconciled row restores the frozen decision without fabricating lineage'
);

-- The reconciliation it superseded stays reconstructible from the append-only ledger.
SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'df500000-0000-4000-8000-000000000001'
      AND action = 'sheet_import.outcome_reconciled'
  ),
  1,
  'the superseded reconciliation remains in the audit ledger'
);

SELECT extensions.is(
  (
    SELECT after_data ->> 'priorResolution' FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'df500000-0000-4000-8000-000000000001'
      AND action = 'sheet_import.failed_row_settled'
  ),
  'accepted_as_not_written',
  'and the settlement event records the decision it superseded'
);

-- And a retried row is not re-openable by a worker that no longer owns the commit.
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_fail_import_row_for_attempt(
        'df100000-0000-4000-8000-000000000001', %L,
        'df500000-0000-4000-8000-000000000001', 'row_commit_failed', NULL, true)$$,
    (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
     JOIN plugin_data.csf_sheet_import_jobs AS commit_job
       ON commit_job.id = attempt.commit_job_id
     WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
       AND attempt.attempt_number = 1)
  ),
  '55P03',
  NULL,
  'a superseded attempt cannot re-fail the retried row'
);

-- The real shape uses the roster preview's remaining frozen row, which is exactly what
-- a deterministic failure happens to: a row an officer reviewed, frozen at the first
-- claim, that a later attempt could not write. Inventing a fresh unfrozen row would not
-- reach this path at all -- the takeover drift check refuses a pending row that no claim
-- ever froze, which is the protection working, not a fixture problem.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_claim_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001', 300,
      (plugin_data.csf_issue_uploaded_source_evidence(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        'df200000-0000-4000-8000-000000000007',
        'df300000-0000-4000-8000-000000000001'
       ) ->> 'evidenceToken')::uuid
    )
  $$,
  'a further attempt may be claimed once nothing is unsettled'
);

SELECT extensions.lives_ok(
  format(
    $$SELECT plugin_data.csf_begin_import_row_for_attempt(
        'df100000-0000-4000-8000-000000000001', %L,
        'df500000-0000-4000-8000-000000000002')$$,
    (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
     JOIN plugin_data.csf_sheet_import_jobs AS commit_job
       ON commit_job.id = attempt.commit_job_id
     WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
       AND attempt.status = 'running')
  ),
  'the new attempt may start a write intent for the frozen row'
);

-- A live owner is not a crash. Its rows are not taken from it, because it may still
-- report the outcome itself -- and stealing them is the exact race the fence exists to
-- prevent.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_recover_stale_import_intents(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'intent_stale_after_lease_expiry'
    )
  $$,
  '55P03',
  NULL,
  'recovery refuses to take an in-flight row from an attempt that still holds its lease'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_fail_import_row_for_attempt(
      'df100000-0000-4000-8000-000000000001',
      (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
       JOIN plugin_data.csf_sheet_import_jobs AS commit_job
         ON commit_job.id = attempt.commit_job_id
       WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
         AND attempt.status = 'running'),
      'df500000-0000-4000-8000-000000000002',
      'row_commit_failed', 'The class was closed', true
    ) ->> 'outcomeState'
  ),
  'failed',
  'a structured database error settles the row as a deterministic failure'
);

-- A decision is refused while a writer still holds the fence.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_settle_failed_import_row(
      'df100000-0000-4000-8000-000000000001',
      'df500000-0000-4000-8000-000000000002',
      'df000000-0000-4000-8000-000000000001', 'retry', 'officer_requested_retry'
    )
  $$,
  '55P03',
  NULL,
  'a failed row cannot be released back into a worklist a live attempt is paging'
);

-- Finish the attempt, then retry the row.
SELECT extensions.lives_ok(
  format(
    $$SELECT plugin_data.csf_finalize_import_commit_attempt(
        'df100000-0000-4000-8000-000000000001', %L, '{}'::jsonb)$$,
    (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
     JOIN plugin_data.csf_sheet_import_jobs AS commit_job
       ON commit_job.id = attempt.commit_job_id
     WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000001'
       AND attempt.status = 'running')
  ),
  'the attempt that failed the row may finalize'
);

-- A row cannot be reset by anything but the fenced settlement transition. Test
-- this while it is actually failed; after the legitimate retry below, assigning
-- `pending` / `frozen` again would be a no-op and could not prove the guard.
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET import_status = 'pending', commit_outcome_state = 'frozen'
    WHERE id = 'df500000-0000-4000-8000-000000000002'
  $$,
  '55000',
  NULL,
  'a failed row cannot be reopened without recording the attempt it is releasing'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_settle_failed_import_row(
      'df100000-0000-4000-8000-000000000001',
      'df500000-0000-4000-8000-000000000002',
      'df000000-0000-4000-8000-000000000001', 'retry', 'officer_requested_retry'
    ) ->> 'importStatus'
  ),
  'pending',
  'a deterministically failed row can be explicitly retried'
);

SELECT extensions.ok(
  (
    SELECT commit_outcome_state = 'frozen'
      AND import_status = 'pending'
      AND commit_attempt_id IS NULL
      AND commit_retry_count = 1
      -- The attempt that failed is still nameable. That is the immutable evidence.
      AND commit_last_failed_attempt_id IS NOT NULL
      -- And the reviewed decision itself was never re-opened.
      AND commit_frozen_at IS NOT NULL
      AND commit_frozen_row_hash = row_hash
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'df500000-0000-4000-8000-000000000002'
  ),
  'a retry releases the row without erasing the attempt that failed or the frozen decision'
);

SELECT extensions.is(
  (
    SELECT attempt.status FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    WHERE attempt.id = (
      SELECT commit_last_failed_attempt_id FROM plugin_data.csf_sheet_import_rows
      WHERE id = 'df500000-0000-4000-8000-000000000002'
    )
  ),
  'failed',
  'the failed attempt keeps its own terminal record after the retry'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
    WHERE action = 'sheet_import.failed_row_settled'
      AND target_id = 'df500000-0000-4000-8000-000000000002'
  ),
  1,
  'settling a failed row appends exactly one auditable event'
);

-- ---------------------------------------------------------------------------
-- A crashed preview retires its raw workbook; a live reader does not lose it.
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider, settings
) VALUES (
  'df200000-0000-4000-8000-000000000005',
  'df100000-0000-4000-8000-000000000001',
  'student_roster',
  'Synthetic crashed-preview roster',
  'df150000-0000-4000-8000-000000000001',
  'uploaded_xlsx',
  jsonb_build_object(
    'sourceKind', 'student_roster',
    'contentHash', repeat('b', 64)
  )
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_open_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000005',
      'csf-private', 'xlsx', repeat('b', 64), 8192, 3600
    )
  $$,
  'a workbook may be staged for the crashed-preview fixture'
);

SELECT extensions.isnt(
  (
    SELECT plugin_data.csf_finalize_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_staging_objects
       WHERE source_id = 'df200000-0000-4000-8000-000000000005')
    ) ->> 'readyExpiresAt'
  ),
  NULL,
  'promoting a workbook to readable always states when it stops being readable'
);

-- A preview claims the source's published attachment, not an ambient ready row.
-- Publish the finalized generation as fixture setup without changing the pgTAP
-- plan; the attachment lifecycle itself has its dedicated assertions below.
DO $attach_crashed_preview_generation$
DECLARE
  v_staging_object_id uuid;
BEGIN
  SELECT id INTO STRICT v_staging_object_id
  FROM plugin_data.csf_sheet_import_staging_objects
  WHERE source_id = 'df200000-0000-4000-8000-000000000005'
    AND generation = 1;

  PERFORM plugin_data.csf_attach_sheet_source_generation(
    'df100000-0000-4000-8000-000000000001',
    'df000000-0000-4000-8000-000000000001',
    'df200000-0000-4000-8000-000000000005',
    v_staging_object_id,
    1,
    repeat('b', 64),
    NULL,
    1
  );
END;
$attach_crashed_preview_generation$;

-- A live claim, exactly as a preview in progress holds one.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_claim_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000005',
      'df000000-0000-4000-8000-000000000001', 900
    )
  $$,
  'a preview claims the crashed-preview workbook'
);

-- Now the process dies: no release, no retire request, nothing runs a `finally`. Force
-- the deadline past and let the sweeper act on its own.
UPDATE plugin_data.csf_sheet_import_staging_objects
SET ready_expires_at = now() - interval '1 minute'
WHERE source_id = 'df200000-0000-4000-8000-000000000005';

SELECT extensions.is(
  (SELECT plugin_data.csf_sweep_staging_objects(100) ->> 'readyDeadlinesPassed'),
  '1',
  'the sweeper retires a readable workbook nobody came back for'
);

-- The claim is still live, so the bytes are not queued out from under the reader.
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_sheet_import_staging_objects
   WHERE source_id = 'df200000-0000-4000-8000-000000000005'),
  'retire_pending',
  'a live concurrent claim prevents premature deletion of the raw workbook'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_storage_deletion_queue AS queued
    JOIN plugin_data.csf_sheet_import_staging_objects AS staging
      ON staging.bucket = queued.bucket AND staging.object_path = queued.object_path
    WHERE staging.source_id = 'df200000-0000-4000-8000-000000000005'
  ),
  0,
  'nothing is queued for deletion while the crashed preview still holds its claim'
);

-- The claim lease lapses. Now the sweep completes without any cooperation at all.
UPDATE plugin_data.csf_sheet_import_staging_claims AS claim
SET lease_expires_at = now() - interval '1 minute'
WHERE claim.staging_object_id = (
  SELECT id FROM plugin_data.csf_sheet_import_staging_objects
  WHERE source_id = 'df200000-0000-4000-8000-000000000005'
);

SELECT extensions.isnt(
  (SELECT plugin_data.csf_sweep_staging_objects(100) ->> 'settledRetirements'),
  '0',
  'once the crashed preview''s claim expires the retirement settles itself'
);

SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_sheet_import_staging_objects
   WHERE source_id = 'df200000-0000-4000-8000-000000000005'),
  'tombstoned',
  'the exact original workbook becomes a tombstone after its path enters the deletion outbox'
);

SELECT extensions.is(
  (SELECT uploaded_file_path FROM plugin_data.csf_sheet_sources
   WHERE id = 'df200000-0000-4000-8000-000000000005'),
  NULL,
  'and the source stops advertising a workbook that is being deleted'
);

-- No raw workbook content, discarded field, or public link reaches an audit row.
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE action LIKE 'sheet_import.%'
      AND (
        after_data::text LIKE '%objectPath%'
        OR after_data::text LIKE '%contentHash%'
        OR after_data::text LIKE '%https://%'
        OR plugin_data.csf_jsonb_carries_raw_content(after_data)
      )
  ),
  'no import audit event carries a storage path, a digest, a link, or raw content'
);

-- ---------------------------------------------------------------------------
-- Staging release locks source, then object, then claim.
-- ---------------------------------------------------------------------------

-- Asserted against the statements that actually take locks. The previous shape locked
-- the source and then the claim, reaching the object only indirectly through the
-- retirement helper -- so the object lock was really taken *after* the claim lock,
-- inverting the order the sweeper uses.
-- Anchored to the locking statements themselves.
--
-- The previous assertion keyed off the first textual mention of each table, which in this
-- body is the *unlocked* join that resolves the claim token into its outer identifiers --
-- so it would have passed whatever order the real locks were taken in. It also counted
-- occurrences of the words `FOR UPDATE` anywhere in the body, including ones belonging to
-- unrelated statements. Each lock is now located by the exact statement that takes it.
SELECT extensions.ok(
  (
    SELECT
      locks.source_lock > 0
      AND locks.object_lock > locks.source_lock
      AND locks.claim_lock > locks.object_lock
    FROM (
      SELECT
        position(
          'PERFORM 1' || chr(10) ||
          '  FROM plugin_data.csf_sheet_sources AS source' in body.definition
        ) AS source_lock,
        position(
          'SELECT * INTO v_staging' || chr(10) ||
          '  FROM plugin_data.csf_sheet_import_staging_objects AS staging' in body.definition
        ) AS object_lock,
        position(
          'SELECT * INTO v_claim' || chr(10) ||
          '  FROM plugin_data.csf_sheet_import_staging_claims AS claim' in body.definition
        ) AS claim_lock
      FROM (
        -- Release plus the retirement primitive it delegates to. The object lock
        -- moved into the internal helper when retirement was split, so reading
        -- release alone would assert against half the path and pass vacuously.
        SELECT pg_get_functiondef(
          'plugin_data.csf_release_staging_claim(uuid, uuid, uuid, text, boolean)'::regprocedure
        ) || pg_get_functiondef(
          'plugin_data.csf_retire_staging_object_internal(uuid, uuid, text, integer, uuid)'::regprocedure
        ) AS definition
      ) AS body
    ) AS locks
  ),
  'releasing a staging claim locks the source, then the object, then the claim'
);

-- The sweeper path, which the earlier assertion never covered at all. Its expired-claim
-- loop used to update the claim and only then reach the object inside
-- `csf_settle_staging_retirement`, giving source -> claim -> object: the opposite inner
-- order to release, while the migration documented one global order.
SELECT extensions.ok(
  (
    SELECT
      locks.source_lock > 0
      AND locks.object_lock > locks.source_lock
      AND locks.claim_update > locks.object_lock
    FROM (
      SELECT
        position('FOR UPDATE OF source SKIP LOCKED' in body.expired_loop) AS source_lock,
        position(
          'PERFORM 1' || chr(10) ||
          '    FROM plugin_data.csf_sheet_import_staging_objects AS staging' in body.expired_loop
        ) AS object_lock,
        position(
          'UPDATE plugin_data.csf_sheet_import_staging_claims' in body.expired_loop
        ) AS claim_update
      FROM (
        SELECT substring(
          pg_get_functiondef(
            'plugin_data.csf_sweep_staging_objects(integer)'::regprocedure
          )
          FROM position(
            'Expired claims stop counting as live readers' in pg_get_functiondef(
              'plugin_data.csf_sweep_staging_objects(integer)'::regprocedure
            )
          )
        ) AS expired_loop
      ) AS body
    ) AS locks
  ),
  'the expired-claim sweep locks the source, then the object, then writes the claim'
);

-- ---------------------------------------------------------------------------
-- Terminal skip -> finalize -> completed, end to end.
--
-- The server action always had a finalize-only path, but nothing could reach it: the
-- workspace treated a `partially_completed` commit with zero pending rows as already
-- imported, and "No ready rows remain" was an unconditional readiness blocker. So the
-- last terminally-skipped row left a logical commit permanently unfinishable. This uses
-- its own single-row preview, because a preview whose stored row count no longer matches
-- its snapshot can never reach `completed` for an unrelated reason.
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  drive_access_state, drive_trashed, drive_file_id, drive_file_name,
  drive_mime_type, drive_modified_at, settings
) VALUES (
  'df200000-0000-4000-8000-000000000006',
  'df100000-0000-4000-8000-000000000001',
  'student_roster',
  'Synthetic finalize-only roster',
  'df150000-0000-4000-8000-000000000001',
  'google_sheets',
  'accessible', false, 'synthetic-finalize-file', 'Synthetic finalize roster',
  'application/vnd.google-apps.spreadsheet', '2026-07-03T00:00:00Z',
  -- The server-issued provider version this source was last refreshed at, equal
  -- to what the preview below froze. Without it the readiness gate has no live
  -- coordinate to compare the frozen version against, which is missing evidence.
  jsonb_build_object(
    'sourceKind', 'student_roster',
    'evidenceRevision', '12'
  )
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
) VALUES (
  'df300000-0000-4000-8000-000000000006',
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000006',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster',
  'synthetic-finalize-file', 'Synthetic finalize roster', 'Roster', 'Roster!A1:C2',
  '2026-07-03T00:00:00Z',
  jsonb_build_object(
    'id', 'synthetic-finalize-file',
    'sourceProvider', 'google_sheets',
    'name', 'Synthetic finalize roster',
    'mimeType', 'application/vnd.google-apps.spreadsheet',
    'version', '12',
    'modifiedTime', '2026-07-03T00:00:00Z',
    'accessState', 'accessible', 'trashed', false
  ),
  jsonb_build_object(
    'version', 1, 'sourceType', 'student_roster',
    'sourceFileId', 'synthetic-finalize-file',
    'sourceProvider', 'google_sheets',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Roster', 'range', 'Roster!A1:C2', 'headerRow', 1)
    )
  ),
  1, repeat('7', 64), repeat('8', 64), 1, 'csf-normalized-import/v1'
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, sheet_tab_name, row_number,
  import_status, row_hash, normalized_data
) VALUES (
  'df500000-0000-4000-8000-000000000021',
  'df100000-0000-4000-8000-000000000001',
  'df300000-0000-4000-8000-000000000006',
  'df200000-0000-4000-8000-000000000006',
  'df150000-0000-4000-8000-000000000001',
  'Roster', 2, 'pending', repeat('d', 64),
  jsonb_build_object(
    'commitPayload', jsonb_build_object(
      'version', 'csf-commit-payload/v1',
      'sourceType', 'student_roster',
      'identity', jsonb_build_object(
        'firstName', 'Juniper', 'lastName', 'Vale',
        'normalizedFirstName', 'juniper', 'normalizedLastName', 'vale'
      ),
      'canonicalEmails', '{}'::jsonb
    )
  )
);

SELECT extensions.is(
  plugin_data.csf_import_preview_claim_blockers(
    'df100000-0000-4000-8000-000000000001',
    'df300000-0000-4000-8000-000000000006'
  ),
  ARRAY[]::text[],
  'the finalize-only fixture starts as a claimable preview'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_claim_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000006',
      'df000000-0000-4000-8000-000000000001', 300,
      (plugin_data.csf_refresh_sheet_source_evidence(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        'df200000-0000-4000-8000-000000000006',
        'df300000-0000-4000-8000-000000000006',
        (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
          WHERE id = 'df200000-0000-4000-8000-000000000006'),
        'synthetic-finalize-file', 'application/vnd.google-apps.spreadsheet',
        '2026-07-03T00:00:00Z', '12', false, 'accessible', 'Synthetic finalize roster'
       ) ->> 'evidenceToken')::uuid
    )
  $$,
  'the finalize-only fixture can be claimed'
);

SELECT extensions.lives_ok(
  format(
    $$SELECT plugin_data.csf_begin_import_row_for_attempt(
        'df100000-0000-4000-8000-000000000001', %L,
        'df500000-0000-4000-8000-000000000021')$$,
    (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
     JOIN plugin_data.csf_sheet_import_jobs AS commit_job
       ON commit_job.id = attempt.commit_job_id
     WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000006')
  ),
  'its only row can start a write intent'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_fail_import_row_for_attempt(
      'df100000-0000-4000-8000-000000000001',
      (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
       JOIN plugin_data.csf_sheet_import_jobs AS commit_job
         ON commit_job.id = attempt.commit_job_id
       WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000006'),
      'df500000-0000-4000-8000-000000000021',
      'row_commit_failed', NULL, true
    ) ->> 'outcomeState'
  ),
  'failed',
  'and it deterministically fails'
);

-- Finalizing now is honest: an undecided failure is still outstanding.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
       JOIN plugin_data.csf_sheet_import_jobs AS commit_job
         ON commit_job.id = attempt.commit_job_id
       WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000006'),
      '{}'::jsonb
    ) ->> 'status'
  ),
  'partially_completed',
  'an undecided failed row keeps the commit partially completed'
);

-- An unsettled failure cannot use the finalize-only path: claiming again is refused
-- while the row is still awaiting a decision only if it is unknown/in-flight, so the
-- meaningful guard here is that the row is not silently re-attempted.
SELECT extensions.is(
  (SELECT import_status FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'df500000-0000-4000-8000-000000000021'),
  'error',
  'the failed row is not quietly returned to the worklist'
);

-- Terminal skip.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_settle_failed_import_row(
      'df100000-0000-4000-8000-000000000001',
      'df500000-0000-4000-8000-000000000021',
      'df000000-0000-4000-8000-000000000001', 'skip', 'officer_skipped_failed_row'
    ) ->> 'importStatus'
  ),
  'skipped',
  'the failed row can be terminally skipped'
);

SELECT extensions.ok(
  (
    SELECT import_status = 'skipped'
      AND commit_outcome_state = 'failed'
      AND commit_outcome_resolution = 'terminally_skipped'
      AND commit_outcome_resolved_by = 'df000000-0000-4000-8000-000000000001'
      -- The attempt that failed it stays nameable.
      AND commit_last_failed_attempt_id IS NOT NULL
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'df500000-0000-4000-8000-000000000021'
  ),
  'the skip is coherent across every dimension and keeps its prior attempt lineage'
);

-- Now the finalize-only claim, which is the step nothing could previously reach.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_claim_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000006',
      'df000000-0000-4000-8000-000000000001', 300,
      (plugin_data.csf_refresh_sheet_source_evidence(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        'df200000-0000-4000-8000-000000000006',
        'df300000-0000-4000-8000-000000000006',
        (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
          WHERE id = 'df200000-0000-4000-8000-000000000006'),
        'synthetic-finalize-file', 'application/vnd.google-apps.spreadsheet',
        '2026-07-03T00:00:00Z', '12', false, 'accessible', 'Synthetic finalize roster'
       ) ->> 'evidenceToken')::uuid
    )
  $$,
  -- A finalize that writes no rows is still held to the same freshness proof:
  -- it completes a commit under this source's provenance.
  'a commit with nothing left to write can still claim a fenced attempt to finish'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      (SELECT attempt.id FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
       JOIN plugin_data.csf_sheet_import_jobs AS commit_job
         ON commit_job.id = attempt.commit_job_id
       WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000006'
         AND attempt.status = 'running'),
      '{}'::jsonb
    ) ->> 'status'
  ),
  'completed',
  'terminal skip then finalize reaches a completed logical commit'
);

SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_sheet_import_jobs
   WHERE mode = 'commit' AND preview_job_id = 'df300000-0000-4000-8000-000000000006'),
  'completed',
  'and the commit job itself records completed'
);

SELECT extensions.is(
  (SELECT import_status FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'df500000-0000-4000-8000-000000000021'),
  'skipped',
  'with the skipped row still skipped rather than rewritten by the finalize'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    JOIN plugin_data.csf_sheet_import_jobs AS commit_job
      ON commit_job.id = attempt.commit_job_id
    WHERE commit_job.preview_job_id = 'df300000-0000-4000-8000-000000000006'
  ),
  2,
  'and both attempts survive as immutable audit lineage'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
    WHERE action = 'sheet_import.commit_finalized'
      AND target_id = (
        SELECT id FROM plugin_data.csf_sheet_import_jobs
        WHERE mode = 'commit' AND preview_job_id = 'df300000-0000-4000-8000-000000000006'
      )
  ),
  2,
  'each finalize appended its own auditable event'
);

-- No canonical record was written twice: the row was never committed at all.
SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows
    WHERE job_id = 'df300000-0000-4000-8000-000000000006'
      AND import_status IN ('created', 'updated')
  ),
  0,
  'a terminally skipped row produces no canonical write'
);

-- And an unsettled recovery state still cannot reach a completed commit.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_sheet_import_jobs AS commit_job
    WHERE commit_job.status = 'completed'
      AND EXISTS (
        SELECT 1 FROM plugin_data.csf_sheet_import_rows AS import_row
        WHERE import_row.job_id = commit_job.preview_job_id
          AND import_row.commit_outcome_state IN ('in_flight', 'unknown', 'historical_unknown')
      )
  ),
  0,
  'no completed commit leaves an unknown, historical or in-flight row behind it'
);

-- ---------------------------------------------------------------------------
-- The write boundary, exercised as service_role.
--
-- Every refusal below must be a *privilege* refusal (42501), not a trigger or an RLS
-- policy. That distinction is the whole finding: the triggers already rejected some of
-- these shapes, which made it look as though the boundary held, while `service_role`
-- retained `GRANT ALL` from the `plugin_data` default ACL and could write the shapes the
-- triggers happened to accept -- a commit job, an attempt link, a frozen decision, a
-- terminal row status.
-- ---------------------------------------------------------------------------

-- Exact table privileges, in both directions: SELECT present, everything else absent.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM (VALUES
      ('plugin_data.csf_sheet_import_jobs'),
      ('plugin_data.csf_sheet_import_rows'),
      ('plugin_data.csf_sheet_import_commit_attempts'),
      ('plugin_data.csf_sheet_import_staging_objects'),
      ('plugin_data.csf_sheet_import_staging_claims')
    ) AS guarded(relation)
    CROSS JOIN (VALUES
      ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) AS forbidden(privilege)
    WHERE has_table_privilege('service_role', guarded.relation, forbidden.privilege)
  ),
  0,
  'service_role holds no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on any import table'
);

SELECT extensions.ok(
  (
    SELECT bool_and(has_table_privilege('service_role', guarded.relation, 'SELECT'))
    FROM (VALUES
      ('plugin_data.csf_sheet_import_jobs'),
      ('plugin_data.csf_sheet_import_rows'),
      ('plugin_data.csf_sheet_import_commit_attempts'),
      ('plugin_data.csf_sheet_import_staging_objects'),
      ('plugin_data.csf_sheet_import_staging_claims')
    ) AS guarded(relation)
  ),
  'service_role can still read every import table'
);

-- Column-targeted privileges too: a column grant would be the obvious way to reintroduce
-- exactly the columns a forged commit transition needs.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM (VALUES
      ('plugin_data.csf_sheet_import_jobs', 'status'),
      ('plugin_data.csf_sheet_import_jobs', 'mode'),
      ('plugin_data.csf_sheet_import_jobs', 'summary'),
      ('plugin_data.csf_sheet_import_jobs', 'active_commit_attempt_id'),
      ('plugin_data.csf_sheet_import_jobs', 'commit_actor_user_id'),
      ('plugin_data.csf_sheet_import_rows', 'import_status'),
      ('plugin_data.csf_sheet_import_rows', 'commit_attempt_id'),
      ('plugin_data.csf_sheet_import_rows', 'commit_outcome_state'),
      ('plugin_data.csf_sheet_import_rows', 'commit_frozen_row_hash'),
      ('plugin_data.csf_sheet_import_rows', 'commit_target_profile_id'),
      ('plugin_data.csf_sheet_import_rows', 'commit_retry_count'),
      ('plugin_data.csf_sheet_import_commit_attempts', 'status'),
      ('plugin_data.csf_sheet_import_commit_attempts', 'correlation_id')
    ) AS guarded(relation, column_name)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('REFERENCES')) AS forbidden(privilege)
    WHERE has_column_privilege(
      'service_role', guarded.relation, guarded.column_name, forbidden.privilege
    )
  ),
  0,
  'service_role holds no column-level write privilege on any commit, freeze or outcome column'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM information_schema.role_table_grants
    WHERE table_schema = 'plugin_data'
      AND table_name IN (
        'csf_sheet_import_jobs', 'csf_sheet_import_rows',
        'csf_sheet_import_commit_attempts',
        'csf_sheet_import_staging_objects', 'csf_sheet_import_staging_claims'
      )
      AND (grantee IN ('anon', 'authenticated', 'PUBLIC')
        OR (grantee = 'service_role' AND privilege_type <> 'SELECT'))
  ),
  0,
  'the granted table privilege set is exactly service_role SELECT and nothing else'
);

-- Now the direct attempts, as the role itself.
SET LOCAL ROLE service_role;

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, source_id, mode, status, source_type, preview_job_id
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      'commit', 'running', 'student_roster',
      'df300000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  NULL,
  'service_role cannot forge a commit job'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_jobs
    SET active_commit_attempt_id = NULL, status = 'completed'
    WHERE mode = 'commit'
  $$,
  '42501',
  NULL,
  'service_role cannot forge active attempt identity or a commit status'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_commit_attempts (
      organization_id, commit_job_id, attempt_number, status, lease_expires_at
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000001',
      99, 'running', now() + interval '1 hour'
    )
  $$,
  '42501',
  NULL,
  'service_role cannot forge a commit attempt'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET commit_outcome_state = 'succeeded',
        commit_attempt_id = NULL,
        import_status = 'created'
    WHERE id = 'df500000-0000-4000-8000-000000000002'
  $$,
  '42501',
  NULL,
  'service_role cannot forge a row outcome, lineage or terminal status'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET commit_frozen_at = now(),
        commit_frozen_row_hash = repeat('f', 64),
        commit_target_profile_id = 'df600000-0000-4000-8000-000000000001',
        commit_frozen_actor_user_id = 'df000000-0000-4000-8000-000000000002'
    WHERE id = 'df500000-0000-4000-8000-000000000002'
  $$,
  '42501',
  NULL,
  'service_role cannot forge frozen target, hash or actor lineage'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET commit_retry_count = 42,
        commit_outcome_resolution = 'confirmed_written',
        commit_outcome_resolved_by = 'df000000-0000-4000-8000-000000000002',
        commit_outcome_resolved_at = now()
    WHERE id = 'df500000-0000-4000-8000-000000000002'
  $$,
  '42501',
  NULL,
  'service_role cannot forge settlement counts or an outcome reconciliation'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_rows (
      organization_id, job_id, sheet_tab_name, row_number, import_status, row_hash
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000001',
      'Forged', 900, 'created', repeat('e', 64)
    )
  $$,
  '42501',
  NULL,
  'service_role cannot insert a preview row directly, terminal or otherwise'
);

SELECT extensions.throws_ok(
  $$DELETE FROM plugin_data.csf_sheet_import_rows$$,
  '42501', NULL,
  'service_role cannot delete preview rows'
);

SELECT extensions.throws_ok(
  $$TRUNCATE plugin_data.csf_sheet_import_jobs$$,
  '42501', NULL,
  'service_role cannot truncate import jobs'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_import_staging_objects (
      organization_id, source_id, generation, bucket, object_path, file_extension,
      content_hash, byte_length, upload_expires_at
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      99, 'csf-private', 'forged/path.xlsx', 'xlsx',
      repeat('a', 64), 10, now() + interval '1 hour'
    )
  $$,
  '42501',
  NULL,
  'service_role cannot forge a staging object'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_staging_claims
    SET released_at = NULL, retire_intent = NULL
  $$,
  '42501',
  NULL,
  'service_role cannot rewrite a staging claim'
);

-- The intended surface still works as that role: reads and the owned RPCs.
SELECT extensions.lives_ok(
  $$SELECT count(*) FROM plugin_data.csf_sheet_import_rows$$,
  'service_role can still read preview rows'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000001'
    )
  $$,
  'service_role can still evaluate readiness'
);

-- A legitimate preview, built end to end through the owned RPCs as service_role.
SELECT extensions.isnt(
  (
    SELECT plugin_data.csf_open_import_preview(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      'student_roster',
      'synthetic-roster-file', 'Synthetic roster.xlsx', 'Roster', 'Roster!A1:C3',
      NULL, '{}'::jsonb,
      jsonb_build_object('version', 1, 'sourceType', 'student_roster'),
      1, NULL, NULL, NULL, NULL, 'csf-normalized-import/v1'
    ) ->> 'previewJobId'
  ),
  NULL,
  'service_role can open a preview through the owned RPC'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_open_import_preview(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      'student_roster',
      'synthetic-roster-file', 'Synthetic roster.xlsx', 'Roster', 'Roster!A1:C3',
      NULL, '{}'::jsonb,
      jsonb_build_object('version', 1, 'sourceType', 'student_roster'),
      1, NULL, NULL, NULL, NULL, 'csf-normalized-import/v1'
    ) ->> 'status'
  ),
  'running',
  'and it always opens as a running preview, never as a commit'
);

-- A caller may not name a commit-side field at all.
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_append_import_preview_rows(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        %L,
        jsonb_build_array(jsonb_build_object(
          'sheet_tab_name', 'Roster', 'row_number', 1,
          'commit_outcome_state', 'succeeded'
        )))$$,
    (SELECT id FROM plugin_data.csf_sheet_import_jobs
     WHERE source_id = 'df200000-0000-4000-8000-000000000001' AND status = 'running'
     ORDER BY created_at DESC LIMIT 1)
  ),
  '23514',
  NULL,
  'a preview row may not name a commit outcome field'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_append_import_preview_rows(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        %L,
        jsonb_build_array(jsonb_build_object(
          'sheet_tab_name', 'Roster', 'row_number', 1, 'import_status', 'created'
        )))$$,
    (SELECT id FROM plugin_data.csf_sheet_import_jobs
     WHERE source_id = 'df200000-0000-4000-8000-000000000001' AND status = 'running'
     ORDER BY created_at DESC LIMIT 1)
  ),
  '23514',
  NULL,
  'a preview row may not be created with a terminal import status'
);

-- Cross-tenant coordinates are rejected.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_open_import_preview(
      'df100000-0000-4000-8000-000000000002',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      'student_roster',
      'x', 'x', 'Roster', 'Roster!A1:C3', NULL, '{}'::jsonb, '{}'::jsonb, 1,
      NULL, NULL, NULL, NULL, 'csf-normalized-import/v1'
    )
  $$,
  '23503',
  NULL,
  'a preview cannot be opened against another tenant''s source'
);

-- Replay is deterministic; a conflicting replay is refused.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_append_import_preview_rows(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_jobs
       WHERE source_id = 'df200000-0000-4000-8000-000000000001' AND status = 'running'
       ORDER BY created_at DESC LIMIT 1),
      -- `source_id` is NOT nameable on a preview row: it is derived from the
      -- locked job so a caller cannot state one that diverges from the preview
      -- the row belongs to. `row_hash` is derived too -- from the accepted
      -- record -- so stating one here could only ever agree or be refused.
      --
      -- A `student_roster` preview is a central source, so its row must carry the
      -- canonical normalized envelope: the contract version, the source type it
      -- agrees with, and an allowlisted record. Without it the RPC refuses the
      -- row for a missing contract version, which is not what these two
      -- assertions are about.
      jsonb_build_array(jsonb_build_object(
        'sheet_tab_name', 'Roster', 'row_number', 1,
        'cohort_id', 'df150000-0000-4000-8000-000000000001',
        'normalized_data', jsonb_build_object(
          'contractVersion', 'csf-normalized-import/v1',
          'sourceType', 'student_roster',
          'record', jsonb_build_object(
            'identity', jsonb_build_object(
              'firstName', 'Rowan', 'lastName', 'Tessel',
              'normalizedFirstName', 'rowan', 'normalizedLastName', 'tessel'
            ),
            'contact', jsonb_build_object(
              'schoolEmail', 'rtessel@students.example.net',
              'schoolEmailState', 'present'
            )
          )
        )
      ))
    ) ->> 'inserted'
  ),
  '1',
  'a preview row chunk is appended through the owned RPC'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_append_import_preview_rows(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_jobs
       WHERE source_id = 'df200000-0000-4000-8000-000000000001' AND status = 'running'
       ORDER BY created_at DESC LIMIT 1),
      -- `source_id` is NOT nameable on a preview row: it is derived from the
      -- locked job so a caller cannot state one that diverges from the preview
      -- the row belongs to. `row_hash` is derived too -- from the accepted
      -- record -- so stating one here could only ever agree or be refused.
      --
      -- A `student_roster` preview is a central source, so its row must carry the
      -- canonical normalized envelope: the contract version, the source type it
      -- agrees with, and an allowlisted record. Without it the RPC refuses the
      -- row for a missing contract version, which is not what these two
      -- assertions are about.
      jsonb_build_array(jsonb_build_object(
        'sheet_tab_name', 'Roster', 'row_number', 1,
        'cohort_id', 'df150000-0000-4000-8000-000000000001',
        'normalized_data', jsonb_build_object(
          'contractVersion', 'csf-normalized-import/v1',
          'sourceType', 'student_roster',
          'record', jsonb_build_object(
            'identity', jsonb_build_object(
              'firstName', 'Rowan', 'lastName', 'Tessel',
              'normalizedFirstName', 'rowan', 'normalizedLastName', 'tessel'
            ),
            'contact', jsonb_build_object(
              'schoolEmail', 'rtessel@students.example.net',
              'schoolEmailState', 'present'
            )
          )
        )
      ))
    ) ->> 'replayed'
  ),
  '1',
  'an identical chunk replay is deterministic and inserts nothing further'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_append_import_preview_rows(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        %L,
        jsonb_build_array(jsonb_build_object(
          'sheet_tab_name', 'Roster', 'row_number', 1,
          'cohort_id', 'df150000-0000-4000-8000-000000000001',
          'normalized_data', jsonb_build_object(
            'contractVersion', 'csf-normalized-import/v1',
            'sourceType', 'student_roster',
            'record', jsonb_build_object(
              'identity', jsonb_build_object(
                'firstName', 'Rowan', 'lastName', 'Tessel-Changed',
                'normalizedFirstName', 'rowan',
                'normalizedLastName', 'tessel-changed'
              ),
              'contact', jsonb_build_object(
                'schoolEmail', 'rtessel@students.example.net',
                'schoolEmailState', 'present'
              )
            )
          )
        )))$$,
    (SELECT id FROM plugin_data.csf_sheet_import_jobs
     WHERE source_id = 'df200000-0000-4000-8000-000000000001' AND status = 'running'
     ORDER BY created_at DESC LIMIT 1)
  ),
  '23505',
  NULL,
  'a conflicting chunk replay is refused rather than rewriting the preview'
);

-- Sealing makes the rows immutable: appending afterwards is refused.
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_seal_import_preview(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        %L,
        'completed',
        jsonb_build_object('rows', 85)
      )$$,
    (SELECT id FROM plugin_data.csf_sheet_import_jobs
     WHERE source_id = 'df200000-0000-4000-8000-000000000001' AND status = 'running'
     ORDER BY created_at DESC LIMIT 1)
  ),
  '23514',
  'A CSF preview summary may not state "rows": it is derived from the stored rows.',
  'a preview caller cannot state the row count that sealing derives from stored rows'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_seal_import_preview(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_jobs
       WHERE source_id = 'df200000-0000-4000-8000-000000000001' AND status = 'running'
       ORDER BY created_at DESC LIMIT 1),
      'needs_resolution',
      jsonb_build_object('matched', 0)
    ) ->> 'sealed'
  ),
  'true',
  'a preview can be sealed through the owned RPC'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_append_import_preview_rows(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        %L,
        jsonb_build_array(jsonb_build_object(
          'sheet_tab_name', 'Roster', 'row_number', 2, 'row_hash', %L
        )))$$,
    (SELECT id FROM plugin_data.csf_sheet_import_jobs
     WHERE source_id = 'df200000-0000-4000-8000-000000000001'
       AND status = 'completed'
     ORDER BY created_at DESC LIMIT 1),
    repeat('3', 64)
  ),
  '55000',
  NULL,
  'a sealed preview is immutable: no further rows may be appended'
);

-- And the payload bound is real.
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_append_import_preview_rows(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001', %L, '[]'::jsonb)$$,
    (SELECT id FROM plugin_data.csf_sheet_import_jobs
     WHERE source_id = 'df200000-0000-4000-8000-000000000001'
     ORDER BY created_at DESC LIMIT 1)
  ),
  '22023',
  NULL,
  'an empty preview chunk is refused'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- The staging actor surface, and the sheet-source registry.
--
-- Executable rather than asserted about the source text: each case calls the
-- real signature as `service_role` and expects the exact SQLSTATE, then proves
-- the row it targeted did not move.
-- ---------------------------------------------------------------------------

SET ROLE service_role;

-- A dedicated source so these cases cannot perturb the ledger fixtures above.
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      NULL,
      'student_roster',
      jsonb_build_object(
        'title', 'Registry contract source',
        'provider', 'uploaded_xlsx',
        'settings', jsonb_build_object('sourceKind', 'student_roster', 'mappingVersion', 1)
      )
    )$$,
  'a permitted officer may register a source'
);

-- Every denial in the matrix, on the same call, with zero mutation.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001', NULL::uuid, NULL, 'student_roster',
      jsonb_build_object('title', 'Denied', 'settings',
        jsonb_build_object('sourceKind', 'student_roster')))$$,
  '42501', NULL,
  'a null actor may not register a source'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-00000000ffff'::uuid, NULL, 'student_roster',
      jsonb_build_object('title', 'Denied', 'settings',
        jsonb_build_object('sourceKind', 'student_roster')))$$,
  '42501', NULL,
  'a nonexistent actor may not register a source'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000002'::uuid, NULL, 'student_roster',
      jsonb_build_object('title', 'Denied', 'settings',
        jsonb_build_object('sourceKind', 'student_roster')))$$,
  '42501', NULL,
  'a cross-tenant officer may not register a source'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000004'::uuid, NULL, 'student_roster',
      jsonb_build_object('title', 'Denied', 'settings',
        jsonb_build_object('sourceKind', 'student_roster')))$$,
  '42501', NULL,
  'an inactive member may not register a source'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000005'::uuid, NULL, 'student_roster',
      jsonb_build_object('title', 'Denied', 'settings',
        jsonb_build_object('sourceKind', 'student_roster')))$$,
  '42501', NULL,
  'an expired position may not register a source'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000003',
      NULL, 'student_roster',
      jsonb_build_object('title', 'Admin registered', 'provider', 'uploaded_xlsx',
        'settings', jsonb_build_object('sourceKind', 'student_roster')))$$,
  'an active organization admin bypasses the position and capability checks'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_sources
   WHERE organization_id = 'df100000-0000-4000-8000-000000000001'
     AND title = 'Denied'),
  0,
  'no denied registration left a row behind'
);

-- Registration refuses arbitrary JSON and arbitrary targets.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001', NULL, 'student_roster',
      jsonb_build_object('organizationId', 'df100000-0000-4000-8000-000000000002',
        'settings', jsonb_build_object('sourceKind', 'student_roster')))$$,
  '23514', NULL,
  'a registration may not name its own organization'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001', NULL, 'student_roster',
      jsonb_build_object('title', 'Bad settings', 'settings',
        jsonb_build_object('sourceKind', 'student_roster', 'somethingNew', 'x')))$$,
  '23514', NULL,
  'an unreviewed settings key is refused'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001', NULL, 'student_roster',
      jsonb_build_object('title', 'Forged attachment', 'settings',
        jsonb_build_object('sourceKind', 'student_roster', 'stagingGeneration', 9)))$$,
  '23514', NULL,
  'a registration may not state a staged generation'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001', NULL, 'student_roster',
      jsonb_build_object('title', 'Cross-tenant class', 'cohortId',
        'df150000-0000-4000-8000-0000000000ff',
        'settings', jsonb_build_object('sourceKind', 'student_roster')))$$,
  '23503', NULL,
  'a registration may not name a class outside its organization'
);

-- Source kind is immutable, because it selects the governing capability.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      'meeting_attendance',
      jsonb_build_object('settings', jsonb_build_object('sourceKind', 'meeting_attendance')))$$,
  '23514', NULL,
  'a registered source keeps the kind it was created as'
);

SELECT extensions.is(
  (SELECT source_type FROM plugin_data.csf_sheet_sources
   WHERE id = 'df200000-0000-4000-8000-000000000001'),
  'student_roster',
  'the refused kind change left the source untouched'
);

-- A grant for another source never authorizes this one.
INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title, status
) VALUES (
  'df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000004',
  'df170000-0000-4000-8000-000000000003', '2028-2029', 'Meetings Only', 'active'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_record_sheet_source_sync(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000004',
      'df200000-0000-4000-8000-000000000001',
      'healthy', 'preview_completed', NULL, true)$$,
  '42501', NULL,
  'an import_meetings grant does not authorize a roster source'
);

-- ---------------------------------------------------------------------------
-- Attaching a staged generation is a compare-and-swap.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_open_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      'csf-private', 'xlsx', repeat('a', 64), 4096, 3600)$$,
  'a permitted officer may open a staging generation'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_open_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000002',
      'df200000-0000-4000-8000-000000000001',
      'csf-private', 'xlsx', repeat('b', 64), 4096, 3600)$$,
  '42501', NULL,
  'a cross-tenant officer may not open a staging generation'
);

SELECT extensions.lives_ok(
  format($$SELECT plugin_data.csf_finalize_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001', %L)$$,
    (SELECT id FROM plugin_data.csf_sheet_import_staging_objects
     WHERE source_id = 'df200000-0000-4000-8000-000000000001'
     ORDER BY generation DESC LIMIT 1)),
  'a permitted officer may finalize a staging generation'
);

SELECT extensions.is(
  (SELECT finalized_by FROM plugin_data.csf_sheet_import_staging_objects
   WHERE source_id = 'df200000-0000-4000-8000-000000000001'
   ORDER BY generation DESC LIMIT 1),
  'df000000-0000-4000-8000-000000000001'::uuid,
  'the finalize receipt records the officer who performed it'
);

-- N attaches.
SELECT extensions.lives_ok(
  format($$SELECT plugin_data.csf_attach_sheet_source_generation(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      %L, %s, %L, NULL, 1)$$,
    (SELECT id FROM plugin_data.csf_sheet_import_staging_objects
     WHERE source_id = 'df200000-0000-4000-8000-000000000001'
     ORDER BY generation DESC LIMIT 1),
    (SELECT generation FROM plugin_data.csf_sheet_import_staging_objects
     WHERE source_id = 'df200000-0000-4000-8000-000000000001'
     ORDER BY generation DESC LIMIT 1),
    repeat('a', 64)),
  'generation N attaches when no prior attachment is expected'
);

-- N replays idempotently.
SELECT extensions.is(
  (SELECT (plugin_data.csf_attach_sheet_source_generation(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_staging_objects
       WHERE source_id = 'df200000-0000-4000-8000-000000000001'
       ORDER BY generation DESC LIMIT 1),
      (SELECT generation FROM plugin_data.csf_sheet_import_staging_objects
       WHERE source_id = 'df200000-0000-4000-8000-000000000001'
       ORDER BY generation DESC LIMIT 1),
      repeat('a', 64),
      NULL,
      1) ->> 'replayed')),
  'true',
  'an exact replay of generation N is idempotent'
);

-- N with a different digest is refused.
SELECT extensions.throws_ok(
  format($$SELECT plugin_data.csf_attach_sheet_source_generation(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      %L, %s, %L, %s, 1)$$,
    (SELECT id FROM plugin_data.csf_sheet_import_staging_objects
     WHERE source_id = 'df200000-0000-4000-8000-000000000001'
     ORDER BY generation DESC LIMIT 1),
    (SELECT generation FROM plugin_data.csf_sheet_import_staging_objects
     WHERE source_id = 'df200000-0000-4000-8000-000000000001'
     ORDER BY generation DESC LIMIT 1),
    repeat('c', 64),
    (SELECT generation FROM plugin_data.csf_sheet_import_staging_objects
     WHERE source_id = 'df200000-0000-4000-8000-000000000001'
     ORDER BY generation DESC LIMIT 1)),
  '22023', NULL,
  'generation N with a different digest is refused'
);

-- A REAL generation-2 transition, built rather than assumed. The earlier version
-- of this case asserted "a delayed N fails after N+1" without ever creating N+1,
-- so it proved only that a generation the object does not carry is refused --
-- which is a different contract, and one the implementation had already changed.
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_open_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      'csf-private', 'xlsx', repeat('a', 64), 4096, 3600)$$,
  'a second staging generation opens for the registry contract source'
);

SELECT extensions.lives_ok(
  format($$SELECT plugin_data.csf_finalize_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001', %L)$$,
    (SELECT id FROM plugin_data.csf_sheet_import_staging_objects
     WHERE source_id = 'df200000-0000-4000-8000-000000000001'
     ORDER BY generation DESC LIMIT 1)),
  'the second generation is finalized readable'
);

-- N+1 attaches, naming N as its expected prior fence.
SELECT extensions.is(
  (SELECT (plugin_data.csf_attach_sheet_source_generation(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_staging_objects
       WHERE source_id = 'df200000-0000-4000-8000-000000000001'
       ORDER BY generation DESC LIMIT 1),
      (SELECT generation FROM plugin_data.csf_sheet_import_staging_objects
       WHERE source_id = 'df200000-0000-4000-8000-000000000001'
       ORDER BY generation DESC LIMIT 1),
      repeat('a', 64),
      1,
      1) ->> 'replayed')),
  'false',
  'generation N+1 attaches over N when it names N as its expected prior fence'
);

-- And now the delayed N. It carries the coordinates it was built with, before
-- N+1 existed, and must change nothing.
SELECT extensions.is(
  (SELECT plugin_data.csf_attach_sheet_source_generation(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_staging_objects
       WHERE source_id = 'df200000-0000-4000-8000-000000000001' AND generation = 1),
      1, repeat('a', 64), NULL, 1) ->> 'reasonCode'),
  'newer_generation_attached',
  'a delayed generation-N attach is refused once N+1 is attached'
);

SELECT extensions.is(
  (SELECT (settings ->> 'stagingGeneration') FROM plugin_data.csf_sheet_sources
   WHERE id = 'df200000-0000-4000-8000-000000000001'),
  '2',
  'the delayed generation-N attach left N+1 in place'
);

SELECT extensions.is(
  (SELECT (settings ->> 'stagingContentHash') FROM plugin_data.csf_sheet_sources
   WHERE id = 'df200000-0000-4000-8000-000000000001'),
  repeat('a', 64),
  'and left N+1 evidence untouched'
);

-- Replay is exact, not generation-shaped. Same generation and digest, DIFFERENT
-- prior fence: a different request, and refused rather than acknowledged.
SELECT extensions.is(
  (SELECT plugin_data.csf_attach_sheet_source_generation(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_staging_objects
       WHERE source_id = 'df200000-0000-4000-8000-000000000001' AND generation = 2),
      2, repeat('a', 64), NULL, 1) ->> 'reasonCode'),
  'prior_generation_changed',
  'the same generation with a different prior fence is not a replay'
);

-- Same generation and fence, DIFFERENT mapping version: also a different request.
SELECT extensions.is(
  (SELECT plugin_data.csf_attach_sheet_source_generation(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_staging_objects
       WHERE source_id = 'df200000-0000-4000-8000-000000000001' AND generation = 2),
      2, repeat('a', 64), 2, 7) ->> 'reasonCode'),
  'mapping_version_changed',
  'the same generation with a different mapping version is not a replay'
);

-- The byte-for-byte equivalent, and only it, replays.
SELECT extensions.is(
  (SELECT (plugin_data.csf_attach_sheet_source_generation(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_staging_objects
       WHERE source_id = 'df200000-0000-4000-8000-000000000001' AND generation = 2),
      2, repeat('a', 64), 1, 1) ->> 'replayed')),
  'true',
  'the exact accepted request, and only it, replays'
);

-- An invalid prior fence is refused outright rather than encoded as a sentinel.
SELECT extensions.throws_ok(
  format($$SELECT plugin_data.csf_attach_sheet_source_generation(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      %L, 2, %L, -1, 1)$$,
    (SELECT id FROM plugin_data.csf_sheet_import_staging_objects
     WHERE source_id = 'df200000-0000-4000-8000-000000000001' AND generation = 2),
    repeat('a', 64)),
  '22023', NULL,
  'a negative prior generation is refused rather than colliding with "no prior attachment"'
);

-- ---------------------------------------------------------------------------
-- The system-owned settings namespace survives reconfiguration.
-- ---------------------------------------------------------------------------

-- Give the source live provider evidence to preserve. Written directly here
-- because the refresh RPC needs a provider round trip this harness cannot make.
--
-- `RESET ROLE` first, and deliberately so. Everything from the boundary section
-- above runs as `service_role`, which holds SELECT and nothing else on
-- `csf_sheet_sources` -- that restriction is the subject of assertions in this
-- very file. So this statement used to raise 42501 and abort the run: a fixture
-- that could only have worked if the boundary it is testing did not hold.
-- Privileged fixture setup happens as the test's own role, explicitly outside
-- the impersonation, and the impersonation resumes immediately afterwards.
RESET ROLE;

UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object(
      'evidenceRevision', 'revision-fixture-1',
      'evidenceDigest', repeat('e', 64)
    )
WHERE id = 'df200000-0000-4000-8000-000000000001';

SET ROLE service_role;

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      'student_roster',
      jsonb_build_object('title', 'Reconfigured',
        'settings', jsonb_build_object('sourceKind', 'student_roster', 'mappingVersion', 4)))$$,
  'a reconfiguration that omits every system-owned key is accepted'
);

SELECT extensions.is(
  (SELECT (settings ->> 'evidenceRevision') FROM plugin_data.csf_sheet_sources
   WHERE id = 'df200000-0000-4000-8000-000000000001'),
  'revision-fixture-1',
  'reconfiguration preserves the live provider revision it did not mention'
);

SELECT extensions.is(
  (SELECT (settings ->> 'evidenceDigest') FROM plugin_data.csf_sheet_sources
   WHERE id = 'df200000-0000-4000-8000-000000000001'),
  repeat('e', 64),
  'reconfiguration preserves the live provider digest it did not mention'
);

SELECT extensions.is(
  (SELECT (settings ->> 'stagingGeneration') FROM plugin_data.csf_sheet_sources
   WHERE id = 'df200000-0000-4000-8000-000000000001'),
  '2',
  'reconfiguration preserves the staged generation it did not mention'
);

SELECT extensions.is(
  (SELECT (settings ->> 'mappingVersion') FROM plugin_data.csf_sheet_sources
   WHERE id = 'df200000-0000-4000-8000-000000000001'),
  '4',
  'while the caller-owned configuration it did state is replaced'
);

-- And a caller that tries to state one is refused, not merged.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      'student_roster',
      jsonb_build_object('settings', jsonb_build_object(
        'sourceKind', 'student_roster', 'evidenceDigest', repeat('f', 64))))$$,
  '23514', NULL,
  'a caller may not state the live provider digest'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_register_sheet_source(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      'student_roster',
      jsonb_build_object('settings', jsonb_build_object(
        'sourceKind', 'student_roster', 'stagedUpload', false)))$$,
  '23514', NULL,
  'a caller may not clear the staged-upload flag'
);

SELECT extensions.is(
  (SELECT (settings ->> 'evidenceDigest') FROM plugin_data.csf_sheet_sources
   WHERE id = 'df200000-0000-4000-8000-000000000001'),
  repeat('e', 64),
  'and neither refused attempt changed the stored evidence'
);

-- ---------------------------------------------------------------------------
-- Every retirement branch resolves a real signature and reaches its state.
-- ---------------------------------------------------------------------------

-- The officer-facing entry point.
SELECT extensions.is(
  (SELECT (plugin_data.csf_retire_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_sheet_import_staging_objects
       WHERE source_id = 'df200000-0000-4000-8000-000000000001' AND generation = 2),
      'officer_retired', 2) ->> 'systemInitiated')),
  'false',
  'an officer retirement is recorded as officer work'
);

SELECT extensions.is(
  (SELECT retire_requested_by FROM plugin_data.csf_sheet_import_staging_objects
   WHERE source_id = 'df200000-0000-4000-8000-000000000001' AND generation = 2),
  'df000000-0000-4000-8000-000000000001'::uuid,
  'and the receipt names the officer who asked for it'
);

-- The open branch, which retires an abandoned upload it did not authorize twice.
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_open_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      'csf-private', 'xlsx', repeat('a', 64), 1024, 3600)$$,
  'opening a generation resolves the retirement primitive for the abandoned upload'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_open_staging_object(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000001',
      'csf-private', 'xlsx', repeat('a', 64), 1024, 3600)$$,
  'and opening a replacement retires the previous abandoned upload without error'
);

-- Both sweepers, which must resolve the primitive with no actor at all.
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_sweep_staging_objects(10)$$,
  'the staging sweeper resolves the retirement primitive as system work'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_retire_expired_staging_objects(10)$$,
  '42501', NULL,
  'the ready-deadline helper remains internal while the public sweeper invokes it'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_sheet_import_staging_objects
    WHERE retire_reason IN ('ready_deadline_passed', 'upload_abandoned')
      AND retire_requested_by IS NOT NULL
      AND retire_requested_by <> 'df000000-0000-4000-8000-000000000001'::uuid
  ),
  'no sweep attributed a system retirement to an officer who did not ask for it'
);

-- ---------------------------------------------------------------------------
-- csf_sheet_sources holds no write privilege for anybody.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  has_table_privilege('service_role', 'plugin_data.csf_sheet_sources', 'SELECT'),
  'service_role reads the sheet-source registry'
);

SELECT extensions.ok(
  NOT has_table_privilege('service_role', 'plugin_data.csf_sheet_sources', 'INSERT'),
  'service_role has no INSERT on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('service_role', 'plugin_data.csf_sheet_sources', 'UPDATE'),
  'service_role has no UPDATE on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('service_role', 'plugin_data.csf_sheet_sources', 'DELETE'),
  'service_role has no DELETE on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('service_role', 'plugin_data.csf_sheet_sources', 'TRUNCATE'),
  'service_role has no TRUNCATE on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('service_role', 'plugin_data.csf_sheet_sources', 'REFERENCES'),
  'service_role has no REFERENCES on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('service_role', 'plugin_data.csf_sheet_sources', 'TRIGGER'),
  'service_role has no TRIGGER on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'plugin_data.csf_sheet_sources', 'INSERT'),
  'anon has no INSERT on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'plugin_data.csf_sheet_sources', 'UPDATE'),
  'anon has no UPDATE on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'plugin_data.csf_sheet_sources', 'DELETE'),
  'anon has no DELETE on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'plugin_data.csf_sheet_sources', 'TRUNCATE'),
  'anon has no TRUNCATE on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'plugin_data.csf_sheet_sources', 'REFERENCES'),
  'anon has no REFERENCES on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'plugin_data.csf_sheet_sources', 'TRIGGER'),
  'anon has no TRIGGER on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_sheet_sources', 'INSERT'),
  'authenticated has no INSERT on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_sheet_sources', 'UPDATE'),
  'authenticated has no UPDATE on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_sheet_sources', 'DELETE'),
  'authenticated has no DELETE on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_sheet_sources', 'TRUNCATE'),
  'authenticated has no TRUNCATE on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_sheet_sources', 'REFERENCES'),
  'authenticated has no REFERENCES on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_sheet_sources', 'TRIGGER'),
  'authenticated has no TRIGGER on csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'plugin_data.csf_sheet_sources', 'SELECT'),
  'anon cannot read csf_sheet_sources'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_sheet_sources', 'SELECT'),
  'authenticated cannot read csf_sheet_sources'
);

SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_sheet_sources (organization_id, source_type, title)
    VALUES ('df100000-0000-4000-8000-000000000001', 'student_roster', 'Direct')$$,
  '42501', NULL,
  'service_role cannot insert a sheet source directly'
);

SELECT extensions.throws_ok(
  $$UPDATE plugin_data.csf_sheet_sources SET title = 'Forged'
    WHERE id = 'df200000-0000-4000-8000-000000000001'$$,
  '42501', NULL,
  'service_role cannot update a sheet source directly'
);

-- ---------------------------------------------------------------------------
-- The synthetic fixture seam cannot reach a production organization.
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_seed_reset_synthetic_import(
      'df100000-0000-4000-8000-000000000001')$$,
  '42501', NULL,
  'the seed reset refuses a non-synthetic organization'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_seed_synthetic_import_fixture(
      'df100000-0000-4000-8000-000000000001', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)$$,
  '42501', NULL,
  'the seed fixture refuses a non-synthetic organization'
);

SELECT extensions.ok(
  plugin_data.csf_is_synthetic_fixture_id('10000000-0000-4000-8000-000000000004'),
  'the reserved fixture namespace is recognized'
);

SELECT extensions.ok(
  NOT plugin_data.csf_is_synthetic_fixture_id('df100000-0000-4000-8000-000000000001'),
  'a production organization is outside the fixture namespace'
);

RESET ROLE;

-- ===========================================================================
-- Import authorization: membership is the tenant boundary, and no mailbox is a
-- capability.
--
-- `csf_assert_import_actor` used to select a literal `true` beside `bool_or`,
-- and an aggregate with no GROUP BY returns one row even over an empty FROM.
-- Membership was therefore never actually required of anybody: every caller
-- reached the position and mailbox checks with `v_is_member` already true. The
-- assertions below are the ones that could not have failed before.
-- ===========================================================================

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-00000000000b',
      'student_roster')$$,
  '42501', NULL,
  'a known user with no organization membership at all is refused'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-00000000000a',
      'student_roster')$$,
  '42501', NULL,
  'the mailbox holder is an ordinary member and authorizes nothing by itself'
);

-- The same account, now genuinely without membership. The old bypass compared
-- `auth.users.email` before consulting anything else, so this was the strongest
-- authority in the system rather than the weakest.
DELETE FROM public.organization_members
WHERE organization_id = 'df100000-0000-4000-8000-000000000001'
  AND user_id = 'df000000-0000-4000-8000-00000000000a';

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-00000000000a',
      'student_roster')$$,
  '42501', NULL,
  'and the mailbox holder cannot act in an organization they do not belong to'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000004',
      'student_roster')$$,
  '42501', NULL,
  'a membership row that is not active is not membership'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000005',
      'student_roster')$$,
  '42501', NULL,
  'an active member whose position ended yesterday holds no capability'
);

-- A stale position: the member was offboarded, the position row stayed. Before
-- membership was enforced this kept working indefinitely.
DELETE FROM public.organization_members
WHERE organization_id = 'df100000-0000-4000-8000-000000000001'
  AND user_id = 'df000000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'student_roster')$$,
  '42501', NULL,
  'a position left behind by an offboarded member grants nothing'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001', 'staff', 'active');

SELECT extensions.is(
  plugin_data.csf_assert_import_actor(
    'df100000-0000-4000-8000-000000000001',
    'df000000-0000-4000-8000-000000000001',
    'student_roster') ->> 'basis',
  'staff_position',
  'and it works again the moment the membership is restored'
);

-- Owner authority, positive and negative, now that it is a row rather than an
-- address.
SELECT extensions.is(
  plugin_data.csf_assert_import_actor(
    'df100000-0000-4000-8000-000000000001',
    'df000000-0000-4000-8000-000000000007',
    'student_roster') ->> 'basis',
  'owner_position',
  'an explicit active in-date owner position carries owner authority'
);

-- The owner role deliberately holds no import permission row, so this is the
-- position and nothing else.
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_role_permissions
   WHERE role_id = 'df170000-0000-4000-8000-000000000004'),
  0,
  'and it does so without any permission row standing behind it'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000008',
      'student_roster')$$,
  '42501', NULL,
  'an owner position that has ended is an ex-owner'
);

UPDATE plugin_data.csf_staff_positions
SET status = 'inactive'
WHERE organization_id = 'df100000-0000-4000-8000-000000000001'
  AND user_id = 'df000000-0000-4000-8000-000000000007';

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000007',
      'student_roster')$$,
  '42501', NULL,
  'an inactive owner position carries no authority either'
);

UPDATE plugin_data.csf_staff_positions
SET status = 'active'
WHERE organization_id = 'df100000-0000-4000-8000-000000000001'
  AND user_id = 'df000000-0000-4000-8000-000000000007';

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000009',
      'student_roster')$$,
  '42501', NULL,
  'an owner of the other tenant is not an owner here'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000002',
      'student_roster')$$,
  '42501', NULL,
  'a cross-tenant officer is refused before any position is consulted'
);

SELECT extensions.is(
  plugin_data.csf_assert_import_actor(
    'df100000-0000-4000-8000-000000000001',
    'df000000-0000-4000-8000-000000000003',
    'student_roster') ->> 'basis',
  'organization_admin',
  'an active organization admin still bypasses position and capability'
);

-- The admin bypass is a bypass of the CSF position, never of the tenant.
UPDATE public.organization_members SET status = 'removed'
WHERE organization_id = 'df100000-0000-4000-8000-000000000001'
  AND user_id = 'df000000-0000-4000-8000-000000000003';

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assert_import_actor(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000003',
      'student_roster')$$,
  '42501', NULL,
  'and a removed admin is not an admin of anything'
);

UPDATE public.organization_members SET status = 'active'
WHERE organization_id = 'df100000-0000-4000-8000-000000000001'
  AND user_id = 'df000000-0000-4000-8000-000000000003';

-- The bypass is gone from the source text as well as from behavior, so a future
-- edit cannot reintroduce it while these behavioral assertions still pass by
-- happening to test users who lack the address.
--
-- Stated as "no email literal at all" rather than "not this one address". A
-- check naming the old mailbox would have to spell it, which would put a real
-- address into a file whose whole fixture rule is that every value is synthetic
-- -- and it would say nothing about the next hard-coded address somebody adds.
SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_assert_import_actor(uuid, uuid, text)'::regprocedure
  ) !~ E'\'[^\']*@[^\']*\'',
  'no email literal of any kind appears in the import authorization'
);

SELECT extensions.ok(
  position(
    'count(*) > 0' in pg_get_functiondef(
      'plugin_data.csf_assert_import_actor(uuid, uuid, text)'::regprocedure
    )
  ) > 0,
  'membership is tested with an aggregate that is false over an empty match'
);

-- ===========================================================================
-- The evidence receipt: provider-aware, preview-bound, single-use.
-- ===========================================================================

-- No four-argument claim overload survives, and the five-argument one carries no
-- default that would let a caller omit the receipt.
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc AS proc
   JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
   WHERE namespace.nspname = 'plugin_data'
     AND proc.proname = 'csf_claim_import_commit_attempt'),
  1,
  'exactly one claim signature exists, so no four-argument overload can be resolved'
);

SELECT extensions.is(
  (SELECT proc.pronargdefaults::integer
   FROM pg_catalog.pg_proc AS proc
   JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
   WHERE namespace.nspname = 'plugin_data'
     AND proc.proname = 'csf_claim_import_commit_attempt'),
  0,
  'and it declares no defaults, so the receipt cannot be omitted at the call site'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc AS proc
   JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
   WHERE namespace.nspname = 'plugin_data'
     AND proc.proname = 'csf_refresh_sheet_source_evidence'),
  1,
  'and exactly one evidence refresh signature exists, the preview-bound one'
);

-- A fresh preview of the uploaded source, so these assertions do not disturb the
-- commit fixtures above.
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_file_metadata, mapping_snapshot, mapping_version,
  source_content_hash, snapshot_hash, snapshot_row_count, snapshot_contract_version
) VALUES (
  'df300000-0000-4000-8000-00000000000e',
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000007',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster',
  'synthetic-roster-file', 'Synthetic roster.xlsx', 'Roster', 'Roster!C5:E7',
  jsonb_build_object(
    'id', 'df210000-0000-4000-8000-000000000001',
    'name', 'Synthetic roster.xlsx',
    'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'headRevisionId', repeat('5', 64),
    'accessState', 'accessible', 'trashed', false
  ),
  jsonb_build_object('version', 1, 'sourceType', 'student_roster',
    'sourceFileId', 'synthetic-roster-file',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Roster', 'range', 'Roster!C5:E7', 'headerRow', 5))),
  -- Bound to the staged digest: the issuer now compares the job's own column
  -- with the locked staged bytes, so a preview that contradicts itself cannot
  -- receive a receipt at all.
  1, repeat('5', 64), repeat('2', 64), 1, 'csf-normalized-import/v1'
);

SELECT extensions.is(
  plugin_data.csf_issue_uploaded_source_evidence(
    'df100000-0000-4000-8000-000000000001',
    'df000000-0000-4000-8000-000000000001',
    'df200000-0000-4000-8000-000000000007',
    'df300000-0000-4000-8000-00000000000e') ->> 'provider',
  'uploaded_xlsx',
  'an uploaded source issues its own receipt with no provider call'
);

SELECT extensions.is(
  (SELECT preview_job_id FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE preview_job_id = 'df300000-0000-4000-8000-00000000000e'
   ORDER BY created_at DESC, id DESC LIMIT 1),
  'df300000-0000-4000-8000-00000000000e'::uuid,
  'and the receipt is bound at issuance to the exact preview it names'
);

SELECT extensions.is(
  (SELECT content_digest FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE preview_job_id = 'df300000-0000-4000-8000-00000000000e'
   ORDER BY created_at DESC, id DESC LIMIT 1),
  repeat('5', 64),
  'to the staged bytes it was derived from, which the caller never stated'
);

-- The Google issuer refuses an uploaded source outright, and vice versa: neither
-- family's proof can be produced for the other.
--
-- Deliberately supplied with an OTHERWISE VALID Google answer -- exact Sheets
-- MIME, well-formed version, accessible, untrashed -- so the refusal provably
-- comes from the provider family check rather than from an input this call could
-- not have satisfied anyway. An assertion that passes for the wrong reason is
-- indistinguishable from one that has stopped testing anything.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df300000-0000-4000-8000-00000000000e',
      0, 'df210000-0000-4000-8000-000000000001',
      'application/vnd.google-apps.spreadsheet',
      now(), '3', false, 'accessible', 'Synthetic roster.xlsx')$$,
  '23514', NULL,
  'the live-provider refresh refuses an uploaded source rather than trusting its caller'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_issue_uploaded_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000002',
      'df300000-0000-4000-8000-000000000002')$$,
  '23514', NULL,
  'and the uploaded issuer refuses a Google source'
);

-- The preview binding, at issuance: a preview of a different source.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_issue_uploaded_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df300000-0000-4000-8000-000000000002')$$,
  '23514', NULL,
  'a receipt cannot be issued against a preview taken from another source'
);

-- A cross-tenant actor cannot obtain one at all.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_issue_uploaded_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000002',
      'df200000-0000-4000-8000-000000000007',
      'df300000-0000-4000-8000-00000000000e')$$,
  '42501', NULL,
  'and an officer of another tenant cannot obtain one'
);

-- A replacement upload invalidates a receipt already issued: the attachment moved,
-- and the consumption re-checks it.
SELECT extensions.throws_ok(
  format($$SELECT plugin_data.csf_consume_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df000000-0000-4000-8000-000000000001',
      %L, 'df300000-0000-4000-8000-00000000000f')$$,
    (SELECT nonce FROM plugin_data.csf_sheet_source_evidence_tokens
     WHERE preview_job_id = 'df300000-0000-4000-8000-00000000000e'
     ORDER BY created_at DESC, id DESC LIMIT 1)),
  '42501', NULL,
  'a receipt spent against a different preview is refused'
);

SELECT extensions.is(
  (SELECT consumed_at FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE preview_job_id = 'df300000-0000-4000-8000-00000000000e'
   ORDER BY created_at DESC, id DESC LIMIT 1),
  NULL,
  'and refusing it does not consume it'
);

SELECT extensions.throws_ok(
  format($$SELECT plugin_data.csf_consume_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df000000-0000-4000-8000-000000000006',
      %L, 'df300000-0000-4000-8000-00000000000e')$$,
    (SELECT nonce FROM plugin_data.csf_sheet_source_evidence_tokens
     WHERE preview_job_id = 'df300000-0000-4000-8000-00000000000e'
     ORDER BY created_at DESC, id DESC LIMIT 1)),
  '42501', NULL,
  'a receipt spent by a different officer is refused without consuming it'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_consume_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df000000-0000-4000-8000-000000000001',
      NULL, 'df300000-0000-4000-8000-00000000000e')$$,
  '55000', NULL,
  'and a null receipt is a refusal for every provider, not an exemption'
);

-- Superseded: a second issuance bumps the generation, so the first receipt is
-- stale even though it was never used.
SELECT extensions.ok(
  plugin_data.csf_issue_uploaded_source_evidence(
    'df100000-0000-4000-8000-000000000001',
    'df000000-0000-4000-8000-000000000001',
    'df200000-0000-4000-8000-000000000007',
    'df300000-0000-4000-8000-00000000000e') ? 'evidenceToken',
  'a second receipt supersedes the first'
);

SELECT extensions.throws_ok(
  format($$SELECT plugin_data.csf_consume_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df000000-0000-4000-8000-000000000001',
      %L, 'df300000-0000-4000-8000-00000000000e')$$,
    (SELECT nonce FROM plugin_data.csf_sheet_source_evidence_tokens
     WHERE preview_job_id = 'df300000-0000-4000-8000-00000000000e'
     ORDER BY evidence_generation ASC LIMIT 1)),
  '40001', NULL,
  'and the superseded receipt is refused'
);

-- The surviving receipt consumes exactly once, and records its binding.
SELECT extensions.is(
  (SELECT plugin_data.csf_consume_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df000000-0000-4000-8000-000000000001',
      (SELECT nonce FROM plugin_data.csf_sheet_source_evidence_tokens
       WHERE preview_job_id = 'df300000-0000-4000-8000-00000000000e'
       ORDER BY evidence_generation DESC LIMIT 1),
      'df300000-0000-4000-8000-00000000000e') ->> 'consumed'),
  'true',
  'the current receipt consumes exactly once'
);

SELECT extensions.is(
  (SELECT consumed_by_job_id FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE preview_job_id = 'df300000-0000-4000-8000-00000000000e'
   ORDER BY evidence_generation DESC LIMIT 1),
  'df300000-0000-4000-8000-00000000000e'::uuid,
  'and consumption records the exact preview it was bound to'
);

SELECT extensions.throws_ok(
  format($$SELECT plugin_data.csf_consume_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df000000-0000-4000-8000-000000000001',
      %L, 'df300000-0000-4000-8000-00000000000e')$$,
    (SELECT nonce FROM plugin_data.csf_sheet_source_evidence_tokens
     WHERE preview_job_id = 'df300000-0000-4000-8000-00000000000e'
     ORDER BY evidence_generation DESC LIMIT 1)),
  '55000', NULL,
  'and a replay of it is refused'
);

-- The database, not a code path, is what makes consumption record the binding.
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'plugin_data.csf_sheet_source_evidence_tokens'::regclass
      AND conname = 'csf_evidence_tokens_consumed_binding_check'
  ),
  'a table constraint forbids consumption recording any other preview'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'plugin_data.csf_sheet_source_evidence_tokens'::regclass
      AND conname = 'csf_evidence_tokens_provider_shape_check'
  ),
  'and each provider family must carry exactly its own evidence'
);



-- ---------------------------------------------------------------------------
-- Exactness, at the uploaded issuer and at consumption.
--
-- The uploaded path carried two normalizations rather than one. `btrim`
-- repaired a padded coordinate into the one it was about to be compared with,
-- and `lower` folded an UPPERCASE digest into canonical sha256 evidence -- so a
-- source whose recorded digest is not the canonical digest, and a preview whose
-- frozen digest is not the digest, both reached agreement and were issued a
-- receipt attesting to bytes nothing had read under that name.
--
-- Each case gets its own preview: `source_file_metadata` is immutable by
-- trigger, so a shared fixture cannot be mutated into the shape under test.
-- ---------------------------------------------------------------------------
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_file_metadata, mapping_snapshot, mapping_version,
  source_content_hash, snapshot_hash, snapshot_row_count, snapshot_contract_version
)
SELECT
  shape.id,
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000007',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster',
  'synthetic-roster-file', 'Synthetic roster.xlsx', 'Roster', 'Roster!C5:E7',
  shape.metadata,
  jsonb_build_object('version', 1, 'sourceType', 'student_roster',
    'sourceFileId', 'synthetic-roster-file',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Roster', 'range', 'Roster!C5:E7', 'headerRow', 5))),
  1, repeat('5', 64), repeat('2', 64), 1, 'csf-normalized-import/v1'
FROM (
  VALUES
    -- A padded frozen staging id, which btrim made equal to the attachment.
    (
      'df300000-0000-4000-8000-000000000050'::uuid,
      jsonb_build_object(
        'id', ' df210000-0000-4000-8000-000000000001 ',
        'name', 'Synthetic roster.xlsx',
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'headRevisionId', repeat('5', 64),
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- An UPPERCASE frozen digest, which lower() folded into canonical evidence.
    (
      'df300000-0000-4000-8000-000000000051'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000001',
        'name', 'Synthetic roster.xlsx',
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'headRevisionId', upper(repeat('a', 64)),
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A padded frozen digest, which btrim repaired into the staged one.
    (
      'df300000-0000-4000-8000-000000000052'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000001',
        'name', 'Synthetic roster.xlsx',
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'headRevisionId', ' ' || repeat('5', 64),
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A frozen digest that is a JSON number rather than a digest at all.
    (
      'df300000-0000-4000-8000-000000000053'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000001',
        'name', 'Synthetic roster.xlsx',
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'headRevisionId', 55555,
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- Exact and complete: the fixture the consumption recheck is issued against.
    (
      'df300000-0000-4000-8000-000000000054'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000001',
        'name', 'Synthetic roster.xlsx',
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'headRevisionId', repeat('5', 64),
        'accessState', 'accessible', 'trashed', false
      )
    )
) AS shape(id, metadata);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_issue_uploaded_source_evidence(
      'df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000001', 'df200000-0000-4000-8000-000000000007', 'df300000-0000-4000-8000-000000000050')$$,
  '23514', NULL,
  'a padded frozen staging id is refused rather than trimmed into the attachment'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_issue_uploaded_source_evidence(
      'df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000001', 'df200000-0000-4000-8000-000000000007', 'df300000-0000-4000-8000-000000000051')$$,
  '23514', NULL,
  'an uppercase frozen digest is refused rather than folded into canonical sha256'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_issue_uploaded_source_evidence(
      'df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000001', 'df200000-0000-4000-8000-000000000007', 'df300000-0000-4000-8000-000000000052')$$,
  '23514', NULL,
  'a padded frozen digest is refused rather than trimmed into the staged one'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_issue_uploaded_source_evidence(
      'df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000001', 'df200000-0000-4000-8000-000000000007', 'df300000-0000-4000-8000-000000000053')$$,
  '23514', NULL,
  'a frozen digest that is a JSON number is not a digest'
);

-- The SOURCE's own recorded coordinates, held to the same rule. Each is written
-- by csf_attach_sheet_source_generation and must survive being re-read exactly;
-- restoring afterwards keeps every later assertion on the seeded attachment.
UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('stagingContentHash', ' ' || repeat('5', 64))
WHERE id = 'df200000-0000-4000-8000-000000000007';

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_issue_uploaded_source_evidence(
      'df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000001', 'df200000-0000-4000-8000-000000000007', 'df300000-0000-4000-8000-000000000054')$$,
  '23514', NULL,
  'a padded attached digest is refused rather than trimmed into a sha256 digest'
);

UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('stagingContentHash', upper(repeat('a', 64)))
WHERE id = 'df200000-0000-4000-8000-000000000007';

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_issue_uploaded_source_evidence(
      'df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000001', 'df200000-0000-4000-8000-000000000007', 'df300000-0000-4000-8000-000000000054')$$,
  '23514', NULL,
  'an uppercase attached digest is refused rather than lowercased into canonical evidence'
);

UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object(
      'stagingContentHash', repeat('5', 64),
      'stagingObjectId', ' df210000-0000-4000-8000-000000000001 '
    )
WHERE id = 'df200000-0000-4000-8000-000000000007';

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_issue_uploaded_source_evidence(
      'df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000001', 'df200000-0000-4000-8000-000000000007', 'df300000-0000-4000-8000-000000000054')$$,
  '55000', NULL,
  'a padded attached staging object id is refused rather than trimmed into a uuid'
);

UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('stagingObjectId', 'df210000-0000-4000-8000-000000000001')
WHERE id = 'df200000-0000-4000-8000-000000000007';

-- Consumption re-checks the attachment against the receipt, and it re-checks it
-- EXACTLY. `lower(btrim(...))` here folded an uppercase recorded digest back
-- into the digest the receipt attested to, so a source whose recorded evidence
-- had been rewritten still spent a receipt that never named it.
SELECT extensions.is(
  plugin_data.csf_issue_uploaded_source_evidence(
    'df100000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000001', 'df200000-0000-4000-8000-000000000007',
    'df300000-0000-4000-8000-000000000054') ->> 'provider',
  'uploaded_xlsx',
  'an exact uploaded attachment still issues its receipt'
);

UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('stagingContentHash', upper(repeat('a', 64)))
WHERE id = 'df200000-0000-4000-8000-000000000007';

SELECT extensions.throws_ok(
  format($$SELECT plugin_data.csf_consume_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001', 'df200000-0000-4000-8000-000000000007', 'df000000-0000-4000-8000-000000000001',
      %L, 'df300000-0000-4000-8000-000000000054')$$,
    (SELECT nonce FROM plugin_data.csf_sheet_source_evidence_tokens
     WHERE preview_job_id = 'df300000-0000-4000-8000-000000000054'
     ORDER BY evidence_generation DESC LIMIT 1)),
  '40001', NULL,
  'an uppercase recorded digest is refused at consumption rather than folded back into the receipt'
);

SELECT extensions.is(
  (SELECT consumed_at FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE preview_job_id = 'df300000-0000-4000-8000-000000000054'
   ORDER BY evidence_generation DESC LIMIT 1),
  NULL,
  'and refusing it does not consume it'
);

UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('stagingContentHash', repeat('5', 64))
WHERE id = 'df200000-0000-4000-8000-000000000007';

-- With the exact attachment restored the same receipt spends normally, which is
-- what makes the refusal above a statement about the digest rather than about
-- anything else that moved. It also leaves no unconsumed receipt behind for this
-- source, so the provider/MIME assertions further down still read the one they
-- were written against.
SELECT extensions.is(
  (SELECT plugin_data.csf_consume_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df000000-0000-4000-8000-000000000001',
      (SELECT nonce FROM plugin_data.csf_sheet_source_evidence_tokens
       WHERE preview_job_id = 'df300000-0000-4000-8000-000000000054'
       ORDER BY evidence_generation DESC LIMIT 1),
      'df300000-0000-4000-8000-000000000054') ->> 'consumed'),
  'true',
  'and the exact attachment spends the same receipt once the digest is itself again'
);

-- ===========================================================================
-- The exact evidence contract, one independent refusal at a time.
--
-- Everything below exists because the previous form of this issuer compared two
-- of its four coordinates CONDITIONALLY -- `IF v_frozen_mime IS NOT NULL`, `IF
-- v_preview.source_modified_at IS NOT NULL` -- so a preview that never froze one
-- of them skipped that comparison entirely and still received a receipt. A
-- comparison a missing value switches off is not a check.
--
-- It also asked a native Google Sheet for a `headRevisionId`. Google's Drive v3
-- `files` resource documents headRevisionId as available only for binary content
-- and checksums as unpopulated for Docs Editors files, so a Sheet never has one;
-- `headRevisionId ?? modifiedTime` therefore resolved to the modification time,
-- and the receipt stored that time twice under two names. Two coordinates that
-- are the same value cannot disagree, which made "edited inside one timestamp
-- granule" undetectable -- the one case the pair existed to catch. The provider
-- coordinate a Sheet actually exposes is `version`, and that is what is proved
-- here.
--
-- Each case gets its own preview job: `source_file_metadata` is immutable by
-- trigger, so a shared fixture cannot be mutated into the shape under test.
-- ===========================================================================

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  drive_access_state, drive_trashed, drive_file_id, drive_file_name,
  drive_mime_type, drive_modified_at, settings
) VALUES (
  'df200000-0000-4000-8000-000000000008',
  'df100000-0000-4000-8000-000000000001',
  'application_responses',
  'Synthetic exact-evidence source',
  'df150000-0000-4000-8000-000000000001',
  'google_sheets',
  'accessible', false, 'synthetic-evidence-file', 'Synthetic evidence sheet',
  'application/vnd.google-apps.spreadsheet',
  '2026-07-05T00:00:00Z',
  '{"sourceKind":"application_responses"}'::jsonb
);

-- Nine previews of that one source, each frozen with exactly one coordinate
-- missing, unparseable, disagreeing, or drifted. `...0020` is the complete one
-- every live-value case is run against.
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
)
SELECT
  shape.id,
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000008',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'application_responses',
  'synthetic-evidence-file', 'Synthetic evidence sheet', 'Responses', 'Responses!A1:Z9',
  shape.modified_at,
  shape.metadata || jsonb_build_object('sourceProvider', 'google_sheets'),
  jsonb_build_object(
    'version', 1, 'sourceType', 'application_responses',
    'sourceFileId', 'synthetic-evidence-file',
    'sourceProvider', 'google_sheets',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Responses', 'range', 'Responses!A1:Z9', 'headerRow', 1)
    )
  ),
  1, repeat('9', 64), repeat('a', 64), 1, 'csf-normalized-import/v1'
FROM (
  VALUES
    -- Complete, and deliberately carrying NO headRevisionId: this is what a real
    -- native Sheet looks like, and it must succeed.
    (
      'df300000-0000-4000-8000-000000000020'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- No frozen file id.
    (
      'df300000-0000-4000-8000-000000000021'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- No frozen MIME. This is the case the old `IF v_frozen_mime IS NOT NULL`
    -- silently allowed through.
    (
      'df300000-0000-4000-8000-000000000022'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- No frozen modified time.
    (
      'df300000-0000-4000-8000-000000000023'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- No frozen provider version.
    (
      'df300000-0000-4000-8000-000000000024'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A frozen modified time that is present but not a timestamp. It must be a
    -- named refusal, never a cast error escaping the function.
    (
      'df300000-0000-4000-8000-000000000025'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', 'the fifth of July',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- The preview's own two records of the modification time disagree.
    (
      'df300000-0000-4000-8000-000000000026'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-06T00:00:00Z',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- Complete but frozen against a DIFFERENT MIME. With the comparison now
    -- unconditional this is a refusal; before, a null MIME was the only way to
    -- reach the comparison at all.
    (
      'df300000-0000-4000-8000-000000000027'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.document',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- Complete, frozen against a different file.
    (
      'df300000-0000-4000-8000-000000000028'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'some-other-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- ------------------------------------------------------------------
    -- Exactness. Every shape below was ACCEPTED before this correction,
    -- because the issuer read each frozen coordinate through `btrim` and a
    -- padded value was repaired into the one it was about to be compared
    -- with. A coordinate with a stray space is not that coordinate.
    -- ------------------------------------------------------------------
    -- A padded frozen file id. `btrim` made this equal to the live answer.
    (
      'df300000-0000-4000-8000-000000000029'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', ' synthetic-evidence-file ',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A frozen file id that is a JSON number. `->>` renders it as text that
    -- every string check downstream would then accept.
    (
      'df300000-0000-4000-8000-00000000002a'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 41,
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A padded frozen MIME.
    (
      'df300000-0000-4000-8000-00000000002b'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet ',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A frozen MIME that is a JSON number.
    (
      'df300000-0000-4000-8000-00000000002c'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 41,
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- Hour 24. PostgreSQL reads `2026-07-05T24:00:00Z` as the next day's
    -- midnight rather than refusing it, and this preview's own column records
    -- exactly that neighbour -- so before the shape check the cast produced a
    -- coherent instant and the refresh below issued a receipt for an hour the
    -- provider never reported.
    (
      'df300000-0000-4000-8000-00000000002d'::uuid,
      '2026-07-06T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-05T24:00:00Z',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A whitespace-padded frozen timestamp. PostgreSQL tolerates surrounding
    -- whitespace in timestamp input and `btrim` removed it besides, so this
    -- parsed, agreed with everything, and was issued a receipt.
    (
      'df300000-0000-4000-8000-00000000002e'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', ' 2026-07-05T00:00:00Z',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A day that does not exist. This one the guarded cast catches on its own,
    -- and it is kept so the calendar rule is proved rather than assumed.
    (
      'df300000-0000-4000-8000-00000000002f'::uuid,
      '2026-03-02T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-02-30T00:00:00Z',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- No timezone at all: a local-looking timestamp names no instant, so the
    -- cast has to invent a zone to read it.
    (
      'df300000-0000-4000-8000-000000000055'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-05 00:00:00',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A padded frozen provider version, which `btrim` made equal to the live one.
    (
      'df300000-0000-4000-8000-000000000056'::uuid,
      '2026-07-05T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', ' 58',
        'accessState', 'accessible', 'trashed', false
      )
    )
) AS shape(id, modified_at, metadata);

-- Every frozen-coordinate refusal, one per missing coordinate.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000021',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a preview that froze no provider file id cannot receive a Google receipt'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000022',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a preview that froze no MIME is refused rather than having the comparison skipped'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000023',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a preview that froze no modified time is refused rather than having the comparison skipped'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000024',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a preview that froze no provider version cannot receive a Google receipt'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000025',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'an unparseable frozen modified time is a named refusal, not a cast error'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000026',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a preview whose own two records of the modified time disagree is refused'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000027',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a live MIME that differs from the frozen one is refused'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000028',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a live file id that differs from the frozen one is refused'
);

-- Live drift against the complete preview, coordinate by coordinate.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-06T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a live modified time that moved past the frozen one is refused'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '59', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'an unchanged modified time beside an advanced provider version is refused'
);

-- Malformed live versions. Each is its own shape of "not a canonical unsigned
-- decimal int64", each is written as its own statement -- one pgTAP assertion
-- per statement is what keeps `plan(N)` checkable by reading the file -- and each
-- must refuse rather than be coerced into a number.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '', false, 'accessible', 'Synthetic evidence sheet')$$,
  '22023', NULL,
  'a blank provider version is malformed evidence and refuses'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '   ', false, 'accessible', 'Synthetic evidence sheet')$$,
  '22023', NULL,
  'a whitespace-only provider version refuses'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', 'not-a-number', false, 'accessible', 'Synthetic evidence sheet')$$,
  '22023', NULL,
  'a non-numeric provider version refuses'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '-1', false, 'accessible', 'Synthetic evidence sheet')$$,
  '22023', NULL,
  'a negative provider version refuses'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '+7', false, 'accessible', 'Synthetic evidence sheet')$$,
  '22023', NULL,
  'a signed provider version refuses'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '0', false, 'accessible', 'Synthetic evidence sheet')$$,
  '22023', NULL,
  'a zero provider version is not a positive version and refuses'
);

-- `007` and `7` are the same integer and different evidence. This value is only
-- ever compared for exact equality, so a non-canonical spelling is refused
-- rather than normalized into one that would silently compare unequal.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '058', false, 'accessible', 'Synthetic evidence sheet')$$,
  '22023', NULL,
  'a leading-zero provider version refuses rather than being normalized'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '5.0', false, 'accessible', 'Synthetic evidence sheet')$$,
  '22023', NULL,
  'a non-integer provider version refuses'
);

-- The int64 ceiling, exactly. One past it, and far past it.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '9223372036854775808', false, 'accessible',
      'Synthetic evidence sheet')$$,
  '22023', NULL,
  'a provider version one past the int64 ceiling overflows and refuses'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        'df200000-0000-4000-8000-000000000008',
        'df300000-0000-4000-8000-000000000020',
        (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
          WHERE id = 'df200000-0000-4000-8000-000000000008'),
        'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
        '2026-07-05T00:00:00Z', %L, false, 'accessible', 'Synthetic evidence sheet')$$,
    repeat('9', 25)
  ),
  '22023', NULL,
  'a twenty-five digit provider version exceeds its bound and refuses'
);

-- A null provider version is the null-evidence refusal, not a malformed one.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', NULL, false, 'accessible', 'Synthetic evidence sheet')$$,
  '22023', NULL,
  'a null provider version is a refusal, not a value'
);

-- Bounded, trim-required live file id and file name.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      '', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '22023', NULL,
  'a blank live file id is unusable identity and refuses'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      '    ', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '22023', NULL,
  'a whitespace-only live file id refuses rather than being trimmed into nothing'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        'df200000-0000-4000-8000-000000000008',
        'df300000-0000-4000-8000-000000000020',
        (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
          WHERE id = 'df200000-0000-4000-8000-000000000008'),
        %L, 'application/vnd.google-apps.spreadsheet',
        '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
    repeat('f', 513)
  ),
  '22023', NULL,
  'a live file id past its length bound refuses'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', '')$$,
  '22023', NULL,
  'a blank live file name is unusable provenance and refuses'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', '    ')$$,
  '22023', NULL,
  'a whitespace-only live file name refuses'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
        'df100000-0000-4000-8000-000000000001',
        'df000000-0000-4000-8000-000000000001',
        'df200000-0000-4000-8000-000000000008',
        'df300000-0000-4000-8000-000000000020',
        (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
          WHERE id = 'df200000-0000-4000-8000-000000000008'),
        'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
        '2026-07-05T00:00:00Z', '58', false, 'accessible', %L)$$,
    repeat('n', 1025)
  ),
  '22023', NULL,
  'a live file name past its length bound refuses'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', NULL)$$,
  '22023', NULL,
  'a null file name is incomplete provider evidence'
);

-- The live MIME must be EXACTLY the Google Sheets MIME. A Doc and a folder share
-- its `application/vnd.google-apps` family, an uploaded workbook's MIME is a
-- different family entirely, and a trailing space is a different string --
-- exactness is what makes all four the same answer.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.document',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a live Google Doc MIME is not a Google Sheet'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.folder',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a live Drive folder MIME is not a Google Sheet'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet ',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a live Sheets MIME with a trailing space is not the exact Sheets MIME'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'text/csv',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a live CSV MIME cannot receive a Google Sheets receipt'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a live XLSX MIME cannot receive a Google Sheets receipt'
);

-- Trash and access state, exactly.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', true, 'accessible', 'Synthetic evidence sheet')$$,
  '55000', NULL,
  'a trashed file cannot have its evidence refreshed'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', NULL, 'accessible', 'Synthetic evidence sheet')$$,
  '22023', NULL,
  'an unstated trash state is not "not trashed"'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'unknown', 'Synthetic evidence sheet')$$,
  '55000', NULL,
  'an unknown access state is not exactly accessible'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'reconnect_required', 'Synthetic evidence sheet')$$,
  '55000', NULL,
  'a reconnect-required access state is not exactly accessible'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'Accessible', 'Synthetic evidence sheet')$$,
  '55000', NULL,
  'a differently-cased access state is not exactly accessible'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible ', 'Synthetic evidence sheet')$$,
  '55000', NULL,
  'an access state with a trailing space is not exactly accessible'
);

-- ---------------------------------------------------------------------------
-- Exactness, at the issuer.
--
-- Each case below was ACCEPTED before this correction. `btrim` on the way in
-- repaired a padded coordinate into the one it was about to be compared with,
-- so a provider answer or a frozen coordinate that is not the coordinate
-- reached agreement and was issued a receipt. The `count(*) = 0` and
-- `evidence_generation = 0` assertions that follow are what prove these are
-- refusals rather than messages.
-- ---------------------------------------------------------------------------
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000029',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a padded frozen file id is refused rather than trimmed into the live one'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-00000000002a',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a frozen file id that is a JSON number is not the coordinate at all'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-00000000002b',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a padded frozen MIME is refused rather than trimmed into the exact Sheets MIME'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-00000000002c',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a frozen MIME that is a JSON number is not the coordinate at all'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-00000000002d',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-06T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'an hour-24 frozen timestamp is refused rather than read as the next days midnight'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-00000000002e',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a whitespace-padded frozen timestamp is refused rather than trimmed into a valid instant'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-00000000002f',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-03-02T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a frozen February 30 is refused by the guarded cast rather than raising out of the issuer'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000055',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a frozen timestamp with no timezone names no instant and is refused'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000056',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '23514', NULL,
  'a padded frozen provider version is refused rather than trimmed into the live one'
);

-- The provider's own answer, held to the same rule. A padded file id or version
-- is rejected, not canonicalized: canonicalizing it made a wrong answer compare
-- equal to the frozen coordinate it is supposed to be checked against.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      ' synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '22023', NULL,
  'a padded provider file id is rejected rather than canonicalized into the frozen one'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df300000-0000-4000-8000-000000000020',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-000000000008'),
      'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-05T00:00:00Z', ' 58', false, 'accessible', 'Synthetic evidence sheet')$$,
  '22023', NULL,
  'a padded provider version is rejected rather than canonicalized into the frozen one'
);

-- Nothing above issued anything. A refusal that still minted a receipt, or still
-- moved the source's evidence generation, would be a refusal in message only.
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE source_id = 'df200000-0000-4000-8000-000000000008'),
  0,
  'no refused exact-evidence call issued a receipt'
);

SELECT extensions.is(
  (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
   WHERE id = 'df200000-0000-4000-8000-000000000008'),
  0::bigint,
  'and none of them advanced the source evidence generation'
);

-- The positive case: a native Google Sheet with NO head revision and NO checksum
-- -- which is every native Google Sheet -- issues a receipt on `version` alone.
SELECT extensions.is(
  plugin_data.csf_refresh_sheet_source_evidence(
    'df100000-0000-4000-8000-000000000001',
    'df000000-0000-4000-8000-000000000001',
    'df200000-0000-4000-8000-000000000008',
    'df300000-0000-4000-8000-000000000020',
    (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
      WHERE id = 'df200000-0000-4000-8000-000000000008'),
    'synthetic-evidence-file', 'application/vnd.google-apps.spreadsheet',
    '2026-07-05T00:00:00Z', '58', false, 'accessible', 'Synthetic evidence sheet'
  ) ->> 'provider',
  'google_sheets',
  'a native Sheet with no head revision issues a receipt on its provider version'
);

SELECT extensions.is(
  (SELECT provider_version FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE source_id = 'df200000-0000-4000-8000-000000000008'
   ORDER BY evidence_generation DESC LIMIT 1),
  '58',
  'and the receipt records the provider version rather than a second copy of the modified time'
);

SELECT extensions.isnt(
  (SELECT provider_version FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE source_id = 'df200000-0000-4000-8000-000000000008'
   ORDER BY evidence_generation DESC LIMIT 1),
  to_char(
    timestamptz '2026-07-05T00:00:00Z' AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ),
  'the receipt freshness coordinate is not the modification time under another name'
);

-- ===========================================================================
-- The SQL claim preflight, held to the SAME exact coordinates as the receipt.
--
-- The receipt above stays the final live-provider authority -- only a fresh Drive
-- read can say what the file is right now. But the readiness gate runs first, and
-- it must never call incomplete or already-drifted evidence ready. It previously
-- did: for a Google source it read `headRevisionId` as "the revision", and a
-- native Sheet has none, so it compared null against null and never looked at
-- `version` at all. A missing frozen MIME, a missing modified time and a missing
-- server-issued version were likewise all "ready".
--
-- Every case below reuses the exact-evidence fixtures the receipt assertions were
-- written against, so the two gates are demonstrably reading the same evidence.
-- The successful refresh above stored `evidenceRevision` = '58' on the source,
-- which is precisely the ordering the claim relies on: this function runs inside
-- `csf_claim_import_commit_attempt` AFTER `csf_consume_sheet_source_evidence`, so
-- the issuer has already persisted the current server-read version.
--
-- These fixtures carry no preview rows, so each assertion projects out ONLY the
-- source-evidence blockers rather than comparing the whole list.
-- ===========================================================================

-- Four more shapes the receipt suite has no equivalent of, because the receipt
-- takes its version as an argument while this gate reads a frozen one.
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
)
SELECT
  shape.id,
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000008',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'application_responses',
  'synthetic-evidence-file', 'Synthetic evidence sheet', 'Responses', 'Responses!A1:Z9',
  '2026-07-05T00:00:00Z',
  shape.metadata || jsonb_build_object('sourceProvider', 'google_sheets'),
  jsonb_build_object(
    'version', 1, 'sourceType', 'application_responses',
    'sourceFileId', 'synthetic-evidence-file',
    'sourceProvider', 'google_sheets',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Responses', 'range', 'Responses!A1:Z9', 'headerRow', 1)
    )
  ),
  1, repeat('9', 64), repeat('a', 64), 1, 'csf-normalized-import/v1'
FROM (
  VALUES
    -- A non-canonical version. `058` and `58` are the same integer and different
    -- evidence, and this value is only ever compared for exact equality, so the
    -- spelling is refused rather than normalized into one that would compare
    -- unequal to the server-issued coordinate for no visible reason.
    (
      'df300000-0000-4000-8000-000000000040'::uuid,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', '058',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- One past the int64 ceiling. A `::bigint` cast here would raise
    -- numeric_value_out_of_range out of a STABLE readiness function; the bound is
    -- decided on the text instead, so this is a bounded product blocker.
    (
      'df300000-0000-4000-8000-000000000041'::uuid,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', '9223372036854775808',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- The case ONLY the version can see: the modification time is identical to
    -- both the live source and the job's own column, and the contents still moved.
    (
      'df300000-0000-4000-8000-000000000042'::uuid,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', '59',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- Crossed the other way: an uploaded family's MIME frozen for a Google source.
    (
      'df300000-0000-4000-8000-000000000043'::uuid,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'text/csv',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', '58',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- Not a number at all. This is a DIFFERENT failure mode from the overflow
    -- above: a numeric cast would raise invalid_text_representation here and
    -- numeric_value_out_of_range there, and neither may escape this function.
    (
      'df300000-0000-4000-8000-000000000044'::uuid,
      jsonb_build_object(
        'id', 'synthetic-evidence-file',
        'name', 'Synthetic evidence sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-05T00:00:00Z',
        'version', 'fifty-eight',
        'accessState', 'accessible', 'trashed', false
      )
    )
) AS shape(id, metadata);

-- The complete native Sheet: exact id, exact MIME, agreeing modified times, and a
-- frozen version equal to the server-issued one. It carries NO headRevisionId,
-- because no native Sheet has one, and that must not cost it a single blocker.
SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(
      plugin_data.csf_import_preview_claim_blockers(
        'df100000-0000-4000-8000-000000000001',
        'df300000-0000-4000-8000-000000000020'
      )
    ) AS blocker
    WHERE blocker IN (
      'Run a fresh preview so this import records its source evidence.',
      'This source now points at a different file. Run a fresh preview.',
      'This source changed after it was previewed. Run a fresh preview.',
      'This source was replaced with a different kind of file. Run a fresh preview.',
      'A newer workbook was uploaded for this source. Run a fresh preview.',
      'Reconnect the source file before importing.'
    )
  ),
  ARRAY[]::text[],
  'a complete native Sheet preview carrying no headRevisionId raises no source-evidence blocker'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000021'
    )
  ),
  'a preview that froze no provider file id is not ready to claim'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000022'
    )
  ),
  'a preview that froze no MIME is not ready to claim'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000023'
    )
  ),
  'a preview that froze no modified time is not ready to claim'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000024'
    )
  ),
  'a preview that froze no provider version is not ready to claim'
);

-- An unparseable frozen timestamp must be a named blocker, never a cast error
-- escaping a STABLE function to its caller.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000025'
    )
  $$,
  'an unparseable frozen modified time returns a bounded blocker list rather than raising'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000025'
    )
  ),
  'an unparseable frozen modified time is missing evidence and blocks the claim'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000026'
    )
  ),
  'a preview whose own two records of the modified time disagree blocks the claim'
);

SELECT extensions.ok(
  'This source was replaced with a different kind of file. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000027'
    )
  ),
  'a Google Doc MIME frozen for a Google Sheets source blocks the claim'
);

SELECT extensions.ok(
  'This source now points at a different file. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000028'
    )
  ),
  'a frozen file id the source no longer names blocks the claim'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000040'
    )
  ),
  'a leading-zero frozen version is malformed evidence and blocks the claim'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000041'
    )
  $$,
  'a frozen version past the int64 ceiling returns a bounded blocker list rather than overflowing a cast'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000041'
    )
  ),
  'a frozen version past the int64 ceiling blocks the claim'
);

SELECT extensions.ok(
  'This source changed after it was previewed. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000042'
    )
  ),
  'an unchanged modified time beside a different provider version blocks the claim'
);

SELECT extensions.ok(
  'This source was replaced with a different kind of file. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000043'
    )
  ),
  'a CSV MIME frozen for a Google Sheets source blocks the claim'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000044'
    )
  $$,
  'a non-numeric frozen version returns a bounded blocker list rather than raising on a cast'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000044'
    )
  ),
  'a non-numeric frozen version blocks the claim'
);

-- The live side of each coordinate, mutated on the source and restored again.
UPDATE plugin_data.csf_sheet_sources
SET drive_mime_type = NULL
WHERE id = 'df200000-0000-4000-8000-000000000008';

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000020'
    )
  ),
  'a source that records no live MIME cannot be proved to still be a Sheet, and blocks'
);

UPDATE plugin_data.csf_sheet_sources
SET drive_mime_type = 'text/csv'
WHERE id = 'df200000-0000-4000-8000-000000000008';

SELECT extensions.ok(
  'This source was replaced with a different kind of file. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000020'
    )
  ),
  'a live MIME that is no longer the exact Sheets MIME blocks the claim'
);

UPDATE plugin_data.csf_sheet_sources
SET drive_mime_type = 'application/vnd.google-apps.spreadsheet'
WHERE id = 'df200000-0000-4000-8000-000000000008';

-- The server-issued version itself. A source with none has never had a receipt
-- issued against it, and this gate runs after the receipt was consumed -- so a
-- missing one is a contradiction, not a first run.
UPDATE plugin_data.csf_sheet_sources
SET settings = settings - 'evidenceRevision'
WHERE id = 'df200000-0000-4000-8000-000000000008';

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000020'
    )
  ),
  'a source carrying no server-issued evidenceRevision blocks the claim preflight'
);

UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('evidenceRevision', '58')
WHERE id = 'df200000-0000-4000-8000-000000000008';

-- A benign Drive rename, on the Google side. The name is provenance and is never
-- compared, so the complete preview is still free of source-evidence blockers.
UPDATE plugin_data.csf_sheet_sources
SET drive_file_name = 'Synthetic evidence sheet (renamed)',
    title = 'Synthetic exact-evidence source (renamed)'
WHERE id = 'df200000-0000-4000-8000-000000000008';

SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(
      plugin_data.csf_import_preview_claim_blockers(
        'df100000-0000-4000-8000-000000000001',
        'df300000-0000-4000-8000-000000000020'
      )
    ) AS blocker
    WHERE blocker IN (
      'Run a fresh preview so this import records its source evidence.',
      'This source now points at a different file. Run a fresh preview.',
      'This source changed after it was previewed. Run a fresh preview.',
      'This source was replaced with a different kind of file. Run a fresh preview.',
      'A newer workbook was uploaded for this source. Run a fresh preview.',
      'Reconnect the source file before importing.'
    )
  ),
  ARRAY[]::text[],
  'renaming a Google source raises no source-evidence blocker, and every live mutation above was restored'
);

-- ---------------------------------------------------------------------------
-- The uploaded receipt must require the CORRECT frozen MIME, not merely a
-- not-Google one. Three previews of the uploaded roster, each frozen with the
-- exact staging identity the issuer proves, and each with a different MIME.
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
)
SELECT
  shape.id,
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000007',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster',
  'df210000-0000-4000-8000-000000000001',
  'Synthetic roster.xlsx', 'Roster', 'Roster!C5:E7',
  now(),
  shape.metadata || jsonb_build_object(
    'sourceProvider', 'uploaded_xlsx',
    'stagingGeneration', 1,
    'readyAt', now()
  ),
  jsonb_build_object('version', 1, 'sourceType', 'student_roster',
    'sourceFileId', 'df210000-0000-4000-8000-000000000001',
    'sourceProvider', 'uploaded_xlsx',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Roster', 'range', 'Roster!C5:E7', 'headerRow', 5))),
  1, repeat('5', 64), repeat('2', 64), 1, 'csf-normalized-import/v1'
FROM (
  VALUES
    -- No MIME at all. The old `IF v_frozen_mime IS NOT NULL AND ... LIKE
    -- 'application/vnd.google-apps%'` let this through and issued a receipt.
    (
      'df300000-0000-4000-8000-000000000030'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000001',
        'name', 'Synthetic roster.xlsx',
        'headRevisionId', repeat('5', 64),
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- An unrelated MIME. Also not Google, so also previously accepted.
    (
      'df300000-0000-4000-8000-000000000031'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000001',
        'name', 'Synthetic roster.xlsx',
        'mimeType', 'application/pdf',
        'headRevisionId', repeat('5', 64),
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- Crossed between the two uploaded families: a CSV MIME frozen for a source
    -- registered as `uploaded_xlsx`. A CSV receipt and an XLSX receipt authorize
    -- different parsers over the same bytes.
    (
      'df300000-0000-4000-8000-000000000032'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000001',
        'name', 'Synthetic roster.xlsx',
        'mimeType', 'text/csv',
        'headRevisionId', repeat('5', 64),
        'accessState', 'accessible', 'trashed', false
      )
    )
) AS shape(id, metadata);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_issue_uploaded_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df300000-0000-4000-8000-000000000030')$$,
  '23514', NULL,
  'an uploaded preview that froze no MIME cannot receive a workbook receipt'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_issue_uploaded_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df300000-0000-4000-8000-000000000031')$$,
  '23514', NULL,
  'an uploaded preview frozen with an unrelated MIME is refused, not merely a Google one'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_issue_uploaded_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df300000-0000-4000-8000-000000000032')$$,
  '23514', NULL,
  'a CSV MIME frozen for an uploaded_xlsx source is a crossed provider and is refused'
);

-- ---------------------------------------------------------------------------
-- The same three MIME cases at the SQL claim preflight, plus the two that prove
-- an uploaded workbook's coordinate is its sha256 content digest and NOT a
-- borrowed provider version.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000030'
    )
  ),
  'an uploaded preview that froze no MIME is not ready to claim'
);

SELECT extensions.ok(
  'This source was replaced with a different kind of file. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000031'
    )
  ),
  'an uploaded preview frozen with an unrelated MIME blocks the claim, not merely a Google one'
);

SELECT extensions.ok(
  'This source was replaced with a different kind of file. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000032'
    )
  ),
  'a CSV MIME frozen for an uploaded_xlsx source blocks the claim'
);

-- Two more previews of the uploaded roster: one carrying a provider version it has
-- no business having, one whose digest is wrong while that version is right.
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
)
SELECT
  shape.id,
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000007',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster',
  'df210000-0000-4000-8000-000000000001',
  'Synthetic roster.xlsx', 'Roster', 'Roster!C5:E7',
  now(),
  shape.metadata || jsonb_build_object(
    'sourceProvider', 'uploaded_xlsx',
    'stagingGeneration', 1,
    'readyAt', now()
  ),
  jsonb_build_object('version', 1, 'sourceType', 'student_roster',
    'sourceFileId', 'df210000-0000-4000-8000-000000000001',
    'sourceProvider', 'uploaded_xlsx',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Roster', 'range', 'Roster!C5:E7', 'headerRow', 5))),
  -- Bound to the attachment's digest, so each shape below isolates the ONE
  -- coordinate it mutates instead of also failing on a job column that
  -- disagreed with every other record of the same bytes.
  1, repeat('5', 64), repeat('2', 64), 1, 'csf-normalized-import/v1'
FROM (
  VALUES
    -- Exact staging identity and digest in the current uploaded provenance
    -- shape. An uploaded workbook has no provider version, so a current preview
    -- records only its staged generation, ready time and content digest.
    (
      'df300000-0000-4000-8000-000000000033'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000001',
        'name', 'Synthetic roster.xlsx',
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'headRevisionId', repeat('5', 64),
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- The inverse: a `version` that happens to spell the attached digest, beside
    -- a headRevisionId that does not. If the gate ever accepted `version` as an
    -- uploaded coordinate this would pass, and it must not.
    (
      'df300000-0000-4000-8000-000000000034'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000001',
        'name', 'Synthetic roster.xlsx',
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'headRevisionId', repeat('7', 64),
        'version', repeat('5', 64),
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A padded frozen staging id, which btrim made equal to the attachment.
    (
      'df300000-0000-4000-8000-000000000057'::uuid,
      jsonb_build_object(
        'id', ' df210000-0000-4000-8000-000000000001 ',
        'name', 'Synthetic roster.xlsx',
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'headRevisionId', repeat('5', 64),
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A padded frozen MIME, which btrim made equal to the MIME this provider owns.
    (
      'df300000-0000-4000-8000-000000000058'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000001',
        'name', 'Synthetic roster.xlsx',
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet ',
        'headRevisionId', repeat('5', 64),
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A padded frozen digest, which btrim repaired into the attached one.
    (
      'df300000-0000-4000-8000-000000000037'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000001',
        'name', 'Synthetic roster.xlsx',
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'headRevisionId', ' ' || repeat('5', 64),
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- An uppercase frozen digest: the right bytes in a spelling nothing wrote.
    (
      'df300000-0000-4000-8000-000000000038'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000001',
        'name', 'Synthetic roster.xlsx',
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'headRevisionId', upper(repeat('a', 64)),
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A frozen digest that is a JSON number rather than a digest at all.
    (
      'df300000-0000-4000-8000-000000000039'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000001',
        'name', 'Synthetic roster.xlsx',
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'headRevisionId', 55555,
        'accessState', 'accessible', 'trashed', false
      )
    )
) AS shape(id, metadata);

-- ---------------------------------------------------------------------------
-- Exactness, at the claim gate, for the uploaded family.
--
-- Each shape below reached the gate through `btrim` and compared EQUAL to the
-- coordinate it was supposed to be checked against. A coordinate with a stray
-- space is not that coordinate, and the right bytes in the wrong case are not
-- the canonical digest.
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000057'
    )
  ),
  'a padded frozen staging id blocks rather than being trimmed into the attachment'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000058'
    )
  ),
  'a padded frozen uploaded MIME blocks rather than being trimmed into the owned MIME'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000037'
    )
  ),
  'a padded frozen uploaded digest blocks rather than being trimmed into the attached one'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000038'
    )
  ),
  'an uppercase frozen uploaded digest blocks rather than being folded into canonical evidence'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000039'
    )
  ),
  'a frozen uploaded digest that is a JSON number blocks rather than being read as text'
);

-- The ATTACHMENT's own recorded digest, re-read exactly and restored afterwards.
-- `btrim` here repaired a padded recorded digest into the canonical one, so a
-- source whose settings are not what the attachment wrote passed the gate.
UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('stagingContentHash', ' ' || repeat('5', 64))
WHERE id = 'df200000-0000-4000-8000-000000000007';

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000033'
    )
  ),
  'a padded attached digest blocks rather than being trimmed into canonical evidence'
);

UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('stagingContentHash', 55555)
WHERE id = 'df200000-0000-4000-8000-000000000007';

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000033'
    )
  ),
  'an attached digest that is a JSON number blocks rather than being rendered into text'
);

UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('stagingContentHash', repeat('5', 64))
WHERE id = 'df200000-0000-4000-8000-000000000007';

-- ===========================================================================
-- Exactness and the real calendar, at the claim gate, for the Google family.
--
-- Two fail-open normalizations lived here.
--
--   * `btrim` on the way in repaired a padded frozen id, MIME or version into
--     the coordinate it was about to be compared with, so evidence that is not
--     the coordinate reached agreement with the live source.
--
--   * `modifiedTime` was cast straight to timestamptz. PostgreSQL refuses an
--     impossible calendar DATE -- February 30, a non-leap February 29, April 31
--     -- but it reads `24:00:00` as the next day's midnight, `:60` as the next
--     minute, tolerates surrounding whitespace, and reads a timestamp with no
--     offset as local time. Each of those becomes an instant the provider never
--     reported, and this source records exactly the neighbour they normalize
--     to, so before the strict shape check every one of them agreed.
--
-- Two purpose-built sources, so no fixture has to be mutated into shape and no
-- existing assertion's live coordinates move.
-- ===========================================================================
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  drive_access_state, drive_trashed, drive_file_id, drive_file_name,
  drive_mime_type, drive_modified_at, settings
) VALUES (
  'df200000-0000-4000-8000-00000000000c',
  'df100000-0000-4000-8000-000000000001',
  'application_responses',
  'Synthetic normalized-neighbour source',
  'df150000-0000-4000-8000-000000000001',
  'google_sheets',
  'accessible', false, 'synthetic-normalized-file', 'Synthetic normalized sheet',
  'application/vnd.google-apps.spreadsheet',
  -- The instant every counterexample below normalizes to.
  '2026-07-02T00:00:00Z',
  jsonb_build_object('sourceKind', 'application_responses', 'evidenceRevision', '41')
), (
  'df200000-0000-4000-8000-00000000000d',
  'df100000-0000-4000-8000-000000000001',
  'application_responses',
  'Synthetic leap-day source',
  'df150000-0000-4000-8000-000000000001',
  'google_sheets',
  'accessible', false, 'synthetic-leap-file', 'Synthetic leap-day sheet',
  'application/vnd.google-apps.spreadsheet',
  -- A real leap day, with a fractional second, so the passing cases prove the
  -- calendar rule does not overreach.
  '2028-02-29T00:00:00.500Z',
  jsonb_build_object('sourceKind', 'application_responses', 'evidenceRevision', '41')
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
)
SELECT
  shape.id,
  'df100000-0000-4000-8000-000000000001',
  shape.source_id,
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'application_responses',
  shape.file_id, 'Synthetic normalized sheet', 'Responses', 'Responses!A1:Z9',
  shape.modified_at,
  shape.metadata || jsonb_build_object('sourceProvider', 'google_sheets'),
  jsonb_build_object(
    'version', 1, 'sourceType', 'application_responses',
    'sourceFileId', shape.file_id,
    'sourceProvider', 'google_sheets',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Responses', 'range', 'Responses!A1:Z9', 'headerRow', 1)
    )
  ),
  1, repeat('9', 64), repeat('a', 64), 1, 'csf-normalized-import/v1'
FROM (
  VALUES
    -- A padded frozen file id, which btrim made equal to the live Drive id.
    (
      'df320000-0000-4000-8000-000000000001'::uuid,
      'df200000-0000-4000-8000-00000000000c'::uuid,
      'synthetic-normalized-file',
      '2026-07-02T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', ' synthetic-normalized-file ',
        'name', 'Synthetic normalized sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-02T00:00:00Z',
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A frozen file id that is a JSON number, which ->> renders into usable text.
    (
      'df320000-0000-4000-8000-000000000002'::uuid,
      'df200000-0000-4000-8000-00000000000c'::uuid,
      'synthetic-normalized-file',
      '2026-07-02T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 41,
        'name', 'Synthetic normalized sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-02T00:00:00Z',
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A padded frozen MIME, which btrim made equal to the exact Sheets MIME.
    (
      'df320000-0000-4000-8000-000000000003'::uuid,
      'df200000-0000-4000-8000-00000000000c'::uuid,
      'synthetic-normalized-file',
      '2026-07-02T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-normalized-file',
        'name', 'Synthetic normalized sheet',
        'mimeType', ' application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-02T00:00:00Z',
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A frozen MIME that is a JSON number rather than a MIME.
    (
      'df320000-0000-4000-8000-000000000004'::uuid,
      'df200000-0000-4000-8000-00000000000c'::uuid,
      'synthetic-normalized-file',
      '2026-07-02T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-normalized-file',
        'name', 'Synthetic normalized sheet',
        'mimeType', 41,
        'modifiedTime', '2026-07-02T00:00:00Z',
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A padded frozen version, which btrim made equal to the server-issued one.
    (
      'df320000-0000-4000-8000-000000000005'::uuid,
      'df200000-0000-4000-8000-00000000000c'::uuid,
      'synthetic-normalized-file',
      '2026-07-02T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-normalized-file',
        'name', 'Synthetic normalized sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-02T00:00:00Z',
        'version', ' 41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- Hour 24: read as the next days midnight, which is exactly what this source records.
    (
      'df320000-0000-4000-8000-000000000006'::uuid,
      'df200000-0000-4000-8000-00000000000c'::uuid,
      'synthetic-normalized-file',
      '2026-07-02T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-normalized-file',
        'name', 'Synthetic normalized sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-01T24:00:00Z',
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A leap second: rolled into the next minute, which is the same neighbour.
    (
      'df320000-0000-4000-8000-000000000007'::uuid,
      'df200000-0000-4000-8000-00000000000c'::uuid,
      'synthetic-normalized-file',
      '2026-07-02T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-normalized-file',
        'name', 'Synthetic normalized sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-01T23:59:60Z',
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- Surrounding whitespace, which btrim removed and the cast tolerates anyway.
    (
      'df320000-0000-4000-8000-000000000008'::uuid,
      'df200000-0000-4000-8000-00000000000c'::uuid,
      'synthetic-normalized-file',
      '2026-07-02T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-normalized-file',
        'name', 'Synthetic normalized sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', ' 2026-07-02T00:00:00Z',
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- No timezone at all: a local-looking timestamp names no instant.
    (
      'df320000-0000-4000-8000-000000000009'::uuid,
      'df200000-0000-4000-8000-00000000000c'::uuid,
      'synthetic-normalized-file',
      '2026-07-02T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-normalized-file',
        'name', 'Synthetic normalized sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-02 00:00:00',
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- Trailing prose after an otherwise exact instant.
    (
      'df320000-0000-4000-8000-00000000000a'::uuid,
      'df200000-0000-4000-8000-00000000000c'::uuid,
      'synthetic-normalized-file',
      '2026-07-02T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-normalized-file',
        'name', 'Synthetic normalized sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-02T00:00:00Z probably',
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- February 30, paired with the March 2 a normalizing reader would answer with.
    (
      'df320000-0000-4000-8000-00000000000b'::uuid,
      'df200000-0000-4000-8000-00000000000c'::uuid,
      'synthetic-normalized-file',
      '2026-03-02T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-normalized-file',
        'name', 'Synthetic normalized sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-02-30T00:00:00Z',
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- February 29 in a non-leap year, paired with the March 1 beside it.
    (
      'df320000-0000-4000-8000-00000000000c'::uuid,
      'df200000-0000-4000-8000-00000000000c'::uuid,
      'synthetic-normalized-file',
      '2025-03-01T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-normalized-file',
        'name', 'Synthetic normalized sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2025-02-29T00:00:00Z',
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- April 31, paired with the May 1 beside it.
    (
      'df320000-0000-4000-8000-00000000000d'::uuid,
      'df200000-0000-4000-8000-00000000000c'::uuid,
      'synthetic-normalized-file',
      '2026-05-01T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-normalized-file',
        'name', 'Synthetic normalized sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-04-31T00:00:00Z',
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A frozen modified time that is a JSON number rather than provider text.
    (
      'df320000-0000-4000-8000-00000000000e'::uuid,
      'df200000-0000-4000-8000-00000000000c'::uuid,
      'synthetic-normalized-file',
      '2026-07-02T00:00:00Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-normalized-file',
        'name', 'Synthetic normalized sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', 1782000000000,
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A REAL leap day with a fractional second. This must pass.
    (
      'df320000-0000-4000-8000-000000000010'::uuid,
      'df200000-0000-4000-8000-00000000000d'::uuid,
      'synthetic-leap-file',
      '2028-02-29T00:00:00.500Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-leap-file',
        'name', 'Synthetic normalized sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2028-02-29T00:00:00.500Z',
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- The SAME instant, spelled the way the provider actually spells it.
    --
    -- This fixture used to be `2028-02-28T16:00:00.500-08:00` and expected no
    -- blocker, which contradicted the canonical grammar the same suite asserts
    -- elsewhere: Drive emits UTC `Z` with 0, 3, 6 or 9 fractional digits and
    -- never a numeric offset, and the newer offset test correctly blocks one. A
    -- suite cannot both refuse a spelling and require it to pass, so the older
    -- control is converted to the exact equivalent canonical instant rather than
    -- the refusal being weakened.
    (
      'df320000-0000-4000-8000-000000000011'::uuid,
      'df200000-0000-4000-8000-00000000000d'::uuid,
      'synthetic-leap-file',
      '2028-02-29T00:00:00.500Z'::timestamptz,
      jsonb_build_object(
        'id', 'synthetic-leap-file',
        'name', 'Synthetic normalized sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2028-02-29T00:00:00.500Z',
        'version', '41',
        'accessState', 'accessible', 'trashed', false
      )
    )
) AS shape(id, source_id, file_id, modified_at, metadata);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-000000000001'
    )
  ),
  'a padded frozen Google file id blocks rather than being trimmed into the live id'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-000000000002'
    )
  ),
  'a frozen Google file id that is a JSON number blocks rather than being rendered into text'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-000000000003'
    )
  ),
  'a padded frozen Google MIME blocks rather than being trimmed into the exact Sheets MIME'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-000000000004'
    )
  ),
  'a frozen Google MIME that is a JSON number blocks'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-000000000005'
    )
  ),
  'a padded frozen Google version blocks rather than being trimmed into the server-issued one'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-000000000006'
    )
  ),
  'an hour-24 frozen instant blocks even when the source records the next days midnight'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-000000000007'
    )
  ),
  'a leap-second frozen instant blocks even when the source records the next minute'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-000000000008'
    )
  ),
  'a whitespace-padded frozen instant blocks rather than being trimmed into a valid one'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-000000000009'
    )
  ),
  'a frozen timestamp with no timezone blocks rather than being read as local time'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-00000000000a'
    )
  ),
  'a frozen instant with trailing prose blocks'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-00000000000b'
    )
  ),
  'February 30 blocks even when the source records the March 2 beside it'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-00000000000c'
    )
  ),
  'a non-leap February 29 blocks even when the source records the March 1 beside it'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-00000000000d'
    )
  ),
  'April 31 blocks even when the source records the May 1 beside it'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-00000000000e'
    )
  ),
  'a frozen modified time that is a JSON number blocks'
);

-- An impossible calendar date reaches a guarded cast, and the guard is what
-- keeps this STABLE function returning a blocker list instead of raising
-- date/time field value out of range at its caller.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-00000000000b'
    )
  $$,
  'February 30 returns a bounded blocker list rather than raising out of the STABLE gate'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-00000000000c'
    )
  $$,
  'a non-leap February 29 returns a bounded blocker list rather than raising'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df320000-0000-4000-8000-00000000000d'
    )
  $$,
  'April 31 returns a bounded blocker list rather than raising'
);

-- And the rule does not overreach. A real leap day, a fractional second, and an
-- explicit non-UTC offset naming the same instant the timestamptz column renders
-- are all exact coordinates, and none of them may cost a blocker.
SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(
      plugin_data.csf_import_preview_claim_blockers(
        'df100000-0000-4000-8000-000000000001',
        'df320000-0000-4000-8000-000000000010'
      )
    ) AS blocker
    WHERE blocker IN (
      'Run a fresh preview so this import records its source evidence.',
      'This source now points at a different file. Run a fresh preview.',
      'This source changed after it was previewed. Run a fresh preview.',
      'This source was replaced with a different kind of file. Run a fresh preview.',
      'Reconnect the source file before importing.'
    )
  ),
  ARRAY[]::text[],
  'an exact leap-day instant with a fractional second raises no source-evidence blocker'
);

SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(
      plugin_data.csf_import_preview_claim_blockers(
        'df100000-0000-4000-8000-000000000001',
        'df320000-0000-4000-8000-000000000011'
      )
    ) AS blocker
    WHERE blocker IN (
      'Run a fresh preview so this import records its source evidence.',
      'This source now points at a different file. Run a fresh preview.',
      'This source changed after it was previewed. Run a fresh preview.',
      'This source was replaced with a different kind of file. Run a fresh preview.',
      'Reconnect the source file before importing.'
    )
  ),
  ARRAY[]::text[],
  'the canonical UTC spelling of that same instant raises no source-evidence blocker'
);



SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(
      plugin_data.csf_import_preview_claim_blockers(
        'df100000-0000-4000-8000-000000000001',
        'df300000-0000-4000-8000-000000000033'
      )
    ) AS blocker
    WHERE blocker IN (
      'Run a fresh preview so this import records its source evidence.',
      'This source now points at a different file. Run a fresh preview.',
      'This source changed after it was previewed. Run a fresh preview.',
      'This source was replaced with a different kind of file. Run a fresh preview.',
      'A newer workbook was uploaded for this source. Run a fresh preview.',
      'Reconnect the source file before importing.'
    )
  ),
  ARRAY[]::text[],
  'an uploaded preview is judged on its staging id, generation, ready time, digest and exact MIME'
);

SELECT extensions.ok(
  'A newer workbook was uploaded for this source. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000034'
    )
  ),
  'a provider version spelling the attached digest cannot stand in for the digest itself'
);

-- ---------------------------------------------------------------------------
-- The other uploaded family, end to end: a real staged CSV generation, a preview
-- frozen with exactly text/csv, and the crossing in the opposite direction.
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  drive_access_state, drive_trashed, drive_file_name, drive_mime_type,
  uploaded_file_path, settings
) VALUES (
  'df200000-0000-4000-8000-000000000009',
  'df100000-0000-4000-8000-000000000001',
  'student_roster',
  'Synthetic uploaded CSV roster',
  'df150000-0000-4000-8000-000000000001',
  'uploaded_csv',
  'accessible', false, 'Synthetic roster.csv', 'text/csv',
  'df100000-0000-4000-8000-000000000001/df200000-0000-4000-8000-000000000009/1.csv',
  jsonb_build_object(
    'sourceKind', 'student_roster',
    'stagedUpload', true,
    'stagingObjectId', 'df210000-0000-4000-8000-000000000003',
    'stagingGeneration', 1,
    'stagingContentHash', repeat('c', 64),
    'stagingByteLength', 1024,
    'stagingReadyAt', now(),
    -- For an uploaded source this compatibility key holds the content digest,
    -- not a provider version, and the uploaded branch reads it as the third of
    -- the three digests it requires. The two provider meanings stay unconfused
    -- because the uploaded branch compares it only for equality against two
    -- other sha256 digests and never applies Drive's version grammar to it.
    'evidenceRevision', repeat('c', 64)
  )
);

INSERT INTO plugin_data.csf_sheet_import_staging_objects (
  id, organization_id, source_id, generation, status, bucket, object_path,
  file_extension, content_hash, byte_length, upload_expires_at, ready_at,
  ready_expires_at
) VALUES (
  'df210000-0000-4000-8000-000000000003',
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000009',
  1, 'ready', 'csf-private',
  'df100000-0000-4000-8000-000000000001/df200000-0000-4000-8000-000000000009/1.csv',
  'csv', repeat('c', 64), 1024,
  now() + interval '1 hour', now(), now() + interval '1 hour'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
)
SELECT
  shape.id,
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000009',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster',
  'df210000-0000-4000-8000-000000000003',
  'Synthetic roster.csv', 'Roster', 'Roster!A1:C3',
  now(),
  shape.metadata || jsonb_build_object(
    'sourceProvider', 'uploaded_csv',
    'stagingGeneration', 1,
    'readyAt', now()
  ),
  jsonb_build_object('version', 1, 'sourceType', 'student_roster',
    'sourceFileId', 'df210000-0000-4000-8000-000000000003',
    'sourceProvider', 'uploaded_csv',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Roster', 'range', 'Roster!A1:C3', 'headerRow', 1))),
  -- The CSV source's own staged digest, which is `c...c` rather than `5...5`.
  1, repeat('c', 64), repeat('2', 64), 1, 'csf-normalized-import/v1'
FROM (
  VALUES
    -- Exactly the MIME `uploaded_csv` owns.
    (
      'df300000-0000-4000-8000-000000000035'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000003',
        'name', 'Synthetic roster.csv',
        'mimeType', 'text/csv',
        'headRevisionId', repeat('c', 64),
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- The crossing in the other direction: an XLSX MIME frozen for a CSV source.
    (
      'df300000-0000-4000-8000-000000000036'::uuid,
      jsonb_build_object(
        'id', 'df210000-0000-4000-8000-000000000003',
        'name', 'Synthetic roster.csv',
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'headRevisionId', repeat('c', 64),
        'accessState', 'accessible', 'trashed', false
      )
    )
) AS shape(id, metadata);

SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(
      plugin_data.csf_import_preview_claim_blockers(
        'df100000-0000-4000-8000-000000000001',
        'df300000-0000-4000-8000-000000000035'
      )
    ) AS blocker
    WHERE blocker IN (
      'Run a fresh preview so this import records its source evidence.',
      'This source now points at a different file. Run a fresh preview.',
      'This source changed after it was previewed. Run a fresh preview.',
      'This source was replaced with a different kind of file. Run a fresh preview.',
      'A newer workbook was uploaded for this source. Run a fresh preview.',
      'Reconnect the source file before importing.'
    )
  ),
  ARRAY[]::text[],
  'an uploaded CSV preview frozen with exactly text/csv raises no source-evidence blocker'
);

SELECT extensions.ok(
  'This source was replaced with a different kind of file. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000036'
    )
  ),
  'an XLSX MIME frozen for an uploaded_csv source blocks the claim'
);

-- And the receipt issuer agrees with the gate on both, which is the whole point
-- of deriving the expected MIME the same way in both places.
SELECT extensions.is(
  plugin_data.csf_issue_uploaded_source_evidence(
    'df100000-0000-4000-8000-000000000001',
    'df000000-0000-4000-8000-000000000001',
    'df200000-0000-4000-8000-000000000009',
    'df300000-0000-4000-8000-000000000035') ->> 'provider',
  'uploaded_csv',
  'the CSV preview the gate accepts is the one the uploaded receipt issuer accepts'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_issue_uploaded_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000009',
      'df300000-0000-4000-8000-000000000036')$$,
  '23514', NULL,
  'and the crossed XLSX MIME the gate blocks is the one the issuer refuses'
);

-- ---------------------------------------------------------------------------
-- The receipt table itself refuses a crossed provider/MIME row, whatever an
-- issuer computes. All six crossings, written directly.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'plugin_data.csf_sheet_source_evidence_tokens'::regclass
      AND conname = 'csf_evidence_tokens_provider_mime_check'
  ),
  'a table constraint ties every receipt provider to its one canonical MIME'
);

-- Each crossing is written out. Every one of these rows satisfies the shape
-- check -- a Google row with a version and no staging identity, an uploaded row
-- with a staging identity and no version -- so the ONLY thing it violates is the
-- provider/MIME pairing, and the refusal cannot be coming from anywhere else.
SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
      organization_id, source_id, actor_user_id, preview_job_id, provider,
      evidence_generation, metadata_digest, provider_file_id, mime_type,
      modified_time, provider_version, access_checked_at, expires_at
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df000000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000020',
      'google_sheets', 99, repeat('c', 64), 'crossed-file',
      'text/csv', now(), '4', now(), now() + interval '2 minutes')$$,
  '23514', NULL,
  'a google_sheets receipt may not carry the CSV MIME'
);

SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
      organization_id, source_id, actor_user_id, preview_job_id, provider,
      evidence_generation, metadata_digest, provider_file_id, mime_type,
      modified_time, provider_version, access_checked_at, expires_at
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df000000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000020',
      'google_sheets', 99, repeat('c', 64), 'crossed-file',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      now(), '4', now(), now() + interval '2 minutes')$$,
  '23514', NULL,
  'a google_sheets receipt may not carry the XLSX MIME'
);

SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
      organization_id, source_id, actor_user_id, preview_job_id, provider,
      evidence_generation, metadata_digest, provider_file_id, mime_type,
      modified_time, provider_version,
      staging_object_id, staging_generation, content_digest, byte_length,
      access_checked_at, expires_at
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df000000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000000e',
      'uploaded_csv', 99, repeat('c', 64), 'df210000-0000-4000-8000-000000000001',
      'application/vnd.google-apps.spreadsheet', now(), NULL,
      'df210000-0000-4000-8000-000000000001', 1, repeat('5', 64), 2048,
      now(), now() + interval '2 minutes')$$,
  '23514', NULL,
  'an uploaded_csv receipt may not carry the Google Sheets MIME'
);

SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
      organization_id, source_id, actor_user_id, preview_job_id, provider,
      evidence_generation, metadata_digest, provider_file_id, mime_type,
      modified_time, provider_version,
      staging_object_id, staging_generation, content_digest, byte_length,
      access_checked_at, expires_at
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df000000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000000e',
      'uploaded_csv', 99, repeat('c', 64), 'df210000-0000-4000-8000-000000000001',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', now(), NULL,
      'df210000-0000-4000-8000-000000000001', 1, repeat('5', 64), 2048,
      now(), now() + interval '2 minutes')$$,
  '23514', NULL,
  'an uploaded_csv receipt may not carry the XLSX MIME'
);

SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
      organization_id, source_id, actor_user_id, preview_job_id, provider,
      evidence_generation, metadata_digest, provider_file_id, mime_type,
      modified_time, provider_version,
      staging_object_id, staging_generation, content_digest, byte_length,
      access_checked_at, expires_at
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df000000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000000e',
      'uploaded_xlsx', 99, repeat('c', 64), 'df210000-0000-4000-8000-000000000001',
      'application/vnd.google-apps.spreadsheet', now(), NULL,
      'df210000-0000-4000-8000-000000000001', 1, repeat('5', 64), 2048,
      now(), now() + interval '2 minutes')$$,
  '23514', NULL,
  'an uploaded_xlsx receipt may not carry the Google Sheets MIME'
);

SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
      organization_id, source_id, actor_user_id, preview_job_id, provider,
      evidence_generation, metadata_digest, provider_file_id, mime_type,
      modified_time, provider_version,
      staging_object_id, staging_generation, content_digest, byte_length,
      access_checked_at, expires_at
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df000000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000000e',
      'uploaded_xlsx', 99, repeat('c', 64), 'df210000-0000-4000-8000-000000000001',
      'text/csv', now(), NULL,
      'df210000-0000-4000-8000-000000000001', 1, repeat('5', 64), 2048,
      now(), now() + interval '2 minutes')$$,
  '23514', NULL,
  'an uploaded_xlsx receipt may not carry the CSV MIME'
);

-- And the shape check refuses a Google receipt with no provider version, or an
-- uploaded one that claims to have a provider behind it.
SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
      organization_id, source_id, actor_user_id, preview_job_id, provider,
      evidence_generation, metadata_digest, provider_file_id, mime_type,
      modified_time, provider_version, access_checked_at, expires_at
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df000000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000020',
      'google_sheets', 1, repeat('c', 64), 'crossed-file',
      'application/vnd.google-apps.spreadsheet', now(), NULL,
      now(), now() + interval '2 minutes')$$,
  '23514', NULL,
  'a Google receipt with no provider version cannot exist'
);

SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
      organization_id, source_id, actor_user_id, preview_job_id, provider,
      evidence_generation, metadata_digest, provider_file_id, mime_type,
      modified_time, provider_version,
      staging_object_id, staging_generation, content_digest, byte_length,
      access_checked_at, expires_at
    ) VALUES (
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df000000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000000e',
      'uploaded_xlsx', 1, repeat('c', 64), 'df210000-0000-4000-8000-000000000001',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', now(), '4',
      'df210000-0000-4000-8000-000000000001', 1, repeat('5', 64), 2048,
      now(), now() + interval '2 minutes')$$,
  '23514', NULL,
  'and an uploaded receipt cannot claim a provider version it has no provider for'
);

-- ---------------------------------------------------------------------------
-- Consumption re-checks the receipt's provider/MIME pairing on its own.
--
-- The table constraint is dropped for exactly this one statement and restored
-- immediately, because the point is that the CONSUMER refuses independently: a
-- future issuer regression, a manual write, or a constraint somebody drops must
-- not become a committed import. Testing this any other way would only re-prove
-- the constraint. The whole file runs inside one transaction that rolls back.
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_sheet_source_evidence_tokens
  DROP CONSTRAINT csf_evidence_tokens_provider_mime_check;

UPDATE plugin_data.csf_sheet_source_evidence_tokens
SET mime_type = 'text/csv'
WHERE source_id = 'df200000-0000-4000-8000-000000000008';

SELECT extensions.throws_ok(
  format($$SELECT plugin_data.csf_consume_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000008',
      'df000000-0000-4000-8000-000000000001',
      %L, 'df300000-0000-4000-8000-000000000020')$$,
    (SELECT nonce FROM plugin_data.csf_sheet_source_evidence_tokens
     WHERE source_id = 'df200000-0000-4000-8000-000000000008'
     ORDER BY evidence_generation DESC LIMIT 1)),
  '23514', NULL,
  'consumption refuses a Google receipt whose MIME no longer matches its provider'
);

SELECT extensions.is(
  (SELECT consumed_at FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE source_id = 'df200000-0000-4000-8000-000000000008'
   ORDER BY evidence_generation DESC LIMIT 1),
  NULL,
  'and refusing it does not spend it'
);

-- The uploaded family, for the same guard. A receipt issued honestly earlier in
-- this file has its MIME crossed underneath it, and consumption refuses it
-- before reaching the staged-identity checks it would otherwise pass.
UPDATE plugin_data.csf_sheet_source_evidence_tokens
SET mime_type = 'text/csv'
WHERE source_id = 'df200000-0000-4000-8000-000000000007'
  AND consumed_at IS NULL;

SELECT extensions.throws_ok(
  format($$SELECT plugin_data.csf_consume_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-000000000007',
      'df000000-0000-4000-8000-000000000001',
      %L, 'df300000-0000-4000-8000-00000000000e')$$,
    (SELECT nonce FROM plugin_data.csf_sheet_source_evidence_tokens
     WHERE source_id = 'df200000-0000-4000-8000-000000000007'
       AND consumed_at IS NULL
     ORDER BY evidence_generation DESC LIMIT 1)),
  '23514', NULL,
  'an uploaded receipt whose MIME was crossed to CSV is refused at consumption'
);

-- Restore both, then put the constraint back VALIDATED. A restored constraint
-- that had to be `NOT VALID` would mean the rows were left crossed, and the
-- assertion below would be proving nothing.
UPDATE plugin_data.csf_sheet_source_evidence_tokens
SET mime_type = 'application/vnd.google-apps.spreadsheet'
WHERE source_id = 'df200000-0000-4000-8000-000000000008';

UPDATE plugin_data.csf_sheet_source_evidence_tokens
SET mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
WHERE source_id = 'df200000-0000-4000-8000-000000000007';

ALTER TABLE plugin_data.csf_sheet_source_evidence_tokens
  ADD CONSTRAINT csf_evidence_tokens_provider_mime_check CHECK (
    (provider = 'google_sheets'
      AND mime_type = 'application/vnd.google-apps.spreadsheet')
    OR (provider = 'uploaded_csv' AND mime_type = 'text/csv')
    OR (provider = 'uploaded_xlsx'
      AND mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  );

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'plugin_data.csf_sheet_source_evidence_tokens'::regclass
      AND conname = 'csf_evidence_tokens_provider_mime_check'
      AND convalidated
  ),
  'and every receipt row still satisfies the restored provider/MIME constraint'
);


-- ===========================================================================
-- The uploaded family requires the digest the RECEIPT wrote, not only the two
-- copies of the attachment.
--
-- `csf_issue_uploaded_source_evidence` reads the staged generation under lock
-- and writes that digest to `settings->>'evidenceRevision'` in the same
-- statement that mints the receipt; the claim consumes that receipt before this
-- gate runs, so by the time the gate reads the key it is the issuer's own live
-- answer. Comparing the preview's frozen `headRevisionId` against
-- `stagingContentHash` alone compared two copies of an attachment with each
-- other -- both of which move together when a source's recorded digest is
-- rewritten, and neither of which is evidence that any read of the bytes ever
-- happened.
--
-- Preview `...0033` is the uploaded XLSX whose staging id, digest and exact MIME
-- all match the live source, so it isolates the third digest exactly.
-- ===========================================================================

SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(
      plugin_data.csf_import_preview_claim_blockers(
        'df100000-0000-4000-8000-000000000001',
        'df300000-0000-4000-8000-000000000033'
      )
    ) AS blocker
    WHERE blocker IN (
      'Run a fresh preview so this import records its source evidence.',
      'A newer workbook was uploaded for this source. Run a fresh preview.'
    )
  ),
  ARRAY[]::text[],
  'an uploaded preview whose frozen, attached and receipt-written digests all agree raises no source-evidence blocker'
);

-- 1. MISSING. A source with no receipt-written digest has had no receipt issued
-- against these bytes, and this gate runs after one was supposed to have been
-- consumed -- so its absence is a contradiction, not a first run.
UPDATE plugin_data.csf_sheet_sources
SET settings = settings - 'evidenceRevision'
WHERE id = 'df200000-0000-4000-8000-000000000007';

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000033'
    )
  ),
  'an uploaded source carrying no receipt-written digest blocks the claim preflight'
);

-- 2. MALFORMED. Not a sha256 digest at all. A value nothing can attribute to any
-- bytes is missing evidence rather than a disagreement, and comparing it must
-- not raise: the whole check is regex and text equality with no cast.
UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('evidenceRevision', 'not-a-digest')
WHERE id = 'df200000-0000-4000-8000-000000000007';

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000033'
    )
  ),
  'an uploaded receipt-written digest that is not a sha256 digest blocks rather than raising'
);

-- 3. MALFORMED, the case a fold would have hidden. The right bytes in the wrong
-- case is not the canonical digest, and lowercasing it here would silently
-- accept evidence the issuer never wrote in that form.
UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('evidenceRevision', upper(repeat('a', 64)))
WHERE id = 'df200000-0000-4000-8000-000000000007';

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000033'
    )
  ),
  'an uppercase uploaded digest is refused rather than folded into the canonical one'
);

-- 4. TAMPERED. Well-formed, canonical, and a different digest from the two the
-- preview and the attachment agree on. That is a disagreement, so it is the
-- replaced-workbook blocker rather than the re-preview one.
UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('evidenceRevision', repeat('6', 64))
WHERE id = 'df200000-0000-4000-8000-000000000007';

SELECT extensions.ok(
  'A newer workbook was uploaded for this source. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000033'
    )
  ),
  'a receipt-written digest that disagrees with the frozen and attached ones blocks the claim'
);

UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('evidenceRevision', repeat('5', 64))
WHERE id = 'df200000-0000-4000-8000-000000000007';

SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(
      plugin_data.csf_import_preview_claim_blockers(
        'df100000-0000-4000-8000-000000000001',
        'df300000-0000-4000-8000-000000000033'
      )
    ) AS blocker
    WHERE blocker IN (
      'Run a fresh preview so this import records its source evidence.',
      'A newer workbook was uploaded for this source. Run a fresh preview.'
    )
  ),
  ARRAY[]::text[],
  'and restoring the receipt-written digest restores the passing three-way agreement'
);

-- The other uploaded family, on its own source, so the rule is not an accident
-- of one provider's fixture.
UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('evidenceRevision', repeat('7', 64))
WHERE id = 'df200000-0000-4000-8000-000000000009';

SELECT extensions.ok(
  'A newer workbook was uploaded for this source. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000035'
    )
  ),
  'the same three-way digest rule governs an uploaded CSV source'
);

UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('evidenceRevision', repeat('c', 64))
WHERE id = 'df200000-0000-4000-8000-000000000009';

SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(
      plugin_data.csf_import_preview_claim_blockers(
        'df100000-0000-4000-8000-000000000001',
        'df300000-0000-4000-8000-000000000035'
      )
    ) AS blocker
    WHERE blocker IN (
      'Run a fresh preview so this import records its source evidence.',
      'A newer workbook was uploaded for this source. Run a fresh preview.'
    )
  ),
  ARRAY[]::text[],
  'and the CSV source is clean again once its receipt-written digest agrees'
);

-- ===========================================================================
-- A frozen Google `version` must be a JSON STRING in BOTH gates.
--
-- `jsonb ->> 'version'` renders the JSON number 58 as the text 58, which then
-- satisfies the canonical bounded int64 grammar exactly as a genuine provider
-- string would. Drive serializes `version` as a JSON string precisely because an
-- int64 does not survive a double, so a numeric frozen version is evidence that
-- has already been through one -- and a boolean, array, object or JSON null is
-- not the coordinate at all. Every one of them must fail closed into the
-- existing source-evidence/re-preview behavior.
--
-- Its own source, because the successful refresh below advances an evidence
-- generation and no earlier assertion may be moved by it.
-- ===========================================================================

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  drive_access_state, drive_trashed, drive_file_id, drive_file_name,
  drive_mime_type, drive_modified_at, settings
) VALUES (
  'df200000-0000-4000-8000-00000000000a',
  'df100000-0000-4000-8000-000000000001',
  'application_responses',
  'Synthetic typed-version source',
  'df150000-0000-4000-8000-000000000001',
  'google_sheets',
  'accessible', false, 'synthetic-typed-file', 'Synthetic typed version sheet',
  'application/vnd.google-apps.spreadsheet',
  '2026-07-08T00:00:00Z',
  jsonb_build_object(
    'sourceKind', 'application_responses',
    'evidenceRevision', '77'
  )
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
)
SELECT
  shape.id,
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-00000000000a',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'application_responses',
  'synthetic-typed-file', 'Synthetic typed version sheet', 'Responses', 'Responses!A1:Z9',
  '2026-07-08T00:00:00Z',
  shape.metadata || jsonb_build_object('sourceProvider', 'google_sheets'),
  jsonb_build_object(
    'version', 1, 'sourceType', 'application_responses',
    'sourceFileId', 'synthetic-typed-file',
    'sourceProvider', 'google_sheets',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Responses', 'range', 'Responses!A1:Z9', 'headerRow', 1)
    )
  ),
  1, repeat('9', 64), repeat('b', 64), 1, 'csf-normalized-import/v1'
FROM (
  VALUES
    -- The valid form: the exact decimal string the provider sent.
    (
      'df300000-0000-4000-8000-00000000004a'::uuid,
      jsonb_build_object(
        'id', 'synthetic-typed-file',
        'name', 'Synthetic typed version sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-08T00:00:00Z',
        'version', '77',
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A JSON NUMBER. `->>` renders this as the text `77`, which is byte-identical
    -- to the string above and would compare equal to the server-issued
    -- coordinate -- so without a type check this is indistinguishable from
    -- evidence that never went through a double.
    (
      'df300000-0000-4000-8000-00000000004b'::uuid,
      jsonb_build_object(
        'id', 'synthetic-typed-file',
        'name', 'Synthetic typed version sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-08T00:00:00Z',
        'version', 77,
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A JSON boolean.
    (
      'df300000-0000-4000-8000-00000000004c'::uuid,
      jsonb_build_object(
        'id', 'synthetic-typed-file',
        'name', 'Synthetic typed version sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-08T00:00:00Z',
        'version', true,
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A JSON null, which is present-but-stated-as-nothing rather than absent.
    (
      'df300000-0000-4000-8000-00000000004d'::uuid,
      jsonb_build_object(
        'id', 'synthetic-typed-file',
        'name', 'Synthetic typed version sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-08T00:00:00Z',
        'version', NULL::jsonb,
        'accessState', 'accessible', 'trashed', false
      )
    ),
    -- A JSON array, whose `->>` rendering is text that no grammar should read.
    (
      'df300000-0000-4000-8000-00000000004e'::uuid,
      jsonb_build_object(
        'id', 'synthetic-typed-file',
        'name', 'Synthetic typed version sheet',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'modifiedTime', '2026-07-08T00:00:00Z',
        'version', jsonb_build_array('77'),
        'accessState', 'accessible', 'trashed', false
      )
    )
) AS shape(id, metadata);

SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(
      plugin_data.csf_import_preview_claim_blockers(
        'df100000-0000-4000-8000-000000000001',
        'df300000-0000-4000-8000-00000000004a'
      )
    ) AS blocker
    WHERE blocker IN (
      'Run a fresh preview so this import records its source evidence.',
      'This source now points at a different file. Run a fresh preview.',
      'This source changed after it was previewed. Run a fresh preview.',
      'This source was replaced with a different kind of file. Run a fresh preview.',
      'Reconnect the source file before importing.'
    )
  ),
  ARRAY[]::text[],
  'a frozen version held as a JSON string raises no source-evidence blocker'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000004b'
    )
  ),
  'a JSON NUMERIC frozen version is refused by the claim gate, not coerced into text'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000004c'
    )
  ),
  'a JSON boolean frozen version is refused by the claim gate'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000004d'
    )
  ),
  'a JSON null frozen version is refused by the claim gate'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000004e'
    )
  ),
  'a JSON array frozen version is refused by the claim gate'
);

-- The same rule in the other gate. These raise before anything is stored, so the
-- source's evidence generation is untouched by either refusal.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-00000000000a',
      'df300000-0000-4000-8000-00000000004b',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-00000000000a'),
      'synthetic-typed-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-08T00:00:00Z', '77', false, 'accessible', 'Synthetic typed version sheet')$$,
  '23514', NULL,
  'the Google receipt issuer refuses a JSON NUMERIC frozen version as unrecorded evidence'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-00000000000a',
      'df300000-0000-4000-8000-00000000004c',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-00000000000a'),
      'synthetic-typed-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-08T00:00:00Z', '77', false, 'accessible', 'Synthetic typed version sheet')$$,
  '23514', NULL,
  'and refuses a JSON boolean frozen version on the same terms'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_refresh_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df000000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-00000000000a',
      'df300000-0000-4000-8000-00000000004a',
      (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
        WHERE id = 'df200000-0000-4000-8000-00000000000a'),
      'synthetic-typed-file', 'application/vnd.google-apps.spreadsheet',
      '2026-07-08T00:00:00Z', '77', false, 'accessible', 'Synthetic typed version sheet')$$,
  'while the same preview with a JSON STRING version still receives a receipt'
);

-- ===========================================================================
-- The receipt is consumed BEFORE the readiness gate, and a failed gate rolls the
-- consumption back with everything else.
--
-- The ordering is load-bearing rather than incidental: the gate reads
-- `settings->>'evidenceRevision'` for both provider families, and that key is
-- written by the receipt issuers -- so a gate evaluated first would read the
-- previous refresh's answer, or on a first refresh none at all. Both run in the
-- one claim transaction, so a preview that fails readiness must leave its
-- receipt spendable; burning it would force an officer to re-read the source to
-- retry something that never happened.
--
-- The blocker used here is the preview's `status`, chosen because it is
-- evaluated ONLY inside `csf_import_preview_claim_blockers` -- the consume path
-- never reads it. The snapshot digest would say the same thing but cannot be the
-- lever: `csf_preserve_import_snapshot_provenance` makes it immutable once
-- recorded, which is itself a guarantee this suite asserts elsewhere.
-- ===========================================================================

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  drive_access_state, drive_trashed, drive_file_id, drive_file_name,
  drive_mime_type, drive_modified_at, settings
) VALUES (
  'df200000-0000-4000-8000-00000000000b',
  'df100000-0000-4000-8000-000000000001',
  'student_roster',
  'Synthetic receipt-ordering roster',
  'df150000-0000-4000-8000-000000000001',
  'google_sheets',
  'accessible', false, 'synthetic-ordering-file', 'Synthetic ordering roster',
  'application/vnd.google-apps.spreadsheet', '2026-07-09T00:00:00Z',
  jsonb_build_object(
    'sourceKind', 'student_roster',
    'evidenceRevision', '90'
  )
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
) VALUES (
  'df300000-0000-4000-8000-00000000004f',
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-00000000000b',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster',
  'synthetic-ordering-file', 'Synthetic ordering roster', 'Roster', 'Roster!A1:C2',
  '2026-07-09T00:00:00Z',
  jsonb_build_object(
    'id', 'synthetic-ordering-file',
    'sourceProvider', 'google_sheets',
    'name', 'Synthetic ordering roster',
    'mimeType', 'application/vnd.google-apps.spreadsheet',
    'version', '90',
    'modifiedTime', '2026-07-09T00:00:00Z',
    'accessState', 'accessible', 'trashed', false
  ),
  jsonb_build_object(
    'version', 1, 'sourceType', 'student_roster',
    'sourceFileId', 'synthetic-ordering-file',
    'sourceProvider', 'google_sheets',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Roster', 'range', 'Roster!A1:C2', 'headerRow', 1)
    )
  ),
  1, repeat('e', 64), repeat('f', 64), 1, 'csf-normalized-import/v1'
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, sheet_tab_name, row_number,
  import_status, row_hash, normalized_data
) VALUES (
  'df500000-0000-4000-8000-000000000031',
  'df100000-0000-4000-8000-000000000001',
  'df300000-0000-4000-8000-00000000004f',
  'df200000-0000-4000-8000-00000000000b',
  'df150000-0000-4000-8000-000000000001',
  'Roster', 2, 'pending', repeat('9', 64),
  jsonb_build_object(
    'commitPayload', jsonb_build_object(
      'version', 'csf-commit-payload/v1',
      'sourceType', 'student_roster',
      'identity', jsonb_build_object(
        'firstName', 'Rowan', 'lastName', 'Ash',
        'normalizedFirstName', 'rowan', 'normalizedLastName', 'ash'
      ),
      'canonicalEmails', '{}'::jsonb
    )
  )
);

SELECT extensions.is(
  plugin_data.csf_import_preview_claim_blockers(
    'df100000-0000-4000-8000-000000000001',
    'df300000-0000-4000-8000-00000000004f'
  ),
  ARRAY[]::text[],
  'the receipt-ordering fixture starts as a fully claimable preview'
);

-- The receipt is issued and its nonce kept, so the SAME token can be offered
-- twice: once to a claim that must fail, and once to a claim that must succeed.
CREATE TEMP TABLE csf_ordering_receipt AS
SELECT (plugin_data.csf_refresh_sheet_source_evidence(
    'df100000-0000-4000-8000-000000000001',
    'df000000-0000-4000-8000-000000000001',
    'df200000-0000-4000-8000-00000000000b',
    'df300000-0000-4000-8000-00000000004f',
    (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
      WHERE id = 'df200000-0000-4000-8000-00000000000b'),
    'synthetic-ordering-file', 'application/vnd.google-apps.spreadsheet',
    '2026-07-09T00:00:00Z', '90', false, 'accessible', 'Synthetic ordering roster'
  ) ->> 'evidenceToken')::uuid AS nonce;

-- A blocker the consume path cannot see, introduced after the receipt exists.
UPDATE plugin_data.csf_sheet_import_jobs
SET status = 'running'
WHERE id = 'df300000-0000-4000-8000-00000000004f';

SELECT extensions.ok(
  'Wait for a completed preview before importing records.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000004f'
    )
  ),
  'the introduced blocker is one only the readiness gate evaluates'
);

SELECT extensions.throws_ok(
  format($$SELECT plugin_data.csf_claim_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000004f',
      'df000000-0000-4000-8000-000000000001', 300, %L)$$,
    (SELECT nonce FROM csf_ordering_receipt)),
  '23514', NULL,
  'a claim that reaches the readiness gate with a valid receipt still fails on the blocker'
);

SELECT extensions.is(
  (SELECT token.consumed_at FROM plugin_data.csf_sheet_source_evidence_tokens AS token
   WHERE token.nonce = (SELECT nonce FROM csf_ordering_receipt)),
  NULL,
  'and the statement rollback left that receipt unconsumed rather than burning it'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_jobs
   WHERE mode = 'commit' AND preview_job_id = 'df300000-0000-4000-8000-00000000004f'),
  0,
  'and no logical commit was created by the refused claim'
);

UPDATE plugin_data.csf_sheet_import_jobs
SET status = 'completed'
WHERE id = 'df300000-0000-4000-8000-00000000004f';

SELECT extensions.lives_ok(
  format($$SELECT plugin_data.csf_claim_import_commit_attempt(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000004f',
      'df000000-0000-4000-8000-000000000001', 300, %L)$$,
    (SELECT nonce FROM csf_ordering_receipt)),
  'the very same receipt is still spendable once the blocker is resolved'
);

SELECT extensions.isnt(
  (SELECT token.consumed_at FROM plugin_data.csf_sheet_source_evidence_tokens AS token
   WHERE token.nonce = (SELECT nonce FROM csf_ordering_receipt)),
  NULL::timestamptz,
  'and the successful claim did consume it'
);

-- Single use is unchanged. A receipt that survived a rolled-back claim is
-- reusable exactly until it is actually spent, and never afterwards.
SELECT extensions.throws_ok(
  format($$SELECT plugin_data.csf_consume_sheet_source_evidence(
      'df100000-0000-4000-8000-000000000001',
      'df200000-0000-4000-8000-00000000000b',
      'df000000-0000-4000-8000-000000000001',
      %L, 'df300000-0000-4000-8000-00000000004f')$$,
    (SELECT nonce FROM csf_ordering_receipt)),
  '55000', NULL,
  'and replaying the spent receipt is still refused'
);

-- ===========================================================================
-- Exact, self-consistent frozen coordinates: the counterexamples the previous
-- shape-only readers accepted.
--
-- Every case below was accepted by direct execution before this correction, at
-- one or both authorities. Each runs against its OWN fixture, so no case
-- depends on a mutation an earlier one left behind.
--
-- A dedicated source is used rather than either of the two above because these
-- cases need a live modification time with FRACTIONAL seconds: `timestamptz`
-- retains microseconds, and several assertions are precisely about which digits
-- survive the typed column and which cannot.
-- ===========================================================================

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  drive_access_state, drive_trashed, drive_file_id, drive_file_name,
  drive_mime_type, drive_modified_at, settings
) VALUES (
  'df200000-0000-4000-8000-000000000010',
  'df100000-0000-4000-8000-000000000001',
  'application_responses',
  'Synthetic sub-second evidence source',
  'df150000-0000-4000-8000-000000000001',
  'google_sheets',
  'accessible', false, 'synthetic-precision-file', 'Synthetic precision sheet',
  'application/vnd.google-apps.spreadsheet',
  '2026-07-05T00:00:00.123456Z',
  jsonb_build_object('sourceKind', 'application_responses', 'evidenceRevision', '58')
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
)
SELECT
  shape.id,
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000010',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'application_responses',
  shape.file_id, 'Synthetic precision sheet', 'Responses', 'Responses!A1:Z9',
  shape.modified_at,
  jsonb_build_object(
    'id', shape.frozen_id, 'name', 'Synthetic precision sheet',
    'sourceProvider', 'google_sheets',
    'mimeType', 'application/vnd.google-apps.spreadsheet',
    'modifiedTime', shape.modified_text, 'version', '58',
    'accessState', 'accessible', 'trashed', false
  ),
  jsonb_build_object(
    'version', 1, 'sourceType', 'application_responses',
    'sourceFileId', 'synthetic-precision-file',
    'sourceProvider', 'google_sheets',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Responses', 'range', 'Responses!A1:Z9', 'headerRow', 1)
    )
  ),
  1, repeat('9', 64), repeat('a', 64), 1, 'csf-normalized-import/v1'
FROM (
  VALUES
    -- The control: the same instant on both sides, at every retained digit.
    ('df300000-0000-4000-8000-000000000070'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('2026-07-05T00:00:00.123456Z'::text)),
    -- `.123456` and `.123999` are DIFFERENT instants that any millisecond
    -- reading of this evidence collapses onto a single value.
    ('df300000-0000-4000-8000-000000000071'::uuid,
     '2026-07-05T00:00:00.123999Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('2026-07-05T00:00:00.123456Z'::text)),
    -- Nine digits whose sub-microsecond part is NOT zero: precision the typed
    -- column cannot retain, refused BEFORE the cast rather than truncated into
    -- an equality it does not name.
    ('df300000-0000-4000-8000-000000000072'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('2026-07-05T00:00:00.123456789Z'::text)),
    -- `-00:00` is RFC 3339's offset-unknown spelling. It names no zone at all,
    -- and it is not something Drive emits.
    ('df300000-0000-4000-8000-000000000073'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('2026-07-05T00:00:00.123456-00:00'::text)),
    -- A one-digit fraction is not a width Drive produces; refused rather than
    -- normalized into `.100`.
    ('df300000-0000-4000-8000-000000000074'::uuid,
     '2026-07-05T00:00:00.100Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('2026-07-05T00:00:00.1Z'::text)),
    -- A numeric offset, even a correct one, is not provider OUTPUT.
    ('df300000-0000-4000-8000-000000000075'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('2026-07-05T00:00:00.123456+00:00'::text)),
    -- A day that does not exist. Only the guarded cast can see this one, and it
    -- must become a blocker rather than an error out of a STABLE function.
    ('df300000-0000-4000-8000-000000000076'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('2026-02-30T00:00:00.123456Z'::text)),
    -- Hour 24 and second 60 are spellings a lenient parser MOVES to the
    -- neighbouring instant rather than refusing, so the shape excludes both
    -- before the cast is ever reached.
    ('df300000-0000-4000-8000-000000000077'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('2026-07-05T24:00:00.123456Z'::text)),
    ('df300000-0000-4000-8000-000000000078'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('2026-07-05T00:00:60.123456Z'::text)),
    -- Padded frozen provider text. Noticed, never trimmed into validity.
    ('df300000-0000-4000-8000-000000000079'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb(' 2026-07-05T00:00:00.123456Z '::text)),
    -- Nine digits whose sub-microsecond part IS zero: this one carries no
    -- precision the typed column cannot hold, so it must PASS.
    ('df300000-0000-4000-8000-00000000007a'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('2026-07-05T00:00:00.123456000Z'::text)),
    -- A frozen modified time that is a JSON NUMBER. `->>` renders it as text,
    -- so without the type guard it reaches the grammar looking like a string.
    ('df300000-0000-4000-8000-00000000007b'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb(20260705)),
    -- A frozen id that is a JSON NUMBER, for the same reason.
    ('df300000-0000-4000-8000-00000000007c'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb(12345),
     to_jsonb('2026-07-05T00:00:00.123456Z'::text)),
    -- Real Gregorian leap days, and the two century years that are NOT leap.
    -- A value that PARSES reaches the live comparison and yields the
    -- changed-source sentence, which is how these four distinguish "not a date
    -- at all" from "a real date that disagrees".
    ('df300000-0000-4000-8000-00000000007d'::uuid,
     '2000-02-29T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('2000-02-29T00:00:00.123456Z'::text)),
    ('df300000-0000-4000-8000-00000000007e'::uuid,
     '2400-02-29T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('2400-02-29T00:00:00.123456Z'::text)),
    ('df300000-0000-4000-8000-00000000007f'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('1900-02-29T00:00:00.123456Z'::text)),
    ('df300000-0000-4000-8000-000000000080'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz, 'synthetic-precision-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('2100-02-29T00:00:00.123456Z'::text)),
    -- Unicode and control padding on BOTH edges of two ids that agree with each
    -- other, written with `chr()` so the fixture says which CODE POINT it means.
    -- `[[:space:]]` is a locale class blind to the first three, so each of them
    -- was read as exact here while the TypeScript boundary refused it. U+0000 is
    -- deliberately absent: PostgreSQL `text` cannot hold one, and the assertion
    -- below proves the json input boundary refuses it before this gate is ever
    -- reached, which is why the NUL regression can only live in TypeScript.
    ('df300000-0000-4000-8000-000000000081'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz,
     chr(160) || 'synthetic-precision-file' || chr(160),
     to_jsonb(chr(160) || 'synthetic-precision-file' || chr(160)),
     to_jsonb('2026-07-05T00:00:00.123456Z'::text)),
    ('df300000-0000-4000-8000-000000000082'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz,
     chr(133) || 'synthetic-precision-file' || chr(133),
     to_jsonb(chr(133) || 'synthetic-precision-file' || chr(133)),
     to_jsonb('2026-07-05T00:00:00.123456Z'::text)),
    ('df300000-0000-4000-8000-000000000083'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz,
     chr(8203) || 'synthetic-precision-file' || chr(8203),
     to_jsonb(chr(8203) || 'synthetic-precision-file' || chr(8203)),
     to_jsonb('2026-07-05T00:00:00.123456Z'::text)),
    ('df300000-0000-4000-8000-000000000084'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz,
     chr(32) || 'synthetic-precision-file' || chr(32),
     to_jsonb(chr(32) || 'synthetic-precision-file' || chr(32)),
     to_jsonb('2026-07-05T00:00:00.123456Z'::text)),
    ('df300000-0000-4000-8000-000000000085'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz,
     chr(9) || 'synthetic-precision-file' || chr(9),
     to_jsonb(chr(9) || 'synthetic-precision-file' || chr(9)),
     to_jsonb('2026-07-05T00:00:00.123456Z'::text)),
    ('df300000-0000-4000-8000-000000000086'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz,
     chr(10) || 'synthetic-precision-file' || chr(10),
     to_jsonb(chr(10) || 'synthetic-precision-file' || chr(10)),
     to_jsonb('2026-07-05T00:00:00.123456Z'::text)),
    -- The job's own id disagreeing with an otherwise exact frozen one. This link
    -- of the identity chain was previously checked only for PRESENCE.
    ('df300000-0000-4000-8000-000000000087'::uuid,
     '2026-07-05T00:00:00.123456Z'::timestamptz, 'synthetic-other-file',
     to_jsonb('synthetic-precision-file'::text),
     to_jsonb('2026-07-05T00:00:00.123456Z'::text))
) AS shape(id, modified_at, file_id, frozen_id, modified_text);

-- The exact control. Every coordinate agrees at every digit either side kept,
-- so this fixture must cost nothing -- otherwise the refusals below would prove
-- only that the gate refuses everything.
SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(
      plugin_data.csf_import_preview_claim_blockers(
        'df100000-0000-4000-8000-000000000001',
        'df300000-0000-4000-8000-000000000070'
      )
    ) AS blocker
    WHERE blocker IN (
      'Run a fresh preview so this import records its source evidence.',
      'This source now points at a different file. Run a fresh preview.',
      'This source changed after it was previewed. Run a fresh preview.',
      'This source was replaced with a different kind of file. Run a fresh preview.',
      'Reconnect the source file before importing.'
    )
  ),
  ARRAY[]::text[],
  'a frozen microsecond instant equal to the job and live columns raises no source-evidence blocker'
);

-- Nine digits whose sub-microsecond part is zero names exactly the instant the
-- typed column holds, so the WIDTH alone must not cost anything either.
SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(
      plugin_data.csf_import_preview_claim_blockers(
        'df100000-0000-4000-8000-000000000001',
        'df300000-0000-4000-8000-00000000007a'
      )
    ) AS blocker
    WHERE blocker IN (
      'Run a fresh preview so this import records its source evidence.',
      'This source changed after it was previewed. Run a fresh preview.'
    )
  ),
  ARRAY[]::text[],
  'a nine-digit frozen fraction whose sub-microsecond digits are zero is accepted at full precision'
);

-- Each of these was accepted before the correction. `.123456` versus `.123999`
-- is the case a millisecond reading cannot see at all.
SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000071')),
  'a frozen .123456 against a stored .123999 is not the same instant and blocks'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000072')),
  'a frozen nanosecond timestamptz cannot retain is refused rather than truncated into equality'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000073')),
  'a frozen -00:00 names no zone and blocks rather than being read as UTC'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000074')),
  'a frozen one-digit fraction is not a Drive output width and blocks'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000075')),
  'a frozen numeric offset is not provider output and blocks even when it names the right instant'
);

-- The calendar cases the SHAPE cannot see: only the guarded cast can, and it
-- must never let a cast error escape this STABLE function.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000076')
  $$,
  'an impossible calendar date returns a bounded blocker list rather than raising'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000076')),
  'February 30 blocks'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000077')),
  'hour 24 blocks rather than becoming the next day midnight'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000078')),
  'a leap second blocks rather than becoming the next minute'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000079')),
  'a padded frozen modified time blocks rather than being trimmed into validity'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000007b')),
  'a frozen modified time that is a JSON number blocks, because ->> would render it as text'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000007c')),
  'a frozen file id that is a JSON number blocks rather than being read as a provider string'
);

-- The four Gregorian century cases. A REAL date parses and therefore reaches the
-- live comparison, which is a different sentence from "this is not a date".
SELECT extensions.ok(
  'This source changed after it was previewed. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000007d')),
  'the year 2000 IS a leap year, so February 29 parses and reaches the live comparison'
);

SELECT extensions.ok(
  'This source changed after it was previewed. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000007e')),
  'the year 2400 IS a leap year, by the 400-year rule'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000007f')),
  'the year 1900 is NOT a leap year, so February 29 is not a date and blocks'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000080')),
  'the year 2100 is NOT a leap year either'
);

-- Edge padding on two ids that agree with each other. Named by CODE POINT,
-- because `[[:space:]]` matches none of the first three under any locale.
SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000081')),
  'agreeing ids wrapped in U+00A0 NO-BREAK SPACE block rather than comparing equal'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000082')),
  'agreeing ids wrapped in U+0085 NEXT LINE block'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000083')),
  'agreeing ids wrapped in U+200B ZERO WIDTH SPACE block'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000084')),
  'agreeing ids wrapped in an ASCII space block'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000085')),
  'agreeing ids wrapped in a tab block'
);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000086')),
  'agreeing ids wrapped in a newline block'
);

-- U+0000 cannot reach the gate at all: PostgreSQL `text` cannot hold one, so the
-- json input boundary refuses it first. The escape is assembled with chr(92) so
-- this file never has to contain a NUL to say so. This is why the NUL regression
-- lives in the TypeScript suite, which is the only authority that can carry it.
SELECT extensions.throws_ok(
  $nul$ SELECT ('{"id":"' || chr(92) || 'u0000"}')::jsonb $nul$,
  '22P05', NULL,
  'a NUL inside a json string is refused by the input boundary before any authority reads it'
);

-- The third link of the Google identity chain, which was only ever checked for
-- presence: the job column naming one file while the frozen metadata names
-- another.
SELECT extensions.ok(
  'This source now points at a different file. Run a fresh preview.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000087')),
  'a job source_file_id disagreeing with an exact frozen id blocks the claim'
);

-- ---------------------------------------------------------------------------
-- The A1 range is PARSED, and the mapping generation is BOUND.
--
-- Each fixture below carries exact source evidence, so the only thing it can
-- cost is the mapping sentence under test. The previous reader was a shape-only
-- regex applied to a btrimmed value, and a shape is not a rectangle: it accepted
-- a qualifier naming a DIFFERENT tab than the entry it belonged to, a
-- double-quoted qualifier (two literal characters of a sheet name, not A1
-- quoting), endpoints written in the wrong order, padded ranges, and a row
-- integer no spreadsheet has. `mapping_snapshot.version` was optional and
-- type-erased, so an absent, stringly-typed, fractional or simply unequal
-- generation all passed against a job at generation 1.
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
)
SELECT
  shape.id,
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000010',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'application_responses',
  'synthetic-precision-file', 'Synthetic precision sheet', 'Responses', 'Responses!A1:Z9',
  '2026-07-05T00:00:00.123456Z',
  jsonb_build_object(
    'id', 'synthetic-precision-file', 'name', 'Synthetic precision sheet',
    'sourceProvider', 'google_sheets',
    'mimeType', 'application/vnd.google-apps.spreadsheet',
    'modifiedTime', '2026-07-05T00:00:00.123456Z', 'version', '58',
    'accessState', 'accessible', 'trashed', false
  ),
  shape.mapping || jsonb_build_object('sourceProvider', 'google_sheets'),
  1, repeat('9', 64), repeat('a', 64), 1, 'csf-normalized-import/v1'
FROM (
  VALUES
    -- A qualifier naming a tab OTHER than the entry it is filed under. This is
    -- the hole that let a mapping record cells from one tab under another's name.
    ('df300000-0000-4000-8000-000000000090'::uuid,
     jsonb_build_object('version', 1, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', '''Elections''!A1:Z9', 'headerRow', 1)))),
    -- Double quotes are not A1 sheet quoting, so the decoded qualifier here is
    -- literally `"Responses"` and is not the tab this entry names.
    ('df300000-0000-4000-8000-000000000091'::uuid,
     jsonb_build_object('version', 1, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', '"Responses"!A1:Z9', 'headerRow', 1)))),
    -- Endpoints in the wrong order name no cells as written.
    ('df300000-0000-4000-8000-000000000092'::uuid,
     jsonb_build_object('version', 1, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', 'B1:A2', 'headerRow', 1)))),
    ('df300000-0000-4000-8000-000000000093'::uuid,
     jsonb_build_object('version', 1, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', 'A2:B1', 'headerRow', 1)))),
    -- Padded ranges. `btrim` repaired both of these into valid ones.
    ('df300000-0000-4000-8000-000000000094'::uuid,
     jsonb_build_object('version', 1, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', ' A1:Z9 ', 'headerRow', 1)))),
    ('df300000-0000-4000-8000-000000000095'::uuid,
     jsonb_build_object('version', 1, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses',
         'range', chr(160) || 'A1:Z9' || chr(160), 'headerRow', 1)))),
    -- A row integer no spreadsheet has. Bounded on the DIGIT COUNT, so it never
    -- reaches `::bigint` and never raises 22003 out of this STABLE function.
    ('df300000-0000-4000-8000-000000000096'::uuid,
     jsonb_build_object('version', 1, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', 'A1:B99999999999999999999999', 'headerRow', 1)))),
    -- The mapping generation: absent, stringly-typed, fractional, and simply
    -- unequal. All four passed against a job at generation 1.
    ('df300000-0000-4000-8000-000000000097'::uuid,
     jsonb_build_object('sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', 'A1:Z9', 'headerRow', 1)))),
    ('df300000-0000-4000-8000-000000000098'::uuid,
     jsonb_build_object('version', '1', 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', 'A1:Z9', 'headerRow', 1)))),
    ('df300000-0000-4000-8000-000000000099'::uuid,
     jsonb_build_object('version', 1.5, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', 'A1:Z9', 'headerRow', 1)))),
    ('df300000-0000-4000-8000-00000000009a'::uuid,
     jsonb_build_object('version', 999, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', 'A1:Z9', 'headerRow', 1)))),
    -- A header row that is a JSON string. `->>` renders it as the same text a
    -- genuine number produces, so the type guard is the only thing that sees it.
    ('df300000-0000-4000-8000-00000000009b'::uuid,
     jsonb_build_object('version', 1, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', 'A1:Z9', 'headerRow', '1')))),
    -- The positives. An unqualified block is read under its entry's own tab; an
    -- exactly matching single-quoted qualifier is accepted; `''''` decodes to one
    -- literal quote inside a sheet name; and both bounds are inclusive.
    ('df300000-0000-4000-8000-00000000009c'::uuid,
     jsonb_build_object('version', 1, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', 'A1:Z9', 'headerRow', 1)))),
    ('df300000-0000-4000-8000-00000000009d'::uuid,
     jsonb_build_object('version', 1, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', '''Responses''!A1:Z9', 'headerRow', 1)))),
    ('df300000-0000-4000-8000-00000000009e'::uuid,
     jsonb_build_object('version', 1, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Officer''s Log',
         'range', '''Officer''''s Log''!A1:Z9', 'headerRow', 1)))),
    ('df300000-0000-4000-8000-00000000009f'::uuid,
     jsonb_build_object('version', 1, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', 'A1:B10000000', 'headerRow', 1)))),
    ('df300000-0000-4000-8000-0000000000a0'::uuid,
     jsonb_build_object('version', 1, 'sourceType', 'application_responses',
       'sourceFileId', 'synthetic-precision-file',
       'tabs', jsonb_build_array(jsonb_build_object(
         'tabName', 'Responses', 'range', 'A1:ZZZ9', 'headerRow', 1))))
) AS shape(id, mapping);

SELECT extensions.ok(
  'Select an exact Sheet range.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000090')),
  'a qualifier naming a different tab than its entry blocks the claim'
);

SELECT extensions.ok(
  'Select an exact Sheet range.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000091')),
  'a double-quoted qualifier is two literal characters of a sheet name and blocks'
);

SELECT extensions.ok(
  'Select an exact Sheet range.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000092')),
  'a range whose start column is past its end column blocks'
);

SELECT extensions.ok(
  'Select an exact Sheet range.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000093')),
  'a range whose start row is past its end row blocks'
);

SELECT extensions.ok(
  'Select an exact Sheet range.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000094')),
  'an ASCII-space-padded range blocks rather than being trimmed into validity'
);

SELECT extensions.ok(
  'Select an exact Sheet range.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000095')),
  'a U+00A0-padded range blocks, which a locale space class never saw'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000096')
  $$,
  'an arbitrarily long row integer returns a bounded blocker list rather than raising 22003'
);

SELECT extensions.ok(
  'Select an exact Sheet range.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000096')),
  'an arbitrarily long row integer blocks'
);

SELECT extensions.ok(
  'Inspect and map the selected columns again.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000097')),
  'a mapping snapshot carrying no generation blocks rather than skipping the check'
);

SELECT extensions.ok(
  'Inspect and map the selected columns again.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000098')),
  'a stringly-typed mapping generation blocks, because ->> renders "1" and 1 alike'
);

SELECT extensions.ok(
  'Inspect and map the selected columns again.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-000000000099')),
  'a fractional mapping generation blocks'
);

SELECT extensions.ok(
  'Inspect and map the selected columns again.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000009a')),
  'a mapping generation of 999 against a job at generation 1 blocks'
);

SELECT extensions.ok(
  'Choose the header row for every selected tab.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000009b')),
  'a header row that is a JSON string blocks rather than being read as a number'
);

-- The positives, each proving the parser accepts what a real mapping writes.
SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000009c')) AS blocker
    WHERE blocker IN ('Select an exact Sheet range.', 'Select an exact Sheet tab.',
      'Inspect and map the selected columns again.',
      'Choose the header row for every selected tab.')
  ),
  ARRAY[]::text[],
  'an unqualified block is read under its own entry tab and raises no mapping blocker'
);

SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000009d')) AS blocker
    WHERE blocker IN ('Select an exact Sheet range.', 'Select an exact Sheet tab.',
      'Inspect and map the selected columns again.',
      'Choose the header row for every selected tab.')
  ),
  ARRAY[]::text[],
  'a single-quoted qualifier equal to its entry tab raises no mapping blocker'
);

SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000009e')) AS blocker
    WHERE blocker IN ('Select an exact Sheet range.', 'Select an exact Sheet tab.',
      'Inspect and map the selected columns again.',
      'Choose the header row for every selected tab.')
  ),
  ARRAY[]::text[],
  'a sheet name containing an escaped single quote decodes to its own tab name'
);

SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-00000000009f')) AS blocker
    WHERE blocker IN ('Select an exact Sheet range.', 'Select an exact Sheet tab.',
      'Inspect and map the selected columns again.',
      'Choose the header row for every selected tab.')
  ),
  ARRAY[]::text[],
  'row 10,000,000 is inside the bound rather than past it'
);

SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-0000000000a0')) AS blocker
    WHERE blocker IN ('Select an exact Sheet range.', 'Select an exact Sheet tab.',
      'Inspect and map the selected columns again.',
      'Choose the header row for every selected tab.')
  ),
  ARRAY[]::text[],
  'column ZZZ is the last column the one-to-three-letter shape names and is accepted'
);

-- ---------------------------------------------------------------------------
-- A JSON NUMBER that renders as a canonical digest.
--
-- This is the case `->>` alone cannot see: `jsonb ->> 'headRevisionId'` turns
-- the JSON number 555...5 into exactly the same 64 characters the JSON string
-- "555...5" produces, so it satisfies `^[0-9a-f]{64}$` and compares equal to the
-- attachment's digest. Only `jsonb_typeof(...) = 'string'` distinguishes them,
-- and the pair below differs in nothing else.
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  drive_access_state, drive_trashed, drive_file_name, drive_mime_type,
  uploaded_file_path, settings
) VALUES (
  'df200000-0000-4000-8000-000000000011',
  'df100000-0000-4000-8000-000000000001',
  'student_roster',
  'Synthetic numeric-digest CSV source',
  'df150000-0000-4000-8000-000000000001',
  'uploaded_csv',
  'accessible', false, 'Synthetic numeric.csv', 'text/csv',
  'df100000-0000-4000-8000-000000000001/df200000-0000-4000-8000-000000000011/1.csv',
  jsonb_build_object(
    'sourceKind', 'student_roster',
    'stagedUpload', true,
    'stagingObjectId', 'df210000-0000-4000-8000-000000000004',
    'stagingGeneration', 1,
    'stagingContentHash', repeat('5', 64),
    'stagingByteLength', 1024,
    'stagingReadyAt', now(),
    'evidenceRevision', repeat('5', 64)
  )
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata,
  mapping_snapshot, mapping_version, source_content_hash, snapshot_hash,
  snapshot_row_count, snapshot_contract_version
)
SELECT
  shape.id,
  'df100000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000011',
  'df000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster',
  'df210000-0000-4000-8000-000000000004',
  'Synthetic numeric.csv', 'Roster', 'Roster!A1:C3',
  now(),
  jsonb_build_object(
    'id', 'df210000-0000-4000-8000-000000000004',
    'sourceProvider', 'uploaded_csv',
    'name', 'Synthetic numeric.csv',
    'mimeType', 'text/csv',
    'headRevisionId', shape.frozen_digest,
    'stagingGeneration', 1,
    'readyAt', now(),
    'accessState', 'accessible', 'trashed', false
  ),
  jsonb_build_object('version', 1, 'sourceType', 'student_roster',
    'sourceFileId', 'df210000-0000-4000-8000-000000000004',
    'sourceProvider', 'uploaded_csv',
    'tabs', jsonb_build_array(
      jsonb_build_object('tabName', 'Roster', 'range', 'Roster!A1:C3', 'headerRow', 1))),
  1, repeat('5', 64), repeat('2', 64), 1, 'csf-normalized-import/v1'
FROM (
  VALUES
    -- The digest as a JSON NUMBER. `->>` renders it into the exact 64 characters
    -- every other record of these bytes holds.
    ('df300000-0000-4000-8000-0000000000a1'::uuid,
     to_jsonb(repeat('5', 64)::numeric)),
    -- The identical digest as the JSON STRING it is supposed to be.
    ('df300000-0000-4000-8000-0000000000a2'::uuid,
     to_jsonb(repeat('5', 64)))
) AS shape(id, frozen_digest);

SELECT extensions.ok(
  'Run a fresh preview so this import records its source evidence.' = ANY (
    plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-0000000000a1')),
  'a frozen uploaded digest that is a 64-digit JSON number blocks despite rendering as canonical hex'
);

SELECT extensions.is(
  ARRAY(
    SELECT blocker
    FROM unnest(plugin_data.csf_import_preview_claim_blockers(
      'df100000-0000-4000-8000-000000000001',
      'df300000-0000-4000-8000-0000000000a2')) AS blocker
    WHERE blocker IN (
      'Run a fresh preview so this import records its source evidence.',
      'A newer workbook was uploaded for this source. Run a fresh preview.',
      'This source was replaced with a different kind of file. Run a fresh preview.'
    )
  ),
  ARRAY[]::text[],
  'the very same digest as a JSON string, with all four records agreeing, raises no source-evidence blocker'
);

SELECT * FROM extensions.finish();

ROLLBACK;
