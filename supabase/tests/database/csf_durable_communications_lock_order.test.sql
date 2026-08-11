-- Durable CSF communications: canonical lock order.
--
-- Every function that mutates campaign-scoped state takes the same locks in the
-- same order:
--
--   1. bounded, UNLOCKED coordinate discovery
--   2. the campaign advisory lock
--   3. the campaign row (FOR UPDATE)
--   4. the attempt row
--   5. the delivery row
--
-- The order is not decoration. Cancellation, settlement, reaping, provider
-- evidence, reconciliation, and -- as of this correction -- draft authoring all
-- run concurrently against the same campaign, and any one of them taking the
-- delivery before the attempt, or the attempt before the campaign, is a deadlock
-- that only appears under load.
--
-- These are SOURCE assertions on purpose. A deadlock is precisely the failure a
-- functional test cannot reproduce on demand: it needs two sessions interleaved
-- at one instruction. Pinning the order in the source is what makes a regression
-- visible at review time instead of at 400 concurrent sends.
--
-- The whole file runs inside one transaction and ends in ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- An exact plan. See the note in csf_durable_communications_contract.test.sql:
-- no_plan() cannot distinguish "every assertion passed" from "some never ran".
SELECT extensions.plan(14);

-- ---------------------------------------------------------------------------
-- A. THE CAMPAIGN ADVISORY LOCK IS TAKEN ON THE SAME KEY EVERYWHERE
--
-- Two functions locking 'csf-campaign:...' and 'csf-communication-campaign:...'
-- would take two DIFFERENT locks and serialize against nothing at all.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_get_functiondef(routine_name::regprocedure)
        LIKE '%csf-communication-campaign:%'
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_cancel_communication_campaign(uuid,uuid,text,uuid,text)',
      'plugin_data.csf_settle_communication_dispatch_attempt(uuid,uuid,text,text,text,integer,text,text,integer,integer,jsonb)',
      'plugin_data.csf_resolve_communication_provider_evidence(uuid,uuid)',
      'plugin_data.csf_reconcile_communication_unknown_outcome(uuid,uuid,text,text,text,uuid,text,text)',
      'plugin_data.csf_update_communication_campaign_draft(uuid,uuid,uuid,text,text,text,text)'
    ]) AS routine_name
  ),
  'every campaign-scoped mutator takes the campaign advisory lock on the one canonical key'
);

-- ---------------------------------------------------------------------------
-- B. THE CAMPAIGN ADVISORY LOCK PRECEDES THE CAMPAIGN ROW LOCK
--
-- Taking the row first lets two sessions hold each other's row while queueing for
-- the advisory lock.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'csf-communication-campaign:'
      ) < pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'FOR UPDATE'
      )
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_cancel_communication_campaign(uuid,uuid,text,uuid,text)',
      'plugin_data.csf_reconcile_communication_unknown_outcome(uuid,uuid,text,text,text,uuid,text,text)',
      'plugin_data.csf_update_communication_campaign_draft(uuid,uuid,uuid,text,text,text,text)'
    ]) AS routine_name
  ),
  'the campaign advisory lock is always taken before the first row lock'
);

-- ---------------------------------------------------------------------------
-- C. THE NEW AUTHORING PATH JOINS THE ORDER RATHER THAN INVENTING ONE
--
-- Draft editing races content finalization and cancellation against the same
-- campaign row. It therefore takes exactly the two locks they take, in the same
-- order, and takes no attempt or delivery lock at all -- it has no business
-- there, and reaching further down the order would invert it.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_update_communication_campaign_draft(uuid,uuid,uuid,text,text,text,text)'::regprocedure
  ) LIKE '%pg_advisory_xact_lock%',
  'draft editing takes a transaction-scoped advisory lock, released with the transaction'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_update_communication_campaign_draft(uuid,uuid,uuid,text,text,text,text)'::regprocedure
  ) NOT LIKE '%csf_communication_dispatch_attempts%',
  'draft editing never reaches the attempt ledger, so it cannot invert the lock order below it'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_update_communication_campaign_draft(uuid,uuid,uuid,text,text,text,text)'::regprocedure
  ) NOT LIKE '%csf_communication_deliveries%',
  'draft editing never reaches the delivery ledger either'
);

-- Creating a draft touches exactly one row that no other session can name yet,
-- so it takes no lock at all. Taking one would be pure contention.
SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_create_communication_campaign_draft(uuid,text,text,text,uuid,uuid,text,text,text,text,jsonb,text,uuid)'::regprocedure
  ) NOT LIKE '%pg_advisory_xact_lock%',
  'creating a draft locks nothing: the row it inserts has no other claimant'
);

