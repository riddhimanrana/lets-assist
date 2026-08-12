-- The immutable uploaded workbook can prove itself, and only when it actually can.
--
-- This is the third receipt issuer. `csf_refresh_sheet_source_evidence` proves a live
-- Google file, `csf_issue_uploaded_source_evidence` proves a locked staged generation, and
-- `csf_issue_immutable_upload_source_evidence` proves the one family neither of those can
-- describe: a partner-club audit workbook written ONCE to a permanent per-batch object path
-- with `upsert: false`, which has no Drive object to re-read and no staged generation to
-- lock. Before it existed, every such batch reached
-- `csf_commit_partner_audit_import` with a NULL token and was refused with no way out.
--
-- What this file proves, in order:
--
--   A. the issuer accepts exactly the reviewed immutable shape, and what it writes is
--      what an independent recomputation of the same coordinates produces;
--   B. every way of not being that shape is a refusal -- wrong organization, wrong or
--      unauthorized officer, wrong preview, a mutable or mis-typed provider, a staged
--      source, and missing, malformed or disagreeing immutable coordinates on either the
--      source or the preview;
--   C. the receipt is spent by a real commit, exactly once, bound to that one preview;
--   D. re-issuing and mutating the source both invalidate a receipt already in hand;
--   E. the two uploaded families cannot be substituted for each other;
--   F. the issuer is reachable by service_role and nobody else, the consume by nobody,
--      and the receipt-less commit overload is gone.
--
-- Nothing here is a source scan. Every assertion runs the functions.
--
-- Every identity, path and digest is synthetic and lives only inside this rolled-back
-- transaction. The digests are literal repeated hex rather than a hash of anything, which
-- is what a canonical lowercase sha256 has to look like and says nothing about any file.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- An exact plan. `no_plan()` cannot distinguish "every assertion passed" from "some never
-- ran", and an evidence gate that silently stops running is the failure this file exists
-- to catch.
SELECT extensions.plan(48);

