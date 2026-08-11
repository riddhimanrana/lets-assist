-- Durable CSF communications: schema, dispatch safety, consent, reduction,
-- and teardown.
--
-- Every value here is synthetic. The whole file runs inside one transaction and
-- ends in ROLLBACK, so it leaves no rows behind and does not depend on the
-- order it is run relative to any other suite.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(421);

-- This transaction is one synthetic local backend. Direct fixture inserts do
-- not pass through the server wrapper that derives the hosted project ref, so
-- make their signed environment coordinate explicit at the table boundary.
ALTER TABLE plugin_data.csf_communication_campaigns
  ALTER COLUMN metadata
  SET DEFAULT '{"csf_environment":"local"}'::jsonb;

-- ---------------------------------------------------------------------------
-- A. Fresh schema presence and explicit, in-limit object names
-- ---------------------------------------------------------------------------

SELECT extensions.has_table(
  'plugin_data', 'csf_communication_broadcast_preferences',
  'broadcast consent has a durable projection table'
);
SELECT extensions.has_table(
  'plugin_data', 'csf_communication_preference_events',
  'consent decisions have an append-only history table'
);
SELECT extensions.has_table(
  'plugin_data', 'csf_communication_dispatch_attempts',
  'per-try dispatch work has a durable attempt ledger'
);
-- VOLUNTARY CONSENT AND PROVIDER SAFETY ARE DIFFERENT FACTS. They therefore live
-- in different tables, and the safety one deliberately carries no topic column.
SELECT extensions.has_table(
  'plugin_data', 'csf_communication_address_safety',
  'provider address safety has its own durable projection, separate from consent'
);
SELECT extensions.has_table(
  'plugin_data', 'csf_communication_address_safety_events',
  'address safety observations have an append-only evidence table'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'plugin_data'
      AND table_name = 'csf_communication_address_safety'
      AND column_name = 'topic_key'
  ),
  'address safety is address-scoped and cannot be expressed as a topic decision'
);

SELECT extensions.has_column(
  'plugin_data', 'csf_communication_campaigns', 'body_text',
  'a campaign stores the exact plain-text body it sends'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_communication_campaigns', 'content_hash',
  'a campaign stores a content digest'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_communication_campaigns', 'cancelled_at',
  'a campaign records when it was cancelled'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_communication_dispatch_attempts', 'request_payload_hash',
  'every attempt stores the digest of the exact provider request'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_communication_dispatch_attempts', 'reconciled_by',
  'reconciliation records the account that decided it'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_communication_dispatch_attempts', 'escalated_at',
  'escalation is recorded separately from final reconciliation'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_communication_provider_events', 'provider_occurred_at',
  'provider evidence distinguishes a real provider time from a placeholder'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_communication_recipient_snapshots', 'recipient_snapshot_hash',
  'an audience row carries its own complete snapshot digest'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_communication_campaigns', 'content_finalized_at',
  'a campaign records the explicit moment its copy was declared ready'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_communication_dispatch_attempts', 'dispatch_authorized_at',
  'an attempt records when the ledger handed a worker the exact request'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_communication_provider_events', 'attempt_id',
  'provider evidence records which dispatch attempt it resolved against'
);

-- PostgreSQL silently truncates an identifier past 63 bytes, which would make
-- any test that names the object unnameable. Every explicit name this migration
-- creates is checked, not just the ones that happen to be short.
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_meta
    WHERE constraint_meta.conrelid IN (
        'plugin_data.csf_communication_campaigns'::regclass,
        'plugin_data.csf_communication_recipient_snapshots'::regclass,
        'plugin_data.csf_communication_deliveries'::regclass,
        'plugin_data.csf_communication_provider_events'::regclass,
        'plugin_data.csf_communication_dispatch_attempts'::regclass,
        'plugin_data.csf_communication_broadcast_preferences'::regclass,
        'plugin_data.csf_communication_preference_events'::regclass,
        'plugin_data.csf_communication_address_safety'::regclass,
        'plugin_data.csf_communication_address_safety_events'::regclass
      )
      AND octet_length(constraint_meta.conname::text) > 63
  ),
  'no constraint name on a durable communications table exceeds the 63-byte identifier limit'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'csf_comm_snapshot_transactional_mandatory_check'
  )
  AND EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'csf_comm_pref_resubscribe_source_check'
  ),
  'the two shortened constraint names exist under exactly the names the tests use'
);

SELECT extensions.ok(
  (
    SELECT count(*)::integer
    FROM pg_class
    WHERE relkind = 'i'
      AND relname IN (
        'csf_communication_dispatch_attempts_claim_idx',
        'csf_communication_dispatch_attempts_lease_expiry_idx',
        'csf_communication_dispatch_attempts_campaign_state_idx',
        'csf_communication_dispatch_attempts_delivery_idx',
        'csf_communication_dispatch_attempts_review_idx',
        'csf_communication_dispatch_attempts_live_idx',
        'csf_communication_provider_events_reduction_idx',
        'csf_communication_broadcast_preferences_address_idx',
        'csf_communication_broadcast_preferences_profile_idx',
        'csf_communication_campaigns_content_hash_idx',
        'csf_communication_campaigns_term_idx',
        'csf_comm_delivery_provider_message_global_idx',
        'csf_comm_pref_events_timeline_idx',
        'csf_comm_address_safety_lookup_idx',
        'csf_comm_address_safety_suppressed_idx',
        'csf_comm_addr_safety_events_timeline_idx',
        'csf_comm_event_attempt_idx'
      )
  ) = 17,
  'dispatch claim, lease expiry, reduction, consent, address-safety, and tenant indexes all exist'
);

SELECT extensions.ok(
  (
    SELECT indisunique
    FROM pg_index AS index_meta
    JOIN pg_class AS index_class ON index_class.oid = index_meta.indexrelid
    WHERE index_class.relname = 'csf_comm_delivery_provider_message_global_idx'
  ),
  'provider message identity is globally unique, so a webhook cannot resolve to two tenants'
);

-- ---------------------------------------------------------------------------
-- B. Server-only boundary and the deletion boundary
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (
    SELECT bool_and(class.relrowsecurity)
    FROM pg_class AS class
    WHERE class.oid IN (
      'plugin_data.csf_communication_broadcast_preferences'::regclass,
      'plugin_data.csf_communication_preference_events'::regclass,
      'plugin_data.csf_communication_address_safety'::regclass,
      'plugin_data.csf_communication_address_safety_events'::regclass,
      'plugin_data.csf_communication_dispatch_attempts'::regclass,
      'plugin_data.csf_communication_campaigns'::regclass,
      'plugin_data.csf_communication_recipient_snapshots'::regclass,
      'plugin_data.csf_communication_deliveries'::regclass,
      'plugin_data.csf_communication_provider_events'::regclass,
      'plugin_data.csf_communication_webhook_quarantine'::regclass
    )
  ),
  'row level security is enabled on every durable communications table'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'plugin_data'
      AND tablename IN (
        'csf_communication_broadcast_preferences',
        'csf_communication_preference_events',
        'csf_communication_address_safety',
        'csf_communication_address_safety_events',
        'csf_communication_dispatch_attempts',
        'csf_communication_campaigns',
        'csf_communication_recipient_snapshots',
        'csf_communication_deliveries',
        'csf_communication_provider_events',
        'csf_communication_webhook_quarantine'
      )
  ),
  'no browser-facing policy exists on any durable communications table'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_communication_broadcast_preferences',
      'plugin_data.csf_communication_preference_events',
      'plugin_data.csf_communication_address_safety',
      'plugin_data.csf_communication_address_safety_events',
      'plugin_data.csf_communication_dispatch_attempts',
      'plugin_data.csf_communication_campaigns',
      'plugin_data.csf_communication_recipient_snapshots',
      'plugin_data.csf_communication_deliveries',
      'plugin_data.csf_communication_provider_events',
      'plugin_data.csf_communication_webhook_quarantine'
    ]) AS target(relation)
    CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS client(role_name)
    CROSS JOIN unnest(ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]) AS wanted(privilege)
    WHERE has_table_privilege(client.role_name::name, target.relation, wanted.privilege)
  ),
  'anon and authenticated hold no privilege at all on any durable communications table'
);

-- WIDENED. This used to allow the server role direct INSERT/UPDATE on consent,
-- consent history, and the dispatch attempt ledger, with address safety and the
-- webhook quarantine as the SELECT-only exceptions. The reasoning behind those
-- exceptions -- a projection row and the append-only record justifying it are
-- written together, in one transaction, by one owner function -- is not special to
-- them. It is the same reasoning for every consequential ledger here, and a direct
-- write grant contradicts it identically: it lets a bare statement forge a complete
-- tuple that no guard ever ran for.
--
-- So the boundary is now uniform. Reads stay open because dispatch, review screens,
-- and the decision helpers need them; every consequential write goes through an
-- owner-executed SECURITY DEFINER RPC. Section N2 below proves the denial by
-- executing forged full-tuple writes as service_role, rather than only asserting
-- the catalog.
-- ONE INVENTORY, USED BY EVERY PRIVILEGE ASSERTION BELOW.
--
-- These lists used to be retyped per assertion, and they silently diverged: the
-- TRUNCATE/REFERENCES/TRIGGER case enumerated FIVE of the ten while its
-- description claimed the whole boundary, so five ledgers -- including campaigns,
-- deliveries, provider events, and the webhook quarantine -- were never checked
-- for the three privileges that would let a holder erase or restructure audited
-- history without firing a single row trigger. A copied list is a list that will
-- drift; there is now exactly one.
CREATE FUNCTION pg_temp.csf_communication_ledger_inventory()
RETURNS TABLE (relation text)
LANGUAGE sql
STABLE
AS $inventory$
  SELECT unnest(ARRAY[
    'plugin_data.csf_communication_broadcast_preferences',
    'plugin_data.csf_communication_preference_events',
    'plugin_data.csf_communication_address_safety',
    'plugin_data.csf_communication_address_safety_events',
    'plugin_data.csf_communication_webhook_quarantine',
    'plugin_data.csf_communication_dispatch_attempts',
    'plugin_data.csf_communication_campaigns',
    'plugin_data.csf_communication_recipient_snapshots',
    'plugin_data.csf_communication_deliveries',
    'plugin_data.csf_communication_provider_events'
  ]);
$inventory$;

-- AND THE INVENTORY ITSELF IS PROVED AGAINST THE CATALOG.
--
-- One shared list removes the drift between assertions; it does not stop the list
-- from falling behind the schema. A future migration adding an eleventh
-- communications ledger would leave it unasserted and every check below would
-- still pass, describing a boundary it no longer covers. So the inventory is
-- compared, both directions, against every ordinary table in plugin_data whose
-- name says it is one of these. Adding a table without listing it fails here.
SELECT extensions.ok(
  NOT EXISTS (
    SELECT relation FROM pg_temp.csf_communication_ledger_inventory()
    EXCEPT
    SELECT 'plugin_data.' || class.relname
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS ns ON ns.oid = class.relnamespace
    WHERE ns.nspname = 'plugin_data'
      AND class.relkind = 'r'
      AND class.relname LIKE 'csf\_communication\_%'
  )
  AND NOT EXISTS (
    SELECT 'plugin_data.' || class.relname
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS ns ON ns.oid = class.relnamespace
    WHERE ns.nspname = 'plugin_data'
      AND class.relkind = 'r'
      AND class.relname LIKE 'csf\_communication\_%'
    EXCEPT
    SELECT relation FROM pg_temp.csf_communication_ledger_inventory()
  )
  -- Anti-tautology: two empty sets would also satisfy both EXCEPTs.
  AND (SELECT count(*) FROM pg_temp.csf_communication_ledger_inventory()) = 10,
  'the ledger inventory is exactly the ten csf_communication_% tables that exist, so no assertion below can describe a boundary it does not cover'
);

SELECT extensions.ok(
  (
    SELECT bool_and(has_table_privilege('service_role', target.relation, 'SELECT'))
    FROM pg_temp.csf_communication_ledger_inventory() AS target
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_temp.csf_communication_ledger_inventory() AS target
    CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS forbidden(privilege)
    WHERE has_table_privilege('service_role', target.relation, forbidden.privilege)
  ),
  'the server role reads every communications ledger and can directly write none of them'
);

-- INVERTED. A GUC that service_role can set itself is not a deletion boundary;
-- the absence of the DELETE privilege is. Removal happens only through the
-- owner-run purge entry point.
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_temp.csf_communication_ledger_inventory() AS target
    WHERE has_table_privilege('service_role', target.relation, 'DELETE')
  ),
  'the server role holds no DELETE on any communications ledger, preference, attempt, or provider event'
);

-- TRUNCATE would erase an audited ledger without firing a single row trigger, and
-- REFERENCES/TRIGGER would let a holder attach new structure to audited history.
-- All ten, not the five this used to check.
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_temp.csf_communication_ledger_inventory() AS target
    CROSS JOIN unnest(ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']) AS forbidden(privilege)
    WHERE has_table_privilege('service_role', target.relation, forbidden.privilege)
  ),
  'not even the server role may TRUNCATE, REFERENCE, or attach triggers to any of the ten communications ledgers'
);

-- INVERTED. The partial purge helper is reachable only from inside the exact
-- entry point, which runs as the owner.
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY['public', 'anon', 'authenticated', 'service_role']) AS role_name
    WHERE has_function_privilege(
      role_name::name, 'plugin_data.csf_purge_durable_communications(uuid)', 'EXECUTE'
    )
  ),
  'the partial purge helper is not directly executable by any granted role'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role', 'plugin_data.csf_purge_recovery_foundations(uuid)', 'EXECUTE'
  ),
  'only the exact existing organization purge entry point is executable by the server role'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_snapshot_communication_recipients(uuid, uuid, jsonb)',
      'plugin_data.csf_finalize_communication_recipient_snapshot(uuid, uuid, integer)',
      'plugin_data.csf_finalize_communication_campaign_content(uuid, uuid, uuid, text)',
      'plugin_data.csf_finalize_communication_campaign(uuid, uuid)',
      'plugin_data.csf_claim_communication_dispatch_batch(uuid, uuid, text, integer, integer)',
      'plugin_data.csf_authorize_communication_dispatch(uuid, uuid, text, text)',
      'plugin_data.csf_reap_communication_dispatch_leases(uuid, uuid)',
      'plugin_data.csf_cancel_communication_campaign(uuid, uuid, text, uuid, text)',
      'plugin_data.csf_settle_communication_dispatch_attempt(uuid, uuid, text, text, text, integer, text, text, integer, integer, jsonb)',
      'plugin_data.csf_record_communication_provider_event(uuid, text, text, text, timestamptz, text, boolean, text, text, jsonb, uuid, uuid)',
      'plugin_data.csf_rebind_communication_provider_event(uuid, text)',
      -- EIGHT arguments. This listed seven, and has_function_privilege() raises
      -- undefined_function for a signature that does not exist -- which aborted the
      -- whole suite here at assertion 30 with a bad plan, so nothing downstream ran.
      -- A stale signature in a privilege assertion is not a soft failure.
      'plugin_data.csf_reconcile_communication_unknown_outcome(uuid, uuid, text, text, text, uuid, text, text)',
      'plugin_data.csf_release_communication_address_safety(uuid, text, text, uuid, text)',
      'plugin_data.csf_bind_communication_provider_message(uuid, uuid, text, text, uuid, text)',
      'plugin_data.csf_quarantine_communication_webhook(text, text, text, text, text, text, uuid, uuid, uuid)',
      'plugin_data.csf_purge_recovery_foundations(uuid)',
      'plugin_data.csf_communication_preference_decision(uuid, text, text, text)',
      'plugin_data.csf_communication_address_safety_decision(uuid, text)',
      'plugin_data.csf_communication_dispatch_decision(uuid, text, text, text)',
      'plugin_data.csf_comm_reduction_decision(text, timestamptz, boolean, text, boolean, timestamptz)',
      'plugin_data.csf_communication_provider_request(uuid, uuid, uuid, uuid, integer)',
      'plugin_data.csf_communication_provider_request_hash(jsonb)',
      'plugin_data.csf_communication_idempotency_key(uuid, uuid, uuid, integer, text)',
      'plugin_data.csf_comm_safety_kind_rank(text)',
      'plugin_data.csf_comm_bounce_class(text)',
      'plugin_data.csf_communication_tag_value(text)',
      'plugin_data.csf_comm_teardown_authorized(uuid)',
      'plugin_data.csf_provider_event_metadata_allowlisted(jsonb)'
    ]) AS guard(signature)
    CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated']) AS client(role_name)
    WHERE has_function_privilege(client.role_name::name, guard.signature, 'EXECUTE')
  ),
  'no client role can execute any durable communications RPC, guard, or helper'
);

-- The two primitives that write on behalf of the ledger itself are reachable from
-- nowhere but the owner-run RPCs that call them.
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_resolve_communication_provider_evidence(uuid, uuid)',
      -- TEN arguments: p_bounce_type was added so a permanent bounce and a full
      -- mailbox stop producing the same block. The nine-argument spelling here did
      -- not exist and raised undefined_function.
      'plugin_data.csf_apply_communication_address_safety(uuid, text, text, text, timestamptz, text, text, text, text, text)'
    ]) AS internal(signature)
    CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role'])
      AS caller(role_name)
    WHERE has_function_privilege(caller.role_name::name, internal.signature, 'EXECUTE')
  ),
  'the evidence-resolution and address-safety primitives are not directly executable by any granted role'
);

SELECT extensions.ok(
  (
    SELECT bool_and(proc.prosecdef AND proc.proconfig @> ARRAY['search_path=""'])
    FROM pg_proc AS proc
    WHERE proc.oid IN (
      'plugin_data.csf_snapshot_communication_recipients(uuid, uuid, jsonb)'::regprocedure,
      'plugin_data.csf_finalize_communication_recipient_snapshot(uuid, uuid, integer)'::regprocedure,
      'plugin_data.csf_finalize_communication_campaign_content(uuid, uuid, uuid, text)'::regprocedure,
      'plugin_data.csf_finalize_communication_campaign(uuid, uuid)'::regprocedure,
      'plugin_data.csf_claim_communication_dispatch_batch(uuid, uuid, text, integer, integer)'::regprocedure,
      'plugin_data.csf_authorize_communication_dispatch(uuid, uuid, text, text)'::regprocedure,
      'plugin_data.csf_reap_communication_dispatch_leases(uuid, uuid)'::regprocedure,
      'plugin_data.csf_cancel_communication_campaign(uuid, uuid, text, uuid, text)'::regprocedure,
      'plugin_data.csf_settle_communication_dispatch_attempt(uuid, uuid, text, text, text, integer, text, text, integer, integer, jsonb)'::regprocedure,
      'plugin_data.csf_record_communication_provider_event(uuid, text, text, text, timestamptz, text, boolean, text, text, jsonb, uuid, uuid)'::regprocedure,
      'plugin_data.csf_rebind_communication_provider_event(uuid, text)'::regprocedure,
      'plugin_data.csf_resolve_communication_provider_evidence(uuid, uuid)'::regprocedure,
      -- TEN arguments, not nine: p_bounce_type was added so a permanent bounce and a
      -- full mailbox stop producing the same block. A ::regprocedure cast of a
      -- signature that does not exist raises undefined_function, which aborts the
      -- suite and leaves every downstream assertion unrun.
      'plugin_data.csf_apply_communication_address_safety(uuid, text, text, text, timestamptz, text, text, text, text, text)'::regprocedure,
      -- EIGHT, not seven, for the same reason.
      'plugin_data.csf_reconcile_communication_unknown_outcome(uuid, uuid, text, text, text, uuid, text, text)'::regprocedure,
      'plugin_data.csf_release_communication_address_safety(uuid, text, text, uuid, text)'::regprocedure,
      'plugin_data.csf_bind_communication_provider_message(uuid, uuid, text, text, uuid, text)'::regprocedure,
      'plugin_data.csf_quarantine_communication_webhook(text, text, text, text, text, text, uuid, uuid, uuid)'::regprocedure,
      'plugin_data.csf_purge_durable_communications(uuid)'::regprocedure,
      'plugin_data.csf_purge_recovery_foundations(uuid)'::regprocedure
    )
  ),
  'every durable communications RPC is SECURITY DEFINER with a pinned empty search_path'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = 'plugin_data.csf_purge_recovery_foundations(uuid)'::regprocedure
      AND prorettype = 'jsonb'::regtype
  ),
  'the existing purge entry point is extended in place, not renamed or replaced'
);

-- The email helper is the one that used a schema-qualified POSITION(x IN y),
-- which is a parse error rather than a runtime one. Calling it proves the
-- function body actually compiles.
SELECT extensions.ok(
  plugin_data.csf_communication_email_is_storable('rep.one@local.test')
    AND NOT plugin_data.csf_communication_email_is_storable('two@at@local.test')
    AND NOT plugin_data.csf_communication_email_is_storable('no-at-sign')
    AND NOT plugin_data.csf_communication_email_is_storable('@leading.test')
    AND NOT plugin_data.csf_communication_email_is_storable('has space@local.test'),
  'the storable-address helper parses and enforces exactly one at-sign with content on both sides'
);

-- ---------------------------------------------------------------------------
-- C. Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('bd000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'csf-officer@local.test', now(), '{}', '{}', now(), now()),
  ('bd000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'linked.member@local.test', now(), '{}', '{}', now(), now()),
  ('bd000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'other-org-officer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('bd100000-0000-4000-8000-000000000001', 'CSF Comms One', 'csf-comms-one', 'school', '991001'),
  ('bd100000-0000-4000-8000-000000000002', 'CSF Comms Two', 'csf-comms-two', 'school', '991002');

-- ACTOR AUTHORIZATION FIXTURES.
--
-- Cancellation, reconciliation, and content finalization require an ACTIVE
-- tenant-scoped CSF staff capability, so the suite needs three distinct actors:
-- one authorized here, one that is a real account but no member of any
-- organization, and one that is an officer of the OTHER organization.
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('bd100000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('bd100000-0000-4000-8000-000000000002', 'bd000000-0000-4000-8000-000000000003', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  ('bd200000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001', 'S32', 'Spring 2032', '2031-2032', 'spring', true),
  ('bd200000-0000-4000-8000-000000000002', 'bd100000-0000-4000-8000-000000000002', 'S32', 'Spring 2032', '2031-2032', 'spring', true);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES (
  'bd300000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001',
  'Comms', 'Member', 'comms', 'member'
);

SET CONSTRAINTS ALL IMMEDIATE;

-- ---------------------------------------------------------------------------
-- D. Campaign identity, server-derived content, durable term history
-- ---------------------------------------------------------------------------

-- A campaign recorded before this migration: no body, so no content digest and
-- no dispatch readiness. Its history is preserved exactly as it was.
SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, sender_email, subject,
      audience_snapshot_version, provider_idempotency_key
    ) VALUES (
      'bd400000-0000-4000-8000-000000000004', 'bd100000-0000-4000-8000-000000000001',
      'broadcast', 'queued', 'legacy@local.test', 'Legacy campaign', 1,
      'legacy-campaign-key'
    )
  $$,
  'a legacy campaign with no body is preserved exactly as it was'
);

SELECT extensions.is(
  (
    SELECT content_hash IS NULL
    FROM plugin_data.csf_communication_campaigns
    WHERE id = 'bd400000-0000-4000-8000-000000000004'
  ),
  true,
  'a campaign with no plain-text body can never become dispatch-ready'
);

-- A CALLER-SUPPLIED CONTENT HASH IS NOT PROOF. The declared digest below is
-- discarded and replaced with the server-derived one.
--
-- content_finalized_at is what makes this campaign dispatch-ready. A body alone
-- would leave it an editable draft with no digest at all; see section D2 below.
SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, sender_name, sender_email,
      reply_to_email, subject, body_text, body_html, body_text_hash,
      content_hash, term_id, audience_kind, broadcast_topic_key, resend_topic_id,
      created_by, created_by_identity, content_finalized_at, content_finalized_by,
      content_finalized_by_identity, audience_snapshot_version,
      provider_idempotency_key, metadata
    ) VALUES (
      'bd400000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001',
      'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
      'dvhighcsf@gmail.com', 'Spring 2032 partner club audit',
      'Please submit your Spring 2032 audit.', NULL,
      repeat('a', 64), repeat('9', 64), 'bd200000-0000-4000-8000-000000000001',
      'partner_club_representatives', 'partner_clubs',
      -- A dispatch-ready broadcast must carry the provider topic: it is what puts a
      -- working one-click unsubscribe in the recipient's mail client, and the
      -- resend-topic scope CHECK now requires it.
      'topic_synthetic_partner_clubs',
      'bd000000-0000-4000-8000-000000000001', 'csf-officer@local.test',
      now(), 'bd000000-0000-4000-8000-000000000001', 'csf-officer@local.test', 1,
      'spring-2032-audit-broadcast',
      '{"csf_environment":"local"}'::jsonb
    )
  $$,
  'a dispatch-ready broadcast records the DVHS identity, body, topic, provider topic, term, and creator'
);

SELECT extensions.is(
  (
    SELECT content_hash
    FROM plugin_data.csf_communication_campaigns
    WHERE id = 'bd400000-0000-4000-8000-000000000001'
  ),
  plugin_data.csf_communication_campaign_content_hash(
    'broadcast', 'email', 'DVHS CSF', 'csf@notifications.lets-assist.com',
    'dvhighcsf@gmail.com', 'Spring 2032 partner club audit',
    'Please submit your Spring 2032 audit.', NULL,
    '{}'::jsonb, 'partner_clubs'
  ),
  'the stored content digest is derived from the stored content, not from what the caller declared'
);

