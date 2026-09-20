-- The sender identity every CSF campaign lane records, and the context a notice
-- may quote. Catalog shape, roles, and behaviour against the real constraint.
--
-- No provider is contacted and nothing is sent. "Records an identity" here is a
-- statement about a row. Whether a provider would accept that address is not a
-- fact this file can establish.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(18);

-- ---------------------------------------------------------------------------
-- 1. Shape and reach
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_campaign_platform_sender_identity()') IS NOT NULL,
  'the campaign sender identity trigger function is defined'
);

SELECT extensions.ok(
  p.prosecdef AND p.proconfig @> ARRAY['search_path=""']::text[],
  'the sender identity function is SECURITY DEFINER with an empty search_path'
)
FROM pg_proc p
WHERE p.oid = to_regprocedure('plugin_data.csf_campaign_platform_sender_identity()');

-- It decides what a member's inbox shows as the origin of chapter mail. No
-- caller outside the database invokes it directly, which includes the service
-- role the workers run as.
SELECT extensions.ok(
  NOT has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE')
  AND NOT has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE')
  AND NOT has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE'),
  format('%s is unreachable from anon, authenticated and service_role', signature)
)
FROM (VALUES
  ('plugin_data.csf_campaign_platform_sender_identity()')
) AS expected(signature);

-- The replaced authorization function keeps exactly the reach it had.
SELECT extensions.ok(
  NOT has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE')
  AND NOT has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE')
  AND has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE'),
  format('%s stays worker-only', signature)
)
FROM (VALUES
  ('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)')
) AS expected(signature);

-- No client-callable public function was introduced, so nothing was added to
-- the architecture catalog allowlist. This fails if one ever is.
SELECT extensions.is(
  (SELECT count(*)::int FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'csf_campaign_platform_sender_identity',
       'csf_authorize_publication_notification')),
  0,
  'this migration adds no function to the public schema'
);

-- ---------------------------------------------------------------------------
-- 2. The trigger fires before the content digest, and only on INSERT
-- ---------------------------------------------------------------------------
-- The digest covers the sender, so a substitution after derivation would leave
-- a hash describing a sender the row no longer carries. BEFORE triggers fire in
-- name order, and this is what pins the order.
SELECT extensions.ok(
  (SELECT t.tgname FROM pg_trigger t
   WHERE t.tgrelid = 'plugin_data.csf_communication_campaigns'::regclass
     AND NOT t.tgisinternal
     AND t.tgfoid = to_regprocedure('plugin_data.csf_campaign_platform_sender_identity()'))
  < 'csf_communication_campaigns_content_derive',
  'the sender substitution runs before the content digest is derived'
);

-- tgtype bit 4 is INSERT and bit 16 is UPDATE. Asserting both is what says no
-- existing campaign, finalized or not, can have its sender rewritten.
SELECT extensions.is(
  (SELECT ((t.tgtype & 4) > 0)::text || '/' || ((t.tgtype & 16) > 0)::text
   FROM pg_trigger t
   WHERE t.tgrelid = 'plugin_data.csf_communication_campaigns'::regclass
     AND NOT t.tgisinternal
     AND t.tgfoid = to_regprocedure('plugin_data.csf_campaign_platform_sender_identity()')),
  'true/false',
  'the sender substitution fires on INSERT and never on UPDATE'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM pg_trigger t
   JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal
     AND t.tgfoid = to_regprocedure('plugin_data.csf_campaign_platform_sender_identity()')
     AND c.relname <> 'csf_communication_campaigns'),
  0,
  'the sender substitution is attached to the campaign table and nothing else'
);

-- ---------------------------------------------------------------------------
-- 3. Both identities are accepted by the dispatch rule
-- ---------------------------------------------------------------------------
-- The historical identity cannot be inserted after this migration, because the
-- substitution is exactly what is under test, so its acceptance is asserted
-- from the constraint itself. That acceptance is also enforced at deploy time:
-- the constraint is added validating, so a pre-existing finalized campaign it
-- rejected would fail the migration rather than reach this file.
SELECT extensions.ok(
  pg_get_constraintdef(oid) LIKE '%csf@notifications.lets-assist.com%'
  AND pg_get_constraintdef(oid) LIKE '%projects@notifications.lets-assist.com%'
  AND pg_get_constraintdef(oid) LIKE '%dvhs-csf@notifications.lets-assist.com%'
  AND pg_get_constraintdef(oid) LIKE '%dvhighcsf@gmail.com%',
  'the dispatch rule accepts the historical identity and the platform identity'
)
FROM pg_constraint
WHERE conrelid = 'plugin_data.csf_communication_campaigns'::regclass
  AND conname = 'csf_communication_campaigns_dispatch_identity_check';

-- ---------------------------------------------------------------------------
-- 4. Behaviour against the real table
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE sender_behavior (key text PRIMARY KEY, value text);

DO $do$
DECLARE
  c_org constant uuid := 'ed100000-0000-4000-8000-000000000001'::uuid;
  c_term constant uuid := 'ed200000-0000-4000-8000-000000000001'::uuid;
  c_new constant uuid := 'ed300000-0000-4000-8000-000000000001'::uuid;
  c_foreign constant uuid := 'ed300000-0000-4000-8000-000000000003'::uuid;