-- ---------------------------------------------------------------------------
-- Fixture.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) VALUES
  ('e4000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'immutable-upload-officer@local.test', now(), '{}', '{}', now(), now()),
  -- A real user who is NOT a member of the organization. The difference between
  -- "unknown user" and "known user without authority" is a difference the issuer is
  -- required to make, so both are exercised.
  ('e4000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'immutable-upload-stranger@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code) VALUES
  ('e4100000-0000-4000-8000-000000000001', 'CSF Immutable Upload Evidence',
   'csf-immutable-upload-evidence', 'school', '995221'),
  ('e4100000-0000-4000-8000-000000000002', 'CSF Immutable Upload Neighbour',
   'csf-immutable-upload-neighbour', 'school', '995222');

INSERT INTO public.organization_members (organization_id, user_id, role, status) VALUES
  ('e4100000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
   'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'e4200000-0000-4000-8000-000000000001', 'e4100000-0000-4000-8000-000000000001',
  'F34', 'Fall 2034', '2034-2035', 'fall'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name,
  record_status
) VALUES (
  'e4300000-0000-4000-8000-000000000001', 'e4100000-0000-4000-8000-000000000001',
  'Immutable', 'Auditee', 'immutable', 'auditee', 'active'
);

INSERT INTO plugin_data.csf_partner_clubs (
  id, organization_id, name, approved_point_types
) VALUES (
  'e4800000-0000-4000-8000-000000000001', 'e4100000-0000-4000-8000-000000000001',
  'Synthetic Immutable Club', ARRAY['non_drive']::text[]
);

-- The sources. One valid immutable workbook, and one of every shape that must NOT receive
-- an immutable receipt.
--
--   ...0001  valid: uploaded_xlsx, a permanent object path, contentHash = fileHash
--   ...0002  uploaded_csv -- the immutable path writes a workbook, never a CSV
--   ...0003  google_sheets -- a mutable external provider
--   ...0004  uploaded_xlsx pointing at a STAGED generation, which has its own issuer
--   ...0005  uploaded_xlsx with no recorded object path at all
--   ...0006  uploaded_xlsx that recorded no digest at all
--   ...0007  uploaded_xlsx whose two records of the digest disagree
--
-- There is deliberately no "uppercase digest" source here, and its absence is a finding
-- rather than a gap: `csf_sheet_sources_uploaded_digest_shape_check` already makes a
-- non-canonical `contentHash` on an uploaded source unrepresentable, so that row cannot be
-- inserted to be refused. `fileHash` carries no such constraint, which is why the
-- disagreeing pair below is the shape that has to be tested at the issuer.
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, provider, spreadsheet_id, uploaded_file_path,
  drive_file_id, drive_mime_type, drive_modified_at, sync_status, settings
) VALUES
  ('e4500000-0000-4000-8000-000000000001', 'e4100000-0000-4000-8000-000000000001',
   'partner_club_audit', 'Immutable audit source', 'uploaded_xlsx', NULL,
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/e4900000-0000-4000-8000-000000000001/synthetic-audit.xlsx',
   NULL, NULL, NULL, 'not_synced',
   jsonb_build_object(
     'sourceKind', 'partner_club_audit',
     'contentHash', repeat('a', 64),
     'fileHash', repeat('a', 64)
   )),
  ('e4500000-0000-4000-8000-000000000002', 'e4100000-0000-4000-8000-000000000001',
   'partner_club_audit', 'Immutable CSV source', 'uploaded_csv', NULL,
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/csv/synthetic-audit.csv',
   NULL, NULL, NULL, 'not_synced',
   jsonb_build_object(
     'sourceKind', 'partner_club_audit',
     -- Distinct from every other fixture source's digest: an organization may not
     -- register two uploaded sources of one kind for the same bytes, and that unique
     -- index is not what this file is about.
     'contentHash', repeat('b', 64),
     'fileHash', repeat('b', 64)
   )),
  ('e4500000-0000-4000-8000-000000000003', 'e4100000-0000-4000-8000-000000000001',
   'partner_club_audit', 'Mutable Google source', 'google_sheets', 'immutable-google', NULL,
   'immutable-google', 'application/vnd.google-apps.spreadsheet', '2034-08-01T00:00:00Z',
   'not_synced', '{"sourceKind":"partner_club_audit"}'),
  ('e4500000-0000-4000-8000-000000000004', 'e4100000-0000-4000-8000-000000000001',
   'partner_club_audit', 'Staged upload source', 'uploaded_xlsx', NULL,
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/staged/synthetic-audit.xlsx',
   NULL, NULL, NULL, 'not_synced',
   jsonb_build_object(
     'sourceKind', 'partner_club_audit',
     'contentHash', repeat('c', 64),
     'fileHash', repeat('c', 64),
     'stagingObjectId', 'e4b00000-0000-4000-8000-000000000001',
     'stagingGeneration', 1,
     'stagingContentHash', repeat('c', 64),
     'stagingByteLength', 4096
   )),
  ('e4500000-0000-4000-8000-000000000005', 'e4100000-0000-4000-8000-000000000001',
   'partner_club_audit', 'Pathless upload source', 'uploaded_xlsx', NULL, NULL,
   NULL, NULL, NULL, 'not_synced',
   jsonb_build_object(
     'sourceKind', 'partner_club_audit',
     'contentHash', repeat('d', 64),
     'fileHash', repeat('d', 64)
   )),
  ('e4500000-0000-4000-8000-000000000006', 'e4100000-0000-4000-8000-000000000001',
   'partner_club_audit', 'Digestless upload source', 'uploaded_xlsx', NULL,
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/malformed/synthetic-audit.xlsx',
   NULL, NULL, NULL, 'not_synced',
   -- No digest of any kind. The table permits this -- its shape check only constrains a
   -- contentHash that is present -- so the refusal has to come from the issuer.
   '{"sourceKind":"partner_club_audit"}'),
  ('e4500000-0000-4000-8000-000000000007', 'e4100000-0000-4000-8000-000000000001',
   'partner_club_audit', 'Self-disagreeing source', 'uploaded_xlsx', NULL,
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/disagreeing/synthetic-audit.xlsx',
   NULL, NULL, NULL, 'not_synced',
   jsonb_build_object(
     'sourceKind', 'partner_club_audit',
     'contentHash', repeat('e', 64),
     'fileHash', repeat('f', 64)
   ));