SELECT extensions.isnt(
  (
    SELECT content_hash
    FROM plugin_data.csf_communication_campaigns
    WHERE id = 'bd400000-0000-4000-8000-000000000001'
  ),
  repeat('9', 64),
  'the caller-declared content digest was discarded'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      organization_id, campaign_kind, status, sender_name, sender_email,
      reply_to_email, subject, body_text, body_text_hash,
      term_id, audience_kind, broadcast_topic_key, resend_topic_id,
      created_by_identity, content_finalized_at, content_finalized_by_identity,
      provider_idempotency_key
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'broadcast', 'draft', 'Someone Else',
      'someone@example.com', 'dvhighcsf@gmail.com', 'Wrong sender',
      'Body text.', repeat('a', 64),
      'bd200000-0000-4000-8000-000000000001', 'partner_club_representatives',
      -- Supplied so the SENDER rule below is the constraint that actually fires.
      -- PostgreSQL evaluates CHECKs in constraint-name order, and
      -- csf_comm_campaign_resend_topic_scope_check sorts before
      -- csf_communication_campaigns_dispatch_identity_check -- so omitting the
      -- provider topic here would report a topic error for a sender test.
      'partner_clubs', 'topic_synthetic_partner_clubs', 'csf-officer@local.test',
      now(), 'csf-officer@local.test', 'wrong-sender-key'
    )
  $$,
  '23514',
  'new row for relation "csf_communication_campaigns" violates check constraint "csf_communication_campaigns_dispatch_identity_check"',
  'a dispatch-ready campaign cannot use a sender other than DVHS CSF'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      organization_id, campaign_kind, status, sender_name, sender_email,
      reply_to_email, subject, body_text, body_text_hash,
      term_id, audience_kind, broadcast_topic_key, resend_topic_id,
      created_by_identity, content_finalized_at, content_finalized_by_identity,
      provider_idempotency_key
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'broadcast', 'draft', 'DVHS CSF',
      'csf@notifications.lets-assist.com', 'someone.else@example.com',
      'Wrong reply-to', 'Body text.', repeat('a', 64),
      'bd200000-0000-4000-8000-000000000001', 'partner_club_representatives',
      'partner_clubs', 'topic_synthetic_partner_clubs', 'csf-officer@local.test',
      now(), 'csf-officer@local.test', 'wrong-reply-to-key'
    )
  $$,
  '23514',
  'new row for relation "csf_communication_campaigns" violates check constraint "csf_communication_campaigns_dispatch_identity_check"',
  'a dispatch-ready campaign cannot use a reply-to other than dvhighcsf@gmail.com'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      organization_id, campaign_kind, status, sender_name, sender_email,
      reply_to_email, subject, body_text, body_text_hash, term_id,
      audience_kind, resend_topic_id, created_by_identity, content_finalized_at,
      content_finalized_by_identity, provider_idempotency_key
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'broadcast', 'draft', 'DVHS CSF',
      'csf@notifications.lets-assist.com', 'dvhighcsf@gmail.com',
      'No topic', 'Body text.', repeat('a', 64),
      'bd200000-0000-4000-8000-000000000001', 'partner_club_representatives',
      -- The PROVIDER topic is present; the local consent topic is what is missing,
      -- so the consent-scope rule is the one under test here.
      'topic_synthetic_partner_clubs',
      'csf-officer@local.test', now(), 'csf-officer@local.test', 'no-topic-key'
    )
  $$,
  '23514',
  'new row for relation "csf_communication_campaigns" violates check constraint "csf_communication_campaigns_topic_scope_check"',
  'a dispatch-ready broadcast must name the preference topic it is scoped to'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      organization_id, campaign_kind, status, sender_email, subject,
      broadcast_topic_key, provider_idempotency_key
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'broadcast', 'draft',
      'csf@local.test', 'Reserved topic', 'transactional', 'reserved-topic-key'
    )
  $$,
  '23514',
  'new row for relation "csf_communication_campaigns" violates check constraint "csf_communication_campaigns_topic_key_check"',
  'no campaign may claim the reserved transactional topic'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      organization_id, campaign_kind, status, sender_name, sender_email,
      reply_to_email, subject, body_text, body_text_hash, term_id,
      audience_kind, broadcast_topic_key, created_by_identity,
      provider_idempotency_key
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'broadcast', 'draft', 'DVHS CSF',
      'csf@notifications.lets-assist.com', 'dvhighcsf@gmail.com',
      'Cross tenant term', 'Body text.', repeat('a', 64),
      'bd200000-0000-4000-8000-000000000002', 'partner_club_representatives',
      'partner_clubs', 'csf-officer@local.test', 'cross-tenant-term-key'
    )
  $$,
  '23503',
  'insert or update on table "csf_communication_campaigns" violates foreign key constraint "csf_communication_campaigns_term_fkey"',
  'a campaign cannot be filed under another organization semester'
);

-- DURABLE TERM HISTORY. RESTRICT, not SET NULL: severing the semester would
-- either break the dispatch CHECK or quietly orphan the send.
SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_terms
    WHERE id = 'bd200000-0000-4000-8000-000000000001'
  $$,
  '23503',
  'update or delete on table "csf_terms" violates foreign key constraint "csf_communication_campaigns_term_fkey" on table "csf_communication_campaigns"',
  'a semester that a campaign belongs to cannot be deleted out from under it'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, sender_name, sender_email,
      reply_to_email, subject, body_text, body_text_hash, term_id,
      audience_kind, created_by, created_by_identity, content_finalized_at,
      content_finalized_by_identity, audience_snapshot_version,
      provider_idempotency_key
    ) VALUES (
      'bd400000-0000-4000-8000-000000000002', 'bd100000-0000-4000-8000-000000000001',
      'transactional', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
      'dvhighcsf@gmail.com', 'Your CSF application decision',
      'Your application was reviewed.', repeat('b', 64),
      'bd200000-0000-4000-8000-000000000001', 'applicants',
      'bd000000-0000-4000-8000-000000000001', 'csf-officer@local.test',
      now(), 'csf-officer@local.test', 1,
      'spring-2032-decision-transactional'
    )
  $$,
  'a dispatch-ready transactional campaign carries no topic because it cannot be refused'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, sender_name, sender_email,
      reply_to_email, subject, body_text, body_text_hash, term_id,
      audience_kind, broadcast_topic_key, resend_topic_id, created_by_identity,
      content_finalized_at, content_finalized_by_identity,
      audience_snapshot_version, provider_idempotency_key
    ) VALUES
      (
        'bd400000-0000-4000-8000-000000000003', 'bd100000-0000-4000-8000-000000000002',
        'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
        'dvhighcsf@gmail.com', 'Other organization broadcast',
        'Other organization body.', repeat('c', 64),
        'bd200000-0000-4000-8000-000000000002', 'term_members', 'partner_clubs',
        'topic_synthetic_other_org',
        'csf-officer@local.test', now(), 'csf-officer@local.test', 1,
        'other-org-broadcast'
      ),
      (
        'bd400000-0000-4000-8000-000000000005', 'bd100000-0000-4000-8000-000000000001',
        'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
        'dvhighcsf@gmail.com', 'Campaign that will be cancelled',
        'This send is cancelled before it leaves.', repeat('d', 64),
        'bd200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
        'topic_synthetic_term_bulletin',
        'csf-officer@local.test', now(), 'csf-officer@local.test', 1,
        'cancelled-campaign-key'
      ),
      (
        'bd400000-0000-4000-8000-000000000006', 'bd100000-0000-4000-8000-000000000001',
        'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
        'dvhighcsf@gmail.com', 'Campaign whose recipient opts out late',
        'This recipient changes their mind after the freeze.', repeat('e', 64),
        'bd200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
        'topic_synthetic_term_bulletin',
        'csf-officer@local.test', now(), 'csf-officer@local.test', 1,
        'late-optout-campaign-key'
      ),
      (
        'bd400000-0000-4000-8000-000000000008', 'bd100000-0000-4000-8000-000000000001',
        'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
        'dvhighcsf@gmail.com', 'Campaign whose address is provider-suppressed',
        'This address bounced before the send.', repeat('8', 64),
        'bd200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
        'topic_synthetic_term_bulletin',
        'csf-officer@local.test', now(), 'csf-officer@local.test', 1,
        'suppressed-address-broadcast-key'
      ),
      -- TRANSACTIONAL: no consent topic AND no provider topic. Attaching a provider
      -- topic here would offer an unsubscribe from mail the chapter is obliged to
      -- send, and one click would then suppress it.
      (
        'bd400000-0000-4000-8000-000000000009', 'bd100000-0000-4000-8000-000000000001',
        'transactional', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
        'dvhighcsf@gmail.com', 'Mandatory notice to a suppressed address',
        'Transactional mail to a bounced address.', repeat('9', 64),
        'bd200000-0000-4000-8000-000000000001', 'applicants', NULL, NULL,
        'csf-officer@local.test', now(), 'csf-officer@local.test', 1,
        'suppressed-address-transactional-key'
      ),
      -- BYTE-IDENTICAL to bd400000-...0001: same sender, reply-to, subject, both
      -- bodies, topic, and provider topic. Only the campaign coordinate differs,
      -- which is exactly the collision the old content-only request digest produced.
      (
        'bd400000-0000-4000-8000-000000000010', 'bd100000-0000-4000-8000-000000000001',
        'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
        'dvhighcsf@gmail.com', 'Spring 2032 partner club audit',
        'Please submit your Spring 2032 audit.', repeat('a', 64),
        'bd200000-0000-4000-8000-000000000001', 'partner_club_representatives',
        'partner_clubs', 'topic_synthetic_partner_clubs',
        'csf-officer@local.test', now(), 'csf-officer@local.test',
        1, 'second-campaign-same-copy-key'
      ),
      (
        'bd400000-0000-4000-8000-000000000011', 'bd100000-0000-4000-8000-000000000001',
        'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
        'dvhighcsf@gmail.com', 'Campaign that must not complete early',
        'This campaign is terminalized only once every recipient is settled.',
        repeat('1', 64),
        'bd200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
        'topic_synthetic_term_bulletin',
        'csf-officer@local.test', now(), 'csf-officer@local.test', 1,
        'terminalization-campaign-key'
      ),
      -- For the email.sent acceptance case: its recipient is claimed AND
      -- authorized, then left in flight so a signed sent webhook can be observed
      -- racing the worker's own HTTP response.
      (
        'bd400000-0000-4000-8000-000000000012', 'bd100000-0000-4000-8000-000000000001',
        'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
        'dvhighcsf@gmail.com', 'Campaign whose sent webhook beats the worker',
        'The provider acknowledges before the worker hears back.', repeat('2', 64),
        'bd200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
        'topic_synthetic_term_bulletin',
        'csf-officer@local.test', now(), 'csf-officer@local.test', 1,
        'sent-acceptance-campaign-key'
      ),
      -- The contrast case: signed provider evidence naming an attempt that was
      -- never authorized for dispatch.
      (
        'bd400000-0000-4000-8000-000000000013', 'bd100000-0000-4000-8000-000000000001',
        'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
        'dvhighcsf@gmail.com', 'Campaign whose evidence names an unauthorized try',
        'The provider claims a send this ledger never released.', repeat('3', 64),
        'bd200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
        'topic_synthetic_term_bulletin',
        'csf-officer@local.test', now(), 'csf-officer@local.test', 1,
        'unauthorized-evidence-campaign-key'
      ),
      -- Cancelled while a worker still holds a live lease, so authorization has
      -- to refuse a send the officer already stopped.
      (
        'bd400000-0000-4000-8000-000000000014', 'bd100000-0000-4000-8000-000000000001',
        'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
        'dvhighcsf@gmail.com', 'Campaign cancelled under a live lease',
        'This send is withdrawn while a worker still holds its lease.',
        repeat('4', 64),
        'bd200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
        'topic_synthetic_term_bulletin',
        'csf-officer@local.test', now(), 'csf-officer@local.test', 1,
        'cancelled-under-lease-campaign-key'
      ),
      -- Manual provider-message binding racing previously unmatched evidence.
      (
        'bd400000-0000-4000-8000-000000000015', 'bd100000-0000-4000-8000-000000000001',
        'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
        'dvhighcsf@gmail.com', 'Campaign whose identity is discovered later',
        'An officer finds the provider message identity after settlement.',
        repeat('5', 64),
        'bd200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
        'topic_synthetic_term_bulletin',
        'csf-officer@local.test', now(), 'csf-officer@local.test', 1,
        'late-binding-campaign-key'
      ),
      -- sent -> suppressed, where the accepted attempt history must survive.
      (
        'bd400000-0000-4000-8000-000000000016', 'bd100000-0000-4000-8000-000000000001',
        'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
        'dvhighcsf@gmail.com', 'Campaign the provider suppresses after accepting',
        'Accepted first, suppressed afterwards.', repeat('6', 64),
        'bd200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
        'topic_synthetic_term_bulletin',
        'csf-officer@local.test', now(), 'csf-officer@local.test', 1,
        'sent-then-suppressed-campaign-key'
      ),
      -- Signed safety evidence that arrives with no provider occurrence time, so
      -- the reduction decision short-circuits before it ever reaches the safety
      -- branch.
      (
        'bd400000-0000-4000-8000-000000000018', 'bd100000-0000-4000-8000-000000000001',
        'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
        'dvhighcsf@gmail.com', 'Campaign whose bounce carries no provider time',
        'A safety signal arrives without an authoritative timestamp.',
        repeat('9', 64),
        'bd200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
        'topic_synthetic_term_bulletin',
        'csf-officer@local.test', now(), 'csf-officer@local.test', 1,
        'timeless-safety-campaign-key'
      ),
      -- Deliberately never handed to any RPC. It is the anti-tautology control
      -- for the advisory-lock assertions: if the predicate answered true for a
      -- campaign nothing has touched, it would be proving nothing anywhere.
      (
        'bd400000-0000-4000-8000-000000000017', 'bd100000-0000-4000-8000-000000000001',
        'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
        'dvhighcsf@gmail.com', 'Campaign no RPC ever touches',
        'Untouched control for the advisory-lock probe.', repeat('7', 64),
        'bd200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
        'topic_synthetic_term_bulletin',
        'csf-officer@local.test', now(), 'csf-officer@local.test', 1,
        'never-locked-campaign-key'
      )
  $$,
  'the remaining fixture campaigns are dispatch-ready, including two that reuse one approved body'
);

-- A BEHAVIOURAL PROBE FOR THE CANONICAL PROLOGUE -- AND EXACTLY WHAT IT PROVES.
--
-- Every consequential campaign path is required to take
-- pg_advisory_xact_lock(hashtextextended('csf-communication-campaign:<org>:<id>'))
-- BEFORE it touches a campaign, attempt, delivery, or evidence row. Reading the
-- migration text proves nothing at runtime, so this asks PostgreSQL directly:
-- pg_locks reports the advisory locks this backend actually holds.
--
-- WHAT THIS PROBE CANNOT SEE IS ORDER. pg_locks is a snapshot of what is held
-- NOW, not a journal of when each lock was taken. Because the suite runs in one
-- transaction and pg_advisory_xact_lock holds to COMMIT, a true answer proves the
-- campaign advisory lock WAS ACQUIRED by some RPC in this transaction -- it does
-- not prove the lock was taken before that RPC's row locks, and it cannot
-- distinguish which of several RPCs acquired it. The row locks it would have to
-- be compared against are themselves already released or coalesced by the time
-- any assertion runs. Ordering is enforced by the canonical prologue in the
-- migration. Cross-session ordering needs a dedicated two-connection integration
-- harness; the assertions below are deliberately worded as acquisition, not
-- sequence, so this pgTAP file never claims evidence it cannot produce.
--
-- A 64-bit advisory key is stored split across classid (high 32 bits) and objid
-- (low 32), with objsubid = 1. Both halves are compared as unsigned, which is why
-- the key is masked rather than cast.
--
-- The whole suite runs in one transaction and pg_advisory_xact_lock holds until
-- it ends, so "held" is a durable post-condition once an RPC has run against a
-- campaign -- and campaign bd400000-...0017, which no RPC ever touches, is the
-- control that keeps the predicate from being a tautology.
CREATE FUNCTION pg_temp.csf_campaign_advisory_held(p_org uuid, p_campaign uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $advisoryprobe$
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_locks AS held
    WHERE held.locktype = 'advisory'
      AND held.pid = pg_catalog.pg_backend_pid()
      AND held.objsubid = 1
      AND held.classid::bigint = (
        (
          pg_catalog.hashtextextended(
            'csf-communication-campaign:' || p_org::text || ':' || p_campaign::text,
            0
          ) >> 32
        ) & 4294967295
      )
      AND held.objid::bigint = (
        pg_catalog.hashtextextended(
          'csf-communication-campaign:' || p_org::text || ':' || p_campaign::text,
          0
        ) & 4294967295
      )
  );
$advisoryprobe$;

-- ---------------------------------------------------------------------------
-- D2. A NON-EMPTY DRAFT BODY IS NOT PUBLICATION
--
-- A campaign is editable until an officer explicitly says the copy is ready.
-- Deriving dispatch identity from "the body is no longer empty" would freeze the
-- sender, subject, and body on the FIRST save, so an officer who noticed a typo
-- would have to abandon the campaign and retype it.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, sender_name, sender_email,
      reply_to_email, subject, body_text, body_text_hash, term_id,
      audience_kind, broadcast_topic_key, created_by, created_by_identity,
      audience_snapshot_version, provider_idempotency_key
    ) VALUES (
      'bd400000-0000-4000-8000-000000000007', 'bd100000-0000-4000-8000-000000000001',
      'broadcast', 'draft', 'DVHS CSF', 'csf@notifications.lets-assist.com',
      'dvhighcsf@gmail.com', 'First pass at the subject',
      'First pass at the body.', repeat('7', 64),
      'bd200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
      'bd000000-0000-4000-8000-000000000001', 'csf-officer@local.test', 1,
      'editable-draft-key'
    )
  $$,
  'a draft with a full body saves without becoming dispatch-ready'
);

-- The provider topic is a DRAFT field until content finalization, exactly like the
-- subject: an officer who picked the wrong chapter topic must be able to fix it.
SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET resend_topic_id = 'topic_synthetic_first_choice'
    WHERE id = 'bd400000-0000-4000-8000-000000000007'
  $$,
  'a draft provider topic is editable before content finalization'
);

SELECT extensions.is(
  (
    SELECT (content_hash IS NULL)::text || '|' || (content_finalized_at IS NULL)::text
    FROM plugin_data.csf_communication_campaigns
    WHERE id = 'bd400000-0000-4000-8000-000000000007'
  ),
  'true|true',
  'a non-empty draft body derives no content digest and no dispatch readiness'
);

-- REPEATED SAVES. Every field the officer is still writing stays editable.
SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET subject = 'Second pass at the subject',
        body_text = 'Second pass at the body.',
        body_html = '<p>Second pass.</p>',
        body_metadata = '{"template":"audit-v2"}'::jsonb,
        sender_name = 'DVHS CSF',
        broadcast_topic_key = 'term_bulletin',
        audience_kind = 'staff',
        term_id = 'bd200000-0000-4000-8000-000000000001'
    WHERE id = 'bd400000-0000-4000-8000-000000000007'
  $$,
  'a draft sender, subject, body, HTML, metadata, topic, term, and audience kind all stay editable'
);

SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET body_text = 'Third pass at the body.',
        broadcast_topic_key = 'partner_clubs'
    WHERE id = 'bd400000-0000-4000-8000-000000000007'
  $$,
  'a draft can be saved repeatedly without any freeze taking hold'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_finalize_communication_campaign_content(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000007',
      'bd000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  'That account does not hold the CSF staff capability required to finalize campaign content in this organization.',
  'a non-staff account cannot declare campaign copy ready to send'
);

CREATE TEMP TABLE t_finalize_content AS
SELECT plugin_data.csf_finalize_communication_campaign_content(
  'bd100000-0000-4000-8000-000000000001',
  'bd400000-0000-4000-8000-000000000007',
  'bd000000-0000-4000-8000-000000000001',
  'corr-content-final-1'
) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'contentHash' IS NOT NULL)::text
      || '|' || (result->>'idempotentReplay')
    FROM t_finalize_content
  ),
  'true|false',
  'explicit content finalization is what derives the dispatch content digest'
);

SELECT extensions.is(
  (
    SELECT content_hash
    FROM plugin_data.csf_communication_campaigns
    WHERE id = 'bd400000-0000-4000-8000-000000000007'
  ),
  plugin_data.csf_communication_campaign_content_hash(
    'broadcast', 'email', 'DVHS CSF', 'csf@notifications.lets-assist.com',
    'dvhighcsf@gmail.com', 'Second pass at the subject',
    'Third pass at the body.', '<p>Second pass.</p>',
    '{"template":"audit-v2"}'::jsonb, 'partner_clubs'
  ),
  'the finalized digest describes the LAST draft state, not the first'
);

-- AND NOW EVERYTHING FREEZES TOGETHER.
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET body_text = 'Fourth pass, after finalization.'
    WHERE id = 'bd400000-0000-4000-8000-000000000007'
  $$,
  '23514',
  'CSF campaign sender identity, subject, and body are frozen once the campaign content is finalized.',
  'the body freezes at content finalization'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET broadcast_topic_key = 'term_bulletin'
    WHERE id = 'bd400000-0000-4000-8000-000000000007'
  $$,
  '23514',
  'CSF campaign sender identity, subject, and body are frozen once the campaign content is finalized.',
  'the broadcast topic freezes together with the content'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET audience_kind = 'custom_list'
    WHERE id = 'bd400000-0000-4000-8000-000000000007'
  $$,
  '23514',
  'CSF campaign audience identity and dispatch markers are recorded once and never rewritten.',
  'the audience kind freezes together with the content'
);

-- THE PROVIDER TOPIC IS PART OF THE FINALIZED CONTENT CONTRACT.
--
-- 20260730001001 froze resend_topic_id only once the campaign left draft, but
-- content finalization happens WHILE it is still a draft -- so between those two
-- points the topic was editable even though every attempt's payload digest and
-- idempotency key had already been derived from it. Repointing it there would have
-- sent a broadcast under a different unsubscribe topic than the ledger vouched for.
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET resend_topic_id = 'topic_synthetic_repointed'
    WHERE id = 'bd400000-0000-4000-8000-000000000007'
  $$,
  '23514',
  'CSF campaign sender identity, subject, and body are frozen once the campaign content is finalized.',
  'the provider topic freezes with the content, exactly like the subject and body'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_campaign_content(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000007',
      'bd000000-0000-4000-8000-000000000001'
    )->>'idempotentReplay'
  ),
  'true',
  'replaying content finalization is idempotent rather than a second freeze'
);

-- ---------------------------------------------------------------------------
-- E. Consent: accountless preferences and append-only history
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_broadcast_preferences (
      organization_id, topic_key, recipient_email, subscription_state,
      opt_out_source, opt_out_at
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'transactional',
      'nope@local.test', 'unsubscribed', 'recipient_unsubscribe_link', now()
    )
  $$,
  '23514',
  'new row for relation "csf_communication_broadcast_preferences" violates check constraint "csf_communication_broadcast_preferences_topic_key_check"',
  'no consent row can express refusal of transactional mail'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_broadcast_preferences (
      id, organization_id, topic_key, recipient_email, subscription_state,
      opt_out_source, opt_out_reason, opt_out_at
    ) VALUES (
      'bd500000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001',
      'partner_clubs', 'OptedOut@Local.Test', 'unsubscribed',
      'recipient_unsubscribe_link', 'Too many emails.', now() - interval '1 day'
    )
  $$,
  'an accountless address can opt out of a broadcast topic with no account or profile'
);

SELECT extensions.is(
  (
    SELECT (user_id IS NULL AND profile_id IS NULL)::text
      || '|' || normalized_recipient_email
    FROM plugin_data.csf_communication_broadcast_preferences
    WHERE id = 'bd500000-0000-4000-8000-000000000001'
  ),
  'true|optedout@local.test',
  'the accountless opt-out is keyed on the normalized address with no account or profile'
);

SELECT extensions.is(
  (
    SELECT recipient_email_hash
    FROM plugin_data.csf_communication_broadcast_preferences
    WHERE id = 'bd500000-0000-4000-8000-000000000001'
  ),
  encode(extensions.digest('optedout@local.test'::text, 'sha256'), 'hex'),
  'the preference address digest is generated from the normalized address'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_communication_broadcast_preferences (
      id, organization_id, topic_key, recipient_email, user_id, profile_id,
      subscription_state
    ) VALUES (
      'bd500000-0000-4000-8000-000000000002', 'bd100000-0000-4000-8000-000000000001',
      'partner_clubs', 'subscribed@local.test',
      'bd000000-0000-4000-8000-000000000002', 'bd300000-0000-4000-8000-000000000001',
      'subscribed'
    )
  $$,
  'an account-linked address records an explicit subscription'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_broadcast_preferences (
      organization_id, topic_key, recipient_email, subscription_state
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'partner_clubs',
      'OPTEDOUT@local.test', 'subscribed'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "csf_communication_broadcast_preferences_scope_key"',
  'one address holds one decision per topic per organization'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_broadcast_preferences (
      organization_id, topic_key, recipient_email, subscription_state
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'partner_clubs',
      'unsubscribed.without.evidence@local.test', 'unsubscribed'
    )
  $$,
  '23514',
  'new row for relation "csf_communication_broadcast_preferences" violates check constraint "csf_communication_broadcast_preferences_decision_check"',
  'an opt-out must record when and from where it was made'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_broadcast_preferences (
      organization_id, topic_key, recipient_email, subscription_state,
      resubscribe_source
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'partner_clubs',
      'bad.source@local.test', 'subscribed', 'telepathy'
    )
  $$,
  '23514',
  'new row for relation "csf_communication_broadcast_preferences" violates check constraint "csf_comm_pref_resubscribe_source_check"',
  'the shortened resubscribe-source constraint is the one that actually fires'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_broadcast_preferences (
      organization_id, topic_key, recipient_email, subscription_state
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'partner_clubs',
      'two@addresses@local.test', 'subscribed'
    )
  $$,
  '23514',
  'new row for relation "csf_communication_broadcast_preferences" violates check constraint "csf_communication_broadcast_preferences_email_shape_check"',
  'a malformed address is refused before it can be mailed'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_broadcast_preferences
    SET topic_key = 'other_topic'
    WHERE id = 'bd500000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF broadcast preference identity (organization, topic, address) is immutable; record a decision for the new scope instead.',
  'a consent record cannot be re-scoped to a different topic'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_broadcast_preferences
    SET subscription_state = 'subscribed', opt_out_at = NULL, opt_out_source = NULL
    WHERE id = 'bd500000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'A recorded CSF broadcast opt-out is never erased; resubscribing keeps the opt-out timestamp as history.',
  'resubscribing may not erase the opt-out that came before it'
);

-- THE PRIVILEGE CASES MUST ACTUALLY RUN AS service_role.
--
-- A pgTAP suite runs as the database owner, and the owner's privileges are not
-- checked against grants at all -- so a bare DELETE here proved nothing about
-- service_role and instead reported whichever immutability trigger happened to
-- fire. Worse, with the teardown GUC set the owner-run delete SUCCEEDED, which is
-- how the purge assertion downstream came to be testing an already-empty table.
-- SET LOCAL ROLE is what makes the assertion mean what it says.
SET LOCAL ROLE service_role;

SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_communication_broadcast_preferences
    WHERE id = 'bd500000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table csf_communication_broadcast_preferences',
  'the server role cannot delete a consent record at all; it lacks the privilege'
);

RESET ROLE;

-- REPEATED CONSENT CYCLES. The projection forgets; the history does not.
--
-- Three of the four decisions are the recipient acting through an unsubscribe
-- link with no account behind them, which is the ordinary case; the last is an
-- officer acting on their behalf. Both are recorded, and they are recorded as
-- DIFFERENT kinds of claim.
INSERT INTO plugin_data.csf_communication_broadcast_preferences (
  id, organization_id, topic_key, recipient_email, subscription_state,
  last_decision_at, decision_actor_kind, decision_actor_identity,
  decision_correlation_id
) VALUES (
  'bd500000-0000-4000-8000-000000000003', 'bd100000-0000-4000-8000-000000000001',
  'partner_clubs', 'cycles@local.test', 'subscribed', now() - interval '4 days',
  'recipient', 'unsubscribe-link', 'corr-consent-1'
);

UPDATE plugin_data.csf_communication_broadcast_preferences
SET subscription_state = 'unsubscribed',
    opt_out_at = now() - interval '3 days',
    opt_out_source = 'recipient_unsubscribe_link',
    last_decision_at = now() - interval '3 days',
    decision_actor_kind = 'recipient',
    decision_actor_identity = 'unsubscribe-link',
    decision_correlation_id = 'corr-consent-2'
WHERE id = 'bd500000-0000-4000-8000-000000000003';

UPDATE plugin_data.csf_communication_broadcast_preferences
SET subscription_state = 'subscribed',
    resubscribed_at = now() - interval '2 days',
    resubscribe_source = 'recipient_action',
    last_decision_at = now() - interval '2 days',
    decision_actor_kind = 'recipient',
    decision_actor_identity = 'unsubscribe-link',
    decision_correlation_id = 'corr-consent-3'
WHERE id = 'bd500000-0000-4000-8000-000000000003';

UPDATE plugin_data.csf_communication_broadcast_preferences
SET subscription_state = 'unsubscribed',
    opt_out_at = now() - interval '1 day',
    opt_out_source = 'staff_action',
    last_decision_at = now() - interval '1 day',
    decision_actor_kind = 'staff',
    decision_actor_user_id = 'bd000000-0000-4000-8000-000000000001',
    decision_actor_identity = 'csf-officer@local.test',
    decision_correlation_id = 'corr-consent-4'
WHERE id = 'bd500000-0000-4000-8000-000000000003';

SELECT extensions.is(
  (
    SELECT string_agg(decision, ',' ORDER BY decided_at)
    FROM plugin_data.csf_communication_preference_events
    WHERE normalized_recipient_email = 'cycles@local.test'
  ),
  'subscribed,unsubscribed,subscribed,unsubscribed',
  'a repeated opt-out and resubscribe cycle preserves every decision in order'
);