BEGIN
  INSERT INTO public.organizations (id, name, username, type, join_code)
  VALUES (c_org, 'Sender Identity Chapter', 'sender-identity-chapter', 'school', '887001');

  INSERT INTO plugin_data.csf_terms
    (id, organization_id, code, label, school_year, semester, is_current)
  VALUES (c_term, c_org, 'F30', 'Fall 2030', '2030-2031', 'fall', true);

  -- Authored with the historical identity, as all five campaign lanes do.
  INSERT INTO plugin_data.csf_communication_campaigns (
    id, organization_id, campaign_kind, status, channel,
    sender_name, sender_email, reply_to_email,
    subject, body_text, body_text_hash, term_id, audience_kind,
    created_by_identity, content_finalized_at, content_finalized_by_identity,
    audience_snapshot_version, provider_idempotency_key
  ) VALUES (
    c_new, c_org, 'transactional', 'draft', 'email',
    'DVHS CSF', 'csf@notifications.lets-assist.com', 'dvhighcsf@gmail.com',
    'Authored with the historical identity', 'Body text.', repeat('a', 64),
    c_term, 'custom_list',
    'system:csf-notice', now(), 'system:csf-notice',
    1, 'sender-identity-new'
  );

  INSERT INTO sender_behavior (key, value)
  SELECT 'new.identity',
         campaign.sender_name || '|' || campaign.sender_email
           || '|' || campaign.reply_to_email
  FROM plugin_data.csf_communication_campaigns AS campaign WHERE campaign.id = c_new;

  INSERT INTO sender_behavior (key, value)
  SELECT 'new.dispatchReady', (campaign.content_hash IS NOT NULL)::text
  FROM plugin_data.csf_communication_campaigns AS campaign WHERE campaign.id = c_new;

  -- Frozen content is still frozen. The substitution changed what a new row
  -- records; it did not make a finalized campaign editable.
  BEGIN
    UPDATE plugin_data.csf_communication_campaigns
    SET sender_email = 'csf@notifications.lets-assist.com'
    WHERE id = c_new;
    INSERT INTO sender_behavior (key, value) VALUES ('new.updateSqlstate', 'accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO sender_behavior (key, value) VALUES ('new.updateSqlstate', SQLSTATE);
  END;

  -- An unreviewed sender is refused rather than silently corrected, so the
  -- substitution cannot become a way to launder an arbitrary From line.
  BEGIN
    INSERT INTO plugin_data.csf_communication_campaigns (
      id, organization_id, campaign_kind, status, channel,
      sender_name, sender_email, reply_to_email,
      subject, body_text, body_text_hash, term_id, audience_kind,
      created_by_identity, content_finalized_at, content_finalized_by_identity,
      audience_snapshot_version, provider_idempotency_key
    ) VALUES (
      c_foreign, c_org, 'transactional', 'draft', 'email',
      'Someone Else', 'someone@example.test', 'dvhighcsf@gmail.com',
      'Authored with a sender nobody reviewed', 'Body text.', repeat('c', 64),
      c_term, 'custom_list',
      'system:csf-notice', now(), 'system:csf-notice',
      1, 'sender-identity-foreign'
    );
    INSERT INTO sender_behavior (key, value) VALUES ('foreign.sqlstate', 'accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO sender_behavior (key, value) VALUES ('foreign.sqlstate', SQLSTATE);
  END;
END;
$do$;

SELECT extensions.is(
  (SELECT value FROM sender_behavior WHERE key = 'new.identity'),
  'DVHS CSF|dvhs-csf@notifications.lets-assist.com|dvhighcsf@gmail.com',
  'a new campaign records the chapter mailbox and display name'
);

SELECT extensions.is(
  (SELECT value FROM sender_behavior WHERE key = 'new.dispatchReady'), 'true',
  'a campaign carrying the platform identity reaches a content digest'
);

SELECT extensions.is(
  (SELECT value FROM sender_behavior WHERE key = 'new.updateSqlstate'), '23514',
  'a finalized campaign sender cannot be rewritten afterwards'
);

SELECT extensions.is(
  (SELECT value FROM sender_behavior WHERE key = 'foreign.sqlstate'), '23514',
  'an unreviewed sender is refused rather than corrected into a valid one'
);

-- ---------------------------------------------------------------------------
-- 5. Nothing in the decision path announces or mails
-- ---------------------------------------------------------------------------
-- Restated forward against this migration. A decision is staged, synced and
-- released without a member-visible event, and none of that path may acquire a
-- trigger that records a notice or writes a campaign sender.
SELECT extensions.is(
  (SELECT count(*)::int FROM pg_trigger t
   JOIN pg_class c ON c.oid = t.tgrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT t.tgisinternal
     AND n.nspname = 'plugin_data'
     AND (c.relname LIKE '%decision%' OR c.relname LIKE '%application%')
     AND t.tgfoid IN (
       to_regprocedure('plugin_data.csf_record_publication_notifications()'),
       to_regprocedure('plugin_data.csf_record_point_submission_notification()'),
       to_regprocedure('plugin_data.csf_record_profile_notification()'),
       to_regprocedure('plugin_data.csf_campaign_platform_sender_identity()'),
       to_regprocedure(
         'plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text)'))),
  0,
  'decision staging, sync and release still announce nothing and mail nothing'
);

-- ---------------------------------------------------------------------------
-- 6. The authorization payload carries the added context keys
-- ---------------------------------------------------------------------------
-- Read from the shipped source: calling it needs a live lease, which
-- csf_detailed_publication_notices.test.sql establishes separately.
SELECT extensions.ok(
  pg_get_functiondef(
    to_regprocedure('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)')
  ) LIKE '%' || key || '%',
  format('the authorization payload names %s', key)
)
FROM (VALUES ('termLabel'), ('audienceLabel'), ('authorizedOutcome')) AS expected(key);

-- A profile branch that read a title or a status would defeat the privacy rule
-- the notice wording depends on.
SELECT extensions.ok(
  pg_get_functiondef(
    to_regprocedure('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)')
  ) LIKE '%v_subject := NULL;%',
  'the profile branch still returns no subject'
);

SELECT * FROM extensions.finish();

ROLLBACK;