-- The previews. `...0001` is the reviewed immutable snapshot the commit below writes;
-- every other one names exactly one way of not being that.
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range, source_modified_at,
  source_file_metadata, source_content_hash, mapping_snapshot, mapping_version,
  correlation_id, summary, completed_at
) VALUES
  ('e4600000-0000-4000-8000-000000000001', 'e4100000-0000-4000-8000-000000000001',
   'e4500000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
   'preview', 'completed', 'partner_club_audit',
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/e4900000-0000-4000-8000-000000000001/synthetic-audit.xlsx',
   'Synthetic Audit', 'Audit', 'Audit!A1:E12', NULL, '{}', repeat('a', 64),
   '{"version":1,"sourceType":"partner_club_audit"}', 1,
   'e4d00000-0000-4000-8000-000000000001', '{}', now()),
  -- A SECOND reviewed preview of the SAME source, which is what makes the preview binding
  -- testable at all: a receipt issued against this one must not spend on the first.
  ('e4600000-0000-4000-8000-000000000002', 'e4100000-0000-4000-8000-000000000001',
   'e4500000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
   'preview', 'completed', 'partner_club_audit',
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/e4900000-0000-4000-8000-000000000001/synthetic-audit.xlsx',
   'Synthetic Audit Again', 'Audit', 'Audit!A1:E12', NULL, '{}', repeat('a', 64),
   '{"version":1,"sourceType":"partner_club_audit"}', 1,
   'e4d00000-0000-4000-8000-000000000002', '{}', now()),
  -- Froze a different object path than the source records.
  ('e4600000-0000-4000-8000-000000000003', 'e4100000-0000-4000-8000-000000000001',
   'e4500000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
   'preview', 'completed', 'partner_club_audit',
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/elsewhere/synthetic-audit.xlsx',
   'Synthetic Audit', 'Audit', 'Audit!A1:E12', NULL, '{}', repeat('a', 64),
   '{"version":1,"sourceType":"partner_club_audit"}', 1,
   'e4d00000-0000-4000-8000-000000000003', '{}', now()),
  -- Froze a different digest than the source records.
  ('e4600000-0000-4000-8000-000000000004', 'e4100000-0000-4000-8000-000000000001',
   'e4500000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
   'preview', 'completed', 'partner_club_audit',
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/e4900000-0000-4000-8000-000000000001/synthetic-audit.xlsx',
   'Synthetic Audit', 'Audit', 'Audit!A1:E12', NULL, '{}', repeat('9', 64),
   '{"version":1,"sourceType":"partner_club_audit"}', 1,
   'e4d00000-0000-4000-8000-000000000004', '{}', now()),
  -- Froze NO digest at all.
  ('e4600000-0000-4000-8000-000000000005', 'e4100000-0000-4000-8000-000000000001',
   'e4500000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
   'preview', 'completed', 'partner_club_audit',
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/e4900000-0000-4000-8000-000000000001/synthetic-audit.xlsx',
   'Synthetic Audit', 'Audit', 'Audit!A1:E12', NULL, '{}', NULL,
   '{"version":1,"sourceType":"partner_club_audit"}', 1,
   'e4d00000-0000-4000-8000-000000000005', '{}', now()),
  -- Froze a MODIFICATION TIME, which an object written once does not have.
  ('e4600000-0000-4000-8000-000000000006', 'e4100000-0000-4000-8000-000000000001',
   'e4500000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
   'preview', 'completed', 'partner_club_audit',
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/e4900000-0000-4000-8000-000000000001/synthetic-audit.xlsx',
   'Synthetic Audit', 'Audit', 'Audit!A1:E12', '2034-08-05T00:00:00Z', '{}', repeat('a', 64),
   '{"version":1,"sourceType":"partner_club_audit"}', 1,
   'e4d00000-0000-4000-8000-000000000006', '{}', now()),
  -- Froze a provider VERSION, which belongs to a Google preview.
  ('e4600000-0000-4000-8000-000000000007', 'e4100000-0000-4000-8000-000000000001',
   'e4500000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
   'preview', 'completed', 'partner_club_audit',
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/e4900000-0000-4000-8000-000000000001/synthetic-audit.xlsx',
   'Synthetic Audit', 'Audit', 'Audit!A1:E12', NULL, '{"version":"13"}', repeat('a', 64),
   '{"version":1,"sourceType":"partner_club_audit"}', 1,
   'e4d00000-0000-4000-8000-000000000007', '{}', now()),
  -- A COMMIT run, not a preview.
  ('e4600000-0000-4000-8000-000000000008', 'e4100000-0000-4000-8000-000000000001',
   'e4500000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
   'commit', 'completed', 'partner_club_audit',
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/e4900000-0000-4000-8000-000000000001/synthetic-audit.xlsx',
   'Synthetic Audit', 'Audit', 'Audit!A1:E12', NULL, '{}', repeat('a', 64),
   '{"version":1,"sourceType":"partner_club_audit"}', 1,
   -- A commit job must name the preview it came from -- `csf_commit_import_job_lineage`
   -- refuses one that does not. It names ...0003, a preview no batch below commits, so
   -- this row exists to be refused as a receipt target and does not accidentally become
   -- an idempotent-replay answer for either batch.
   'e4d00000-0000-4000-8000-000000000008',
   '{"previewJobId":"e4600000-0000-4000-8000-000000000003"}', now()),
  -- A preview of a DIFFERENT source.
  ('e4600000-0000-4000-8000-000000000009', 'e4100000-0000-4000-8000-000000000001',
   'e4500000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-000000000001',
   'preview', 'completed', 'partner_club_audit',
   'immutable-google', 'Google Audit', 'Audit', 'Audit!A1:E12', NULL, '{}', NULL,
   '{"version":1,"sourceType":"partner_club_audit"}', 1,
   'e4d00000-0000-4000-8000-000000000009', '{}', now());

-- One ready row per preview that a commit will actually read. Readiness refuses a commit
-- while any sibling is undecided, so the two previews the commits below use carry exactly
-- one `pending` row each.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, term_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, matched_profile_id, import_status, correlation_id
) VALUES
  ('e4700000-0000-4000-8000-000000000001', 'e4100000-0000-4000-8000-000000000001',
   'e4600000-0000-4000-8000-000000000001', 'e4500000-0000-4000-8000-000000000001',
   'e4200000-0000-4000-8000-000000000001', 'Audit', 2, '{"Name":"Immutable Auditee"}',
   '{"partnerAuditBatchId":"e4900000-0000-4000-8000-000000000001","source":{"rowHash":"immutable-audit-hash-1"}}',
   'immutable-audit-hash-1', 'e4300000-0000-4000-8000-000000000001', 'pending',
   'e4d00000-0000-4000-8000-000000000001'),
  ('e4700000-0000-4000-8000-000000000002', 'e4100000-0000-4000-8000-000000000001',
   'e4600000-0000-4000-8000-000000000002', 'e4500000-0000-4000-8000-000000000001',
   'e4200000-0000-4000-8000-000000000001', 'Audit', 2, '{"Name":"Immutable Auditee"}',
   '{"partnerAuditBatchId":"e4900000-0000-4000-8000-000000000002","source":{"rowHash":"immutable-audit-hash-2"}}',
   'immutable-audit-hash-2', 'e4300000-0000-4000-8000-000000000001', 'pending',
   'e4d00000-0000-4000-8000-000000000002');