SELECT extensions.is(
  (
    SELECT subscription_state
    FROM plugin_data.csf_communication_broadcast_preferences
    WHERE id = 'bd500000-0000-4000-8000-000000000003'
  ),
  'unsubscribed',
  'the projection still answers with the current decision'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_preference_events
    SET decision = 'subscribed'
    WHERE normalized_recipient_email = 'cycles@local.test'
      AND decision = 'unsubscribed'
  $$,
  '23514',
  'CSF consent history is append-only.',
  'a recorded consent decision can never be rewritten'
);

SET LOCAL ROLE service_role;

SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_communication_preference_events
    WHERE normalized_recipient_email = 'cycles@local.test'
  $$,
  '42501',
  'permission denied for table csf_communication_preference_events',
  'the server role cannot delete consent history at all'
);

RESET ROLE;

-- CONSENT HISTORY FREEZES ITS ACTOR EVIDENCE.
SELECT extensions.is(
  (
    SELECT string_agg(
      actor_kind || ':' || coalesce(actor_identity, 'no-identity'), ','
      ORDER BY decided_at
    )
    FROM plugin_data.csf_communication_preference_events
    WHERE normalized_recipient_email = 'cycles@local.test'
  ),
  'recipient:unsubscribe-link,recipient:unsubscribe-link,recipient:unsubscribe-link,staff:csf-officer@local.test',
  'every consent decision records the actor kind and durable identity that made it'
);

-- A RECIPIENT DECISION CANNOT MASQUERADE AS STAFF.
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_broadcast_preferences (
      organization_id, topic_key, recipient_email, subscription_state,
      decision_actor_kind, decision_actor_user_id
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'partner_clubs',
      'fake.staff@local.test', 'subscribed', 'recipient',
      'bd000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'new row for relation "csf_communication_broadcast_preferences" violates check constraint "csf_comm_pref_actor_account_check"',
  'a recipient self-service decision cannot attach a staff account to itself'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_broadcast_preferences (
      organization_id, topic_key, recipient_email, subscription_state,
      decision_actor_kind
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'partner_clubs',
      'accountless.staff@local.test', 'subscribed', 'staff'
    )
  $$,
  '23514',
  'new row for relation "csf_communication_broadcast_preferences" violates check constraint "csf_comm_pref_actor_account_check"',
  'a staff decision must name the account behind it'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_preference_events
    SET actor_kind = 'staff'
    WHERE normalized_recipient_email = 'cycles@local.test'
      AND actor_kind = 'recipient'
  $$,
  '23514',
  'CSF consent history is append-only.',
  'recorded consent actor evidence can never be relabelled'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_communication_preference_decision(
      'bd100000-0000-4000-8000-000000000001', 'broadcast', 'partner_clubs',
      'OptedOut@Local.Test'
    )->>'decision'
  ),
  'suppressed_opt_out',
  'a broadcast to an opted-out address is suppressed'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_communication_preference_decision(
      'bd100000-0000-4000-8000-000000000001', 'transactional', NULL,
      'OptedOut@Local.Test'
    )->>'decision'
  ),
  'mandatory_transactional',
  'the same opted-out address still receives mandatory transactional mail'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_communication_preference_decision(
      'bd100000-0000-4000-8000-000000000001', 'broadcast', 'partner_clubs',
      'never.seen@local.test'
    )->>'decision'
  ),
  'no_preference_record',
  'an address with no recorded decision is not treated as a refusal'
);

-- ---------------------------------------------------------------------------
-- F. Audience snapshot
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000002',
      'bd400000-0000-4000-8000-000000000001',
      '[{"email":"cross.tenant@local.test","provenance":"staff_entry"}]'::jsonb
    )
  $$,
  '23503',
  'That CSF campaign does not exist in this organization.',
  'an audience cannot be built for another organization campaign'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000004',
      '[{"email":"legacy.audience@local.test","provenance":"staff_entry"}]'::jsonb
    )
  $$,
  '23514',
  'A CSF campaign must record its content digest and DVHS sending identity before an audience is built.',
  'a campaign with no body can never be dispatched'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001',
      '[]'::jsonb
    )
  $$,
  '22023',
  'A CSF audience snapshot call carries between 1 and 500 recipients; page larger audiences.',
  'an audience snapshot call is bounded at both ends'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001',
      '[{"email":"no.provenance@local.test"}]'::jsonb
    )
  $$,
  '22023',
  'CSF audience recipient 1 must record where its address came from.',
  'every audience row must record where its address came from'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001',
      '[{"email":"declared@local.test","provenance":"staff_entry","requirement":"transactional"}]'::jsonb
    )
  $$,
  '22023',
  'CSF audience recipient 1 declares requirement "transactional" but the campaign is broadcast.',
  'a caller cannot relabel a broadcast recipient as transactional'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001',
      '[{"email":"forced@local.test","provenance":"staff_entry","exclusionReason":"unsubscribed"}]'::jsonb
    )
  $$,
  '22023',
  'CSF audience recipient 1 may only be skipped for an invalid address, a duplicate, or ineligibility; consent is decided by the preference table.',
  'a caller cannot hand-write an unsubscribe exclusion around the preference table'
);

CREATE TEMP TABLE t_broadcast_snapshot AS
SELECT plugin_data.csf_snapshot_communication_recipients(
  'bd100000-0000-4000-8000-000000000001',
  'bd400000-0000-4000-8000-000000000001',
  '[
    {"email":"Rep.One@Local.Test","name":"Rep One","provenance":"representative_record",
     "responseContactEmail":"rep.one.form@local.test","preferredContactEmail":"Rep.One@Local.Test"},
    {"email":"subscribed@local.test","name":"Subscribed Member","provenance":"account_email"},
    {"email":"OptedOut@Local.Test","name":"Opted Out Adviser","provenance":"import_record"}
  ]'::jsonb
) AS result;

SELECT extensions.is(
  (SELECT result->>'recorded' FROM t_broadcast_snapshot),
  '3',
  'the broadcast audience records every candidate, included or not'
);
SELECT extensions.is(
  (SELECT result->>'included' FROM t_broadcast_snapshot),
  '2',
  'two broadcast recipients are included'
);
SELECT extensions.is(
  (SELECT result->>'excluded' FROM t_broadcast_snapshot),
  '1',
  'the opted-out broadcast recipient is excluded'
);

SELECT extensions.is(
  (
    SELECT subscription_decision || '|' || exclusion_reason || '|' || preference_decision
    FROM plugin_data.csf_communication_recipient_snapshots
    WHERE campaign_id = 'bd400000-0000-4000-8000-000000000001'
      AND normalized_recipient_email = 'optedout@local.test'
  ),
  'excluded|unsubscribed|suppressed_opt_out',
  'the broadcast opt-out is recorded as the reason the recipient was skipped'
);

SELECT extensions.is(
  (
    SELECT response_contact_hash IS DISTINCT FROM preferred_contact_hash
    FROM plugin_data.csf_communication_recipient_snapshots
    WHERE campaign_id = 'bd400000-0000-4000-8000-000000000001'
      AND normalized_recipient_email = 'rep.one@local.test'
  ),
  true,
  'a response address that differs from the preferred address stays provable as digests'
);

-- IDENTICAL REPLAY IS IDEMPOTENT.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001',
      '[{"email":"Rep.One@Local.Test","name":"Rep One","provenance":"representative_record",
         "responseContactEmail":"rep.one.form@local.test","preferredContactEmail":"Rep.One@Local.Test"}]'::jsonb
    )->>'alreadyRecorded'
  ),
  '1',
  'replaying a byte-identical audience row re-records nobody'
);

-- MATERIALLY DIFFERENT REPLAY IS A CONFLICT, NOT AN IDEMPOTENT RETRY.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001',
      '[{"email":"Rep.One@Local.Test","name":"Someone Else Entirely","provenance":"staff_entry"}]'::jsonb
    )
  $$,
  '23505',
  'CSF audience recipient 1 is already recorded for this campaign with a materially different snapshot; a finalized audience row is never rewritten.',
  'a replay that would change who was mailed, or why, is refused'
);

-- MANDATORY TRANSACTIONAL: the very address that opted out of broadcasts.
CREATE TEMP TABLE t_transactional_snapshot AS
SELECT plugin_data.csf_snapshot_communication_recipients(
  'bd100000-0000-4000-8000-000000000001',
  'bd400000-0000-4000-8000-000000000002',
  '[{"email":"OptedOut@Local.Test","name":"Opted Out Adviser","provenance":"account_email"}]'::jsonb
) AS result;

SELECT extensions.is(
  (SELECT result->>'included' FROM t_transactional_snapshot),
  '1',
  'a broadcast opt-out never suppresses mandatory transactional delivery'
);

SELECT extensions.is(
  (
    SELECT delivery_requirement || '|' || preference_decision
      || '|' || subscription_decision || '|' || coalesce(topic_key, 'no-topic')
    FROM plugin_data.csf_communication_recipient_snapshots
    WHERE campaign_id = 'bd400000-0000-4000-8000-000000000002'
      AND normalized_recipient_email = 'optedout@local.test'
  ),
  'transactional|mandatory_transactional|included|no-topic',
  'the transactional audience row records the mandatory decision and no topic'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_recipient_snapshots
    SET preference_decision = 'allowed'
    WHERE campaign_id = 'bd400000-0000-4000-8000-000000000001'
      AND normalized_recipient_email = 'optedout@local.test'
  $$,
  '23514',
  'CSF audience snapshot dispatch provenance is immutable; a send reads only what the snapshot froze.',
  'a recorded consent decision cannot be rewritten after the fact'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_recipient_snapshots
    SET recipient_email = 'rewritten@local.test'
    WHERE campaign_id = 'bd400000-0000-4000-8000-000000000001'
      AND normalized_recipient_email = 'rep.one@local.test'
  $$,
  '23514',
  'CSF audience snapshots are immutable after insert.',
  'an audience address cannot be rewritten after insert'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_recipient_snapshots (
      organization_id, campaign_id, snapshot_version, recipient_email,
      subscription_decision, exclusion_reason, delivery_requirement,
      preference_decision, preference_reason, preference_recorded_at,
      contact_provenance, content_hash, recipient_snapshot_hash
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'bd400000-0000-4000-8000-000000000002',
      1, 'suppressed.transactional@local.test', 'excluded', 'unsubscribed',
      'transactional', 'mandatory_transactional', 'forced', now(),
      'staff_entry', repeat('2', 64), repeat('d', 64)
    )
  $$,
  '23514',
  'new row for relation "csf_communication_recipient_snapshots" violates check constraint "csf_comm_snapshot_transactional_mandatory_check"',
  'a transactional recipient can never be excluded for unsubscribing'
);

-- ---------------------------------------------------------------------------
-- G. Finalization and the attempt ledger
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001',
      9
    )
  $$,
  '23514',
  'The CSF audience holds 2 included recipients, not the 9 the caller expected.',
  'finalization refuses an audience that is not the size the caller counted'
);

CREATE TEMP TABLE t_finalize AS
SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
  'bd100000-0000-4000-8000-000000000001',
  'bd400000-0000-4000-8000-000000000001',
  2
) AS result;

SELECT extensions.is(
  (SELECT result->>'deliveriesCreated' FROM t_finalize),
  '2',
  'finalization creates one delivery per included recipient and none for the excluded one'
);
SELECT extensions.is(
  (SELECT result->>'attemptsEnqueued' FROM t_finalize),
  '2',
  'finalization enqueues the first attempt for every delivery'
);

SELECT extensions.is(
  (
    SELECT status || '|' || (audience_finalized_at IS NOT NULL)::text
      || '|' || (dispatch_started_at IS NOT NULL)::text
    FROM plugin_data.csf_communication_campaigns
    WHERE id = 'bd400000-0000-4000-8000-000000000001'
  ),
  'queued|true|true',
  'a finalized campaign is queued with its audience closed and dispatch open'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001',
      '[{"email":"late.arrival@local.test","provenance":"staff_entry"}]'::jsonb
    )
  $$,
  '23514',
  'A CSF campaign audience may only be built while the campaign is a draft.',
  'no recipient can be added once dispatch has begun'
);

-- A FINALIZED AUDIENCE IS CLOSED AT THE TABLE, NOT ONLY IN THE RPC.
--
-- service_role holds SELECT and nothing else on this table, so it cannot reach
-- here at all -- but the OWNER can, and every SECURITY DEFINER RPC runs as the
-- owner. This suite runs as the owner too, which is what makes the statement
-- below a real test of the trigger rather than of a grant. A late direct row
-- would mail somebody the recorded audience does not contain and would
-- permanently break the digest a restart uses to prove it is resending the same
-- audience, so the guard has to hold against the one role that is not stopped by
-- the privilege boundary.
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_recipient_snapshots (
      organization_id, campaign_id, snapshot_version, recipient_email,
      subscription_decision, delivery_requirement, topic_key,
      preference_decision, preference_reason, preference_recorded_at,
      contact_provenance, content_hash, recipient_snapshot_hash
    )
    SELECT
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001', 1, 'smuggled.in@local.test',
      'included', 'broadcast', 'partner_clubs', 'no_preference_record',
      'no_recorded_broadcast_preference', now(), 'staff_entry',
      campaign.content_hash, repeat('5', 64)
    FROM plugin_data.csf_communication_campaigns AS campaign
    WHERE campaign.id = 'bd400000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'This CSF campaign audience is already finalized; a finalized audience never gains a recipient.',
  'a finalized audience refuses a direct snapshot insert, not just an RPC call'
);

-- IDEMPOTENT SNAPSHOT REPLAY IS PRESERVED for the identical PRE-finalized
-- contract: the guard above closes NEW rows only, and the byte-identical replay
-- asserted earlier in this section never reaches an insert at all.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_recipient_snapshots
    WHERE campaign_id = 'bd400000-0000-4000-8000-000000000001'
  ),
  3,
  'the finalized audience still holds exactly the three rows it was built with'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001'
    )->>'idempotentReplay'
  ),
  'true',
  'replaying finalization is a no-op that returns the recorded digest'
);

-- THE IDEMPOTENCY KEY IS BOUND TO THE COMPLETE REQUEST AND ITS COORDINATE.
SELECT extensions.is(
  (
    SELECT attempt.request_payload_hash
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
      AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
  ),
  (
    SELECT plugin_data.csf_communication_provider_request_hash(
      plugin_data.csf_communication_provider_request(
        attempt.organization_id, attempt.campaign_id,
        attempt.recipient_snapshot_id, attempt.id, attempt.attempt_number
      )
    )
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
      AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
  ),
  'the attempt request digest is the digest of the complete canonical provider request'
);

SELECT extensions.is(
  (
    SELECT attempt.provider_idempotency_key
      = plugin_data.csf_communication_idempotency_key(
          attempt.organization_id, attempt.campaign_id,
          attempt.recipient_snapshot_id, attempt.attempt_number,
          attempt.request_payload_hash
        )
      AND char_length(attempt.provider_idempotency_key) <= 256
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
      AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
  ),
  true,
  'the provider idempotency key is derived from organization, campaign, recipient, attempt, and payload digest, within the 256-character provider limit'
);

-- THE CANONICAL REQUEST CARRIES THE SIGNED ROUTING TAGS, IN SEND-API SHAPE.
--
-- An ARRAY of {name, value}, not the object Resend reports back on a webhook. The
-- builder used to store the webhook shape and hand it to a transport whose request
-- takes the array, so the stored digest described a document nobody transmitted.
-- Ordered by name, because jsonb sorts object keys but preserves array order.
SELECT extensions.is(
  (
    SELECT (
      plugin_data.csf_communication_provider_request(
        attempt.organization_id, attempt.campaign_id,
        attempt.recipient_snapshot_id, attempt.id, attempt.attempt_number
      )->'providerPayload'->'tags'
    )::text
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
      AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
  ),
  (
    SELECT jsonb_build_array(
      jsonb_build_object('name', 'csf_attempt_id', 'value', attempt.id::text),
      jsonb_build_object('name', 'csf_campaign_id', 'value', attempt.campaign_id::text),
      jsonb_build_object('name', 'csf_environment', 'value', 'local'),
      jsonb_build_object(
        'name', 'csf_organization_id', 'value', attempt.organization_id::text
      ),
      jsonb_build_object('name', 'csf_plugin', 'value', 'dvhs_csf'),
      jsonb_build_object('name', 'csf_topic_key', 'value', 'partner_clubs')
    )::text
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
      AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
  ),
  'the sendable payload carries the signed environment, plugin, organization, campaign, attempt, and topic tags as a name/value array'
);

-- THE PROVIDER TOPIC IS IN THE SENDABLE PAYLOAD AND THEREFORE IN THE DIGEST.
SELECT extensions.is(
  (
    SELECT
      (
        plugin_data.csf_communication_provider_request(
          attempt.organization_id, attempt.campaign_id,
          attempt.recipient_snapshot_id, attempt.id, attempt.attempt_number
        )->'providerPayload'->>'topicId'
      )
      || '|' || (
        plugin_data.csf_communication_provider_request(
          attempt.organization_id, attempt.campaign_id,
          attempt.recipient_snapshot_id, attempt.id, attempt.attempt_number
        )->'providerPayload'->>'type'
      )
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
      AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
  ),
  'topic_synthetic_partner_clubs|transactional',
  'a broadcast payload forwards the frozen chapter provider topic and the transport routing flag'
);

-- COORDINATE AND SENDABLE PAYLOAD ARE SEPARATE HALVES.
SELECT extensions.ok(
  (
    WITH built AS (
      SELECT plugin_data.csf_communication_provider_request(
        attempt.organization_id, attempt.campaign_id,
        attempt.recipient_snapshot_id, attempt.id, attempt.attempt_number
      ) AS request
      FROM plugin_data.csf_communication_dispatch_attempts AS attempt
      JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
        ON snapshot.id = attempt.recipient_snapshot_id
      WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
        AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
    )
    SELECT
      -- Internal identity is never in the transmitted half.
      (built.request ? 'coordinate')
      AND (built.request ? 'providerPayload')
      AND NOT (built.request->'providerPayload' ? 'coordinate')
      AND NOT (built.request->'providerPayload' ? 'recipientSnapshotHash')
      AND NOT (built.request->'providerPayload' ? 'contentHash')
      -- And the ledger's own coordinate is never mistaken for a sendable field.
      AND (built.request->'coordinate' ? 'recipientSnapshotHash')
      AND (built.request->'coordinate' ? 'attemptNumber')
    FROM built
  ),
  'the internal coordinate and the sendable provider payload are separate halves of the hashed request'
);

-- ANY CHANGE TO A TAG, A HEADER, OR A COORDINATE CHANGES THE DIGEST.
SELECT extensions.ok(
  (
    WITH attempt AS (
      SELECT dispatch.*
      FROM plugin_data.csf_communication_dispatch_attempts AS dispatch
      JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
        ON snapshot.id = dispatch.recipient_snapshot_id
      WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
        AND dispatch.campaign_id = 'bd400000-0000-4000-8000-000000000001'
      LIMIT 1
    ),
    baseline AS (
      SELECT
        attempt.id,
        plugin_data.csf_communication_provider_request(
          attempt.organization_id, attempt.campaign_id,
          attempt.recipient_snapshot_id, attempt.id, attempt.attempt_number
        ) AS request
      FROM attempt
    )
    SELECT
      -- dropping one routing tag from the sendable array
      plugin_data.csf_communication_provider_request_hash(
        jsonb_set(
          baseline.request,
          '{providerPayload,tags}',
          (
            SELECT coalesce(jsonb_agg(tag.value), '[]'::jsonb)
            FROM jsonb_array_elements(
              baseline.request->'providerPayload'->'tags'
            ) AS tag(value)
            WHERE tag.value->>'name' <> 'csf_attempt_id'
          )
        )
      ) <> plugin_data.csf_communication_provider_request_hash(baseline.request)
      -- editing one routing tag value
      AND plugin_data.csf_communication_provider_request_hash(
        jsonb_set(
          baseline.request,
          '{providerPayload,tags}',
          (
            SELECT coalesce(
              jsonb_agg(
                CASE
                  WHEN tag.value->>'name' = 'csf_topic_key'
                    THEN jsonb_build_object(
                      'name', 'csf_topic_key', 'value', 'term_bulletin'
                    )
                  ELSE tag.value
                END
                ORDER BY tag.value->>'name'
              ),
              '[]'::jsonb
            )
            FROM jsonb_array_elements(
              baseline.request->'providerPayload'->'tags'
            ) AS tag(value)
          )
        )
      ) <> plugin_data.csf_communication_provider_request_hash(baseline.request)
      -- REPOINTING THE PROVIDER TOPIC changes what the recipient can unsubscribe
      -- from, so it must change the digest the idempotency key was derived against.
      AND plugin_data.csf_communication_provider_request_hash(
        jsonb_set(
          baseline.request,
          '{providerPayload,topicId}',
          '"topic_synthetic_repointed"'::jsonb
        )
      ) <> plugin_data.csf_communication_provider_request_hash(baseline.request)
      -- adding one header
      AND plugin_data.csf_communication_provider_request_hash(
        jsonb_set(
          baseline.request,
          '{providerPayload,headers}',
          jsonb_build_object('X-Injected', '1')
        )
      ) <> plugin_data.csf_communication_provider_request_hash(baseline.request)
      -- flipping the transport routing flag, which would let an unrelated
      -- preference table silently drop an authorized send
      AND plugin_data.csf_communication_provider_request_hash(
        jsonb_set(baseline.request, '{providerPayload,type}', '"general"'::jsonb)
      ) <> plugin_data.csf_communication_provider_request_hash(baseline.request)
      -- changing the attempt coordinate
      AND plugin_data.csf_communication_provider_request_hash(
        jsonb_set(
          baseline.request, '{coordinate,attemptNumber}', '2'::jsonb
        )
      ) <> plugin_data.csf_communication_provider_request_hash(baseline.request)
    FROM baseline
  ),
  'the payload digest changes if any tag, topic, header, transport flag, or attempt coordinate changes'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET subject = 'Rewritten after keys were allocated'
    WHERE id = 'bd400000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'CSF campaign content cannot change after a provider idempotency key has been allocated against it.',
  'campaign content is frozen once a provider idempotency key exists'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET body_text = 'Rewritten body.'
    WHERE id = 'bd400000-0000-4000-8000-000000000002'
  $$,
  '23514',
  'CSF campaign sender identity, subject, and body are frozen once the campaign content is finalized.',
  'campaign content is frozen from the moment its content is explicitly finalized'
);

-- SAME COPY, SAME ADDRESS, DIFFERENT CAMPAIGN, DIFFERENT KEY.
--
-- bd400000-...0010 carries a byte-identical body, subject, sender, reply-to, and
-- topic to bd400000-...0001 and addresses the same adviser. The previous request
-- digest covered only that content, so both campaigns derived the SAME
-- idempotency key -- and Resend, honoring its own key, would have silently dropped
-- the second semester's send as a duplicate of the first.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000010',
      '[{"email":"Rep.One@Local.Test","name":"Rep One","provenance":"representative_record",
         "responseContactEmail":"rep.one.form@local.test","preferredContactEmail":"Rep.One@Local.Test"}]'::jsonb
    )
  $$,
  'the same adviser can be addressed again by a later campaign with the same approved copy'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000010', 1
    )->>'attemptsEnqueued'
  ),
  '1',
  'the second campaign with identical copy enqueues its own attempt'
);

SELECT extensions.is(
  (
    SELECT count(DISTINCT attempt.content_hash)::integer
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
      AND attempt.campaign_id IN (
        'bd400000-0000-4000-8000-000000000001',
        'bd400000-0000-4000-8000-000000000010'
      )
  ),
  1,
  'the two campaigns really do share one identical content digest'
);

SELECT extensions.is(
  (
    SELECT count(DISTINCT attempt.provider_idempotency_key)::integer
      || '|' || count(DISTINCT attempt.request_payload_hash)::integer
      || '|' || count(*)::integer
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
      AND attempt.campaign_id IN (
        'bd400000-0000-4000-8000-000000000001',
        'bd400000-0000-4000-8000-000000000010'
      )
  ),
  '2|2|2',
  'identical copy to the same address in two campaigns still allocates two distinct keys and two distinct payload digests'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_dispatch_attempts
    SET request_payload_hash = repeat('9', 64)
    WHERE campaign_id = 'bd400000-0000-4000-8000-000000000001'
      AND attempt_number = 1
  $$,
  '23514',
  'A CSF dispatch attempt identity, provider idempotency key, and bound request digest are frozen once the key is allocated.',
  'an allocated key can never be re-bound to a different request'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_dispatch_attempts (
      organization_id, campaign_id, recipient_snapshot_id, delivery_id,
      attempt_number, provider_idempotency_key, content_hash,
      request_payload_hash, recipient_email_hash
    )
    SELECT
      attempt.organization_id, attempt.campaign_id, attempt.recipient_snapshot_id,
      attempt.delivery_id, 1, NULL, attempt.content_hash,
      attempt.request_payload_hash, attempt.recipient_email_hash
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
    LIMIT 1
  $$,
  '23514',
  'A CSF recipient already has a live dispatch attempt; settle it before enqueuing another.',
  'a second live attempt for one recipient is refused'
);

-- ---------------------------------------------------------------------------
-- H. Bounded, leased, campaign-gated, consent-rechecked claiming
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001', 'worker-1', 0, 120
    )
  $$,
  '22023',
  'A CSF dispatch claim takes between 1 and 100 attempts.',
  'a claim batch size of zero is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001', 'worker-1', 101, 120
    )
  $$,
  '22023',
  'A CSF dispatch claim takes between 1 and 100 attempts.',
  'an unbounded claim batch is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001', 'worker-1', 10, 5
    )
  $$,
  '22023',
  'A CSF dispatch lease lasts between 30 and 1800 seconds.',
  'a lease shorter than the supported floor is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001', '   ', 10, 120
    )
  $$,
  '22023',
  'A CSF dispatch claim requires a worker identity of at most 128 characters.',
  'an anonymous worker cannot hold a lease'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000002',
      'bd400000-0000-4000-8000-000000000001', 'worker-1', 10, 120
    )
  $$,
  '23503',
  'That CSF campaign does not exist in this organization.',
  'a worker cannot claim another organization campaign'
);

CREATE TEMP TABLE t_claim AS
SELECT plugin_data.csf_claim_communication_dispatch_batch(
  'bd100000-0000-4000-8000-000000000001',
  'bd400000-0000-4000-8000-000000000001', 'worker-1', 1, 120
) AS result;

SELECT extensions.is(
  (SELECT result->>'claimedCount' FROM t_claim),
  '1',
  'a claim takes exactly the bounded batch it asked for and no more'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_dispatch_attempts
    WHERE campaign_id = 'bd400000-0000-4000-8000-000000000001'
      AND state = 'processing'
      AND lease_owner = 'worker-1'
      AND lease_expires_at > now()
      AND lease_count = 1
  ),
  1,
  'the claimed attempt holds a lease with a real expiry'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_communication_campaigns
    WHERE id = 'bd400000-0000-4000-8000-000000000001'
  ),
  'sending',
  'a campaign with work in flight advances to sending'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000001', 'worker-1', 25, 120
    )->>'claimedCount'
  ),
  '1',
  'the second claim drains the queue'
);

-- OPT-OUT AFTER SNAPSHOT, BEFORE CLAIM.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000006',
      '[{"email":"lateoptout@local.test","name":"Late Opt Out","provenance":"import_record"}]'::jsonb
    )
  $$,
  'an address with no recorded preference is snapshotted as includable'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000006', 1
    )->>'attemptsEnqueued'
  ),
  '1',
  'the late-opt-out campaign enqueues its single recipient'
);

