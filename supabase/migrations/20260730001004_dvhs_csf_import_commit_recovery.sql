-- DVHS CSF import: immutable-payload commits, a fenced attempt ledger, and a
-- claim-based uploaded staging lifecycle.
--
-- Wave 1 made a preview an immutable, digested snapshot. Committing one, and
-- staging an uploaded workbook, were still unsafe in five ways:
--
--   1. The commit wrapper accepted names, addresses, application evidence,
--      activities, meetings and the acting officer from its caller and forwarded
--      them. A stale or buggy service call could therefore write arbitrary
--      identity, Drive evidence, or point totals under a perfectly valid
--      immutable row and a perfectly valid attempt. Here the wrapper takes only
--      identifiers and derives every authoritative argument from the row's
--      immutable `normalized_data.commitPayload` and from the locked attempt.
--   2. The application branch forwarded caller emails into the legacy RPC, which
--      matches profiles on the normalized pair and seeds new profiles from the
--      plain pair. Unverified form evidence could become canonical identity. Here
--      the application branch passes NULL for all four canonical email arguments
--      unconditionally, in SQL, regardless of payload content.
--   3. Staging was addressed by content digest, so identical bytes for two source
--      types shared one object; opening a replacement immediately queued the
--      previous generation for deletion even while a preview was reading it; and
--      there was no claim ledger, so "is anyone still using this?" was
--      unanswerable. Here staging is a typed lifecycle
--      (uploading -> ready -> retire_pending -> tombstoned) with a claim table,
--      and deletion is queued only when retirement is requested and no live claim
--      remains. A tombstone keeps the typed immutable evidence for the generation
--      it names and keeps NO storage path: the private bucket/path lives in the
--      deletion outbox, which is what an idempotent storage retry reads.
--   4. Attempt metadata stayed mutable after an attempt finished, carried no
--      actor, and put the shared correlation only in `after_data` rather than in
--      the indexed `csf_admin_audit_events.correlation_id`.
--   5. Cleanup paths wrote directly to the job and source, so an expired worker
--      could overwrite a takeover worker's state, or downgrade its own already
--      finalized success. Here every failure path goes through one attempt-scoped
--      abort RPC that verifies ownership first and no-ops when ownership is lost.
--
-- Scope: central sheet sources only (application_responses, student_roster,
-- class_history). Contextual attendance and partner-club importers already commit
-- a whole batch in one transaction; they are given no attempt semantics, are not
-- annotated, and are not otherwise touched.
--
-- No pre-existing migration is edited. The three legacy row RPCs are unchanged in
-- body, but `service_role` loses EXECUTE on them so the fenced wrapper is the only
-- reachable path; the wrapper is SECURITY DEFINER and owned, so it may still call
-- them.

-- ---------------------------------------------------------------------------
-- Draft overload cleanup. Runs before anything here is created.
--
-- This migration was iterated locally, so a database may already carry functions from
-- an earlier draft of it. That is not merely untidy: PostgreSQL resolves by signature,
-- so an old `csf_retire_staging_object(uuid, uuid, text)` sitting beside the canonical
-- `(uuid, uuid, text, integer DEFAULT NULL)` makes every existing three-argument call
-- *ambiguous* and fails at runtime rather than at deploy time. The unsafe
-- sixteen-argument commit wrapper is worse: it accepted caller-supplied identity,
-- application, activity, meeting and requirement payloads and carried its own
-- service_role EXECUTE grant, so leaving it callable would leave the entire
-- identifiers-only boundary bypassable.
--
-- Both halves are deliberate. The named drops below are the exact draft signatures
-- known to have existed; the guarded sweep after them removes any other overload of a
-- name this migration owns, so a draft nobody wrote down cannot survive either. On a
-- fresh database every statement here is a no-op, which is what makes an empty replay
-- and a draft-over-draft repair reach the same state.
-- ---------------------------------------------------------------------------

-- The four-argument claim, superseded by the five-argument one that consumes a
-- live provider-evidence token in the same transaction. It must go before the
-- replacement is created: two overloads of this name would make every existing
-- four-argument call ambiguous at runtime rather than at deploy time.
DROP FUNCTION IF EXISTS plugin_data.csf_claim_import_commit_attempt(uuid, uuid, uuid, integer);

-- The provider-unaware evidence refresh. Its receipt was bound to organization,
-- source and actor but to no preview job, so it could authorize the commit of
-- any preview of that source. The replacement takes the preview as an argument;
-- leaving the old arity callable would leave the unbound receipt mintable.
DROP FUNCTION IF EXISTS plugin_data.csf_refresh_sheet_source_evidence(
  uuid, uuid, uuid, bigint, text, text, timestamptz, text, boolean, text, text
);

-- The synthetic fixture seam a draft of THIS migration installed and granted to
-- `service_role`. It now lives in `supabase/seeds/local-only.sql`, which a
-- production deployment never applies -- but a database that ran the draft still
-- holds these functions, still granted. Removing them from the file would leave
-- them installed forever, so they are dropped explicitly, and the convergence
-- block below asserts they are gone rather than merely unmentioned.
DROP FUNCTION IF EXISTS plugin_data.csf_seed_synthetic_import_fixture(uuid, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS plugin_data.csf_seed_reset_synthetic_import(uuid);
DROP FUNCTION IF EXISTS plugin_data.csf_assert_synthetic_fixture_scope(uuid);
DROP FUNCTION IF EXISTS plugin_data.csf_is_synthetic_fixture_id(uuid);

-- The four staging entry points that held service_role EXECUTE while accepting
-- no actor at all. They could not authorize anybody, so any service caller could
-- open, finalize, retire or release another organization's staged workbook. Each
-- is replaced below by a signature that takes the acting officer; the old shapes
-- go first so no overload survives to be resolved by accident.
DROP FUNCTION IF EXISTS plugin_data.csf_open_staging_object(
  uuid, uuid, text, text, text, bigint, integer
);
DROP FUNCTION IF EXISTS plugin_data.csf_finalize_staging_object(uuid, uuid);
DROP FUNCTION IF EXISTS plugin_data.csf_retire_staging_object(uuid, uuid, text, integer);
DROP FUNCTION IF EXISTS plugin_data.csf_release_staging_claim(uuid, uuid, text, boolean);
DROP FUNCTION IF EXISTS plugin_data.csf_retire_staging_object(uuid, uuid, text);
DROP FUNCTION IF EXISTS plugin_data.csf_fail_import_row_for_attempt(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS plugin_data.csf_abort_import_commit_attempt(uuid, uuid, text);
DROP FUNCTION IF EXISTS plugin_data.csf_flag_import_row_outcome_unknown(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS plugin_data.csf_reconcile_import_row_outcome(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS plugin_data.csf_accept_historical_import_outcome(uuid, uuid, uuid, text, text);

-- The unsafe draft wrapper: identifiers *and* caller-supplied authoritative content.
DROP FUNCTION IF EXISTS plugin_data.csf_commit_import_row_for_attempt(
  uuid, uuid, uuid, uuid,
  text, text, text, text, text, text, text, text,
  jsonb, jsonb, jsonb, boolean
);

-- The digest-keyed open/consume staging pair this lifecycle replaced.
DROP FUNCTION IF EXISTS plugin_data.csf_open_csf_import_staging_object(
  uuid, uuid, text, text, text, bigint, integer
);
DROP FUNCTION IF EXISTS plugin_data.csf_consume_csf_import_staging_object(uuid, uuid, text);
DROP FUNCTION IF EXISTS plugin_data.csf_open_import_staging_object(
  uuid, uuid, text, text, text, bigint, integer
);
DROP FUNCTION IF EXISTS plugin_data.csf_consume_import_staging_object(uuid, uuid, text);

-- The sweep is a structural catalog comparison, and it fails closed.
--
-- It used to compare `pg_get_function_identity_arguments()` against bare type strings
-- like 'uuid, uuid, text'. That text embeds the *declared parameter names*, so it
-- renders as 'p_organization_id uuid, p_staging_object_id uuid, p_reason text' for
-- every function in this file -- never equal to the expected string. Every canonical
-- named function was therefore classified as obsolete, and the loop dropped all of
-- them. On a fresh database that was invisible because there was nothing to drop; on a
-- draft-over-draft repair it dropped and recreated everything, and on any database
-- where another migration had introduced a same-named function it would have dropped
-- that too, silently.
--
-- So identity is compared on catalog structure instead: `prokind`, argument modes,
-- argument type OIDs positionally out of `proargtypes`, and the return type OID. None
-- of that depends on how a parameter was spelled. Anything present that is neither the
-- canonical contract nor an explicitly allowlisted historical draft raises, rather
-- than being dropped on the assumption that it is ours to delete.
DO $draft_overload_cleanup$
DECLARE
  v_dropped text[] := ARRAY[]::text[];
  v_unexpected text[] := ARRAY[]::text[];
  v_unreplaceable text[] := ARRAY[]::text[];
  v_row record;
BEGIN
  FOR v_row IN
    WITH canonical(proname, arg_types, rettype) AS (
      VALUES
        ('csf_has_edge_padding', ARRAY['text'], 'boolean'),
        ('csf_bounded_reason_code', ARRAY['text','text'], 'text'),
        ('csf_bounded_failure_detail', ARRAY['text'], 'text'),
        ('csf_settle_staging_retirement', ARRAY['uuid'], 'boolean'),
        ('csf_retire_staging_object', ARRAY['uuid','uuid','uuid','text','integer'], 'jsonb'),
        ('csf_retire_staging_object_internal', ARRAY['uuid','uuid','text','integer','uuid'], 'jsonb'),
        ('csf_retire_expired_staging_objects', ARRAY['integer'], 'integer'),
        ('csf_open_staging_object',
          ARRAY['uuid','uuid','uuid','text','text','text','bigint','integer'], 'jsonb'),
        ('csf_finalize_staging_object', ARRAY['uuid','uuid','uuid'], 'jsonb'),
        ('csf_claim_staging_object', ARRAY['uuid','uuid','uuid','integer'], 'jsonb'),
        ('csf_release_staging_claim', ARRAY['uuid','uuid','uuid','text','boolean'], 'jsonb'),
        ('csf_sweep_staging_objects', ARRAY['integer'], 'jsonb'),
        ('csf_enforce_import_row_attempt_lineage', ARRAY[]::text[], 'trigger'),
        ('csf_preserve_import_commit_attempt', ARRAY[]::text[], 'trigger'),
        -- Created by 20260714235236 and REPLACED by B1b.3. It is listed here so
        -- the sweep can see it: identical zero-argument trigger shape, therefore
        -- always replaceable and never dropped, but a rogue overload under this
        -- name would now be reported instead of silently surviving.
        ('csf_reject_audit_mutation', ARRAY[]::text[], 'trigger'),
        ('csf_lock_import_commit_coordinate', ARRAY['uuid','uuid','boolean'], 'void'),
        ('csf_import_preview_claim_blockers', ARRAY['uuid','uuid'], 'text[]'),
        ('csf_freeze_import_commit_decision',
          ARRAY['uuid','uuid','uuid','uuid','jsonb'], 'integer'),
        ('csf_claim_import_commit_attempt', ARRAY['uuid','uuid','uuid','integer','uuid'], 'jsonb'),
        ('csf_heartbeat_import_commit_attempt', ARRAY['uuid','uuid','integer'], 'jsonb'),
        ('csf_assert_active_import_commit_attempt', ARRAY['uuid','uuid'],
          'plugin_data.csf_sheet_import_commit_attempts'),
        ('csf_assert_import_row_for_attempt', ARRAY['uuid','uuid','uuid'],
          'plugin_data.csf_sheet_import_rows'),
        ('csf_begin_import_row_for_attempt', ARRAY['uuid','uuid','uuid'], 'jsonb'),
        ('csf_import_row_recovery_state', ARRAY['uuid','uuid'], 'jsonb'),
        ('csf_commit_import_row_for_attempt', ARRAY['uuid','uuid','uuid'], 'jsonb'),
        ('csf_fail_import_row_for_attempt',
          ARRAY['uuid','uuid','uuid','text','text','boolean'], 'jsonb'),
        ('csf_flag_import_row_outcome_unknown',
          ARRAY['uuid','uuid','uuid','text','text'], 'jsonb'),
        ('csf_reconcile_import_row_outcome',
          ARRAY['uuid','uuid','uuid','text','uuid','text','text'], 'jsonb'),
        ('csf_accept_historical_import_outcome', ARRAY['uuid','uuid','uuid','text'], 'jsonb'),
        ('csf_recover_stale_import_intents', ARRAY['uuid','uuid','uuid','text'], 'jsonb'),
        ('csf_settle_failed_import_row', ARRAY['uuid','uuid','uuid','text','text'], 'jsonb'),
        ('csf_finalize_import_commit_attempt', ARRAY['uuid','uuid','jsonb'], 'jsonb'),
        ('csf_assert_preview_payload_bounds',
          ARRAY['jsonb'], 'void'),
        ('csf_open_import_preview',
          ARRAY['uuid','uuid','uuid','text','text','text','text','text','timestamptz','jsonb','jsonb','integer','uuid','text','text','integer','text'], 'jsonb'),
        ('csf_append_import_preview_rows',
          ARRAY['uuid','uuid','uuid','jsonb'], 'jsonb'),
        ('csf_seal_import_preview',
          ARRAY['uuid','uuid','uuid','text','jsonb'], 'jsonb'),
        ('csf_fail_import_preview',
          ARRAY['uuid','uuid','uuid','text','text'], 'jsonb'),
        ('csf_abort_import_commit_attempt', ARRAY['uuid','uuid','text','text'], 'jsonb'),
        -- Wave 3.
        ('csf_chapter_today', ARRAY[]::text[], 'date'),
        ('csf_import_source_permission', ARRAY['text'], 'text'),
        ('csf_import_compatibility_permissions', ARRAY['text'], 'text[]'),
        ('csf_assert_import_actor', ARRAY['uuid','uuid','text'], 'jsonb'),
        ('csf_assert_import_cleanup_actor', ARRAY['uuid','uuid','uuid'], 'jsonb'),
        ('csf_assert_import_actor_for_source', ARRAY['uuid','uuid','uuid'], 'jsonb'),
        ('csf_assert_import_actor_for_job', ARRAY['uuid','uuid','uuid'], 'jsonb'),
        ('csf_assert_import_actor_for_row', ARRAY['uuid','uuid','uuid'], 'jsonb'),
        ('csf_sheet_source_settings_schema', ARRAY[]::text[], 'jsonb'),
        ('csf_sheet_source_attachment_keys', ARRAY[]::text[], 'text[]'),
        ('csf_assert_sheet_source_settings', ARRAY['jsonb'], 'jsonb'),
        ('csf_register_sheet_source', ARRAY['uuid','uuid','uuid','text','jsonb'], 'jsonb'),
        ('csf_record_sheet_source_sync', ARRAY['uuid','uuid','uuid','text','text','text','boolean'], 'jsonb'),
        ('csf_refresh_sheet_source_drive_metadata', ARRAY['uuid','uuid','uuid','jsonb'], 'jsonb'),
        ('csf_attach_sheet_source_generation', ARRAY['uuid','uuid','uuid','uuid','integer','text','integer','integer'], 'jsonb'),
        -- The read-only half of the attachment contract. Same eight coordinates,
        -- deliberately: a reconciliation that took a different shape could not be
        -- asking about the same request.
        ('csf_reconcile_sheet_source_generation', ARRAY['uuid','uuid','uuid','uuid','integer','text','integer','integer'], 'jsonb'),
        ('csf_js_number_text', ARRAY['float8'], 'text'),
        ('csf_canonical_number_text', ARRAY['numeric'], 'text'),
        ('csf_canonical_json', ARRAY['jsonb'], 'text'),
        ('csf_canonical_digest', ARRAY['jsonb'], 'text'),
        ('csf_payload_string', ARRAY['jsonb'], 'text'),
        ('csf_payload_number', ARRAY['jsonb'], 'jsonb'),
        ('csf_normalize_identity_part', ARRAY['text'], 'text'),
        ('csf_normalize_email_text', ARRAY['text'], 'text'),
        ('csf_meeting_key_from_label', ARRAY['text','integer'], 'text'),
        ('csf_meeting_attendance_value', ARRAY['text'], 'text'),
        ('csf_normalized_record_schema', ARRAY['text'], 'jsonb'),
        ('csf_assert_canonical_record', ARRAY['text','jsonb'], 'jsonb'),
        ('csf_derive_row_commit_payload', ARRAY['text','jsonb'], 'jsonb'),
        ('csf_record_import_cleanup_recovery', ARRAY['uuid','uuid','text','text','integer'], 'jsonb'),
        ('csf_sweep_import_cleanup_recovery', ARRAY['integer'], 'jsonb'),
        ('csf_refresh_sheet_source_evidence', ARRAY['uuid','uuid','uuid','uuid','bigint','text','text','timestamptz','text','boolean','text','text'], 'jsonb'),
        ('csf_issue_uploaded_source_evidence', ARRAY['uuid','uuid','uuid','uuid'], 'jsonb'),
        ('csf_consume_sheet_source_evidence', ARRAY['uuid','uuid','uuid','uuid','uuid'], 'jsonb'),
        ('csf_purge_import_recovery', ARRAY['uuid'], 'jsonb'),
        ('csf_purge_recovery_foundations', ARRAY['uuid'], 'jsonb')
    ),
    -- Replaceability is a *different* contract from identity, and both have to hold.
    --
    -- Function identity ignores input parameter names, so a draft with the same types and
    -- return type is the same function as far as `pg_proc` is concerned -- but
    -- `CREATE OR REPLACE FUNCTION` refuses to rename an already-named input parameter
    -- ("cannot change name of input parameter"), and refuses to change a scalar return
    -- into `SETOF` or back. A draft matching on types alone was therefore classified
    -- canonical, left in place, and then failed the replacement mid-migration.
    --
    -- So the canonical contract carries the exact input names and requires
    -- `proretset = false`; anything that is identity-canonical but not replaceable is
    -- treated as a draft that must go, not as a function to keep.
    canonical_names(proname, arg_names) AS (
      VALUES
        -- Present in the structural signature inventory and in the ACL block, but
        -- absent here, so the draft-over-draft sweep classified an already-present
        -- exact helper as unreplaceable and raised 42723 on a second application.
        ('csf_has_edge_padding', ARRAY['p_value']),
        ('csf_bounded_reason_code', ARRAY['p_value','p_fallback']),
        ('csf_bounded_failure_detail', ARRAY['p_value']),
        ('csf_settle_staging_retirement', ARRAY['p_staging_object_id']),
        ('csf_retire_staging_object',
          ARRAY['p_organization_id','p_actor_user_id','p_staging_object_id','p_reason','p_expected_generation']),
        ('csf_retire_staging_object_internal',
          ARRAY['p_organization_id','p_staging_object_id','p_reason','p_expected_generation','p_actor_user_id']),
        ('csf_retire_expired_staging_objects', ARRAY['p_limit']),
        ('csf_open_staging_object', ARRAY[
          'p_organization_id','p_actor_user_id','p_source_id','p_bucket','p_file_extension',
          'p_content_hash','p_byte_length','p_upload_ttl_seconds'
        ]),
        ('csf_finalize_staging_object', ARRAY['p_organization_id','p_actor_user_id','p_staging_object_id']),
        ('csf_claim_staging_object',
          ARRAY['p_organization_id','p_source_id','p_claimed_by','p_lease_seconds']),
        ('csf_release_staging_claim',
          ARRAY['p_organization_id','p_actor_user_id','p_claim_token','p_reason','p_retire']),
        ('csf_sweep_staging_objects', ARRAY['p_limit']),
        ('csf_enforce_import_row_attempt_lineage', ARRAY[]::text[]),
        ('csf_preserve_import_commit_attempt', ARRAY[]::text[]),
        ('csf_reject_audit_mutation', ARRAY[]::text[]),
        ('csf_lock_import_commit_coordinate',
          ARRAY['p_organization_id','p_preview_job_id','p_lock_rows']),
        ('csf_import_preview_claim_blockers', ARRAY['p_organization_id','p_preview_job_id']),
        ('csf_freeze_import_commit_decision', ARRAY[
          'p_organization_id','p_preview_job_id','p_commit_job_id',
          'p_actor_user_id','p_actor_snapshot'
        ]),
        ('csf_claim_import_commit_attempt', ARRAY[
          'p_organization_id','p_preview_job_id','p_actor_user_id','p_lease_seconds',
          'p_evidence_token'
        ]),
        ('csf_heartbeat_import_commit_attempt',
          ARRAY['p_organization_id','p_attempt_id','p_lease_seconds']),
        ('csf_assert_active_import_commit_attempt',
          ARRAY['p_organization_id','p_attempt_id']),
        ('csf_assert_import_row_for_attempt',
          ARRAY['p_organization_id','p_attempt_id','p_import_row_id']),
        ('csf_begin_import_row_for_attempt',
          ARRAY['p_organization_id','p_attempt_id','p_import_row_id']),
        ('csf_import_row_recovery_state', ARRAY['p_organization_id','p_import_row_id']),
        ('csf_commit_import_row_for_attempt',
          ARRAY['p_organization_id','p_attempt_id','p_import_row_id']),
        ('csf_fail_import_row_for_attempt', ARRAY[
          'p_organization_id','p_attempt_id','p_import_row_id',
          'p_reason_code','p_detail','p_deterministic'
        ]),
        ('csf_flag_import_row_outcome_unknown', ARRAY[
          'p_organization_id','p_attempt_id','p_import_row_id','p_reason_code','p_detail'
        ]),
        ('csf_reconcile_import_row_outcome', ARRAY[
          'p_organization_id','p_import_row_id','p_actor_user_id','p_decision',
          'p_correlation_id','p_reason_code','p_detail'
        ]),
        ('csf_accept_historical_import_outcome', ARRAY[
          'p_organization_id','p_import_row_id','p_actor_user_id','p_reason_code'
        ]),
        ('csf_recover_stale_import_intents', ARRAY[
          'p_organization_id','p_preview_job_id','p_actor_user_id','p_reason_code'
        ]),
        ('csf_settle_failed_import_row', ARRAY[
          'p_organization_id','p_import_row_id','p_actor_user_id','p_decision','p_reason_code'
        ]),
        ('csf_finalize_import_commit_attempt',
          ARRAY['p_organization_id','p_attempt_id','p_summary']),
        ('csf_assert_preview_payload_bounds',
          ARRAY['p_rows']),
        ('csf_open_import_preview',
          ARRAY['p_organization_id','p_actor_user_id','p_source_id','p_source_type','p_source_file_id','p_source_file_name','p_source_sheet_tab','p_source_range','p_source_modified_at','p_source_file_metadata','p_mapping_snapshot','p_mapping_version','p_retry_of_job_id','p_source_content_hash','p_snapshot_hash','p_snapshot_row_count','p_snapshot_contract_version']),
        ('csf_append_import_preview_rows',
          ARRAY['p_organization_id','p_actor_user_id','p_preview_job_id','p_rows']),
        ('csf_seal_import_preview',
          ARRAY['p_organization_id','p_actor_user_id','p_preview_job_id','p_status','p_summary']),
        ('csf_fail_import_preview',
          ARRAY['p_organization_id','p_actor_user_id','p_preview_job_id','p_reason_code','p_detail']),
        ('csf_abort_import_commit_attempt',
          ARRAY['p_organization_id','p_attempt_id','p_reason_code','p_detail']),
        -- Wave 3.
        ('csf_chapter_today', ARRAY[]::text[]),
        ('csf_import_source_permission', ARRAY['p_source_type']),
        ('csf_import_compatibility_permissions', ARRAY['p_source_type']),
        ('csf_assert_import_actor', ARRAY['p_organization_id','p_actor_user_id','p_source_type']),
        ('csf_assert_import_cleanup_actor', ARRAY['p_organization_id','p_actor_user_id','p_preview_job_id']),
        ('csf_assert_import_actor_for_source', ARRAY['p_organization_id','p_actor_user_id','p_source_id']),
        ('csf_assert_import_actor_for_job', ARRAY['p_organization_id','p_actor_user_id','p_job_id']),
        ('csf_assert_import_actor_for_row', ARRAY['p_organization_id','p_actor_user_id','p_import_row_id']),
        ('csf_sheet_source_settings_schema', ARRAY[]::text[]),
        ('csf_sheet_source_attachment_keys', ARRAY[]::text[]),
        ('csf_assert_sheet_source_settings', ARRAY['p_settings']),
        ('csf_register_sheet_source', ARRAY['p_organization_id','p_actor_user_id','p_source_id','p_source_type','p_registration']),
        ('csf_record_sheet_source_sync', ARRAY['p_organization_id','p_actor_user_id','p_source_id','p_sync_status','p_last_sync_status','p_last_sync_error','p_mark_previewed']),
        ('csf_refresh_sheet_source_drive_metadata', ARRAY['p_organization_id','p_actor_user_id','p_source_id','p_metadata']),
        ('csf_attach_sheet_source_generation', ARRAY['p_organization_id','p_actor_user_id','p_source_id','p_staging_object_id','p_expected_generation','p_expected_content_hash','p_expected_prior_generation','p_mapping_version']),
        ('csf_reconcile_sheet_source_generation', ARRAY['p_organization_id','p_actor_user_id','p_source_id','p_staging_object_id','p_expected_generation','p_expected_content_hash','p_expected_prior_generation','p_mapping_version']),
        ('csf_js_number_text', ARRAY['p_value']),
        ('csf_canonical_number_text', ARRAY['p_value']),
        ('csf_canonical_json', ARRAY['p_value']),
        ('csf_canonical_digest', ARRAY['p_value']),
        ('csf_payload_string', ARRAY['p_value']),
        ('csf_payload_number', ARRAY['p_value']),
        ('csf_normalize_identity_part', ARRAY['p_value']),
        ('csf_normalize_email_text', ARRAY['p_value']),
        ('csf_meeting_key_from_label', ARRAY['p_label','p_fallback_index']),
        ('csf_meeting_attendance_value', ARRAY['p_value']),
        ('csf_normalized_record_schema', ARRAY['p_source_type']),
        ('csf_assert_canonical_record', ARRAY['p_source_type','p_record']),
        ('csf_derive_row_commit_payload', ARRAY['p_source_type','p_record']),
        ('csf_record_import_cleanup_recovery', ARRAY['p_organization_id','p_preview_job_id','p_reason_code','p_detail','p_lease_seconds']),
        ('csf_sweep_import_cleanup_recovery', ARRAY['p_limit']),
        ('csf_refresh_sheet_source_evidence', ARRAY['p_organization_id','p_actor_user_id','p_source_id','p_preview_job_id','p_expected_generation','p_provider_file_id','p_mime_type','p_modified_time','p_provider_version','p_trashed','p_access_state','p_file_name']),
        ('csf_issue_uploaded_source_evidence', ARRAY['p_organization_id','p_actor_user_id','p_source_id','p_preview_job_id']),
        ('csf_consume_sheet_source_evidence', ARRAY['p_organization_id','p_source_id','p_actor_user_id','p_evidence_token','p_preview_job_id']),
        ('csf_purge_import_recovery', ARRAY['p_organization_id']),
        ('csf_purge_recovery_foundations', ARRAY['p_organization_id'])
    ),
    -- Only these historical shapes may be dropped. The list is closed on purpose: a
    -- signature nobody wrote down is not automatically ours.
    --
    -- The two `*_csf_import_staging_object` names are historical-*only*: no canonical
    -- function bears them, so they never appeared in the canonical-name sweep and any
    -- draft under those names survived it. They are swept here by name.
    known_draft(proname, arg_types) AS (
      VALUES
        ('csf_open_csf_import_staging_object',
          ARRAY['uuid','uuid','text','text','text','bigint','integer']),
        ('csf_consume_csf_import_staging_object', ARRAY['uuid','uuid','text']),
        ('csf_open_import_staging_object',
          ARRAY['uuid','uuid','text','text','text','bigint','integer']),
        ('csf_consume_import_staging_object', ARRAY['uuid','uuid','text']),
        ('csf_claim_import_commit_attempt', ARRAY['uuid','uuid','uuid','integer']),
        -- The provider-unaware evidence refresh, superseded by the preview-bound
        -- one. It issued a receipt that named no preview job, so a database that
        -- ran the draft would otherwise keep an overload able to mint exactly the
        -- unbound receipts this wave exists to remove.
        ('csf_refresh_sheet_source_evidence',
          ARRAY['uuid','uuid','uuid','bigint','text','text','timestamptz','text','boolean','text','text']),
        -- The preview-bound refresh as an EARLIER DRAFT of this same migration
        -- created it: identical argument types, but its ninth parameter was named
        -- `p_revision` and held `headRevisionId ?? modifiedTime`. Argument names
        -- are not part of function identity, so that draft is the same function
        -- to `pg_proc` -- but `CREATE OR REPLACE FUNCTION` refuses to rename an
        -- input parameter, so replacing it in place fails mid-migration.
        --
        -- Listing it here is what makes the rename converge instead of halting:
        -- a database on the draft names is not replaceable, matches this shape,
        -- and is dropped before the canonical definition is created. A database
        -- already on the canonical names IS replaceable, never enters the sweep,
        -- and is untouched.
        ('csf_refresh_sheet_source_evidence',
          ARRAY['uuid','uuid','uuid','uuid','bigint','text','text','timestamptz','text','boolean','text','text']),
        ('csf_open_staging_object', ARRAY['uuid','uuid','text','text','text','bigint','integer']),
        ('csf_finalize_staging_object', ARRAY['uuid','uuid']),
        ('csf_release_staging_claim', ARRAY['uuid','uuid','text','boolean']),
        ('csf_retire_staging_object', ARRAY['uuid','uuid','text','integer']),
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
        ])
    ),
    present AS (
      SELECT
        proc.oid,
        proc.proname,
        proc.oid::regprocedure::text AS signature,
        proc.prokind,
        proc.proargmodes IS NULL AS only_in_args,
        proc.pronargs,
        proc.proargtypes,
        proc.prorettype,
        proc.proretset,
        coalesce(proc.proargnames, ARRAY[]::text[]) AS proargnames
      FROM pg_catalog.pg_proc AS proc
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
      WHERE namespace.nspname = 'plugin_data'
        -- Canonical names *and* the historical-only names, so a draft under a name this
        -- migration no longer uses cannot slip past the sweep entirely.
        AND (
          proc.proname IN (SELECT canonical.proname FROM canonical)
          OR proc.proname IN (SELECT known_draft.proname FROM known_draft)
        )
    ),
    classified AS (
      SELECT
        present.signature,
        present.oid,
        -- Structural equality against the canonical contract: plain function, all IN
        -- arguments, exact positional argument type OIDs, exact return type OID.
        -- Identity: the kind, modes and positional type OIDs used to locate a function.
        EXISTS (
          SELECT 1 FROM canonical
          WHERE canonical.proname = present.proname
            AND present.prokind = 'f'
            AND present.only_in_args
            AND present.pronargs = cardinality(canonical.arg_types)
            AND NOT EXISTS (
              SELECT 1
              FROM unnest(canonical.arg_types) WITH ORDINALITY AS expected(type_name, position)
              WHERE present.proargtypes[expected.position - 1]
                IS DISTINCT FROM expected.type_name::regtype::oid
            )
        ) AS is_canonical_identity,
        -- Replaceability: everything above, plus every property `CREATE OR REPLACE`
        -- refuses to change in place -- the exact input parameter names, a scalar rather
        -- than set-returning result, and the exact return type.
        EXISTS (
          SELECT 1 FROM canonical
          JOIN canonical_names ON canonical_names.proname = canonical.proname
          WHERE canonical.proname = present.proname
            AND present.prokind = 'f'
            AND present.only_in_args
            AND NOT present.proretset
            AND present.pronargs = cardinality(canonical.arg_types)
            AND present.prorettype = canonical.rettype::regtype::oid
            AND present.proargnames = canonical_names.arg_names
            AND NOT EXISTS (
              SELECT 1
              FROM unnest(canonical.arg_types) WITH ORDINALITY AS expected(type_name, position)
              WHERE present.proargtypes[expected.position - 1]
                IS DISTINCT FROM expected.type_name::regtype::oid
            )
        ) AS is_replaceable,
        EXISTS (
          SELECT 1 FROM known_draft
          WHERE known_draft.proname = present.proname
            AND present.prokind = 'f'
            AND present.only_in_args
            AND present.pronargs = cardinality(known_draft.arg_types)
            AND NOT EXISTS (
              SELECT 1
              FROM unnest(known_draft.arg_types) WITH ORDINALITY AS expected(type_name, position)
              WHERE present.proargtypes[expected.position - 1]
                IS DISTINCT FROM expected.type_name::regtype::oid
            )
        ) AS is_known_draft
      FROM present
    )
    SELECT
      classified.signature,
      classified.is_canonical_identity,
      classified.is_replaceable,
      classified.is_known_draft
    FROM classified
    -- Only a definition that is both canonical *and* replaceable may survive to the
    -- `CREATE OR REPLACE` statements below.
    WHERE NOT classified.is_replaceable
  LOOP
    IF v_row.is_known_draft THEN
      EXECUTE format('DROP FUNCTION IF EXISTS %s', v_row.signature);
      v_dropped := v_dropped || v_row.signature;
    ELSIF v_row.is_canonical_identity THEN
      -- Same types, same kind, but something `CREATE OR REPLACE` cannot change in place:
      -- an old input parameter name, or a set-returning result. The replacement below
      -- would fail mid-migration -- but this is *not* an allowlisted shape, so it is
      -- reported for a decision rather than dropped on the assumption that it is ours.
      v_unreplaceable := v_unreplaceable || v_row.signature;
    ELSE
      v_unexpected := v_unexpected || v_row.signature;
    END IF;
  END LOOP;

  IF array_length(v_unreplaceable, 1) > 0 THEN
    RAISE EXCEPTION
      'CSF import recovery halted: % existing function(s) match a canonical argument contract but cannot be replaced in place: %. CREATE OR REPLACE FUNCTION cannot rename an input parameter or change a scalar result into SETOF, so applying this migration would fail partway through. Drop them explicitly after confirming they are obsolete drafts.',
      array_length(v_unreplaceable, 1), array_to_string(v_unreplaceable, ', ')
      USING ERRCODE = '42723';
  END IF;

  IF array_length(v_unexpected, 1) > 0 THEN
    RAISE EXCEPTION
      'CSF import recovery halted: plugin_data holds % function(s) sharing a name this migration owns but matching neither its canonical contract nor a known draft: %. Review them before applying this migration; it will not drop a function it cannot identify.',
      array_length(v_unexpected, 1), array_to_string(v_unexpected, ', ')
      USING ERRCODE = '42723';
  END IF;

  IF array_length(v_dropped, 1) > 0 THEN
    RAISE NOTICE
      'CSF import recovery: dropped % obsolete draft overload(s) before creating the canonical functions: %',
      array_length(v_dropped, 1), array_to_string(v_dropped, ', ');
  END IF;
END
$draft_overload_cleanup$;

-- ---------------------------------------------------------------------------
-- Preflight. Actionable, and with predicates that match the indexes built below.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_blank integer;
  v_overlong integer;
  v_dup_path integer;
  v_blank_digest integer;
  v_dup_digest integer;
BEGIN
  SELECT count(*) INTO v_blank
  FROM plugin_data.csf_sheet_sources
  WHERE uploaded_file_path IS NOT NULL
    AND length(btrim(uploaded_file_path)) = 0;
  IF v_blank > 0 THEN
    RAISE EXCEPTION
      'CSF import preflight failed: % source(s) record a blank uploaded_file_path. Set them to NULL (SELECT id FROM plugin_data.csf_sheet_sources WHERE uploaded_file_path IS NOT NULL AND length(btrim(uploaded_file_path)) = 0) before applying this migration.',
      v_blank;
  END IF;

  SELECT count(*) INTO v_overlong
  FROM plugin_data.csf_sheet_sources
  WHERE uploaded_file_path IS NOT NULL
    AND octet_length(uploaded_file_path) > 1000;
  IF v_overlong > 0 THEN
    RAISE EXCEPTION
      'CSF import preflight failed: % source(s) record an uploaded_file_path longer than 1000 bytes, which cannot be uniquely indexed. Shorten or clear them before applying this migration.',
      v_overlong;
  END IF;

  SELECT count(*) INTO v_dup_path
  FROM (
    SELECT organization_id, source_type, uploaded_file_path
    FROM plugin_data.csf_sheet_sources
    WHERE uploaded_file_path IS NOT NULL
    GROUP BY organization_id, source_type, uploaded_file_path
    HAVING count(*) > 1
  ) AS duplicated;
  IF v_dup_path > 0 THEN
    RAISE EXCEPTION
      'CSF import preflight failed: % uploaded staging path(s) are registered more than once for the same organization and source type. Deduplicate before applying this migration.',
      v_dup_path;
  END IF;

  -- The digest corpus is RAW and canonical, not normalized.
  --
  -- The predicate this replaces was `nullif(btrim(...), '') IS NOT NULL`, and the
  -- index keyed on the btrimmed value. That made the arbiter a NORMALIZING one:
  -- ' abc ' and 'abc' collided, an uppercase digest was a distinct key from its
  -- lowercase twin, and a create-or-adopt decision over such a key is not an
  -- identity boundary -- it adopts rows that were never the same workbook and
  -- fails to adopt rows that were. Both the CHECK and the partial unique index
  -- below now describe exactly one corpus: an uploaded row either does not own
  -- `contentHash` at all, or owns a primitive JSON string matching raw
  -- `^[0-9a-f]{64}$`. The preflight proves that corpus before either is created.
  SELECT count(*) INTO v_blank_digest
  FROM plugin_data.csf_sheet_sources
  WHERE provider IN ('uploaded_xlsx', 'uploaded_csv')
    AND settings ? 'contentHash'
    AND (
      jsonb_typeof(settings -> 'contentHash') <> 'string'
      OR settings ->> 'contentHash' !~ '^[0-9a-f]{64}$'
    );
  IF v_blank_digest > 0 THEN
    RAISE EXCEPTION
      'CSF import preflight failed: % uploaded source(s) record a contentHash that is not a canonical lowercase sha256 string. Remove the key or replace it with the exact digest before applying this migration; this migration will not normalize or repair one.',
      v_blank_digest;
  END IF;

  SELECT count(*) INTO v_dup_digest
  FROM (
    SELECT organization_id, source_type, settings ->> 'contentHash' AS digest
    FROM plugin_data.csf_sheet_sources
    WHERE provider IN ('uploaded_xlsx', 'uploaded_csv')
      AND settings ? 'contentHash'
    GROUP BY organization_id, source_type, settings ->> 'contentHash'
    HAVING count(*) > 1
  ) AS duplicated;
  IF v_dup_digest > 0 THEN
    RAISE EXCEPTION
      'CSF import preflight failed: % uploaded workbook digest(s) are registered as more than one source for the same organization and source type. Merge or remove the duplicates before applying this migration.',
      v_dup_digest;
  END IF;
END $$;

CREATE UNIQUE INDEX csf_sheet_sources_uploaded_object_idx
  ON plugin_data.csf_sheet_sources (organization_id, source_type, uploaded_file_path)
  WHERE uploaded_file_path IS NOT NULL;

-- The uploaded-workbook logical identity, and the ONLY arbiter
-- `csf_register_sheet_source` may infer.
--
-- Expression and predicate are stated here in the exact form the `ON CONFLICT`
-- clause repeats, character for character. Inference is by matching the index
-- definition, so an arbiter that merely means the same thing is not the same
-- arbiter -- and a targetless `DO NOTHING` would silently swallow an unrelated
-- unique violation, which is precisely the failure this index exists to decide.
--
-- Predicate matches the preflight above and the CHECK below exactly. There is
-- deliberately no second competing digest index.
CREATE UNIQUE INDEX csf_sheet_sources_uploaded_digest_idx
  ON plugin_data.csf_sheet_sources (
    organization_id,
    source_type,
    (settings ->> 'contentHash')
  )
  WHERE provider IN ('uploaded_xlsx', 'uploaded_csv')
    AND settings ? 'contentHash';

-- Future writes cannot reintroduce the blank/overlong paths the preflight just
-- proved absent.
ALTER TABLE plugin_data.csf_sheet_sources
  ADD CONSTRAINT csf_sheet_sources_uploaded_path_shape_check CHECK (
    uploaded_file_path IS NULL
    OR (length(btrim(uploaded_file_path)) > 0 AND octet_length(uploaded_file_path) <= 1000)
  );

-- And the digest corpus the arbiter keys on is exact for every future write.
--
-- An uploaded source may legitimately own no digest -- the contextual attendance
-- and partner-club importers register sources that do not use digest identity --
-- but a row that OWNS the key must carry a primitive JSON string matching raw
-- `^[0-9a-f]{64}$`. Without this, the partial unique index would happily key on
-- ' ABC ' or a JSON number, and the create-or-adopt arbiter would be deciding
-- identity over a value nobody canonicalized.
ALTER TABLE plugin_data.csf_sheet_sources
  ADD CONSTRAINT csf_sheet_sources_uploaded_digest_shape_check CHECK (
    provider NOT IN ('uploaded_xlsx', 'uploaded_csv')
    OR NOT (settings ? 'contentHash')
    OR (
      jsonb_typeof(settings -> 'contentHash') = 'string'
      AND settings ->> 'contentHash' ~ '^[0-9a-f]{64}$'
    )
  );

-- ---------------------------------------------------------------------------
-- Uploaded staging: a typed generation lifecycle with claims.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_sheet_import_staging_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_id uuid NOT NULL,
  -- Monotonic per source. This, not the content digest, is staging identity.
  generation integer NOT NULL CHECK (generation >= 1),
  status text NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'ready', 'retire_pending', 'tombstoned')),
  bucket text NOT NULL,
  -- Derived server-side from organization, source, generation and a safe
  -- extension. Never assembled by application code from a digest.
  --
  -- Nullable for exactly one state. A tombstone has no staging storage path:
  -- settlement hands the exact bucket/path to the deletion outbox and then
  -- clears it here, so the row that survives is typed immutable evidence about
  -- bytes that are already scheduled for removal rather than a pointer to bytes
  -- an officer could still be handed. The state-aware constraint below is what
  -- keeps that from becoming "any row may lose its path".
  object_path text,
  file_extension text NOT NULL CHECK (file_extension IN ('xlsx', 'csv')),
  -- Provenance and dedup evidence only.
  content_hash text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  upload_expires_at timestamptz NOT NULL,
  ready_at timestamptz,
  -- How long the exact original bytes may remain readable without being claimed
  -- again. Retirement after a preview used to depend entirely on a JavaScript
  -- `finally`, so a process death after finalize or claim preserved a complete
  -- student workbook -- including the columns normalization deliberately discards --
  -- for as long as the row existed. This deadline is what a sweeper can honor
  -- without any cooperation from the process that uploaded it.
  ready_expires_at timestamptz,
  retire_requested_at timestamptz,
  -- When settlement tombstoned this generation and committed its path to the
  -- deletion outbox. Named for the state it records, not for the queue it wrote.
  tombstoned_at timestamptz,
  retire_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_staging_objects_source_organization_fkey
    FOREIGN KEY (source_id, organization_id)
    REFERENCES plugin_data.csf_sheet_sources (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_staging_objects_generation_key UNIQUE (source_id, generation),
  CONSTRAINT csf_staging_objects_object_key UNIQUE (bucket, object_path),
  CONSTRAINT csf_staging_objects_id_organization_key UNIQUE (id, organization_id),
  CONSTRAINT csf_staging_objects_bucket_not_blank CHECK (length(btrim(bucket)) > 0),
  CONSTRAINT csf_staging_objects_path_not_blank CHECK (length(btrim(object_path)) > 0),
  CONSTRAINT csf_staging_objects_path_bounded CHECK (octet_length(object_path) <= 1000),
  -- A path exists for exactly the states that can still be read, and for none of
  -- the states that cannot. Without this, "tombstoned" would be a status a row
  -- could carry while still advertising the bytes it claims to have retired --
  -- and the two blank/bounded checks above are NULL-tolerant by design, so they
  -- cannot express it.
  CONSTRAINT csf_staging_objects_tombstone_path_check CHECK (
    (status <> 'tombstoned' AND object_path IS NOT NULL)
    OR (status = 'tombstoned' AND object_path IS NULL)
  ),
  CONSTRAINT csf_staging_objects_content_hash_check
    CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  -- Lifecycle timestamps agree with the status they describe. `ready` is the only
  -- state a claim may attach to, so an abandoned upload cannot masquerade as one.
  CONSTRAINT csf_staging_objects_lifecycle_check CHECK (
    (status = 'uploading' AND ready_at IS NULL AND ready_expires_at IS NULL
      AND retire_requested_at IS NULL AND tombstoned_at IS NULL)
    -- A readable generation always carries a deadline, so "nobody ever came back
    -- for it" is a state the sweeper can act on rather than a state nothing owns.
    OR (status = 'ready' AND ready_at IS NOT NULL AND ready_expires_at IS NOT NULL
      AND retire_requested_at IS NULL AND tombstoned_at IS NULL)
    OR (status = 'retire_pending' AND retire_requested_at IS NOT NULL AND tombstoned_at IS NULL)
    OR (status = 'tombstoned' AND retire_requested_at IS NOT NULL AND tombstoned_at IS NOT NULL)
  )
);

-- At most one *in-flight upload* per source, so an officer cannot accumulate
-- undeleted half-written originals by repeatedly opening staging.
--
-- Deliberately narrower than "pre-terminal". A single index over
-- ('uploading', 'ready') forbade the state this lifecycle actually needs: a new
-- upload being written while the previous generation is still readable. With that
-- index, opening a replacement had to retire the readable generation first, which
-- left the source with nothing claimable for the whole upload window and cut off
-- any preview that had not yet claimed.
CREATE UNIQUE INDEX csf_staging_objects_one_upload_per_source_idx
  ON plugin_data.csf_sheet_import_staging_objects (source_id)
  WHERE status = 'uploading';

-- Ready generations are intentionally not unique per source: finalize promotes a
-- new one while the previous one is still readable and still attached, so the
-- source is never momentarily unreadable, and a claim on the older generation
-- keeps working until it releases. Retirement of the predecessor belongs to the
-- attachment compare-and-swap, not to finalize.
--
-- Claiming resolves the source's ATTACHED generation, never "the newest ready
-- row": the attachment names one row and that row is fetched by id.
--
-- This partial index is NOT a correctness dependency of any current claim or
-- sweep path, and no current path performs the ordered generation scan its
-- shape suggests. It is retained only pending representative-scale plan
-- evidence from the isolated replay; if that evidence does not appear, it
-- should be dropped rather than justified after the fact.
CREATE INDEX csf_staging_objects_ready_generation_idx
  ON plugin_data.csf_sheet_import_staging_objects (source_id, generation DESC)
  WHERE status = 'ready';

CREATE INDEX csf_staging_objects_upload_sweep_idx
  ON plugin_data.csf_sheet_import_staging_objects (upload_expires_at)
  WHERE status = 'uploading';

CREATE INDEX csf_staging_objects_retire_sweep_idx
  ON plugin_data.csf_sheet_import_staging_objects (retire_requested_at)
  WHERE status = 'retire_pending';

-- The crash-durable sweep: readable generations nobody came back for.
CREATE INDEX csf_staging_objects_ready_sweep_idx
  ON plugin_data.csf_sheet_import_staging_objects (ready_expires_at)
  WHERE status = 'ready';

COMMENT ON TABLE plugin_data.csf_sheet_import_staging_objects IS
  'Short-lived exact uploaded workbook bytes as a typed lifecycle keyed by (source, generation). Server-only, with no browser policy and no direct table write: every mutation goes through the owned lifecycle, attachment and purge functions defined in this migration, so no caller can invent a state transition. Naming those functions here would be a list that silently goes stale; the durable rule is that the mutation surface is exactly the owned functions in this file. A tombstone keeps its typed immutable evidence and no storage path.';

COMMENT ON COLUMN plugin_data.csf_sheet_import_staging_objects.content_hash IS
  'Provenance and dedup evidence for the uploaded bytes. Deliberately not part of the object key: keying on it made one object shared across source types and re-uploads.';

CREATE TABLE plugin_data.csf_sheet_import_staging_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  staging_object_id uuid NOT NULL,
  -- Opaque to the caller and required to release. Releasing is therefore
  -- idempotent for the exact claim and impossible for anybody else.
  claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text,
  -- The retirement decision the *first* release made, kept so a replayed or
  -- contradictory release cannot change it. Null until the claim is released.
  retire_intent boolean,
  CONSTRAINT csf_staging_claims_object_organization_fkey
    FOREIGN KEY (staging_object_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_staging_objects (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT csf_staging_claims_token_key UNIQUE (claim_token),
  CONSTRAINT csf_staging_claims_release_check
    CHECK (released_at IS NULL OR release_reason IS NOT NULL),
  CONSTRAINT csf_staging_claims_retire_intent_check
    CHECK (released_at IS NOT NULL OR retire_intent IS NULL)
);

-- Object-scoped: "does this generation still have a live reader?", which is the
-- question retirement settlement asks.
CREATE INDEX csf_staging_claims_live_idx
  ON plugin_data.csf_sheet_import_staging_claims (staging_object_id, lease_expires_at)
  WHERE released_at IS NULL;

-- Global, and ordered the way the sweeper actually scans: every unreleased claim
-- across all objects, oldest lease first. The object-scoped index above cannot
-- serve that scan because its leading column is the object, so without this the
-- sweeper degrades to a full scan of the claim table as claims accumulate.
CREATE INDEX csf_staging_claims_expired_sweep_idx
  ON plugin_data.csf_sheet_import_staging_claims (lease_expires_at, id)
  WHERE released_at IS NULL;

COMMENT ON TABLE plugin_data.csf_sheet_import_staging_claims IS
  'Live readers of a staging generation. A generation is never queued for deletion while a claim remains unreleased and unexpired.';

-- Receipt columns. A release or a retirement is an act by a specific officer,
-- and until now the ledger recorded only that it happened. Recording the ORIGINAL
-- claimant instead would be worse than recording nobody: it would attribute a
-- takeover to the officer whose claim was taken over.
ALTER TABLE plugin_data.csf_sheet_import_staging_claims
  ADD COLUMN IF NOT EXISTS released_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;
ALTER TABLE plugin_data.csf_sheet_import_staging_objects
  ADD COLUMN IF NOT EXISTS opened_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS finalized_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retire_requested_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN plugin_data.csf_sheet_import_staging_claims.released_by IS
  'The officer who released this claim, authorized at release time. Never the original claimant: a takeover must not be recorded against the person whose claim was taken.';

ALTER TABLE plugin_data.csf_sheet_import_staging_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_sheet_import_staging_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_sheet_import_staging_objects FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE plugin_data.csf_sheet_import_staging_claims FROM PUBLIC, anon, authenticated;
-- Deliberately read-only for service_role: every mutation goes through a narrow
-- lifecycle RPC so no caller can invent a state transition.
GRANT SELECT ON TABLE plugin_data.csf_sheet_import_staging_objects TO service_role;
GRANT SELECT ON TABLE plugin_data.csf_sheet_import_staging_claims TO service_role;

-- ---------------------------------------------------------------------------
-- Bounded, classified operational evidence.
--
-- Nothing that reaches a durable column may be a raw thrown message. A reason is a
-- short machine code from a closed shape; a detail is dropped outright unless it is
-- already plain operational prose. Truncating a raw database or transport message
-- to fit a column is not sanitizing it -- the fragment still carries statement
-- text, constraint names, hostnames, addresses, or a student value, and it would
-- then sit next to student records and be rendered to an officer.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Edge padding DETECTION for an exact coordinate. One implementation.
--
-- Four functions each carried their own copy of a character-class regex, and
-- every copy was the same INCOMPLETE list: it stopped at U+FFFB and omitted
-- U+0890, U+0891, U+08E2 and every non-BMP format control -- U+110BD, U+110CD,
-- the Egyptian hieroglyph controls, U+1BCA0..U+1BCA3, the musical beam
-- controls, U+E0001 and the tag characters. The TypeScript boundary matches
-- `\p{White_Space}\p{Cc}\p{Cf}`, which is the complete current union, so an
-- identifier padded with any of those was refused there and read as exact here:
-- two authorities disagreeing about the same bytes, which is the one thing this
-- contract may not do.
--
-- Written as CODE POINT bounds rather than a character class, so it means the
-- same thing under every collation. In a UTF-8 database `ascii()` returns the
-- Unicode code point of the first character, so `left(value, 1)` and
-- `right(value, 1)` give exactly the two code points this rule is about --
-- including non-BMP ones, which a UTF-16-shaped class cannot express at all.
--
-- Only the EDGES. An opaque provider identifier stays opaque, so an ordinary
-- internal character -- including one of these -- is not this rule's business.
--
-- U+0000 NUL is inside the first range for completeness, but PostgreSQL `text`
-- cannot hold one: a NUL-padded coordinate is refused by the json/text input
-- boundary long before any caller reaches here, and the TypeScript regression is
-- what covers that edge because it is the only authority that can represent it.
CREATE OR REPLACE FUNCTION plugin_data.csf_has_edge_padding(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  -- Built-ins are written unqualified, exactly as `csf_bounded_reason_code`
  -- below does: `pg_catalog` is always implicitly first in the search path even
  -- when `search_path` is empty, and `coalesce` is a SQL construct rather than a
  -- catalog function, so it has no schema-qualified spelling at all.
  SELECT coalesce(bool_or(
    -- Cc (C0 controls) plus White_Space SPACE.
       edge.code BETWEEN 0 AND 32
    -- DEL, Cc (C1 controls), White_Space NEL and NO-BREAK SPACE.
    OR edge.code BETWEEN 127 AND 160
    OR edge.code = 173                     -- U+00AD SOFT HYPHEN
    OR edge.code BETWEEN 1536 AND 1541     -- U+0600..U+0605
    OR edge.code = 1564                    -- U+061C
    OR edge.code = 1757                    -- U+06DD
    OR edge.code = 1807                    -- U+070F
    OR edge.code BETWEEN 2192 AND 2193     -- U+0890..U+0891
    OR edge.code = 2274                    -- U+08E2
    OR edge.code = 5760                    -- U+1680 OGHAM SPACE MARK
    OR edge.code = 6158                    -- U+180E MONGOLIAN VOWEL SEPARATOR
    OR edge.code BETWEEN 8192 AND 8207     -- U+2000..U+200F
    OR edge.code BETWEEN 8232 AND 8239     -- U+2028..U+202F
    OR edge.code BETWEEN 8287 AND 8292     -- U+205F..U+2064
    OR edge.code BETWEEN 8294 AND 8303     -- U+2066..U+206F
    OR edge.code = 12288                   -- U+3000 IDEOGRAPHIC SPACE
    OR edge.code = 65279                   -- U+FEFF
    OR edge.code BETWEEN 65529 AND 65531   -- U+FFF9..U+FFFB
    OR edge.code = 69821                   -- U+110BD KAITHI NUMBER SIGN
    OR edge.code = 69837                   -- U+110CD KAITHI NUMBER SIGN ABOVE
    OR edge.code BETWEEN 78896 AND 78911   -- U+13430..U+1343F
    OR edge.code BETWEEN 113824 AND 113827 -- U+1BCA0..U+1BCA3
    OR edge.code BETWEEN 119155 AND 119162 -- U+1D173..U+1D17A
    OR edge.code = 917505                  -- U+E0001 LANGUAGE TAG
    OR edge.code BETWEEN 917536 AND 917631 -- U+E0020..U+E007F
  ), false)
  FROM (
    SELECT ascii(left(p_value, 1)) AS code
    UNION ALL
    SELECT ascii(right(p_value, 1))
  ) AS edge
  WHERE p_value IS NOT NULL AND p_value <> '';
$$;

COMMENT ON FUNCTION plugin_data.csf_has_edge_padding(text) IS
  'Whether an exact coordinate is padded at either end by a character in the union of Unicode White_Space, general category Cc and general category Cf. Locale-independent by construction: the first and last code points are read with ascii(left(...)) and ascii(right(...)), which return Unicode code points in a UTF-8 database, and compared against explicit numeric bounds rather than against a character class whose meaning depends on collation and which cannot express a non-BMP range at all. Replaces four duplicated copies of an incomplete BMP-only list that omitted U+0890, U+0891, U+08E2, U+110BD, U+110CD, U+13430..U+1343F, U+1BCA0..U+1BCA3, U+1D173..U+1D17A, U+E0001 and U+E0020..U+E007F, each of which the TypeScript boundary already refused. Detection only: nothing is trimmed, and an internal occurrence of any of these characters is deliberately not padding. NULL and the empty string are not padded. Internal helper; no role holds EXECUTE.';

-- Server-only, like every other internal helper: it is a component of the
-- SECURITY DEFINER gates that call it, never a capability of its own. The
-- convergence block at the end of this migration states the same thing again;
-- this revoke is here so the function is never reachable in the window between
-- its creation and that block.
REVOKE ALL ON FUNCTION plugin_data.csf_has_edge_padding(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_bounded_reason_code(
  p_value text,
  p_fallback text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN lower(btrim(coalesce(p_value, ''))) ~ '^[a-z][a-z0-9_]{2,39}$'
      THEN lower(btrim(p_value))
    ELSE p_fallback
  END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_bounded_failure_detail(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN collapsed.value = '' THEN NULL
    WHEN length(collapsed.value) > 200 THEN NULL
    -- An address, a URI, a quoted literal, or a long digit run means this is
    -- provider or database output rather than our own prose. Dropped, not clipped.
    WHEN collapsed.value ~ '[@]|://|["'']|[0-9]{5,}' THEN NULL
    WHEN collapsed.value !~ '^[A-Za-z0-9 ,.()_-]+$' THEN NULL
    ELSE collapsed.value
  END
  FROM (
    SELECT btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')) AS value
  ) AS collapsed;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_bounded_reason_code(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_bounded_failure_detail(text)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staging lifecycle functions.
--
-- Canonical staging lock order, used by every function below without variation:
--
--   1. the sheet source row
--   2. the staging object row
--   3. the staging claim row
--
-- The previous shape violated it in two directions at once: `open` locked source
-- then object, while `finalize` locked object and then updated -- and so locked --
-- source. Two officers, one finalizing an upload and one starting the next, could
-- deadlock on exactly that pair. Where a function is handed an inner identifier (a
-- staging object id, a claim token) it resolves the outer identifiers with an
-- unlocked read first, then takes the locks outermost-first and re-verifies
-- everything under them.
-- ---------------------------------------------------------------------------

-- Queue a retirement exactly once, and only when nothing is still reading.
--
-- Internal. Its callers already hold the source lock; it is taken again here so
-- the canonical order still holds if a future caller forgets.
CREATE OR REPLACE FUNCTION plugin_data.csf_settle_staging_retirement(
  p_staging_object_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_id uuid;
  v_staging plugin_data.csf_sheet_import_staging_objects%ROWTYPE;
  v_live integer;
BEGIN
  -- Unlocked, and only to find the outer lock target.
  SELECT staging.source_id INTO v_source_id
  FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.id = p_staging_object_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.id = v_source_id
  FOR UPDATE;

  SELECT * INTO v_staging
  FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.id = p_staging_object_id
  FOR UPDATE;
  IF NOT FOUND OR v_staging.status <> 'retire_pending' THEN
    RETURN false;
  END IF;

  SELECT count(*) INTO v_live
  FROM plugin_data.csf_sheet_import_staging_claims AS claim
  WHERE claim.staging_object_id = v_staging.id
    AND claim.released_at IS NULL
    AND claim.lease_expires_at > now();
  IF v_live > 0 THEN
    -- Somebody is still reading these bytes. Retirement stays pending.
    RETURN false;
  END IF;

  -- The outbox row is written FIRST, inside this transaction, and every later
  -- statement depends on it having succeeded.
  --
  -- The order is the durability argument, not a style choice. The tombstone is
  -- the row that stops advertising the path, so if the path were cleared before
  -- the queue accepted it, a queue failure would roll back -- but only if the
  -- whole thing is one transaction, and the previous order made that the ONLY
  -- thing standing between an operator and a private object nothing referenced
  -- any more. Writing the outbox first states the dependency directly: no path
  -- is forgotten here until the outbox has committed to remembering it.
  --
  -- Keyed on (bucket, object_path), and the path carries the generation, so this
  -- is idempotent and can never name a later generation.
  INSERT INTO plugin_data.csf_storage_deletion_queue (
    organization_id, submission_file_id, bucket, object_path
  ) VALUES (
    v_staging.organization_id, NULL, v_staging.bucket, v_staging.object_path
  )
  ON CONFLICT (bucket, object_path) DO NOTHING;

  -- The source's current path is cleared only while it still names *these* bytes.
  -- Clearing it unconditionally would blank the pointer to a newer generation the
  -- attachment had already published, which is how retiring a superseded upload
  -- used to make a newer, perfectly readable one unreachable.
  UPDATE plugin_data.csf_sheet_sources
  SET uploaded_file_path = NULL,
      updated_at = now()
  WHERE organization_id = v_staging.organization_id
    AND id = v_staging.source_id
    AND uploaded_file_path = v_staging.object_path;

  -- Last: the generation becomes a tombstone and stops naming a storage path at
  -- all. Its typed immutable evidence -- organization, source, object id,
  -- generation, provider extension, digest, byte length, ready time, retirement
  -- reason/times and actor -- all survive; only the pointer to readable bytes
  -- does not. The state-aware constraint on the table refuses the inverse.
  UPDATE plugin_data.csf_sheet_import_staging_objects
  SET status = 'tombstoned',
      tombstoned_at = now(),
      object_path = NULL
  WHERE id = v_staging.id;

  RETURN true;
END;
$$;

-- Request retirement of a generation. Settles immediately when unclaimed.
--
-- Split in two, because retirement has two genuinely different callers and
-- collapsing them was what left five lifecycle branches calling a signature that
-- no longer exists:
--
--   * an OFFICER retiring a generation they can see, which must prove they hold
--     the source's capability, and
--   * a LIFECYCLE branch already inside an authorized operation -- open
--     superseding an abandoned upload, the attachment compare-and-swap
--     superseding the exact predecessor it just replaced, release consuming a
--     claim -- or a SWEEPER doing system work on nobody's behalf.
--
-- The second kind cannot re-authorize: open and attach have already proved the
-- actor, and a sweeper has no actor at all. Passing them through the public
-- entry point would mean either re-running an assertion that already passed or,
-- for the sweeper, inventing an officer UUID to satisfy a signature -- which
-- would put a system decision under a real person's name in the audit receipt.
--
-- So the internal helper takes the actor as evidence rather than as a claim, and
-- accepts NULL to mean "the system did this". Its EXECUTE is revoked from every
-- role including `service_role`: it is reachable only from the owned SECURITY
-- DEFINER bodies below, which run as the schema owner.
--
-- `p_expected_generation` is the generation fence. A worker that opened generation
-- N may retire generation N and nothing else. Without it, a worker holding a stale
-- staging object id -- or an action whose cleanup path ran late -- could retire a
-- newer upload another officer had already made readable.
CREATE OR REPLACE FUNCTION plugin_data.csf_retire_staging_object_internal(
  p_organization_id uuid,
  p_staging_object_id uuid,
  p_reason text,
  p_expected_generation integer,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_staging plugin_data.csf_sheet_import_staging_objects%ROWTYPE;
  v_queued boolean := false;
BEGIN
  SELECT * INTO v_staging
  FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.organization_id = p_organization_id
    AND staging.id = p_staging_object_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF staged workbook was not found.' USING ERRCODE = '23503';
  END IF;

  IF p_expected_generation IS NOT NULL
    AND v_staging.generation <> p_expected_generation
  THEN
    RAISE EXCEPTION
      'This CSF staging generation has been superseded; nothing was retired.'
      USING ERRCODE = '55P03';
  END IF;

  IF v_staging.status IN ('uploading', 'ready') THEN
    UPDATE plugin_data.csf_sheet_import_staging_objects
    SET status = 'retire_pending',
        retire_requested_at = now(),
        -- The officer who asked for the retirement, or NULL when the sweeper did
        -- it. Never the officer who opened the generation: a late cleanup by a
        -- second officer is their act, and a sweep is nobody's.
        retire_requested_by = p_actor_user_id,
        retire_reason = plugin_data.csf_bounded_reason_code(p_reason, 'retired')
    WHERE id = v_staging.id;
  END IF;

  v_queued := plugin_data.csf_settle_staging_retirement(v_staging.id);

  RETURN jsonb_build_object(
    'stagingObjectId', v_staging.id,
    'generation', v_staging.generation,
    'bucket', v_staging.bucket,
    'contentHash', v_staging.content_hash,
    'byteLength', v_staging.byte_length,
    -- Only a queued path may be deleted from storage, so the caller is handed one
    -- only when it really was queued.
    'objectPath', CASE WHEN v_queued THEN v_staging.object_path ELSE NULL END,
    'queued', v_queued,
    -- Stated so a caller can tell an officer's retirement from a sweep without
    -- re-reading the row.
    'retiredBy', p_actor_user_id,
    'systemInitiated', p_actor_user_id IS NULL
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_retire_staging_object_internal(uuid, uuid, text, integer, uuid) IS
  'Owner-only retirement primitive. Takes the acting officer as evidence already proved by its caller, or NULL for genuine system work such as the sweepers. EXECUTE is revoked from PUBLIC, anon, authenticated and service_role: it is reachable only from the owned SECURITY DEFINER bodies that authorize first.';

-- The externally reachable retirement. Authorizes, then delegates.
CREATE OR REPLACE FUNCTION plugin_data.csf_retire_staging_object(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_staging_object_id uuid,
  p_reason text,
  p_expected_generation integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_id uuid;
BEGIN
  SELECT staging.source_id INTO v_source_id
  FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.organization_id = p_organization_id
    AND staging.id = p_staging_object_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF staged workbook was not found.' USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor_for_source(
    p_organization_id, p_actor_user_id, v_source_id
  );

  -- Source first, then object: the canonical staging lock order. The helper takes
  -- the object lock, so this is the only place the source lock belongs.
  PERFORM 1
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = v_source_id
  FOR UPDATE;

  RETURN plugin_data.csf_retire_staging_object_internal(
    p_organization_id, p_staging_object_id, p_reason, p_expected_generation,
    p_actor_user_id
  );
END;
$$;

-- Open the next generation as `uploading`.
--
-- Retires only an *abandoned upload* this source left behind. It deliberately does
-- not touch the source's readable generation: that generation stays claimable for
-- the whole time the replacement is being written, and the attachment
-- compare-and-swap is what supersedes it. Retiring it here left the source with
-- nothing claimable for the entire upload window, and turned a failed upload into
-- a source with no readable workbook at all.
CREATE OR REPLACE FUNCTION plugin_data.csf_open_staging_object(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_bucket text,
  p_file_extension text,
  p_content_hash text,
  p_byte_length bigint,
  p_upload_ttl_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_previous uuid;
  v_previous_expires_at timestamptz;
  v_previous_organization_id uuid;
  v_previous_generation integer;
  v_generation integer;
  v_object_path text;
  v_id uuid;
  v_expires timestamptz;
BEGIN
  -- Interactive. Authorized against the source's own kind, from the source row,
  -- before a generation is allocated or any bytes are addressed.
  PERFORM plugin_data.csf_assert_import_actor_for_source(
    p_organization_id, p_actor_user_id, p_source_id
  );
  IF p_upload_ttl_seconds IS NULL OR p_upload_ttl_seconds < 60 OR p_upload_ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'CSF staging upload TTL must be between 60 and 86400 seconds.'
      USING ERRCODE = '22023';
  END IF;
  IF p_file_extension NOT IN ('xlsx', 'csv') THEN
    RAISE EXCEPTION 'CSF staging supports only xlsx and csv.' USING ERRCODE = '22023';
  END IF;
  -- Exactly one private bucket. An arbitrary bucket name from a caller would put
  -- exact original student workbooks somewhere with different access rules.
  IF p_bucket IS DISTINCT FROM 'csf-private' THEN
    RAISE EXCEPTION 'CSF staging is only permitted in the csf-private bucket.'
      USING ERRCODE = '22023';
  END IF;
  -- The caller's digest is CHECKED, never repaired.
  --
  -- This stored and returned `lower(btrim(p_content_hash))`, which is a producer
  -- manufacturing canonical evidence: ` AA..AA ` was rewritten into `aa..aa`,
  -- stored as the content address of these bytes, handed back to the caller as
  -- though it had been supplied that way, and then compared byte for byte by
  -- three consumer gates that exist precisely to test whether two records of
  -- the same bytes agree. A digest that had to be normalized on the way in is a
  -- digest nothing downstream can attribute, so a padded or uppercase one is
  -- refused before anything durable is written.
  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION
      'A CSF staged workbook requires a canonical lowercase sha256 content digest.'
      USING ERRCODE = '22023';
  END IF;
  IF p_byte_length IS NULL OR p_byte_length < 1 THEN
    RAISE EXCEPTION 'A CSF staged workbook requires a positive byte length.'
      USING ERRCODE = '22023';
  END IF;

  -- Lock the source so two concurrent uploads cannot allocate one generation.
  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found.' USING ERRCODE = '23503';
  END IF;

  -- Staging exists for the three central record sources. Attendance and
  -- partner-club workbooks are acquired inside their contextual workflow and must
  -- never be staged through this lifecycle.
  IF v_source.source_type NOT IN ('application_responses', 'student_roster', 'class_history') THEN
    RAISE EXCEPTION
      'Only central CSF record sources may stage an uploaded workbook.'
      USING ERRCODE = '23514';
  END IF;

  -- The typed source_type and the legacy settings discriminator must agree, or a
  -- later reader could resolve two different allowlists for the same bytes.
  IF nullif(btrim(coalesce(v_source.settings->>'sourceKind', '')), '') IS DISTINCT FROM v_source.source_type THEN
    RAISE EXCEPTION
      'This CSF source disagrees with itself about its source type; re-save the source before uploading.'
      USING ERRCODE = '23514';
  END IF;

  -- Provider and extension are one fact stated twice; a mismatch means the bytes
  -- and the declared format disagree.
  IF NOT (
    (v_source.provider = 'uploaded_xlsx' AND p_file_extension = 'xlsx')
    OR (v_source.provider = 'uploaded_csv' AND p_file_extension = 'csv')
  ) THEN
    RAISE EXCEPTION
      'The uploaded workbook format does not match this source provider.'
      USING ERRCODE = '23514';
  END IF;

  -- ------------------------------------------------------------------
  -- B1b.3.1 -- the source lock is also the DIGEST FENCE.
  --
  -- A staged generation belongs to the workbook the source was registered
  -- under. Without this, an adopted or concurrent caller holding a different
  -- workbook could allocate a generation against someone else's source, and the
  -- attachment compare-and-swap would only notice much later -- after the bytes
  -- had already been written to private storage.
  --
  -- A digestless uploaded source fails closed too: it is outside the arbiter's
  -- corpus, so nothing here can prove which workbook it is.
  -- ------------------------------------------------------------------
  IF NOT (v_source.settings ? 'contentHash')
    OR pg_catalog.jsonb_typeof(v_source.settings -> 'contentHash') <> 'string'
    OR v_source.settings ->> 'contentHash' !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION
      'This CSF source does not record the canonical workbook digest a staged upload must match.'
      USING ERRCODE = '23514';
  END IF;
  IF v_source.settings ->> 'contentHash' IS DISTINCT FROM p_content_hash THEN
    RAISE EXCEPTION
      'This uploaded workbook does not match the digest this CSF source was registered under.'
      USING ERRCODE = '23514';
  END IF;

  -- ------------------------------------------------------------------
  -- B1b.3.1 -- an UNEXPIRED upload is live, and nothing may steal it.
  --
  -- This used to find any `uploading` row, call it `upload_abandoned` on no
  -- evidence at all, retire it, and allocate the next generation. So a second
  -- caller -- a concurrent upload to the same source, or a loser that had just
  -- adopted the winner's source -- destroyed a live upload before the attachment
  -- CAS existed to protect anything: the winner's staging row was retired and
  -- its bytes queued for deletion while it was still writing them.
  --
  -- The deadline is the evidence. Read under the source lock, BEFORE the
  -- retirement helper and BEFORE any allocation, and answered with a closed
  -- `busy` receipt that names no staging id and no path. Crash recovery is
  -- unchanged: an upload whose deadline passes is reclaimable here and by the
  -- bounded expiry sweeper, exactly as before.
  -- ------------------------------------------------------------------
  SELECT staging.organization_id, staging.id, staging.generation, staging.upload_expires_at
  INTO v_previous_organization_id, v_previous, v_previous_generation, v_previous_expires_at
  FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.organization_id = p_organization_id
    AND staging.source_id = p_source_id
    AND staging.status = 'uploading'
  FOR UPDATE;

  IF v_previous IS NOT NULL THEN
    IF v_previous_expires_at IS NULL OR v_previous_expires_at > now() THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'busy');
    END IF;
    -- Only now: the deadline has passed, so this generation is abandoned rather
    -- than live. Already inside an authorized open -- the actor was proved above
    -- -- so this is their retirement rather than a second authorization.
    --
    -- Retired on the OBSERVED coordinates, fenced on the OBSERVED generation.
    -- Passing NULL disabled the helper's own generation fence exactly where it
    -- mattered: a stale or racing caller could then retire whatever occupied
    -- that id. The organization is re-verified rather than assumed, so a row
    -- that somehow belonged elsewhere fails closed before any allocation.
    IF v_previous_organization_id IS DISTINCT FROM p_organization_id
      OR v_previous_generation IS NULL
      OR v_previous_generation < 1
    THEN
      RAISE EXCEPTION
        'This CSF source''s abandoned upload could not be identified for retirement.'
        USING ERRCODE = '22023';
    END IF;
    PERFORM plugin_data.csf_retire_staging_object_internal(
      v_previous_organization_id, v_previous, 'upload_abandoned', v_previous_generation,
      p_actor_user_id
    );
  END IF;

  SELECT coalesce(max(staging.generation), 0) + 1
  INTO v_generation
  FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.source_id = p_source_id;

  -- Server-derived path. Organization and source scope it; the generation makes
  -- it unique; the digest is not part of it.
  v_object_path := 'csf/' || p_organization_id::text || '/record-imports/'
    || p_source_id::text || '/g' || v_generation::text || '.' || p_file_extension;
  v_expires := now() + make_interval(secs => p_upload_ttl_seconds);

  INSERT INTO plugin_data.csf_sheet_import_staging_objects (
    organization_id, source_id, generation, status, bucket, object_path,
    file_extension, content_hash, byte_length, upload_expires_at, opened_by
  ) VALUES (
    p_organization_id, p_source_id, v_generation, 'uploading', p_bucket, v_object_path,
    p_file_extension, p_content_hash, p_byte_length, v_expires,
    p_actor_user_id
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'outcome', 'opened',
    'stagingObjectId', v_id,
    'generation', v_generation,
    'bucket', p_bucket,
    'objectPath', v_object_path,
    'contentHash', p_content_hash,
    'byteLength', p_byte_length,
    'status', 'uploading',
    'uploadExpiresAt', v_expires
  );
END;
$$;

-- Promote an uploaded generation to `ready`. Nothing else.
--
-- This function publishes no source pointer and retires no predecessor. Both
-- belong to `csf_attach_sheet_source_generation`, which does them in the same
-- transaction that accepts the swap -- so a crash or a refused CAS after
-- finalize leaves the previous generation attached, readable and claimable, and
-- leaves this one merely ready and unattached for bounded cleanup.
CREATE OR REPLACE FUNCTION plugin_data.csf_finalize_staging_object(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_staging_object_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- How long readable original bytes may sit unclaimed before the sweeper retires
  -- them without any cooperation from the process that uploaded them. Long enough
  -- for an officer to finish mapping and run a preview; short enough that a crashed
  -- preview does not leave an exact student workbook readable indefinitely.
  c_ready_ttl_seconds constant integer := 21600;
  v_source_id uuid;
  v_staging plugin_data.csf_sheet_import_staging_objects%ROWTYPE;
  v_ready timestamptz;
BEGIN
  SELECT staging.source_id INTO v_source_id
  FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.organization_id = p_organization_id
    AND staging.id = p_staging_object_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF staged workbook was not found.' USING ERRCODE = '23503';
  END IF;

  -- Interactive. Resolved from the OBJECT's own source rather than a caller
  -- argument, so a staging id from another tenant cannot be authorized against a
  -- source the caller happens to hold a capability for.
  PERFORM plugin_data.csf_assert_import_actor_for_source(
    p_organization_id, p_actor_user_id, v_source_id
  );

  -- Source first, then object: the canonical order. Locking the object first and
  -- then updating the source, as this used to, deadlocked against `open`.
  PERFORM 1
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = v_source_id
  FOR UPDATE;

  SELECT * INTO v_staging
  FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.organization_id = p_organization_id
    AND staging.id = p_staging_object_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF staged workbook was not found.' USING ERRCODE = '23503';
  END IF;
  IF v_staging.status <> 'uploading' THEN
    RAISE EXCEPTION 'Only an uploading CSF staging generation can be finalized.'
      USING ERRCODE = '55000';
  END IF;
  IF v_staging.upload_expires_at <= now() THEN
    RAISE EXCEPTION 'This CSF staging upload expired before it was finalized.'
      USING ERRCODE = '55000';
  END IF;

  v_ready := now();
  UPDATE plugin_data.csf_sheet_import_staging_objects
  SET status = 'ready',
      finalized_by = p_actor_user_id,
      ready_at = v_ready,
      -- The deadline is set here, not by the caller, so no upload path can promote
      -- bytes to readable without also stating when they stop being readable.
      ready_expires_at = v_ready + make_interval(secs => c_ready_ttl_seconds)
  WHERE id = v_staging.id;

  -- Deliberately nothing else.
  --
  -- This function used to publish `uploaded_file_path` and retire every older
  -- ready generation right here, BEFORE the attachment compare-and-swap had
  -- accepted anything. A crash or a refused CAS between the two RPCs therefore
  -- left attached generation N retired and finalized-but-unattached N+1
  -- unclaimable -- the source pointed at bytes no consumer gate would accept,
  -- and the generation every gate did accept was on its way to deletion.
  --
  -- Promotion to `ready` is a statement about THESE bytes only: they are
  -- readable, their evidence is frozen, and their deadline is set. Which
  -- generation the source POINTS at is a different decision, it is authoritative,
  -- and it belongs to `csf_attach_sheet_source_generation` -- which publishes the
  -- new path and requests the exact predecessor's retirement in the same
  -- transaction that accepts the swap.

  RETURN jsonb_build_object(
    'stagingObjectId', v_staging.id,
    'generation', v_staging.generation,
    'bucket', v_staging.bucket,
    'objectPath', v_staging.object_path,
    'contentHash', v_staging.content_hash,
    'byteLength', v_staging.byte_length,
    'readyAt', v_ready,
    'readyExpiresAt', v_ready + make_interval(secs => c_ready_ttl_seconds),
    'status', 'ready'
  );
END;
$$;

-- Claim the source's ATTACHED ready generation for reading.
--
-- Only a live claim authorizes a download, and the claim carries the complete
-- immutable evidence for the bytes it names -- path, generation, digest, byte
-- length, ready timestamp -- so the caller can verify what it downloaded really is
-- the generation it claimed instead of trusting the source's mutable pointer.
--
-- "Attached", not "newest". Selecting the newest ready row made a generation
-- that had been finalized but never attached claimable: `csf_finalize_staging_object`
-- promotes bytes to `ready`, while the source's authoritative attachment --
-- `stagingObjectId` / `stagingGeneration` / `stagingContentHash` and the
-- `uploaded_file_path` published beside them, all moved only by the
-- `csf_attach_sheet_source_generation`
-- compare-and-swap -- still named the older one. A preview could therefore read
-- generation N+1 while every consumer gate checked its evidence against the
-- attached N and refused, or, worse, while a concurrent attach landed in between
-- and the two agreed by accident. The claim now names exactly the row the
-- attachment names, and once the attachment advances that new generation becomes
-- the claimable one.
CREATE OR REPLACE FUNCTION plugin_data.csf_claim_staging_object(
  p_organization_id uuid,
  p_source_id uuid,
  p_claimed_by uuid,
  p_lease_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_uuid_shape constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_sha256_shape constant text := '^[0-9a-f]{64}$';
  -- The `integer` ceiling the staging generation column holds.
  c_generation_max constant bigint := 2147483647;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_attached_object_text text;
  v_attached_object_id uuid;
  v_attached_generation_text text;
  v_attached_generation integer;
  v_attached_hash text;
  v_staging plugin_data.csf_sheet_import_staging_objects%ROWTYPE;
  v_claim_id uuid;
  v_token uuid;
  v_lease timestamptz;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'CSF staging claim lease must be between 30 and 3600 seconds.'
      USING ERRCODE = '22023';
  END IF;

  -- Interactive: an officer claims a staged workbook to read it. `p_claimed_by`
  -- was recorded and never checked, so any service caller could hold a claim in
  -- any officer's name and block that source for the lease duration.
  PERFORM plugin_data.csf_assert_import_actor_for_source(
    p_organization_id, p_claimed_by, p_source_id
  );

  -- Source first, then object: the canonical lock order every other staging path
  -- takes. The row is READ here, not merely locked, because its settings are the
  -- authority for which generation may be claimed.
  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found.' USING ERRCODE = '23503';
  END IF;

  -- The attachment, read EXACTLY and type-checked before any cast.
  --
  -- `->>` renders a JSON number, boolean or array into text that would satisfy
  -- a bare uuid or integer cast attempt, and an unguarded `::uuid` on malformed
  -- settings raises invalid_text_representation quoting the offending text back
  -- at the caller. Each coordinate is therefore read as a JSON string, matched
  -- against its own grammar, and only then cast.
  v_attached_object_text := CASE
    WHEN jsonb_typeof(v_source.settings -> 'stagingObjectId') = 'string'
      THEN nullif(v_source.settings ->> 'stagingObjectId', '')
    ELSE NULL
  END;
  v_attached_generation_text := CASE
    WHEN jsonb_typeof(v_source.settings -> 'stagingGeneration') = 'string'
      THEN nullif(v_source.settings ->> 'stagingGeneration', '')
    WHEN jsonb_typeof(v_source.settings -> 'stagingGeneration') = 'number'
      THEN v_source.settings ->> 'stagingGeneration'
    ELSE NULL
  END;
  v_attached_hash := CASE
    WHEN jsonb_typeof(v_source.settings -> 'stagingContentHash') = 'string'
      THEN nullif(v_source.settings ->> 'stagingContentHash', '')
    ELSE NULL
  END;
  IF v_attached_object_text IS NULL
    OR v_attached_object_text !~ c_uuid_shape
    OR v_attached_generation_text IS NULL
    OR v_attached_generation_text !~ '^[1-9][0-9]{0,9}$'
    OR v_attached_hash IS NULL
    OR v_attached_hash !~ c_sha256_shape
  THEN
    RAISE EXCEPTION
      'No readable uploaded workbook remains for this source. Upload it again to run a new preview.'
      USING ERRCODE = '55000';
  END IF;
  IF v_attached_generation_text::bigint > c_generation_max THEN
    RAISE EXCEPTION
      'No readable uploaded workbook remains for this source. Upload it again to run a new preview.'
      USING ERRCODE = '55000';
  END IF;
  v_attached_object_id := v_attached_object_text::uuid;
  v_attached_generation := v_attached_generation_text::integer;

  -- Exactly the attached row, locked by primary key. No ordering and no LIMIT:
  -- a finalized generation the attachment has not moved to is not claimable, and
  -- "the newest one that happens to be ready" is not a coordinate any consumer
  -- gate checks against.
  SELECT * INTO v_staging
  FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.organization_id = p_organization_id
    AND staging.id = v_attached_object_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_staging.source_id IS DISTINCT FROM p_source_id
    OR v_staging.generation IS DISTINCT FROM v_attached_generation
    OR v_staging.content_hash IS DISTINCT FROM v_attached_hash
    OR v_staging.status <> 'ready'
  THEN
    RAISE EXCEPTION
      'No readable uploaded workbook remains for this source. Upload it again to run a new preview.'
      USING ERRCODE = '55000';
  END IF;

  v_lease := now() + make_interval(secs => p_lease_seconds);
  INSERT INTO plugin_data.csf_sheet_import_staging_claims (
    organization_id, staging_object_id, claimed_by, lease_expires_at
  ) VALUES (
    p_organization_id, v_staging.id, p_claimed_by, v_lease
  ) RETURNING id, claim_token INTO v_claim_id, v_token;

  -- Somebody is actively reading these bytes, so the retirement deadline moves out
  -- past this claim. Without this, a long preview started just before the deadline
  -- would have its bytes retired underneath it by the sweeper -- and, conversely, a
  -- claim that never releases can no longer hold a readable generation open forever,
  -- because the deadline still advances only by the lease it actually asked for.
  UPDATE plugin_data.csf_sheet_import_staging_objects
  SET ready_expires_at = greatest(ready_expires_at, v_lease + make_interval(secs => p_lease_seconds))
  WHERE id = v_staging.id;

  RETURN jsonb_build_object(
    'claimId', v_claim_id,
    'claimToken', v_token,
    'stagingObjectId', v_staging.id,
    'generation', v_staging.generation,
    'bucket', v_staging.bucket,
    'objectPath', v_staging.object_path,
    'contentHash', v_staging.content_hash,
    'byteLength', v_staging.byte_length,
    'readyAt', v_staging.ready_at,
    'status', v_staging.status,
    'leaseExpiresAt', v_lease
  );
END;
$$;

-- Retire every readable generation whose consumption deadline has passed.
--
-- Internal, and the only crash-durable retirement path. The action layer requests
-- retirement from a JavaScript `finally`, which does not run when the process dies;
-- this is what makes "the preview never came back" a state the database resolves on
-- its own. A live claim still blocks the deletion queue, so a concurrent reader is
-- never cut off -- the retirement simply stays pending until that claim goes away.
CREATE OR REPLACE FUNCTION plugin_data.csf_retire_expired_staging_objects(
  p_limit integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_row record;
  v_retired integer := 0;
BEGIN
  FOR v_row IN
    SELECT staging.id, staging.organization_id
    FROM plugin_data.csf_sheet_import_staging_objects AS staging
    JOIN plugin_data.csf_sheet_sources AS source
      ON source.id = staging.source_id
    WHERE staging.status = 'ready'
      AND staging.ready_expires_at <= now()
    ORDER BY staging.ready_expires_at
    LIMIT v_limit
    -- The source, not the object: the canonical staging order is source first, and
    -- the retirement below wants the object lock.
    FOR UPDATE OF source SKIP LOCKED
  LOOP
    -- A sweep, with no officer behind it. NULL is the honest actor: fabricating
    -- one would record a system decision under a real person's name.
    PERFORM plugin_data.csf_retire_staging_object_internal(
      v_row.organization_id, v_row.id, 'ready_deadline_passed', NULL, NULL
    );
    v_retired := v_retired + 1;
  END LOOP;

  RETURN v_retired;
END;
$$;

-- Release a claim. Idempotent for the exact token; settles any pending retirement.
--
-- The retirement decision of the first release is persisted on the claim. A replay
-- that asks for the opposite decision is refused rather than silently
-- reinterpreted, because "this preview consumed the bytes" and "this preview left
-- the bytes readable" are different durable facts.
--
-- A replay reports the queued path only while the exact outbox row is still
-- observed. Once the cleanup has drained that row the deletion is COMPLETE, and
-- this answers `queued = false` with `objectPath = null` rather than continuing
-- to describe a pending removal that already happened.
CREATE OR REPLACE FUNCTION plugin_data.csf_release_staging_claim(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_claim_token uuid,
  p_reason text,
  p_retire boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claim plugin_data.csf_sheet_import_staging_claims%ROWTYPE;
  v_source_id uuid;
  v_staging_id uuid;
  v_retire boolean := coalesce(p_retire, false);
  v_already boolean := false;
  v_queued boolean := false;
  v_staging plugin_data.csf_sheet_import_staging_objects%ROWTYPE;
  -- Captured BEFORE settlement, because settlement is what clears it. The
  -- tombstone deliberately keeps no path; the outbox is the durable record, and
  -- this is the caller's copy of the exact path that was committed to it.
  v_settled_path text;
  -- The outbox row actually observed for that path, or NULL. Both `queued` and
  -- `objectPath` are answered from this and from nothing else.
  v_queue_path text;
BEGIN
  -- Unlocked, and only to resolve the two outer lock targets from the claim token.
  SELECT source.id, staging.id INTO v_source_id, v_staging_id
  FROM plugin_data.csf_sheet_import_staging_claims AS claim
  JOIN plugin_data.csf_sheet_import_staging_objects AS staging
    ON staging.id = claim.staging_object_id
  JOIN plugin_data.csf_sheet_sources AS source
    ON source.id = staging.source_id
  WHERE claim.organization_id = p_organization_id
    AND claim.claim_token = p_claim_token;

  -- Authorized as the CURRENT officer. The claim token proves which claim is
  -- being released; it does not prove who is releasing it, and inheriting the
  -- original claimant's authority is exactly how a takeover would launder a
  -- capability that has since been withdrawn.
  IF FOUND THEN
    PERFORM plugin_data.csf_assert_import_actor_for_source(
      p_organization_id, p_actor_user_id, v_source_id
    );
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF staging claim was not found.' USING ERRCODE = '23503';
  END IF;

  -- Source, then object, then claim -- actually locked in that order, not merely
  -- described in that order. The previous shape locked the source and then the claim
  -- and only reached the object indirectly through the retirement helper, so the
  -- object lock was really being taken *after* the claim lock. Against the sweeper,
  -- which reaches source -> object -> claim, that is an inversion.
  PERFORM 1
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = v_source_id
  FOR UPDATE;

  SELECT * INTO v_staging
  FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.organization_id = p_organization_id
    AND staging.id = v_staging_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF staged workbook was not found.' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_claim
  FROM plugin_data.csf_sheet_import_staging_claims AS claim
  WHERE claim.organization_id = p_organization_id
    AND claim.claim_token = p_claim_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF staging claim was not found.' USING ERRCODE = '23503';
  END IF;

  IF v_claim.released_at IS NOT NULL THEN
    v_already := true;
    IF v_claim.retire_intent IS DISTINCT FROM v_retire THEN
      RAISE EXCEPTION
        'This CSF staging claim was already released with a different retirement decision.'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    UPDATE plugin_data.csf_sheet_import_staging_claims
    SET released_at = now(),
        released_by = p_actor_user_id,
        release_reason = plugin_data.csf_bounded_reason_code(p_reason, 'released'),
        retire_intent = v_retire
    WHERE id = v_claim.id;
  END IF;

  -- Captured BEFORE the retirement helper, which settles internally. The
  -- previous revision read this AFTER that call and claimed to be reading it
  -- before settlement: by then the tombstone had already nulled the column, so
  -- the "candidate" was reliably NULL exactly when it mattered.
  SELECT staging.object_path INTO v_settled_path
  FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.id = v_claim.staging_object_id;

  IF v_retire THEN
    PERFORM plugin_data.csf_retire_staging_object_internal(
      p_organization_id, v_claim.staging_object_id,
      plugin_data.csf_bounded_reason_code(p_reason, 'consumed'), NULL,
      p_actor_user_id
    );
  END IF;
  v_queued := plugin_data.csf_settle_staging_retirement(v_claim.staging_object_id);

  -- Re-read the object under the lock taken above, so the reported status reflects
  -- the retirement that just settled.
  SELECT * INTO v_staging
  FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.id = v_claim.staging_object_id;

  -- What the caller may be told about the bytes, decided by OBSERVATION.
  --
  -- On a replay the staging row is already a tombstone and holds no path, so the
  -- candidate is reconstructed from the coordinates the tombstone does keep --
  -- the same deterministic derivation `csf_open_staging_object` used to build it
  -- -- and is then used only to LOOK UP the outbox. The value returned is the
  -- outbox's own, never the reconstruction.
  IF v_settled_path IS NULL AND v_staging.status = 'tombstoned' THEN
    v_settled_path := 'csf/' || v_staging.organization_id::text
      || '/record-imports/' || v_staging.source_id::text
      || '/g' || v_staging.generation::text || '.' || v_staging.file_extension;
  END IF;

  -- The single positive observation both answers depend on. `queued` was
  -- previously true for any tombstone, so a replay AFTER the cleanup drained the
  -- outbox still told the caller the path was queued -- and handed back a null
  -- path to go with it. A drained queue is a completed deletion, not a pending
  -- one, and this now says so.
  IF v_settled_path IS NOT NULL THEN
    SELECT queue.object_path INTO v_queue_path
    FROM plugin_data.csf_storage_deletion_queue AS queue
    WHERE queue.organization_id = v_staging.organization_id
      AND queue.bucket = v_staging.bucket
      AND queue.object_path = v_settled_path;
  END IF;
  RETURN jsonb_build_object(
    'released', NOT v_already,
    'alreadyReleased', v_already,
    'retireIntent', v_retire,
    'queued', v_queue_path IS NOT NULL,
    'stagingObjectId', v_claim.staging_object_id,
    'generation', v_staging.generation,
    'bucket', v_staging.bucket,
    'contentHash', v_staging.content_hash,
    'byteLength', v_staging.byte_length,
    'objectPath', CASE
      WHEN v_queue_path IS NOT NULL THEN v_queue_path
      ELSE NULL
    END
  );
END;
$$;

-- Bounded sweeper for abandoned uploads and expired claims.
CREATE OR REPLACE FUNCTION plugin_data.csf_sweep_staging_objects(
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_row record;
  v_abandoned integer := 0;
  v_expired_claims integer := 0;
  v_settled integer := 0;
  v_ready_expired integer := 0;
BEGIN
  -- Every batch below locks the *source* with SKIP LOCKED rather than the staging
  -- object or the claim. That keeps the sweep bounded and non-blocking while still
  -- taking the outermost lock first: taking the object lock here and then calling a
  -- retirement that wants the source lock would invert the canonical order and
  -- deadlock against an officer opening the next upload.

  -- Abandoned uploads: never finalized, past their upload window.
  FOR v_row IN
    SELECT staging.id, staging.organization_id
    FROM plugin_data.csf_sheet_import_staging_objects AS staging
    JOIN plugin_data.csf_sheet_sources AS source
      ON source.id = staging.source_id
    WHERE staging.status = 'uploading'
      AND staging.upload_expires_at <= now()
    ORDER BY staging.upload_expires_at
    LIMIT v_limit
    FOR UPDATE OF source SKIP LOCKED
  LOOP
    PERFORM plugin_data.csf_retire_staging_object_internal(
      v_row.organization_id, v_row.id, 'upload_abandoned', NULL, NULL
    );
    v_abandoned := v_abandoned + 1;
  END LOOP;

  -- Expired claims stop counting as live readers.
  FOR v_row IN
    SELECT claim.id, claim.staging_object_id
    FROM plugin_data.csf_sheet_import_staging_claims AS claim
    JOIN plugin_data.csf_sheet_import_staging_objects AS staging
      ON staging.id = claim.staging_object_id
    JOIN plugin_data.csf_sheet_sources AS source
      ON source.id = staging.source_id
    WHERE claim.released_at IS NULL
      AND claim.lease_expires_at <= now()
    -- Ordered to match csf_staging_claims_expired_sweep_idx exactly, including the
    -- id tiebreak, so the bounded batch is a deterministic index scan.
    ORDER BY claim.lease_expires_at, claim.id
    LIMIT v_limit
    FOR UPDATE OF source SKIP LOCKED
  LOOP
    -- The staging object is locked here, before the claim is touched.
    --
    -- Without this the loop ran source -> claim -> object: it updated the claim and only
    -- then reached the object inside `csf_settle_staging_retirement`. Release runs
    -- source -> object -> claim. Two sessions on the same source cannot deadlock,
    -- because the source lock serialises them -- but on *different* sources sharing
    -- nothing else the inner pair could still interleave, and more importantly the
    -- migration claimed one global order while the sweeper implemented another. Taking
    -- the object first makes the claimed order the real one everywhere.
    PERFORM 1
    FROM plugin_data.csf_sheet_import_staging_objects AS staging
    WHERE staging.id = v_row.staging_object_id
    FOR UPDATE;

    UPDATE plugin_data.csf_sheet_import_staging_claims
    SET released_at = now(),
        release_reason = 'claim_lease_expired',
        retire_intent = false
    WHERE id = v_row.id
      AND released_at IS NULL;
    v_expired_claims := v_expired_claims + 1;
    IF plugin_data.csf_settle_staging_retirement(v_row.staging_object_id) THEN
      v_settled := v_settled + 1;
    END IF;
  END LOOP;

  -- Readable generations nobody came back for. This is the step that makes a crashed
  -- preview deterministic: the retire request no longer depends on a JavaScript
  -- `finally` that a killed process never runs.
  v_ready_expired := plugin_data.csf_retire_expired_staging_objects(v_limit);

  -- Retirements that were blocked by a claim that has since gone away. Runs last so
  -- anything the two steps above marked `retire_pending` is settled in the same pass
  -- when no live reader remains.
  FOR v_row IN
    SELECT staging.id
    FROM plugin_data.csf_sheet_import_staging_objects AS staging
    JOIN plugin_data.csf_sheet_sources AS source
      ON source.id = staging.source_id
    WHERE staging.status = 'retire_pending'
    ORDER BY staging.retire_requested_at
    LIMIT v_limit
    FOR UPDATE OF source SKIP LOCKED
  LOOP
    IF plugin_data.csf_settle_staging_retirement(v_row.id) THEN
      v_settled := v_settled + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'abandonedUploads', v_abandoned,
    'expiredClaims', v_expired_claims,
    'readyDeadlinesPassed', v_ready_expired,
    'settledRetirements', v_settled
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_settle_staging_retirement(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_retire_staging_object_internal(uuid, uuid, text, integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_retire_staging_object(uuid, uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_open_staging_object(uuid, uuid, uuid, text, text, text, bigint, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_finalize_staging_object(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_staging_object(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_release_staging_claim(uuid, uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_sweep_staging_objects(integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_retire_staging_object(uuid, uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_open_staging_object(uuid, uuid, uuid, text, text, text, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finalize_staging_object(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_staging_object(uuid, uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_release_staging_claim(uuid, uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sweep_staging_objects(integer) TO service_role;
-- csf_settle_staging_retirement is internal: only the lifecycle functions above
-- may settle a retirement.

-- ---------------------------------------------------------------------------
-- The commit attempt ledger.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_sheet_import_commit_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  commit_job_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  -- Immutable actor snapshot. Row audit derives the actor from here, not from the
  -- caller, so a changed caller cannot impersonate the officer who claimed.
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(actor_snapshot) = 'object'),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'superseded')),
  lease_expires_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failure_reason text,
  CONSTRAINT csf_commit_attempts_job_organization_fkey
    FOREIGN KEY (commit_job_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_jobs (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_commit_attempts_number_key UNIQUE (commit_job_id, attempt_number),
  CONSTRAINT csf_commit_attempts_correlation_key UNIQUE (correlation_id),
  CONSTRAINT csf_commit_attempts_id_organization_key UNIQUE (id, organization_id),
  CONSTRAINT csf_commit_attempts_lease_check CHECK (
    (status = 'running' AND lease_expires_at IS NOT NULL AND completed_at IS NULL)
    OR (status <> 'running' AND lease_expires_at IS NULL AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX csf_commit_attempts_one_running_idx
  ON plugin_data.csf_sheet_import_commit_attempts (commit_job_id)
  WHERE status = 'running';

CREATE INDEX csf_commit_attempts_job_idx
  ON plugin_data.csf_sheet_import_commit_attempts (organization_id, commit_job_id, attempt_number DESC);

COMMENT ON TABLE plugin_data.csf_sheet_import_commit_attempts IS
  'Immutable fenced attempts of one logical CSF commit job. Scoped to central sheet imports; contextual attendance and partner-club batches commit in one transaction and have no attempts.';

ALTER TABLE plugin_data.csf_sheet_import_commit_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_sheet_import_commit_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE plugin_data.csf_sheet_import_commit_attempts TO service_role;

ALTER TABLE plugin_data.csf_sheet_import_jobs
  ADD COLUMN active_commit_attempt_id uuid,
  ADD CONSTRAINT csf_sheet_import_jobs_active_attempt_organization_fkey
    FOREIGN KEY (active_commit_attempt_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_commit_attempts (id, organization_id)
    ON DELETE SET NULL (active_commit_attempt_id),
  ADD CONSTRAINT csf_sheet_import_jobs_active_attempt_mode_check
    CHECK (active_commit_attempt_id IS NULL OR mode = 'commit');

-- Referencing-side partial index, so resolving "which job does this attempt own"
-- and cascading a cleared attempt do not scan the jobs table.
CREATE INDEX csf_sheet_import_jobs_active_attempt_idx
  ON plugin_data.csf_sheet_import_jobs (active_commit_attempt_id)
  WHERE active_commit_attempt_id IS NOT NULL;

-- The logical commit's actor, frozen once at the first claim.
--
-- An attempt already records the caller that opened it, but the *authoritative*
-- officer is the one whose decision the commit executes, and that must not change
-- when a lapsed attempt is taken over by whoever happened to retry. Row audit and
-- the wrapper read the actor from here, so a later caller cannot inherit the
-- authority of the officer who reviewed the preview.
ALTER TABLE plugin_data.csf_sheet_import_jobs
  ADD COLUMN commit_actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN commit_actor_snapshot jsonb,
  ADD CONSTRAINT csf_sheet_import_jobs_commit_actor_shape_check CHECK (
    commit_actor_snapshot IS NULL OR jsonb_typeof(commit_actor_snapshot) = 'object'
  ),
  ADD CONSTRAINT csf_sheet_import_jobs_commit_actor_mode_check CHECK (
    commit_actor_snapshot IS NULL OR mode = 'commit'
  );

ALTER TABLE plugin_data.csf_sheet_import_rows
  ADD COLUMN commit_attempt_id uuid,
  -- A genuinely ambiguous authoritative outcome is durable state, not a counter
  -- in a summary. It blocks finalization and blocks the next claim until an
  -- officer reconciles it.
  ADD COLUMN commit_outcome_unresolved boolean NOT NULL DEFAULT false,
  ADD COLUMN commit_outcome_note text,
  ADD CONSTRAINT csf_sheet_import_rows_commit_attempt_organization_fkey
    FOREIGN KEY (commit_attempt_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_commit_attempts (id, organization_id),
  -- Only an authoritative write outcome may carry lineage. `pending` has not been
  -- written; `skipped` and `superseded` are officer or preview decisions, not
  -- writes performed by an attempt.
  ADD CONSTRAINT csf_sheet_import_rows_commit_attempt_status_check CHECK (
    commit_attempt_id IS NULL
    OR import_status IN ('created', 'updated', 'error')
  ),
  ADD CONSTRAINT csf_sheet_import_rows_unresolved_note_check CHECK (
    commit_outcome_unresolved = false OR commit_outcome_note IS NOT NULL
  );

CREATE INDEX csf_sheet_import_rows_commit_attempt_idx
  ON plugin_data.csf_sheet_import_rows (commit_attempt_id)
  WHERE commit_attempt_id IS NOT NULL;

CREATE INDEX csf_sheet_import_rows_unresolved_outcome_idx
  ON plugin_data.csf_sheet_import_rows (organization_id, job_id)
  WHERE commit_outcome_unresolved;

CREATE INDEX csf_sheet_import_rows_pending_commit_idx
  ON plugin_data.csf_sheet_import_rows (job_id, sheet_tab_name, row_number, id)
  WHERE import_status = 'pending';

-- ---------------------------------------------------------------------------
-- The frozen authoritative decision, and the durable outcome state machine.
--
-- Everything an attempt is allowed to act on is copied here once, at the first
-- claim, in one deterministic pass over the preview in
-- (sheet_tab_name, row_number, id) order. After that the attempt reads only these
-- columns. A later edit to the preview row's match, to the source's metadata, to
-- the mapping, or a takeover by a different caller therefore cannot change what
-- gets committed -- which is the whole difference between "the officer approved
-- this" and "the officer approved something that has since been rewritten".
--
-- `commit_outcome_state` is the recovery model, not a counter:
--
--   not_started        -- never claimed
--   frozen             -- claimed and frozen, nothing attempted
--   in_flight          -- begin-intent recorded; a write may or may not have landed
--   succeeded          -- an authoritative write landed and was observed
--   failed             -- deterministically refused before any write
--   unknown            -- begin-intent recorded, no trustworthy result; review-blocked
--   historical_unknown -- committed before this ledger existed; provenance unknown
--
-- `unknown` and `historical_unknown` are the only states that block the next claim
-- and finalization, and only the fenced reconciliation RPCs may leave them.
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_sheet_import_rows
  ADD COLUMN commit_frozen_at timestamptz,
  ADD COLUMN commit_frozen_by_job_id uuid,
  ADD COLUMN commit_frozen_row_hash text,
  ADD COLUMN commit_frozen_source_id uuid,
  -- The preview's own source revision, so a source re-synced to different bytes
  -- after the freeze is detectable rather than silently committed.
  ADD COLUMN commit_frozen_source_revision text,
  ADD COLUMN commit_frozen_payload_hash text,
  ADD COLUMN commit_frozen_actor_user_id uuid,
  ADD COLUMN commit_frozen_actor_snapshot jsonb,
  -- The explicit officer-approved target. Null means "this row may not attach to an
  -- existing member", which for an application means it may not commit at all.
  ADD COLUMN commit_target_profile_id uuid,
  ADD COLUMN commit_resolution_snapshot jsonb,
  ADD COLUMN commit_intent_attempt_id uuid,
  ADD COLUMN commit_intent_correlation_id uuid,
  ADD COLUMN commit_intent_started_at timestamptz,
  ADD COLUMN commit_outcome_state text NOT NULL DEFAULT 'not_started',
  ADD COLUMN commit_outcome_code text,
  ADD COLUMN commit_outcome_resolution text,
  ADD COLUMN commit_outcome_resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN commit_outcome_resolved_at timestamptz,
  ADD COLUMN commit_outcome_correlation_id uuid,
  -- Retry lineage. A deterministically failed row may be tried again, but the
  -- attempt that failed is immutable and must stay nameable, so its identity moves
  -- here rather than being cleared. `commit_retry_count` is what makes the carve-out
  -- in the lineage trigger self-describing: only a transition that *records* the
  -- attempt it is releasing and increments the counter is a retry.
  ADD COLUMN commit_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN commit_last_failed_attempt_id uuid;

ALTER TABLE plugin_data.csf_sheet_import_rows
  -- Same-organization composite references with deletion restricted. NO ACTION
  -- rather than RESTRICT deliberately: both give "you may not delete the thing this
  -- frozen evidence names", but NO ACTION is checked at the end of the statement, so
  -- deleting a whole organization -- which cascades to the profiles, jobs, attempts
  -- *and* these rows in one statement -- still succeeds. RESTRICT fires immediately
  -- and would make tenant teardown depend on cascade ordering.
  ADD CONSTRAINT csf_sheet_import_rows_frozen_job_organization_fkey
    FOREIGN KEY (commit_frozen_by_job_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_jobs (id, organization_id) ON DELETE NO ACTION,
  ADD CONSTRAINT csf_sheet_import_rows_frozen_source_organization_fkey
    FOREIGN KEY (commit_frozen_source_id, organization_id)
    REFERENCES plugin_data.csf_sheet_sources (id, organization_id) ON DELETE NO ACTION,
  ADD CONSTRAINT csf_sheet_import_rows_frozen_target_organization_fkey
    FOREIGN KEY (commit_target_profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE NO ACTION,
  ADD CONSTRAINT csf_sheet_import_rows_intent_attempt_organization_fkey
    FOREIGN KEY (commit_intent_attempt_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_commit_attempts (id, organization_id)
    ON DELETE NO ACTION,
  ADD CONSTRAINT csf_sheet_import_rows_outcome_state_check CHECK (
    commit_outcome_state IN (
      'not_started', 'frozen', 'in_flight',
      'succeeded', 'failed', 'unknown', 'historical_unknown'
    )
  ),
  -- All or none. A half-written freeze is indistinguishable from a forged one.
  ADD CONSTRAINT csf_sheet_import_rows_freeze_complete_check CHECK (
    (
      commit_frozen_at IS NULL
      AND commit_frozen_by_job_id IS NULL
      AND commit_frozen_row_hash IS NULL
      AND commit_frozen_source_id IS NULL
      AND commit_frozen_payload_hash IS NULL
      AND commit_frozen_actor_snapshot IS NULL
      AND commit_resolution_snapshot IS NULL
    )
    OR (
      commit_frozen_at IS NOT NULL
      AND commit_frozen_by_job_id IS NOT NULL
      AND commit_frozen_row_hash IS NOT NULL
      AND commit_frozen_source_id IS NOT NULL
      AND commit_frozen_payload_hash IS NOT NULL
      AND commit_frozen_actor_snapshot IS NOT NULL
      AND commit_resolution_snapshot IS NOT NULL
    )
  ),
  ADD CONSTRAINT csf_sheet_import_rows_freeze_shape_check CHECK (
    (commit_frozen_actor_snapshot IS NULL
      OR jsonb_typeof(commit_frozen_actor_snapshot) = 'object')
    AND (commit_resolution_snapshot IS NULL
      OR jsonb_typeof(commit_resolution_snapshot) = 'object')
    AND (commit_frozen_row_hash IS NULL OR commit_frozen_row_hash ~ '^[0-9a-f]{64}$')
    AND (commit_frozen_payload_hash IS NULL OR commit_frozen_payload_hash ~ '^[0-9a-f]{64}$')
    AND (commit_frozen_source_revision IS NULL
      OR commit_frozen_source_revision ~ '^[0-9a-f]{64}$')
  ),
  -- Only pre-ledger history may hold an outcome state without a freeze. An
  -- unresolved backfill remains `historical_unknown`; its one coherent terminal
  -- transition is the attributed `historical_accepted` acknowledgement below.
  -- Requiring a freeze for that transition would force the acknowledgement RPC
  -- to fabricate provenance this migration explicitly says does not exist.
  ADD CONSTRAINT csf_sheet_import_rows_state_needs_freeze_check CHECK (
    commit_outcome_state IN ('not_started', 'historical_unknown')
    OR commit_frozen_at IS NOT NULL
    OR (
      commit_outcome_state = 'succeeded'
      AND commit_outcome_resolution = 'historical_accepted'
    )
  ),
  -- The intent triple is all or none, and only a state that follows begin-intent
  -- may carry one.
  ADD CONSTRAINT csf_sheet_import_rows_intent_complete_check CHECK (
    (
      commit_intent_attempt_id IS NULL
      AND commit_intent_correlation_id IS NULL
      AND commit_intent_started_at IS NULL
    )
    OR (
      commit_intent_attempt_id IS NOT NULL
      AND commit_intent_correlation_id IS NOT NULL
      AND commit_intent_started_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT csf_sheet_import_rows_intent_state_check CHECK (
    commit_outcome_state NOT IN ('in_flight', 'unknown')
    OR commit_intent_attempt_id IS NOT NULL
  ),
  -- `unresolved` and the state machine are one fact, so they cannot drift apart.
  ADD CONSTRAINT csf_sheet_import_rows_unresolved_state_check CHECK (
    commit_outcome_unresolved = (commit_outcome_state IN ('unknown', 'historical_unknown'))
  ),
  -- Reconciliation is an explicit, attributed, bounded decision or it did not happen.
  ADD CONSTRAINT csf_sheet_import_rows_outcome_resolution_check CHECK (
    (
      commit_outcome_resolution IS NULL
      AND commit_outcome_resolved_by IS NULL
      AND commit_outcome_resolved_at IS NULL
    )
    OR (
      -- A closed set of *recorded outcomes*, not of officer opinions.
      -- `confirmed_written` exists only where the ledger proves the write landed;
      -- there is deliberately no stored value meaning "an officer asserted a write
      -- nothing recorded", because that assertion is refused rather than persisted.
      commit_outcome_resolution IN (
        'confirmed_written',
        'accepted_as_not_written',
        'historical_accepted',
        'terminally_skipped'
      )
      AND commit_outcome_resolved_by IS NOT NULL
      AND commit_outcome_resolved_at IS NOT NULL
    )
  ),
  -- Durable evidence is a closed reason code plus, at most, bounded prose.
  ADD CONSTRAINT csf_sheet_import_rows_outcome_code_shape_check CHECK (
    commit_outcome_code IS NULL OR commit_outcome_code ~ '^[a-z][a-z0-9_]{2,39}$'
  ),
  ADD CONSTRAINT csf_sheet_import_rows_outcome_note_bounded_check CHECK (
    commit_outcome_note IS NULL OR length(commit_outcome_note) <= 200
  ),
  ADD CONSTRAINT csf_sheet_import_rows_retry_count_check CHECK (commit_retry_count >= 0),
  -- Recorded lineage implies a settlement happened; a settlement does not imply there
  -- was lineage to record. A row reconciled out of `unknown` reaches `failed` with no
  -- attempt to name -- the write never landed, so no attempt wrote it -- and it must
  -- still be retryable or skippable. Requiring lineage here is what stranded it.
  ADD CONSTRAINT csf_sheet_import_rows_retry_lineage_check CHECK (
    commit_last_failed_attempt_id IS NULL OR commit_retry_count > 0
  ),
  ADD CONSTRAINT csf_sheet_import_rows_last_failed_attempt_fkey
    FOREIGN KEY (commit_last_failed_attempt_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_commit_attempts (id, organization_id)
    ON DELETE NO ACTION,
  -- ------------------------------------------------------------------
  -- Coherence across state dimensions. These two are the whole answer to "a row
  -- that is terminal in one dimension and pending in another".
  --
  -- A recovery decision used to be able to move the outcome to `succeeded` while
  -- leaving `import_status = 'pending'` and no attempt lineage. Finalize counted the
  -- pending row forever and the commit worklist -- which selects only `frozen` rows
  -- -- could never pick it up again, so the row was permanently stranded and the
  -- logical commit could never complete.
  --
  -- The mirror case is worse: accepting a pre-ledger row as *not* written while its
  -- `import_status` still said `created`. That is a durable claim that a member
  -- record both exists and was never written.
  -- ------------------------------------------------------------------
  ADD CONSTRAINT csf_sheet_import_rows_succeeded_coherent_check CHECK (
    commit_outcome_state <> 'succeeded' OR import_status IN ('created', 'updated')
  ),
  ADD CONSTRAINT csf_sheet_import_rows_failed_coherent_check CHECK (
    commit_outcome_state <> 'failed' OR import_status NOT IN ('created', 'updated')
  );

-- Referencing sides of the composite references above, so a profile, source, job,
-- or attempt deletion check does not scan the whole rows table.
CREATE INDEX csf_sheet_import_rows_frozen_job_idx
  ON plugin_data.csf_sheet_import_rows (commit_frozen_by_job_id)
  WHERE commit_frozen_by_job_id IS NOT NULL;

CREATE INDEX csf_sheet_import_rows_frozen_source_idx
  ON plugin_data.csf_sheet_import_rows (commit_frozen_source_id)
  WHERE commit_frozen_source_id IS NOT NULL;

CREATE INDEX csf_sheet_import_rows_frozen_target_idx
  ON plugin_data.csf_sheet_import_rows (commit_target_profile_id)
  WHERE commit_target_profile_id IS NOT NULL;

CREATE INDEX csf_sheet_import_rows_intent_attempt_idx
  ON plugin_data.csf_sheet_import_rows (commit_intent_attempt_id)
  WHERE commit_intent_attempt_id IS NOT NULL;

CREATE INDEX csf_sheet_import_rows_last_failed_attempt_idx
  ON plugin_data.csf_sheet_import_rows (commit_last_failed_attempt_id)
  WHERE commit_last_failed_attempt_id IS NOT NULL;

-- The recovery worklist: rows whose authoritative outcome is not settled.
CREATE INDEX csf_sheet_import_rows_open_outcome_idx
  ON plugin_data.csf_sheet_import_rows (organization_id, job_id, commit_outcome_state)
  WHERE commit_outcome_state IN ('in_flight', 'unknown', 'historical_unknown');

COMMENT ON COLUMN plugin_data.csf_sheet_import_rows.commit_frozen_payload_hash IS
  'Digest of the exact allowlisted normalized_data.commitPayload frozen at claim time. The wrapper recomputes it and refuses to write when it no longer matches.';

COMMENT ON COLUMN plugin_data.csf_sheet_import_rows.commit_outcome_state IS
  'Durable recovery state. unknown and historical_unknown block the next claim and finalization until a fenced reconciliation RPC resolves them with an explicit officer decision.';

-- ---------------------------------------------------------------------------
-- Lineage and attempt immutability.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_import_row_attempt_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
BEGIN
  -- The frozen authoritative decision is write-once.
  --
  -- This is what makes the freeze mean anything. Without it, `matched_profile_id`
  -- and the frozen block stay editable by every other writer that touches an import
  -- row -- notably the pre-existing reconciliation RPC, which is a large function in
  -- an older migration and is deliberately not rewritten here. Guarding the columns
  -- rather than the caller covers every writer, present and future, including ones
  -- that do not know the freeze exists.
  IF TG_OP = 'UPDATE' AND OLD.commit_frozen_at IS NOT NULL THEN
    IF ROW(
      NEW.commit_frozen_at, NEW.commit_frozen_by_job_id, NEW.commit_frozen_row_hash,
      NEW.commit_frozen_source_id, NEW.commit_frozen_source_revision,
      NEW.commit_frozen_payload_hash, NEW.commit_frozen_actor_user_id,
      NEW.commit_frozen_actor_snapshot, NEW.commit_target_profile_id,
      NEW.commit_resolution_snapshot
    ) IS DISTINCT FROM ROW(
      OLD.commit_frozen_at, OLD.commit_frozen_by_job_id, OLD.commit_frozen_row_hash,
      OLD.commit_frozen_source_id, OLD.commit_frozen_source_revision,
      OLD.commit_frozen_payload_hash, OLD.commit_frozen_actor_user_id,
      OLD.commit_frozen_actor_snapshot, OLD.commit_target_profile_id,
      OLD.commit_resolution_snapshot
    ) THEN
      RAISE EXCEPTION
        'This CSF import row has a frozen commit decision; it cannot be re-frozen while that commit is outstanding.'
        USING ERRCODE = '55000';
    END IF;

    -- `matched_profile_id` is the *result* column, so it is pinned rather than
    -- frozen. A frozen row that named a target must keep naming exactly that target,
    -- so no writer can re-aim an approved decision at a different member. A frozen
    -- row with no target -- a roster or class-history row that will bring a new
    -- member into being -- may have its match filled in once, but only on the same
    -- update that records the result of a live write intent. Merely allowing the
    -- first null-to-value change let the legacy reconciliation path re-aim a still
    -- pending frozen row; the next claim detected drift, but only after the reviewed
    -- decision had already been mutated. Freezing the column outright would break
    -- every roster and class-history commit because their internal row RPCs record
    -- the member they created here, so that exact result transition is the one
    -- exception.
    IF OLD.commit_target_profile_id IS NOT NULL
      AND NEW.matched_profile_id IS DISTINCT FROM OLD.commit_target_profile_id
    THEN
      RAISE EXCEPTION
        'This CSF import row is frozen to a reviewed member; it cannot be re-matched to another.'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.commit_target_profile_id IS NULL
      AND OLD.matched_profile_id IS NOT NULL
      AND NEW.matched_profile_id IS DISTINCT FROM OLD.matched_profile_id
    THEN
      RAISE EXCEPTION
        'This CSF import row already records the member its commit created; it cannot be re-matched.'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.commit_target_profile_id IS NULL
      AND OLD.matched_profile_id IS NULL
      AND NEW.matched_profile_id IS NOT NULL
      AND NOT (
        OLD.commit_outcome_state = 'in_flight'
        AND OLD.commit_intent_attempt_id IS NOT NULL
        AND OLD.import_status = 'pending'
        AND NEW.import_status IN ('created', 'updated')
        AND NEW.resolved_by IS NOT DISTINCT FROM OLD.commit_frozen_actor_user_id
      )
    THEN
      RAISE EXCEPTION
        'This CSF import row has no live write result that may establish its committed member.'
        USING ERRCODE = '55000';
    END IF;

    -- The include/skip decision is part of the frozen decision.
    --
    -- Guarding only the target left the real hole: the pre-existing reconciliation
    -- RPC in an older migration still moves a `pending` row to `skipped`, and it has
    -- no idea this freeze exists. A concurrent officer skipping a frozen row removes
    -- it from the commit worklist, and finalize then reports the logical commit
    -- complete without it -- a silently short import of exactly the rows somebody was
    -- editing while it ran.
    --
    -- After a freeze there are only three legal destinations for `import_status`, and
    -- all three are reached through the fenced RPCs in this migration:
    --   pending -> created / updated   the authoritative write landed
    --   pending -> error               the write deterministically did not land
    --   error   -> pending / skipped   the fenced retry or terminal-skip transition
    IF NEW.import_status IS DISTINCT FROM OLD.import_status
      AND NOT (
        (OLD.import_status = 'pending' AND NEW.import_status IN ('created', 'updated', 'error'))
        OR (OLD.import_status = 'error' AND NEW.import_status IN ('pending', 'skipped')
          AND NEW.commit_retry_count > OLD.commit_retry_count
          AND NEW.commit_last_failed_attempt_id IS NOT DISTINCT FROM OLD.commit_attempt_id
          AND NEW.commit_attempt_id IS NULL)
      )
    THEN
      RAISE EXCEPTION
        'This CSF import row has a frozen commit decision; its include or skip decision cannot change while that commit is outstanding.'
        USING ERRCODE = '55000';
    END IF;

    -- Resolution metadata is part of the same decision. The legacy path rewrites
    -- resolution_status/resolved_by as a side effect of matching or skipping, so it is
    -- refused here too rather than only where it changes the match.
    IF OLD.import_status <> 'pending'
      AND NEW.resolution_status IS DISTINCT FROM OLD.resolution_status
      AND NEW.commit_retry_count IS NOT DISTINCT FROM OLD.commit_retry_count
    THEN
      RAISE EXCEPTION
        'This CSF import row is already terminal for its frozen commit; its reconciliation state cannot be rewritten.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- The outcome state machine. Every legal edge is listed; anything else is a
  -- writer inventing a transition.
  IF TG_OP = 'UPDATE' AND NEW.commit_outcome_state IS DISTINCT FROM OLD.commit_outcome_state THEN
    IF NOT (
      (OLD.commit_outcome_state = 'not_started' AND NEW.commit_outcome_state IN ('frozen', 'historical_unknown'))
      OR (OLD.commit_outcome_state = 'frozen' AND NEW.commit_outcome_state IN ('in_flight', 'failed'))
      OR (OLD.commit_outcome_state = 'in_flight' AND NEW.commit_outcome_state IN ('succeeded', 'failed', 'unknown'))
      OR (OLD.commit_outcome_state = 'unknown' AND NEW.commit_outcome_state IN ('succeeded', 'failed'))
      OR (OLD.commit_outcome_state = 'historical_unknown' AND NEW.commit_outcome_state = 'succeeded')
      -- The retry edge. Only a transition that releases and records the attempt it
      -- failed under, and increments the retry counter, may re-open a failed row.
      OR (OLD.commit_outcome_state = 'failed' AND NEW.commit_outcome_state = 'frozen'
        AND NEW.commit_retry_count > OLD.commit_retry_count
        AND NEW.commit_last_failed_attempt_id IS NOT DISTINCT FROM OLD.commit_attempt_id
        AND NEW.commit_attempt_id IS NULL)
    ) THEN
      RAISE EXCEPTION
        'A CSF import row cannot move from commit outcome "%" to "%".',
        OLD.commit_outcome_state, NEW.commit_outcome_state
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- A settled outcome is settled. Re-opening one would let a late worker overwrite
  -- an officer's reconciliation decision. Recording the *first* resolution is not
  -- re-reconciliation: a deterministically failed row is already `failed` before an
  -- officer decides whether to retry it or skip it terminally.
  IF TG_OP = 'UPDATE'
    AND OLD.commit_outcome_state IN ('succeeded', 'failed')
    AND NEW.commit_outcome_state = OLD.commit_outcome_state
    AND OLD.commit_outcome_resolution IS NOT NULL
    -- A terminal skip of an already-reconciled failure is a *further* decision about
    -- disposition, not a rewrite of the reconciliation, and it announces itself by
    -- incrementing the settlement counter. Without this exemption a row reconciled as
    -- "not written" could never afterwards be skipped, which is precisely how it stayed
    -- stranded: no retry, no skip, and finalize counting it forever.
    AND NEW.commit_retry_count IS NOT DISTINCT FROM OLD.commit_retry_count
    AND ROW(NEW.commit_outcome_resolution, NEW.commit_outcome_resolved_by, NEW.commit_outcome_resolved_at)
      IS DISTINCT FROM
       ROW(OLD.commit_outcome_resolution, OLD.commit_outcome_resolved_by, OLD.commit_outcome_resolved_at)
  THEN
    RAISE EXCEPTION
      'A settled CSF import row outcome cannot be re-reconciled.'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.commit_attempt_id IS NOT NULL
    AND NEW.commit_attempt_id IS DISTINCT FROM OLD.commit_attempt_id
    -- Releasing lineage is permitted only when it is *recorded* rather than lost, on
    -- the same statement that increments the retry counter. That is the fenced retry
    -- and terminal-skip transition; nothing else can satisfy all three at once.
    AND NOT (
      NEW.commit_attempt_id IS NULL
      AND NEW.commit_last_failed_attempt_id IS NOT DISTINCT FROM OLD.commit_attempt_id
      AND NEW.commit_retry_count > OLD.commit_retry_count
    )
  THEN
    RAISE EXCEPTION
      'A CSF import row already records the commit attempt that wrote it; it cannot be cleared or re-pointed.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.commit_attempt_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only a null -> value transition needs the fence assertion; an unchanged link
  -- on an unrelated update must not fail once the attempt has finished.
  IF TG_OP = 'UPDATE' AND OLD.commit_attempt_id IS NOT DISTINCT FROM NEW.commit_attempt_id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_attempt
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  WHERE attempt.id = NEW.commit_attempt_id
    AND attempt.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The CSF commit attempt named by this import row does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.id = v_attempt.commit_job_id;
  IF NOT FOUND OR v_commit.mode <> 'commit' THEN
    RAISE EXCEPTION
      'A CSF import row may only name an attempt of a commit job.'
      USING ERRCODE = '23514';
  END IF;

  IF v_commit.preview_job_id IS DISTINCT FROM NEW.job_id THEN
    RAISE EXCEPTION
      'A CSF import row may only be committed by an attempt derived from its own preview.'
      USING ERRCODE = '23514';
  END IF;

  -- The fence itself. Linking a row to an attempt that is not the active,
  -- unexpired owner of its logical job is exactly what a stale worker would do.
  IF v_attempt.status <> 'running'
    OR v_attempt.lease_expires_at IS NULL
    OR v_attempt.lease_expires_at <= now()
    OR v_commit.active_commit_attempt_id IS DISTINCT FROM v_attempt.id
  THEN
    RAISE EXCEPTION
      'Only the active, unexpired CSF commit attempt may record row lineage.'
      USING ERRCODE = '55P03';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS csf_sheet_import_rows_attempt_lineage
  ON plugin_data.csf_sheet_import_rows;
CREATE TRIGGER csf_sheet_import_rows_attempt_lineage
  BEFORE INSERT OR UPDATE ON plugin_data.csf_sheet_import_rows
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_enforce_import_row_attempt_lineage();

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_import_row_attempt_lineage()
  FROM PUBLIC, anon, authenticated;

-- A terminal attempt is frozen entirely, including completed_at and
-- failure_reason. Identity, correlation, and actor are immutable always.
CREATE OR REPLACE FUNCTION plugin_data.csf_preserve_import_commit_attempt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.organization_id, NEW.commit_job_id, NEW.attempt_number,
    NEW.correlation_id, NEW.actor_user_id, NEW.actor_snapshot, NEW.started_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.organization_id, OLD.commit_job_id, OLD.attempt_number,
    OLD.correlation_id, OLD.actor_user_id, OLD.actor_snapshot, OLD.started_at
  ) THEN
    RAISE EXCEPTION
      'CSF commit attempt identity, correlation, and actor are immutable; claim a new attempt instead.'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status <> 'running' THEN
    IF ROW(NEW.status, NEW.lease_expires_at, NEW.completed_at, NEW.failure_reason)
      IS DISTINCT FROM
       ROW(OLD.status, OLD.lease_expires_at, OLD.completed_at, OLD.failure_reason)
    THEN
      RAISE EXCEPTION
        'A finished CSF commit attempt is frozen and cannot be modified.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS csf_commit_attempts_preserve_identity
  ON plugin_data.csf_sheet_import_commit_attempts;
CREATE TRIGGER csf_commit_attempts_preserve_identity
  BEFORE UPDATE ON plugin_data.csf_sheet_import_commit_attempts
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_preserve_import_commit_attempt();

REVOKE ALL ON FUNCTION plugin_data.csf_preserve_import_commit_attempt()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- One canonical lock order for the whole commit coordinate.
--
-- Every RPC below that touches more than one of these objects calls this helper
-- first and then re-reads what it needs. The rows are already locked by then, so
-- those reads acquire nothing further and cannot take a lock out of order:
--
--   1. transaction-scoped advisory lock on (organization, preview job)
--   2. the preview job row
--   3. the logical commit job row
--   4. the commit attempt rows, oldest attempt first
--   5. the preview's import rows, in (sheet_tab_name, row_number, id) order
--   6. the sheet source row
--
-- The order matters because the previous shape did not have one. Claiming locked
-- preview -> commit -> attempt while finalizing and aborting started at the attempt
-- and then locked the commit: a takeover racing a finalize was a genuine deadlock,
-- and whichever session Postgres chose to kill left an attempt whose fence state
-- disagreed with its job's. The advisory lock at step 1 is what makes the rest
-- reliable -- two workers racing the same preview serialize before either has taken
-- a single row lock, so the row locks can never interleave into a cycle at all.
--
-- Staging has its own, disjoint order (source -> staging object -> staging claim).
-- The only object the two share is the source, and this helper takes it last, so no
-- cycle spans the two.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_lock_import_commit_coordinate(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_lock_rows boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_preview_job_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF import commit coordinate needs both an organization and a preview job.'
      USING ERRCODE = '22023';
  END IF;

  -- 1. The logical coordinate itself. Transaction-scoped, so it is released by
  -- commit or rollback and never leaks a session-level lock on failure.
  --
  -- One bigint key, not the two-int form: the two-argument advisory functions take
  -- int4 pairs, and the namespaced string below keeps CSF import coordinates from
  -- colliding with any other advisory key in the database.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'plugin_data.csf_import_commit:'
        || p_organization_id::text || ':' || p_preview_job_id::text,
      0
    )
  );

  -- 2. Preview job.
  PERFORM 1
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id
  FOR UPDATE;

  -- 3. Logical commit job, if one exists yet.
  PERFORM 1
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.organization_id = p_organization_id
    AND commit_job.mode = 'commit'
    AND commit_job.preview_job_id = p_preview_job_id
  FOR UPDATE;

  -- 4. Its attempts, oldest first.
  PERFORM 1
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  WHERE attempt.organization_id = p_organization_id
    AND attempt.commit_job_id IN (
      SELECT commit_job.id
      FROM plugin_data.csf_sheet_import_jobs AS commit_job
      WHERE commit_job.organization_id = p_organization_id
        AND commit_job.mode = 'commit'
        AND commit_job.preview_job_id = p_preview_job_id
    )
  ORDER BY attempt.attempt_number
  FOR UPDATE;

  -- 5. The preview's rows, in the one stable order the freeze also walks. Only the
  -- freeze needs the whole set; the per-row RPCs lock their single row instead.
  IF coalesce(p_lock_rows, false) THEN
    PERFORM 1
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = p_preview_job_id
    ORDER BY import_row.sheet_tab_name, import_row.row_number, import_row.id
    FOR UPDATE;
  END IF;

  -- 6. Source last, so it is also the one object shared with the staging order.
  SELECT preview.source_id INTO v_source_id
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id;

  IF v_source_id IS NOT NULL THEN
    PERFORM 1
    FROM plugin_data.csf_sheet_sources AS source
    WHERE source.organization_id = p_organization_id
      AND source.id = v_source_id
    FOR UPDATE;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_lock_import_commit_coordinate(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
-- Internal: only the owned commit RPCs below may take the coordinate.

COMMENT ON FUNCTION plugin_data.csf_lock_import_commit_coordinate(uuid, uuid, boolean) IS
  'The single canonical lock order for one logical CSF import commit: advisory coordinate, preview job, commit job, attempts, rows in stable order, source last.';

-- ---------------------------------------------------------------------------
-- What must be true before a logical commit may exist at all.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_import_preview_claim_blockers(
  p_organization_id uuid,
  p_preview_job_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_contract constant text := 'csf-normalized-import/v1';
  -- The acquisition request sentinel. Never exact provenance, in any spelling.
  c_used_range constant text := 'used-range';
  -- One rectangular A1 block, both endpoints CAPTURED so both can be ordered.
  --
  -- The predecessor was a single shape-only pattern applied to a btrimmed value,
  -- and a shape is not a rectangle. It accepted `B2:A1` and `A2:B1`, which name
  -- no cells in the order they are written; a qualifier naming a DIFFERENT tab
  -- than the entry it belonged to; `"Tab B"!A1:B2`, where the double quotes are
  -- two literal characters of a sheet name rather than A1 quoting; and an
  -- arbitrarily long row integer no spreadsheet has.
  c_a1_block constant text :=
    '^([A-Za-z]{1,3})([1-9][0-9]*):([A-Za-z]{1,3})([1-9][0-9]*)$';
  -- A quoted A1 sheet qualifier. `''''` is one literal quote inside the name.
  c_a1_quoted constant text := '^''((?:[^'']|'''')*)''!(.*)$';
  -- An unquoted qualifier is taken exactly as written and may contain no quote.
  c_a1_unquoted constant text := '^([^''!]+)!(.*)$';
  -- Bounded row space. Decided on the DIGIT COUNT before any cast, so an
  -- arbitrarily long integer is a refusal rather than a 22003 raised out of this
  -- STABLE function.
  c_a1_max_row constant bigint := 10000000;
  c_a1_max_row_digits constant integer := 8;
  -- The database `integer` ceiling the job's `mapping_version` column holds.
  c_mapping_version_max constant bigint := 2147483647;
  -- The one MIME a native Google Sheet has, and the two an uploaded workbook may
  -- have. Exact values, not families: the same three the receipt issuers own, so
  -- this gate and the receipt cannot disagree about what kind of file a preview
  -- read.
  c_sheets_mime constant text := 'application/vnd.google-apps.spreadsheet';
  c_csv_mime constant text := 'text/csv';
  c_xlsx_mime constant text :=
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  -- Drive documents `version` as an int64. Canonical decimal text: no sign, no
  -- leading zero, no separators, because this value is only ever compared for
  -- exact equality and `007` and `7` are the same integer but different evidence.
  c_version_shape constant text := '^[1-9][0-9]*$';
  -- The int64 ceiling as text, compared as text on purpose: with no leading zeros
  -- a shorter string is the smaller integer and equal lengths compare
  -- lexicographically in numeric order, so the bound holds with NO cast to any
  -- numeric type. That is what keeps malformed version text a bounded blocker
  -- rather than an invalid_text_representation raised out of a STABLE function.
  c_version_max constant text := '9223372036854775807';
  -- The canonical form of an uploaded workbook's content digest: lowercase
  -- sha256 hex. Uppercase is refused rather than folded, because these three
  -- values are only ever compared for exact equality and a digest that has been
  -- normalized on the way in is a digest nothing downstream can attribute.
  c_sha256_shape constant text := '^[0-9a-f]{64}$';
  -- Padding DETECTION, never repair -- and locale-INDEPENDENT.
  --
  -- Every coordinate below used to be read through `btrim(...)`, which is a
  -- normalization: a frozen id of ` 1AbC ` was repaired into `1AbC`, compared
  -- equal to the live Drive id, and a preview whose recorded evidence is not the
  -- coordinate passed the gate whose whole subject is exactness. This pattern
  -- only NOTICES surrounding padding; a value that matches it is malformed
  -- evidence and falls into the same re-preview refusal as a missing one.
  --
  -- `[[:space:]]` was the previous detector and it is a LOCALE class, so what it
  -- matches depends on the database's collation -- and it does not match U+0085
  -- NEXT LINE, U+00A0 NO-BREAK SPACE or U+200B ZERO WIDTH SPACE at all. An
  -- opaque provider id wrapped in any of those was read as exact here while the
  -- TypeScript boundary refused it: two authorities disagreeing about the same
  -- bytes, which is the one thing this contract may not do.
  --
  -- The code points are therefore listed by NUMBER, so the class means the same
  -- thing under every collation. It is the union of Unicode White_Space, general
  -- category Cc (the C0 and C1 controls, U+0085 among them) and general category
  -- Cf (the invisible formatting characters, U+200B and U+FEFF among them).
  --
  -- U+0000 NUL is absent by necessity rather than by omission: PostgreSQL `text`
  -- cannot hold one, so a NUL-padded coordinate is refused by the json/text input
  -- boundary before this function is ever reached. The TypeScript regression is
  -- what covers that edge, because it is the only authority that can represent it.
  -- The class used to be a LOCAL copy here, and in three other functions, and
  -- every copy stopped at U+FFFB: U+0890, U+0891, U+08E2 and every non-BMP
  -- format control were read as ordinary characters here while the TypeScript
  -- boundary refused them. It is now one shared function,
  -- `plugin_data.csf_has_edge_padding`, written as code-point bounds so it also
  -- covers the non-BMP controls a UTF-16-shaped character class cannot express.
  -- The provider's OWN output spelling for a frozen Drive `modifiedTime`, as a
  -- strict shape checked BEFORE the guarded timestamptz cast below.
  --
  -- Drive emits UTC `Z` form with either no fractional part or a fixed 3, 6 or 9
  -- digits. Narrowing to that supersedes the previous explicit-offset
  -- acceptance: a frozen value spelled `+00:00`, `-00:00` or `.1234` is not
  -- something the provider produced, so accepting it means accepting a
  -- coordinate authored somewhere between the provider and this column -- which
  -- is precisely what a frozen coordinate exists to rule out. `-00:00` is RFC
  -- 3339's "offset unknown" spelling and names no zone at all.
  --
  -- The cast alone is not a calendar gate: PostgreSQL raises for February 30 and
  -- for April 31 -- which the guard turns into a refusal -- but it happily reads
  -- `24:00:00` as the next day's midnight and `:60` as the next minute, so a
  -- frozen coordinate naming an hour that does not exist would have become the
  -- instant beside it. Hour 24, second 60, a missing timezone, padding, a locale
  -- spelling and trailing prose are all excluded here, before anything is cast.
  c_drive_instant constant text :=
    '^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])'
    || 'T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]'
    || '(?:\.(?:[0-9]{3}|[0-9]{6}|[0-9]{9}))?Z$';
  -- The nine-digit fractional form, captured so the three digits BELOW the
  -- microsecond can be inspected. A guarded cast is not enough on its own:
  -- `timestamptz` retains microseconds, so a frozen `.123456789Z` would be
  -- silently truncated to `.123456` and then compare EQUAL to a stored value it
  -- does not name. Significant precision the typed column cannot retain is a
  -- bounded refusal instead.
  c_drive_nanos constant text := '\.[0-9]{6}([0-9]{3})Z$';
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_blockers text[] := ARRAY[]::text[];
  v_total integer;
  v_pending integer;
  v_unresolved integer;
  v_unknown integer;
  v_in_flight integer;
  v_missing_cohort integer;
  v_missing_term integer;
  v_frozen_file_id text;
  v_frozen_revision text;
  v_frozen_mime text;
  v_frozen_version text;
  v_frozen_modified_text text;
  v_frozen_modified_at timestamptz;
  -- The family this preview STATES it was read under, from the frozen
  -- metadata. Never inferred from the MIME: the MIME is the thing this
  -- discriminator decides, so reading it as the discriminator made a preview
  -- that froze the wrong MIME select the rules it happens to satisfy.
  v_frozen_provider text;
  -- The uploaded family's own frozen coordinates.
  v_frozen_generation_text text;
  v_frozen_generation bigint;
  v_frozen_ready_text text;
  v_frozen_ready_at timestamptz;
  v_live_generation_text text;
  v_live_ready_text text;
  v_live_ready_at timestamptz;
  -- Mapping-snapshot coordinates, read through guarded control flow.
  v_mapping_ok boolean;
  v_mapping_version_text text;
  v_mapping_source_type text;
  v_mapping_file_id text;
  v_mapping_provider text;
  v_header_ok boolean;
  v_header_row_text text;
  -- The job's own identity column, read exactly rather than merely for presence.
  v_job_file_id text;
  -- The job's own record of the bytes it read, for the uploaded family.
  v_job_content_hash text;
  v_live_file_id text;
  v_live_mime text;
  v_live_revision text;
  -- The uploaded family's third, independently sourced digest: the value the
  -- receipt issuer wrote to the source immediately before this claim consumed
  -- the receipt.
  v_receipt_revision text;
  v_expected_mime text;
  v_tabs jsonb;
  v_tab jsonb;
  -- The mapping entry's own coordinates, read exactly and never btrimmed.
  v_tab_name text;
  v_range text;
  v_qualifier text;
  v_block text;
  v_parts text[];
  v_range_ok boolean;
  -- Used as a set of already-seen tab names; jsonb `?` gives exact, case-sensitive
  -- membership, which is what a spreadsheet's tab names require.
  v_tab_names jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id;
  IF NOT FOUND THEN
    RETURN ARRAY['The preview job was not found.'];
  END IF;

  IF v_preview.mode <> 'preview' THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Only a preview job may be committed.');
  END IF;

  -- ------------------------------------------------------------------
  -- Source evidence. This is the boundary, not the TypeScript precheck.
  --
  -- The client-side readiness check already refused an inaccessible or unidentified
  -- source, but it ran against the page's snapshot of the job. A direct authorized
  -- RPC call, or simply revoking Drive access between page render and the officer
  -- pressing the button, reached a claim gate that never looked at any of it -- and
  -- the freeze then committed a decision the interface had declared ineligible.
  -- ------------------------------------------------------------------
  IF nullif(btrim(coalesce(v_preview.source_file_id, '')), '') IS NULL THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Choose an exact source file.');
  END IF;
  IF nullif(btrim(coalesce(v_preview.source_file_name, '')), '') IS NULL THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Record the source file name.');
  END IF;
  -- Metadata shape is validated before it is read.
  --
  -- `(... ->> 'trashed')::boolean` was an uncontrolled cast: a preview whose metadata
  -- recorded `"trashed": "no"`, or a number, or an object, raised
  -- invalid_text_representation from inside a STABLE readiness function instead of
  -- returning a blocker. Malformed evidence is now a refusal, which is the fail-closed
  -- reading of "we cannot tell whether this file is still there".
  IF jsonb_typeof(coalesce(v_preview.source_file_metadata, 'null'::jsonb)) <> 'object' THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
  ELSE
    -- Trash state is REQUIRED and must be a JSON boolean.
    --
    -- An absent key, a JSON null and a `"no"` are the same fact: this preview
    -- never recorded whether the file it read still exists. `? 'trashed' AND
    -- typeof NOT IN ('boolean','null')` treated the first two as "not trashed",
    -- which answers the question rather than refusing it, and the TypeScript
    -- boundary refuses all three. `jsonb_typeof` of an absent key is NULL, so
    -- the coalesce is what makes absence reach this comparison at all.
    IF coalesce(jsonb_typeof(v_preview.source_file_metadata -> 'trashed'), 'absent')
      <> 'boolean'
    THEN
      v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
    END IF;
    IF coalesce(v_preview.source_file_metadata->>'accessState', '') <> 'accessible'
      OR coalesce(
        CASE
          WHEN jsonb_typeof(v_preview.source_file_metadata -> 'trashed') = 'boolean'
            THEN (v_preview.source_file_metadata ->> 'trashed')::boolean
          ELSE NULL
        END,
        false
      )
    THEN
      v_blockers := pg_catalog.array_append(v_blockers, 'Reconnect the source file before importing.');
    END IF;
  END IF;

  IF v_preview.source_id IS NULL THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Reconnect the source file before importing.');
  ELSE
    SELECT * INTO v_source
    FROM plugin_data.csf_sheet_sources AS source
    WHERE source.organization_id = p_organization_id
      AND source.id = v_preview.source_id;
    IF NOT FOUND THEN
      v_blockers := pg_catalog.array_append(v_blockers, 'Reconnect the source file before importing.');
    ELSE
      -- Live source state, not the preview's copy of it. A revoked or trashed source
      -- is refused even though the preview still remembers it as accessible.
      IF coalesce(v_source.drive_access_state, '') <> 'accessible'
        OR coalesce(v_source.drive_trashed, false)
      THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'Reconnect the source file before importing.');
      END IF;
      -- The legacy family discriminator, re-read exactly. A JSON non-string is
      -- not the discriminator, and ` student_roster ` was previously trimmed
      -- into agreement with the typed column rather than refused.
      IF (CASE
        WHEN jsonb_typeof(v_source.settings -> 'sourceKind') = 'string'
          THEN nullif(v_source.settings->>'sourceKind', '')
        ELSE NULL
      END) IS DISTINCT FROM v_preview.source_type
      THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'Reconnect the source file before importing.');
      END IF;

      -- ------------------------------------------------------------------
      -- Live identity and freshness drift, provider-aware and fail-closed.
      --
      -- Access and trash state were checked live, but nothing compared *which file*
      -- the source now points at, or whether its contents had moved on. An officer who
      -- re-pointed a source at a different spreadsheet -- or a Sheet that was edited
      -- after the preview was taken -- reached a gate that happily froze the old
      -- reviewed decision against the new file.
      --
      -- Two rules govern everything below, and they are deliberately distinct:
      --
      --   * MISSING or malformed evidence is a fresh-preview/recheck blocker. A
      --     comparison a null switches off is not a check, and "we cannot tell
      --     whether this is still the same file" is a refusal.
      --   * A DISAGREEMENT between two present coordinates is a changed- or
      --     replaced-source blocker, named for what actually diverged.
      --
      -- This gate is not the final authority -- the receipt consumed immediately
      -- above it is, because only a live provider read can prove the file as it is
      -- right now. But it must never call incomplete or already-drifted evidence
      -- ready, which is what the previous form did: for a Google source it compared
      -- an identity and, only when both sides happened to be non-null, a modified
      -- time. It read `headRevisionId` as "the revision" for every family, and a
      -- native Sheet has none, so the Google branch compared a null against a null
      -- and the one coordinate a Sheet exposes -- `version` -- was never looked at.
      --
      -- The display name is deliberately *not* compared. A Drive rename is benign and
      -- routine; it is kept as evidence in the snapshot rather than made into identity,
      -- because blocking on it would train officers to re-preview for no reason. The
      -- conservative consequence is stated rather than papered over: the provider's
      -- documented `version` advances on metadata-only changes too, so a rename CAN
      -- move it and require a fresh preview. That is a re-preview, not a wrong import.
      -- ------------------------------------------------------------------
      --
      -- Read EXACTLY, in three steps that are deliberately separate:
      --
      --   1. the JSON TYPE decides whether there is a coordinate at all, because
      --      `->>` renders a number, a boolean or an array into text that then
      --      satisfies every string check below;
      --   2. the text is taken as it stands, with no `btrim` -- trimming a
      --      padded id into the live id is inventing the agreement this gate
      --      exists to find;
      --   3. a padded value is nulled out into the existing missing-evidence
      --      refusal, so malformed evidence fails closed rather than comparing.
      v_frozen_file_id := CASE
        WHEN jsonb_typeof(v_preview.source_file_metadata -> 'id') = 'string'
          THEN nullif(v_preview.source_file_metadata->>'id', '')
        ELSE NULL
      END;
      IF plugin_data.csf_has_edge_padding(v_frozen_file_id) THEN
        v_frozen_file_id := NULL;
      END IF;
      v_frozen_mime := CASE
        WHEN jsonb_typeof(v_preview.source_file_metadata -> 'mimeType') = 'string'
          THEN nullif(v_preview.source_file_metadata->>'mimeType', '')
        ELSE NULL
      END;
      IF plugin_data.csf_has_edge_padding(v_frozen_mime) THEN
        v_frozen_mime := NULL;
      END IF;
      -- The family the preview STATES it was read under, and the live source
      -- row's own provider, bound to each other.
      --
      -- Correction 4 branched on `v_source.provider` alone, which is the LIVE
      -- row: a preview frozen under one family could be read under another's
      -- rules simply because the row had since been relabelled. The frozen
      -- copy is now required, exactly typed, unpadded, and required to equal
      -- the locked live provider -- and the mapping snapshot's third copy is
      -- bound to this same value further down.
      v_frozen_provider := CASE
        WHEN jsonb_typeof(v_preview.source_file_metadata -> 'sourceProvider') = 'string'
          THEN nullif(v_preview.source_file_metadata->>'sourceProvider', '')
        ELSE NULL
      END;
      IF plugin_data.csf_has_edge_padding(v_frozen_provider) THEN
        v_frozen_provider := NULL;
      END IF;
      IF v_frozen_provider IS NULL
        OR v_frozen_provider IS DISTINCT FROM v_source.provider
      THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        -- Nulled so the family branches below cannot compare against a provider
        -- this preview never stated.
        v_frozen_provider := NULL;
      END IF;

      IF v_frozen_provider IS NULL THEN
        -- Already blocked above. Nothing family-specific can be checked without
        -- a family, and guessing one is what this correction removes.
        NULL;
      ELSIF v_frozen_provider = 'google_sheets' THEN
        -- The frozen native-Sheet coordinates. `headRevisionId` is deliberately not
        -- among them: Drive populates it and content checksums only for binary
        -- content, never for a Docs Editors file, so requiring one here would be an
        -- impossible provider contract rather than a stronger one.
        --
        -- The JSON TYPE is required before the text is, because `->>` erases the
        -- distinction this contract is built on: `jsonb ->> 'version'` renders the
        -- JSON number `58` as the text `58`, which then satisfies every grammar
        -- check below. Drive serializes `version` as a JSON STRING precisely
        -- because an int64 does not survive a double, so a numeric frozen version
        -- is evidence that has already been through one -- and a boolean, object,
        -- array or JSON null is not the coordinate at all. All of them fail closed
        -- here into the same missing-evidence refusal.
        --
        -- The text is NOT trimmed. The canonical grammar below already refuses a
        -- padded version, and trimming one into the grammar would make ` 41 ` and
        -- `41` the same evidence when the contract says they are not.
        v_frozen_version := CASE
          WHEN jsonb_typeof(v_preview.source_file_metadata -> 'version') = 'string'
            THEN nullif(v_preview.source_file_metadata ->> 'version', '')
          ELSE NULL
        END;
        v_frozen_modified_text := CASE
          WHEN jsonb_typeof(v_preview.source_file_metadata -> 'modifiedTime') = 'string'
            THEN nullif(v_preview.source_file_metadata->>'modifiedTime', '')
          ELSE NULL
        END;
        -- Provider text inside an immutable jsonb column, so it is shape-checked
        -- and then parsed defensively.
        --
        -- The shape comes FIRST because the cast is not a clock: PostgreSQL reads
        -- `2026-07-01T24:00:00Z` as the next day's midnight and `:60` as the next
        -- minute, so an hour that does not exist would have become the instant
        -- beside it and then compared equal to a `source_modified_at` holding
        -- that neighbour. The cast still runs, and still catches what only a
        -- calendar can -- February 30, a non-leap February 29, April 31 -- and it
        -- stays wrapped so a malformed value is MISSING evidence rather than a
        -- cast error escaping this STABLE function to the caller.
        --
        -- The shape now also decides PRECISION. `timestamptz` retains
        -- microseconds, so a frozen `.123456789Z` cast into it silently loses
        -- its last three digits and then compares EQUAL to a stored instant it
        -- does not name. A nine-digit fraction whose sub-microsecond digits are
        -- not all zero is therefore refused before the cast rather than
        -- truncated through it -- the same fail-closed reading the TypeScript
        -- boundary applies, and the one this schema can honestly support.
        v_frozen_modified_at := NULL;
        IF v_frozen_modified_text IS NOT NULL
          AND v_frozen_modified_text ~ c_drive_instant
          AND coalesce(
            (regexp_match(v_frozen_modified_text, c_drive_nanos))[1], '000'
          ) = '000'
        THEN
          BEGIN
            v_frozen_modified_at := v_frozen_modified_text::timestamptz;
          EXCEPTION WHEN others THEN
            v_frozen_modified_at := NULL;
          END;
        END IF;

        -- The live coordinates. `evidenceRevision` is the source's current
        -- server-read provider version: `csf_refresh_sheet_source_evidence` writes it
        -- from its own Drive read as it issues the receipt, and this function runs
        -- inside the claim AFTER `csf_consume_sheet_source_evidence`, so by the time
        -- it is read the issuer has already persisted it. It is never a
        -- caller-authored value, and it is compared for equality only -- never for
        -- ordering, which is what `evidence_generation` is for.
        --
        -- Typed columns are compared as stored, and the settings key is read with
        -- its JSON type checked first. Neither side is trimmed: a padded live
        -- coordinate is a source whose recorded evidence is malformed, which is a
        -- refusal rather than something to repair into agreement.
        v_live_file_id := nullif(
          coalesce(v_source.drive_file_id, v_source.spreadsheet_id, ''), ''
        );
        IF plugin_data.csf_has_edge_padding(v_live_file_id) THEN
          v_live_file_id := NULL;
        END IF;
        v_live_mime := nullif(coalesce(v_source.drive_mime_type, ''), '');
        IF plugin_data.csf_has_edge_padding(v_live_mime) THEN
          v_live_mime := NULL;
        END IF;
        v_live_revision := CASE
          WHEN jsonb_typeof(v_source.settings -> 'evidenceRevision') = 'string'
            THEN nullif(v_source.settings->>'evidenceRevision', '')
          ELSE NULL
        END;

        -- 1. File identity: the Drive object the preview actually read.
        --
        -- THREE coordinates, not two. The job's own `source_file_id` was only
        -- ever checked for presence, so a preview whose column named one Drive
        -- file while its frozen metadata named another agreed with the live
        -- source and passed -- and the identity chain the receipt later extends
        -- had a link missing at its own end. It is read exactly here, with no
        -- `btrim`, and required to equal the frozen id byte for byte. Only the
        -- Google family: for an uploaded source that column carries legacy path
        -- provenance rather than the staging identity.
        v_job_file_id := nullif(v_preview.source_file_id, '');
        IF plugin_data.csf_has_edge_padding(v_job_file_id) THEN
          v_job_file_id := NULL;
        END IF;
        IF v_frozen_file_id IS NULL OR v_live_file_id IS NULL OR v_job_file_id IS NULL THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_frozen_file_id IS DISTINCT FROM v_live_file_id
          OR v_frozen_file_id IS DISTINCT FROM v_job_file_id
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'This source now points at a different file. Run a fresh preview.');
        END IF;

        -- 2. File kind: exactly the one MIME a native Sheet has, on BOTH sides. The
        -- previous form only rejected two wrong answers by prefix, so a preview that
        -- froze no MIME at all, or froze `application/vnd.google-apps.document`,
        -- passed a check whose whole purpose was to establish what it had read.
        IF v_frozen_mime IS NULL OR v_live_mime IS NULL THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_frozen_mime IS DISTINCT FROM c_sheets_mime
          OR v_live_mime IS DISTINCT FROM c_sheets_mime
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'This source was replaced with a different kind of file. Run a fresh preview.');
        END IF;

        -- 3. Modification time. The job column and the frozen metadata must describe
        -- the same instant, or the preview's own evidence disagrees with itself and
        -- nothing downstream can resolve which one the rows were read under.
        IF v_frozen_modified_at IS NULL
          OR v_preview.source_modified_at IS NULL
          OR v_preview.source_modified_at IS DISTINCT FROM v_frozen_modified_at
          OR v_source.drive_modified_at IS NULL
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_source.drive_modified_at IS DISTINCT FROM v_frozen_modified_at THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'This source changed after it was previewed. Run a fresh preview.');
        END IF;

        -- 4. Provider version: the only coordinate that moves when a Sheet is edited
        -- inside one `modifiedTime` granule. Validated as canonical bounded positive
        -- decimal int64 TEXT and compared as text, so a malformed or overflowing
        -- value is a refusal instead of a cast, and a version past 2^53 can never
        -- compare equal to a neighbour it merely rounds to.
        -- `COLLATE "C"` on purpose: the bound is a comparison of DIGITS, and a
        -- database whose default collation reorders or equates characters would
        -- otherwise decide an int64 ceiling by locale rules that have nothing to
        -- do with numbers.
        IF v_frozen_version IS NULL
          OR v_frozen_version !~ c_version_shape
          OR length(v_frozen_version) > length(c_version_max)
          OR (length(v_frozen_version) = length(c_version_max)
            AND v_frozen_version COLLATE "C" > c_version_max COLLATE "C")
          OR v_live_revision IS NULL
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_live_revision IS DISTINCT FROM v_frozen_version THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'This source changed after it was previewed. Run a fresh preview.');
        END IF;
      ELSIF v_frozen_provider IN ('uploaded_xlsx', 'uploaded_csv') THEN
        -- For an uploaded workbook the immutable identity is the staging generation the
        -- preview claimed, and the freshness evidence is that generation's sha256
        -- content digest, carried in `headRevisionId` because an uploaded workbook is
        -- genuinely binary content and genuinely has one. Drive's `version` semantics
        -- are NOT borrowed here, and nothing below is ever ordered: three digests
        -- either name the same bytes or they do not.
        --
        -- THREE independently sourced values are required, not two:
        --
        --   1. `source_file_metadata->>'headRevisionId'` -- what the PREVIEW froze,
        --      written when the reviewed rows were read;
        --   2. `settings->>'stagingContentHash'` -- what the ATTACHMENT currently
        --      points at, written by `csf_attach_sheet_source_generation`;
        --   3. `settings->>'evidenceRevision'` -- what the RECEIPT ISSUER read under
        --      lock from the staging row, written by
        --      `csf_issue_uploaded_source_evidence` immediately before this claim
        --      consumed the receipt.
        --
        -- Comparing only (1) against (2) was the gap: both are copies of an
        -- attachment, and a source whose recorded digest was rewritten without a
        -- receipt ever being issued for it -- or whose receipt attested to a
        -- different generation entirely -- agreed with itself and passed. (3) is
        -- the only one of the three that a live, locked read of the staged bytes
        -- put there, so requiring it is what makes this gate a statement about
        -- proven bytes rather than about two agreeing memories of them.
        --
        -- All four read exactly: JSON type first, no `btrim`, and no `lower`. The
        -- three digests are canonical LOWERCASE sha256 by contract, so folding an
        -- uppercase one here would manufacture the very equality the three-way
        -- comparison below exists to test.
        v_frozen_revision := CASE
          WHEN jsonb_typeof(v_preview.source_file_metadata -> 'headRevisionId') = 'string'
            THEN nullif(v_preview.source_file_metadata->>'headRevisionId', '')
          ELSE NULL
        END;
        -- The exact MIME this typed provider owns, derived the same way
        -- `csf_issue_uploaded_source_evidence` derives it.
        v_expected_mime := CASE v_frozen_provider
          WHEN 'uploaded_csv' THEN c_csv_mime
          ELSE c_xlsx_mime
        END;
        v_live_file_id := CASE
          WHEN jsonb_typeof(v_source.settings -> 'stagingObjectId') = 'string'
            THEN nullif(v_source.settings->>'stagingObjectId', '')
          ELSE NULL
        END;
        IF plugin_data.csf_has_edge_padding(v_live_file_id) THEN
          v_live_file_id := NULL;
        END IF;
        v_live_revision := CASE
          WHEN jsonb_typeof(v_source.settings -> 'stagingContentHash') = 'string'
            THEN nullif(v_source.settings->>'stagingContentHash', '')
          ELSE NULL
        END;
        v_receipt_revision := CASE
          WHEN jsonb_typeof(v_source.settings -> 'evidenceRevision') = 'string'
            THEN nullif(v_source.settings->>'evidenceRevision', '')
          ELSE NULL
        END;
        -- The frozen staging identity must also BE a canonical staging object
        -- key, not merely equal to whatever the settings happen to hold: an
        -- uppercase or malformed uuid on both sides would otherwise agree with
        -- itself. This is the same grammar the readiness boundary applies.
        IF v_frozen_file_id IS NULL
          OR v_live_file_id IS NULL
          OR v_frozen_file_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_frozen_file_id IS DISTINCT FROM v_live_file_id THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'A newer workbook was uploaded for this source. Run a fresh preview.');
        END IF;
        -- The job's OWN identity column joins the chain for this family too.
        --
        -- It never did before, because the producer wrote the source row's
        -- mutable `uploaded_file_path` there and the column was documented as
        -- carrying "legacy path provenance". It now carries the claimed staging
        -- object, so job id = frozen id = attached id is one exact value or the
        -- preview is refused.
        v_job_file_id := nullif(v_preview.source_file_id, '');
        IF plugin_data.csf_has_edge_padding(v_job_file_id) THEN
          v_job_file_id := NULL;
        END IF;
        IF v_job_file_id IS NULL THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_frozen_file_id IS NOT NULL AND v_job_file_id IS DISTINCT FROM v_frozen_file_id THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'A newer workbook was uploaded for this source. Run a fresh preview.');
        END IF;
        -- The staged GENERATION, on both sides.
        --
        -- The digests say which bytes; the generation says which staged
        -- generation of this source those bytes are, and it is the coordinate
        -- the attachment compare-and-swap advances. Read as an exact JSON
        -- number on the frozen side and as an exact settings string on the live
        -- side, with the digit grammar and the length bound decided BEFORE any
        -- cast so a malformed or oversized value is a bounded blocker rather
        -- than a 22003 raised out of this STABLE function.
        v_frozen_generation := NULL;
        v_frozen_generation_text := CASE
          WHEN jsonb_typeof(v_preview.source_file_metadata -> 'stagingGeneration') = 'number'
            THEN v_preview.source_file_metadata ->> 'stagingGeneration'
          ELSE NULL
        END;
        IF v_frozen_generation_text IS NOT NULL
          AND v_frozen_generation_text ~ '^[1-9][0-9]{0,9}$'
        THEN
          IF v_frozen_generation_text::bigint <= c_mapping_version_max THEN
            v_frozen_generation := v_frozen_generation_text::bigint;
          END IF;
        END IF;
        v_live_generation_text := CASE
          WHEN jsonb_typeof(v_source.settings -> 'stagingGeneration') = 'string'
            THEN nullif(v_source.settings ->> 'stagingGeneration', '')
          WHEN jsonb_typeof(v_source.settings -> 'stagingGeneration') = 'number'
            THEN v_source.settings ->> 'stagingGeneration'
          ELSE NULL
        END;
        IF v_live_generation_text IS NOT NULL
          AND v_live_generation_text !~ '^[1-9][0-9]{0,9}$'
        THEN
          v_live_generation_text := NULL;
        END IF;
        IF v_frozen_generation IS NULL OR v_live_generation_text IS NULL THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_live_generation_text::bigint IS DISTINCT FROM v_frozen_generation THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'A newer workbook was uploaded for this source. Run a fresh preview.');
        END IF;
        -- Ready-time evidence, on all three sides.
        --
        -- The uploaded family previously had NO time coordinate at this gate at
        -- all: the producer wrote the staging `readyAt` into the job's
        -- `source_modified_at` and labelled the frozen copy `modifiedTime`, and
        -- nothing compared either of them with the attachment. Both casts are
        -- guarded, so a malformed timestamp is a refusal rather than an
        -- exception out of this STABLE function.
        v_frozen_ready_at := NULL;
        v_frozen_ready_text := CASE
          WHEN jsonb_typeof(v_preview.source_file_metadata -> 'readyAt') = 'string'
            THEN nullif(v_preview.source_file_metadata ->> 'readyAt', '')
          ELSE NULL
        END;
        IF v_frozen_ready_text IS NOT NULL
          AND NOT plugin_data.csf_has_edge_padding(v_frozen_ready_text)
        THEN
          BEGIN
            v_frozen_ready_at := v_frozen_ready_text::timestamptz;
          EXCEPTION WHEN others THEN
            v_frozen_ready_at := NULL;
          END;
        END IF;
        v_live_ready_at := NULL;
        v_live_ready_text := CASE
          WHEN jsonb_typeof(v_source.settings -> 'stagingReadyAt') = 'string'
            THEN nullif(v_source.settings ->> 'stagingReadyAt', '')
          ELSE NULL
        END;
        IF v_live_ready_text IS NOT NULL
          AND NOT plugin_data.csf_has_edge_padding(v_live_ready_text)
        THEN
          BEGIN
            v_live_ready_at := v_live_ready_text::timestamptz;
          EXCEPTION WHEN others THEN
            v_live_ready_at := NULL;
          END;
        END IF;
        -- A frozen `version` or `modifiedTime` is evidence from the OLD shape,
        -- where the producer manufactured a Drive version from the staging
        -- generation and called the database's `readyAt` a provider modified
        -- time. Their presence means this preview was written under rules it is
        -- no longer being read under, so it fails closed and is re-taken.
        IF v_preview.source_file_metadata ? 'version'
          OR v_preview.source_file_metadata ? 'modifiedTime'
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        END IF;
        IF v_frozen_ready_at IS NULL
          OR v_live_ready_at IS NULL
          OR v_preview.source_modified_at IS NULL
          OR v_preview.source_modified_at IS DISTINCT FROM v_frozen_ready_at
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_live_ready_at IS DISTINCT FROM v_frozen_ready_at THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'A newer workbook was uploaded for this source. Run a fresh preview.');
        END IF;
        -- The FOURTH independently sourced digest: the job's own record of the
        -- bytes it read.
        --
        -- Three digests that are all copies of an attachment or a receipt can
        -- agree with each other while the preview's own column names different
        -- bytes entirely, and nothing refused that -- `source_content_hash` was
        -- only ever shape-checked, several hundred lines further down, against a
        -- job whose frozen digest was never compared with it. Read exactly here,
        -- with no `btrim` and no `lower`. `snapshot_hash` is deliberately NOT
        -- part of this: it digests the normalized snapshot rather than the
        -- uploaded bytes, so binding it would be a false equality.
        v_job_content_hash := nullif(v_preview.source_content_hash, '');
        -- Each of the four must EXIST and must be a canonical lowercase sha256
        -- hex string. A missing one is a comparison switched off; a malformed one
        -- is a value nothing can attribute to any bytes. Both are refusals, and
        -- neither may raise: this is all regex and text equality, with no cast to
        -- any type, so no malformed settings value escapes this STABLE function.
        IF v_frozen_revision IS NULL
          OR v_live_revision IS NULL
          OR v_receipt_revision IS NULL
          OR v_job_content_hash IS NULL
          OR v_frozen_revision !~ c_sha256_shape
          OR v_live_revision !~ c_sha256_shape
          OR v_receipt_revision !~ c_sha256_shape
          OR v_job_content_hash !~ c_sha256_shape
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        -- Any disagreement at all, in any direction. Equality only: an uploaded
        -- digest is content-addressed, so "newer" is not a property it has.
        ELSIF v_frozen_revision IS DISTINCT FROM v_live_revision
          OR v_frozen_revision IS DISTINCT FROM v_receipt_revision
          OR v_frozen_revision IS DISTINCT FROM v_job_content_hash
          OR v_live_revision IS DISTINCT FROM v_receipt_revision
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'A newer workbook was uploaded for this source. Run a fresh preview.');
        END IF;
        -- The frozen MIME must EXIST and must be exactly the one this provider owns.
        -- Rejecting only `application/vnd.google-apps%` was a check on one wrong
        -- answer rather than a check for the right one: a preview that froze no MIME,
        -- or `application/pdf`, or `text/csv` for a source registered as
        -- `uploaded_xlsx`, all fell through it -- and a CSV parser and an XLSX parser
        -- read the same bytes differently, so crossing them is not cosmetic.
        IF v_frozen_mime IS NULL THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_frozen_mime IS DISTINCT FROM v_expected_mime THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'This source was replaced with a different kind of file. Run a fresh preview.');
        END IF;
      ELSE
        -- An unrecognised provider is not a provider this contract can reason about.
        v_blockers := pg_catalog.array_append(v_blockers, 'Reconnect the source file before importing.');
      END IF;
    END IF;
  END IF;
  IF v_preview.status NOT IN ('completed', 'needs_resolution') THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Wait for a completed preview before importing records.');
  END IF;
  IF v_preview.snapshot_contract_version IS DISTINCT FROM c_contract THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import uses the current normalized snapshot.');
  END IF;
  IF coalesce(v_preview.source_content_hash, '') !~ '^[0-9a-f]{64}$'
    OR coalesce(v_preview.snapshot_hash, '') !~ '^[0-9a-f]{64}$'
  THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records a complete normalized snapshot.');
  END IF;
  IF v_preview.snapshot_row_count IS NULL OR v_preview.snapshot_row_count < 1 THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records a complete normalized snapshot.');
  END IF;
  IF v_preview.mapping_version IS NULL OR v_preview.mapping_version < 1
    OR jsonb_typeof(coalesce(v_preview.mapping_snapshot, 'null'::jsonb)) <> 'object'
  THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Inspect and map the selected columns again.');
  ELSE
    -- The snapshot's own record of WHICH import it belongs to.
    --
    -- Rewritten as NESTED CONTROL FLOW rather than one long `OR` chain. SQL
    -- does not promise left-to-right short-circuit evaluation of `OR`, so a
    -- chain whose earlier terms are the JSON-type and digit-grammar guards and
    -- whose later terms hold `::bigint` was only accidentally safe: the planner
    -- is free to evaluate the cast first, and a fractional, oversized or
    -- otherwise malformed value then raises invalid_text_representation or
    -- 22003 out of a STABLE readiness function instead of returning a blocker.
    -- Each cast below is reached only after its own guard has already run.
    --
    -- The coordinates are also REQUIRED and typed, on both sides: `->>` renders
    -- the JSON string "3" and the JSON number 3 as the same text, and btrimming
    -- ` a-file ` into agreement with the job's typed column is the same
    -- fail-open normalization the frozen coordinates above are read to avoid.
    -- The repeated coordinate never overrides the job; it is only ever required
    -- to agree with it.
    v_mapping_ok := true;
    IF jsonb_typeof(v_preview.mapping_snapshot -> 'version') <> 'number' THEN
      v_mapping_ok := false;
    ELSE
      v_mapping_version_text := v_preview.mapping_snapshot ->> 'version';
      -- Shape first, then LENGTH, then the cast. The digit shape refuses a
      -- fractional, signed, zero or leading-zero value, and `{1,10}` bounds the
      -- digit COUNT so nothing wider than an int64 ever reaches `::bigint`.
      IF v_mapping_version_text IS NULL
        OR v_mapping_version_text !~ '^[1-9][0-9]{0,9}$'
      THEN
        v_mapping_ok := false;
      ELSIF v_mapping_version_text::bigint > c_mapping_version_max THEN
        v_mapping_ok := false;
      ELSIF v_mapping_version_text::bigint
        IS DISTINCT FROM v_preview.mapping_version::bigint
      THEN
        v_mapping_ok := false;
      END IF;
    END IF;

    IF v_mapping_ok THEN
      v_mapping_source_type := CASE
        WHEN jsonb_typeof(v_preview.mapping_snapshot -> 'sourceType') = 'string'
          THEN nullif(v_preview.mapping_snapshot ->> 'sourceType', '')
        ELSE NULL
      END;
      IF v_mapping_source_type IS NULL
        OR plugin_data.csf_has_edge_padding(v_mapping_source_type)
        OR v_mapping_source_type IS DISTINCT FROM v_preview.source_type
      THEN
        v_mapping_ok := false;
      END IF;
    END IF;

    IF v_mapping_ok THEN
      v_mapping_file_id := CASE
        WHEN jsonb_typeof(v_preview.mapping_snapshot -> 'sourceFileId') = 'string'
          THEN nullif(v_preview.mapping_snapshot ->> 'sourceFileId', '')
        ELSE NULL
      END;
      IF v_mapping_file_id IS NULL
        OR plugin_data.csf_has_edge_padding(v_mapping_file_id)
        OR v_mapping_file_id IS DISTINCT FROM nullif(v_preview.source_file_id, '')
      THEN
        v_mapping_ok := false;
      END IF;
    END IF;

    -- The provider the mapping was authored under. Required here as well as in
    -- the frozen metadata, and required to equal it: the frozen copy is what
    -- selects the evidence rules above, so a mapping that names a different
    -- family is a mapping for an import read under different rules entirely.
    IF v_mapping_ok THEN
      v_mapping_provider := CASE
        WHEN jsonb_typeof(v_preview.mapping_snapshot -> 'sourceProvider') = 'string'
          THEN nullif(v_preview.mapping_snapshot ->> 'sourceProvider', '')
        ELSE NULL
      END;
      IF v_mapping_provider IS NULL
        OR plugin_data.csf_has_edge_padding(v_mapping_provider)
        OR v_frozen_provider IS NULL
        OR v_mapping_provider IS DISTINCT FROM v_frozen_provider
      THEN
        v_mapping_ok := false;
      END IF;
    END IF;

    IF NOT v_mapping_ok THEN
      v_blockers := pg_catalog.array_append(v_blockers, 'Inspect and map the selected columns again.');
    END IF;
  END IF;

  -- Structured tabs are the sole range authority.
  --
  -- `source_range` is deliberately NOT parsed. It is a single-tab display field,
  -- and splitting it on commas mangles a tab legitimately named `Fall, 2025` into
  -- two meaningless fragments that a reader cannot distinguish from a genuine
  -- two-tab import. `used-range` names no cells and can never be provenance.
  -- The snapshot must also agree with the job it belongs to. A mapping that names a
  -- different source type or a different provider file is a mapping for some other
  -- import; committing it would apply one workbook's column decisions to another's
  -- rows.
  -- The shape check is in its own control flow, not a term of the same boolean.
  --
  -- `v_tabs IS NULL OR jsonb_typeof(v_tabs) <> 'array' OR jsonb_array_length(v_tabs) = 0`
  -- reads as safe, but SQL does not promise left-to-right short-circuit evaluation of
  -- OR, so the planner is free to evaluate `jsonb_array_length` on a scalar or object
  -- and raise from inside a STABLE readiness function. A malformed mapping must be a
  -- named blocker, never an exception.
  v_tabs := v_preview.mapping_snapshot -> 'tabs';
  IF v_tabs IS NULL OR jsonb_typeof(v_tabs) <> 'array' THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Select at least one exact Sheet tab and range.');
  ELSIF jsonb_array_length(v_tabs) = 0 THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Select at least one exact Sheet tab and range.');
  ELSE
    FOR v_tab IN SELECT jsonb_array_elements(v_tabs)
    LOOP
      IF jsonb_typeof(v_tab) <> 'object' THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'Select at least one exact Sheet tab and range.');
        EXIT;
      END IF;
      -- Read EXACTLY: the JSON type first, then the text as it stands. `btrim`
      -- ran on both the tab name and the range, which repaired a padded tab into
      -- one that then matched a qualifier, a duplicate, and a row coordinate it
      -- is not equal to -- and it returned the repaired value as though the
      -- snapshot had held it.
      v_tab_name := CASE
        WHEN jsonb_typeof(v_tab -> 'tabName') = 'string'
          THEN nullif(v_tab->>'tabName', '')
        ELSE NULL
      END;
      IF v_tab_name IS NULL OR plugin_data.csf_has_edge_padding(v_tab_name) THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'Select an exact Sheet tab.');
        EXIT;
      END IF;
      IF v_tab_names ? v_tab_name THEN
        v_blockers := pg_catalog.array_append(v_blockers, format('The %s tab is mapped more than once.', v_tab_name));
        EXIT;
      END IF;
      v_tab_names := v_tab_names || jsonb_build_object(v_tab_name, true);

      v_range := CASE
        WHEN jsonb_typeof(v_tab -> 'range') = 'string'
          THEN nullif(v_tab->>'range', '')
        ELSE NULL
      END;
      v_range_ok := v_range IS NOT NULL AND NOT plugin_data.csf_has_edge_padding(v_range);
      -- Case-insensitive MATCH rather than a folded value: the sentinel is
      -- searched for, and nothing about the range is rewritten to find it.
      IF v_range_ok AND v_range ~* c_used_range THEN
        v_range_ok := false;
      END IF;

      -- The qualifier, decoded and BOUND to this entry's own tab.
      --
      -- `''` is one literal quote inside a quoted sheet name; an unquoted
      -- qualifier is taken exactly as written and may contain no quote at all,
      -- which is why `"Tab B"!A1:B2` fails: the double quotes are two literal
      -- characters of a sheet name, so the decoded qualifier is `"Tab B"` and it
      -- is not the tab this entry was filed under. Nothing is folded or trimmed
      -- into agreement, in either direction.
      v_qualifier := NULL;
      v_block := NULL;
      IF v_range_ok THEN
        v_parts := regexp_match(v_range, c_a1_quoted);
        IF v_parts IS NOT NULL THEN
          v_qualifier := replace(v_parts[1], '''''', '''');
          v_block := v_parts[2];
          IF v_qualifier = '' THEN
            v_range_ok := false;
          END IF;
        ELSE
          v_parts := regexp_match(v_range, c_a1_unquoted);
          IF v_parts IS NOT NULL THEN
            v_qualifier := v_parts[1];
            v_block := v_parts[2];
          ELSIF strpos(v_range, '!') > 0 THEN
            -- A separator with no readable qualifier in front of it.
            v_range_ok := false;
          ELSE
            -- Unqualified: the block is read under this entry's own tab.
            v_block := v_range;
          END IF;
        END IF;
      END IF;
      IF v_range_ok AND v_qualifier IS NOT NULL AND v_qualifier IS DISTINCT FROM v_tab_name THEN
        v_range_ok := false;
      END IF;

      -- One finite rectangle, with its endpoints in the order they are written.
      IF v_range_ok THEN
        v_parts := regexp_match(v_block, c_a1_block);
        v_range_ok := v_parts IS NOT NULL;
      END IF;
      IF v_range_ok THEN
        -- Columns order as (length, uppercase text) under the C collation, which
        -- IS base-26 numeric order for a one-to-three-letter column and needs no
        -- arithmetic: with no leading "zero" letter a shorter column is the
        -- smaller one, and equal lengths compare lexicographically in numeric
        -- order. `{1,3}` is itself the `ZZZ` bound. `upper` here converts a
        -- numeral rather than folding a compared coordinate -- the sheet name
        -- above is never touched this way.
        IF length(v_parts[1]) > length(v_parts[3])
          OR (length(v_parts[1]) = length(v_parts[3])
            AND upper(v_parts[1]) COLLATE "C" > upper(v_parts[3]) COLLATE "C")
        THEN
          v_range_ok := false;
        -- Rows are bounded on the DIGIT COUNT before any cast, so an
        -- arbitrarily long integer never reaches `::bigint`. The bound and the
        -- cast are in SEPARATE nested branches rather than two arms of one
        -- `ELSIF` chain: an `ELSIF` arm is a single Boolean expression whose
        -- terms SQL may evaluate in any order, so putting the digit-count guard
        -- and the cast in one expression left the cast free to run first and
        -- raise 22003 out of this STABLE function.
        ELSIF length(v_parts[2]) > c_a1_max_row_digits
          OR length(v_parts[4]) > c_a1_max_row_digits
        THEN
          v_range_ok := false;
        ELSE
          IF v_parts[2]::bigint > c_a1_max_row THEN
            v_range_ok := false;
          ELSIF v_parts[4]::bigint > c_a1_max_row THEN
            v_range_ok := false;
          ELSIF v_parts[2]::bigint > v_parts[4]::bigint THEN
            v_range_ok := false;
          END IF;
        END IF;
      END IF;
      IF NOT v_range_ok THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'Select an exact Sheet range.');
        EXIT;
      END IF;

      -- The header row is a JSON NUMBER, not text that merely renders like one:
      -- `->>` turns the JSON string "1" into the text 1, which satisfied the
      -- previous grammar exactly as a genuine number would. Bounded to the same
      -- row space the range is.
      --
      -- Type, then digit grammar, then the cast -- each in its own branch, so
      -- the cast is REACHED only after the two guards that make it total have
      -- already run. As one `OR` chain the planner could evaluate the cast
      -- first, and a fractional or oversized header row raised out of a STABLE
      -- function instead of returning this blocker.
      v_header_ok := jsonb_typeof(v_tab -> 'headerRow') = 'number';
      IF v_header_ok THEN
        v_header_row_text := v_tab ->> 'headerRow';
        IF v_header_row_text IS NULL OR v_header_row_text !~ '^[1-9][0-9]{0,7}$' THEN
          v_header_ok := false;
        ELSIF v_header_row_text::bigint > c_a1_max_row THEN
          v_header_ok := false;
        END IF;
      END IF;
      IF NOT v_header_ok THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'Choose the header row for every selected tab.');
        EXIT;
      END IF;
    END LOOP;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE import_status = 'pending'),
    count(*) FILTER (WHERE import_status IN ('ambiguous', 'conflict', 'duplicate')),
    count(*) FILTER (WHERE commit_outcome_unresolved),
    count(*) FILTER (WHERE commit_outcome_state = 'in_flight'),
    count(*) FILTER (WHERE import_status = 'pending' AND cohort_id IS NULL),
    count(*) FILTER (
      WHERE import_status = 'pending'
        AND term_id IS NULL
        -- A roster row genuinely has no semester; the other two central sources do.
        AND v_preview.source_type IN ('application_responses', 'class_history')
    )
  INTO v_total, v_pending, v_unresolved, v_unknown, v_in_flight,
       v_missing_cohort, v_missing_term
  FROM plugin_data.csf_sheet_import_rows
  WHERE organization_id = p_organization_id
    AND job_id = p_preview_job_id;

  -- The freeze copies each row's class and semester as part of the reviewed decision,
  -- so a row that never resolved one cannot be frozen coherently. Counted here, at
  -- the gate, rather than discovered halfway through a freeze.
  IF v_missing_cohort > 0 THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Resolve the class for every ready row.');
  END IF;
  IF v_missing_term > 0 THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Resolve the semester for every ready row.');
  END IF;
  IF v_in_flight > 0 THEN
    v_blockers := pg_catalog.array_append(v_blockers, format('%s row(s) are still recorded in flight and need recovery review first.', v_in_flight));
  END IF;

  IF v_preview.snapshot_row_count IS NOT NULL AND v_total <> v_preview.snapshot_row_count THEN
    v_blockers := pg_catalog.array_append(v_blockers, format('This preview stores %s of the %s reviewed rows.', v_total, v_preview.snapshot_row_count));
  END IF;
  IF v_pending = 0 THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'No ready rows remain in this preview.');
  END IF;
  IF v_unresolved > 0 THEN
    v_blockers := pg_catalog.array_append(v_blockers, format('Reconcile %s conflicting row(s) before importing.', v_unresolved));
  END IF;
  IF v_unknown > 0 THEN
    v_blockers := pg_catalog.array_append(v_blockers, format('%s row(s) have an unresolved import outcome and must be reconciled first.', v_unknown));
  END IF;

  RETURN v_blockers;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_import_preview_claim_blockers(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_preview_claim_blockers(uuid, uuid) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_import_preview_claim_blockers(uuid, uuid) IS
  'The authoritative readiness superset, evaluated inside csf_claim_import_commit_attempt after the source receipt has been consumed. Every frozen and live coordinate is read EXACTLY: the JSON type is required before ->> is trusted, nothing is btrimmed into validity or into equality, and nothing is lowercased into a canonical digest -- a padded, wrong-type or case-folded value is malformed evidence and yields the same fresh-preview refusal a missing one does, because trimming a coordinate into agreement invents the agreement this gate exists to find. Provider-aware and fail-closed on source evidence: for google_sheets it requires the job''s own source_file_id, the frozen file id and the live Drive id to be one exact unpadded value -- the job column was previously only checked for presence, so a preview naming one file in its column and another in its metadata passed -- a frozen mimeType of exactly application/vnd.google-apps.spreadsheet, a frozen modifiedTime matching the provider''s OWN output spelling (UTC Z form, hour 00-23, minute and second 00-59, a fractional part of exactly 0, 3, 6 or 9 digits, no numeric offset, no -00:00, no padding and no trailing prose) whose sub-microsecond digits must be zero -- timestamptz retains microseconds, so a nonzero nanosecond would be silently truncated into an equality it does not name and is refused before the cast instead -- and whose guarded timestamptz cast then also refuses an impossible calendar date such as February 30, a non-leap February 29 or April 31, and that agrees with the job''s own source_modified_at, and a frozen version that is a JSON STRING -- jsonb_typeof(source_file_metadata -> ''version'') = ''string'' is required before the text is read, because ->> renders the JSON number 58 as the text 58 and would satisfy the grammar -- holding canonical bounded positive decimal int64 TEXT, then requires the live drive_file_id/spreadsheet_id, the exact live drive_mime_type, a live drive_modified_at, and the current server-issued settings->>''evidenceRevision'', and compares all four coordinates exactly. headRevisionId is NOT a Google coordinate: Drive populates it and content checksums only for binary content, never for a Docs Editors file. For uploaded_xlsx/uploaded_csv the identity is the staging object id and the freshness evidence is FOUR independently sourced canonical lowercase sha256 hex digests that must all exist and all be equal: the preview''s frozen headRevisionId, the job''s own source_content_hash, the attachment''s settings->>''stagingContentHash'', and the receipt-written settings->>''evidenceRevision'' that csf_issue_uploaded_source_evidence persisted from a locked read of the staged bytes immediately before this claim consumed the receipt. snapshot_hash is deliberately NOT among them: it digests the normalized snapshot rather than the uploaded bytes, so binding it would be a false equality. A frozen mimeType must also exist and equal exactly the MIME the typed provider owns -- the same pairing csf_issue_uploaded_source_evidence enforces. settings->>''evidenceRevision'' is a single compatibility key with two provider meanings: the exact Drive version string for a Google source, written by csf_refresh_sheet_source_evidence, and the sha256 content digest for an uploaded source, written by csf_issue_uploaded_source_evidence. It is compared for EQUALITY only and never for ordering, in both families; ordering between two provider reads is decided solely by the evidence_generation compare-and-set. Missing or malformed evidence yields a fresh-preview blocker, a disagreement yields a changed/replaced-source blocker, and no malformed json, timestamp, digest or version text may raise a cast error out of this STABLE function. Padding is detected with an explicit locale-INDEPENDENT class covering Unicode White_Space plus general categories Cc and Cf -- [[:space:]] is a locale class that does not match U+0085, U+00A0 or U+200B, so a coordinate padded with one of those was read as exact here while the TypeScript boundary refused it; U+0000 cannot appear in PostgreSQL text and is refused by the json/text input boundary before this function is reached. The mapping snapshot''s version, sourceType and sourceFileId are REQUIRED, exactly typed and bound to the job''s own columns -- all three were optional and two were type-erased, so an absent, stringly-typed, fractional or unequal mapping generation passed. Each mapped range is PARSED rather than shape-matched: an unqualified block is read under its entry''s own tabName, a qualified one must decode (single-quote quoting, '''' as one literal quote) to that tabName byte for byte, both endpoints are required, start column <= end column and start row <= end row, columns are bounded at ZZZ by the one-to-three-letter shape and rows at 10,000,000 on the DIGIT COUNT before any cast, and headerRow must be a JSON number in the same row space. The display name is never compared: a rename is provenance, not identity.';

-- ---------------------------------------------------------------------------
-- Freezing the authoritative decision.
--
-- Runs once, inside the first claim, under the coordinate lock with every preview
-- row already locked in stable order. A takeover does not re-freeze: it validates
-- that the existing freeze still describes the preview it is about to commit and
-- reuses it. Re-copying on takeover would be the bug this whole mechanism exists to
-- prevent -- the second worker would snapshot whatever the preview looks like *now*,
-- including any match an officer changed in between, and commit that under the
-- first officer's review.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_freeze_import_commit_decision(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_commit_job_id uuid,
  p_actor_user_id uuid,
  p_actor_snapshot jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_payload jsonb;
  v_frozen integer := 0;
  v_basis text;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF preview job was not found.' USING ERRCODE = '23503';
  END IF;

  -- One deterministic pass, in exactly the order the coordinate lock walked.
  FOR v_row IN
    SELECT *
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = p_preview_job_id
      AND import_row.import_status = 'pending'
      AND import_row.commit_frozen_at IS NULL
    ORDER BY import_row.sheet_tab_name, import_row.row_number, import_row.id
  LOOP
    v_payload := v_row.normalized_data -> 'commitPayload';
    IF v_payload IS NULL OR jsonb_typeof(v_payload) <> 'object' THEN
      RAISE EXCEPTION
        'This preview row carries no commit payload. Run a fresh preview before importing.'
        USING ERRCODE = '23514';
    END IF;
    IF v_row.row_hash IS NULL OR v_row.row_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION
        'This preview row has no digest, so its content cannot be frozen. Run a fresh preview.'
        USING ERRCODE = '23514';
    END IF;
    -- Named explicitly rather than left to the all-or-none freeze constraint, so a
    -- preview row that lost its source produces a diagnosis instead of an opaque
    -- check violation.
    IF v_row.source_id IS NULL OR v_row.cohort_id IS NULL THEN
      RAISE EXCEPTION
        'This preview row is missing its source or class and cannot be frozen. Run a fresh preview.'
        USING ERRCODE = '23514';
    END IF;
    -- The semester is as much part of the reviewed decision as the class. Rejecting it
    -- only later, inside the wrapper, meant a commit could freeze rows it would then
    -- refuse one at a time -- so the officer saw a half-committed import instead of a
    -- gate that never opened.
    IF v_row.term_id IS NULL
      AND v_preview.source_type IN ('application_responses', 'class_history')
    THEN
      RAISE EXCEPTION
        'This preview row is missing its semester and cannot be frozen. Resolve it before importing.'
        USING ERRCODE = '23514';
    END IF;

    -- How the target was arrived at, recorded rather than inferred later. The
    -- action layer only leaves an application row `pending` with a match when that
    -- match was a single exact normalized-address candidate; anything ambiguous is
    -- held out of `pending` entirely and never reaches this loop.
    v_basis := CASE
      WHEN v_row.resolution_status = 'resolved' AND v_row.resolved_by IS NOT NULL
        THEN 'officer_resolved'
      WHEN v_row.matched_profile_id IS NOT NULL THEN 'preview_exact_match'
      ELSE 'unmatched'
    END;

    UPDATE plugin_data.csf_sheet_import_rows
    SET commit_frozen_at = v_now,
        commit_frozen_by_job_id = p_commit_job_id,
        commit_frozen_row_hash = v_row.row_hash,
        commit_frozen_source_id = v_row.source_id,
        commit_frozen_source_revision = v_preview.source_content_hash,
        commit_frozen_payload_hash = encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex'),
        commit_frozen_actor_user_id = p_actor_user_id,
        commit_frozen_actor_snapshot = coalesce(p_actor_snapshot, '{}'::jsonb),
        commit_target_profile_id = v_row.matched_profile_id,
        commit_resolution_snapshot = jsonb_build_object(
          'basis', v_basis,
          'resolutionStatus', v_row.resolution_status,
          'resolutionReasonCode', v_row.resolution_reason_code,
          'resolvedBy', v_row.resolved_by,
          'resolvedAt', v_row.resolved_at,
          'matchedApplicationId', v_row.matched_application_id,
          'previewMappingVersion', v_row.mapping_version,
          'sheetTabName', v_row.sheet_tab_name,
          'rowNumber', v_row.row_number
        ),
        commit_outcome_state = 'frozen'
    WHERE id = v_row.id;
    v_frozen := v_frozen + 1;
  END LOOP;

  RETURN v_frozen;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_freeze_import_commit_decision(uuid, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
-- Internal: only the claim RPC may freeze a decision.

-- ---------------------------------------------------------------------------
-- Claim, heartbeat, assert.
-- ---------------------------------------------------------------------------

-- The claim, with source evidence consumed in the SAME transaction.
--
-- Wave 3 issued a single-use token from `csf_refresh_sheet_source_evidence` and
-- spent it from TypeScript, in a transaction of its own, immediately before
-- calling this function. Two things were wrong with that. A caller could skip
-- the consume entirely and claim anyway -- the claim never asked for a token --
-- and a crash between the two calls burned a token without producing a claim,
-- so the officer had to re-read the source to try again.
--
-- Here the token is an argument and is consumed inside the same transaction
-- that freezes the rows and opens the attempt. One token succeeds exactly once;
-- a replay, a token for another actor/source/preview/provider/generation, an
-- expired token, and a token superseded by a competing refresh all fail with
-- nothing claimed and nothing burned.
--
-- `p_evidence_token` carries NO default, and the consume has no null-tolerant
-- branch. That matters most for the source family that has no provider to call:
-- an uploaded workbook's receipt comes from
-- `csf_issue_uploaded_source_evidence`, which reads the staged generation under
-- lock, rather than from a relaxation of this argument. A `NULL` here is a
-- refusal for every provider.
--
-- The consume runs BEFORE the readiness gate below on purpose. Both are in this
-- one transaction, so a preview that fails readiness rolls the consumption back
-- with everything else and the receipt is still spendable; ordering it the other
-- way would buy nothing and would let a readiness check run on a source nothing
-- had yet proved current.
CREATE OR REPLACE FUNCTION plugin_data.csf_claim_import_commit_attempt(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_actor_user_id uuid,
  p_lease_seconds integer,
  p_evidence_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_active plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_blockers text[];
  v_unknown integer;
  v_in_flight integer;
  v_attempt_id uuid;
  v_attempt_number integer;
  v_correlation uuid;
  v_resumed boolean := false;
  v_lease timestamptz;
  v_actor_snapshot jsonb;
  v_frozen integer := 0;
  v_drifted integer;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'CSF commit lease must be between 30 and 3600 seconds.'
      USING ERRCODE = '22023';
  END IF;

  -- The CURRENT claimant is authorized here, every time -- first claim, retry and
  -- takeover alike. A takeover must never inherit the original officer's
  -- authority: that is precisely how a withdrawn capability would be laundered
  -- through an attempt somebody else opened.
  PERFORM plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, p_actor_user_id, p_preview_job_id
  );

  -- The canonical order, taken once, before anything is read for decisions. Rows are
  -- included because the freeze below walks every one of them.
  PERFORM plugin_data.csf_lock_import_commit_coordinate(
    p_organization_id, p_preview_job_id, true
  );

  SELECT * INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF preview job was not found.' USING ERRCODE = '23503';
  END IF;
  IF v_preview.source_type NOT IN ('application_responses', 'student_roster', 'class_history') THEN
    RAISE EXCEPTION
      'Attendance and partner-club imports commit as one batch and have no commit attempts.'
      USING ERRCODE = '23514';
  END IF;

  -- Live provider evidence, spent here rather than in a prior transaction. This
  -- runs for a first claim, a retry, a takeover and a finalize-only resume
  -- alike: a finalize that writes no rows still writes under this source's
  -- provenance, so it is held to the same freshness proof.
  PERFORM plugin_data.csf_consume_sheet_source_evidence(
    p_organization_id, v_preview.source_id, p_actor_user_id,
    p_evidence_token, p_preview_job_id
  );

  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.organization_id = p_organization_id
    AND commit_job.mode = 'commit'
    AND commit_job.preview_job_id = p_preview_job_id;

  IF NOT FOUND THEN
    -- Creating the logical commit is the gated act. Everything the readiness
    -- contract requires must hold before it exists at all.
    v_blockers := plugin_data.csf_import_preview_claim_blockers(p_organization_id, p_preview_job_id);
    IF array_length(v_blockers, 1) > 0 THEN
      RAISE EXCEPTION 'Preview is not ready to commit. %', v_blockers[1]
        USING ERRCODE = '23514';
    END IF;

    v_actor_snapshot := jsonb_build_object(
      'actorUserId', p_actor_user_id,
      'claimedAt', now(),
      'previewJobId', p_preview_job_id,
      'snapshotHash', v_preview.snapshot_hash
    );

    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id, source_id, initiated_by, mode, status, source_type,
      source_file_id, source_file_name, source_sheet_tab, source_range,
      source_modified_at, source_file_metadata, mapping_snapshot, mapping_version,
      preview_job_id, source_content_hash, snapshot_hash, snapshot_row_count,
      snapshot_contract_version, summary, started_at,
      commit_actor_user_id, commit_actor_snapshot
    ) VALUES (
      p_organization_id, v_preview.source_id, p_actor_user_id, 'commit', 'running',
      v_preview.source_type, v_preview.source_file_id, v_preview.source_file_name,
      v_preview.source_sheet_tab, v_preview.source_range, v_preview.source_modified_at,
      v_preview.source_file_metadata, v_preview.mapping_snapshot, v_preview.mapping_version,
      p_preview_job_id, v_preview.source_content_hash, v_preview.snapshot_hash,
      v_preview.snapshot_row_count, v_preview.snapshot_contract_version,
      jsonb_build_object('previewJobId', p_preview_job_id), now(),
      p_actor_user_id, v_actor_snapshot
    ) RETURNING * INTO v_commit;

    -- Freeze on the first logical claim, never later.
    v_frozen := plugin_data.csf_freeze_import_commit_decision(
      p_organization_id, p_preview_job_id, v_commit.id, p_actor_user_id, v_actor_snapshot
    );
  ELSE
    v_resumed := true;
    IF v_commit.status = 'completed' THEN
      RAISE EXCEPTION 'This CSF preview has already been imported.' USING ERRCODE = '55000';
    END IF;
    IF v_commit.status = 'cancelled' THEN
      RAISE EXCEPTION 'This CSF import was cancelled; run a fresh preview.' USING ERRCODE = '55000';
    END IF;

    -- An unresolved authoritative outcome must be reconciled before another
    -- attempt may run, or the next attempt would write on top of an unknown.
    SELECT
      count(*) FILTER (WHERE commit_outcome_state IN ('unknown', 'historical_unknown')),
      count(*) FILTER (WHERE commit_outcome_state = 'in_flight')
    INTO v_unknown, v_in_flight
    FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id = p_organization_id
      AND job_id = p_preview_job_id;

    IF v_unknown > 0 THEN
      RAISE EXCEPTION
        '% row(s) have an unresolved import outcome and must be reconciled before this import can resume.',
        v_unknown USING ERRCODE = '23514';
    END IF;
    -- A row still marked in flight means the previous attempt recorded a begin-intent
    -- and never came back with a trustworthy result. Taking over on top of that would
    -- be exactly the blind retry this design exists to prevent, so the takeover is
    -- refused until the abort or the reconciliation path has settled it.
    IF v_in_flight > 0 THEN
      RAISE EXCEPTION
        '% row(s) are still recorded in flight from the previous attempt and must be reconciled before this import can resume.',
        v_in_flight USING ERRCODE = '23514';
    END IF;

    SELECT * INTO v_active
    FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    WHERE attempt.commit_job_id = v_commit.id
      AND attempt.status = 'running';

    IF FOUND THEN
      IF v_active.lease_expires_at > now() THEN
        RAISE EXCEPTION 'This CSF preview is already being committed by another officer.'
          USING ERRCODE = '55P03';
      END IF;
      UPDATE plugin_data.csf_sheet_import_commit_attempts
      SET status = 'superseded',
          lease_expires_at = NULL,
          completed_at = now(),
          failure_reason = 'lease_expired_taken_over'
      WHERE id = v_active.id;
    END IF;

    -- Takeover validates and reuses the existing freeze. It never re-copies one.
    --
    -- Anything still pending without a freeze, or with a freeze that no longer
    -- describes the row it is attached to, means the preview moved underneath a
    -- decision an officer already approved. That is a stop, not something to
    -- silently re-snapshot.
    SELECT count(*) INTO v_drifted
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = p_preview_job_id
      AND import_row.import_status = 'pending'
      AND (
        import_row.commit_frozen_at IS NULL
        OR import_row.commit_frozen_by_job_id IS DISTINCT FROM v_commit.id
        OR import_row.commit_frozen_row_hash IS DISTINCT FROM import_row.row_hash
        OR import_row.commit_target_profile_id IS DISTINCT FROM import_row.matched_profile_id
      );
    IF v_drifted > 0 THEN
      RAISE EXCEPTION
        '% row(s) no longer match the reviewed decision this import froze. Run a fresh preview.',
        v_drifted USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT coalesce(max(attempt.attempt_number), 0) + 1
  INTO v_attempt_number
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  WHERE attempt.commit_job_id = v_commit.id;

  v_lease := now() + make_interval(secs => p_lease_seconds);
  INSERT INTO plugin_data.csf_sheet_import_commit_attempts (
    organization_id, commit_job_id, attempt_number, status, lease_expires_at,
    actor_user_id, actor_snapshot
  ) VALUES (
    p_organization_id, v_commit.id, v_attempt_number, 'running', v_lease,
    -- The *logical* actor, frozen at the first claim. A takeover records who ran it
    -- in the snapshot below, but never inherits authority it was not given.
    v_commit.commit_actor_user_id,
    jsonb_build_object(
      'actorUserId', v_commit.commit_actor_user_id,
      'claimedBy', p_actor_user_id,
      'claimedAt', now(),
      'attemptNumber', v_attempt_number,
      'takeover', v_resumed
    )
  ) RETURNING id, correlation_id INTO v_attempt_id, v_correlation;

  UPDATE plugin_data.csf_sheet_import_jobs
  SET active_commit_attempt_id = v_attempt_id,
      status = 'running',
      error_message = NULL,
      updated_at = now()
  WHERE id = v_commit.id;

  -- One auditable event per claim, on the attempt's own correlation, carrying
  -- coordinates only. No student payload reaches an audit row.
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    correlation_id, source_type, source_id, after_data
  ) VALUES (
    p_organization_id, coalesce(v_commit.commit_actor_user_id, p_actor_user_id),
    'sheet_import.commit_claimed', 'csf_sheet_import_jobs', v_commit.id,
    v_correlation, 'sheet_import', v_preview.source_id::text,
    jsonb_build_object(
      'previewJobId', p_preview_job_id,
      'commitAttemptId', v_attempt_id,
      'attemptNumber', v_attempt_number,
      'takeover', v_resumed,
      'frozenRows', v_frozen,
      'claimedBy', p_actor_user_id
    )
  );

  RETURN jsonb_build_object(
    'commitJobId', v_commit.id,
    'attemptId', v_attempt_id,
    'attemptNumber', v_attempt_number,
    'correlationId', v_correlation,
    'resumed', v_resumed,
    'frozenRows', v_frozen,
    'actorUserId', v_commit.commit_actor_user_id,
    'leaseExpiresAt', v_lease
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_heartbeat_import_commit_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_lease_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease timestamptz;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'CSF commit lease must be between 30 and 3600 seconds.'
      USING ERRCODE = '22023';
  END IF;
  v_lease := now() + make_interval(secs => p_lease_seconds);

  UPDATE plugin_data.csf_sheet_import_commit_attempts AS attempt
  SET lease_expires_at = v_lease
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id
    AND attempt.status = 'running'
    AND attempt.lease_expires_at > now()
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_sheet_import_jobs AS commit_job
      WHERE commit_job.id = attempt.commit_job_id
        AND commit_job.active_commit_attempt_id = attempt.id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'This CSF commit attempt is no longer active; another attempt has taken over.'
      USING ERRCODE = '55P03';
  END IF;

  RETURN jsonb_build_object('attemptId', p_attempt_id, 'leaseExpiresAt', v_lease);
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_active_import_commit_attempt(
  p_organization_id uuid,
  p_attempt_id uuid
)
RETURNS plugin_data.csf_sheet_import_commit_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF commit attempt was not found.' USING ERRCODE = '23503';
  END IF;

  IF v_attempt.status <> 'running'
    OR v_attempt.lease_expires_at IS NULL
    OR v_attempt.lease_expires_at <= now()
    OR NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_sheet_import_jobs AS commit_job
      WHERE commit_job.id = v_attempt.commit_job_id
        AND commit_job.active_commit_attempt_id = v_attempt.id
    )
  THEN
    RAISE EXCEPTION
      'This CSF commit attempt is no longer active; another attempt has taken over.'
      USING ERRCODE = '55P03';
  END IF;

  RETURN v_attempt;
END;
$$;

-- The five-argument claim, and only it. These statements used to name the
-- four-argument signature this migration drops at the top of the file, so a
-- fresh replay reached them with nothing of that shape installed and halted on
-- "function ... does not exist" -- after most of the schema had already been
-- created. `REVOKE`/`GRANT ON FUNCTION` resolve a specific overload and have no
-- IF EXISTS form, so the signature written here has to be the one that exists.
REVOKE ALL ON FUNCTION plugin_data.csf_claim_import_commit_attempt(uuid, uuid, uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_import_commit_attempt(uuid, uuid, uuid, integer, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_heartbeat_import_commit_attempt(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_heartbeat_import_commit_attempt(uuid, uuid, integer)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_active_import_commit_attempt(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
-- Internal helper: reachable only from the owned wrappers below.

-- ---------------------------------------------------------------------------
-- Begin-intent: the record that says "a write is about to be attempted".
--
-- Without it there is no way to tell a row that was never attempted from a row
-- whose result was lost in transit, because both look identical: still `pending`,
-- no lineage. Committing one is safe and committing the other is a double write.
-- So the intent is durable *before* any mutation, and the abort path turns any
-- intent that never reported back into a review-blocking `unknown` rather than
-- something the next attempt quietly retries.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_begin_import_row_for_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_import_row_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
BEGIN
  v_attempt := plugin_data.csf_assert_active_import_commit_attempt(
    p_organization_id, p_attempt_id
  );

  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.id = v_attempt.commit_job_id;

  -- The row must belong to this attempt's own preview, and to the freeze this
  -- attempt's logical commit performed. Both are checked, not one: the preview link
  -- proves tenancy and lineage, the freeze link proves the decision being executed
  -- is the one that was reviewed.
  SELECT * INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id
    AND import_row.job_id = v_commit.preview_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found for this commit.' USING ERRCODE = '23503';
  END IF;
  IF v_row.commit_frozen_by_job_id IS DISTINCT FROM v_commit.id THEN
    RAISE EXCEPTION
      'This CSF import row was not frozen by the commit this attempt belongs to.'
      USING ERRCODE = '23514';
  END IF;

  -- Already terminal: report it rather than starting a second intent.
  IF v_row.commit_outcome_state IN ('succeeded', 'failed') THEN
    RETURN jsonb_build_object(
      'began', false,
      'outcomeState', v_row.commit_outcome_state,
      'importStatus', v_row.import_status,
      'committedByAttemptId', v_row.commit_attempt_id
    );
  END IF;
  IF v_row.commit_outcome_state IN ('unknown', 'historical_unknown') THEN
    RAISE EXCEPTION
      'This CSF import row has an unresolved outcome and must be reconciled first.'
      USING ERRCODE = '23514';
  END IF;
  IF v_row.commit_outcome_state = 'in_flight' THEN
    IF v_row.commit_intent_attempt_id = p_attempt_id THEN
      -- This attempt's own intent, replayed. Idempotent.
      RETURN jsonb_build_object(
        'began', true,
        'replayedIntent', true,
        'outcomeState', 'in_flight',
        'attemptId', p_attempt_id,
        'correlationId', v_attempt.correlation_id
      );
    END IF;
    RAISE EXCEPTION
      'Another CSF commit attempt already has a write in flight for this row.'
      USING ERRCODE = '55P03';
  END IF;
  IF v_row.import_status <> 'pending' THEN
    RAISE EXCEPTION 'This CSF import row is no longer ready to commit.' USING ERRCODE = '55000';
  END IF;

  UPDATE plugin_data.csf_sheet_import_rows
  SET commit_outcome_state = 'in_flight',
      commit_intent_attempt_id = p_attempt_id,
      commit_intent_correlation_id = v_attempt.correlation_id,
      commit_intent_started_at = now()
  WHERE organization_id = p_organization_id
    AND id = p_import_row_id;

  RETURN jsonb_build_object(
    'began', true,
    'replayedIntent', false,
    'outcomeState', 'in_flight',
    'attemptId', p_attempt_id,
    'correlationId', v_attempt.correlation_id,
    'frozenRowHash', v_row.commit_frozen_row_hash,
    'targetProfileId', v_row.commit_target_profile_id
  );
END;
$$;

-- Historical readback. Distinguishes the four cases a recovering worker must never
-- confuse: already succeeded, still in flight, unknown, or a safe deterministic
-- failure it may legitimately re-run.
CREATE OR REPLACE FUNCTION plugin_data.csf_import_row_recovery_state(
  p_organization_id uuid,
  p_import_row_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_intent_status text;
  v_intent_lease timestamptz;
BEGIN
  SELECT * INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found.' USING ERRCODE = '23503';
  END IF;

  IF v_row.commit_intent_attempt_id IS NOT NULL THEN
    SELECT attempt.status, attempt.lease_expires_at
    INTO v_intent_status, v_intent_lease
    FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    WHERE attempt.id = v_row.commit_intent_attempt_id;
  END IF;

  RETURN jsonb_build_object(
    'importRowId', p_import_row_id,
    'outcomeState', v_row.commit_outcome_state,
    'importStatus', v_row.import_status,
    'frozen', v_row.commit_frozen_at IS NOT NULL,
    'targetProfileId', v_row.commit_target_profile_id,
    'committedByAttemptId', v_row.commit_attempt_id,
    'intentAttemptId', v_row.commit_intent_attempt_id,
    'intentCorrelationId', v_row.commit_intent_correlation_id,
    'intentAttemptStatus', v_intent_status,
    -- An intent whose attempt has lost its lease is stale, not live. A recovering
    -- worker needs that distinction: live means wait, stale means reconcile.
    'intentStale', v_row.commit_outcome_state = 'in_flight'
      AND (v_intent_status IS DISTINCT FROM 'running' OR coalesce(v_intent_lease, now()) <= now()),
    'reconcilable', v_row.commit_outcome_state IN ('unknown', 'historical_unknown'),
    'safeToRetry', v_row.commit_outcome_state IN ('frozen', 'failed')
      AND v_row.import_status = 'pending',
    'outcomeCode', v_row.commit_outcome_code,
    'outcomeResolution', v_row.commit_outcome_resolution
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_begin_import_row_for_attempt(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_import_row_for_attempt(uuid, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_import_row_recovery_state(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_row_recovery_state(uuid, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- The atomic row wrapper. Identifiers in, authoritative write out.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_commit_import_row_for_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_import_row_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_payload_version constant text := 'csf-commit-payload/v1';
  c_allowed_keys constant text[] := ARRAY[
    'version', 'sourceType', 'identity', 'canonicalEmails',
    'applicationData', 'activities', 'meetings', 'allRequirementsMet'
  ];
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_payload jsonb;
  v_identity jsonb;
  v_emails jsonb;
  v_key text;
  v_result jsonb;
  v_source_type text;
  v_school text;
  v_personal text;
  v_norm_school text;
  v_norm_personal text;
  v_prior_correlation uuid;
  v_target uuid;
  v_basis text;
BEGIN
  v_attempt := plugin_data.csf_assert_active_import_commit_attempt(
    p_organization_id, p_attempt_id
  );

  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.id = v_attempt.commit_job_id;
  v_source_type := v_commit.source_type;

  SELECT * INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id
    AND import_row.job_id = v_commit.preview_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found for this commit.' USING ERRCODE = '23503';
  END IF;

  -- A lost response, not work to redo. The committed attempt and its correlation
  -- are reported separately from this observer's, so the two are never conflated.
  IF v_row.commit_attempt_id IS NOT NULL THEN
    SELECT prior.correlation_id INTO v_prior_correlation
    FROM plugin_data.csf_sheet_import_commit_attempts AS prior
    WHERE prior.id = v_row.commit_attempt_id;
    RETURN jsonb_build_object(
      'replayed', true,
      'importStatus', v_row.import_status,
      'profileId', v_row.matched_profile_id,
      'outcomeState', v_row.commit_outcome_state,
      'committedByAttemptId', v_row.commit_attempt_id,
      'committedByCorrelationId', v_prior_correlation,
      'observerAttemptId', p_attempt_id,
      'observerCorrelationId', v_attempt.correlation_id
    );
  END IF;

  IF v_row.import_status <> 'pending' THEN
    RAISE EXCEPTION 'This CSF import row is no longer ready to commit.' USING ERRCODE = '55000';
  END IF;
  IF v_row.commit_outcome_unresolved THEN
    RAISE EXCEPTION 'This CSF import row has an unresolved outcome and must be reconciled first.'
      USING ERRCODE = '23514';
  END IF;

  -- A live begin-intent belonging to *this* attempt is required. Committing without
  -- one would leave no durable trace that a write was attempted, which is precisely
  -- the state that cannot be recovered from.
  IF v_row.commit_outcome_state <> 'in_flight'
    OR v_row.commit_intent_attempt_id IS DISTINCT FROM p_attempt_id
    OR v_row.commit_intent_correlation_id IS DISTINCT FROM v_attempt.correlation_id
  THEN
    RAISE EXCEPTION
      'This CSF import row has no live write intent for this attempt; begin the row before committing it.'
      USING ERRCODE = '55000';
  END IF;

  -- The frozen decision must still describe this row. The freeze trigger already
  -- makes these columns write-once, so a mismatch here means the row's own evidence
  -- changed underneath an approved decision, not that the freeze was edited.
  IF v_row.commit_frozen_at IS NULL
    OR v_row.commit_frozen_by_job_id IS DISTINCT FROM v_commit.id
  THEN
    RAISE EXCEPTION
      'This CSF import row was not frozen by the commit this attempt belongs to.'
      USING ERRCODE = '23514';
  END IF;
  IF v_row.commit_frozen_row_hash IS DISTINCT FROM v_row.row_hash THEN
    RAISE EXCEPTION
      'This CSF import row no longer matches the digest that was reviewed. Run a fresh preview.'
      USING ERRCODE = '23514';
  END IF;
  IF v_row.commit_frozen_source_id IS DISTINCT FROM v_row.source_id THEN
    RAISE EXCEPTION
      'This CSF import row no longer names the source that was reviewed.'
      USING ERRCODE = '23514';
  END IF;
  IF v_row.commit_frozen_source_revision IS NOT NULL
    AND v_commit.source_content_hash IS DISTINCT FROM v_row.commit_frozen_source_revision
  THEN
    RAISE EXCEPTION
      'The source revision behind this import changed after it was reviewed. Run a fresh preview.'
      USING ERRCODE = '23514';
  END IF;

  -- Everything authoritative comes from the immutable preview row. The caller
  -- supplied only identifiers, so there is nothing here for it to forge; the
  -- payload itself lives inside `normalized_data`, which
  -- csf_preserve_import_row_snapshot already makes immutable.
  v_payload := v_row.normalized_data -> 'commitPayload';
  IF v_payload IS NULL OR jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION
      'This preview row carries no commit payload. Run a fresh preview before importing.'
      USING ERRCODE = '23514';
  END IF;
  IF v_payload->>'version' IS DISTINCT FROM c_payload_version THEN
    RAISE EXCEPTION
      'This preview row uses an unsupported commit payload version. Run a fresh preview.'
      USING ERRCODE = '23514';
  END IF;
  IF v_payload->>'sourceType' IS DISTINCT FROM v_source_type THEN
    RAISE EXCEPTION
      'The commit payload disagrees with the source type of the import it belongs to.'
      USING ERRCODE = '23514';
  END IF;
  -- Closed shape: an unreviewed field cannot arrive by being added upstream.
  FOR v_key IN SELECT jsonb_object_keys(v_payload)
  LOOP
    IF NOT (v_key = ANY (c_allowed_keys)) THEN
      RAISE EXCEPTION 'The commit payload carries an unsupported field "%".', v_key
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- The exact allowlisted payload that was frozen, proved by digest rather than
  -- assumed. `normalized_data` is already immutable, so this is the belt to that
  -- brace: if either the immutability trigger or the freeze were ever weakened, this
  -- comparison is what still refuses to write a payload nobody reviewed.
  IF encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex')
    IS DISTINCT FROM v_row.commit_frozen_payload_hash
  THEN
    RAISE EXCEPTION
      'The commit payload for this row differs from the one that was reviewed. Run a fresh preview.'
      USING ERRCODE = '23514';
  END IF;

  v_identity := coalesce(v_payload -> 'identity', '{}'::jsonb);
  v_emails := coalesce(v_payload -> 'canonicalEmails', '{}'::jsonb);
  IF nullif(btrim(coalesce(v_identity->>'firstName', '')), '') IS NULL
    OR nullif(btrim(coalesce(v_identity->>'lastName', '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'The commit payload is missing a first or last name.' USING ERRCODE = '23514';
  END IF;
  IF v_row.source_id IS NULL OR v_row.cohort_id IS NULL THEN
    RAISE EXCEPTION 'The import row is missing its source or class.' USING ERRCODE = '23514';
  END IF;

  -- The frozen target is the only profile this row may touch.
  v_target := v_row.commit_target_profile_id;
  v_basis := coalesce(v_row.commit_resolution_snapshot->>'basis', 'unmatched');

  -- Canonical email safety, enforced here rather than trusted from the payload.
  -- An application's response and preferred-contact addresses are unverified form
  -- evidence: the legacy RPC matches profiles on the normalized pair and seeds new
  -- profiles from the plain pair, so passing them would make a typed-in address
  -- canonical identity for a student who never proved it.
  IF v_source_type = 'application_responses' THEN
    v_school := NULL;
    v_personal := NULL;
    v_norm_school := NULL;
    v_norm_personal := NULL;
  ELSE
    v_school := nullif(btrim(coalesce(v_emails->>'schoolEmail', '')), '');
    v_personal := nullif(btrim(coalesce(v_emails->>'personalEmail', '')), '');
    v_norm_school := nullif(btrim(coalesce(v_emails->>'normalizedSchoolEmail', '')), '');
    v_norm_personal := nullif(btrim(coalesce(v_emails->>'normalizedPersonalEmail', '')), '');
  END IF;

  IF v_source_type = 'application_responses' THEN
    IF v_row.term_id IS NULL THEN
      RAISE EXCEPTION 'The application row is missing its semester.' USING ERRCODE = '23514';
    END IF;

    -- An application never brings a member into being.
    --
    -- The legacy row RPC below still contains a name-only fallback that seeds a new
    -- profile when it is handed a null profile id, and reaching that branch is how an
    -- unverified form response could become canonical identity for a student who
    -- never proved it. It is unreachable from here by construction: a targetless
    -- application row is refused before the call, so the RPC is only ever entered
    -- with a nonnull, frozen, officer-approved target and takes its update path.
    --
    -- Roster and class-history imports are the two sources that may create a member,
    -- and they are deliberately left alone.
    IF v_target IS NULL THEN
      RAISE EXCEPTION
        'This application row has no reviewed CSF member to attach to. Resolve it to an existing member before importing.'
        USING ERRCODE = '23514';
    END IF;
    IF v_basis NOT IN ('officer_resolved', 'preview_exact_match') THEN
      RAISE EXCEPTION
        'This application row was not resolved to a reviewed CSF member.'
        USING ERRCODE = '23514';
    END IF;
    -- The frozen target must still be a live member of this organization. Locked,
    -- because the write below depends on it existing for the whole transaction.
    PERFORM 1
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = v_target
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'The CSF member this application was resolved to no longer exists.'
        USING ERRCODE = '23503';
    END IF;

    v_result := plugin_data.csf_import_application_response_row(
      p_organization_id, v_target,
      btrim(v_identity->>'firstName'), btrim(v_identity->>'lastName'),
      v_school, v_personal,
      btrim(coalesce(v_identity->>'normalizedFirstName', '')),
      btrim(coalesce(v_identity->>'normalizedLastName', '')),
      v_norm_school, v_norm_personal,
      v_row.cohort_id, v_row.term_id, v_row.source_id, p_import_row_id,
      v_row.commit_frozen_row_hash,
      coalesce(v_payload -> 'applicationData', '{}'::jsonb),
      v_row.commit_frozen_actor_user_id
    );
  ELSIF v_source_type = 'student_roster' THEN
    v_result := plugin_data.csf_import_student_roster_row(
      p_organization_id, v_target,
      btrim(v_identity->>'firstName'), btrim(v_identity->>'lastName'),
      v_school, v_personal,
      btrim(coalesce(v_identity->>'normalizedFirstName', '')),
      btrim(coalesce(v_identity->>'normalizedLastName', '')),
      v_norm_school, v_norm_personal,
      v_row.cohort_id, v_row.source_id, p_import_row_id,
      v_row.commit_frozen_row_hash, v_row.commit_frozen_actor_user_id
    );
  ELSIF v_source_type = 'class_history' THEN
    IF v_row.term_id IS NULL THEN
      RAISE EXCEPTION 'The class-history row is missing its semester.' USING ERRCODE = '23514';
    END IF;
    -- The requirements flag must be a JSON boolean, absent, or JSON null. Anything else
    -- is a malformed payload and is refused here rather than being coerced to "unknown"
    -- -- silently turning a garbled value into NULL would import a row whose
    -- requirements state nobody actually reviewed.
    IF v_payload ? 'allRequirementsMet'
      AND jsonb_typeof(v_payload -> 'allRequirementsMet') NOT IN ('boolean', 'null')
    THEN
      RAISE EXCEPTION
        'This preview row records a malformed requirements flag. Run a fresh preview.'
        USING ERRCODE = '23514';
    END IF;
    v_result := plugin_data.csf_import_class_history_row_v2(
      p_organization_id, v_target,
      btrim(v_identity->>'firstName'), btrim(v_identity->>'lastName'),
      v_school, v_personal,
      btrim(coalesce(v_identity->>'normalizedFirstName', '')),
      btrim(coalesce(v_identity->>'normalizedLastName', '')),
      v_norm_school, v_norm_personal,
      v_row.cohort_id, v_row.term_id, v_row.source_id, p_import_row_id,
      v_row.commit_frozen_row_hash,
      coalesce(v_payload -> 'activities', '[]'::jsonb),
      coalesce(v_payload -> 'meetings', '[]'::jsonb),
      -- Cast only what has already been proved to be a JSON boolean. Testing for
      -- `NULL`/`'null'` left every other shape -- a string, a number, an object -- going
      -- straight into `::boolean`, which raises invalid_text_representation from the
      -- middle of an authoritative write instead of refusing the payload.
      CASE
        WHEN jsonb_typeof(v_payload -> 'allRequirementsMet') = 'boolean'
          THEN (v_payload ->> 'allRequirementsMet')::boolean
        ELSE NULL
      END,
      v_row.commit_frozen_actor_user_id
    );
  ELSE
    RAISE EXCEPTION
      'This CSF source type is committed from its contextual workflow, not through a commit attempt.'
      USING ERRCODE = '23514';
  END IF;

  -- Same transaction as the authoritative write above. The intent that authorized
  -- this write is settled here, so the row can never be left recorded in flight
  -- after a successful commit.
  UPDATE plugin_data.csf_sheet_import_rows
  SET commit_attempt_id = p_attempt_id,
      commit_outcome_state = 'succeeded',
      commit_outcome_code = NULL,
      commit_outcome_note = NULL
  WHERE organization_id = p_organization_id
    AND id = p_import_row_id;

  -- Shared correlation in the real indexed column, not only in after_data, and the
  -- frozen logical actor rather than whoever happened to run this attempt.
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    term_id, correlation_id, source_type, source_id, after_data
  ) VALUES (
    p_organization_id, v_row.commit_frozen_actor_user_id, 'sheet_import.row_committed',
    'csf_sheet_import_rows', p_import_row_id, v_row.term_id,
    v_attempt.correlation_id, 'sheet_import', v_row.source_id::text,
    jsonb_build_object(
      'commitJobId', v_commit.id,
      'commitAttemptId', p_attempt_id,
      'attemptNumber', v_attempt.attempt_number,
      'sourceType', v_source_type,
      'resolutionBasis', v_basis,
      'targetProfileId', v_target,
      'importStatus', coalesce(v_result->>'importStatus', 'updated')
    )
  );

  RETURN coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'replayed', false,
    'outcomeState', 'succeeded',
    'resolutionBasis', v_basis,
    'commitAttemptId', p_attempt_id,
    'correlationId', v_attempt.correlation_id
  );
END;
$$;

-- Internal: prove a row belongs to this attempt's preview and to the freeze this
-- attempt's logical commit performed. Every outcome-recording path below calls it,
-- so none of them can be aimed at a row from another import or another tenant.
CREATE OR REPLACE FUNCTION plugin_data.csf_assert_import_row_for_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_import_row_id uuid
)
RETURNS plugin_data.csf_sheet_import_rows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
BEGIN
  SELECT commit_job.* INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  JOIN plugin_data.csf_sheet_import_commit_attempts AS attempt
    ON attempt.commit_job_id = commit_job.id
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF commit attempt was not found.' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id
    AND import_row.job_id = v_commit.preview_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found for this commit.' USING ERRCODE = '23503';
  END IF;
  IF v_row.commit_frozen_by_job_id IS DISTINCT FROM v_commit.id THEN
    RAISE EXCEPTION
      'This CSF import row was not frozen by the commit this attempt belongs to.'
      USING ERRCODE = '23514';
  END IF;

  RETURN v_row;
END;
$$;

-- Record the outcome of a row whose write did not succeed, for the active attempt.
--
-- `p_deterministic` is the whole point of this signature. A structured database
-- error means the wrapper's transaction rolled back, so no write landed and the row
-- is safely `failed`. No trustworthy response at all -- a dropped connection, a
-- timeout -- means the write may well have committed before the reply was lost, so
-- the row becomes a review-blocking `unknown`. Collapsing the two, as a single
-- "mark it failed" path does, is how a committed row gets re-run or a real write
-- gets reported to an officer as a failure.
CREATE OR REPLACE FUNCTION plugin_data.csf_fail_import_row_for_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_import_row_id uuid,
  p_reason_code text,
  p_detail text,
  p_deterministic boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_code text;
  v_detail text;
  v_state text;
BEGIN
  v_attempt := plugin_data.csf_assert_active_import_commit_attempt(
    p_organization_id, p_attempt_id
  );
  v_row := plugin_data.csf_assert_import_row_for_attempt(
    p_organization_id, p_attempt_id, p_import_row_id
  );

  IF v_row.import_status <> 'pending' OR v_row.commit_outcome_state = 'succeeded' THEN
    -- The authoritative write landed after all. Its real outcome stands.
    RETURN jsonb_build_object(
      'recorded', false,
      'importStatus', v_row.import_status,
      'outcomeState', v_row.commit_outcome_state,
      'commitAttemptId', v_row.commit_attempt_id
    );
  END IF;
  IF v_row.commit_outcome_state IN ('unknown', 'historical_unknown') THEN
    RETURN jsonb_build_object(
      'recorded', false,
      'importStatus', v_row.import_status,
      'outcomeState', v_row.commit_outcome_state,
      'commitAttemptId', v_row.commit_attempt_id
    );
  END IF;
  -- An in-flight intent must belong to this attempt, or this attempt is speaking for
  -- a write it did not start.
  IF v_row.commit_outcome_state = 'in_flight'
    AND v_row.commit_intent_attempt_id IS DISTINCT FROM p_attempt_id
  THEN
    RAISE EXCEPTION
      'Another CSF commit attempt owns the write in flight for this row.'
      USING ERRCODE = '55P03';
  END IF;

  v_code := plugin_data.csf_bounded_reason_code(
    p_reason_code,
    CASE WHEN coalesce(p_deterministic, false) THEN 'row_commit_failed' ELSE 'row_outcome_unknown' END
  );
  v_detail := plugin_data.csf_bounded_failure_detail(p_detail);
  v_state := CASE WHEN coalesce(p_deterministic, false) THEN 'failed' ELSE 'unknown' END;

  IF v_state = 'failed' THEN
    UPDATE plugin_data.csf_sheet_import_rows
    SET import_status = 'error',
        -- The durable operator-visible evidence is the code. Prose is appended only
        -- when it survived sanitizing, so a raw driver message never lands here.
        errors = ARRAY[coalesce(v_code || CASE WHEN v_detail IS NULL THEN '' ELSE ': ' || v_detail END, 'row_commit_failed')]::text[],
        commit_attempt_id = p_attempt_id,
        commit_outcome_state = 'failed',
        commit_outcome_code = v_code,
        commit_outcome_note = v_detail
    WHERE organization_id = p_organization_id
      AND id = p_import_row_id;
  ELSE
    UPDATE plugin_data.csf_sheet_import_rows
    SET commit_outcome_state = 'unknown',
        commit_outcome_unresolved = true,
        commit_outcome_code = v_code,
        commit_outcome_correlation_id = v_attempt.correlation_id,
        commit_outcome_note = coalesce(
          v_detail,
          'The authoritative outcome of this row could not be determined.'
        )
    WHERE organization_id = p_organization_id
      AND id = p_import_row_id;
  END IF;

  RETURN jsonb_build_object(
    'recorded', true,
    'deterministic', coalesce(p_deterministic, false),
    'outcomeState', v_state,
    'outcomeCode', v_code,
    'importStatus', CASE WHEN v_state = 'failed' THEN 'error' ELSE v_row.import_status END,
    'commitAttemptId', p_attempt_id,
    'correlationId', v_attempt.correlation_id
  );
END;
$$;

-- Durably mark a row's authoritative outcome unknown. Blocks finalization and the
-- next claim until an officer reconciles it.
--
-- Narrowly scoped now: the active attempt, a row of that attempt's own frozen
-- preview, and an intent this attempt actually started. Previously this could be
-- pointed at any row id in the organization, which made it a way to mark an
-- unrelated import unresolvable.
--
-- The commit loop does not call this directly; it reaches the same durable state
-- through csf_fail_import_row_for_attempt with p_deterministic false, so there is one
-- code path from "the write did not answer" to "the outcome is unknown" rather than
-- two that could disagree. This entry point exists for a caller that knows the
-- outcome is unknowable for a reason other than a failed call -- an aborted request,
-- a cancelled job -- and for the contract tests that prove the scoping.
CREATE OR REPLACE FUNCTION plugin_data.csf_flag_import_row_outcome_unknown(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_import_row_id uuid,
  p_reason_code text,
  p_detail text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
BEGIN
  v_attempt := plugin_data.csf_assert_active_import_commit_attempt(
    p_organization_id, p_attempt_id
  );
  v_row := plugin_data.csf_assert_import_row_for_attempt(
    p_organization_id, p_attempt_id, p_import_row_id
  );

  IF v_row.commit_outcome_state IN ('succeeded', 'failed') THEN
    RETURN jsonb_build_object(
      'flagged', false,
      'outcomeState', v_row.commit_outcome_state
    );
  END IF;
  IF v_row.commit_outcome_state = 'unknown' THEN
    RETURN jsonb_build_object('flagged', false, 'outcomeState', 'unknown');
  END IF;
  IF v_row.commit_outcome_state <> 'in_flight'
    OR v_row.commit_intent_attempt_id IS DISTINCT FROM p_attempt_id
  THEN
    RAISE EXCEPTION
      'Only the attempt that started a write may record its outcome as unknown.'
      USING ERRCODE = '55P03';
  END IF;

  UPDATE plugin_data.csf_sheet_import_rows
  SET commit_outcome_state = 'unknown',
      commit_outcome_unresolved = true,
      commit_outcome_code = plugin_data.csf_bounded_reason_code(p_reason_code, 'row_outcome_unknown'),
      commit_outcome_correlation_id = v_attempt.correlation_id,
      commit_outcome_note = coalesce(
        plugin_data.csf_bounded_failure_detail(p_detail),
        'The authoritative outcome of this row could not be determined.'
      )
  WHERE organization_id = p_organization_id
    AND id = p_import_row_id;

  RETURN jsonb_build_object(
    'flagged', true,
    'outcomeState', 'unknown',
    'correlationId', v_attempt.correlation_id
  );
END;
$$;

-- The only way out of `unknown`.
--
-- An explicit decision, the original correlation the unknown was recorded under, a
-- nonnull officer, and a bounded reason. The correlation requirement is what stops a
-- reconciliation from being applied to a *later* unknown than the one the officer
-- actually reviewed: by the time a human looks, the row may have been through
-- another attempt, and "I decided about this" has to name which one.
--
-- What changed, and why it matters more than the vocabulary:
--
-- `accepted_as_written` used to move the outcome to `succeeded` while leaving
-- `import_status = 'pending'` and no attempt lineage. That row was then stranded
-- forever: finalize counted it as pending, so the logical commit could never
-- complete, and the commit worklist selects only `frozen` rows, so nothing could ever
-- pick it up again. It also asserted a write that no evidence supported.
--
-- The evidence is not a matter of opinion here. `csf_commit_import_row_for_attempt`
-- performs the authoritative write, records the row's attempt lineage, and sets the
-- outcome state in *one transaction*. So a row still holding `import_status =
-- 'pending'` with no lineage is proof that the write did not land, and a row already
-- holding terminal lineage is proof that it did. This function therefore reads the
-- evidence instead of accepting a claim about it:
--
--   * lineage present  -> the write is proven; settle `succeeded` and say so, whatever
--                         the officer guessed. No decision can contradict the record.
--   * lineage absent   -> the write provably did not land, so `accepted_as_written` is
--                         refused outright rather than allowed to fabricate one.
CREATE OR REPLACE FUNCTION plugin_data.csf_reconcile_import_row_outcome(
  p_organization_id uuid,
  p_import_row_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_correlation_id uuid,
  p_reason_code text,
  p_detail text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_code text;
  v_state text;
  v_resolution text;
  v_written boolean;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Reconciling a CSF import outcome requires the deciding officer.'
      USING ERRCODE = '23502';
  END IF;
  -- Interactive: reconciling an unknown outcome decides whether a student record
  -- was written. It is recorded against `p_actor_user_id` in the audit ledger, so
  -- proving that person may act on this source is the whole point of recording it.
  PERFORM plugin_data.csf_assert_import_actor_for_row(
    p_organization_id, p_actor_user_id, p_import_row_id
  );
  IF p_decision NOT IN ('accepted_as_written', 'accepted_as_not_written') THEN
    RAISE EXCEPTION
      'A CSF import outcome must be reconciled as accepted_as_written or accepted_as_not_written.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found.' USING ERRCODE = '23503';
  END IF;

  IF v_row.commit_outcome_state <> 'unknown' THEN
    RETURN jsonb_build_object(
      'reconciled', false,
      'outcomeState', v_row.commit_outcome_state,
      'reason', 'not_unknown'
    );
  END IF;
  IF v_row.commit_outcome_correlation_id IS DISTINCT FROM p_correlation_id THEN
    RAISE EXCEPTION
      'This CSF import outcome was recorded under a different attempt than the one being reconciled.'
      USING ERRCODE = '55P03';
  END IF;

  v_code := plugin_data.csf_bounded_reason_code(p_reason_code, 'officer_reconciled');

  -- The evidence, read under the row lock taken above.
  v_written := v_row.commit_attempt_id IS NOT NULL
    AND v_row.import_status IN ('created', 'updated');

  IF v_written THEN
    -- The write is proven, so the outcome is `succeeded` regardless of what was
    -- submitted, and every dimension is already terminal and coherent. The officer's
    -- own decision is still recorded, but it cannot override the record.
    v_state := 'succeeded';
    v_resolution := 'confirmed_written';
  ELSIF p_decision = 'accepted_as_written' THEN
    -- Nothing supports it. The wrapper writes the record, the lineage and the outcome
    -- in one transaction, so a row without lineage did not have its write land, and
    -- saying otherwise would invent a member record that does not exist.
    RAISE EXCEPTION
      'There is no record of an authoritative write for this row, so it cannot be accepted as written. Accept it as not written, or retry the import.'
      USING ERRCODE = '23514';
  ELSE
    v_state := 'failed';
    v_resolution := 'accepted_as_not_written';
  END IF;

  UPDATE plugin_data.csf_sheet_import_rows
  SET commit_outcome_state = v_state,
      commit_outcome_unresolved = false,
      commit_outcome_code = v_code,
      commit_outcome_resolution = v_resolution,
      commit_outcome_resolved_by = p_actor_user_id,
      commit_outcome_resolved_at = now(),
      commit_outcome_note = plugin_data.csf_bounded_failure_detail(p_detail),
      -- One coherent terminal state across every dimension. A `failed` outcome moves
      -- `import_status` to `error` in the same statement, so the row can never be
      -- terminal in one dimension and pending in another; the coherence CHECK
      -- constraints on this table refuse the combination outright.
      import_status = CASE
        WHEN v_state = 'failed' AND import_status = 'pending' THEN 'error'
        ELSE import_status
      END,
      errors = CASE
        WHEN v_state = 'failed' AND import_status = 'pending' THEN ARRAY[v_code]::text[]
        ELSE errors
      END
  WHERE organization_id = p_organization_id
    AND id = p_import_row_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    correlation_id, source_type, source_id, after_data
  ) VALUES (
    p_organization_id, p_actor_user_id, 'sheet_import.outcome_reconciled',
    'csf_sheet_import_rows', p_import_row_id,
    p_correlation_id, 'sheet_import', v_row.source_id::text,
    jsonb_build_object(
      'submittedDecision', p_decision,
      'resolution', v_resolution,
      'outcomeState', v_state,
      'writeProven', v_written,
      'reasonCode', v_code,
      'commitJobId', v_row.commit_frozen_by_job_id
    )
  );

  RETURN jsonb_build_object(
    'reconciled', true,
    'outcomeState', v_state,
    'resolution', v_resolution,
    'writeProven', v_written,
    'reasonCode', v_code
  );
END;
$$;

-- Accept a pre-ledger row's unknowable provenance.
--
-- Deliberately separate from the reconciliation path above, and deliberately narrow.
-- Rows committed before this ledger existed carry no begin-intent and no
-- correlation, so there is nothing for an officer to compare against; all they can
-- do is state, on the record, that the historical outcome is accepted as-is. Mixing
-- that into the normal reconciliation RPC would let a genuinely ambiguous *live*
-- unknown be closed without a correlation.
-- There is exactly one coherent decision available here, so the signature offers
-- exactly one.
--
-- A pre-ledger row reached `historical_unknown` *because* its `import_status` already
-- says `created` or `updated`: a record was written, by a commit that predates the
-- attempt ledger, and nothing recorded which attempt did it. Accepting it "as not
-- written" would have moved the outcome to `failed` while leaving that
-- `created`/`updated` status in place -- a durable, self-contradicting claim that a
-- member record both exists and was never written.
--
-- So the only thing an officer can truthfully do is acknowledge the record on the
-- books. Undoing a pre-ledger import is a *corrective* act on the operational record,
-- not a relabelling of an import row, and it deliberately has no path here: this
-- function will not invent lineage, and it will not invent a correction either.
CREATE OR REPLACE FUNCTION plugin_data.csf_accept_historical_import_outcome(
  p_organization_id uuid,
  p_import_row_id uuid,
  p_actor_user_id uuid,
  p_reason_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_code text;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Accepting a historical CSF import outcome requires the deciding officer.'
      USING ERRCODE = '23502';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor_for_row(
    p_organization_id, p_actor_user_id, p_import_row_id
  );

  SELECT * INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found.' USING ERRCODE = '23503';
  END IF;
  IF v_row.commit_outcome_state <> 'historical_unknown' THEN
    RETURN jsonb_build_object(
      'accepted', false,
      'outcomeState', v_row.commit_outcome_state,
      'reason', 'not_historical'
    );
  END IF;
  -- The state was only ever set on a row whose status already recorded a write. If
  -- that is somehow not true, acknowledging it would be the contradiction this
  -- function exists to prevent, so it refuses instead of guessing.
  IF v_row.import_status NOT IN ('created', 'updated') THEN
    RAISE EXCEPTION
      'This row does not record a completed pre-ledger import, so its history cannot be acknowledged here.'
      USING ERRCODE = '23514';
  END IF;

  v_code := plugin_data.csf_bounded_reason_code(p_reason_code, 'historical_accepted');

  UPDATE plugin_data.csf_sheet_import_rows
  SET commit_outcome_state = 'succeeded',
      commit_outcome_unresolved = false,
      commit_outcome_code = v_code,
      commit_outcome_resolution = 'historical_accepted',
      commit_outcome_resolved_by = p_actor_user_id,
      commit_outcome_resolved_at = now(),
      commit_outcome_note = NULL
  WHERE organization_id = p_organization_id
    AND id = p_import_row_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    source_type, source_id, after_data
  ) VALUES (
    p_organization_id, p_actor_user_id, 'sheet_import.historical_outcome_accepted',
    'csf_sheet_import_rows', p_import_row_id,
    'sheet_import', v_row.source_id::text,
    jsonb_build_object(
      'resolution', 'historical_accepted',
      'outcomeState', 'succeeded',
      'importStatus', v_row.import_status,
      'reasonCode', v_code
    )
  );

  RETURN jsonb_build_object(
    'accepted', true,
    'outcomeState', 'succeeded',
    'resolution', 'historical_accepted',
    'reasonCode', v_code
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- The crash path: a write intent whose owner never came back.
--
-- This is the one transition the state machine was missing, and without it a real
-- process death after begin-intent was unrecoverable by design. Every door was shut:
-- claim refuses to run while any row is `in_flight`; abort refuses because the lease
-- has lapsed and it no longer owns the attempt; the unknown-outcome RPC requires the
-- *active* attempt, which no longer exists; and reconciliation only accepts a row
-- already in `unknown`. The read projection could see `intentStale` and say so, and
-- nothing whatsoever could act on it.
--
-- So this promotes those rows to `unknown` and supersedes the dead attempt, under the
-- canonical coordinate lock, and then stops. It does not open a successor writer, it
-- does not guess whether the authoritative write happened, and it never retries: the
-- logical commit stays blocked until an officer reconciles each row. Running it twice
-- promotes nothing the second time.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_recover_stale_import_intents(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_actor_user_id uuid,
  p_reason_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_code text := plugin_data.csf_bounded_reason_code(p_reason_code, 'intent_stale_after_lease_expiry');
  v_promoted integer := 0;
  v_superseded integer := 0;
  v_live integer;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Recovering a stale CSF import intent requires the acting officer.'
      USING ERRCODE = '23502';
  END IF;

  -- Recovery authorizes the CURRENT claimant, not the officer who opened the
  -- original attempt: inheriting that officer's authority is exactly how a
  -- takeover would launder a withdrawn capability.
  PERFORM plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, p_actor_user_id, p_preview_job_id
  );

  PERFORM plugin_data.csf_lock_import_commit_coordinate(
    p_organization_id, p_preview_job_id, true
  );

  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.organization_id = p_organization_id
    AND commit_job.mode = 'commit'
    AND commit_job.preview_job_id = p_preview_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This CSF preview has no commit to recover.' USING ERRCODE = '23503';
  END IF;

  -- A live owner is not a crash. If the attempt still holds its lease it may yet
  -- report the outcome itself, and stealing its rows would be the race this whole
  -- mechanism exists to prevent.
  SELECT count(*) INTO v_live
  FROM plugin_data.csf_sheet_import_rows AS import_row
  JOIN plugin_data.csf_sheet_import_commit_attempts AS attempt
    ON attempt.id = import_row.commit_intent_attempt_id
  WHERE import_row.organization_id = p_organization_id
    AND import_row.job_id = p_preview_job_id
    AND import_row.commit_outcome_state = 'in_flight'
    AND attempt.status = 'running'
    AND attempt.lease_expires_at > now();
  IF v_live > 0 THEN
    RAISE EXCEPTION
      'This CSF import is still being written by a live attempt; wait for its lease to lapse before recovering it.'
      USING ERRCODE = '55P03';
  END IF;

  -- Only rows whose own intent correlation still matches the attempt that started
  -- them, and only where that attempt is genuinely finished or lapsed. The
  -- correlation match is what stops this from sweeping up an intent belonging to some
  -- later attempt that happens to be in flight.
  UPDATE plugin_data.csf_sheet_import_rows AS import_row
  SET commit_outcome_state = 'unknown',
      commit_outcome_unresolved = true,
      commit_outcome_code = v_code,
      commit_outcome_correlation_id = import_row.commit_intent_correlation_id,
      commit_outcome_note = 'The import stopped after this row was started and never reported its outcome.'
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  WHERE import_row.organization_id = p_organization_id
    AND import_row.job_id = p_preview_job_id
    AND import_row.commit_outcome_state = 'in_flight'
    AND attempt.id = import_row.commit_intent_attempt_id
    AND attempt.correlation_id = import_row.commit_intent_correlation_id
    AND (
      attempt.status <> 'running'
      OR attempt.lease_expires_at IS NULL
      OR attempt.lease_expires_at <= now()
    );
  GET DIAGNOSTICS v_promoted = ROW_COUNT;

  -- The dead attempt is superseded here rather than left running-but-lapsed, so the
  -- ledger stops describing a writer that no longer exists. No successor is opened.
  UPDATE plugin_data.csf_sheet_import_commit_attempts
  SET status = 'superseded',
      lease_expires_at = NULL,
      completed_at = now(),
      failure_reason = 'lease_expired_stale_intent'
  WHERE commit_job_id = v_commit.id
    AND status = 'running'
    AND (lease_expires_at IS NULL OR lease_expires_at <= now());
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  IF v_superseded > 0 THEN
    UPDATE plugin_data.csf_sheet_import_jobs
    SET active_commit_attempt_id = NULL,
        status = CASE WHEN status = 'running' THEN 'needs_resolution' ELSE status END,
        error_message = v_code,
        updated_at = now()
    WHERE id = v_commit.id;
  END IF;

  IF v_promoted > 0 OR v_superseded > 0 THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id,
      source_type, source_id, after_data
    ) VALUES (
      p_organization_id, p_actor_user_id, 'sheet_import.stale_intent_recovered',
      'csf_sheet_import_jobs', v_commit.id,
      'sheet_import', v_commit.source_id::text,
      jsonb_build_object(
        'previewJobId', p_preview_job_id,
        'promotedRows', v_promoted,
        'supersededAttempts', v_superseded,
        'reasonCode', v_code
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'promotedRows', v_promoted,
    'supersededAttempts', v_superseded,
    -- Never "you may now retry". The rows are review-blocked until an officer
    -- reconciles each one, and claim keeps refusing while any remain unresolved.
    'reviewRequired', v_promoted > 0,
    'reasonCode', v_code
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- A deterministically failed row, decided.
--
-- `csf_fail_import_row_for_attempt` leaves a coherent terminal row: `error` status,
-- `failed` outcome, and permanent lineage naming the attempt that could not write it.
-- What did not exist was any legal way forward. Legacy `error -> skipped` cannot
-- satisfy the lineage constraint, and nothing could reopen the row for another try, so
-- a single deterministic failure permanently pinned the logical commit to
-- `partially_completed`.
--
-- Both edges live here, both are fenced, and both keep the failed attempt intact: its
-- identity moves to `commit_last_failed_attempt_id` rather than being cleared, and the
-- attempt row itself is immutable already. A retry does not reuse the old attempt --
-- it releases the row so the *next* claim, with its own attempt number and its own
-- correlation, can try it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_settle_failed_import_row(
  p_organization_id uuid,
  p_import_row_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_reason_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_preview_job_id uuid;
  v_code text;
  v_running integer;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Deciding a failed CSF import row requires the acting officer.'
      USING ERRCODE = '23502';
  END IF;
  IF p_decision NOT IN ('retry', 'skip') THEN
    RAISE EXCEPTION 'A failed CSF import row may only be retried or skipped.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor_for_row(
    p_organization_id, p_actor_user_id, p_import_row_id
  );

  -- Resolved unlocked purely to find the coordinate, then everything is re-read under
  -- the canonical lock order.
  SELECT import_row.job_id INTO v_preview_job_id
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found.' USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_lock_import_commit_coordinate(
    p_organization_id, v_preview_job_id, true
  );

  SELECT * INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id;

  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.organization_id = p_organization_id
    AND commit_job.mode = 'commit'
    AND commit_job.preview_job_id = v_row.job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This CSF import row has no commit to decide.' USING ERRCODE = '23503';
  END IF;

  -- Two shapes arrive here, and both are decidable:
  --
  --   * an attempt tried the row and the database refused it, so there is lineage; and
  --   * an officer reconciled an unknown outcome as *not written*, so there is a
  --     reconciliation on the record and deliberately no lineage -- no attempt wrote it.
  --
  -- Requiring lineage refused the second shape outright, which left it with no retry, no
  -- skip, hidden from the recovery projection, excluded from the commit worklist, and
  -- counted as unresolved by finalize forever. It also made the officer copy promising a
  -- retry a lie.
  IF v_row.commit_outcome_state <> 'failed' OR v_row.import_status <> 'error' THEN
    RETURN jsonb_build_object(
      'settled', false,
      'outcomeState', v_row.commit_outcome_state,
      'importStatus', v_row.import_status,
      'reason', 'not_a_decidable_failure'
    );
  END IF;

  -- No writer may be running. Releasing a row while an attempt holds the fence would
  -- put it back into a worklist that attempt has already paged past.
  SELECT count(*) INTO v_running
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  WHERE attempt.commit_job_id = v_commit.id
    AND attempt.status = 'running'
    AND attempt.lease_expires_at > now();
  IF v_running > 0 THEN
    RAISE EXCEPTION
      'This CSF import is being committed right now; decide its failed rows once that attempt finishes.'
      USING ERRCODE = '55P03';
  END IF;

  v_code := plugin_data.csf_bounded_reason_code(
    p_reason_code,
    CASE WHEN p_decision = 'retry' THEN 'officer_requested_retry' ELSE 'officer_skipped_failed_row' END
  );

  IF p_decision = 'retry' THEN
    -- Back to the frozen decision, not to an unreviewed one: every commit_frozen_*
    -- column is left exactly as the first claim wrote it, so the retry commits the
    -- decision an officer actually approved.
    UPDATE plugin_data.csf_sheet_import_rows
    SET import_status = 'pending',
        errors = ARRAY[]::text[],
        commit_last_failed_attempt_id = commit_attempt_id,
        commit_attempt_id = NULL,
        commit_retry_count = commit_retry_count + 1,
        commit_outcome_state = 'frozen',
        commit_outcome_code = NULL,
        commit_outcome_note = NULL,
        commit_outcome_correlation_id = NULL,
        commit_outcome_resolution = NULL,
        commit_outcome_resolved_by = NULL,
        commit_outcome_resolved_at = NULL,
        commit_intent_attempt_id = NULL,
        commit_intent_correlation_id = NULL,
        commit_intent_started_at = NULL
    WHERE organization_id = p_organization_id
      AND id = p_import_row_id;
  ELSE
    -- Terminal skip. The outcome stays `failed` -- it did fail -- and the row leaves
    -- the import as skipped, so the logical commit can finish honestly without
    -- pretending this row was written.
    UPDATE plugin_data.csf_sheet_import_rows
    SET import_status = 'skipped',
        commit_last_failed_attempt_id = commit_attempt_id,
        commit_attempt_id = NULL,
        commit_retry_count = commit_retry_count + 1,
        commit_outcome_code = v_code,
        commit_outcome_resolution = 'terminally_skipped',
        commit_outcome_resolved_by = p_actor_user_id,
        commit_outcome_resolved_at = now()
    WHERE organization_id = p_organization_id
      AND id = p_import_row_id;
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    source_type, source_id, after_data
  ) VALUES (
    p_organization_id, p_actor_user_id, 'sheet_import.failed_row_settled',
    'csf_sheet_import_rows', p_import_row_id,
    'sheet_import', v_row.source_id::text,
    jsonb_build_object(
      'decision', p_decision,
      'reasonCode', v_code,
      'commitJobId', v_commit.id,
      -- The attempt that failed stays nameable. That is the immutable prior evidence.
      'failedAttemptId', v_row.commit_attempt_id,
      'retryCount', v_row.commit_retry_count + 1,
      -- A retry clears the row's live reconciliation fields so the row can be attempted
      -- again, so the decision being superseded is carried into the append-only ledger
      -- here. Between this event and the `sheet_import.outcome_reconciled` event that
      -- preceded it, the whole history of the row's disposition stays reconstructible.
      'priorOutcomeState', v_row.commit_outcome_state,
      'priorResolution', v_row.commit_outcome_resolution,
      'priorResolvedBy', v_row.commit_outcome_resolved_by,
      'priorResolvedAt', v_row.commit_outcome_resolved_at,
      'priorOutcomeCorrelationId', v_row.commit_outcome_correlation_id
    )
  );

  RETURN jsonb_build_object(
    'settled', true,
    'decision', p_decision,
    'outcomeState', CASE WHEN p_decision = 'retry' THEN 'frozen' ELSE 'failed' END,
    'importStatus', CASE WHEN p_decision = 'retry' THEN 'pending' ELSE 'skipped' END,
    'failedAttemptId', v_row.commit_attempt_id,
    'reasonCode', v_code
  );
END;
$$;

-- Finalize only the active attempt, from authoritative complete counts.
CREATE OR REPLACE FUNCTION plugin_data.csf_finalize_import_commit_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_summary jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_total integer;
  v_pending integer;
  v_unresolved integer;
  v_unknown integer;
  v_without_attempt integer;
  v_committed integer;
  v_in_flight integer;
  v_preview_job_id uuid;
  v_status text;
BEGIN
  -- The attempt is resolved with an unlocked read, then the coordinate is locked in
  -- canonical order, then the fence is asserted under those locks. Asserting first
  -- and locking afterwards -- attempt, then commit job -- is the inverted order that
  -- deadlocked against a concurrent takeover.
  SELECT commit_job.preview_job_id INTO v_preview_job_id
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  JOIN plugin_data.csf_sheet_import_commit_attempts AS attempt
    ON attempt.commit_job_id = commit_job.id
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id;
  IF NOT FOUND OR v_preview_job_id IS NULL THEN
    RAISE EXCEPTION 'CSF commit attempt was not found.' USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_lock_import_commit_coordinate(
    p_organization_id, v_preview_job_id, false
  );

  v_attempt := plugin_data.csf_assert_active_import_commit_attempt(
    p_organization_id, p_attempt_id
  );

  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.id = v_attempt.commit_job_id;

  SELECT
    count(*),
    count(*) FILTER (WHERE import_status = 'pending'),
    count(*) FILTER (WHERE import_status IN ('ambiguous', 'conflict', 'duplicate', 'error')),
    count(*) FILTER (WHERE commit_outcome_state IN ('unknown', 'historical_unknown')),
    -- A row claiming a *successful write* with nothing to back it. Deliberately
    -- narrower than "any terminal row with no lineage": an officer-decided row is
    -- legitimately terminal without attempt lineage -- a reconciliation that found no
    -- write, or a terminally skipped failure -- and counting those as fabricated
    -- writes pinned the logical commit to `partially_completed` forever, which is the
    -- other half of the stranded-row defect.
    count(*) FILTER (
      WHERE commit_outcome_state = 'succeeded'
        AND commit_attempt_id IS NULL
        AND commit_outcome_resolution IS NULL
    ),
    count(*) FILTER (WHERE import_status IN ('created', 'updated')),
    count(*) FILTER (WHERE commit_outcome_state = 'in_flight')
  INTO v_total, v_pending, v_unresolved, v_unknown, v_without_attempt, v_committed, v_in_flight
  FROM plugin_data.csf_sheet_import_rows
  WHERE organization_id = p_organization_id
    AND job_id = v_commit.preview_job_id;

  -- Any row still recorded in flight at finalize time never reported back. It is
  -- promoted to a review-blocking unknown here rather than being left to look like
  -- work in progress on a commit that has finished.
  IF v_in_flight > 0 THEN
    UPDATE plugin_data.csf_sheet_import_rows
    SET commit_outcome_state = 'unknown',
        commit_outcome_unresolved = true,
        commit_outcome_code = 'intent_unreported_at_finalize',
        commit_outcome_correlation_id = coalesce(commit_intent_correlation_id, v_attempt.correlation_id),
        commit_outcome_note = 'This row was still recorded in flight when the import finished.'
    WHERE organization_id = p_organization_id
      AND job_id = v_commit.preview_job_id
      AND commit_outcome_state = 'in_flight';
    v_unknown := v_unknown + v_in_flight;
  END IF;

  IF v_unknown > 0 OR v_without_attempt > 0 OR v_pending > 0 OR v_unresolved > 0 THEN
    v_status := 'partially_completed';
  ELSIF v_commit.snapshot_row_count IS NOT NULL AND v_total <> v_commit.snapshot_row_count THEN
    v_status := 'partially_completed';
  ELSE
    v_status := 'completed';
  END IF;

  UPDATE plugin_data.csf_sheet_import_commit_attempts
  SET status = CASE WHEN v_status = 'completed' THEN 'completed' ELSE 'failed' END,
      lease_expires_at = NULL,
      completed_at = now(),
      failure_reason = CASE
        WHEN v_status = 'completed' THEN NULL
        ELSE 'the preview was not fully accounted for by this attempt'
      END
  WHERE id = p_attempt_id;

  UPDATE plugin_data.csf_sheet_import_jobs
  SET status = v_status,
      active_commit_attempt_id = NULL,
      summary = coalesce(p_summary, '{}'::jsonb) || jsonb_build_object(
        'previewJobId', v_commit.preview_job_id,
        'commitAttemptId', p_attempt_id,
        'attemptNumber', v_attempt.attempt_number,
        'correlationId', v_attempt.correlation_id,
        'previewRows', v_total,
        'stillPending', v_pending,
        'unresolved', v_unresolved,
        'unknownOutcomes', v_unknown,
        'writtenWithoutAttempt', v_without_attempt,
        'committed', v_committed
      ),
      committed_at = now(),
      completed_at = now(),
      updated_at = now()
  WHERE id = v_commit.id;

  -- Source health is set here, with the source already locked last by the coordinate
  -- helper, rather than by the action after finalize returned. An action-side update
  -- was reachable by a worker that had already lost the fence, so a stale process
  -- could mark a source healthy after a takeover had marked it as needing attention.
  IF v_commit.source_id IS NOT NULL THEN
    UPDATE plugin_data.csf_sheet_sources
    SET sync_status = CASE WHEN v_status = 'completed' THEN 'healthy' ELSE 'needs_attention' END,
        last_sync_status = CASE WHEN v_status = 'completed' THEN 'commit_completed' ELSE 'commit_incomplete' END,
        last_sync_error = CASE WHEN v_status = 'completed' THEN NULL ELSE 'commit_incomplete' END,
        last_committed_at = now(),
        last_synced_at = CASE WHEN v_status = 'completed' THEN now() ELSE last_synced_at END,
        updated_at = now()
    WHERE organization_id = p_organization_id
      AND id = v_commit.source_id;
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    correlation_id, source_type, source_id, after_data
  ) VALUES (
    p_organization_id, v_commit.commit_actor_user_id, 'sheet_import.commit_finalized',
    'csf_sheet_import_jobs', v_commit.id,
    v_attempt.correlation_id, 'sheet_import', v_commit.source_id::text,
    jsonb_build_object(
      'previewJobId', v_commit.preview_job_id,
      'commitAttemptId', p_attempt_id,
      'attemptNumber', v_attempt.attempt_number,
      'status', v_status,
      'previewRows', v_total,
      'committed', v_committed,
      'unknownOutcomes', v_unknown,
      'writtenWithoutAttempt', v_without_attempt
    )
  );

  RETURN jsonb_build_object(
    'commitJobId', v_commit.id,
    'attemptId', p_attempt_id,
    'status', v_status,
    'previewRows', v_total,
    'stillPending', v_pending,
    'unresolved', v_unresolved,
    'unknownOutcomes', v_unknown,
    'writtenWithoutAttempt', v_without_attempt,
    'committed', v_committed
  );
END;
$$;

-- One attempt-scoped abort for every failure path.
--
-- Verifies ownership first and returns a bounded no-op when it has been lost, so
-- an expired worker cannot overwrite the state of the attempt that took over, and
-- cannot downgrade a logical commit that already finished.
CREATE OR REPLACE FUNCTION plugin_data.csf_abort_import_commit_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_reason_code text,
  p_detail text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_preview_job_id uuid;
  v_committed integer;
  v_stranded integer := 0;
  -- Only a closed reason code and, at most, already-safe prose become durable.
  v_code text := plugin_data.csf_bounded_reason_code(p_reason_code, 'commit_failed');
  v_detail text := plugin_data.csf_bounded_failure_detail(p_detail);
  v_status text;
BEGIN
  SELECT commit_job.preview_job_id INTO v_preview_job_id
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  JOIN plugin_data.csf_sheet_import_commit_attempts AS attempt
    ON attempt.commit_job_id = commit_job.id
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id;
  IF NOT FOUND OR v_preview_job_id IS NULL THEN
    RETURN jsonb_build_object('aborted', false, 'reason', 'attempt_not_found');
  END IF;

  -- Canonical order, so aborting cannot deadlock against a claim or a finalize.
  PERFORM plugin_data.csf_lock_import_commit_coordinate(
    p_organization_id, v_preview_job_id, false
  );

  SELECT * INTO v_attempt
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('aborted', false, 'reason', 'attempt_not_found');
  END IF;

  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.id = v_attempt.commit_job_id;

  -- Ownership lost, or already finished: a bounded no-op, never a write.
  IF v_attempt.status <> 'running'
    OR v_attempt.lease_expires_at IS NULL
    OR v_attempt.lease_expires_at <= now()
    OR v_commit.active_commit_attempt_id IS DISTINCT FROM v_attempt.id
  THEN
    RETURN jsonb_build_object('aborted', false, 'reason', 'ownership_lost');
  END IF;
  IF v_commit.status = 'completed' THEN
    RETURN jsonb_build_object('aborted', false, 'reason', 'already_completed');
  END IF;

  -- Every write this attempt started and never reported becomes a durable unknown.
  -- Leaving them in flight is what let the next attempt pick them up and write a
  -- second time; marking them failed would be asserting something the abort cannot
  -- know. The correlation kept here is the intent's own, so an officer reconciling
  -- later is deciding about this exact attempt.
  UPDATE plugin_data.csf_sheet_import_rows
  SET commit_outcome_state = 'unknown',
      commit_outcome_unresolved = true,
      commit_outcome_code = 'attempt_aborted_in_flight',
      commit_outcome_correlation_id = coalesce(commit_intent_correlation_id, v_attempt.correlation_id),
      commit_outcome_note = 'This row was still being written when the import was aborted.'
  WHERE organization_id = p_organization_id
    AND job_id = v_commit.preview_job_id
    AND commit_outcome_state = 'in_flight'
    AND commit_intent_attempt_id = p_attempt_id;
  GET DIAGNOSTICS v_stranded = ROW_COUNT;

  SELECT count(*) INTO v_committed
  FROM plugin_data.csf_sheet_import_rows
  WHERE organization_id = p_organization_id
    AND job_id = v_commit.preview_job_id
    AND import_status IN ('created', 'updated');

  v_status := CASE WHEN v_committed > 0 OR v_stranded > 0 THEN 'partially_completed' ELSE 'failed' END;

  UPDATE plugin_data.csf_sheet_import_commit_attempts
  SET status = 'failed',
      lease_expires_at = NULL,
      completed_at = now(),
      failure_reason = v_code
  WHERE id = p_attempt_id;

  UPDATE plugin_data.csf_sheet_import_jobs
  SET status = v_status,
      active_commit_attempt_id = NULL,
      error_message = v_code,
      completed_at = now(),
      updated_at = now()
  WHERE id = v_commit.id;

  -- Source health moves with the job, in the same transaction, with the source
  -- already locked last by the coordinate helper.
  IF v_commit.source_id IS NOT NULL THEN
    UPDATE plugin_data.csf_sheet_sources
    SET sync_status = 'needs_attention',
        last_sync_status = 'commit_failed',
        last_sync_error = v_code,
        updated_at = now()
    WHERE organization_id = p_organization_id
      AND id = v_commit.source_id;
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    correlation_id, source_type, source_id, after_data
  ) VALUES (
    p_organization_id, v_commit.commit_actor_user_id, 'sheet_import.commit_aborted',
    'csf_sheet_import_jobs', v_commit.id,
    v_attempt.correlation_id, 'sheet_import', v_commit.source_id::text,
    jsonb_build_object(
      'previewJobId', v_commit.preview_job_id,
      'commitAttemptId', p_attempt_id,
      'attemptNumber', v_attempt.attempt_number,
      'reasonCode', v_code,
      'detail', v_detail,
      'strandedRows', v_stranded,
      'committed', v_committed,
      'status', v_status
    )
  );

  RETURN jsonb_build_object(
    'aborted', true,
    'commitJobId', v_commit.id,
    'attemptId', p_attempt_id,
    'committed', v_committed,
    'strandedRows', v_stranded,
    'reasonCode', v_code,
    'status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_commit_import_row_for_attempt(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_import_row_for_attempt(uuid, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_import_row_for_attempt(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
-- Internal helper: reachable only from the owned wrappers above.
REVOKE ALL ON FUNCTION plugin_data.csf_fail_import_row_for_attempt(uuid, uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_fail_import_row_for_attempt(uuid, uuid, uuid, text, text, boolean)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_flag_import_row_outcome_unknown(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_flag_import_row_outcome_unknown(uuid, uuid, uuid, text, text)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_import_row_outcome(uuid, uuid, uuid, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reconcile_import_row_outcome(uuid, uuid, uuid, text, uuid, text, text)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_accept_historical_import_outcome(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_accept_historical_import_outcome(uuid, uuid, uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_recover_stale_import_intents(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_recover_stale_import_intents(uuid, uuid, uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_settle_failed_import_row(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_settle_failed_import_row(uuid, uuid, uuid, text, text)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_retire_expired_staging_objects(integer)
  FROM PUBLIC, anon, authenticated;
-- Internal: reached only from the bounded sweeper.
REVOKE ALL ON FUNCTION plugin_data.csf_finalize_import_commit_attempt(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finalize_import_commit_attempt(uuid, uuid, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_abort_import_commit_attempt(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_abort_import_commit_attempt(uuid, uuid, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- The fenced wrapper is the only reachable central import path.
--
-- service_role loses EXECUTE on the three legacy central row RPCs. The wrapper is
-- SECURITY DEFINER and owned, so it still calls them; nothing else can. Their
-- bodies are untouched, and the contextual attendance and partner-club RPCs keep
-- their grants because they commit a whole batch in one transaction and are
-- deliberately outside attempt semantics.
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION plugin_data.csf_import_application_response_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, uuid
) FROM service_role;

REVOKE EXECUTE ON FUNCTION plugin_data.csf_import_student_roster_row(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, text, uuid
) FROM service_role;

REVOKE EXECUTE ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM service_role;

-- ---------------------------------------------------------------------------
-- Legacy lineage stays truthful, and contextual history is not touched.
--
-- Existing central commit jobs predate the attempt ledger, so their rows keep a
-- null commit_attempt_id and the job records that its attempt history is unknown.
-- Attendance and partner-club jobs are outside attempt semantics entirely and are
-- deliberately not annotated.
-- ---------------------------------------------------------------------------

UPDATE plugin_data.csf_sheet_import_jobs
SET summary = summary || jsonb_build_object('commitAttemptHistory', 'unknown_pre_ledger')
WHERE mode = 'commit'
  AND source_type IN ('application_responses', 'student_roster', 'class_history')
  AND NOT (summary ? 'commitAttemptHistory');

-- Rows a pre-ledger commit already wrote are `historical_unknown`, not `succeeded`.
--
-- They have a terminal import_status, so something was written, but no begin-intent,
-- no frozen decision, and no attempt lineage, so nothing recorded *what* was written
-- or by whom. Calling them `succeeded` would be inventing provenance the ledger was
-- built to require; calling them `unknown` would put them into the live
-- reconciliation queue, where an officer would be asked for a correlation that does
-- not exist. They get their own state and their own narrow acceptance RPC.
--
-- Scoped to central record imports whose rows were written by a commit that predates
-- the ledger. Contextual attendance and partner-club rows are outside attempt
-- semantics entirely and are left alone.
UPDATE plugin_data.csf_sheet_import_rows AS import_row
SET commit_outcome_state = 'historical_unknown',
    commit_outcome_unresolved = true,
    commit_outcome_code = 'pre_ledger_commit',
    commit_outcome_note = 'This row was imported before commit attempts were recorded.'
WHERE import_row.commit_outcome_state = 'not_started'
  AND import_row.commit_attempt_id IS NULL
  AND import_row.import_status IN ('created', 'updated')
  AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_sheet_import_jobs AS commit_job
    WHERE commit_job.organization_id = import_row.organization_id
      AND commit_job.preview_job_id = import_row.job_id
      AND commit_job.mode = 'commit'
      AND commit_job.source_type IN ('application_responses', 'student_roster', 'class_history')
  );

DO $historical_report$
DECLARE
  v_historical integer;
BEGIN
  SELECT count(*) INTO v_historical
  FROM plugin_data.csf_sheet_import_rows
  WHERE commit_outcome_state = 'historical_unknown';

  IF v_historical > 0 THEN
    RAISE NOTICE
      'CSF import recovery: % row(s) were committed before the attempt ledger existed and are recorded as historical_unknown. They block finalization of their preview until an officer accepts them through plugin_data.csf_accept_historical_import_outcome.',
      v_historical;
  END IF;
END
$historical_report$;

-- ---------------------------------------------------------------------------
-- The owned preview-construction surface.
--
-- Everything in this migration rests on "the fenced wrapper is the only reachable
-- central commit path", and that was false in the only way that matters: `service_role`
-- held `GRANT ALL` on `csf_sheet_import_jobs` and `csf_sheet_import_rows`, inherited
-- from an older `ALTER DEFAULT PRIVILEGES` rule on `plugin_data`. Revoking EXECUTE on
-- the legacy row RPCs did nothing about that. A compromised or buggy service caller
-- could write a commit job, a frozen decision, an attempt link or a terminal row status
-- directly, and the triggers would have accepted several of those as valid-looking
-- transitions.
--
-- The base tables therefore become SELECT-only for `service_role`, which means the
-- legitimate preview writers -- attendance, partner member/form/audit, and the central
-- Sheets workflow -- need a way in. That is these three functions: open one preview job,
-- append bounded immutable rows to it, then seal or fail it. Column grants were
-- considered and rejected: the columns the writers touch include `status`, `summary` and
-- `import_status`, which are exactly the ones a forged transition needs, so a column
-- grant would have handed over the boundary it was supposed to defend.
--
-- What a caller may state is deliberately narrow. It may not name a commit attempt, a
-- commit status, a frozen target, a retry or settlement counter, an outcome
-- reconciliation, or a terminal row state; `mode` is always `preview` and `initiated_by`
-- is always the validated actor. Payloads are bounded so this is not an arbitrary SQL
-- tunnel.
-- ---------------------------------------------------------------------------

-- Bounds. Generous enough for the 25,000-row contract in chunks, small enough that one
-- call cannot be used to push an unbounded document through the boundary.
CREATE OR REPLACE FUNCTION plugin_data.csf_assert_preview_payload_bounds(
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  c_max_rows constant integer := 500;
  c_max_bytes constant integer := 4000000;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'CSF preview rows must be a JSON array.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'CSF preview rows must not be empty.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) > c_max_rows THEN
    RAISE EXCEPTION
      'A CSF preview chunk may carry at most % rows; this one carries %.',
      c_max_rows, jsonb_array_length(p_rows)
      USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_rows::text) > c_max_bytes THEN
    RAISE EXCEPTION 'This CSF preview chunk is too large to accept.' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- Open exactly one preview job, with its immutable source coordinates.
CREATE OR REPLACE FUNCTION plugin_data.csf_open_import_preview(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_source_type text,
  p_source_file_id text,
  p_source_file_name text,
  p_source_sheet_tab text,
  p_source_range text,
  p_source_modified_at timestamptz,
  p_source_file_metadata jsonb,
  p_mapping_snapshot jsonb,
  p_mapping_version integer,
  p_retry_of_job_id uuid,
  p_source_content_hash text,
  p_snapshot_hash text,
  p_snapshot_row_count integer,
  p_snapshot_contract_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_job_id uuid;
  v_correlation uuid;
BEGIN
  IF p_organization_id IS NULL OR p_source_id IS NULL THEN
    RAISE EXCEPTION 'A CSF preview needs an organization and a source.' USING ERRCODE = '22023';
  END IF;
  -- The actor is validated, not decorative: `initiated_by` is provenance an officer is
  -- later held to, so it may not name somebody who is not a real user.
  IF p_actor_user_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM auth.users AS actor WHERE actor.id = p_actor_user_id)
  THEN
    RAISE EXCEPTION 'A CSF preview must record the officer who started it.'
      USING ERRCODE = '23503';
  END IF;

  -- Exact tenant and source relationship, read under a lock so the source cannot change
  -- kind between validation and insert.
  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;

  -- Source kind is the source's own fact, and both statements of it must agree.
  IF p_source_type IS DISTINCT FROM v_source.source_type
    OR nullif(btrim(coalesce(v_source.settings->>'sourceKind', '')), '')
      IS DISTINCT FROM v_source.source_type
  THEN
    RAISE EXCEPTION
      'This CSF source disagrees with itself or with the requested preview about its source type.'
      USING ERRCODE = '23514';
  END IF;

  -- Immutable shape checks. These columns are frozen the moment the row exists, so a
  -- malformed value can never be corrected afterwards.
  IF jsonb_typeof(coalesce(p_source_file_metadata, 'null'::jsonb)) <> 'object'
    OR jsonb_typeof(coalesce(p_mapping_snapshot, 'null'::jsonb)) <> 'object'
  THEN
    RAISE EXCEPTION 'CSF preview provenance must be recorded as JSON objects.'
      USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_source_file_metadata::text) > 200000
    OR octet_length(p_mapping_snapshot::text) > 1000000
  THEN
    RAISE EXCEPTION 'CSF preview provenance is too large to accept.' USING ERRCODE = '22023';
  END IF;
  IF p_mapping_version IS NULL OR p_mapping_version < 1 THEN
    RAISE EXCEPTION 'A CSF preview needs a mapping version.' USING ERRCODE = '22023';
  END IF;
  IF p_source_content_hash IS NOT NULL AND p_source_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A CSF preview source digest must be a sha256 hex digest.'
      USING ERRCODE = '22023';
  END IF;
  IF p_snapshot_hash IS NOT NULL AND p_snapshot_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A CSF preview snapshot digest must be a sha256 hex digest.'
      USING ERRCODE = '22023';
  END IF;
  IF p_snapshot_row_count IS NOT NULL AND p_snapshot_row_count < 0 THEN
    RAISE EXCEPTION 'A CSF preview row count cannot be negative.' USING ERRCODE = '22023';
  END IF;

  -- A retry must name a preview of this organization, never a commit job.
  IF p_retry_of_job_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM plugin_data.csf_sheet_import_jobs AS prior
      WHERE prior.organization_id = p_organization_id
        AND prior.id = p_retry_of_job_id
        AND prior.mode = 'preview'
    )
  THEN
    RAISE EXCEPTION 'A CSF preview retry must name an earlier preview of this organization.'
      USING ERRCODE = '23503';
  END IF;

  -- `mode` and `status` are set here, not accepted. This is the whole reason the caller
  -- no longer holds INSERT: a caller that can state `mode` can state `commit`.
  INSERT INTO plugin_data.csf_sheet_import_jobs (
    organization_id, source_id, initiated_by, mode, status, source_type,
    source_file_id, source_file_name, source_sheet_tab, source_range,
    source_modified_at, source_file_metadata, mapping_snapshot, mapping_version,
    retry_of_job_id, source_content_hash, snapshot_hash, snapshot_row_count,
    snapshot_contract_version, started_at
  ) VALUES (
    p_organization_id, p_source_id, p_actor_user_id, 'preview', 'running', v_source.source_type,
    p_source_file_id, p_source_file_name, p_source_sheet_tab, p_source_range,
    p_source_modified_at, coalesce(p_source_file_metadata, '{}'::jsonb),
    coalesce(p_mapping_snapshot, '{}'::jsonb), p_mapping_version,
    p_retry_of_job_id, p_source_content_hash, p_snapshot_hash, p_snapshot_row_count,
    p_snapshot_contract_version, now()
  ) RETURNING id, correlation_id INTO v_job_id, v_correlation;

  RETURN jsonb_build_object(
    'previewJobId', v_job_id,
    'correlationId', v_correlation,
    'sourceType', v_source.source_type,
    'status', 'running'
  );
END;
$$;

-- Append one bounded chunk of immutable preview rows.
--
-- Replay-safe by coordinate: an identical chunk sent twice is accepted and reports what
-- it already found, while a chunk that contradicts a stored row's digest is refused.
-- That is the difference between a retried request and a rewritten preview.
CREATE OR REPLACE FUNCTION plugin_data.csf_append_import_preview_rows(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_preview_job_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_allowed_keys constant text[] := ARRAY[
    'source_id', 'cohort_id', 'term_id', 'sheet_tab_name', 'row_number', 'source_range',
    'raw_data', 'normalized_data', 'row_hash', 'matched_profile_id',
    'matched_application_id', 'import_status', 'errors', 'warnings',
    'retry_of_row_id', 'source_modified_at', 'mapping_version'
  ];
  -- Non-terminal only. A preview row may arrive already needing an officer decision, but
  -- it may never arrive claiming a commit outcome.
  c_allowed_status constant text[] := ARRAY[
    'pending', 'ambiguous', 'conflict', 'duplicate', 'error', 'skipped'
  ];
  v_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_row jsonb;
  v_key text;
  v_status text;
  v_inserted integer := 0;
  v_replayed integer := 0;
  v_existing plugin_data.csf_sheet_import_rows%ROWTYPE;
BEGIN
  PERFORM plugin_data.csf_assert_preview_payload_bounds(p_rows);

  IF p_actor_user_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM auth.users AS actor WHERE actor.id = p_actor_user_id)
  THEN
    RAISE EXCEPTION 'Appending CSF preview rows requires the acting officer.'
      USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_job
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = p_preview_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF preview job was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;
  -- Only a preview still being constructed accepts rows. A sealed preview is immutable,
  -- and a commit job never accepts rows at all.
  IF v_job.mode <> 'preview' THEN
    RAISE EXCEPTION 'Only a CSF preview job may receive preview rows.' USING ERRCODE = '23514';
  END IF;
  IF v_job.status <> 'running' THEN
    RAISE EXCEPTION
      'This CSF preview is no longer being constructed; its rows are sealed.'
      USING ERRCODE = '55000';
  END IF;
  IF v_job.initiated_by IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION
      'Only the officer who started this CSF preview may add rows to it.'
      USING ERRCODE = '42501';
  END IF;

  FOR v_row IN SELECT jsonb_array_elements(p_rows)
  LOOP
    IF jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'Each CSF preview row must be a JSON object.' USING ERRCODE = '22023';
    END IF;
    -- Closed shape. A key nobody reviewed cannot arrive by being added upstream, and in
    -- particular none of the commit, freeze, intent, outcome, retry or settlement columns
    -- is nameable here at all.
    FOR v_key IN SELECT jsonb_object_keys(v_row)
    LOOP
      IF NOT (v_key = ANY (c_allowed_keys)) THEN
        RAISE EXCEPTION 'A CSF preview row may not set "%".', v_key USING ERRCODE = '23514';
      END IF;
    END LOOP;

    v_status := coalesce(nullif(btrim(coalesce(v_row->>'import_status', '')), ''), 'pending');
    IF NOT (v_status = ANY (c_allowed_status)) THEN
      RAISE EXCEPTION
        'A CSF preview row may not be created with the terminal status "%".', v_status
        USING ERRCODE = '23514';
    END IF;
    IF nullif(btrim(coalesce(v_row->>'sheet_tab_name', '')), '') IS NULL
      OR coalesce(v_row->>'row_number', '') !~ '^[1-9][0-9]*$'
    THEN
      RAISE EXCEPTION 'A CSF preview row needs a sheet tab and a positive row number.'
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(coalesce(v_row -> 'raw_data', '{}'::jsonb)) <> 'object'
      OR jsonb_typeof(coalesce(v_row -> 'normalized_data', '{}'::jsonb)) <> 'object'
    THEN
      RAISE EXCEPTION 'CSF preview row evidence must be recorded as JSON objects.'
        USING ERRCODE = '22023';
    END IF;

    -- Exact tenant/source/cohort/term relationships. A row may not reach across tenants
    -- through any of its four foreign coordinates.
    IF nullif(v_row->>'source_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_sheet_sources AS source
        WHERE source.organization_id = p_organization_id
          AND source.id = (v_row->>'source_id')::uuid
          AND source.id = v_job.source_id
      )
    THEN
      RAISE EXCEPTION 'A CSF preview row must name the source its preview was taken from.'
        USING ERRCODE = '23503';
    END IF;
    IF nullif(v_row->>'cohort_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_cohorts AS cohort
        WHERE cohort.organization_id = p_organization_id
          AND cohort.id = (v_row->>'cohort_id')::uuid
      )
    THEN
      RAISE EXCEPTION 'A CSF preview row must name a class of this organization.'
        USING ERRCODE = '23503';
    END IF;
    IF nullif(v_row->>'term_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_terms AS term
        WHERE term.organization_id = p_organization_id
          AND term.id = (v_row->>'term_id')::uuid
      )
    THEN
      RAISE EXCEPTION 'A CSF preview row must name a semester of this organization.'
        USING ERRCODE = '23503';
    END IF;
    IF nullif(v_row->>'matched_profile_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_profiles AS profile
        WHERE profile.organization_id = p_organization_id
          AND profile.id = (v_row->>'matched_profile_id')::uuid
      )
    THEN
      RAISE EXCEPTION 'A CSF preview row must name a member of this organization.'
        USING ERRCODE = '23503';
    END IF;

    -- Replay, decided by coordinate rather than by hoping the caller retries cleanly.
    SELECT * INTO v_existing
    FROM plugin_data.csf_sheet_import_rows AS existing
    WHERE existing.job_id = p_preview_job_id
      AND existing.sheet_tab_name = btrim(v_row->>'sheet_tab_name')
      AND existing.row_number = (v_row->>'row_number')::integer;
    IF FOUND THEN
      IF v_existing.row_hash IS DISTINCT FROM nullif(v_row->>'row_hash', '') THEN
        RAISE EXCEPTION
          'A CSF preview row already exists at %:% with a different digest; the preview would not describe one read of the source.',
          btrim(v_row->>'sheet_tab_name'), v_row->>'row_number'
          USING ERRCODE = '23505';
      END IF;
      v_replayed := v_replayed + 1;
      CONTINUE;
    END IF;

    INSERT INTO plugin_data.csf_sheet_import_rows (
      organization_id, job_id, source_id, cohort_id, term_id, sheet_tab_name, row_number,
      source_range, raw_data, normalized_data, row_hash, matched_profile_id,
      matched_application_id, import_status, errors, warnings, retry_of_row_id,
      source_modified_at, mapping_version
    ) VALUES (
      -- Tenant and job are taken from the locked job, never from the payload.
      p_organization_id, p_preview_job_id,
      nullif(v_row->>'source_id', '')::uuid,
      nullif(v_row->>'cohort_id', '')::uuid,
      nullif(v_row->>'term_id', '')::uuid,
      btrim(v_row->>'sheet_tab_name'),
      (v_row->>'row_number')::integer,
      nullif(v_row->>'source_range', ''),
      coalesce(v_row -> 'raw_data', '{}'::jsonb),
      coalesce(v_row -> 'normalized_data', '{}'::jsonb),
      nullif(v_row->>'row_hash', ''),
      nullif(v_row->>'matched_profile_id', '')::uuid,
      nullif(v_row->>'matched_application_id', '')::uuid,
      v_status,
      coalesce(
        (SELECT array_agg(value::text) FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(v_row -> 'errors') = 'array' THEN v_row -> 'errors' ELSE '[]'::jsonb END
        ) AS value),
        ARRAY[]::text[]
      ),
      coalesce(
        (SELECT array_agg(value::text) FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(v_row -> 'warnings') = 'array' THEN v_row -> 'warnings' ELSE '[]'::jsonb END
        ) AS value),
        ARRAY[]::text[]
      ),
      nullif(v_row->>'retry_of_row_id', '')::uuid,
      nullif(v_row->>'source_modified_at', '')::timestamptz,
      coalesce(nullif(v_row->>'mapping_version', '')::integer, v_job.mapping_version)
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'previewJobId', p_preview_job_id,
    'inserted', v_inserted,
    'replayed', v_replayed
  );
END;
$$;

-- Seal a preview, or record that its construction failed.
--
-- Sealing is the only transition out of `running`, and after it the preview's rows are
-- immutable: `csf_append_import_preview_rows` refuses a job that is not `running`, and
-- nothing else can insert into the table at all.
CREATE OR REPLACE FUNCTION plugin_data.csf_seal_import_preview(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_preview_job_id uuid,
  p_status text,
  p_summary jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_rows integer;
BEGIN
  IF p_status NOT IN ('completed', 'needs_resolution') THEN
    RAISE EXCEPTION
      'A CSF preview may only be sealed as completed or needs_resolution.'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p_summary, 'null'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'A CSF preview summary must be a JSON object.' USING ERRCODE = '22023';
  END IF;
  IF octet_length(coalesce(p_summary, '{}'::jsonb)::text) > 100000 THEN
    RAISE EXCEPTION 'This CSF preview summary is too large to accept.' USING ERRCODE = '22023';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Sealing a CSF preview requires the acting officer.' USING ERRCODE = '23502';
  END IF;

  SELECT * INTO v_job
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = p_preview_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF preview job was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;
  IF v_job.mode <> 'preview' THEN
    RAISE EXCEPTION 'Only a CSF preview job may be sealed.' USING ERRCODE = '23514';
  END IF;
  IF v_job.status <> 'running' THEN
    RETURN jsonb_build_object(
      'sealed', false, 'status', v_job.status, 'reason', 'not_under_construction'
    );
  END IF;
  IF v_job.initiated_by IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Only the officer who started this CSF preview may seal it.'
      USING ERRCODE = '42501';
  END IF;

  -- The stored row count is authoritative, counted here rather than reported by the
  -- caller, so a sealed preview always states how many rows it actually holds.
  SELECT count(*) INTO v_rows
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.job_id = p_preview_job_id;

  UPDATE plugin_data.csf_sheet_import_jobs
  SET status = p_status,
      summary = coalesce(p_summary, '{}'::jsonb) || jsonb_build_object('rows', v_rows),
      completed_at = now(),
      updated_at = now()
  WHERE id = p_preview_job_id;

  RETURN jsonb_build_object('sealed', true, 'status', p_status, 'rows', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_fail_import_preview(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_preview_job_id uuid,
  p_reason_code text,
  p_detail text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_code text := plugin_data.csf_bounded_reason_code(p_reason_code, 'preview_failed');
BEGIN
  SELECT * INTO v_job
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = p_preview_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('failed', false, 'reason', 'not_found');
  END IF;
  IF v_job.mode <> 'preview' THEN
    RAISE EXCEPTION 'Only a CSF preview job may be marked failed here.' USING ERRCODE = '23514';
  END IF;
  -- A sealed preview stays sealed. A failure path that could reopen a completed preview
  -- would be a way to invalidate rows an officer had already reviewed.
  IF v_job.status <> 'running' THEN
    RETURN jsonb_build_object('failed', false, 'status', v_job.status, 'reason', 'already_final');
  END IF;

  UPDATE plugin_data.csf_sheet_import_jobs
  SET status = 'failed',
      -- The durable artifact is a closed code; sanitized prose is appended only if it
      -- survives the same filter every other failure path uses.
      error_message = v_code || coalesce(
        ': ' || plugin_data.csf_bounded_failure_detail(p_detail), ''
      ),
      completed_at = now(),
      updated_at = now()
  WHERE id = p_preview_job_id;

  RETURN jsonb_build_object('failed', true, 'reasonCode', v_code);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_preview_payload_bounds(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_open_import_preview(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, jsonb, jsonb, integer,
  uuid, text, text, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_open_import_preview(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, jsonb, jsonb, integer,
  uuid, text, text, integer, text
) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_append_import_preview_rows(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_append_import_preview_rows(uuid, uuid, uuid, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_seal_import_preview(uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_seal_import_preview(uuid, uuid, uuid, text, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_fail_import_preview(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_fail_import_preview(uuid, uuid, uuid, text, text)
  TO service_role;


-- ===========================================================================
-- WAVE 3, PART 1: the actor argument becomes an authorization boundary.
--
-- Every RPC above takes an actor and, until here, proved only that the supplied
-- UUID exists in `auth.users`. That is not authorization: it is a foreign key.
-- Any caller holding the service role could name any real user and act as them
-- -- open a preview, append rows, seal it, claim a commit, take one over,
-- reconcile an outcome, accept a historical write, settle a failed row -- while
-- `initiated_by` and every audit row recorded a person who did nothing.
--
-- What follows is one assertion, used by every actor-taking entry point, that
-- implements exactly the product's source-scoped import matrix:
--
--   application_responses        -> import_applications
--   student_roster, class_history-> import_members
--   meeting_attendance           -> import_meetings
--   partner_club_audit           -> import_partner_clubs
--
-- and exactly the compatibility grants `scoped-permissions.ts` already encodes,
-- no more: `manage_sheet_sync` and `resolve_imports` for any source, and
-- `manage_partner_clubs` for the partner-club audit alone. Those are legacy
-- custom-role grants; system roles no longer receive them, and this list is
-- frozen against the TypeScript map by an exact parity test.
--
-- The operational "today" is the chapter's calendar date in America/Los_Angeles,
-- matching every other CSF position check in the schema. It is deliberately NOT
-- `current_date`, which is the *session* time zone, and NOT UTC: between 00:00
-- and 07:00/08:00 Pacific, UTC is already tomorrow, so a position that ended
-- yesterday would still authorize during exactly the hours a school district's
-- evening imports run.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_chapter_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (pg_catalog.now() AT TIME ZONE 'America/Los_Angeles')::date;
$$;

COMMENT ON FUNCTION plugin_data.csf_chapter_today() IS
  'The DVHS chapter calendar date in America/Los_Angeles. Not current_date (session time zone) and not UTC: for the seven or eight hours after Pacific midnight those disagree with the chapter''s own day, which is exactly when an expired position would still authorize.';

-- The exact source-type -> permission map. One row per source type, and a source
-- type absent from it is not importable at all.
CREATE OR REPLACE FUNCTION plugin_data.csf_import_source_permission(
  p_source_type text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_source_type
    WHEN 'application_responses' THEN 'import_applications'
    WHEN 'student_roster' THEN 'import_members'
    WHEN 'class_history' THEN 'import_members'
    WHEN 'meeting_attendance' THEN 'import_meetings'
    WHEN 'partner_club_audit' THEN 'import_partner_clubs'
    ELSE NULL
  END;
$$;

-- The intentional compatibility grants, and nothing else.
--
-- These exist because custom roles created before scoped imports may still carry
-- one of them. They are enumerated here rather than pattern-matched so adding a
-- new broad permission cannot silently widen import authority, and so the parity
-- test can compare this list to `canAccessCsfImportSource` element by element.
CREATE OR REPLACE FUNCTION plugin_data.csf_import_compatibility_permissions(
  p_source_type text
)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN plugin_data.csf_import_source_permission(p_source_type) IS NULL
      THEN ARRAY[]::text[]
    WHEN p_source_type = 'partner_club_audit'
      THEN ARRAY['manage_sheet_sync', 'resolve_imports', 'manage_partner_clubs']
    ELSE ARRAY['manage_sheet_sync', 'resolve_imports']
  END;
$$;

-- The assertion itself. Raises 42501 and writes nothing on every denial.
--
-- Order matters and is stated rather than incidental:
--
--   1. Active organization membership is required of EVERY actor, including an
--      organization admin and including the chapter owner. Membership is the
--      tenant boundary; a position is a role *within* a tenant and cannot
--      substitute for belonging to it.
--   2. An active organization admin then bypasses the CSF position and
--      capability checks entirely.
--   3. An explicit, active, in-date CSF `owner` staff position carries owner
--      authority over every import source in its own organization.
--   4. Everyone else needs an active, in-date CSF staff position whose role
--      carries the exact source capability enabled, or one of the compatibility
--      grants above.
--
-- Inactive membership, an expired or not-yet-started position, a disabled
-- permission row, and a grant belonging to a different source all fall through
-- to the raise.
--
-- There is deliberately NO email-addressed bypass here.
--
-- This function used to grant the full source capability to one hard-coded
-- mailbox, `dvhighcsf@gmail.com`, on the strength of `auth.users.email` alone.
-- That made a mutable, self-service user attribute into an authorization fact:
-- anyone who came to hold that address held chapter-owner authority over CSF
-- imports in every organization they could reach, with nothing in
-- `plugin_data` recording that they had been given it. The mailbox is still the
-- chapter's operational address -- it is where notifications reply to -- but an
-- operational address is not a capability. Owner authority is now exactly what
-- step 3 says it is: a row somebody with authority created, that an auditor can
-- read, that expires, and that belongs to one organization.
--
-- Step 1 was also, until this wave, unenforceable as written. It read
--
--     SELECT true, bool_or(member.role = 'admin')
--       INTO v_is_member, v_is_admin
--       FROM public.organization_members WHERE ...
--
-- and an aggregate query with no GROUP BY returns exactly one row even when the
-- FROM produces none. `v_is_member` was therefore the literal `true` for every
-- caller, membership was never actually required of anybody, and the tenant
-- boundary held only by way of the checks that came after it. `count(*) > 0` is
-- an aggregate over the same single scan that is false on an empty match.
CREATE OR REPLACE FUNCTION plugin_data.csf_assert_import_actor(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_type text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_permission text := plugin_data.csf_import_source_permission(p_source_type);
  v_compatibility text[] := plugin_data.csf_import_compatibility_permissions(p_source_type);
  v_today date := plugin_data.csf_chapter_today();
  v_is_member boolean;
  v_is_admin boolean;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A CSF import action requires an organization and an acting officer.'
      USING ERRCODE = '42501';
  END IF;
  IF v_permission IS NULL THEN
    RAISE EXCEPTION 'CSF source type "%" is not an importable source.', coalesce(p_source_type, '<null>')
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS actor WHERE actor.id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'The acting officer for this CSF import is not a known user.'
      USING ERRCODE = '42501';
  END IF;

  -- Step 1. Tenant membership, required of everyone, checked before any bypass.
  -- `count(*) > 0` rather than a literal: see the note above on why the literal
  -- made this branch unreachable.
  SELECT
    count(*) > 0,
    bool_or(member.role = 'admin')
  INTO v_is_member, v_is_admin
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND coalesce(member.status, 'active') = 'active';

  IF NOT coalesce(v_is_member, false) THEN
    RAISE EXCEPTION
      'This officer is not an active member of the organization whose CSF import they are acting on.'
      USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_is_admin, false) THEN
    RETURN pg_catalog.jsonb_build_object(
      'actorUserId', p_actor_user_id,
      'sourceType', p_source_type,
      'permission', v_permission,
      'basis', 'organization_admin'
    );
  END IF;

  -- Step 3. An explicit CSF owner position in THIS organization.
  --
  -- Held to exactly the same lifecycle as any other position -- active, started,
  -- not ended -- because the point of replacing the mailbox bypass was to make
  -- owner authority something that can be granted, audited and withdrawn. An
  -- ended owner position is an ex-owner.
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_staff_positions AS position
    JOIN plugin_data.csf_roles AS role
      ON role.id = position.role_id
     AND role.organization_id = position.organization_id
    WHERE position.organization_id = p_organization_id
      AND position.user_id = p_actor_user_id
      AND position.status = 'active'
      AND (position.starts_at IS NULL OR position.starts_at <= v_today)
      AND (position.ends_at IS NULL OR position.ends_at >= v_today)
      AND (role.role_type = 'owner' OR role.key = 'owner')
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'actorUserId', p_actor_user_id,
      'sourceType', p_source_type,
      'permission', v_permission,
      'basis', 'owner_position'
    );
  END IF;

  -- Step 4. An active, in-date position whose role carries the exact capability,
  -- or one of the enumerated compatibility grants. `enabled = true` is part of
  -- the join: a permission row that exists but is switched off is not a grant.
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_staff_positions AS position
    JOIN plugin_data.csf_role_permissions AS permission
      ON permission.organization_id = position.organization_id
     AND permission.role_id = position.role_id
     AND permission.enabled = true
     AND (
       permission.permission_key = v_permission
       OR permission.permission_key = ANY (v_compatibility)
     )
    WHERE position.organization_id = p_organization_id
      AND position.user_id = p_actor_user_id
      AND position.status = 'active'
      AND (position.starts_at IS NULL OR position.starts_at <= v_today)
      AND (position.ends_at IS NULL OR position.ends_at >= v_today)
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'actorUserId', p_actor_user_id,
      'sourceType', p_source_type,
      'permission', v_permission,
      'basis', 'staff_position'
    );
  END IF;

  RAISE EXCEPTION
    'This officer does not hold the % capability for CSF % imports in this organization.',
    v_permission, p_source_type
    USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_assert_import_actor(uuid, uuid, text) IS
  'The one tenant-scoped import authorization. Requires active organization membership of every actor, checked with count(*) > 0 so an empty match is a denial rather than an aggregate''s single row; an active organization admin then bypasses the CSF position and capability checks; an explicit active in-date CSF owner position carries owner authority within its own organization; everyone else needs an active in-date CSF staff position whose role carries the exact source capability or one of the intentional compatibility grants in scoped-permissions.ts. Carries no email-addressed bypass: an operational mailbox is not a capability. Raises SQLSTATE 42501 and mutates nothing on denial.';

-- Preview cleanup, which is a narrower authority than preview construction.
--
-- Failing an already-opened preview is not a new import: it closes a job the
-- actor themselves started, and it can only ever move `running` to `failed`. So
-- the exact initiator is allowed to finish their own cleanup after their
-- capability has been withdrawn or their position has expired -- otherwise a
-- routine mid-semester role change would strand a permanent `running` preview
-- that nothing else may touch.
--
-- What it does NOT do is let a second caller act as the initiator. Active
-- organization membership is still required, so a removed member cannot clean
-- up and neither can anyone else on their behalf; that case routes to the
-- owner-only recovery sweeper instead. The actor argument is never ignored.
CREATE OR REPLACE FUNCTION plugin_data.csf_assert_import_cleanup_actor(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_preview_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_initiated_by uuid;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL OR p_preview_job_id IS NULL THEN
    RAISE EXCEPTION 'Closing a CSF preview requires an organization, an officer, and the preview.'
      USING ERRCODE = '42501';
  END IF;

  SELECT job.initiated_by INTO v_initiated_by
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = p_preview_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF preview job was not found for this organization.'
      USING ERRCODE = '42501';
  END IF;

  IF v_initiated_by IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION
      'Only the officer who started this CSF preview may close it; recovery of an abandoned preview is owner-only.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_actor_user_id
      AND coalesce(member.status, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION
      'This officer is no longer an active member of the organization, so this preview must be recovered rather than closed interactively.'
      USING ERRCODE = '42501';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'actorUserId', p_actor_user_id,
    'previewJobId', p_preview_job_id,
    'basis', 'exact_initiator'
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_assert_import_cleanup_actor(uuid, uuid, uuid) IS
  'Cleanup authority for an already-opened CSF preview: the exact initiator, still an active organization member. Deliberately allows that initiator to close their own job after later capability withdrawal or position expiry, and deliberately refuses every other caller, including one naming the initiator. A vanished user or membership routes to the owner-only recovery sweeper instead.';

-- ===========================================================================
-- WAVE 4, PART 1: the authorization inventory, closed.
--
-- Wave 3 authorized the four preview construction RPCs. It left every other
-- service-role-executable import mutation authorizing nothing: the commit
-- claim, the staging claim, reconcile, historical acceptance, stale recovery
-- and failed-row settlement all took an actor UUID and recorded it without ever
-- asking whether that person may act. A service caller could therefore perform
-- any of them in any officer's name.
--
-- Three resolver helpers do the lookup each entry point needs, so every
-- interposed call site is one line and the source type is always the source's
-- own fact rather than a caller's claim.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_import_actor_for_source(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_type text;
BEGIN
  SELECT source.source_type INTO v_source_type
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.'
      USING ERRCODE = '42501';
  END IF;
  RETURN plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, v_source_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_import_actor_for_job(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_type text;
BEGIN
  -- The job's own recorded source type, not the source's current one: a job is
  -- immutable evidence of what was being imported, and a source that later
  -- changed kind must not retroactively change who may act on an old job.
  SELECT job.source_type INTO v_source_type
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import job was not found for this organization.'
      USING ERRCODE = '42501';
  END IF;
  RETURN plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, v_source_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_import_actor_for_row(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_import_row_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job_id uuid;
BEGIN
  SELECT import_row.job_id INTO v_job_id
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found for this organization.'
      USING ERRCODE = '42501';
  END IF;
  RETURN plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, p_actor_user_id, v_job_id
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_assert_import_actor_for_job(uuid, uuid, uuid) IS
  'Resolves an import job to the source type it recorded and delegates to csf_assert_import_actor. Uses the JOB''s frozen source_type rather than the source''s current one, so a source that later changed kind cannot retroactively change who may act on an old job.';


-- ===========================================================================
-- WAVE 3, PART 2: one canonical form, spelled identically in both languages.
--
-- The row digest and the frozen commit payload are only meaningful if
-- TypeScript and PostgreSQL agree byte for byte on what a record serializes to.
-- They did not. `jsonb::text` is PostgreSQL's own rendering of an
-- arbitrary-precision `numeric`, and JavaScript's `JSON.stringify` is
-- ECMAScript `Number::toString` over a binary64. Those disagree on:
--
--   * 1e-7      -- PostgreSQL prints 1e-07, JavaScript prints 1e-7
--   * 1e20      -- PostgreSQL prints 1e+20, JavaScript prints 100000000000000000000
--   * 9007199254740993   -- PostgreSQL keeps it, JavaScript rounds to ...992
--   * 1.0000000000000001 -- PostgreSQL keeps it, JavaScript rounds to 1
--
-- So this implements RFC 8785 §3.2.2.3 -- which *is* ECMAScript
-- `Number::toString` -- in SQL, and refuses any number that binary64 cannot hold
-- exactly rather than letting the two sides silently produce different digests
-- for one stored row.
-- ===========================================================================

-- ECMAScript Number::toString for a finite double.
--
-- `float8out` already gives the shortest round-trippable decimal (PostgreSQL 12+
-- with extra_float_digits >= 1, pinned on the function below so a session GUC
-- cannot change a digest). What it does NOT give is ECMAScript's *spelling* of
-- that decimal, which is what JCS specifies. This reads the digits and decimal
-- exponent out of PostgreSQL's rendering and re-emits them under §6.1.6.1.20.
CREATE OR REPLACE FUNCTION plugin_data.csf_js_number_text(
  p_value double precision
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
SET extra_float_digits = 1
AS $$
DECLARE
  v_text text;
  v_negative boolean;
  v_mantissa text;
  v_exponent integer := 0;
  v_integer text;
  v_fraction text := '';
  v_digits text;
  v_leading integer;
  v_n integer;
  v_k integer;
  v_e integer;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_value = 'NaN'::double precision
    OR p_value = 'Infinity'::double precision
    OR p_value = '-Infinity'::double precision
  THEN
    RAISE EXCEPTION 'A canonical number must be finite.' USING ERRCODE = '22023';
  END IF;
  -- Both zeros are one number. JCS spells it "0".
  IF p_value = 0::double precision THEN
    RETURN '0';
  END IF;

  v_text := p_value::text;
  v_negative := pg_catalog.left(v_text, 1) = '-';
  IF v_negative THEN
    v_text := pg_catalog.substr(v_text, 2);
  END IF;

  IF pg_catalog.strpos(v_text, 'e') > 0 THEN
    v_mantissa := pg_catalog.split_part(v_text, 'e', 1);
    v_exponent := pg_catalog.split_part(v_text, 'e', 2)::integer;
  ELSE
    v_mantissa := v_text;
  END IF;

  IF pg_catalog.strpos(v_mantissa, '.') > 0 THEN
    v_integer := pg_catalog.split_part(v_mantissa, '.', 1);
    v_fraction := pg_catalog.split_part(v_mantissa, '.', 2);
  ELSE
    v_integer := v_mantissa;
  END IF;

  -- value = 0.<digits> x 10^n, with `digits` carrying neither leading nor
  -- trailing zeros. That is exactly the (s, k, n) triple ECMAScript's algorithm
  -- is written against.
  v_digits := v_integer || v_fraction;
  v_leading := pg_catalog.length(v_digits) - pg_catalog.length(pg_catalog.ltrim(v_digits, '0'));
  v_digits := pg_catalog.ltrim(v_digits, '0');
  v_n := pg_catalog.length(v_integer) + v_exponent - v_leading;
  v_digits := pg_catalog.rtrim(v_digits, '0');
  IF v_digits = '' THEN
    RETURN '0';
  END IF;
  v_k := pg_catalog.length(v_digits);

  RETURN
    (CASE WHEN v_negative THEN '-' ELSE '' END)
    || CASE
      WHEN v_k <= v_n AND v_n <= 21 THEN
        v_digits || pg_catalog.repeat('0', v_n - v_k)
      WHEN 0 < v_n AND v_n <= 21 THEN
        pg_catalog.substr(v_digits, 1, v_n) || '.' || pg_catalog.substr(v_digits, v_n + 1)
      WHEN -6 < v_n AND v_n <= 0 THEN
        '0.' || pg_catalog.repeat('0', -v_n) || v_digits
      ELSE
        (CASE
          WHEN v_k = 1 THEN v_digits
          ELSE pg_catalog.substr(v_digits, 1, 1) || '.' || pg_catalog.substr(v_digits, 2)
        END)
        || 'e'
        || (CASE WHEN v_n - 1 >= 0 THEN '+' ELSE '-' END)
        || pg_catalog.abs(v_n - 1)::text
    END;
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_js_number_text(double precision) IS
  'RFC 8785 §3.2.2.3 number serialization: ECMAScript Number::toString spelling of a finite binary64. Not float8out -- that prints 1e-07 and 1e+20 where ECMAScript prints 1e-7 and 100000000000000000000. extra_float_digits is pinned on the function so a session GUC cannot change a digest.';

-- The same, for a jsonb number, refusing anything binary64 cannot hold exactly.
--
-- PostgreSQL stores a jsonb number as `numeric`, so `9007199254740993` and
-- `1.0000000000000001` survive here while JavaScript rounds both. A number that
-- is not the shortest round-trip decimal of some double has two different
-- canonical forms depending on which side rendered it, which is precisely the
-- silent collision this refuses.
CREATE OR REPLACE FUNCTION plugin_data.csf_canonical_number_text(
  p_value numeric
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_double double precision;
  v_text text;
BEGIN
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'A canonical number may not be null.' USING ERRCODE = '22023';
  END IF;
  IF p_value = 'NaN'::numeric THEN
    RAISE EXCEPTION 'A canonical number must be finite.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_double := p_value::double precision;
  EXCEPTION WHEN numeric_value_out_of_range OR data_exception THEN
    RAISE EXCEPTION
      'The number % is outside the range an IEEE-754 double can hold, so it has no canonical form.',
      p_value USING ERRCODE = '22023';
  END;
  IF v_double = 'Infinity'::double precision OR v_double = '-Infinity'::double precision THEN
    RAISE EXCEPTION
      'The number % overflows an IEEE-754 double, so it has no canonical form.',
      p_value USING ERRCODE = '22023';
  END IF;

  v_text := plugin_data.csf_js_number_text(v_double);
  -- Numeric equality, so 1 and 1.0 agree while ...993 and ...992 do not.
  IF v_text::numeric <> p_value THEN
    RAISE EXCEPTION
      'The number % is not exactly representable as an IEEE-754 double, so PostgreSQL and JavaScript would canonicalize it differently.',
      p_value USING ERRCODE = '22023';
  END IF;
  RETURN v_text;
END;
$$;

-- The canonical form of a jsonb value.
--
-- Object members are ordered by key under `COLLATE "C"`. JCS orders by UTF-16
-- code unit and PostgreSQL has no UTF-16 collation, so the canonical key charset
-- is restricted to ASCII, where the two orders are the same sequence. That is a
-- narrowing of what a key may be spelled, not an assumption that they coincide.
--
-- String escaping is `to_jsonb(text)`, which escapes exactly the set
-- `JSON.stringify` escapes -- the seven short forms plus \u00xx below 0x20 --
-- and leaves every other code point as literal UTF-8, as JCS requires.
CREATE OR REPLACE FUNCTION plugin_data.csf_canonical_json(
  p_value jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_type text;
  v_key text;
  v_parts text[] := ARRAY[]::text[];
  v_item jsonb;
BEGIN
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'A canonical value may not be SQL NULL.' USING ERRCODE = '22023';
  END IF;
  v_type := pg_catalog.jsonb_typeof(p_value);

  IF v_type = 'null' THEN
    RETURN 'null';
  ELSIF v_type = 'boolean' THEN
    RETURN CASE WHEN p_value = 'true'::jsonb THEN 'true' ELSE 'false' END;
  ELSIF v_type = 'number' THEN
    RETURN plugin_data.csf_canonical_number_text((p_value #>> '{}')::numeric);
  ELSIF v_type = 'string' THEN
    RETURN pg_catalog.to_jsonb(p_value #>> '{}')::text;
  ELSIF v_type = 'array' THEN
    FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value) AS element(value)
    LOOP
      v_parts := v_parts || plugin_data.csf_canonical_json(v_item);
    END LOOP;
    RETURN '[' || pg_catalog.array_to_string(v_parts, ',') || ']';
  ELSIF v_type = 'object' THEN
    FOR v_key IN
      SELECT key FROM pg_catalog.jsonb_object_keys(p_value) AS keys(key)
      ORDER BY key COLLATE "C"
    LOOP
      IF v_key !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$' THEN
        RAISE EXCEPTION
          'The object key "%" is not canonical; canonical keys are ASCII identifiers so UTF-16 and "C" ordering agree.',
          v_key USING ERRCODE = '22023';
      END IF;
      v_parts := v_parts
        || (pg_catalog.to_jsonb(v_key)::text || ':' || plugin_data.csf_canonical_json(p_value -> v_key));
    END LOOP;
    RETURN '{' || pg_catalog.array_to_string(v_parts, ',') || '}';
  END IF;

  RAISE EXCEPTION 'A canonical value may not be of type %.', v_type USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_canonical_digest(
  p_value jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(plugin_data.csf_canonical_json(p_value), 'UTF8')),
    'hex'
  );
$$;

-- ===========================================================================
-- WAVE 3, PART 3: the authoritative payload stops being a caller assertion.
--
-- `csf_append_import_preview_rows` used to accept three independent facts and
-- believe all of them: an opaque `normalized_data.commitPayload`, a
-- caller-selected target, and a `row_hash` unrelated to either. It froze
-- whatever arrived, and `csf_commit_import_row_for_attempt` then treated that
-- frozen blob as authoritative identity, application evidence, activities and
-- meetings. Anything able to reach the append RPC could therefore write any
-- identity under a perfectly valid preview simply by naming it.
--
-- The fix is not to validate the caller's payload more carefully. It is to stop
-- accepting it: the RPC takes the allowlisted normalized record, validates it
-- against the exact nested schema for that source type, and DERIVES the commit
-- payload and the row digest itself, using this SQL mirror of
-- `buildCsfRowCommitPayload`. A caller-authored `commitPayload` is refused
-- outright rather than compared, and a caller `row_hash` that disagrees with the
-- derived digest is refused rather than trusted.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_payload_string(p_value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR pg_catalog.jsonb_typeof(p_value) <> 'string' THEN NULL
    ELSE nullif(pg_catalog.btrim(p_value #>> '{}'), '')
  END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_payload_number(p_value jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR pg_catalog.jsonb_typeof(p_value) <> 'number' THEN 'null'::jsonb
    ELSE p_value
  END;
$$;

-- `normalizeCsfIdentityPart`: trim, lowercase, collapse whitespace, NFKD, then
-- drop combining marks. Written in the same order as the TypeScript so a future
-- edit to either is visibly a change to both.
CREATE OR REPLACE FUNCTION plugin_data.csf_normalize_identity_part(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- The combining-mark range is built with chr() rather than written as literal
  -- combining characters: a bare U+0300-U+036F class in a migration file is
  -- invisible in review and one stray editor normalization away from silently
  -- changing every normalized name in the database.
  SELECT pg_catalog.regexp_replace(
    normalize(
      pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(coalesce(p_value, ''))), '\s+', ' ', 'g'),
      NFKD
    ),
    '[' || pg_catalog.chr(768) || '-' || pg_catalog.chr(879) || ']', '', 'g'
  );
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_normalize_email_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_value, ''))), '');
$$;

-- `meetingKeyFromLabel`, including the 48-character truncation and the
-- `meeting_<index>` fallback for a label that normalizes away entirely.
CREATE OR REPLACE FUNCTION plugin_data.csf_meeting_key_from_label(
  p_label text,
  p_fallback_index integer DEFAULT 1
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    nullif(
      pg_catalog.substr(
        pg_catalog.btrim(
          pg_catalog.regexp_replace(
            pg_catalog.lower(pg_catalog.btrim(coalesce(p_label, ''))),
            '[^a-z0-9]+', '_', 'g'
          ),
          '_'
        ),
        1, 48
      ),
      ''
    ),
    'meeting_' || p_fallback_index::text
  );
$$;

-- `normalizeCsfMeetingAttendanceValue`. The trailing default is `attended`, not
-- `unknown`: only a blank cell is unknown, and an unrecognized mark on a
-- attendance sheet is a mark.
CREATE OR REPLACE FUNCTION plugin_data.csf_meeting_attendance_value(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_value, ''))), '') IS NULL
      THEN 'unknown'
    WHEN pg_catalog.lower(pg_catalog.btrim(p_value)) = ANY (ARRAY[
      'x', 'yes', 'y', 'true', 'attended', 'present', 'complete', 'completed'
    ]) THEN 'attended'
    WHEN pg_catalog.lower(pg_catalog.btrim(p_value)) = ANY (ARRAY['excused', 'e'])
      THEN 'excused'
    WHEN pg_catalog.lower(pg_catalog.btrim(p_value)) = ANY (ARRAY[
      'missed', 'absent', 'no', 'n', 'false'
    ]) THEN 'missed'
    WHEN pg_catalog.lower(pg_catalog.btrim(p_value)) = ANY (ARRAY[
      'not required', 'not_required', 'n/a', 'na'
    ]) THEN 'not_required'
    ELSE 'attended'
  END;
$$;

-- The exact nested schema for each central source type, mirroring
-- `CSF_IMPORT_ALLOWLISTED_PATHS`. Encoded as data rather than as a wall of IF
-- statements so the parity test can compare the two lists element by element.
--
-- Every field is optional: the TypeScript sanitizer drops a key whose value did
-- not survive normalization and drops an object left empty, so a valid record is
-- a subset. What is NOT optional is the closed shape -- an unknown key at any
-- depth, a scalar where an object belongs, or an object where an array belongs
-- is refused.
CREATE OR REPLACE FUNCTION plugin_data.csf_normalized_record_schema(
  p_source_type text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_source_type
    WHEN 'application_responses' THEN '{
      "identity": {"kind": "object", "fields": {
        "firstName": "string", "lastName": "string",
        "normalizedFirstName": "string", "normalizedLastName": "string"
      }},
      "contact": {"kind": "object", "fields": {
        "responseEmail": "string", "responseEmailState": "string",
        "preferredContactEmail": "string", "preferredContactEmailState": "string",
        "emailsAgree": "boolean"
      }},
      "cohort": {"kind": "object", "fields": {
        "gradeLevel": "number", "returningStatus": "string"
      }},
      "submission": {"kind": "object", "fields": {"submittedAt": "string"}},
      "claimedTotals": {"kind": "object", "fields": {
        "listIPoints": "number", "listIAndIIPoints": "number", "grandTotalPoints": "number"
      }},
      "courses": {"kind": "array", "fields": {
        "courseList": "string", "courseName": "string", "grade": "string", "isBonus": "boolean"
      }},
      "evidence": {"kind": "object", "fields": {
        "transcriptDriveFileId": "string", "transcriptAccessState": "string",
        "receiptDriveFileId": "string", "receiptAccessState": "string"
      }}
    }'::jsonb
    WHEN 'student_roster' THEN '{
      "identity": {"kind": "object", "fields": {
        "firstName": "string", "lastName": "string",
        "normalizedFirstName": "string", "normalizedLastName": "string"
      }},
      "contact": {"kind": "object", "fields": {
        "schoolEmail": "string", "schoolEmailState": "string",
        "personalEmail": "string", "personalEmailState": "string"
      }},
      "cohort": {"kind": "object", "fields": {"gradeLevel": "number"}}
    }'::jsonb
    WHEN 'class_history' THEN '{
      "identity": {"kind": "object", "fields": {
        "firstName": "string", "lastName": "string",
        "normalizedFirstName": "string", "normalizedLastName": "string"
      }},
      "contact": {"kind": "object", "fields": {
        "schoolEmail": "string", "schoolEmailState": "string",
        "personalEmail": "string", "personalEmailState": "string"
      }},
      "activities": {"kind": "array", "fields": {"label": "string", "points": "number"}},
      "meetings": {"kind": "array", "fields": {"key": "string", "state": "string"}},
      "requirements": {"kind": "object", "fields": {"allRequirementsMet": "boolean"}}
    }'::jsonb
    ELSE NULL
  END;
$$;

-- Validate one allowlisted normalized record against its schema, and fail closed.
--
-- Bounds are part of the schema, not an afterthought: an oversized nested value
-- is refused before it can be stored, hashed, or logged.
CREATE OR REPLACE FUNCTION plugin_data.csf_assert_canonical_record(
  p_source_type text,
  p_record jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  c_max_bytes constant integer := 200000;
  c_max_items constant integer := 200;
  v_schema jsonb := plugin_data.csf_normalized_record_schema(p_source_type);
  v_key text;
  v_spec jsonb;
  v_node jsonb;
  v_item jsonb;
  v_field text;
  v_expected text;
BEGIN
  IF v_schema IS NULL THEN
    RAISE EXCEPTION
      'CSF source type "%" has no canonical record schema, so no record may be accepted for it.',
      coalesce(p_source_type, '<null>') USING ERRCODE = '22023';
  END IF;
  IF p_record IS NULL OR pg_catalog.jsonb_typeof(p_record) <> 'object' THEN
    RAISE EXCEPTION 'A CSF canonical record must be a JSON object.' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.octet_length(p_record::text) > c_max_bytes THEN
    RAISE EXCEPTION 'This CSF canonical record is too large to accept.' USING ERRCODE = '22023';
  END IF;

  FOR v_key IN SELECT key FROM pg_catalog.jsonb_object_keys(p_record) AS keys(key)
  LOOP
    v_spec := v_schema -> v_key;
    IF v_spec IS NULL THEN
      RAISE EXCEPTION
        'A CSF % record may not carry "%".', p_source_type, v_key USING ERRCODE = '23514';
    END IF;
    v_node := p_record -> v_key;

    IF v_spec ->> 'kind' = 'object' THEN
      IF pg_catalog.jsonb_typeof(v_node) <> 'object' THEN
        RAISE EXCEPTION 'A CSF % record needs "%" to be a JSON object.', p_source_type, v_key
          USING ERRCODE = '22023';
      END IF;
      FOR v_field IN SELECT key FROM pg_catalog.jsonb_object_keys(v_node) AS keys(key)
      LOOP
        v_expected := v_spec -> 'fields' ->> v_field;
        IF v_expected IS NULL THEN
          RAISE EXCEPTION 'A CSF % record may not carry "%.%".', p_source_type, v_key, v_field
            USING ERRCODE = '23514';
        END IF;
        IF pg_catalog.jsonb_typeof(v_node -> v_field) NOT IN (v_expected, 'null') THEN
          RAISE EXCEPTION
            'A CSF % record needs "%.%" to be a % or null.',
            p_source_type, v_key, v_field, v_expected USING ERRCODE = '22023';
        END IF;
      END LOOP;

    ELSIF v_spec ->> 'kind' = 'array' THEN
      IF pg_catalog.jsonb_typeof(v_node) <> 'array' THEN
        RAISE EXCEPTION 'A CSF % record needs "%" to be a JSON array.', p_source_type, v_key
          USING ERRCODE = '22023';
      END IF;
      IF pg_catalog.jsonb_array_length(v_node) > c_max_items THEN
        RAISE EXCEPTION 'A CSF % record may not carry more than % "%" entries.',
          p_source_type, c_max_items, v_key USING ERRCODE = '22023';
      END IF;
      FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_node) AS element(value)
      LOOP
        IF pg_catalog.jsonb_typeof(v_item) <> 'object' THEN
          RAISE EXCEPTION 'Each "%" entry of a CSF % record must be a JSON object.',
            v_key, p_source_type USING ERRCODE = '22023';
        END IF;
        FOR v_field IN SELECT key FROM pg_catalog.jsonb_object_keys(v_item) AS keys(key)
        LOOP
          v_expected := v_spec -> 'fields' ->> v_field;
          IF v_expected IS NULL THEN
            RAISE EXCEPTION 'A CSF % record may not carry "%[].%".', p_source_type, v_key, v_field
              USING ERRCODE = '23514';
          END IF;
          IF pg_catalog.jsonb_typeof(v_item -> v_field) NOT IN (v_expected, 'null') THEN
            RAISE EXCEPTION
              'A CSF % record needs "%[].%" to be a % or null.',
              p_source_type, v_key, v_field, v_expected USING ERRCODE = '22023';
          END IF;
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;

  -- Canonicalizing here is not decorative: it is what proves every number in the
  -- accepted record survives binary64 and every key is orderable, before any of
  -- it is frozen or hashed.
  PERFORM plugin_data.csf_canonical_json(p_record);
  RETURN p_record;
END;
$$;

-- The SQL mirror of `buildCsfRowCommitPayload`.
--
-- Two rules are structural rather than incidental and are written out here for
-- the same reason they are written out there:
--
--   * An application's canonical email pair is unconditionally null. Response
--     and preferred-contact addresses are unverified form evidence; promoting
--     them to canonical identity is how a form submission would attach itself to
--     an existing member.
--   * `applicationData.listIPoints`, `listIAndIIPoints` and `grandTotalPoints`
--     are null while the student's own figures ride along under `claimedTotals`.
--     A spreadsheet cell is a claim about a total, not the total.
CREATE OR REPLACE FUNCTION plugin_data.csf_derive_row_commit_payload(
  p_source_type text,
  p_record jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_identity jsonb := coalesce(p_record -> 'identity', '{}'::jsonb);
  v_contact jsonb := coalesce(p_record -> 'contact', '{}'::jsonb);
  v_first text := coalesce(plugin_data.csf_payload_string(v_identity -> 'firstName'), '');
  v_last text := coalesce(plugin_data.csf_payload_string(v_identity -> 'lastName'), '');
  v_school text;
  v_personal text;
  v_application jsonb := NULL;
  v_activities jsonb := NULL;
  v_meetings jsonb := NULL;
  v_requirements jsonb := 'null'::jsonb;
  v_entry jsonb;
  v_index integer := 0;
  v_label text;
  v_points jsonb;
  v_key text;
  v_state text;
  v_grade jsonb;
BEGIN
  IF plugin_data.csf_normalized_record_schema(p_source_type) IS NULL THEN
    RAISE EXCEPTION
      'CSF source type "%" is not eligible for the central commit path, so no commit payload may be derived for it.',
      coalesce(p_source_type, '<null>') USING ERRCODE = '23514';
  END IF;

  -- Canonical identity addresses, by source type. Application: none, ever.
  IF p_source_type = 'application_responses' THEN
    v_school := NULL;
    v_personal := NULL;
  ELSE
    -- Key ABSENT means the adapter recorded no state and the address stands.
    -- Key PRESENT but not exactly the string 'valid' -- including an explicit
    -- JSON null -- means the adapter could not validate it, so it is evidence
    -- for an officer and never canonical identity. `coalesce` would have
    -- collapsed those two into one and quietly promoted the second.
    v_school := CASE
      WHEN NOT (v_contact ? 'schoolEmailState')
        OR (v_contact ->> 'schoolEmailState') = 'valid'
        THEN plugin_data.csf_payload_string(v_contact -> 'schoolEmail')
      ELSE NULL
    END;
    v_personal := CASE
      WHEN NOT (v_contact ? 'personalEmailState')
        OR (v_contact ->> 'personalEmailState') = 'valid'
        THEN plugin_data.csf_payload_string(v_contact -> 'personalEmail')
      ELSE NULL
    END;
  END IF;

  IF p_source_type = 'application_responses' THEN
    DECLARE
      v_cohort jsonb := coalesce(p_record -> 'cohort', '{}'::jsonb);
      v_submission jsonb := coalesce(p_record -> 'submission', '{}'::jsonb);
      v_claimed jsonb := coalesce(p_record -> 'claimedTotals', '{}'::jsonb);
      v_evidence jsonb := coalesce(p_record -> 'evidence', '{}'::jsonb);
      v_courses jsonb := '[]'::jsonb;
      v_grade_level jsonb := plugin_data.csf_payload_number(v_cohort -> 'gradeLevel');
      v_preferred text := plugin_data.csf_payload_string(v_contact -> 'preferredContactEmail');
      v_course_name text;
      v_course_list text;
      v_missing jsonb := '[]'::jsonb;
    BEGIN
      FOR v_entry IN
        SELECT value FROM pg_catalog.jsonb_array_elements(
          CASE WHEN pg_catalog.jsonb_typeof(coalesce(p_record -> 'courses', '[]'::jsonb)) = 'array'
            THEN p_record -> 'courses' ELSE '[]'::jsonb END
        ) AS element(value)
      LOOP
        v_course_name := plugin_data.csf_payload_string(v_entry -> 'courseName');
        v_course_list := plugin_data.csf_payload_string(v_entry -> 'courseList');
        CONTINUE WHEN v_course_name IS NULL OR v_course_list IS NULL;
        v_grade := pg_catalog.to_jsonb(plugin_data.csf_payload_string(v_entry -> 'grade'));
        v_courses := v_courses || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'courseList', v_course_list,
          'courseName', v_course_name,
          'grade', coalesce(v_grade, 'null'::jsonb),
          -- Never derived from a course name: bonus weight is published policy.
          'points', NULL,
          'isBonus', false
        ));
      END LOOP;

      IF v_grade_level = 'null'::jsonb THEN
        v_missing := v_missing || pg_catalog.jsonb_build_array('current_grade_level');
      END IF;
      IF v_preferred IS NULL THEN
        v_missing := v_missing || pg_catalog.jsonb_build_array('most_checked_email');
      END IF;

      v_application := pg_catalog.jsonb_build_object(
        'currentGradeLevel', v_grade_level,
        'returningStatus', coalesce(plugin_data.csf_payload_string(v_cohort -> 'returningStatus'), 'unknown'),
        'sourceSubmittedAt', coalesce(pg_catalog.to_jsonb(plugin_data.csf_payload_string(v_submission -> 'submittedAt')), 'null'::jsonb),
        'mostCheckedEmail', coalesce(pg_catalog.to_jsonb(v_preferred), 'null'::jsonb),
        'listIPoints', NULL,
        'listIAndIIPoints', NULL,
        'grandTotalPoints', NULL,
        'claimedTotals', pg_catalog.jsonb_build_object(
          'listIPoints', plugin_data.csf_payload_number(v_claimed -> 'listIPoints'),
          'listIAndIIPoints', plugin_data.csf_payload_number(v_claimed -> 'listIAndIIPoints'),
          'grandTotalPoints', plugin_data.csf_payload_number(v_claimed -> 'grandTotalPoints')
        ),
        'transcriptDriveFileId', coalesce(pg_catalog.to_jsonb(plugin_data.csf_payload_string(v_evidence -> 'transcriptDriveFileId')), 'null'::jsonb),
        'transcriptUrl', NULL,
        'transcriptAccessState', coalesce(pg_catalog.to_jsonb(plugin_data.csf_payload_string(v_evidence -> 'transcriptAccessState')), 'null'::jsonb),
        'receiptDriveFileId', coalesce(pg_catalog.to_jsonb(plugin_data.csf_payload_string(v_evidence -> 'receiptDriveFileId')), 'null'::jsonb),
        'receiptUrl', NULL,
        'receiptAccessState', coalesce(pg_catalog.to_jsonb(plugin_data.csf_payload_string(v_evidence -> 'receiptAccessState')), 'null'::jsonb),
        'courses', v_courses,
        'missingFields', v_missing
      );
    END;
  END IF;

  IF p_source_type = 'class_history' THEN
    v_activities := '[]'::jsonb;
    FOR v_entry IN
      SELECT value FROM pg_catalog.jsonb_array_elements(
        CASE WHEN pg_catalog.jsonb_typeof(coalesce(p_record -> 'activities', '[]'::jsonb)) = 'array'
          THEN p_record -> 'activities' ELSE '[]'::jsonb END
      ) AS element(value)
    LOOP
      v_index := v_index + 1;
      v_label := plugin_data.csf_payload_string(v_entry -> 'label');
      v_points := plugin_data.csf_payload_number(v_entry -> 'points');
      -- Text without a positive number never becomes points.
      CONTINUE WHEN v_label IS NULL
        OR v_points = 'null'::jsonb
        OR (v_points #>> '{}')::numeric <= 0;
      v_activities := v_activities || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'slot', 'activity_' || v_index::text,
        'label', v_label,
        'value', v_label,
        'points', v_points,
        -- Deliberately empty: workbook layout is not part of a committed record.
        'sourceColumns', '[]'::jsonb
      ));
    END LOOP;

    v_meetings := '[]'::jsonb;
    FOR v_entry IN
      SELECT value FROM pg_catalog.jsonb_array_elements(
        CASE WHEN pg_catalog.jsonb_typeof(coalesce(p_record -> 'meetings', '[]'::jsonb)) = 'array'
          THEN p_record -> 'meetings' ELSE '[]'::jsonb END
      ) AS element(value)
    LOOP
      v_key := plugin_data.csf_payload_string(v_entry -> 'key');
      v_state := plugin_data.csf_payload_string(v_entry -> 'state');
      CONTINUE WHEN v_key IS NULL OR v_state IS NULL;
      v_meetings := v_meetings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'key', plugin_data.csf_meeting_key_from_label(v_key),
        'label', v_key,
        'value', v_state,
        'status', plugin_data.csf_meeting_attendance_value(v_state)
      ));
    END LOOP;

    IF pg_catalog.jsonb_typeof(coalesce(p_record -> 'requirements' -> 'allRequirementsMet', 'null'::jsonb)) = 'boolean' THEN
      v_requirements := p_record -> 'requirements' -> 'allRequirementsMet';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
      'version', 'csf-commit-payload/v1',
      'sourceType', p_source_type,
      'identity', pg_catalog.jsonb_build_object(
        'firstName', v_first,
        'lastName', v_last,
        'normalizedFirstName', coalesce(
          plugin_data.csf_payload_string(v_identity -> 'normalizedFirstName'),
          plugin_data.csf_normalize_identity_part(v_first)
        ),
        'normalizedLastName', coalesce(
          plugin_data.csf_payload_string(v_identity -> 'normalizedLastName'),
          plugin_data.csf_normalize_identity_part(v_last)
        )
      ),
      'canonicalEmails', pg_catalog.jsonb_build_object(
        'schoolEmail', coalesce(pg_catalog.to_jsonb(v_school), 'null'::jsonb),
        'personalEmail', coalesce(pg_catalog.to_jsonb(v_personal), 'null'::jsonb),
        'normalizedSchoolEmail', coalesce(
          pg_catalog.to_jsonb(plugin_data.csf_normalize_email_text(v_school)), 'null'::jsonb
        ),
        'normalizedPersonalEmail', coalesce(
          pg_catalog.to_jsonb(plugin_data.csf_normalize_email_text(v_personal)), 'null'::jsonb
        )
      ),
      'applicationData', coalesce(v_application, 'null'::jsonb),
      'activities', coalesce(v_activities, 'null'::jsonb),
      'meetings', coalesce(v_meetings, 'null'::jsonb),
      'allRequirementsMet', CASE WHEN p_source_type = 'class_history' THEN v_requirements ELSE 'null'::jsonb END
    );
END;
$$;

-- ===========================================================================
-- WAVE 3, PART 4: preview construction, with every authoritative fact derived.
--
-- The three construction RPCs are redefined here rather than edited above, so
-- the wave-2 bodies and the reasoning that produced them stay readable and the
-- changes this wave makes are all in one place.
--
-- What changes:
--
--   * `csf_open_import_preview` asserts the actor holds the source capability
--     instead of merely existing.
--   * `csf_append_import_preview_rows` derives the commit payload and the row
--     digest from the validated canonical record, refuses a caller-authored
--     `commitPayload`, derives `source_id`/`mapping_version` from the locked
--     job, and requires a retry parent to be a row of the exact parent preview
--     at the exact sheet coordinate.
--   * `csf_seal_import_preview` derives the final status and every count from
--     the stored rows, and confines caller display metadata to a subobject that
--     cannot collide with a server-owned key.
--   * `csf_fail_import_preview` authorizes the exact initiator and records a
--     durable recovery row when nothing can close the job interactively.
-- ===========================================================================

-- Durable evidence that a preview was left mid-construction.
--
-- A returned UUID and a log line are not a recovery mechanism: nothing consumes
-- them, so a preview whose failure path itself failed stays `running` forever
-- and every later preview of that source is blocked behind it. This table is
-- what the sweeper reads, and it is server-only state like every other import
-- table -- RLS on, no browser policy, no privileges below service_role SELECT,
-- and every write through an owned function.
CREATE TABLE IF NOT EXISTS plugin_data.csf_import_cleanup_recovery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  preview_job_id uuid NOT NULL REFERENCES plugin_data.csf_sheet_import_jobs (id) ON DELETE CASCADE,
  source_id uuid REFERENCES plugin_data.csf_sheet_sources (id) ON DELETE SET NULL,
  initiated_by uuid,
  reason_code text NOT NULL,
  detail text,
  -- The lease after which an abandoned preview may be terminalized by the
  -- owner-only sweeper rather than waiting for a caller that will never return.
  recover_after timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  settled_at timestamptz,
  settled_outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_import_cleanup_recovery_outcome_chk CHECK (
    settled_outcome IS NULL
    OR settled_outcome IN ('failed', 'already_final', 'job_missing')
  ),
  CONSTRAINT csf_import_cleanup_recovery_attempts_chk CHECK (attempts >= 0)
);

-- One open recovery record per preview. A repeated failure updates the lease
-- rather than queueing a second identical sweep.
CREATE UNIQUE INDEX IF NOT EXISTS csf_import_cleanup_recovery_open_idx
  ON plugin_data.csf_import_cleanup_recovery (preview_job_id)
  WHERE settled_at IS NULL;

CREATE INDEX IF NOT EXISTS csf_import_cleanup_recovery_due_idx
  ON plugin_data.csf_import_cleanup_recovery (recover_after)
  WHERE settled_at IS NULL;

COMMENT ON TABLE plugin_data.csf_import_cleanup_recovery IS
  'Durable evidence that a CSF preview was left under construction because its own failure path could not close it. Consumed by plugin_data.csf_sweep_import_cleanup_recovery(integer), which terminalizes the job as failed after the lease and never marks it completed.';

ALTER TABLE plugin_data.csf_import_cleanup_recovery ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION plugin_data.csf_open_import_preview(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_source_type text,
  p_source_file_id text,
  p_source_file_name text,
  p_source_sheet_tab text,
  p_source_range text,
  p_source_modified_at timestamptz,
  p_source_file_metadata jsonb,
  p_mapping_snapshot jsonb,
  p_mapping_version integer,
  p_retry_of_job_id uuid,
  p_source_content_hash text,
  p_snapshot_hash text,
  p_snapshot_row_count integer,
  p_snapshot_contract_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_job_id uuid;
  v_correlation uuid;
  v_grant jsonb;
BEGIN
  IF p_organization_id IS NULL OR p_source_id IS NULL THEN
    RAISE EXCEPTION 'A CSF preview needs an organization and a source.' USING ERRCODE = '22023';
  END IF;

  -- Exact tenant and source relationship, read under a lock so the source cannot change
  -- kind between validation and insert.
  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;

  -- Source kind is the source's own fact, and both statements of it must agree.
  IF p_source_type IS DISTINCT FROM v_source.source_type
    OR nullif(btrim(coalesce(v_source.settings->>'sourceKind', '')), '')
      IS DISTINCT FROM v_source.source_type
  THEN
    RAISE EXCEPTION
      'This CSF source disagrees with itself or with the requested preview about its source type.'
      USING ERRCODE = '23514';
  END IF;

  -- Authorization, against the source's OWN type rather than the requested one,
  -- and after the two were proved equal. `initiated_by` is provenance an officer
  -- is later held to, so proving the UUID exists was never enough: it let any
  -- service caller start a preview in any officer's name.
  v_grant := plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, v_source.source_type
  );

  -- Immutable shape checks. These columns are frozen the moment the row exists, so a
  -- malformed value can never be corrected afterwards.
  IF jsonb_typeof(coalesce(p_source_file_metadata, 'null'::jsonb)) <> 'object'
    OR jsonb_typeof(coalesce(p_mapping_snapshot, 'null'::jsonb)) <> 'object'
  THEN
    RAISE EXCEPTION 'CSF preview provenance must be recorded as JSON objects.'
      USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_source_file_metadata::text) > 200000
    OR octet_length(p_mapping_snapshot::text) > 1000000
  THEN
    RAISE EXCEPTION 'CSF preview provenance is too large to accept.' USING ERRCODE = '22023';
  END IF;
  IF p_mapping_version IS NULL OR p_mapping_version < 1 THEN
    RAISE EXCEPTION 'A CSF preview needs a mapping version.' USING ERRCODE = '22023';
  END IF;
  IF p_source_content_hash IS NOT NULL AND p_source_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A CSF preview source digest must be a sha256 hex digest.'
      USING ERRCODE = '22023';
  END IF;
  IF p_snapshot_hash IS NOT NULL AND p_snapshot_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A CSF preview snapshot digest must be a sha256 hex digest.'
      USING ERRCODE = '22023';
  END IF;
  IF p_snapshot_row_count IS NOT NULL AND p_snapshot_row_count < 0 THEN
    RAISE EXCEPTION 'A CSF preview row count cannot be negative.' USING ERRCODE = '22023';
  END IF;

  -- A retry must name an earlier preview of this organization, of the SAME source
  -- and the SAME source type. A retry that crosses either is not a retry: it
  -- would let a roster preview claim lineage from an application preview and
  -- inherit its review history.
  IF p_retry_of_job_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM plugin_data.csf_sheet_import_jobs AS prior
      WHERE prior.organization_id = p_organization_id
        AND prior.id = p_retry_of_job_id
        AND prior.mode = 'preview'
        AND prior.source_id = p_source_id
        AND prior.source_type = v_source.source_type
    )
  THEN
    RAISE EXCEPTION
      'A CSF preview retry must name an earlier preview of this organization, source, and source type.'
      USING ERRCODE = '23503';
  END IF;

  -- `mode` and `status` are set here, not accepted. This is the whole reason the caller
  -- no longer holds INSERT: a caller that can state `mode` can state `commit`.
  INSERT INTO plugin_data.csf_sheet_import_jobs (
    organization_id, source_id, initiated_by, mode, status, source_type,
    source_file_id, source_file_name, source_sheet_tab, source_range,
    source_modified_at, source_file_metadata, mapping_snapshot, mapping_version,
    retry_of_job_id, source_content_hash, snapshot_hash, snapshot_row_count,
    snapshot_contract_version, started_at
  ) VALUES (
    p_organization_id, p_source_id, p_actor_user_id, 'preview', 'running', v_source.source_type,
    p_source_file_id, p_source_file_name, p_source_sheet_tab, p_source_range,
    p_source_modified_at, coalesce(p_source_file_metadata, '{}'::jsonb),
    coalesce(p_mapping_snapshot, '{}'::jsonb), p_mapping_version,
    p_retry_of_job_id, p_source_content_hash, p_snapshot_hash, p_snapshot_row_count,
    p_snapshot_contract_version, now()
  ) RETURNING id, correlation_id INTO v_job_id, v_correlation;

  RETURN jsonb_build_object(
    'previewJobId', v_job_id,
    'correlationId', v_correlation,
    'sourceType', v_source.source_type,
    'status', 'running',
    'authorizationBasis', v_grant ->> 'basis'
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_append_import_preview_rows(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_preview_job_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- `source_id` and `mapping_version` are gone from this list on purpose: they
  -- are derived from the locked job, so a caller can no longer state a value
  -- that diverges from the preview the row belongs to.
  c_allowed_keys constant text[] := ARRAY[
    'cohort_id', 'term_id', 'sheet_tab_name', 'row_number', 'source_range',
    'raw_data', 'normalized_data', 'row_hash', 'matched_profile_id',
    'matched_application_id', 'import_status', 'errors', 'warnings',
    'retry_of_row_id', 'source_modified_at'
  ];
  -- Non-terminal only. A preview row may arrive already needing an officer decision, but
  -- it may never arrive claiming a commit outcome.
  c_allowed_status constant text[] := ARRAY[
    'pending', 'ambiguous', 'conflict', 'duplicate', 'error', 'skipped'
  ];
  -- `superseded` is NOT in that list. It is derived below, not selected: it
  -- asserts that an earlier attempt already committed exactly this evidence, and
  -- a caller able to state it could mark a changed row as already-imported and
  -- have the commit path skip it. The row terminal states an ancestor may be in
  -- for that assertion to hold are enumerated rather than "anything final".
  c_committed_parent_status constant text[] := ARRAY['created', 'updated', 'superseded'];
  -- Envelope keys the central Sheets flow states. `commitPayload` is absent:
  -- the RPC derives it, and a caller stating one is refused rather than merged.
  c_central_envelope_keys constant text[] := ARRAY[
    'contractVersion', 'snapshotHash', 'rowHash', 'sourceType', 'termCode',
    'targetStrategy', 'targetStatus', 'targetTermCode', 'targetTermLabel',
    'targetCohortYear', 'targetCohortLabel', 'targetErrors', 'matchBasis',
    'rejected', 'record'
  ];
  v_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_row jsonb;
  v_key text;
  v_status text;
  v_inserted integer := 0;
  v_replayed integer := 0;
  v_existing plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_normalized jsonb;
  v_raw jsonb;
  v_record jsonb;
  v_payload jsonb;
  v_digest text;
  v_central boolean;
  v_tab text;
  v_number integer;
  v_requested_superseded boolean;
  v_parent plugin_data.csf_sheet_import_rows%ROWTYPE;
BEGIN
  PERFORM plugin_data.csf_assert_preview_payload_bounds(p_rows);

  SELECT * INTO v_job
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = p_preview_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF preview job was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;
  -- Only a preview still being constructed accepts rows. A sealed preview is immutable,
  -- and a commit job never accepts rows at all.
  IF v_job.mode <> 'preview' THEN
    RAISE EXCEPTION 'Only a CSF preview job may receive preview rows.' USING ERRCODE = '23514';
  END IF;
  IF v_job.status <> 'running' THEN
    RAISE EXCEPTION
      'This CSF preview is no longer being constructed; its rows are sealed.'
      USING ERRCODE = '55000';
  END IF;
  IF v_job.initiated_by IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION
      'Only the officer who started this CSF preview may add rows to it.'
      USING ERRCODE = '42501';
  END IF;
  -- Still authorized *now*, not merely at open time. A capability withdrawn
  -- mid-preview stops further rows; closing the job stays available through the
  -- narrower cleanup authority.
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, v_job.source_type
  );

  v_central := plugin_data.csf_normalized_record_schema(v_job.source_type) IS NOT NULL;

  FOR v_row IN SELECT jsonb_array_elements(p_rows)
  LOOP
    -- Cleared per row: a %ROWTYPE variable keeps the previous iteration's value
    -- otherwise, and a row with no retry parent would inherit the last one's.
    v_parent := NULL;
    v_raw := '{}'::jsonb;
    IF jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'Each CSF preview row must be a JSON object.' USING ERRCODE = '22023';
    END IF;
    -- Closed shape. A key nobody reviewed cannot arrive by being added upstream, and in
    -- particular none of the commit, freeze, intent, outcome, retry or settlement columns
    -- is nameable here at all.
    FOR v_key IN SELECT jsonb_object_keys(v_row)
    LOOP
      IF NOT (v_key = ANY (c_allowed_keys)) THEN
        RAISE EXCEPTION 'A CSF preview row may not set "%".', v_key USING ERRCODE = '23514';
      END IF;
    END LOOP;

    v_status := coalesce(nullif(btrim(coalesce(v_row->>'import_status', '')), ''), 'pending');
    v_requested_superseded := v_status = 'superseded';
    IF v_requested_superseded THEN
      -- Held as `pending` until the lineage below proves otherwise. A request
      -- that cannot be proved does not fall back to `superseded`.
      v_status := 'pending';
    ELSIF NOT (v_status = ANY (c_allowed_status)) THEN
      RAISE EXCEPTION
        'A CSF preview row may not be created with the terminal status "%".', v_status
        USING ERRCODE = '23514';
    END IF;
    v_tab := nullif(btrim(coalesce(v_row->>'sheet_tab_name', '')), '');
    IF v_tab IS NULL OR coalesce(v_row->>'row_number', '') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'A CSF preview row needs a sheet tab and a positive row number.'
        USING ERRCODE = '22023';
    END IF;
    v_number := (v_row->>'row_number')::integer;
    IF jsonb_typeof(coalesce(v_row -> 'raw_data', '{}'::jsonb)) <> 'object'
      OR jsonb_typeof(coalesce(v_row -> 'normalized_data', '{}'::jsonb)) <> 'object'
    THEN
      RAISE EXCEPTION 'CSF preview row evidence must be recorded as JSON objects.'
        USING ERRCODE = '22023';
    END IF;

    v_normalized := coalesce(v_row -> 'normalized_data', '{}'::jsonb);
    -- No caller may state the authoritative payload, on any source type. On a
    -- contextual preview this is what stops a commit-shaped object from making
    -- an ineligible row look eligible; on a central one it is what stops a
    -- forged identity from being frozen under a valid row.
    IF v_normalized ? 'commitPayload' THEN
      RAISE EXCEPTION
        'A CSF preview row may not state its own commit payload; it is derived from the accepted record.'
        USING ERRCODE = '23514';
    END IF;

    IF v_central THEN
      FOR v_key IN SELECT jsonb_object_keys(v_normalized)
      LOOP
        IF NOT (v_key = ANY (c_central_envelope_keys)) THEN
          RAISE EXCEPTION
            'A CSF % preview row may not carry normalized_data."%".', v_job.source_type, v_key
            USING ERRCODE = '23514';
        END IF;
      END LOOP;
      -- An absent or unrecognized contract version fails closed for every
      -- variant: a row whose serialization rules are unknown cannot be hashed
      -- into evidence anybody can later verify.
      IF coalesce(v_normalized ->> 'contractVersion', '') <> 'csf-normalized-import/v1' THEN
        RAISE EXCEPTION
          'A CSF preview row must state the supported normalized import contract version.'
          USING ERRCODE = '23514';
      END IF;
      IF coalesce(v_normalized ->> 'sourceType', '') IS DISTINCT FROM v_job.source_type THEN
        RAISE EXCEPTION
          'A CSF preview row must agree with its preview about the source type.'
          USING ERRCODE = '23514';
      END IF;

      -- The allowlisted record, validated against the exact nested schema, then
      -- the payload and the digest DERIVED from it. Everything downstream reads
      -- these, so nothing downstream depends on a caller having been honest.
      v_record := plugin_data.csf_assert_canonical_record(
        v_job.source_type, coalesce(v_normalized -> 'record', '{}'::jsonb)
      );
      v_payload := plugin_data.csf_derive_row_commit_payload(v_job.source_type, v_record);
      v_digest := plugin_data.csf_canonical_digest(v_record);

      -- A caller digest is allowed to be present and is required to agree. A row
      -- whose stated digest names different evidence than the row carries is a
      -- forged coordinate, not a retry.
      IF nullif(v_row->>'row_hash', '') IS NOT NULL
        AND nullif(v_row->>'row_hash', '') IS DISTINCT FROM v_digest
      THEN
        RAISE EXCEPTION
          'The digest stated for CSF preview row %:% does not match the record it carries.',
          v_tab, v_number USING ERRCODE = '23514';
      END IF;
      IF nullif(v_normalized->>'rowHash', '') IS NOT NULL
        AND nullif(v_normalized->>'rowHash', '') IS DISTINCT FROM v_digest
      THEN
        RAISE EXCEPTION
          'The evidence digest inside CSF preview row %:% does not match the record it carries.',
          v_tab, v_number USING ERRCODE = '23514';
      END IF;

      -- An application row may never arrive with a caller-selected target. Only
      -- an officer resolution binds one, so accepting a match here would be the
      -- whole unresolved-application boundary bypassed by naming a profile.
      IF v_job.source_type = 'application_responses'
        AND nullif(v_row->>'matched_profile_id', '') IS NOT NULL
      THEN
        RAISE EXCEPTION
          'A CSF application preview row may not arrive already bound to a member; an officer resolves it.'
          USING ERRCODE = '23514';
      END IF;

      v_normalized := v_normalized
        || jsonb_build_object('record', v_record, 'rowHash', v_digest, 'commitPayload', v_payload);
    ELSE
      -- Contextual previews keep their own shapes but gain the same two
      -- guarantees: bounded evidence, and no path to central eligibility.
      IF octet_length(v_normalized::text) > 200000 THEN
        RAISE EXCEPTION 'This CSF preview row carries more evidence than the boundary accepts.'
          USING ERRCODE = '22023';
      END IF;
      v_digest := nullif(v_row->>'row_hash', '');
      -- And a contextual row retains NO raw payload at all.
      --
      -- A central row's `raw_data` is already constrained to the accepted
      -- canonical record. A contextual one was stored exactly as the caller sent
      -- it, bounded only by size, so an unmapped source password, an irrelevant
      -- qualitative answer, a hyperlink, a quoted source value or a rejected
      -- column arrived and stayed. Discarding it here rather than refusing the
      -- row is deliberate: refusal would make every existing contextual importer
      -- fail at runtime, while discarding retains nothing and needs no caller to
      -- change first. Nothing reads a contextual `raw_data`; the commit path
      -- reads `normalized_data`.
      v_raw := '{}'::jsonb;
    END IF;

    -- `raw_data` is either empty or exactly the same allowlisted record. A second,
    -- wider copy of the row is what previously carried discarded passwords,
    -- qualitative responses, and rejected columns into the database.
    IF v_central THEN
      IF coalesce(v_row -> 'raw_data', '{}'::jsonb) <> '{}'::jsonb
        AND coalesce(v_row -> 'raw_data', '{}'::jsonb) IS DISTINCT FROM v_record
      THEN
        RAISE EXCEPTION
          'A CSF preview row may only retain the accepted canonical record, never a second wider copy.'
          USING ERRCODE = '23514';
      END IF;
      -- Derived, not forwarded: the stored value is the record this RPC accepted,
      -- so it cannot differ from the record even by a key ordering.
      v_raw := CASE
        WHEN coalesce(v_row -> 'raw_data', '{}'::jsonb) = '{}'::jsonb THEN '{}'::jsonb
        ELSE v_record
      END;
    END IF;

    -- Exact tenant/cohort/term relationships. A row may not reach across tenants
    -- through any of its foreign coordinates.
    IF nullif(v_row->>'cohort_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_cohorts AS cohort
        WHERE cohort.organization_id = p_organization_id
          AND cohort.id = (v_row->>'cohort_id')::uuid
      )
    THEN
      RAISE EXCEPTION 'A CSF preview row must name a class of this organization.'
        USING ERRCODE = '23503';
    END IF;
    IF nullif(v_row->>'term_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_terms AS term
        WHERE term.organization_id = p_organization_id
          AND term.id = (v_row->>'term_id')::uuid
      )
    THEN
      RAISE EXCEPTION 'A CSF preview row must name a semester of this organization.'
        USING ERRCODE = '23503';
    END IF;
    IF nullif(v_row->>'matched_profile_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_profiles AS profile
        WHERE profile.organization_id = p_organization_id
          AND profile.id = (v_row->>'matched_profile_id')::uuid
      )
    THEN
      RAISE EXCEPTION 'A CSF preview row must name a member of this organization.'
        USING ERRCODE = '23503';
    END IF;
    -- A matched application must agree with the row on tenant, member, class and
    -- semester. An application belonging to a different member is not a weaker
    -- match; it is a different student's record.
    IF nullif(v_row->>'matched_application_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_term_applications AS application
        WHERE application.organization_id = p_organization_id
          AND application.id = (v_row->>'matched_application_id')::uuid
          AND (
            nullif(v_row->>'matched_profile_id', '') IS NULL
            OR application.profile_id = (v_row->>'matched_profile_id')::uuid
          )
          AND (
            nullif(v_row->>'term_id', '') IS NULL
            OR application.term_id = (v_row->>'term_id')::uuid
          )
      )
    THEN
      RAISE EXCEPTION
        'A CSF preview row must name an application of this organization that agrees with its member and semester.'
        USING ERRCODE = '23503';
    END IF;

    -- A retry parent must be a row of the exact parent preview at the exact
    -- sheet coordinate. Naming an arbitrary same-organization row would let a
    -- clean row inherit a different row's review history and terminal state.
    IF nullif(v_row->>'retry_of_row_id', '') IS NOT NULL THEN
      IF v_job.retry_of_job_id IS NULL THEN
        RAISE EXCEPTION
          'A CSF preview row may only name a retry parent when its preview is itself a retry.'
          USING ERRCODE = '23514';
      END IF;
      SELECT * INTO v_parent
      FROM plugin_data.csf_sheet_import_rows AS parent
      WHERE parent.organization_id = p_organization_id
        AND parent.id = (v_row->>'retry_of_row_id')::uuid
        AND parent.job_id = v_job.retry_of_job_id
        AND parent.source_id IS NOT DISTINCT FROM v_job.source_id
        AND parent.sheet_tab_name = v_tab
        AND parent.row_number = v_number;
      IF NOT FOUND THEN
        RAISE EXCEPTION
          'The retry parent named by CSF preview row %:% is not that row in the parent preview.',
          v_tab, v_number USING ERRCODE = '23503';
      END IF;
    END IF;

    -- `superseded`, derived. Four facts must all hold, and the row is left
    -- `pending` -- committable, reviewable -- if any of them does not:
    --
    --   1. exact parent lineage, already proved above;
    --   2. the same sheet coordinate, also proved above;
    --   3. the ancestor reached one of the enumerated committed terminal states;
    --   4. the canonical evidence is byte-identical to what that ancestor
    --      carried.
    --
    -- Without (4) a re-previewed row whose values changed would be marked
    -- already-imported and silently skipped by the commit path.
    IF v_requested_superseded THEN
      IF v_parent.id IS NOT NULL
        AND v_parent.import_status = ANY (c_committed_parent_status)
        AND v_parent.row_hash IS NOT NULL
        AND v_parent.row_hash IS NOT DISTINCT FROM v_digest
        AND v_parent.normalized_data IS NOT DISTINCT FROM v_normalized
      THEN
        v_status := 'superseded';
      END IF;
    END IF;

    -- Replay, decided by coordinate rather than by hoping the caller retries cleanly.
    SELECT * INTO v_existing
    FROM plugin_data.csf_sheet_import_rows AS existing
    WHERE existing.job_id = p_preview_job_id
      AND existing.sheet_tab_name = v_tab
      AND existing.row_number = v_number;
    IF FOUND THEN
      IF v_existing.row_hash IS DISTINCT FROM v_digest
        OR v_existing.normalized_data IS DISTINCT FROM v_normalized
        OR v_existing.import_status IS DISTINCT FROM v_status
      THEN
        RAISE EXCEPTION
          'A CSF preview row already exists at %:% describing different evidence; the preview would not describe one read of the source.',
          v_tab, v_number
          USING ERRCODE = '23505';
      END IF;
      v_replayed := v_replayed + 1;
      CONTINUE;
    END IF;

    INSERT INTO plugin_data.csf_sheet_import_rows (
      organization_id, job_id, source_id, cohort_id, term_id, sheet_tab_name, row_number,
      source_range, raw_data, normalized_data, row_hash, matched_profile_id,
      matched_application_id, import_status, errors, warnings, retry_of_row_id,
      source_modified_at, mapping_version
    ) VALUES (
      -- Tenant, job, source and mapping version all come from the locked job.
      p_organization_id, p_preview_job_id, v_job.source_id,
      nullif(v_row->>'cohort_id', '')::uuid,
      nullif(v_row->>'term_id', '')::uuid,
      v_tab,
      v_number,
      nullif(v_row->>'source_range', ''),
      coalesce(v_raw, '{}'::jsonb),
      v_normalized,
      v_digest,
      nullif(v_row->>'matched_profile_id', '')::uuid,
      nullif(v_row->>'matched_application_id', '')::uuid,
      v_status,
      coalesce(
        (SELECT array_agg(value::text) FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(v_row -> 'errors') = 'array' THEN v_row -> 'errors' ELSE '[]'::jsonb END
        ) AS value),
        ARRAY[]::text[]
      ),
      coalesce(
        (SELECT array_agg(value::text) FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(v_row -> 'warnings') = 'array' THEN v_row -> 'warnings' ELSE '[]'::jsonb END
        ) AS value),
        ARRAY[]::text[]
      ),
      nullif(v_row->>'retry_of_row_id', '')::uuid,
      nullif(v_row->>'source_modified_at', '')::timestamptz,
      v_job.mapping_version
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'previewJobId', p_preview_job_id,
    'inserted', v_inserted,
    'replayed', v_replayed
  );
END;
$$;

-- Seal a preview. Status and every count are derived, never accepted.
--
-- The caller used to state both, and the RPC believed them: a preview holding
-- unresolved rows could be sealed `completed` with a summary saying zero, which
-- is exactly the state the commit path treats as ready. Now the caller may
-- provide bounded *display* metadata, and it lives under `display` so it cannot
-- collide with a server-owned key.
CREATE OR REPLACE FUNCTION plugin_data.csf_seal_import_preview(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_preview_job_id uuid,
  p_status text,
  p_summary jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- The server-owned summary namespace, reserved and enumerated. A caller
  -- display key equal to any of these is refused rather than overwritten,
  -- because "the caller could not overwrite it" and "the caller's value was
  -- silently dropped" are different guarantees and only the first is one.
  c_reserved constant text[] := ARRAY[
    'rows', 'pending', 'ambiguous', 'conflict', 'duplicate', 'error', 'skipped',
    'warningRows', 'errorRows', 'ready', 'unresolved', 'status', 'derivedStatus',
    'sealedAt'
  ];
  v_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_display jsonb := coalesce(p_summary, '{}'::jsonb);
  v_key text;
  v_counts record;
  v_derived text;
BEGIN
  IF p_status IS NOT NULL AND p_status NOT IN ('completed', 'needs_resolution') THEN
    RAISE EXCEPTION
      'A CSF preview may only be sealed as completed or needs_resolution.'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_display) <> 'object' THEN
    RAISE EXCEPTION 'A CSF preview summary must be a JSON object.' USING ERRCODE = '22023';
  END IF;
  IF octet_length(v_display::text) > 100000 THEN
    RAISE EXCEPTION 'This CSF preview summary is too large to accept.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT key FROM jsonb_object_keys(v_display) AS keys(key)
  LOOP
    IF v_key = ANY (c_reserved) THEN
      RAISE EXCEPTION
        'A CSF preview summary may not state "%": it is derived from the stored rows.', v_key
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  SELECT * INTO v_job
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = p_preview_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF preview job was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;
  IF v_job.mode <> 'preview' THEN
    RAISE EXCEPTION 'Only a CSF preview job may be sealed.' USING ERRCODE = '23514';
  END IF;
  IF v_job.status <> 'running' THEN
    RETURN jsonb_build_object(
      'sealed', false, 'status', v_job.status, 'reason', 'not_under_construction'
    );
  END IF;
  IF v_job.initiated_by IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Only the officer who started this CSF preview may seal it.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, v_job.source_type
  );

  SELECT
    count(*) AS rows,
    count(*) FILTER (WHERE import_row.import_status = 'pending') AS pending,
    count(*) FILTER (WHERE import_row.import_status = 'ambiguous') AS ambiguous,
    count(*) FILTER (WHERE import_row.import_status = 'conflict') AS conflict,
    count(*) FILTER (WHERE import_row.import_status = 'duplicate') AS duplicate,
    count(*) FILTER (WHERE import_row.import_status = 'error') AS error,
    count(*) FILTER (WHERE import_row.import_status = 'skipped') AS skipped,
    count(*) FILTER (WHERE cardinality(coalesce(import_row.warnings, ARRAY[]::text[])) > 0)
      AS warning_rows,
    count(*) FILTER (WHERE cardinality(coalesce(import_row.errors, ARRAY[]::text[])) > 0)
      AS error_rows
  INTO v_counts
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.job_id = p_preview_job_id;

  -- Derived, from the rows themselves. A preview holding anything an officer
  -- must decide is `needs_resolution` no matter what the caller asked for.
  v_derived := CASE
    WHEN v_counts.ambiguous > 0
      OR v_counts.conflict > 0
      OR v_counts.duplicate > 0
      OR v_counts.error > 0
      OR v_counts.warning_rows > 0
      OR v_counts.error_rows > 0
    THEN 'needs_resolution'
    ELSE 'completed'
  END;

  UPDATE plugin_data.csf_sheet_import_jobs
  SET status = v_derived,
      summary = jsonb_build_object(
        'rows', v_counts.rows,
        'pending', v_counts.pending,
        'ambiguous', v_counts.ambiguous,
        'conflict', v_counts.conflict,
        'duplicate', v_counts.duplicate,
        'error', v_counts.error,
        'skipped', v_counts.skipped,
        'warningRows', v_counts.warning_rows,
        'errorRows', v_counts.error_rows,
        'ready', v_counts.pending,
        'unresolved', v_counts.ambiguous + v_counts.conflict + v_counts.duplicate,
        'derivedStatus', v_derived,
        'sealedAt', now(),
        -- Caller metadata, quarantined. It is display copy, so it is kept, but
        -- it is kept somewhere it can never be mistaken for a derived count.
        'display', v_display
      ),
      completed_at = now(),
      updated_at = now()
  WHERE id = p_preview_job_id;

  RETURN jsonb_build_object(
    'sealed', true,
    'status', v_derived,
    'requestedStatus', p_status,
    'rows', v_counts.rows,
    'unresolved', v_counts.ambiguous + v_counts.conflict + v_counts.duplicate
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_fail_import_preview(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_preview_job_id uuid,
  p_reason_code text,
  p_detail text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_code text := plugin_data.csf_bounded_reason_code(p_reason_code, 'preview_failed');
BEGIN
  -- Cleanup authority, not construction authority: the exact initiator, still an
  -- active member. That deliberately keeps working after their capability is
  -- withdrawn or their position expires, because otherwise a mid-semester role
  -- change would strand a permanent `running` preview.
  PERFORM plugin_data.csf_assert_import_cleanup_actor(
    p_organization_id, p_actor_user_id, p_preview_job_id
  );

  SELECT * INTO v_job
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = p_preview_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('failed', false, 'reason', 'not_found');
  END IF;
  IF v_job.mode <> 'preview' THEN
    RAISE EXCEPTION 'Only a CSF preview job may be marked failed here.' USING ERRCODE = '23514';
  END IF;
  -- A sealed preview stays sealed. A failure path that could reopen a completed preview
  -- would be a way to invalidate rows an officer had already reviewed.
  IF v_job.status <> 'running' THEN
    RETURN jsonb_build_object('failed', false, 'status', v_job.status, 'reason', 'already_final');
  END IF;

  UPDATE plugin_data.csf_sheet_import_jobs
  SET status = 'failed',
      -- The durable artifact is a closed code; sanitized prose is appended only if it
      -- survives the same filter every other failure path uses.
      error_message = v_code || coalesce(
        ': ' || plugin_data.csf_bounded_failure_detail(p_detail), ''
      ),
      completed_at = now(),
      updated_at = now()
  WHERE id = p_preview_job_id;

  -- Whatever queued this preview for recovery is satisfied now.
  UPDATE plugin_data.csf_import_cleanup_recovery AS recovery
  SET settled_at = now(),
      settled_outcome = 'failed',
      updated_at = now()
  WHERE recovery.preview_job_id = p_preview_job_id
    AND recovery.settled_at IS NULL;

  RETURN jsonb_build_object('failed', true, 'reasonCode', v_code);
END;
$$;

-- Queue an abandoned preview for owner-only recovery.
--
-- Called when the interactive failure path itself could not run -- the cleanup
-- RPC errored, the user was removed, the membership vanished. It records a
-- deterministic job coordinate and a lease; it does NOT terminalize the job,
-- because the caller that reached this point is by definition one that could not
-- be trusted to have observed the preview's real state.
CREATE OR REPLACE FUNCTION plugin_data.csf_record_import_cleanup_recovery(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_reason_code text,
  p_detail text,
  p_lease_seconds integer DEFAULT 900
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_lease integer := greatest(60, least(coalesce(p_lease_seconds, 900), 86400));
  v_id uuid;
BEGIN
  SELECT * INTO v_job
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = p_preview_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'not_found');
  END IF;
  IF v_job.mode <> 'preview' THEN
    RAISE EXCEPTION 'Only a CSF preview job may be queued for construction recovery.'
      USING ERRCODE = '23514';
  END IF;
  IF v_job.status <> 'running' THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'already_final', 'status', v_job.status);
  END IF;

  INSERT INTO plugin_data.csf_import_cleanup_recovery AS recovery (
    organization_id, preview_job_id, source_id, initiated_by,
    reason_code, detail, recover_after
  ) VALUES (
    p_organization_id, p_preview_job_id, v_job.source_id, v_job.initiated_by,
    plugin_data.csf_bounded_reason_code(p_reason_code, 'preview_cleanup_failed'),
    plugin_data.csf_bounded_failure_detail(p_detail),
    now() + make_interval(secs => v_lease)
  )
  ON CONFLICT (preview_job_id) WHERE settled_at IS NULL
  DO UPDATE SET
    reason_code = excluded.reason_code,
    detail = excluded.detail,
    recover_after = least(recovery.recover_after, excluded.recover_after),
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('recorded', true, 'recoveryId', v_id, 'previewJobId', p_preview_job_id);
END;
$$;

-- The consumer. Owner-only, idempotent, and structurally unable to invent a
-- completed preview: the only status it writes is `failed`.
CREATE OR REPLACE FUNCTION plugin_data.csf_sweep_import_cleanup_recovery(
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
  v_row record;
  v_failed integer := 0;
  v_already integer := 0;
  v_missing integer := 0;
  v_outcome text;
BEGIN
  FOR v_row IN
    SELECT recovery.id, recovery.organization_id, recovery.preview_job_id, recovery.source_id
    FROM plugin_data.csf_import_cleanup_recovery AS recovery
    WHERE recovery.settled_at IS NULL
      AND recovery.recover_after <= now()
    ORDER BY recovery.recover_after
    LIMIT v_limit
    FOR UPDATE OF recovery SKIP LOCKED
  LOOP
    UPDATE plugin_data.csf_sheet_import_jobs AS job
    SET status = 'failed',
        error_message = coalesce(job.error_message, 'preview_cleanup_recovered'),
        completed_at = now(),
        updated_at = now()
    WHERE job.organization_id = v_row.organization_id
      AND job.id = v_row.preview_job_id
      AND job.mode = 'preview'
      -- The status guard is the safety property: a preview that reached
      -- `completed`, `needs_resolution` or `failed` on its own is never
      -- rewritten, so the sweeper can only ever close a genuinely stuck job.
      AND job.status = 'running';

    IF FOUND THEN
      v_outcome := 'failed';
      v_failed := v_failed + 1;
    ELSIF EXISTS (
      SELECT 1 FROM plugin_data.csf_sheet_import_jobs AS job
      WHERE job.organization_id = v_row.organization_id AND job.id = v_row.preview_job_id
    ) THEN
      v_outcome := 'already_final';
      v_already := v_already + 1;
    ELSE
      v_outcome := 'job_missing';
      v_missing := v_missing + 1;
    END IF;

    UPDATE plugin_data.csf_import_cleanup_recovery
    SET settled_at = now(), settled_outcome = v_outcome,
        attempts = attempts + 1, updated_at = now()
    WHERE id = v_row.id;

    -- An audit receipt, so a sweep that closed somebody's preview is visible in
    -- the same ledger every other import decision lands in.
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id,
      source_type, source_id, after_data
    ) VALUES (
      v_row.organization_id,
      -- Deliberately NULL. The sweeper is the system, not an officer, and
      -- attributing its decision to the officer who happened to start the
      -- preview would put an action they did not take under their name.
      NULL,
      'sheet_import.preview_recovered', 'csf_sheet_import_jobs', v_row.preview_job_id,
      'sheet_import', v_row.source_id::text,
      jsonb_build_object(
        'recoveryId', v_row.id,
        'previewJobId', v_row.preview_job_id,
        'outcome', v_outcome
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'failed', v_failed, 'alreadyFinal', v_already, 'jobMissing', v_missing
  );
END;
$$;

-- ===========================================================================
-- WAVE 3, PART 5: commit-time provider evidence, persisted through the database.
--
-- A preview freezes what Drive said when the officer looked. The commit happens
-- later -- sometimes much later, and always after a review step -- and until
-- here nothing re-read the provider before writing. A source that was renamed,
-- re-shared, trashed, replaced, or edited between preview and commit was
-- committed against the frozen snapshot as if none of that had happened.
--
-- The refresh is a database-owned operation rather than a caller-side check for
-- one reason: the caller cannot be trusted to have performed it. So the claim
-- requires a token this function issues, and this function will only issue one
-- after a compare-and-set against the source's own evidence generation.
--
-- Ordering is the subtle part, and the provider version does NOT supply it. It
-- advances with the FILE, so two concurrent reads of one unchanged file report
-- the identical version and it cannot say which read happened first. Ordering
-- therefore comes from the database generation CAS, and the provider version is
-- compared only for equality against frozen evidence. A provider read that began
-- before a concurrent refresh carries the older generation, fails the CAS, and
-- cannot overwrite the newer evidence or receive the newest token.
--
-- The coordinate itself is Drive's `version`, not `headRevisionId`. Google's
-- Drive v3 `files` resource documents headRevisionId as available only for
-- binary content and checksums as unpopulated for Docs Editors files, so
-- requiring either from a native Sheet is an impossible provider contract; the
-- old `headRevisionId ?? modifiedTime` fallback quietly resolved to the
-- modification time and made the same-granule edit undetectable.
-- ===========================================================================

ALTER TABLE plugin_data.csf_sheet_sources
  ADD COLUMN IF NOT EXISTS evidence_generation bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evidence_refreshed_at timestamptz;

COMMENT ON COLUMN plugin_data.csf_sheet_sources.evidence_generation IS
  'Monotonic counter incremented by plugin_data.csf_refresh_sheet_source_evidence(). The ONLY ordering signal for two provider reads: the provider''s own file version advances with the FILE and is identical across two reads of one unchanged file, and modifiedTime has one-second granularity, so neither can decide which of two concurrent refreshes is newer.';

-- Dropped and rebuilt rather than altered.
--
-- The receipt gained a preview binding and a provider discriminator, and both
-- are `NOT NULL`: there is no coherent value to backfill an unbound draft row
-- with, and a receipt is a two-minute single-use artifact, so nothing durable is
-- lost by starting the table over. `CREATE TABLE IF NOT EXISTS` alone would have
-- left a draft database on the old, unbindable shape while every statement after
-- it reported success.
DROP TABLE IF EXISTS plugin_data.csf_sheet_source_evidence_tokens;

CREATE TABLE plugin_data.csf_sheet_source_evidence_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES plugin_data.csf_sheet_sources (id) ON DELETE CASCADE,
  -- Bound to the actor, so a token issued for one officer cannot authorize
  -- another officer's claim.
  actor_user_id uuid NOT NULL,
  -- Bound to the EXACT preview it authorizes.
  --
  -- Without this a receipt proved only "this source was fresh at some point for
  -- this officer". An officer holding two reviewed previews of one source could
  -- refresh against the newer one and spend the receipt committing the older,
  -- and the consume had no way to notice: it accepted a preview job id and wrote
  -- it down rather than checking it.
  preview_job_id uuid NOT NULL,
  -- Which provider family produced this receipt. A Google receipt must never
  -- satisfy an uploaded source's commit, or vice versa: the two prove entirely
  -- different things, and the whole point of the uploaded issuer is that it
  -- performs no provider call.
  provider text NOT NULL
    CHECK (provider IN ('google_sheets', 'uploaded_xlsx', 'uploaded_csv')),
  nonce uuid NOT NULL DEFAULT gen_random_uuid(),
  evidence_generation bigint NOT NULL,
  metadata_digest text NOT NULL CHECK (metadata_digest ~ '^[0-9a-f]{64}$'),
  provider_file_id text NOT NULL,
  mime_type text NOT NULL,
  modified_time timestamptz NOT NULL,
  -- The Google-only freshness coordinate: Drive's own `version`, a monotonically
  -- increasing counter it advances on every server-side change to the file.
  --
  -- Named for what it is. The column used to be `revision`, and for a native
  -- Sheet it held a copy of `modifiedTime` -- Drive populates `headRevisionId`
  -- and checksums only for binary content, never for a Docs Editors file, so
  -- `headRevisionId ?? modifiedTime` degraded to storing the modification time
  -- twice and calling one copy a revision. Two coordinates that are the same
  -- value cannot disagree, so the "edited inside one timestamp granule" case
  -- they existed to catch was undetectable.
  --
  -- Text, not bigint, and never parsed through a JavaScript number: Drive
  -- documents this as an int64, and a double rounds past 2^53 into a neighbour
  -- that would compare equal to a genuinely different version.
  --
  -- NULL for an uploaded workbook, which has no provider to version it. Its
  -- freshness evidence is `content_digest` plus `staging_generation` below, and
  -- the shape CHECK is what makes "an uploaded receipt carrying a provider
  -- version" unrepresentable rather than merely unwritten.
  provider_version text,
  -- The uploaded-only identity. Immutable facts about the exact staged bytes the
  -- preview read, re-verified at consumption.
  staging_object_id uuid,
  staging_generation integer,
  content_digest text,
  byte_length bigint,
  access_checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by_job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nonce),
  -- Each provider family carries exactly its own evidence and none of the
  -- other's, so "an uploaded receipt with no staging identity" is not a row that
  -- can exist to be checked laxly later.
  CONSTRAINT csf_evidence_tokens_provider_shape_check CHECK (
    (provider = 'google_sheets'
      -- Shape and length bound only. The exact int64 ceiling is the issuer's
      -- job; this is the table refusing a value that is not a canonical
      -- unsigned decimal at all.
      -- `CHECK` accepts UNKNOWN, so the explicit non-null term is load-bearing:
      -- a NULL version must not make this whole provider arm evaluate to NULL
      -- and therefore pass as if it were valid Google evidence.
      AND provider_version IS NOT NULL
      AND provider_version ~ '^[1-9][0-9]{0,18}$'
      AND staging_object_id IS NULL
      AND staging_generation IS NULL
      AND content_digest IS NULL
      AND byte_length IS NULL)
    OR (provider IN ('uploaded_xlsx', 'uploaded_csv')
      AND provider_version IS NULL
      AND staging_object_id IS NOT NULL
      AND staging_generation IS NOT NULL AND staging_generation >= 1
      AND content_digest ~ '^[0-9a-f]{64}$'
      AND byte_length IS NOT NULL AND byte_length > 0)
  ),
  -- Provider and MIME, tied in the table rather than in an issuer.
  --
  -- Both issuers today derive the MIME from the typed provider, but "the issuer
  -- intended to insert the right one" is a property of code that can regress in
  -- one edit; this is a property of the row. A Google receipt naming a CSV, an
  -- XLSX receipt naming Google's editor MIME, a CSV receipt carrying the
  -- spreadsheetml MIME -- none of them can exist, whatever a future issuer
  -- computes. Consumption re-checks the same pairing, so a receipt also cannot
  -- be spent under a MIME its provider does not own.
  CONSTRAINT csf_evidence_tokens_provider_mime_check CHECK (
    (provider = 'google_sheets'
      AND mime_type = 'application/vnd.google-apps.spreadsheet')
    OR (provider = 'uploaded_csv' AND mime_type = 'text/csv')
    OR (provider = 'uploaded_xlsx'
      AND mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  ),
  -- Consumption records the preview binding, and the database -- not a code path
  -- -- is what makes it the binding the receipt was issued under.
  CONSTRAINT csf_evidence_tokens_consumed_binding_check CHECK (
    (consumed_at IS NULL AND consumed_by_job_id IS NULL)
    OR (consumed_at IS NOT NULL
      AND consumed_by_job_id IS NOT NULL
      AND consumed_by_job_id = preview_job_id)
  )
);

CREATE INDEX IF NOT EXISTS csf_evidence_tokens_live_idx
  ON plugin_data.csf_sheet_source_evidence_tokens (source_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS csf_evidence_tokens_preview_idx
  ON plugin_data.csf_sheet_source_evidence_tokens (preview_job_id);

COMMENT ON TABLE plugin_data.csf_sheet_source_evidence_tokens IS
  'Single-use commit-time proof that a CSF source was re-verified immediately before its commit. Bound at issuance to organization, source, actor, the exact preview job, the provider family, the metadata digest, the evidence generation and the access-check time. A Google receipt carries the provider file id, the exact Google Sheets MIME, the modified time and Drive''s own int64 `version`; an uploaded receipt carries no provider version and instead names the staging object, generation, content digest and byte length it was derived from. csf_evidence_tokens_provider_mime_check ties every provider to its one canonical MIME in the table itself, so a crossed provider/MIME receipt cannot exist even if an issuer regresses. Expires no later than two minutes after issue; consumed durably inside the claim''s own transaction so a replay, a wrong preview, or a wrong provider cannot reuse one.';

COMMENT ON COLUMN plugin_data.csf_sheet_source_evidence_tokens.provider_version IS
  'Google Drive''s own monotonic file `version` for the Sheet this receipt attests to, kept as the exact decimal int64 string the provider sent and compared only for equality. It replaced a `revision` column that held `headRevisionId ?? modifiedTime`: Drive populates headRevisionId and checksums only for binary content and never for a Docs Editors file, so for a native Sheet that expression stored the modification time twice. NULL for an uploaded workbook, whose freshness evidence is content_digest and staging_generation.';

ALTER TABLE plugin_data.csf_sheet_source_evidence_tokens ENABLE ROW LEVEL SECURITY;

-- The refresh. Persists live evidence under a generation CAS and returns a
-- single-use token bound to everything the claim will re-check.
CREATE OR REPLACE FUNCTION plugin_data.csf_refresh_sheet_source_evidence(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_preview_job_id uuid,
  p_expected_generation bigint,
  p_provider_file_id text,
  p_mime_type text,
  p_modified_time timestamptz,
  p_provider_version text,
  p_trashed boolean,
  p_access_state text,
  p_file_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Deliberately short. The token exists to prove the provider was read
  -- immediately before the claim, and a long-lived one would prove only that it
  -- was read at some point.
  c_token_ttl_seconds constant integer := 120;
  -- The one MIME a native Google Sheet has. Not a prefix, not a family.
  c_sheets_mime constant text := 'application/vnd.google-apps.spreadsheet';
  -- Drive's `version` is documented as an int64. Canonical decimal text: no
  -- sign, no leading zero, no separators. A leading zero is refused rather than
  -- normalized because this value is only ever compared for exact equality, and
  -- `007` and `7` are the same integer but different evidence.
  c_version_shape constant text := '^[1-9][0-9]*$';
  -- The int64 ceiling, as text. Compared as text on purpose: with no leading
  -- zeros a shorter string is the smaller integer and equal lengths compare
  -- lexicographically in numeric order, so the bound holds with no cast to any
  -- numeric type -- the same rule the TypeScript reader applies, for the same
  -- reason that a double cannot carry this value.
  c_version_max constant text := '9223372036854775807';
  -- Padding DETECTION, never repair, and locale-INDEPENDENT. A provider answer
  -- with a stray space in its file id is not that file id, and `btrim`ing it
  -- into one made a padded answer compare equal to the frozen coordinate it is
  -- supposed to be checked against.
  --
  -- `[[:space:]]` was the previous detector and it is a LOCALE class that does
  -- not match U+0085, U+00A0 or U+200B at all, so this issuer and the readiness
  -- boundary disagreed about the same bytes. The code points are listed by
  -- number instead: Unicode White_Space, plus general categories Cc and Cf.
  -- U+0000 NUL is absent because PostgreSQL `text` cannot hold one -- the
  -- json/text input boundary refuses it before this function is reached.
  -- One shared, complete, locale-independent implementation. See
  -- `plugin_data.csf_has_edge_padding`.
  -- The same Drive-OUTPUT spelling the claim gate applies, checked before the
  -- frozen timestamp is cast: UTC `Z`, and a fraction of exactly 0, 3, 6 or 9
  -- digits. A frozen `+00:00`, `-00:00` or `.1234` is not provider output. The
  -- cast catches an impossible calendar date; it does NOT catch hour 24 or
  -- second 60, which PostgreSQL reads as the neighbouring instant.
  c_drive_instant constant text :=
    '^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])'
    || 'T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]'
    || '(?:\.(?:[0-9]{3}|[0-9]{6}|[0-9]{9}))?Z$';
  -- The three digits BELOW the microsecond, captured so precision `timestamptz`
  -- cannot retain is refused rather than silently truncated into equality.
  c_drive_nanos constant text := '\.[0-9]{6}([0-9]{3})Z$';
  -- Bounds on the free-text provider strings this function stores. A provider
  -- that answers with a megabyte of "file name" is answering wrongly.
  c_max_file_id_length constant integer := 512;
  c_max_file_name_length constant integer := 1024;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_file_id text;
  v_file_name text;
  v_frozen_file_id text;
  v_frozen_version text;
  v_frozen_mime text;
  v_frozen_modified_text text;
  v_frozen_modified_at timestamptz;
  v_digest text;
  v_token plugin_data.csf_sheet_source_evidence_tokens%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_preview_job_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF source evidence refresh must name the preview it is being issued for.'
      USING ERRCODE = '22023';
  END IF;
  IF p_provider_file_id IS NULL
    OR p_mime_type IS NULL
    OR p_modified_time IS NULL
    OR p_provider_version IS NULL
    OR p_trashed IS NULL
    OR p_access_state IS NULL
    OR p_file_name IS NULL
  THEN
    RAISE EXCEPTION
      'A CSF source evidence refresh needs complete provider evidence; null evidence is a refusal, not a value.'
      USING ERRCODE = '22023';
  END IF;

  -- ------------------------------------------------------------------
  -- The server-read provider answer, validated before anything is stored or
  -- compared. Every coordinate is checked for exactly the value the contract
  -- names -- not "present", not "looks about right".
  -- ------------------------------------------------------------------
  -- The file id is IDENTITY, so it is taken exactly as the provider sent it. A
  -- padded answer is rejected rather than canonicalized: `btrim` here repaired
  -- ` 1AbC ` into the id it was about to be compared with, so a wrong answer
  -- became a matching one on its way through the validator.
  v_file_id := nullif(p_provider_file_id, '');
  IF v_file_id IS NULL
    OR plugin_data.csf_has_edge_padding(v_file_id)
    OR length(v_file_id) > c_max_file_id_length
  THEN
    RAISE EXCEPTION
      'The provider did not identify this CSF source with a usable file id.'
      USING ERRCODE = '22023';
  END IF;
  -- The display provenance this refresh records. Bounded and required: a source
  -- the provider will not name is a source nothing can be attributed to.
  v_file_name := nullif(btrim(p_file_name), '');
  IF v_file_name IS NULL OR length(v_file_name) > c_max_file_name_length THEN
    RAISE EXCEPTION
      'The provider did not report a usable name for this CSF source.'
      USING ERRCODE = '22023';
  END IF;
  -- Exactly the Google Sheets MIME. This issuer proves a native Sheet; a Doc, a
  -- Form, a folder and an uploaded workbook are all "not this file".
  IF p_mime_type <> c_sheets_mime THEN
    RAISE EXCEPTION 'This CSF source is no longer a Google Sheet.' USING ERRCODE = '23514';
  END IF;
  -- The freshness coordinate a native Sheet actually exposes. Drive populates
  -- headRevisionId and content checksums only for binary Drive content, never
  -- for a Docs Editors file, so requiring one of those would be an impossible
  -- provider contract; `version` is the one that advances on every server-side
  -- change. A blank, signed, zero, leading-zero or over-long value is malformed
  -- evidence, and malformed evidence is a refusal. Read exactly, with no
  -- `btrim`: a padded version is refused rather than canonicalized into one that
  -- would then compare equal to the frozen coordinate it must be checked against.
  --
  -- `COLLATE "C"` on purpose: the bound is a comparison of DIGITS, and a
  -- database whose default collation reorders or equates characters would
  -- otherwise decide an int64 ceiling by locale rules that have nothing to do
  -- with numbers.
  IF p_provider_version !~ c_version_shape
    OR length(p_provider_version) > length(c_version_max)
    OR (length(p_provider_version) = length(c_version_max)
      AND p_provider_version COLLATE "C" > c_version_max COLLATE "C")
  THEN
    RAISE EXCEPTION
      'The provider did not report a usable version for this CSF source.'
      USING ERRCODE = '22023';
  END IF;
  -- `trashed` must be exactly SQL false, never null and never true. "Not stated"
  -- is not "not trashed". `access_state` must be exactly `accessible`.
  IF p_trashed IS NOT FALSE OR p_access_state <> 'accessible' THEN
    RAISE EXCEPTION 'This CSF source is not currently accessible, so its evidence cannot be refreshed.'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, v_source.source_type
  );

  -- This issuer proves a GOOGLE file is unchanged. An uploaded workbook has no
  -- Drive object to re-read, and letting it through here would mean accepting
  -- caller-supplied "provider evidence" for a source whose evidence is supposed
  -- to come exclusively from locked database state.
  IF v_source.provider <> 'google_sheets' THEN
    RAISE EXCEPTION
      'This CSF source is not a Google source, so its evidence is issued from its staged workbook rather than a provider read.'
      USING ERRCODE = '23514';
  END IF;

  -- The preview this receipt will authorize, resolved and checked here rather
  -- than trusted. A receipt bound to a job that is not a preview, belongs to
  -- another organization, or was taken from a different source proves nothing
  -- about the rows the claim is about to commit.
  SELECT * INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF preview job was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;
  IF v_preview.mode <> 'preview' THEN
    RAISE EXCEPTION 'CSF source evidence is issued against a preview run, not a commit run.'
      USING ERRCODE = '23514';
  END IF;
  IF v_preview.source_id IS DISTINCT FROM p_source_id THEN
    RAISE EXCEPTION 'That CSF preview was taken from a different source.'
      USING ERRCODE = '23514';
  END IF;

  -- Every frozen coordinate is read EXACTLY: the JSON type first, then the text
  -- as it stands with no `btrim`, then a padded value nulled into the existing
  -- missing-evidence refusal. Trimming it instead repaired a padded frozen id
  -- into one that compared equal to the live provider answer, which is the
  -- agreement these comparisons exist to establish rather than manufacture.
  v_frozen_file_id := CASE
    WHEN jsonb_typeof(v_preview.source_file_metadata -> 'id') = 'string'
      THEN nullif(v_preview.source_file_metadata->>'id', '')
    ELSE NULL
  END;
  IF plugin_data.csf_has_edge_padding(v_frozen_file_id) THEN
    v_frozen_file_id := NULL;
  END IF;
  -- The JSON type is part of the coordinate, so it is required before the text.
  --
  -- `jsonb ->> 'version'` coerces the JSON number 58 into the text 58, which then
  -- passes the canonical int64 grammar below exactly as a genuine provider string
  -- would. Drive serializes `version` as a JSON string because an int64 does not
  -- survive a double, so a numeric frozen version has already lost the property
  -- the exact-equality contract depends on. A JSON number, boolean, object, array
  -- or null therefore resolves to NULL here and falls into the existing
  -- re-preview refusal rather than being compared.
  v_frozen_version := CASE
    WHEN jsonb_typeof(v_preview.source_file_metadata -> 'version') = 'string'
      THEN nullif(v_preview.source_file_metadata ->> 'version', '')
    ELSE NULL
  END;
  v_frozen_mime := CASE
    WHEN jsonb_typeof(v_preview.source_file_metadata -> 'mimeType') = 'string'
      THEN nullif(v_preview.source_file_metadata->>'mimeType', '')
    ELSE NULL
  END;
  IF plugin_data.csf_has_edge_padding(v_frozen_mime) THEN
    v_frozen_mime := NULL;
  END IF;
  v_frozen_modified_text := CASE
    WHEN jsonb_typeof(v_preview.source_file_metadata -> 'modifiedTime') = 'string'
      THEN nullif(v_preview.source_file_metadata->>'modifiedTime', '')
    ELSE NULL
  END;

  -- ------------------------------------------------------------------
  -- The live read, compared against what the PREVIEW froze.
  --
  -- Everything below used to be compared against the source row -- that is,
  -- against the previous refresh -- which answers "has this file changed since
  -- the last time anybody looked", not "is this still the file the reviewed rows
  -- were read from". Those diverge exactly when it matters: a takeover or a
  -- retry re-refreshes, the source row moves forward with the file, and the
  -- stale preview commits against evidence that agrees with itself.
  --
  -- All four coordinates are REQUIRED and all four are compared
  -- unconditionally. Two of them -- the MIME and the modified time -- used to be
  -- compared only `IF ... IS NOT NULL`, which meant a preview that never froze
  -- one silently skipped that comparison and still received a receipt. A
  -- comparison that a missing value turns off is not a check; incomplete
  -- evidence is a refusal.
  -- ------------------------------------------------------------------
  IF v_frozen_file_id IS NULL THEN
    RAISE EXCEPTION
      'This CSF preview did not record which provider file it read; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  IF v_frozen_mime IS NULL THEN
    RAISE EXCEPTION
      'This CSF preview did not record what kind of file it read; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  IF v_frozen_modified_text IS NULL THEN
    RAISE EXCEPTION
      'This CSF preview did not record when its source was last modified; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  IF v_frozen_version IS NULL THEN
    RAISE EXCEPTION
      'This CSF preview did not record the provider version a commit must be checked against; preview it again.'
      USING ERRCODE = '23514';
  END IF;

  -- The frozen timestamp is provider text inside an immutable jsonb column, so
  -- its SHAPE is checked before it is parsed, and it is then parsed defensively:
  -- an unparseable one is missing evidence, never an exception escaping to the
  -- caller as a cast error.
  --
  -- The shape check is not redundant with the cast. PostgreSQL rejects an
  -- impossible calendar date -- February 30, a non-leap February 29, April 31 --
  -- but reads `24:00:00` as the next day's midnight and `:60` as the next
  -- minute, and accepts a timestamp with no timezone at all as local time. Each
  -- of those would have become an instant the provider never reported.
  --
  -- The shape now also decides PRECISION. `timestamptz` retains microseconds, so
  -- a frozen `.123456789Z` cast into it silently loses its last three digits and
  -- then compares EQUAL to a stored or live instant it does not name. Nine
  -- digits whose sub-microsecond part is not all zero are refused before the
  -- cast rather than truncated through it.
  v_frozen_modified_at := NULL;
  IF v_frozen_modified_text ~ c_drive_instant
    AND coalesce((regexp_match(v_frozen_modified_text, c_drive_nanos))[1], '000') = '000'
  THEN
    BEGIN
      v_frozen_modified_at := v_frozen_modified_text::timestamptz;
    EXCEPTION WHEN others THEN
      v_frozen_modified_at := NULL;
    END;
  END IF;
  IF v_frozen_modified_at IS NULL THEN
    RAISE EXCEPTION
      'This CSF preview did not record when its source was last modified; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  -- The job column and the frozen metadata describe the same instant or the
  -- preview's own evidence disagrees with itself, which nothing downstream can
  -- resolve.
  IF v_preview.source_modified_at IS NULL
    OR v_preview.source_modified_at IS DISTINCT FROM v_frozen_modified_at
  THEN
    RAISE EXCEPTION
      'This CSF preview did not record when its source was last modified; preview it again.'
      USING ERRCODE = '23514';
  END IF;

  -- The identity chain, closed at its own end.
  --
  -- This issuer compared frozen-to-provider here and provider-to-live below, but
  -- never the JOB's own `source_file_id` -- so a preview whose column named one
  -- Drive file while its frozen metadata named another received a receipt, and
  -- every later comparison was against the frozen copy alone. The job column is
  -- read exactly, with no `btrim`: a padded value is malformed evidence rather
  -- than something to repair into agreement.
  IF nullif(v_preview.source_file_id, '') IS NULL
    OR plugin_data.csf_has_edge_padding(v_preview.source_file_id)
  THEN
    RAISE EXCEPTION
      'This CSF preview did not record which provider file it read; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  IF v_preview.source_file_id IS DISTINCT FROM v_frozen_file_id THEN
    RAISE EXCEPTION 'This CSF preview was taken from a different file than the one it recorded.'
      USING ERRCODE = '23514';
  END IF;
  IF v_file_id IS DISTINCT FROM v_frozen_file_id THEN
    RAISE EXCEPTION 'This CSF preview was taken from a different file than the provider now reports.'
      USING ERRCODE = '23514';
  END IF;
  IF p_mime_type IS DISTINCT FROM v_frozen_mime THEN
    RAISE EXCEPTION 'This CSF source is no longer the kind of file it was previewed as.'
      USING ERRCODE = '23514';
  END IF;
  -- Equal timestamp, different version. Checked against the preview's own
  -- frozen version, so it fires on the FIRST refresh of a source as well: the
  -- previous form compared against `settings->>'evidenceRevision'`, which is
  -- null until some refresh has already run, so the very case this guards --
  -- a file edited within one timestamp granule of the preview -- passed
  -- unexamined the first time through.
  IF p_modified_time = v_frozen_modified_at
    AND p_provider_version IS DISTINCT FROM v_frozen_version
  THEN
    RAISE EXCEPTION
      'This CSF source changed without its modification time advancing; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;
  -- Any other divergence from the reviewed snapshot, in either direction.
  IF p_modified_time IS DISTINCT FROM v_frozen_modified_at THEN
    RAISE EXCEPTION
      'This CSF source changed after it was previewed; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;
  IF p_provider_version IS DISTINCT FROM v_frozen_version THEN
    RAISE EXCEPTION
      'This CSF source''s contents moved on after it was previewed; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;

  -- The compare-and-set. An older provider read carries the generation it saw
  -- before a concurrent refresh bumped it, so it lands here and is refused
  -- rather than overwriting newer evidence and receiving the newest token.
  IF p_expected_generation IS DISTINCT FROM v_source.evidence_generation THEN
    RAISE EXCEPTION
      'This CSF source was refreshed by another read while this one was in flight; run the check again.'
      USING ERRCODE = '40001';
  END IF;

  -- Identity, proved rather than assumed.
  IF v_file_id IS DISTINCT FROM coalesce(v_source.drive_file_id, v_source.spreadsheet_id) THEN
    RAISE EXCEPTION 'The provider answered about a different file than this CSF source names.'
      USING ERRCODE = '23514';
  END IF;

  -- Modification time may not go backwards. It is not an ordering signal on its
  -- own -- that is the generation CAS above -- but a regression means the read
  -- describes an older state of the file than one already accepted.
  IF v_source.drive_modified_at IS NOT NULL AND p_modified_time < v_source.drive_modified_at THEN
    RAISE EXCEPTION
      'The provider reports this CSF source was modified earlier than the evidence already on file; refusing to move it backwards.'
      USING ERRCODE = '23514';
  END IF;
  -- Equal modified time with a changed effective version is a conflict, not an
  -- update: the file changed within one timestamp granule, so the reviewed
  -- preview no longer describes it and a new preview is required.
  --
  -- This is the SOURCE-relative form of the same rule the preview-relative block
  -- above states. It is kept as well as, not instead of: it catches a source
  -- whose own last accepted evidence disagrees with this read, which the
  -- preview-relative check cannot see. Because it depends on a previous refresh
  -- having stored `evidenceRevision`, it is silent on a first refresh -- which is
  -- exactly why the preview-relative check exists and why it is not conditional.
  IF v_source.drive_modified_at IS NOT NULL
    AND p_modified_time = v_source.drive_modified_at
    AND (CASE
      WHEN jsonb_typeof(v_source.settings -> 'evidenceRevision') = 'string'
        THEN nullif(v_source.settings ->> 'evidenceRevision', '')
      ELSE NULL
    END) IS NOT NULL
    AND (CASE
      WHEN jsonb_typeof(v_source.settings -> 'evidenceRevision') = 'string'
        THEN nullif(v_source.settings ->> 'evidenceRevision', '')
      ELSE NULL
    END) IS DISTINCT FROM p_provider_version
  THEN
    RAISE EXCEPTION
      'This CSF source changed without its modification time advancing; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;

  v_digest := encode(
    sha256(convert_to(
      plugin_data.csf_canonical_json(jsonb_build_object(
        'fileId', v_file_id,
        'mimeType', p_mime_type,
        -- `US`, not `MS`. The digest is what consumption re-checks, and `MS`
        -- renders only three fractional digits -- so two provider reads whose
        -- modification times differ by microseconds produced the SAME digest and
        -- a receipt could be spent against evidence it did not attest to. Every
        -- digit the typed column retained is serialized.
        'modifiedTime', to_char(p_modified_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        -- The provider version, not a second copy of the modification time. The
        -- digest is what consumption re-checks, so a coordinate that is absent
        -- here is a coordinate nothing downstream can notice changing.
        'version', p_provider_version,
        'trashed', p_trashed
      )),
      'UTF8'
    )),
    'hex'
  );

  UPDATE plugin_data.csf_sheet_sources
  SET evidence_generation = v_source.evidence_generation + 1,
      evidence_refreshed_at = v_now,
      drive_modified_at = p_modified_time,
      drive_mime_type = p_mime_type,
      drive_trashed = false,
      drive_access_state = 'accessible',
      drive_access_checked_at = v_now,
      -- Display provenance only. A rename is benign and must never block a
      -- commit, so it is recorded and nothing more -- the name is validated as
      -- bounded and nonempty above but is deliberately never compared against
      -- what the preview froze.
      --
      -- Note the conservative consequence, stated rather than papered over: the
      -- documented provider `version` advances on metadata-only changes too, so
      -- a rename between preview and commit CAN move the version and require a
      -- fresh preview. That is a re-preview, not a wrong import, and it is the
      -- direction to be wrong in.
      drive_file_name = v_file_name,
      settings = v_source.settings || jsonb_build_object(
        'evidenceRevision', p_provider_version,
        'evidenceDigest', v_digest
      ),
      updated_at = v_now
  WHERE id = p_source_id;

  INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
    organization_id, source_id, actor_user_id, preview_job_id, provider,
    evidence_generation, metadata_digest,
    provider_file_id, mime_type, modified_time, provider_version,
    access_checked_at, expires_at
  ) VALUES (
    p_organization_id, p_source_id, p_actor_user_id, p_preview_job_id, 'google_sheets',
    v_source.evidence_generation + 1, v_digest,
    v_file_id, p_mime_type, p_modified_time, p_provider_version, v_now,
    v_now + make_interval(secs => c_token_ttl_seconds)
  ) RETURNING * INTO v_token;

  RETURN jsonb_build_object(
    'evidenceToken', v_token.nonce,
    'evidenceGeneration', v_token.evidence_generation,
    'metadataDigest', v_digest,
    'provider', 'google_sheets',
    'previewJobId', p_preview_job_id,
    'expiresAt', v_token.expires_at
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_refresh_sheet_source_evidence(uuid, uuid, uuid, uuid, bigint, text, text, timestamptz, text, boolean, text, text) IS
  'Issues the single-use commit-time receipt for a Google Sheets CSF source from a fresh server-side Drive metadata read. Requires the exact native-Sheet evidence coordinates and validates every one before anything is stored: a bounded nonempty UNPADDED file id, mimeType exactly application/vnd.google-apps.spreadsheet, a non-null modified time, an UNPADDED bounded positive decimal int64 provider version, trashed exactly false, access state exactly accessible, and a bounded nonempty file name kept as display provenance only. The provider file id and provider version are rejected when padded rather than btrimmed into validity -- canonicalizing them made a wrong provider answer compare equal to the frozen coordinate it is checked against -- while the file name may still be btrimmed and bounded because the name is explicitly display provenance and never identity. The preview must have frozen all four of id, mimeType, modifiedTime and version, each read exactly (JSON type checked, untrimmed, padded values refused), with modifiedTime matching the same Drive-OUTPUT spelling the claim gate applies -- UTC Z form, hour 00-23, minute and second 00-59, a fractional part of exactly 0, 3, 6 or 9 digits, no numeric offset and no -00:00 -- and with any sub-microsecond digits required to be zero, because timestamptz retains microseconds and a nonzero nanosecond would be truncated into an equality it does not name, before its guarded timestamptz cast, which then also refuses an impossible calendar date -- with version held as a JSON STRING, since jsonb_typeof(source_file_metadata -> ''version'') = ''string'' is required before ->> is read and a JSON numeric version is refused as re-preview evidence -- and all four are compared unconditionally -- a missing frozen value is a refusal, never a skipped comparison. headRevisionId is NOT used: Drive populates it and content checksums only for binary content and never for a Docs Editors file. The job''s own source_file_id is bound into the identity chain as well, so job id = frozen id = provider id = live id is proved rather than assumed -- previously the job column was never compared with either. The receipt digest serializes the modification time to MICROseconds (US, not MS): with MS, two provider reads differing by microseconds produced the same digest. Padding is detected with an explicit locale-independent class covering Unicode White_Space plus categories Cc and Cf, and the int64 version bound compares digits under COLLATE "C" rather than the database locale. Because the live modification time arrives as a typed timestamptz parameter, this function validates the instant it was given and makes NO claim about the provider''s original raw spelling of it; only the frozen text is checked against the provider''s output grammar. Preserves the evidence_generation compare-and-set and issues a receipt bound to organization, source, actor, preview job and provider, expiring after two minutes.';

-- ---------------------------------------------------------------------------
-- The uploaded-workbook receipt.
--
-- An uploaded XLSX or CSV has no Drive object to re-read, and for a while that
-- was treated as "no evidence is required": the action skipped the refresh, the
-- claim accepted the resulting `NULL`, and an uploaded commit proved nothing at
-- all. Making `NULL` acceptable in general is the wrong repair -- it reopens the
-- same hole for Google sources, because a caller who can pass `NULL` can pass it
-- for anything.
--
-- So an uploaded source gets a receipt of its own, with the same shape,
-- lifetime, single-use rule and preview binding as the Google one. What differs
-- is where the evidence comes from: this function performs NO provider call and
-- accepts NO provider evidence from its caller. Every value it attests to is
-- read, under lock, from the staged generation the source is attached to and the
-- staging object row itself. A caller cannot state the digest, the byte length
-- or the generation, so a caller cannot forge them.
--
-- The immutable uploaded identity is checked here, at issuance, against what the
-- preview froze, and checked again at consumption against the same two rows. An
-- officer who uploads a replacement workbook between preview and commit changes
-- the source's attachment, and both checks then fail.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plugin_data.csf_issue_uploaded_source_evidence(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_preview_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- The same two minutes the Google receipt gets. An uploaded receipt attests to
  -- database state rather than a provider read, but it is still a claim about
  -- *now*, and a long-lived one would let an officer hold it across a
  -- replacement upload.
  c_token_ttl_seconds constant integer := 120;
  -- Padding DETECTION, never repair, and the canonical digest shape both sides
  -- of every comparison below must already be in. `btrim` and `lower` used to
  -- run on the way in, which made a padded or uppercase value agree with a
  -- coordinate it does not name.
  -- Locale-INDEPENDENT edge detection, for the same reason the claim gate and
  -- the Google issuer use it: `[[:space:]]` does not match U+0085, U+00A0 or
  -- U+200B, so a padded coordinate was read as exact here and refused there.
  -- U+0000 NUL cannot appear in PostgreSQL `text` and is refused by the
  -- json/text input boundary before this function sees it.
  -- One shared, complete, locale-independent implementation. See
  -- `plugin_data.csf_has_edge_padding`.
  c_sha256_shape constant text := '^[0-9a-f]{64}$';
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_staging plugin_data.csf_sheet_import_staging_objects%ROWTYPE;
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_staging_object_id uuid;
  v_staging_generation integer;
  v_content_hash text;
  v_byte_length bigint;
  v_frozen_file_id text;
  v_frozen_revision text;
  v_frozen_mime text;
  v_mime text;
  v_digest text;
  v_token plugin_data.csf_sheet_source_evidence_tokens%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_organization_id IS NULL
    OR p_actor_user_id IS NULL
    OR p_source_id IS NULL
    OR p_preview_job_id IS NULL
  THEN
    RAISE EXCEPTION
      'Issuing CSF uploaded-workbook evidence requires an organization, an officer, a source, and the preview.'
      USING ERRCODE = '22023';
  END IF;

  -- Source first, then staging object: the canonical lock order every other
  -- staging path takes, so this cannot deadlock against open, finalize, attach
  -- or retire.
  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, v_source.source_type
  );

  IF v_source.provider NOT IN ('uploaded_xlsx', 'uploaded_csv') THEN
    RAISE EXCEPTION
      'This CSF source is not an uploaded workbook, so its evidence comes from a live provider read.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF preview job was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;
  IF v_preview.mode <> 'preview' THEN
    RAISE EXCEPTION 'CSF source evidence is issued against a preview run, not a commit run.'
      USING ERRCODE = '23514';
  END IF;
  IF v_preview.source_id IS DISTINCT FROM p_source_id THEN
    RAISE EXCEPTION 'That CSF preview was taken from a different source.'
      USING ERRCODE = '23514';
  END IF;

  -- The attachment the source currently points at, read from the row rather than
  -- from the caller. `csf_attach_sheet_source_generation` is the only writer of
  -- these keys, and its compare-and-swap is what makes them trustworthy here.
  --
  -- Read EXACTLY, and cast only behind a shape that makes the cast total.
  --
  -- Two normalizations lived here. `btrim` repaired a padded settings value into
  -- one the staging row would then agree with, and `lower` folded an uppercase
  -- digest into canonical sha256 evidence -- so a source whose recorded digest
  -- was not the canonical digest was issued a receipt attesting that it was.
  -- Both are gone: a padded, uppercase or wrong-type value now falls into the
  -- refusals below instead of being repaired past them.
  --
  -- The shape guards in front of the casts are what keep a malformed value a
  -- bounded refusal: an unguarded `::uuid` or `::bigint` raises 22P02/22003 with
  -- the offending text quoted in the message, which would echo the malformed
  -- coordinate back to a caller.
  v_staging_object_id := CASE
    WHEN jsonb_typeof(v_source.settings -> 'stagingObjectId') = 'string'
      AND v_source.settings->>'stagingObjectId'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (v_source.settings->>'stagingObjectId')::uuid
    ELSE NULL
  END;
  v_staging_generation := CASE
    WHEN jsonb_typeof(v_source.settings -> 'stagingGeneration') = 'number'
      AND v_source.settings->>'stagingGeneration' ~ '^[1-9][0-9]{0,8}$'
      THEN (v_source.settings->>'stagingGeneration')::integer
    ELSE NULL
  END;
  v_content_hash := CASE
    WHEN jsonb_typeof(v_source.settings -> 'stagingContentHash') = 'string'
      THEN nullif(v_source.settings->>'stagingContentHash', '')
    ELSE NULL
  END;
  v_byte_length := CASE
    WHEN jsonb_typeof(v_source.settings -> 'stagingByteLength') = 'number'
      AND v_source.settings->>'stagingByteLength' ~ '^[0-9]{1,18}$'
      THEN (v_source.settings->>'stagingByteLength')::bigint
    ELSE NULL
  END;

  IF v_staging_object_id IS NULL
    OR v_staging_generation IS NULL
    OR v_content_hash IS NULL
    OR v_byte_length IS NULL
  THEN
    RAISE EXCEPTION
      'This CSF source has no attached workbook generation to prove, so this import cannot be committed.'
      USING ERRCODE = '55000';
  END IF;
  -- Canonical LOWERCASE sha256, as stored. An uppercase digest is refused here
  -- rather than folded into canonical evidence: these values are only ever
  -- compared for exact equality, and a digest normalized on the way in is a
  -- digest nothing downstream can attribute to any read of any bytes.
  IF v_content_hash !~ c_sha256_shape THEN
    RAISE EXCEPTION 'This CSF source''s attached workbook digest is not a sha256 digest.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_staging
  FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.organization_id = p_organization_id
    AND staging.id = v_staging_object_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The staged workbook this CSF source points at no longer exists; upload it again and preview.'
      USING ERRCODE = '23503';
  END IF;

  -- The staging row is the authority; the source's copy of it must agree, and a
  -- half-written generation is not evidence of anything.
  IF v_staging.source_id IS DISTINCT FROM p_source_id THEN
    RAISE EXCEPTION 'That staged workbook belongs to a different CSF source.'
      USING ERRCODE = '23514';
  END IF;
  -- `ready`, `retire_pending` and `tombstoned` are all authoritative here, and
  -- `uploading` is not.
  --
  -- This gate used to require `ready`, and that is what trapped the officer in a
  -- preview -> upload-again -> preview loop: a successful preview releases its
  -- claim WITH retirement, settlement moved the generation past `ready`, and the
  -- commit that the preview existed to authorize was then refused for bytes
  -- whose evidence had never changed. This receipt performs no provider call and
  -- rereads no storage: it verifies typed immutable coordinates -- object id,
  -- generation, digest, byte length, ready time, provider MIME -- every one of
  -- which a tombstone still carries. Refusing a tombstone was refusing evidence
  -- that was still exactly true.
  --
  -- `uploading` remains refused because a half-written object has no frozen
  -- evidence to verify. Raw-byte readers stay `ready`-only and are unaffected:
  -- this path never hands anybody a storage path.
  IF v_staging.status NOT IN ('ready', 'retire_pending', 'tombstoned') THEN
    RAISE EXCEPTION
      'The staged workbook this CSF source points at was never made readable; upload it again and preview.'
      USING ERRCODE = '55000';
  END IF;
  IF v_staging.generation IS DISTINCT FROM v_staging_generation
    OR v_staging.content_hash IS DISTINCT FROM v_content_hash
    OR v_staging.byte_length IS DISTINCT FROM v_byte_length
  THEN
    RAISE EXCEPTION
      'This CSF source''s recorded workbook no longer matches the staged bytes; upload it again and preview.'
      USING ERRCODE = '23514';
  END IF;

  -- The preview's own frozen identity. For an uploaded workbook the immutable
  -- identity is the staging object, and the revision evidence is that
  -- generation's content digest -- the same pair the readiness contract compares.
  -- Read exactly, on the same terms as the attachment above: JSON type first, no
  -- `btrim`, no `lower`. The frozen digest is compared byte for byte against the
  -- staged one, so folding case here would have made an uppercase frozen digest
  -- prove bytes it does not name.
  v_frozen_file_id := CASE
    WHEN jsonb_typeof(v_preview.source_file_metadata -> 'id') = 'string'
      THEN nullif(v_preview.source_file_metadata->>'id', '')
    ELSE NULL
  END;
  IF plugin_data.csf_has_edge_padding(v_frozen_file_id) THEN
    v_frozen_file_id := NULL;
  END IF;
  v_frozen_revision := CASE
    WHEN jsonb_typeof(v_preview.source_file_metadata -> 'headRevisionId') = 'string'
      THEN nullif(v_preview.source_file_metadata->>'headRevisionId', '')
    ELSE NULL
  END;
  v_frozen_mime := CASE
    WHEN jsonb_typeof(v_preview.source_file_metadata -> 'mimeType') = 'string'
      THEN nullif(v_preview.source_file_metadata->>'mimeType', '')
    ELSE NULL
  END;
  IF plugin_data.csf_has_edge_padding(v_frozen_mime) THEN
    v_frozen_mime := NULL;
  END IF;

  -- A padded, uppercase or otherwise non-canonical frozen digest is MALFORMED
  -- evidence, not a mismatch: it is refused here rather than reaching the
  -- byte-for-byte comparison below on values that were repaired into shape.
  IF v_frozen_file_id IS NULL
    OR v_frozen_revision IS NULL
    OR v_frozen_revision !~ c_sha256_shape
  THEN
    RAISE EXCEPTION
      'This CSF preview did not record the workbook evidence a commit must be checked against; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  IF v_frozen_file_id IS DISTINCT FROM v_staging_object_id::text THEN
    RAISE EXCEPTION
      'A different workbook is attached to this CSF source than the one this preview read; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  IF v_frozen_revision IS DISTINCT FROM v_content_hash THEN
    RAISE EXCEPTION
      'The workbook attached to this CSF source is not the bytes this preview read; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  -- The preview's OWN record of the bytes it read, bound to the same digest.
  --
  -- The frozen `headRevisionId` and the job's `source_content_hash` are two
  -- independent records of one sequence of staged bytes, and nothing compared
  -- them: a preview could freeze digest A while its own column recorded that it
  -- read digest B, and both were well-formed, so a receipt was issued for a
  -- preview whose evidence contradicts itself. Read exactly -- no `btrim`, no
  -- `lower` -- so a padded or uppercase column is refused rather than repaired.
  -- `snapshot_hash` is deliberately NOT part of this: it digests the normalized
  -- snapshot rather than the uploaded bytes.
  IF nullif(v_preview.source_content_hash, '') IS NULL
    OR v_preview.source_content_hash !~ c_sha256_shape
  THEN
    RAISE EXCEPTION
      'This CSF preview did not record the workbook evidence a commit must be checked against; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  IF v_preview.source_content_hash IS DISTINCT FROM v_content_hash THEN
    RAISE EXCEPTION
      'The workbook attached to this CSF source is not the bytes this preview read; preview it again.'
      USING ERRCODE = '23514';
  END IF;

  -- The exact MIME this typed provider owns, derived here and nowhere else.
  v_mime := CASE v_source.provider
    WHEN 'uploaded_csv' THEN 'text/csv'
    ELSE 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  END;

  -- The preview's frozen MIME must EXIST and must be exactly that value.
  --
  -- This used to reject only a frozen `application/vnd.google-apps%` MIME, which
  -- is a check on one wrong answer rather than a check for the right one: a
  -- preview that froze no MIME at all, or froze `application/pdf`, or froze
  -- `text/csv` for a source now registered as `uploaded_xlsx`, all fell through
  -- the `LIKE` and received a workbook receipt. A CSV receipt and an XLSX
  -- receipt authorize different parsers over the same bytes, so crossing them is
  -- not a cosmetic mismatch.
  IF v_frozen_mime IS NULL THEN
    RAISE EXCEPTION
      'This CSF preview did not record what kind of workbook it read; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  IF v_frozen_mime IS DISTINCT FROM v_mime THEN
    RAISE EXCEPTION
      'This CSF source was previewed as a different kind of file than it is now; preview it again.'
      USING ERRCODE = '23514';
  END IF;

  -- The digest covers every coordinate the consumption re-checks, so a receipt
  -- whose evidence was altered underneath it cannot still match.
  v_digest := encode(
    sha256(convert_to(
      plugin_data.csf_canonical_json(jsonb_build_object(
        'provider', v_source.provider,
        'stagingObjectId', v_staging_object_id::text,
        'stagingGeneration', v_staging_generation,
        'contentHash', v_content_hash,
        'byteLength', v_byte_length,
        'mimeType', v_mime
      )),
      'UTF8'
    )),
    'hex'
  );

  UPDATE plugin_data.csf_sheet_sources
  SET evidence_generation = v_source.evidence_generation + 1,
      evidence_refreshed_at = v_now,
      drive_access_state = 'accessible',
      drive_access_checked_at = v_now,
      settings = v_source.settings || jsonb_build_object(
        'evidenceRevision', v_content_hash,
        'evidenceDigest', v_digest
      ),
      updated_at = v_now
  WHERE id = p_source_id;

  INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
    organization_id, source_id, actor_user_id, preview_job_id, provider,
    evidence_generation, metadata_digest,
    -- No `provider_version`: an uploaded workbook has no provider to version it,
    -- and the table's shape CHECK requires the column to be NULL here. Its
    -- freshness evidence is the content digest and the staged generation below,
    -- which is a stronger statement about the bytes than a counter would be.
    provider_file_id, mime_type, modified_time,
    staging_object_id, staging_generation, content_digest, byte_length,
    access_checked_at, expires_at
  ) VALUES (
    p_organization_id, p_source_id, p_actor_user_id, p_preview_job_id, v_source.provider,
    v_source.evidence_generation + 1, v_digest,
    v_staging_object_id::text, v_mime, coalesce(v_staging.ready_at, v_staging.created_at),
    v_staging_object_id, v_staging_generation, v_content_hash, v_byte_length,
    v_now, v_now + make_interval(secs => c_token_ttl_seconds)
  ) RETURNING * INTO v_token;

  RETURN jsonb_build_object(
    'evidenceToken', v_token.nonce,
    'evidenceGeneration', v_token.evidence_generation,
    'metadataDigest', v_digest,
    'provider', v_source.provider,
    'previewJobId', p_preview_job_id,
    'expiresAt', v_token.expires_at
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_issue_uploaded_source_evidence(uuid, uuid, uuid, uuid) IS
  'Issues the single-use commit-time receipt for an uploaded XLSX/CSV CSF source. Performs no provider call and accepts no provider evidence: the staging object id, generation, sha256 content digest and byte length are read under lock from the source''s attachment and the staging object row, and are verified against the preview''s frozen source_file_metadata before a receipt exists. Every one of those values, and every frozen coordinate, is read EXACTLY -- JSON type checked before ->> is trusted, never btrimmed, never lowercased -- so a padded, uppercase, wrong-type or malformed value is refused instead of being canonicalized into evidence it does not name; the uuid, integer and bigint casts sit behind shape guards so a malformed settings value is a bounded refusal rather than a cast error quoting the offending text back at the caller. The attachment''s digest, the preview''s frozen headRevisionId and the preview''s OWN source_content_hash must all already be canonical lowercase sha256 hex before they are compared byte for byte -- the job column was previously never compared with the frozen digest, so a preview whose two records of the same bytes disagreed still received a receipt. snapshot_hash is deliberately excluded: it digests the normalized snapshot rather than the uploaded bytes. Padding is detected with an explicit locale-independent class covering Unicode White_Space plus categories Cc and Cf, because [[:space:]] is a locale class blind to U+0085, U+00A0 and U+200B. The frozen MIME must EXIST and equal exactly the MIME the typed provider owns -- text/csv for uploaded_csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet for uploaded_xlsx -- so a missing, unrelated or CSV/XLSX-crossed MIME is refused rather than merely not-Google. Bound to organization, source, actor, preview job and provider; expires after two minutes; consumed exactly once by csf_claim_import_commit_attempt.';

-- Consume one. Internal: only the claim path calls it, inside the same
-- transaction that opens the attempt, so a token cannot be spent without a claim
-- or a claim performed without spending one.
CREATE OR REPLACE FUNCTION plugin_data.csf_consume_sheet_source_evidence(
  p_organization_id uuid,
  p_source_id uuid,
  p_actor_user_id uuid,
  p_evidence_token uuid,
  p_preview_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- The same canonical grammars the issuers wrote these values under. Restated
  -- here rather than imported, because the whole point of this function is to be
  -- an INDEPENDENT reader of what was stored -- a verifier that trusts the
  -- writer's own constants proves only that the writer agreed with itself.
  c_sheets_mime constant text := 'application/vnd.google-apps.spreadsheet';
  c_sha256_shape constant text := '^[0-9a-f]{64}$';
  c_version_shape constant text := '^[1-9][0-9]*$';
  c_version_max constant text := '9223372036854775807';
  c_uuid_shape constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  -- One shared, complete, locale-independent implementation. See
  -- `plugin_data.csf_has_edge_padding`.
  v_token plugin_data.csf_sheet_source_evidence_tokens%ROWTYPE;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_staging plugin_data.csf_sheet_import_staging_objects%ROWTYPE;
  -- The digest recomputed from the receipt's own coordinates, so a receipt whose
  -- stored digest does not describe the receipt is refused.
  v_recomputed_digest text;
  v_settings_revision text;
BEGIN
  -- There is deliberately no null-tolerant branch and no default for this
  -- parameter. "No receipt" is the case this whole mechanism exists to refuse,
  -- for every provider family: an uploaded source that cannot produce a receipt
  -- has an unprovable attachment, which is not a reason to commit it anyway.
  IF p_evidence_token IS NULL THEN
    RAISE EXCEPTION
      'This CSF import must re-verify its source immediately before committing.'
      USING ERRCODE = '55000';
  END IF;
  IF p_preview_job_id IS NULL THEN
    RAISE EXCEPTION 'Consuming CSF source evidence requires the preview it was issued for.'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_token
  FROM plugin_data.csf_sheet_source_evidence_tokens AS token
  WHERE token.nonce = p_evidence_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This CSF source freshness check is not recognized.' USING ERRCODE = '55000';
  END IF;

  IF v_token.organization_id IS DISTINCT FROM p_organization_id
    OR v_token.source_id IS DISTINCT FROM p_source_id
    OR v_token.actor_user_id IS DISTINCT FROM p_actor_user_id
  THEN
    RAISE EXCEPTION
      'This CSF source freshness check was issued for a different officer, source, or organization.'
      USING ERRCODE = '42501';
  END IF;
  -- The preview binding, checked rather than recorded.
  --
  -- This function already took a preview job id before this wave; it wrote it
  -- into `consumed_by_job_id` and never compared it to anything. An officer with
  -- two reviewed previews of one source could therefore refresh against either
  -- and spend the receipt on the other.
  IF v_token.preview_job_id IS DISTINCT FROM p_preview_job_id THEN
    RAISE EXCEPTION
      'This CSF source freshness check was issued for a different preview; check this preview and import again.'
      USING ERRCODE = '42501';
  END IF;
  -- Single use, durably. A replayed token is refused rather than silently
  -- accepted a second time.
  IF v_token.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This CSF source freshness check has already been used.' USING ERRCODE = '55000';
  END IF;
  IF v_token.expires_at <= now() THEN
    RAISE EXCEPTION
      'This CSF source freshness check has expired; re-read the source and import again.'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.' USING ERRCODE = '23503';
  END IF;

  -- The provider family the receipt attests to must still be the source's own.
  -- A Google receipt proves a live Drive read; an uploaded receipt proves a
  -- locked staged generation. Neither is evidence about the other, and a source
  -- that changed kind between issue and use has invalidated both.
  IF v_token.provider IS DISTINCT FROM v_source.provider THEN
    RAISE EXCEPTION
      'This CSF source freshness check was issued for a different kind of source; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;

  -- The receipt's own provider/MIME pairing, re-derived here rather than
  -- trusted. `csf_evidence_tokens_provider_mime_check` already makes a crossed
  -- row unrepresentable, but the constraint is enforced at INSERT by the
  -- issuer's intent; this is the reader refusing to spend a receipt whose MIME
  -- does not belong to its provider, so a future issuer regression, a manual
  -- write, or a constraint someone drops does not become a committed import.
  IF v_token.mime_type IS DISTINCT FROM (
    CASE v_token.provider
      WHEN 'google_sheets' THEN 'application/vnd.google-apps.spreadsheet'
      WHEN 'uploaded_csv' THEN 'text/csv'
      WHEN 'uploaded_xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ELSE NULL
    END
  ) THEN
    RAISE EXCEPTION
      'This CSF source freshness check does not describe the kind of file it was issued for; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;

  -- The receipt's own coordinates, revalidated against the canonical grammars
  -- they were written under.
  --
  -- This function used to take the token row as given, on the reasoning that the
  -- issuer had already validated it and the table's CHECK constraints hold the
  -- shape. Neither is a proof at consumption time: a constraint someone drops, a
  -- manual write, or a future issuer regression all produce a row this function
  -- would have spent. A padded provider id, a non-canonical digest or an
  -- overflowing version is malformed evidence here as much as it is there.
  IF nullif(v_token.provider_file_id, '') IS NULL
    OR plugin_data.csf_has_edge_padding(v_token.provider_file_id)
    OR v_token.modified_time IS NULL
  THEN
    RAISE EXCEPTION
      'This CSF source freshness check does not identify the file it was issued for; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;
  IF v_token.provider = 'google_sheets' THEN
    -- Canonical bounded positive decimal int64 TEXT, compared as digits under
    -- the C collation so no database locale decides the bound.
    IF nullif(v_token.provider_version, '') IS NULL
      OR v_token.provider_version !~ c_version_shape
      OR length(v_token.provider_version) > length(c_version_max)
      OR (length(v_token.provider_version) = length(c_version_max)
        AND v_token.provider_version COLLATE "C" > c_version_max COLLATE "C")
    THEN
      RAISE EXCEPTION
        'This CSF source freshness check does not carry a usable provider version; preview it again before importing.'
        USING ERRCODE = '23514';
    END IF;
    -- The receipt is rebound to the LIVE source row, not only to the settings
    -- digest below: identity, kind and modification time must all still be the
    -- ones the receipt attested to.
    IF v_token.provider_file_id
      IS DISTINCT FROM nullif(coalesce(v_source.drive_file_id, v_source.spreadsheet_id), '')
      OR v_source.drive_mime_type IS DISTINCT FROM c_sheets_mime
      OR v_source.drive_modified_at IS DISTINCT FROM v_token.modified_time
    THEN
      RAISE EXCEPTION
        'This CSF source changed after it was checked; preview it again before importing.'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    IF v_token.content_digest IS NULL
      OR v_token.content_digest !~ c_sha256_shape
      OR v_token.staging_object_id IS NULL
      OR v_token.provider_file_id !~ c_uuid_shape
      OR v_token.provider_file_id IS DISTINCT FROM v_token.staging_object_id::text
    THEN
      RAISE EXCEPTION
        'This CSF source freshness check does not carry a usable workbook digest; preview it again before importing.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF v_token.metadata_digest IS NULL OR v_token.metadata_digest !~ c_sha256_shape THEN
    RAISE EXCEPTION
      'This CSF source freshness check does not carry a usable evidence digest; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;

  -- The digest, RECOMPUTED from the receipt's own coordinates.
  --
  -- Comparing the stored digest against the source's settings proves the two
  -- copies agree; it does not prove either describes the receipt. Rebuilding it
  -- from the token's own columns does, so a row whose digest was written
  -- separately from its coordinates cannot be spent. `trashed` is `false` by
  -- construction: the Google issuer refuses to issue at all unless the provider
  -- reported exactly SQL false, so there is no other value a receipt can encode.
  v_recomputed_digest := encode(
    sha256(convert_to(
      plugin_data.csf_canonical_json(
        CASE
          WHEN v_token.provider = 'google_sheets' THEN jsonb_build_object(
            'fileId', v_token.provider_file_id,
            'mimeType', v_token.mime_type,
            'modifiedTime', to_char(
              v_token.modified_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ),
            'version', v_token.provider_version,
            'trashed', false
          )
          ELSE jsonb_build_object(
            'provider', v_token.provider,
            'stagingObjectId', v_token.staging_object_id::text,
            'stagingGeneration', v_token.staging_generation,
            'contentHash', v_token.content_digest,
            'byteLength', v_token.byte_length,
            'mimeType', v_token.mime_type
          )
        END
      ),
      'UTF8'
    )),
    'hex'
  );
  IF v_recomputed_digest IS DISTINCT FROM v_token.metadata_digest THEN
    RAISE EXCEPTION
      'This CSF source freshness check does not describe the evidence it was issued for; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;

  -- The receipt-written revision, revalidated as canonical rather than merely
  -- present. For a Google source this is the exact provider version string; for
  -- an uploaded one it is the sha256 content digest. Both are compared for
  -- EQUALITY only, and neither is btrimmed or lowercased into agreement.
  v_settings_revision := CASE
    WHEN jsonb_typeof(v_source.settings -> 'evidenceRevision') = 'string'
      THEN nullif(v_source.settings ->> 'evidenceRevision', '')
    ELSE NULL
  END;
  IF v_settings_revision IS NULL
    OR plugin_data.csf_has_edge_padding(v_settings_revision)
    OR v_settings_revision IS DISTINCT FROM (CASE
      WHEN v_token.provider = 'google_sheets' THEN v_token.provider_version
      ELSE v_token.content_digest
    END)
  THEN
    RAISE EXCEPTION
      'This CSF source changed after it was checked; preview it again before importing.'
      USING ERRCODE = '40001';
  END IF;

  -- Stale by generation, or stale by digest. A competing refresh that landed
  -- between this token's issue and its use replaced both, so the reviewed
  -- snapshot is no longer what the provider holds.
  --
  -- The stored digest is read exactly: its JSON type is checked before `->>` is
  -- trusted, and it is not btrimmed into agreement with the receipt's own.
  IF v_token.evidence_generation IS DISTINCT FROM v_source.evidence_generation
    OR v_token.metadata_digest IS DISTINCT FROM (CASE
      WHEN jsonb_typeof(v_source.settings -> 'evidenceDigest') = 'string'
        THEN nullif(v_source.settings ->> 'evidenceDigest', '')
      ELSE NULL
    END)
  THEN
    RAISE EXCEPTION
      'This CSF source changed after it was checked; preview it again before importing.'
      USING ERRCODE = '40001';
  END IF;

  -- The uploaded identity, verified a second time against the two rows it was
  -- derived from. The generation CAS above already refuses a receipt issued
  -- before a competing refresh, but a replacement upload is a change to the
  -- *attachment*, and this is what notices it.
  IF v_token.provider IN ('uploaded_xlsx', 'uploaded_csv') THEN
    -- Re-read on exactly the terms the issuer wrote them: JSON type checked, not
    -- btrimmed, not lowercased, and cast only behind a shape that makes the cast
    -- total so a malformed settings value is this bounded refusal rather than a
    -- 22P02 quoting the offending text back at the caller. A padded, uppercase
    -- or wrong-type value therefore resolves to NULL, which `IS DISTINCT FROM`
    -- the receipt's coordinate and refuses -- rather than being repaired into
    -- agreement with a receipt that never attested to it.
    IF (CASE
        WHEN jsonb_typeof(v_source.settings -> 'stagingObjectId') = 'string'
          AND v_source.settings->>'stagingObjectId'
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (v_source.settings->>'stagingObjectId')::uuid
        ELSE NULL
      END) IS DISTINCT FROM v_token.staging_object_id
      OR (CASE
        WHEN jsonb_typeof(v_source.settings -> 'stagingGeneration') = 'number'
          AND v_source.settings->>'stagingGeneration' ~ '^[1-9][0-9]{0,8}$'
          THEN (v_source.settings->>'stagingGeneration')::integer
        ELSE NULL
      END) IS DISTINCT FROM v_token.staging_generation
      OR (CASE
        WHEN jsonb_typeof(v_source.settings -> 'stagingContentHash') = 'string'
          THEN nullif(v_source.settings->>'stagingContentHash', '')
        ELSE NULL
      END) IS DISTINCT FROM v_token.content_digest
      OR (CASE
        WHEN jsonb_typeof(v_source.settings -> 'stagingByteLength') = 'number'
          AND v_source.settings->>'stagingByteLength' ~ '^[0-9]{1,18}$'
          THEN (v_source.settings->>'stagingByteLength')::bigint
        ELSE NULL
      END) IS DISTINCT FROM v_token.byte_length
    THEN
      RAISE EXCEPTION
        'A different workbook is attached to this CSF source than the one this import checked; preview it again.'
        USING ERRCODE = '40001';
    END IF;

    SELECT * INTO v_staging
    FROM plugin_data.csf_sheet_import_staging_objects AS staging
    WHERE staging.organization_id = p_organization_id
      AND staging.id = v_token.staging_object_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'The staged workbook this CSF import checked no longer exists; upload it again and preview.'
        USING ERRCODE = '23503';
    END IF;
    IF v_staging.source_id IS DISTINCT FROM p_source_id
      -- The same three-state immutable-evidence allowlist the issuer uses, and
      -- for the same reason: this comparison verifies typed coordinates that a
      -- tombstone still carries -- object id, generation, digest, byte length --
      -- and never reads a storage path. Requiring `ready` here reinstated the
      -- preview -> upload-again loop one step later than the issuer did: the
      -- receipt was granted and then refused at the moment it was consumed.
      -- `uploading` stays refused, because a half-written object has no frozen
      -- evidence to compare against.
      OR v_staging.status NOT IN ('ready', 'retire_pending', 'tombstoned')
      OR v_staging.generation IS DISTINCT FROM v_token.staging_generation
      OR v_staging.content_hash IS DISTINCT FROM v_token.content_digest
      OR v_staging.byte_length IS DISTINCT FROM v_token.byte_length
    THEN
      RAISE EXCEPTION
        'The staged workbook this CSF import checked is no longer the bytes it proved; upload it again and preview.'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  -- Consumption records the exact preview binding. `consumed_by_job_id` equals
  -- `preview_job_id` by table constraint, so this cannot drift into recording
  -- some other job even if a future caller passes one.
  UPDATE plugin_data.csf_sheet_source_evidence_tokens
  SET consumed_at = now(), consumed_by_job_id = v_token.preview_job_id
  WHERE id = v_token.id;

  RETURN jsonb_build_object(
    'consumed', true,
    'provider', v_token.provider,
    'previewJobId', v_token.preview_job_id,
    'evidenceGeneration', v_token.evidence_generation,
    'metadataDigest', v_token.metadata_digest
  );
END;
$$;

-- Organization-uninstall deletion of the sheet-source lifecycle, child first.
--
-- The plugin's data-delete path used to issue a generic
-- `.delete().eq("organization_id", ...)` against `csf_sheet_sources`,
-- `csf_sheet_import_jobs` and `csf_sheet_import_rows`. Those tables are
-- SELECT-only to `service_role` after wave 2, so that path could no longer
-- delete anything at all -- an uninstall would fail partway through, leaving a
-- half-removed tenant. This is the owned replacement.
CREATE OR REPLACE FUNCTION plugin_data.csf_purge_import_recovery(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tokens integer := 0;
  v_recovery integer := 0;
  v_claims integer := 0;
  v_objects integer := 0;
  v_attempts integer := 0;
  v_rows integer := 0;
  v_jobs integer := 0;
  v_sources integer := 0;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF import recovery purge requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  -- Child before parent, throughout: evidence tokens and cleanup receipts
  -- reference sources and jobs; claims reference staging objects; attempts and
  -- rows reference jobs; jobs reference sources.
  DELETE FROM plugin_data.csf_sheet_source_evidence_tokens AS token
  WHERE token.organization_id = p_organization_id;
  GET DIAGNOSTICS v_tokens = ROW_COUNT;

  DELETE FROM plugin_data.csf_import_cleanup_recovery AS recovery
  WHERE recovery.organization_id = p_organization_id;
  GET DIAGNOSTICS v_recovery = ROW_COUNT;

  DELETE FROM plugin_data.csf_sheet_import_staging_claims AS claim
  WHERE claim.organization_id = p_organization_id;
  GET DIAGNOSTICS v_claims = ROW_COUNT;

  DELETE FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.organization_id = p_organization_id;
  GET DIAGNOSTICS v_objects = ROW_COUNT;

  DELETE FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  WHERE attempt.organization_id = p_organization_id;
  GET DIAGNOSTICS v_attempts = ROW_COUNT;

  DELETE FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  DELETE FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  DELETE FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id;
  GET DIAGNOSTICS v_sources = ROW_COUNT;

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'evidenceTokens', v_tokens,
    'cleanupRecoveries', v_recovery,
    'stagingClaims', v_claims,
    'stagingObjects', v_objects,
    'commitAttempts', v_attempts,
    'importRows', v_rows,
    'importJobs', v_jobs,
    'sheetSources', v_sources
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_purge_import_recovery(uuid) IS
  'Owner-only helper that retires one organization''s import-recovery footprint child-first: csf_sheet_source_evidence_tokens, csf_import_cleanup_recovery, csf_sheet_import_staging_claims, csf_sheet_import_staging_objects, csf_sheet_import_commit_attempts, csf_sheet_import_rows, csf_sheet_import_jobs, csf_sheet_sources. Returns EXACTLY: organizationId, evidenceTokens, cleanupRecoveries, stagingClaims, stagingObjects, commitAttempts, importRows, importJobs, sheetSources. Called by csf_purge_recovery_foundations() before its communications and calendar sweep; that wrapper''s own 14-key contract is unchanged.';


-- ===========================================================================
-- WAVE 5: the sheet-source registry stops being a directly writable table.
--
-- Nineteen application call sites wrote `plugin_data.csf_sheet_sources`
-- directly with a service-role client. Each one chose its own column set, its
-- own settings shape, and its own idea of which fields are identity; none of
-- them authorized anything, because the table held the write privilege and the
-- privilege does not ask who is calling.
--
-- One of those writes was also a lost update waiting to happen. The uploaded
-- workbook flow read `settings`, built a new object in TypeScript, and wrote it
-- back. Two uploads finishing close together therefore raced: the slower one
-- overwrote the faster one's `stagingGeneration`, pointing the source at bytes
-- that had already been retired.
--
-- Four owned RPCs replace all nineteen. Each authorizes the acting officer from
-- the source's own recorded kind, accepts an exactly-enumerated field set rather
-- than arbitrary JSON, and owns one transition:
--
--   csf_register_sheet_source            create or reconfigure a source
--   csf_record_sheet_source_sync         bounded sync-status transition
--   csf_refresh_sheet_source_drive_metadata   provider provenance only
--   csf_attach_sheet_source_generation   compare-and-swap a staged generation
--
-- `settings.staging*` is writable by the attach RPC alone. That is what makes
-- the compare-and-swap meaningful: no other path can move the attachment.
-- ===========================================================================

-- The closed settings vocabulary. Every key one of the five importers writes,
-- with its exact JSON type. An unknown key is refused rather than stored, so a
-- future field cannot arrive unreviewed inside an opaque blob.
CREATE OR REPLACE FUNCTION plugin_data.csf_sheet_source_settings_schema()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT '{
    "sourceKind": "string",
    "sourceVariant": "string",
    "targetStrategy": "string",
    "mappingVersion": "number",
    "headerRow": "number",
    "selectedTabs": "array",
    "availableTabs": "array",
    "visibleTabs": "array",
    "hiddenTabCount": "number",
    "workbookFormat": "string",
    "fileHash": "string",
    "contentHash": "string",
    "meetingId": "string",
    "termId": "string",
    "partnerClubId": "string",
    "batchId": "string",
    "latestPreviewJobId": "string",
    "sheetImportSourceId": "string",
    "sheetImportPreviewJobId": "string",
    "sheetImportCorrelationId": "string"
  }'::jsonb;
$$;

COMMENT ON FUNCTION plugin_data.csf_sheet_source_settings_schema() IS
  'The closed settings vocabulary a caller may register. Deliberately excludes every stagingObjectId/stagingGeneration/stagingContentHash/stagingByteLength/stagingReadyAt key: those are written only by csf_attach_sheet_source_generation, which is what makes its compare-and-swap the single authority over which generation a source points at.';

-- The system-owned settings namespace: every key a caller may neither state nor
-- erase.
--
-- Two groups, written by two different owners and previously only half handled:
--
--   * the staged-generation attachment, written by
--     `csf_attach_sheet_source_generation`, and
--   * the live provider evidence, written by
--     `csf_refresh_sheet_source_evidence`.
--
-- Reconfiguration used to carry only the first group forward, so saving a mapping
-- silently erased `evidenceRevision` and `evidenceDigest` -- the exact values the
-- commit-time token consumption compares against. The next commit would then see
-- a source whose recorded evidence had vanished.
CREATE OR REPLACE FUNCTION plugin_data.csf_sheet_source_attachment_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    -- Staged generation, owned by csf_attach_sheet_source_generation.
    -- `stagedUpload` belongs here too: it states WHETHER this source points at a
    -- staged generation, which is the same fact the coordinates below describe.
    -- Leaving it caller-writable let a mapping save set it false while the
    -- attachment coordinates still pointed at a live generation.
    'stagedUpload',
    'stagingObjectId', 'stagingGeneration', 'stagingContentHash',
    'stagingByteLength', 'stagingReadyAt',
    -- The canonical identity of the accepted attachment request, so a replay can
    -- be compared byte for byte rather than by generation alone, and the two ids
    -- of the immutable audit row that request wrote inside the same transaction.
    --
    -- All three are one group. A caller able to state or erase any of them could
    -- point a source's receipt at an audit row describing a different
    -- attachment -- or erase the evidence that the attachment was audited at all
    -- -- which is the whole thing the receipt exists to prove.
    'stagingRequestDigest', 'stagingAuditEventId', 'stagingAuditCorrelationId',
    -- Live source evidence, owned by csf_refresh_sheet_source_evidence for a
    -- Google source and csf_issue_uploaded_source_evidence for an uploaded one.
    -- Two writers, one namespace: both are receipt issuers, and neither accepts
    -- these values from a caller.
    --
    -- `evidenceRevision` is one compatibility key with two provider meanings, and
    -- reading it requires knowing the source's provider:
    --
    --   google_sheets              the exact Drive `version` decimal int64 STRING
    --   uploaded_xlsx/uploaded_csv the staged generation's sha256 content digest
    --
    -- The name predates the split and is kept rather than widened, because
    -- renaming it would rewrite every writer, reader and carry-forward path in
    -- this migration for no behavioral gain. Either meaning is compared for
    -- EQUALITY only -- never ordered, never arithmetically compared, never cast to
    -- a numeric type -- which is what lets one column hold both.
    'evidenceRevision', 'evidenceDigest'
  ];
$$;

COMMENT ON FUNCTION plugin_data.csf_sheet_source_attachment_keys() IS
  'The complete system-owned settings namespace: staged-generation attachment proof, the accepted attachment request digest with both ids of the immutable audit row that request wrote in the same transaction, and live provider evidence. A caller may neither state nor erase any of them, and reconfiguration carries every one forward from the stored row. evidenceRevision is provider-dependent by design: it holds the exact Drive version decimal int64 string for a google_sheets source and the staged generation''s sha256 content digest for an uploaded_xlsx/uploaded_csv one, and either meaning is compared for equality only, never ordered and never cast to a numeric type.';

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_sheet_source_settings(
  p_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_schema jsonb := plugin_data.csf_sheet_source_settings_schema();
  v_attachment text[] := plugin_data.csf_sheet_source_attachment_keys();
  v_key text;
  v_expected text;
BEGIN
  IF p_settings IS NULL OR pg_catalog.jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'CSF source settings must be a JSON object.' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.octet_length(p_settings::text) > 20000 THEN
    RAISE EXCEPTION 'These CSF source settings are too large to accept.' USING ERRCODE = '22023';
  END IF;

  FOR v_key IN SELECT key FROM pg_catalog.jsonb_object_keys(p_settings) AS keys(key)
  LOOP
    IF v_key = ANY (v_attachment) THEN
      RAISE EXCEPTION
        'CSF source settings may not state "%": the staged generation is written only by csf_attach_sheet_source_generation and the provider evidence only by csf_refresh_sheet_source_evidence.',
        v_key USING ERRCODE = '23514';
    END IF;
    v_expected := v_schema ->> v_key;
    IF v_expected IS NULL THEN
      RAISE EXCEPTION 'CSF source settings may not carry "%".', v_key USING ERRCODE = '23514';
    END IF;
    IF pg_catalog.jsonb_typeof(p_settings -> v_key) NOT IN (v_expected, 'null') THEN
      RAISE EXCEPTION 'CSF source setting "%" must be a % or null.', v_key, v_expected
        USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN p_settings;
END;
$$;

-- Register or reconfigure one source.
--
-- `p_source_id` NULL creates; non-null reconfigures. Either way the ORGANIZATION
-- comes from the authorized argument and the SOURCE KIND is immutable after
-- creation: it selects which capability governs the source, so a caller able to
-- change it could move a source under a permission they happen to hold.
CREATE OR REPLACE FUNCTION plugin_data.csf_register_sheet_source(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_source_type text,
  p_registration jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_allowed constant text[] := ARRAY[
    'title', 'provider', 'cohortId', 'spreadsheetId', 'driveFileId',
    'uploadedFilePath', 'sheetUrl', 'syncMode', 'syncStatus', 'lastSyncStatus',
    'lastSyncError', 'targetStrategy', 'duplicatePolicy', 'columnMappings',
    'tabMappings', 'settings', 'driveMetadata'
  ];
  c_sync_modes constant text[] := ARRAY['manual', 'scheduled', 'disabled'];
  c_sync_status constant text[] := ARRAY[
    'not_synced', 'healthy', 'needs_attention', 'failed', 'disabled'
  ];
  -- The closed set of provider families this contract has evidence semantics
  -- for. A provider outside it has no adapter, no frozen-coordinate grammar and
  -- no consumer gate, so storing one would create a source nothing can preview.
  c_providers constant text[] := ARRAY[
    'google_sheets', 'uploaded_csv', 'uploaded_xlsx'
  ];
  v_existing plugin_data.csf_sheet_sources%ROWTYPE;
  v_key text;
  v_settings jsonb;
  v_metadata jsonb;
  v_source_id uuid;
  v_provider text;
  v_created boolean := false;
  -- B1b.3.1: the create-or-adopt arbitration.
  v_adopted boolean := false;
  v_effective_provider text;
  v_is_uploaded boolean := false;
  v_requested_digest text;
  v_stored_digest text;
  v_winner plugin_data.csf_sheet_sources%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Registering a CSF source requires an organization.' USING ERRCODE = '22023';
  END IF;
  IF p_registration IS NULL OR pg_catalog.jsonb_typeof(p_registration) <> 'object' THEN
    RAISE EXCEPTION 'A CSF source registration must be a JSON object.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT key FROM pg_catalog.jsonb_object_keys(p_registration) AS keys(key)
  LOOP
    IF NOT (v_key = ANY (c_allowed)) THEN
      RAISE EXCEPTION 'A CSF source registration may not set "%".', v_key USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF p_source_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM plugin_data.csf_sheet_sources AS source
    WHERE source.organization_id = p_organization_id
      AND source.id = p_source_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CSF sheet source was not found for this organization.'
        USING ERRCODE = '23503';
    END IF;
    -- Immutable identity. The kind a source was registered as is the kind it
    -- stays; a reconfiguration that could change it would move the source under
    -- a different capability.
    IF p_source_type IS DISTINCT FROM v_existing.source_type THEN
      RAISE EXCEPTION
        'A CSF source keeps the kind it was registered as; create a new source instead.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- The requested provider, validated as an exact primitive supported value.
  --
  -- `->>` renders a JSON number, boolean or array into text, so the type is
  -- required before the value is read. An omitted key means "keep what is
  -- stored" for a reconfiguration and `google_sheets` for a creation, which is
  -- the behaviour the previous `coalesce(nullif(...), source.provider)` had --
  -- but only for an omitted key, never for a different one.
  IF p_registration ? 'provider' THEN
    IF pg_catalog.jsonb_typeof(p_registration -> 'provider') <> 'string' THEN
      RAISE EXCEPTION 'A CSF source provider must be a JSON string.' USING ERRCODE = '22023';
    END IF;
    v_provider := p_registration ->> 'provider';
    IF NOT (v_provider = ANY (c_providers)) THEN
      RAISE EXCEPTION 'CSF source provider "%" is not supported.', v_provider
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Provider is IMMUTABLE, exactly as source kind is.
  --
  -- It was not: `provider = coalesce(nullif(p_registration ->> 'provider', ''),
  -- source.provider)` accepted any spelling and rewrote the column. So
  -- re-registering the same source could relabel bytes that were never
  -- re-uploaded -- an attached uploaded workbook could become `google_sheets`
  -- while its staging attachment, digest and evidence stayed exactly where they
  -- were -- and the family-specific evidence a consumer then applied was the
  -- new label's, against the old family's coordinates. This RAISES before any
  -- update, so the row, its attachment, its evidence, its mappings and its
  -- metadata are all left untouched. Changing families means a new source.
  IF p_source_id IS NOT NULL
    AND v_provider IS NOT NULL
    AND v_provider IS DISTINCT FROM v_existing.provider
  THEN
    RAISE EXCEPTION
      'A CSF source keeps the provider it was registered as; create a new source instead.'
      USING ERRCODE = '23514';
  END IF;

  -- The stored file pointer is the ATTACHMENT CONTRACT's, not a caller's.
  --
  -- A creation may state `uploadedFilePath`: the contextual attendance and
  -- partner-club importers register a source for bytes they have already
  -- written, and there is no attachment to invalidate yet. A RECONFIGURATION may
  -- not, and the previous
  -- `uploaded_file_path = coalesce(nullif(p_registration ->> 'uploadedFilePath', ''), source.uploaded_file_path)`
  -- let it: a mapping save, or any widened service payload, could move the
  -- pointer of an attached source while its settings still named the old
  -- generation. The attachment would then be internally contradictory --
  -- `csf_attach_sheet_source_generation` and its reconciliation both classify
  -- that as corruption -- so an otherwise perfect receipt would be destroyed by
  -- a save that had nothing to do with the workbook. Refused before any update,
  -- and the column below is written as the stored value unconditionally.
  IF p_source_id IS NOT NULL AND p_registration ? 'uploadedFilePath' THEN
    RAISE EXCEPTION
      'A CSF source''s stored file is moved only by the attachment contract; a reconfiguration may not state it.'
      USING ERRCODE = '23514';
  END IF;

  -- Authorized against the source's own kind for a reconfiguration, and against
  -- the requested kind for a creation. Both go through the same matrix.
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id,
    coalesce(v_existing.source_type, p_source_type)
  );

  v_settings := plugin_data.csf_assert_sheet_source_settings(
    coalesce(p_registration -> 'settings', '{}'::jsonb)
  );
  -- The source's own statement of its kind has to agree with the column, because
  -- open/preview compares the two and refuses a source that disagrees with itself.
  IF coalesce(v_settings ->> 'sourceKind', '') IS DISTINCT FROM coalesce(v_existing.source_type, p_source_type) THEN
    RAISE EXCEPTION 'CSF source settings must state the same source kind as the source.'
      USING ERRCODE = '23514';
  END IF;

  -- ------------------------------------------------------------------
  -- B1b.3.1 -- the uploaded digest is CANONICAL and IMMUTABLE.
  --
  -- `settings.contentHash` is the key the partial unique index arbitrates on, so
  -- it is logical identity rather than an ordinary caller setting. Two things
  -- follow, and neither held before:
  --
  --   * it must be a primitive JSON string matching raw `^[0-9a-f]{64}$` before
  --     it can participate. A padded, uppercase, numeric or object value is
  --     refused rather than normalized -- repairing it would mean adopting a row
  --     that was never this workbook;
  --   * a reconfiguration may restate it EXACTLY or omit it, and nothing else. It
  --     used to be an ordinary key the caller could rewrite or erase, which made
  --     the arbiter mutable: a mapping save could move a source out from under
  --     the digest that identified it, or give a digestless legacy source one and
  --     let it bypass create-or-adopt entirely.
  -- ------------------------------------------------------------------
  v_effective_provider := coalesce(v_provider, v_existing.provider, 'google_sheets');
  v_is_uploaded := v_effective_provider IN ('uploaded_xlsx', 'uploaded_csv');

  IF v_settings ? 'contentHash' THEN
    IF pg_catalog.jsonb_typeof(v_settings -> 'contentHash') <> 'string' THEN
      RAISE EXCEPTION 'A CSF uploaded workbook digest must be a JSON string.'
        USING ERRCODE = '22023';
    END IF;
    v_requested_digest := v_settings ->> 'contentHash';
    IF v_is_uploaded AND v_requested_digest !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION
        'A CSF uploaded workbook digest must be a canonical lowercase sha256.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_source_id IS NOT NULL AND v_is_uploaded THEN
    IF v_existing.settings ? 'contentHash' THEN
      IF pg_catalog.jsonb_typeof(v_existing.settings -> 'contentHash') <> 'string' THEN
        RAISE EXCEPTION
          'This CSF source''s stored workbook digest is malformed and cannot be reconfigured.'
          USING ERRCODE = '22023';
      END IF;
      -- Canonical, proved HERE, against the RAW expression and BEFORE anything
      -- is bound to it.
      --
      -- The table CHECK also states this, but a CHECK is defence in depth for
      -- rows this function did not write: it is not the function's own promise.
      -- Without this, a stored value that predates the constraint would be
      -- carried forward, compared and re-published as identity by the very
      -- function that promises to fail closed on it.
      --
      -- The check reads `v_existing.settings ->> 'contentHash'` rather than the
      -- variable on purpose. Validating a value only AFTER binding it leaves a
      -- window in which `v_stored_digest` holds an unproved digest, and every
      -- later statement -- including the carry-forward -- reads that variable,
      -- not the expression. Bind only what has already been proved.
      IF v_existing.settings ->> 'contentHash' !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION
          'This CSF source''s stored workbook digest is not canonical and cannot be reconfigured.'
          USING ERRCODE = '22023';
      END IF;
      v_stored_digest := v_existing.settings ->> 'contentHash';
    END IF;
    -- Restated: it must be raw-exact. Omitted: the stored value is carried
    -- forward below. Never rewritten, never erased, never normalized.
    IF v_requested_digest IS NOT NULL
      AND v_stored_digest IS NOT NULL
      AND v_requested_digest IS DISTINCT FROM v_stored_digest
    THEN
      RAISE EXCEPTION
        'A CSF uploaded workbook keeps the digest it was registered under; create a new source instead.'
        USING ERRCODE = '23514';
    END IF;
    -- A digestless uploaded source may not GAIN one by ordinary reconfiguration:
    -- that would move it into the arbiter's corpus without ever passing through
    -- create-or-adopt.
    IF v_requested_digest IS NOT NULL AND v_stored_digest IS NULL THEN
      RAISE EXCEPTION
        'A CSF uploaded workbook digest is assigned when the source is created, not by a later save.'
        USING ERRCODE = '23514';
    END IF;
    IF v_stored_digest IS NOT NULL THEN
      v_settings := v_settings || pg_catalog.jsonb_build_object('contentHash', v_stored_digest);
    ELSE
      v_settings := v_settings - 'contentHash';
    END IF;
  END IF;

  v_metadata := coalesce(p_registration -> 'driveMetadata', '{}'::jsonb);
  IF pg_catalog.jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'CSF source drive metadata must be a JSON object.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT key FROM pg_catalog.jsonb_object_keys(v_metadata) AS keys(key)
  LOOP
    IF NOT (v_key = ANY (ARRAY[
      'name', 'modifiedAt', 'mimeType', 'webViewLink', 'trashed', 'accessState'
    ])) THEN
      RAISE EXCEPTION 'CSF source drive metadata may not carry "%".', v_key USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF pg_catalog.jsonb_typeof(coalesce(p_registration -> 'tabMappings', '[]'::jsonb)) <> 'array'
    OR pg_catalog.jsonb_typeof(coalesce(p_registration -> 'columnMappings', '{}'::jsonb)) <> 'object'
  THEN
    RAISE EXCEPTION 'CSF source mappings must be a JSON array and a JSON object.'
      USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_registration ->> 'syncMode', 'manual') <> ALL (c_sync_modes) THEN
    RAISE EXCEPTION 'CSF sync mode "%" is not supported.', p_registration ->> 'syncMode'
      USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_registration ->> 'syncStatus', 'not_synced') <> ALL (c_sync_status) THEN
    RAISE EXCEPTION 'CSF sync status "%" is not supported.', p_registration ->> 'syncStatus'
      USING ERRCODE = '22023';
  END IF;
  -- A cohort named here must belong to this organization. Accepting an arbitrary
  -- one is how a source would project into another tenant's class.
  IF nullif(p_registration ->> 'cohortId', '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM plugin_data.csf_cohorts AS cohort
      WHERE cohort.organization_id = p_organization_id
        AND cohort.id = (p_registration ->> 'cohortId')::uuid
    )
  THEN
    RAISE EXCEPTION 'A CSF source must name a class of its own organization.'
      USING ERRCODE = '23503';
  END IF;

  IF p_source_id IS NULL THEN
    INSERT INTO plugin_data.csf_sheet_sources (
      organization_id, cohort_id, source_type, title, provider,
      spreadsheet_id, drive_file_id, uploaded_file_path, sheet_url,
      drive_file_name, drive_modified_at, drive_mime_type, drive_web_view_link,
      drive_trashed, drive_access_state, drive_access_checked_at,
      sync_owner_user_id, sync_mode, sync_status, last_sync_status, last_sync_error,
      target_strategy, duplicate_policy, column_mappings, tab_mappings, settings,
      updated_at
    ) VALUES (
      p_organization_id,
      nullif(p_registration ->> 'cohortId', '')::uuid,
      p_source_type,
      coalesce(nullif(pg_catalog.btrim(coalesce(p_registration ->> 'title', '')), ''), 'CSF source'),
      coalesce(v_provider, 'google_sheets'),
      nullif(p_registration ->> 'spreadsheetId', ''),
      nullif(p_registration ->> 'driveFileId', ''),
      nullif(p_registration ->> 'uploadedFilePath', ''),
      nullif(p_registration ->> 'sheetUrl', ''),
      nullif(v_metadata ->> 'name', ''),
      nullif(v_metadata ->> 'modifiedAt', '')::timestamptz,
      nullif(v_metadata ->> 'mimeType', ''),
      nullif(v_metadata ->> 'webViewLink', ''),
      CASE WHEN v_metadata ? 'trashed' THEN (v_metadata ->> 'trashed')::boolean ELSE NULL END,
      coalesce(nullif(v_metadata ->> 'accessState', ''), 'unknown'),
      CASE WHEN v_metadata ? 'accessState' THEN now() ELSE NULL END,
      -- Provenance, not authority: the officer who registered it. Authorization
      -- is re-derived on every later call rather than read from this column.
      p_actor_user_id,
      coalesce(p_registration ->> 'syncMode', 'manual'),
      coalesce(p_registration ->> 'syncStatus', 'not_synced'),
      -- Sanitized on the way in, exactly as csf_record_sheet_source_sync does.
      -- Registration accepted arbitrary caller text for both of these while the
      -- sync path bounded them, so the same durable column held classified
      -- operational prose from one writer and a raw provider or database message
      -- -- statement text, an address, a URI, a student value -- from the other.
      plugin_data.csf_bounded_reason_code(
        nullif(p_registration ->> 'lastSyncStatus', ''), NULL
      ),
      plugin_data.csf_bounded_failure_detail(
        nullif(p_registration ->> 'lastSyncError', '')
      ),
      coalesce(nullif(p_registration ->> 'targetStrategy', ''), 'fixed'),
      coalesce(nullif(p_registration ->> 'duplicatePolicy', ''), 'match_email_then_name'),
      coalesce(p_registration -> 'columnMappings', '{}'::jsonb),
      coalesce(p_registration -> 'tabMappings', '[]'::jsonb),
      v_settings,
      now()
    )
    -- ------------------------------------------------------------------
    -- B1b.3.1 -- create-or-adopt, arbitrated by the database.
    --
    -- The read-then-insert this replaces was not idempotent and never had been:
    -- two callers could both observe no source, one won
    -- `csf_sheet_sources_uploaded_digest_idx`, and the other got a raw 23505 that
    -- no receipt described. "A simultaneous duplicate adopts the winner" was
    -- simply false.
    --
    -- The arbiter is stated EXPLICITLY and repeats the index definition
    -- character for character. A targetless `DO NOTHING` would also swallow an
    -- unrelated unique violation -- the uploaded PATH index, the primary key --
    -- and turn a real integrity failure into a silent adopt.
    --
    -- `DO NOTHING`, never `DO UPDATE`: adopting must not write the winner's row.
    -- A no-op update would still take a row lock, bump `updated_at`, fire
    -- triggers and let a losing caller's payload touch a source it does not own.
    -- ------------------------------------------------------------------
    ON CONFLICT (organization_id, source_type, (settings ->> 'contentHash'))
      WHERE provider IN ('uploaded_xlsx', 'uploaded_csv')
        AND settings ? 'contentHash'
    DO NOTHING
    RETURNING id INTO v_source_id;

    IF v_source_id IS NOT NULL THEN
      v_created := true;
    ELSE
      -- The insert conflicted. A SECOND statement now reads the winner.
      --
      -- Deliberately not a one-statement CTE reselect: under READ COMMITTED the
      -- conflicting row may belong to a transaction that committed after this
      -- statement's snapshot was taken, so the same statement cannot see it.
      -- A new statement takes a fresh snapshot, which is what makes the adopt
      -- observable at all.
      --
      -- ISOLATION CONTRACT, stated honestly: this is a READ COMMITTED guarantee.
      -- Under REPEATABLE READ or SERIALIZABLE the winner may remain invisible, or
      -- PostgreSQL may raise a serialization failure instead. Both fail closed
      -- below; neither falls through to create or to open.
      -- The index spans the uploaded FAMILY, but adoption is exact.
      --
      -- Identical bytes can legitimately be registered as `uploaded_csv` and as
      -- `uploaded_xlsx`; those are different logical sources with different
      -- parsers. Adopting across the two would hand this caller a source whose
      -- provider disagrees with the workbook it holds, so the reselect binds the
      -- effective provider and a cross-provider collision fails closed below.
      SELECT * INTO v_winner
      FROM plugin_data.csf_sheet_sources AS source
      WHERE source.organization_id = p_organization_id
        AND source.source_type = p_source_type
        AND source.provider = v_effective_provider
        AND source.settings ? 'contentHash'
        AND source.settings ->> 'contentHash' = v_requested_digest
      FOR UPDATE;

      -- The winner has to be the SAME logical source, raw. A normalized, padded
      -- or uppercase legacy row is not this workbook and must never be adopted
      -- into being one.
      IF NOT FOUND
        OR v_requested_digest IS NULL
        OR v_winner.id IS NULL
        OR v_winner.organization_id IS DISTINCT FROM p_organization_id
        OR v_winner.source_type IS DISTINCT FROM p_source_type
        OR v_winner.provider IS DISTINCT FROM v_effective_provider
        OR v_winner.settings ->> 'contentHash' IS DISTINCT FROM v_requested_digest
        OR v_winner.settings ->> 'sourceKind' IS DISTINCT FROM p_source_type
      THEN
        RAISE EXCEPTION
          'This CSF uploaded workbook is being registered by another request; nothing was changed.'
          USING ERRCODE = '40001';
      END IF;

      v_source_id := v_winner.id;
      v_adopted := true;
    END IF;
  ELSE
    UPDATE plugin_data.csf_sheet_sources AS source
    SET cohort_id = CASE
          WHEN p_registration ? 'cohortId'
            THEN nullif(p_registration ->> 'cohortId', '')::uuid
          ELSE source.cohort_id
        END,
        title = coalesce(nullif(pg_catalog.btrim(coalesce(p_registration ->> 'title', '')), ''), source.title),
        -- Proved equal to the stored value above, or absent. Written as the
        -- stored value either way, so no reconfiguration path can move it.
        provider = source.provider,
        spreadsheet_id = coalesce(nullif(p_registration ->> 'spreadsheetId', ''), source.spreadsheet_id),
        drive_file_id = coalesce(nullif(p_registration ->> 'driveFileId', ''), source.drive_file_id),
        -- Proved absent above, so this is the stored value either way. Written
        -- explicitly rather than omitted so the statement itself says that no
        -- reconfiguration path can move the attachment's file pointer.
        uploaded_file_path = source.uploaded_file_path,
        sheet_url = coalesce(nullif(p_registration ->> 'sheetUrl', ''), source.sheet_url),
        drive_file_name = coalesce(nullif(v_metadata ->> 'name', ''), source.drive_file_name),
        drive_modified_at = coalesce(nullif(v_metadata ->> 'modifiedAt', '')::timestamptz, source.drive_modified_at),
        drive_mime_type = coalesce(nullif(v_metadata ->> 'mimeType', ''), source.drive_mime_type),
        drive_web_view_link = coalesce(nullif(v_metadata ->> 'webViewLink', ''), source.drive_web_view_link),
        drive_trashed = CASE
          WHEN v_metadata ? 'trashed' THEN (v_metadata ->> 'trashed')::boolean
          ELSE source.drive_trashed
        END,
        drive_access_state = coalesce(nullif(v_metadata ->> 'accessState', ''), source.drive_access_state),
        drive_access_checked_at = CASE
          WHEN v_metadata ? 'accessState' THEN now() ELSE source.drive_access_checked_at
        END,
        sync_mode = coalesce(nullif(p_registration ->> 'syncMode', ''), source.sync_mode),
        sync_status = coalesce(nullif(p_registration ->> 'syncStatus', ''), source.sync_status),
        last_sync_status = CASE
          WHEN p_registration ? 'lastSyncStatus'
            THEN plugin_data.csf_bounded_reason_code(
              nullif(p_registration ->> 'lastSyncStatus', ''), NULL
            )
          ELSE source.last_sync_status
        END,
        last_sync_error = CASE
          WHEN p_registration ? 'lastSyncError'
            THEN plugin_data.csf_bounded_failure_detail(
              nullif(p_registration ->> 'lastSyncError', '')
            )
          ELSE source.last_sync_error
        END,
        target_strategy = coalesce(nullif(p_registration ->> 'targetStrategy', ''), source.target_strategy),
        duplicate_policy = coalesce(nullif(p_registration ->> 'duplicatePolicy', ''), source.duplicate_policy),
        column_mappings = coalesce(p_registration -> 'columnMappings', source.column_mappings),
        tab_mappings = coalesce(p_registration -> 'tabMappings', source.tab_mappings),
        -- The system-owned namespace is carried forward from the stored row and
        -- applied AFTER the caller's keys, so the caller's object cannot move,
        -- clear or forge the staged generation or the live provider evidence --
        -- not by stating them, and not by omitting them either. A caller who
        -- spreads the stored settings back is refused earlier, by the settings
        -- guard; a caller who omits them lands here and the stored values win.
        settings = v_settings || (
          SELECT coalesce(
            pg_catalog.jsonb_object_agg(kept.key, source.settings -> kept.key),
            '{}'::jsonb
          )
          FROM pg_catalog.unnest(plugin_data.csf_sheet_source_attachment_keys()) AS kept(key)
          WHERE source.settings ? kept.key
        ),
        updated_at = now()
    WHERE source.organization_id = p_organization_id
      AND source.id = p_source_id
    RETURNING source.id INTO v_source_id;
  END IF;

  -- A CLOSED receipt. `created`, `adopted` and `reconfigured` are mutually
  -- exclusive and exhaustive, so a caller can tell "I made this source" from "the
  -- database chose someone else's" from "I re-saved my own" without inspecting a
  -- provider error. The previous receipt reported only `sourceId` and `created`,
  -- so an adopted caller looked exactly like a creating one and went on to open
  -- staging against a source another request was actively uploading to.
  RETURN pg_catalog.jsonb_build_object(
    'sourceId', v_source_id,
    'created', v_created,
    'adopted', v_adopted,
    'reconfigured', NOT (v_created OR v_adopted),
    'sourceType', coalesce(v_existing.source_type, p_source_type)
  );
END;
$$;

-- Bounded sync-status transition. The only thing a preview or commit reports.
CREATE OR REPLACE FUNCTION plugin_data.csf_record_sheet_source_sync(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_sync_status text,
  p_last_sync_status text,
  p_last_sync_error text,
  p_mark_previewed boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_sync_status constant text[] := ARRAY[
    'not_synced', 'healthy', 'needs_attention', 'failed', 'disabled'
  ];
  -- The closed set of things a run may say about itself. Prose is not one of
  -- them: an arbitrary string here becomes durable text beside student records.
  c_last_status constant text[] := ARRAY[
    'awaiting_mapping', 'mapping_saved', 'source_saved',
    'preview_completed', 'preview_failed', 'commit_completed', 'commit_failed'
  ];
BEGIN
  IF p_sync_status IS NOT NULL AND p_sync_status <> ALL (c_sync_status) THEN
    RAISE EXCEPTION 'CSF sync status "%" is not supported.', p_sync_status
      USING ERRCODE = '22023';
  END IF;
  IF p_last_sync_status IS NOT NULL AND p_last_sync_status <> ALL (c_last_status) THEN
    RAISE EXCEPTION 'CSF run status "%" is not supported.', p_last_sync_status
      USING ERRCODE = '22023';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor_for_source(
    p_organization_id, p_actor_user_id, p_source_id
  );

  UPDATE plugin_data.csf_sheet_sources AS source
  SET sync_status = coalesce(p_sync_status, source.sync_status),
      last_sync_status = coalesce(p_last_sync_status, source.last_sync_status),
      -- Sanitized through the same filter every other durable failure string uses.
      last_sync_error = CASE
        WHEN p_last_sync_error IS NULL THEN NULL
        ELSE plugin_data.csf_bounded_failure_detail(p_last_sync_error)
      END,
      last_previewed_at = CASE
        WHEN coalesce(p_mark_previewed, false) THEN now() ELSE source.last_previewed_at
      END,
      updated_at = now()
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;

  RETURN pg_catalog.jsonb_build_object('sourceId', p_source_id, 'recorded', true);
END;
$$;

-- Provider provenance only. Writes no status, no mapping and no settings, so a
-- metadata refresh can never be a way to reconfigure a source.
CREATE OR REPLACE FUNCTION plugin_data.csf_refresh_sheet_source_drive_metadata(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text;
BEGIN
  IF p_metadata IS NULL OR pg_catalog.jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION 'CSF source drive metadata must be a JSON object.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT key FROM pg_catalog.jsonb_object_keys(p_metadata) AS keys(key)
  LOOP
    IF NOT (v_key = ANY (ARRAY[
      'name', 'modifiedAt', 'mimeType', 'webViewLink', 'trashed', 'accessState'
    ])) THEN
      RAISE EXCEPTION 'CSF source drive metadata may not carry "%".', v_key USING ERRCODE = '23514';
    END IF;
  END LOOP;

  PERFORM plugin_data.csf_assert_import_actor_for_source(
    p_organization_id, p_actor_user_id, p_source_id
  );

  UPDATE plugin_data.csf_sheet_sources AS source
  SET drive_file_name = coalesce(nullif(p_metadata ->> 'name', ''), source.drive_file_name),
      drive_modified_at = coalesce(nullif(p_metadata ->> 'modifiedAt', '')::timestamptz, source.drive_modified_at),
      drive_mime_type = coalesce(nullif(p_metadata ->> 'mimeType', ''), source.drive_mime_type),
      drive_web_view_link = coalesce(nullif(p_metadata ->> 'webViewLink', ''), source.drive_web_view_link),
      drive_trashed = CASE
        WHEN p_metadata ? 'trashed' THEN (p_metadata ->> 'trashed')::boolean
        ELSE source.drive_trashed
      END,
      drive_access_state = coalesce(nullif(p_metadata ->> 'accessState', ''), source.drive_access_state),
      drive_access_checked_at = now(),
      updated_at = now()
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;

  RETURN pg_catalog.jsonb_build_object('sourceId', p_source_id, 'refreshed', true);
END;
$$;

-- Attach a finalized staged generation, compare-and-swap.
--
-- The read-modify-write this replaces was a lost update: TypeScript read
-- `settings`, built a new object, and wrote it back, so two uploads finishing
-- close together left the source pointing at whichever one wrote last -- which
-- could be the OLDER generation, already retired, its bytes already queued for
-- deletion.
--
-- Here the swap is one statement under one lock and every coordinate is
-- compared: the source's own current attachment, the staging object's
-- generation, its content digest, and the mapping version the caller believed
-- it was attaching for. A delayed generation-N call therefore cannot overwrite
-- generation N+1 -- it sees a prior attachment it did not expect and fails,
-- leaving the newer attachment exactly as it was.
-- Correction B1b: the swap answers with a CLOSED RECEIPT, and its audit row is
-- part of the same transaction.
--
-- What this replaces answered a business disagreement by RAISING. A PostgREST
-- caller cannot tell a raised business refusal from a transport failure: both
-- arrive as a non-null `error`, and the only thing distinguishing them is text
-- the provider wrote. So the action either had to read `error.code` -- guessing
-- provenance from the SHAPE of a five-character string, which `EPIPE` and
-- `FETCH` also match -- or treat every refusal as an unknown outcome. Neither is
-- an answer. Every disagreement this function can DECIDE now returns a
-- structured receipt under one of exactly six closed reason codes, mutates
-- nothing, and is distinguishable from a dropped response without reading one
-- byte of provider prose.
--
-- Exceptions are kept for exactly the cases that are not decisions: bad
-- arguments, authorization, a missing row, malformed stored settings, and a
-- stored receipt that contradicts its own audit evidence. Those are not
-- outcomes of a compare-and-swap; they are states in which no receipt could
-- honestly be issued.
--
-- The immutable audit row moved INSIDE this transaction. It used to be a
-- best-effort write the action attempted afterwards, so an accepted attachment
-- with no audit row was a routine outcome. Now the publication, the audit row
-- and the receipt either all commit or none of them do.
--
-- Correction B1b.2 closed six runtime gaps an adversarial SQL audit found:
--
--   * the stored attachment was counted as a three-key core plus a three-key
--     receipt, so `stagedUpload`, `stagingByteLength` and `stagingReadyAt` could
--     be orphaned or contradictory and a receipt could still replay. There is
--     now ONE nine-key attachment state and every 1-8 key subset is corruption;
--   * a source carrying a historical `uploaded_file_path` with no staged
--     generation was silently overwritten on the next attach, destroying the
--     only durable locator of a private object nothing else records. That state
--     is now named `legacy_path` and refused;
--   * reconciliation read only the REQUESTED staging row, so it could confirm an
--     attachment whose current row disagreed with the stored coordinates, or
--     report a clean "not observed" while the source's actual current attachment
--     was missing or incoherent. It now loads and verifies both;
--   * `text !~ grammar OR text::bigint > ceiling` lets PostgreSQL evaluate the
--     cast first. Every database-derived numeric text is now checked in
--     sequential statements: JSON primitive, then grammar, then ceiling, then
--     assignment -- never a grammar and a cast in one Boolean expression;
--   * the audit predicate called `jsonb_object_keys()` beside a type test, which
--     can evaluate on a scalar and leak a raw internal error, and it never
--     recomputed the historical digest. The row is now fetched by relational
--     coordinates and validated procedurally, and its ten-member payload must
--     rebuild the digest the source stored;
--   * a null `p_mapping_version` was resolved from MUTABLE current source state,
--     so the same eight arguments hashed differently after a reconfiguration.
--     The mapping version is now a required request coordinate.
CREATE OR REPLACE FUNCTION plugin_data.csf_attach_sheet_source_generation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_staging_object_id uuid,
  p_expected_generation integer,
  p_expected_content_hash text,
  p_expected_prior_generation integer,
  p_mapping_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- The domain separator. Both a key and a value the B1a digest object never
  -- carried, so no v1 digest can be mistaken for a v2 one.
  c_contract constant text := 'csf-attach-generation/v1';
  -- ONE closed attachment state, counted as a whole.
  --
  -- Splitting it into a "core" and a "receipt" is what let an orphan
  -- `stagedUpload`, an orphan byte length or an orphan ready timestamp sit
  -- beside a coherent trio and be ignored, and what let a receipt replay against
  -- a source whose auxiliary evidence had been half-erased. A source either
  -- carries all nine of these or none of them.
  c_attachment_keys constant text[] := ARRAY[
    'stagedUpload',
    'stagingObjectId',
    'stagingGeneration',
    'stagingContentHash',
    'stagingByteLength',
    'stagingReadyAt',
    'stagingRequestDigest',
    'stagingAuditEventId',
    'stagingAuditCorrelationId'
  ];
  -- The exact, closed, coordinate-only audit payload vocabulary. Nothing here
  -- names a file, a tab, a path, a student, a public URL or a provider body.
  --
  -- `actorUserId` is carried IN THE PAYLOAD as well as in the relational column
  -- because `csf_admin_audit_events.actor_user_id` is ON DELETE SET NULL: an
  -- explicitly permitted account deletion would otherwise blank the only record
  -- of who attached, and the digest recomputed from it would stop matching --
  -- permanently bricking a source that is entirely coherent. This deliberately
  -- retains a pseudonymous auth UUID after referential deletion so immutable
  -- receipt evidence stays verifiable. It is an opaque identifier and nothing
  -- else: no name, no email, no other identity data is stored here.
  c_audit_keys constant text[] := ARRAY[
    'contractVersion', 'actorUserId', 'sourceId', 'stagingObjectId',
    'generation', 'contentHash', 'byteLength', 'priorGeneration',
    'mappingVersion', 'requestDigest'
  ];
  -- The largest integer PostgreSQL and JavaScript spell identically. A byte
  -- length above it has two canonical forms depending on which side rendered it,
  -- so it can never be part of one shared request identity.
  c_max_safe_integer constant bigint := 9007199254740991;
  c_int4_max constant bigint := 2147483647;
  c_uuid_shape constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_sha256_shape constant text := '^[0-9a-f]{64}$';
  -- Canonical positive decimal text, bounded so the NEXT statement's cast is
  -- total. Ten digits cannot overflow bigint; sixteen cannot either.
  c_int4_shape constant text := '^[1-9][0-9]{0,9}$';
  c_bigint_shape constant text := '^[1-9][0-9]{0,15}$';
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  -- The REQUESTED staging row, and the source's CURRENT attachment row. They are
  -- the same row for a replay and different rows for a supersession, and reading
  -- only the first is what let a divergent current attachment go unnoticed.
  v_staging plugin_data.csf_sheet_import_staging_objects%ROWTYPE;
  v_current plugin_data.csf_sheet_import_staging_objects%ROWTYPE;
  v_current_found boolean := false;
  v_source_attachment_state text;
  v_attachment_present integer := 0;
  v_prior integer;
  v_prior_hash text;
  -- The caller's digest, taken EXACTLY as supplied.
  --
  -- `lower(btrim(...))` here was a producer manufacturing canonical evidence:
  -- an uppercase or padded digest was rewritten into the canonical form, then
  -- compared with the staging row, then stored as the attachment's
  -- `stagingContentHash` and folded into the request digest -- so a caller who
  -- named the bytes wrongly still attached them, and the compare-and-swap's own
  -- identity was computed from a value the caller never sent.
  v_hash text := p_expected_content_hash;
  v_stored_mapping integer;
  v_mapping_version integer;
  v_request_digest text;
  v_request_prior_json jsonb;
  v_prior_digest text;
  v_prior_event_id uuid;
  v_prior_correlation_id uuid;
  v_prior_byte_length bigint;
  v_prior_object_id uuid;
  -- One scratch text for every grammar check, so a check and its cast are always
  -- separate statements over the same already-validated value.
  v_text text;
  v_audit plugin_data.csf_admin_audit_events%ROWTYPE;
  v_audit_actor uuid;
  v_audit_key_count integer;
  v_audit_generation integer;
  v_audit_byte_length bigint;
  v_audit_prior_generation integer;
  v_audit_mapping integer;
  v_audit_digest text;
  v_locked plugin_data.csf_sheet_import_staging_objects%ROWTYPE;
  v_lock_id uuid;
  v_staging_found boolean := false;
  v_audit_event_id uuid;
  v_audit_correlation_id uuid;
  v_reason_code text;
BEGIN
  -- ------------------------------------------------------------------
  -- PHASE A. Arguments. Nothing here has looked at a row yet.
  -- ------------------------------------------------------------------
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Attaching a CSF staged generation requires an organization.'
      USING ERRCODE = '22023';
  END IF;
  -- The actor is a digest coordinate, so "absent" is not a value this identity
  -- can hold. Authorization would deny a null actor a moment later, but a JSON
  -- null actor inside a canonical digest is a coordinate nobody sent.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Attaching a CSF staged generation requires the acting officer.'
      USING ERRCODE = '22023';
  END IF;
  IF p_expected_generation IS NULL OR p_expected_generation < 1 THEN
    RAISE EXCEPTION 'Attaching a CSF staged generation requires the generation number.'
      USING ERRCODE = '22023';
  END IF;
  IF v_hash IS NULL OR v_hash !~ c_sha256_shape THEN
    RAISE EXCEPTION 'Attaching a CSF staged generation requires its sha256 content digest.'
      USING ERRCODE = '22023';
  END IF;
  -- A prior fence, when stated, names a real generation. Generations start at 1,
  -- so zero and negatives are not "no prior attachment" -- they are nonsense, and
  -- accepting them would put an unreachable coordinate into the request identity.
  IF p_expected_prior_generation IS NOT NULL AND p_expected_prior_generation < 1 THEN
    RAISE EXCEPTION
      'A CSF staged prior generation must be a positive generation number or absent.'
      USING ERRCODE = '22023';
  END IF;
  -- REQUIRED, not defaulted. Resolving a null mapping version from the source's
  -- CURRENT settings made the request identity depend on mutable state: the same
  -- eight arguments hashed one way before a reconfiguration and another way
  -- after it, so an accepted request stopped recognising its own replay.
  IF p_mapping_version IS NULL OR p_mapping_version < 1 THEN
    RAISE EXCEPTION 'A CSF mapping version must be a positive number.'
      USING ERRCODE = '22023';
  END IF;
  v_mapping_version := p_mapping_version;

  -- ------------------------------------------------------------------
  -- PHASE B. Authorization.
  -- ------------------------------------------------------------------
  PERFORM plugin_data.csf_assert_import_actor_for_source(
    p_organization_id, p_actor_user_id, p_source_id
  );

  -- ------------------------------------------------------------------
  -- PHASE C. Source first, then object: the canonical lock order every other
  -- staging path takes, so this cannot deadlock against open, finalize or
  -- retire.
  -- ------------------------------------------------------------------
  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;

  -- ------------------------------------------------------------------
  -- PHASE D. The stored state, classified as a whole before any comparison with
  -- the request.
  --
  -- Everything AMBIENT is checked here and RAISES; everything REQUEST-RELATIVE
  -- is checked later and REFUSES. That split is the contract: a closed refusal
  -- is a statement about a coherent source, so a source that is not coherent
  -- must never produce one.
  -- ------------------------------------------------------------------
  IF pg_catalog.jsonb_typeof(v_source.settings) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION
      'This CSF source''s stored settings are malformed and cannot be used.'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_attachment_present
  FROM pg_catalog.jsonb_object_keys(v_source.settings) AS present(key)
  WHERE present.key = ANY (c_attachment_keys);

  IF v_attachment_present = 0 THEN
    IF v_source.uploaded_file_path IS NULL THEN
      v_source_attachment_state := 'pristine';
    ELSE
      v_source_attachment_state := 'legacy_path';
    END IF;
  ELSIF v_attachment_present = pg_catalog.cardinality(c_attachment_keys) THEN
    v_source_attachment_state := 'attached';
  ELSE
    -- Any 1-8 key subset. An orphan `stagedUpload`, an orphan byte length, an
    -- orphan ready timestamp, a receipt with no coordinates and a coordinate set
    -- with no receipt are all the same fact: something wrote half an attachment
    -- away, and no part of it may be believed.
    RAISE EXCEPTION
      'This CSF source''s stored attachment is incomplete and cannot be used.'
      USING ERRCODE = '22023';
  END IF;

  -- A source that predates the staged attachment contract.
  --
  -- Zero attachment keys and a non-null `uploaded_file_path`: an opaque string
  -- naming a private object that nothing else in this schema records. Attaching
  -- over it would overwrite the ONLY durable locator of those bytes, leaving a
  -- sensitive storage orphan no sweeper can ever find -- so this refuses instead,
  -- and the pointer is left exactly as it was.
  --
  -- The value is deliberately not parsed, not logged, not interpolated into this
  -- message and not carried into any receipt: this function does not know which
  -- bucket, tenant or generation it belongs to, and guessing is how the orphan
  -- would be created rather than avoided.
  --
  -- PRODUCTION CUTOVER RESIDUAL: these sources need a separate server-only
  -- inventory or quarantine record -- or an external pre-cutover inventory --
  -- before they can be migrated onto the staged contract. B1b.2 deliberately
  -- does not invent that ledger; it only refuses to destroy the evidence a
  -- ledger would need.
  IF v_source_attachment_state = 'legacy_path' THEN
    RAISE EXCEPTION
      'This CSF source records a workbook from before the staged attachment contract, so a new generation cannot be attached to it until that file has been inventoried.'
      USING ERRCODE = '55000';
  END IF;

  -- ------------------------------------------------------------------
  -- PHASE D1. The stored attachment, decoded.
  --
  -- Every database-derived numeric text is checked in SEQUENTIAL statements:
  -- exact JSON primitive, then canonical grammar, then the numeric ceiling, then
  -- the assignment. `text !~ shape OR text::bigint > ceiling` is not equivalent:
  -- PostgreSQL is free to evaluate the cast first, so a malformed value raises
  -- 22P02 -- an uncontrolled error whose text prints the stored value back.
  -- ------------------------------------------------------------------
  IF v_source_attachment_state = 'attached' THEN
    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagedUpload') <> 'boolean' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    IF (v_source.settings -> 'stagedUpload') IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagingObjectId') <> 'string' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_source.settings ->> 'stagingObjectId';
    IF v_text !~ c_uuid_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_prior_object_id := v_text::uuid;

    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagingGeneration') <> 'number' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_source.settings ->> 'stagingGeneration';
    IF v_text !~ c_int4_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text::bigint > c_int4_max THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_prior := v_text::integer;

    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagingContentHash') <> 'string' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_prior_hash := v_source.settings ->> 'stagingContentHash';
    IF v_prior_hash !~ c_sha256_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagingByteLength') <> 'number' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_source.settings ->> 'stagingByteLength';
    IF v_text !~ c_bigint_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text::bigint > c_max_safe_integer THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_prior_byte_length := v_text::bigint;

    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagingRequestDigest') <> 'string' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_prior_digest := v_source.settings ->> 'stagingRequestDigest';
    IF v_prior_digest !~ c_sha256_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagingAuditEventId') <> 'string' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_source.settings ->> 'stagingAuditEventId';
    IF v_text !~ c_uuid_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_prior_event_id := v_text::uuid;

    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagingAuditCorrelationId') <> 'string' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_source.settings ->> 'stagingAuditCorrelationId';
    IF v_text !~ c_uuid_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_prior_correlation_id := v_text::uuid;
  END IF;

  -- The STORED mapping version, resolved on its own and with the same care.
  --
  -- It is NOT the request's mapping version any more -- that is a required
  -- argument -- but it is still what mapping drift is measured against, so it
  -- has to be readable without an unguarded cast.
  IF v_source.settings ? 'mappingVersion' THEN
    IF pg_catalog.jsonb_typeof(v_source.settings -> 'mappingVersion') <> 'number' THEN
      RAISE EXCEPTION
        'This CSF source''s stored mapping version is malformed.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_source.settings ->> 'mappingVersion';
    IF v_text !~ c_int4_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored mapping version is malformed.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text::bigint > c_int4_max THEN
      RAISE EXCEPTION
        'This CSF source''s stored mapping version is malformed.'
        USING ERRCODE = '22023';
    END IF;
    v_stored_mapping := v_text::integer;
  END IF;

  -- ------------------------------------------------------------------
  -- PHASE E. Deterministic pair lock, scoped to THIS source.
  --
  -- Every row locked below is filtered on `source_id = p_source_id`, so a
  -- purported current attachment belonging to another source is never returned
  -- and therefore never locked: there is no source-A -> object-B edge to invert
  -- against source B's own ordering. The two ids are then locked in canonical
  -- UUID order, one statement at a time, so two transactions that ever did
  -- contend for the same pair would take them in the same sequence. Relying on
  -- the source lock alone -- as an earlier revision did -- is an argument about
  -- callers, not a lock order.
  -- ------------------------------------------------------------------
  FOR v_lock_id IN
    SELECT candidate.id
    FROM unnest(ARRAY[p_staging_object_id, v_prior_object_id]) AS candidate(id)
    WHERE candidate.id IS NOT NULL
    GROUP BY candidate.id
    ORDER BY candidate.id
  LOOP
    SELECT * INTO v_locked
    FROM plugin_data.csf_sheet_import_staging_objects AS staging
    WHERE staging.organization_id = p_organization_id
      AND staging.source_id = p_source_id
      AND staging.id = v_lock_id
    FOR UPDATE;
    IF FOUND THEN
      IF v_locked.id = p_staging_object_id THEN
        v_staging := v_locked;
        v_staging_found := true;
      END IF;
      IF v_prior_object_id IS NOT NULL AND v_locked.id = v_prior_object_id THEN
        v_current := v_locked;
        v_current_found := true;
      END IF;
    END IF;
  END LOOP;

  IF NOT v_staging_found THEN
    RAISE EXCEPTION 'CSF staged workbook was not found.' USING ERRCODE = '23503';
  END IF;

  -- ------------------------------------------------------------------
  -- B1b.3.1 -- the source lock is also the DIGEST FENCE, independently.
  --
  -- `csf_open_staging_object` applies the same fence, but this function may not
  -- rely on that: it is the authority, and a generation could have been opened
  -- by an older build, by a different service caller, or before the source's
  -- digest was proved. So the registry digest, the digest this request names and
  -- the digest frozen on the staged row must all be RAW-exact equal here, before
  -- anything can be attached -- on the fresh path and on the convergent draft
  -- (replay) path alike, which is why it sits above both.
  -- ------------------------------------------------------------------
  IF NOT (v_source.settings ? 'contentHash')
    OR pg_catalog.jsonb_typeof(v_source.settings -> 'contentHash') <> 'string'
    OR v_source.settings ->> 'contentHash' !~ c_sha256_shape
  THEN
    RAISE EXCEPTION
      'This CSF source does not record the canonical workbook digest an attachment must match.'
      USING ERRCODE = '22023';
  END IF;
  IF v_source.settings ->> 'contentHash' IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION
      'This attachment names a workbook digest this CSF source was not registered under.'
      USING ERRCODE = '22023';
  END IF;
  IF v_source.settings ->> 'contentHash' IS DISTINCT FROM v_staging.content_hash THEN
    RAISE EXCEPTION
      'This CSF staged workbook does not match the digest this source was registered under.'
      USING ERRCODE = '22023';
  END IF;

  -- ------------------------------------------------------------------
  -- PHASE F. The CURRENT attachment's own row, verified against the stored
  -- coordinates. Ambient, and BEFORE the refusal ladder, so no business
  -- disagreement can be answered from -- or overwrite -- a source that
  -- contradicts itself.
  -- ------------------------------------------------------------------
  IF v_source_attachment_state = 'attached' THEN
    IF NOT v_current_found
      OR v_current.id IS DISTINCT FROM v_prior_object_id
      OR v_current.generation IS DISTINCT FROM v_prior
      OR v_current.content_hash IS DISTINCT FROM v_prior_hash
      OR v_current.byte_length IS DISTINCT FROM v_prior_byte_length
    THEN
      RAISE EXCEPTION
        'This CSF source''s attached workbook no longer matches its recorded evidence.'
        USING ERRCODE = '22023';
    END IF;
    -- Compared as JSON, against the value `to_jsonb` produced when this
    -- attachment was published. A `::timestamptz` cast here would accept a
    -- differently spelled instant as equal and would raise 22007 on a stored
    -- value that is not a timestamp at all.
    IF (v_source.settings -> 'stagingReadyAt')
      IS DISTINCT FROM pg_catalog.to_jsonb(v_current.ready_at)
    THEN
      RAISE EXCEPTION
        'This CSF source''s attached workbook no longer matches its recorded evidence.'
        USING ERRCODE = '22023';
    END IF;
    -- An attachment must name a generation that was actually MADE readable. The
    -- coordinate checks above are satisfied by an `uploading` row, so a source
    -- could claim a half-written object as its authoritative attachment -- and a
    -- replacement would then quietly retire it, queue its partial bytes for
    -- deletion, and overwrite that state as though it had been a real one.
    IF v_current.status NOT IN ('ready', 'retire_pending', 'tombstoned') THEN
      RAISE EXCEPTION
        'This CSF source''s attached workbook was never made readable.'
        USING ERRCODE = '22023';
    END IF;
    -- The source's raw pointer and the current row's own state must agree. A
    -- live attachment advertises its exact path; a tombstone advertises none,
    -- and the table constraint already guarantees its `object_path` is null.
    IF v_current.status IN ('ready', 'retire_pending') THEN
      IF v_current.object_path IS NULL
        OR v_source.uploaded_file_path IS DISTINCT FROM v_current.object_path
      THEN
        RAISE EXCEPTION
          'This CSF source''s stored file pointer disagrees with its attached workbook.'
          USING ERRCODE = '22023';
      END IF;
    ELSIF v_source.uploaded_file_path IS NOT NULL THEN
      RAISE EXCEPTION
        'This CSF source''s stored file pointer disagrees with its attached workbook.'
        USING ERRCODE = '22023';
    END IF;

    -- ----------------------------------------------------------------
    -- The receipt's own immutable audit row.
    --
    -- Fetched by relational coordinates FIRST, into a row variable, and then
    -- validated in sequential procedural statements. The predicate this replaces
    -- called `jsonb_object_keys()` in the same WHERE clause as the type test
    -- that was supposed to guard it -- and a scalar or array `after_data` would
    -- then raise a raw internal error out of a function whose whole contract is
    -- that it never leaks one.
    --
    -- The historical prior fence and mapping version are HISTORY. They are typed
    -- and bounded here and rebuilt into the historical digest, but they are never
    -- compared with the source's later current mapping: doing so would make a
    -- legitimate reconfiguration retroactively corrupt an exact receipt. Exact
    -- replay, further down, is the one place they meet this request.
    -- ----------------------------------------------------------------
    SELECT * INTO v_audit
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.id = v_prior_event_id
      AND audit.organization_id = p_organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF v_audit.correlation_id IS DISTINCT FROM v_prior_correlation_id
      OR v_audit.action IS DISTINCT FROM 'sheet_source.upload'
      OR v_audit.target_type IS DISTINCT FROM 'csf_sheet_sources'
      OR v_audit.target_id IS DISTINCT FROM p_source_id
      OR v_audit.source_type IS DISTINCT FROM 'uploaded_workbook'
      OR v_audit.source_id IS DISTINCT FROM p_source_id::text
      OR v_audit.reason_code IS DISTINCT FROM 'staged_generation_attached'
      OR v_audit.actor_profile_id IS NOT NULL
      OR v_audit.term_id IS NOT NULL
      OR v_audit.before_data IS NOT NULL
      OR v_audit.ip_hash IS NOT NULL
      OR v_audit.user_agent_hash IS NOT NULL
    THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    -- Proved an OBJECT before anything enumerates its keys.
    IF pg_catalog.jsonb_typeof(v_audit.after_data) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.count(*)::integer INTO v_audit_key_count
    FROM pg_catalog.jsonb_object_keys(v_audit.after_data) AS payload(key);
    IF v_audit_key_count IS DISTINCT FROM pg_catalog.cardinality(c_audit_keys) THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_audit.after_data ?& c_audit_keys) THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    -- Exact JSON primitives, before `->>` renders a number, a boolean or an
    -- array into text that would satisfy every grammar below it.
    IF pg_catalog.jsonb_typeof(v_audit.after_data -> 'contractVersion') <> 'string'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'actorUserId') <> 'string'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'sourceId') <> 'string'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'stagingObjectId') <> 'string'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'contentHash') <> 'string'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'requestDigest') <> 'string'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'generation') <> 'number'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'byteLength') <> 'number'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'mappingVersion') <> 'number'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'priorGeneration') NOT IN ('null', 'number')
    THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF (v_audit.after_data ->> 'contractVersion') IS DISTINCT FROM c_contract THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_audit.after_data ->> 'actorUserId';
    IF v_text !~ c_uuid_shape THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_audit_actor := v_text::uuid;
    -- The relational column is ON DELETE SET NULL. While it still holds a value
    -- it must agree with the payload; once an account deletion has blanked it,
    -- the payload coordinate is the surviving evidence and the receipt stays
    -- verifiable rather than the source becoming permanently unusable.
    IF v_audit.actor_user_id IS NOT NULL
      AND v_audit.actor_user_id IS DISTINCT FROM v_audit_actor
    THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF (v_audit.after_data ->> 'sourceId') IS DISTINCT FROM p_source_id::text THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_audit.after_data ->> 'stagingObjectId';
    IF v_text !~ c_uuid_shape THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text::uuid IS DISTINCT FROM v_prior_object_id THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_audit.after_data ->> 'contentHash';
    IF v_text !~ c_sha256_shape THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text IS DISTINCT FROM v_prior_hash THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_audit.after_data ->> 'generation';
    IF v_text !~ c_int4_shape THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text::bigint > c_int4_max THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_audit_generation := v_text::integer;
    IF v_audit_generation IS DISTINCT FROM v_prior THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_audit.after_data ->> 'byteLength';
    IF v_text !~ c_bigint_shape THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text::bigint > c_max_safe_integer THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_audit_byte_length := v_text::bigint;
    IF v_audit_byte_length IS DISTINCT FROM v_prior_byte_length THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_audit.after_data ->> 'mappingVersion';
    IF v_text !~ c_int4_shape THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text::bigint > c_int4_max THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_audit_mapping := v_text::integer;
    IF pg_catalog.jsonb_typeof(v_audit.after_data -> 'priorGeneration') = 'number' THEN
      v_text := v_audit.after_data ->> 'priorGeneration';
      IF v_text !~ c_int4_shape THEN
        RAISE EXCEPTION
          'This CSF source''s attachment receipt does not match its recorded attachment.'
          USING ERRCODE = '22023';
      END IF;
      IF v_text::bigint > c_int4_max THEN
        RAISE EXCEPTION
          'This CSF source''s attachment receipt does not match its recorded attachment.'
          USING ERRCODE = '22023';
      END IF;
      v_audit_prior_generation := v_text::integer;
    ELSE
      v_audit_prior_generation := NULL;
    END IF;
    v_text := v_audit.after_data ->> 'requestDigest';
    IF v_text !~ c_sha256_shape THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    -- The historical identity, REBUILT rather than believed.
    --
    -- Every coordinate comes from evidence that cannot have drifted: the
    -- organization, the immutable payload actor, the source, and the current
    -- attachment this row was just proved to describe -- plus the historical
    -- fence and mapping the payload itself records. A payload whose recorded
    -- digest disagrees with its own coordinates, or whose coordinates disagree
    -- with what the source stored, is corruption in both directions.
    v_audit_digest := plugin_data.csf_canonical_digest(pg_catalog.jsonb_build_object(
      'contractVersion', c_contract,
      'organizationId', p_organization_id::text,
      'actorUserId', v_audit_actor::text,
      'sourceId', p_source_id::text,
      'stagingObjectId', v_prior_object_id::text,
      'expectedGeneration', v_prior,
      'expectedContentHash', v_prior_hash,
      'byteLength', v_prior_byte_length,
      'expectedPriorGeneration',
        coalesce(pg_catalog.to_jsonb(v_audit_prior_generation), 'null'::jsonb),
      'mappingVersion', v_audit_mapping
    ));
    IF v_audit_digest IS DISTINCT FROM v_text THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF v_audit_digest IS DISTINCT FROM v_prior_digest THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ------------------------------------------------------------------
  -- PHASE G. The requested object's own recorded size, gated BEFORE it becomes a
  -- digest coordinate.
  --
  -- `byte_length` is a bigint. Without this gate the canonical number serializer
  -- would be the thing that raised, with an error whose text prints the value --
  -- so an unstatable size would leak through the one path that exists to keep
  -- values out of errors.
  -- ------------------------------------------------------------------
  IF v_staging.byte_length IS NULL
    OR v_staging.byte_length < 1
    OR v_staging.byte_length > c_max_safe_integer
  THEN
    RAISE EXCEPTION
      'This CSF staged workbook''s recorded size cannot be stated exactly.'
      USING ERRCODE = '22023';
  END IF;

  -- ------------------------------------------------------------------
  -- PHASE H. The canonical identity of THIS request.
  --
  -- Every coordinate that makes it the request it is, domain-separated by the
  -- contract version. Comparing generation alone -- as this used to -- meant a
  -- request with a different prior fence, a different object, a different actor
  -- or a different mapping version was acknowledged as `replayed: true` for an
  -- attachment it never asked for.
  --
  -- `expectedPriorGeneration` is JSON null when there is no prior attachment,
  -- not a sentinel number: encoding "none" as -1 would make a request that
  -- genuinely named generation -1 hash identically to a first attachment.
  -- Generations are validated positive above, so null is unambiguous.
  -- ------------------------------------------------------------------
  v_request_prior_json := coalesce(
    pg_catalog.to_jsonb(p_expected_prior_generation), 'null'::jsonb
  );
  v_request_digest := plugin_data.csf_canonical_digest(pg_catalog.jsonb_build_object(
    'contractVersion', c_contract,
    'organizationId', p_organization_id::text,
    'actorUserId', p_actor_user_id::text,
    'sourceId', p_source_id::text,
    'stagingObjectId', p_staging_object_id::text,
    'expectedGeneration', p_expected_generation,
    'expectedContentHash', v_hash,
    'byteLength', v_staging.byte_length,
    'expectedPriorGeneration', v_request_prior_json,
    'mappingVersion', v_mapping_version
  ));

  -- ------------------------------------------------------------------
  -- PHASE I. Exact replay, and nothing weaker.
  --
  -- Evaluated BEFORE the readiness gate and before mapping drift, and that order
  -- is the point. The gate used to run first, so a request that had already been
  -- accepted could no longer replay once its own row moved to `retire_pending`
  -- or `tombstoned` -- the caller was told its committed attachment had failed
  -- for the one reason that could not be true of it. And an already accepted
  -- request must stay replayable after the source is later reconfigured, which
  -- is why mapping drift is ranked below this branch rather than above it.
  --
  -- The digest alone is NOT the predicate. Matching only the stored digest let a
  -- source that coherently points at attachment B, while still carrying a stale
  -- digest from request A, answer "A is already attached". The requested row must
  -- BE the verified current row, and the audit row proved above must be this
  -- actor's, this fence's and this mapping's. This branch mutates nothing.
  -- ------------------------------------------------------------------
  IF v_source_attachment_state = 'attached'
    AND v_prior_digest = v_request_digest
    AND v_prior_object_id = p_staging_object_id
    AND v_staging.id = v_current.id
    AND v_prior = p_expected_generation
    AND v_prior_hash = v_hash
    AND v_prior_byte_length = v_staging.byte_length
    AND v_staging.generation = v_prior
    AND v_staging.content_hash = v_prior_hash
    AND v_staging.status IN ('ready', 'retire_pending', 'tombstoned')
    AND v_audit_actor = p_actor_user_id
    AND v_audit_prior_generation IS NOT DISTINCT FROM p_expected_prior_generation
    AND v_audit_mapping = v_mapping_version
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'contractVersion', c_contract,
      'outcome', 'attached',
      'replayed', true,
      'sourceId', p_source_id,
      'stagingObjectId', p_staging_object_id,
      'generation', p_expected_generation,
      'contentHash', v_prior_hash,
      'byteLength', v_prior_byte_length,
      'requestDigest', v_request_digest,
      'auditEventId', v_prior_event_id,
      'auditCorrelationId', v_prior_correlation_id
    );
  END IF;
  -- The stored receipt names this exact request and the source does not agree
  -- with it. That is not a new attachment to be attempted -- it is a receipt and
  -- an attachment that contradict each other, and falling through would let the
  -- contradiction be resolved by overwriting one of them.
  IF v_source_attachment_state = 'attached' AND v_prior_digest = v_request_digest THEN
    RAISE EXCEPTION
      'This CSF source''s attachment receipt does not match its recorded attachment.'
      USING ERRCODE = '22023';
  END IF;

  -- ------------------------------------------------------------------
  -- PHASE J. Not a replay. Every disagreement below is a DECISION: it returns a
  -- closed refusal and mutates nothing.
  --
  -- The ladder IS the precedence, and each rank is there for a case the rank
  -- above it would have described wrongly:
  --
  --   1 identity      a request whose own coordinates do not describe the row it
  --                   named cannot be compared against the source at all;
  --   2 newer         a delayed generation-N call arriving after N+1 also
  --                   disagrees about its prior fence, and 'the fence moved,
  --                   upload again' invites a second upload racing a source that
  --                   is already correct. 'A newer generation is attached' is
  --                   terminal;
  --   3 prior         the compare-and-swap fence is the caller's own assertion
  --                   about the world, and it is the more specific answer than a
  --                   configuration difference;
  --   4 mapping       configuration drift, which applies with or WITHOUT a
  --                   current attachment: a first attachment must not silently
  --                   overwrite a mapping version the source already states;
  --   5 same          a second request claiming a coordinate this source already
  --                   published under a different identity;
  --   6 ready         LAST, always. Running it first is what made the delayed-N
  --                   call report 'this workbook is not readable' when the true
  --                   answer was 'a newer generation is attached'.
  -- ------------------------------------------------------------------
  IF v_staging.generation IS DISTINCT FROM p_expected_generation
    OR v_staging.content_hash IS DISTINCT FROM v_hash
  THEN
    v_reason_code := 'staging_identity_mismatch';
  ELSIF v_prior IS NOT NULL AND v_prior > p_expected_generation THEN
    v_reason_code := 'newer_generation_attached';
  ELSIF p_expected_prior_generation IS DISTINCT FROM v_prior THEN
    v_reason_code := 'prior_generation_changed';
  ELSIF v_stored_mapping IS NOT NULL
    AND v_mapping_version IS DISTINCT FROM v_stored_mapping
  THEN
    v_reason_code := 'mapping_version_changed';
  ELSIF v_prior IS NOT NULL AND v_prior IS NOT DISTINCT FROM p_expected_generation THEN
    v_reason_code := 'generation_coordinate_conflict';
  ELSIF v_staging.status <> 'ready' OR v_staging.object_path IS NULL THEN
    v_reason_code := 'staging_not_ready';
  END IF;

  IF v_reason_code IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'contractVersion', c_contract,
      'outcome', 'refused',
      'reasonCode', v_reason_code,
      'sourceId', p_source_id,
      'stagingObjectId', p_staging_object_id,
      'generation', p_expected_generation,
      'requestDigest', v_request_digest
    );
  END IF;

  -- ------------------------------------------------------------------
  -- PHASE K. Accept. One transaction, four statements, in this exact order.
  --
  -- There is deliberately NO `BEGIN ... EXCEPTION` anywhere on this path. That
  -- block would open a subtransaction able to swallow the audit insert's
  -- failure and leave a published attachment with no audit row -- which is
  -- precisely the state this correction exists to make impossible.
  --
  -- The receipt is written in a SECOND update, after the audit row exists,
  -- rather than folded into the publication. The two writes are separable facts:
  -- 'this source points at this generation' and 'this exact request produced
  -- this exact audit row'. Collapsing them because uncommitted state is
  -- externally invisible would leave nothing in the statement order to show that
  -- the receipt is downstream of the audit row it names.
  -- ------------------------------------------------------------------
  v_audit_event_id := pg_catalog.gen_random_uuid();
  v_audit_correlation_id := pg_catalog.gen_random_uuid();

  -- 1. Publish the attachment core and the path in ONE statement, so the source
  -- can never advertise a generation its settings do not name.
  UPDATE plugin_data.csf_sheet_sources AS source
  SET settings = source.settings || pg_catalog.jsonb_build_object(
        'stagedUpload', true,
        'stagingObjectId', p_staging_object_id,
        'stagingGeneration', v_staging.generation,
        'stagingContentHash', v_staging.content_hash,
        'stagingByteLength', v_staging.byte_length,
        'stagingReadyAt', v_staging.ready_at,
        'mappingVersion', v_mapping_version,
        'fileHash', v_staging.content_hash
        -- `contentHash` is deliberately NOT written here.
        --
        -- It is the registry's logical identity and the key the create-or-adopt
        -- arbiter infers on, and this statement used to assign it from the
        -- staging row. That is a rewrite of an immutable identity by a function
        -- that is not its writer -- and it would have been the one path able to
        -- move a source between digest identities without passing the arbiter.
        -- The three-way fence above already proved the stored value equals the
        -- staged one, so preserving it is both correct and a no-op in value.
      ),
      drive_access_state = 'accessible',
      drive_access_checked_at = now(),
      uploaded_file_path = v_staging.object_path,
      updated_at = now()
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id;

  -- 2. Exactly one immutable audit row, carrying COORDINATES only. No filename,
  -- no tab label, no object path, no student value, no public URL, no provider
  -- body and no copied workbook data reaches it -- and its `after_data` binds
  -- the request digest, which is what makes the two stored audit ids evidence
  -- rather than decoration.
  INSERT INTO plugin_data.csf_admin_audit_events (
    id, organization_id, actor_user_id, actor_profile_id, action, target_type,
    target_id, term_id, before_data, after_data, ip_hash, user_agent_hash,
    correlation_id, source_type, source_id, reason_code
  ) VALUES (
    v_audit_event_id, p_organization_id, p_actor_user_id, NULL,
    'sheet_source.upload', 'csf_sheet_sources', p_source_id, NULL, NULL,
    pg_catalog.jsonb_build_object(
      'contractVersion', c_contract,
      'actorUserId', p_actor_user_id::text,
      'sourceId', p_source_id::text,
      'stagingObjectId', p_staging_object_id::text,
      'generation', p_expected_generation,
      'contentHash', v_hash,
      'byteLength', v_staging.byte_length,
      'priorGeneration', v_request_prior_json,
      'mappingVersion', v_mapping_version,
      'requestDigest', v_request_digest
    ),
    NULL, NULL,
    v_audit_correlation_id, 'uploaded_workbook', p_source_id::text,
    'staged_generation_attached'
  );

  -- 3. Only now the receipt, merged into the same locked source row.
  UPDATE plugin_data.csf_sheet_sources AS source
  SET settings = source.settings || pg_catalog.jsonb_build_object(
        'stagingRequestDigest', v_request_digest,
        'stagingAuditEventId', v_audit_event_id,
        'stagingAuditCorrelationId', v_audit_correlation_id
      ),
      updated_at = now()
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id;

  -- 4. ONLY NOW is the predecessor superseded, and only from a TYPED attached
  -- state.
  --
  -- Guarding on `v_prior_object_id IS NOT NULL` alone was guarding on a variable
  -- that happens to be unset in every other state; guarding on the state itself
  -- says what is actually required, and a future edit that decodes the id
  -- earlier cannot silently re-enable this write for a pristine or legacy
  -- source.
  --
  -- Order is the whole invariant. N+1's path is already published above, so when
  -- settlement clears `uploaded_file_path` it finds the source naming N+1 and its
  -- `uploaded_file_path = <N's path>` predicate matches nothing -- retiring N can
  -- never blank N+1's pointer. Reversing these statements is exactly the bug
  -- that made a superseded upload take the newer readable one down with it.
  --
  -- Both rows are ALREADY locked, in canonical UUID order, by the source-scoped
  -- pair lock above -- so the helper's own object lock is a re-entrant no-op and
  -- adds no new edge. If N still has a live claim the internal helper leaves it
  -- `retire_pending` and the bounded sweeper settles it later. The retirement
  -- fence is the exact generation, never NULL: handing it NULL disabled the
  -- helper's own fence precisely where it mattered most.
  IF v_source_attachment_state = 'attached'
    AND v_prior_object_id IS DISTINCT FROM p_staging_object_id
  THEN
    PERFORM plugin_data.csf_retire_staging_object_internal(
      p_organization_id, v_prior_object_id, 'superseded_by_new_generation', v_prior,
      p_actor_user_id
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'contractVersion', c_contract,
    'outcome', 'attached',
    'replayed', false,
    'sourceId', p_source_id,
    'stagingObjectId', p_staging_object_id,
    'generation', v_staging.generation,
    'contentHash', v_staging.content_hash,
    'byteLength', v_staging.byte_length,
    'requestDigest', v_request_digest,
    'auditEventId', v_audit_event_id,
    'auditCorrelationId', v_audit_correlation_id
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_attach_sheet_source_generation(
  uuid, uuid, uuid, uuid, integer, text, integer, integer
) IS
  'Compare-and-swap the staged generation a CSF source points at, answering with a CLOSED RECEIPT under contract csf-attach-generation/v1. Every disagreement this function can decide returns outcome=refused under exactly one of six reason codes -- staging_identity_mismatch, newer_generation_attached, prior_generation_changed, mapping_version_changed, generation_coordinate_conflict, staging_not_ready -- and mutates nothing, so a caller can distinguish a decided refusal from a dropped response without reading provider prose. Bad arguments, authorization, missing rows, malformed stored settings and a receipt that contradicts its own audit row stay bounded exceptions, because no receipt could honestly be issued for them. Under the source lock the stored settings are classified into exactly three states by counting ONE closed nine-key attachment namespace -- stagedUpload, the object/generation/digest coordinates, byte length, ready timestamp, request digest and both audit ids: pristine (zero keys, no file pointer), legacy_path (zero keys, a historical uploaded_file_path) and attached (all nine). Every 1-8 key subset is corruption, so an orphan staged flag, byte length, ready timestamp or receipt key can no longer sit beside a coherent trio and be ignored. A legacy_path source is REFUSED with a fixed bounded exception before any digest, refusal or write: its pointer is the only durable locator of a private object nothing else records, it is never parsed, logged, interpolated or retired, and it needs a separate server-only inventory before cutover. Every database-derived numeric text -- stored generation, byte length and mapping version, and the audit payload''s generation, byte length, prior fence and mapping version -- is validated in sequential statements (exact JSON primitive, canonical grammar with a digit bound, numeric ceiling, then assignment) so no cast can be evaluated ahead of the grammar that makes it total. The stored ready timestamp is compared as JSON against to_jsonb of the current row rather than cast. The current attachment''s own staging row is loaded and required to match object id, generation, digest, byte length, readable lifecycle status and the source''s file pointer. Its immutable audit row is then fetched by relational coordinates into a row variable and validated procedurally: null-unused columns, after_data proved to be an object BEFORE any key enumeration, an exact ten-key coordinate-only payload, exact JSON primitive types, canonical grammar and bounds, agreement with the current coordinates, and a REBUILT historical ten-member digest that must equal both the payload''s own requestDigest and the source-stored stagingRequestDigest. The payload carries actorUserId because the relational actor column is ON DELETE SET NULL: while it is non-null the two must agree, and after a permitted account deletion the pseudonymous payload UUID keeps the receipt verifiable rather than bricking a coherent source. Historical prior fence and mapping version stay history and are never compared with the source''s later current mapping except when deciding exact replay. The mapping version is a REQUIRED request coordinate -- a null argument is refused rather than resolved from mutable current state -- so the same eight arguments always hash to the same identity. Exact replay is evaluated BEFORE mapping drift and readiness and additionally requires the requested row to BE the verified current row and the historical actor, fence and mapping to equal this request''s. An accepted request publishes the attachment core and uploaded_file_path in one statement, inserts exactly one immutable coordinate-only audit row under reason staged_generation_attached, merges the request digest and both audit ids into the same locked row, and only then -- guarded on the typed attached state rather than an incidentally null id -- requests the exact predecessor''s retirement fenced on its own generation, all in one transaction with no swallowed exception.';

-- The read-only half of the same contract.
--
-- An attach request that left this process without an answer is not knowable
-- from a table read: `settings` says what the source points at, not whether THIS
-- request is what put it there. The action's previous reconciliation read
-- `csf_sheet_sources.settings` directly and compared three coordinates, which
-- cannot see the request identity at all -- so a coincidentally identical
-- attachment made by another officer would have been reported as this upload's
-- success.
--
-- This RPC answers exactly one question -- "did MY request commit?" -- and it
-- answers it positively or not at all. It verifies the full attachment state and
-- its immutable audit row against the recomputed request digest, and it returns
-- either that verified attachment with `replayed: true` or a closed
-- `not_observed`. There is deliberately no refusal here and no DML: a read
-- issued after an in-flight write is not causally ordered after it, so "I did
-- not observe it" can never become "it did not happen", and nothing this
-- function returns may authorize a retry.
--
-- Correction B1b.2 gave it the SECOND read it was missing. It loaded only the
-- REQUESTED staging row, so it could confirm an attachment whose current row
-- disagreed with the stored coordinates, and it could report a clean
-- `not_observed` while the source's actual current attachment was missing,
-- half-written or path-incoherent. It now loads the source's own current row by
-- the stored object id -- which may be a different row entirely -- and applies
-- the byte-identical coherence and audit blocks the compare-and-swap applies, so
-- corruption raises before either outcome and only a COHERENT different
-- attachment can yield `not_observed`.
--
-- STABLE, so the whole call sees ONE snapshot: the source, both staging rows and
-- the audit row are a single coherent observation rather than four reads that
-- could straddle a commit. It takes no lock, because a lock here would be the
-- read blocking the very write it is asking about.
CREATE OR REPLACE FUNCTION plugin_data.csf_reconcile_sheet_source_generation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_staging_object_id uuid,
  p_expected_generation integer,
  p_expected_content_hash text,
  p_expected_prior_generation integer,
  p_mapping_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_contract constant text := 'csf-attach-generation/v1';
  c_attachment_keys constant text[] := ARRAY[
    'stagedUpload',
    'stagingObjectId',
    'stagingGeneration',
    'stagingContentHash',
    'stagingByteLength',
    'stagingReadyAt',
    'stagingRequestDigest',
    'stagingAuditEventId',
    'stagingAuditCorrelationId'
  ];
  c_audit_keys constant text[] := ARRAY[
    'contractVersion', 'actorUserId', 'sourceId', 'stagingObjectId',
    'generation', 'contentHash', 'byteLength', 'priorGeneration',
    'mappingVersion', 'requestDigest'
  ];
  c_max_safe_integer constant bigint := 9007199254740991;
  c_int4_max constant bigint := 2147483647;
  c_uuid_shape constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_sha256_shape constant text := '^[0-9a-f]{64}$';
  c_int4_shape constant text := '^[1-9][0-9]{0,9}$';
  c_bigint_shape constant text := '^[1-9][0-9]{0,15}$';
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_staging plugin_data.csf_sheet_import_staging_objects%ROWTYPE;
  v_current plugin_data.csf_sheet_import_staging_objects%ROWTYPE;
  v_current_found boolean := false;
  v_source_attachment_state text;
  v_attachment_present integer := 0;
  v_prior integer;
  v_prior_hash text;
  v_hash text := p_expected_content_hash;
  v_stored_mapping integer;
  v_mapping_version integer;
  v_request_digest text;
  v_request_prior_json jsonb;
  v_prior_digest text;
  v_prior_event_id uuid;
  v_prior_correlation_id uuid;
  v_prior_byte_length bigint;
  v_prior_object_id uuid;
  v_text text;
  v_audit plugin_data.csf_admin_audit_events%ROWTYPE;
  v_audit_actor uuid;
  v_audit_key_count integer;
  v_audit_generation integer;
  v_audit_byte_length bigint;
  v_audit_prior_generation integer;
  v_audit_mapping integer;
  v_audit_digest text;
BEGIN
  -- PHASE A. Arguments, identical to the compare-and-swap's. A reconciliation
  -- that accepted coordinates the attach RPC would have refused could not be
  -- asking about the same request.
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Reconciling a CSF staged generation requires an organization.'
      USING ERRCODE = '22023';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Reconciling a CSF staged generation requires the acting officer.'
      USING ERRCODE = '22023';
  END IF;
  IF p_expected_generation IS NULL OR p_expected_generation < 1 THEN
    RAISE EXCEPTION 'Reconciling a CSF staged generation requires the generation number.'
      USING ERRCODE = '22023';
  END IF;
  IF v_hash IS NULL OR v_hash !~ c_sha256_shape THEN
    RAISE EXCEPTION 'Reconciling a CSF staged generation requires its sha256 content digest.'
      USING ERRCODE = '22023';
  END IF;
  IF p_expected_prior_generation IS NOT NULL AND p_expected_prior_generation < 1 THEN
    RAISE EXCEPTION
      'A CSF staged prior generation must be a positive generation number or absent.'
      USING ERRCODE = '22023';
  END IF;
  IF p_mapping_version IS NULL OR p_mapping_version < 1 THEN
    RAISE EXCEPTION 'A CSF mapping version must be a positive number.'
      USING ERRCODE = '22023';
  END IF;
  v_mapping_version := p_mapping_version;

  -- PHASE B. The same tenant-scoped authorization. A read that proves an
  -- attachment is evidence, and evidence is not public.
  PERFORM plugin_data.csf_assert_import_actor_for_source(
    p_organization_id, p_actor_user_id, p_source_id
  );

  -- PHASE C. One snapshot, no lock.
  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;

  -- PHASE D. The same stored-state classification. Malformed stored state is
  -- corruption here too: this function may not repair it and may not report it
  -- as a clean "not observed", because that would be an answer about a request
  -- when the truth is that the source cannot be read at all.
  IF pg_catalog.jsonb_typeof(v_source.settings) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION
      'This CSF source''s stored settings are malformed and cannot be used.'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_attachment_present
  FROM pg_catalog.jsonb_object_keys(v_source.settings) AS present(key)
  WHERE present.key = ANY (c_attachment_keys);

  IF v_attachment_present = 0 THEN
    IF v_source.uploaded_file_path IS NULL THEN
      v_source_attachment_state := 'pristine';
    ELSE
      v_source_attachment_state := 'legacy_path';
    END IF;
  ELSIF v_attachment_present = pg_catalog.cardinality(c_attachment_keys) THEN
    v_source_attachment_state := 'attached';
  ELSE
    RAISE EXCEPTION
      'This CSF source''s stored attachment is incomplete and cannot be used.'
      USING ERRCODE = '22023';
  END IF;

  -- A `legacy_path` source is structurally coherent and simply not this request:
  -- it carries no staged attachment at all, so nothing here could have committed
  -- it. It falls through to `not_observed` untouched. This function does not
  -- refuse, does not raise for it, and above all does not read or report the
  -- opaque pointer -- the compare-and-swap is where that state is decided.

  -- PHASE D1. The stored attachment, decoded through sequential statements so no
  -- cast is ever evaluated ahead of the grammar that makes it total.
  IF v_source_attachment_state = 'attached' THEN
    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagedUpload') <> 'boolean' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    IF (v_source.settings -> 'stagedUpload') IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagingObjectId') <> 'string' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_source.settings ->> 'stagingObjectId';
    IF v_text !~ c_uuid_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_prior_object_id := v_text::uuid;

    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagingGeneration') <> 'number' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_source.settings ->> 'stagingGeneration';
    IF v_text !~ c_int4_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text::bigint > c_int4_max THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_prior := v_text::integer;

    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagingContentHash') <> 'string' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_prior_hash := v_source.settings ->> 'stagingContentHash';
    IF v_prior_hash !~ c_sha256_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagingByteLength') <> 'number' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_source.settings ->> 'stagingByteLength';
    IF v_text !~ c_bigint_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text::bigint > c_max_safe_integer THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_prior_byte_length := v_text::bigint;

    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagingRequestDigest') <> 'string' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_prior_digest := v_source.settings ->> 'stagingRequestDigest';
    IF v_prior_digest !~ c_sha256_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagingAuditEventId') <> 'string' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_source.settings ->> 'stagingAuditEventId';
    IF v_text !~ c_uuid_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_prior_event_id := v_text::uuid;

    IF pg_catalog.jsonb_typeof(v_source.settings -> 'stagingAuditCorrelationId') <> 'string' THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_source.settings ->> 'stagingAuditCorrelationId';
    IF v_text !~ c_uuid_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored attachment is malformed and cannot be used.'
        USING ERRCODE = '22023';
    END IF;
    v_prior_correlation_id := v_text::uuid;
  END IF;

  IF v_source.settings ? 'mappingVersion' THEN
    IF pg_catalog.jsonb_typeof(v_source.settings -> 'mappingVersion') <> 'number' THEN
      RAISE EXCEPTION
        'This CSF source''s stored mapping version is malformed.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_source.settings ->> 'mappingVersion';
    IF v_text !~ c_int4_shape THEN
      RAISE EXCEPTION
        'This CSF source''s stored mapping version is malformed.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text::bigint > c_int4_max THEN
      RAISE EXCEPTION
        'This CSF source''s stored mapping version is malformed.'
        USING ERRCODE = '22023';
    END IF;
    v_stored_mapping := v_text::integer;
  END IF;

  -- PHASE E. The REQUESTED staging row, from the same snapshot and without a
  -- lock. Rows are tombstoned rather than deleted, so an absent one means the
  -- caller named an object this source never had.
  SELECT * INTO v_staging
  FROM plugin_data.csf_sheet_import_staging_objects AS staging
  WHERE staging.organization_id = p_organization_id
    AND staging.source_id = p_source_id
    AND staging.id = p_staging_object_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF staged workbook was not found.' USING ERRCODE = '23503';
  END IF;

  -- And the source's OWN CURRENT attachment row, read INDEPENDENTLY by the
  -- stored object id. It is frequently a different row from the requested one --
  -- that is the whole point of asking whether this request committed -- and
  -- reading only the requested row is what let a divergent current attachment go
  -- unexamined.
  IF v_source_attachment_state = 'attached' THEN
    SELECT * INTO v_current
    FROM plugin_data.csf_sheet_import_staging_objects AS staging
    WHERE staging.organization_id = p_organization_id
      AND staging.source_id = p_source_id
      AND staging.id = v_prior_object_id;
    v_current_found := FOUND;
  END IF;

  -- PHASE F. The CURRENT attachment's own row, verified against the stored
  -- coordinates. Byte-identical to the compare-and-swap's block, deliberately:
  -- two authorities that disagreed about what a coherent attachment IS would be
  -- worse than either one alone.
  IF v_source_attachment_state = 'attached' THEN
    IF NOT v_current_found
      OR v_current.id IS DISTINCT FROM v_prior_object_id
      OR v_current.generation IS DISTINCT FROM v_prior
      OR v_current.content_hash IS DISTINCT FROM v_prior_hash
      OR v_current.byte_length IS DISTINCT FROM v_prior_byte_length
    THEN
      RAISE EXCEPTION
        'This CSF source''s attached workbook no longer matches its recorded evidence.'
        USING ERRCODE = '22023';
    END IF;
    -- Compared as JSON, against the value `to_jsonb` produced when this
    -- attachment was published. A `::timestamptz` cast here would accept a
    -- differently spelled instant as equal and would raise 22007 on a stored
    -- value that is not a timestamp at all.
    IF (v_source.settings -> 'stagingReadyAt')
      IS DISTINCT FROM pg_catalog.to_jsonb(v_current.ready_at)
    THEN
      RAISE EXCEPTION
        'This CSF source''s attached workbook no longer matches its recorded evidence.'
        USING ERRCODE = '22023';
    END IF;
    -- An attachment must name a generation that was actually MADE readable. The
    -- coordinate checks above are satisfied by an `uploading` row, so a source
    -- could claim a half-written object as its authoritative attachment -- and a
    -- replacement would then quietly retire it, queue its partial bytes for
    -- deletion, and overwrite that state as though it had been a real one.
    IF v_current.status NOT IN ('ready', 'retire_pending', 'tombstoned') THEN
      RAISE EXCEPTION
        'This CSF source''s attached workbook was never made readable.'
        USING ERRCODE = '22023';
    END IF;
    -- The source's raw pointer and the current row's own state must agree. A
    -- live attachment advertises its exact path; a tombstone advertises none,
    -- and the table constraint already guarantees its `object_path` is null.
    IF v_current.status IN ('ready', 'retire_pending') THEN
      IF v_current.object_path IS NULL
        OR v_source.uploaded_file_path IS DISTINCT FROM v_current.object_path
      THEN
        RAISE EXCEPTION
          'This CSF source''s stored file pointer disagrees with its attached workbook.'
          USING ERRCODE = '22023';
      END IF;
    ELSIF v_source.uploaded_file_path IS NOT NULL THEN
      RAISE EXCEPTION
        'This CSF source''s stored file pointer disagrees with its attached workbook.'
        USING ERRCODE = '22023';
    END IF;

    -- ----------------------------------------------------------------
    -- The receipt's own immutable audit row.
    --
    -- Fetched by relational coordinates FIRST, into a row variable, and then
    -- validated in sequential procedural statements. The predicate this replaces
    -- called `jsonb_object_keys()` in the same WHERE clause as the type test
    -- that was supposed to guard it -- and a scalar or array `after_data` would
    -- then raise a raw internal error out of a function whose whole contract is
    -- that it never leaks one.
    --
    -- The historical prior fence and mapping version are HISTORY. They are typed
    -- and bounded here and rebuilt into the historical digest, but they are never
    -- compared with the source's later current mapping: doing so would make a
    -- legitimate reconfiguration retroactively corrupt an exact receipt. Exact
    -- replay, further down, is the one place they meet this request.
    -- ----------------------------------------------------------------
    SELECT * INTO v_audit
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.id = v_prior_event_id
      AND audit.organization_id = p_organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF v_audit.correlation_id IS DISTINCT FROM v_prior_correlation_id
      OR v_audit.action IS DISTINCT FROM 'sheet_source.upload'
      OR v_audit.target_type IS DISTINCT FROM 'csf_sheet_sources'
      OR v_audit.target_id IS DISTINCT FROM p_source_id
      OR v_audit.source_type IS DISTINCT FROM 'uploaded_workbook'
      OR v_audit.source_id IS DISTINCT FROM p_source_id::text
      OR v_audit.reason_code IS DISTINCT FROM 'staged_generation_attached'
      OR v_audit.actor_profile_id IS NOT NULL
      OR v_audit.term_id IS NOT NULL
      OR v_audit.before_data IS NOT NULL
      OR v_audit.ip_hash IS NOT NULL
      OR v_audit.user_agent_hash IS NOT NULL
    THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    -- Proved an OBJECT before anything enumerates its keys.
    IF pg_catalog.jsonb_typeof(v_audit.after_data) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.count(*)::integer INTO v_audit_key_count
    FROM pg_catalog.jsonb_object_keys(v_audit.after_data) AS payload(key);
    IF v_audit_key_count IS DISTINCT FROM pg_catalog.cardinality(c_audit_keys) THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_audit.after_data ?& c_audit_keys) THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    -- Exact JSON primitives, before `->>` renders a number, a boolean or an
    -- array into text that would satisfy every grammar below it.
    IF pg_catalog.jsonb_typeof(v_audit.after_data -> 'contractVersion') <> 'string'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'actorUserId') <> 'string'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'sourceId') <> 'string'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'stagingObjectId') <> 'string'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'contentHash') <> 'string'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'requestDigest') <> 'string'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'generation') <> 'number'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'byteLength') <> 'number'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'mappingVersion') <> 'number'
      OR pg_catalog.jsonb_typeof(v_audit.after_data -> 'priorGeneration') NOT IN ('null', 'number')
    THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF (v_audit.after_data ->> 'contractVersion') IS DISTINCT FROM c_contract THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_audit.after_data ->> 'actorUserId';
    IF v_text !~ c_uuid_shape THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_audit_actor := v_text::uuid;
    -- The relational column is ON DELETE SET NULL. While it still holds a value
    -- it must agree with the payload; once an account deletion has blanked it,
    -- the payload coordinate is the surviving evidence and the receipt stays
    -- verifiable rather than the source becoming permanently unusable.
    IF v_audit.actor_user_id IS NOT NULL
      AND v_audit.actor_user_id IS DISTINCT FROM v_audit_actor
    THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF (v_audit.after_data ->> 'sourceId') IS DISTINCT FROM p_source_id::text THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_audit.after_data ->> 'stagingObjectId';
    IF v_text !~ c_uuid_shape THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text::uuid IS DISTINCT FROM v_prior_object_id THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_audit.after_data ->> 'contentHash';
    IF v_text !~ c_sha256_shape THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text IS DISTINCT FROM v_prior_hash THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_audit.after_data ->> 'generation';
    IF v_text !~ c_int4_shape THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text::bigint > c_int4_max THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_audit_generation := v_text::integer;
    IF v_audit_generation IS DISTINCT FROM v_prior THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_audit.after_data ->> 'byteLength';
    IF v_text !~ c_bigint_shape THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text::bigint > c_max_safe_integer THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_audit_byte_length := v_text::bigint;
    IF v_audit_byte_length IS DISTINCT FROM v_prior_byte_length THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_text := v_audit.after_data ->> 'mappingVersion';
    IF v_text !~ c_int4_shape THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF v_text::bigint > c_int4_max THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    v_audit_mapping := v_text::integer;
    IF pg_catalog.jsonb_typeof(v_audit.after_data -> 'priorGeneration') = 'number' THEN
      v_text := v_audit.after_data ->> 'priorGeneration';
      IF v_text !~ c_int4_shape THEN
        RAISE EXCEPTION
          'This CSF source''s attachment receipt does not match its recorded attachment.'
          USING ERRCODE = '22023';
      END IF;
      IF v_text::bigint > c_int4_max THEN
        RAISE EXCEPTION
          'This CSF source''s attachment receipt does not match its recorded attachment.'
          USING ERRCODE = '22023';
      END IF;
      v_audit_prior_generation := v_text::integer;
    ELSE
      v_audit_prior_generation := NULL;
    END IF;
    v_text := v_audit.after_data ->> 'requestDigest';
    IF v_text !~ c_sha256_shape THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    -- The historical identity, REBUILT rather than believed.
    --
    -- Every coordinate comes from evidence that cannot have drifted: the
    -- organization, the immutable payload actor, the source, and the current
    -- attachment this row was just proved to describe -- plus the historical
    -- fence and mapping the payload itself records. A payload whose recorded
    -- digest disagrees with its own coordinates, or whose coordinates disagree
    -- with what the source stored, is corruption in both directions.
    v_audit_digest := plugin_data.csf_canonical_digest(pg_catalog.jsonb_build_object(
      'contractVersion', c_contract,
      'organizationId', p_organization_id::text,
      'actorUserId', v_audit_actor::text,
      'sourceId', p_source_id::text,
      'stagingObjectId', v_prior_object_id::text,
      'expectedGeneration', v_prior,
      'expectedContentHash', v_prior_hash,
      'byteLength', v_prior_byte_length,
      'expectedPriorGeneration',
        coalesce(pg_catalog.to_jsonb(v_audit_prior_generation), 'null'::jsonb),
      'mappingVersion', v_audit_mapping
    ));
    IF v_audit_digest IS DISTINCT FROM v_text THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
    IF v_audit_digest IS DISTINCT FROM v_prior_digest THEN
      RAISE EXCEPTION
        'This CSF source''s attachment receipt does not match its recorded attachment.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- PHASE G. The same JS-safe gate, for the same reason.
  IF v_staging.byte_length IS NULL
    OR v_staging.byte_length < 1
    OR v_staging.byte_length > c_max_safe_integer
  THEN
    RAISE EXCEPTION
      'This CSF staged workbook''s recorded size cannot be stated exactly.'
      USING ERRCODE = '22023';
  END IF;

  -- PHASE H. The same ten-member domain-separated identity, computed by the same
  -- expression.
  v_request_prior_json := coalesce(
    pg_catalog.to_jsonb(p_expected_prior_generation), 'null'::jsonb
  );
  v_request_digest := plugin_data.csf_canonical_digest(pg_catalog.jsonb_build_object(
    'contractVersion', c_contract,
    'organizationId', p_organization_id::text,
    'actorUserId', p_actor_user_id::text,
    'sourceId', p_source_id::text,
    'stagingObjectId', p_staging_object_id::text,
    'expectedGeneration', p_expected_generation,
    'expectedContentHash', v_hash,
    'byteLength', v_staging.byte_length,
    'expectedPriorGeneration', v_request_prior_json,
    'mappingVersion', v_mapping_version
  ));

  -- PHASE I. Positive proof, or nothing.
  --
  -- The requested row must BE the verified current row. Without that clause a
  -- request naming a superseded generation could match a digest while the source
  -- pointed somewhere else entirely, and this function would have reported
  -- another attachment as this request's success.
  IF v_source_attachment_state = 'attached'
    AND v_prior_digest = v_request_digest
    AND v_prior_object_id = p_staging_object_id
    AND v_staging.id = v_current.id
    AND v_prior = p_expected_generation
    AND v_prior_hash = v_hash
    AND v_prior_byte_length = v_staging.byte_length
    AND v_staging.generation = v_prior
    AND v_staging.content_hash = v_prior_hash
    AND v_staging.status IN ('ready', 'retire_pending', 'tombstoned')
    AND v_audit_actor = p_actor_user_id
    AND v_audit_prior_generation IS NOT DISTINCT FROM p_expected_prior_generation
    AND v_audit_mapping = v_mapping_version
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'contractVersion', c_contract,
      'outcome', 'attached',
      'replayed', true,
      'sourceId', p_source_id,
      'stagingObjectId', p_staging_object_id,
      'generation', p_expected_generation,
      'contentHash', v_prior_hash,
      'byteLength', v_prior_byte_length,
      'requestDigest', v_request_digest,
      'auditEventId', v_prior_event_id,
      'auditCorrelationId', v_prior_correlation_id
    );
  END IF;
  IF v_source_attachment_state = 'attached' AND v_prior_digest = v_request_digest THEN
    RAISE EXCEPTION
      'This CSF source''s attachment receipt does not match its recorded attachment.'
      USING ERRCODE = '22023';
  END IF;

  -- Not observed, and that is ALL it says. A COHERENT different attachment lands
  -- here -- an incoherent one raised above -- and so does a pristine or legacy
  -- source. This function was asked whether one specific request committed, and
  -- the honest answer to "someone else's workbook is attached" is that this
  -- request was not observed: never that it failed, and never a licence to
  -- upload again over a source that may be about to point at this very
  -- generation.
  RETURN pg_catalog.jsonb_build_object(
    'contractVersion', c_contract,
    'outcome', 'not_observed',
    'sourceId', p_source_id,
    'stagingObjectId', p_staging_object_id,
    'generation', p_expected_generation,
    'requestDigest', v_request_digest
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_reconcile_sheet_source_generation(
  uuid, uuid, uuid, uuid, integer, text, integer, integer
) IS
  'The read-only half of contract csf-attach-generation/v1: did THIS attach request commit? Takes the identical eight coordinates the compare-and-swap takes, requires the same mapping version argument rather than resolving one from mutable state, authorizes the same tenant-scoped import actor, and reads one STABLE snapshot without any lock, so the source, BOTH staging rows and the audit row are a single coherent observation rather than four reads that could straddle a commit. It classifies the stored settings into pristine, legacy_path or attached by counting the same closed nine-key attachment namespace, treats every 1-8 key subset as corruption, and decodes every stored numeric through the same sequential grammar-then-ceiling-then-cast statements. It loads the REQUESTED staging row and, independently, the source''s OWN CURRENT row by the stored object id -- frequently a different row -- and applies the byte-identical current-attachment coherence and audit-verification blocks the compare-and-swap applies, including the rebuilt historical ten-member digest and the actorUserId payload coordinate that survives a nulled relational actor. Corruption in the current attachment therefore raises before either outcome, and only a COHERENT different attachment can yield not_observed; a structurally coherent legacy_path source is likewise not_observed and never attached, and its opaque pointer is never read, parsed or reported here. Positive proof additionally requires the requested row to BE the verified current row with exact generation, digest, byte length, request-digest and audit evidence, and returns outcome=attached with replayed=true. It performs no DML, holds no lock, repairs nothing, never refuses, and never authorizes a retry: a read issued after an in-flight write is not causally ordered after it, so not observed can never become did not happen.';

-- ===========================================================================
-- The deterministic local-development fixture seam is NOT here, on purpose.
--
-- An earlier draft created `csf_seed_reset_synthetic_import` and
-- `csf_seed_synthetic_import_fixture` in this migration and granted them to
-- `service_role`, guarded only by a reserved UUID prefix. A prefix is a naming
-- convention, not a deployment boundary: the functions still shipped to every
-- environment this migration reaches, and every one of them was one reachable
-- mutation entry point away from the production tables.
--
-- The boundary is now structural. Those functions are defined in
-- `supabase/seeds/local-only.sql`, which `supabase/config.toml` applies during a
-- local `db reset` and which a production migration deployment never runs. A
-- deployed database therefore has no synthetic fixture mutation surface at all,
-- and the convergence inventories below prove it: neither name appears in the
-- deployable contract.
-- ===========================================================================

-- ===========================================================================
-- csf_sheet_sources joins the closed posture.
--
-- Every write now goes through one of the four owned RPCs above, the evidence
-- refresh, the purge helper, or the fixture seam -- all SECURITY DEFINER, all
-- executing as the schema owner. So the table itself needs no write privilege
-- for anybody, and holding one would only re-open the boundary those RPCs exist
-- to hold.
-- ===========================================================================

ALTER TABLE plugin_data.csf_sheet_sources ENABLE ROW LEVEL SECURITY;

DO $wave5_source_privileges$
BEGIN
  PERFORM 'plugin_data.csf_sheet_sources'::regclass;
  REVOKE ALL ON TABLE plugin_data.csf_sheet_sources
    FROM PUBLIC, anon, authenticated, service_role;
  -- SELECT only, and only for the server role. Reads are how the action layer
  -- resolves a source before calling an owned RPC; writes have no caller.
  GRANT SELECT ON TABLE plugin_data.csf_sheet_sources TO service_role;
END
$wave5_source_privileges$;

-- ---------------------------------------------------------------------------
-- Table privilege convergence, against the inherited default ACL.
--
-- `ALTER DEFAULT PRIVILEGES ... IN SCHEMA plugin_data GRANT ALL ... TO service_role`
-- means every table this migration creates arrives with `service_role` holding ALL --
-- INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER included. Granting SELECT
-- afterwards adds nothing and removes nothing, so the revoke has to come first and has
-- to name every privilege, not just the ones anybody remembered.
-- ---------------------------------------------------------------------------

DO $table_privilege_convergence$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'plugin_data.csf_sheet_import_jobs',
    'plugin_data.csf_sheet_import_rows',
    'plugin_data.csf_sheet_import_commit_attempts',
    'plugin_data.csf_sheet_import_staging_objects',
    'plugin_data.csf_sheet_import_staging_claims'
  ]
  LOOP
    PERFORM v_table::regclass;
    EXECUTE format(
      'REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', v_table
    );
    -- SELECT only. Every mutation goes through an owned SECURITY DEFINER function, so
    -- there is no column whose write privilege can be justified: the columns the preview
    -- writers touch include `status`, `summary` and `import_status`, which are exactly the
    -- ones a forged commit transition needs.
    EXECUTE format('GRANT SELECT ON TABLE %s TO service_role', v_table);
  END LOOP;
END
$table_privilege_convergence$;

-- ---------------------------------------------------------------------------
-- Privilege convergence for every function this migration owns.
--
-- `CREATE OR REPLACE FUNCTION` replaces the body, the language, the volatility, the
-- `SET search_path` and the security context -- but it preserves the *owner and the
-- ACL*. So a draft that had granted `service_role` EXECUTE on an internal helper keeps
-- that grant forever, no matter how the helper is rewritten, and the per-function
-- `REVOKE ... FROM PUBLIC, anon, authenticated` lines above never mentioned
-- `service_role` at all.
--
-- This block states the intended privilege set once, revokes everything from every
-- role first, and then grants back only what the list marks reachable. Being
-- revoke-then-grant rather than grant-only is the point: it converges *away* from
-- inherited draft state instead of adding to it.
-- ---------------------------------------------------------------------------

DO $privilege_convergence$
DECLARE
  v_row record;
  v_owners text[];
BEGIN
  FOR v_row IN
    SELECT signature, service_role_execute
    FROM (VALUES
      -- Internal helpers. Reachable only from the owned SECURITY DEFINER wrappers, so
      -- not even the server role may call them directly.
      ('plugin_data.csf_has_edge_padding(text)', false),
      ('plugin_data.csf_bounded_reason_code(text, text)', false),
      ('plugin_data.csf_bounded_failure_detail(text)', false),
      ('plugin_data.csf_settle_staging_retirement(uuid)', false),
      ('plugin_data.csf_retire_expired_staging_objects(integer)', false),
      ('plugin_data.csf_lock_import_commit_coordinate(uuid, uuid, boolean)', false),
      ('plugin_data.csf_freeze_import_commit_decision(uuid, uuid, uuid, uuid, jsonb)', false),
      ('plugin_data.csf_assert_active_import_commit_attempt(uuid, uuid)', false),
      ('plugin_data.csf_assert_import_row_for_attempt(uuid, uuid, uuid)', false),
      -- Trigger functions. Invoked by the trigger, never by a caller.
      ('plugin_data.csf_enforce_import_row_attempt_lineage()', false),
      ('plugin_data.csf_preserve_import_commit_attempt()', false),
      -- Replaced by B1b.3 so the ON DELETE SET NULL actor cascade can complete.
      -- It decides immutability, so no role -- service_role included -- may call
      -- it directly; only the trigger may.
      ('plugin_data.csf_reject_audit_mutation()', false),
      -- The service RPCs the action layer speaks.
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
      -- Wave 3. Authorization, canonical form, and payload derivation are all
      -- internal: they are the checks the reachable RPCs perform, and a caller
      -- able to invoke them directly could ask whether it *would* be authorized
      -- without being, or canonicalize a record the boundary never accepted.
      ('plugin_data.csf_chapter_today()', false),
      ('plugin_data.csf_import_source_permission(text)', false),
      ('plugin_data.csf_import_compatibility_permissions(text)', false),
      ('plugin_data.csf_assert_import_actor(uuid, uuid, text)', false),
      ('plugin_data.csf_assert_import_cleanup_actor(uuid, uuid, uuid)', false),
      ('plugin_data.csf_assert_import_actor_for_source(uuid, uuid, uuid)', false),
      ('plugin_data.csf_assert_import_actor_for_job(uuid, uuid, uuid)', false),
      ('plugin_data.csf_assert_import_actor_for_row(uuid, uuid, uuid)', false),
      -- Wave 5: the sheet-source registry.
      ('plugin_data.csf_sheet_source_settings_schema()', false),
      ('plugin_data.csf_sheet_source_attachment_keys()', false),
      ('plugin_data.csf_assert_sheet_source_settings(jsonb)', false),
      ('plugin_data.csf_register_sheet_source(uuid, uuid, uuid, text, jsonb)', true),
      ('plugin_data.csf_record_sheet_source_sync(uuid, uuid, uuid, text, text, text, boolean)', true),
      ('plugin_data.csf_refresh_sheet_source_drive_metadata(uuid, uuid, uuid, jsonb)', true),
      ('plugin_data.csf_attach_sheet_source_generation(uuid, uuid, uuid, uuid, integer, text, integer, integer)', true),
      -- Reachable, and read-only. The server action calls it for exactly one
      -- question -- did the attach request it just sent commit? -- and the answer
      -- is either a fully verified attachment or "not observed". It holds no
      -- lock, writes nothing, repairs nothing and refuses nothing, so
      -- reachability grants a service caller nothing beyond proof of state that
      -- is already in the database.
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
      -- Reachable. The sweeper is granted deliberately: it can only ever move a
      -- stuck `running` preview to `failed`, never to a completed state, so it
      -- is the system's recovery path rather than an officer capability.
      ('plugin_data.csf_record_import_cleanup_recovery(uuid, uuid, text, text, integer)', true),
      ('plugin_data.csf_sweep_import_cleanup_recovery(integer)', true),
      ('plugin_data.csf_refresh_sheet_source_evidence(uuid, uuid, uuid, uuid, bigint, text, text, timestamptz, text, boolean, text, text)', true),
      -- Reachable, because the server action calls it for an uploaded source
      -- exactly where it calls the refresh above for a Google one. It performs no
      -- provider call and accepts no provider evidence, so reachability grants a
      -- service caller nothing beyond "issue a receipt for the state already in
      -- the database, if it is coherent".
      ('plugin_data.csf_issue_uploaded_source_evidence(uuid, uuid, uuid, uuid)', true),
      -- Internal. The claim consumes the token inside its own transaction, so an
      -- independently reachable consume seam could only ever burn a token
      -- without claiming -- which is the failure mode it was meant to prevent.
      ('plugin_data.csf_consume_sheet_source_evidence(uuid, uuid, uuid, uuid, uuid)', false),
      -- Redefined by this migration, so its ACL converges here too. The grant is
      -- unchanged from 20260730001001: `CREATE OR REPLACE` preserves an ACL, and
      -- a function this file rewrites but never states the privileges of is
      -- exactly the inherited-draft-grant case this block exists to close.
      ('plugin_data.csf_purge_recovery_foundations(uuid)', true)
    ) AS intended(signature, service_role_execute)
  LOOP
    -- Resolving through regprocedure means a signature that does not exist raises here
    -- rather than leaving a function silently unconverged.
    PERFORM v_row.signature::regprocedure;
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      v_row.signature
    );
    IF v_row.service_role_execute THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_row.signature);
    END IF;
  END LOOP;

  -- Ownership, scoped to exactly the functions this migration owns and required to be the
  -- trusted schema owner by name.
  --
  -- Scanning every `plugin_data.csf_%` function only established that they all happened to
  -- share one owner: it could fail because some unrelated CSF function from another
  -- migration belongs to a different role, and it would have passed if every function
  -- here were uniformly owned by the wrong one. Every SECURITY DEFINER function in this
  -- inventory executes as its owner, so the owner has to be the specific trusted role.
  SELECT array_agg(DISTINCT pg_catalog.pg_get_userbyid(proc.proowner))
  INTO v_owners
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid IN (
    SELECT intended.signature::regprocedure
    FROM (VALUES
      ('plugin_data.csf_has_edge_padding(text)'),
      ('plugin_data.csf_bounded_reason_code(text, text)'),
      ('plugin_data.csf_bounded_failure_detail(text)'),
      ('plugin_data.csf_settle_staging_retirement(uuid)'),
      ('plugin_data.csf_retire_expired_staging_objects(integer)'),
      ('plugin_data.csf_lock_import_commit_coordinate(uuid, uuid, boolean)'),
      ('plugin_data.csf_freeze_import_commit_decision(uuid, uuid, uuid, uuid, jsonb)'),
      ('plugin_data.csf_assert_active_import_commit_attempt(uuid, uuid)'),
      ('plugin_data.csf_assert_import_row_for_attempt(uuid, uuid, uuid)'),
      ('plugin_data.csf_enforce_import_row_attempt_lineage()'),
      ('plugin_data.csf_preserve_import_commit_attempt()'),
      ('plugin_data.csf_reject_audit_mutation()'),
      ('plugin_data.csf_retire_staging_object_internal(uuid, uuid, text, integer, uuid)'),
      ('plugin_data.csf_retire_staging_object(uuid, uuid, uuid, text, integer)'),
      ('plugin_data.csf_open_staging_object(uuid, uuid, uuid, text, text, text, bigint, integer)'),
      ('plugin_data.csf_finalize_staging_object(uuid, uuid, uuid)'),
      ('plugin_data.csf_claim_staging_object(uuid, uuid, uuid, integer)'),
      ('plugin_data.csf_release_staging_claim(uuid, uuid, uuid, text, boolean)'),
      ('plugin_data.csf_sweep_staging_objects(integer)'),
      ('plugin_data.csf_import_preview_claim_blockers(uuid, uuid)'),
      ('plugin_data.csf_claim_import_commit_attempt(uuid, uuid, uuid, integer, uuid)'),
      ('plugin_data.csf_heartbeat_import_commit_attempt(uuid, uuid, integer)'),
      ('plugin_data.csf_begin_import_row_for_attempt(uuid, uuid, uuid)'),
      ('plugin_data.csf_import_row_recovery_state(uuid, uuid)'),
      ('plugin_data.csf_commit_import_row_for_attempt(uuid, uuid, uuid)'),
      ('plugin_data.csf_fail_import_row_for_attempt(uuid, uuid, uuid, text, text, boolean)'),
      ('plugin_data.csf_flag_import_row_outcome_unknown(uuid, uuid, uuid, text, text)'),
      ('plugin_data.csf_reconcile_import_row_outcome(uuid, uuid, uuid, text, uuid, text, text)'),
      ('plugin_data.csf_accept_historical_import_outcome(uuid, uuid, uuid, text)'),
      ('plugin_data.csf_recover_stale_import_intents(uuid, uuid, uuid, text)'),
      ('plugin_data.csf_settle_failed_import_row(uuid, uuid, uuid, text, text)'),
      ('plugin_data.csf_finalize_import_commit_attempt(uuid, uuid, jsonb)'),
      ('plugin_data.csf_assert_preview_payload_bounds(jsonb)'),
      ('plugin_data.csf_open_import_preview(uuid, uuid, uuid, text, text, text, text, text, timestamptz, jsonb, jsonb, integer, uuid, text, text, integer, text)'),
      ('plugin_data.csf_append_import_preview_rows(uuid, uuid, uuid, jsonb)'),
      ('plugin_data.csf_seal_import_preview(uuid, uuid, uuid, text, jsonb)'),
      ('plugin_data.csf_fail_import_preview(uuid, uuid, uuid, text, text)'),
      ('plugin_data.csf_abort_import_commit_attempt(uuid, uuid, text, text)'),
      ('plugin_data.csf_chapter_today()'),
      ('plugin_data.csf_import_source_permission(text)'),
      ('plugin_data.csf_import_compatibility_permissions(text)'),
      ('plugin_data.csf_assert_import_actor(uuid, uuid, text)'),
      ('plugin_data.csf_assert_import_cleanup_actor(uuid, uuid, uuid)'),
      ('plugin_data.csf_assert_import_actor_for_source(uuid, uuid, uuid)'),
      ('plugin_data.csf_assert_import_actor_for_job(uuid, uuid, uuid)'),
      ('plugin_data.csf_assert_import_actor_for_row(uuid, uuid, uuid)'),
      ('plugin_data.csf_sheet_source_settings_schema()'),
      ('plugin_data.csf_sheet_source_attachment_keys()'),
      ('plugin_data.csf_assert_sheet_source_settings(jsonb)'),
      ('plugin_data.csf_register_sheet_source(uuid, uuid, uuid, text, jsonb)'),
      ('plugin_data.csf_record_sheet_source_sync(uuid, uuid, uuid, text, text, text, boolean)'),
      ('plugin_data.csf_refresh_sheet_source_drive_metadata(uuid, uuid, uuid, jsonb)'),
      ('plugin_data.csf_attach_sheet_source_generation(uuid, uuid, uuid, uuid, integer, text, integer, integer)'),
      ('plugin_data.csf_reconcile_sheet_source_generation(uuid, uuid, uuid, uuid, integer, text, integer, integer)'),
      ('plugin_data.csf_js_number_text(double precision)'),
      ('plugin_data.csf_canonical_number_text(numeric)'),
      ('plugin_data.csf_canonical_json(jsonb)'),
      ('plugin_data.csf_canonical_digest(jsonb)'),
      ('plugin_data.csf_payload_string(jsonb)'),
      ('plugin_data.csf_payload_number(jsonb)'),
      ('plugin_data.csf_normalize_identity_part(text)'),
      ('plugin_data.csf_normalize_email_text(text)'),
      ('plugin_data.csf_meeting_key_from_label(text, integer)'),
      ('plugin_data.csf_meeting_attendance_value(text)'),
      ('plugin_data.csf_normalized_record_schema(text)'),
      ('plugin_data.csf_assert_canonical_record(text, jsonb)'),
      ('plugin_data.csf_derive_row_commit_payload(text, jsonb)'),
      ('plugin_data.csf_purge_import_recovery(uuid)'),
      ('plugin_data.csf_record_import_cleanup_recovery(uuid, uuid, text, text, integer)'),
      ('plugin_data.csf_sweep_import_cleanup_recovery(integer)'),
      ('plugin_data.csf_refresh_sheet_source_evidence(uuid, uuid, uuid, uuid, bigint, text, text, timestamptz, text, boolean, text, text)'),
      ('plugin_data.csf_issue_uploaded_source_evidence(uuid, uuid, uuid, uuid)'),
      ('plugin_data.csf_consume_sheet_source_evidence(uuid, uuid, uuid, uuid, uuid)'),
      ('plugin_data.csf_purge_recovery_foundations(uuid)')
    ) AS intended(signature)
  );

  IF v_owners IS DISTINCT FROM ARRAY[
    (
      SELECT schema_owner.rolname::text
      FROM pg_catalog.pg_namespace AS namespace
      JOIN pg_catalog.pg_roles AS schema_owner ON schema_owner.oid = namespace.nspowner
      WHERE namespace.nspname = 'plugin_data'
    )
  ] THEN
    RAISE EXCEPTION
      'CSF import recovery halted: the functions this migration owns are owned by % rather than solely by the plugin_data schema owner. Every SECURITY DEFINER function here executes as its owner, so this is a privilege boundary that cannot be reasoned about.',
      coalesce(array_to_string(v_owners, ', '), 'no role')
      USING ERRCODE = '42501';
  END IF;
END
$privilege_convergence$;


-- ===========================================================================
-- WAVE 3, PART 6: least privilege for the two tables this wave adds, and the
-- import footprint joining the organization purge.
-- ===========================================================================

-- ===========================================================================
-- Correction B1b.3: the receipt verifier's actor-deletion branch has to be
-- REACHABLE.
--
-- `csf_admin_audit_events.actor_user_id` is declared `ON DELETE SET NULL`, and
-- the B1b.2 verifier relies on that: while the column still holds a value it
-- must equal the payload's `actorUserId`, and once a permitted account deletion
-- has blanked it the pseudonymous payload coordinate keeps the receipt
-- verifiable instead of bricking a coherent source for ever.
--
-- Except it could never happen. PostgreSQL implements `ON DELETE SET NULL` as an
-- UPDATE of the child row, and the `csf_admin_audit_events_immutable` trigger
-- answered every UPDATE and every DELETE with one unconditional raise. So
-- deleting an `auth.users` row failed at this trigger, the FK action never
-- landed, and `actor_user_id IS NULL` was unreachable state that the verifier
-- nonetheless had a branch for.
--
-- This replaces the SAME zero-argument trigger function -- no new signature, so
-- the existing trigger keeps pointing at it -- and opens exactly one hole:
--
--   * this table, in a BEFORE ROW UPDATE trigger, and nothing else;
--   * `actor_user_id` going from a value to NULL, and no other transition;
--   * every other column byte-identical, proved by comparing the whole row as
--     jsonb with that one key removed, so no second field can ride along;
--   * `pg_trigger_depth() > 1`, so it is a nested action rather than a direct
--     statement someone issued against the audit table;
--   * and the parent row is GONE, so this is the referential action completing
--     rather than a caller blanking an actor who still exists.
--
-- Everything else -- every DELETE, every other UPDATE, a statement-level or
-- AFTER firing, an organization cascade, a profile or term deletion, an
-- ordinary nested trigger, a direct service-role change -- keeps the identical
-- fixed exception and its identical message. The conditions are split across
-- two nested IFs on purpose: SQL does not guarantee short-circuit evaluation,
-- so `NEW`/`OLD` field references must sit under a proven `TG_OP = 'UPDATE'`
-- rather than beside it in one Boolean expression.
--
-- SECURITY DEFINER because the `auth.users` probe must answer the same way
-- whatever role triggered the cascade; `search_path = ''` because it does.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_SCHEMA = 'plugin_data'
    AND TG_TABLE_NAME = 'csf_admin_audit_events'
    AND TG_WHEN = 'BEFORE'
    AND TG_LEVEL = 'ROW'
    AND TG_OP = 'UPDATE'
  THEN
    IF OLD.actor_user_id IS NOT NULL
      AND NEW.actor_user_id IS NULL
      AND (pg_catalog.to_jsonb(NEW) - 'actor_user_id')
          IS NOT DISTINCT FROM
          (pg_catalog.to_jsonb(OLD) - 'actor_user_id')
      AND pg_catalog.pg_trigger_depth() > 1
      AND NOT EXISTS (
        SELECT 1
        FROM auth.users AS actor
        WHERE actor.id = OLD.actor_user_id
      )
    THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'CSF audit events are immutable.';
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_reject_audit_mutation() IS
  'Immutability trigger for plugin_data.csf_admin_audit_events, with exactly one hole: the ON DELETE SET NULL referential action that blanks actor_user_id when an auth.users row is deleted. It returns NEW only for a BEFORE ROW UPDATE on this exact table, where actor_user_id goes from a value to NULL, every other column is byte-identical as jsonb with that key removed, pg_trigger_depth() > 1 proves a nested action rather than a direct statement, and the parent auth.users row no longer exists. Every DELETE and every other UPDATE -- organization cascade, profile or term deletion, an ordinary nested trigger, a direct service-role change -- raises the same fixed immutable exception with the same message. Without this hole the B1b receipt verifier''s actor-deletion branch is unreachable, because the FK action is itself an UPDATE this trigger used to refuse.';

REVOKE ALL ON FUNCTION plugin_data.csf_reject_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

-- The audit table's own privileges, converged explicitly.
--
-- Deliberately its own statement pair rather than an entry in either table loop
-- above: the five-table import set is an exact contract a test asserts equality
-- against, and the wave-3 loop grants SELECT only. This table is APPEND-ONLY to
-- a service caller -- it reads its own history and inserts new events, and the
-- immutability trigger above is what makes the remaining two verbs meaningless
-- rather than merely unused.
--
-- No production path needs UPDATE, DELETE or TRUNCATE here: every application
-- reference is an insert or a select, no migration mutates the table, and the
-- local seed never touches it. The organization uninstall sweep in
-- `lib/plugins/private/plugins/dvhs-csf/lifecycle.ts` does list this table in
-- its per-table delete loop, but that delete already raises at the trigger for
-- any organization that ever recorded an event; the sanctioned removal path is
-- the SECURITY DEFINER purge RPC, which runs as this schema's owner and is
-- unaffected by these grants.
REVOKE ALL ON TABLE plugin_data.csf_admin_audit_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE plugin_data.csf_admin_audit_events
  TO service_role;

DO $wave3_table_privileges$
DECLARE
  v_table text;
BEGIN
  -- Deliberately a separate list from the five-table import set above. That set
  -- is an exact contract a test asserts equality against; appending to it would
  -- silently change what "the five guarded import tables" means.
  FOREACH v_table IN ARRAY ARRAY[
    'plugin_data.csf_import_cleanup_recovery',
    'plugin_data.csf_sheet_source_evidence_tokens'
  ]
  LOOP
    PERFORM v_table::regclass;
    EXECUTE format(
      'REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', v_table
    );
    EXECUTE format('GRANT SELECT ON TABLE %s TO service_role', v_table);
  END LOOP;
END
$wave3_table_privileges$;

-- The 20260730001001 entry point, extended a second time.
--
-- Its exact 14-key result contract is unchanged and is restated here so a future
-- edit has to notice it: organizationId, dispatchAttempts,
-- preferenceDecisionEvents, broadcastPreferences, addressSafetyEvents,
-- addressSafetyRecords, webhookQuarantine, providerEvents, deliveries,
-- recipientSnapshots, campaigns, partnerClubTermEvents,
-- partnerClubRepresentatives, calendarProjections.
--
-- The import footprint is retired FIRST, by the helper, because import jobs and
-- rows reference sources and terms that the later deletions remove, and because
-- an uninstall that leaves them behind leaves a tenant's student evidence in the
-- database. The helper's own counts are deliberately NOT merged into the result:
-- adding a key would break the frozen contract above.
CREATE OR REPLACE FUNCTION plugin_data.csf_purge_recovery_foundations(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_durable jsonb;
  v_provider_events integer := 0;
  v_deliveries integer := 0;
  v_snapshots integer := 0;
  v_campaigns integer := 0;
  v_club_term_events integer := 0;
  v_representatives integer := 0;
  v_calendar_events integer := 0;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF recovery purge requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_recovery_purge_organization',
    p_organization_id::text,
    true
  );

  -- Import recovery and the sheet-source lifecycle first. Both are SELECT-only
  -- to service_role, so this is the only path that can retire them at all.
  PERFORM plugin_data.csf_purge_import_recovery(p_organization_id);

  -- Durable communications next: dispatch attempts are children of the
  -- deliveries removed below. The helper restores the flag it found, which is
  -- the flag this function just set, so the deletions that follow stay
  -- authorized.
  v_durable := plugin_data.csf_purge_durable_communications(p_organization_id);

  DELETE FROM plugin_data.csf_communication_provider_events AS provider_event
  WHERE provider_event.organization_id = p_organization_id;
  GET DIAGNOSTICS v_provider_events = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_deliveries AS delivery
  WHERE delivery.organization_id = p_organization_id;
  GET DIAGNOSTICS v_deliveries = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
  WHERE snapshot.organization_id = p_organization_id;
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.organization_id = p_organization_id;
  GET DIAGNOSTICS v_campaigns = ROW_COUNT;

  DELETE FROM plugin_data.csf_partner_club_term_events AS club_event
  WHERE club_event.organization_id = p_organization_id;
  GET DIAGNOSTICS v_club_term_events = ROW_COUNT;

  DELETE FROM plugin_data.csf_partner_club_representatives AS representative
  WHERE representative.organization_id = p_organization_id;
  GET DIAGNOSTICS v_representatives = ROW_COUNT;

  -- CSF projections only. project_schedule bindings and public.projects are
  -- deliberately out of scope: this RPC retires plugin projections, never the
  -- core scheduling records they were derived from.
  DELETE FROM public.organization_calendar_events AS calendar_event
  WHERE calendar_event.organization_id = p_organization_id
    AND calendar_event.source_kind IN (
      'csf_opportunity',
      'csf_meeting_session',
      'csf_deadline'
    );
  GET DIAGNOSTICS v_calendar_events = ROW_COUNT;

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_recovery_purge_organization',
    '',
    true
  );

  -- Reproduced key for key from 20260730001003 rather than composed with `||`.
  -- The contract is the exact key set, so building it explicitly is what makes a
  -- future edit that drops or renames one a visible change instead of a
  -- side effect of what some helper happened to return.
  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'dispatchAttempts', coalesce((v_durable->>'dispatchAttempts')::integer, 0),
    'preferenceDecisionEvents',
      coalesce((v_durable->>'preferenceDecisionEvents')::integer, 0),
    'broadcastPreferences', coalesce((v_durable->>'broadcastPreferences')::integer, 0),
    'addressSafetyEvents', coalesce((v_durable->>'addressSafetyEvents')::integer, 0),
    'addressSafetyRecords', coalesce((v_durable->>'addressSafetyRecords')::integer, 0),
    'webhookQuarantine', coalesce((v_durable->>'webhookQuarantine')::integer, 0),
    'providerEvents', v_provider_events,
    'deliveries', v_deliveries,
    'recipientSnapshots', v_snapshots,
    'campaigns', v_campaigns,
    'partnerClubTermEvents', v_club_term_events,
    'partnerClubRepresentatives', v_representatives,
    'calendarProjections', v_calendar_events
  );
END;
$$;


-- Per-function privilege statements for wave 3.
--
-- The convergence block below states the same thing once, revoking from every role
-- before restoring only what the inventory marks reachable, and that is what
-- actually holds. These lines are here as well because a function whose privileges
-- are only ever set by a loop is one rename away from being silently unconverged,
-- and because the intent of each one belongs beside its definition.
REVOKE ALL ON FUNCTION plugin_data.csf_chapter_today()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_import_source_permission(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_import_compatibility_permissions(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_import_actor(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_import_cleanup_actor(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_import_actor_for_source(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_import_actor_for_job(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_import_actor_for_row(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_js_number_text(double precision)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_canonical_number_text(numeric)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_canonical_json(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_canonical_digest(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_payload_string(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_payload_number(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_normalize_identity_part(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_normalize_email_text(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_meeting_key_from_label(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_meeting_attendance_value(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_normalized_record_schema(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_canonical_record(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_derive_row_commit_payload(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_purge_import_recovery(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_record_import_cleanup_recovery(uuid, uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_import_cleanup_recovery(uuid, uuid, text, text, integer) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_sweep_import_cleanup_recovery(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sweep_import_cleanup_recovery(integer) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_refresh_sheet_source_evidence(uuid, uuid, uuid, uuid, bigint, text, text, timestamptz, text, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_refresh_sheet_source_evidence(uuid, uuid, uuid, uuid, bigint, text, text, timestamptz, text, boolean, text, text) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_issue_uploaded_source_evidence(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_issue_uploaded_source_evidence(uuid, uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_consume_sheet_source_evidence(uuid, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_purge_recovery_foundations(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_purge_recovery_foundations(uuid) TO service_role;


-- Wave 5 per-function privilege statements.
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_source_settings_schema()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_source_attachment_keys()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_sheet_source_settings(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_register_sheet_source(uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_register_sheet_source(uuid, uuid, uuid, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_record_sheet_source_sync(uuid, uuid, uuid, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_sheet_source_sync(uuid, uuid, uuid, text, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_refresh_sheet_source_drive_metadata(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_refresh_sheet_source_drive_metadata(uuid, uuid, uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_attach_sheet_source_generation(uuid, uuid, uuid, uuid, integer, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_attach_sheet_source_generation(uuid, uuid, uuid, uuid, integer, text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_sheet_source_generation(uuid, uuid, uuid, uuid, integer, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reconcile_sheet_source_generation(uuid, uuid, uuid, uuid, integer, text, integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- The deployable contract carries no synthetic fixture mutation surface.
--
-- Asserted rather than assumed. A draft installed these with a `service_role`
-- grant, and "we deleted the CREATE" is not the same claim as "the deployed
-- database cannot reach it": the drops above are what make the second true, and
-- this is what proves they ran.
-- ---------------------------------------------------------------------------

DO $wave6_no_fixture_seam$
DECLARE
  v_present text[];
BEGIN
  SELECT array_agg(proc.oid::regprocedure::text ORDER BY proc.oid::regprocedure::text)
  INTO v_present
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'plugin_data'
    AND proc.proname IN (
      'csf_seed_synthetic_import_fixture',
      'csf_seed_reset_synthetic_import',
      'csf_assert_synthetic_fixture_scope',
      'csf_is_synthetic_fixture_id',
      'csf_assert_fixture_keys',
      'csf_assert_fixture_reference',
      'csf_assert_fixture_owner'
    );

  IF v_present IS NOT NULL THEN
    RAISE EXCEPTION
      'CSF import recovery halted: the deployable contract must contain no synthetic fixture mutation seam, but plugin_data still holds %. Those functions belong to supabase/seeds/local-only.sql, which a production deployment does not apply.',
      array_to_string(v_present, ', ')
      USING ERRCODE = '42501';
  END IF;
END
$wave6_no_fixture_seam$;

-- ---------------------------------------------------------------------------
-- Re-assert the server-only boundary.
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_sheet_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_sheet_import_rows ENABLE ROW LEVEL SECURITY;

-- Table privileges are converged by the revoke-then-grant block above, which is the only
-- place they are stated. The `GRANT ALL ... TO service_role` that used to close this file
-- was the release blocker itself: it handed back INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES and TRIGGER on the two tables the whole fenced-wrapper argument depends on,
-- so a service caller could write a commit job, an attempt link, a frozen decision or a
-- terminal row status directly and never touch an RPC. Nothing here re-grants them.