INSERT INTO plugin_data.csf_partner_submission_batches (
  id, organization_id, partner_club_id, term_id, title, source, source_url, status,
  submitted_by, summary
) VALUES
  ('e4900000-0000-4000-8000-000000000001', 'e4100000-0000-4000-8000-000000000001',
   'e4800000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000001',
   'Synthetic immutable audit', 'sheet',
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/e4900000-0000-4000-8000-000000000001/synthetic-audit.xlsx',
   'needs_verification', 'e4000000-0000-4000-8000-000000000001',
   '{"sheetImportPreviewJobId":"e4600000-0000-4000-8000-000000000001","sheetImportCorrelationId":"e4d00000-0000-4000-8000-000000000001"}'),
  ('e4900000-0000-4000-8000-000000000002', 'e4100000-0000-4000-8000-000000000001',
   'e4800000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000001',
   'Synthetic immutable audit two', 'sheet',
   'csf/e4100000-0000-4000-8000-000000000001/partner-audits/e4900000-0000-4000-8000-000000000001/synthetic-audit.xlsx',
   'needs_verification', 'e4000000-0000-4000-8000-000000000001',
   '{"sheetImportPreviewJobId":"e4600000-0000-4000-8000-000000000002","sheetImportCorrelationId":"e4d00000-0000-4000-8000-000000000002"}');

INSERT INTO plugin_data.csf_partner_submission_rows (
  id, organization_id, batch_id, profile_id, matched_status, raw_data, normalized_data,
  claimed_points, point_type
) VALUES
  ('e4a00000-0000-4000-8000-000000000001', 'e4100000-0000-4000-8000-000000000001',
   'e4900000-0000-4000-8000-000000000001', 'e4300000-0000-4000-8000-000000000001',
   'matched', '{"Name":"Immutable Auditee"}',
   '{"source":{"rowHash":"immutable-audit-hash-1"}}', 3, 'non_drive'),
  ('e4a00000-0000-4000-8000-000000000002', 'e4100000-0000-4000-8000-000000000001',
   'e4900000-0000-4000-8000-000000000002', 'e4300000-0000-4000-8000-000000000001',
   'matched', '{"Name":"Immutable Auditee"}',
   '{"source":{"rowHash":"immutable-audit-hash-2"}}', 5, 'non_drive');

-- ---------------------------------------------------------------------------
-- A. The issuer accepts exactly the reviewed immutable shape.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE immutable_receipts (label text PRIMARY KEY, token uuid);

INSERT INTO immutable_receipts (label, token)
SELECT
  'first',
  (plugin_data.csf_issue_immutable_upload_source_evidence(
    'e4100000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001',
    'e4500000-0000-4000-8000-000000000001',
    'e4600000-0000-4000-8000-000000000001'
  )->>'evidenceToken')::uuid;

SELECT extensions.is(
  (SELECT count(*)::integer FROM immutable_receipts WHERE label = 'first' AND token IS NOT NULL),
  1,
  'the immutable uploaded family is issued a real receipt'
);

SELECT extensions.is(
  (SELECT token.provider FROM plugin_data.csf_sheet_source_evidence_tokens AS token
   JOIN immutable_receipts AS receipt ON receipt.token = token.nonce
   WHERE receipt.label = 'first'),
  'uploaded_xlsx',
  'and it is an uploaded_xlsx receipt'
);

-- The staged coordinates are ABSENT rather than defaulted: a receipt carrying half a
-- staged identity is what the third constraint arm exists to keep unrepresentable.
SELECT extensions.ok(
  (SELECT token.staging_object_id IS NULL
      AND token.staging_generation IS NULL
      AND token.byte_length IS NULL
      AND token.provider_version IS NULL
   FROM plugin_data.csf_sheet_source_evidence_tokens AS token
   JOIN immutable_receipts AS receipt ON receipt.token = token.nonce
   WHERE receipt.label = 'first'),
  'carrying no staged generation, no byte length and no provider version'
);

-- The identity it attests to is the source's own object path, and the freshness evidence
-- is the source's own digest. Neither was supplied by the caller: the caller passed four
-- identifiers.
SELECT extensions.is(
  (SELECT token.provider_file_id FROM plugin_data.csf_sheet_source_evidence_tokens AS token
   JOIN immutable_receipts AS receipt ON receipt.token = token.nonce
   WHERE receipt.label = 'first'),
  'csf/e4100000-0000-4000-8000-000000000001/partner-audits/e4900000-0000-4000-8000-000000000001/synthetic-audit.xlsx',
  'the receipt names the permanent object path the source records'
);