-- The recipient changes their mind after the audience was frozen.
INSERT INTO plugin_data.csf_communication_broadcast_preferences (
  organization_id, topic_key, recipient_email, subscription_state,
  opt_out_source, opt_out_at
) VALUES (
  'bd100000-0000-4000-8000-000000000001', 'partner_clubs',
  'lateoptout@local.test', 'unsubscribed', 'recipient_unsubscribe_link', now()
);

CREATE TEMP TABLE t_late_optout_claim AS
SELECT plugin_data.csf_claim_communication_dispatch_batch(
  'bd100000-0000-4000-8000-000000000001',
  'bd400000-0000-4000-8000-000000000006', 'worker-3', 25, 120
) AS result;

SELECT extensions.is(
  (SELECT result->>'claimedCount' FROM t_late_optout_claim),
  '0',
  'a recipient who opted out after the snapshot is never handed to a worker'
);
SELECT extensions.is(
  (SELECT result->>'suppressedAtClaim' FROM t_late_optout_claim),
  '1',
  'the claim path reports the late opt-out it suppressed'
);

SELECT extensions.is(
  (
    SELECT attempt.state
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000006'
  ),
  'suppressed',
  'the late opt-out settles the attempt as suppressed inside the claim transaction'
);

SELECT extensions.is(
  (
    SELECT delivery.status || '|' || (delivery.terminal_locked_at IS NOT NULL)::text
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'bd400000-0000-4000-8000-000000000006'
  ),
  'suppressed|true',
  'the late opt-out terminally locks the delivery'
);

-- Transactional delivery is untouched by any of this.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000002', 1
    )->>'attemptsEnqueued'
  ),
  '1',
  'the transactional campaign enqueues its one mandatory recipient'
);

-- A TRANSACTIONAL PAYLOAD CARRIES NO TOPIC AT ALL.
--
-- This assertion belongs after the transactional audience is finalized and its
-- attempt exists. Before that, the scalar subquery returned NULL and the test was
-- checking fixture order rather than the request contract.
-- Not `null`: the key is ABSENT. A present-but-null topicId would reach the provider
-- as topic_id and offer an unsubscribe from mail the chapter is obliged to send.
SELECT extensions.ok(
  (
    SELECT NOT (
      plugin_data.csf_communication_provider_request(
        attempt.organization_id, attempt.campaign_id,
        attempt.recipient_snapshot_id, attempt.id, attempt.attempt_number
      )->'providerPayload' ? 'topicId'
    )
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000002'
    LIMIT 1
  ),
  'a transactional payload omits topicId entirely rather than sending a null topic'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000002', 'worker-2', 25, 120
    )->>'claimedCount'
  ),
  '1',
  'a transactional attempt for an opted-out address is still claimable'
);

-- ---------------------------------------------------------------------------
-- H2. A LEASE IS NOT AUTHORIZATION TO SEND
--
-- A lease may last 1800 seconds. Inside that half hour a recipient can click an
-- unsubscribe link or the provider can report their address dead, and a claim-time
-- check cannot know about either. So the claim result is deliberately not a
-- sendable payload, and the exact request is handed over only by a separate call
-- made immediately before the worker talks to the provider.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT result->>'claimAuthorizesSend' FROM t_claim),
  'false',
  'the claim result states outright that it does not authorize a send'
);

SELECT extensions.ok(
  (
    SELECT (result->'claims')::text !~* '(subject|body|"to"|"from"|"tags")'
    FROM t_claim
  ),
  'a claim hands back attempt coordinates and no part of the message itself'
);

CREATE TEMP TABLE t_authorize AS
SELECT plugin_data.csf_authorize_communication_dispatch(
  'bd100000-0000-4000-8000-000000000001',
  (
    SELECT attempt.id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
      AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
    LIMIT 1
  ),
  'worker-1',
  'corr-dispatch-1'
) AS result;

SELECT extensions.is(
  (SELECT result->>'authorized' FROM t_authorize),
  'true',
  'a live leaseholder whose recipient is still consenting and safe is authorized'
);

-- THE WORKER IS GIVEN THE EXACT PAYLOAD WHOSE HASH IS STORED.
SELECT extensions.is(
  (SELECT result->>'requestPayloadHash' FROM t_authorize),
  (
    SELECT attempt.request_payload_hash
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
      AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
  ),
  'dispatch authorization returns the digest the ledger already stored for this attempt'
);

-- THE AUTHORIZED PAYLOAD MUST HASH TO THE STORED DIGEST.
--
-- Rebuilt from the two halves the authorization returns, minus the idempotency key
-- the authorization merges in afterwards. The key is DERIVED from the digest, so
-- including it in the hashed document would be circular -- but everything else the
-- worker transmits is covered, which is what makes a silently added or omitted tag
-- detectable rather than merely discouraged.
SELECT extensions.ok(
  (
    SELECT plugin_data.csf_communication_provider_request_hash(
      jsonb_build_object(
        'v', 3,
        'coordinate', result->'coordinate',
        'providerPayload', (result->'providerPayload') - 'idempotencyKey'
      )
    ) = (result->>'requestPayloadHash')
    FROM t_authorize
  ),
  'the payload handed to the worker hashes to the digest the ledger stored, so a silently added or omitted tag is detectable'
);

SELECT extensions.is(
  (
    SELECT (
      SELECT tag.value->>'value'
      FROM jsonb_array_elements(result->'providerPayload'->'tags') AS tag(value)
      WHERE tag.value->>'name' = 'csf_attempt_id'
    )
      || '|' || (
        SELECT tag.value->>'value'
        FROM jsonb_array_elements(result->'providerPayload'->'tags') AS tag(value)
        WHERE tag.value->>'name' = 'csf_plugin'
      )
      || '|' || (result->>'providerIdempotencyKey' IS NOT NULL)::text
      -- The key the ledger allocated must be the key that is actually transmitted.
      || '|' || (
        (result->'providerPayload'->>'idempotencyKey')
          = (result->>'providerIdempotencyKey')
      )::text
    FROM t_authorize
  ),
  (
    SELECT attempt.id::text || '|dvhs_csf|true|true'
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
      AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
  ),
  'the authorized payload carries the signed attempt routing tag and transmits the allocated provider key'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_authorize_communication_dispatch(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
          AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
        LIMIT 1
      ),
      'worker-9'
    )
  $$,
  '23514',
  'This CSF dispatch attempt is leased to another worker; a stale worker may not be authorized to send it.',
  'a worker that does not hold the lease is never authorized to send'
);

-- OPT-OUT AFTER THE CLAIM BUT BEFORE THE DISPATCH.
--
-- This is the case a claim-time check cannot catch, and it is why the claim result
-- must not be a send-authorizing payload.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000007',
      '[{"email":"midlease@local.test","name":"Mid Lease","provenance":"staff_entry"}]'::jsonb
    )
  $$,
  'the mid-lease campaign snapshots a consenting recipient'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000007', 1
    )->>'attemptsEnqueued'
  ),
  '1',
  'the mid-lease campaign enqueues its single recipient'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000007', 'worker-7', 25, 1800
    )->>'claimedCount'
  ),
  '1',
  'the mid-lease recipient is claimed while still consenting, under a long lease'
);

-- The recipient clicks unsubscribe while the worker still holds the lease.
INSERT INTO plugin_data.csf_communication_broadcast_preferences (
  organization_id, topic_key, recipient_email, subscription_state,
  opt_out_source, opt_out_at, decision_actor_kind, decision_actor_identity
) VALUES (
  'bd100000-0000-4000-8000-000000000001', 'partner_clubs',
  'midlease@local.test', 'unsubscribed', 'recipient_unsubscribe_link', now(),
  'recipient', 'unsubscribe-link'
);

CREATE TEMP TABLE t_authorize_optout AS
SELECT plugin_data.csf_authorize_communication_dispatch(
  'bd100000-0000-4000-8000-000000000001',
  (
    SELECT attempt.id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000007'
    LIMIT 1
  ),
  'worker-7'
) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'authorized') || '|' || (result->>'blockedBy')
      || '|' || (result->>'attemptState')
    FROM t_authorize_optout
  ),
  'false|broadcast_consent|suppressed',
  'an opt-out recorded after the claim but before the dispatch blocks the broadcast'
);

SELECT extensions.is(
  (
    SELECT result->'providerPayload' = 'null'::jsonb
      AND result->'coordinate' = 'null'::jsonb
    FROM t_authorize_optout
  ),
  true,
  'a refused authorization hands back no payload at all'
);

SELECT extensions.is(
  (
    SELECT delivery.status || '|' || (delivery.terminal_locked_at IS NOT NULL)::text
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'bd400000-0000-4000-8000-000000000007'
  ),
  'suppressed|true',
  'the mid-lease opt-out settles the delivery instead of leaving it open'
);

-- ---------------------------------------------------------------------------
-- I. Settlement
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
          AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
        LIMIT 1
      ),
      'worker-9', 'accepted', 'resend-message-a'
    )
  $$,
  '23514',
  'This CSF dispatch attempt is leased to another worker; a stale worker may not settle it.',
  'a worker that does not hold the lease cannot settle the attempt'
);

-- A PROVIDER ACCEPTANCE IMPLIES THE LEDGER HANDED OVER A REQUEST.
--
-- subscribed@local.test was claimed but never authorized, so it cannot claim the
-- provider accepted a payload the ledger never issued.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
        LIMIT 1
      ),
      'worker-1', 'accepted', 'resend-message-unauthorized'
    )
  $$,
  '23514',
  'This CSF dispatch attempt was never authorized for dispatch, so it cannot report a provider acceptance; authorize it through plugin_data.csf_authorize_communication_dispatch() before sending.',
  'an unauthorized attempt cannot report a provider acceptance'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000002',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
          AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
        LIMIT 1
      ),
      'worker-1', 'accepted', 'resend-message-a'
    )
  $$,
  '23503',
  'That CSF dispatch attempt does not exist in this organization.',
  'a settlement cannot cross an organization boundary'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
          AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
        LIMIT 1
      ),
      'worker-1', 'accepted', NULL
    )
  $$,
  '23514',
  'An accepted CSF dispatch attempt must record the provider message identity it was accepted as.',
  'an accepted send must record the provider message it became'
);

-- A PROVIDER MESSAGE IDENTITY MEANS THE SEND WAS ACCEPTED. Never retryable.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
          AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
        LIMIT 1
      ),
      'worker-1', 'retryable_failure', 'resend-message-would-duplicate'
    )
  $$,
  '23514',
  'A CSF dispatch response that carries a provider message identity was accepted and can never be auto-retried; settle it as accepted or as unknown_outcome.',
  'a response with a provider message identity can never be scheduled for a retry'
);

CREATE TEMP TABLE t_settle_accepted AS
SELECT plugin_data.csf_settle_communication_dispatch_attempt(
  'bd100000-0000-4000-8000-000000000001',
  (
    SELECT attempt.id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
      AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
    LIMIT 1
  ),
  'worker-1', 'accepted', 'resend-message-a'
) AS result;

SELECT extensions.is(
  (SELECT result->>'deliveryStatus' FROM t_settle_accepted),
  'sent',
  'an accepted attempt advances its delivery to sent'
);

-- IDENTICAL REPLAY IS IDEMPOTENT; A DIFFERENT PROVIDER RESPONSE IS NOT.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
          AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
        LIMIT 1
      ),
      'worker-1', 'accepted', 'resend-message-a'
    )->>'idempotentReplay'
  ),
  'true',
  'replaying the identical settlement is idempotent'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
          AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
        LIMIT 1
      ),
      'worker-1', 'accepted', 'resend-message-a-different'
    )
  $$,
  '23514',
  'That CSF dispatch attempt already settled as "accepted" with different provider evidence and cannot be re-settled as "accepted".',
  'a replay carrying different provider evidence is a conflict, not an idempotent retry'
);

-- ---------------------------------------------------------------------------
-- I2. AN EXPIRED LEASE IS AN UNKNOWN OUTCOME, NOT A RETRY
--
-- REWRITTEN. This suite previously asserted that the next sweep RECLAIMED a lapsed
-- lease back to 'queued', and that expectation blessed a duplicate-send generator:
-- a worker can write the exact request to Resend and be killed before it commits a
-- settlement, and from the ledger's side that is indistinguishable from dying
-- before it opened the socket. Requeueing therefore re-sends an unknown number of
-- already-accepted messages to real people, and Resend's own idempotency key is
-- remembered for only 24 hours so it will not deduplicate a later retry either.
--
-- The lease is aged directly, which is the one thing a test can do that a clock
-- cannot.
-- ---------------------------------------------------------------------------

UPDATE plugin_data.csf_communication_dispatch_attempts AS attempt
SET leased_at = now() - interval '30 minutes',
    lease_expires_at = now() - interval '20 minutes'
FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
WHERE snapshot.id = attempt.recipient_snapshot_id
  AND snapshot.normalized_recipient_email = 'optedout@local.test'
  AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000002';

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000002'
        LIMIT 1
      ),
      'worker-2', 'accepted', 'resend-message-expired'
    )
  $$,
  '23514',
  'This CSF dispatch lease has expired; the attempt may already have been reclaimed and cannot be settled by the lapsed holder.',
  'a lapsed lease holder cannot settle an attempt that may already have been reclaimed'
);

-- THE TABLE ITSELF REFUSES THE REQUEUE, not merely the reaper.
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_dispatch_attempts AS attempt
    SET state = 'queued', lease_owner = NULL, leased_at = NULL,
        lease_expires_at = NULL, available_at = now()
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000002'
      AND attempt.state = 'processing'
  $$,
  '23514',
  'A CSF dispatch attempt never returns to the queue; a leaseholder may already have handed the request to the provider, so a lapsed lease settles as unknown_outcome instead.',
  'even a direct update cannot return a lapsed attempt to the queue'
);

CREATE TEMP TABLE t_expired_sweep AS
SELECT plugin_data.csf_claim_communication_dispatch_batch(
  'bd100000-0000-4000-8000-000000000001',
  'bd400000-0000-4000-8000-000000000002', 'worker-4', 25, 120
) AS result;

SELECT extensions.is(
  (SELECT result->>'unknownOutcomeExpiredLeases' FROM t_expired_sweep),
  '1',
  'the lapsed lease is settled as an unknown outcome by the next sweep'
);

-- NO CLAIM. The whole point: the sweep produces nothing a worker can send.
SELECT extensions.is(
  (SELECT result->>'claimedCount' FROM t_expired_sweep),
  '0',
  'a lapsed lease yields no claimable work, so nobody is mailed a second time'
);

SELECT extensions.is(
  (
    SELECT attempt.state || '|' || attempt.review_state
      || '|' || (attempt.unknown_reason IS NOT NULL)::text
      || '|' || (attempt.settled_at IS NOT NULL)::text
      || '|' || (attempt.lease_owner IS NULL)::text
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000002'
  ),
  'unknown_outcome|pending|true|true|true',
  'the lapsed attempt is settled unretryably with a recorded reason and a pending review'
);

-- NO SUCCESSOR ATTEMPT. There is exactly one attempt for that recipient, and the
-- enqueue guard refuses to open another behind an unknown outcome.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000002'
  ),
  1,
  'a lapsed lease creates no successor attempt'
);

SELECT extensions.is(
  (
    SELECT (delivery.unknown_outcome_at IS NOT NULL)::text
      || '|' || delivery.review_state
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'bd400000-0000-4000-8000-000000000002'
  ),
  'true|pending',
  'the delivery carries an unknown-outcome marker and a review flag'
);

SELECT extensions.is(
  (
    SELECT (review_blocked_at IS NOT NULL)::text || '|' || status
    FROM plugin_data.csf_communication_campaigns
    WHERE id = 'bd400000-0000-4000-8000-000000000002'
  ),
  'true|sending',
  'the campaign becomes visibly review-blocked and stays nonterminal'
);

-- UNKNOWN OUTCOME on the second broadcast recipient.
CREATE TEMP TABLE t_settle_unknown AS
SELECT plugin_data.csf_settle_communication_dispatch_attempt(
  'bd100000-0000-4000-8000-000000000001',
  (
    SELECT attempt.id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
    LIMIT 1
  ),
  'worker-1', 'unknown_outcome', NULL, NULL, 'timeout',
  'Connection reset after the request was written.'
) AS result;

SELECT extensions.is(
  (SELECT result->>'retryEnqueued' FROM t_settle_unknown),
  'false',
  'an unknown provider outcome never enqueues a retry'
);

SELECT extensions.is(
  (
    SELECT attempt.state || '|' || attempt.review_state
      || '|' || (attempt.unknown_reason IS NOT NULL)::text
      || '|' || (attempt.settled_at IS NOT NULL)::text
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
  ),
  'unknown_outcome|pending|true|true',
  'the unknown attempt is settled, reasoned, and queued for review'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_dispatch_attempts (
      organization_id, campaign_id, recipient_snapshot_id, delivery_id,
      attempt_number, provider_idempotency_key, content_hash,
      request_payload_hash, recipient_email_hash
    )
    SELECT
      attempt.organization_id, attempt.campaign_id, attempt.recipient_snapshot_id,
      attempt.delivery_id, 2, NULL, attempt.content_hash,
      attempt.request_payload_hash, attempt.recipient_email_hash
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
  $$,
  '23514',
  'A CSF dispatch attempt with an unknown provider outcome can never be retried; reconcile it or resolve it through human review.',
  'an unknown outcome can never be followed by a blind retry'
);

-- DIRECT MUTATION IS DENIED. Not "the RPC refuses" -- the table refuses.
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_dispatch_attempts AS attempt
    SET state = 'delivered'
    FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
    WHERE snapshot.id = attempt.recipient_snapshot_id
      AND snapshot.normalized_recipient_email = 'subscribed@local.test'
  $$,
  '23514',
  'Leaving a CSF unknown provider outcome requires a recorded resolution, actor, reason, and matching final state.',
  'an operator cannot resolve an unknown outcome with a bare UPDATE and no evidence'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_dispatch_attempts AS attempt
    SET review_state = 'none'
    FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
    WHERE snapshot.id = attempt.recipient_snapshot_id
      AND snapshot.normalized_recipient_email = 'subscribed@local.test'
  $$,
  '23514',
  'CSF dispatch review state is monotonic; it never returns to an earlier stage.',
  'a review flag cannot be cleared while an unknown outcome marker exists'
);

-- ---------------------------------------------------------------------------
-- J. Unknown-outcome reconciliation
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_reconcile_communication_unknown_outcome(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
        LIMIT 1
      ),
      'retry', 'Operator wants another try.', NULL,
      'bd000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'A CSF dispatch attempt with an unknown provider outcome can never be retried; resolve it as delivered, bounced, complained, suppressed, failed, or human_review.',
  'reconciliation rejects every retry-shaped resolution by name, and names the legal ones'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_reconcile_communication_unknown_outcome(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
        LIMIT 1
      ),
      'failed', 'No actor supplied.', NULL, NULL
    )
  $$,
  '22004',
  'A CSF unknown-outcome reconciliation must record the account that decided it.',
  'a reconciliation with no named actor is refused'
);

-- THE ACTOR IS AUTHORIZATION, NOT DECORATION.
--
-- Proving the account merely exists would let any signed-in user declare another
-- chapter's ambiguous send delivered. bd000000-...0002 is a real, confirmed account
-- with no membership anywhere.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_reconcile_communication_unknown_outcome(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
        LIMIT 1
      ),
      'failed', 'An account that merely exists.', NULL,
      'bd000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  'That account does not hold the CSF staff capability required to reconcile an unknown dispatch outcome in this organization.',
  'an account that exists but holds no CSF staff capability cannot reconcile an unknown outcome'
);

-- CROSS-TENANT. bd000000-...0003 is a real officer -- of the OTHER organization.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_reconcile_communication_unknown_outcome(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
        LIMIT 1
      ),
      'failed', 'An officer of another chapter.', NULL,
      'bd000000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  'That account does not hold the CSF staff capability required to reconcile an unknown dispatch outcome in this organization.',
  'an officer of another organization cannot reconcile this organization unknown outcome'
);

-- HUMAN REVIEW FIRST. Non-final: the attempt stays unknown and unretryable.
CREATE TEMP TABLE t_escalate AS
SELECT plugin_data.csf_reconcile_communication_unknown_outcome(
  'bd100000-0000-4000-8000-000000000001',
  (
    SELECT attempt.id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
    LIMIT 1
  ),
  'human_review', 'Provider logs are inconclusive; escalating.', NULL,
  'bd000000-0000-4000-8000-000000000001'
) AS result;

SELECT extensions.is(
  (SELECT result->>'attemptState' FROM t_escalate),
  'unknown_outcome',
  'escalating to human review leaves the outcome unknown rather than inventing one'
);

SELECT extensions.is(
  (
    SELECT attempt.review_state || '|' || (attempt.escalated_at IS NOT NULL)::text
      || '|' || attempt.escalated_by::text
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
  ),
  'escalated|true|bd000000-0000-4000-8000-000000000001',
  'escalation persists its own actor and timestamp'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_reconcile_communication_unknown_outcome(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
        LIMIT 1
      ),
      'human_review', 'Provider logs are inconclusive; escalating.', NULL,
      'bd000000-0000-4000-8000-000000000001'
    )->>'idempotentReplay'
  ),
  'true',
  'replaying the same escalation is idempotent'
);

-- EXACTLY ONE LATER FINAL RESOLUTION IS STILL ALLOWED.
CREATE TEMP TABLE t_reconcile AS
SELECT plugin_data.csf_reconcile_communication_unknown_outcome(
  'bd100000-0000-4000-8000-000000000001',
  (
    SELECT attempt.id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
    LIMIT 1
  ),
  'delivered', 'Provider support confirmed delivery out of band.', NULL,
  'bd000000-0000-4000-8000-000000000001'
) AS result;

SELECT extensions.is(
  (SELECT result->>'deliveryReduced' FROM t_reconcile),
  'true',
  'an escalated unknown outcome can still be finally resolved exactly once'
);

-- THE DELIVERY WALKS LEGAL INTERMEDIATE STATES rather than being left queued.
SELECT extensions.is(
  (
    SELECT delivery.status || '|' || (delivery.sent_at IS NOT NULL)::text
      || '|' || (delivery.delivered_at IS NOT NULL)::text
      || '|' || delivery.review_state
    FROM plugin_data.csf_communication_deliveries AS delivery
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = delivery.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
  ),
  'delivered|true|true|resolved',
  'the reconciled delivery walks queued to sent to delivered instead of staying queued'
);

SELECT extensions.is(
  (
    SELECT attempt.state || '|' || attempt.reconciled_outcome
      || '|' || attempt.reconciled_by::text
      || '|' || attempt.reconciliation_reason
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
  ),
  'delivered|delivered|bd000000-0000-4000-8000-000000000001|Provider support confirmed delivery out of band.',
  'the final resolution persists outcome, actor, and reason immutably'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_reconcile_communication_unknown_outcome(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
        LIMIT 1
      ),
      'delivered', 'Provider support confirmed delivery out of band.', NULL,
      'bd000000-0000-4000-8000-000000000001'
    )->>'idempotentReplay'
  ),
  'true',
  'replaying the identical final resolution is idempotent'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_reconcile_communication_unknown_outcome(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE snapshot.normalized_recipient_email = 'subscribed@local.test'
        LIMIT 1
      ),
      'bounced', 'Actually it bounced.', NULL,
      'bd000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'That CSF unknown outcome was already reconciled as "delivered" with different evidence -- outcome, reason, deciding account, correlation, or provider message identity -- and is not reconciled twice.',
  'a conflicting reconciliation replay is refused'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_dispatch_attempts AS attempt
    SET reconciliation_reason = 'rewritten history'
    FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
    WHERE snapshot.id = attempt.recipient_snapshot_id
      AND snapshot.normalized_recipient_email = 'subscribed@local.test'
  $$,
  '23514',
  'CSF dispatch reconciliation evidence is recorded once and never rewritten.',
  'recorded reconciliation evidence cannot be rewritten by a direct update'
);

-- ---------------------------------------------------------------------------
-- K. Verified provider webhooks
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_unverified_0001',
      'email.delivered', 'resend-message-a', now(), repeat('e', 64), false
    )
  $$,
  '23514',
  'CSF provider webhook events are only recorded after the application verifies the signature over the exact raw request body; the database does not verify signatures.',
  'the database refuses any webhook the application has not verified'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_badhash_0001',
      'email.delivered', 'resend-message-a', now(), 'not-a-sha256', true
    )
  $$,
  '22023',
  'A CSF provider event requires the SHA-256 of the exact verified raw request body.',
  'a webhook without the verified raw-body digest is refused'
);

-- METADATA BOUNDS.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_badmeta_0001',
      'email.delivered', 'resend-message-a', now(), repeat('e', 64), true,
      'svix', NULL, '{"subject":"Spring 2032 partner club audit"}'::jsonb
    )
  $$,
  '22023',
  'CSF provider event metadata may hold only allowlisted, scalar, bounded operational fields.',
  'a webhook cannot smuggle message content past the operational allowlist'
);

SELECT extensions.ok(
  NOT plugin_data.csf_provider_event_metadata_allowlisted(
    pg_catalog.jsonb_build_object('tags', repeat('t', 5000))
  ),
  'metadata is bounded by total encoded size'
);

SELECT extensions.ok(
  NOT plugin_data.csf_provider_event_metadata_allowlisted(
    pg_catalog.jsonb_build_object('emailId', repeat('e', 300))
  ),
  'metadata is bounded by string length'
);

SELECT extensions.ok(
  NOT plugin_data.csf_provider_event_metadata_allowlisted(
    pg_catalog.jsonb_build_object('smtpCode', 99999999999999::numeric)
  ),
  'metadata is bounded by numeric magnitude'
);

SELECT extensions.ok(
  NOT plugin_data.csf_provider_event_metadata_allowlisted(
    pg_catalog.jsonb_build_object(
      'tags',
      (SELECT pg_catalog.jsonb_agg(entry) FROM generate_series(1, 40) AS entry)
    )
  ),
  'metadata is bounded by array length'
);

SELECT extensions.ok(
  plugin_data.csf_provider_event_metadata_allowlisted(
    '{"smtpCode":550,"bounceType":"Permanent","tags":["a","b"]}'::jsonb
  ),
  'ordinary allowlisted operational metadata is accepted'
);

-- NO PROVIDER TIME, NO AUTHORITY.
CREATE TEMP TABLE t_no_time AS
SELECT plugin_data.csf_record_communication_provider_event(
  'bd100000-0000-4000-8000-000000000001', 'evt_notime_0001',
  'email.delivered', 'resend-message-a', NULL, repeat('1', 64), true
) AS result;

SELECT extensions.is(
  (SELECT result->>'processingState' FROM t_no_time),
  'ignored_no_provider_time',
  'a webhook with no provider occurrence time is retained but never authoritative'
);
SELECT extensions.is(
  (SELECT result->>'reductionApplied' FROM t_no_time),
  'false',
  'a timeless webhook applies no reduction'
);
SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_communication_deliveries
    WHERE provider_message_id = 'resend-message-a'
  ),
  'sent',
  'the delivery is unchanged by a timeless webhook'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_provider_events
    WHERE provider_event_id = 'evt_notime_0001'
      AND provider_occurred_at IS NULL
  ),
  1,
  'the timeless event is still retained as evidence with a null provider time'
);

-- OUT-OF-ORDER SAFETY SIGNAL. Bounce arrives with a LATER time first.
CREATE TEMP TABLE t_bounce AS
SELECT plugin_data.csf_record_communication_provider_event(
  'bd100000-0000-4000-8000-000000000001', 'evt_bounce_0001',
  'email.bounced', 'resend-message-a', now() + interval '10 minutes',
  repeat('e', 64), true, 'svix', 'whsec_test_key',
  '{"smtpCode":550,"bounceType":"Permanent"}'::jsonb
) AS result;

SELECT extensions.is(
  (SELECT result->>'processingState' FROM t_bounce),
  'reduced',
  'a bounce for a sent delivery reduces it'
);