-- ---------------------------------------------------------------------------
-- D. THE CONSENT COORDINATE LOCK
--
-- A preference decision is keyed on (organization, topic, address) and the row
-- often does not exist yet. An absent row locks nothing, so two concurrent first
-- decisions would both insert and one would lose to the unique key with no
-- evidence of the race -- the advisory lock on the coordinate is what makes the
-- first decision serializable.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_record_broadcast_preference_decision(uuid,text,text,text,text,text,uuid,text,text)'::regprocedure
  ) LIKE '%csf-communication-preference:%',
  'a broadcast preference decision takes an advisory lock on its own consent coordinate'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_get_functiondef(
      'plugin_data.csf_record_broadcast_preference_decision(uuid,text,text,text,text,text,uuid,text,text)'::regprocedure
    ),
    'csf-communication-preference:'
  ) < pg_catalog.strpos(
    pg_get_functiondef(
      'plugin_data.csf_record_broadcast_preference_decision(uuid,text,text,text,text,text,uuid,text,text)'::regprocedure
    ),
    'FOR UPDATE'
  ),
  'the consent coordinate lock is taken before the preference row is read for update'
);

-- The consent coordinate lock is a DIFFERENT namespace from the campaign one, so
-- a preference decision and a campaign mutation never contend with each other.
SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_record_broadcast_preference_decision(uuid,text,text,text,text,text,uuid,text,text)'::regprocedure
  ) NOT LIKE '%csf-communication-campaign:%',
  'a consent decision does not take the campaign lock; the two never contend'
);

-- ---------------------------------------------------------------------------
-- E. AUTHORIZATION PRECEDES EVERY LOCK
--
-- An unauthorized caller must not be able to hold a lock on a campaign it may not
-- see. Checking authority first makes a refused call cost nothing and keeps a
-- 42501 path from becoming a denial-of-service primitive.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (
    SELECT bool_and(
      pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'csf_actor_has_permission'
      ) < pg_catalog.strpos(
        pg_get_functiondef(routine_name::regprocedure),
        'pg_advisory_xact_lock'
      )
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_update_communication_campaign_draft(uuid,uuid,uuid,text,text,text,text)',
      'plugin_data.csf_record_broadcast_preference_decision(uuid,text,text,text,text,text,uuid,text,text)'
    ]) AS routine_name
  ),
  'the actor capability check runs before any lock is taken'
);

-- ---------------------------------------------------------------------------
-- F. EVERY NEW ENTRYPOINT IS SERVER-ONLY
--
-- The doors added for authoring and consent are least-privilege in the same sense
-- as the rest: SECURITY DEFINER, service_role EXECUTE only, and no browser role
-- holds any privilege on them.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (
    SELECT bool_and(routine.prosecdef)
    FROM unnest(ARRAY[
      'plugin_data.csf_create_communication_campaign_draft(uuid,text,text,text,uuid,uuid,text,text,text,text,jsonb,text,uuid)',
      'plugin_data.csf_update_communication_campaign_draft(uuid,uuid,uuid,text,text,text,text)',
      'plugin_data.csf_record_broadcast_preference_decision(uuid,text,text,text,text,text,uuid,text,text)'
    ]) AS routine_name
    JOIN pg_proc AS routine ON routine.oid = routine_name::regprocedure
  ),
  'every new communications entrypoint is SECURITY DEFINER'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      NOT has_function_privilege('anon', routine_name::regprocedure, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', routine_name::regprocedure, 'EXECUTE')
      AND has_function_privilege('service_role', routine_name::regprocedure, 'EXECUTE')
    )
    FROM unnest(ARRAY[
      'plugin_data.csf_create_communication_campaign_draft(uuid,text,text,text,uuid,uuid,text,text,text,text,jsonb,text,uuid)',
      'plugin_data.csf_update_communication_campaign_draft(uuid,uuid,uuid,text,text,text,text)',
      'plugin_data.csf_record_broadcast_preference_decision(uuid,text,text,text,text,text,uuid,text,text)'
    ]) AS routine_name
  ),
  'no browser role can execute the new entrypoints; service_role alone can'
);

-- Each new entrypoint pins an empty search_path, so an attacker-controlled schema
-- can never shadow a function it calls.
SELECT extensions.ok(
  (
    SELECT bool_and(routine.proconfig @> ARRAY['search_path=""'])
    FROM unnest(ARRAY[
      'plugin_data.csf_create_communication_campaign_draft(uuid,text,text,text,uuid,uuid,text,text,text,text,jsonb,text,uuid)',
      'plugin_data.csf_update_communication_campaign_draft(uuid,uuid,uuid,text,text,text,text)',
      'plugin_data.csf_record_broadcast_preference_decision(uuid,text,text,text,text,text,uuid,text,text)'
    ]) AS routine_name
    JOIN pg_proc AS routine ON routine.oid = routine_name::regprocedure
  ),
  'every new entrypoint pins an empty search_path'
);

-- ---------------------------------------------------------------------------
-- G. THE WRITE BOUNDARY IS UNCHANGED
--
-- The whole point of adding RPCs rather than grants: service_role must still hold
-- SELECT and nothing else on all ten ledgers.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (
    SELECT bool_and(
      has_table_privilege('service_role', table_name, 'SELECT')
      AND NOT has_table_privilege('service_role', table_name, 'INSERT')
      AND NOT has_table_privilege('service_role', table_name, 'UPDATE')
      AND NOT has_table_privilege('service_role', table_name, 'DELETE')
    )
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
    ]) AS table_name
  ),
  'adding authoring and consent entrypoints did not add a single table write grant'
);

SELECT * FROM extensions.finish();
ROLLBACK;