SELECT extensions.is(
  (SELECT token.content_digest FROM plugin_data.csf_sheet_source_evidence_tokens AS token
   JOIN immutable_receipts AS receipt ON receipt.token = token.nonce
   WHERE receipt.label = 'first'),
  repeat('a', 64),
  'and the sha256 the source records for those bytes'
);

-- The digest, recomputed here from the same coordinates by an independent expression.
-- The receipt works below because it is correctly shaped, not because this file asserted
-- that it should be.
SELECT extensions.is(
  (SELECT token.metadata_digest FROM plugin_data.csf_sheet_source_evidence_tokens AS token
   JOIN immutable_receipts AS receipt ON receipt.token = token.nonce
   WHERE receipt.label = 'first'),
  encode(
    sha256(convert_to(
      plugin_data.csf_canonical_json(jsonb_build_object(
        'provider', 'uploaded_xlsx',
        'immutableObjectPath',
        'csf/e4100000-0000-4000-8000-000000000001/partner-audits/e4900000-0000-4000-8000-000000000001/synthetic-audit.xlsx',
        'contentHash', repeat('a', 64),
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )),
      'UTF8'
    )),
    'hex'
  ),
  'the metadata digest is the canonical digest of the immutable coordinates'
);

SELECT extensions.is(
  (SELECT source.settings->>'evidenceRevision'
   FROM plugin_data.csf_sheet_sources AS source
   WHERE source.id = 'e4500000-0000-4000-8000-000000000001'),
  repeat('a', 64),
  'issuing writes the content digest as the source evidence revision'
);

SELECT extensions.is(
  (SELECT source.evidence_generation
   FROM plugin_data.csf_sheet_sources AS source
   WHERE source.id = 'e4500000-0000-4000-8000-000000000001'),
  1::bigint,
  'and advances the source evidence generation'
);

-- ---------------------------------------------------------------------------
-- B. Everything that is not that shape is a refusal.
-- ---------------------------------------------------------------------------
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      NULL,
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000001',
      'e4600000-0000-4000-8000-000000000001'
    )
  $$,
  '22023',
  'Issuing CSF uploaded-workbook evidence requires an organization, an officer, a source, and the preview.',
  'a receipt cannot be issued without all four identifiers'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000002',
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000001',
      'e4600000-0000-4000-8000-000000000001'
    )
  $$,
  '23503',
  'CSF sheet source was not found for this organization.',
  'a source in another organization is not found rather than proved'
);

-- Authority, and it is checked before any shape question, so an unauthorized caller
-- learns nothing about the source it named.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000002',
      'e4500000-0000-4000-8000-000000000001',
      'e4600000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'This officer is not an active member of the organization whose CSF import they are acting on.',
  'a known user with no membership cannot issue a receipt'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-0000000000ff',
      'e4500000-0000-4000-8000-000000000001',
      'e4600000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'The acting officer for this CSF import is not a known user.',
  'and an unknown actor is refused by name rather than treated as absent'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000003',
      'e4600000-0000-4000-8000-000000000009'
    )
  $$,
  '23514',
  'This CSF source is not an immutable uploaded workbook, so its evidence comes from a live provider read.',
  'a mutable Google source is refused: its evidence is a live provider read'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000002',
      'e4600000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'This CSF source is not an immutable uploaded workbook, so its evidence comes from a live provider read.',
  'and an uploaded_csv source is refused too: a CSV receipt authorizes a different parser'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000004',
      'e4600000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'This CSF source points at a staged workbook generation, so its evidence is issued from that generation.',
  'a source with a staged attachment belongs to the other uploaded issuer'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000005',
      'e4600000-0000-4000-8000-000000000001'
    )
  $$,
  '55000',
  'This CSF source records no uploaded workbook to prove, so this import cannot be committed.',
  'a source with no recorded object path has nothing to attest to'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000006',
      'e4600000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'This CSF source''s recorded workbook digest is not a usable sha256 digest of the uploaded bytes.',
  'a source that recorded no digest has nothing a commit could be checked against'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000007',
      'e4600000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'This CSF source''s recorded workbook digest is not a usable sha256 digest of the uploaded bytes.',
  'and a source whose two records of one digest disagree proves nothing about any bytes'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000001',
      'e4600000-0000-4000-8000-000000000008'
    )
  $$,
  '23514',
  'CSF source evidence is issued against a preview run, not a commit run.',
  'a commit run is not something a receipt can be issued against'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000001',
      'e4600000-0000-4000-8000-000000000009'
    )
  $$,
  '23514',
  'That CSF preview was taken from a different source.',
  'and neither is a preview of some other source'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000001',
      'e4600000-0000-4000-8000-000000000005'
    )
  $$,
  '23514',
  'This CSF preview did not record the workbook evidence a commit must be checked against; preview it again.',
  'a preview that froze no digest cannot be checked against anything'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000001',
      'e4600000-0000-4000-8000-000000000003'
    )
  $$,
  '23514',
  'A different workbook is attached to this CSF source than the one this preview read; preview it again.',
  'a preview that froze another object path is a replaced workbook, not a receipt'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000001',
      'e4600000-0000-4000-8000-000000000004'
    )
  $$,
  '23514',
  'The workbook attached to this CSF source is not the bytes this preview read; preview it again.',
  'and a preview that froze another digest read different bytes'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000001',
      'e4600000-0000-4000-8000-000000000006'
    )
  $$,
  '23514',
  'This CSF preview recorded a source modification time, so it was not taken from an immutable uploaded workbook; preview it again.',
  'a frozen modification time is a mutable provider''s coordinate and refuses the family'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_issue_immutable_upload_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000001',
      'e4600000-0000-4000-8000-000000000007'
    )
  $$,
  '23514',
  'This CSF preview froze provider evidence that does not describe this uploaded workbook; preview it again.',
  'and frozen provider metadata is checked rather than disregarded'
);