SELECT extensions.is(
  (
    SELECT delivery.status || '|' || (delivery.terminal_locked_at IS NOT NULL)::text
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.provider_message_id = 'resend-message-a'
  ),
  'bounced|true',
  'the bounce locks the delivery in a terminal safety state'
);

-- ONE PRIMITIVE BINDS AND ADVANCES EVERYTHING. The bounce did not merely move the
-- delivery: it advanced the accepted ATTEMPT to the evidence-backed outcome and
-- bound itself to that attempt, so the per-try ledger and the provider's own
-- account of the send agree.
SELECT extensions.is(
  (
    SELECT attempt.state
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE snapshot.normalized_recipient_email = 'rep.one@local.test'
      AND attempt.campaign_id = 'bd400000-0000-4000-8000-000000000001'
  ),
  'bounced',
  'verified provider evidence advances the accepted attempt to the outcome it reports'
);

SELECT extensions.is(
  (
    SELECT event.attempt_id IS NOT NULL AND event.delivery_id IS NOT NULL
    FROM plugin_data.csf_communication_provider_events AS event
    WHERE event.provider_event_id = 'evt_bounce_0001'
  ),
  true,
  'the reducing event binds both the delivery and the dispatch attempt it describes'
);

-- ---------------------------------------------------------------------------
-- K2. PROVIDER SAFETY IS NOT CONSENT
--
-- The bounce above is evidence about an ADDRESS, so it updated the address-safety
-- projection -- not the topic-scoped preference table. That distinction is the whole
-- point: a broadcast opt-out must never reach transactional mail, and a dead
-- mailbox must.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT safety.safety_state || '|' || safety.suppression_class
      || '|' || (safety.terminal_locked_at IS NULL)::text
      || '|' || safety.observation_count::text
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND safety.normalized_recipient_email = 'rep.one@local.test'
  ),
  -- A bounce suppresses without locking terminally: mailbox-full and greylisting
  -- are real, so a purge-and-recreate path is not foreclosed by one soft failure.
  'suppressed|bounce|true|1',
  'the bounce suppresses the address in the safety projection without locking it terminally'
);

SELECT extensions.is(
  (
    SELECT safety_event.event_class || '|' || safety_event.previous_state
      || '|' || safety_event.next_state || '|' || safety_event.actor_kind
      || '|' || (safety_event.provider_event_id = 'evt_bounce_0001')::text
    FROM plugin_data.csf_communication_address_safety_events AS safety_event
    WHERE safety_event.organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND safety_event.normalized_recipient_email = 'rep.one@local.test'
  ),
  'bounce|safe|suppressed|provider|true',
  'the safety projection is backed by frozen evidence naming the provider event behind it'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_address_safety
    SET safety_state = 'safe'
    WHERE normalized_recipient_email = 'rep.one@local.test'
  $$,
  '23514',
  'A CSF address suppressed by provider evidence returns to safe only through an audited release recording the actor and reason.',
  'an address suppressed by provider evidence is never quietly declared healthy again'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_address_safety_events
    SET event_class = 'manual_hold'
    WHERE normalized_recipient_email = 'rep.one@local.test'
  $$,
  '23514',
  'CSF address safety history is append-only.',
  'recorded address-safety evidence can never be rewritten'
);

-- THE DECISION SPLIT, STATED SIDE BY SIDE.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_communication_preference_decision(
      'bd100000-0000-4000-8000-000000000001', 'transactional', NULL,
      'rep.one@local.test'
    )->>'decision'
  ),
  'mandatory_transactional',
  'the CONSENT decision still says transactional mail to this address is mandatory'
);

SELECT extensions.is(
  (
    SELECT (
      plugin_data.csf_communication_dispatch_decision(
        'bd100000-0000-4000-8000-000000000001', 'broadcast', 'partner_clubs',
        'rep.one@local.test'
      )->>'blockedBy'
    ) || '|' || (
      plugin_data.csf_communication_dispatch_decision(
        'bd100000-0000-4000-8000-000000000001', 'transactional', NULL,
        'rep.one@local.test'
      )->>'blockedBy'
    )
  ),
  'address_safety|address_safety',
  'a provider-suppressed address blocks BOTH broadcast and transactional dispatch'
);

-- END TO END. Two fresh campaigns to the same suppressed address: one refusable,
-- one mandatory. Both are stopped.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000008',
      '[{"email":"Rep.One@Local.Test","provenance":"representative_record"}]'::jsonb
    )
  $$,
  'a broadcast campaign can still snapshot a provider-suppressed address'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000008', 1
    )->>'attemptsEnqueued'
  ),
  '1',
  'the broadcast to the suppressed address enqueues before safety is consulted'
);

CREATE TEMP TABLE t_suppressed_broadcast AS
SELECT plugin_data.csf_claim_communication_dispatch_batch(
  'bd100000-0000-4000-8000-000000000001',
  'bd400000-0000-4000-8000-000000000008', 'worker-8', 25, 120
) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'claimedCount') || '|' || (result->>'suppressedAtClaim')
    FROM t_suppressed_broadcast
  ),
  '0|1',
  'a broadcast to a provider-suppressed address is never handed to a worker'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000009',
      '[{"email":"Rep.One@Local.Test","provenance":"account_email"}]'::jsonb
    )
  $$,
  'a transactional campaign can still snapshot a provider-suppressed address as mandatory'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000009', 1
    )->>'attemptsEnqueued'
  ),
  '1',
  'the transactional send to the suppressed address enqueues its mandatory recipient'
);

CREATE TEMP TABLE t_suppressed_transactional AS
SELECT plugin_data.csf_claim_communication_dispatch_batch(
  'bd100000-0000-4000-8000-000000000001',
  'bd400000-0000-4000-8000-000000000009', 'worker-9', 25, 120
) AS result;

-- THE CONTRAST THAT MATTERS. Earlier in this suite a broadcast OPT-OUT left
-- transactional delivery untouched, because consent cannot refuse mandatory mail.
-- Provider SAFETY is a different fact and stops it.
SELECT extensions.is(
  (
    SELECT (result->>'claimedCount') || '|' || (result->>'suppressedAtClaim')
    FROM t_suppressed_transactional
  ),
  '0|1',
  'mandatory transactional mail to a provider-suppressed address is stopped too, unlike a broadcast opt-out'
);

SELECT extensions.is(
  (
    SELECT attempt.state || '|' || attempt.failure_class
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000009'
  ),
  'suppressed|dispatch_refused',
  'the refused transactional attempt records why it was stopped'
);

CREATE TEMP TABLE t_late_delivered AS
SELECT plugin_data.csf_record_communication_provider_event(
  'bd100000-0000-4000-8000-000000000001', 'evt_delivered_late_0001',
  'email.delivered', 'resend-message-a', now() + interval '1 minute',
  repeat('f', 64), true
) AS result;

SELECT extensions.is(
  (SELECT result->>'processingState' FROM t_late_delivered),
  'ignored_terminal',
  'a late delivered event with an earlier provider time is retained but ignored'
);
SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_communication_deliveries
    WHERE provider_message_id = 'resend-message-a'
  ),
  'bounced',
  'a terminal bounce is never downgraded by a later success event'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_provider_events
    WHERE provider_event_id = 'evt_delivered_late_0001'
  ),
  1,
  'the ignored event is still retained as evidence'
);

-- A SAFETY SIGNAL WITH AN EARLIER TIME IS NOT DISCARDED. It escalates.
-- CORRECTED. A complaint AFTER a delivery is not a contradiction at all: the
-- recipient received the message and then reported it as spam, which is the normal
-- order of events. Treating it as a conflict would have parked the single most
-- deliverability-critical signal we get in a review queue instead of acting on it.
-- It reduces, and it locks terminal safety.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_comm_reduction_decision(
      'email.complained', now() - interval '1 hour', true, 'delivered', false, now()
    )->>'processingState'
  ),
  'reduced',
  'a complaint after a recorded delivery is a legitimate safety escalation, not a conflict'
);

SELECT extensions.is(
  (
    WITH decided AS (
      SELECT plugin_data.csf_comm_reduction_decision(
        'email.complained', now() - interval '1 hour', true, 'delivered', false, now()
      ) AS verdict
    )
    SELECT (verdict->>'applied') || '|' || (verdict->>'target')
      || '|' || (verdict->>'isSafety')
    FROM decided
  ),
  'true|complained|true',
  'the late complaint reduces the delivery to complained as a safety signal'
);

-- A GENUINE contradiction still escalates rather than vanishing: no legal
-- transition moves a bounced delivery to complained, so that event is retained and
-- raised for a human instead of being applied or dropped.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_comm_reduction_decision(
      'email.complained', now() + interval '1 hour', true, 'bounced', true, now()
    )->>'processingState'
  ),
  'ignored_conflict',
  'a complaint that cannot legally follow a recorded bounce is escalated, not discarded'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_comm_reduction_decision(
      'email.bounced', now() - interval '1 hour', true, 'sent', false, now()
    )->>'applied'
  ),
  'true',
  'a bounce that arrives out of order still reduces a sent delivery'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_comm_reduction_decision(
      'email.delivered', now() - interval '1 hour', true, 'sent', false, now()
    )->>'processingState'
  ),
  'ignored_stale',
  'an out-of-order success signal, unlike a safety signal, is treated as stale'
);

-- DUPLICATE ENVELOPE HANDLING.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_record_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_bounce_0001',
      'email.bounced', 'resend-message-a', now() + interval '10 minutes',
      repeat('e', 64), true, 'svix', 'whsec_test_key',
      '{"smtpCode":550,"bounceType":"Permanent"}'::jsonb
    )->>'duplicate'
  ),
  'true',
  'a byte-identical envelope replay is reported as a duplicate'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_bounce_0001',
      'email.bounced', 'resend-message-a', now() + interval '99 minutes',
      repeat('e', 64), true
    )
  $$,
  '23505',
  'CSF provider webhook envelope "evt_bounce_0001" was already recorded with different immutable evidence; refusing a conflicting replay.',
  'an envelope replayed with a different provider time is a conflict'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_bounce_0001',
      'email.complained', 'resend-message-a', now() + interval '10 minutes',
      repeat('e', 64), true
    )
  $$,
  '23505',
  'CSF provider webhook envelope "evt_bounce_0001" was already recorded with different immutable evidence; refusing a conflicting replay.',
  'an envelope replayed with a different event type is a conflict'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_bounce_0001',
      'email.bounced', 'resend-message-a', now() + interval '10 minutes',
      repeat('0', 64), true
    )
  $$,
  '23505',
  'CSF provider webhook envelope "evt_bounce_0001" was already recorded with different immutable evidence; refusing a conflicting replay.',
  'an envelope replayed with a different raw-body digest is a conflict'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_provider_events
    WHERE provider_message_id = 'resend-message-a'
      AND reduction_applied
  ),
  1,
  'a replayed webhook reduces the delivery exactly once'
);

-- WRONG-TENANT POISONING.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_communication_provider_event(
      'bd100000-0000-4000-8000-000000000002', 'evt_foreign_0001',
      'email.delivered', 'resend-message-a', now(), repeat('e', 64), true
    )
  $$,
  '23503',
  'That CSF provider message belongs to another organization; refusing to record cross-tenant webhook evidence.',
  'a webhook naming another organization provider message is refused, not filed as unmatched'
);

-- UNKNOWN EVENT TYPE.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_record_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_opened_0001',
      'email.opened', 'resend-message-a', now() + interval '30 minutes',
      repeat('0', 64), true
    )->>'processingState'
  ),
  'ignored_unknown_type',
  'an unknown provider event type is retained without mutating delivery state'
);

SELECT extensions.is(
  (
    SELECT signature_verified::text || '|' || signature_scheme
      || '|' || (signature_verified_at IS NOT NULL)::text
    FROM plugin_data.csf_communication_provider_events
    WHERE provider_event_id = 'evt_opened_0001'
  ),
  'true|svix|true',
  'every recorded event carries the application signature verification metadata'
);

-- LEGACY EVIDENCE IS STRUCTURALLY UNVERIFIED AND NON-REDUCIBLE.
--
-- Exercised on INSERT rather than UPDATE on purpose: on an existing row the
-- append-only freeze trigger would fire first and report the settle rule, which
-- would hide whether the verification rule exists at all.
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_provider_events (
      organization_id, provider, provider_event_id, event_type,
      provider_message_id, occurred_at, payload_hash,
      processing_state, reduction_applied, reduced_to_status, reduced_at
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'resend', 'evt_unverified_reduce',
      'email.delivered', 'resend-message-a', now(), repeat('3', 64),
      'reduced', true, 'delivered', now()
    )
  $$,
  '23514',
  'new row for relation "csf_communication_provider_events" violates check constraint "csf_comm_event_verified_reduction_check"',
  'unverified evidence with no provider time can never be recorded as having reduced anything'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_provider_events
    WHERE signature_verified AND NOT reduction_applied
      AND provider_event_id = 'evt_notime_0001'
  ),
  1,
  'a verified but timeless event is retained as evidence and marked as having reduced nothing'
);

-- WEBHOOK BEFORE DELIVERY: unmatched, then rebound.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_record_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_early_0001',
      'email.delivered', 'resend-message-early', now(), repeat('7', 64), true
    )->>'processingState'
  ),
  'unmatched',
  'a webhook that beats its delivery row is retained as unmatched evidence'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_rebind_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_early_0001'
    )->>'rebound'
  ),
  'false',
  'rebinding before the delivery exists changes nothing and stays unmatched'
);

-- MANUAL RECONCILIATION IS WHAT MAKES THE REBIND POSSIBLE.
--
-- The operator finds the message identity in the provider's dashboard and supplies
-- it while resolving campaign bd400000-...0002's unknown outcome. That call must
-- bind BOTH the attempt and the delivery: binding only the attempt would leave the
-- delivery unnameable, so this already-recorded webhook would stay unmatched
-- forever -- the provider's own account of the send, discarded by an omission.
CREATE TEMP TABLE t_reconcile_binds AS
SELECT plugin_data.csf_reconcile_communication_unknown_outcome(
  'bd100000-0000-4000-8000-000000000001',
  (
    SELECT attempt.id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000002'
    LIMIT 1
  ),
  'failed',
  'Provider support confirmed the send never left.',
  'resend-message-early',
  'bd000000-0000-4000-8000-000000000001',
  'corr-reconcile-1'
) AS result;

SELECT extensions.is(
  (SELECT result->>'boundDeliveryMessageId' FROM t_reconcile_binds),
  'true',
  'a reconciliation that supplies a provider message identity binds the delivery too, not just the attempt'
);

SELECT extensions.is(
  (
    SELECT attempt.provider_message_id || '|' || delivery.provider_message_id
      || '|' || attempt.reconciled_actor_kind
      || '|' || attempt.reconciled_by_identity
      || '|' || attempt.correlation_id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_deliveries AS delivery
      ON delivery.id = attempt.delivery_id
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000002'
  ),
  'resend-message-early|resend-message-early|staff|csf-officer@local.test|corr-reconcile-1',
  'both sides carry the provider identity, and the reconciliation freezes its staff actor and correlation'
);

CREATE TEMP TABLE t_rebind AS
SELECT plugin_data.csf_rebind_communication_provider_event(
  'bd100000-0000-4000-8000-000000000001', 'evt_early_0001'
) AS result;

SELECT extensions.is(
  (SELECT result->>'rebound' FROM t_rebind),
  'true',
  'the previously unmatched evidence can finally be rebound once reconciliation named its message'
);

SELECT extensions.is(
  (
    SELECT (result->>'deliveryId' IS NOT NULL)::text
      || '|' || (result->>'processingState')
    FROM t_rebind
  ),
  -- The operator determined the send failed. A late 'delivered' webhook is retained
  -- as evidence and cannot downgrade that recorded outcome.
  'true|ignored_stale',
  'the rebound event attaches to its delivery without downgrading the recorded failure'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_communication_deliveries
    WHERE provider_message_id = 'resend-message-early'
  ),
  'failed',
  'a late success event never overwrites a reconciled failure'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_rebind_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_early_0001'
    )
  $$,
  '23514',
  'Only unmatched CSF webhook evidence can be rebound; this event is already "ignored_stale".',
  'a rebound event cannot be resolved a second time'
);

-- ---------------------------------------------------------------------------
-- K3. A WEBHOOK THAT ARRIVES BEFORE LOCAL SETTLEMENT
--
-- The signed csf_attempt_id tag is what makes this recoverable without reading a
-- single byte of message content or a recipient address. Campaign
-- bd400000-...0010's attempt is deliberately left in 'unknown_outcome' first, so
-- the arriving evidence has to bind the delivery, bind the attempt, advance it, and
-- resolve review -- all in one transaction.
-- ---------------------------------------------------------------------------

-- Campaign ...0010 deliberately reuses the same address as ...0001 to prove
-- campaign-scoped idempotency. Section K2 subsequently recorded a bounce for
-- that address, so another real send is only valid after the existing audited
-- release path restores it. Without this fixture transition the claim correctly
-- suppresses the queued attempt and the webhook race below has no send to race.
CREATE TEMP TABLE t_repeat_recipient_release AS
SELECT plugin_data.csf_release_communication_address_safety(
  'bd100000-0000-4000-8000-000000000001',
  'rep.one@local.test',
  'Synthetic audited release before the later campaign send.',
  'bd000000-0000-4000-8000-000000000001',
  'corr-repeat-recipient-release'
) AS result;

SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000010', 'worker-10', 25, 120
    )->>'claimedCount'
  ),
  '1',
  'the second same-copy campaign claims its attempt'
);

-- THE ATTEMPT IS AUTHORIZED BEFORE ANY PROVIDER EVIDENCE NAMES IT.
--
-- An unknown outcome only makes sense for a send the ledger actually released: if
-- nothing was ever authorized, no request reached the provider and there is nothing
-- to be ambiguous about. The fixture used to claim and then settle unknown straight
-- away, which described a state the durable path cannot produce -- and it is exactly
-- the state that section K5 now proves is treated as an incident.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_authorize_communication_dispatch(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000010'
          AND attempt.state = 'processing'
        LIMIT 1
      ),
      'worker-10', 'corr-tagged-1'
    )->>'authorized'
  ),
  'true',
  'the same-copy attempt is authorized for dispatch before the worker reports back'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000010'
        LIMIT 1
      ),
      'worker-10', 'unknown_outcome', NULL, NULL, 'timeout',
      'Socket closed before the provider answered.'
    )->>'requiresHumanReview'
  ),
  'true',
  'the worker honestly reports that it cannot tell what happened'
);

SELECT extensions.is(
  (
    SELECT (delivery.provider_message_id IS NULL)::text
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'bd400000-0000-4000-8000-000000000010'
  ),
  'true',
  'no provider message identity is recorded locally, so a message-id lookup alone could never match'
);

CREATE TEMP TABLE t_tagged_evidence AS
SELECT plugin_data.csf_record_communication_provider_event(
  'bd100000-0000-4000-8000-000000000001',
  'evt_tagged_0001',
  'email.delivered',
  'resend-message-tagged',
  now() + interval '2 minutes',
  repeat('b', 64),
  true,
  'svix',
  'whsec_test_key',
  '{}'::jsonb,
  (
    SELECT attempt.id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000010'
    LIMIT 1
  ),
  'bd400000-0000-4000-8000-000000000010'
) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'processingState') || '|' || (result->>'boundDeliveryMessageId')
      || '|' || (result->>'attemptAdvanced') || '|' || (result->>'attemptState')
    FROM t_tagged_evidence
  ),
  'reduced|true|true|delivered',
  'a webhook that beats local settlement binds the delivery identity, binds the attempt, and advances it'
);

SELECT extensions.is(
  (
    SELECT attempt.state || '|' || attempt.review_state
      || '|' || attempt.reconciled_actor_kind
      || '|' || (attempt.reconciled_by IS NULL)::text
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000010'
  ),
  -- PROVIDER evidence resolved this, not a human, and the record says so.
  'delivered|resolved|provider|true',
  'provider evidence resolves the unknown outcome as provider evidence, never as a staff decision'
);

SELECT extensions.is(
  (
    SELECT delivery.status || '|' || delivery.review_state
      || '|' || delivery.provider_message_id
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'bd400000-0000-4000-8000-000000000010'
  ),
  'delivered|resolved|resend-message-tagged',
  'the delivery is bound, reduced, and its review state resolved in the same transaction'
);

-- ---------------------------------------------------------------------------
-- K4. A SIGNED email.sent IS PROVIDER ACCEPTANCE
--
-- csf_communication_event_target_status() has always mapped email.sent to delivery
-- 'sent', and the delivery duly reduced -- but the ATTEMPT mapping had no 'sent'
-- case, so the walk-out-of-processing branch never fired. The attempt sat in
-- 'processing' holding a lease while the provider had already said, in a signed
-- webhook, that it accepted the message. The lease then lapsed and the reaper
-- settled it 'unknown_outcome': the ledger manufactured ambiguity about a send the
-- provider had confirmed in writing, and demanded a human reconcile it.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000012',
      '[{"email":"sentfirst@local.test","provenance":"staff_entry"}]'::jsonb
    )
  $$,
  'a fresh recipient is snapshotted for the sent-acceptance case'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000012', 1
    )->>'attemptsEnqueued'
  ),
  '1',
  'the sent-acceptance campaign enqueues its recipient'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000012', 'worker-sent', 25, 120
    )->>'claimedCount'
  ),
  '1',
  'the sent-acceptance recipient is claimed and left in flight'
);

-- AND AUTHORIZED. A signed email.sent is provider ACCEPTANCE only when it can be
-- tied to a try this ledger actually released; see section K5 for what happens when
-- it cannot. The nominal fixture is therefore claim -> authorize -> signed evidence.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_authorize_communication_dispatch(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000012'
          AND attempt.state = 'processing'
        LIMIT 1
      ),
      'worker-sent', 'corr-sent-first-1'
    )->>'authorized'
  ),
  'true',
  'the sent-acceptance attempt is authorized immediately before the send'
);

-- The worker is still waiting on its HTTP response. The webhook arrives first.
CREATE TEMP TABLE t_sent_acceptance AS
SELECT plugin_data.csf_record_communication_provider_event(
  'bd100000-0000-4000-8000-000000000001',
  'evt_sent_first_0001',
  'email.sent',
  'resend-message-sent-first',
  now() + interval '1 minute',
  repeat('5', 64),
  true,
  'svix',
  'whsec_test_key',
  '{}'::jsonb,
  (
    SELECT attempt.id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000012'
      AND attempt.state = 'processing'
    LIMIT 1
  ),
  'bd400000-0000-4000-8000-000000000012'
) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'processingState') || '|' || (result->>'attemptAdvanced')
      || '|' || (result->>'attemptState')
    FROM t_sent_acceptance
  ),
  'reduced|true|accepted',
  'a signed email.sent settles the in-flight attempt as accepted instead of leaving it processing'
);

SELECT extensions.is(
  (
    SELECT attempt.state || '|' || attempt.settlement_source
      || '|' || (attempt.settled_at IS NOT NULL)::text
      || '|' || (attempt.lease_owner IS NULL)::text
      || '|' || attempt.provider_message_id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000012'
  ),
  'accepted|provider|true|true|resend-message-sent-first',
  'the attempt is settled with provider provenance, its lease released, and the message bound'
);

-- THE REAPER CANNOT NOW FABRICATE AMBIGUITY. The attempt is no longer processing, so
-- ageing every remaining lease and sweeping finds nothing to call unknown.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_reap_communication_dispatch_leases(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000012'
    )->>'settledUnknownOutcomes'
  ),
  '0',
  'lease expiry cannot manufacture an unknown outcome after the provider accepted the message'
);

-- AND A LATER AGREEING WORKER RESPONSE CONFIRMS RATHER THAN CONFLICTS.
SELECT extensions.is(
  (
    SELECT (result->>'idempotentReplay')
      || '|' || (result->>'workerConfirmedProviderSettlement')
      || '|' || (result->>'attemptState')
    FROM (
      SELECT plugin_data.csf_settle_communication_dispatch_attempt(
        'bd100000-0000-4000-8000-000000000001',
        (
          SELECT attempt.id
          FROM plugin_data.csf_communication_dispatch_attempts AS attempt
          WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000012'
          LIMIT 1
        ),
        'worker-sent', 'accepted', 'resend-message-sent-first'
      ) AS result
    ) AS confirmation
  ),
  'true|true|accepted',
  'the worker response that finally arrives confirms the provider settlement idempotently'
);

SELECT extensions.is(
  (
    SELECT (attempt.worker_confirmed_at IS NOT NULL)::text
      || '|' || attempt.settlement_source
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000012'
  ),
  'true|provider',
  'the confirmation is recorded without rewriting the provider as the settling party'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_crosstag_0001',
      'email.delivered', 'resend-message-crosstag', now(), repeat('c', 64), true,
      'svix', NULL, '{}'::jsonb,
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000010'
        LIMIT 1
      ),
      'bd400000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'This CSF webhook routing tag names a dispatch attempt from a different campaign than the campaign tag; refusing to bind contradictory evidence.',
  'a signed attempt tag that disagrees with the campaign tag is refused rather than guessed at'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_record_communication_provider_event(
      'bd100000-0000-4000-8000-000000000002', 'evt_foreigntag_0001',
      'email.delivered', 'resend-message-foreigntag', now(), repeat('d', 64), true,
      'svix', NULL, '{}'::jsonb,
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000010'
        LIMIT 1
      ),
      NULL
    )
  $$,
  '23503',
  'The CSF dispatch attempt named by this webhook routing tag does not exist in this organization.',
  'a signed attempt tag is validated against the claiming organization before it binds anything'
);

-- SETTLED ATTEMPT EVIDENCE IS FROZEN.
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_dispatch_attempts
    SET provider_status_code = 200, failure_class = 'rewritten'
    WHERE campaign_id = 'bd400000-0000-4000-8000-000000000010'
  $$,
  '23514',
  'CSF dispatch attempt evidence is frozen once the attempt settles; only a first reconciliation may record its own decision.',
  'a settled attempt provider status code and failure class can never be rewritten'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_dispatch_attempts
    SET metadata = '{"smtpCode":250}'::jsonb
    WHERE campaign_id = 'bd400000-0000-4000-8000-000000000010'
  $$,
  '23514',
  'CSF dispatch attempt evidence is frozen once the attempt settles; only a first reconciliation may record its own decision.',
  'settled attempt operational metadata can never be rewritten'
);

-- ---------------------------------------------------------------------------
-- K5. PROVIDER EVIDENCE MUST NOT CREATE ANOTHER SEND
--
-- A signed email.sent is provider ACCEPTANCE only when it can be tied to an
-- attempt this ledger actually released. plugin_data.csf_authorize_communication_dispatch()
-- is the only thing that ever hands a payload out, and it stamps
-- dispatch_authorized_at when it does.
--
-- Evidence naming an attempt with no such stamp is a contradiction, and treating it
-- as an ordinary success was the dangerous answer: it walked a QUEUED attempt --
-- one a worker is still entitled to claim and send -- into 'accepted' on the
-- strength of a routing tag. The ledger would then show a completed send while a
-- real one was still pending.
--
-- The evidence is kept, because it is signed and it is the only record that this
-- happened. Nothing becomes a success, and the attempt and its delivery become
-- permanently unsendable and review-blocked.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000013',
      '[{"email":"unauthorized.evidence@local.test","provenance":"staff_entry"}]'::jsonb
    )
  $$,
  'a recipient is snapshotted for the unauthorized-evidence case'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000013', 1
    )->>'attemptsEnqueued'
  ),
  '1',
  'the unauthorized-evidence campaign enqueues its recipient and leaves it queued'
);