-- None of those refusals wrote anything: the generation is still the one the single
-- successful issue above left behind.
SELECT extensions.is(
  (SELECT source.evidence_generation
   FROM plugin_data.csf_sheet_sources AS source
   WHERE source.id = 'e4500000-0000-4000-8000-000000000001'),
  1::bigint,
  'a refused issue advances nothing'
);

-- ---------------------------------------------------------------------------
-- C. The receipt is spent by a real commit, exactly once, bound to that preview.
-- ---------------------------------------------------------------------------
--
-- The receipt in hand was issued for preview ...0001. Batch ...0002 links preview ...0002,
-- so this is a receipt for the right source, the right officer and the wrong preview --
-- the case the token's preview binding exists for.
SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_commit_partner_audit_import(
        'e4100000-0000-4000-8000-000000000001',
        'e4900000-0000-4000-8000-000000000002',
        'pending',
        'e4000000-0000-4000-8000-000000000001',
        'Attempted to commit one preview with the other preview''''s receipt.',
        NULL,
        %L
      )
    $$,
    (SELECT token FROM immutable_receipts WHERE label = 'first')
  ),
  '42501',
  'This CSF source freshness check was issued for a different preview; check this preview and import again.',
  'an immutable receipt cannot be spent on another preview of the same source'
);

SELECT extensions.is(
  (SELECT token.consumed_at FROM plugin_data.csf_sheet_source_evidence_tokens AS token
   JOIN immutable_receipts AS receipt ON receipt.token = token.nonce
   WHERE receipt.label = 'first'),
  NULL,
  'and refusing it does not spend it'
);

SELECT extensions.is(
  (SELECT (plugin_data.csf_commit_partner_audit_import(
    'e4100000-0000-4000-8000-000000000001',
    'e4900000-0000-4000-8000-000000000001',
    'pending',
    'e4000000-0000-4000-8000-000000000001',
    'Committed the immutable partner-audit workbook against its own receipt.',
    NULL,
    (SELECT token FROM immutable_receipts WHERE label = 'first')
  ))->>'generated')::integer,
  1,
  'the immutable uploaded family can now commit'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_credit_records AS credit
   WHERE credit.organization_id = 'e4100000-0000-4000-8000-000000000001'
     AND credit.profile_id = 'e4300000-0000-4000-8000-000000000001'),
  1,
  'and the credit it exists to write is written'
);

SELECT extensions.is(
  (SELECT token.consumed_by_job_id FROM plugin_data.csf_sheet_source_evidence_tokens AS token
   JOIN immutable_receipts AS receipt ON receipt.token = token.nonce
   WHERE receipt.label = 'first'),
  'e4600000-0000-4000-8000-000000000001'::uuid,
  'the receipt is recorded as spent by the exact preview it was issued for'
);

-- Single use, durably. The spent receipt is offered to the OTHER batch, whose preview it
-- was never issued for either -- so if the spend check were the thing that regressed, the
-- preview binding would still refuse. Both are asserted rather than one standing in for
-- the other: the sentence names which check answered.
-- The batch is already committed, so the replay short-circuits ahead of the population
-- lock, the readiness gate and the consume. Offering it the spent receipt is therefore
-- not an error: a replay writes nothing new, and re-proving a durable snapshot would turn
-- a safe retry into a failure whenever the workbook has legitimately changed since.
SELECT extensions.lives_ok(
  format(
    $$
      SELECT plugin_data.csf_commit_partner_audit_import(
        'e4100000-0000-4000-8000-000000000001',
        'e4900000-0000-4000-8000-000000000001',
        'pending',
        'e4000000-0000-4000-8000-000000000001',
        'Attempted to spend one receipt twice.',
        NULL,
        %L
      )
    $$,
    (SELECT token FROM immutable_receipts WHERE label = 'first')
  ),
  'replaying the committed batch with the spent receipt short-circuits ahead of the consume'
);

SELECT extensions.is(
  (SELECT (plugin_data.csf_commit_partner_audit_import(
    'e4100000-0000-4000-8000-000000000001',
    'e4900000-0000-4000-8000-000000000001',
    'pending',
    'e4000000-0000-4000-8000-000000000001',
    'Replayed the committed batch with no receipt at all.',
    NULL,
    NULL
  ))->>'idempotent')::boolean,
  true,
  'a replay of an already-committed batch stays idempotent and needs no fresh receipt'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_credit_records AS credit
   WHERE credit.organization_id = 'e4100000-0000-4000-8000-000000000001'),
  1,
  'and writes nothing a second time'
);

-- The spent receipt against a batch that has NOT been committed: now the consume is
-- reached, and the durable single-use rule is what answers.
SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_commit_partner_audit_import(
        'e4100000-0000-4000-8000-000000000001',
        'e4900000-0000-4000-8000-000000000002',
        'pending',
        'e4000000-0000-4000-8000-000000000001',
        'Attempted to spend a used receipt on an uncommitted batch.',
        NULL,
        %L
      )
    $$,
    (SELECT token FROM immutable_receipts WHERE label = 'first')
  ),
  '42501',
  'This CSF source freshness check was issued for a different preview; check this preview and import again.',
  'a spent receipt is still refused on the preview it was never issued for'
);

-- ---------------------------------------------------------------------------
-- D. Re-issuing and mutating both invalidate a receipt already in hand.
-- ---------------------------------------------------------------------------
INSERT INTO immutable_receipts (label, token)
SELECT
  'second',
  (plugin_data.csf_issue_immutable_upload_source_evidence(
    'e4100000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001',
    'e4500000-0000-4000-8000-000000000001',
    'e4600000-0000-4000-8000-000000000002'
  )->>'evidenceToken')::uuid;

INSERT INTO immutable_receipts (label, token)
SELECT
  'third',
  (plugin_data.csf_issue_immutable_upload_source_evidence(
    'e4100000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001',
    'e4500000-0000-4000-8000-000000000001',
    'e4600000-0000-4000-8000-000000000002'
  )->>'evidenceToken')::uuid;

SELECT extensions.isnt(
  (SELECT token FROM immutable_receipts WHERE label = 'second'),
  (SELECT token FROM immutable_receipts WHERE label = 'third'),
  'retrying the issue is safe and hands back a new receipt each time'
);

-- Deliberately not idempotent, and this is the direction to be wrong in: the retry
-- NARROWS what can be spent. The superseded receipt fails the generation compare-and-set.
SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_consume_sheet_source_evidence(
        'e4100000-0000-4000-8000-000000000001',
        'e4500000-0000-4000-8000-000000000001',
        'e4000000-0000-4000-8000-000000000001',
        %L,
        'e4600000-0000-4000-8000-000000000002'
      )
    $$,
    (SELECT token FROM immutable_receipts WHERE label = 'second')
  ),
  '40001',
  'This CSF source changed after it was checked; preview it again before importing.',
  'and the superseded receipt can no longer be spent'
);

-- The source re-pointed at a different uploaded workbook, underneath a live receipt.
UPDATE plugin_data.csf_sheet_sources
SET uploaded_file_path = 'csf/e4100000-0000-4000-8000-000000000001/partner-audits/replacement/synthetic-audit.xlsx'
WHERE id = 'e4500000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_consume_sheet_source_evidence(
        'e4100000-0000-4000-8000-000000000001',
        'e4500000-0000-4000-8000-000000000001',
        'e4000000-0000-4000-8000-000000000001',
        %L,
        'e4600000-0000-4000-8000-000000000002'
      )
    $$,
    (SELECT token FROM immutable_receipts WHERE label = 'third')
  ),
  '40001',
  'A different workbook is attached to this CSF source than the one this import checked; preview it again.',
  'a source re-pointed at another workbook invalidates a receipt already in hand'
);

UPDATE plugin_data.csf_sheet_sources
SET uploaded_file_path = 'csf/e4100000-0000-4000-8000-000000000001/partner-audits/e4900000-0000-4000-8000-000000000001/synthetic-audit.xlsx',
    settings = settings || jsonb_build_object('fileHash', repeat('d', 64))
WHERE id = 'e4500000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_consume_sheet_source_evidence(
        'e4100000-0000-4000-8000-000000000001',
        'e4500000-0000-4000-8000-000000000001',
        'e4000000-0000-4000-8000-000000000001',
        %L,
        'e4600000-0000-4000-8000-000000000002'
      )
    $$,
    (SELECT token FROM immutable_receipts WHERE label = 'third')
  ),
  '40001',
  'A different workbook is attached to this CSF source than the one this import checked; preview it again.',
  'and so does changing either of the source''s two records of the digest'
);

-- Restored, so the family check below is about the family rather than the digest.
UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object('fileHash', repeat('a', 64))
WHERE id = 'e4500000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_consume_sheet_source_evidence(
        'e4100000-0000-4000-8000-000000000001',
        'e4500000-0000-4000-8000-000000000001',
        'e4000000-0000-4000-8000-0000000000ff',
        %L,
        'e4600000-0000-4000-8000-000000000002'
      )
    $$,
    (SELECT token FROM immutable_receipts WHERE label = 'third')
  ),
  '42501',
  'This CSF source freshness check was issued for a different officer, source, or organization.',
  'a receipt is bound to the officer it was issued for'
);

-- ---------------------------------------------------------------------------
-- E. The two uploaded families cannot be substituted for each other.
-- ---------------------------------------------------------------------------
--
-- The receipt is untouched and still current. What changes is the SOURCE: it now carries a
-- staged attachment, so it is the other uploaded family, and an immutable receipt is no
-- longer evidence about it. Without this the two arms would each happily satisfy the one
-- they were built for.
UPDATE plugin_data.csf_sheet_sources
SET settings = settings || jsonb_build_object(
  'stagingObjectId', 'e4b00000-0000-4000-8000-000000000002',
  'stagingGeneration', 1,
  'stagingContentHash', repeat('a', 64),
  'stagingByteLength', 4096
)
WHERE id = 'e4500000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_consume_sheet_source_evidence(
        'e4100000-0000-4000-8000-000000000001',
        'e4500000-0000-4000-8000-000000000001',
        'e4000000-0000-4000-8000-000000000001',
        %L,
        'e4600000-0000-4000-8000-000000000002'
      )
    $$,
    (SELECT token FROM immutable_receipts WHERE label = 'third')
  ),
  '23514',
  'This CSF source freshness check was issued for a different kind of source; preview it again before importing.',
  'a source that gains a staged attachment refuses the immutable receipt it already issued'
);

UPDATE plugin_data.csf_sheet_sources
SET settings = settings - 'stagingObjectId' - 'stagingGeneration'
  - 'stagingContentHash' - 'stagingByteLength'
WHERE id = 'e4500000-0000-4000-8000-000000000001';

-- And the reverse: a staged receipt cannot be spent for a source with no attachment. The
-- receipt is minted directly here, because the point is the CONSUME's family binding and
-- no issuer can produce this pairing.
INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
  organization_id, source_id, actor_user_id, preview_job_id, provider, nonce,
  evidence_generation, metadata_digest, provider_file_id, mime_type, modified_time,
  staging_object_id, staging_generation, content_digest, byte_length,
  access_checked_at, expires_at
)
SELECT
  'e4100000-0000-4000-8000-000000000001',
  'e4500000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'e4600000-0000-4000-8000-000000000002',
  'uploaded_xlsx',
  'e4e00000-0000-4000-8000-000000000001',
  source.evidence_generation,
  encode(
    sha256(convert_to(
      plugin_data.csf_canonical_json(jsonb_build_object(
        'provider', 'uploaded_xlsx',
        'stagingObjectId', 'e4b00000-0000-4000-8000-000000000003',
        'stagingGeneration', 1,
        'contentHash', repeat('a', 64),
        'byteLength', 4096,
        'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )),
      'UTF8'
    )),
    'hex'
  ),
  'e4b00000-0000-4000-8000-000000000003',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  now(),
  'e4b00000-0000-4000-8000-000000000003', 1, repeat('a', 64), 4096,
  now(), now() + interval '2 minutes'
FROM plugin_data.csf_sheet_sources AS source
WHERE source.id = 'e4500000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_consume_sheet_source_evidence(
      'e4100000-0000-4000-8000-000000000001',
      'e4500000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e4e00000-0000-4000-8000-000000000001',
      'e4600000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'This CSF source freshness check was issued for a different kind of source; preview it again before importing.',
  'and a staged receipt cannot be spent for a source that carries no staged attachment'
);

-- ---------------------------------------------------------------------------
-- F. Reachability, and the overload that is gone.
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_issue_immutable_upload_source_evidence(uuid, uuid, uuid, uuid)',
    'EXECUTE'
  ),
  'the permission-checked Server Action reaches the issuer as the service role'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_issue_immutable_upload_source_evidence(uuid, uuid, uuid, uuid)',
    'EXECUTE'
  ),
  'a signed-in browser session does not'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_issue_immutable_upload_source_evidence(uuid, uuid, uuid, uuid)',
    'EXECUTE'
  ),
  'and neither does an anonymous one'
);

-- The consume keeps the shape it was given: internal, reached by the owned SECURITY
-- DEFINER commits as the definer and by no role at all.
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_consume_sheet_source_evidence(uuid, uuid, uuid, uuid, uuid)',
    'EXECUTE'
  ),
  'replacing the consume did not make it externally reachable'
);

SELECT extensions.is(
  to_regprocedure('plugin_data.csf_commit_partner_audit_import(uuid,uuid,text,uuid,text,uuid)')::text,
  NULL,
  'and the receipt-less partner-audit overload still does not resolve'
);

SELECT extensions.is(
  to_regprocedure('plugin_data.csf_commit_meeting_attendance_import(uuid,uuid,uuid,text,uuid)')::text,
  NULL,
  'nor the receipt-less meeting-attendance one'
);

SELECT * FROM extensions.finish();

ROLLBACK;