-- Never claimed, never authorized. The provider nevertheless reports a send.
CREATE TEMP TABLE t_unauthorized_evidence AS
SELECT plugin_data.csf_record_communication_provider_event(
  'bd100000-0000-4000-8000-000000000001',
  'evt_unauth_sent_0001',
  'email.sent',
  'resend-message-unauthorized',
  now() + interval '1 minute',
  repeat('8', 64),
  true,
  'svix',
  'whsec_test_key',
  '{}'::jsonb,
  (
    SELECT attempt.id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000013'
    LIMIT 1
  ),
  'bd400000-0000-4000-8000-000000000013'
) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'processingState')
      || '|' || (result->>'unauthorizedAttemptEvidence')
      || '|' || (result->>'reductionApplied')
      || '|' || (result->>'attemptState')
    FROM t_unauthorized_evidence
  ),
  'ignored_conflict|true|false|unknown_outcome',
  'signed evidence for an attempt that was never authorized is filed as a conflict, never as an acceptance'
);

SELECT extensions.is(
  (
    SELECT attempt.state || '|' || attempt.review_state
      || '|' || attempt.settlement_source
      || '|' || (attempt.settled_at IS NOT NULL)::text
      || '|' || (attempt.lease_owner IS NULL)::text
      || '|' || (attempt.unknown_reason IS NOT NULL)::text
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000013'
  ),
  'unknown_outcome|escalated|provider|true|true|true',
  'the unauthorized attempt is settled unretryably and escalated rather than accepted'
);

-- THE DELIVERY DID NOT BECOME 'sent'. That is the whole point: an ordinary success
-- here would be the ledger asserting a completed send it cannot account for.
SELECT extensions.is(
  (
    SELECT delivery.status || '|' || delivery.review_state
      || '|' || (delivery.unknown_outcome_at IS NOT NULL)::text
      || '|' || (delivery.sent_at IS NULL)::text
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'bd400000-0000-4000-8000-000000000013'
  ),
  'queued|escalated|true|true',
  'the delivery is escalated for review and never records a send that was not authorized'
);

SELECT extensions.is(
  (
    SELECT (campaign.review_blocked_at IS NOT NULL)::text
      || '|' || (campaign.review_blocked_reason IS NOT NULL)::text
    FROM plugin_data.csf_communication_campaigns AS campaign
    WHERE campaign.id = 'bd400000-0000-4000-8000-000000000013'
  ),
  'true|true',
  'the campaign becomes visibly review-blocked by the contradiction'
);

-- THE SIGNED EVIDENCE IS NOT DISCARDED AND NOT OVERWRITTEN.
SELECT extensions.is(
  (
    SELECT event.signature_verified::text
      || '|' || event.payload_hash
      || '|' || event.event_type
      || '|' || event.provider_message_id
      || '|' || event.reduction_applied::text
      || '|' || (event.reduced_to_status IS NULL)::text
      || '|' || (event.delivery_id IS NULL)::text
    FROM plugin_data.csf_communication_provider_events AS event
    WHERE event.provider_event_id = 'evt_unauth_sent_0001'
  ),
  'true|' || repeat('8', 64) || '|email.sent|resend-message-unauthorized|false|true|true',
  'the signed event is retained with every evidential column intact without binding the unreserved message identity to a delivery'
);

-- UNAUTHORIZED EVIDENCE MUST NOT RESERVE A PROVIDER IDENTITY.
--
-- csf_comm_delivery_provider_message_global_idx makes provider_message_id unique
-- across every organization, so binding it is a one-time, irreversible claim on a
-- coordinate. The resolver used to bind it onto the delivery and the attempt
-- BEFORE it checked dispatch_authorized_at, and the unknown_outcome settlement
-- then bound it a third time. Evidence for a try the ledger never released could
-- therefore consume the identity -- and the send that legitimately owned that
-- message id would afterwards be unable to bind it at all.
--
-- The identity lives on the immutable event row, which is where the evidence
-- belongs. It does not live on the projections the contradiction poisoned.
SELECT extensions.is(
  (
    SELECT (attempt.provider_message_id IS NULL)::text
      || '|' || (delivery.provider_message_id IS NULL)::text
      || '|' || attempt.state
      || '|' || delivery.review_state
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_deliveries AS delivery
      ON delivery.id = attempt.delivery_id
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000013'
  ),
  'true|true|unknown_outcome|escalated',
  'neither the attempt nor the delivery binds the provider identity, while the incident stays durable'
);

-- ANTI-TAUTOLOGY: the identity is genuinely unclaimed, not merely absent from the
-- two rows above. Nothing anywhere holds it except the evidence row itself.
SELECT extensions.is(
  (
    SELECT (
      SELECT count(*)
      FROM plugin_data.csf_communication_deliveries AS delivery
      WHERE delivery.provider_message_id = 'resend-message-unauthorized'
    )::text
    || '|' || (
      SELECT count(*)
      FROM plugin_data.csf_communication_dispatch_attempts AS attempt
      WHERE attempt.provider_message_id = 'resend-message-unauthorized'
    )::text
    || '|' || (
      SELECT count(*)
      FROM plugin_data.csf_communication_provider_events AS event
      WHERE event.provider_message_id = 'resend-message-unauthorized'
    )::text
  ),
  '0|0|1',
  'the globally unique provider identity is still free for a send the ledger actually authorizes'
);

-- PERMANENTLY NON-SENDABLE. Not merely "not right now".
SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000013', 'worker-unauth', 25, 120
    )->>'claimedCount'
  ),
  '0',
  'the contradicted attempt is no longer claimable by any worker'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_dispatch_attempts (
      organization_id, campaign_id, recipient_snapshot_id, delivery_id,
      attempt_number, provider_idempotency_key, content_hash,
      request_payload_hash, recipient_email_hash
    )
    SELECT
      attempt.organization_id, attempt.campaign_id, attempt.recipient_snapshot_id,
      attempt.delivery_id, 2, NULL, attempt.content_hash,
      attempt.request_payload_hash, attempt.recipient_email_hash
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000013'
  $$,
  '23514',
  'A CSF dispatch attempt with an unknown provider outcome can never be retried; reconcile it or resolve it through human review.',
  'no successor attempt can ever be opened behind the contradicted one'
);

SELECT extensions.ok(
  pg_temp.csf_campaign_advisory_held(
    'bd100000-0000-4000-8000-000000000001',
    'bd400000-0000-4000-8000-000000000013'
  ),
  'resolving provider evidence acquired the campaign advisory lock (held, not ordered, is what pg_locks can show)'
);

-- ---------------------------------------------------------------------------
-- K5b. SIGNED SAFETY EVIDENCE WITH NO PROVIDER TIME STILL LEAVES A TRACE
--
-- csf_comm_reduction_decision() answers ignored_no_provider_time as soon as it
-- sees a null occurrence time -- which is BEFORE it reaches the safety branch. A
-- bounce, complaint, or suppression that arrives without an authoritative
-- timestamp therefore carried isSafety = true through a state that nothing
-- downstream acted on: it matched neither the reduce arm nor the ignored_conflict
-- review arm, so the delivery was left completely untouched. No review state, no
-- reason, nothing on any worklist. The caller saw a 200 and an unremarkable
-- result and had every reason to read it as ordinary success.
--
-- The missing timestamp is a real constraint and it is respected: ranking needs an
-- authoritative time, so nothing is reduced, and an address is never suppressed on
-- evidence that cannot say when it happened. But "we cannot act on this" is not
-- "this did not happen". Somebody told us this address bounced. It is filed as
-- strictly as a contradiction -- escalated, with a reason, for a human.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000018',
      '[{"email":"timeless.safety@local.test","provenance":"staff_entry"}]'::jsonb
    )
  $$,
  'a recipient is snapshotted for the timeless-safety-evidence case'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000018', 1
    )->>'attemptsEnqueued'
  ),
  '1',
  'the timeless-safety campaign enqueues its recipient and leaves it queued'
);

-- A bounce naming the attempt, carrying NO provider occurrence time.
CREATE TEMP TABLE t_timeless_safety AS
SELECT plugin_data.csf_record_communication_provider_event(
  'bd100000-0000-4000-8000-000000000001',
  'evt_timeless_bounce_0001',
  'email.bounced',
  'resend-message-timeless-safety',
  NULL,
  repeat('9', 64),
  true,
  'svix',
  'whsec_test_key',
  '{"smtpCode":550,"bounceType":"Permanent"}'::jsonb,
  (
    SELECT attempt.id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000018'
    LIMIT 1
  ),
  'bd400000-0000-4000-8000-000000000018'
) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'processingState')
      || '|' || (result->>'reductionApplied')
      || '|' || (result->>'reducedToStatus' IS NULL)::text
      || '|' || (result->>'reason' IS NOT NULL)::text
    FROM t_timeless_safety
  ),
  'ignored_no_provider_time|false|true|true',
  'timeless safety evidence is retained in its own non-authoritative state and reduces nothing'
);

-- THE DELIVERY IS UNCHANGED AND THE REVIEW FLAG IS RAISED. Both halves matter: an
-- escalation that also moved delivery truth would be acting on evidence the
-- decision just refused to trust.
SELECT extensions.is(
  (
    SELECT delivery.status
      || '|' || delivery.review_state
      || '|' || (delivery.review_reason IS NOT NULL)::text
      || '|' || (delivery.terminal_locked_at IS NULL)::text
      || '|' || (delivery.failed_at IS NULL)::text
      || '|' || (delivery.last_provider_event_at IS NULL)::text
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'bd400000-0000-4000-8000-000000000018'
  ),
  'queued|escalated|true|true|true|true',
  'the delivery is escalated for review while its status, terminal lock, and provider-event clock are untouched'
);

-- AND THE ADDRESS IS NOT BLOCKED. Suppressing on evidence that cannot say when it
-- happened would let an unstamped -- or replayed -- signal silently deny a real
-- recipient every future send.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND safety.recipient_email = 'timeless.safety@local.test'
  ),
  0,
  'the address-safety projection is untouched, because no authoritative time proves the block'
);

-- The evidence itself survives in full. That is what an operator reconciles from.
SELECT extensions.is(
  (
    SELECT event.processing_state
      || '|' || (event.provider_occurred_at IS NULL)::text
      || '|' || event.event_type
      || '|' || event.provider_message_id
      || '|' || (event.ignored_reason IS NOT NULL)::text
    FROM plugin_data.csf_communication_provider_events AS event
    WHERE event.provider_event_id = 'evt_timeless_bounce_0001'
  ),
  'ignored_no_provider_time|true|email.bounced|resend-message-timeless-safety|true',
  'the timeless safety event is retained whole, with its null provider time and its reason'
);

-- ---------------------------------------------------------------------------
-- K6. CANCELLATION AFTER THE LEASE, BEFORE AUTHORIZATION
--
-- Cancellation reports live leases rather than stealing them, so a worker can
-- legitimately still hold one when an officer withdraws the send. Authorization is
-- what must notice -- and it must notice BEFORE it assembles a sendable request,
-- because that request carries the sender, the recipient, the subject, both bodies,
-- the topic, and the allocated provider idempotency key.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000014',
      '[{"email":"cancelled.under.lease@local.test","provenance":"staff_entry"}]'::jsonb
    )
  $$,
  'a recipient is snapshotted for the cancel-under-lease case'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000014', 1
    )->>'attemptsEnqueued'
  ),
  '1',
  'the cancel-under-lease campaign enqueues its recipient'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000014', 'worker-lease', 25, 1800
    )->>'claimedCount'
  ),
  '1',
  'a worker takes a long lease on the recipient'
);

-- The officer withdraws the send while that lease is still live.
CREATE TEMP TABLE t_cancel_under_lease AS
SELECT plugin_data.csf_cancel_communication_campaign(
  'bd100000-0000-4000-8000-000000000001',
  'bd400000-0000-4000-8000-000000000014',
  'Synthetic withdrawal while a lease is live.',
  'bd000000-0000-4000-8000-000000000001',
  'corr-cancel-lease-1'
) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'status') || '|' || (result->>'attemptsStillLeased')
      || '|' || (result->>'expiredLeasesSettledUnknown')
    FROM t_cancel_under_lease
  ),
  'cancelled|1|0',
  'cancellation reports the live lease it refuses to steal rather than fabricating an unknown outcome'
);

-- THE LEASE IS NOT A LICENCE. The holder asks to send and is refused.
CREATE TEMP TABLE t_authorize_after_cancel AS
SELECT plugin_data.csf_authorize_communication_dispatch(
  'bd100000-0000-4000-8000-000000000001',
  (
    SELECT attempt.id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000014'
    LIMIT 1
  ),
  'worker-lease',
  'corr-cancel-lease-2'
) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'authorized') || '|' || (result->>'blockedBy')
      || '|' || (result->>'campaignStatus') || '|' || (result->>'attemptState')
    FROM t_authorize_after_cancel
  ),
  'false|campaign_status|cancelled|failed',
  'a lease taken before cancellation can never authorize a send after it'
);

-- NOTHING SENDABLE CAME BACK. Not a truncated payload, not a key: nothing.
SELECT extensions.ok(
  (
    SELECT result->'providerPayload' = 'null'::jsonb
      AND result->'coordinate' = 'null'::jsonb
      AND result->'requestPayloadHash' = 'null'::jsonb
      AND result->'providerIdempotencyKey' = 'null'::jsonb
      AND result::text NOT LIKE '%cancelled.under.lease@local.test%'
      AND result::text NOT LIKE '%Campaign cancelled under a live lease%'
    FROM t_authorize_after_cancel
  ),
  'a refused authorization returns no recipient, subject, body, sender, topic, or provider key'
);

SELECT extensions.is(
  (
    SELECT attempt.state || '|' || attempt.failure_class
      || '|' || attempt.settlement_source
      || '|' || (attempt.lease_owner IS NULL)::text
      || '|' || (attempt.dispatch_authorized_at IS NULL)::text
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000014'
  ),
  'failed|campaign_cancelled|dispatch_refused|true|true',
  'the refused attempt settles as an observed failure with its lease released and no authorization recorded'
);

SELECT extensions.is(
  (
    SELECT delivery.status || '|' || (delivery.sent_at IS NULL)::text
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'bd400000-0000-4000-8000-000000000014'
  ),
  'failed|true',
  'the delivery settles as failed and never records a send'
);

SELECT extensions.ok(
  pg_temp.csf_campaign_advisory_held(
    'bd100000-0000-4000-8000-000000000001',
    'bd400000-0000-4000-8000-000000000014'
  ),
  'the claim/cancellation/authorization sequence acquired the campaign advisory lock (the probe cannot attribute it to one path)'
);

-- CANCELLATION AND SETTLEMENT SERIALIZE ON ONE LOCK, IN ONE ORDER.
--
-- A single session cannot exhibit a two-session wait graph; that proof belongs in
-- a bounded two-connection integration harness, not an untracked scratch script.
-- What IS provable here is that both
-- paths take the SAME advisory lock and that taking it twice in one transaction --
-- which is what re-entering it from a nested RPC does -- never blocks.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_cancel_communication_campaign(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000014',
      'Synthetic withdrawal while a lease is live.',
      'bd000000-0000-4000-8000-000000000001',
      'corr-cancel-lease-1'
    )
  $$,
  're-entering the campaign advisory lock inside the same transaction never blocks'
);

-- ---------------------------------------------------------------------------
-- K7. A LATE WORKER NEVER OVERWRITES A RECONCILED RESULT
--
-- Campaign bd400000-...0010's attempt was settled unknown by its worker and then
-- reconciled by verified provider evidence. If that worker's settlement response
-- was merely lost, its retry arrives against an attempt the ledger has already
-- moved on from -- and a raise would abort the worker's transaction and send it
-- round again, forever.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT (result->>'idempotentReplay')
      || '|' || (result->>'supersededByReconciliation')
      || '|' || (result->>'attemptState')
      || '|' || (result->>'reconciledActorKind')
    FROM (
      SELECT plugin_data.csf_settle_communication_dispatch_attempt(
        'bd100000-0000-4000-8000-000000000001',
        (
          SELECT attempt.id
          FROM plugin_data.csf_communication_dispatch_attempts AS attempt
          WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000010'
          LIMIT 1
        ),
        'worker-10', 'unknown_outcome', NULL, NULL, 'timeout',
        'Socket closed before the provider answered.'
      ) AS result
    ) AS late
  ),
  'true|true|delivered|provider',
  'a late worker replaying the settlement reconciliation superseded is told so instead of raising'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000010'
        LIMIT 1
      ),
      'worker-10', 'failed', NULL, NULL, 'smtp', 'A different story entirely.'
    )
  $$,
  '23514',
  'That CSF dispatch attempt was already reconciled as "delivered" on provider evidence; a late worker settlement never overwrites a reconciled result.',
  'a late worker cannot overwrite a provider-reconciled result with a contradicting one'
);

SELECT extensions.is(
  (
    SELECT attempt.state || '|' || attempt.reconciled_outcome
      || '|' || attempt.reconciled_actor_kind || '|' || attempt.review_state
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000010'
  ),
  'delivered|delivered|provider|resolved',
  'the reconciled evidence survives both the replay and the contradiction attempt unchanged'
);

-- ---------------------------------------------------------------------------
-- K8. RESOLVER AND MANUAL BINDING, SAME LOCK ORDER, EXACTLY ONCE EACH
--
-- The resolver walks campaign -> attempt -> delivery -> evidence; manual binding
-- used to walk attempt -> delivery -> evidence with no campaign lock at all, which
-- is the same rows in a conflicting direction. Both now open with the campaign
-- advisory lock, and this section drives them against each other on one delivery.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000015',
      '[{"email":"late.binding@local.test","provenance":"staff_entry"}]'::jsonb
    )
  $$,
  'a recipient is snapshotted for the late-binding case'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000015', 1
    )->>'attemptsEnqueued'
  ),
  '1',
  'the late-binding campaign enqueues its recipient'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000015', 'worker-bind', 25, 120
    )->>'claimedCount'
  ),
  '1',
  'the late-binding recipient is claimed'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_authorize_communication_dispatch(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000015'
          AND attempt.state = 'processing'
        LIMIT 1
      ),
      'worker-bind', 'corr-bind-1'
    )->>'authorized'
  ),
  'true',
  'the late-binding attempt is authorized before its request leaves the ledger'
);

-- The response never arrived, so the worker says so honestly and records no
-- provider message identity.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000015'
        LIMIT 1
      ),
      'worker-bind', 'unknown_outcome', NULL, NULL, 'timeout',
      'No response before the socket closed.'
    )->>'requiresHumanReview'
  ),
  'true',
  'the late-binding attempt settles as an honest unknown outcome'
);

-- The provider's own account of the send arrives naming a message nothing here
-- reports yet, and with no routing tag to bind it.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_record_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_latebind_0001',
      'email.delivered', 'resend-message-latebind', now() + interval '3 minutes',
      repeat('9', 64), true
    )->>'processingState'
  ),
  'unmatched',
  'evidence for a message identity nobody reports yet is retained as unmatched'
);

CREATE TEMP TABLE t_manual_bind AS
SELECT plugin_data.csf_bind_communication_provider_message(
  'bd100000-0000-4000-8000-000000000001',
  (
    SELECT attempt.id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000015'
    LIMIT 1
  ),
  'resend-message-latebind',
  'Officer read the identity off the provider dashboard.',
  'bd000000-0000-4000-8000-000000000001',
  'corr-bind-2'
) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'reboundEvents') || '|' || (result->>'idempotentReplay')
      || '|' || (result->'lastResolution'->>'processingState')
    FROM t_manual_bind
  ),
  '1|false|reduced',
  'the manual binding re-runs the shared resolver over the evidence that was waiting for exactly this identity'
);

SELECT extensions.is(
  (
    SELECT attempt.state || '|' || attempt.provider_message_id
      || '|' || attempt.reconciled_actor_kind
      || '|' || delivery.status || '|' || delivery.provider_message_id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_deliveries AS delivery
      ON delivery.id = attempt.delivery_id
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000015'
  ),
  'delivered|resend-message-latebind|provider|delivered|resend-message-latebind',
  'both sides carry the discovered identity and the resolver, not the officer, recorded the outcome'
);

-- REPLAY. The identical discovery is idempotent and rebinds nothing a second time.
SELECT extensions.is(
  (
    SELECT (result->>'idempotentReplay') || '|' || (result->>'reboundEvents')
    FROM (
      SELECT plugin_data.csf_bind_communication_provider_message(
        'bd100000-0000-4000-8000-000000000001',
        (
          SELECT attempt.id
          FROM plugin_data.csf_communication_dispatch_attempts AS attempt
          WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000015'
          LIMIT 1
        ),
        'resend-message-latebind',
        'Officer read the identity off the provider dashboard.',
        'bd000000-0000-4000-8000-000000000001',
        'corr-bind-2'
      ) AS result
    ) AS replay
  ),
  'true|0',
  'replaying the identical binding is idempotent and re-resolves nothing'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_bind_communication_provider_message(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000015'
        LIMIT 1
      ),
      'resend-message-latebind-different',
      'A second, contradicting discovery.',
      'bd000000-0000-4000-8000-000000000001',
      'corr-bind-3'
    )
  $$,
  '23514',
  'This CSF dispatch attempt already reports provider message "resend-message-latebind"; a provider message identity is bound exactly once.',
  'a conflicting second discovery is refused rather than silently absorbed'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_rebind_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_latebind_0001'
    )
  $$,
  '23514',
  'Only unmatched CSF webhook evidence can be rebound; this event is already "reduced".',
  'the resolver and the manual binding together resolve the evidence exactly once'
);

SELECT extensions.ok(
  pg_temp.csf_campaign_advisory_held(
    'bd100000-0000-4000-8000-000000000001',
    'bd400000-0000-4000-8000-000000000015'
  ),
  'manual binding acquired the campaign advisory lock (acquisition only; pg_locks cannot show it preceded the row locks)'
);

-- ---------------------------------------------------------------------------
-- K9. sent -> suppressed RETAINS THE ACCEPTED-ATTEMPT HISTORY
--
-- A provider suppression after an acceptance is a real sequence: the message was
-- accepted and then the provider decided not to deliver it. The delivery must walk
-- to 'suppressed' AND the evidence that it was once accepted -- the authorization
-- stamp, the worker settlement, the provider message identity, the sent timestamp
-- -- must all survive, because that is what tells an operator a send was attempted
-- at all.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000016',
      '[{"email":"accepted.then.suppressed@local.test","provenance":"staff_entry"}]'::jsonb
    )
  $$,
  'a recipient is snapshotted for the accept-then-suppress case'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000016', 1
    )->>'attemptsEnqueued'
  ),
  '1',
  'the accept-then-suppress campaign enqueues its recipient'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000016', 'worker-suppress', 25, 120
    )->>'claimedCount'
  ),
  '1',
  'the accept-then-suppress recipient is claimed'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_authorize_communication_dispatch(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000016'
          AND attempt.state = 'processing'
        LIMIT 1
      ),
      'worker-suppress', 'corr-suppress-1'
    )->>'authorized'
  ),
  'true',
  'the accept-then-suppress attempt is authorized before the send'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000016'
        LIMIT 1
      ),
      'worker-suppress', 'accepted', 'resend-message-suppressed-later'
    )->>'deliveryStatus'
  ),
  'sent',
  'the accepted settlement moves the delivery to sent'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_record_communication_provider_event(
      'bd100000-0000-4000-8000-000000000001', 'evt_supp_after_sent_0001',
      'email.suppressed', 'resend-message-suppressed-later',
      now() + interval '5 minutes', repeat('a', 64), true,
      'svix', 'whsec_test_key',
      '{"suppressionType":"OnAccountSuppressionList"}'::jsonb
    )->>'reducedToStatus'
  ),
  'suppressed',
  'a later provider suppression reduces the delivery from sent to suppressed'
);

SELECT extensions.is(
  (
    SELECT delivery.status
      || '|' || (delivery.sent_at IS NOT NULL)::text
      || '|' || (delivery.terminal_locked_at IS NOT NULL)::text
      || '|' || delivery.provider_message_id
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'bd400000-0000-4000-8000-000000000016'
  ),
  'suppressed|true|true|resend-message-suppressed-later',
  'the suppressed delivery keeps the timestamp and identity proving it was sent first'
);

SELECT extensions.is(
  (
    SELECT attempt.state
      || '|' || (attempt.dispatch_authorized_at IS NOT NULL)::text
      || '|' || attempt.dispatch_authorized_to
      || '|' || attempt.settlement_source
      || '|' || attempt.provider_message_id
      || '|' || (attempt.settled_at IS NOT NULL)::text
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000016'
  ),
  'suppressed|true|worker-suppress|worker|resend-message-suppressed-later|true',
  'the attempt records that it was authorized, sent by a worker, and accepted before the suppression'
);

SELECT extensions.is(
  (
    SELECT safety.safety_state || '|' || safety.suppression_class
    FROM plugin_data.csf_communication_address_safety AS safety
    WHERE safety.organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND safety.normalized_recipient_email = 'accepted.then.suppressed@local.test'
  ),
  'suppressed|provider_suppression',
  'the provider suppression protects the next send through the address-safety projection'
);

-- THE ANTI-TAUTOLOGY CONTROL for every advisory-lock assertion above. Campaign
-- bd400000-...0017 exists and is dispatch-ready, but no RPC has ever been handed
-- it, so its lock must NOT be held.
SELECT extensions.ok(
  NOT pg_temp.csf_campaign_advisory_held(
    'bd100000-0000-4000-8000-000000000001',
    'bd400000-0000-4000-8000-000000000017'
  ),
  'the advisory-lock probe answers false for a campaign no RPC has touched'
);

-- ---------------------------------------------------------------------------
-- L. Cancellation
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000005',
      '[
        {"email":"cancelled.recipient@local.test","provenance":"staff_entry"},
        {"email":"cancelled.midflight@local.test","provenance":"staff_entry"}
      ]'::jsonb
    )
  $$,
  'the campaign that will be cancelled first builds an audience'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000005', 2
    )->>'attemptsEnqueued'
  ),
  '2',
  'the campaign that will be cancelled has queued work'
);

-- One recipient is handed to a worker, then that worker's lease lapses. This is the
-- case cancellation used to strand: the claim path refuses to yield work for a
-- cancelled campaign, so nothing would ever settle a lapsed lease afterwards.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000005', 'worker-cancel', 1, 120
    )->>'claimedCount'
  ),
  '1',
  'one of the soon-to-be-cancelled recipients is claimed under a lease'
);

UPDATE plugin_data.csf_communication_dispatch_attempts
SET leased_at = now() - interval '40 minutes',
    lease_expires_at = now() - interval '30 minutes'
WHERE campaign_id = 'bd400000-0000-4000-8000-000000000005'
  AND state = 'processing';

-- THE ACTOR IS AUTHORIZATION, NOT DECORATION.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_cancel_communication_campaign(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000005',
      'An account that merely exists.',
      'bd000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  'That account does not hold the CSF staff capability required to cancel a campaign in this organization.',
  'an account that exists but holds no CSF staff capability cannot cancel a campaign'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_cancel_communication_campaign(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000005',
      'An officer of another chapter.',
      'bd000000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  'That account does not hold the CSF staff capability required to cancel a campaign in this organization.',
  'an officer of another organization cannot cancel this organization campaign'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_cancel_communication_campaign(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000005',
      'No actor at all.', NULL
    )
  $$,
  '22004',
  'A CSF campaign cancellation must record the staff account that decided it.',
  'cancellation with no named actor is refused outright'
);

CREATE TEMP TABLE t_cancel AS
SELECT plugin_data.csf_cancel_communication_campaign(
  'bd100000-0000-4000-8000-000000000001',
  'bd400000-0000-4000-8000-000000000005',
  'Officer withdrew the send.',
  'bd000000-0000-4000-8000-000000000001',
  'corr-cancel-1'
) AS result;

SELECT extensions.is(
  (SELECT result->>'attemptsSettled' FROM t_cancel),
  '1',
  'cancellation settles the queued work in the same transaction'
);

-- CANCELLATION SETTLES EXPIRED LEASED WORK HONESTLY INSTEAD OF STRANDING IT.
SELECT extensions.is(
  (SELECT result->>'expiredLeasesSettledUnknown' FROM t_cancel),
  '1',
  'cancellation settles already-lapsed leased work as an unknown outcome rather than abandoning it'
);

SELECT extensions.is(
  (
    SELECT string_agg(
      attempt.state || ':' || attempt.review_state, ',' ORDER BY attempt.state
    )
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000005'
  ),
  'failed:none,unknown_outcome:pending',
  'the cancelled campaign leaves nothing in processing: the queued attempt failed and the lapsed one is under review'
);

-- AND NOT A SINGLE RETRY BEHIND ANY OF IT.
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000005'
  ),
  2,
  'cancellation never enqueues a successor attempt for anything it settled'
);

SELECT extensions.is(
  (
    SELECT status || '|' || (cancelled_at IS NOT NULL)::text
      || '|' || cancelled_by::text || '|' || cancelled_by_identity
      || '|' || correlation_id
    FROM plugin_data.csf_communication_campaigns
    WHERE id = 'bd400000-0000-4000-8000-000000000005'
  ),
  'cancelled|true|bd000000-0000-4000-8000-000000000001|csf-officer@local.test|corr-cancel-1',
  'the cancelled campaign freezes when, why, by whom, and under which correlation it stopped'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000005', 'worker-5', 25, 120
    )->>'claimedCount'
  ),
  '0',
  'a cancelled campaign yields no work to any worker'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_cancel_communication_campaign(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000005',
      'Officer withdrew the send.',
      'bd000000-0000-4000-8000-000000000001'
    )->>'idempotentReplay'
  ),
  'true',
  'cancelling an already cancelled campaign is idempotent'
);

-- A completed campaign yields no work either.
UPDATE plugin_data.csf_communication_campaigns
SET status = 'completed', completed_at = now()
WHERE id = 'bd400000-0000-4000-8000-000000000006';

SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000006', 'worker-6', 25, 120
    )->>'claimedCount'
  ),
  '0',
  'a completed campaign yields no work to any worker'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_cancel_communication_campaign(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000006',
      'Too late.', 'bd000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'A settled CSF campaign ("completed") cannot be cancelled.',
  'a settled campaign cannot be retroactively cancelled'
);

-- ---------------------------------------------------------------------------
-- L2. AUTHORITATIVE CAMPAIGN TERMINALIZATION
--
-- 'completed' and 'failed' are read as "every recipient has an answer". Setting
-- either while work is queued, leased, awaiting a retry, or -- worst -- sitting in
-- unknown_outcome reports a finished send that nobody can account for.
--
-- The guard is the authority, not the RPC. service_role cannot UPDATE this table
-- at all -- it holds SELECT only -- but the owner can, and every SECURITY DEFINER
-- RPC runs as the owner. So the rule has to survive a direct owner UPDATE of the
-- status column, which is exactly what this suite (running as the owner) writes.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000011',
      '[
        {"email":"terminal.one@local.test","provenance":"staff_entry"},
        {"email":"terminal.two@local.test","provenance":"staff_entry"}
      ]'::jsonb
    )
  $$,
  'the terminalization campaign builds a two-recipient audience'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000011', 2
    )->>'attemptsEnqueued'
  ),
  '2',
  'the terminalization campaign enqueues both recipients'
);

-- QUEUED WORK BLOCKS COMPLETION, and it blocks a direct UPDATE just as hard.
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET status = 'completed', completed_at = now()
    WHERE id = 'bd400000-0000-4000-8000-000000000011'
  $$,
  '23514',
  'This CSF campaign still has 2 dispatch attempt(s) queued, leased, or awaiting a retry and cannot be marked "completed" yet.',
  'a campaign with queued work cannot be marked completed, not even by a direct update'
);

SELECT extensions.is(
  (
    SELECT (result->>'terminalized') || '|' || (result->>'blockedBy')
      || '|' || (result->>'liveAttempts')
    FROM (
      SELECT plugin_data.csf_finalize_communication_campaign(
        'bd100000-0000-4000-8000-000000000001',
        'bd400000-0000-4000-8000-000000000011'
      ) AS result
    ) AS finalization
  ),
  'false|live_attempts|2',
  'the finalizer reports queued work as a result rather than terminalizing or raising'
);

-- PROCESSING WORK BLOCKS COMPLETION.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000011', 'worker-11', 1, 120
    )->>'claimedCount'
  ),
  '1',
  'one terminalization recipient is leased'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET status = 'failed', completed_at = now()
    WHERE id = 'bd400000-0000-4000-8000-000000000011'
  $$,
  '23514',
  'This CSF campaign still has 2 dispatch attempt(s) queued, leased, or awaiting a retry and cannot be marked "failed" yet.',
  'a campaign with one leased and one queued attempt cannot be marked failed either'
);

-- A RETRYABLE FAILURE IS LIVE WORK: a successor attempt is expected.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000011'
          AND attempt.state = 'processing'
        LIMIT 1
      ),
      'worker-11', 'retryable_failure', NULL, 429, 'rate_limited',
      'Provider asked us to slow down.', 60, 5
    )->>'retryEnqueued'
  ),
  'true',
  'an observed retryable failure schedules exactly one successor attempt'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET status = 'completed', completed_at = now()
    WHERE id = 'bd400000-0000-4000-8000-000000000011'
  $$,
  '23514',
  'This CSF campaign still has 2 dispatch attempt(s) queued, leased, or awaiting a retry and cannot be marked "completed" yet.',
  'a campaign awaiting a scheduled retry cannot be marked completed'
);

-- AN UNKNOWN OUTCOME BLOCKS COMPLETION AND SAYS SO OUT LOUD.
--
-- The successor attempt is claimed and honestly reported as unknown; the second
-- recipient is settled cleanly. Both attempts are then settled, but one of them
-- nobody can account for.
UPDATE plugin_data.csf_communication_dispatch_attempts
SET available_at = now() - interval '1 minute'
WHERE campaign_id = 'bd400000-0000-4000-8000-000000000011'
  AND state = 'queued';

SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000011', 'worker-12', 25, 120
    )->>'claimedCount'
  ),
  '2',
  'the retry successor and the remaining recipient are both claimed'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000011'
          AND attempt.state = 'processing'
          AND snapshot.normalized_recipient_email = 'terminal.one@local.test'
        LIMIT 1
      ),
      'worker-12', 'unknown_outcome', NULL, NULL, 'timeout',
      'No answer from the provider.'
    )->>'requiresHumanReview'
  ),
  'true',
  'the retried recipient settles as an unknown outcome'
);

CREATE TEMP TABLE t_terminal_second AS
SELECT plugin_data.csf_authorize_communication_dispatch(
  'bd100000-0000-4000-8000-000000000001',
  (
    SELECT attempt.id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
    WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000011'
      AND attempt.state = 'processing'
      AND snapshot.normalized_recipient_email = 'terminal.two@local.test'
    LIMIT 1
  ),
  'worker-12'
) AS result;

SELECT extensions.is(
  (SELECT result->>'authorized' FROM t_terminal_second),
  'true',
  'the second terminalization recipient is authorized for dispatch'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_settle_communication_dispatch_attempt(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
          ON snapshot.id = attempt.recipient_snapshot_id
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000011'
          AND attempt.state = 'processing'
          AND snapshot.normalized_recipient_email = 'terminal.two@local.test'
        LIMIT 1
      ),
      'worker-12', 'accepted', 'resend-message-terminal-two'
    )->>'deliveryStatus'
  ),
  'sent',
  'the second terminalization recipient is accepted by the provider'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET status = 'completed', completed_at = now()
    WHERE id = 'bd400000-0000-4000-8000-000000000011'
  $$,
  '23514',
  'This CSF campaign still has 1 dispatch attempt(s) with an unknown provider outcome; resolve or reconcile them before marking it "completed".',
  'a campaign with one unaccounted-for recipient cannot be marked completed'
);

SELECT extensions.is(
  (
    SELECT (result->>'terminalized') || '|' || (result->>'blockedBy')
      || '|' || (result->>'reviewBlocked') || '|' || (result->>'unknownAttempts')
    FROM (
      SELECT plugin_data.csf_finalize_communication_campaign(
        'bd100000-0000-4000-8000-000000000001',
        'bd400000-0000-4000-8000-000000000011'
      ) AS result
    ) AS finalization
  ),
  'false|unknown_outcomes|true|1',
  'an unknown outcome keeps the campaign nonterminal and visibly review-blocked'
);

SELECT extensions.is(
  (
    SELECT (review_blocked_at IS NOT NULL)::text || '|' || status
    FROM plugin_data.csf_communication_campaigns
    WHERE id = 'bd400000-0000-4000-8000-000000000011'
  ),
  'true|sending',
  'the review block is visible on the campaign row itself, not only in an RPC result'
);

-- ONLY WHOLLY SETTLED EVIDENCE TERMINALIZES.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_reconcile_communication_unknown_outcome(
      'bd100000-0000-4000-8000-000000000001',
      (
        SELECT attempt.id
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.campaign_id = 'bd400000-0000-4000-8000-000000000011'
          AND attempt.state = 'unknown_outcome'
        LIMIT 1
      ),
      'failed', 'Provider support confirmed it never left.', NULL,
      'bd000000-0000-4000-8000-000000000001'
    )->>'resolution'
  ),
  'failed',
  'the unaccounted-for recipient is finally reconciled by an authorized officer'
);

CREATE TEMP TABLE t_terminalize AS
SELECT plugin_data.csf_finalize_communication_campaign(
  'bd100000-0000-4000-8000-000000000001',
  'bd400000-0000-4000-8000-000000000011'
) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'terminalized') || '|' || (result->>'status')
      || '|' || (result->>'succeededDeliveries')
      || '|' || (result->>'failedDeliveries')
      || '|' || (result->>'reviewBlocked')
    FROM t_terminalize
  ),
  'true|completed|1|1|false',
  'the finalizer terminalizes only once every recipient attempt and delivery is settled'
);

SELECT extensions.is(
  (
    SELECT status || '|' || (completed_at IS NOT NULL)::text
      || '|' || (review_blocked_at IS NULL)::text
    FROM plugin_data.csf_communication_campaigns
    WHERE id = 'bd400000-0000-4000-8000-000000000011'
  ),
  'completed|true|true',
  'terminalization records the completion and lifts the review block it had earned'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_campaign(
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000011'
    )->>'idempotentReplay'
  ),
  'true',
  'replaying terminalization on a settled campaign is idempotent'
);

-- ---------------------------------------------------------------------------
-- M. Attempt ledger uniqueness
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_dispatch_attempts (
      organization_id, campaign_id, recipient_snapshot_id, delivery_id,
      attempt_number, provider_idempotency_key, content_hash,
      request_payload_hash, recipient_email_hash
    )
    SELECT
      'bd100000-0000-4000-8000-000000000002',
      delivery.campaign_id, delivery.recipient_snapshot_id, delivery.id,
      1, NULL, repeat('1', 64), repeat('1', 64), repeat('a', 64)
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.provider_message_id = 'resend-message-a'
  $$,
  '23503',
  'The CSF delivery for this dispatch attempt does not exist in this organization.',
  'an attempt cannot attach to a delivery in another organization'
);

SELECT extensions.is(
  (
    SELECT count(DISTINCT provider_idempotency_key)::integer = count(*)::integer
    FROM plugin_data.csf_communication_dispatch_attempts
  ),
  true,
  'every allocated provider idempotency key is distinct'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_communication_dispatch_attempts'::regclass
      AND conname = 'csf_communication_dispatch_attempts_coordinate_key'
      AND contype = 'u'
  ),
  'attempt coordinates are unique per organization, campaign, recipient, and attempt number'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_communication_dispatch_attempts'::regclass
      AND conname = 'csf_communication_dispatch_attempts_provider_idempotency_key'
      AND contype = 'u'
  ),
  'the provider idempotency key is unique beyond any provider retention window'
);

-- ---------------------------------------------------------------------------
-- N1. WEBHOOK QUARANTINE: EXACT REPLAY, IMMUTABLE CONFLICT, AND POISON
--
-- Resend retries every non-200 response, so a signed event we keep refusing comes
-- back forever while nothing is ever written. The quarantine is how a fault becomes
-- durable enough to answer 200 for -- which means its own replay semantics have to
-- be exactly right. An envelope id is chosen by the sender of the request, and the
-- row's whole evidential value is the raw-body digest and the claimed coordinates,
-- so folding a DIFFERENT digest into an existing row's counter would assert "we saw
-- this same fault again" about a body nobody ever saw.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE t_quarantine_first AS
SELECT plugin_data.csf_quarantine_communication_webhook(
  'msg_2synthetic_quarantine_0001',
  repeat('b', 64),
  'unroutable_tenant',
  'signed CSF event carried a missing or malformed organization tag',
  'email.delivered',
  'resend-message-quarantined',
  NULL, NULL, NULL
) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'firstCapture') || '|' || (result->>'occurrenceCount')
      || '|' || (result->>'exactReplay') || '|' || (result->>'conflict')
      || '|' || (result->>'durable')
    FROM t_quarantine_first
  ),
  'true|1|false|false|true',
  'the first capture of an unroutable signed event is recorded durably'
);

SELECT extensions.is(
  (
    SELECT (quarantine.organization_id IS NULL)::text
      || '|' || (quarantine.claimed_organization_id IS NULL)::text
      || '|' || quarantine.reason_code
      || '|' || quarantine.raw_body_hash
    FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
    WHERE quarantine.provider_event_id = 'msg_2synthetic_quarantine_0001'
      AND quarantine.reason_code = 'unroutable_tenant'
  ),
  'true|true|unroutable_tenant|' || repeat('b', 64),
  'an unroutable event stays tenant-less until evidence proves an organization'
);

-- EXACT REPLAY. Same envelope, same reason, same digest, same claimed coordinates.
SELECT extensions.is(
  (
    SELECT (result->>'exactReplay') || '|' || (result->>'occurrenceCount')
      || '|' || (result->>'conflict') || '|' || (result->>'firstCapture')
    FROM (
      SELECT plugin_data.csf_quarantine_communication_webhook(
        'msg_2synthetic_quarantine_0001',
        repeat('b', 64),
        'unroutable_tenant',
        'signed CSF event carried a missing or malformed organization tag',
        'email.delivered',
        'resend-message-quarantined',
        NULL, NULL, NULL
      ) AS result
    ) AS replay
  ),
  'true|2|false|false',
  'an exact provider retry increments the counter instead of growing the table'
);

-- IMMUTABLE CONFLICT. Same envelope and reason, DIFFERENT raw body digest.
SELECT extensions.is(
  (
    SELECT (result->>'conflict') || '|' || (result->>'reasonCode')
      || '|' || (result->>'exactReplay') || '|' || (result->>'durable')
    FROM (
      SELECT plugin_data.csf_quarantine_communication_webhook(
        'msg_2synthetic_quarantine_0001',
        repeat('c', 64),
        'unroutable_tenant',
        'signed CSF event carried a missing or malformed organization tag',
        'email.delivered',
        'resend-message-quarantined',
        NULL, NULL, NULL
      ) AS result
    ) AS conflicting
  ),
  'true|conflicting_quarantine_evidence|false|true',
  'a differing raw body digest becomes its own conflicting-evidence row, never a merged counter'
);

SELECT extensions.is(
  (
    SELECT quarantine.occurrence_count::text || '|' || quarantine.raw_body_hash
    FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
    WHERE quarantine.provider_event_id = 'msg_2synthetic_quarantine_0001'
      AND quarantine.reason_code = 'unroutable_tenant'
  ),
  '2|' || repeat('b', 64),
  'the prior evidence is left exactly as it was recorded'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
    WHERE quarantine.provider_event_id = 'msg_2synthetic_quarantine_0001'
  ),
  2,
  'both the original fault and the conflicting evidence survive as separate rows'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_webhook_quarantine
    SET raw_body_hash = repeat('d', 64)
    WHERE provider_event_id = 'msg_2synthetic_quarantine_0001'
      AND reason_code = 'unroutable_tenant'
  $$,
  '23514',
  'CSF webhook quarantine evidence is append-only.',
  'quarantined evidence can never be rewritten, not even by the owner'
);

-- CSF POISON THAT IS SHAPELESS OR UNMODELLED IS STILL OURS.
SELECT extensions.is(
  (
    SELECT (result->>'reasonCode') || '|' || (result->>'firstCapture')
      || '|' || (result->>'durable')
    FROM (
      SELECT plugin_data.csf_quarantine_communication_webhook(
        'msg_2synthetic_quarantine_0002',
        repeat('e', 64),
        'malformed_event_shape',
        'signed CSF event carried no usable event type',
        NULL, NULL,
        'bd100000-0000-4000-8000-000000000001', NULL, NULL
      ) AS result
    ) AS malformed
  ),
  'malformed_event_shape|true|true',
  'a signed CSF event with no usable type is captured rather than discarded as somebody else traffic'
);

SELECT extensions.is(
  (
    SELECT (result->>'reasonCode') || '|' || (result->>'firstCapture')
    FROM (
      SELECT plugin_data.csf_quarantine_communication_webhook(
        'msg_2synthetic_quarantine_0003',
        repeat('f', 64),
        'unsupported_event_shape',
        'signed CSF event type "email.synthetic_unmodelled" is not modelled by this ledger',
        'email.synthetic_unmodelled', NULL,
        'bd100000-0000-4000-8000-000000000001', NULL, NULL
      ) AS result
    ) AS unsupported
  ),
  'unsupported_event_shape|true',
  'a signed CSF event of an unmodelled type lands on a worklist instead of silently doing nothing'
);

SELECT extensions.is(
  (
    SELECT (quarantine.organization_id IS NOT NULL)::text
      || '|' || (quarantine.event_type IS NULL)::text
    FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
    WHERE quarantine.provider_event_id = 'msg_2synthetic_quarantine_0002'
  ),
  'true|true',
  'a claimed tenant that really exists is linked, and a missing event type stays null rather than invented'
);

-- BOUNDED INPUT. The envelope id and the digest are the two things the route may
-- not get wrong, so both are refused at the boundary rather than stored malformed.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_quarantine_communication_webhook(
      'msg with whitespace', repeat('b', 64), 'unroutable_tenant'
    )
  $$,
  '22023',
  'A CSF webhook quarantine record requires the verified envelope id, without whitespace and at most 255 characters.',
  'a whitespace-bearing envelope id is refused rather than quarantined'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_quarantine_communication_webhook(
      'msg_2synthetic_quarantine_0004', 'not-a-sha256', 'unroutable_tenant'
    )
  $$,
  '22023',
  'A CSF webhook quarantine record requires the SHA-256 of the exact verified raw request body.',
  'a quarantine record without the verified raw body digest is refused'
);

-- THE REASON IS REFUSED AT THE ARGUMENT, NOT BY THE TABLE CHECK.
--
-- This used to assert the CHECK violation, which meant an unmodelled reason
-- reached the route as a constraint error indistinguishable from a storage fault
-- -- so the route answered 503 and Resend retried a request that could never
-- succeed. A named 22023 says which input was wrong, and it fires before any lock
-- is taken. The CHECK stays as the last line of defence; it is simply no longer
-- the first.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_quarantine_communication_webhook(
      'msg_2synthetic_quarantine_0005', repeat('b', 64), 'invented_reason_code'
    )
  $$,
  '22023',
  'A CSF webhook quarantine reason must be one of the closed route-emitted codes; "conflicting_quarantine_evidence" is authored by this function alone.',
  'a route cannot invent a quarantine reason nobody triages'
);

-- THE CONFLICT REASON IS THE DATABASE'S TO AUTHOR, NOT A CALLER'S TO CLAIM.
--
-- It is in the table CHECK, so without this refusal a caller could write one
-- directly -- asserting that two bodies were compared and found to differ when
-- nothing of the kind happened. The only way to produce this reason is the
-- serialized compare-then-act path that actually proves the mismatch.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_quarantine_communication_webhook(
      'msg_2synthetic_quarantine_0006', repeat('b', 64),
      'conflicting_quarantine_evidence'
    )
  $$,
  '22023',
  'A CSF webhook quarantine reason must be one of the closed route-emitted codes; "conflicting_quarantine_evidence" is authored by this function alone.',
  'the conflicting-evidence reason cannot be claimed by a caller, only authored by the compare-then-act path'
);

-- ---------------------------------------------------------------------------
-- N1b. THE CONFLICT RECORD HAS ITS OWN REPLAY SEMANTICS
--
-- The conflict row is reached by a second coordinate, under a second advisory
-- lock, and it needs the same compare-then-act discipline as the first: an
-- identical conflicting body must count, and a THIRD distinct body must not be
-- silently absorbed as though it were the one on file.
--
-- The unique key is (provider, envelope, reason), so there is no third row to put
-- a third digest in. That bound is real and is reported rather than hidden --
-- digestRetained tells an operator whether the stored digest is the one this call
-- carried, which is the difference between "the record describes your body" and
-- "the record counts your body".
-- ---------------------------------------------------------------------------

-- The SAME conflicting digest again. Identical evidence, so it counts.
SELECT extensions.is(
  (
    SELECT (result->>'reasonCode') || '|' || (result->>'occurrenceCount')
      || '|' || (result->>'digestRetained') || '|' || (result->>'firstCapture')
    FROM (
      SELECT plugin_data.csf_quarantine_communication_webhook(
        'msg_2synthetic_quarantine_0001',
        repeat('c', 64),
        'unroutable_tenant',
        'signed CSF event carried a missing or malformed organization tag',
        'email.delivered',
        'resend-message-quarantined',
        NULL, NULL, NULL
      ) AS result
    ) AS repeated_conflict
  ),
  'conflicting_quarantine_evidence|2|true|false',
  'an identical conflicting replay increments the conflict record and still describes the body it holds'
);

-- A THIRD, DIFFERENT digest under the same envelope and reason.
SELECT extensions.is(
  (
    SELECT (result->>'reasonCode') || '|' || (result->>'occurrenceCount')
      || '|' || (result->>'digestRetained')
    FROM (
      SELECT plugin_data.csf_quarantine_communication_webhook(
        'msg_2synthetic_quarantine_0001',
        repeat('9', 64),
        'unroutable_tenant',
        'signed CSF event carried a missing or malformed organization tag',
        'email.delivered',
        'resend-message-quarantined',
        NULL, NULL, NULL
      ) AS result
    ) AS third_body
  ),
  'conflicting_quarantine_evidence|3|false',
  'a third distinct body is counted honestly rather than passed off as the digest on file'
);

-- BOTH FROZEN DIGESTS ARE STILL EXACTLY WHAT WAS FIRST WRITTEN.
SELECT extensions.is(
  (
    SELECT string_agg(
      quarantine.reason_code || ':' || quarantine.raw_body_hash
        || ':' || quarantine.occurrence_count::text,
      ',' ORDER BY quarantine.reason_code
    )
    FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
    WHERE quarantine.provider_event_id = 'msg_2synthetic_quarantine_0001'
  ),
  'conflicting_quarantine_evidence:' || repeat('c', 64) || ':3'
    || ',unroutable_tenant:' || repeat('b', 64) || ':2',
  'neither row ever rewrites the digest it was created with, whatever replays after'
);

-- A COORDINATE MISMATCH IS A MISMATCH TOO, not only a differing digest. The
-- claimed tenant is evidence about who the sender says this event was for, and
-- folding two different claims into one counter would erase that.
SELECT extensions.is(
  (
    SELECT (result->>'conflict') || '|' || (result->>'reasonCode')
    FROM (
      SELECT plugin_data.csf_quarantine_communication_webhook(
        'msg_2synthetic_quarantine_0002',
        repeat('e', 64),
        'malformed_event_shape',
        'signed CSF event carried no usable event type',
        NULL, NULL,
        'bd100000-0000-4000-8000-000000000002', NULL, NULL
      ) AS result
    ) AS reclaimed
  ),
  'true|conflicting_quarantine_evidence',
  'the same envelope, reason, and digest under a DIFFERENT claimed tenant is a conflict, not a repeat'
);

-- AND THE ORIGINAL CLAIM WAS NOT REASSIGNED. This is the assertion that would
-- have failed had the mismatch been folded into the first row's counter.
SELECT extensions.is(
  (
    SELECT quarantine.claimed_organization_id::text
      || '|' || quarantine.occurrence_count::text
    FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
    WHERE quarantine.provider_event_id = 'msg_2synthetic_quarantine_0002'
      AND quarantine.reason_code = 'malformed_event_shape'
  ),
  'bd100000-0000-4000-8000-000000000001|1',
  'the first capture keeps the tenant it was claimed for and is not counted up by a different claim'
);

-- ---------------------------------------------------------------------------
-- N2. DIRECT MUTATION IS DENIED, FULL TUPLE OR NOT
--
-- A trigger that validates a complete-looking tuple is not authorization. These
-- statements are deliberately COMPLETE and internally coherent -- every column a
-- guard inspects is populated with a plausible value -- so what refuses them is the
-- missing privilege, not a shape check. They run as service_role, because the suite
-- otherwise runs as the database owner, which bypasses grants entirely.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE service_role;

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, sender_name, sender_email,
      reply_to_email, subject, body_text, body_html, body_text_hash, term_id,
      audience_kind, broadcast_topic_key, resend_topic_id, created_by_identity,
      content_finalized_at, content_finalized_by_identity,
      audience_snapshot_version, provider_idempotency_key
    ) VALUES (
      'bd400000-0000-4000-8000-0000000000f1',
      'bd100000-0000-4000-8000-000000000001', 'broadcast', 'queued', 'DVHS CSF',
      'csf@notifications.lets-assist.com', 'dvhighcsf@gmail.com',
      'Forged campaign', 'Forged body.', '<p>Forged.</p>', repeat('a', 64),
      'bd200000-0000-4000-8000-000000000001', 'term_members', 'partner_clubs',
      'topic_synthetic_term_bulletin', 'csf-officer@local.test', now(),
      'csf-officer@local.test', 1, 'forged-campaign-key'
    )
  $$,
  '42501',
  'permission denied for table csf_communication_campaigns',
  'a complete, coherent campaign tuple cannot be forged directly by the server role'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_dispatch_attempts (
      organization_id, campaign_id, recipient_snapshot_id, delivery_id,
      attempt_number, state, provider_idempotency_key, content_hash,
      request_payload_hash, recipient_email_hash, settlement_source, settled_at,
      provider_message_id, dispatch_authorized_at, dispatch_authorized_to
    )
    SELECT
      delivery.organization_id, delivery.campaign_id,
      delivery.recipient_snapshot_id, delivery.id, 99, 'accepted',
      'forged-idempotency-key', repeat('a', 64), repeat('b', 64), repeat('c', 64),
      'worker', now(), 'forged-provider-message', now(), 'forged-worker'
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.campaign_id = 'bd400000-0000-4000-8000-000000000016'
  $$,
  '42501',
  'permission denied for table csf_communication_dispatch_attempts',
  'a complete accepted-looking dispatch attempt cannot be forged directly by the server role'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_deliveries (
      organization_id, campaign_id, recipient_snapshot_id, provider_idempotency_key,
      status, queued_at, sent_at, provider_message_id, attempt_count
    )
    SELECT
      snapshot.organization_id, snapshot.campaign_id, snapshot.id,
      'forged-delivery-key', 'sent', now(), now(), 'forged-delivery-message', 1
    FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
    WHERE snapshot.campaign_id = 'bd400000-0000-4000-8000-000000000016'
  $$,
  '42501',
  'permission denied for table csf_communication_deliveries',
  'a complete sent-looking delivery cannot be forged directly by the server role'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_provider_events (
      organization_id, provider, provider_event_id, event_type,
      provider_message_id, occurred_at, provider_occurred_at, received_at,
      payload_hash, metadata, signature_verified, signature_verified_at,
      signature_scheme, signature_key_id, processing_state
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'resend', 'evt_forged_0001',
      'email.delivered', 'forged-event-message', now(), now(), now(),
      repeat('a', 64), '{}'::jsonb, true, now(), 'svix', 'whsec_forged', 'pending'
    )
  $$,
  '42501',
  'permission denied for table csf_communication_provider_events',
  'a signature-verified-looking provider event cannot be forged directly by the server role'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_recipient_snapshots (
      organization_id, campaign_id, snapshot_version, recipient_email,
      subscription_decision, delivery_requirement, topic_key, preference_decision
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001',
      'bd400000-0000-4000-8000-000000000016', 1, 'forged.recipient@local.test',
      'included', 'broadcast', 'partner_clubs', 'allowed'
    )
  $$,
  '42501',
  'permission denied for table csf_communication_recipient_snapshots',
  'an included-looking audience row cannot be forged directly by the server role'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_broadcast_preferences (
      organization_id, topic_key, recipient_email, subscription_state,
      last_decision_at, decision_actor_kind, decision_actor_identity
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'partner_clubs',
      'forged.consent@local.test', 'subscribed', now(), 'recipient',
      'unsubscribe-link'
    )
  $$,
  '42501',
  'permission denied for table csf_communication_broadcast_preferences',
  'a consent record cannot be forged directly by the server role'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_preference_events (
      organization_id, topic_key, normalized_recipient_email,
      recipient_email_hash, decision, decision_source, decided_at, actor_kind,
      actor_identity
    ) VALUES (
      'bd100000-0000-4000-8000-000000000001', 'partner_clubs',
      'forged.consent@local.test', repeat('a', 64), 'unsubscribed',
      'recipient_unsubscribe_link', now(), 'recipient', 'unsubscribe-link'
    )
  $$,
  '42501',
  'permission denied for table csf_communication_preference_events',
  'consent history cannot be forged directly by the server role'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_communication_webhook_quarantine (
      provider, provider_event_id, raw_body_hash, reason_code
    ) VALUES (
      'resend', 'msg_2synthetic_quarantine_forged', repeat('a', 64),
      'unroutable_tenant'
    )
  $$,
  '42501',
  'permission denied for table csf_communication_webhook_quarantine',
  'quarantine evidence cannot be written directly by the server role'
);

-- UPDATE IS THE OTHER HALF. A forged tuple and a rewritten one are the same
-- failure with different syntax.
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_campaigns
    SET status = 'completed', completed_at = now(),
        review_blocked_at = NULL, review_blocked_reason = NULL
    WHERE id = 'bd400000-0000-4000-8000-000000000013'
  $$,
  '42501',
  'permission denied for table csf_communication_campaigns',
  'the server role cannot declare a review-blocked campaign complete with a bare update'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_dispatch_attempts
    SET state = 'accepted', review_state = 'resolved'
    WHERE campaign_id = 'bd400000-0000-4000-8000-000000000013'
  $$,
  '42501',
  'permission denied for table csf_communication_dispatch_attempts',
  'the server role cannot turn a contradicted attempt into an acceptance with a bare update'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_communication_deliveries
    SET status = 'sent', sent_at = now()
    WHERE campaign_id = 'bd400000-0000-4000-8000-000000000013'
  $$,
  '42501',
  'permission denied for table csf_communication_deliveries',
  'the server role cannot record a send on an escalated delivery with a bare update'
);

-- READS STAY OPEN. Dispatch, review screens, and the decision helpers all need
-- them, so the boundary is write-only and this proves it is not a blanket denial.
SELECT extensions.ok(
  (
    SELECT count(*)
    FROM plugin_data.csf_communication_dispatch_attempts
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
  ) > 0,
  'the server role can still read every ledger it needs to dispatch and triage from'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- N. Purge and retention
-- ---------------------------------------------------------------------------

-- THESE TWO CASES MUST ACTUALLY RUN AS service_role.
--
-- Run as the database owner they proved nothing: the owner bypasses grant checks
-- entirely, so the first reported a trigger message instead of a permission error,
-- and the second -- with the teardown GUC set -- actually SUCCEEDED and wiped the
-- attempt ledger. The purge assertion below then "passed" against an already-empty
-- table, which is how a real regression could have hidden here indefinitely.
SET LOCAL ROLE service_role;

SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_communication_dispatch_attempts
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table csf_communication_dispatch_attempts',
  'attempt history cannot be deleted by the server role at all'
);

-- Even holding the teardown GUC, the server role cannot delete: the boundary is
-- the missing privilege, not the flag.
SELECT set_config(
  'plugin_data.csf_recovery_purge_organization',
  'bd100000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_communication_dispatch_attempts
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table csf_communication_dispatch_attempts',
  'setting the teardown flag directly grants no deletion power whatsoever'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_communication_address_safety
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table csf_communication_address_safety',
  'the server role cannot delete an address-safety record either'
);

RESET ROLE;

SELECT set_config('plugin_data.csf_recovery_purge_organization', '', true);

-- A REAL SERVICE-ROLE DENIAL LEAVES THE WORK FOR THE AUTHORIZED PURGE TO RETIRE.
SELECT extensions.ok(
  (
    SELECT count(*)
    FROM plugin_data.csf_communication_dispatch_attempts
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
  ) > 0,
  'the refused deletions left the attempt ledger intact for the authorized purge'
);

-- SECTION P2: A RELEASED ADDRESS IS STILL SUPPRESSIBLE
--
-- The release columns are the CURRENT release state; the append-only event rows are
-- the history. Two rules used to contradict each other here -- the applier clears the
-- release columns when a newer suppression lands, and the transition guard refused any
-- rewrite of them -- so the entire suppress -> release -> new hard bounce path raised
-- instead of re-blocking. A recipient whose mailbox died after a release would have
-- kept receiving mail. These assertions are the executable statement of the fix, and
-- they also pin that the release evidence survives in the event log.

SELECT plugin_data.csf_apply_communication_address_safety(
  'bd100000-0000-4000-8000-000000000001',
  'resuppressible@local.test',
  'bounce',
  'synthetic hard bounce before release',
  now() - interval '3 hours',
  'evt_resup_hard_0001',
  'provider',
  NULL,
  'corr-resup-0001',
  'Permanent'
);

SELECT extensions.is(
  (
    SELECT safety_state || '|' || suppression_kind
    FROM plugin_data.csf_communication_address_safety
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND recipient_email = 'resuppressible@local.test'
  ),
  'suppressed|indefinite',
  'a synthetic permanent bounce indefinitely suppresses the address'
);

SELECT plugin_data.csf_release_communication_address_safety(
  'bd100000-0000-4000-8000-000000000001',
  'resuppressible@local.test',
  'synthetic officer release for the re-suppression probe',
  'bd000000-0000-4000-8000-000000000001',
  'corr-resup-release-0001'
);

SELECT extensions.is(
  (
    SELECT safety_state || '|' || (released_at IS NOT NULL)::text
      || '|' || (suppressed_at IS NOT NULL)::text
    FROM plugin_data.csf_communication_address_safety
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND recipient_email = 'resuppressible@local.test'
  ),
  'safe|true|true',
  'the release makes the address safe while keeping the suppression evidence that preceded it'
);

-- THE CASE THAT USED TO RAISE. A released address draws a fresh hard bounce.
SELECT extensions.lives_ok(
  $releaseresup$
  SELECT plugin_data.csf_apply_communication_address_safety(
    'bd100000-0000-4000-8000-000000000001',
    'resuppressible@local.test',
    'bounce',
    'synthetic hard bounce after release',
    now() - interval '1 hour',
    'evt_resup_hard_0002',
    'provider',
    NULL,
    'corr-resup-0002',
    'Permanent'
  )
  $releaseresup$,
  'a released address that bounces again is re-suppressed rather than raising'
);

SELECT extensions.is(
  (
    SELECT safety_state || '|' || suppression_kind
      || '|' || (released_at IS NULL)::text
    FROM plugin_data.csf_communication_address_safety
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND recipient_email = 'resuppressible@local.test'
  ),
  'suppressed|indefinite|true',
  'the later bounce supersedes the release and re-suppresses the address indefinitely'
);

-- THE RELEASE IS NOT ERASED. Clearing the projection columns is not deleting history:
-- the release event row is still there, which is what makes the supersede safe.
SELECT extensions.is(
  (
    SELECT count(*)
    FROM plugin_data.csf_communication_address_safety_events
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND normalized_recipient_email = 'resuppressible@local.test'
      AND event_class = 'release'
  )::integer,
  1,
  'the superseded release survives as append-only event evidence'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM plugin_data.csf_communication_address_safety_events
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND normalized_recipient_email = 'resuppressible@local.test'
  )::integer,
  3,
  'the whole suppress, release, re-suppress lifecycle is three append-only events'
);

-- A COMPLAINT AFTER A RELEASE. Same path, different class.
SELECT plugin_data.csf_apply_communication_address_safety(
  'bd100000-0000-4000-8000-000000000001',
  'resup.complaint@local.test',
  'bounce',
  'synthetic hard bounce before the complaint probe',
  now() - interval '4 hours',
  'evt_resup_comp_0001',
  'provider',
  NULL,
  'corr-resup-comp-0001',
  'Permanent'
);

SELECT plugin_data.csf_release_communication_address_safety(
  'bd100000-0000-4000-8000-000000000001',
  'resup.complaint@local.test',
  'synthetic officer release before the complaint probe',
  'bd000000-0000-4000-8000-000000000001',
  'corr-resup-comp-release'
);

SELECT extensions.lives_ok(
  $resupcomplaint$
  SELECT plugin_data.csf_apply_communication_address_safety(
    'bd100000-0000-4000-8000-000000000001',
    'resup.complaint@local.test',
    'complaint',
    'synthetic complaint after release',
    now(),
    'evt_resup_comp_0002',
    'provider',
    NULL,
    'corr-resup-comp-0002',
    NULL
  )
  $resupcomplaint$,
  'a released address that complains is re-suppressed rather than raising'
);

SELECT extensions.is(
  (
    SELECT safety_state || '|' || suppression_class || '|' || suppression_kind
    FROM plugin_data.csf_communication_address_safety
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND normalized_recipient_email = 'resup.complaint@local.test'
  ),
  'suppressed|complaint|indefinite',
  'the post-release complaint records its own class rather than inheriting the stale bounce class'
);

-- A SOFT BOUNCE AFTER A RELEASE. This is the case the severity-monotonic rule broke:
-- the pre-release kind was more severe than an expiring hold, so comparing against it
-- refused the new, milder block outright. A released address starts fresh.
SELECT plugin_data.csf_apply_communication_address_safety(
  'bd100000-0000-4000-8000-000000000001',
  'resup.soft@local.test',
  'bounce',
  'synthetic hard bounce before the soft probe',
  now() - interval '5 hours',
  'evt_resup_soft_0001',
  'provider',
  NULL,
  'corr-resup-soft-0001',
  'Permanent'
);

SELECT plugin_data.csf_release_communication_address_safety(
  'bd100000-0000-4000-8000-000000000001',
  'resup.soft@local.test',
  'synthetic officer release before the soft probe',
  'bd000000-0000-4000-8000-000000000001',
  'corr-resup-soft-release'
);

SELECT extensions.lives_ok(
  $resupsoft$
  SELECT plugin_data.csf_apply_communication_address_safety(
    'bd100000-0000-4000-8000-000000000001',
    'resup.soft@local.test',
    'bounce',
    'synthetic transient bounce after release',
    now(),
    'evt_resup_soft_0002',
    'provider',
    NULL,
    'corr-resup-soft-0002',
    'Transient'
  )
  $resupsoft$,
  'a released address that softly bounces is held rather than refused for being milder than the lifted block'
);

SELECT extensions.is(
  (
    SELECT safety_state || '|' || suppression_kind
      || '|' || (hold_expires_at IS NOT NULL)::text
      || '|' || (terminal_locked_at IS NULL)::text
    FROM plugin_data.csf_communication_address_safety
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND recipient_email = 'resup.soft@local.test'
  ),
  'suppressed|expiring|true|true',
  'the post-release soft bounce becomes an expiring hold and does not terminally lock the address'
);

-- STILL MONOTONIC WHILE THE BLOCK IS LIVE. Relaxing the rule across a release must not
-- relax it inside one: a transient bounce cannot soften a live indefinite suppression.
SELECT plugin_data.csf_apply_communication_address_safety(
  'bd100000-0000-4000-8000-000000000001',
  'resup.monotonic@local.test',
  'bounce',
  'synthetic hard bounce that stays live',
  now() - interval '2 hours',
  'evt_resup_mono_0001',
  'provider',
  NULL,
  'corr-resup-mono-0001',
  'Permanent'
);

SELECT plugin_data.csf_apply_communication_address_safety(
  'bd100000-0000-4000-8000-000000000001',
  'resup.monotonic@local.test',
  'bounce',
  'synthetic transient bounce against a live indefinite block',
  now(),
  'evt_resup_mono_0002',
  'provider',
  NULL,
  'corr-resup-mono-0002',
  'Transient'
);

SELECT extensions.is(
  (
    SELECT safety_state || '|' || suppression_kind
      || '|' || (hold_expires_at IS NULL)::text
    FROM plugin_data.csf_communication_address_safety
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND recipient_email = 'resup.monotonic@local.test'
  ),
  'suppressed|indefinite|true',
  'a transient bounce never softens a live indefinite suppression into an expiring hold'
);

-- A PROVIDER SUPPRESSION AFTER A RELEASE. This one IS terminal, so it must both
-- supersede the release and lock the address against a second release.
SELECT plugin_data.csf_apply_communication_address_safety(
  'bd100000-0000-4000-8000-000000000001',
  'resup.provider@local.test',
  'bounce',
  'synthetic hard bounce before the provider suppression probe',
  now() - interval '6 hours',
  'evt_resup_prov_0001',
  'provider',
  NULL,
  'corr-resup-prov-0001',
  'Permanent'
);

SELECT plugin_data.csf_release_communication_address_safety(
  'bd100000-0000-4000-8000-000000000001',
  'resup.provider@local.test',
  'synthetic officer release before the provider suppression probe',
  'bd000000-0000-4000-8000-000000000001',
  'corr-resup-prov-release'
);

SELECT extensions.lives_ok(
  $resupprovider$
  SELECT plugin_data.csf_apply_communication_address_safety(
    'bd100000-0000-4000-8000-000000000001',
    'resup.provider@local.test',
    'provider_suppression',
    'synthetic provider suppression after release',
    now(),
    'evt_resup_prov_0002',
    'provider',
    NULL,
    'corr-resup-prov-0002',
    NULL
  )
  $resupprovider$,
  'a released address the provider then suppresses is re-suppressed rather than raising'
);

SELECT extensions.is(
  (
    SELECT safety_state || '|' || suppression_class
      || '|' || (released_at IS NULL)::text
      || '|' || (terminal_locked_at IS NOT NULL)::text
    FROM plugin_data.csf_communication_address_safety
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND recipient_email = 'resup.provider@local.test'
  ),
  'suppressed|provider_suppression|true|true',
  'the post-release provider suppression supersedes the release and terminally locks the address'
);

-- AND THE TERMINAL LOCK HOLDS. A second release must now be refused outright.
SELECT extensions.throws_ok(
  $resupproviderlock$
  SELECT plugin_data.csf_release_communication_address_safety(
    'bd100000-0000-4000-8000-000000000001',
    'resup.provider@local.test',
    'synthetic second release attempt against a terminal lock',
    'bd000000-0000-4000-8000-000000000001',
    'corr-resup-prov-release-2'
  )
  $resupproviderlock$,
  '23514',
  'That CSF address is terminally locked by a complaint or provider suppression and is never released; the recipient must be reached another way.',
  'a terminally locked address cannot be released a second time'
);

-- A REPLAYED POST-RELEASE BOUNCE IS NOT A SECOND SUPPRESSION.
SELECT extensions.lives_ok(
  $resupreplay$
  SELECT plugin_data.csf_apply_communication_address_safety(
    'bd100000-0000-4000-8000-000000000001',
    'resuppressible@local.test',
    'bounce',
    'synthetic hard bounce after release',
    now() - interval '1 hour',
    'evt_resup_hard_0002',
    'provider',
    NULL,
    'corr-resup-0002',
    'Permanent'
  )
  $resupreplay$,
  'replaying the post-release bounce is accepted without raising'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM plugin_data.csf_communication_address_safety_events
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND normalized_recipient_email = 'resuppressible@local.test'
      AND provider_event_id = 'evt_resup_hard_0002'
  )::integer,
  1,
  'the replayed post-release bounce does not append a duplicate safety event'
);

INSERT INTO plugin_data.csf_communication_broadcast_preferences (
  organization_id, topic_key, recipient_email, subscription_state,
  opt_out_source, opt_out_at
) VALUES (
  'bd100000-0000-4000-8000-000000000002', 'partner_clubs',
  'other.org.optout@local.test', 'unsubscribed', 'staff_action', now()
);

-- ---------------------------------------------------------------------------
-- N5. THE PURGE RETIRES QUARANTINE EVIDENCE ON BOTH TENANT COORDINATES
--
-- plugin_data.csf_purge_durable_communications() deletes quarantine rows matching
-- `organization_id = p_organization_id OR claimed_organization_id =
-- p_organization_id`. Both arms exist for a reason: an unroutable event carries
-- only the CLAIM, so without the second arm an event naming a purged organization
-- would outlive it forever.
--
-- A SINGLE ROW WITH BOTH COLUMNS SET IS NOT AN ORACLE. It is deleted by either arm
-- on its own, so a purge that had lost one would still remove it and the assertion
-- would pass. The two fixtures below each match EXACTLY ONE arm, so a missing arm
-- leaves a row behind and the residue assertions name which coordinate failed.
--
-- A dedicated organization is used because org ...0001 already carries quarantine
-- evidence from N1: "the purge removed 2" is only evidence about these two rows if
-- nothing else here could have supplied them.
-- ---------------------------------------------------------------------------

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'bd100000-0000-4000-8000-000000000003', 'CSF Comms Three', 'csf-comms-three',
  'school', '991003'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
    WHERE quarantine.organization_id = 'bd100000-0000-4000-8000-000000000003'
      OR quarantine.claimed_organization_id = 'bd100000-0000-4000-8000-000000000003'
  )::integer,
  0,
  'the dedicated purge fixture organization starts with no quarantine evidence, so a later count of 2 is about these fixtures alone'
);

-- Written directly rather than through the RPC, deliberately: the RPC derives
-- organization_id FROM claimed_organization_id, so it cannot produce a row where
-- only one of the two names this tenant. The suite runs as the table owner, which
-- is what makes a direct fixture INSERT possible at all -- service_role holds
-- SELECT and nothing else here.
INSERT INTO plugin_data.csf_communication_webhook_quarantine (
  organization_id, provider, provider_event_id, raw_body_hash, reason_code,
  reason_detail, claimed_organization_id, occurrence_count
) VALUES
  (
    'bd100000-0000-4000-8000-000000000003', 'resend',
    'msg_2synthetic_qpurge_linked', repeat('1', 64), 'unroutable_tenant',
    'synthetic fixture linked by organization_id alone', NULL, 1
  ),
  (
    NULL, 'resend',
    'msg_2synthetic_qpurge_claimed', repeat('2', 64), 'malformed_event_shape',
    'synthetic fixture naming the tenant by claimed_organization_id alone',
    'bd100000-0000-4000-8000-000000000003', 1
  );

SELECT extensions.is(
  (
    SELECT count(*)
    FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
    WHERE quarantine.organization_id = 'bd100000-0000-4000-8000-000000000003'
      AND quarantine.claimed_organization_id IS NULL
  )::integer,
  1,
  'exactly one quarantine fixture is reachable by the organization_id arm alone'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
    WHERE quarantine.claimed_organization_id = 'bd100000-0000-4000-8000-000000000003'
      AND quarantine.organization_id IS NULL
  )::integer,
  1,
  'exactly one quarantine fixture is reachable by the claimed_organization_id arm alone'
);

-- THE OVER-DELETE CONTROL. Every quarantine row that does NOT name this tenant --
-- including N1's unroutable capture with no tenant at all, and the rows claiming
-- org ...0001 -- must survive the purge untouched.
CREATE TEMP TABLE t_qpurge_control AS
SELECT count(*)::integer AS unrelated
FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
WHERE quarantine.organization_id
        IS DISTINCT FROM 'bd100000-0000-4000-8000-000000000003'::uuid
  AND quarantine.claimed_organization_id
        IS DISTINCT FROM 'bd100000-0000-4000-8000-000000000003'::uuid;

CREATE TEMP TABLE t_qpurge AS
SELECT plugin_data.csf_purge_recovery_foundations(
  'bd100000-0000-4000-8000-000000000003'
) AS result;

SELECT extensions.is(
  (SELECT (result->>'webhookQuarantine')::integer FROM t_qpurge),
  2,
  'the purge reports both quarantine rows it retired, one per tenant coordinate'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
    WHERE quarantine.organization_id = 'bd100000-0000-4000-8000-000000000003'
  )::integer,
  0,
  'no quarantine row linked by organization_id survives the purge'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
    WHERE quarantine.claimed_organization_id = 'bd100000-0000-4000-8000-000000000003'
  )::integer,
  0,
  'no quarantine row naming the tenant only in claimed_organization_id survives the purge'
);

SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_communication_webhook_quarantine)::integer,
  (SELECT unrelated FROM t_qpurge_control),
  'the purge removed nothing beyond the two rows naming that tenant'
);

-- THE RESULT CONTRACT IS THE KEY NAMES, NOT A COUNT OF THEM.
--
-- The purge documentation used to say "two additional keys", which any two names
-- satisfy. Both directions plus the cardinality, so neither a renamed key nor an
-- extra one passes -- and the cardinality is what stops two empty sets from
-- satisfying both EXCEPTs.
SELECT extensions.ok(
  NOT EXISTS (
    SELECT key FROM jsonb_object_keys((SELECT result FROM t_qpurge)) AS key
    EXCEPT
    SELECT unnest(ARRAY[
      'organizationId', 'dispatchAttempts', 'preferenceDecisionEvents',
      'broadcastPreferences', 'addressSafetyEvents', 'addressSafetyRecords',
      'webhookQuarantine', 'providerEvents', 'deliveries', 'recipientSnapshots',
      'campaigns', 'partnerClubTermEvents', 'partnerClubRepresentatives',
      'calendarProjections'
    ])
  )
  AND NOT EXISTS (
    SELECT unnest(ARRAY[
      'organizationId', 'dispatchAttempts', 'preferenceDecisionEvents',
      'broadcastPreferences', 'addressSafetyEvents', 'addressSafetyRecords',
      'webhookQuarantine', 'providerEvents', 'deliveries', 'recipientSnapshots',
      'campaigns', 'partnerClubTermEvents', 'partnerClubRepresentatives',
      'calendarProjections'
    ])
    EXCEPT
    SELECT key FROM jsonb_object_keys((SELECT result FROM t_qpurge)) AS key
  )
  AND (
    SELECT count(*) FROM jsonb_object_keys((SELECT result FROM t_qpurge))
  ) = 14,
  'plugin_data.csf_purge_recovery_foundations(uuid) returns exactly its fourteen documented keys'
);

-- The owner-only helper, called standalone against the now-empty fixture
-- organization. It saves and restores the teardown flag, which is what makes a
-- standalone call legal; the point here is its own exact seven-key contract.
CREATE TEMP TABLE t_qpurge_helper AS
SELECT plugin_data.csf_purge_durable_communications(
  'bd100000-0000-4000-8000-000000000003'
) AS result;

SELECT extensions.ok(
  NOT EXISTS (
    SELECT key FROM jsonb_object_keys((SELECT result FROM t_qpurge_helper)) AS key
    EXCEPT
    SELECT unnest(ARRAY[
      'organizationId', 'dispatchAttempts', 'preferenceDecisionEvents',
      'broadcastPreferences', 'addressSafetyEvents', 'addressSafetyRecords',
      'webhookQuarantine'
    ])
  )
  AND NOT EXISTS (
    SELECT unnest(ARRAY[
      'organizationId', 'dispatchAttempts', 'preferenceDecisionEvents',
      'broadcastPreferences', 'addressSafetyEvents', 'addressSafetyRecords',
      'webhookQuarantine'
    ])
    EXCEPT
    SELECT key FROM jsonb_object_keys((SELECT result FROM t_qpurge_helper)) AS key
  )
  AND (
    SELECT count(*) FROM jsonb_object_keys((SELECT result FROM t_qpurge_helper))
  ) = 7,
  'plugin_data.csf_purge_durable_communications(uuid) returns exactly its seven documented keys'
);

CREATE TEMP TABLE t_purge AS
SELECT plugin_data.csf_purge_recovery_foundations(
  'bd100000-0000-4000-8000-000000000001'
) AS result;

SELECT extensions.is(
  (SELECT (result->>'dispatchAttempts')::integer > 0 FROM t_purge),
  true,
  'the existing purge entry point reports the dispatch attempts it retired'
);
SELECT extensions.is(
  (SELECT (result->>'preferenceDecisionEvents')::integer > 0 FROM t_purge),
  true,
  'the existing purge entry point retires consent history too'
);
SELECT extensions.is(
  (SELECT (result->>'broadcastPreferences')::integer FROM t_purge),
  5,
  'the existing purge entry point retires broadcast consent for that organization'
);
SELECT extensions.is(
  (
    SELECT (result->>'addressSafetyRecords')::integer > 0
      AND (result->>'addressSafetyEvents')::integer > 0
    FROM t_purge
  ),
  true,
  'the existing purge entry point retires the address-safety projection and its evidence'
);

SELECT extensions.is(
  (
    SELECT
      (SELECT count(*) FROM plugin_data.csf_communication_dispatch_attempts
       WHERE organization_id = 'bd100000-0000-4000-8000-000000000001')
      + (SELECT count(*) FROM plugin_data.csf_communication_preference_events
         WHERE organization_id = 'bd100000-0000-4000-8000-000000000001')
      + (SELECT count(*) FROM plugin_data.csf_communication_broadcast_preferences
         WHERE organization_id = 'bd100000-0000-4000-8000-000000000001')
      + (SELECT count(*) FROM plugin_data.csf_communication_address_safety
         WHERE organization_id = 'bd100000-0000-4000-8000-000000000001')
      + (SELECT count(*) FROM plugin_data.csf_communication_address_safety_events
         WHERE organization_id = 'bd100000-0000-4000-8000-000000000001')
      + (SELECT count(*) FROM plugin_data.csf_communication_provider_events
         WHERE organization_id = 'bd100000-0000-4000-8000-000000000001')
      + (SELECT count(*) FROM plugin_data.csf_communication_deliveries
         WHERE organization_id = 'bd100000-0000-4000-8000-000000000001')
      + (SELECT count(*) FROM plugin_data.csf_communication_recipient_snapshots
         WHERE organization_id = 'bd100000-0000-4000-8000-000000000001')
      + (SELECT count(*) FROM plugin_data.csf_communication_campaigns
         WHERE organization_id = 'bd100000-0000-4000-8000-000000000001')
      -- The tenth ledger, previously absent from an aggregate whose description
      -- claimed the WHOLE footprint. Both coordinates, mirroring the purge's own
      -- predicate: N1 left rows claiming this organization, and counting only
      -- organization_id would have missed every one of them.
      + (SELECT count(*) FROM plugin_data.csf_communication_webhook_quarantine
         WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
            OR claimed_organization_id = 'bd100000-0000-4000-8000-000000000001')
  )::integer,
  0,
  'the purge removes the whole durable communications footprint for one organization, all ten ledgers'
);

SELECT extensions.is(
  (
    SELECT
      (SELECT count(*) FROM plugin_data.csf_communication_broadcast_preferences
       WHERE organization_id = 'bd100000-0000-4000-8000-000000000002')
      + (SELECT count(*) FROM plugin_data.csf_communication_campaigns
         WHERE organization_id = 'bd100000-0000-4000-8000-000000000002')
  )::integer,
  2,
  'the purge leaves the other organization entirely untouched'
);

SELECT * FROM extensions.finish();
ROLLBACK;
